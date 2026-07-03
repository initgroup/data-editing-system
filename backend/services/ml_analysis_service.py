"""
WAS-side machine learning analysis helpers.

The target DB stores source data and result tables. Heavy Python algorithms run
in the FastAPI process so Oracle Cloud environments that cannot use OML4Py can
still execute feature selection and symbolic rule discovery.
"""

from fastapi import HTTPException
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
import json
import math
import re

try:
    import numpy as np
    from sklearn.linear_model import Lasso, LassoCV
    from sklearn.metrics import r2_score
    from sklearn.preprocessing import PolynomialFeatures, StandardScaler
except Exception:  # pragma: no cover - dependency availability is runtime-specific.
    np = None
    Lasso = None
    LassoCV = None
    PolynomialFeatures = None
    StandardScaler = None
    r2_score = None


WEB_API_METHODS = {
    "LASSO_FEATURE_SELECT",
    "SYMBOLIC_REGRESSION_RULE",
}


def execute_web_api_job(
    conn,
    job: Dict[str, Any],
    runtime_values: Optional[Dict[str, Any]] = None,
    run_id: Optional[int] = None,
) -> str:
    method = normalize_method(
        job.get("EXEC_METHOD")
        or job.get("execMethod")
        or get_method_from_spec(job.get("EXEC_SPEC_JSON") or job.get("execSpecJson"))
        or job.get("EXEC_OBJECT_NAME")
    )
    payload = build_payload(job, runtime_values or {}, run_id)
    if method == "LASSO_FEATURE_SELECT":
        result = run_lasso_feature_select(conn, payload)
        if result.get("targetCount"):
            return (
                f"LASSO auto feature selection completed. "
                f"{result['successCount']}/{result['targetCount']} target column(s), "
                f"{result['selectedCount']} selected / {result['candidateCount']} candidate feature(s)."
            )
        return (
            f"LASSO feature selection completed. "
            f"{result['selectedCount']} selected / {result['candidateCount']} candidate feature(s)."
        )
    if method == "SYMBOLIC_REGRESSION_RULE":
        result = run_symbolic_regression_rule(conn, payload)
        if result.get("targetCount"):
            return (
                f"Symbolic regression auto rule discovery completed. "
                f"{result['successCount']}/{result['targetCount']} target column(s), "
                f"{result['featureCount']} feature(s)."
            )
        return (
            f"Symbolic regression rule discovery completed. "
            f"{result['featureCount']} feature(s), method={result['method']}."
        )
    raise HTTPException(status_code=400, detail=f"Unsupported WEB_API method: {method}")


def get_method_from_spec(value: Any) -> str:
    try:
        spec = json.loads(str(value or "").strip() or "{}")
    except Exception:
        return ""
    if not isinstance(spec, dict):
        return ""
    method = spec.get("method") or spec.get("execMethod")
    if method:
        return str(method)
    endpoint = str(spec.get("serviceUrl") or spec.get("endpoint") or "").lower()
    if endpoint.endswith("/lasso-feature-select"):
        return "LASSO_FEATURE_SELECT"
    if endpoint.endswith("/symbolic-regression-rule"):
        return "SYMBOLIC_REGRESSION_RULE"
    return ""


