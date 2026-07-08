# AGENTS.md

이 문서는 Codex가 이 저장소에서 작업할 때 따라야 할 프로젝트 전용 가이드입니다.

## 작업 원칙

- 사용자의 기존 변경사항을 되돌리지 않습니다. 현재 워킹트리는 변경/삭제/추가 파일이 많을 수 있으므로 작업 전 `git status --short`로 범위를 확인합니다.
- `.env`, `secreats/`, `instantclient/`, 지갑 ZIP, DB 비밀번호, API 키는 읽거나 출력하거나 커밋하지 않습니다.
- 새 문서/코드는 UTF-8로 작성합니다. 기존 파일에 깨진 한글이 있더라도 요청 범위 밖의 대량 인코딩 정리는 하지 않습니다.
- SQL과 DB DDL은 영향 범위가 크므로, 사용자가 명시하지 않은 스키마 변경이나 데이터 삭제를 실행하지 않습니다.
- 파일 검색은 `rg` 또는 `rg --files`를 우선 사용합니다.
- CSS를 수정할 때는 문제를 덮기 위해 새 override를 계속 추가하지 않습니다. 먼저 기존 선택자, 중복 규칙, media query, cascade 순서를 추적해 원인이 되는 원본 규칙을 수정하거나 정리합니다. 불가피하게 override가 필요하면 이유와 범위를 설명하고, 관련 중복 규칙을 함께 정리합니다.
- 모든 최종 답변 마지막에는 `Usage 확인: VS Code Codex 입력창에서 /status` 문구를 반드시 추가합니다.

## 보안 필수 기준

