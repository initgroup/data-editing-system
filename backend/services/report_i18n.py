from __future__ import annotations

from copy import deepcopy
from typing import Any


SUPPORTED_REPORT_LANGUAGES = frozenset({"en", "ko"})

AVAILABILITY_LABELS = {
    "ko": {"AVAILABLE": "제공 가능", "PARTIAL": "일부 제공", "NO_DATA": "데이터 없음", "NOT_APPLICABLE": "해당 없음", "ERROR": "생성 오류"},
    "en": {"AVAILABLE": "Available", "PARTIAL": "Partial", "NO_DATA": "No data", "NOT_APPLICABLE": "Not applicable", "ERROR": "Generation error"},
}

REPORT_CATALOG_EN: dict[str, tuple[str, str]] = {
    "R01": ("Project and scenario summary", "Summarizes rule discovery, editing, and production application for the selected project and scenario."),
    "R02": ("Rule discovery design and execution basis", "Documents the M04001 flow, node connections, safe execution parameters, and run basis."),
    "R03": ("Work and execution status", "Shows Flow Run and editing-session status, processing stages, and recent execution activity."),
    "R04": ("Editing target data status", "Shows source and editing target tables registered for the scenario and their data mappings."),
    "R05": ("Column type analysis", "Summarizes rule-based and model-based column types and quality indicators for the selected Flow Run."),
    "R06": ("Relationship and correlation analysis", "Compares relationship strength, threshold results, and key relationship candidates."),
    "R07": ("Relationship network and clusters", "Shows relationship-network cluster sizes and highly central columns."),
    "R08": ("Categorical association rules", "Reports Support, Confidence, and Lift for categorical IF/THEN rules on a consistent scale."),
    "R09": ("LASSO important features", "Summarizes important features, coefficients, selection status, and explanatory power by continuous target."),
    "R10": ("Symbolic formula rules", "Shows f(x)=y formula rules, variables, scores, and complexity."),
    "R11": ("Rule violation status", "Aggregates categorical and continuous rule violations by type, table, and target column."),
    "R12": ("Discovered-rule decisions", "Summarizes selected, rejected, and pending discovered rules and their quality indicators."),
    "R13": ("Final rule master", "Shows the scope of final discovered rules and user-defined rules."),
    "R14": ("Editing work and table status", "Shows source/edit table mappings and preparation and progress by editing session."),
    "R15": ("Error correction results", "Calculates correction counts, application status, and expected-value match rate consistently."),
    "R16": ("Correction and match history", "Tracks corrected columns, change and expected-match status, rule, user, and time without exposing sensitive values."),
    "R17": ("Before-and-after editing validation", "Compares violation changes, applied corrections, and validation status between baseline and reanalysis runs."),
    "R18": ("Production application and DML status", "Shows approval and execution status and affected rows for production DML."),
    "R19": ("Complete audit history", "Shows major audit events from rule decisions through production application in time order."),
    "R20": ("Project and scenario comparison scorecard", "Compares rule-selection and correction-application rates using the latest successful run and editing session per scenario."),
}

