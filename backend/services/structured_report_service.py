from __future__ import annotations

import json
import logging
import math
import re
from collections import Counter
from contextvars import ContextVar
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Iterable

from fastapi import HTTPException, Request

from backend.auth_context import get_request_role_code, get_request_user_id
from backend.database_helper import execute_query
from backend.target_database import get_target_db_connection
from backend.services import descriptive_statistics_service as descriptive_statistics
from backend.services.report_i18n import (
    localize_catalog_item,
    localize_report_document,
    normalize_report_language,
)


logger = logging.getLogger(__name__)

_BATCH_CACHEABLE_SQL_IDS = {
    "M06001_TARGET_TABLE_LIST",
    "M06001_CHANGE_SUMMARY",
    "M06001_CHANGE_DETAIL",
}
_BATCH_QUERY_CACHE: ContextVar[dict[tuple[str, str], list[dict[str, Any]]] | None] = ContextVar(
    "m06001_batch_query_cache",
    default=None,
)

REPORT_SCHEMA_VERSION = "1.0"
REPORT_DEFINITION_VERSION = "M06001_STRUCTURED_REPORT_V4"
REPORT_PROVIDER = {
    "name": "IN-DEPS",
    "statement": "본 보고서는 IN-DEPS 시스템에서 제공합니다.",
}


REPORT_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "code": "R01",
        "group": "SUMMARY",
        "title": "프로젝트·시나리오 종합 요약",
        "description": "프로젝트와 선택 시나리오의 규칙발굴·에디팅·운영 반영 현황을 한눈에 요약합니다.",
        "icon": "fa-chart-pie",
        "requirement": "PROJECT",
    },
    {
        "code": "R02",
        "group": "M04001",
        "title": "규칙발굴 설계 및 실행 기준",
        "description": "M04001에서 설계한 Flow, 노드 연결, 실행 파라미터와 실행 결과 기준을 정리합니다.",
        "icon": "fa-diagram-project",
        "requirement": "FLOW",
    },
    {
        "code": "R03",
        "group": "SUMMARY",
        "title": "작업·실행 현황",
        "description": "Flow Run과 에디팅 세션의 상태, 처리 단계와 최근 실행 현황을 제공합니다.",
        "icon": "fa-list-check",
        "requirement": "WORK",
    },
    {
        "code": "R04",
        "group": "DATA",
        "title": "에디팅 대상 데이터 현황",
        "description": "시나리오에 등록된 원본·편집 대상 테이블과 데이터 연결 정보를 보여줍니다.",
        "icon": "fa-table",
        "requirement": "TARGET_TABLE_COUNT",
    },
    {
        "code": "R05",
        "group": "M04002",
        "title": "컬럼 유형 분석",
        "description": "선택 Flow Run의 규칙 기반·모델 기반 컬럼 유형과 품질 지표를 요약합니다.",
        "icon": "fa-chart-column",
        "requirement": "COLUMN_TYPE_COUNT",
    },
    {
        "code": "R06",
        "group": "M04002",
        "title": "관계·상관 분석",
        "description": "컬럼 관계 강도, 기준 통과 건수와 핵심 관계 후보를 비교합니다.",
        "icon": "fa-link",
        "requirement": "RELATION_COUNT",
    },
    {
        "code": "R07",
        "group": "M04002",
        "title": "관계 네트워크·군집",
        "description": "관계 네트워크의 군집 규모와 중심성이 높은 핵심 컬럼을 보여줍니다.",
        "icon": "fa-share-nodes",
        "requirement": "NETWORK_NODE_COUNT",
    },
    {
        "code": "R08",
        "group": "M04002",
        "title": "범주형 연관규칙",
        "description": "범주형 IF/THEN 규칙의 Support, Confidence, Lift를 같은 기준으로 제공합니다.",
        "icon": "fa-code-branch",
        "requirement": "ASSOCIATION_RULE_COUNT",
    },
    {
        "code": "R09",
        "group": "M04002",
        "title": "LASSO 중요변수",
        "description": "연속형 대상별 중요변수, 계수, 선택 여부와 설명력을 정리합니다.",
        "icon": "fa-ranking-star",
        "requirement": "LASSO_FEATURE_COUNT",
    },
    {
        "code": "R10",
        "group": "M04002",
        "title": "Symbolic 수식 규칙",
        "description": "f(x)=y 형태의 수식 규칙, 사용 변수, 점수와 복잡도를 제공합니다.",
        "icon": "fa-square-root-variable",
        "requirement": "SYMBOLIC_RULE_COUNT",
    },
    {
        "code": "R11",
        "group": "M04002",
        "title": "규칙 위반 현황",
        "description": "범주형·연속형 규칙 위반을 유형, 테이블, 대상 컬럼 단위로 집계합니다.",
        "icon": "fa-triangle-exclamation",
        "requirement": "VIOLATION_COUNT",
    },
    {
        "code": "R12",
        "group": "M05001",
        "title": "발굴 규칙 판단 현황",
        "description": "발굴 규칙의 선정·제외·대기 상태와 품질 지표를 요약합니다.",
        "icon": "fa-scale-balanced",
        "requirement": "DISCOVERED_RULE_COUNT",
    },
    {
        "code": "R13",
        "group": "M05001",
        "title": "최종 규칙 마스터",
        "description": "최종 선정된 발굴 규칙과 사용자 정의 규칙의 적용 범위를 제공합니다.",
        "icon": "fa-clipboard-check",
        "requirement": "FINAL_RULE_COUNT",
    },
    {
        "code": "R14",
        "group": "M05002",
        "title": "에디팅 작업·테이블 현황",
        "description": "원본·편집 테이블 매핑과 에디팅 세션별 준비·진행 상태를 보여줍니다.",
        "icon": "fa-pen-to-square",
        "requirement": "EDIT_WORK",
    },
    {
        "code": "R15",
        "group": "M05002",
        "title": "오류 수정 성과",
        "description": "오류 수정 건수, 적용 상태와 기대값 일치율을 같은 산식으로 계산합니다.",
        "icon": "fa-eraser",
        "requirement": "EDIT_CHANGE_COUNT",
    },
    {
        "code": "R16",
        "group": "M05002",
        "title": "수정 결과·일치 여부 이력",
        "description": "민감한 변경값 원문 없이 수정 컬럼, 값 변경 여부, 기대값 일치 여부, 규칙, 작업자와 수정 시각을 추적합니다.",
        "icon": "fa-clock-rotate-left",
        "requirement": "EDIT_CHANGE_COUNT",
    },
    {
        "code": "R17",
        "group": "M05003",
        "title": "에디팅 전후 효과 검증",
        "description": "기준 Run과 재분석 Run의 위반 변화, 수정 적용, 검증 시점 기초통계량과 분산 변화를 비교합니다.",
        "icon": "fa-chart-line",
        "requirement": "VALIDATED_SESSION_COUNT",
    },
    {
        "code": "R18",
        "group": "M05003",
        "title": "운영 반영·DML 현황",
        "description": "운영 반영 DML의 승인·실행 상태와 영향 행 수를 제공합니다.",
        "icon": "fa-database",
        "requirement": "DML_COUNT",
    },
    {
        "code": "R19",
        "group": "M05003",
        "title": "전체 감사 이력",
        "description": "규칙 판단부터 운영 반영까지 주요 감사 이벤트를 시간순으로 제공합니다.",
        "icon": "fa-shield-halved",
        "requirement": "AUDIT_EVENT_COUNT",
    },
    {
        "code": "R20",
        "group": "COMPARISON",
        "title": "프로젝트·시나리오 비교 스코어카드",
        "description": "각 시나리오의 최신 성공 Run과 최신 에디팅 세션을 고정해 규칙 선정률과 수정 적용률을 비교합니다.",
        "icon": "fa-table-columns",
        "requirement": "SCENARIO_COUNT",
    },
    {
        "code": "R21",
        "group": "M05003",
        "title": "데이터 프로파일 비교·기초통계량",
        "description": "전체 변화 맵, 중요 컬럼 순위, 원본·수정 기초통계량과 동일 구간 분포를 인쇄 가능한 전체 펼침 형식으로 제공합니다.",
        "icon": "fa-chart-column",
        "requirement": "DESCRIPTIVE_STATISTICS",
    },
)

REPORT_BY_CODE = {item["code"]: item for item in REPORT_CATALOG}


COLUMN_LABELS = {
    "METRIC": "지표",
    "VALUE": "값",
    "PARAMETER": "파라미터",
    "PROJECT_ID": "프로젝트 ID",
    "PROJECT_CODE": "프로젝트 코드",
    "PROJECT_NAME": "프로젝트명",
    "PROJECT_TYPE": "프로젝트 유형",
    "SCENARIO_ID": "시나리오 ID",
    "SCENARIO_CODE": "시나리오 코드",
    "SCENARIO_NAME": "시나리오명",
    "SCENARIO_TYPE": "시나리오 유형",
    "SCENARIO_COUNT": "프로젝트 시나리오 수",
    "FLOW_ID": "Flow ID",
    "FLOW_NAME": "Flow명",
    "FLOW_GROUP": "Flow 그룹",
    "FLOW_TYPE": "Flow 유형",
    "FLOW_COUNT": "M04001 Flow 수",
    "FLOW_RUN_ID": "Flow Run ID",
    "RUN_TYPE": "실행 유형",
    "STATUS": "상태",
    "MESSAGE": "메시지",
    "NODE_COUNT": "노드 수",
    "SUCCESS_NODE_COUNT": "성공 노드 수",
    "STARTED_AT": "시작 시각",
    "FINISHED_AT": "종료 시각",
    "CREATED_AT": "생성 시각",
    "UPDATED_AT": "수정 시각",
    "OWNER_NAME": "소유자",
    "OWNER": "소유자",
    "TABLE_NAME": "테이블",
    "TARGET_OWNER": "대상 소유자",
    "TARGET_TABLE": "대상 테이블",
    "EDIT_OWNER_NAME": "편집 소유자",
    "EDIT_TABLE_NAME": "편집 테이블",
    "DATA_ORIGIN_TYPE": "데이터 원천",
    "CASE_ID_COLUMN": "업무 키 컬럼",
    "TABLE_COMMENT": "테이블 설명",
    "NODE_KEY": "노드 키",
    "NODE_NAME": "노드명",
    "NODE_TYPE": "노드 유형",
    "NODE_DESC": "노드 설명",
    "USE_YN": "사용 여부",
    "RUN_LEVEL": "실행 단계",
    "SORT_ORDER": "정렬 순서",
    "FROM_NODE_KEY": "출발 노드",
    "TO_NODE_KEY": "도착 노드",
    "EDGE_MODE": "연결 모드",
    "COLUMN_NAME": "컬럼명",
    "COLUMN_DESC": "컬럼 설명",
    "DATA_TYPE": "물리 유형",
    "TYPE_GROUP_CODE": "유형 그룹",
    "FINAL_TYPE_CODE": "최종 유형",
    "BASE_TYPE_CODE": "기본 유형",
    "MODL_TYPE_CODE": "모델 유형",
    "MODEL_CONFIDENCE": "모델 신뢰도",
    "NULL_RATIO": "NULL 비율",
    "TOTAL_ROWS": "전체 행 수",
    "NUM_DISTINCT": "고유값 수",
    "COLUMN_COUNT": "컬럼 수",
    "PAIR_COUNT": "관계 쌍 수",
    "PASS_PAIR_COUNT": "기준 통과 쌍",
    "AVG_ABS_METRIC_VALUE": "평균 관계 강도",
    "MAX_ABS_METRIC_VALUE": "최대 관계 강도",
    "SELECTED_YN": "선택 여부",
    "CLUSTER_ID": "군집 ID",
    "DEGREE_COUNT": "연결 수",
    "CENTRALITY_SCORE": "중심성",
    "TARGET_COLUMN": "대상 컬럼",
    "FEATURE_NAME": "중요변수",
    "COEFFICIENT": "계수",
    "ABS_COEFFICIENT": "절대 계수",
    "R2_SCORE": "R²",
    "RULE_ID": "규칙 ID",
    "RULE_NAME": "규칙명",
    "RULE_SOURCE": "규칙 출처",
    "SOURCE_RULE_TYPE": "규칙 유형",
    "RULE_SUPPORT": "Support",
    "RULE_SUPPORT_SOURCE": "원본 Support",
    "RULE_CONFIDENCE": "Confidence",
    "RULE_CONFIDENCE_SOURCE": "원본 Confidence",
    "ASSOCIATION_SUPPORT_RATE": "연관규칙 Support 비율",
    "ASSOCIATION_CONFIDENCE_RATE": "연관규칙 Confidence 비율",
    "AVG_ASSOC_SUPPORT_RATE": "평균 연관규칙 Support 비율",
    "AVG_ASSOC_CONFIDENCE_RATE": "평균 연관규칙 Confidence 비율",
    "SYMBOLIC_SCORE": "Symbolic 점수",
    "AVG_SYMBOLIC_SCORE": "평균 Symbolic 점수",
    "RULE_LIFT": "Lift",
    "CONDITION_TEXT": "조건",
    "RESULT_TEXT": "결과",
    "RESULT_COLUMN": "결과 컬럼",
    "RESULT_VALUE": "결과값",
    "EXPRESSION": "수식",
    "FEATURE_COLUMNS": "사용 변수",
    "SCORE": "점수",
    "COMPLEXITY": "복잡도",
    "METHOD": "방법",
    "VIOLATION_TYPE": "위반 유형",
    "VIOLATION_COUNT": "위반 건수",
    "AVG_VIOLATION_SCORE": "평균 위반 점수",
    "DECISION_STATUS": "판단 상태",
    "RULE_STATUS": "규칙 상태",
    "USER_RULE_YN": "사용자 규칙",
    "RULE_COUNT": "규칙 수",
    "EDIT_RULE_COUNT": "에디팅 규칙 수",
    "EDIT_RULE_ID": "에디팅 규칙 ID",
    "EDIT_SESSION_ID": "에디팅 세션 ID",
    "EDIT_SESSION_COUNT": "에디팅 세션 수",
    "SESSION_NAME": "에디팅 작업명",
    "SESSION_STATUS": "세션 상태",
    "SOURCE_TABLE": "원본 테이블",
    "EDIT_TABLE": "편집 테이블",
    "SOURCE_ROW_COUNT": "원본 행 수",
    "CHANGE_COUNT": "수정 건수",
    "EDIT_CHANGE_COUNT": "선택 세션 수정 건수",
    "SCENARIO_EDIT_CHANGE_COUNT": "시나리오 전체 수정 건수",
    "CHANGED_ROW_COUNT": "수정 행 수",
    "APPLIED_CHANGE_COUNT": "적용 수정 건수",
    "EXPECTED_MATCH_COUNT": "기대값 일치 건수",
    "CHANGE_STATUS": "수정 상태",
    "OLD_VALUE": "수정 전 값",
    "NEW_VALUE": "수정 후 값",
    "EXPECTED_VALUE": "기대값",
    "EDITED_BY": "수정자",
    "EDITED_AT": "수정 시각",
    "BASELINE_FLOW_RUN_ID": "기준 Flow Run",
    "REANALYSIS_FLOW_RUN_ID": "재분석 Flow Run",
    "BASELINE_VIOLATION_COUNT": "기준 위반 건수",
    "REANALYSIS_VIOLATION_COUNT": "재분석 위반 건수",
    "DML_NAME": "DML명",
    "DML_STATUS": "DML 상태",
    "DML_COUNT": "선택 세션 DML 건수",
    "SCENARIO_DML_COUNT": "시나리오 전체 DML 건수",
    "AFFECTED_ROW_COUNT": "영향 행 수",
    "APPROVED_BY": "승인자",
    "APPROVED_AT": "승인 시각",
    "EXECUTED_BY": "실행자",
    "EXECUTED_AT": "실행 시각",
    "EVENT_TYPE": "이벤트 유형",
    "ENTITY_TYPE": "대상 유형",
    "ENTITY_ID": "대상 ID",
    "EVENT_SUMMARY": "이벤트 요약",
    "EVENT_USER": "작업자",
    "TARGET_TABLE_COUNT": "대상 테이블 수",
    "EDIT_READY_TARGET_TABLE_COUNT": "INITUP$·INITDN$ 비교 쌍 수",
    "FLOW_RUN_COUNT": "Flow Run 수",
    "SUCCESS_FLOW_RUN_COUNT": "성공 Flow Run 수",
    "FLOW_SUCCESS_RATE": "Flow 성공률",
    "TOTAL_RULE_COUNT": "전체 규칙 수",
    "FINAL_RULE_COUNT": "최종 규칙 수",
    "RULE_SELECTION_RATE": "규칙 선정률",
    "INSPECTED_ROW_COUNT": "검사 행 수",
    "EXECUTED_DML_COUNT": "운영 반영 수",
    "CHANGE_APPLY_RATE": "수정 적용률",
    "CONTEXT_MATCH_YN": "Run·세션 기준 일치",
    "LATEST_SUCCESS_FLOW_RUN_ID": "최신 성공 Flow Run",
    "LATEST_SUCCESS_FLOW_RUN_AT": "최신 성공 Run 시각",
    "LATEST_EDIT_SESSION_ID": "최신 에디팅 세션",
    "LATEST_EDIT_SESSION_STATUS": "최신 세션 상태",
    "LATEST_EDIT_SESSION_AT": "최신 세션 시각",
    "SESSION_BASELINE_FLOW_RUN_ID": "세션 기준 Flow Run",
    "DATA_STAGE": "데이터 구분",
    "TOTAL_ROW_COUNT": "전체 건수",
    "VALUE_COUNT": "유효값 건수",
    "NULL_COUNT": "결측·변환실패 건수",
    "DISTINCT_COUNT": "고유값 수",
    "DISTINCT_RATE": "고유값 비율",
    "MODE_VALUE": "최빈값",
    "MODE_COUNT": "최빈값 빈도",
    "MIN_LENGTH": "최소 길이",
    "AVG_LENGTH": "평균 길이",
    "MAX_LENGTH": "최대 길이",
    "MIN_VALUE_TEXT": "최솟값·최초값",
    "MAX_VALUE_TEXT": "최댓값·최종값",
    "PROFILE_KIND": "통계 유형",
    "SUM_VALUE": "합계",
    "MEAN_VALUE": "평균",
    "VARIANCE_VALUE": "분산",
    "STDDEV_VALUE": "표준편차",
    "SKEWNESS_VALUE": "왜도",
    "KURTOSIS_VALUE": "첨도(초과첨도)",
    "MEDIAN_VALUE": "메디안(중앙값)",
    "MIN_VALUE": "최소값",
    "Q1_VALUE": "1사분위수(Q1)",
    "Q3_VALUE": "3사분위수(Q3)",
    "MAX_VALUE": "최대값",
    "BEFORE_VARIANCE": "변경 전 분산",
    "AFTER_VARIANCE": "변경 후 분산",
    "VARIANCE_DELTA": "분산 변화량",
    "VARIANCE_REDUCTION_RATE": "분산 감소율",
    "VARIANCE_DIRECTION": "분산 변화 방향",
    "IMPORTANCE_RANK": "중요도 순위",
    "IMPORTANCE_SCORE": "중요도 점수",
    "PRIORITY_LEVEL": "확인 우선순위",
    "PRIORITY_REASONS": "우선 확인 사유",
    "HAS_STATISTICS": "기초통계 제공 여부",
    "VIOLATED_ROW_COUNT": "위반 행 수",
    "CATEGORICAL_VIOLATION_COUNT": "범주형 위반 건수",
    "CONTINUOUS_VIOLATION_COUNT": "연속형 위반 건수",
    "MISSING_RATE": "결측률",
    "VARIANCE_CHANGE_RATE": "분산 변화율",
    "MEAN_SHIFT_STD": "평균 이동(표준편차 배수)",
    "RANGE_SHIFT_RATE": "분포 범위 이동률",
    "STATISTICS_COLUMN_COUNT": "통계 분석 컬럼 수",
    "STATISTICS_BASIS": "통계 산정 기준",
    "BIN_NO": "분포 구간",
    "RANGE_FROM": "구간 시작",
    "RANGE_TO": "구간 끝",
    "BEFORE_COUNT": "원본 건수",
    "AFTER_COUNT": "수정 건수",
    "VALUE_RANK": "값 순위",
    "VALUE": "값",
    "HIGH_PRIORITY_COLUMN_COUNT": "우선 확인 컬럼 수",
    "MEDIUM_PRIORITY_COLUMN_COUNT": "관심 컬럼 수",
    "VIOLATION_COLUMN_COUNT": "위반 발생 컬럼 수",
    "TOTAL_VIOLATION_COUNT": "전체 위반 건수",
    "DECREASED_VARIANCE_COLUMN_COUNT": "분산 감소 컬럼 수",
    "INCREASED_VARIANCE_COLUMN_COUNT": "분산 증가 컬럼 수",
    "BEFORE_MEAN": "변경 전 평균",
    "AFTER_MEAN": "변경 후 평균",
    "MEAN_DELTA": "평균 변화량",
    "BEFORE_STDDEV": "변경 전 표준편차",
    "AFTER_STDDEV": "변경 후 표준편차",
    "BEFORE_MIN": "변경 전 최소값",
    "AFTER_MIN": "변경 후 최소값",
    "BEFORE_MAX": "변경 전 최대값",
    "AFTER_MAX": "변경 후 최대값",
}


