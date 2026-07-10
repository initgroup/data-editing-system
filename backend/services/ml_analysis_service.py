"""
WAS-side machine learning analysis helpers.

The target DB stores source data and result tables. Heavy Python algorithms run
in the FastAPI process so Oracle Cloud environments that cannot use OML4Py can
still execute feature selection and symbolic rule discovery.
"""

from fastapi import HTTPException
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
import hashlib
import json
import math
import re

try:
    import numpy as np
    from sklearn.linear_model import Lasso, LassoCV, LinearRegression
    from sklearn.metrics import r2_score
    from sklearn.preprocessing import PolynomialFeatures, StandardScaler
except Exception:  # pragma: no cover - dependency availability is runtime-specific.
    np = None
    Lasso = None
    LassoCV = None
    LinearRegression = None
    PolynomialFeatures = None
    StandardScaler = None
    r2_score = None

try:
    import networkx as nx
except Exception:  # pragma: no cover - dependency availability is runtime-specific.
    nx = None


WEB_API_METHODS = {
    "LASSO_FEATURE_SELECT",
    "RELATION_NETWORK_CLUSTER",
    "SYMBOLIC_REGRESSION_RULE",
    "INTEGRATED_RULE_DISCOVER",
    "INTEGRATED_RULE_VIOLATION_DETECT",
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
    if method == "RELATION_NETWORK_CLUSTER":
        result = run_relation_network_cluster(conn, payload)
        return (
            f"Relation network clustering completed. "
            f"{result.get('nodeCount', 0)} node(s), "
            f"{result.get('edgeCount', 0)} edge(s), "
            f"{result.get('clusterCount', 0)} cluster(s)."
        )
    if method == "INTEGRATED_RULE_DISCOVER":
        result = run_integrated_rule_discover(conn, payload)
        return (
            f"Integrated rule discovery completed. "
            f"{result.get('successCount', 0)}/{result.get('taskCount', 0)} task(s) succeeded."
        )
    if method == "INTEGRATED_RULE_VIOLATION_DETECT":
        result = run_integrated_rule_violation_detect(conn, payload)
        return (
            f"Integrated rule violation detection completed. "
            f"{result.get('successCount', 0)}/{result.get('taskCount', 0)} task(s) succeeded."
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
    if endpoint.endswith("/relation-network-cluster"):
        return "RELATION_NETWORK_CLUSTER"
    if endpoint.endswith("/integrated-rule-discover"):
        return "INTEGRATED_RULE_DISCOVER"
    if endpoint.endswith("/integrated-rule-violation-detect"):
        return "INTEGRATED_RULE_VIOLATION_DETECT"
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
    use_pysr = parse_yes_no(get_value(payload, "P_USE_PYSR", "usePysr"), "N") == "Y"
    linear_first = parse_yes_no(get_value(payload, "P_LINEAR_FIRST_YN", "linearFirstYn"), "Y") == "Y"
    linear_r2_threshold = clamp_float(
        parse_optional_float(get_value(payload, "P_LINEAR_R2_THRESHOLD", "linearR2Threshold")),
        0.995,
        0.0,
        1.0,
    )

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
        use_pysr,
        linear_first,
        linear_r2_threshold,
    )
    expression = normalize_oracle_symbolic_expression(expression, used_features)
    rule_id = build_symbolic_rule_id(run_source_type, run_id, owner, table, target_column, expression, used_features)
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
                "ruleId": rule_id,
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
        "ruleId": rule_id,
    }


def run_relation_network_cluster(conn, payload: Dict[str, Any]) -> Dict[str, Any]:
    owner = require_identifier(get_value(payload, "P_TARGET_OWNER", "targetOwner", "owner"), "targetOwner")
    table = require_identifier(get_value(payload, "P_TARGET_TABLE", "targetTable", "tableName"), "targetTable")
    run_source_type = normalize_run_source_type(get_value(payload, "P_RUN_SOURCE_TYPE", "runSourceType"))
    run_id = parse_int(get_value(payload, "P_RUN_ID", "runId"), 0)
    min_metric = clamp_float(parse_optional_float(get_value(payload, "P_MIN_METRIC", "minMetric")), 0.65, 0.0, 1.0)
    max_edges = clamp(parse_int(get_value(payload, "P_MAX_EDGES", "maxEdges"), 500), 1, 10000)
    relation_types = normalize_token_list(get_value(payload, "P_RELATION_TYPES", "relationTypes"))
    metric_names = normalize_token_list(get_value(payload, "P_METRIC_NAMES", "metricNames"))

    cursor = conn.cursor()
    try:
        clear_relation_network_rows(cursor, owner, table, run_source_type, run_id)
        rows = load_relation_pairs_for_network(
            cursor,
            owner,
            table,
            run_source_type,
            run_id,
            min_metric,
            max_edges,
            relation_types,
            metric_names,
        )
        if not rows:
            return {
                "status": "success",
                "nodeCount": 0,
                "edgeCount": 0,
                "clusterCount": 0,
                "algorithm": "NONE",
                "resultTable": "INIT$_TB_RELATION_NETWORK_EDGE",
                "message": "No passed relation pairs were found for network clustering.",
            }

        edge_rows = choose_strongest_edges(rows, max_edges)
        cluster_map, node_metrics, algorithm = build_relation_network(edge_rows)
        insert_relation_network_rows(cursor, owner, table, run_source_type, run_id, edge_rows, cluster_map, node_metrics)
        update_relation_pair_clusters(cursor, owner, table, run_source_type, run_id, cluster_map)
        cluster_count = len({cluster_id for cluster_id in cluster_map.values() if cluster_id is not None})
        return {
            "status": "success",
            "nodeCount": len(node_metrics),
            "edgeCount": len(edge_rows),
            "clusterCount": cluster_count,
            "algorithm": algorithm,
            "minMetric": min_metric,
            "resultTable": "INIT$_TB_RELATION_NETWORK_EDGE",
        }
    finally:
        cursor.close()


