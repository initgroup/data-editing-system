"""Read-only, execution-scoped plots evaluated from a saved mixed formula AST."""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import logging
import math

from fastapi import HTTPException

from backend.auth_context import get_request_role_code, get_request_user_id
from backend.target_database import get_target_db_connection
from backend.services import mixed_xai_service as xai
from backend.services import mixed_pattern_service as patterns
from backend.services.mixed_formula import compile_expression, number
from backend.services.mixed_numeric import numeric_text_sql


logger = logging.getLogger(__name__)
SCAN_LIMIT = 5000
SAMPLE_LIMIT = 300


def _decimal(value):
    try:
        converted = Decimal(str(value)) if value is not None else None
        return converted if converted is not None and converted.is_finite() else None
    except (ValueError, InvalidOperation):
        return None


def _raw(value):
    return None if value is None else str(value)[:256]


def _spread(rows, count):
    if count >= len(rows):
        return rows
    if count <= 0:
        return []
    if count == 1:
        return [rows[len(rows) // 2]]
    return [rows[round(index * (len(rows) - 1) / (count - 1))] for index in range(count)]


def _balanced(normal, violations, limit):
    if normal and violations:
        violation_count = min(len(violations), max(1, limit // 2))
        normal_count = min(len(normal), limit - violation_count)
        violation_count = min(len(violations), limit - normal_count)
    else:
        normal_count = min(len(normal), limit)
        violation_count = min(len(violations), limit - normal_count)
    return sorted(_spread(normal, normal_count) + _spread(violations, violation_count), key=lambda row: row.pop("_order"))


def read_formula_sample(conn, *, flow_run_id, owner, table, model_name, rule_id, user_id,
                        include_all_users=False, sample_limit=SAMPLE_LIMIT):
    params = {"runId": flow_run_id, "owner": owner, "tableName": table,
              "modelName": model_name, "ruleId": rule_id}
    with conn.cursor() as cursor:
        xai._execute(cursor, "XAI_FLOW_ACCESS", {"runId": flow_run_id, "userId": user_id,
                                               "includeAllUsers": "Y" if include_all_users else "N"})
        if not cursor.fetchone():
            raise HTTPException(404, "Flow run was not found in your project.")
        patterns.require_schema(cursor)
        xai._execute(cursor, "PATTERN_FORMULA_SAMPLE_RULE", params)
        records = xai._rows(cursor)
        if not records:
            raise HTTPException(404, "The saved mixed formula was not found for this execution and target.")
        if len(records) != 1:
            raise HTTPException(409, "The saved formula identity is ambiguous. Reload the execution results.")
        rule = records[0]
        if rule.get("RESULT_KIND") != "FORMULA":
            raise HTTPException(409, "Only a saved continuous formula can provide formula chart samples.")
        result = xai._json_object(rule["RESULT_JSON"], "RESULT_JSON")
        context = {"owner": owner, "tableName": table}
        columns = xai._columns(cursor, context)
        try:
            condition, consequence, _, binds = patterns.compile_violation(rule, columns, prefix="chart")
            prediction, prediction_binds, predictors = compile_expression(result["expression"], columns,
                prefix="chartprediction", forbidden_column=rule["RESULT_COLUMN"])
        except HTTPException as error:
            if error.status_code == 400:
                raise HTTPException(409, "The stored formula no longer matches the current source columns.") from error
            raise
        binds.update(prediction_binds)
        target = rule["RESULT_COLUMN"]
        actual = "T." + xai.ml.quote_identifier(target)
        actual = numeric_text_sql(actual) if result.get("numericText") is True else actual
        needed = {target, *predictors, *(node["column"] for node in xai._atomic_nodes(
            xai._json_object(rule["CONDITION_JSON"], "CONDITION_JSON")))}
        known = {column["COLUMN_NAME"] for column in columns}
        if "FILE_ROW_NO" in known:
            needed.add("FILE_ROW_NO")
        row_alias = "INIT_CHART_ROWID"
        while row_alias in known:
            row_alias += "_X"
        quoted_alias = xai.ml.quote_identifier(row_alias)
        input_names = sorted(predictors)
        replacements = {
            "targetObject": xai.ml.quote_identifier(owner) + "." + xai.ml.quote_identifier(table),
            "rowAlias": quoted_alias,
            "sourceColumns": "\n             , ".join("Q." + xai.ml.quote_identifier(name) for name in sorted(needed)),
            "caseIdExpression": 'TO_CHAR(T."FILE_ROW_NO")' if "FILE_ROW_NO" in known else "T." + quoted_alias,
            "actualRawExpression": "T." + xai.ml.quote_identifier(target),
            "actualNumericExpression": actual,
            "formulaExpression": prediction,
            "conditionExpression": condition,
            "resultExpression": consequence,
            "inputProjection": "".join("\n     , T." + xai.ml.quote_identifier(name) + f' AS "CHART_INPUT_{index}"'
                                       for index, name in enumerate(input_names)),
        }
        sql = xai.SqlLoader.get_sql("PATTERN_FORMULA_SAMPLE_ROWS")
        for key, value in replacements.items():
            sql = sql.replace("{" + key + "}", value)
        cursor.execute(sql, {**binds, "scanLimit": SCAN_LIMIT + 1})
        output_names = [column[0].upper() for column in cursor.description or []]
        normal, violations = [], []
        skipped = {"conditionFalse": 0, "nullActual": 0, "invalidActual": 0, "nonFinitePrediction": 0}
        scanned = applicable = normal_count = violation_count = 0
        scan_capped = False
        absolute, relative = number(result["absoluteTolerance"]), number(result.get("relativeTolerance", 0))
        while True:
            batch = cursor.fetchmany(100)
            if not batch:
                break
            for values in batch:
                if scanned == SCAN_LIMIT:
                    scan_capped = True
                    break
                scanned += 1
                row = dict(zip(output_names, values))
                if not row["APPLICABLE_YN"]:
                    skipped["conditionFalse"] += 1
                    continue
                applicable += 1
                violation = not bool(row["RESULT_VALID_YN"])
                violation_count += int(violation)
                normal_count += int(not violation)
                actual_value, predicted = _decimal(row["ACTUAL_VALUE"]), _decimal(row["PREDICTED_VALUE"])
                if row["ACTUAL_RAW"] is None or row["ACTUAL_RAW"] == "":
                    skipped["nullActual"] += 1
                    continue
                if actual_value is None:
                    skipped["invalidActual"] += 1
                    continue
                if predicted is None:
                    skipped["nonFinitePrediction"] += 1
                    continue
                tolerance = max(absolute, relative * predicted.copy_abs())
                numeric = [actual_value, predicted, predicted - tolerance, predicted + tolerance, actual_value - predicted]
                plotted = [float(value) for value in numeric]
                if not all(math.isfinite(value) for value in plotted):
                    skipped["nonFinitePrediction"] += 1
                    continue
                point = {"rowId": str(row["CASE_ID"] or row["CASE_ROWID"]), "actual": plotted[0],
                         "predicted": plotted[1], "lower": plotted[2], "upper": plotted[3], "residual": plotted[4],
                         "violation": violation, "actualRaw": _raw(row["ACTUAL_RAW"]),
                         "values": {name: _raw(row[f"CHART_INPUT_{index}"]) for index, name in enumerate(input_names)},
                         "_order": scanned}
                (violations if violation else normal).append(point)
            if scan_capped:
                break
        points = _balanced(normal, violations, sample_limit)
        sampled = len(normal) + len(violations) > len(points)
        return {"status": "success", "data": {
            "rule": {"ruleId": rule["RULE_ID"], "modelName": rule["MODEL_NAME"], "resultColumn": target,
                     "conditionText": rule["CONDITION_TEXT"], "resultText": rule["RESULT_TEXT"],
                     "absoluteTolerance": float(absolute), "relativeTolerance": float(relative)},
            "points": points, "inputColumns": input_names,
            "rowIdColumn": "FILE_ROW_NO" if "FILE_ROW_NO" in known else "ROWID",
            "source": "CURRENT_SOURCE", "sampling": "FIRST_ROWS_BALANCED",
            "evaluatedAt": datetime.now(timezone.utc).isoformat(), "scanLimit": SCAN_LIMIT,
            "sampleLimit": sample_limit, "scannedCount": scanned, "applicableCount": applicable,
            "normalCount": normal_count, "violationCount": violation_count, "skipped": skipped,
            "plottableCount": len(normal) + len(violations), "sampleCount": len(points),
            "shownNormalCount": sum(not point["violation"] for point in points),
            "shownViolationCount": sum(point["violation"] for point in points),
            "scanLimitReached": scan_capped, "isCapped": scan_capped or sampled, "hasMore": scan_capped or sampled,
        }, "total": len(points)}


def get_formula_sample(request, *, flow_run_id, target_owner, target_table, model_name, rule_id, sample_limit=300):
    owner = xai.ml.require_identifier(target_owner, "targetOwner")
    table = xai.ml.require_identifier(target_table, "targetTable")
    if not model_name:
        raise HTTPException(409, "The saved model name is required. Reload the execution results.")
    model = xai.ml.require_identifier(model_name, "modelName")
    if not isinstance(rule_id, str) or not rule_id.strip() or len(rule_id) > 128:
        raise HTTPException(400, "Invalid formula rule ID.")
    if not isinstance(flow_run_id, int) or isinstance(flow_run_id, bool) or flow_run_id <= 0:
        raise HTTPException(400, "Invalid flow run ID.")
    if not isinstance(sample_limit, int) or isinstance(sample_limit, bool) or not 2 <= sample_limit <= SAMPLE_LIMIT:
        raise HTTPException(400, "sampleLimit must be between 2 and 300.")
    conn = None
    try:
        conn = get_target_db_connection(request)
        include_all = get_request_role_code(request) == "ADMIN" and not getattr(request.state, "internal_api_user_id", None)
        return read_formula_sample(conn, flow_run_id=flow_run_id, owner=owner, table=table, model_name=model,
            rule_id=rule_id.strip(), user_id=get_request_user_id(request), include_all_users=include_all, sample_limit=sample_limit)
    except HTTPException:
        raise
    except Exception:
        logger.warning("Unable to read a mixed formula graph sample.", exc_info=False)
        raise HTTPException(500, "Unable to read the mixed formula sample from the current source.")
    finally:
        if conn:
            conn.close()
