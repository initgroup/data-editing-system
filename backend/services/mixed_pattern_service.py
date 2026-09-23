"""Actual-column pattern discovery and NULL-safe violation detection.

The caller owns the transaction. Schema changes are exclusively manual installers.
Version 1 anomaly explanations retain their original storage and meaning.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import math

from fastapi import HTTPException

from backend.services import mixed_xai_service as xai

ALGORITHM = "MIXED_PATTERN_TREE"
RULE_TABLE = "INIT$_TB_RULEDISC_ASSOC_SUM"
VIOLATION_TABLE = "INIT$_TB_RULEVIOL_ASSOC"
REQUIRED_FIELDS = {"CONDITION_JSON", "RESULT_JSON", "VALIDATION_JSON", "RESULT_KIND", "VIOLATION_COUNT"}


def require_schema(cursor):
    xai.require_schema(cursor)
    xai._execute(cursor, "PATTERN_SCHEMA_CHECK")
    found = set(cursor.fetchall())
    required = {(RULE_TABLE, name) for name in REQUIRED_FIELDS} | {(VIOLATION_TABLE, "ACTUAL_VALUE")}
    missing = sorted(required - found)
    if missing:
        columns = ", ".join(f"{table}.{column}" for table, column in missing)
        raise HTTPException(409, "Mixed pattern schema is incomplete. Missing columns: " + columns
                            + ". Run the corrected database/INIT_TARGET_PATTERN.sql as a complete script"
                            + " using the same Target DB account selected in the app; verify '[OK] Mixed pattern schema',"
                            + " then retry the failed stage.")


def _model_name(ctx):
    return "XAI_PATTERN_" + str(ctx["runId"])


def _sample(cursor, ctx, payload):
    ml = xai.ml
    row_cap = ml._ml_runtime_limit(payload, "APP_ML_MAX_IN_MEMORY_ROWS", ml._ml_in_memory_row_limit(), 1)
    feature_cap = min(128, ml._ml_runtime_limit(payload, "APP_ML_MAX_INPUT_FEATURES", ml._ml_input_feature_limit(), 1))
    limit = min(25000, row_cap, xai._number(payload, "sampleRows", row_cap, 32, 1000000, integer=True))
    columns = xai._columns(cursor, ctx)
    excluded = set(ml.normalize_column_list(xai._value(payload, "excludeColumns", "FILE_ROW_NO")))
    requested = ml.normalize_column_list(xai._value(payload, "featureColumns"))
    eligible = [c for c in columns if c["COLUMN_NAME"] not in excluded
                and (c["DATA_TYPE"] in xai.NUMERIC_TYPES or
                     c["DATA_TYPE"] in xai.TEXT_TYPES and c["DATA_LENGTH"] <= 4000)]
    if requested:
        if set(requested) - {c["COLUMN_NAME"] for c in eligible}:
            raise HTTPException(400, "Selected features contain excluded, unsupported or unknown columns.")
        eligible = [c for c in eligible if c["COLUMN_NAME"] in requested]
    limited_columns = [column["COLUMN_NAME"] for column in eligible[feature_cap:]]
    eligible = eligible[:feature_cap]
    if len(eligible) < 2:
        raise HTTPException(400, "Pattern discovery requires at least two usable columns: an IF input and an actual THEN result.")
    projection = ", ".join("T." + ml.quote_identifier(c["COLUMN_NAME"]) for c in eligible)
    cursor.execute(xai._render("XAI_SOURCE_SAMPLE", ctx, projection), {"rowLimit": limit})
    names = [str(d[0]).upper() for d in cursor.description or []]
    rows, size, byte_limit_reached = [], 0, False
    while len(rows) < limit and not byte_limit_reached:
        batch = cursor.fetchmany(min(250, limit - len(rows)))
        if not batch:
            break
        for values in batch:
            row_size = sum(len(v.encode("utf-8")) + 64 if isinstance(v, str) else 32 for v in values)
            if size + row_size > 32 * 1024 * 1024:
                byte_limit_reached = True
                break
            rows.append(dict(zip(names, values)))
            size += row_size
    return rows, eligible, columns, {"sampling": "FIRST_ROWS", "sampleLimit": limit,
        "sampleCount": len(rows), "sampleLimitReached": len(rows) == limit,
        "sampleByteLimitReached": byte_limit_reached, "sourceColumnCount": len(columns),
        "sampleColumnCount": len(eligible), "featureLimit": feature_cap,
        "featureLimitExcludedColumns": limited_columns}


@xai.ml._limit_ml_concurrency
def discover(conn, payload):
    from backend.services.mixed_pattern_algorithm import analyze_pattern_rows
    ctx = xai.context(payload)
    with conn.cursor() as cursor:
        require_schema(cursor)
        rows, eligible, columns, sampling = _sample(cursor, ctx, payload)
        options = {
            "maxRows": sampling["sampleLimit"], "maxColumns": len(eligible),
            "maxFeatures": min(4096, max(2, len(eligible) * 64)), "randomState": 42,
            "maxDepth": xai._number(payload, "maxDepth", 4, 1, 6, integer=True),
            "maxCategories": xai._number(payload, "maxCategories", 32, 2, 64, integer=True),
            "minSamplesLeaf": xai._number(payload, "minSamplesLeaf", 20, 5, 1000, integer=True),
            "maxTargets": xai._number(payload, "maxTargets", 64, 1, 64, integer=True),
            "maxRules": xai._number(payload, "maxRules", 64, 1, 128, integer=True),
            "minConfidence": xai._number(payload, "minConfidence", .99, .5, 1),
            "minValidationConfidence": xai._number(payload, "minValidationConfidence", .90, .5, 1),
            "minValidationCount": xai._number(payload, "minValidationCount", 10, 2, 1000, integer=True),
            "minLift": xai._number(payload, "minLift", 1.01, 1, 100),
            "minConfidenceGain": xai._number(payload, "minConfidenceGain", .01, 0, .5),
            "targetColumns": xai.ml.normalize_column_list(xai._value(payload, "targetColumns")) or None,
            "continuousEnabled": str(xai._value(payload, "continuousEnabled", "true")).strip().lower() not in {"false", "n", "0"},
            "maxContinuousTargets": xai._number(payload, "maxContinuousTargets", 16, 1, 32, integer=True),
            "maxContinuousRules": xai._number(payload, "maxContinuousRules", 32, 1, 128, integer=True),
            "maxFormulaFeatures": xai._number(payload, "maxFormulaFeatures", 3, 1, 4, integer=True),
            "minFormulaConfidence": xai._number(payload, "minFormulaConfidence", .95, .5, 1),
            "minFormulaValidationConfidence": xai._number(payload, "minFormulaValidationConfidence", .90, .5, 1),
            "minFormulaR2": xai._number(payload, "minFormulaR2", .90, .5, .99999),
            "maxToleranceFraction": xai._number(payload, "maxToleranceFraction", .05, .001, .2),
        }
        try:
            analysis = analyze_pattern_rows(rows, eligible, options)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        rules = analysis.get("rules", [])
        # Validate every generated predicate before the first write.
        for rule in rules:
            xai.compile_predicate(rule["predicate"], columns)
            xai.compile_predicate(rule["resultPredicate"], columns)
        model_name = _model_name(ctx)
        xai._execute(cursor, "XAI_RUN_SUMMARY", ctx)
        previous_row = cursor.fetchone()
        previous = xai._json_object(previous_row[0], "SUMMARY_JSON") if previous_row else {}
        stage_snapshots = {key: previous[key] for key in ("profile", "relationships") if key in previous}
        xai._execute(cursor, "PATTERN_CLEAR_VIOLATIONS", {**ctx, "modelName": model_name})
        xai._execute(cursor, "PATTERN_CLEAR_RULES", ctx)
        for sql_id in ("XAI_CLEAR_VIOLATIONS", "XAI_CLEAR_RULES", "XAI_CLEAR_RUN"):
            xai._execute(cursor, sql_id, ctx)
        warnings = list(analysis.get("warnings", []))
        if sampling["featureLimitExcludedColumns"]:
            warnings.append("SOURCE_FEATURE_COLUMN_LIMIT")
        if sampling["sampleLimitReached"] or sampling["sampleByteLimitReached"]:
            warnings.append("FIRST_ROWS_SAMPLE_NOT_POPULATION_REPRESENTATIVE")
        summary = {**stage_snapshots, **analysis.get("metrics", {}), **sampling,
            "algorithm": ALGORITHM, "algorithmVersion": 2, "encoding": analysis.get("encoding", {}),
            "options": options, "ruleCount": len(rules), "modelName": model_name,
            "status": "PATTERN_RULES", "warnings": warnings, "metricsCohort": "TRAIN_SAMPLE",
            "meaning": "Actual-column patterns selected with separate validation; violations satisfy IF and fail THEN.",
            "validationMeaning": "SELECTION_VALIDATION", "nullPolicy": "MISSING_RESULT_IS_VIOLATION"}
        xai._execute(cursor, "XAI_INSERT_RUN", {**ctx, "summaryJson": xai._json(summary)})
        for rule in rules:
            condition_columns = {n["column"] for n in xai._atomic_nodes(rule["predicate"])}
            validation = {**rule.get("validation", {}), "train": {
                **rule.get("validation", {}).get("train", {}),
                **{k: rule.get(k) for k in
                   ("supportCount", "conditionCount", "resultCount", "totalCount", "confidence", "support", "lift")}}}
            xai._execute(cursor, "PATTERN_INSERT_RULE", {**ctx, "modelName": model_name,
                "ruleId": rule["ruleId"], "conditionCount": len(condition_columns),
                "conditionText": rule["expression"], "resultColumn": rule["resultColumn"],
                "resultValue": str(rule["resultValue"]), "resultText": rule["resultText"],
                "support": rule["support"], "confidence": rule["confidence"], "lift": rule["lift"],
                "supportCount": rule["supportCount"], "conditionTotal": rule["conditionCount"],
                "resultTotal": rule["resultCount"], "totalCount": rule["totalCount"],
                "conditionJson": xai._json(rule["predicate"]), "resultJson": xai._json(rule["resultPredicate"]),
                "validationJson": xai._json(validation), "resultKind": rule["resultKind"]})
    return {**summary, "status": "success", "resultTable": RULE_TABLE,
            "resultTables": [RULE_TABLE, xai.TABLES[0]]}


def compile_violation(rule, columns, *, prefix="p"):
    condition = xai._json_object(rule["CONDITION_JSON"], "CONDITION_JSON")
    result = xai._json_object(rule["RESULT_JSON"], "RESULT_JSON")
    a, abinds = xai.compile_predicate(condition, columns, prefix=prefix + "a")
    b, bbinds = xai.compile_predicate(result, columns, prefix=prefix + "b")
    target = rule.get("RESULT_COLUMN")
    if target and ({n.get("column") for n in xai._atomic_nodes(result)} != {target}
                   or target in {n.get("column") for n in xai._atomic_nodes(condition)}):
        raise HTTPException(409, "A pattern must predict its actual result column without using it in IF.")
    # SQL NOT B would silently miss NULL results under three-valued logic.
    return a, b, f"({a}) AND (CASE WHEN {b} THEN 0 ELSE 1 END = 1)", {**abinds, **bbinds}


def _metrics(a, ab, b, n):
    confidence = ab / a if a else None
    baseline = b / n if n else 0
    return {"supportCount": ab, "conditionTotal": a, "resultTotal": b, "totalCount": n,
            "support": ab / n if n else None, "confidence": confidence,
            "lift": confidence / baseline if confidence is not None and baseline else None,
            "violationCount": a - ab}


def _preview_quotas(counts, limit):
    """Round-robin allocation keeps later rules visible under the shared cap."""
    quotas = [0] * len(counts)
    while limit and any(q < c for q, c in zip(quotas, counts)):
        for index, count in enumerate(counts):
            if quotas[index] < count and limit:
                quotas[index] += 1
                limit -= 1
    return quotas


def detect_patterns(cursor, ctx, source_ctx, summary, limit):
    require_schema(cursor)
    columns = xai._columns(cursor, ctx)
    xai._execute(cursor, "PATTERN_RULE_LIST", source_ctx)
    rules = xai._rows(cursor)
    if len(rules) > 128:
        raise HTTPException(409, "Stored pattern rules exceed the supported per-run limit. Re-run discovery.")
    compiled = [compile_violation(rule, columns, prefix=f"r{i}_") for i, rule in enumerate(rules)]
    metrics = []
    # One scan per bounded batch; no per-rule full scans for counts.
    for offset in range(0, len(compiled), 32):
        expressions, binds = ["COUNT(*)"], {}
        for a, b, _, rule_binds in compiled[offset:offset + 32]:
            expressions.extend(f"SUM(CASE WHEN {p} THEN 1 ELSE 0 END)" for p in (a, f"({a}) AND ({b})", b))
            binds.update(rule_binds)
        sql = xai._render("XAI_MATCH_COUNTS", ctx).replace("/*COUNTS*/", "\n     , ".join(expressions))
        cursor.execute(sql, binds)
        values = [int(value or 0) for value in cursor.fetchone()]
        metrics.extend(_metrics(*values[i:i + 3], values[0]) for i in range(1, len(values), 3))
    for rule, counts in zip(rules, metrics):
        if rule.get("RESULT_KIND") == "FORMULA":
            # Coverage of a tolerance band is not an association-rule lift.
            counts.update(lift=None, resultTotal=None)
    unique_count = 0
    if compiled:
        union = " OR ".join(f"({item[2]})" for item in compiled)
        binds = {key: value for item in compiled for key, value in item[3].items()}
        cursor.execute(xai._render("PATTERN_UNIQUE_COUNT", ctx, predicate=union), binds)
        unique_count = int(cursor.fetchone()[0] or 0)
    # No writes until both ASTs and the full-source evaluations succeed.
    model_name = _model_name(source_ctx)
    xai._execute(cursor, "PATTERN_CLEAR_VIOLATIONS", {**ctx, "modelName": model_name})
    if source_ctx["runId"] != ctx["runId"]:
        # Independent DATA_WORK stages have distinct run IDs. Keep a scoped
        # snapshot with the application run so shared analysis/edit joins work,
        # without changing the original discovery's metrics on a later run.
        xai._execute(cursor, "PATTERN_CLEAR_RULES", ctx)
        xai._execute(cursor, "PATTERN_COPY_DISCOVERY_RULES", {**ctx, "discoveryRunId": source_ctx["runId"]})
    quotas = _preview_quotas([m["violationCount"] for m in metrics], limit)
    has_file_row = any(c["COLUMN_NAME"] == "FILE_ROW_NO" for c in columns)
    case_expression = 'TO_CHAR(T."FILE_ROW_NO")' if has_file_row else "ROWIDTOCHAR(T.ROWID)"
    saved_count = 0
    for rule, (_, _, predicate, binds), counts, quota in zip(rules, compiled, metrics, quotas):
        xai._execute(cursor, "PATTERN_UPDATE_COUNTS", {**ctx, "modelName": rule["MODEL_NAME"],
            "ruleId": rule["RULE_ID"], **counts})
        if not quota:
            continue
        projection = "T." + xai.ml.quote_identifier(rule["RESULT_COLUMN"])
        result_ast = xai._json_object(rule["RESULT_JSON"], "RESULT_JSON")
        formula = rule.get("RESULT_KIND") == "FORMULA"
        preview_binds = {**binds, "rowLimit": quota}
        sql_id = "PATTERN_PREVIEW"
        if formula:
            from backend.services.mixed_formula import compile_expression
            expected_sql, expected_binds, _ = compile_expression(result_ast["expression"], columns,
                prefix="preview_", forbidden_column=rule["RESULT_COLUMN"])
            preview_binds.update(expected_binds)
            sql_id = "PATTERN_FORMULA_PREVIEW"
        sql = xai._render(sql_id, ctx, projection, predicate, case_expression)
        if formula:
            sql = sql.replace("/*EXPECTED*/", expected_sql)
        cursor.execute(sql, preview_binds)
        previews = cursor.fetchall()
        for preview in previews:
            case_rowid, case_id, actual = preview[:3]
            expected = preview[3] if formula else rule["RESULT_VALUE"]
            params = {**ctx, "modelName": rule["MODEL_NAME"], "ruleId": rule["RULE_ID"],
                "caseId": str(case_id) if case_id is not None else str(case_rowid), "caseRowid": str(case_rowid),
                "conditionCount": rule["CONDITION_COUNT"], "conditionText": rule["CONDITION_TEXT"],
                "resultColumn": rule["RESULT_COLUMN"], "expectedValue": str(expected) if expected is not None else None,
                "actualValue": str(actual) if actual is not None else None,
                "reason": "PATTERN_RESULT_MISSING" if actual is None else
                          "PATTERN_FORMULA_MISMATCH" if formula else "PATTERN_RESULT_MISMATCH",
                **{key: value for key, value in counts.items() if key != "violationCount"}}
            xai._execute(cursor, "PATTERN_INSERT_VIOLATION", params)
            saved_count += 1
    violations = sum(m["violationCount"] for m in metrics)
    summary.update({"ruleMatchCount": violations, "violationCount": violations,
        "uniqueViolationCount": unique_count, "savedViolationCount": saved_count,
        "previewLimit": limit, "previewTruncated": violations > saved_count,
        "previewAllocation": "ROUND_ROBIN_BY_RULE", "discoveryRunId": source_ctx["runId"],
        "detectedRunId": ctx["runId"], "metricsCohort": "FULL_TARGET",
        "caseIdColumn": "FILE_ROW_NO" if has_file_row else None,
        "evaluatedRows": metrics[0]["totalCount"] if metrics else 0,
        "countMeaning": "Rule-row violations; uniqueViolationCount counts distinct source rows."})
    if source_ctx["runId"] != ctx["runId"]:
        xai._execute(cursor, "XAI_CLEAR_RUN", ctx)
        xai._execute(cursor, "XAI_INSERT_RUN", {**ctx, "summaryJson": xai._json(summary)})
    else:
        xai._execute(cursor, "XAI_UPDATE_RUN", {**ctx, "summaryJson": xai._json(summary)})
    return {**summary, "status": "success", "resultTable": VIOLATION_TABLE, "resultTables": [VIOLATION_TABLE]}


def rule_summary(rules, comments):
    normalized, buckets, result_counts = [], {}, {}
    for stored in rules:
        rule = {key: value for key, value in stored.items() if not key.endswith("_JSON")}
        predicate = xai._json_object(stored["CONDITION_JSON"], "CONDITION_JSON")
        result = xai._json_object(stored["RESULT_JSON"], "RESULT_JSON")
        validation = xai._json_object(stored.get("VALIDATION_JSON") or {}, "VALIDATION_JSON")
        rule.update({"RULE_KIND": ALGORITHM, "CONDITION_AST": predicate, "RESULT_AST": result,
            "CONDITION_COLUMNS": sorted({n["column"] for n in xai._atomic_nodes(predicate)}),
            "MATCH_COUNT": rule.get("VIOLATION_COUNT"), "VALIDATION_CONFIDENCE": validation.get("confidence"),
            "VALIDATION_COUNT": validation.get("conditionCount"), "VALIDATION_SUPPORT_COUNT": validation.get("supportCount"),
            "VALIDATION_STATUS": validation.get("status"), "VALIDATION_KIND": "SELECTION_VALIDATION",
            "TRAIN_CONFIDENCE": validation.get("train", {}).get("confidence"),
            "TRAIN_COUNT": validation.get("train", {}).get("conditionCount")})
        if rule.get("RESULT_KIND") == "FORMULA":
            rule.update({"VALIDATION_R2": validation.get("r2"), "VALIDATION_MAE": validation.get("mae"),
                "VALIDATION_RMSE": validation.get("rmse"), "ABSOLUTE_TOLERANCE": result.get("absoluteTolerance"),
                "RELATIVE_TOLERANCE": result.get("relativeTolerance", 0),
                "FORMULA_EXPRESSION": result.get("expression"), "VALIDATION_DIAGNOSTICS": validation,
                "FORMULA_METHOD": validation.get("discoveryMethod"),
                "COEFFICIENT_POLICY": validation.get("coefficientPolicy")})
        normalized.append(rule)
        count = int(rule.get("CONDITION_COUNT") or 0)
        bucket = buckets.setdefault(count, {"CONDITION_COUNT": count, "RULE_COUNT": 0, "NON_PERFECT_CONF_RULES": 0})
        bucket["RULE_COUNT"] += 1
        bucket["NON_PERFECT_CONF_RULES"] += int(rule.get("RULE_CONFIDENCE") is not None and rule["RULE_CONFIDENCE"] < 1)
        result_counts[rule["RESULT_COLUMN"]] = result_counts.get(rule["RESULT_COLUMN"], 0) + 1
    result_top = [{"RESULT_COLUMN": column, "RULE_COUNT": count} for column, count in
                  sorted(result_counts.items(), key=lambda item: (-item[1], item[0]))]
    def average(key):
        values = [float(rule[key]) for rule in normalized if rule.get(key) is not None
                  and math.isfinite(float(rule[key]))]
        return sum(values) / len(values) if values else None

    return {"overview": {"TOTAL_RULES": len(rules), "MAPPED_RULES": len(rules), "MISSING_RESULT_RULES": 0,
                "NON_PERFECT_CONF_RULES": sum(b["NON_PERFECT_CONF_RULES"] for b in buckets.values()),
                "AVG_CONFIDENCE": average("RULE_CONFIDENCE"), "AVG_LIFT": average("RULE_LIFT"),
                "FORMULA_RULE_COUNT": sum(rule.get("RESULT_KIND") == "FORMULA" for rule in normalized),
                "VALUE_RULE_COUNT": sum(rule.get("RESULT_KIND") == "VALUE" for rule in normalized),
                "RANGE_RULE_COUNT": sum(rule.get("RESULT_KIND") == "RANGE" for rule in normalized),
                "RULE_SOURCE": ALGORITHM, "MODEL_TYPE": ALGORITHM},
            "rules": normalized, "conditionDist": [buckets[n] for n in sorted(buckets)],
            "resultTop": result_top, "resultTopTotal": len(result_top), "resultTopPage": 1,
            "resultTopPageSize": 12, "columnComments": comments,
            "total": len(rules), "page": 1, "pageSize": max(20, len(rules))}


def read_pattern_results(cursor, params, runs):
    require_schema(cursor)
    xai._execute(cursor, "PATTERN_FLOW_RULES", params)
    rules = xai._rows(cursor)
    xai._execute(cursor, "PATTERN_FLOW_VIOLATIONS", params)
    violations = xai._rows(cursor)
    rule_map = {(r["TARGET_OWNER"], r["TARGET_TABLE"], r["MODEL_NAME"], r["RULE_ID"]): r for r in rules}
    for row in violations:
        rule = rule_map.get((row["TARGET_OWNER"], row["TARGET_TABLE"], row["MODEL_NAME"], row["RULE_ID"]), {})
        row["RESULT_KIND"] = rule.get("RESULT_KIND")
        if rule.get("RESULT_KIND") == "FORMULA" and row.get("EXPECTED_VALUE") is not None:
            result = xai._json_object(rule["RESULT_JSON"], "RESULT_JSON")
            expected = Decimal(str(row["EXPECTED_VALUE"]))
            tolerance = max(Decimal(str(result["absoluteTolerance"])),
                            Decimal(str(result.get("relativeTolerance", 0))) * abs(expected))
            row.update(EXPECTED_LOWER=str(expected - tolerance), EXPECTED_UPPER=str(expected + tolerance))
            if row.get("ACTUAL_VALUE") is not None:
                if result.get("numericText"):
                    from backend.services.mixed_numeric import parse_numeric_decimal
                    actual = parse_numeric_decimal(row["ACTUAL_VALUE"])
                else:
                    try:
                        actual = Decimal(str(row["ACTUAL_VALUE"]))
                    except (InvalidOperation, ValueError):
                        actual = None
                if actual is not None and actual.is_finite():
                    residual = actual - expected
                    row.update(RESIDUAL=str(residual), ABS_ERROR=str(abs(residual)))
                else:
                    row.update(RESIDUAL=None, ABS_ERROR=None, ACTUAL_NUMERIC_VALID_YN="N")
    xai._execute(cursor, "XAI_FLOW_COLUMN_COMMENTS", params)
    comments = {r["COLUMN_NAME"]: r["COMMENTS"] for r in xai._rows(cursor) if r.get("COMMENTS")}
    summary = runs[0]["summary"] if len(runs) == 1 else {"algorithm": ALGORITHM, "algorithmVersion": 2,
        "targetCount": len(runs), "ruleCount": len(rules),
        "violationCount": sum(r["summary"].get("violationCount", 0) for r in runs)}
    return {"status": "success", "data": {"rules": rules, "violations": violations,
        "ruleSummary": rule_summary(rules, comments), "summary": summary, "runs": runs}}