def run_integrated_rule_discover(conn, payload: Dict[str, Any]) -> Dict[str, Any]:
    owner = require_identifier(get_value(payload, "P_TARGET_OWNER", "targetOwner", "owner"), "targetOwner")
    table = require_identifier(get_value(payload, "P_TARGET_TABLE", "targetTable", "tableName"), "targetTable")
    run_source_type = normalize_run_source_type(get_value(payload, "P_RUN_SOURCE_TYPE", "runSourceType"))
    run_id = parse_int(get_value(payload, "P_RUN_ID", "runId"), 0)
    parts = normalize_integrated_parts(get_value(payload, "P_RULE_PARTS", "ruleParts"))
    continue_on_error = parse_yes_no(get_value(payload, "P_CONTINUE_ON_ERROR", "continueOnError"), "Y") == "Y"

    results: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []

    if "CATEGORICAL" in parts:
        try:
            results.append(run_integrated_apriori_assoc_model(conn, payload, owner, table, run_source_type, run_id))
        except Exception as exc:
            failures.append({"task": "CATEGORICAL_APRIORI", "message": get_error_message(exc)})
            if not continue_on_error:
                raise

    if "CONTINUOUS" in parts:
        lasso_result = None
        try:
            lasso_payload = dict(payload)
            lasso_payload.setdefault("P_TARGET_COLUMN", "(auto)")
            lasso_payload.setdefault("targetColumn", lasso_payload["P_TARGET_COLUMN"])
            lasso_result = run_lasso_feature_select(conn, lasso_payload)
            results.append({"task": "CONTINUOUS_LASSO", "resultTable": "INIT$_TB_LASSO_FEATURE", **lasso_result})
        except Exception as exc:
            failures.append({"task": "CONTINUOUS_LASSO", "message": get_error_message(exc)})
            if not continue_on_error:
                raise

        if lasso_result is not None:
            try:
                symbolic_payload = dict(payload)
                symbolic_payload.setdefault("P_TARGET_COLUMN", "(auto)")
                symbolic_payload.setdefault("targetColumn", symbolic_payload["P_TARGET_COLUMN"])
                symbolic_result = run_symbolic_regression_rule(conn, symbolic_payload)
                results.append({"task": "CONTINUOUS_SYMBOLIC", "resultTable": "INIT$_TB_SYMBOLIC_RULE", **symbolic_result})
            except Exception as exc:
                failures.append({"task": "CONTINUOUS_SYMBOLIC", "message": get_error_message(exc)})
                if not continue_on_error:
                    raise

    if not results:
        detail = "; ".join(f"{item['task']}: {item['message']}" for item in failures) or "No integrated rule discovery task succeeded."
        raise HTTPException(status_code=400, detail=detail)

    return {
        "status": "partial_success" if failures else "success",
        "taskCount": len(results) + len(failures),
        "successCount": len(results),
        "failedCount": len(failures),
        "failedTasks": failures,
        "parts": sorted(parts),
        "resultTables": ["INIT$_TB_ASSOC_RULE_SUMMARY", "INIT$_TB_LASSO_FEATURE", "INIT$_TB_SYMBOLIC_RULE"],
        "results": results,
    }


def run_integrated_rule_violation_detect(conn, payload: Dict[str, Any]) -> Dict[str, Any]:
    owner = require_identifier(get_value(payload, "P_TARGET_OWNER", "targetOwner", "owner"), "targetOwner")
    table = require_identifier(get_value(payload, "P_TARGET_TABLE", "targetTable", "tableName"), "targetTable")
    run_source_type = normalize_run_source_type(get_value(payload, "P_RUN_SOURCE_TYPE", "runSourceType"))
    run_id = parse_int(get_value(payload, "P_RUN_ID", "runId"), 0)
    parts = normalize_integrated_parts(get_value(payload, "P_RULE_PARTS", "ruleParts"))
    continue_on_error = parse_yes_no(get_value(payload, "P_CONTINUE_ON_ERROR", "continueOnError"), "Y") == "Y"

    results: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []

    if "CATEGORICAL" in parts:
        try:
            results.append(run_integrated_assoc_rule_violation(conn, payload, owner, table, run_source_type, run_id))
        except Exception as exc:
            failures.append({"task": "CATEGORICAL_RULE_VIOLATION", "message": get_error_message(exc)})
            if not continue_on_error:
                raise

    if "CONTINUOUS" in parts:
        try:
            results.append(run_integrated_symbolic_rule_violation(conn, payload, owner, table, run_source_type, run_id))
        except Exception as exc:
            failures.append({"task": "CONTINUOUS_SYMBOLIC_VIOLATION", "message": get_error_message(exc)})
            if not continue_on_error:
                raise

    if not results:
        detail = "; ".join(f"{item['task']}: {item['message']}" for item in failures) or "No integrated violation detection task succeeded."
        raise HTTPException(status_code=400, detail=detail)

    return {
        "status": "partial_success" if failures else "success",
        "taskCount": len(results) + len(failures),
        "successCount": len(results),
        "failedCount": len(failures),
        "failedTasks": failures,
        "parts": sorted(parts),
        "resultTables": ["INIT$_TB_RULE_VIOLATION_RESULT", "INIT$_TB_SYMBOLIC_RULE_VIOLATION"],
        "results": results,
    }