def run_lasso_feature_select(conn, payload: Dict[str, Any]) -> Dict[str, Any]:
    require_sklearn()
    owner = require_identifier(get_value(payload, "P_TARGET_OWNER", "targetOwner", "owner"), "targetOwner")
    table = require_identifier(get_value(payload, "P_TARGET_TABLE", "targetTable", "tableName"), "targetTable")
    target_column_value = get_value(payload, "P_TARGET_COLUMN", "targetColumn")
    run_source_type = normalize_run_source_type(get_value(payload, "P_RUN_SOURCE_TYPE", "runSourceType"))
    run_id = parse_int(get_value(payload, "P_RUN_ID", "runId"), 0)
    max_features = clamp(parse_int(get_value(payload, "P_MAX_FEATURES", "maxFeatures"), 10), 1, 50)
    sample_rows = parse_optional_positive_int(get_value(payload, "P_SAMPLE_ROWS", "sampleRows"), 100000)
    alpha = parse_optional_float(get_value(payload, "P_ALPHA", "alpha"))

    if is_auto_target(target_column_value):
        max_auto_targets = clamp(parse_int(get_value(payload, "P_MAX_AUTO_TARGETS", "maxAutoTargets"), 10), 1, 100)
        continue_on_error = parse_yes_no(get_value(payload, "P_CONTINUE_ON_ERROR", "continueOnError"), "Y") == "Y"
        continuous_columns = load_predicted_continuous_columns(conn, owner, table)
        target_columns = continuous_columns[:max_auto_targets]
        if not target_columns:
            raise HTTPException(status_code=400, detail="No FINAL_PREDICTED_TYPE continuous columns found for auto LASSO target selection.")
        return run_lasso_auto_targets(conn, payload, target_columns, continue_on_error, continuous_columns)

    target_column = require_identifier(target_column_value, "targetColumn")

    candidates = normalize_column_list(get_value(payload, "P_CANDIDATE_COLUMNS", "candidateColumns"))
    if not candidates:
        candidates = load_predicted_continuous_columns(conn, owner, table, exclude={target_column})
    if not candidates:
        candidates = load_numeric_corr_candidates(conn, owner, table, target_column, run_source_type, run_id, max(50, max_features * 5))
    candidates = [column for column in candidates if column != target_column]
    if not candidates:
        raise HTTPException(status_code=400, detail="No numeric candidate features were found for LASSO.")

    x_values, y_values, used_features = fetch_numeric_matrix(conn, owner, table, target_column, candidates, sample_rows)
    if len(y_values) < 10:
        raise HTTPException(status_code=400, detail="LASSO requires at least 10 complete numeric rows.")

    x_scaler = StandardScaler()
    y_scaler = StandardScaler()
    x_scaled = x_scaler.fit_transform(x_values)
    y_scaled = y_scaler.fit_transform(y_values.reshape(-1, 1)).ravel()

    if alpha is not None and alpha > 0:
        model = Lasso(alpha=alpha, max_iter=10000, random_state=42)
        model.fit(x_scaled, y_scaled)
        model_alpha = float(alpha)
    else:
        cv = min(5, max(2, len(y_scaled) // 5))
        model = LassoCV(cv=cv, max_iter=10000, random_state=42)
        model.fit(x_scaled, y_scaled)
        model_alpha = float(model.alpha_)

    coefficients = [float(value) for value in model.coef_]
    scored = sorted(
        [
            {
                "feature": feature,
                "coefficient": coef,
                "absCoefficient": abs(coef),
            }
            for feature, coef in zip(used_features, coefficients)
        ],
        key=lambda row: (-row["absCoefficient"], row["feature"]),
    )
    selected = [row for row in scored if row["absCoefficient"] > 0][:max_features]
    selected_names = {row["feature"] for row in selected}
    score = float(model.score(x_scaled, y_scaled))
    message = f"rows={len(y_scaled)}, alpha={model_alpha}, selected={len(selected_names)}"

    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            DELETE FROM "INIT$_TB_LASSO_FEATURE"
             WHERE "RUN_SOURCE_TYPE" = :runSourceType
               AND "RUN_ID" = :runId
               AND "OWNER" = :owner
               AND "TABLE_NAME" = :tableName
               AND "TARGET_COLUMN" = :targetColumn
            """,
            {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
                "targetColumn": target_column,
            },
        )
        insert_sql = """
            INSERT INTO "INIT$_TB_LASSO_FEATURE" (
                "RUN_SOURCE_TYPE"
              , "RUN_ID"
              , "OWNER"
              , "TABLE_NAME"
              , "TARGET_COLUMN"
              , "FEATURE_NAME"
              , "COEFFICIENT"
              , "ABS_COEFFICIENT"
              , "RANK_NO"
              , "SELECTED_YN"
              , "MODEL_ALPHA"
              , "R2_SCORE"
              , "MESSAGE"
              , "CREATE_DT"
            ) VALUES (
                :runSourceType
              , :runId
              , :owner
              , :tableName
              , :targetColumn
              , :featureName
              , :coefficient
              , :absCoefficient
              , :rankNo
              , :selectedYn
              , :modelAlpha
              , :r2Score
              , :message
              , SYSDATE
            )
        """
        for rank_no, row in enumerate(scored, start=1):
            cursor.execute(insert_sql, {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
                "targetColumn": target_column,
                "featureName": row["feature"],
                "coefficient": row["coefficient"],
                "absCoefficient": row["absCoefficient"],
                "rankNo": rank_no,
                "selectedYn": "Y" if row["feature"] in selected_names else "N",
                "modelAlpha": model_alpha,
                "r2Score": score,
                "message": message,
            })
    finally:
        cursor.close()

    return {
        "status": "success",
        "candidateCount": len(scored),
        "selectedCount": len(selected_names),
        "r2Score": score,
        "alpha": model_alpha,
    }


def run_symbolic_regression_rule(conn, payload: Dict[str, Any]) -> Dict[str, Any]:
    require_sklearn()
    owner = require_identifier(get_value(payload, "P_TARGET_OWNER", "targetOwner", "owner"), "targetOwner")
    table = require_identifier(get_value(payload, "P_TARGET_TABLE", "targetTable", "tableName"), "targetTable")
    target_column_value = get_value(payload, "P_TARGET_COLUMN", "targetColumn")
    run_source_type = normalize_run_source_type(get_value(payload, "P_RUN_SOURCE_TYPE", "runSourceType"))
    run_id = parse_int(get_value(payload, "P_RUN_ID", "runId"), 0)
    max_features = clamp(parse_int(get_value(payload, "P_MAX_FEATURES", "maxFeatures"), 10), 1, 10)
    sample_rows = parse_optional_positive_int(get_value(payload, "P_SAMPLE_ROWS", "sampleRows"), 50000)
    max_iterations = clamp(parse_int(get_value(payload, "P_MAX_ITERATIONS", "maxIterations"), 10000), 100, 100000)
    min_r2_score = clamp_float(parse_optional_float(get_value(payload, "P_MIN_R2_SCORE", "minR2Score")), 0.7, 0.0, 1.0)

    if is_auto_target(target_column_value):
        max_auto_targets = clamp(parse_int(get_value(payload, "P_MAX_AUTO_TARGETS", "maxAutoTargets"), 10), 1, 100)
        continue_on_error = parse_yes_no(get_value(payload, "P_CONTINUE_ON_ERROR", "continueOnError"), "Y") == "Y"
        target_columns = load_lasso_target_columns(conn, owner, table, run_source_type, run_id, min_r2_score, max_auto_targets)
        if not target_columns:
            raise HTTPException(status_code=400, detail=f"No LASSO selected target columns found for auto symbolic regression. Required SELECTED_YN=Y and R2_SCORE >= {min_r2_score}.")
        return run_symbolic_auto_targets(conn, payload, target_columns, continue_on_error)

    target_column = require_identifier(target_column_value, "targetColumn")

    features = normalize_column_list(get_value(payload, "P_FEATURE_COLUMNS", "featureColumns"))
    if not features:
        features = load_lasso_selected_features(conn, owner, table, target_column, run_source_type, run_id, min_r2_score, max_features)
    if not features:
        raise HTTPException(status_code=400, detail=f"No LASSO selected features were found for symbolic regression. Required SELECTED_YN=Y and R2_SCORE >= {min_r2_score}.")
    features = features[:max_features]

    x_values, y_values, used_features = fetch_numeric_matrix(conn, owner, table, target_column, features, sample_rows)
    if len(y_values) < 10:
        raise HTTPException(status_code=400, detail="Symbolic regression requires at least 10 complete numeric rows.")

    expression, score, complexity, method, message = fit_symbolic_expression(
        x_values,
        y_values,
        used_features,
        max_iterations,
    )
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            DELETE FROM "INIT$_TB_SYMBOLIC_RULE"
             WHERE "RUN_SOURCE_TYPE" = :runSourceType
               AND "RUN_ID" = :runId
               AND "OWNER" = :owner
               AND "TABLE_NAME" = :tableName
               AND "TARGET_COLUMN" = :targetColumn
            """,
            {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
                "targetColumn": target_column,
            },
        )
        cursor.execute(
            """
            INSERT INTO "INIT$_TB_SYMBOLIC_RULE" (
                "RUN_SOURCE_TYPE"
              , "RUN_ID"
              , "OWNER"
              , "TABLE_NAME"
              , "TARGET_COLUMN"
              , "RULE_ID"
              , "EXPRESSION"
              , "SCORE"
              , "COMPLEXITY"
              , "RANK_NO"
              , "SELECTED_YN"
              , "FEATURE_COLUMNS"
              , "METHOD"
              , "MESSAGE"
              , "CREATE_DT"
            ) VALUES (
                :runSourceType
              , :runId
              , :owner
              , :tableName
              , :targetColumn
              , :ruleId
              , :expression
              , :score
              , :complexity
              , :rankNo
              , 'Y'
              , :featureColumns
              , :method
              , :message
              , SYSDATE
            )
            """,
            {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
                "targetColumn": target_column,
                "ruleId": "RULE_001",
                "expression": expression,
                "score": score,
                "complexity": complexity,
                "rankNo": 1,
                "featureColumns": ",".join(used_features),
                "method": method,
                "message": message,
            },
        )
    finally:
        cursor.close()

    return {
        "status": "success",
        "featureCount": len(used_features),
        "method": method,
        "score": score,
    }


def run_lasso_auto_targets(
    conn,
    payload: Dict[str, Any],
    target_columns: Sequence[str],
    continue_on_error: bool,
    continuous_columns: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    results = []
    failures = []
    feature_pool = [str(column).upper() for column in (continuous_columns or [])]
    for target_column in target_columns:
        next_payload = dict(payload)
        next_payload["P_TARGET_COLUMN"] = target_column
        next_payload["targetColumn"] = target_column
        if feature_pool:
            next_payload["P_CANDIDATE_COLUMNS"] = [column for column in feature_pool if column != target_column]
            next_payload["candidateColumns"] = next_payload["P_CANDIDATE_COLUMNS"]
        try:
            result = run_lasso_feature_select(conn, next_payload)
            results.append({"targetColumn": target_column, **result})
        except Exception as exc:
            failures.append({"targetColumn": target_column, "message": get_error_message(exc)})
            if not continue_on_error:
                raise

    if not results:
        detail = "; ".join(f"{item['targetColumn']}: {item['message']}" for item in failures) or "No auto target succeeded."
        raise HTTPException(status_code=400, detail=detail)

    return {
        "status": "partial_success" if failures else "success",
        "targetCount": len(target_columns),
        "successCount": len(results),
        "failedCount": len(failures),
        "failedTargets": failures,
        "candidateCount": sum(int(item.get("candidateCount") or 0) for item in results),
        "selectedCount": sum(int(item.get("selectedCount") or 0) for item in results),
        "targets": results,
    }


def run_symbolic_auto_targets(conn, payload: Dict[str, Any], target_columns: Sequence[str], continue_on_error: bool) -> Dict[str, Any]:
    results = []
    failures = []
    for target_column in target_columns:
        next_payload = dict(payload)
        next_payload["P_TARGET_COLUMN"] = target_column
        next_payload["targetColumn"] = target_column
        try:
            result = run_symbolic_regression_rule(conn, next_payload)
            results.append({"targetColumn": target_column, **result})
        except Exception as exc:
            failures.append({"targetColumn": target_column, "message": get_error_message(exc)})
            if not continue_on_error:
                raise

    if not results:
        detail = "; ".join(f"{item['targetColumn']}: {item['message']}" for item in failures) or "No auto target succeeded."
        raise HTTPException(status_code=400, detail=detail)

    return {
        "status": "partial_success" if failures else "success",
        "targetCount": len(target_columns),
        "successCount": len(results),
        "failedCount": len(failures),
        "failedTargets": failures,
        "featureCount": sum(int(item.get("featureCount") or 0) for item in results),
        "method": "AUTO",
        "targets": results,
    }


def fit_symbolic_expression(
    x_values,
    y_values,
    feature_names: Sequence[str],
    max_iterations: int,
) -> Tuple[str, float, int, str, str]:
    try:
        from pysr import PySRRegressor

        model = PySRRegressor(
            niterations=max_iterations,
            binary_operators=["+", "-", "*", "/"],
            unary_operators=["square"],
            maxsize=20,
            verbosity=0,
            random_state=42,
        )
        model.fit(x_values, y_values, variable_names=list(feature_names))
        best = model.get_best()
        expression = str(best.get("sympy_format") or best.get("equation") or model)
        score = float(best.get("score") or 0)
        complexity = int(best.get("complexity") or len(expression))
        return expression, score, complexity, "PYSR", "PySR symbolic regression completed."
    except Exception as exc:
        return fit_polynomial_fallback(x_values, y_values, feature_names, str(exc))


def fit_polynomial_fallback(x_values, y_values, feature_names: Sequence[str], reason: str) -> Tuple[str, float, int, str, str]:
    x_scaler = StandardScaler()
    y_scaler = StandardScaler()
    x_scaled = x_scaler.fit_transform(x_values)
    y_scaled = y_scaler.fit_transform(y_values.reshape(-1, 1)).ravel()
    poly = PolynomialFeatures(degree=2, include_bias=False)
    x_poly = poly.fit_transform(x_scaled)
    names = poly.get_feature_names_out(feature_names)
    cv = min(5, max(2, len(y_scaled) // 5))
    model = LassoCV(cv=cv, max_iter=10000, random_state=42)
    model.fit(x_poly, y_scaled)
    prediction = model.predict(x_poly)
    score = float(r2_score(y_scaled, prediction))
    terms = []
    for coef, name in sorted(zip(model.coef_, names), key=lambda item: -abs(float(item[0])))[:12]:
        coef = float(coef)
        if abs(coef) <= 1.0e-8:
            continue
        terms.append(f"{coef:.6g}*{format_feature_term(name)}")
    intercept = float(model.intercept_)
    expression = f"{intercept:.6g}"
    if terms:
        expression += " + " + " + ".join(terms)
    complexity = len(terms) + 1
    message = "PySR was unavailable or failed; polynomial LASSO fallback was used."
    if reason:
        message = f"{message} First PySR error: {reason[:500]}"
    return expression, score, complexity, "POLYNOMIAL_LASSO_FALLBACK", message


def build_payload(job: Dict[str, Any], runtime_values: Dict[str, Any], run_id: Optional[int]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    for item in parse_params(job.get("PARAMS") or job.get("params") or job.get("PARAM_JSON")):
        key = item.get("itemName") or item.get("ITEM_NAME") or item.get("name") or item.get("key")
        if not key:
            continue
        payload[str(key)] = item.get("value", item.get("VALUE", item.get("itemDefault", item.get("ITEM_DEFAULT"))))

    runtime_values = runtime_values or {}
    payload.update(runtime_values)
    for key, value in list(payload.items()):
        payload[key] = resolve_runtime_reference(value, runtime_values)
    payload.setdefault("P_TARGET_OWNER", job.get("OWNER_NAME") or job.get("ownerName"))
    payload.setdefault("P_TARGET_TABLE", job.get("TABLE_NAME") or job.get("tableName"))
    payload.setdefault("P_RUN_SOURCE_TYPE", runtime_values.get("INIT$RunSourceType") or runtime_values.get("runSourceType") or "DATA_WORK")
    payload.setdefault("P_RUN_ID", runtime_values.get("INIT$RunId") or runtime_values.get("runId") or run_id or 0)
    return payload


def resolve_runtime_reference(value: Any, runtime_values: Dict[str, Any]) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text.startswith(":"):
        return value
    key = text[1:]
    resolved = runtime_values.get(key)
    if resolved is None:
        resolved = runtime_values.get(to_camel_key(key))
    return value if resolved is None else resolved


def parse_params(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def load_predicted_continuous_columns(
    conn,
    owner: str,
    table: str,
    exclude: Optional[Set[str]] = None,
) -> List[str]:
    excluded = {str(column).upper() for column in (exclude or set())}
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT "COLUMN_NAME"
              FROM "INIT$_TB_PREDICTED_TYPE_FINAL"
             WHERE "OWNER" = :owner
               AND "TABLE_NAME" = :tableName
               AND TRIM("FINAL_PREDICTED_TYPE") LIKE '%연속형'
             ORDER BY "COLUMN_ID" NULLS LAST
                    , "COLUMN_NAME"
            """,
            {
                "owner": owner,
                "tableName": table,
            },
        )
        result = []
        for row in cursor.fetchall():
            column = str(row[0]).upper()
            if column not in excluded:
                result.append(column)
        return result
    finally:
        cursor.close()


def load_numeric_corr_candidates(
    conn,
    owner: str,
    table: str,
    target_column: str,
    run_source_type: str,
    run_id: int,
    limit: int,
) -> List[str]:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT CASE
                       WHEN "COL_A" = :targetColumn THEN "COL_B"
                       ELSE "COL_A"
                   END AS "COLUMN_NAME"
              FROM "INIT$_TB_NUM_CORR_PAIR"
             WHERE "RUN_SOURCE_TYPE" = :runSourceType
               AND "RUN_ID" = :runId
               AND "OWNER" = :owner
               AND "TABLE_NAME" = :tableName
               AND "PASS_YN" = 'Y'
               AND ("COL_A" = :targetColumn OR "COL_B" = :targetColumn)
             ORDER BY "ABS_PEARSON_R" DESC NULLS LAST
                    , "COLUMN_NAME"
            """,
            {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
                "targetColumn": target_column,
            },
        )
        result = [str(row[0]).upper() for row in cursor.fetchmany(limit)]
        if result:
            return result

        cursor.execute(
            """
            SELECT "COLUMN_NAME"
              FROM "INIT$_TB_NUM_CORR_SUMMARY"
             WHERE "RUN_SOURCE_TYPE" = :runSourceType
               AND "RUN_ID" = :runId
               AND "OWNER" = :owner
               AND "TABLE_NAME" = :tableName
               AND "COLUMN_NAME" <> :targetColumn
               AND "SELECTED_YN" = 'Y'
             ORDER BY "RANK_NO" NULLS LAST
                    , "MAX_ABS_PEARSON_R" DESC NULLS LAST
                    , "COLUMN_NAME"
            """,
            {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
                "targetColumn": target_column,
            },
        )
        return [str(row[0]).upper() for row in cursor.fetchmany(limit)]
    finally:
        cursor.close()


def load_auto_corr_target_columns(
    conn,
    owner: str,
    table: str,
    run_source_type: str,
    run_id: int,
    limit: int,
) -> List[str]:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT COLUMN_NAME
              FROM (
                    SELECT COLUMN_NAME
                         , MAX(SORT_SCORE) AS SORT_SCORE
                      FROM (
                            SELECT "COL_A" AS COLUMN_NAME
                                 , "ABS_PEARSON_R" AS SORT_SCORE
                              FROM "INIT$_TB_NUM_CORR_PAIR"
                             WHERE "RUN_SOURCE_TYPE" = :runSourceType
                               AND "RUN_ID" = :runId
                               AND "OWNER" = :owner
                               AND "TABLE_NAME" = :tableName
                               AND "PASS_YN" = 'Y'
                            UNION ALL
                            SELECT "COL_B" AS COLUMN_NAME
                                 , "ABS_PEARSON_R" AS SORT_SCORE
                              FROM "INIT$_TB_NUM_CORR_PAIR"
                             WHERE "RUN_SOURCE_TYPE" = :runSourceType
                               AND "RUN_ID" = :runId
                               AND "OWNER" = :owner
                               AND "TABLE_NAME" = :tableName
                               AND "PASS_YN" = 'Y'
                           )
                     GROUP BY COLUMN_NAME
                   )
             ORDER BY SORT_SCORE DESC NULLS LAST
                    , COLUMN_NAME
            """,
            {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
            },
        )
        return [str(row[0]).upper() for row in cursor.fetchmany(limit)]
    finally:
        cursor.close()


def load_lasso_target_columns(
    conn,
    owner: str,
    table: str,
    run_source_type: str,
    run_id: int,
    min_r2_score: float,
    limit: int,
) -> List[str]:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT "TARGET_COLUMN"
              FROM "INIT$_TB_LASSO_FEATURE"
             WHERE "RUN_SOURCE_TYPE" = :runSourceType
               AND "RUN_ID" = :runId
               AND "OWNER" = :owner
               AND "TABLE_NAME" = :tableName
               AND "SELECTED_YN" = 'Y'
               AND NVL("R2_SCORE", -1) >= :minR2Score
             GROUP BY "TARGET_COLUMN"
             ORDER BY MAX("R2_SCORE") DESC NULLS LAST
                    , MIN("RANK_NO") NULLS LAST
                    , MAX("ABS_COEFFICIENT") DESC NULLS LAST
                    , "TARGET_COLUMN"
            """,
            {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
                "minR2Score": min_r2_score,
            },
        )
        return [str(row[0]).upper() for row in cursor.fetchmany(limit)]
    finally:
        cursor.close()


def load_lasso_selected_features(
    conn,
    owner: str,
    table: str,
    target_column: str,
    run_source_type: str,
    run_id: int,
    min_r2_score: float,
    limit: int,
) -> List[str]:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT "FEATURE_NAME"
              FROM "INIT$_TB_LASSO_FEATURE"
             WHERE "RUN_SOURCE_TYPE" = :runSourceType
               AND "RUN_ID" = :runId
               AND "OWNER" = :owner
               AND "TABLE_NAME" = :tableName
               AND "TARGET_COLUMN" = :targetColumn
               AND "SELECTED_YN" = 'Y'
               AND NVL("R2_SCORE", -1) >= :minR2Score
             ORDER BY "RANK_NO" NULLS LAST, "ABS_COEFFICIENT" DESC NULLS LAST, "FEATURE_NAME"
            """,
            {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
                "targetColumn": target_column,
                "minR2Score": min_r2_score,
            },
        )
        return [str(row[0]).upper() for row in cursor.fetchmany(limit)]
    finally:
        cursor.close()


def load_numeric_table_columns(conn, owner: str, table: str, exclude: Set[str], limit: int) -> List[str]:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT COLUMN_NAME
              FROM ALL_TAB_COLUMNS
             WHERE OWNER = :owner
               AND TABLE_NAME = :tableName
               AND DATA_TYPE IN ('NUMBER', 'FLOAT', 'BINARY_FLOAT', 'BINARY_DOUBLE')
             ORDER BY COLUMN_ID
            """,
            {"owner": owner, "tableName": table},
        )
        result = []
        for row in cursor.fetchall():
            column = str(row[0]).upper()
            if column not in exclude:
                result.append(column)
            if len(result) >= limit:
                break
        return result
    finally:
        cursor.close()


def fetch_numeric_matrix(
    conn,
    owner: str,
    table: str,
    target_column: str,
    feature_columns: Sequence[str],
    sample_rows: Optional[int],
):
    columns = [target_column] + list(feature_columns)
    select_list = ", ".join(quote_identifier(column) for column in columns)
    null_filter = " AND ".join(f"{quote_identifier(column)} IS NOT NULL" for column in columns)
    sql = (
        f"SELECT {select_list}\n"
        f"  FROM {quote_identifier(owner)}.{quote_identifier(table)}\n"
        f" WHERE {null_filter}"
    )
    binds = {}
    if sample_rows:
        sql += "\n   AND ROWNUM <= :sampleRows"
        binds["sampleRows"] = int(sample_rows)

    cursor = conn.cursor()
    try:
        cursor.execute(sql, binds)
        x_rows = []
        y_rows = []
        for row in cursor.fetchall():
            values = [to_float(value) for value in row]
            if any(value is None or not math.isfinite(value) for value in values):
                continue
            y_rows.append(values[0])
            x_rows.append(values[1:])
        if not y_rows:
            raise HTTPException(status_code=400, detail="No complete numeric rows were found.")
        return np.asarray(x_rows, dtype=float), np.asarray(y_rows, dtype=float), list(feature_columns)
    finally:
        cursor.close()


def require_sklearn() -> None:
    if np is None or LassoCV is None or StandardScaler is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Python ML dependencies are not installed. Install numpy and scikit-learn in the WAS environment."
            ),
        )


def get_value(payload: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
        alt = to_camel_key(key)
        if alt in payload and payload[alt] not in (None, ""):
            return payload[alt]
    return None


def to_camel_key(value: str) -> str:
    text = str(value or "")
    if text.startswith("P_"):
        text = text[2:]
    parts = [part.lower() for part in text.split("_") if part]
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:]) if parts else text


