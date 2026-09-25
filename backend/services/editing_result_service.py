"""Read-only, bounded catalog of stored editing rules; no model reclassification."""
from __future__ import annotations

import base64
import json

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import mixed_xai_service as xai


SOURCES = {
    "LEGACY_ASSOC": ("EDITING_ASSOC_SOURCE", "INIT$_TB_RULEDISC_ASSOC_SUM", "INIT$_TB_RULEVIOL_ASSOC"),
    "MIXED_PATTERN": ("EDITING_ASSOC_SOURCE", "INIT$_TB_RULEDISC_ASSOC_SUM", "INIT$_TB_RULEVIOL_ASSOC"),
    "LEGACY_SYMBOLIC": ("EDITING_SYMBOLIC_SOURCE", "INIT$_TB_RULEDISC_SYMBOLIC", "INIT$_TB_RULEVIOL_SYMBOLIC"),
}
FAMILIES = ("CONDITION", "FORMULA")
KEY_FIELDS = ("source", "flowRunId", "targetOwner", "targetTable", "ruleOwner", "modelName", "targetColumn", "ruleId")
MAX_PAGE_SIZE = 100


def _query(cursor, sql_id, params=None, source_sql=None, index_sql=None):
    sql = SqlLoader.get_sql(sql_id)
    if source_sql:
        # Only server-owned SQL IDs can supply a relation, never request SQL.
        sql = sql.replace("/*SOURCE_SQL*/", SqlLoader.get_sql(source_sql))
    if index_sql:
        sql = sql.replace("/*INDEX_SQL*/", index_sql)
    cursor.execute(sql, params or {})
    return xai._rows(cursor)


def _scope_params(flow_run_id, target_owner, target_table):
    owner = xai.ml.require_identifier(target_owner, "targetOwner") if target_owner else None
    table = xai.ml.require_identifier(target_table, "targetTable") if target_table else None
    return {"runId": int(flow_run_id), "owner": owner, "tableName": table}


def _authorize(cursor, flow_run_id, user_id, include_all_users):
    xai._execute(cursor, "XAI_FLOW_ACCESS", {"runId": flow_run_id, "userId": user_id,
                                          "includeAllUsers": "Y" if include_all_users else "N"})
    if not cursor.fetchone():
        raise HTTPException(404, "Flow run was not found in your project.")


def _encode_key(scope):
    value = [scope[field] for field in KEY_FIELDS]
    return base64.urlsafe_b64encode(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).decode().rstrip("=")


def _decode_key(key, params):
    try:
        if not key or len(key) > 4096:
            raise ValueError
        value = json.loads(base64.b64decode(key + "=" * (-len(key) % 4), altchars=b"-_", validate=True))
        if not isinstance(value, list) or len(value) != len(KEY_FIELDS):
            raise ValueError
        scope = dict(zip(KEY_FIELDS, value))
        if scope["source"] not in SOURCES or scope["flowRunId"] != params["runId"]:
            raise ValueError
        if any(not isinstance(scope[k], str) for k in KEY_FIELDS if k != "flowRunId"):
            raise ValueError
        if params["owner"] and scope["targetOwner"] != params["owner"]:
            raise ValueError
        if params["tableName"] and scope["targetTable"] != params["tableName"]:
            raise ValueError
        if not scope["ruleId"] or len(scope["ruleId"]) > 128:
            raise ValueError
        return scope
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        raise HTTPException(400, "Invalid rule key for the selected run and target.") from exc


