"""Independent mixed-data discovery. Schema installation is deliberately manual."""
from __future__ import annotations

import json
import math
import re
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import ml_analysis_service as ml

NUMERIC_TYPES = {"NUMBER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE"}
TEXT_TYPES = {"VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR"}
TABLES = ("INIT$_TB_XAI_RUN", "INIT$_TB_RULEDISC_XAI", "INIT$_TB_RULEVIOL_XAI")


def _value(payload, name, default=None):
    oracle_name = "P_" + re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()
    value = payload.get(oracle_name, payload.get(name))
    return value if value is not None else default


def _number(payload, name, default, minimum, maximum, *, integer=False):
    value = _value(payload, name, default)
    try:
        number = float(value)
        if isinstance(value, bool) or not math.isfinite(number) or not minimum <= number <= maximum or (integer and number != int(number)):
            raise ValueError
    except (ValueError, TypeError, OverflowError) as exc:
        raise HTTPException(400, f"{name} must be {'an integer' if integer else 'a number'} between {minimum} and {maximum}.") from exc
    return int(number) if integer else number


def context(payload):
    owner = ml.require_identifier(_value(payload, "targetOwner"), "targetOwner")
    table = ml.require_identifier(_value(payload, "targetTable"), "targetTable")
    source = str(_value(payload, "runSourceType", "FLOW_WORK")).upper()
    run_id = _number(payload, "runId", 0, 1, 10**15, integer=True)
    if source not in {"FLOW_WORK", "DATA_WORK"} or run_id <= 0:
        raise HTTPException(400, "A persisted FLOW_WORK or DATA_WORK run is required.")
    return {"owner": owner, "tableName": table, "runSourceType": source, "runId": run_id}


def _rows(cursor):
    names = [str(d[0]).upper() for d in cursor.description or []]
    return [dict(zip(names, [v.read() if hasattr(v, "read") else v for v in row])) for row in cursor.fetchall()]


def _execute(cursor, sql_id, params=None):
    cursor.execute(SqlLoader.get_sql(sql_id), params or {})


def require_scope(conn, payload, user_id):
    """Bind direct HTTP calls to a real run, its project owner and registered source."""
    params = context(payload)
    with conn.cursor() as cursor:
        _execute(cursor, "XAI_RUN_ACCESS", {**params, "userId": int(user_id)})
        if not cursor.fetchone():
            raise HTTPException(404, "The run and target table were not found in your project.")


def _columns(cursor, ctx):
    _execute(cursor, "XAI_SOURCE_COLUMNS", {"owner": ctx["owner"], "tableName": ctx["tableName"]})
    columns = _rows(cursor)
    if not columns:
        raise HTTPException(404, "Target table columns were not found.")
    return columns


def require_schema(cursor):
    _execute(cursor, "XAI_SCHEMA_CHECK")
    found = {r[0] for r in cursor.fetchall()}
    if set(TABLES) - found:
        raise HTTPException(409, "Install database/INIT_TARGET_XAI.sql in the selected Target DB before running the mixed XAI scenario.")


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, default=str)