- 인증/인가 판단은 서버 세션 쿠키와 시스템 DB 조회를 기준으로 합니다. 브라우저 `sessionStorage`, `localStorage`, GET/POST 파라미터, `X-Login-*` 헤더를 사용자 ID/관리자 권한 근거로 사용하지 않습니다.
- 새 API는 기본적으로 로그인 세션을 요구해야 합니다. 공개 API가 필요하면 `main.py`의 공개 예외 목록에 좁게 추가하고, bootstrap/API key 등 별도 검증을 라우터에서 수행합니다.
- 관리자 메뉴 또는 관리자 기능 API는 서버 측 `require_admin_role` 또는 전역 관리자 API 정책을 반드시 통과해야 합니다. 프론트 메뉴 숨김은 보조 UI일 뿐 보안 경계가 아닙니다.
- DB 비밀번호, 지갑 비밀번호, 외부 API Key, 관리자 인증키는 브라우저 응답/캐시/쿠키/JS에 남기지 않습니다. 저장이 필요하면 `backend.security.encrypt_secret`/`decrypt_secret` 경로를 사용하고 운영 환경에는 `INIT_SECRET_KEY`를 설정해야 합니다.
- `database/`, `.env`, `secreats/`, `instantclient/`, 지갑 ZIP, 백엔드 소스가 정적 URL로 노출되도록 라우팅하거나 마운트하지 않습니다.
- 동적 SQL 실행 기능을 수정할 때는 화면에서 허용한 범위만 서버에서 다시 검증합니다. SELECT 경로는 읽기 전용이어야 하고, 일반 사용자 PL/SQL에서 `EXECUTE IMMEDIATE`, `DBMS_SQL`, `DROP`, `TRUNCATE`, `ALTER`, `GRANT`, `REVOKE` 우회를 허용하지 않습니다.
- 내장 Python API를 HTTP로 직접 노출할 때는 `INIT_INTERNAL_API_KEY` 기반 인증과 서버 환경변수의 서비스 사용자/Target DB 연결만 사용합니다. 사용자 ID를 헤더로 받아 실행하지 않습니다.

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
- Codex 셸에서 Python 명령을 실행할 때는 기본 `python` 대신 `.\venv\Scripts\python.exe`를 우선 사용합니다. UTF-8 가드가 함께 필요하면 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\codex-venv.ps1 ...` 형태로 실행합니다.

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
.\venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Tailwind 결과물이 필요하면 다음 명령을 사용합니다.

```powershell
npx tailwindcss -i ./frontend/css/input.css -o ./frontend/css/output.css --watch
```

## SQL 작성 스타일

- SQL을 새로 작성하거나 요청 범위 안에서 정리할 때는 아래 comma-first 정렬 스타일을 우선 사용합니다.
- `SELECT`는 서브쿼리의 시작점이자 정렬 기준입니다. `SELECT` 6글자 끝 위치를 기준으로 다음 컬럼의 콤마(`,`)와 `FROM`, `WHERE`, `GROUP`, `ORDER`, `HAVING` 같은 주요 절 키워드를 오른쪽 정렬합니다.
- 첫 컬럼은 반드시 `SELECT 컬럼` 형태로 같은 줄에 둡니다. `SELECT`만 단독으로 한 줄에 쓰고 다음 줄에 첫 컬럼을 두지 않습니다.
- 두 번째 컬럼부터는 `     , 컬럼` 형태로 콤마를 줄 앞에 둡니다.
- 함수 인자, `DECODE(...)`, `NVL2(...)`, `IN (...)`처럼 표현식 내부의 콤마는 컬럼/값 구분용 콤마로 보지 않고 임의 줄바꿈하지 않습니다. `CASE WHEN`은 `WHEN 조건 THEN 결과` 한 쌍을 가능하면 한 줄에 둡니다. 긴 산식이나 긴 조건처럼 줄바꿈이 필요한 표현식은 컬럼 구분 콤마 정렬 위치보다 최소 한 칸 더 안쪽으로 들여써 컬럼 구분 콤마와 구별합니다.
- `FROM`, `JOIN`, `WHERE`는 앞 공백을 포함해 `SELECT` 기준에 맞추고, `ON`, `AND`, `OR` 조건도 같은 세로 정렬 감각으로 배치합니다.
- `WHERE` 조건은 가능하면 `WHERE 1=1`로 시작하고, 이후 조건은 `   AND ...` 형태로 이어갑니다.
- `GROUP BY`, `ORDER BY` 뒤의 두 번째 이후 표현식도 comma-first로 맞춥니다. 예: `        , 컬럼`
- `INSERT` 컬럼 목록과 `VALUES` 값 목록도 같은 comma-first 규칙을 적용합니다. 괄호 안 첫 항목은 기존 들여쓰기 위치에 두고, 두 번째 항목부터는 첫 항목의 시작 위치보다 두 칸 앞에 콤마를 둡니다. 예: `  , USER_EMAIL`
- `UPDATE ... SET` 목록도 첫 대입문은 `SET 컬럼 = 값` 형태로 두고, 두 번째 대입문부터는 `     , 컬럼 = 값` 형태로 콤마를 줄 앞에 둡니다. `MERGE ... UPDATE SET`처럼 `UPDATE SET`이 별도 줄이면 첫 대입문 줄의 시작 위치를 기준으로 comma-first 정렬합니다.
- 서브쿼리는 여는 괄호 `(`를 별도 줄에 두고, 내부 `SELECT`는 괄호 위치보다 한 칸 뒤에서 시작합니다. 닫는 괄호 `)`는 여는 괄호와 같은 열에 둡니다.
- 기존 SQL 전체를 요청 없이 대량 포맷팅하지 않습니다. 새로 작성하거나 직접 수정하는 SQL 블록에만 이 스타일을 적용합니다.

## Oracle Cloud Target DB / 대용량 DML 주의

- Oracle Cloud 기반 Target DB에서 대용량 `DELETE`, `UPDATE`, `MERGE`, `INSERT SELECT` 또는 분석 프로시저를 수정할 때는 병렬 실행으로 인한 대기 가능성을 기본 점검합니다.
- 실행 중 `enq: PS - contention` 이벤트가 보이면 일반적인 행 락보다 Parallel Statement/Parallel Server 자원 경합 가능성을 먼저 의심합니다.
- 대용량 DML을 의도적으로 병렬 처리하지 않는 프로시저는 `ALTER SESSION DISABLE PARALLEL DML`만으로 충분한지 확인하고, `INSERT SELECT`처럼 조회부가 큰 경우 `ALTER SESSION DISABLE PARALLEL QUERY`와 `NO_PARALLEL` 힌트 적용 여부도 함께 검토합니다.
- 대용량 결과 생성 프로시저는 한 번에 너무 큰 DML을 수행하지 않도록 블록 단위 커밋 파라미터, 진행 상태 기록(`DBMS_APPLICATION_INFO` 등), 중간 건수 확인 방법을 함께 고려합니다.
- 병렬 차단은 Oracle Cloud 기반 Target DB에서 특히 필요한 방어이며, 모든 환경에 무조건 적용하기보다 대상 DB 특성과 작업량을 보고 좁게 적용합니다.

예시:

```sql
SELECT P.CONDITION_VALUE1
     , P.CONDITION_VALUE2
     , P.RESULT_VALUE
     , P.SUPPORT_COUNT
     , DECODE(P.RESULT_VALUE, 'Y', 'YES', 'N', 'NO', 'UNKNOWN') AS RESULT_LABEL
     , CASE
           WHEN P.RULE_CONFIDENCE >= 0.9 AND P.RULE_LIFT >= 1 THEN 'HIGH'
           ELSE 'LOW'
       END AS RULE_GRADE
     , C.CONDITION_TOTAL_COUNT
     , R.RESULT_TOTAL_COUNT
     , T.TOTAL_COUNT
     , P.SUPPORT_COUNT / NULLIF(T.TOTAL_COUNT, 0) AS RULE_SUPPORT
     , P.SUPPORT_COUNT / NULLIF(C.CONDITION_TOTAL_COUNT, 0) AS RULE_CONFIDENCE
     , (P.SUPPORT_COUNT / NULLIF(C.CONDITION_TOTAL_COUNT, 0))
         / NULLIF(R.RESULT_TOTAL_COUNT / NULLIF(T.TOTAL_COUNT, 0), 0) AS RULE_LIFT
  FROM PAIR_COUNTS P
  JOIN CONDITION_COUNTS C
    ON C.CONDITION_VALUE1 = P.CONDITION_VALUE1
   AND C.CONDITION_VALUE2 = P.CONDITION_VALUE2
  JOIN RESULT_COUNTS R
    ON R.RESULT_VALUE = P.RESULT_VALUE
 CROSS JOIN TOTALS T
 WHERE 1=1
   AND P.RESULT_VALUE IS NOT NULL
 GROUP BY P.CONDITION_VALUE1
        , P.CONDITION_VALUE2
        , P.RESULT_VALUE