SECTION_TITLES_EN = {
    "보고서 개요": "Report overview",
    "핵심 현황": "Key status",
    "현재 Flow 정의": "Current Flow definitions",
    "현재 Flow 노드": "Current Flow nodes",
    "현재 Flow 노드 연결": "Current Flow node connections",
    "선택 Run 노드 실행 이력": "Selected-run node execution history",
    "공개 가능한 실행 파라미터": "Safe execution parameters",
    "실행 당시 계획 기준": "Execution-time plan basis",
    "실행 당시 노드 스냅샷": "Execution-time node snapshot",
    "실행 당시 연결 스냅샷": "Execution-time connection snapshot",
    "실행 계획 스냅샷 없음": "Execution plan snapshot unavailable",
    "최근 Flow Run 50개": "Latest 50 Flow Runs",
    "최근 에디팅 세션 50개": "Latest 50 editing sessions",
    "대상 데이터 목록": "Target data list",
    "유형 분포": "Type distribution",
    "컬럼 유형 상세 표본": "Column type detail sample",
    "관계·상관 요약 표본": "Relationship and correlation sample",
    "군집 요약": "Cluster summary",
    "핵심 네트워크 노드 표본": "Key network node sample",
    "범주형 연관규칙 표본": "Categorical association-rule sample",
    "LASSO 중요변수 표본": "LASSO important-feature sample",
    "Symbolic 수식 규칙 표본": "Symbolic formula-rule sample",
    "규칙 위반 집계": "Rule violation summary",
    "판단 상태 요약": "Decision status summary",
    "발굴 규칙 판단 상세": "Discovered-rule decision details",
    "최종 규칙 마스터": "Final rule master",
    "원본·편집 테이블": "Source and editing tables",
    "수정 결과·일치 여부 이력": "Correction and match history",
    "컬럼별 오류 수정 성과": "Correction results by column",
    "최근 수정 결과": "Recent correction results",
    "운영 반영 DML 현황": "Production DML status",
    "검증 세션 집계": "Validation session summary",
    "저장된 전체 효과 검증": "Saved overall effect validation",
    "규칙 유형별 효과 검증": "Effect validation by rule type",
    "연결 재분석 상태": "Linked reanalysis status",
    "재현 기준": "Reproduction basis",
    "효과 검증 데이터 한계": "Effect-validation data limitations",
    "최근 감사 이력 300개": "Latest 300 audit events",
    "시나리오 비교 스코어카드": "Scenario comparison scorecard",
    "보고서 생성 안내": "Report generation notice",
}

TEXT_EN = {
    "본 보고서는 IN-DEPS 시스템에서 제공합니다.": "This report is provided by the IN-DEPS system.",
    "기본형 보고서 통합본": "All Basic Reports",
    "선택한 동일 기준으로 생성한 고정 20종 기본형 보고서를 한 번에 제공합니다.": "Provides all 20 fixed Basic Reports generated from the same selected basis.",
    "아직 실행·에디팅 이력이 없습니다.": "No execution or editing history is available yet.",
    "설계된 M04001 Flow가 없습니다.": "No M04001 Flow has been designed.",
    "실행 이력이 없어 Flow 설계 기준만 제공합니다.": "Only the Flow design basis is available because there is no execution history.",
    "실행 또는 에디팅 작업 이력이 없습니다.": "No execution or editing-work history is available.",
    "에디팅 세션이 없어 대상 테이블 매핑만 제공합니다.": "Only target-table mappings are available because there is no editing session.",
    "대상 테이블 매핑과 에디팅 세션이 없습니다.": "No target-table mapping or editing session is available.",
    "규칙 판단 기준 Flow Run을 선택해야 합니다.": "Select a Flow Run as the rule-decision basis.",
    "선택한 Run에 발굴 규칙이 없습니다.": "The selected run has no discovered rules.",
    "효과 검증 기준 에디팅 세션을 선택해야 합니다.": "Select an editing session as the effect-validation basis.",
    "저장된 효과 검증 스냅샷이 없어 과거 효과 지표를 재산정하지 않습니다.": "Historical effect indicators are not recalculated because no saved validation snapshot exists.",
    "선택한 세션의 효과 검증이 완료되지 않았습니다.": "Effect validation for the selected session is not complete.",
    "분석 기준 Flow Run을 선택해야 합니다.": "Select a Flow Run as the analysis basis.",
    "에디팅 세션을 선택해야 합니다.": "Select an editing session.",
    "선택한 기준에 생성된 데이터가 없습니다.": "No data was generated for the selected basis.",
    "이 보고서 내용을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.": "This report could not be generated. Please try again later.",
    "다른 보고서는 정상적으로 생성되었으며 이 항목만 다시 확인할 수 있습니다.": "Other reports were generated successfully; retry this report separately.",
    "기준 시각": "Basis time",
    "데이터 없음": "No data",
    "해당 없음": "Not applicable",
    "Symbolic 점수": "Symbolic score",
    "비율 지표": "Rate indicator",
    "보고서를 생성한 시각이며 실행·세션 식별자와 함께 결과 기준을 고정합니다.": "The report generation time; together with run and session identifiers it fixes the result basis.",
    "보고서 유형은 유지되지만 선택 기준에서 해당 결과가 생성되지 않은 상태입니다.": "The report type remains fixed, but no result was generated for the selected basis.",
    "필요한 Flow Run 또는 에디팅 세션이 선택되지 않아 산정할 수 없는 상태입니다.": "The value cannot be calculated because a required Flow Run or editing session is not selected.",
    "연관규칙 패턴이 전체 데이터에서 함께 관찰된 비율이며 0~1로 정규화합니다.": "The share of all data in which the association pattern is observed, normalized to 0–1.",
    "연관규칙 조건이 참일 때 결과도 참인 비율이며 0~1로 정규화합니다.": "The probability that the result is true when the association condition is true, normalized to 0–1.",
    "결과의 기본 발생률 대비 규칙의 결합 강도입니다.": "Association strength relative to the result's baseline occurrence rate.",
    "Symbolic 모델이 저장한 품질 점수이며 연관규칙 Confidence와 다른 척도로 구분합니다.": "A quality score stored by the Symbolic model, kept separate from association-rule Confidence.",
    "서로 다른 데이터 규모를 비교할 수 있도록 분자와 분모를 함께 제공합니다.": "Provides numerator and denominator so different data volumes can be compared.",
}