def _json_object(value, field):
    """Accept native Oracle JSON objects as well as text/LOB driver results."""
    def normalize(item):
        if isinstance(item, Decimal):
            if not item.is_finite():
                raise ValueError("Nonfinite JSON number")
            item = int(item) if item == item.to_integral_value() else float(item)
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError("Nonfinite JSON number")
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        if isinstance(item, list):
            return [normalize(child) for child in item]
        return item

    try:
        value = value.read() if hasattr(value, "read") else value
        if isinstance(value, (str, bytes, bytearray)):
            value = json.loads(value)
        if not isinstance(value, dict):
            raise ValueError("Expected a JSON object")
        return normalize(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise HTTPException(500, f"Stored XAI {field} is not a valid JSON object.") from exc


def compile_predicate(predicate, columns, *, prefix="x"):
    """Only algorithm AST nodes become SQL; values always remain binds."""
    metadata = {c["COLUMN_NAME"]: c for c in columns}
    binds = {}
    nodes = 0

    def visit(node, depth=0):
        nonlocal nodes
        nodes += 1
        if not isinstance(node, dict) or depth > 20 or nodes > 256:
            raise HTTPException(400, "Invalid or oversized candidate predicate.")
        op = node.get("operator")
        if op == "WITHIN_TOLERANCE":
            from backend.services.mixed_formula import compile_result
            expression, formula_binds = compile_result(node, columns, prefix=prefix + "f" + str(nodes))
            binds.update(formula_binds)
            return expression
        if op in {"AND", "OR"}:
            children = node.get("conditions")
            if not isinstance(children, list) or not children:
                raise HTTPException(400, "An empty predicate is not allowed.")
            return "(" + (" " + op + " ").join(visit(c, depth + 1) for c in children) + ")"
        name = str(node.get("column") or "")
        if name not in metadata or op not in {"=", "!=", "<", "<=", ">", ">=", "IS_NULL", "NOT_NULL"}:
            raise HTTPException(400, "Unsupported candidate predicate column or operator.")
        column = "T." + ml.quote_identifier(name)
        numeric_text = node.get("numericText") is True
        if "numericText" in node:
            if not numeric_text or metadata[name]["DATA_TYPE"] not in TEXT_TYPES:
                raise HTTPException(400, "Numeric-text predicates require an explicitly annotated text column.")
            from backend.services.mixed_numeric import numeric_text_sql
            column = numeric_text_sql(column)
        if op in {"IS_NULL", "NOT_NULL"}:
            return column + (" IS NULL" if op == "IS_NULL" else " IS NOT NULL")
        value = node.get("value")
        numeric = metadata[name]["DATA_TYPE"] in NUMERIC_TYPES or numeric_text
        if numeric:
            if (node.get("valueType") == "NUMBER" or numeric_text) and isinstance(value, str):
                if len(value) > 128 or not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", value):
                    raise HTTPException(400, "Invalid exact numeric rule value.")
                value = Decimal(value)
            try:
                finite = (value.is_finite() if isinstance(value, Decimal) else
                          not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value))
            except OverflowError:
                finite = False
            if not finite:
                raise HTTPException(400, "Numeric rule values must be finite numbers.")
            if node.get("valueType") == "BINARY_FLOAT":
                column = "CAST(" + column + " AS BINARY_FLOAT)"
        elif not isinstance(value, str) or len(value) > 4000 or op not in {"=", "!="}:
            raise HTTPException(400, "Invalid categorical rule value.")
        key = prefix + str(len(binds))
        binds[key] = value
        return f"{column} {op} :{key}"

    return visit(predicate), binds


def _render(sql_id, ctx, columns="T.*", predicate="1=1", case_expression="ROWIDTOCHAR(T.ROWID)"):
    sql = SqlLoader.get_sql(sql_id)
    replacements = {
        "/*TARGET*/": ml.quote_identifier(ctx["owner"]) + "." + ml.quote_identifier(ctx["tableName"]),
        "/*COLUMNS*/": columns,
        "/*PREDICATE*/": predicate,
        "/*CASE_ID*/": case_expression,
    }
    for key, value in replacements.items():
        sql = sql.replace(key, value)
    return sql


