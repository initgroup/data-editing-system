# Data Editing System 개발자 환경 이전 가이드

이 문서는 `data-editing-system` 프로젝트를 다른 PC로 옮겨 개발할 때 확인해야 할 항목을 정리한 안내서입니다. 압축 해제나 `git clone` 직후 이 파일을 먼저 확인하세요.

## 1. 현재 점검 결과 요약

- 애플리케이션 본문 코드의 정적 경로는 대부분 `Path(__file__).resolve()` 또는 상대 경로를 사용하므로 프로젝트 폴더 위치가 바뀌어도 기본 실행에는 큰 문제가 없습니다.
- 백업 스크립트의 기본 백업 위치는 프로젝트 상위 폴더의 `backup`으로 계산되도록 정리했습니다. 다른 위치를 원하면 `-BackupRoot` 값을 지정하세요.
- `README.md`의 로컬 개발 예시는 프로젝트 기준 상대 경로인 `DB_WALLET_PATH=secreats/Wallet_INITGROUPEDITING`로 정리했습니다. Linux/배포 환경에서는 `/etc/secrets` 같은 환경별 절대 경로로 바꿔야 합니다.
- `AGENTS.md`의 실행 명령은 대부분 `.\venv\...` 형태의 상대 경로라 프로젝트 루트에서 실행하면 다른 Windows PC에서도 그대로 사용할 수 있습니다. 다만 Windows가 아닌 환경에서는 가상환경 경로 표기법을 바꿔야 합니다.
- `prompt/codex01.txt`에는 개인 작업 메모 성격의 `D:\work\backup`, `git reset --hard`, `git push origin main` 예시가 있습니다. 배포 절차서로 그대로 복사하기보다 아래의 Git/백업 절차를 기준으로 확인하세요.
- `.gitignore`는 `venv/`, `.env`, 지갑/인증서 파일, Oracle Wallet ZIP, 로컬 wheel 파일을 제외하도록 보강했습니다. 기존에 추적 중이던 `venv/`, `Wallet_INITGROUPEDITING.zip`, `oracledb-3.4.2-cp312-cp312-win_amd64.whl`은 Git 추적 해제 대상으로 정리했습니다.

## 2. 다른 PC에 기본 설치할 도구

- Git
- Python 3.12 권장
- Node.js LTS: Tailwind CSS를 다시 빌드할 때 필요
- VS Code: 선택 사항이지만 `.vscode/tasks.json`의 백업 Task를 쓰려면 필요
- Oracle 접속 정보: 로컬 DB 또는 Cloud DB 접속 계정
- Oracle Wallet: Cloud Wallet 방식이면 필요하며 Git에 포함하지 않습니다.
- Oracle Instant Client: `DB_ORACLE_MODE=thick`를 사용할 때만 필요합니다. 기본 권장은 thin 모드입니다.

## 3. Git으로 받은 직후 확인

```powershell
git status --short
git branch --show-current
git remote -v
```

정상 기준:

- 기본 브랜치는 `main`입니다.
- 원격 저장소는 `origin https://github.com/initgroup/data-editing-system.git` 형식입니다.
- 새 PC에서는 `.env`, `venv/`, `node_modules/`, `secreats/`, `instantclient/`가 없어도 정상입니다. `.env.example`을 복사해 `.env`를 직접 만들어야 합니다.

배포 전 정리 권장. 이미 정리된 커밋을 받은 개발자는 다시 실행할 필요가 없습니다.

```powershell
git rm -r --cached venv
git rm --cached Wallet_INITGROUPEDITING.zip
git rm --cached oracledb-3.4.2-cp312-cp312-win_amd64.whl
```

위 명령은 Git 추적만 해제하고 로컬 파일은 남깁니다. 지갑 ZIP은 비밀 파일이므로 원격 저장소에 올리면 안 됩니다. `oracledb-3.4.2-cp312-cp312-win_amd64.whl`은 Python 3.12 Windows 전용 오프라인 설치용 파일입니다. 온라인 설치가 가능하면 `requirements.txt`의 `oracledb==3.4.2`로 충분합니다.

`.gitignore`에는 다음 로컬 폴더/파일이 제외되어 있어야 합니다.

```text
venv/
.venv/
.env
secreats/
.secreats/
etc/secrets/
instantclient/
.instantclient/
node_modules/
__pycache__/
*.pyc
```