REPORT_UI_TEXT = {
    "ko": {
        "project": "프로젝트", "scenario": "시나리오", "allScenarios": "전체 시나리오",
        "editingSessionId": "에디팅 세션 ID", "definitionVersion": "보고서 정의 버전",
        "generatedAt": "생성 시각", "status": "상태", "definitions": "산정 기준 및 용어",
        "noData": "표시할 데이터가 없습니다.", "numerator": "분자", "denominator": "분모",
        "toc": "보고서 목차", "tocSheet": "목차", "backToToc": "목차로 돌아가기", "generationStatus": "생성 상태",
        "basicReport": "IN-DEPS 기본형 보고서", "basicReportBundle": "IN-DEPS 기본형 보고서 통합본",
        "summary": "요약", "detail": "상세", "metadata": "메타정보", "calculationBasis": "산정 기준",
        "reportCode": "보고서 코드", "providerStatement": "제공 문구", "providerSystem": "제공 시스템",
        "schemaVersion": "스키마 버전", "availabilityStatus": "가용 상태", "availabilityReason": "가용 사유",
        "item": "항목", "value": "값", "unit": "단위", "term": "용어", "definition": "정의",
        "notice": "안내", "description": "설명", "dataCount": "데이터 건수", "sheet": "시트",
        "order": "순서", "code": "코드", "report": "보고서", "group": "그룹",
        "total": "전체", "available": "제공 가능", "partial": "일부 제공",
        "notApplicable": "해당 없음", "error": "생성 오류", "noKpi": "KPI 없음",
        "noContent": "표시할 내용이 없습니다.", "flowRunId": "Flow Run ID",
    },
    "en": {
        "project": "Project", "scenario": "Scenario", "allScenarios": "All scenarios",
        "editingSessionId": "Editing session ID", "definitionVersion": "Report definition version",
        "generatedAt": "Generated at", "status": "Status", "definitions": "Calculation basis and terms",
        "noData": "No data to display.", "numerator": "Numerator", "denominator": "Denominator",
        "toc": "Table of contents", "tocSheet": "Contents", "backToToc": "Back to table of contents", "generationStatus": "Generation status",
        "basicReport": "IN-DEPS Basic Report", "basicReportBundle": "All IN-DEPS Basic Reports",
        "summary": "Summary", "detail": "Details", "metadata": "Metadata", "calculationBasis": "Calculation basis",
        "reportCode": "Report code", "providerStatement": "Provider statement", "providerSystem": "Provider system",
        "schemaVersion": "Schema version", "availabilityStatus": "Availability status", "availabilityReason": "Availability reason",
        "item": "Item", "value": "Value", "unit": "Unit", "term": "Term", "definition": "Definition",
        "notice": "Notice", "description": "Description", "dataCount": "Data count", "sheet": "Sheet",
        "order": "Order", "code": "Code", "report": "Report", "group": "Group",
        "total": "Total", "available": "Available", "partial": "Partial",
        "notApplicable": "Not applicable", "error": "Generation error", "noKpi": "No KPI",
        "noContent": "No content to display.", "flowRunId": "Flow Run ID",
    },
}