@ml._limit_ml_concurrency
def _discover_anomaly_v1(conn, payload):
    from backend.services.mixed_xai_algorithm import analyze_mixed_rows
    ctx = context(payload)
    row_cap = ml._ml_runtime_limit(payload, "APP_ML_MAX_IN_MEMORY_ROWS", ml._ml_in_memory_row_limit(), 1)
    feature_cap = ml._ml_runtime_limit(payload, "APP_ML_MAX_INPUT_FEATURES", ml._ml_input_feature_limit(), 1)
    sample_limit = min(50000, row_cap, _number(payload, "sampleRows", row_cap, 1, 1000000, integer=True))
    feature_cap = min(feature_cap, 128)
    with conn.cursor() as cursor:
        require_schema(cursor)
        columns = _columns(cursor, ctx)
        supported = [c for c in columns if c["DATA_TYPE"] in NUMERIC_TYPES | TEXT_TYPES
                     and (c["DATA_TYPE"] in NUMERIC_TYPES or c["DATA_LENGTH"] <= 4000)]
        excluded = set(ml.normalize_column_list(_value(payload, "excludeColumns", "FILE_ROW_NO")))
        requested = ml.normalize_column_list(_value(payload, "featureColumns"))
        eligible = [c for c in supported if c["COLUMN_NAME"] not in excluded]
        if requested:
            available = {c["COLUMN_NAME"] for c in eligible}
            if set(requested) - available:
                raise HTTPException(400, "Selected features contain excluded, unsupported or unknown columns.")
            eligible = [c for c in eligible if c["COLUMN_NAME"] in requested]
        eligible = eligible[:feature_cap]
        if not eligible:
            raise HTTPException(400, "No supported mixed-data features were selected.")
        names = [ml.quote_identifier(c["COLUMN_NAME"]) for c in eligible]
        # A bounded first-row sample avoids materializing/sorting the full source.
        cursor.execute(_render("XAI_SOURCE_SAMPLE", ctx, ", ".join("T." + n for n in names)), {"rowLimit": sample_limit})
        rows = []
        sample_bytes = 0
        byte_limit_reached = False
        field_names = [str(d[0]).upper() for d in cursor.description or []]
        while len(rows) < sample_limit and not byte_limit_reached:
            batch = cursor.fetchmany(min(250, sample_limit - len(rows)))
            if not batch:
                break
            for values in batch:
                row_bytes = sum(len(v.encode("utf-8")) + 64 if isinstance(v, str) else 32 for v in values)
                if sample_bytes + row_bytes > 32 * 1024 * 1024:
                    byte_limit_reached = True
                    break
                rows.append(dict(zip(field_names, values)))
                sample_bytes += row_bytes
        options = {
            "contamination": _number(payload, "contamination", 0.03, 0.001, 0.25),
            "maxDepth": _number(payload, "maxDepth", 4, 1, 6, integer=True),
            "maxRows": sample_limit,
            "maxColumns": feature_cap,
            "maxFeatures": min(4096, max(2, feature_cap * 64)),
            "maxCategories": _number(payload, "maxCategories", 32, 2, 64, integer=True),
            "minSamplesLeaf": _number(payload, "minSamplesLeaf", 5, 2, 1000, integer=True),
            "randomState": 42,
        }
        try:
            analysis = analyze_mixed_rows(rows, eligible, options)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        # Clear only this exact run/target, inside the caller's transaction.
        for sql_id in ("XAI_CLEAR_VIOLATIONS", "XAI_CLEAR_RULES", "XAI_CLEAR_RUN"):
            _execute(cursor, sql_id, ctx)
        summary = {
            **analysis.get("metrics", {}),
            "encoding": analysis.get("encoding", {}),
            "options": options,
            "sampling": "FIRST_ROWS",
            "sampleLimit": sample_limit,
            "sampleCount": len(rows),
            "sampleLimitReached": len(rows) == sample_limit,
            "sampleByteLimitReached": byte_limit_reached,
            "ruleCount": len(analysis.get("rules", [])),
            "status": "CANDIDATE",
            "warnings": analysis.get("warnings", []),
            "meaning": "Agreement with an anomaly detector; not verified business errors.",
        }
        _execute(cursor, "XAI_INSERT_RUN", {**ctx, "summaryJson": _json(summary)})
        for rule in analysis.get("rules", []):
            compile_predicate(rule["predicate"], columns)
            _execute(cursor, "XAI_INSERT_RULE", {
                **ctx, "ruleId": rule["ruleId"], "ruleText": rule["expression"],
                "conditionJson": _json(rule["predicate"]), "supportCount": rule["supportCount"],
                "anomalyCount": rule["anomalyCount"], "purity": rule["anomalyPurity"],
                "validationJson": _json({k: v for k, v in rule.items() if k.startswith("holdout") or k in {"validationStatus", "metricMeaning"}}),
            })
    return {"status": "success", "resultTable": TABLES[1], "resultTables": [TABLES[0], TABLES[1]], **summary}