def _envelope(stored, result_owner):
    source = stored["SOURCE_FAMILY"]
    family = stored["RESULT_FAMILY"]
    scope = {"source": source, "flowRunId": int(stored["RUN_ID"]),
             "targetOwner": stored["SCOPE_TARGET_OWNER"], "targetTable": stored["SCOPE_TARGET_TABLE"],
             "ruleOwner": stored["SCOPE_RULE_OWNER"], "modelName": stored.get("MODEL_NAME") or "",
             "targetColumn": stored.get("SCOPE_TARGET_COLUMN") or "", "ruleId": str(stored["RULE_ID"])}
    row = {key: value for key, value in stored.items()
           if not key.startswith("SCOPE_") and key not in {"SOURCE_FAMILY", "RESULT_FAMILY"}}
    if source == "MIXED_PATTERN":
        from backend.services.mixed_pattern_service import rule_summary
        row = rule_summary([row], {})["rules"][0]
        metrics = {"kind": "SELECTION_VALIDATION" if family == "FORMULA" else "PATTERN_CONFIDENCE",
                   "confidence": row.get("RULE_CONFIDENCE"), "support": row.get("RULE_SUPPORT"),
                   "lift": row.get("RULE_LIFT"), "validationConfidence": row.get("VALIDATION_CONFIDENCE"),
                   "validationR2": row.get("VALIDATION_R2"), "violationCount": row.get("VIOLATION_COUNT")}
    elif source == "LEGACY_SYMBOLIC":
        metrics = {"kind": "SYMBOLIC_SCORE", "score": row.get("SCORE"), "method": row.get("METHOD"),
                   "selected": row.get("SELECTED_YN"), "complexity": row.get("COMPLEXITY")}
    else:
        metrics = {"kind": "ASSOCIATION", "confidence": row.get("RULE_CONFIDENCE"),
                   "support": row.get("RULE_SUPPORT"), "lift": row.get("RULE_LIFT"),
                   "violationCount": row.get("VIOLATION_COUNT")}
    return {"key": _encode_key(scope), "family": family, "source": source, "scope": scope,
            "artifact": {"owner": result_owner, "objectName": SOURCES[source][1],
                         "violationObjectName": SOURCES[source][2]}, "row": row, "metrics": metrics,
            "semanticStatus": "UNMAPPED_RESULT" if source == "LEGACY_ASSOC" and not row.get("RESULT_COLUMN") else "STORED_RULE"}


def _attach_column_comments(cursor, entries):
    # Resolve only the current page's authorized original targets. Never merge
    # equal physical column names from different source tables.
    targets = {}
    for entry in entries:
        scope = entry["scope"]
        target = (scope["targetOwner"], scope["targetTable"])
        if target not in targets:
            rows = _query(cursor, "EDITING_RESULT_COLUMN_COMMENTS", {"owner": target[0], "tableName": target[1]})
            targets[target] = {row["COLUMN_NAME"]: row["COMMENTS"] for row in rows}
        entry["columnComments"] = targets[target]


def _index_sql(tables):
    parts = []
    for kind, table, violations in (("ASSOC", "INIT$_TB_RULEDISC_ASSOC_SUM", "INIT$_TB_RULEVIOL_ASSOC"),
                                    ("SYMBOLIC", "INIT$_TB_RULEDISC_SYMBOLIC", "INIT$_TB_RULEVIOL_SYMBOLIC")):
        if table in tables:
            count_id = f"EDITING_INDEX_{kind}_VIOLATIONS" if violations in tables else "EDITING_INDEX_UNKNOWN_COUNT"
            parts.append(SqlLoader.get_sql(f"EDITING_INDEX_{kind}").replace("/*VIOLATION_COUNT*/", SqlLoader.get_sql(count_id)))
    return "\nUNION ALL\n".join(parts)


def _summary(cursor, params, tables, index_sql):
    groups = _query(cursor, "EDITING_INDEX_COUNTS", params, index_sql=index_sql) if index_sql else []
    source_counts = []
    for source, (_, table, _) in SOURCES.items():
        for family in (*FAMILIES, "UNCLASSIFIED"):
            if source == "LEGACY_ASSOC" and family == "FORMULA" or source == "LEGACY_SYMBOLIC" and family != "FORMULA":
                continue
            count = sum(int(row["RULE_COUNT"]) for row in groups if row["SOURCE_FAMILY"] == source and row["RESULT_FAMILY"] == family)
            source_counts.append({"family": family, "source": source, "ruleCount": count,
                                  "status": "available" if table in tables else "unavailable"})
    historical = 0
    if "INIT$_TB_RULEDISC_XAI" in tables:
        historical = int(_query(cursor, "EDITING_HISTORICAL_EXPLANATION_COUNT", params)[0]["TOTAL"])
    families = {}
    for family in FAMILIES:
        total = sum(row["ruleCount"] for row in source_counts if row["family"] == family)
        families[family] = {"ruleCount": total, "total": total}
    return {"families": families, "sourceCounts": source_counts, "historicalExplanationCount": historical,
            "unclassifiedRuleCount": sum(row["ruleCount"] for row in source_counts if row["family"] == "UNCLASSIFIED")}, groups