_SECRET_KEY_PATTERN = re.compile(
    r"password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|wallet|credential|connection[_-]?string",
    re.IGNORECASE,
)
_ALLOWED_PARAMETER_KEYS = {
    "projectId",
    "scenarioId",
    "flowId",
    "flowRunId",
    "runType",
    "runMode",
    "targetOwner",
    "targetTable",
    "sourceOwner",
    "sourceTable",
    "ownerName",
    "tableName",
    "resultOwner",
    "resultTableName",
    "resultCreateYn",
    "modelName",
    "objectName",
    "menuCode",
    "refMenuCode",
    "ruleParts",
    "clusterUsageMode",
    "dimensionReductionMode",
    "estimationMode",
    "monteCarloMode",
    "monteCarloIterations",
    "monteCarloMaxRows",
    "banffMode",
    "editingSessionId",
}
_ALLOWED_P_PARAMETER_KEYS = {
    "P_ABS_ERROR_THRESHOLD",
    "P_ALPHA",
    "P_ASSOC_MODEL_NAME",
    "P_BANFF_MODE",
    "P_CANDIDATE_COLUMNS",
    "P_CASE_ID_COLUMN_NAME",
    "P_CATEGORICAL_COLUMNS",
    "P_CLEAR_EXISTING_YN",
    "P_CLUSTER_USAGE_MODE",
    "P_COMMIT_INTERVAL",
    "P_CONTINUE_ON_ERROR",
    "P_DIMENSION_REDUCTION_MODE",
    "P_ERROR_PCT_THRESHOLD",
    "P_ESTIMATION_MODE",
    "P_INCLUDE_SPEARMAN",
    "P_LINEAR_FIRST_YN",
    "P_LINEAR_R2_THRESHOLD",
    "P_MAX_AUTO_TARGETS",
    "P_MAX_COLUMNS",
    "P_MAX_DISTINCT",
    "P_MAX_EDGES",
    "P_MAX_ELAPSED_SECONDS",
    "P_MAX_EXPRESSION_LENGTH",
    "P_MAX_FEATURES",
    "P_MAX_INPUT_ROWS",
    "P_MAX_ITERATIONS",
    "P_MAX_RULE_LENGTH",
    "P_MAX_RULE_SUMMARY_COLUMNS",
    "P_MAX_RULE_SUMMARY_PER_PAIR",
    "P_MAX_RULES",
    "P_MAX_SCAN_ROWS",
    "P_MAX_SYMBOLIC_TERMS",
    "P_MAX_VIOLATIONS_PER_RULE",
    "P_METRIC_NAMES",
    "P_MIN_ABS_CORR",
    "P_MIN_AVG_ABS_CORR",
    "P_MIN_AVG_V",
    "P_MIN_CONFIDENCE",
    "P_MIN_CRAMER",
    "P_MIN_ETA",
    "P_MIN_LIFT",
    "P_MIN_METRIC",
    "P_MIN_PVALUE",
    "P_MIN_R2_SCORE",
    "P_MIN_ROWS",
    "P_MIN_RULE_LIFT",
    "P_MIN_RULE_SUPPORT_COUNT",
    "P_MIN_SUPPORT",
    "P_ML_MAX_IN_MEMORY_ROWS",
    "P_ML_MAX_INPUT_FEATURES",
    "P_MODEL_NAME",
    "P_MONTE_CARLO_ITERATIONS",
    "P_MONTE_CARLO_MAX_ROWS",
    "P_MONTE_CARLO_MODE",
    "P_NETWORK_MIN_METRIC",
    "P_PREDICTED_TYPE",
    "P_PREDICTION_METHOD",
    "P_RELATION_TYPES",
    "P_RESULT_OWNER",
    "P_RESULT_TABLE",
    "P_RULE_ID",
    "P_RULE_MODEL_NAME",
    "P_RULE_OWNER_NAME",
    "P_RULE_PARTS",
    "P_RULE_SUMMARY_TIMEOUT_MS",
    "P_RULE_TABLE_NAME",
    "P_RUN_ID",
    "P_RUN_SOURCE_TYPE",
    "P_SAMPLE_ROWS",
    "P_SYMBOLIC_MAX_RULES",
    "P_SYMBOLIC_RESULT_OWNER",
    "P_SYMBOLIC_RESULT_TABLE",
    "P_SYMBOLIC_RULE_TABLE_NAME",
    "P_TARGET_COLUMN",
    "P_TARGET_OWNER",
    "P_TARGET_TABLE",
    "P_USE_PYSR",
}
_SECRET_VALUE_PATTERN = re.compile(
    r"(?:\bBearer\s+[A-Za-z0-9._~+/=-]+|"
    r"\b(?:password|passwd|token|api[_-]?key|secret)\s*[\"']?\s*[:=]|"
    r"^[a-z][a-z0-9+.-]*://[^/\s:@]+:[^@\s/]+@)",
    re.IGNORECASE,
)


def _read_lob(value: Any) -> Any:
    if hasattr(value, "read") and callable(value.read):
        return value.read()
    return value


def _normalize_value(value: Any) -> Any:
    value = _read_lob(value)
    if isinstance(value, dict):
        return {str(key): _normalize_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize_value(item) for item in value]
    return value


def _request_access(request: Request) -> dict[str, Any]:
    return {
        "userId": get_request_user_id(request),
        "includeAllUsers": "Y" if get_request_role_code(request) == "ADMIN" else "N",
    }


def _query(conn, sql_id: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    query_params = params or {}
    cache = _BATCH_QUERY_CACHE.get()
    cache_key: tuple[str, str] | None = None
    if cache is not None and sql_id in _BATCH_CACHEABLE_SQL_IDS:
        cache_key = (
            sql_id,
            json.dumps(query_params, ensure_ascii=False, sort_keys=True, default=str),
        )
        if cache_key in cache:
            return deepcopy(cache[cache_key])

    result = execute_query(conn, sql_id, query_params)
    if result.get("status") != "success":
        message = result.get("message") or result.get("detail") or f"{sql_id} query failed."
        raise HTTPException(status_code=500, detail=str(message))
    rows = [_normalize_value(row) for row in result.get("data", [])]
    if cache is not None and cache_key is not None:
        cache[cache_key] = deepcopy(rows)
    return rows


def _first(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    return rows[0] if rows else None


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _as_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _ratio(numerator: Any, denominator: Any) -> float | None:
    numerator_value = _as_float(numerator)
    denominator_value = _as_float(denominator)
    if denominator_value == 0:
        return None
    return numerator_value / denominator_value


def _normalized_rate(value: Any) -> float | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if 0 <= numeric <= 1:
        return numeric
    if 1 < numeric <= 100:
        return numeric / 100
    return None


def _generated_at() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _safe_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, Decimal, date, datetime)):
        return value
    text = str(value).strip()
    return text[:500]


def _is_allowed_parameter_key(key: str) -> bool:
    if _SECRET_KEY_PATTERN.search(key):
        return False
    return key in _ALLOWED_PARAMETER_KEYS or key.upper() in _ALLOWED_P_PARAMETER_KEYS