def run_integrated_apriori_assoc_model(
    conn,
    payload: Dict[str, Any],
    owner: str,
    table: str,
    run_source_type: str,
    run_id: int,
) -> Dict[str, Any]:
    model_name = require_identifier(
        default_if_runtime_reference(
            get_value(payload, "P_ASSOC_MODEL_NAME", "P_MODEL_NAME", "modelName"),
            "OML_ASSOCIATION_MODEL_01",
        ),
        "associationModelName",
    )
    data_query = clean_select_query(get_value(payload, "P_DATA_QUERY", "dataQuery"))
    if not data_query:
        data_query = f"SELECT * FROM {quote_identifier(owner)}.{quote_identifier(table)}"

    case_id_column = require_identifier(
        get_value(payload, "P_CASE_ID_COLUMN_NAME", "caseIdColumnName") or "FILE_ROW_NO",
        "caseIdColumnName",
    )
    cursor = conn.cursor()
    try:
        cursor.callproc(
            "INIT$_SP_APRIORI_ASSOC_MODEL",
            [
                model_name,
                data_query,
                case_id_column,
                clamp_float(parse_optional_float(get_value(payload, "P_MIN_SUPPORT", "minSupport")), 0.2, 0.0, 1.0),
                clamp_float(parse_optional_float(get_value(payload, "P_MIN_CONFIDENCE", "minConfidence")), 0.7, 0.0, 1.0),
                clamp(parse_int(get_value(payload, "P_MAX_RULE_LENGTH", "maxRuleLength"), 3), 1, 10),
                parse_yes_no(get_value(payload, "P_DROP_EXISTING_YN", "dropExistingYn"), "Y"),
                parse_optional_positive_int(get_value(payload, "P_MAX_INPUT_ROWS", "maxInputRows"), 100000) or 0,
                clean_optional_text(get_value(payload, "P_CATEGORICAL_COLUMNS", "P_CANDIDATE_COLUMNS", "candidateColumns")),
                parse_int(get_value(payload, "P_MIN_RULE_SUPPORT_COUNT", "minRuleSupportCount"), 30),
                clamp_float(parse_optional_float(get_value(payload, "P_MIN_RULE_LIFT", "minRuleLift")), 1.0, 0.0, 999999.0),
                clamp(parse_int(get_value(payload, "P_MAX_RULE_SUMMARY_COLUMNS", "maxRuleSummaryColumns"), 50), 1, 500),
                clamp(parse_int(get_value(payload, "P_MAX_RULE_SUMMARY_PER_PAIR", "maxRuleSummaryPerPair"), 50), 1, 1000),
                owner,
                table,
                run_source_type,
                run_id,
            ],
        )
        summary_count = count_result_rows(
            cursor,
            "INIT$_TB_ASSOC_RULE_SUMMARY",
            {
                "RUN_SOURCE_TYPE": run_source_type,
                "RUN_ID": run_id,
                "TARGET_OWNER": owner,
                "TARGET_TABLE": table,
                "MODEL_NAME": model_name,
            },
        )
        return {
            "task": "CATEGORICAL_APRIORI",
            "status": "success",
            "modelName": model_name,
            "resultTable": "INIT$_TB_ASSOC_RULE_SUMMARY",
            "summaryCount": summary_count,
        }
    finally:
        cursor.close()


def run_integrated_assoc_rule_violation(
    conn,
    payload: Dict[str, Any],
    owner: str,
    table: str,
    run_source_type: str,
    run_id: int,
) -> Dict[str, Any]:
    rule_owner = require_identifier(
        default_if_runtime_reference(get_value(payload, "P_RULE_OWNER_NAME", "ruleOwnerName"), owner),
        "ruleOwnerName",
    )
    rule_model = require_identifier(
        default_if_runtime_reference(
            get_value(payload, "P_RULE_MODEL_NAME", "P_ASSOC_MODEL_NAME", "P_MODEL_NAME", "ruleModelName"),
            "OML_ASSOCIATION_MODEL_01",
        ),
        "ruleModelName",
    )
    result_owner = require_identifier(
        default_if_runtime_reference(get_value(payload, "P_CAT_RESULT_OWNER", "P_RESULT_OWNER", "resultOwner"), owner),
        "resultOwner",
    )
    result_table = require_identifier(
        default_if_runtime_reference(
            get_value(payload, "P_CAT_RESULT_TABLE", "P_RESULT_TABLE", "resultTable"),
            "INIT$_TB_RULE_VIOLATION_RESULT",
        ),
        "resultTable",
    )
    case_id_column = require_identifier(
        get_value(payload, "P_CASE_ID_COLUMN_NAME", "caseIdColumnName") or "FILE_ROW_NO",
        "caseIdColumnName",
    )
    cursor = conn.cursor()
    try:
        cursor.callproc(
            "INIT$_SP_RULE_VIOLATION_DETECT",
            [
                rule_owner,
                rule_model,
                owner,
                table,
                case_id_column,
                result_owner,
                result_table,
                clamp_float(parse_optional_float(get_value(payload, "P_MIN_CONFIDENCE", "minConfidence")), 0.8, 0.0, 1.0),
                clamp_float(parse_optional_float(get_value(payload, "P_MIN_LIFT", "minLift")), 1.0, 0.0, 999999.0),
                clamp(parse_int(get_value(payload, "P_MAX_RULES", "maxRules"), 100), 1, 10000),
                clamp(parse_int(get_value(payload, "P_MAX_VIOLATIONS_PER_RULE", "maxViolationsPerRule"), 500), 1, 100000),
                parse_yes_no(get_value(payload, "P_CLEAR_EXISTING_YN", "clearExistingYn"), "Y"),
                parse_yes_no(get_value(payload, "P_COMMIT_YN", "commitYn"), "N"),
                run_source_type,
                run_id,
                parse_int(get_value(payload, "P_COMMIT_INTERVAL", "commitInterval"), 5000),
            ],
        )
        violation_count = count_result_rows(
            cursor,
            result_table,
            {
                "RUN_SOURCE_TYPE": run_source_type,
                "RUN_ID": run_id,
                "TARGET_OWNER": owner,
                "TARGET_TABLE": table,
                "MODEL_NAME": rule_model,
            },
        )
        return {
            "task": "CATEGORICAL_RULE_VIOLATION",
            "status": "success",
            "resultTable": result_table,
            "violationCount": violation_count,
        }
    finally:
        cursor.close()