def _page_rules(cursor, params, keys, result_owner):
    # Page keys are selected globally in SQL. Fetch their original CLOBs in at
    # most three batches, rather than loading all rules or issuing N requests.
    found = {}
    for source, (source_sql, _, _) in SOURCES.items():
        selected = [row for row in keys if row["SOURCE_FAMILY"] == source]
        if not selected:
            continue
        binds, predicates = dict(params), []
        columns = ("SOURCE_FAMILY", "SCOPE_RULE_OWNER", "SCOPE_TARGET_OWNER", "SCOPE_TARGET_TABLE", "MODEL_NAME", "SCOPE_TARGET_COLUMN", "RULE_ID")
        for index, row in enumerate(selected):
            terms = []
            for column in columns:
                name = f"key{index}_{column}"
                binds[name] = row.get(column)
                terms.append(f"(G.{column} = :{name} OR (G.{column} IS NULL AND :{name} IS NULL))")
            predicates.append("(" + " AND ".join(terms) + ")")
        sql = SqlLoader.get_sql("EDITING_RESULT_BATCH").replace("/*SOURCE_SQL*/", SqlLoader.get_sql(source_sql)).replace("/*KEY_PREDICATES*/", " OR ".join(predicates))
        cursor.execute(sql, binds)
        for row in xai._rows(cursor):
            entry = _envelope(row, result_owner)
            found[entry["key"]] = entry
    result = []
    for row in keys:
        scope = {"source": row["SOURCE_FAMILY"], "flowRunId": int(row["RUN_ID"]),
                 "targetOwner": row["SCOPE_TARGET_OWNER"], "targetTable": row["SCOPE_TARGET_TABLE"],
                 "ruleOwner": row["SCOPE_RULE_OWNER"], "modelName": row.get("MODEL_NAME") or "",
                 "targetColumn": row.get("SCOPE_TARGET_COLUMN") or "", "ruleId": str(row["RULE_ID"])}
        entry = found.get(_encode_key(scope))
        if entry:
            entry["review"] = {"violationCount": row.get("REVIEW_VIOLATION_COUNT"),
                               "countBasis": row.get("REVIEW_COUNT_BASIS"), "conditionCount": row.get("FILTER_CONDITION_COUNT")}
            result.append(entry)
    return result


def _rule_for_key(cursor, params, scope, result_owner):
    binds = {**params, "source": scope["source"], "ruleOwner": scope["ruleOwner"],
             "scopeOwner": scope["targetOwner"], "scopeTable": scope["targetTable"],
             "modelName": scope["modelName"] or None, "targetColumn": scope["targetColumn"] or None,
             "ruleId": scope["ruleId"]}
    rows = _query(cursor, "EDITING_RESULT_ONE", binds, SOURCES[scope["source"]][0])
    if len(rows) != 1:
        raise HTTPException(404, "The original rule was not found in the selected run and target.")
    return _envelope(rows[0], result_owner)


def _diagnostics(cursor, params, tables, *, full=False):
    if "INIT$_TB_XAI_RUN" not in tables:
        return {"savedSummary": None, "mixedSummary": None, "runs": [], "hasMore": False, "status": "unrecorded"}
    rows = _query(cursor, "EDITING_RESULT_STAGE_DIAGNOSTICS" if full else "EDITING_RESULT_DIAGNOSTICS", params)
    runs = []
    for row in rows[:20]:
        if full:
            summary = xai._json_object(row["SUMMARY_JSON"], "SUMMARY_JSON")
        else:
            summary = {"algorithm": row.get("ALGORITHM")}
            for field, key in (("CONTINUOUS_JSON", "continuous"), ("INTEGRATED_JSON", "integratedEditing"),
                               ("SCREENING_JSON", "featureScreening"), ("EXCLUDED_JSON", "featureLimitExcludedColumns"),
                               ("WARNINGS_JSON", "warnings")):
                if row.get(field) is not None:
                    value = row[field]
                    value = json.loads(value) if isinstance(value, (str, bytes, bytearray)) else value
                    summary[key] = xai._json_object({"value": value}, field)["value"]
            for field, key in (("SAMPLE_COUNT", "sampleCount"), ("SAMPLE_LIMIT", "sampleLimit"),
                               ("SOURCE_COLUMN_COUNT", "sourceColumnCount"), ("SAMPLE_COLUMN_COUNT", "sampleColumnCount"),
                               ("FEATURE_LIMIT", "featureLimit")):
                if row.get(field) is not None:
                    summary[key] = int(row[field])
            for field, key in (("SAMPLING", "sampling"), ("NULL_POLICY", "nullPolicy"), ("METRICS_COHORT", "metricsCohort")):
                if row.get(field) is not None:
                    summary[key] = row[field]
        runs.append({"TARGET_OWNER": row["TARGET_OWNER"], "TARGET_TABLE": row["TARGET_TABLE"], "summary": summary})
    saved = runs[0]["summary"] if len(runs) == 1 else None
    return {"savedSummary": saved, "mixedSummary": saved, "runs": runs, "hasMore": len(rows) > 20,
            "status": "available" if runs else "unrecorded", "stageDetailsIncluded": full}