def _is_sensitive_parameter_value(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return bool(_SECRET_VALUE_PATTERN.search(value.strip()))


def _safe_parameter_value(value: Any) -> tuple[bool, Any]:
    value = _read_lob(value)
    if value is None or isinstance(value, dict):
        return False, None
    if isinstance(value, (list, tuple)):
        if len(value) > 100:
            return False, None
        normalized: list[str] = []
        for item in value:
            item = _read_lob(item)
            if item is None or isinstance(item, (dict, list, tuple, set)):
                return False, None
            if _is_sensitive_parameter_value(item):
                return False, None
            normalized.append(str(_safe_scalar(item)))
        return True, ", ".join(normalized)[:500]
    if isinstance(value, set) or _is_sensitive_parameter_value(value):
        return False, None
    if not isinstance(value, (str, bool, int, float, Decimal, date, datetime)):
        return False, None
    return True, _safe_scalar(value)


def _collect_safe_parameters(value: Any, prefix: str = "") -> list[dict[str, Any]]:
    value = _read_lob(value)
    if value in (None, ""):
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
    rows: list[dict[str, Any]] = []
    if isinstance(value, dict):
        parameter_name = _first_present(
            value,
            "itemName",
            "ITEM_NAME",
            "name",
            "NAME",
            "key",
            "KEY",
        )
        parameter_value = _first_present(
            value,
            "value",
            "VALUE",
            "itemDefault",
            "ITEM_DEFAULT",
            "defaultValue",
            "DEFAULT_VALUE",
        )
        if parameter_name is not None:
            parameter_name = str(parameter_name)
            is_safe, safe_value = _safe_parameter_value(parameter_value)
            if _is_allowed_parameter_key(parameter_name) and is_safe:
                return [
                    {
                        "PARAMETER": f"{prefix}.{parameter_name}" if prefix else parameter_name,
                        "VALUE": safe_value,
                    }
                ]
            return []
        for raw_key, child in value.items():
            key = str(raw_key)
            path = f"{prefix}.{key}" if prefix else key
            if _SECRET_KEY_PATTERN.search(key):
                continue
            if _is_allowed_parameter_key(key):
                is_safe, safe_value = _safe_parameter_value(child)
                if is_safe:
                    rows.append({"PARAMETER": path, "VALUE": safe_value})
            elif isinstance(child, (dict, list, tuple)):
                rows.extend(_collect_safe_parameters(child, path))
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            rows.extend(_collect_safe_parameters(child, f"{prefix}[{index}]"))
    return rows


def _deduplicate_parameter_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    result: list[dict[str, Any]] = []
    for row in rows:
        marker = (str(row.get("PARAMETER") or ""), str(row.get("VALUE") or ""))
        if marker in seen:
            continue
        seen.add(marker)
        result.append(row)
    return result[:200]


_VALIDATION_OVERALL_FIELDS = (
    "STATUS",
    "SOURCE_ROW_COUNT",
    "APPLIED_CHANGE_COUNT",
    "CHANGED_ROW_COUNT",
    "CHANGED_ROW_RATE",
    "DISTINCT_COLUMN_COUNT",
    "DISTINCT_RULE_COUNT",
    "EXPECTED_MATCH_COUNT",
    "EXPECTED_MATCH_RATE",
    "EVALUATION_ERROR",
)
_VALIDATION_SCOPE_FIELDS = (
    "STATUS",
    "AVAILABLE",
    "RULE_COUNT",
    "CHANGE_COUNT",
    "CHANGED_ROW_COUNT",
    "EXPECTED_MATCH_COUNT",
    "EXPECTED_MATCH_RATE",
    "SOURCE_VIOLATION_COUNT",
    "EDIT_VIOLATION_COUNT",
    "SOURCE_VIOLATED_ROW_COUNT",
    "EDIT_VIOLATED_ROW_COUNT",
    "VIOLATION_REDUCTION_COUNT",
    "VIOLATION_REDUCTION_RATE",
    "NON_NUMERIC_COUNT",
    "EVALUATED_COUNT",
    "BEFORE_MAE",
    "AFTER_MAE",
    "BEFORE_RMSE",
    "AFTER_RMSE",
    "MAE_REDUCTION_RATE",
    "RMSE_REDUCTION_RATE",
    "WITHIN_TOLERANCE_COUNT",
    "WITHIN_TOLERANCE_RATE",
    "IMPROVED_COUNT",
    "WORSENED_COUNT",
    "UNCHANGED_COUNT",
)
_VALIDATION_REANALYSIS_FIELDS = (
    "STATUS",
    "FLOW_RUN_ID",
    "RUN_STATUS",
    "BASELINE_VIOLATION_COUNT",
    "REANALYSIS_VIOLATION_COUNT",
    "VIOLATION_REDUCTION_COUNT",
    "VIOLATION_REDUCTION_RATE",
)
_STATISTICS_METRIC_FIELDS = (
    ("TOTAL_ROW_COUNT", "totalRowCount", True),
    ("VALUE_COUNT", "valueCount", True),
    ("NULL_COUNT", "nullCount", True),
    ("DISTINCT_COUNT", "distinctCount", True),
    ("DISTINCT_RATE", "distinctRate", False),
    ("MODE_COUNT", "modeCount", True),
    ("MIN_LENGTH", "minLength", True),
    ("AVG_LENGTH", "avgLength", False),
    ("MAX_LENGTH", "maxLength", True),
    ("SUM_VALUE", "sum", False),
    ("MEAN_VALUE", "mean", False),
    ("VARIANCE_VALUE", "variance", False),
    ("STDDEV_VALUE", "stddev", False),
    ("SKEWNESS_VALUE", "skewness", False),
    ("KURTOSIS_VALUE", "kurtosis", False),
    ("MEDIAN_VALUE", "median", False),
    ("MIN_VALUE", "min", False),
    ("Q1_VALUE", "q1", False),
    ("Q3_VALUE", "q3", False),
    ("MAX_VALUE", "max", False),
)
_REPORT_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")


def _safe_stat_number(value: Any, *, integer: bool = False) -> int | float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(numeric):
        return None
    return int(numeric) if integer else numeric


def _safe_statistics_metrics(source: Any) -> dict[str, int | float | None] | None:
    if not isinstance(source, dict):
        return None
    result = {
        report_key: _safe_stat_number(source.get(api_key), integer=integer)
        for report_key, api_key, integer in _STATISTICS_METRIC_FIELDS
    }
    for report_key, api_key in (
        ("MODE_VALUE", "modeValue"),
        ("MIN_VALUE_TEXT", "minValueText"),
        ("MAX_VALUE_TEXT", "maxValueText"),
    ):
        raw_value = source.get(api_key)
        result[report_key] = str(raw_value)[:500] if raw_value is not None else None
    return result


def _safe_statistics_source(source: Any, stage: str) -> dict[str, str] | None:
    if not isinstance(source, dict):
        return None
    owner = str(source.get("owner") or "").strip().upper()
    table = str(source.get("table") or "").strip().upper()
    if not _REPORT_IDENTIFIER_PATTERN.fullmatch(owner) or not _REPORT_IDENTIFIER_PATTERN.fullmatch(table):
        return None
    return {
        "OWNER": owner,
        "TABLE": table,
        "LABEL": (
            "원본"
            if stage == "BEFORE"
            else "수정"
        ),
    }


def _safe_statistics_distribution(value: Any, *, has_after: bool) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    minimum = _safe_stat_number(value.get("min"))
    maximum = _safe_stat_number(value.get("max"))
    raw_bins = value.get("bins") if isinstance(value.get("bins"), list) else []
    if minimum is None or maximum is None or not raw_bins:
        return None
    bins = []
    for index, raw_bin in enumerate(raw_bins[:12], start=1):
        if not isinstance(raw_bin, dict):
            continue
        bins.append(
            {
                "BIN_NO": index,
                "LOWER_VALUE": _safe_stat_number(raw_bin.get("lower")),
                "UPPER_VALUE": _safe_stat_number(raw_bin.get("upper")),
                "BEFORE_COUNT": _safe_stat_number(raw_bin.get("beforeCount"), integer=True) or 0,
                "AFTER_COUNT": (
                    _safe_stat_number(raw_bin.get("afterCount"), integer=True) or 0
                    if has_after
                    else None
                ),
            }
        )
    if not bins:
        return None
    return {
        "BIN_COUNT": len(bins),
        "MIN_VALUE": minimum,
        "MAX_VALUE": maximum,
        "BINS": bins,
    }


def _safe_statistics_insight(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    column_name = str(value.get("columnName") or "").strip().upper()
    if not _REPORT_IDENTIFIER_PATTERN.fullmatch(column_name):
        return None
    importance_score = _safe_stat_number(value.get("importanceScore")) or 0
    priority_level = "HIGH" if importance_score >= 70 else ("MEDIUM" if importance_score >= 30 else "LOW")
    reasons = value.get("priorityReasons") if isinstance(value.get("priorityReasons"), list) else []
    safe_reasons = [
        str(reason).strip()[:200]
        for reason in reasons[:5]
        if reason is not None and str(reason).strip()
    ]
    data_type = str(value.get("dataType") or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_ ]{0,99}", data_type):
        data_type = ""
    column_comment = value.get("columnComment")
    return {
        "COLUMN_NAME": column_name,
        "COLUMN_DESC": column_comment[:500] if isinstance(column_comment, str) else "",
        "DATA_TYPE": data_type,
        "HAS_STATISTICS": "Y" if value.get("hasStatistics") is not False else "N",
        "IMPORTANCE_RANK": _safe_stat_number(value.get("importanceRank"), integer=True),
        "IMPORTANCE_SCORE": importance_score,
        "PRIORITY_LEVEL": priority_level,
        "PRIORITY_REASONS": " · ".join(safe_reasons),
        "VIOLATION_COUNT": _safe_stat_number(value.get("violationCount"), integer=True) or 0,
        "VIOLATED_ROW_COUNT": _safe_stat_number(value.get("violatedRowCount"), integer=True) or 0,
        "RULE_COUNT": _safe_stat_number(value.get("ruleCount"), integer=True) or 0,
        "CATEGORICAL_VIOLATION_COUNT": _safe_stat_number(value.get("categoricalViolationCount"), integer=True) or 0,
        "CONTINUOUS_VIOLATION_COUNT": _safe_stat_number(value.get("continuousViolationCount"), integer=True) or 0,
        "MISSING_RATE": _safe_stat_number(value.get("missingRate")),
        "VARIANCE_CHANGE_RATE": _safe_stat_number(value.get("varianceChangeRate")),
        "MEAN_SHIFT_STD": _safe_stat_number(value.get("meanShiftStd")),
        "RANGE_SHIFT_RATE": _safe_stat_number(value.get("rangeShiftRate")),
        "TOTAL_ROW_COUNT": _safe_stat_number(value.get("totalRowCount"), integer=True),
    }


def _safe_descriptive_statistics(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or value.get("available") is False:
        return None
    before_source = _safe_statistics_source(value.get("before"), "BEFORE")
    after_source = _safe_statistics_source(value.get("after"), "AFTER")
    if not before_source:
        return None
    raw_columns = value.get("columns") if isinstance(value.get("columns"), list) else []
    columns: list[dict[str, Any]] = []
    column_insights: list[dict[str, Any]] = []
    for raw_column in raw_columns:
        if not isinstance(raw_column, dict):
            continue
        column_name = str(raw_column.get("columnName") or "").strip().upper()
        if not _REPORT_IDENTIFIER_PATTERN.fullmatch(column_name):
            continue
        before = _safe_statistics_metrics(raw_column.get("before"))
        after = _safe_statistics_metrics(raw_column.get("after"))
        if before is None:
            continue
        before_variance = before.get("VARIANCE_VALUE")
        after_variance = after.get("VARIANCE_VALUE") if after else None
        if before_variance is None or after_variance is None:
            variance_delta = None
            variance_reduction_rate = None
            variance_direction = "UNAVAILABLE"
        else:
            before_value = float(before_variance)
            after_value = float(after_variance)
            variance_delta = after_value - before_value
            tolerance = max(1e-12, abs(before_value) * 1e-9)
            if abs(variance_delta) <= tolerance:
                variance_direction = "UNCHANGED"
            elif variance_delta < 0:
                variance_direction = "DECREASED"
            else:
                variance_direction = "INCREASED"
            variance_reduction_rate = (
                0.0
                if before_value == 0 and after_value == 0
                else None
                if before_value == 0
                else (before_value - after_value) / abs(before_value)
            )
        column_comment = raw_column.get("columnComment")
        data_type = str(raw_column.get("dataType") or "").strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9_ ]{0,99}", data_type):
            data_type = ""
        profile_kind = str(raw_column.get("profileKind") or "NUMERIC").strip().upper()
        if profile_kind not in {"NUMERIC", "CATEGORICAL", "TEMPORAL"}:
            profile_kind = "CATEGORICAL"
        top_values = []
        for raw_top_value in raw_column.get("topValues") or []:
            if not isinstance(raw_top_value, dict):
                continue
            top_values.append(
                {
                    "VALUE": str(raw_top_value.get("value") or "")[:500],
                    "BEFORE_COUNT": _safe_stat_number(raw_top_value.get("beforeCount"), integer=True) or 0,
                    "AFTER_COUNT": (
                        _safe_stat_number(raw_top_value.get("afterCount"), integer=True)
                        if after is not None
                        else None
                    ),
                }
            )
            if len(top_values) >= 10:
                break
        columns.append(
            {
                "COLUMN_NAME": column_name,
                "COLUMN_DESC": column_comment[:500] if isinstance(column_comment, str) else "",
                "DATA_TYPE": data_type,
                "PROFILE_KIND": profile_kind,
                "BEFORE": before,
                "AFTER": after,
                "TOP_VALUES": top_values,
                "DISTRIBUTION": _safe_statistics_distribution(
                    raw_column.get("distribution"),
                    has_after=after is not None,
                ),
                "VARIANCE_DELTA": variance_delta,
                "VARIANCE_REDUCTION_RATE": variance_reduction_rate,
                "VARIANCE_DIRECTION": variance_direction,
            }
        )
        column_insight = _safe_statistics_insight(raw_column.get("insight"))
        if column_insight:
            column_insights.append(column_insight)
        if len(columns) >= 100:
            break
    raw_insights = value.get("insights") if isinstance(value.get("insights"), dict) else {}
    raw_ranked = raw_insights.get("rankedColumns") if isinstance(raw_insights.get("rankedColumns"), list) else []
    ranked_insights = [
        insight
        for raw_insight in raw_ranked[:100]
        if (insight := _safe_statistics_insight(raw_insight)) is not None
    ]
    if not ranked_insights:
        ranked_insights = column_insights
    ranked_insights.sort(
        key=lambda item: (
            item.get("IMPORTANCE_RANK") is None,
            item.get("IMPORTANCE_RANK") or 0,
            -(item.get("IMPORTANCE_SCORE") or 0),
            item.get("COLUMN_NAME") or "",
        )
    )
    for index, insight in enumerate(ranked_insights, start=1):
        if insight.get("IMPORTANCE_RANK") is None:
            insight["IMPORTANCE_RANK"] = index
    basis = str(value.get("basis") or "VALIDATION_SNAPSHOT").strip().upper()
    if basis not in {
        "VALIDATION_SNAPSHOT",
        "VALIDATION_SNAPSHOT_SOURCE",
        "BEFORE_AFTER",
        "LIVE_CURRENT_PHYSICAL_PAIR",
        "SINGLE",
        "LIVE_CURRENT_AFTER_APPLY",
    }:
        basis = "VALIDATION_SNAPSHOT"
    return {
        "AVAILABLE": True,
        "BASIS": basis,
        "BEFORE_SOURCE": before_source,
        "AFTER_SOURCE": after_source,
        "COLUMNS": columns,
        "RANKED_INSIGHTS": ranked_insights,
        "TRUNCATED": bool(value.get("truncated")) or len(raw_columns) > len(columns),
    }


def _statistics_stage_rows(statistics: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not statistics:
        return []
    rows: list[dict[str, Any]] = []
    for column in statistics.get("COLUMNS") or []:
        for stage, metrics_key in (("변경 전", "BEFORE"), ("변경 후", "AFTER")):
            metrics = column.get(metrics_key)
            rows.append(
                {
                    "DATA_STAGE": (
                        stage
                        if isinstance(metrics, dict)
                        else "수정(비교 대상 없음)"
                    ),
                    "COLUMN_NAME": column.get("COLUMN_NAME"),
                    "COLUMN_DESC": column.get("COLUMN_DESC"),
                    "DATA_TYPE": column.get("DATA_TYPE"),
                    **(metrics if isinstance(metrics, dict) else {}),
                }
            )
    return rows


def _statistics_variance_rows(statistics: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not statistics:
        return []
    return [
        {
            "COLUMN_NAME": column.get("COLUMN_NAME"),
            "COLUMN_DESC": column.get("COLUMN_DESC"),
            "BEFORE_VARIANCE": (column.get("BEFORE") or {}).get("VARIANCE_VALUE"),
            "AFTER_VARIANCE": (column.get("AFTER") or {}).get("VARIANCE_VALUE"),
            "VARIANCE_DELTA": column.get("VARIANCE_DELTA"),
            "VARIANCE_REDUCTION_RATE": column.get("VARIANCE_REDUCTION_RATE"),
            "VARIANCE_DIRECTION": column.get("VARIANCE_DIRECTION"),
        }
        for column in statistics.get("COLUMNS") or []
        if isinstance(column, dict) and isinstance(column.get("AFTER"), dict)
    ]


def _statistics_priority_rows(statistics: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not statistics:
        return []
    return [
        dict(row)
        for row in statistics.get("RANKED_INSIGHTS") or []
        if isinstance(row, dict)
    ]


def _statistics_distribution_rows(statistics: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not statistics:
        return []
    rows: list[dict[str, Any]] = []
    for column in statistics.get("COLUMNS") or []:
        if not isinstance(column, dict):
            continue
        before = column.get("BEFORE") or {}
        after = column.get("AFTER") or {}
        before_mean = before.get("MEAN_VALUE")
        after_mean = after.get("MEAN_VALUE")
        rows.append(
            {
                "COLUMN_NAME": column.get("COLUMN_NAME"),
                "COLUMN_DESC": column.get("COLUMN_DESC"),
                "BEFORE_MEAN": before_mean,
                "AFTER_MEAN": after_mean,
                "MEAN_DELTA": (
                    float(after_mean) - float(before_mean)
                    if before_mean is not None and after_mean is not None
                    else None
                ),
                "BEFORE_VARIANCE": before.get("VARIANCE_VALUE"),
                "AFTER_VARIANCE": after.get("VARIANCE_VALUE"),
                "VARIANCE_REDUCTION_RATE": column.get("VARIANCE_REDUCTION_RATE"),
                "BEFORE_STDDEV": before.get("STDDEV_VALUE"),
                "AFTER_STDDEV": after.get("STDDEV_VALUE"),
                "BEFORE_MIN": before.get("MIN_VALUE"),
                "AFTER_MIN": after.get("MIN_VALUE"),
                "BEFORE_MAX": before.get("MAX_VALUE"),
                "AFTER_MAX": after.get("MAX_VALUE"),
            }
        )
    return rows


def _statistics_distribution_bin_rows(statistics: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not statistics:
        return []
    rows: list[dict[str, Any]] = []
    for column in statistics.get("COLUMNS") or []:
        if not isinstance(column, dict):
            continue
        distribution = column.get("DISTRIBUTION")
        if not isinstance(distribution, dict):
            continue
        for raw_bin in distribution.get("BINS") or []:
            if not isinstance(raw_bin, dict):
                continue
            rows.append(
                {
                    "COLUMN_NAME": column.get("COLUMN_NAME"),
                    "COLUMN_DESC": column.get("COLUMN_DESC"),
                    "BIN_NO": raw_bin.get("BIN_NO"),
                    "RANGE_FROM": raw_bin.get("LOWER_VALUE"),
                    "RANGE_TO": raw_bin.get("UPPER_VALUE"),
                    "BEFORE_COUNT": raw_bin.get("BEFORE_COUNT"),
                    "AFTER_COUNT": raw_bin.get("AFTER_COUNT"),
                }
            )
    return rows


def _statistics_top_value_rows(statistics: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not statistics:
        return []
    rows: list[dict[str, Any]] = []
    for column in statistics.get("COLUMNS") or []:
        if not isinstance(column, dict) or column.get("PROFILE_KIND") == "NUMERIC":
            continue
        for rank, value in enumerate(column.get("TOP_VALUES") or [], start=1):
            rows.append(
                {
                    "COLUMN_NAME": column.get("COLUMN_NAME"),
                    "COLUMN_DESC": column.get("COLUMN_DESC"),
                    "PROFILE_KIND": column.get("PROFILE_KIND"),
                    "VALUE_RANK": rank,
                    "VALUE": value.get("VALUE"),
                    "BEFORE_COUNT": value.get("BEFORE_COUNT"),
                    "AFTER_COUNT": value.get("AFTER_COUNT"),
                }
            )
    return rows


def _allowlisted_fields(source: Any, fields: Iterable[str]) -> dict[str, Any]:
    if not isinstance(source, dict):
        return {}
    return {field: _safe_scalar(source.get(field)) for field in fields if field in source}


def _safe_validation_snapshot(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row or not row.get("EVENT_DETAIL_JSON"):
        return None
    value = _read_lob(row.get("EVENT_DETAIL_JSON"))
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    if not isinstance(value, dict):
        return None
    analysis = value.get("EDIT_ANALYSIS")
    if not isinstance(analysis, dict):
        return None
    overall = _allowlisted_fields(analysis.get("OVERALL"), _VALIDATION_OVERALL_FIELDS)
    scopes = [
        {
            "SCOPE": scope_name,
            **_allowlisted_fields(analysis.get(scope_name), _VALIDATION_SCOPE_FIELDS),
        }
        for scope_name in ("CATEGORICAL", "CONTINUOUS")
    ]
    return {
        "ANALYSIS_SOURCE": "VALIDATION_SNAPSHOT",
        "VALIDATION_SNAPSHOT_AT": row.get("VALIDATION_SNAPSHOT_AT"),
        "METHOD_VERSION": _safe_scalar(analysis.get("METHOD_VERSION")),
        "BASELINE_FLOW_RUN_ID": _safe_scalar(value.get("BASELINE_FLOW_RUN_ID")),
        "REANALYSIS_FLOW_RUN_ID": _safe_scalar(value.get("REANALYSIS_FLOW_RUN_ID")),
        "OVERALL": overall,
        "SCOPES": scopes,
        "REANALYSIS": _allowlisted_fields(analysis.get("REANALYSIS"), _VALIDATION_REANALYSIS_FIELDS),
        "DESCRIPTIVE_STATISTICS": _safe_descriptive_statistics(value.get("DESCRIPTIVE_STATISTICS")),
    }


def _load_descriptive_statistics_report_data(
    conn,
    context: dict[str, Any],
) -> tuple[dict[str, Any] | None, str, str | None]:
    session = context.get("editSession")
    selection = context.get("selection") or {}
    if isinstance(session, dict):
        cursor = conn.cursor()
        try:
            live_value = descriptive_statistics.build_edit_session_statistics(
                cursor,
                session,
                basis="LIVE_CURRENT_PHYSICAL_PAIR",
            )
            safe_live_value = _safe_descriptive_statistics(live_value)
            if safe_live_value:
                safe_live_value["BASIS"] = "LIVE_CURRENT_PHYSICAL_PAIR"
                return safe_live_value, "CURRENT_PHYSICAL_PAIR", None
        except Exception as exc:
            logger.warning(
                "M06001 live descriptive-statistics report fallback. edit_session_id=%s error_type=%s",
                selection.get("editSessionId"),
                type(exc).__name__,
            )
        finally:
            cursor.close()

    table_rows = _query(
        conn,
        "M06001_TARGET_TABLE_LIST",
        {
            "projectId": selection.get("projectId"),
            "scenarioId": selection.get("scenarioId"),
        },
    )
    run_plan = _safe_run_plan_snapshot((context.get("flowRun") or {}).get("PLAN_JSON"))
    run_targets = {
        (
            str(node.get("OWNER_NAME") or "").strip().upper(),
            str(node.get("TABLE_NAME") or "").strip().upper(),
        )
        for node in run_plan.get("nodes") or []
        if node.get("OWNER_NAME") and node.get("TABLE_NAME")
    }
    pair_candidates = [
        row
        for row in table_rows
        if row.get("OWNER_NAME") and row.get("TABLE_NAME")
    ]
    pair_candidates.sort(
        key=lambda row: (
            0
            if (
                str(row.get("OWNER_NAME") or "").strip().upper(),
                str(row.get("TABLE_NAME") or "").strip().upper(),
            ) in run_targets
            else 1,
            0 if str(row.get("TABLE_NAME") or "").strip().upper().startswith("INITUP$") else 1,
            0 if row.get("EDIT_OWNER_NAME") and row.get("EDIT_TABLE_NAME") else 1,
            _as_int(row.get("SCENARIO_TABLE_ID")),
        )
    )
    if pair_candidates:
        cursor = conn.cursor()
        try:
            for table_row in pair_candidates:
                source_owner = str(table_row.get("OWNER_NAME") or "").strip().upper()
                source_table = str(table_row.get("TABLE_NAME") or "").strip().upper()
                physical_pair = descriptive_statistics.resolve_physical_pair(
                    cursor,
                    target_owner=source_owner,
                    target_table=source_table,
                )
                registered_pair = (
                    {
                        "SOURCE_OWNER": source_owner,
                        "SOURCE_TABLE": source_table,
                        "EDIT_OWNER": str(table_row.get("EDIT_OWNER_NAME") or "").strip().upper(),
                        "EDIT_TABLE": str(table_row.get("EDIT_TABLE_NAME") or "").strip().upper(),
                    }
                    if table_row.get("EDIT_OWNER_NAME") and table_row.get("EDIT_TABLE_NAME")
                    else None
                )
                comparison_pair = physical_pair or registered_pair
                try:
                    common_context = {
                        "projectId": selection.get("projectId"),
                        "scenarioId": selection.get("scenarioId"),
                        "flowRunId": selection.get("flowRunId"),
                        "scenarioTableId": table_row.get("SCENARIO_TABLE_ID"),
                        "statisticsSource": (
                            "LIVE_PHYSICAL_SOURCE_EDIT_PAIR"
                            if physical_pair
                            else (
                                "LIVE_REGISTERED_SOURCE_EDIT_PAIR"
                                if registered_pair
                                else "LIVE_SOURCE_ONLY"
                            )
                        ),
                    }
                    try:
                        live_value = descriptive_statistics.build_statistics(
                            cursor,
                            before_owner=str((comparison_pair or {}).get("SOURCE_OWNER") or source_owner),
                            before_table=str((comparison_pair or {}).get("SOURCE_TABLE") or source_table),
                            after_owner=(comparison_pair or {}).get("EDIT_OWNER"),
                            after_table=(comparison_pair or {}).get("EDIT_TABLE"),
                            basis="LIVE_CURRENT_PHYSICAL_PAIR" if comparison_pair else "SINGLE",
                            context=common_context,
                        )
                    except HTTPException as exc:
                        if not comparison_pair or exc.status_code != 404:
                            raise
                        live_value = descriptive_statistics.build_statistics(
                            cursor,
                            before_owner=source_owner,
                            before_table=source_table,
                            basis="SINGLE",
                            context={
                                **common_context,
                                "statisticsSource": "LIVE_SOURCE_ONLY",
                                "comparisonAvailable": False,
                            },
                        )
                        live_value["notice"] = (
                            "INITDN$ 수정 테이블을 확인할 수 없어 INITUP$ 원본 통계만 제공합니다."
                        )
                    live_value = descriptive_statistics.attach_column_insights(
                        live_value,
                        descriptive_statistics.load_violation_column_insights(
                            cursor,
                            target_owner=str((comparison_pair or {}).get("SOURCE_OWNER") or source_owner),
                            target_table=str((comparison_pair or {}).get("SOURCE_TABLE") or source_table),
                            run_source_type="FLOW_WORK" if selection.get("flowRunId") else None,
                            run_id=selection.get("flowRunId"),
                        ),
                    )
                    safe_live_value = _safe_descriptive_statistics(live_value)
                    if safe_live_value:
                        safe_live_value["BASIS"] = (
                            "LIVE_CURRENT_PHYSICAL_PAIR" if safe_live_value.get("AFTER_SOURCE") else "SINGLE"
                        )
                        return (
                            safe_live_value,
                            "CURRENT_PHYSICAL_PAIR" if safe_live_value.get("AFTER_SOURCE") else "CURRENT_SOURCE_ONLY",
                            None,
                        )
                except HTTPException as exc:
                    logger.info(
                        "M06001 registered-pair descriptive statistics skipped. table=%s.%s status=%s",
                        source_owner,
                        source_table,
                        exc.status_code,
                    )
        finally:
            cursor.close()

    edit_session_id = selection.get("editSessionId")
    if not edit_session_id:
        return (
            None,
            "UNAVAILABLE",
            "등록된 INITUP$ 원본 테이블을 확인할 수 없습니다.",
        )
    snapshot_row = _first(
        _query(
            conn,
            "M06001_VALIDATION_SNAPSHOT",
            {
                "projectId": selection.get("projectId"),
                "scenarioId": selection.get("scenarioId"),
                "editSessionId": edit_session_id,
            },
        )
    )
    snapshot = _safe_validation_snapshot(snapshot_row)
    snapshot_statistics = (snapshot or {}).get("DESCRIPTIVE_STATISTICS")
    if snapshot_statistics:
        return snapshot_statistics, "VALIDATION_SNAPSHOT", snapshot.get("VALIDATION_SNAPSHOT_AT")
    return (
        None,
        "UNAVAILABLE",
        "선택한 기준의 INITUP$ 원본 테이블 또는 저장된 기초통계량 스냅샷을 확인할 수 없습니다.",
    )


def _first_present(source: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in source and source.get(key) not in (None, ""):
            return source.get(key)
    return None


def _safe_run_plan_snapshot(value: Any) -> dict[str, Any]:
    value = _read_lob(value)
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return {"nodes": [], "edges": [], "metadata": {}}
    if isinstance(value, list):
        root = {"plan": value}
    elif isinstance(value, dict):
        root = value
    else:
        return {"nodes": [], "edges": [], "metadata": {}}
    steps = root.get("plan") if isinstance(root.get("plan"), list) else []
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    edge_keys: set[tuple[str, ...]] = set()
    for step in steps:
        if not isinstance(step, dict):
            continue
        payload = step.get("nodePayload") if isinstance(step.get("nodePayload"), dict) else {}
        upstream = step.get("upstream") if isinstance(step.get("upstream"), list) else []
        downstream = step.get("downstream") if isinstance(step.get("downstream"), list) else []
        nodes.append(
            {
                "NODE_KEY": _safe_scalar(_first_present(step, "nodeKey", "NODE_KEY")),
                "NODE_NAME": _safe_scalar(_first_present(step, "nodeName", "NODE_NAME")),
                "NODE_TYPE": _safe_scalar(_first_present(step, "nodeType", "NODE_TYPE")),
                "USE_YN": _safe_scalar(_first_present(step, "useYn", "USE_YN")),
                "REF_MENU_CODE": _safe_scalar(_first_present(step, "refMenuCode", "REF_MENU_CODE")),
                "REF_WORK_JOB_ID": _safe_scalar(_first_present(step, "refWorkJobId", "REF_WORK_JOB_ID")),
                "REF_OBJECT_ID": _safe_scalar(_first_present(step, "refObjectId", "REF_OBJECT_ID")),
                "RUN_LEVEL": _safe_scalar(_first_present(step, "level", "RUN_LEVEL")),
                "UPSTREAM_NODE_KEYS": ", ".join(str(item)[:100] for item in upstream[:100]),
                "DOWNSTREAM_NODE_KEYS": ", ".join(str(item)[:100] for item in downstream[:100]),
                "RUN_STATUS": _safe_scalar(_first_present(step, "status", "STATUS")),
                "NODE_DESC": _safe_scalar(_first_present(payload, "nodeDesc", "NODE_DESC")),
                "OWNER_NAME": _safe_scalar(_first_present(payload, "ownerName", "OWNER_NAME")),
                "TABLE_NAME": _safe_scalar(_first_present(payload, "tableName", "TABLE_NAME")),
                "RESULT_OWNER": _safe_scalar(_first_present(payload, "resultOwner", "RESULT_OWNER")),
                "RESULT_TABLE_NAME": _safe_scalar(_first_present(payload, "resultTableName", "RESULT_TABLE_NAME")),
                "RESULT_CREATE_YN": _safe_scalar(_first_present(payload, "resultCreateYn", "RESULT_CREATE_YN")),
                "EXEC_OBJECT_NAME": _safe_scalar(_first_present(payload, "execObjectName", "EXEC_OBJECT_NAME")),
                "EXEC_METHOD": _safe_scalar(_first_present(payload, "execMethod", "EXEC_METHOD")),
                "SORT_ORDER": _safe_scalar(_first_present(payload, "sortOrder", "SORT_ORDER")),
            }
        )
        incoming_edges = step.get("incomingEdges") if isinstance(step.get("incomingEdges"), list) else []
        for edge in incoming_edges:
            if not isinstance(edge, dict):
                continue
            row = {
                "FROM_NODE_KEY": _safe_scalar(_first_present(edge, "fromNodeKey", "FROM_NODE_KEY")),
                "FROM_PORT": _safe_scalar(_first_present(edge, "fromPort", "FROM_PORT")),
                "TO_NODE_KEY": _safe_scalar(
                    _first_present(edge, "toNodeKey", "TO_NODE_KEY")
                    or _first_present(step, "nodeKey", "NODE_KEY")
                ),
                "TO_PORT": _safe_scalar(_first_present(edge, "toPort", "TO_PORT")),
                "EDGE_MODE": _safe_scalar(_first_present(edge, "edgeMode", "EDGE_MODE")),
                "DASHED_YN": _safe_scalar(_first_present(edge, "dashedYn", "DASHED_YN")),
                "SORT_ORDER": _safe_scalar(_first_present(edge, "sortOrder", "SORT_ORDER")),
            }
            marker = tuple(str(row.get(key) or "") for key in row)
            if marker not in edge_keys:
                edge_keys.add(marker)
                edges.append(row)
    metadata = {
        "BASIS": "RUN_PLAN_SNAPSHOT",
        "SELECTED_NODE_KEY": _safe_scalar(_first_present(root, "selectedNodeKey", "SELECTED_NODE_KEY")),
        "DOWNSTREAM_YN": "Y" if root.get("downstream") is True else ("N" if root.get("downstream") is False else None),
        "CONTINUE_RUN_ID": _safe_scalar(_first_present(root, "continueRunId", "CONTINUE_RUN_ID")),
    }
    return {"nodes": nodes, "edges": edges, "metadata": metadata}


def _column_label(key: str) -> str:
    return COLUMN_LABELS.get(key, key.replace("_", " ").title())


def _table_section(
    title: str,
    rows: list[dict[str, Any]],
    *,
    description: str = "",
    columns: list[str] | None = None,
    note: str = "",
) -> dict[str, Any]:
    normalized_rows = [_normalize_value(row) for row in rows if isinstance(row, dict) and row]
    if columns is None:
        columns = list(normalized_rows[0].keys()) if normalized_rows else []
    return {
        "type": "table",
        "title": title,
        "description": description,
        "columns": [{"key": key, "label": _column_label(key)} for key in columns],
        "rows": [{key: row.get(key) for key in columns} for row in normalized_rows],
        "note": note,
    }


def _text_section(title: str, paragraphs: list[str], *, note: str = "") -> dict[str, Any]:
    return {
        "type": "text",
        "title": title,
        "paragraphs": paragraphs,
        "note": note,
    }


def _kpi(
    code: str,
    label: str,
    value: Any,
    *,
    unit: str = "COUNT",
    numerator: Any | None = None,
    denominator: Any | None = None,
    tone: str = "neutral",
) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "value": value,
        "unit": unit,
        "numerator": numerator,
        "denominator": denominator,
        "tone": tone,
    }


def _availability_status(
    requirement: str,
    counts: dict[str, Any],
    *,
    flow_run_id: int | None,
    edit_session_id: int | None,
) -> tuple[str, str | None, int]:
    if requirement == "PROJECT":
        has_activity = any(
            _as_int(counts.get(key)) > 0
            for key in ("FLOW_RUN_COUNT", "EDIT_RULE_COUNT", "EDIT_SESSION_COUNT")
        )
        return ("AVAILABLE" if has_activity else "PARTIAL", None if has_activity else "아직 실행·에디팅 이력이 없습니다.", 1)
    if requirement == "FLOW":
        count = _as_int(counts.get("FLOW_COUNT"))
        if not count:
            return ("NO_DATA", "설계된 M04001 Flow가 없습니다.", 0)
        if not flow_run_id:
            return ("PARTIAL", "실행 이력이 없어 Flow 설계 기준만 제공합니다.", count)
        return ("AVAILABLE", None, count)
    if requirement == "WORK":
        count = _as_int(counts.get("FLOW_RUN_COUNT")) + _as_int(counts.get("EDIT_SESSION_COUNT"))
        return ("AVAILABLE" if count else "NO_DATA", None if count else "실행 또는 에디팅 작업 이력이 없습니다.", count)
    if requirement == "EDIT_WORK":
        session_count = _as_int(counts.get("EDIT_SESSION_COUNT"))
        table_count = _as_int(counts.get("TARGET_TABLE_COUNT"))
        if session_count:
            return ("AVAILABLE", None, session_count)
        if table_count:
            return ("PARTIAL", "에디팅 세션이 없어 대상 테이블 매핑만 제공합니다.", table_count)
        return ("NO_DATA", "대상 테이블 매핑과 에디팅 세션이 없습니다.", 0)
    if requirement == "DISCOVERED_RULE_COUNT":
        if not flow_run_id:
            return ("NOT_APPLICABLE", "규칙 판단 기준 Flow Run을 선택해야 합니다.", 0)
        count = _as_int(counts.get("ASSOCIATION_RULE_COUNT")) + _as_int(counts.get("SYMBOLIC_RULE_COUNT"))
        return ("AVAILABLE" if count else "NO_DATA", None if count else "선택한 Run에 발굴 규칙이 없습니다.", count)
    if requirement == "VALIDATED_SESSION_COUNT":
        if not edit_session_id:
            validated_count = _as_int(counts.get("VALIDATED_SESSION_COUNT"))
            return (
                ("NOT_APPLICABLE", "수정 전·후 효과검증 보고서는 수정 작업 이력을 선택하면 조회할 수 있습니다.", 0)
                if validated_count
                else ("NO_DATA", "효과 검증이 완료된 수정 작업 이력이 없습니다.", 0)
            )
        snapshot_count = _as_int(counts.get("VALIDATION_SNAPSHOT_COUNT"))
        if snapshot_count:
            return ("AVAILABLE", None, snapshot_count)
        if _as_int(counts.get("VALIDATED_SESSION_COUNT")):
            return ("PARTIAL", "저장된 효과 검증 스냅샷이 없어 과거 효과 지표를 재산정하지 않습니다.", 0)
        return ("NO_DATA", "선택한 세션의 효과 검증이 완료되지 않았습니다.", 0)
    if requirement == "DESCRIPTIVE_STATISTICS":
        pair_count = _as_int(counts.get("EDIT_READY_TARGET_TABLE_COUNT"))
        if pair_count:
            return ("AVAILABLE", None, pair_count)
        target_count = _as_int(counts.get("TARGET_TABLE_COUNT"))
        return (
            (
                "PARTIAL",
                "INITUP$ 원본 프로파일을 제공하며 INITDN$가 없어 수정 비교값만 제외됩니다.",
                target_count,
            )
            if target_count
            else ("NO_DATA", "등록된 대상 테이블이 없습니다.", 0)
        )
    if requirement in {
        "COLUMN_TYPE_COUNT",
        "RELATION_COUNT",
        "NETWORK_NODE_COUNT",
        "ASSOCIATION_RULE_COUNT",
        "LASSO_FEATURE_COUNT",
        "SYMBOLIC_RULE_COUNT",
        "VIOLATION_COUNT",
    } and not flow_run_id:
        return ("NOT_APPLICABLE", "분석 기준 Flow Run을 선택해야 합니다.", 0)
    if requirement in {
        "EDIT_CHANGE_COUNT",
        "DML_COUNT",
    } and not edit_session_id:
        fallback_count = _as_int(counts.get(requirement))
        return (
            ("NOT_APPLICABLE", "이 보고서는 상단에서 수정 작업 이력을 선택하면 조회할 수 있습니다.", 0)
            if fallback_count > 0
            else ("NO_DATA", "저장된 수정 작업 이력이 없습니다.", 0)
        )
    count = _as_int(counts.get(requirement))
    return ("AVAILABLE" if count else "NO_DATA", None if count else "선택한 기준에 생성된 데이터가 없습니다.", count)


def _project_detail(conn, request: Request, project_id: int) -> dict[str, Any]:
    rows = _query(
        conn,
        "M06001_PROJECT_DETAIL",
        {"projectId": project_id, **_request_access(request)},
    )
    project = _first(rows)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _without_keys(row: dict[str, Any] | None, excluded: set[str]) -> dict[str, Any] | None:
    if not row:
        return None
    return {key: value for key, value in row.items() if key not in excluded}


def _public_context(context: dict[str, Any]) -> dict[str, Any]:
    return {
        **context,
        "flowRun": _without_keys(context.get("flowRun"), {"PLAN_JSON"}),
        "editSession": _without_keys(context.get("editSession"), set()),
    }


def _resolve_context(
    conn,
    request: Request,
    *,
    project_id: int,
    scenario_id: int | None = None,
    flow_run_id: int | None = None,
    edit_session_id: int | None = None,
) -> dict[str, Any]:
    requested_flow_run_id = flow_run_id
    access = _request_access(request)
    project = _project_detail(conn, request, project_id)
    scenarios = _query(
        conn,
        "M06001_SCENARIO_LIST",
        {"projectId": project_id, **access},
    )
    selected_scenario: dict[str, Any] | None = None
    if scenario_id:
        selected_scenario = next(
            (row for row in scenarios if _as_int(row.get("SCENARIO_ID")) == scenario_id),
            None,
        )
        if not selected_scenario:
            raise HTTPException(status_code=404, detail="Scenario not found in the selected project.")
    elif scenarios:
        selected_scenario = scenarios[0]
        scenario_id = _as_int(selected_scenario.get("SCENARIO_ID")) or None

    runs = _query(
        conn,
        "M06001_FLOW_RUN_LIST",
        {"projectId": project_id, "scenarioId": scenario_id, **access},
    )
    sessions = _query(
        conn,
        "M06001_EDIT_SESSION_LIST",
        {"projectId": project_id, "scenarioId": scenario_id, **access},
    )

    selected_session: dict[str, Any] | None = None
    if edit_session_id:
        selected_session = _first(
            _query(
                conn,
                "M06001_EDIT_SESSION_DETAIL",
                {
                    "projectId": project_id,
                    "scenarioId": scenario_id,
                    "editSessionId": edit_session_id,
                    **access,
                },
            )
        )
        if not selected_session:
            raise HTTPException(status_code=404, detail="Editing session not found in the selected context.")

    preferred_flow_run_id = flow_run_id
    if not preferred_flow_run_id and selected_session:
        preferred_flow_run_id = _as_int(selected_session.get("BASELINE_FLOW_RUN_ID")) or None
        if not preferred_flow_run_id and str(selected_session.get("SOURCE_RUN_SOURCE_TYPE") or "").upper() == "FLOW_WORK":
            preferred_flow_run_id = _as_int(selected_session.get("SOURCE_RUN_ID")) or None
    if not preferred_flow_run_id and selected_scenario:
        preferred_flow_run_id = _as_int(selected_scenario.get("LATEST_FLOW_RUN_ID")) or None
    if not preferred_flow_run_id:
        successful = next(
            (row for row in runs if str(row.get("STATUS") or "").upper() in {"SUCCESS", "COMPLETED"}),
            None,
        )
        preferred_flow_run_id = _as_int((successful or _first(runs) or {}).get("FLOW_RUN_ID")) or None

    selected_run: dict[str, Any] | None = None
    if preferred_flow_run_id:
        selected_run = _first(
            _query(
                conn,
                "M06001_FLOW_RUN_DETAIL",
                {
                    "projectId": project_id,
                    "scenarioId": scenario_id,
                    "flowRunId": preferred_flow_run_id,
                    **access,
                },
            )
        )
        if requested_flow_run_id and not selected_run:
            raise HTTPException(status_code=404, detail="Flow Run not found in the selected context.")
        if selected_run:
            flow_run_id = _as_int(selected_run.get("FLOW_RUN_ID")) or None
        else:
            flow_run_id = None
    if not selected_run and not requested_flow_run_id:
        fallback_run = next(
            (row for row in runs if str(row.get("STATUS") or "").upper() in {"SUCCESS", "COMPLETED"}),
            _first(runs),
        )
        fallback_flow_run_id = _as_int((fallback_run or {}).get("FLOW_RUN_ID")) or None
        if fallback_flow_run_id:
            selected_run = _first(
                _query(
                    conn,
                    "M06001_FLOW_RUN_DETAIL",
                    {
                        "projectId": project_id,
                        "scenarioId": scenario_id,
                        "flowRunId": fallback_flow_run_id,
                        **access,
                    },
                )
            )
            flow_run_id = _as_int((selected_run or {}).get("FLOW_RUN_ID")) or None

    return {
        "project": project,
        "scenarios": scenarios,
        "scenario": selected_scenario,
        "flowRuns": runs,
        "flowRun": selected_run,
        "editSessions": sessions,
        "editSession": selected_session,
        "selection": {
            "projectId": project_id,
            "scenarioId": scenario_id,
            "flowRunId": flow_run_id,
            "editSessionId": edit_session_id,
        },
    }


def list_projects(
    request: Request,
    *,
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    page = max(1, int(page or 1))
    page_size = min(50, max(1, int(page_size or 20)))
    conn = get_target_db_connection(request)
    try:
        rows = _query(
            conn,
            "M06001_PROJECT_PAGE",
            {
                "keyword": (keyword or "").strip(),
                "offset": (page - 1) * page_size,
                "endRow": page * page_size,
                **_request_access(request),
            },
        )
        total = _as_int(rows[0].get("TOTAL_COUNT")) if rows else 0
        for row in rows:
            row.pop("OWNER_SORT", None)
            row.pop("RN__", None)
            row.pop("TOTAL_COUNT", None)
        return {
            "status": "success",
            "data": rows,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "hasMore": page * page_size < total,
        }
    finally:
        conn.close()


def get_report_context(
    request: Request,
    *,
    project_id: int,
    scenario_id: int | None = None,
    flow_run_id: int | None = None,
    edit_session_id: int | None = None,
) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    try:
        context = _resolve_context(
            conn,
            request,
            project_id=project_id,
            scenario_id=scenario_id,
            flow_run_id=flow_run_id,
            edit_session_id=edit_session_id,
        )
        return {"status": "success", "data": _public_context(context)}
    finally:
        conn.close()


def _load_counts(conn, context: dict[str, Any]) -> dict[str, Any]:
    selection = context["selection"]
    return _first(
        _query(
            conn,
            "M06001_AVAILABILITY_COUNTS",
            {
                "projectId": selection["projectId"],
                "scenarioId": selection["scenarioId"],
                "flowRunId": selection["flowRunId"],
                "editSessionId": selection["editSessionId"],
            },
        )
    ) or {}


def _catalog_with_availability(
    context: dict[str, Any],
    counts: dict[str, Any],
    language: str = "ko",
) -> list[dict[str, Any]]:
    flow_run_id = context["selection"].get("flowRunId")
    edit_session_id = context["selection"].get("editSessionId")
    result: list[dict[str, Any]] = []
    for index, definition in enumerate(REPORT_CATALOG, start=1):
        status, reason, data_count = _availability_status(
            definition["requirement"],
            counts,
            flow_run_id=flow_run_id,
            edit_session_id=edit_session_id,
        )
        result.append(
            localize_catalog_item({
                **definition,
                "order": index,
                "availability": status,
                "availabilityReason": reason,
                "dataCount": data_count,
                "definitionVersion": REPORT_DEFINITION_VERSION,
                "downloads": ["html", "xlsx", "pdf"],
            }, language)
        )
    return result


def get_report_catalog(
    request: Request,
    *,
    project_id: int,
    scenario_id: int | None = None,
    flow_run_id: int | None = None,
    edit_session_id: int | None = None,
    language: str = "ko",
) -> dict[str, Any]:
    conn = get_target_db_connection(request)
    try:
        context = _resolve_context(
            conn,
            request,
            project_id=project_id,
            scenario_id=scenario_id,
            flow_run_id=flow_run_id,
            edit_session_id=edit_session_id,
        )
        counts = _load_counts(conn, context)
        return {
            "status": "success",
            "data": _catalog_with_availability(context, counts, normalize_report_language(language)),
            "context": _public_context(context),
        }
    finally:
        conn.close()


def _report_context_payload(context: dict[str, Any], generated_at: str) -> dict[str, Any]:
    return {
        "project": context.get("project"),
        "scenario": context.get("scenario"),
        "flowRun": _without_keys(context.get("flowRun"), {"PLAN_JSON"}),
        "editSession": context.get("editSession"),
        "selection": context.get("selection"),
        "generatedAt": generated_at,
    }


def _report_definitions(report_code: str) -> list[dict[str, str]]:
    common = [
        {"term": "기준 시각", "definition": "보고서를 생성한 시각이며 선택한 분석 Run·수정 작업 식별자와 함께 결과 기준을 고정합니다."},
        {"term": "데이터 없음", "definition": "보고서 유형은 유지되지만 선택 기준에서 해당 결과가 생성되지 않은 상태입니다."},
        {"term": "해당 없음", "definition": "보고서 산정에 필요한 분석 기준이 없어 계산할 수 없는 상태입니다."},
    ]
    if report_code in {"R08", "R12", "R13"}:
        common.extend(
            [
                {"term": "Support", "definition": "연관규칙 패턴이 전체 데이터에서 함께 관찰된 비율이며 0~1로 정규화합니다."},
                {"term": "Confidence", "definition": "연관규칙 조건이 참일 때 결과도 참인 비율이며 0~1로 정규화합니다."},
                {"term": "Lift", "definition": "결과의 기본 발생률 대비 규칙의 결합 강도입니다."},
                {"term": "Symbolic 점수", "definition": "Symbolic 모델이 저장한 품질 점수이며 연관규칙 Confidence와 다른 척도로 구분합니다."},
            ]
        )
    if report_code in {"R15", "R17", "R20", "R21"}:
        common.append(
            {"term": "비율 지표", "definition": "서로 다른 데이터 규모를 비교할 수 있도록 분자와 분모를 함께 제공합니다."}
        )
    if report_code in {"R17", "R21"}:
        common.extend(
            [
                {
                    "term": "모집단 분산",
                    "definition": "변경 전·후 전체 유효값을 모집단으로 보고 VAR_POP과 STDDEV_POP 기준으로 산정합니다.",
                },
                {
                    "term": "초과첨도",
                    "definition": "정규분포의 첨도를 0으로 보는 기준이며 4차 중심적률을 분산 제곱으로 나눈 뒤 3을 뺍니다.",
                },
                {
                    "term": "숫자 변환 실패",
                    "definition": "문자형 연속 컬럼에서 숫자로 변환할 수 없는 값은 NULL로 처리해 유효값 집계에서 제외하고 결측·변환실패 건수에 포함합니다.",
                },
            ]
        )
    if report_code == "R21":
        common.append(
            {
                "term": "컬럼 중요도 점수",
                "definition": "규칙 위반 55점, 결측 15점, 분산 변화 15점, 평균 이동 10점, 범위 이동 5점의 가중치를 합산한 확인 우선순위 지표입니다.",
            }
        )
    return common


def _build_sections_and_kpis(
    conn,
    report_code: str,
    context: dict[str, Any],
    counts: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    selection = context["selection"]
    project_id = selection["projectId"]
    scenario_id = selection["scenarioId"]
    flow_run_id = selection["flowRunId"]
    edit_session_id = selection["editSessionId"]
    common = {
        "projectId": project_id,
        "scenarioId": scenario_id,
        "flowRunId": flow_run_id,
        "editSessionId": edit_session_id,
    }
    sections: list[dict[str, Any]] = []
    kpis: list[dict[str, Any]] = []

    if report_code == "R01":
        summary_keys = [
            "SCENARIO_COUNT",
            "TARGET_TABLE_COUNT",
            "FLOW_COUNT",
            "FLOW_RUN_COUNT",
            "EDIT_RULE_COUNT",
            "FINAL_RULE_COUNT",
            "EDIT_SESSION_COUNT",
            "SCENARIO_EDIT_CHANGE_COUNT",
            "SCENARIO_DML_COUNT",
        ]
        summary_rows = [{"METRIC": _column_label(key), "VALUE": _as_int(counts.get(key))} for key in summary_keys]
        kpis = [
            _kpi("TARGET_TABLES", "대상 테이블", _as_int(counts.get("TARGET_TABLE_COUNT"))),
            _kpi("FLOW_RUNS", "Flow Run", _as_int(counts.get("FLOW_RUN_COUNT"))),
            _kpi("FINAL_RULES", "최종 규칙", _as_int(counts.get("FINAL_RULE_COUNT"))),
            _kpi("EDIT_CHANGES", "시나리오 전체 수정 건수", _as_int(counts.get("SCENARIO_EDIT_CHANGE_COUNT"))),
        ]
        sections.append(
            _text_section(
                "보고서 개요",
                [
                    "프로젝트와 선택 시나리오의 규칙발굴, 규칙 판단, 오류 수정, 효과 검증 및 운영 반영 현황을 동일한 기준으로 요약합니다.",
                    "세부 결과는 같은 화면의 고정 보고서 카드를 통해 단계별로 확인할 수 있습니다.",
                ],
            )
        )
        sections.append(_table_section("핵심 현황", summary_rows, columns=["METRIC", "VALUE"]))
    elif report_code == "R02":
        flows = _query(conn, "M06001_FLOW_LIST", common)
        design_params = {"projectId": project_id, "scenarioId": scenario_id}
        nodes = _query(conn, "M06001_FLOW_NODE_LIST", design_params) if flows else []
        edges = _query(conn, "M06001_FLOW_EDGE_LIST", design_params) if flows else []
        node_runs = _query(conn, "M06001_FLOW_NODE_RUN_LIST", {"flowRunId": flow_run_id}) if flow_run_id else []
        plan_snapshot = _safe_run_plan_snapshot((context.get("flowRun") or {}).get("PLAN_JSON"))
        snapshot_nodes = plan_snapshot.get("nodes") or []
        snapshot_edges = plan_snapshot.get("edges") or []
        parameter_rows: list[dict[str, Any]] = []
        parameter_rows.extend(_collect_safe_parameters((context.get("flowRun") or {}).get("PLAN_JSON"), "RUN_PLAN"))
        for row in nodes:
            parameter_rows.extend(
                _collect_safe_parameters(
                    row.get("PARAM_JSON"),
                    (
                        f"CURRENT_DESIGN.FLOW_{row.get('FLOW_ID') or 'unknown'}:"
                        f"{row.get('FLOW_NAME') or 'unnamed'}."
                        f"{row.get('NODE_NAME') or row.get('NODE_KEY') or 'node'}"
                    ),
                )
            )
        for row in node_runs:
            parameter_rows.extend(
                _collect_safe_parameters(
                    row.get("RUNTIME_PARAM_JSON"),
                    f"RUN_NODE.{row.get('NODE_NAME') or row.get('NODE_KEY') or 'node'}",
                )
            )
        safe_parameters = _deduplicate_parameter_rows(parameter_rows)
        success_nodes = sum(1 for row in node_runs if str(row.get("STATUS") or "").upper() == "SUCCESS")
        kpis = [
            _kpi("FLOW_COUNT", "설계 Flow", len(flows)),
            _kpi("CURRENT_NODE_COUNT", "현재 설계 노드", len(nodes)),
            _kpi("SNAPSHOT_NODE_COUNT", "실행 스냅샷 노드", len(snapshot_nodes)),
            _kpi(
                "NODE_SUCCESS_RATE",
                "노드 성공률",
                _ratio(success_nodes, len(node_runs)),
                unit="RATE",
                numerator=success_nodes,
                denominator=len(node_runs),
            ),
        ]
        sections.extend(
            [
                _table_section(
                    "현재 Flow 정의",
                    flows,
                    description="선택 시나리오의 사용 중인 모든 M04001 Flow를 보고서 생성 시점 CURRENT_DESIGN으로 제공합니다. 과거 Run의 실행 시점 정의로 해석하지 않습니다.",
                ),
                _table_section(
                    "현재 Flow 노드",
                    nodes,
                    columns=["FLOW_ID", "FLOW_NAME", "NODE_KEY", "NODE_NAME", "NODE_TYPE", "NODE_DESC", "USE_YN", "REF_MENU_CODE", "OWNER_NAME", "TABLE_NAME", "SORT_ORDER"],
                ),
                _table_section(
                    "현재 Flow 노드 연결",
                    edges,
                    columns=["FLOW_ID", "FLOW_NAME", "FROM_NODE_KEY", "FROM_PORT", "TO_NODE_KEY", "TO_PORT", "EDGE_MODE", "DASHED_YN", "SORT_ORDER"],
                ),
            ]
        )
        if flow_run_id and snapshot_nodes:
            sections.extend(
                [
                    _table_section("실행 당시 계획 기준", [plan_snapshot.get("metadata") or {}]),
                    _table_section("실행 당시 노드 스냅샷", snapshot_nodes),
                    _table_section("실행 당시 연결 스냅샷", snapshot_edges),
                ]
            )
        elif flow_run_id:
            sections.append(
                _text_section(
                    "실행 계획 스냅샷 없음",
                    [
                        "선택한 Run에 재현 가능한 PLAN_JSON 노드 스냅샷이 없어 현재 Flow 설계로 대체하지 않습니다.",
                        "노드별 실행 상태와 시각은 저장된 Run 이력 기준으로 별도 제공합니다.",
                    ],
                )
            )
        sections.extend(
            [
                _table_section(
                    "선택 Run 노드 실행 이력",
                    node_runs,
                    columns=["RUN_LEVEL", "NODE_KEY", "NODE_NAME", "NODE_TYPE", "STATUS", "STARTED_AT", "FINISHED_AT"],
                ),
                _table_section(
                    "공개 가능한 실행 파라미터",
                    safe_parameters,
                    columns=["PARAMETER", "VALUE"],
                    note="명시된 분석 파라미터를 중복 제거 후 최대 200개까지 제공합니다. 비밀번호, 인증값, 토큰, API 키, 지갑, 연결 문자열과 실행 SQL은 제외됩니다.",
                ),
            ]
        )
    elif report_code == "R03":
        runs = context.get("flowRuns") or []
        sessions = context.get("editSessions") or []
        flow_run_count = _as_int(counts.get("FLOW_RUN_COUNT"))
        success_runs = _as_int(counts.get("SUCCESS_FLOW_RUN_COUNT"))
        kpis = [
            _kpi("FLOW_RUN_COUNT", "전체 Flow Run", flow_run_count),
            _kpi(
                "FLOW_SUCCESS_RATE",
                "Flow 성공률",
                _ratio(success_runs, flow_run_count),
                unit="RATE",
                numerator=success_runs,
                denominator=flow_run_count,
            ),
            _kpi("EDIT_SESSION_COUNT", "전체 에디팅 세션", _as_int(counts.get("EDIT_SESSION_COUNT"))),
            _kpi("ACTIVE_SESSION_COUNT", "최근 50개 중 진행 세션", sum(1 for row in sessions if str(row.get("SESSION_STATUS") or "") not in {"APPLIED", "CANCELLED"})),
        ]
        sections.extend(
            [
                _table_section("최근 Flow Run 50개", runs),
                _table_section("최근 에디팅 세션 50개", sessions),
            ]
        )
    elif report_code == "R04":
        tables = _query(conn, "M06001_TARGET_TABLE_LIST", common)
        edit_ready = sum(1 for row in tables if row.get("EDIT_OWNER_NAME") and row.get("EDIT_TABLE_NAME"))
        kpis = [
            _kpi("TARGET_TABLE_COUNT", "대상 테이블", len(tables)),
            _kpi("EDIT_READY_COUNT", "편집 매핑 준비", edit_ready),
            _kpi(
                "EDIT_READY_RATE",
                "편집 매핑 준비율",
                _ratio(edit_ready, len(tables)),
                unit="RATE",
                numerator=edit_ready,
                denominator=len(tables),
            ),
        ]
        sections.append(_table_section("대상 데이터 목록", tables))
    elif report_code == "R05":
        summary = _query(conn, "M06001_COLUMN_TYPE_SUMMARY", {"flowRunId": flow_run_id}) if flow_run_id else []
        detail = _query(conn, "M06001_COLUMN_TYPE_DETAIL", {"flowRunId": flow_run_id}) if flow_run_id else []
        categorical = sum(_as_int(row.get("COLUMN_COUNT")) for row in summary if row.get("TYPE_GROUP_CODE") == "CATEGORICAL")
        continuous = sum(_as_int(row.get("COLUMN_COUNT")) for row in summary if row.get("TYPE_GROUP_CODE") == "CONTINUOUS")
        column_count = _as_int(counts.get("COLUMN_TYPE_COUNT"))
        null_ratio_sum = sum(
            _as_float(row.get("AVG_NULL_RATIO")) * _as_int(row.get("COLUMN_COUNT"))
            for row in summary
        )
        kpis = [
            _kpi("COLUMN_COUNT", "분석 컬럼", column_count),
            _kpi("CATEGORICAL_COUNT", "범주형", categorical),
            _kpi("CONTINUOUS_COUNT", "연속형", continuous),
            _kpi("AVG_NULL_RATIO", "평균 NULL 비율", _ratio(null_ratio_sum, column_count), unit="RATE"),
        ]
        sections.extend(
            [
                _table_section("유형 분포", summary),
                _table_section(
                    "컬럼 유형 상세 표본",
                    detail,
                    note=f"전체 {column_count:,}개 컬럼 중 상위 300개까지 표시합니다.",
                ),
            ]
        )
    elif report_code == "R06":
        rows = _query(conn, "M06001_RELATION_SUMMARY", {"flowRunId": flow_run_id}) if flow_run_id else []
        aggregate = _first(_query(conn, "M06001_RELATION_AGGREGATE", {"flowRunId": flow_run_id})) if flow_run_id else {}
        aggregate = aggregate or {}
        relation_count = _as_int(aggregate.get("RELATION_COLUMN_COUNT"))
        selected = _as_int(aggregate.get("SELECTED_COLUMN_COUNT"))
        pair_count = _as_int(aggregate.get("PAIR_COUNT"))
        pass_pair_count = _as_int(aggregate.get("PASS_PAIR_COUNT"))
        kpis = [
            _kpi("RELATION_COLUMN_COUNT", "관계 분석 컬럼", relation_count),
            _kpi("SELECTED_COLUMN_COUNT", "선정 컬럼", selected),
            _kpi(
                "PASS_PAIR_RATE",
                "관계 기준 통과율",
                _ratio(pass_pair_count, pair_count),
                unit="RATE",
                numerator=pass_pair_count,
                denominator=pair_count,
            ),
        ]
        sections.append(
            _table_section(
                "관계·상관 요약 표본",
                rows,
                note=f"전체 {relation_count:,}개 컬럼 중 상위 300개까지 표시합니다.",
            )
        )
    elif report_code == "R07":
        clusters = _query(conn, "M06001_NETWORK_CLUSTER_SUMMARY", {"flowRunId": flow_run_id}) if flow_run_id else []
        nodes = _query(conn, "M06001_NETWORK_NODE_DETAIL", {"flowRunId": flow_run_id}) if flow_run_id else []
        kpis = [
            _kpi("CLUSTER_COUNT", "군집 수", len(clusters)),
            _kpi("NETWORK_NODE_COUNT", "네트워크 노드", _as_int(counts.get("NETWORK_NODE_COUNT"))),
            _kpi("MAX_CENTRALITY", "최대 중심성", max((_as_float(row.get("CENTRALITY_SCORE")) for row in nodes), default=0), unit="SCORE"),
        ]
        sections.extend(
            [
                _table_section("군집 요약", clusters),
                _table_section(
                    "핵심 네트워크 노드 표본",
                    nodes,
                    note=f"전체 {_as_int(counts.get('NETWORK_NODE_COUNT')):,}개 노드 중 중심성 상위 300개까지 표시합니다.",
                ),
            ]
        )
    elif report_code == "R08":
        rows = _query(conn, "M06001_ASSOC_RULE_SUMMARY", {"flowRunId": flow_run_id}) if flow_run_id else []
        aggregate = _first(_query(conn, "M06001_ASSOC_RULE_AGGREGATE", {"flowRunId": flow_run_id})) if flow_run_id else {}
        aggregate = aggregate or {}
        rule_count = _as_int(aggregate.get("ASSOCIATION_RULE_COUNT"))
        kpis = [
            _kpi("ASSOCIATION_RULE_COUNT", "연관규칙", rule_count),
            _kpi("AVG_CONFIDENCE", "평균 Confidence", aggregate.get("AVG_RULE_CONFIDENCE"), unit="RATE"),
            _kpi("AVG_LIFT", "평균 Lift", aggregate.get("AVG_RULE_LIFT"), unit="SCORE"),
        ]
        sections.append(
            _table_section(
                "범주형 연관규칙 표본",
                rows,
                note=f"전체 {rule_count:,}개 규칙 중 Confidence 상위 300개까지 표시합니다. Support와 Confidence는 0~1 비율로 정규화하며 원본 값도 함께 제공합니다.",
            )
        )
    elif report_code == "R09":
        rows = _query(conn, "M06001_LASSO_FEATURE_SUMMARY", {"flowRunId": flow_run_id}) if flow_run_id else []
        aggregate = _first(_query(conn, "M06001_LASSO_FEATURE_AGGREGATE", {"flowRunId": flow_run_id})) if flow_run_id else {}
        aggregate = aggregate or {}
        feature_count = _as_int(aggregate.get("LASSO_FEATURE_COUNT"))
        kpis = [
            _kpi("LASSO_FEATURE_COUNT", "후보 중요변수", feature_count),
            _kpi("SELECTED_FEATURE_COUNT", "선정 중요변수", _as_int(aggregate.get("SELECTED_FEATURE_COUNT"))),
            _kpi("TARGET_COUNT", "연속형 대상", _as_int(aggregate.get("TARGET_COUNT"))),
        ]
        sections.append(
            _table_section(
                "LASSO 중요변수 표본",
                rows,
                note=f"전체 {feature_count:,}개 후보 중 상위 300개까지 표시합니다.",
            )
        )
    elif report_code == "R10":
        rows = _query(conn, "M06001_SYMBOLIC_RULE_SUMMARY", {"flowRunId": flow_run_id}) if flow_run_id else []
        aggregate = _first(_query(conn, "M06001_SYMBOLIC_RULE_AGGREGATE", {"flowRunId": flow_run_id})) if flow_run_id else {}
        aggregate = aggregate or {}
        symbolic_count = _as_int(aggregate.get("SYMBOLIC_RULE_COUNT"))
        kpis = [
            _kpi("SYMBOLIC_RULE_COUNT", "수식 규칙", symbolic_count),
            _kpi("SELECTED_RULE_COUNT", "선정 수식", _as_int(aggregate.get("SELECTED_RULE_COUNT"))),
            _kpi("TARGET_COUNT", "예측 대상", _as_int(aggregate.get("TARGET_COUNT"))),
        ]
        sections.append(
            _table_section(
                "Symbolic 수식 규칙 표본",
                rows,
                note=f"전체 {symbolic_count:,}개 규칙 중 상위 300개까지 표시합니다.",
            )
        )
    elif report_code == "R11":
        rows = _query(conn, "M06001_VIOLATION_SUMMARY", {"flowRunId": flow_run_id}) if flow_run_id else []
        total = sum(_as_int(row.get("VIOLATION_COUNT")) for row in rows)
        assoc = sum(_as_int(row.get("VIOLATION_COUNT")) for row in rows if row.get("VIOLATION_TYPE") == "ASSOCIATION")
        symbolic = total - assoc
        kpis = [
            _kpi("VIOLATION_COUNT", "전체 위반", total),
            _kpi("ASSOCIATION_VIOLATION_COUNT", "범주형 위반", assoc),
            _kpi("SYMBOLIC_VIOLATION_COUNT", "연속형 위반", symbolic),
        ]
        sections.append(_table_section("규칙 위반 집계", rows))
    elif report_code == "R12":
        source_params = {
            "ruleGroup": "ALL",
            "runSourceType": "FLOW_WORK",
            "runId": flow_run_id,
            "targetOwner": None,
            "targetTable": None,
            "keyword": None,
            "projectId": project_id,
            "scenarioId": scenario_id,
        }
        summary: list[dict[str, Any]] = []
        detail: list[dict[str, Any]] = []
        if flow_run_id:
            summary = _query(
                conn,
                "M06001_DISCOVERED_RULE_DECISION_SUMMARY",
                {
                    "projectId": project_id,
                    "scenarioId": scenario_id,
                    "flowRunId": flow_run_id,
                },
            )
            detail = _query(
                conn,
                "MCOMMON_EDIT_RULE_SOURCE_PAGE",
                {
                    **source_params,
                    "decisionStatus": "ALL",
                    "offset": 0,
                    "limit": 300,
                    "resolvedScenarioId": scenario_id,
                },
            )
            for row in detail:
                source_type = str(row.get("SOURCE_RULE_TYPE") or "").upper()
                row["ASSOCIATION_SUPPORT_RATE"] = (
                    _normalized_rate(row.get("RULE_SUPPORT")) if source_type == "ASSOCIATION" else None
                )
                row["ASSOCIATION_CONFIDENCE_RATE"] = (
                    _normalized_rate(row.get("RULE_CONFIDENCE")) if source_type == "ASSOCIATION" else None
                )
                row["SYMBOLIC_SCORE"] = row.get("RULE_CONFIDENCE") if source_type == "SYMBOLIC" else None
        total = sum(_as_int(row.get("RULE_COUNT")) for row in summary)
        selected = sum(
            _as_int(row.get("RULE_COUNT"))
            for row in summary
            if row.get("DECISION_STATUS") == "SELECTED"
        )
        rejected = sum(
            _as_int(row.get("RULE_COUNT"))
            for row in summary
            if row.get("DECISION_STATUS") == "REJECTED"
        )
        pending = sum(
            _as_int(row.get("RULE_COUNT"))
            for row in summary
            if row.get("DECISION_STATUS") == "PENDING"
        )
        kpis = [
            _kpi("TOTAL_RULE_COUNT", "판단 대상 규칙", total),
            _kpi("PENDING_RULE_COUNT", "판단 대기 규칙", pending),
            _kpi("SELECTED_RULE_COUNT", "선정 규칙", selected),
            _kpi("REJECTED_RULE_COUNT", "제외 규칙", rejected),
            _kpi(
                "SELECTION_RATE",
                "규칙 선정률",
                _ratio(selected, total),
                unit="RATE",
                numerator=selected,
                denominator=total,
            ),
        ]
        sections.extend(
            [
                _table_section("판단 상태 요약", summary),
                _table_section(
                    "발굴 규칙 판단 상세",
                    detail,
                    columns=[
                        "SOURCE_RULE_TYPE",
                        "SOURCE_RULE_ID",
                        "TARGET_OWNER",
                        "TARGET_TABLE",
                        "TARGET_COLUMN",
                        "ASSOCIATION_SUPPORT_RATE",
                        "ASSOCIATION_CONFIDENCE_RATE",
                        "SYMBOLIC_SCORE",
                        "RULE_LIFT",
                        "CONDITION_COUNT",
                        "MODEL_TYPE",
                        "RULE_SOURCE",
                        "DECISION_STATUS",
                        "RULE_STATUS",
                        "DECISION_NOTE",
                        "CREATE_DT",
                    ],
                    note=f"전체 {total:,}건 중 비교 가능한 상위 300건만 상세에 표시합니다. 연관규칙 비율과 Symbolic 점수는 서로 다른 척도로 분리합니다.",
                ),
            ]
        )
    elif report_code == "R13":
        summary = _query(conn, "M06001_RULE_DECISION_SUMMARY", common)
        detail = _query(conn, "M06001_RULE_MASTER_DETAIL", common)
        final_summary = [
            row
            for row in summary
            if row.get("DECISION_STATUS") == "SELECTED" and row.get("RULE_STATUS") == "ACTIVE"
        ]
        final_count = sum(_as_int(row.get("RULE_COUNT")) for row in final_summary)
        user_rules = sum(
            _as_int(row.get("RULE_COUNT"))
            for row in final_summary
            if row.get("USER_RULE_YN") == "Y"
        )
        final_rows = [row for row in detail if row.get("DECISION_STATUS") == "SELECTED" and row.get("RULE_STATUS") == "ACTIVE"]
        kpis = [
            _kpi("FINAL_RULE_COUNT", "최종 활성 규칙", final_count),
            _kpi("USER_RULE_COUNT", "사용자 규칙", user_rules),
            _kpi("DISCOVERED_RULE_COUNT", "발굴 출처 규칙", final_count - user_rules),
        ]
        sections.append(
            _table_section(
                "최종 규칙 마스터",
                final_rows,
                note=f"전체 {final_count:,}건 중 최근 300건까지 상세에 표시합니다.",
            )
        )
    elif report_code == "R14":
        tables = _query(conn, "M06001_TARGET_TABLE_LIST", common)
        sessions = context.get("editSessions") or []
        source_rows = sum(_as_int(row.get("SOURCE_ROW_COUNT")) for row in sessions)
        kpis = [
            _kpi("EDIT_TABLE_COUNT", "편집 매핑 테이블", sum(1 for row in tables if row.get("EDIT_TABLE_NAME"))),
            _kpi("EDIT_SESSION_COUNT", "전체 에디팅 세션", _as_int(counts.get("EDIT_SESSION_COUNT"))),
            _kpi("SOURCE_ROW_COUNT", "최근 50개 세션 원본 행 합계", source_rows),
        ]
        sections.extend(
            [
                _table_section("원본·편집 테이블", tables),
                _table_section(
                    "최근 에디팅 세션 50개",
                    sessions,
                    note=f"전체 {_as_int(counts.get('EDIT_SESSION_COUNT')):,}개 중 최근 50개까지 표시합니다.",
                ),
            ]
        )
    elif report_code in {"R15", "R16"}:
        summary = _query(conn, "M06001_CHANGE_SUMMARY", common)
        detail = _query(conn, "M06001_CHANGE_DETAIL", common)
        total = sum(_as_int(row.get("CHANGE_COUNT")) for row in summary)
        applied = sum(_as_int(row.get("CHANGE_COUNT")) for row in summary if row.get("CHANGE_STATUS") == "APPLIED")
        expected_match = sum(_as_int(row.get("EXPECTED_MATCH_COUNT")) for row in summary if row.get("CHANGE_STATUS") == "APPLIED")
        kpis = [
            _kpi("CHANGE_COUNT", "전체 수정", total),
            _kpi("APPLIED_CHANGE_COUNT", "적용 수정", applied),
            _kpi(
                "EXPECTED_MATCH_RATE",
                "기대값 일치율",
                _ratio(expected_match, applied),
                unit="RATE",
                numerator=expected_match,
                denominator=applied,
            ),
        ]
        if report_code == "R15":
            sections.extend(
                [
                    _table_section("컬럼별 오류 수정 성과", summary),
                    _table_section(
                        "최근 수정 결과",
                        detail,
                        note="민감한 수정 전후 값과 행 식별자는 제외하고 값 변경 여부와 기대값 일치 여부만 제공합니다.",
                    ),
                ]
            )
        else:
            sections.append(
                _table_section(
                    "수정 결과·일치 여부 이력",
                    detail,
                    note="민감한 수정 전후 값과 행 식별자는 제외하며 최근 300건까지 표시합니다.",
                )
            )
    elif report_code == "R17":
        rows = _query(conn, "M06001_VALIDATION_SUMMARY", common)
        session_summary = rows[0] if rows else {}
        snapshot_row = _first(
            _query(
                conn,
                "M06001_VALIDATION_SNAPSHOT",
                {
                    "projectId": project_id,
                    "scenarioId": scenario_id,
                    "editSessionId": edit_session_id,
                },
            )
        ) if edit_session_id else None
        snapshot = _safe_validation_snapshot(snapshot_row)
        applied = _as_int(session_summary.get("APPLIED_CHANGE_COUNT"))
        changed_rows = _as_int(session_summary.get("CHANGED_ROW_COUNT"))
        expected_match = _as_int(session_summary.get("EXPECTED_MATCH_COUNT"))
        if snapshot:
            overall = snapshot.get("OVERALL") or {}
            scopes = snapshot.get("SCOPES") or []
            statistics = snapshot.get("DESCRIPTIVE_STATISTICS")
            statistics_rows = _statistics_stage_rows(statistics)
            variance_rows = _statistics_variance_rows(statistics)
            top_value_rows = _statistics_top_value_rows(statistics)

            def optional_scope_sum(key: str) -> int | None:
                values = [row.get(key) for row in scopes if row.get(key) is not None]
                return sum(_as_int(value) for value in values) if values else None

            source_violations = optional_scope_sum("SOURCE_VIOLATION_COUNT")
            edit_violations = optional_scope_sum("EDIT_VIOLATION_COUNT")
            reduction = (
                source_violations - edit_violations
                if source_violations is not None and edit_violations is not None
                else None
            )
            snapshot_applied = _as_int(overall.get("APPLIED_CHANGE_COUNT"))
            snapshot_expected = _as_int(overall.get("EXPECTED_MATCH_COUNT"))
            kpis = [
                _kpi("SOURCE_VIOLATION_COUNT", "원본 동일 규칙 위반", source_violations),
                _kpi("EDIT_VIOLATION_COUNT", "편집본 동일 규칙 위반", edit_violations),
                _kpi("VIOLATION_REDUCTION_COUNT", "위반 감소", reduction),
                _kpi(
                    "VIOLATION_REDUCTION_RATE",
                    "위반 감소율",
                    _ratio(reduction, source_violations) if reduction is not None else None,
                    unit="RATE",
                    numerator=reduction,
                    denominator=source_violations,
                ),
                _kpi(
                    "EXPECTED_MATCH_RATE",
                    "기대값 일치율",
                    _ratio(snapshot_expected, snapshot_applied),
                    unit="RATE",
                    numerator=snapshot_expected,
                    denominator=snapshot_applied,
                ),
            ]
            sections.extend(
                [
                    _table_section("검증 세션 집계", [session_summary]),
                    _table_section("저장된 전체 효과 검증", [overall]),
                    _table_section("규칙 유형별 효과 검증", scopes),
                    _table_section("연결 재분석 상태", [snapshot.get("REANALYSIS") or {}]),
                    _text_section(
                        "재현 기준",
                        [
                            f"효과 검증 완료 시 저장된 스냅샷({snapshot.get('VALIDATION_SNAPSHOT_AT') or '-'})을 그대로 사용했습니다.",
                            "개별 행 샘플, 수정 전후 값, 규칙식과 알 수 없는 스냅샷 필드는 기본형 보고서에서 제외됩니다.",
                        ],
                    ),
                ]
            )
            if statistics_rows:
                sections.extend(
                    [
                        _table_section(
                            "변경 전/후 기초통계량",
                            statistics_rows,
                            columns=[
                                "DATA_STAGE",
                                "COLUMN_NAME",
                                "COLUMN_DESC",
                                "DATA_TYPE",
                                "PROFILE_KIND",
                                "TOTAL_ROW_COUNT",
                                "VALUE_COUNT",
                                "NULL_COUNT",
                                "DISTINCT_COUNT",
                                "DISTINCT_RATE",
                                "MODE_VALUE",
                                "MODE_COUNT",
                                "MIN_LENGTH",
                                "AVG_LENGTH",
                                "MAX_LENGTH",
                                "MIN_VALUE_TEXT",
                                "MAX_VALUE_TEXT",
                                "SUM_VALUE",
                                "MEAN_VALUE",
                                "VARIANCE_VALUE",
                                "STDDEV_VALUE",
                                "SKEWNESS_VALUE",
                                "KURTOSIS_VALUE",
                                "MEDIAN_VALUE",
                                "MIN_VALUE",
                                "Q1_VALUE",
                                "Q3_VALUE",
                                "MAX_VALUE",
                            ],
                            note=(
                                "컬럼유형 분석 결과를 물리 데이터타입보다 우선합니다. 연속형은 수치 통계, "
                                "범주·문자형은 고유값·최빈값·길이, 일시형은 최초·최종 시점을 제공합니다."
                            ),
                        ),
                        _table_section(
                            "범주·문자형 상위 값 분포",
                            top_value_rows,
                            columns=[
                                "COLUMN_NAME",
                                "COLUMN_DESC",
                                "PROFILE_KIND",
                                "VALUE_RANK",
                                "VALUE",
                                "BEFORE_COUNT",
                                "AFTER_COUNT",
                            ],
                            note="컬럼별 상위 10개 값을 원본과 수정본 빈도로 비교합니다.",
                        ),
                        _table_section(
                            "분산 변화 비교",
                            variance_rows,
                            columns=[
                                "COLUMN_NAME",
                                "COLUMN_DESC",
                                "BEFORE_VARIANCE",
                                "AFTER_VARIANCE",
                                "VARIANCE_DELTA",
                                "VARIANCE_REDUCTION_RATE",
                                "VARIANCE_DIRECTION",
                            ],
                            note="분산 감소율은 (변경 전 분산 - 변경 후 분산) / 변경 전 분산으로 산정합니다.",
                        ),
                    ]
                )
            else:
                sections.append(
                    _text_section(
                        "기초통계량 스냅샷 없음",
                        [
                            "이 효과 검증 이력에는 변경 전·후 기초통계량이 저장되지 않아 현재 테이블로 과거 분포를 재산정하지 않습니다.",
                            "다음 효과 검증부터 검증 시점의 기초통계량과 분산 변화가 함께 저장됩니다.",
                        ],
                    )
                )
        else:
            kpis = [
                _kpi("APPLIED_CHANGE_COUNT", "적용 수정", applied),
                _kpi("CHANGED_ROW_COUNT", "수정 행", changed_rows),
                _kpi(
                    "EXPECTED_MATCH_RATE",
                    "기대값 일치율",
                    _ratio(expected_match, applied),
                    unit="RATE",
                    numerator=expected_match,
                    denominator=applied,
                ),
                _kpi("SOURCE_VIOLATION_COUNT", "원본 동일 규칙 위반", None),
                _kpi("EDIT_VIOLATION_COUNT", "편집본 동일 규칙 위반", None),
            ]
            sections.extend(
                [
                    _table_section("검증 세션 집계", rows),
                    _text_section(
                        "효과 검증 데이터 한계",
                        [
                            "저장된 EFFECT_VALIDATED 스냅샷이 없어 동일 규칙 기준의 과거 효과를 확정할 수 없습니다.",
                            "현재 Run 전체 위반 건수로 과거 효과를 재산정하면 다른 테이블과 규칙이 섞일 수 있으므로 기본형 보고서에서는 재산정하지 않습니다.",
                        ],
                    ),
                ]
            )
    elif report_code == "R18":
        rows = _query(conn, "M06001_DML_SUMMARY", common)
        executed = [row for row in rows if row.get("DML_STATUS") == "EXECUTED"]
        affected = sum(_as_int(row.get("AFFECTED_ROW_COUNT")) for row in executed)
        kpis = [
            _kpi("DML_COUNT", "DML 버전", len(rows)),
            _kpi("EXECUTED_DML_COUNT", "실행 완료", len(executed)),
            _kpi("AFFECTED_ROW_COUNT", "운영 영향 행", affected),
        ]
        sections.append(
            _table_section(
                "운영 반영 DML 현황",
                rows,
                note="보안을 위해 DML SQL 원문은 기본형 보고서에 포함하지 않습니다.",
            )
        )
    elif report_code == "R19":
        audit_common = {**common, "editSessionId": None}
        rows = _query(conn, "M06001_AUDIT_EVENT_LIST", audit_common)
        aggregate = _first(_query(conn, "M06001_AUDIT_EVENT_AGGREGATE", audit_common)) or {}
        audit_count = _as_int(aggregate.get("AUDIT_EVENT_COUNT"))
        kpis = [
            _kpi("AUDIT_EVENT_COUNT", "감사 이벤트", audit_count),
            _kpi("EVENT_TYPE_COUNT", "이벤트 유형", _as_int(aggregate.get("EVENT_TYPE_COUNT"))),
            _kpi("EVENT_USER_COUNT", "작업자 수", _as_int(aggregate.get("EVENT_USER_COUNT"))),
        ]
        sections.append(
            _table_section(
                "최근 감사 이력 300개",
                rows,
                note=f"선택 시나리오 전체 {audit_count:,}건 중 최근 300건까지 표시합니다. 행 식별자나 민감값이 포함될 수 있는 이벤트 원문 요약·상세 JSON과 DML 원문은 제외합니다.",
            )
        )
    elif report_code == "R20":
        rows = _query(conn, "M06001_SCENARIO_SCORECARD", {"projectId": project_id})
        for row in rows:
            row["RULE_SELECTION_RATE"] = _ratio(row.get("FINAL_RULE_COUNT"), row.get("TOTAL_RULE_COUNT"))
            row["CHANGE_APPLY_RATE"] = _ratio(row.get("APPLIED_CHANGE_COUNT"), row.get("CHANGE_COUNT"))
        matched_contexts = sum(1 for row in rows if row.get("CONTEXT_MATCH_YN") == "Y")
        kpis = [
            _kpi("SCENARIO_COUNT", "비교 시나리오", len(rows)),
            _kpi("MATCHED_CONTEXT_COUNT", "동일 Run 기준 세션", matched_contexts),
            _kpi("TOTAL_RULE_COUNT", "전체 규칙", sum(_as_int(row.get("TOTAL_RULE_COUNT")) for row in rows)),
            _kpi("FINAL_RULE_COUNT", "최종 규칙", sum(_as_int(row.get("FINAL_RULE_COUNT")) for row in rows)),
            _kpi("APPLIED_CHANGE_COUNT", "적용 수정", sum(_as_int(row.get("APPLIED_CHANGE_COUNT")) for row in rows)),
        ]
        sections.append(
            _table_section(
                "시나리오 비교 스코어카드",
                rows,
                columns=[
                    "SCENARIO_CODE",
                    "SCENARIO_NAME",
                    "TARGET_TABLE_COUNT",
                    "LATEST_SUCCESS_FLOW_RUN_ID",
                    "LATEST_SUCCESS_FLOW_RUN_AT",
                    "TOTAL_RULE_COUNT",
                    "FINAL_RULE_COUNT",
                    "RULE_SELECTION_RATE",
                    "LATEST_EDIT_SESSION_ID",
                    "LATEST_EDIT_SESSION_STATUS",
                    "LATEST_EDIT_SESSION_AT",
                    "SESSION_BASELINE_FLOW_RUN_ID",
                    "CONTEXT_MATCH_YN",
                    "INSPECTED_ROW_COUNT",
                    "CHANGE_COUNT",
                    "APPLIED_CHANGE_COUNT",
                    "CHANGE_APPLY_RATE",
                    "EXECUTED_DML_COUNT",
                ],
                note="재실행 누적량이 비교를 왜곡하지 않도록 시나리오별 최신 성공 Flow Run과 최신 에디팅 세션 1건만 사용합니다. Run·세션 기준 일치가 N이면 서로 다른 회차이므로 규칙 선정률과 수정 적용률을 독립 지표로 비교하십시오.",
            )
        )
    elif report_code == "R21":
        statistics, statistics_basis, fallback_reason = _load_descriptive_statistics_report_data(conn, context)
        if not statistics:
            kpis = [
                _kpi("STATISTICS_COLUMN_COUNT", "통계 분석 컬럼", 0),
                _kpi("HIGH_PRIORITY_COLUMN_COUNT", "우선 확인 컬럼", 0),
                _kpi("TOTAL_VIOLATION_COUNT", "전체 규칙 위반", 0),
            ]
            sections.append(
                _text_section(
                    "기초통계량 보고서 생성 안내",
                    [
                        fallback_reason or "선택한 기준에서 기초통계량을 계산할 수 없습니다.",
                        "시나리오에 INITUP$ 원본 테이블이 있으면 단독 프로파일을 제공하고, INITDN$ 수정 테이블도 있으면 자동으로 비교합니다. 별도의 수정 작업 이력은 필요하지 않습니다.",
                    ],
                )
            )
        else:
            priority_rows = _statistics_priority_rows(statistics)
            stage_rows = _statistics_stage_rows(statistics)
            variance_rows = _statistics_variance_rows(statistics)
            distribution_rows = _statistics_distribution_rows(statistics)
            distribution_bin_rows = _statistics_distribution_bin_rows(statistics)
            top_value_rows = _statistics_top_value_rows(statistics)
            high_priority_count = sum(row.get("PRIORITY_LEVEL") == "HIGH" for row in priority_rows)
            medium_priority_count = sum(row.get("PRIORITY_LEVEL") == "MEDIUM" for row in priority_rows)
            violation_column_count = sum(_as_int(row.get("VIOLATION_COUNT")) > 0 for row in priority_rows)
            total_violation_count = sum(_as_int(row.get("VIOLATION_COUNT")) for row in priority_rows)
            decreased_variance_count = sum(
                row.get("VARIANCE_DIRECTION") == "DECREASED"
                for row in variance_rows
            )
            increased_variance_count = sum(
                row.get("VARIANCE_DIRECTION") == "INCREASED"
                for row in variance_rows
            )
            before_source = statistics.get("BEFORE_SOURCE") or {}
            after_source = statistics.get("AFTER_SOURCE") or {}
            summary_row = {
                "STATISTICS_BASIS": statistics_basis,
                "SOURCE_TABLE": f"{before_source.get('OWNER')}.{before_source.get('TABLE')}",
                "EDIT_TABLE": (
                    f"{after_source.get('OWNER')}.{after_source.get('TABLE')}"
                    if after_source
                    else "비교 대상 없음"
                ),
                "STATISTICS_COLUMN_COUNT": len(statistics.get("COLUMNS") or []),
                "HIGH_PRIORITY_COLUMN_COUNT": high_priority_count,
                "MEDIUM_PRIORITY_COLUMN_COUNT": medium_priority_count,
                "VIOLATION_COLUMN_COUNT": violation_column_count,
                "TOTAL_VIOLATION_COUNT": total_violation_count,
                "DECREASED_VARIANCE_COLUMN_COUNT": decreased_variance_count,
                "INCREASED_VARIANCE_COLUMN_COUNT": increased_variance_count,
            }
            kpis = [
                _kpi("STATISTICS_COLUMN_COUNT", "통계 분석 컬럼", summary_row["STATISTICS_COLUMN_COUNT"]),
                _kpi("HIGH_PRIORITY_COLUMN_COUNT", "우선 확인 컬럼", high_priority_count),
                _kpi("VIOLATION_COLUMN_COUNT", "위반 발생 컬럼", violation_column_count),
                _kpi("TOTAL_VIOLATION_COUNT", "전체 규칙 위반", total_violation_count),
                _kpi("DECREASED_VARIANCE_COLUMN_COUNT", "분산 감소 컬럼", decreased_variance_count),
                _kpi("INCREASED_VARIANCE_COLUMN_COUNT", "분산 증가 컬럼", increased_variance_count),
            ]
            sections.extend(
                [
                    _table_section("기초통계량 분석 요약", [summary_row]),
                    _table_section(
                        "중요 컬럼 우선순위",
                        priority_rows,
                        columns=[
                            "IMPORTANCE_RANK",
                            "COLUMN_NAME",
                            "COLUMN_DESC",
                            "DATA_TYPE",
                            "PRIORITY_LEVEL",
                            "IMPORTANCE_SCORE",
                            "PRIORITY_REASONS",
                            "VIOLATION_COUNT",
                            "VIOLATED_ROW_COUNT",
                            "RULE_COUNT",
                            "CATEGORICAL_VIOLATION_COUNT",
                            "CONTINUOUS_VIOLATION_COUNT",
                            "MISSING_RATE",
                            "VARIANCE_CHANGE_RATE",
                            "MEAN_SHIFT_STD",
                            "RANGE_SHIFT_RATE",
                            "HAS_STATISTICS",
                        ],
                        note="규칙 위반, 결측률, 분산·평균·범위 변화를 함께 점수화해 분석자가 먼저 확인할 컬럼 순서로 정렬합니다.",
                    ),
                    _table_section(
                        "평균·분산·분포 범위 변화",
                        distribution_rows,
                        columns=[
                            "COLUMN_NAME",
                            "COLUMN_DESC",
                            "BEFORE_MEAN",
                            "AFTER_MEAN",
                            "MEAN_DELTA",
                            "BEFORE_VARIANCE",
                            "AFTER_VARIANCE",
                            "VARIANCE_REDUCTION_RATE",
                            "BEFORE_STDDEV",
                            "AFTER_STDDEV",
                            "BEFORE_MIN",
                            "AFTER_MIN",
                            "BEFORE_MAX",
                            "AFTER_MAX",
                        ],
                        note="INITDN$가 있으면 원본·수정 값을 한 행에서 비교하고, 없으면 동일한 표 구조에서 수정 값만 비워 원본 프로파일을 제공합니다.",
                    ),
                    _table_section(
                        "컬럼별 동일 구간 분포 비교",
                        distribution_bin_rows,
                        columns=[
                            "COLUMN_NAME",
                            "COLUMN_DESC",
                            "BIN_NO",
                            "RANGE_FROM",
                            "RANGE_TO",
                            "BEFORE_COUNT",
                            "AFTER_COUNT",
                        ],
                        note="모든 컬럼을 클릭 없이 펼쳐 출력합니다. 각 컬럼은 원본과 수정 데이터의 공통 최소·최대 범위를 12개 동일 구간으로 나누므로 PDF와 XLSX에서도 같은 축으로 비교할 수 있습니다.",
                    ),
                    _table_section(
                        "범주·문자형 상위 값 분포",
                        top_value_rows,
                        columns=[
                            "COLUMN_NAME",
                            "COLUMN_DESC",
                            "PROFILE_KIND",
                            "VALUE_RANK",
                            "VALUE",
                            "BEFORE_COUNT",
                            "AFTER_COUNT",
                        ],
                        note="범주·문자·일시형 컬럼의 상위 10개 값을 클릭 없이 모두 펼쳐 원본과 수정 빈도로 비교합니다.",
                    ),
                    _table_section(
                        "컬럼별 상세 기초통계량",
                        stage_rows,
                        columns=[
                            "DATA_STAGE",
                            "COLUMN_NAME",
                            "COLUMN_DESC",
                            "DATA_TYPE",
                            "PROFILE_KIND",
                            "TOTAL_ROW_COUNT",
                            "VALUE_COUNT",
                            "NULL_COUNT",
                            "DISTINCT_COUNT",
                            "DISTINCT_RATE",
                            "MODE_VALUE",
                            "MODE_COUNT",
                            "MIN_LENGTH",
                            "AVG_LENGTH",
                            "MAX_LENGTH",
                            "MIN_VALUE_TEXT",
                            "MAX_VALUE_TEXT",
                            "SUM_VALUE",
                            "MEAN_VALUE",
                            "VARIANCE_VALUE",
                            "STDDEV_VALUE",
                            "SKEWNESS_VALUE",
                            "KURTOSIS_VALUE",
                            "MEDIAN_VALUE",
                            "MIN_VALUE",
                            "Q1_VALUE",
                            "Q3_VALUE",
                            "MAX_VALUE",
                        ],
                        note="컬럼유형 분석 결과를 우선해 연속형은 수치 8개 지표와 5수치 요약을, 범주·문자형은 고유값·최빈값·길이를, 일시형은 최초·최종 시점을 변경 전·후로 제공합니다.",
                    ),
                ]
            )
    else:
        raise HTTPException(status_code=404, detail="Unknown report code.")
    return sections, kpis


def build_report_document(
    request: Request,
    *,
    report_code: str,
    project_id: int,
    scenario_id: int | None = None,
    flow_run_id: int | None = None,
    edit_session_id: int | None = None,
    language: str = "ko",
) -> dict[str, Any]:
    report_code = str(report_code or "").strip().upper()
    definition = REPORT_BY_CODE.get(report_code)
    if not definition:
        raise HTTPException(status_code=404, detail="Unknown report code.")
    conn = get_target_db_connection(request)
    try:
        context = _resolve_context(
            conn,
            request,
            project_id=project_id,
            scenario_id=scenario_id,
            flow_run_id=flow_run_id,
            edit_session_id=edit_session_id,
        )
        counts = _load_counts(conn, context)
        normalized_language = normalize_report_language(language)
        catalog_item = next(item for item in _catalog_with_availability(context, counts, normalized_language) if item["code"] == report_code)
        sections, kpis = _build_sections_and_kpis(conn, report_code, context, counts)
        document = _assemble_report_document(
            definition=definition,
            context=context,
            catalog_item=catalog_item,
            sections=sections,
            kpis=kpis,
            generated_at=_generated_at(),
        )
        return localize_report_document(document, normalized_language)
    finally:
        conn.close()


def _assemble_report_document(
    *,
    definition: dict[str, Any],
    context: dict[str, Any],
    catalog_item: dict[str, Any],
    sections: list[dict[str, Any]],
    kpis: list[dict[str, Any]],
    generated_at: str,
) -> dict[str, Any]:
    report_code = definition["code"]
    return {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "provider": REPORT_PROVIDER,
        "report": {
            "code": report_code,
            "title": definition["title"],
            "description": definition["description"],
            "group": definition["group"],
            "definitionVersion": REPORT_DEFINITION_VERSION,
        },
        "context": _report_context_payload(context, generated_at),
        "availability": {
            "status": catalog_item["availability"],
            "reason": catalog_item["availabilityReason"],
            "dataCount": catalog_item["dataCount"],
        },
        "kpis": kpis,
        "sections": sections,
        "definitions": _report_definitions(report_code),
        "downloads": ["html", "xlsx", "pdf"],
    }


def _failed_report_document(
    *,
    definition: dict[str, Any],
    context: dict[str, Any],
    generated_at: str,
) -> dict[str, Any]:
    safe_reason = "이 보고서 내용을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."
    return _assemble_report_document(
        definition=definition,
        context=context,
        catalog_item={
            "availability": "ERROR",
            "availabilityReason": safe_reason,
            "dataCount": 0,
        },
        sections=[
            _text_section(
                "보고서 생성 안내",
                [safe_reason],
                note="다른 보고서는 정상적으로 생성되었으며 이 항목만 다시 확인할 수 있습니다.",
            )
        ],
        kpis=[],
        generated_at=generated_at,
    )


def build_batch_report_document(
    request: Request,
    *,
    project_id: int,
    scenario_id: int | None = None,
    flow_run_id: int | None = None,
    edit_session_id: int | None = None,
    language: str = "ko",
) -> dict[str, Any]:
    """Build the fixed twenty-one-report bundle from one authorized context."""
    conn = get_target_db_connection(request)
    try:
        context = _resolve_context(
            conn,
            request,
            project_id=project_id,
            scenario_id=scenario_id,
            flow_run_id=flow_run_id,
            edit_session_id=edit_session_id,
        )
        counts = _load_counts(conn, context)
        normalized_language = normalize_report_language(language)
        catalog = _catalog_with_availability(context, counts, normalized_language)
        catalog_by_code = {item["code"]: item for item in catalog}
        generated_at = _generated_at()
        reports: list[dict[str, Any]] = []
        cache_token = _BATCH_QUERY_CACHE.set({})
        try:
            for definition in REPORT_CATALOG:
                report_code = definition["code"]
                try:
                    sections, kpis = _build_sections_and_kpis(conn, report_code, context, counts)
                    reports.append(
                        _assemble_report_document(
                            definition=definition,
                            context=context,
                            catalog_item=catalog_by_code[report_code],
                            sections=sections,
                            kpis=kpis,
                            generated_at=generated_at,
                        )
                    )
                except HTTPException as error:
                    if error.status_code < 500:
                        raise
                    logger.error(
                        "M06001 batch report item failed. report=%s error_type=%s",
                        report_code,
                        type(error).__name__,
                    )
                    reports.append(
                        _failed_report_document(
                            definition=definition,
                            context=context,
                            generated_at=generated_at,
                        )
                    )
                except Exception as error:
                    logger.error(
                        "M06001 batch report item failed. report=%s error_type=%s",
                        report_code,
                        type(error).__name__,
                    )
                    reports.append(
                        _failed_report_document(
                            definition=definition,
                            context=context,
                            generated_at=generated_at,
                        )
                    )
        finally:
            _BATCH_QUERY_CACHE.reset(cache_token)

        status_counts = Counter(
            str((report.get("availability") or {}).get("status") or "NO_DATA").upper()
            for report in reports
        )
        error_count = status_counts.get("ERROR", 0)
        generation_status = "COMPLETE"
        if error_count == len(reports):
            generation_status = "ERROR"
        elif error_count:
            generation_status = "PARTIAL"
        document = {
            "schemaVersion": REPORT_SCHEMA_VERSION,
            "provider": REPORT_PROVIDER,
            "bundle": {
                "code": "ALL",
                "title": "기본형 보고서 통합본",
                "description": "선택한 동일 기준으로 생성한 고정 21종 기본형 보고서를 한 번에 제공합니다.",
                "definitionVersion": REPORT_DEFINITION_VERSION,
                "generatedAt": generated_at,
                "reportCount": len(reports),
            },
            "context": _report_context_payload(context, generated_at),
            "summary": {
                "generationStatus": generation_status,
                "totalCount": len(reports),
                "availableCount": status_counts.get("AVAILABLE", 0),
                "partialCount": status_counts.get("PARTIAL", 0),
                "noDataCount": status_counts.get("NO_DATA", 0),
                "notApplicableCount": status_counts.get("NOT_APPLICABLE", 0),
                "errorCount": error_count,
            },
            "reports": reports,
            "downloads": ["html", "xlsx", "pdf"],
        }
        return localize_report_document(document, normalized_language)
    finally:
        conn.close()


def json_compatible(value: Any) -> Any:
    value = _normalize_value(value)
    if isinstance(value, dict):
        return {str(key): json_compatible(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_compatible(item) for item in value]
    if isinstance(value, Decimal):
        return format(value, "f") if value.is_finite() else str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value