## 4. 최초 개발자 환경 설정

프로젝트 루트에서 실행합니다.

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

PowerShell 실행 정책 때문에 가상환경 활성화가 막히면 현재 프로세스에서만 우회합니다.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\venv\Scripts\Activate.ps1
```

Tailwind CSS를 수정하거나 Node 패키지를 복원해야 하면 다음을 실행합니다.

```powershell
npm install
```

## 5. `.env` 설정

`.env`는 Git에 올리지 않습니다. 새 PC에서는 `.env.example`을 복사해 `.env`를 만들고 값을 채우세요.

로컬 DB 예시:

```text
DB_MODE=local
DB_USER_LOC=...
DB_PASSWORD_LOC=...
DB_HOST=127.0.0.1
DB_PORT=1521
DB_SERVICE=...
DB_ORACLE_MODE=thin

DB_POOL_MIN=1
DB_POOL_MAX=5
DB_POOL_INCREMENT=1
TARGET_DB_POOL_MIN=1
TARGET_DB_POOL_MAX=3
TARGET_DB_POOL_INCREMENT=1
```

Cloud Wallet 예시:

```text
DB_MODE=cloud
DB_USER_CLD=...
DB_PASSWORD_CLD=...
DB_DSN_CLD=...
DB_WALLET_PATH=secreats/Wallet_INITGROUPEDITING
DB_ORACLE_MODE=thin
```

`DB_WALLET_PATH`는 다음 중 하나로 맞춥니다.

- 프로젝트 내부 로컬 폴더: `secreats/Wallet_INITGROUPEDITING`
- Windows 절대 경로: `D:\somewhere\Wallet_INITGROUPEDITING`
- Linux/배포 환경: `/etc/secrets`

프로젝트의 `_resolve_project_path()` 로직은 상대 경로를 프로젝트 루트 기준으로 해석합니다. 따라서 다른 PC로 옮길 때는 가능하면 상대 경로를 권장합니다.

## 6. 로컬 서비스 구동

가상환경을 활성화한 상태라면:

```powershell
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

가상환경 활성화 여부와 무관하게 확실히 실행하려면:

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

확인 URL:

```text
http://127.0.0.1:8000
http://127.0.0.1:8000/docs
http://127.0.0.1:8000/api/health
```

Tailwind CSS를 수정할 때만 별도 터미널에서 실행합니다.

```powershell
npx tailwindcss -i ./frontend/css/input.css -o ./frontend/css/output.css --watch
```

## 7. `uvicorn main:app --reload` 동작 방식

- `uvicorn`은 FastAPI 같은 ASGI 앱을 실행하는 개발 서버입니다.
- `main:app`은 `main.py` 모듈을 import한 뒤 그 안의 `app = FastAPI(...)` 객체를 실행한다는 뜻입니다.
- `--reload`는 개발용 자동 재시작 옵션입니다. 파일이 바뀌면 reloader 프로세스가 앱 서버 프로세스를 다시 띄웁니다.
- `main.py`에서는 API 라우터를 먼저 `/api/{tag}`로 등록하고, 마지막에 `frontend/`를 정적 파일로 마운트합니다. 그래서 `/api/health` 같은 API와 `/index.html` 같은 프론트 파일이 함께 서비스됩니다.
- 서버 시작 시 `startup_event()`가 등록된 API 경로를 로그로 출력합니다.
- DB 커넥션 풀은 보통 요청에서 `get_db_connection()` 또는 `get_target_db_connection()`을 호출할 때 초기화됩니다. 서버가 켜졌다고 DB 연결이 항상 즉시 성공했다는 뜻은 아닙니다.
- `--reload`는 운영 배포용이 아닙니다. 개발 PC에서만 사용하세요.

## 8. 외부 설치 라이브러리 주의

기본 실행 의존성은 `requirements.txt`에 있습니다.

```powershell
pip install -r requirements.txt
```

현재 개발 PC의 `venv`에는 `requirements.txt`보다 많은 패키지가 설치되어 있을 수 있습니다. 특히 다음은 주의합니다.