def run_integrated_symbolic_rule_violation(
    conn,
    payload: Dict[str, Any],
    owner: str,
    table: str,
    run_source_type: str,
    run_id: int,
) -> Dict[str, Any]:
    rule_owner = require_identifier(
        default_if_runtime_reference(get_value(payload, "P_SYMBOLIC_RULE_OWNER_NAME", "P_RULE_OWNER_NAME", "ruleOwnerName"), owner),
        "ruleOwnerName",
    )
    rule_table = require_identifier(
        default_if_runtime_reference(
            get_value(payload, "P_SYMBOLIC_RULE_TABLE_NAME", "P_RULE_TABLE_NAME", "ruleTableName"),
            "INIT$_TB_SYMBOLIC_RULE",
        ),
        "ruleTableName",
    )
    rule_id = clean_optional_text(get_value(payload, "P_RULE_ID", "ruleId"))
    if rule_id:
        rule_id = require_identifier(rule_id, "ruleId")
    result_owner = require_identifier(
        default_if_runtime_reference(get_value(payload, "P_SYMBOLIC_RESULT_OWNER", "P_RESULT_OWNER", "resultOwner"), owner),
        "resultOwner",
    )
    result_table = require_identifier(
        default_if_runtime_reference(
            get_value(payload, "P_SYMBOLIC_RESULT_TABLE", "resultTable"),
            "INIT$_TB_SYMBOLIC_RULE_VIOLATION",
        ),
        "resultTable",
    )
    case_id_column = require_identifier(
        get_value(payload, "P_CASE_ID_COLUMN_NAME", "caseIdColumnName") or "FILE_ROW_NO",
        "caseIdColumnName",
    )
    cursor = conn.cursor()
    try:
        cursor.callproc(
            "INIT$_SP_SYMBOLIC_RULE_VIOLATION_DETECT",
            [
                rule_owner,
                rule_table,
                rule_id,
                owner,
                table,
                case_id_column,
                result_owner,
                result_table,
                clamp_float(parse_optional_float(get_value(payload, "P_ERROR_PCT_THRESHOLD", "errorPctThreshold")), 0.05, 0.0, 999999.0),
                parse_optional_float(get_value(payload, "P_ABS_ERROR_THRESHOLD", "absErrorThreshold")),
                clamp(parse_int(get_value(payload, "P_SYMBOLIC_MAX_RULES", "P_MAX_SYMBOLIC_RULES", "P_MAX_RULES", "maxRules"), 20), 1, 10000),
                clamp(parse_int(get_value(payload, "P_SYMBOLIC_MAX_VIOLATIONS_PER_RULE", "P_MAX_VIOLATIONS_PER_RULE", "maxViolationsPerRule"), 200), 1, 100000),
                parse_yes_no(get_value(payload, "P_CLEAR_EXISTING_YN", "clearExistingYn"), "Y"),
                parse_int(get_value(payload, "P_COMMIT_INTERVAL", "commitInterval"), 1000),
                parse_yes_no(get_value(payload, "P_COMMIT_YN", "commitYn"), "N"),
                run_source_type,
                run_id,
                parse_int(get_value(payload, "P_MAX_SCAN_ROWS", "maxScanRows"), 50000),
                parse_int(get_value(payload, "P_MAX_ELAPSED_SECONDS", "maxElapsedSeconds"), 1800),
                parse_int(get_value(payload, "P_MAX_EXPRESSION_LENGTH", "maxExpressionLength"), 8000),
            ],
        )
        violation_count = count_result_rows(
            cursor,
            result_table,
            {
                "RUN_SOURCE_TYPE": run_source_type,
                "RUN_ID": run_id,
                "TARGET_OWNER": owner,
                "TARGET_TABLE": table,
            },
        )
        return {
            "task": "CONTINUOUS_SYMBOLIC_VIOLATION",
            "status": "success",
            "resultTable": result_table,
            "violationCount": violation_count,
        }
    finally:
        cursor.close()


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
    use_pysr: bool = False,
    linear_first: bool = True,
    linear_r2_threshold: float = 0.995,
) -> Tuple[str, float, int, str, str]:
    if linear_first:
        linear_expression, linear_score, linear_complexity, linear_method, linear_message = fit_linear_expression(
            x_values,
            y_values,
            feature_names,
        )
        if linear_score >= linear_r2_threshold:
            return linear_expression, linear_score, linear_complexity, linear_method, linear_message

    if not use_pysr:
        return fit_polynomial_fallback(
            x_values,
            y_values,
            feature_names,
            "PySR disabled by P_USE_PYSR=N.",
        )
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
        expression = normalize_oracle_symbolic_expression(
            str(best.get("sympy_format") or best.get("equation") or model),
            feature_names,
        )
        score = float(best.get("score") or 0)
        complexity = int(best.get("complexity") or len(expression))
        return expression, score, complexity, "PYSR", "PySR symbolic regression completed."
    except Exception as exc:
        return fit_polynomial_fallback(x_values, y_values, feature_names, str(exc))