def discover(conn, payload):
    """New runs discover real data consequents; v1 remains readable history only."""
    from backend.services.mixed_pattern_service import discover as discover_patterns
    return discover_patterns(conn, payload)


@ml._limit_ml_concurrency
def detect(conn, payload):
    ctx = context(payload)
    discovery_id = _number(payload, "discoveryRunId", ctx["runId"], 1, 10**15, integer=True)
    source_ctx = {**ctx, "runId": discovery_id}
    if ctx["runSourceType"] == "FLOW_WORK" and discovery_id != ctx["runId"]:
        raise HTTPException(400, "FLOW discovery must belong to the same run.")
    limit = _number(payload, "maxViolationRows", 1000, 1, 1000, integer=True)
    with conn.cursor() as cursor:
        require_schema(cursor)
        if discovery_id != ctx["runId"]:
            _execute(cursor, "XAI_DATA_DISCOVERY_SCOPE", {"runId": ctx["runId"], "discoveryRunId": discovery_id,
                                                       "owner": ctx["owner"], "tableName": ctx["tableName"]})
            if not cursor.fetchone():
                raise HTTPException(404, "Discovery must belong to the same project, scenario and target table.")
        _execute(cursor, "XAI_RUN_SUMMARY", source_ctx)
        source_runs = _rows(cursor)
        if not source_runs:
            raise HTTPException(409, "Run mixed XAI discovery before applying its candidate rules.")
        summary = _json_object(source_runs[0]["SUMMARY_JSON"], "SUMMARY_JSON")
        if summary.get("algorithm") == "MIXED_PATTERN_TREE":
            from backend.services.mixed_pattern_service import detect_patterns
            return detect_patterns(cursor, ctx, source_ctx, summary, limit)
        columns = _columns(cursor, ctx)
        _execute(cursor, "XAI_RULE_LIST", source_ctx)
        rules = _rows(cursor)
        summary = _json_object(source_runs[0]["SUMMARY_JSON"], "SUMMARY_JSON")
        predicates = [_json_object(rule["CONDITION_JSON"], "CONDITION_JSON") for rule in rules]
        compiled = [compile_predicate(predicate, columns, prefix=f"r{i}_") for i, predicate in enumerate(predicates)]
        _execute(cursor, "XAI_CLEAR_VIOLATIONS", ctx)
        _execute(cursor, "XAI_CLEAR_RULE_MATCHES", source_ctx)
        saved_count = 0
        rule_matches = 0
        match_counts = []
        if compiled:
            count_expressions = [f"SUM(CASE WHEN {predicate} THEN 1 ELSE 0 END)" for predicate, _ in compiled]
            all_binds = {key: value for _, binds in compiled for key, value in binds.items()}
            sql = _render("XAI_MATCH_COUNTS", ctx).replace("/*COUNTS*/", "\n     , ".join(count_expressions))
            cursor.execute(sql, all_binds)
            match_counts = [int(value or 0) for value in cursor.fetchone()]
        for rule, rule_predicate, (predicate, binds), match_count in zip(rules, predicates, compiled, match_counts):
            rule_matches += match_count
            _execute(cursor, "XAI_UPDATE_RULE_MATCHES", {**source_ctx, "ruleId": rule["RULE_ID"], "matchCount": match_count})
            remaining = limit - saved_count
            if remaining <= 0 or not match_count:
                continue
            # Store a bounded preview, not another copy of the entire target table.
            feature_names = {n.get("column") for n in _atomic_nodes(rule_predicate)}
            selected = [c for c in columns if c["COLUMN_NAME"] in feature_names]
            projection = ", ".join("T." + ml.quote_identifier(c["COLUMN_NAME"]) for c in selected)
            cursor.execute(_render("XAI_MATCH_PREVIEW", ctx, projection, predicate), {**binds, "rowLimit": remaining})
            preview_columns = [str(d[0]).upper() for d in cursor.description[1:]]
            previews = cursor.fetchall()
            for values in previews:
                case_id = values[0]
                row = dict(zip(preview_columns, values[1:]))
                _execute(cursor, "XAI_INSERT_VIOLATION", {
                    **ctx, "discoveryRunId": discovery_id, "ruleId": rule["RULE_ID"],
                    "caseId": str(case_id), "rowDataJson": _json(row), "purity": rule["RULE_PURITY"],
                })
                saved_count += 1
        summary.update({"ruleMatchCount": rule_matches, "savedViolationCount": saved_count,
                        "previewLimit": limit, "previewTruncated": rule_matches > saved_count,
                        "discoveryRunId": discovery_id, "detectedRunId": ctx["runId"],
                        "countMeaning": "Rule-row matches; a row can match more than one candidate."})
        if discovery_id != ctx["runId"]:
            _execute(cursor, "XAI_CLEAR_RUN", ctx)
            _execute(cursor, "XAI_INSERT_RUN", {**ctx, "summaryJson": _json(summary)})
        else:
            _execute(cursor, "XAI_UPDATE_RUN", {**ctx, "summaryJson": _json(summary)})
    return {"status": "success", "resultTable": TABLES[2], "resultTables": [TABLES[2]], **summary}


