(function (root) {
    "use strict";
    const ko = {
        "Pause": "일시 멈춤",
        "Resume": "재개",
        "Restart": "재시작",
        "Stop": "중단",
        "Paused": "일시 멈춤",
        "Stopped": "중단",
        "Pause requested": "일시 멈춤 요청 중",
        "Stop requested": "중단 요청 중",
        "Stop requested. The current task will finish before the pipeline stops.": "중단 요청 중입니다. 현재 작업이 끝나면 다음 단계부터 실행하지 않습니다.",
        "Pause requested. The current task will finish before the pipeline pauses.": "일시 멈춤 요청 중입니다. 현재 작업이 끝나면 멈춥니다.",
        "Paused. Resume continues from the next unfinished stage.": "일시 멈춤 상태입니다. 재개하면 완료된 단계 다음부터 계속합니다.",
        "Stopped. Restart runs the saved FLOW from the beginning.": "중단되었습니다. 재시작하면 저장된 FLOW를 처음부터 새로 실행합니다.",

        "IF–THEN rules": "IF–THEN 규칙", "Anomaly candidate": "이상 후보",
        "Model agreement": "모델 일치율", "Holdout agreement": "검증 표본 일치율",
        "Sample support": "학습 표본 지지도", "Training matches": "학습 조건 해당 건수",
        "Holdout matches": "검증 조건 해당 건수", "Candidate rows": "검토 대상",
        "Candidate rule": "검토 후보 규칙", "View candidates": "검토 대상 보기",
        "Validation diagnostics": "모델 검증 지표", "Holdout fidelity": "검증 모델 충실도",
        "Holdout precision": "검증 정밀도", "Holdout recall": "검증 재현율",
        "Training rows": "학습 표본 수", "Holdout rows": "검증 표본 수",
        "Insufficient holdout support": "검증 표본 부족", "Holdout observed": "검증 표본 확인",
        "No candidate rules were discovered.": "발굴된 검토 후보 규칙이 없습니다.",
        "These rules explain Isolation Forest candidates. Agreement measures model consistency, not confirmed errors.": "Isolation Forest의 이상 후보를 설명하는 규칙입니다. 일치율은 모델 간 일치 수준이며 확정 오류율이 아닙니다.",
        "Counts are rule-row matches; one row may match several rules. Only a bounded preview is stored.": "건수는 규칙×행 기준이며 같은 행이 여러 규칙에 중복 집계될 수 있습니다. 상세 행은 제한된 미리보기만 저장됩니다.",
        "First-row sampling may reflect source ordering.": "선두 행 표본이므로 원본 정렬에 따른 편향을 검토하세요.",
        "Sample limits were applied.": "학습 표본 제한이 적용되었습니다.",
        "Total rules": "전체 규칙", "Mapped rules": "매핑 규칙", "Rules with candidates": "검토 대상이 있는 규칙",
        "IF–THEN rule detail": "IF–THEN 규칙 상세", "Result": "결과", "Condition": "조건",
        "Condition count": "조건 수", "Rule": "규칙", "Details": "상세", "Previous": "이전", "Next": "다음",
        "No saved candidate rows for this rule.": "이 규칙에 저장된 검토 대상 미리보기가 없습니다.",
        "Candidate preview": "검토 대상 미리보기", "Rule summary table": "규칙 상세 요약표",
        "Validation status": "검증 상태", "Export": "내보내기", "All": "전체",
        "Rules by condition count": "조건 개수별 규칙", "Rules by result column": "결과 컬럼별 규칙",
        "Result column": "결과 컬럼", "Condition columns": "조건 컬럼", "Search": "검색",
        "Conditions": "개 조건", "Rule distribution": "규칙 분포", "Top rules": "주요 발견 규칙",
        "Select a rule to inspect its conditions, result and matching rows.": "규칙을 선택하면 조건·결과와 해당 행을 확인할 수 있습니다.",
        "Rule ID": "규칙 ID", "Model anomaly rows": "모델 이상 후보 건수", "Confidence": "신뢰도", "Lift": "향상도",
        "Not evaluated": "미평가",
        "Row ID": "행 식별값", "Support": "지지도", "Rules": "규칙",
        "Matches the anomaly explanation rule; requires review.": "이상 후보 설명 규칙의 조건에 해당하여 검토가 필요합니다.",
        "Expected value": "기댓값", "Actual value": "실젯값", "Violation score": "위반 점수", "Violation reason": "위반 사유",
        "Not evaluated": "미평가",
        "Click a legend to filter rules": "범례를 눌러 규칙 필터",
        "Inspect the rules explaining anomaly candidates and their matching rows.": "이상 후보를 설명하는 규칙과 해당 조건의 검토 대상을 확인합니다.",
        "Top rules by group": "범례별 상위 규칙", "Selected": "선택",
        "Rule summary is unavailable. Reload after restarting the backend.": "규칙 요약을 불러올 수 없습니다. 백엔드 재시작 후 다시 조회하세요.",
        "Validation confidence": "검증 신뢰도", "Validation matches": "검증 조건 해당 건수", "Validation rows": "검증 표본 수",
        "Violation rows": "위반 건수", "Accepted pattern rules": "검증 통과 패턴 규칙", "Supporting rows": "규칙 지지 건수",
        "Validation supporting rows": "검증 규칙 지지 건수", "Validated": "검증 통과", "Validation failed": "검증 기준 미달",
        "Insufficient validation support": "검증 표본 부족", "NULL (missing)": "NULL(결측)",
        "Actual value does not satisfy the expected value or range.": "실제값이 규칙의 기대값 또는 허용 범위를 만족하지 않습니다.",
        "The result value is missing and does not satisfy the rule.": "결과값이 결측이므로 규칙의 기대값 또는 허용 범위를 만족하지 않습니다.",
        "These rules predict actual column values or ranges. Violations satisfy IF but do not satisfy THEN; they require review.": "실제 컬럼의 값 또는 범위를 예측하는 규칙입니다. IF 조건을 만족하지만 THEN 결과를 만족하지 않는 행을 위반으로 조회하며, 업무 의미 검토가 필요합니다.",
        "No patterns passed the support, confidence and validation criteria. No rules were forced.": "지지도·신뢰도·검증 기준을 통과한 패턴이 없습니다. 기준 미달 규칙은 생성하지 않았습니다.",
        "Validation metrics were used for rule selection; they are not independent final test metrics.": "검증 지표는 규칙 선정에 사용되었으며, 독립적인 최종 시험 성능이 아닙니다.",
        "Pattern rules": "패턴 규칙", "Rules with violations": "위반이 있는 규칙", "View violations": "위반 데이터 조회",
        "Pattern decision tree": "실제 값·구간 예측트리",
        "Condition matches": "조건 해당 건수", "Training confidence": "학습 신뢰도",
        "Violation preview": "위반 데이터 미리보기", "Violation data": "위반 데이터",
        "No saved violation rows for this rule.": "이 규칙에 저장된 위반 데이터가 없습니다.",
        "IF is satisfied but THEN is not satisfied.": "IF 조건을 만족하지만 THEN 결과를 만족하지 않는 데이터를 위반으로 확인합니다.",
        "Rules predict actual column values or ranges without a manual type-classification stage.": "수동 유형 확정 단계 없이 실제 컬럼의 값·범위 규칙을 발굴하고 규칙 위반을 찾습니다.",
        "Inspect expected values, confidence and rows that violate the IF–THEN patterns.": "실제 기대값·신뢰도와 IF–THEN 패턴을 위반하는 행을 확인합니다.",
        "Confidence, support and lift use the full target data after detection.": "탐지 후 신뢰도·지지도·향상도는 동일한 전체 대상 데이터 기준으로 계산합니다.",
        "Target-column limits were applied. Only the listed target columns were modeled.": "결과 컬럼 수 제한이 적용되었습니다. 표시된 결과 컬럼에 대해서만 규칙을 학습했습니다.",
        "Modeled target columns": "학습한 결과 컬럼", "Columns excluded by the feature limit": "입력 컬럼 수 제한으로 제외된 컬럼",
        "The rule limit was applied; additional patterns may exist.": "규칙 수 제한이 적용되었습니다. 표시되지 않은 추가 패턴이 있을 수 있습니다.",
        "Within-tolerance rate": "허용 오차 충족률", "Validation within-tolerance rate": "검증 허용 오차 충족률",
        "Validation R²": "검증 R²", "Validation MAE (target units)": "검증 평균 절대 오차(결과 단위)",
        "Validation RMSE (target units)": "검증 RMSE(결과 단위)", "Absolute tolerance (target units)": "절대 허용 오차(결과 단위)",
        "Relative tolerance": "상대 허용 오차", "Expected lower bound": "예상 하한", "Expected upper bound": "예상 상한",
        "Residual (actual - expected)": "잔차(실제값 - 예측값)", "Absolute error": "절대 오차", "Result kind": "결과 종류",
        "Confidence / within-tolerance rate": "신뢰도 / 허용 오차 충족률", "Validation confidence / within-tolerance rate": "검증 신뢰도 / 허용 오차 충족률",
        "The actual value is outside the formula prediction tolerance.": "실제값이 수식 예측값의 허용 오차를 벗어났습니다.",
        "Formula confidence is the fraction within tolerance, not association frequency. R² and MAE use rows with finite observations and predictions; missing results still violate the rule.": "수식의 신뢰도는 허용 오차를 만족하는 비율입니다. 연관규칙 빈도와 구분하며, 검증 R²·평균 절대 오차는 실제값과 예측값이 유효한 행에서 계산합니다. 결과 결측은 위반으로 집계합니다.",
        "Pattern rules and numeric formulas": "값 패턴·연속형 수식 규칙",
        "Basic statistics and missing values": "기초통계·결측 분석", "Relationships and related columns": "관계·관련 컬럼 분석",
        "This stage was not stored in this execution. Existing two-stage history is preserved; run a new four-stage FLOW to create it.": "이 실행에는 해당 단계의 저장 결과가 없습니다. 기존 2단계 이력은 유지되며, 새 4단계 FLOW를 실행하면 생성됩니다.",
        "Statistics and relationships describe the saved bounded sample, not the entire source or a causal relationship.": "기초통계와 관계는 저장된 제한 표본의 분석 결과입니다. 전체 원본의 통계나 인과관계로 해석하지 않습니다.",
        "Column": "컬럼", "Column description": "컬럼 설명", "Data type": "자료형", "Sample rows": "표본 행 수",
        "Nonmissing rows": "유효값 행 수", "Missing rows": "결측 행 수", "Missing rate": "결측률", "Distinct values": "고유값 수", "Distinct rate": "고유값 비율",
        "Minimum": "최솟값", "Maximum": "최댓값", "Mean": "평균", "Standard deviation": "표준편차", "First quartile": "제1사분위수",
        "Median": "중앙값", "Third quartile": "제3사분위수", "Zero values": "0값 건수", "Frequent values": "빈도 상위 값",
        "Column X": "컬럼 X", "Column Y": "컬럼 Y", "Paired rows": "쌍 유효 행 수", "Coverage": "적용 비율",
        "Pearson correlation": "피어슨 상관계수", "Matching rows": "일치 행 수", "Columns": "컬럼 수",
        "Numeric columns": "수치형 컬럼 수", "Text columns": "문자형 컬럼 수", "Duplicate sampled rows": "표본 중복 행 수",
        "Correlation pairs": "상관 컬럼 쌍", "Duplicate column pairs": "중복 컬럼 쌍", "Column statistics": "컬럼별 기초통계",
        "Numeric relationships": "수치형 컬럼 관계", "Duplicate columns": "중복 컬럼", "Columns with missing values": "결측이 있는 컬럼",
        "Profiled columns": "통계를 계산한 컬럼 수", "Skipped columns": "제한으로 제외된 컬럼 수", "Invalid numeric values": "유효하지 않은 수치 건수",
        "Relationship pair limits were applied.": "관계 컬럼 쌍 수 제한이 적용되었습니다.",
        "Rules predict actual column values, ranges and formulas after basic statistics and relationship analysis.": "기초통계·관계를 분석한 뒤 실제 컬럼의 값·범위·수식 규칙을 발굴하고 위반을 찾습니다.",
        "These rules predict actual column values, ranges or formulas. Violations satisfy IF but do not satisfy THEN; they require review.": "실제 컬럼의 값·범위·수식을 예측하는 규칙입니다. IF 조건을 만족하지만 THEN 결과를 만족하지 않는 행을 위반으로 조회하며, 업무 의미 검토가 필요합니다.",
        "Reported rule metrics use the same full target cohort after detection.": "탐지 후 규칙 지표는 동일한 전체 대상 데이터 기준으로 계산합니다.",
        "Numeric warnings": "수치 통계 안내", "Nonfinite values were excluded from numeric statistics.": "무한대 등 유효하지 않은 수치는 수치 통계에서 제외했습니다.",
        "Some statistics exceed the representable range and are unavailable.": "일부 통계량이 표현 가능한 범위를 벗어나 표시되지 않습니다.", "Validated patterns": "검증 기준을 통과한 규칙",
        "Value and range rules": "값·구간 IF–THEN 규칙", "Continuous formula rules": "연속형 수식 규칙",
        "Continuous formula rules were generated. They are separated from value and range rules.": "연속형 수식 규칙이 생성되었습니다. 값·구간 규칙과 구분하여 표시합니다.",
        "Continuous formula discovery was disabled for this execution.": "이 실행에서는 연속형 수식 발굴이 비활성화되어 있습니다.",
        "This historical execution has no saved continuous-discovery diagnostics. Run a new execution to evaluate formulas.": "이 과거 실행에는 연속형 수식 발굴 진단이 저장되어 있지 않습니다. 새 실행에서 수식 발굴 여부를 확인할 수 있습니다.",
        "No eligible continuous target columns were found in the saved sample.": "저장된 표본에서 연속형 수식 발굴 대상에 해당하는 컬럼을 찾지 못했습니다.",
        "No continuous formulas passed the saved validation criteria. No formulas were forced.": "저장된 검증 기준을 통과한 연속형 수식이 없습니다. 기준을 낮춰 수식을 강제로 만들지 않습니다.",
        "Eligible continuous targets": "연속형 대상 후보 컬럼", "Evaluated continuous targets": "수식 발굴 수행 컬럼",
        "Formula fit rows": "수식 학습 행", "Formula calibration rows": "허용 오차 보정 행", "Formula validation rows": "수식 검증 행",
        "Average confidence": "평균 신뢰도", "Average lift": "평균 향상도", "Average within-tolerance rate": "평균 허용 오차 충족률",
        "Average validation within-tolerance rate": "평균 검증 허용 오차 충족률", "Average validation R²": "평균 검증 R²",
        "Target columns": "대상 컬럼", "Continuous formula details": "연속형 수식 상세", "Numeric relationships and formulas": "수치 관계와 수식",
        "Formula validation and saved per-row predictions are shown below. A source-sample chart is not available for this stored result.": "아래에서 수식 검증 지표와 저장된 행별 예측값을 확인합니다. 이 저장 결과에는 전체 분석 표본 그래프가 없습니다.",
        "Rules by discovery method": "발굴 방법별 규칙", "Mixed numeric formula": "혼합형 수치 수식",
        "Numeric interpretation": "수치 해석 기준", "Numeric text": "숫자 문자열", "Inferred numeric-text columns": "숫자 문자열로 해석한 컬럼",
        "Strict numeric text was interpreted numerically; the physical database type is unchanged.": "엄격한 숫자 형식의 문자열을 수치로 해석했습니다. DB의 실제 자료형은 변경하지 않습니다.",
        "Continuous discovery reasons": "연속형 선정·탈락 사유", "Physical numeric columns": "DB 수치 자료형 컬럼", "Tested formula candidates": "평가한 수식 후보",
        "Identifier or excluded column": "식별자 또는 사용자 제외 컬럼", "Leading-zero code": "앞자리 0이 있는 코드", "Contains nonnumeric text": "숫자가 아닌 문자열 포함",
        "Too few numeric-text values": "숫자 문자열 표본 부족", "Unsupported physical type": "지원하지 않는 DB 자료형", "Outside the supported numeric range": "지원하는 수치 범위 초과",
        "Too few fit values": "학습 유효값 부족", "Constant numeric values": "수치 값이 일정함", "Identifier-like sequence": "식별자 형태의 연속 번호", "Low target cardinality": "결과값 종류가 너무 적음",
        "Insufficient target variation": "결과값 변화량 부족", "No correlated predictors": "상관된 입력 변수 없음", "Too few fit or calibration rows": "학습 또는 허용 오차 보정 행 부족",
        "No usable predictors": "유효 입력 컬럼 없음",
        "Formula fitting failed": "수식 추정 실패", "Invalid coefficients": "유효하지 않은 계수", "Constant prediction": "예측값이 일정함", "Nonfinite calibration residuals": "유효하지 않은 보정 잔차",
        "Tolerance too wide": "허용 오차가 너무 큼", "Too few validation rows": "검증 행 부족", "Training coverage below minimum": "학습 허용 오차 충족률 미달",
        "Validation coverage below minimum": "검증 허용 오차 충족률 미달", "Training fit below minimum": "학습 수식 적합도 미달", "Validation fit below minimum": "검증 수식 적합도 미달",
        "Continuous target limit": "연속형 대상 컬럼 수 제한", "Numeric-text inference was not recorded in this older execution.": "이 과거 실행에는 숫자 문자열 해석 진단이 기록되어 있지 않습니다.",
        "Source column limit": "원본 입력 컬럼 수 제한", "Reload": "다시 조회",
        "No data is available for this chart.": "그래프로 표시할 데이터가 없습니다.",
        "Physical numeric type": "DB 수치 자료형",
        "Discovery method": "발굴 방법", "Sum/difference relation": "합·차 관계", "Linear regression": "선형 회귀", "Ratio relation": "비율 관계",
        "Coefficient policy": "계수 선택", "Validated simple coefficients": "검증된 단순 계수", "Fitted coefficients": "추정 계수",
        "Validated formulas were found but excluded by the final rule-count limit.": "검증된 수식은 있었지만 최종 규칙 수 제한으로 저장 대상에서 제외되었습니다.",
        "Reason counts refer to excluded columns or rejected candidates, not source rows.": "사유별 건수는 제외 컬럼 또는 탈락 후보 수이며 원본 데이터 행 수가 아닙니다.",
    };
    function t(key) {
        let language = root.I18nManager?.getSessionLanguage?.();
        try { language ||= root.sessionStorage?.getItem("initLanguageCode"); } catch (_) { /* optional preference */ }
        return String(language || "ko").toLowerCase().startsWith("en") ? key : (ko[key] || key);
    }
    const isPattern = (row) => [row?.RULE_KIND, row?.RULE_SOURCE, row?.MODEL_TYPE, row?.algorithm, row?.summary?.algorithm, row?.overview?.RULE_SOURCE].includes("MIXED_PATTERN_TREE");
    const isXai = (row) => row?.RULE_KIND === "MIXED_XAI" && !isPattern(row);
    const isFormula = (row) => row?.RESULT_KIND === "FORMULA" || row?.RESULT_AST?.operator === "WITHIN_TOLERANCE";
    function formulaMethod(row, tr = t) {
        const code = row?.FORMULA_METHOD || row?.VALIDATION_DIAGNOSTICS?.discoveryMethod || row?.METHOD;
        return tr(({SUM_DIFFERENCE: "Sum/difference relation", ROBUST_LINEAR: "Linear regression", ROBUST_RATIO: "Ratio relation"})[code] || "Mixed numeric formula");
    }
    function patternSummary(summary = {}, family = "ALL") {
        const rows = (summary.rules || []).filter((r) => family === "ALL" || isFormula(r) === (family === "FORMULA"));
        const mean = (key) => {
            const values = rows.map((r) => r[key]).filter((v) => v != null && v !== "" && Number.isFinite(Number(v))).map(Number);
            return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        };
        const conditions = new Map(), results = new Map();
        rows.forEach((r) => {
            const count = Number(r.CONDITION_COUNT || 0);
            const bucket = conditions.get(count) || { CONDITION_COUNT: count, RULE_COUNT: 0, NON_PERFECT_CONF_RULES: 0 };
            bucket.RULE_COUNT += 1;
            if (r.RULE_CONFIDENCE != null && Number(r.RULE_CONFIDENCE) < 1) bucket.NON_PERFECT_CONF_RULES += 1;
            conditions.set(count, bucket);
            if (r.RESULT_COLUMN) results.set(r.RESULT_COLUMN, (results.get(r.RESULT_COLUMN) || 0) + 1);
        });
        return { ...summary, rules: rows, total: rows.length, page: 1, resultTopTotal: results.size,
            overview: { ...summary.overview, TOTAL_RULES: rows.length, MAPPED_RULES: rows.filter((r) => r.RESULT_HAS_VALUE_YN === "Y").length,
                NON_PERFECT_CONF_RULES: rows.filter((r) => r.RULE_CONFIDENCE != null && Number(r.RULE_CONFIDENCE) < 1).length,
                AVG_CONFIDENCE: mean("RULE_CONFIDENCE"), AVG_LIFT: mean("RULE_LIFT"), AVG_VALIDATION_CONFIDENCE: mean("VALIDATION_CONFIDENCE"),
                TARGET_COLUMN_COUNT: results.size, AVG_VALIDATION_R2: mean("VALIDATION_R2") },
            conditionDist: [...conditions.values()].sort((a, b) => a.CONDITION_COUNT - b.CONDITION_COUNT),
            resultTop: [...results].map(([RESULT_COLUMN, RULE_COUNT]) => ({ RESULT_COLUMN, RULE_COUNT })).sort((a, b) => b.RULE_COUNT - a.RULE_COUNT) };
    }
    function continuousSummary(payload = {}) {
        const summary = patternSummary(payload.ruleSummary, "FORMULA");
        const rules = summary.rules.map((r) => ({ ...r, TARGET_COLUMN: r.RESULT_COLUMN, EXPRESSION: r.RESULT_TEXT,
            METHOD: r.FORMULA_METHOD || r.VALIDATION_DIAGNOSTICS?.discoveryMethod || "MIXED_FORMULA", SELECTED_YN: "Y", VIOLATION_COUNT: r.VIOLATION_COUNT ?? r.MATCH_COUNT }));
        const methods = new Map();
        rules.forEach((r) => methods.set(r.METHOD, (methods.get(r.METHOD) || 0) + 1));
        return { ...summary, topRules: rules, overview: { ...summary.overview, RULE_COUNT: rules.length, SELECTED_RULE_COUNT: rules.length },
            targetGroups: summary.resultTop.map((r) => ({ TARGET_COLUMN: r.RESULT_COLUMN, RULE_COUNT: r.RULE_COUNT })),
            methodGroups: [...methods].map(([METHOD, RULE_COUNT]) => ({METHOD, RULE_COUNT})) };
    }
    function continuousDiagnostic(payload = {}, tr = t) {
        const summary = payload.summary || {}, diagnostic = summary.continuous;
        const count = (payload.ruleSummary?.rules || []).filter(isFormula).length;
        const reason = count ? "Continuous formula rules were generated. They are separated from value and range rules."
            : diagnostic?.enabled === false ? "Continuous formula discovery was disabled for this execution."
            : !diagnostic ? "This historical execution has no saved continuous-discovery diagnostics. Run a new execution to evaluate formulas."
            : Number(diagnostic.acceptedRuleCount ?? diagnostic.candidateRuleCount) > 0 ? "Validated formulas were found but excluded by the final rule-count limit."
            : diagnostic.eligibleTargetCount === 0 ? "No eligible continuous target columns were found in the saved sample."
            : "No continuous formulas passed the saved validation criteria. No formulas were forced.";
        const reasonLabels = { USER_OR_IDENTIFIER_EXCLUDED: "Identifier or excluded column", LEADING_ZERO_CODE: "Leading-zero code", NON_NUMERIC_TEXT: "Contains nonnumeric text",
            INSUFFICIENT_NUMERIC_TEXT: "Too few numeric-text values", UNSUPPORTED_PHYSICAL_TYPE: "Unsupported physical type", ORACLE_FORMULA_NUMERIC_RANGE: "Outside the supported numeric range",
            INSUFFICIENT_FIT_VALUES: "Too few fit values", CONSTANT_NUMERIC_VALUES: "Constant numeric values", IDENTIFIER_LIKE_SEQUENCE: "Identifier-like sequence", LOW_CARDINALITY_TARGET: "Low target cardinality",
            INSUFFICIENT_TARGET_VARIATION: "Insufficient target variation", NO_CORRELATED_PREDICTORS: "No correlated predictors", INSUFFICIENT_FIT_OR_CALIBRATION_ROWS: "Too few fit or calibration rows",
            NO_USABLE_PREDICTORS: "No usable predictors",
            FIT_FAILED: "Formula fitting failed", INVALID_COEFFICIENTS: "Invalid coefficients", CONSTANT_PREDICTION: "Constant prediction", NONFINITE_CALIBRATION_RESIDUALS: "Nonfinite calibration residuals",
            TOLERANCE_TOO_WIDE: "Tolerance too wide", INSUFFICIENT_VALIDATION_ROWS: "Too few validation rows", TRAIN_COVERAGE_BELOW_MINIMUM: "Training coverage below minimum",
            VALIDATION_COVERAGE_BELOW_MINIMUM: "Validation coverage below minimum", TRAIN_R2_BELOW_MINIMUM: "Training fit below minimum", VALIDATION_R2_BELOW_MINIMUM: "Validation fit below minimum" };
        const reasons = [...Object.entries(diagnostic?.eligibilityReasons || {}), ...Object.entries(diagnostic?.rejectionReasons || {})]
            .filter(([, n]) => Number(n) > 0).map(([code, count]) => ({ label: tr(reasonLabels[code] || code), count: number(count) }));
        if (diagnostic?.excludedTargets?.length) reasons.push({ label: tr("Continuous target limit"), count: number(diagnostic.excludedTargets.length) });
        if (summary.featureLimitExcludedColumns?.length) reasons.push({ label: tr("Source column limit"), count: number(summary.featureLimitExcludedColumns.length) });
        const metrics = diagnostic ? [
            ["Eligible continuous targets", diagnostic.eligibleTargetCount], ["Evaluated continuous targets", diagnostic.targetCount],
            ["Formula fit rows", diagnostic.fitRows], ["Formula calibration rows", diagnostic.calibrationRows],
            ["Formula validation rows", diagnostic.validationRows]
        ] : [];
        if (diagnostic?.diagnosticVersion) metrics.unshift(["Physical numeric columns", diagnostic.physicalNumericColumnCount],
            ["Inferred numeric-text columns", diagnostic.inferredNumericTextColumnCount], ["Tested formula candidates", diagnostic.testedCandidateCount]);
        return { count, reasons, message: tr(reason) + (diagnostic && !diagnostic.diagnosticVersion ? " " + tr("Numeric-text inference was not recorded in this older execution.") : ""),
            metrics: metrics.map(([key, value]) => ({ label: tr(key), value: number(value) })) };
    }
    const percent = (v) => v == null ? "-" : `${(Number(v) * 100).toFixed(1)}%`;
    const number = (v) => v == null ? "-" : Number(v).toLocaleString();
    function metrics(row, tr = t) {
        const policy = ({CANONICAL_SIMPLE: "Validated simple coefficients", FITTED: "Fitted coefficients"})[row.COEFFICIENT_POLICY || row.VALIDATION_DIAGNOSTICS?.coefficientPolicy];
        if (isFormula(row)) return [["Discovery method", formulaMethod(row, tr)],
            ...(policy ? [["Coefficient policy", tr(policy)]] : []),
            ["Within-tolerance rate", percent(row.RULE_CONFIDENCE)], ["Condition matches", number(row.CONDITION_TOTAL_COUNT)],
            ["Validation within-tolerance rate", percent(row.VALIDATION_CONFIDENCE)], ["Validation matches", number(row.VALIDATION_COUNT)],
            ["Validation R²", decimal(row.VALIDATION_R2)], ["Validation MAE (target units)", decimal(row.VALIDATION_MAE)],
            ["Validation RMSE (target units)", decimal(row.VALIDATION_RMSE)],
            ["Absolute tolerance (target units)", decimal(row.ABSOLUTE_TOLERANCE ?? row.RESULT_AST?.absoluteTolerance)],
            ["Relative tolerance", percent(row.RELATIVE_TOLERANCE ?? row.RESULT_AST?.relativeTolerance)],
            ["Violation rows", number(row.VIOLATION_COUNT)]].map(([key, value]) => ({ key, label: tr(key), value }));
        if (isPattern(row)) return [["Confidence", percent(row.RULE_CONFIDENCE)], ["Lift", row.RULE_LIFT == null ? "-" : Number(row.RULE_LIFT).toFixed(3)],
            ["Support", percent(row.RULE_SUPPORT)], ["Condition matches", number(row.CONDITION_TOTAL_COUNT)],
            ["Training confidence", percent(row.TRAIN_CONFIDENCE)],
            ["Validation confidence", percent(row.VALIDATION_CONFIDENCE)], ["Validation matches", number(row.VALIDATION_COUNT)],
            ["Violation rows", number(row.VIOLATION_COUNT)]].map(([key, value]) => ({ key, label: tr(key), value }));
        return [["Training matches", number(row.CONDITION_TOTAL_COUNT)],
            ["Sample support", percent(row.RULE_SUPPORT)], ["Model agreement", percent(row.MODEL_AGREEMENT)],
            ["Holdout matches", number(row.HOLDOUT_COUNT)], ["Holdout agreement", percent(row.HOLDOUT_AGREEMENT)],
            ["Candidate rows", number(row.MATCH_COUNT)]].map(([key, value]) => ({ key, label: tr(key), value }));
    }
    function filterSummary(summary = {}, filters = {}, page = 1) {
        summary ||= {};
        const enabled = (v) => v != null && v !== "" && v !== "ALL";
        const rows = (summary.rules || []).filter((row) =>
            (!enabled(filters.conditionCount) || Number(row.CONDITION_COUNT) === Number(filters.conditionCount)) &&
            (!enabled(filters.resultColumn) || row.RESULT_COLUMN === filters.resultColumn) &&
            (!enabled(filters.conditionColumn) || (row.CONDITION_COLUMNS || []).some((c) => c.toUpperCase().includes(String(filters.conditionColumn).toUpperCase()))) &&
            (!enabled(filters.resultHasValueYn) || row.RESULT_HAS_VALUE_YN === filters.resultHasValueYn) &&
            (filters.confidenceScope !== "NON_PERFECT" || (isXai(row) ? Number(row.MATCH_COUNT) > 0 : row.RULE_CONFIDENCE != null && Number(row.RULE_CONFIDENCE) < 1)));
        const pageSize = Math.max(1, Number(filters.pageSize) || 20);
        page = Math.max(1, Math.min(Number(page) || 1, Math.ceil(rows.length / pageSize) || 1));
        return { ...summary, total: rows.length, page, pageSize, rules: rows.slice((page - 1) * pageSize, page * pageSize) };
    }
    function candidateRows(payload = {}, ruleId = "") {
        const rules = new Map((payload.ruleSummary?.rules || []).map((r) => [String(r.RULE_ID), r]));
        return (payload.violations || []).filter((row) => !ruleId || String(row.RULE_ID) === String(ruleId)).map((row) => {
            let values = row.ROW_DATA_JSON || {};
            if (typeof values === "string") { try { values = JSON.parse(values); } catch (_) { values = {}; } }
            // Prefix feature keys so source columns cannot replace result identifiers.
            const rule = rules.get(String(row.RULE_ID)) || {};
            if (isPattern(payload) || isPattern(rule)) return { ...row,
                RESULT_KIND: row.RESULT_KIND ?? rule.RESULT_KIND,
                RESULT_COLUMN: row.RESULT_COLUMN ?? rule.RESULT_COLUMN,
                EXPECTED_VALUE: isFormula(rule) ? row.EXPECTED_VALUE ?? null : row.EXPECTED_VALUE ?? rule.RESULT_VALUE ?? rule.RESULT_TEXT,
                RULE_CONFIDENCE: row.RULE_CONFIDENCE ?? rule.RULE_CONFIDENCE,
                RULE_LIFT: row.RULE_LIFT ?? rule.RULE_LIFT,
                VIOLATION_REASON: violationReason(row.VIOLATION_REASON ?? row.REASON, row, t) };
            return { RULE_ID: row.RULE_ID, CASE_ID: row.CASE_ID, RESULT_COLUMN: "ANOMALY_CANDIDATE",
                EXPECTED_VALUE: null, ACTUAL_VALUE: null, RULE_CONFIDENCE: null, RULE_LIFT: null,
                VIOLATION_SCORE: row.ANOMALY_SCORE ?? null, MODEL_AGREEMENT: row.RULE_PURITY ?? rule.MODEL_AGREEMENT,
                VIOLATION_REASON: t("Matches the anomaly explanation rule; requires review."),
                ...Object.fromEntries(Object.entries(values).map(([key, value]) => [`SOURCE.${key}`, value])) };
        });
    }
    function violationSummary(payload = {}, filters = {}) {
        const summary = payload.ruleSummary || {};
        const pattern = isPattern(payload) || isPattern(summary);
        const scoped = filterSummary(summary, { conditionCount: filters.conditionCount,
            confidenceScope: filters.confidenceScope, pageSize: 1000 }).rules;
        const hit = scoped.filter((r) => Number(r.MATCH_COUNT) > 0);
        const selected = scoped.filter((r) => (!filters.ruleId || String(r.RULE_ID).includes(filters.ruleId)) &&
            (filters.resultScope === "MISS" ? !Number(r.MATCH_COUNT) : filters.resultScope === "MAX_RULES" ? false :
                filters.resultScope === "CANDIDATE" ? true : Number(r.MATCH_COUNT) > 0));
        const pageSize = Number(filters.pageSize) || 20;
        const page = Math.min(Math.max(1, Number(filters.page) || 1), Math.ceil(selected.length / pageSize) || 1);
        const matches = scoped.reduce((sum, r) => sum + Number(r.MATCH_COUNT || 0), 0);
        const columns = new Map();
        if (pattern) scoped.forEach((r) => columns.set(r.RESULT_COLUMN, (columns.get(r.RESULT_COLUMN) || 0) + Number(r.VIOLATION_COUNT || 0)));
        return { mixedXai: !pattern, mixedPattern: pattern, columnComments: summary.columnComments, ruleIdFilter: filters.ruleId || "",
            resultScope: filters.resultScope || "HIT", rulePage: page, rulePageSize: pageSize, ruleTotal: selected.length,
            ruleIds: selected.map((r) => String(r.RULE_ID)),
            candidateOverview: summary.overview, candidateConditionDist: summary.conditionDist,
            overview: { VIOLATION_COUNT: matches, VIOLATED_RULE_COUNT: hit.length,
                VIOLATED_ROW_COUNT: pattern && !filters.ruleId && (!filters.conditionCount || filters.conditionCount === "ALL") && (!filters.confidenceScope || filters.confidenceScope === "ALL")
                    ? payload.summary?.uniqueViolationCount ?? null : null },
            detectionOverview: { CANDIDATE_RULE_COUNT: scoped.length, DETECTION_ELIGIBLE_RULE_COUNT: scoped.length },
            topColumns: pattern ? [...columns].map(([RESULT_COLUMN, VIOLATION_COUNT]) => ({ RESULT_COLUMN, VIOLATION_COUNT })) : matches ? [{ RESULT_COLUMN: "ANOMALY_CANDIDATE", VIOLATION_COUNT: matches }] : [],
            topRules: selected.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r,
                EXPECTED_VALUE: pattern ? r.RESULT_VALUE ?? r.RESULT_TEXT : t("Anomaly candidate"), VIOLATION_COUNT: r.VIOLATION_COUNT ?? r.MATCH_COUNT,
                DETECTION_SCANNED_YN: r.MATCH_COUNT == null ? "N" : "Y" })),
            diagnostics: payload.summary };
    }
    function expressionSql(node, depth = 0) {
        if (!node || depth > 12) throw new Error("Invalid formula expression");
        if (Object.hasOwn(node, "column")) {
            if (!/^[A-Z][A-Z0-9_$#]{0,127}$/.test(node.column || "")) throw new Error("Invalid formula column");
            return node.numericText === true ? numericTextSql(`T."${node.column}"`) : `T."${node.column}"`;
        }
        if (Object.hasOwn(node, "value")) {
            if (typeof node.value !== "number" || !Number.isFinite(node.value)) throw new Error("Invalid formula constant");
            return String(node.value);
        }
        const operators = { ADD: "+", SUBTRACT: "-", MULTIPLY: "*", DIVIDE: "/" };
        if (!operators[node.operator]) throw new Error("Invalid formula operator");
        const left = expressionSql(node.left, depth + 1), right = expressionSql(node.right, depth + 1);
        return `(${left} ${operators[node.operator]} ${node.operator === "DIVIDE" ? `NULLIF(${right}, 0)` : right})`;
    }
    function numericTextSql(reference) {
        if (!/^T\."[A-Z][A-Z0-9_$#]{0,127}"$/.test(reference)) throw new Error("Invalid numeric text column");
        const text = `TRIM(${reference})`;
        const normalized = String.raw`REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(${text}, '^[+]', ''), '^(-?)[.]', '\10.'), '[.]([eE]|$)', '.0\1')`;
        const converted = `JSON_VALUE('[' || ${normalized} || ']', '$[0]' RETURNING NUMBER NULL ON ERROR)`;
        const digits = `LENGTH(REGEXP_REPLACE(REGEXP_SUBSTR(${text}, '^[^eE]+'), '[^0-9]', ''))`;
        const zero = `REGEXP_LIKE(${text}, '^[+-]?(0([.]0*)?|[.]0+)([eE][+-]?[0-9]+)?$', 'c')`;
        return `(CASE WHEN LENGTH(${text}) <= 128 AND ${digits} <= 38 AND NOT REGEXP_LIKE(${text}, '[^0-9eE+.-]', 'c') AND REGEXP_LIKE(${text}, '^[+-]?((0|[1-9][0-9]*)([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$', 'c') THEN CASE WHEN ${zero} THEN 0 WHEN ABS(${converted}) >= 1e-125 AND ABS(${converted}) < 1e125 THEN ${converted} END END)`;
    }
    function formulaToleranceSql(node) {
        const absolute = node.absoluteTolerance, relative = node.relativeTolerance;
        if (![absolute, relative].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) throw new Error("Invalid formula tolerance");
        return `GREATEST(${absolute}, ${relative} * ABS(${expressionSql(node.expression)}))`;
    }
    function predicateSql(node, depth = 0) {
        if (!node || depth > 20) throw new Error("Invalid candidate predicate");
        const op = node.operator;
        if (["AND", "OR"].includes(op) && node.conditions?.length) return `(${node.conditions.map((n) => predicateSql(n, depth + 1)).join(` ${op} `)})`;
        if (!/^[A-Z][A-Z0-9_$#]{0,127}$/.test(node.column || "")) throw new Error("Invalid predicate column");
        let column = node.numericText === true ? numericTextSql(`T."${node.column}"`) : `T."${node.column}"`;
        if (op === "WITHIN_TOLERANCE") {
            const prediction = expressionSql(node.expression);
            return `(${column} IS NOT NULL AND ${prediction} IS NOT NULL AND ABS(${column} - ${prediction}) <= ${formulaToleranceSql(node)})`;
        }
        if (["IS_NULL", "NOT_NULL"].includes(op)) return `${column} IS ${op === "NOT_NULL" ? "NOT " : ""}NULL`;
        if (!["=", "!=", "<=", ">", "<", ">="].includes(op)) throw new Error("Invalid predicate operator");
        const value = node.value;
        if (typeof value === "string" && node.valueType === "NUMBER" && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return `${column} ${op} ${value}`;
        if (typeof value === "number" && Number.isFinite(value)) {
            if (node.valueType === "BINARY_FLOAT") column = `CAST(${column} AS BINARY_FLOAT)`;
            return `${column} ${op} ${value}`;
        }
        if (typeof value !== "string" || !["=", "!="].includes(op)) throw new Error("Invalid predicate value");
        return `${column} ${op} '${value.replaceAll("'", "''")}'`;
    }
    const columns = ["RULE_ID", "CONDITION_TEXT", "RESULT_TEXT", "CONDITION_COUNT", "CONDITION_TOTAL_COUNT", "SUPPORT_COUNT", "RULE_SUPPORT", "RULE_CONFIDENCE", "RULE_LIFT", "MODEL_AGREEMENT", "HOLDOUT_COUNT", "HOLDOUT_AGREEMENT", "MATCH_COUNT", "VALIDATION_STATUS"];
    function columnLabels(tr = t) {
        const keys = ["Rule ID", "Condition", "Result", "Condition count", "Training matches", "Model anomaly rows", "Sample support", "Confidence", "Lift", "Model agreement", "Holdout matches", "Holdout agreement", "Candidate rows", "Validation status"];
        return Object.fromEntries(columns.map((c, i) => [c, tr(keys[i])]));
    }
    function candidateColumnLabels(tr = t) {
        return { ...columnLabels(tr), CASE_ID: tr("Row ID"), EXPECTED_VALUE: tr("Expected value"),
            ACTUAL_VALUE: tr("Actual value"), VIOLATION_SCORE: tr("Violation score"), VIOLATION_REASON: tr("Violation reason"),
            RESULT_COLUMN: tr("Result column"), EXPECTED_LOWER: tr("Expected lower bound"), EXPECTED_UPPER: tr("Expected upper bound"),
            RESIDUAL: tr("Residual (actual - expected)"), ABS_ERROR: tr("Absolute error") };
    }
    function diagnostics(summary = {}, tr = t) {
        if (isPattern(summary)) return [["Training rows", number(summary.trainCount)], ["Validation rows", number(summary.validationCount ?? summary.holdoutCount)],
            ["Accepted pattern rules", number(summary.ruleCount)], ["Violation rows", number(summary.violationCount ?? summary.ruleMatchCount)]]
            .map(([key, value]) => ({ label: tr(key), value }));
        return [["Training rows", number(summary.trainCount)], ["Holdout rows", number(summary.holdoutCount)],
            ["Holdout fidelity", percent(summary.holdoutFidelity)], ["Holdout precision", percent(summary.holdoutPrecision)],
            ["Holdout recall", percent(summary.holdoutRecall)]].map(([key, value]) => ({ label: tr(key), value }));
    }
    function notes(summary = {}, tr = t) {
        const result = [tr(isPattern(summary) ? "These rules predict actual column values, ranges or formulas. Violations satisfy IF but do not satisfy THEN; they require review." : "These rules explain Isolation Forest candidates. Agreement measures model consistency, not confirmed errors."),
            tr("Counts are rule-row matches; one row may match several rules. Only a bounded preview is stored.")];
        if (summary.sampling === "FIRST_ROWS") result.push(tr("First-row sampling may reflect source ordering."));
        if (summary.sampleLimitReached || summary.sampleByteLimitReached) result.push(tr("Sample limits were applied."));
        if ((summary.warnings || []).some((s) => /HOLDOUT/.test(s))) result.push(tr("Insufficient holdout support"));
        if (isPattern(summary)) {
            if ((summary.warnings || []).includes("TARGET_COLUMN_LIMIT")) {
                result.push(tr("Target-column limits were applied. Only the listed target columns were modeled."));
                if (summary.fittedTargets?.length) result.push(`${tr("Modeled target columns")}: ${summary.fittedTargets.join(", ")}.`);
            }
            const excluded = (summary.encoding?.excludedColumns || []).filter((c) => ["COLUMN_LIMIT", "ENCODED_FEATURE_LIMIT"].includes(c.reason)).map((c) => c.column);
            if (excluded.length) result.push(`${tr("Columns excluded by the feature limit")}: ${excluded.join(", ")}.`);
            if ((summary.warnings || []).includes("RULE_LIMIT")) result.push(tr("The rule limit was applied; additional patterns may exist."));
            if (summary.metricsCohort === "FULL_TARGET") result.push(tr("Reported rule metrics use the same full target cohort after detection."));
            result.push(tr("Validation metrics were used for rule selection; they are not independent final test metrics."));
            if (!Number(summary.ruleCount)) result.push(tr("No patterns passed the support, confidence and validation criteria. No rules were forced."));
        }
        return result.join(" ");
    }
    const patternColumns = ["RULE_ID", "RESULT_KIND", "CONDITION_TEXT", "RESULT_TEXT", "CONDITION_COUNT", "CONDITION_TOTAL_COUNT", "SUPPORT_COUNT", "RULE_SUPPORT", "RULE_CONFIDENCE", "RULE_LIFT", "VALIDATION_COUNT", "VALIDATION_SUPPORT_COUNT", "VALIDATION_CONFIDENCE", "VALIDATION_R2", "VALIDATION_MAE", "VALIDATION_RMSE", "ABSOLUTE_TOLERANCE", "RELATIVE_TOLERANCE", "VIOLATION_COUNT", "VALIDATION_STATUS"];
    function patternColumnLabels(tr = t) { return { ...columnLabels(tr), RESULT_KIND: tr("Result kind"), CONDITION_TOTAL_COUNT: tr("Condition matches"), RULE_SUPPORT: tr("Support"), SUPPORT_COUNT: tr("Supporting rows"), RULE_CONFIDENCE: tr("Confidence / within-tolerance rate"), VALIDATION_COUNT: tr("Validation matches"), VALIDATION_SUPPORT_COUNT: tr("Validation supporting rows"), VALIDATION_CONFIDENCE: tr("Validation confidence / within-tolerance rate"), VALIDATION_R2: tr("Validation R²"), VALIDATION_MAE: tr("Validation MAE (target units)"), VALIDATION_RMSE: tr("Validation RMSE (target units)"), ABSOLUTE_TOLERANCE: tr("Absolute tolerance (target units)"), RELATIVE_TOLERANCE: tr("Relative tolerance"), VIOLATION_COUNT: tr("Violation rows") }; }
    function decimal(value) { return value == null || !Number.isFinite(Number(value)) ? "-" : Number(value).toLocaleString(undefined, { maximumSignificantDigits: 6 }); }
    function validationStatus(value, tr = t) { return tr(({ HOLDOUT_OBSERVED: "Holdout observed", VALIDATED: "Validated", ACCEPTED: "Validated", INSUFFICIENT_HOLDOUT_SUPPORT: "Insufficient holdout support", INSUFFICIENT_VALIDATION_SUPPORT: "Insufficient validation support", VALIDATION_FAILED: "Validation failed" })[value] || value || "Not evaluated"); }
    function actualValue(value, tr = t) { return value == null || value === "" ? tr("NULL (missing)") : String(value); }
    function violationReason(reason, row = {}, tr = t) {
        if (reason === "PATTERN_FORMULA_MISMATCH") return tr("The actual value is outside the formula prediction tolerance.");
        if (reason === "PATTERN_RESULT_MISSING") return tr("The result value is missing and does not satisfy the rule.");
        if (/^Expected .+ but actual value is different\.$/.test(String(reason || "")) || ["PATTERN_MISMATCH", "RESULT_MISMATCH", "PATTERN_RESULT_MISMATCH"].includes(reason)) return tr("Actual value does not satisfy the expected value or range.");
        return reason || tr("Actual value does not satisfy the expected value or range.");
    }
    function stageSummary(summary = {}, kind, tr = t) {
        const profile = kind === "PROFILE";
        const data = summary[profile ? "profile" : "relationships"];
        const title = tr(profile ? "Basic statistics and missing values" : "Relationships and related columns");
        if (!data) return { available: false, title, notes: tr("This stage was not stored in this execution. Existing two-stage history is preserved; run a new four-stage FLOW to create it."), metrics: [], sections: [] };
        const labels = { COLUMN_NAME: "Column", COLUMN_COMMENT: "Column description", DATA_TYPE: "Data type", NUMERIC_SOURCE: "Numeric interpretation", ROW_COUNT: "Sample rows", NON_NULL_COUNT: "Nonmissing rows", NULL_COUNT: "Missing rows", NULL_RATE: "Missing rate", DISTINCT_COUNT: "Distinct values", DISTINCT_RATE: "Distinct rate", MIN: "Minimum", MAX: "Maximum", MEAN: "Mean", STDDEV: "Standard deviation", Q1: "First quartile", MEDIAN: "Median", Q3: "Third quartile", ZERO_COUNT: "Zero values", INVALID_NUMERIC_COUNT: "Invalid numeric values", TOP_VALUES: "Frequent values", COLUMN_X: "Column X", COLUMN_Y: "Column Y", PAIR_COUNT: "Paired rows", COVERAGE: "Coverage", CORRELATION: "Pearson correlation", MATCH_COUNT: "Matching rows" };
        const comments = new Map((summary.profile?.columns || []).map((c) => [c.COLUMN_NAME, c.COLUMN_COMMENT]));
        const section = (titleKey, columns, rows) => ({ title: tr(titleKey), columns, columnLabels: Object.fromEntries(columns.map((c) => [c, tr(c === "NUMERIC_WARNINGS" ? "Numeric warnings" : labels[c] || c)])), rows: (rows || []).map((row) => ({ ...row,
            ...Object.fromEntries(["COLUMN_X", "COLUMN_Y"].filter((c) => comments.get(row[c])).map((c) => [c, `${row[c]} · ${comments.get(row[c])}`])),
            ...Object.fromEntries(["NULL_RATE", "COVERAGE"].filter((c) => Object.hasOwn(row, c)).map((c) => [c, percent(row[c])])),
            ...(row.TOP_VALUES ? { TOP_VALUES: row.TOP_VALUES.map((v) => `${actualValue(v.value, tr)}: ${number(v.count)}`).join(" · ") } : {}),
            ...(["NUMERIC_TEXT", "PHYSICAL_NUMERIC"].includes(row.NUMERIC_SOURCE) ? { NUMERIC_SOURCE: tr(row.NUMERIC_SOURCE === "NUMERIC_TEXT" ? "Numeric text" : "Physical numeric type") } : {}),
            ...(row.NUMERIC_WARNINGS ? { NUMERIC_WARNINGS: row.NUMERIC_WARNINGS.map((w) => tr(({NUMERIC_TEXT_INFERRED: "Strict numeric text was interpreted numerically; the physical database type is unchanged.", NON_FINITE_INPUT_EXCLUDED: "Nonfinite values were excluded from numeric statistics.", STATISTIC_OUT_OF_RANGE: "Some statistics exceed the representable range and are unavailable."})[w] || w)).join(" ") } : {}) })) });
        const metrics = profile ? [["Sample rows", data.sampleCount], ["Profiled columns", data.columnCount], ["Numeric columns", data.numericColumnCount], ["Text columns", data.textColumnCount], ["Duplicate sampled rows", data.duplicateRowCount], ["Skipped columns", data.skippedColumnCount]]
            : [["Sample rows", data.sampleCount], ["Numeric columns", data.numericColumnCount], ["Correlation pairs", data.pairCount], ["Duplicate column pairs", data.duplicateColumns?.length]];
        if (profile && data.numericTextColumnCount != null) metrics.push(["Inferred numeric-text columns", data.numericTextColumnCount]);
        const sections = profile ? [section("Column statistics", ["COLUMN_NAME", "COLUMN_COMMENT", "DATA_TYPE", "NUMERIC_SOURCE", "ROW_COUNT", "NULL_COUNT", "NULL_RATE", "DISTINCT_COUNT", "MIN", "MAX", "MEAN", "STDDEV", "Q1", "MEDIAN", "Q3", "ZERO_COUNT", "INVALID_NUMERIC_COUNT", "TOP_VALUES", "NUMERIC_WARNINGS"], data.columns)]
            : [section("Numeric relationships", ["COLUMN_X", "COLUMN_Y", "PAIR_COUNT", "COVERAGE", "CORRELATION"], data.correlationPairs),
                section("Duplicate columns", ["COLUMN_X", "COLUMN_Y", "MATCH_COUNT", "COVERAGE"], data.duplicateColumns),
                section("Columns with missing values", ["COLUMN_NAME", "NULL_COUNT", "NULL_RATE"], data.missingColumns)];
        const notes = [tr("Statistics and relationships describe the saved bounded sample, not the entire source or a causal relationship.")];
        if (data.sampling === "FIRST_ROWS" || summary.sampling === "FIRST_ROWS" || summary.profile?.sampling === "FIRST_ROWS") notes.push(tr("First-row sampling may reflect source ordering."));
        if (data.sampleLimitReached || data.sampleByteLimitReached || (!profile && (summary.profile?.sampleLimitReached || summary.profile?.sampleByteLimitReached))) notes.push(tr("Sample limits were applied."));
        if (data.pairsTruncated) notes.push(tr("Relationship pair limits were applied."));
        return { available: true, title, metrics: metrics.map(([key, value]) => ({ label: tr(key), value: number(value) })), sections, notes: notes.join(" ") };
    }
    function ruleNotes(row, summary = {}, tr = t) {
        return notes(summary, tr) + (isFormula(row) ? " " + tr("Formula confidence is the fraction within tolerance, not association frequency. R² and MAE use rows with finite observations and predictions; missing results still violate the rule.") : "");
    }
    root.RuleResultCommon = { t, ko, isXai, isPattern, isFormula, formulaMethod, patternSummary, continuousSummary, continuousDiagnostic, metrics, filterSummary, candidateRows, violationSummary, predicateSql, expressionSql, formulaToleranceSql, numericTextSql, columns, patternColumns, columnLabels, patternColumnLabels, candidateColumnLabels, diagnostics, stageSummary, ruleNotes, notes, validationStatus, actualValue, violationReason };
})(window);