def fit_linear_expression(x_values, y_values, feature_names: Sequence[str]) -> Tuple[str, float, int, str, str]:
    model = LinearRegression()
    model.fit(x_values, y_values)
    prediction = model.predict(x_values)
    score = float(r2_score(y_values, prediction))
    terms = []
    for coefficient, feature_name in zip(model.coef_, feature_names):
        coefficient = float(coefficient)
        if abs(coefficient) <= 1.0e-8:
            continue
        terms.append((coefficient, str(feature_name).upper()))
    intercept = float(model.intercept_)
    expression = format_linear_expression(intercept, terms)
    complexity = len(terms) + 1
    message = "Simple linear regression matched the target well enough before symbolic/polynomial fallback."
    return expression, score, complexity, "LINEAR_REGRESSION", message


def fit_polynomial_fallback(x_values, y_values, feature_names: Sequence[str], reason: str) -> Tuple[str, float, int, str, str]:
    x_scaler = StandardScaler()
    y_scaler = StandardScaler()
    x_scaled = x_scaler.fit_transform(x_values)
    y_scaled = y_scaler.fit_transform(y_values.reshape(-1, 1)).ravel()
    poly = PolynomialFeatures(degree=2, include_bias=False)
    x_poly = poly.fit_transform(x_scaled)
    cv = min(5, max(2, len(y_scaled) // 5))
    model = LassoCV(cv=cv, max_iter=10000, random_state=42)
    model.fit(x_poly, y_scaled)
    prediction = model.predict(x_poly)
    score = float(r2_score(y_scaled, prediction))
    y_mean = float(y_scaler.mean_[0])
    y_scale = float(y_scaler.scale_[0]) if abs(float(y_scaler.scale_[0])) > 1.0e-12 else 1.0
    x_means = [float(value) for value in x_scaler.mean_]
    x_scales = [float(value) if abs(float(value)) > 1.0e-12 else 1.0 for value in x_scaler.scale_]
    terms = []
    for coef, powers in zip(model.coef_, poly.powers_):
        raw_coef = float(coef) * y_scale
        if abs(raw_coef) <= 1.0e-8:
            continue
        term_expr = format_polynomial_raw_term(powers, feature_names, x_means, x_scales)
        if term_expr:
            terms.append((raw_coef, term_expr))
    terms = sorted(terms, key=lambda item: -abs(item[0]))[:12]
    intercept = y_mean + y_scale * float(model.intercept_)
    expression = format_polynomial_expression(intercept, terms)
    complexity = len(terms) + 1
    message = "PySR was unavailable or failed; polynomial LASSO fallback was used with an original-scale expression."
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


def clear_relation_network_rows(cursor, owner: str, table: str, run_source_type: str, run_id: int) -> None:
    params = {
        "runSourceType": run_source_type,
        "runId": run_id,
        "owner": owner,
        "tableName": table,
    }
    cursor.execute(
        """
        DELETE FROM "INIT$_TB_RELATION_NETWORK_EDGE"
         WHERE "RUN_SOURCE_TYPE" = :runSourceType
           AND "RUN_ID" = :runId
           AND "OWNER" = :owner
           AND "TABLE_NAME" = :tableName
        """,
        params,
    )
    cursor.execute(
        """
        DELETE FROM "INIT$_TB_RELATION_NETWORK_NODE"
         WHERE "RUN_SOURCE_TYPE" = :runSourceType
           AND "RUN_ID" = :runId
           AND "OWNER" = :owner
           AND "TABLE_NAME" = :tableName
        """,
        params,
    )


def load_relation_pairs_for_network(
    cursor,
    owner: str,
    table: str,
    run_source_type: str,
    run_id: int,
    min_metric: float,
    max_edges: int,
    relation_types: Sequence[str],
    metric_names: Sequence[str],
) -> List[Dict[str, Any]]:
    where_sql = [
        '"RUN_SOURCE_TYPE" = :runSourceType',
        '"RUN_ID" = :runId',
        '"OWNER" = :owner',
        '"TABLE_NAME" = :tableName',
        '"PASS_YN" = \'Y\'',
        'NVL("ABS_METRIC_VALUE", 0) >= :minMetric',
    ]
    params: Dict[str, Any] = {
        "runSourceType": run_source_type,
        "runId": run_id,
        "owner": owner,
        "tableName": table,
        "minMetric": min_metric,
    }
    if relation_types:
        names = []
        for index, value in enumerate(relation_types[:20]):
            bind_name = f"relationType{index}"
            names.append(f":{bind_name}")
            params[bind_name] = value
        where_sql.append(f'"RELATION_TYPE" IN ({", ".join(names)})')
    if metric_names:
        names = []
        for index, value in enumerate(metric_names[:20]):
            bind_name = f"metricName{index}"
            names.append(f":{bind_name}")
            params[bind_name] = value
        where_sql.append(f'"METRIC_NAME" IN ({", ".join(names)})')

    sql = f"""
        SELECT "COL_A"
             , "COL_B"
             , "COL_A_TYPE"
             , "COL_B_TYPE"
             , "RELATION_TYPE"
             , "METRIC_NAME"
             , "METRIC_VALUE"
             , "ABS_METRIC_VALUE"
          FROM "INIT$_TB_RELATION_PAIR"
         WHERE {" AND ".join(where_sql)}
         ORDER BY "ABS_METRIC_VALUE" DESC NULLS LAST
                , "COL_A"
                , "COL_B"
                , "METRIC_NAME"
    """
    cursor.execute(sql, params)
    columns = [desc[0] for desc in cursor.description]
    return [
        {columns[index]: row[index] for index in range(len(columns))}
        for row in cursor.fetchmany(max_edges * 3)
    ]


def choose_strongest_edges(rows: Sequence[Dict[str, Any]], max_edges: int) -> List[Dict[str, Any]]:
    best_by_pair: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for row in rows:
        col_a = str(row.get("COL_A") or "").upper()
        col_b = str(row.get("COL_B") or "").upper()
        if not col_a or not col_b or col_a == col_b:
            continue
        pair_key = tuple(sorted([col_a, col_b]))
        current = best_by_pair.get(pair_key)
        weight = float(row.get("ABS_METRIC_VALUE") or 0)
        if current is None or weight > float(current.get("ABS_METRIC_VALUE") or 0):
            best_by_pair[pair_key] = {**row, "COL_A": pair_key[0], "COL_B": pair_key[1]}
    return sorted(
        best_by_pair.values(),
        key=lambda item: (-float(item.get("ABS_METRIC_VALUE") or 0), str(item.get("COL_A")), str(item.get("COL_B"))),
    )[:max_edges]


def build_relation_network(edge_rows: Sequence[Dict[str, Any]]) -> Tuple[Dict[str, int], Dict[str, Dict[str, Any]], str]:
    node_types: Dict[str, str] = {}
    adjacency: Dict[str, Set[str]] = {}
    weighted_degree: Dict[str, float] = {}
    for row in edge_rows:
        col_a = str(row.get("COL_A") or "").upper()
        col_b = str(row.get("COL_B") or "").upper()
        weight = float(row.get("ABS_METRIC_VALUE") or 0)
        if not col_a or not col_b:
            continue
        node_types.setdefault(col_a, str(row.get("COL_A_TYPE") or ""))
        node_types.setdefault(col_b, str(row.get("COL_B_TYPE") or ""))
        adjacency.setdefault(col_a, set()).add(col_b)
        adjacency.setdefault(col_b, set()).add(col_a)
        weighted_degree[col_a] = weighted_degree.get(col_a, 0.0) + weight
        weighted_degree[col_b] = weighted_degree.get(col_b, 0.0) + weight

    if nx is not None:
        graph = nx.Graph()
        for node, column_type in node_types.items():
            graph.add_node(node, columnType=column_type)
        for row in edge_rows:
            graph.add_edge(
                str(row.get("COL_A") or "").upper(),
                str(row.get("COL_B") or "").upper(),
                weight=float(row.get("ABS_METRIC_VALUE") or 0),
            )
        try:
            communities = list(nx.community.louvain_communities(graph, weight="weight", seed=42))
            algorithm = "LOUVAIN"
        except Exception:
            communities = [set(component) for component in nx.connected_components(graph)]
            algorithm = "CONNECTED_COMPONENT"
        centrality = nx.degree_centrality(graph) if graph.number_of_nodes() else {}
        degree_count = dict(graph.degree())
        weighted_degree = dict(graph.degree(weight="weight"))
    else:
        communities = fallback_connected_components(adjacency)
        algorithm = "CONNECTED_COMPONENT_FALLBACK"
        node_total = max(1, len(node_types) - 1)
        degree_count = {node: len(adjacency.get(node, set())) for node in node_types}
        centrality = {node: degree_count.get(node, 0) / node_total for node in node_types}

    sorted_communities = sorted(
        [set(item) for item in communities],
        key=lambda item: (-len(item), sorted(item)[0] if item else ""),
    )
    cluster_map: Dict[str, int] = {}
    for cluster_index, community in enumerate(sorted_communities, start=1):
        for node in community:
            cluster_map[str(node).upper()] = cluster_index

    node_metrics = {
        node: {
            "columnType": node_types.get(node),
            "clusterId": cluster_map.get(node),
            "degreeCount": int(degree_count.get(node, 0)),
            "weightedDegree": float(weighted_degree.get(node, 0) or 0),
            "centralityScore": float(centrality.get(node, 0) or 0),
        }
        for node in sorted(node_types)
    }
    return cluster_map, node_metrics, algorithm


def fallback_connected_components(adjacency: Dict[str, Set[str]]) -> List[Set[str]]:
    seen: Set[str] = set()
    result: List[Set[str]] = []
    for start in sorted(adjacency):
        if start in seen:
            continue
        stack = [start]
        component: Set[str] = set()
        seen.add(start)
        while stack:
            node = stack.pop()
            component.add(node)
            for next_node in adjacency.get(node, set()):
                if next_node in seen:
                    continue
                seen.add(next_node)
                stack.append(next_node)
        result.append(component)
    return result


def insert_relation_network_rows(
    cursor,
    owner: str,
    table: str,
    run_source_type: str,
    run_id: int,
    edge_rows: Sequence[Dict[str, Any]],
    cluster_map: Dict[str, int],
    node_metrics: Dict[str, Dict[str, Any]],
) -> None:
    node_sql = """
        INSERT INTO "INIT$_TB_RELATION_NETWORK_NODE" (
            "RUN_SOURCE_TYPE"
          , "RUN_ID"
          , "OWNER"
          , "TABLE_NAME"
          , "COLUMN_NAME"
          , "COLUMN_TYPE"
          , "CLUSTER_ID"
          , "DEGREE_COUNT"
          , "WEIGHTED_DEGREE"
          , "CENTRALITY_SCORE"
          , "SELECTED_YN"
          , "CREATE_DT"
        ) VALUES (
            :runSourceType
          , :runId
          , :owner
          , :tableName
          , :columnName
          , :columnType
          , :clusterId
          , :degreeCount
          , :weightedDegree
          , :centralityScore
          , 'Y'
          , SYSDATE
        )
    """
    for column_name, metrics in node_metrics.items():
        cursor.execute(node_sql, {
            "runSourceType": run_source_type,
            "runId": run_id,
            "owner": owner,
            "tableName": table,
            "columnName": column_name,
            "columnType": metrics.get("columnType"),
            "clusterId": metrics.get("clusterId"),
            "degreeCount": metrics.get("degreeCount"),
            "weightedDegree": metrics.get("weightedDegree"),
            "centralityScore": metrics.get("centralityScore"),
        })

    edge_sql = """
        INSERT INTO "INIT$_TB_RELATION_NETWORK_EDGE" (
            "RUN_SOURCE_TYPE"
          , "RUN_ID"
          , "OWNER"
          , "TABLE_NAME"
          , "COL_A"
          , "COL_B"
          , "RELATION_TYPE"
          , "METRIC_NAME"
          , "METRIC_VALUE"
          , "ABS_METRIC_VALUE"
          , "CLUSTER_ID"
          , "PASS_YN"
          , "CREATE_DT"
        ) VALUES (
            :runSourceType
          , :runId
          , :owner
          , :tableName
          , :colA
          , :colB
          , :relationType
          , :metricName
          , :metricValue
          , :absMetricValue
          , :clusterId
          , 'Y'
          , SYSDATE
        )
    """
    for row in edge_rows:
        col_a = str(row.get("COL_A") or "").upper()
        col_b = str(row.get("COL_B") or "").upper()
        cluster_id = cluster_map.get(col_a) if cluster_map.get(col_a) == cluster_map.get(col_b) else None
        cursor.execute(edge_sql, {
            "runSourceType": run_source_type,
            "runId": run_id,
            "owner": owner,
            "tableName": table,
            "colA": col_a,
            "colB": col_b,
            "relationType": row.get("RELATION_TYPE"),
            "metricName": row.get("METRIC_NAME"),
            "metricValue": row.get("METRIC_VALUE"),
            "absMetricValue": row.get("ABS_METRIC_VALUE"),
            "clusterId": cluster_id,
        })


def update_relation_pair_clusters(
    cursor,
    owner: str,
    table: str,
    run_source_type: str,
    run_id: int,
    cluster_map: Dict[str, int],
) -> None:
    update_sql = """
        UPDATE "INIT$_TB_RELATION_PAIR"
           SET "CLUSTER_ID" = :clusterId
         WHERE "RUN_SOURCE_TYPE" = :runSourceType
           AND "RUN_ID" = :runId
           AND "OWNER" = :owner
           AND "TABLE_NAME" = :tableName
           AND (
                   ("COL_A" = :colA AND "COL_B" = :colB)
                OR ("COL_A" = :colB AND "COL_B" = :colA)
               )
    """
    handled_pairs: Set[Tuple[str, str, int]] = set()
    for col_a, cluster_a in cluster_map.items():
        for col_b, cluster_b in cluster_map.items():
            if col_a >= col_b or cluster_a != cluster_b:
                continue
            key = (col_a, col_b, cluster_a)
            if key in handled_pairs:
                continue
            handled_pairs.add(key)
            cursor.execute(update_sql, {
                "clusterId": cluster_a,
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
                "colA": col_a,
                "colB": col_b,
            })


def require_sklearn() -> None:
    if np is None or LassoCV is None or LinearRegression is None or StandardScaler is None:
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
    if value is None or is_auto_target(value):
        return []
    if isinstance(value, list):
        items = value
    else:
        items = re.split(r"[,;\s]+", str(value or ""))
    result = []
    for item in items:
        text = str(item or "").strip().upper()
        if not text or text == "(AUTO)":
            continue
        result.append(require_identifier(text, "column"))
    return list(dict.fromkeys(result))


def normalize_token_list(value: Any) -> List[str]:
    if value is None or is_auto_target(value):
        return []
    if isinstance(value, list):
        items = value
    else:
        items = re.split(r"[,;\s]+", str(value or ""))
    result = []
    for item in items:
        text = str(item or "").strip().upper()
        if not text or text == "(AUTO)":
            continue
        if not re.fullmatch(r"[A-Z0-9_$#]+", text):
            raise HTTPException(status_code=400, detail="Invalid filter token.")
        result.append(text)
    return list(dict.fromkeys(result))


def normalize_integrated_parts(value: Any) -> Set[str]:
    tokens = normalize_token_list(value)
    if not tokens or any(token in {"ALL", "BOTH", "AUTO"} for token in tokens):
        return {"CATEGORICAL", "CONTINUOUS"}

    result: Set[str] = set()
    for token in tokens:
        if token in {"CAT", "CATEGORY", "CATEGORICAL", "ASSOC", "ASSOCIATION", "APRIORI"}:
            result.add("CATEGORICAL")
        elif token in {"NUM", "NUMERIC", "CONT", "CONTINUOUS", "LASSO", "SYMBOLIC", "REGRESSION"}:
            result.add("CONTINUOUS")
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported integrated rule part: {token}")
    return result or {"CATEGORICAL", "CONTINUOUS"}


def clean_optional_text(value: Any) -> Optional[str]:
    if value is None or is_auto_target(value):
        return None
    text = str(value).strip()
    if not text or text.upper() in {"NULL", "NONE", "-"}:
        return None
    return text


def default_if_runtime_reference(value: Any, default: Any) -> Any:
    if isinstance(value, str) and value.strip().startswith(":"):
        return default
    return default if value in (None, "") else value


def clean_select_query(value: Any) -> Optional[str]:
    text = clean_optional_text(value)
    if not text:
        return None
    if ";" in text or not re.match(r"(?is)^\s*SELECT\b", text):
        raise HTTPException(status_code=400, detail="Custom data query must be a single SELECT statement.")
    return text


def count_result_rows(cursor, table_name: str, filters: Dict[str, Any]) -> int:
    table = require_identifier(table_name, "resultTable")
    conditions = []
    binds: Dict[str, Any] = {}
    for index, (column, value) in enumerate(filters.items()):
        if value is None:
            continue
        column_name = require_identifier(column, "filterColumn")
        bind_name = f"p{index}"
        conditions.append(f"{quote_identifier(column_name)} = :{bind_name}")
        binds[bind_name] = value
    where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
    cursor.execute(f"SELECT COUNT(*) FROM {quote_identifier(table)}{where_sql}", binds)
    row = cursor.fetchone()
    return int(row[0] or 0) if row else 0


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
    return convert_caret_power_to_oracle(str(name).replace(" ", "*"))


def build_symbolic_rule_id(
    run_source_type: Any,
    run_id: Any,
    owner: str,
    table_name: str,
    target_column: str,
    expression: str,
    feature_names: Sequence[str],
) -> str:
    feature_text = ",".join(str(name).upper() for name in feature_names)
    raw = "|".join(
        [
            str(run_source_type or "").upper(),
            str(run_id or ""),
            str(owner or "").upper(),
            str(table_name or "").upper(),
            str(target_column or "").upper(),
            feature_text,
            str(expression or ""),
        ]
    )
    return "SYM_" + hashlib.sha1(raw.encode("utf-8")).hexdigest().upper()[:32]


def normalize_oracle_symbolic_expression(expression: Any, feature_names: Sequence[str]) -> str:
    text = str(expression or "").strip()
    if not text:
        return "0"
    if "=" in text:
        text = text.rsplit("=", 1)[-1].strip()
    text = text.replace("**", "^")
    text = re.sub(r"\bsquare\s*\(([^()]*)\)", r"POWER(\1, 2)", text, flags=re.IGNORECASE)
    text = re.sub(r"\blog\s*\(", "LN(", text, flags=re.IGNORECASE)
    text = convert_caret_power_to_oracle(text)
    text = normalize_expression_feature_names(text, feature_names)
    if "**" in text or "^" in text:
        raise HTTPException(status_code=500, detail=f"Symbolic expression could not be converted to Oracle syntax: {text[:300]}")
    if re.search(r"['\";\[\]{}]", text):
        raise HTTPException(status_code=500, detail="Symbolic expression contains unsupported characters for Oracle execution.")
    return text


def convert_caret_power_to_oracle(expression: str) -> str:
    text = str(expression or "")
    pattern = re.compile(
        r"(\([^()]*\)|[A-Za-z][A-Za-z0-9_$#]*|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\^\s*(-?\d+(?:\.\d+)?)"
    )
    previous = None
    while previous != text:
        previous = text
        text = pattern.sub(lambda match: f"POWER({match.group(1)}, {match.group(2)})", text)
    return text


def normalize_expression_feature_names(expression: str, feature_names: Sequence[str]) -> str:
    text = str(expression or "")
    for feature in sorted({str(name).upper() for name in feature_names}, key=len, reverse=True):
        text = re.sub(rf"\b{re.escape(feature)}\b", feature, text, flags=re.IGNORECASE)
    return text


def format_model_number(value: float) -> str:
    if not math.isfinite(value) or abs(value) <= 1.0e-12:
        return "0"
    return f"{value:.12g}"


def format_linear_expression(intercept: float, terms: Sequence[Tuple[float, str]]) -> str:
    expression = ""
    if math.isfinite(intercept) and abs(intercept) > 1.0e-8:
        expression = format_model_number(intercept)

    for coefficient, feature_name in terms:
        coefficient = float(coefficient)
        if not math.isfinite(coefficient) or abs(coefficient) <= 1.0e-8:
            continue

        magnitude = abs(coefficient)
        if abs(magnitude - 1.0) <= 1.0e-8:
            term_expr = str(feature_name).upper()
        else:
            term_expr = f"{format_model_number(magnitude)}*{str(feature_name).upper()}"

        if not expression:
            expression = f"-{term_expr}" if coefficient < 0 else term_expr
        else:
            sign = " - " if coefficient < 0 else " + "
            expression += f"{sign}{term_expr}"

    return expression or "0"


def format_scaled_feature_reference(feature_name: str, mean: float, scale: float) -> str:
    feature = str(feature_name).upper()
    if abs(mean) <= 1.0e-12:
        centered = feature
    elif mean > 0:
        centered = f"({feature} - {format_model_number(mean)})"
    else:
        centered = f"({feature} + {format_model_number(abs(mean))})"
    if abs(scale - 1.0) <= 1.0e-12:
        return centered
    return f"({centered}/{format_model_number(scale)})"


def format_polynomial_raw_term(
    powers,
    feature_names: Sequence[str],
    means: Sequence[float],
    scales: Sequence[float],
) -> str:
    parts = []
    for index, power in enumerate(powers):
        power = int(power)
        if power <= 0:
            continue
        base = format_scaled_feature_reference(feature_names[index], means[index], scales[index])
        if power == 1:
            parts.append(base)
        else:
            parts.append(f"POWER({base}, {power})")
    return "*".join(parts)


def format_polynomial_expression(intercept: float, terms: Sequence[Tuple[float, str]]) -> str:
    expression = format_model_number(intercept)
    for coefficient, term_expr in terms:
        sign = " + " if coefficient >= 0 else " - "
        expression += f"{sign}{format_model_number(abs(float(coefficient)))}*{term_expr}"
    return expression