def _atomic_nodes(node):
    if node.get("operator") in {"AND", "OR"}:
        for child in node["conditions"]:
            yield from _atomic_nodes(child)
    else:
        yield node


def _rule_summary(rules, runs, column_comments):
    """Adapt persisted XAI candidates to the shared IF/THEN analysis contract.

    Agreement with Isolation Forest is not association-rule confidence or lift.
    Candidate counts are rule/row matches, not confirmed editing errors.
    """
    diagnostics = {(r["TARGET_OWNER"], r["TARGET_TABLE"]): r["summary"] for r in runs}
    normalized = []
    for rule in rules:
        predicate = _json_object(rule["CONDITION_JSON"], "CONDITION_JSON")
        validation = _json_object(rule.get("VALIDATION_JSON") or {}, "VALIDATION_JSON")
        columns = sorted({n["column"] for n in _atomic_nodes(predicate) if n.get("column")})
        train_count = diagnostics.get((rule["TARGET_OWNER"], rule["TARGET_TABLE"]), {}).get("trainCount", 0)
        # Strip only our generated wrapper; category values may contain THEN.
        condition = str(rule.get("RULE_TEXT") or "")
        if condition.startswith("IF ") and condition.endswith(" THEN ANOMALY_CANDIDATE"):
            condition = condition[3:-len(" THEN ANOMALY_CANDIDATE")]
        normalized.append({
            "RULE_ID": rule["RULE_ID"], "RULE_KIND": "MIXED_XAI", "RULE_SOURCE": "MIXED_XAI",
            "MODEL_TYPE": "ISOLATION_FOREST_SURROGATE", "CONDITION_TEXT": condition,
            "CONDITION_COLUMNS": columns, "CONDITION_COUNT": len(columns),
            "CONDITION_AST": predicate,
            "RESULT_COLUMN": "ANOMALY_CANDIDATE", "RESULT_VALUE": "Y",
            "RESULT_TEXT": "ANOMALY_CANDIDATE = Y", "RESULT_HAS_VALUE_YN": "Y",
            "CONDITION_TOTAL_COUNT": rule["SUPPORT_COUNT"], "SUPPORT_COUNT": rule["ANOMALY_COUNT"],
            "RULE_SUPPORT": float(rule["ANOMALY_COUNT"]) / float(train_count) if train_count else None,
            "RULE_CONFIDENCE": None, "RULE_LIFT": None, "MODEL_AGREEMENT": rule["RULE_PURITY"],
            "MATCH_COUNT": rule.get("MATCH_COUNT"), "VIOLATION_COUNT": rule.get("MATCH_COUNT"),
            "HOLDOUT_COUNT": validation.get("holdoutSupportCount"),
            "HOLDOUT_AGREEMENT": validation.get("holdoutAnomalyPurity"),
            "VALIDATION_STATUS": validation.get("validationStatus"),
        })
    buckets = {}
    for rule in normalized:
        bucket = buckets.setdefault(rule["CONDITION_COUNT"], {"CONDITION_COUNT": rule["CONDITION_COUNT"], "RULE_COUNT": 0, "NON_PERFECT_CONF_RULES": 0})
        bucket["RULE_COUNT"] += 1
        bucket["NON_PERFECT_CONF_RULES"] += int((rule["MATCH_COUNT"] or 0) > 0)
    count = len(normalized)
    return {
        "overview": {"TOTAL_RULES": count, "MAPPED_RULES": count, "MISSING_RESULT_RULES": 0,
                     "NON_PERFECT_CONF_RULES": sum(b["NON_PERFECT_CONF_RULES"] for b in buckets.values()),
                     "RULE_SOURCE": "MIXED_XAI", "MODEL_TYPE": "ISOLATION_FOREST_SURROGATE"},
        "rules": normalized, "conditionDist": [buckets[n] for n in sorted(buckets)],
        "resultTop": [{"RESULT_COLUMN": "ANOMALY_CANDIDATE", "RULE_COUNT": count}] if count else [],
        "resultTopTotal": int(bool(count)), "resultTopPage": 1, "resultTopPageSize": 12,
        "columnComments": column_comments, "total": count, "page": 1, "pageSize": max(20, count),
    }