def read_results(conn, flow_run_id, user_id, *, include_all_users=False, target_owner="", target_table="",
                 view="rules", family="CONDITION", page=1, page_size=20, source="ALL", rule_key="", condition_count="ALL", exclude_zero=False):
    view, family, source = str(view).lower(), str(family).upper(), str(source).upper()
    if view not in {"summary", "rules", "violations", "diagnostics"} or family not in FAMILIES or source not in {"ALL", *SOURCES}:
        raise HTTPException(400, "Unsupported result view, family or source.")
    if isinstance(page, bool) or isinstance(page_size, bool) or not 1 <= int(page) <= 1000000 or not 1 <= int(page_size) <= MAX_PAGE_SIZE:
        raise HTTPException(400, "Result page must be positive and pageSize must be between 1 and 100.")
    page, page_size = int(page), int(page_size)
    condition_count = str(condition_count).upper()
    if condition_count != "ALL" and (not (condition_count.isdigit() or condition_count == "-1") or not -1 <= int(condition_count) <= 10000):
        raise HTTPException(400, "Invalid condition count filter.")
    params = _scope_params(flow_run_id, target_owner, target_table)
    with conn.cursor() as cursor:
        _authorize(cursor, flow_run_id, user_id, include_all_users)
        tables = {row["TABLE_NAME"] for row in _query(cursor, "EDITING_RESULT_TABLES")}
        result_owner = _query(cursor, "EDITING_RESULT_OWNER")[0]["RESULT_OWNER"]
        if view == "diagnostics":
            diagnostics = _diagnostics(cursor, params, tables, full=True)
            return {"status": "success", "data": {"view": view, "diagnostics": diagnostics,
                    "summary": diagnostics["savedSummary"], "runs": diagnostics["runs"], "rules": [], "violations": []}}
        if view == "violations":
            scope = _decode_key(rule_key, params)
            if SOURCES[scope["source"]][1] not in tables:
                raise HTTPException(404, "The stored rule table is unavailable.")
            rule = _rule_for_key(cursor, params, scope, result_owner)
            _attach_column_comments(cursor, [rule])
            violation_table = SOURCES[scope["source"]][2]
            if violation_table not in tables:
                raise HTTPException(409, "The stored violation table is unavailable.")
            sql_id = "EDITING_SYMBOLIC_VIOLATION_SOURCE" if scope["source"] == "LEGACY_SYMBOLIC" else "EDITING_ASSOC_VIOLATION_SOURCE"
            binds = {"runId": params["runId"], "ruleOwner": scope["ruleOwner"], "scopeOwner": scope["targetOwner"],
                     "scopeTable": scope["targetTable"], "ruleId": scope["ruleId"]}
            binds["targetColumn" if scope["source"] == "LEGACY_SYMBOLIC" else "modelName"] = scope["targetColumn" if scope["source"] == "LEGACY_SYMBOLIC" else "modelName"]
            total = int(_query(cursor, "EDITING_RESULT_COUNT", binds, sql_id)[0]["TOTAL"])
            rows = _query(cursor, "EDITING_VIOLATION_PAGE", {**binds, "offset": (page - 1) * page_size, "pageSize": page_size}, sql_id)
            if scope["source"] == "MIXED_PATTERN":
                from backend.services.mixed_pattern_service import enrich_violation
                for row in rows:
                    enrich_violation(row, rule["row"])
            recorded = rule["row"].get("VIOLATION_COUNT")
            condition_total, support = rule["row"].get("CONDITION_TOTAL_COUNT"), rule["row"].get("SUPPORT_COUNT")
            inconsistent = scope["source"] == "MIXED_PATTERN" and recorded is not None and condition_total is not None and support is not None and float(recorded) != float(condition_total) - float(support)
            return {"status": "success", "data": {"rule": rule, "family": rule["family"], "violations": rows,
                    "countConsistency": "INCONSISTENT" if inconsistent else "NOT_CHECKED" if recorded is None else "RECORDED",
                    "evidence": {"conditionRows": condition_total, "satisfiedRows": support,
                                 "confidence": rule["row"].get("RULE_CONFIDENCE"), "detectedViolations": recorded, "savedRows": total},
                    "columns": list(rows[0]) if rows else [], "total": total, "page": page, "pageSize": page_size,
                    "hasMore": page * page_size < total, "previewOnly": scope["source"] == "MIXED_PATTERN",
                    "violationStatus": "DETECTED_NOT_SAVED" if total == 0 and (rule["row"].get("VIOLATION_COUNT") or 0) > 0
                        else "NO_STORED_ROWS" if total == 0 else "SAVED_ROWS",
                    "detectionCountRecorded": rule["row"].get("VIOLATION_COUNT") is not None,
                    "countBasis": "STORED_VIOLATION_ROWS", "fullViolationCount": rule["row"].get("VIOLATION_COUNT")}}
        index_sql = _index_sql(tables)
        summary, groups = _summary(cursor, params, tables, index_sql)
        diagnostics = {**_diagnostics(cursor, params, tables),
                       "classificationPolicy": "STORED_RESULT_SEMANTICS", "warnings": [], "errors": [],
                       "orderPolicy": "VIOLATIONS_DESC_ZERO_LAST", "ruleRowsFetched": 0,
                       "violationRowsFetched": 0}
        missing = [row["source"] for row in summary["sourceCounts"] if row["status"] == "unavailable"]
        if missing:
            diagnostics["warnings"].append({"code": "RESULT_SOURCE_UNAVAILABLE", "sources": sorted(set(missing))})
        if summary["historicalExplanationCount"]:
            diagnostics["warnings"].append({"code": "HISTORICAL_EXPLANATION_NOT_DATA_RULE"})
        if summary["unclassifiedRuleCount"]:
            diagnostics["warnings"].append({"code": "UNCLASSIFIED_STORED_RESULT_KIND"})
        selected = [row for row in groups if row["RESULT_FAMILY"] == family and (source == "ALL" or row["SOURCE_FAMILY"] == source)]
        facets = {}
        for row in selected:
            count = int(row["FILTER_CONDITION_COUNT"]) if row["FILTER_CONDITION_COUNT"] is not None else -1
            facets[count] = facets.get(count, 0) + int(row["RULE_COUNT"]) - (int(row["ZERO_COUNT"]) if exclude_zero else 0)
        total = sum(value for count, value in facets.items() if condition_count == "ALL" or count == int(condition_count))
        rules = []
        if view == "rules" and index_sql:
            keys = _query(cursor, "EDITING_INDEX_PAGE", {**params, "source": source, "family": family,
                          "allConditions": "Y" if condition_count == "ALL" else "N",
                          "conditionCount": -1 if condition_count == "ALL" else int(condition_count),
                          "excludeZero": "Y" if exclude_zero else "N", "offset": (page - 1) * page_size, "pageSize": page_size}, index_sql=index_sql)
            rules = _page_rules(cursor, params, keys, result_owner)
            _attach_column_comments(cursor, rules)
            diagnostics["ruleRowsFetched"] = len(rules)
        return {"status": "success", "data": {"view": view, "family": family, "source": source,
                "total": total, "page": page, "pageSize": page_size, "hasMore": page * page_size < total,
                "rules": rules, "summary": summary, "diagnostics": diagnostics,
                "filters": {"conditionCount": condition_count, "excludeZero": bool(exclude_zero)},
                "conditionCounts": [{"value": str(key), "count": value} for key, value in sorted(facets.items())]}}
