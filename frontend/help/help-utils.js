(function() {
    const DATA_WORK_PAGES = new Set(["M03001", "M03002", "M03003", "M03004"]);
    const FLOW_WORK_PAGES = new Set(["M04001"]);
    const REGISTERED_ROUTER_PAGES = new Set([
        "home", "M01001", "M01002", "M02001", "M02002",
        "M03001", "M03002", "M03003", "M03004", "M04001", "M04002",
        "M90001", "M90002", "M91001", "M91002", "M99001", "M99002", "M99003", "M99004"
    ]);

    const LOGICAL_DATA_DOMAINS = {
        home: ["세션/사용자 상태", "Target DB 연결 요약", "프로젝트/시나리오 집계", "플로우 실행 요약", "공지사항/첨부 파일"],
        M01001: ["프로젝트 마스터", "프로젝트 하위 시나리오 참조", "사용자 소유권/권한"],
        M01002: ["프로젝트 마스터", "시나리오 마스터", "시나리오 하위 대상 데이터 참조"],
        M02001: ["업로드 작업 테이블", "업로드 테이블 컬럼/샘플 데이터", "사용자 SQL 조회 결과"],
        M02002: ["Target DB 메타데이터", "시나리오 대상 테이블 매핑", "테이블 컬럼/샘플 데이터", "개인 설정 기반 필터"],
        M03001: ["시나리오 대상 테이블", "데이터 작업 정의", "프로파일링 실행 이력", "실행 결과 테이블"],
        M03002: ["시나리오 대상 테이블", "데이터 작업 정의", "상관 분석 실행 이력", "상관 분석 결과"],
        M03003: ["시나리오 대상 테이블", "데이터 작업 정의", "규칙 후보 생성 결과", "모델 리소스 참조"],
        M03004: ["시나리오 대상 테이블", "데이터 작업 정의", "규칙 위반 탐지 결과", "트랜잭션성 결과 조회"],
        M04001: ["시나리오 대상 테이블", "데이터 작업 자산", "플로우 마스터", "플로우 노드/엣지", "플로우 실행/노드 실행 이력"],
        M04002: ["플로우 실행 이력", "노드 실행 결과", "모델 메타데이터", "연관 규칙/규칙 요약", "결과 샘플"],
        M05001: ["규칙 후보", "규칙 선정 상태", "업무 검토 이력"],
        M05002: ["사용자 정의 규칙", "규칙 조건/테스트 결과", "규칙 마스터"],
        M06001: ["규칙 위반 데이터", "위반 사유/근거", "정제 대상 목록"],
        M06002: ["정제 대상 데이터", "수정 전후 값", "정제 트랜잭션/검증 결과"],
        M07001: ["정제 전후 품질 지표", "검증 실행 결과", "규칙별 효과 비교"],
        M07002: ["최종 반영 대상", "반영 승인 상태", "commit/rollback 계획"],
        M07003: ["에디팅 실행 이력", "변경 전후 로그", "사용자/시간 감사 정보"],
        M90001: ["Target DB 객체 메타데이터", "내부 모델 리소스", "파라미터/상세 정의", "객체 참조 관계"],
        M90002: ["외부 모델 리소스", "OML4Py Script Repository 메타", "리소스 파라미터", "공개 ML/AI 호출 방식"],
        M91001: ["내 계정 정보", "Target DB 연결 선택", "개인 Gemini API Key 상태", "세션 정리"],
        M91002: ["개인 시스템 설정", "계정 정보", "개인 Gemini API Key 상태", "설정 카테고리"],
        M99001: ["DB 연결 설정", "스키마 상태", "초기 설정 로그", "관리자 bootstrap 상태"],
        M99002: ["Target DB 객체 메타데이터", "테이블 컬럼/샘플 데이터", "PL/SQL 소스 조회", "관리자 SQL 조회"],
        M99003: ["시스템 테이블 상태", "사용자 관리", "초기화/정리 작업", "관리자 감사 대상"],
        M99004: ["공지사항", "공지 첨부 파일", "표시 기간/상태", "관리자 작성 이력"]
    };

    const SQL_PURPOSES = {
        home: ["대시보드 집계", "공지사항 조회", "플로우 실행 추세", "모델/규칙 결과 샘플"],
        M01001: ["프로젝트 목록/상세 조회", "프로젝트 저장/수정/삭제", "하위 참조 카운트 확인"],
        M01002: ["프로젝트 목록 조회", "시나리오 목록/상세 조회", "시나리오 저장/삭제", "하위 참조 확인"],
        M02001: ["업로드 테이블 트리 조회", "컬럼/데이터 조회", "사용자 SQL wrapper"],
        M02002: ["DB 테이블 트리/메타 조회", "컬럼/데이터 조회", "시나리오 대상 테이블 저장", "개인 필터 설정 조회"],
        M03001: ["시나리오 대상 테이블 조회", "실행 객체 조회", "컬럼/데이터 조회", "사용자 SQL wrapper"],
        M03002: ["시나리오 대상 테이블 조회", "실행 객체 조회", "컬럼/데이터 조회", "사용자 SQL wrapper"],
        M03003: ["시나리오 대상 테이블 조회", "실행 객체 조회", "컬럼/데이터 조회", "사용자 SQL wrapper"],
        M03004: ["시나리오 대상 테이블 조회", "실행 객체 조회", "컬럼/데이터 조회", "사용자 SQL wrapper"],
        M04001: ["노드 유형/기본 변수 조회", "공통 플로우 저장/실행 SQL 템플릿"],
        M04002: ["플로우 실행 목록", "노드 결과 조회", "모델 메타/연관 규칙 요약", "결과 샘플"],
        M90001: ["DB 객체 트리/검색", "객체 소스/메타 조회", "내부 모델 등록/삭제", "참조 관계 확인"],
        M90002: ["외부 모델 리소스 목록/상세", "파라미터 저장", "OML4Py wrapper/registered script 확인"],
        M91001: ["연결 목록/상세", "연결 설정 저장", "세션 정리", "설정 저장 일부 공용 SQL"],
        M91002: ["내 계정 조회", "개인 설정 조회/저장", "이름/이메일/비밀번호 변경", "Gemini Key 상태"],
        M99001: ["DB 연결 설정", "스키마 상태/초기화", "모델 객체/학습 작업", "bootstrap 로그"],
        M99002: ["DB 객체 트리", "객체 상세/소스", "테이블 컬럼/데이터", "관리자 SQL wrapper"],
        M99003: ["시스템 상태", "시스템 테이블 조회", "사용자 승인/초기화/비활성화", "제한 SELECT wrapper"],
        M99004: ["공지 목록/상세", "공지 저장/삭제", "첨부 파일 저장/다운로드/삭제"]
    };

    const PUBLIC_MODEL_DETAILS = {
        M03001: ["공개 통계/프로파일링 개념: 결측률, 중복률, distinct count, min/max, 분포 요약을 기준으로 품질 상태를 설명합니다."],
        M03002: ["공개 분석 개념: Pearson/Spearman 상관, Cramer's V, 카이제곱 검정, mutual information 같은 공개 지표를 설명 자료로 사용할 수 있습니다."],
        M03003: ["공개 규칙 발굴 개념: association rule mining, frequent pattern mining, anomaly detection, decision tree rule extraction을 설명할 수 있습니다."],
        M03004: ["공개 검증 개념: rule engine, constraint validation, anomaly score threshold, outlier detection 결과 해석을 설명할 수 있습니다."],
        M04001: ["DAG 공개 개념: directed acyclic graph, dependency planning, topological execution order, node input/output contract를 설명할 수 있습니다.", "워크플로우 공개 개념: batch execution, node-level retry, result materialization, read-only result SQL을 설명할 수 있습니다."],
        M04002: ["공개 모델 해석 개념: association rules의 support, confidence, lift와 모델 결과 요약을 상세히 설명할 수 있습니다.", "Oracle ML 공개 개념: 모델 상세 뷰, 규칙 조건/결과 분포, feature/target 해석 방식은 내부 객체명을 숨기고 개념 중심으로 설명할 수 있습니다."],
        M90002: ["OML4Py 공개 API: Script Repository, pyqEval, pyqTableEval, table_apply 흐름을 설명할 수 있습니다.", "Gemini 공개 API: 사용자가 첨부한 텍스트/이미지 context와 질문을 함께 전달하는 멀티모달 응답 흐름을 설명할 수 있습니다."]
    };

    function normalizePageCode(pageCode) {
        return String(pageCode || "home").trim() || "home";
    }

    function getFrontendHtml(pageCode) {
        if (DATA_WORK_PAGES.has(pageCode)) return "frontend/pages/MCOM_DATA_WORK.html";
        if (FLOW_WORK_PAGES.has(pageCode)) return "frontend/pages/MCOM_FLOW_WORK.html";
        return `frontend/pages/${pageCode}.html`;
    }

    function getFrontendJs(pageCode) {
        if (DATA_WORK_PAGES.has(pageCode)) return "frontend/js/MCOM_DATA_WORK.js";
        if (FLOW_WORK_PAGES.has(pageCode)) return "frontend/js/MCOM_FLOW_WORK.js";
        return `frontend/js/${pageCode}.js`;
    }

    function getRouterPath(pageCode) {
        if (!REGISTERED_ROUTER_PAGES.has(pageCode)) return "";
        return `backend/routers/${pageCode}.py`;
    }

    function getSqlFiles(pageCode) {
        if (DATA_WORK_PAGES.has(pageCode)) return [`database/${pageCode}.sql`, "database/MCOM_DATA_WORK.sql"];
        if (FLOW_WORK_PAGES.has(pageCode)) return [`database/${pageCode}.sql`, "database/MCOM_FLOW_WORK.sql"];
        if (pageCode === "home") return ["database/home.sql"];
        return [`database/${pageCode}.sql`];
    }

    function getServiceFiles(pageCode) {
        if (DATA_WORK_PAGES.has(pageCode)) return ["backend/services/data_work_router.py"];
        if (FLOW_WORK_PAGES.has(pageCode)) return ["backend/services/flow_work_router.py"];
        return [];
    }

    function buildImplementation(pageCode) {
        const normalized = normalizePageCode(pageCode);
        return {
            frontendHtml: getFrontendHtml(normalized),
            frontendJs: getFrontendJs(normalized),
            backendRouter: getRouterPath(normalized),
            serviceFiles: getServiceFiles(normalized),
            sqlFiles: getSqlFiles(normalized),
            sqlPurposes: SQL_PURPOSES[normalized] || ["현재 화면 전용 SQL 파일이 없거나 구현 예정입니다."],
            logicalDataDomains: LOGICAL_DATA_DOMAINS[normalized] || ["구현 예정 논리 데이터 도메인"],
            publicModelDetails: PUBLIC_MODEL_DETAILS[normalized] || [],
            privacyNote: "도움말은 실제 물리 테이블명, 내부 프로시저명, DB 접속 정보, API Key, 비밀번호를 공개하지 않고 논리 도메인명과 파일/템플릿 연결만 설명합니다."
        };
    }

    function toList(items) {
        return (items || []).filter(Boolean).map((item) => `- ${item}`).join("\n");
    }

    function buildHelpMarkdown(page, implementation) {
        const layout = (page.layout || []).map((item) => `- ${item.name}: ${item.description}`).join("\n");
        const serviceFiles = implementation.serviceFiles.length ? implementation.serviceFiles : ["없음 또는 화면 전용 라우터에서 직접 처리"];
        const publicModels = implementation.publicModelDetails.length
            ? toList(implementation.publicModelDetails)
            : "- 이 메뉴에서 안내할 모델/AI 리소스 정보는 별도 공개 범위가 확인될 때만 제공합니다.";
        const optionalSections = [
            ["상세 이해 가이드", page.deepDive],
            ["결과 해석 기준", page.interpretationGuide],
            ["자주 확인할 문제", page.troubleshooting],
            ["구현 보충 설명", page.implementationNotes]
        ]
            .filter(([, items]) => Array.isArray(items) && items.length)
            .flatMap(([title, items]) => ["", `## ${title}`, toList(items)]);

        return [
            `# ${page.title || page.label || page.pageCode}`,
            "",
            `메뉴 코드: ${page.pageCode}`,
            `상태: ${page.status || "enabled"}`,
            `그룹: ${page.group || ""}`,
            "",
            "## 요약",
            page.summary || "",
            "",
            "## 목적",
            toList(page.purpose),
            "",
            "## 화면 구성",
            layout,
            "",
            "## 기본 업무 흐름",
            toList(page.workflow),
            "",
            "## 주요 버튼/동작",
            toList(page.controls),
            "",
            "## 구현 연동",
            `- 화면 HTML: ${implementation.frontendHtml}`,
            `- 화면 JS: ${implementation.frontendJs}`,
            `- API 라우터: ${implementation.backendRouter || "등록된 API 라우터 없음 또는 구현 예정"}`,
            `- 공통 서비스: ${serviceFiles.join(", ")}`,
            `- SQL 템플릿: ${implementation.sqlFiles.join(", ")}`,
            "",
            "## SQL 역할",
            toList(implementation.sqlPurposes),
            "",
            "## 논리 데이터 도메인",
            toList(implementation.logicalDataDomains),
            "",
            "## 모델/AI 리소스 안내 범위",
            publicModels,
            "",
            "## 질문 답변 참고 기준",
            toList(page.aiGuidance),
            "",
            "## 비공개 원칙",
            `- ${implementation.privacyNote}`
        ].concat(optionalSections).join("\n");
    }

    window.HelpContentUtils = {
        buildImplementation,
        buildHelpMarkdown,
        normalizePageCode
    };
})();