- `pysr`, `juliacall`, Julia 관련 패키지: `P_USE_PYSR=Y`로 Symbolic Regression을 실행할 때만 필요합니다. 기본값은 `P_USE_PYSR=N`으로 두는 것을 권장합니다.
- `pandas`, `scipy`: 현재 venv에는 설치되어 있지만 기본 requirements에는 없습니다. 코드에서 직접 필수 import하지 않는지 확인 후 필요하면 requirements에 추가합니다.
- `oracledb`: 현재 PC venv에서는 로컬 whl 경로로 설치된 흔적이 있을 수 있습니다. 새 PC에서는 `requirements.txt`로 설치하거나, 오프라인일 때만 whl 파일을 직접 사용합니다.
- `uvicorn`: 가상환경을 활성화하지 않으면 `uvicorn` 명령이 없거나 전역 설치본이 실행될 수 있습니다. 안전하게는 `.\venv\Scripts\python.exe -m uvicorn ...` 형식을 사용하세요.

## 9. Git 배포 절차

배포 전 상태 확인:

```powershell
git status --short
git diff --stat
```

커밋:

```powershell
git add -A
git commit -m "작업 내용 요약"
```

원격 반영:

```powershell
git pull --rebase origin main
git push origin main
```

주의:

- `git reset --hard`는 로컬 변경사항을 삭제합니다. 백업 또는 명확한 요청 없이 사용하지 마세요.
- `.env`, 지갑 ZIP, `secreats/`, `instantclient/`, `venv/`, `node_modules/`가 스테이징되지 않았는지 항상 확인하세요.
- `git archive` 방식 백업은 Git에 추적 중인 파일만 포함하므로, 잘못 추적 중인 비밀 파일도 같이 들어갈 수 있습니다.

## 10. 백업 정책

백업 스크립트:

```powershell
.\scripts\backup-source.ps1
```

모드:

- `Git`: 현재 커밋된 `HEAD` 기준으로 백업합니다. 내부적으로 `git archive`를 사용합니다.
- `Working`: 현재 작업 폴더를 백업합니다. `.git`, `venv`, `node_modules`, `.env`, `secreats`, `etc\secrets`, `instantclient`, `__pycache__` 등을 제외합니다.

기본 백업 위치는 프로젝트 상위 폴더의 `backup`입니다. 예를 들어 프로젝트가 `D:\work\data-editing-system`이면 기본 백업 위치는 `D:\work\backup`입니다. 다른 위치를 쓰려면 아래처럼 명시하세요.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-source.ps1 -Mode Git -BackupRoot "D:\work\backup"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-source.ps1 -Mode Working -BackupRoot "D:\work\backup"
```

VS Code Task:

- `INIT Backup Source`: 실행 시 `Git` 또는 `Working` 선택
- `INIT Backup Git Source`: Git 커밋본만 백업
- `INIT Backup Working Source`: 현재 작업본 백업

VS Code에서는 `Ctrl + Shift + P` 후 `Tasks: Run Task`를 선택하면 됩니다.

## 11. README.md, AGENTS.md, codex01.txt 확인 기준

- `README.md`: 로컬 개발 기준으로 `.env.example`, 상대 Wallet 경로, `.\venv\Scripts\python.exe -m uvicorn ...` 실행 예시를 사용합니다. 배포 환경에서는 Wallet 경로를 환경에 맞게 바꾸세요.
- `AGENTS.md`: 프로젝트 작업 규칙 문서입니다. `.\venv\Scripts\...` 명령은 Windows 기준입니다. 프로젝트 폴더 위치가 `D:\work\data-editing-system`이 아니어도, 프로젝트 루트에서 실행하면 됩니다.
- `prompt/codex01.txt`: 개인 참고 메모입니다. `D:\work\backup` 같은 경로는 해당 PC 예시이며, 다른 PC에서는 `-BackupRoot`를 바꾸세요. `git reset --hard` 예시는 위험 명령이므로 일반 배포 절차로 사용하지 마세요.

## 12. 이전 후 최소 검증

```powershell
.\venv\Scripts\python.exe -m compileall main.py backend
.\venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

브라우저 또는 API 클라이언트에서 확인:

```text
GET http://127.0.0.1:8000/api/health
```

정상 응답 예시:

```json
{"message":"API 서버가 가동 중입니다."}
```

DB 연결이 필요한 화면은 `.env`, 시스템 DB, Target DB 연결 프로필, Wallet 경로가 모두 맞아야 정상 동작합니다.