;

SELECT SYSDATE
     , T2.LEV
  FROM DUAL T1
     ,
     (
      SELECT LEVEL AS LEV
        FROM DUAL
      CONNECT BY LEVEL <= 10
     ) T2
 WHERE 1=1
   AND T2.LEV <= 5
;

INSERT INTO INIT$_TB_PROJECT (
    USER_ID
  , USER_EMAIL
  , PROJECT_CODE
) VALUES (
    :userId
  , :userEmail
  , :projectCode
);

UPDATE INIT$_TB_PROJECT
   SET PROJECT_CODE = :projectCode
     , USER_EMAIL = :userEmail
     , UPDATED_AT = SYSTIMESTAMP
 WHERE PROJECT_ID = :projectId
;
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
- `M02003`, `M02004`, `M03001`처럼 데이터 작업 공통 템플릿을 쓰는 화면은 `frontend/pages/MCOM_DATA_WORK.html`, `frontend/js/MCOM_DATA_WORK.js`, `backend/services/data_work_router.py` 패턴을 먼저 확인합니다.
- `M04001`처럼 FLOW 작업 공통 템플릿을 쓰는 화면은 `frontend/pages/MCOM_FLOW_WORK.html`, `frontend/js/MCOM_FLOW_WORK.js`, `backend/services/flow_work_router.py`, `frontend/js/M04001.js`, `PageManager.flowWorkTemplatePages` 패턴을 먼저 확인합니다.
- 캔버스/노드/팝업메뉴 이벤트 버그는 선택 상태만 추측해서 고치지 않습니다. 특히 "첫 실행만 실패하고 두 번째부터 성공"하면 이벤트 순서(`pointerdown`/`mousedown`/`click`/`contextmenu`), 실제 DOM 이벤트 타깃, 공통 템플릿 페이지 객체 재사용, `PageManager` 캐시/이미 열린 페이지 상태를 먼저 확인합니다.
- 캔버스 팝업메뉴의 삭제/복제처럼 특정 노드에 대한 액션은 화면에 보이는 활성 노드와 실제 액션 대상이 분리되지 않도록 메뉴가 열린 순간의 노드 ID뿐 아니라 실제 DOM 노드 또는 안정적인 액션 대상 스냅샷을 기준으로 처리합니다.
- FLOW 캔버스의 `Delete node`는 화면의 현재 캔버스/draft에서 노드를 제거하는 UI 편집 동작입니다. 이 액션에서 DB 삭제 API, 저장된 Flow/Node 삭제 SQL, run history 삭제를 직접 호출하지 않습니다.

## 새 화면 추가 절차

1. 메뉴 코드와 업무 범위를 정합니다. 예: `M12345`.
2. `database/M12345.sql`에 필요한 SQL ID를 추가합니다.
3. `backend/routers/M12345.py`를 작성합니다.
4. `main.py`에 라우터 import와 `routers` 항목을 추가합니다.
5. `frontend/pages/M12345.html`과 `frontend/js/M12345.js`를 작성합니다.
6. `frontend/config/menu.config.js`에 메뉴와 파일 목록을 등록합니다.
7. 서버를 재시작하거나 reload 후 `/docs`, 화면 로딩, 주요 API 응답을 확인합니다.

## 검증 체크리스트

- `.\venv\Scripts\python.exe -m compileall main.py backend`
- `.\venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000`
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