def read_results(conn, flow_run_id, user_id, *, include_all_users=False, target_owner="", target_table=""):
    with conn.cursor() as cursor:
        _execute(cursor, "XAI_FLOW_ACCESS", {"runId": flow_run_id, "userId": user_id, "includeAllUsers": "Y" if include_all_users else "N"})
        if not cursor.fetchone():
            raise HTTPException(404, "Flow run was not found in your project.")
        require_schema(cursor)
        params = {"runId": flow_run_id, "owner": target_owner.strip().upper() or None,
                  "tableName": target_table.strip().upper() or None}
        _execute(cursor, "XAI_FLOW_SUMMARIES", params)
        runs = _rows(cursor)
        for run in runs:
            run["summary"] = _json_object(run.pop("SUMMARY_JSON"), "SUMMARY_JSON")
        if any(run["summary"].get("algorithm") in {"MIXED_PATTERN_TREE", "MIXED_PROFILE"} for run in runs):
            if any(run["summary"].get("algorithm") not in {"MIXED_PATTERN_TREE", "MIXED_PROFILE"} for run in runs):
                raise HTTPException(409, "This run contains different result versions. Select a target table to view its original results.")
            from backend.services.mixed_pattern_service import read_pattern_results
            return read_pattern_results(cursor, params, runs)
        _execute(cursor, "XAI_FLOW_RULES", params)
        rules = _rows(cursor)
        _execute(cursor, "XAI_FLOW_VIOLATIONS", params)
        violations = _rows(cursor)
        for row in violations:
            row["ROW_DATA_JSON"] = _json_object(row["ROW_DATA_JSON"], "ROW_DATA_JSON")
        _execute(cursor, "XAI_FLOW_COLUMN_COMMENTS", params)
        comments = {row["COLUMN_NAME"]: row["COMMENTS"] for row in _rows(cursor) if row.get("COMMENTS")}
        rule_summary = _rule_summary(rules, runs, comments)
        return {"status": "success", "data": {"rules": rules, "violations": violations,
                "ruleSummary": rule_summary,
                "summary": runs[0]["summary"] if len(runs) == 1 else {"targetCount": len(runs), "ruleCount": len(rules)}, "runs": runs}}