def normalize_method(value: Any) -> str:
    method = str(value or "").strip().upper()
    method = re.sub(r"[^A-Z0-9_]", "_", method)
    if method not in WEB_API_METHODS:
        raise HTTPException(status_code=400, detail=f"Invalid WEB_API method: {method or '(blank)'}")
    return method


def normalize_run_source_type(value: Any) -> str:
    text = str(value or "DATA_WORK").strip().upper()
    return "FLOW_WORK" if text == "FLOW_WORK" else "DATA_WORK"


def is_auto_target(value: Any) -> bool:
    return str(value or "").strip().lower() == "(auto)"


def parse_yes_no(value: Any, default: str = "N") -> str:
    text = str(value if value not in (None, "") else default).strip().upper()
    return "Y" if text in {"Y", "YES", "TRUE", "1"} else "N"


def get_error_message(exc: Exception) -> str:
    detail = getattr(exc, "detail", None)
    if detail:
        return str(detail)
    return str(exc) or exc.__class__.__name__


def normalize_column_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        items = value
    else:
        items = re.split(r"[,;\s]+", str(value or ""))
    result = []
    for item in items:
        text = str(item or "").strip().upper()
        if not text:
            continue
        result.append(require_identifier(text, "column"))
    return list(dict.fromkeys(result))


def require_identifier(value: Any, field_name: str) -> str:
    text = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#]{0,127}", text):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return text


def quote_identifier(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def parse_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_optional_positive_int(value: Any, default: int) -> Optional[int]:
    parsed = parse_int(value, default)
    return parsed if parsed > 0 else None


def parse_optional_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def clamp_float(value: Optional[float], default: float, minimum: float, maximum: float) -> float:
    parsed = default if value is None else float(value)
    return max(minimum, min(maximum, parsed))


def to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def format_feature_term(name: str) -> str:
    return str(name).replace(" ", "*").replace("^", "**")