def normalize_report_language(value: str | None) -> str:
    return "en" if str(value or "").strip().lower().replace("_", "-") in {"en", "en-us"} else "ko"


def _english_label(key: str) -> str:
    words = str(key or "").replace("_", " ").lower().split()
    acronyms = {"id": "ID", "dml": "DML", "sql": "SQL", "api": "API", "kpi": "KPI", "yn": "Y/N", "null": "NULL", "lasso": "LASSO"}
    return " ".join(acronyms.get(word, word.capitalize()) for word in words)


def _contains_korean(value: Any) -> bool:
    return isinstance(value, str) and any("가" <= character <= "힣" for character in value)


def localize_catalog_item(item: dict[str, Any], language: str) -> dict[str, Any]:
    result = deepcopy(item)
    if normalize_report_language(language) != "en":
        return result
    code = str(result.get("code") or result.get("reportCode") or "").upper()
    title_description = REPORT_CATALOG_EN.get(code)
    if title_description:
        result["title"], result["description"] = title_description
    reason = result.get("availabilityReason")
    if reason in TEXT_EN:
        result["availabilityReason"] = TEXT_EN[reason]
    return result


def localize_report_document(document: dict[str, Any], language: str) -> dict[str, Any]:
    result = deepcopy(document)
    normalized = normalize_report_language(language)
    result["language"] = normalized
    result["labels"] = deepcopy(REPORT_UI_TEXT[normalized])
    availability = result.get("availability")
    if isinstance(availability, dict):
        status = str(availability.get("status") or "NO_DATA").upper()
        availability["label"] = AVAILABILITY_LABELS[normalized].get(status, status)
    reports = result.get("reports")
    if isinstance(reports, list):
        result["reports"] = [
            localize_report_document(item, normalized) if isinstance(item, dict) else item
            for item in reports
        ]
    if normalized != "en":
        return result

    provider = result.get("provider") or {}
    if isinstance(provider, dict):
        provider["statement"] = TEXT_EN["본 보고서는 IN-DEPS 시스템에서 제공합니다."]

    bundle = result.get("bundle")
    if isinstance(bundle, dict):
        bundle["title"] = TEXT_EN.get(bundle.get("title"), bundle.get("title"))
        bundle["description"] = TEXT_EN.get(bundle.get("description"), bundle.get("description"))

    report = result.get("report")
    if isinstance(report, dict):
        translated = localize_catalog_item(report, "en")
        report.update(translated)

    if isinstance(availability, dict):
        availability["reason"] = TEXT_EN.get(availability.get("reason"), availability.get("reason"))

    for kpi in result.get("kpis") or []:
        if isinstance(kpi, dict):
            kpi["label"] = _english_label(str(kpi.get("code") or kpi.get("label") or "KPI"))

    for section in result.get("sections") or []:
        if not isinstance(section, dict):
            continue
        section["title"] = SECTION_TITLES_EN.get(section.get("title"), TEXT_EN.get(section.get("title"), section.get("title")))
        for key in ("description", "note"):
            value = TEXT_EN.get(section.get(key), section.get(key))
            if _contains_korean(value):
                value = (
                    "Additional information for interpreting this section."
                    if key == "note"
                    else "Detailed information for this section."
                )
            section[key] = value
        for column in section.get("columns") or []:
            if isinstance(column, dict):
                column["label"] = _english_label(str(column.get("key") or column.get("label") or "Value"))
        paragraphs = section.get("paragraphs")
        if isinstance(paragraphs, list):
            section["paragraphs"] = [
                TEXT_EN.get(value, value)
                if not _contains_korean(TEXT_EN.get(value, value))
                else "Detailed report information is provided for the selected basis."
                for value in paragraphs
            ]

    for definition in result.get("definitions") or []:
        if isinstance(definition, dict):
            definition["term"] = TEXT_EN.get(definition.get("term"), definition.get("term"))
            definition["definition"] = TEXT_EN.get(definition.get("definition"), definition.get("definition"))

    return result
