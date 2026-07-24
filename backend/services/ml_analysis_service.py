"""
WAS-side machine learning analysis helpers.

The target DB stores source data and result tables. Heavy Python algorithms run
in the FastAPI process so Oracle Cloud environments that cannot use OML4Py can
still execute feature selection and symbolic rule discovery.
"""

from fastapi import HTTPException
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
from functools import wraps
import hashlib
import json
import math
import os
import re
import threading

from backend.database_helper import SqlLoader
from backend.oracle_session import disable_parallel_execution

for _thread_env_name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_thread_env_name, "1")

np = None
Lasso = None
LassoCV = None
LinearRegression = None
PolynomialFeatures = None
StandardScaler = None
r2_score = None
nx = None
_sklearn_import_error = None
_networkx_import_attempted = False
_sklearn_import_lock = threading.Lock()
_networkx_import_lock = threading.Lock()


def _positive_env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except Exception:
        return max(minimum, default)


_ml_execution_semaphore = threading.BoundedSemaphore(_positive_env_int("APP_ML_MAX_CONCURRENT", 1))
_ml_execution_state = threading.local()


def _limit_ml_concurrency(func):
    @wraps(func)
    def wrapped(*args, **kwargs):
        depth = int(getattr(_ml_execution_state, "depth", 0) or 0)
        if depth > 0:
            return func(*args, **kwargs)

        wait_seconds = _positive_env_int("APP_ML_WAIT_SECONDS", 0, 0)
        acquired = _ml_execution_semaphore.acquire(timeout=wait_seconds)
        if not acquired:
            raise HTTPException(
                status_code=503,
                detail="Another ML analysis is running. Please try again after it completes.",
            )
        _ml_execution_state.depth = 1
        try:
            return func(*args, **kwargs)
        finally:
            _ml_execution_state.depth = 0
            _ml_execution_semaphore.release()

    return wrapped


def _load_networkx_dependency():
    global nx, _networkx_import_attempted
    if _networkx_import_attempted:
        return nx
    with _networkx_import_lock:
        if _networkx_import_attempted:
            return nx
        try:
            import networkx as networkx_module
            nx = networkx_module
        except Exception:
            nx = None
        _networkx_import_attempted = True
        return nx


WEB_API_METHODS = {
    "LASSO_FEATURE_SELECT",
    "RELATION_NETWORK_CLUSTER",
    "INTEGRATED_RELATION_CLUSTER",
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
    if method == "INTEGRATED_RELATION_CLUSTER":
        result = run_integrated_relation_cluster(conn, payload)
        network = result.get("network") if isinstance(result.get("network"), dict) else {}
        return (
            "Integrated relation matrix and network clustering completed. "
            f"{result.get('relationCount', 0)} relation row(s), "
            f"{network.get('clusterCount', 0)} cluster(s)."
        )
    if method == "INTEGRATED_RULE_DISCOVER":
        result = run_integrated_rule_discover(conn, payload)
        raise_for_partial_result(result, "Integrated rule discovery")
        return (
            f"Integrated rule discovery completed. "
            f"{result.get('successCount', 0)}/{result.get('taskCount', 0)} task(s) succeeded."
        )
    if method == "INTEGRATED_RULE_VIOLATION_DETECT":
        result = run_integrated_rule_violation_detect(conn, payload)
        raise_for_partial_result(result, "Integrated rule violation detection")
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
    if endpoint.endswith("/integrated-relation-cluster"):
        return "INTEGRATED_RELATION_CLUSTER"
    if endpoint.endswith("/integrated-rule-discover"):
        return "INTEGRATED_RULE_DISCOVER"
    if endpoint.endswith("/integrated-rule-violation-detect"):
        return "INTEGRATED_RULE_VIOLATION_DETECT"
    return ""


CLUSTER_USAGE_MODES = {"NONE", "PREFER_SAME_CLUSTER", "WITHIN_CLUSTER_ONLY"}


def normalize_cluster_usage_mode(value: Any, default: str = "NONE") -> str:
    normalized = str(value or default).strip().upper()
    if normalized not in CLUSTER_USAGE_MODES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported cluster usage mode: {normalized}. "
                "Use NONE, PREFER_SAME_CLUSTER, or WITHIN_CLUSTER_ONLY."
            ),
        )
    return normalized


def load_relation_cluster_nodes(
    conn,
    owner: str,
    table: str,
    run_source_type: str,
    run_id: int,
) -> Dict[str, Dict[str, Any]]:
    cursor = conn.cursor()
    try:
        cursor.execute(
            SqlLoader.get_sql("ML_ANALYSIS_RELATION_CLUSTER_NODES"),
            {
                "runSourceType": run_source_type,
                "runId": run_id,
                "owner": owner,
                "tableName": table,
            },
        )
        columns = [str(desc[0]).upper() for desc in cursor.description or []]
        return {
            str(row[0] or "").strip().upper(): {
                columns[index]: row[index]
                for index in range(len(columns))
            }
            for row in cursor.fetchall()
            if row and row[0]
        }
    finally:
        cursor.close()


def apply_cluster_candidate_strategy(
    candidates: Sequence[str],
    target_column: str,
    cluster_nodes: Dict[str, Dict[str, Any]],
    requested_mode: str,
    max_features: int,
) -> Tuple[List[str], Dict[str, Any]]:
    normalized_candidates = list(dict.fromkeys(str(item).strip().upper() for item in candidates if str(item).strip()))
    usage = {
        "requestedMode": requested_mode,
        "effectiveMode": "NONE",
        "appliedYn": "N",
        "fallbackYn": "N",
        "reason": "Cluster usage is disabled.",
        "targetColumn": target_column,
        "targetClusterId": None,
        "networkNodeCount": len(cluster_nodes),
        "sourceCandidateCount": len(normalized_candidates),
        "candidateCount": len(normalized_candidates),
        "sameClusterCandidateCount": 0,
        "crossClusterCandidateCount": 0,
        "unclusteredCandidateCount": 0,
    }
    if requested_mode == "NONE":
        return normalized_candidates, usage

    target_node = cluster_nodes.get(target_column) or {}
    target_cluster_id = target_node.get("CLUSTER_ID")
    usage["targetClusterId"] = target_cluster_id
    if not cluster_nodes or target_cluster_id is None:
        reason = "No same-run relation cluster exists for the target column."
        if requested_mode == "WITHIN_CLUSTER_ONLY":
            raise HTTPException(status_code=400, detail=f"{reason} targetColumn={target_column}")
        usage.update({"fallbackYn": "Y", "reason": f"{reason} Existing candidate selection was used."})
        return normalized_candidates, usage

    def centrality(column: str) -> Tuple[float, float, str]:
        node = cluster_nodes.get(column) or {}
        return (
            -float(node.get("CENTRALITY_SCORE") or 0),
            -float(node.get("WEIGHTED_DEGREE") or 0),
            column,
        )

    same_cluster = sorted(
        [column for column in normalized_candidates if (cluster_nodes.get(column) or {}).get("CLUSTER_ID") == target_cluster_id],
        key=centrality,
    )
    other_clusters: Dict[Any, List[str]] = {}
    unclustered: List[str] = []
    for column in normalized_candidates:
        cluster_id = (cluster_nodes.get(column) or {}).get("CLUSTER_ID")
        if cluster_id == target_cluster_id:
            continue
        if cluster_id is None:
            unclustered.append(column)
            continue
        other_clusters.setdefault(cluster_id, []).append(column)
    for cluster_id in other_clusters:
        other_clusters[cluster_id] = sorted(other_clusters[cluster_id], key=centrality)

    usage["sameClusterCandidateCount"] = len(same_cluster)
    usage["crossClusterCandidateCount"] = sum(len(items) for items in other_clusters.values())
    usage["unclusteredCandidateCount"] = len(unclustered)
    if requested_mode == "WITHIN_CLUSTER_ONLY":
        if not same_cluster:
            raise HTTPException(
                status_code=400,
                detail=f"No same-cluster candidate feature exists for targetColumn={target_column}, clusterId={target_cluster_id}.",
            )
        usage.update({
            "effectiveMode": requested_mode,
            "appliedYn": "Y",
            "reason": "Only candidate features from the target column cluster were used.",
            "candidateCount": len(same_cluster),
        })
        return same_cluster, usage

    supplemental_centers: List[str] = []
    other_remaining: List[str] = []
    for cluster_id in sorted(other_clusters, key=lambda value: (str(type(value)), str(value))):
        cluster_candidates = other_clusters[cluster_id]
        supplemental_centers.extend(cluster_candidates[:2])
        other_remaining.extend(cluster_candidates[2:])
    preferred = list(dict.fromkeys([*same_cluster, *supplemental_centers, *unclustered, *other_remaining]))
    candidate_limit = max(20, max_features * 4)
    selected_candidates = preferred[:candidate_limit]
    usage.update({
        "effectiveMode": requested_mode,
        "appliedYn": "Y",
        "reason": "Same-cluster candidates were prioritized and central candidates from other clusters were retained as supplements.",
        "candidateCount": len(selected_candidates),
        "candidateLimit": candidate_limit,
        "supplementalCenterCount": len(supplemental_centers),
    })
    return selected_candidates, usage


def build_feature_cluster_usage(
    target_column: str,
    feature_columns: Sequence[str],
    cluster_nodes: Dict[str, Dict[str, Any]],
    requested_mode: str,
) -> Dict[str, Any]:
    target_cluster_id = (cluster_nodes.get(target_column) or {}).get("CLUSTER_ID")
    feature_clusters = [
        {
            "columnName": str(column).upper(),
            "clusterId": (cluster_nodes.get(str(column).upper()) or {}).get("CLUSTER_ID"),
        }
        for column in feature_columns
    ]
    applied = requested_mode != "NONE" and target_cluster_id is not None
    return {
        "requestedMode": requested_mode,
        "effectiveMode": requested_mode if applied else "NONE",
        "appliedYn": "Y" if applied else "N",
        "fallbackYn": "Y" if requested_mode != "NONE" and not applied else "N",
        "targetColumn": target_column,
        "targetClusterId": target_cluster_id,
        "networkNodeCount": len(cluster_nodes),
        "featureClusters": feature_clusters,
        "sameClusterFeatureCount": sum(1 for item in feature_clusters if item["clusterId"] == target_cluster_id and target_cluster_id is not None),
        "crossClusterFeatureCount": sum(1 for item in feature_clusters if item["clusterId"] is not None and item["clusterId"] != target_cluster_id),
        "unclusteredFeatureCount": sum(1 for item in feature_clusters if item["clusterId"] is None),
    }


@_limit_ml_concurrency
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
    cluster_usage_mode = normalize_cluster_usage_mode(
        get_value(payload, "P_CLUSTER_USAGE_MODE", "clusterUsageMode"),
        "NONE",
    )

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

    cluster_nodes = load_relation_cluster_nodes(conn, owner, table, run_source_type, run_id) if cluster_usage_mode != "NONE" else {}
    candidates, cluster_usage = apply_cluster_candidate_strategy(
        candidates,
        target_column,
        cluster_nodes,
        cluster_usage_mode,
        max_features,
    )
    if not candidates:
        raise HTTPException(status_code=400, detail="No numeric candidate features remained after applying cluster usage mode.")

    x_values, y_values, used_features, matrix_limits = fetch_numeric_matrix(
        conn,
        owner,
        table,
        target_column,
        candidates,
        sample_rows,
        max_in_memory_rows=_ml_runtime_limit(
            payload,
            "APP_ML_MAX_IN_MEMORY_ROWS",
            _ml_in_memory_row_limit(),
            1000,
        ),
        max_input_features=_ml_runtime_limit(
            payload,
            "APP_ML_MAX_INPUT_FEATURES",
            _ml_input_feature_limit(),
            1,
        ),
    )
    if len(y_values) < 10:
        raise HTTPException(status_code=400, detail="LASSO requires at least 10 complete numeric rows.")

    x_scaler = StandardScaler(copy=False)
    y_scaler = StandardScaler(copy=False)
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
    message = (
        f"rows={len(y_scaled)}, alpha={model_alpha}, selected={len(selected_names)}, "
        f"requestedRows={matrix_limits['requestedSampleRows']}, "
        f"effectiveRowLimit={matrix_limits['effectiveSampleRows']}, "
        f"inputFeatures={matrix_limits['effectiveFeatureCount']}/{matrix_limits['requestedFeatureCount']}, "
        f"clusterMode={cluster_usage.get('effectiveMode')}, "
        f"targetCluster={cluster_usage.get('targetClusterId')}, "
        f"clusterCandidates={cluster_usage.get('candidateCount')}"
    )

    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            DELETE FROM "INIT$_TB_COLREL_LASSO_FEATURE"
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
            INSERT INTO "INIT$_TB_COLREL_LASSO_FEATURE" (
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
        "clusterUsage": cluster_usage,
        "memoryLimits": matrix_limits,
    }


@_limit_ml_concurrency
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
    max_symbolic_terms = clamp(
        parse_int(get_value(payload, "P_MAX_SYMBOLIC_TERMS", "maxSymbolicTerms"), 8),
        1,
        50,
    )
    min_r2_score = clamp_float(parse_optional_float(get_value(payload, "P_MIN_R2_SCORE", "minR2Score")), 0.7, 0.0, 1.0)
    use_pysr = parse_yes_no(get_value(payload, "P_USE_PYSR", "usePysr"), "N") == "Y"
    linear_first = parse_yes_no(get_value(payload, "P_LINEAR_FIRST_YN", "linearFirstYn"), "Y") == "Y"
    linear_r2_threshold = clamp_float(
        parse_optional_float(get_value(payload, "P_LINEAR_R2_THRESHOLD", "linearR2Threshold")),
        0.995,
        0.0,
        1.0,
    )
    cluster_usage_mode = normalize_cluster_usage_mode(
        get_value(payload, "P_CLUSTER_USAGE_MODE", "clusterUsageMode"),
        "NONE",
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

    x_values, y_values, used_features, matrix_limits = fetch_numeric_matrix(
        conn,
        owner,
        table,
        target_column,
        features,
        sample_rows,
        max_in_memory_rows=_ml_runtime_limit(
            payload,
            "APP_ML_MAX_IN_MEMORY_ROWS",
            _ml_in_memory_row_limit(),
            1000,
        ),
        max_input_features=_ml_runtime_limit(
            payload,
            "APP_ML_MAX_INPUT_FEATURES",
            _ml_input_feature_limit(),
            1,
        ),
    )
    if len(y_values) < 10:
        raise HTTPException(status_code=400, detail="Symbolic regression requires at least 10 complete numeric rows.")

    cluster_nodes = load_relation_cluster_nodes(conn, owner, table, run_source_type, run_id) if cluster_usage_mode != "NONE" else {}
    cluster_usage = build_feature_cluster_usage(target_column, used_features, cluster_nodes, cluster_usage_mode)

    expression, score, complexity, method, message = fit_symbolic_expression(
        x_values,
        y_values,
        used_features,
        max_iterations,
        use_pysr,
        linear_first,
        linear_r2_threshold,
        max_symbolic_terms,
    )
    message = (
        f"{message} requestedRows={matrix_limits['requestedSampleRows']}, "
        f"effectiveRowLimit={matrix_limits['effectiveSampleRows']}, "
        f"inputFeatures={matrix_limits['effectiveFeatureCount']}/{matrix_limits['requestedFeatureCount']}, "
        f"maxSymbolicTerms={max_symbolic_terms}, "
        f"clusterMode={cluster_usage.get('effectiveMode')}, "
        f"targetCluster={cluster_usage.get('targetClusterId')}, "
        f"sameClusterFeatures={cluster_usage.get('sameClusterFeatureCount')}, "
        f"crossClusterFeatures={cluster_usage.get('crossClusterFeatureCount')}."
    )
    expression = normalize_oracle_symbolic_expression(expression, used_features)
    rule_id = build_symbolic_rule_id(run_source_type, run_id, owner, table, target_column, expression, used_features)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            DELETE FROM "INIT$_TB_RULEDISC_SYMBOLIC"
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
            INSERT INTO "INIT$_TB_RULEDISC_SYMBOLIC" (
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
        "complexity": complexity,
        "message": message,
        "ruleId": rule_id,
        "clusterUsage": cluster_usage,
        "memoryLimits": matrix_limits,
    }


@_limit_ml_concurrency
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
                "resultTable": "INIT$_TB_COLREL_NETWORK_EDGE",
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
            "resultTable": "INIT$_TB_COLREL_NETWORK_EDGE",
        }
    finally:
        cursor.close()


@_limit_ml_concurrency
def run_integrated_relation_cluster(conn, payload: Dict[str, Any]) -> Dict[str, Any]:
    owner = require_identifier(get_value(payload, "P_TARGET_OWNER", "targetOwner", "owner"), "targetOwner")
    table = require_identifier(get_value(payload, "P_TARGET_TABLE", "targetTable", "tableName"), "targetTable")
    run_source_type = normalize_run_source_type(get_value(payload, "P_RUN_SOURCE_TYPE", "runSourceType"))
    run_id = parse_int(get_value(payload, "P_RUN_ID", "runId"), 0)
    min_metric = clamp_float(parse_optional_float(get_value(payload, "P_MIN_METRIC", "minMetric")), 0.65, 0.0, 1.0)
    min_pvalue = clamp_float(parse_optional_float(get_value(payload, "P_MIN_PVALUE", "minPvalue")), 0.05, 0.0, 1.0)
    sample_rows = parse_optional_positive_int(get_value(payload, "P_SAMPLE_ROWS", "sampleRows"), 100000)
    max_distinct = clamp(parse_int(get_value(payload, "P_MAX_DISTINCT", "maxDistinct"), 100), 2, 100000)
    max_columns = clamp(parse_int(get_value(payload, "P_MAX_COLUMNS", "maxColumns"), 100), 2, 200)
    min_rows = clamp(parse_int(get_value(payload, "P_MIN_ROWS", "minRows"), 30), 4, 1000000)
    include_spearman = parse_yes_no(get_value(payload, "P_INCLUDE_SPEARMAN", "includeSpearman"), "Y")
    min_cramer = clamp_float(parse_optional_float(get_value(payload, "P_MIN_CRAMER", "minCramer")), 0.3, 0.0, 1.0)
    min_abs_corr = clamp_float(parse_optional_float(get_value(payload, "P_MIN_ABS_CORR", "minAbsCorr")), 0.6, 0.0, 1.0)
    min_eta = clamp_float(parse_optional_float(get_value(payload, "P_MIN_ETA", "minEta")), 0.65, 0.0, 1.0)
    relation_criteria = {
        "minMetric": min_metric,
        "minCramer": min_cramer,
        "minAbsCorr": min_abs_corr,
        "minEta": min_eta,
        "minPvalue": min_pvalue,
        "minRows": min_rows,
    }

    cursor = conn.cursor()
    try:
        cursor.callproc(
            "INIT$_SP_RELATION_MATRIX_ANALYZE",
            [
                owner,
                table,
                min_metric,
                min_pvalue,
                sample_rows,
                max_distinct,
                max_columns,
                min_rows,
                include_spearman,
                run_source_type,
                run_id,
                "Y",
                min_cramer,
                min_abs_corr,
                min_eta,
            ],
        )
        relation_count = count_result_rows(
            cursor,
            "INIT$_TB_COLREL_PAIR",
            {
                "RUN_SOURCE_TYPE": run_source_type,
                "RUN_ID": run_id,
                "OWNER": owner,
                "TABLE_NAME": table,
            },
        )
    finally:
        cursor.close()

    network_payload = dict(payload)
    network_payload["P_TARGET_OWNER"] = owner
    network_payload["P_TARGET_TABLE"] = table
    network_payload["P_RUN_SOURCE_TYPE"] = run_source_type
    network_payload["P_RUN_ID"] = run_id
    network_payload["P_MIN_METRIC"] = clamp_float(
        parse_optional_float(get_value(payload, "P_NETWORK_MIN_METRIC", "networkMinMetric")),
        0.3,
        0.0,
        1.0,
    )
    network_result = run_relation_network_cluster(conn, network_payload)
    return {
        "status": "success",
        "taskCount": 2,
        "successCount": 2,
        "parts": ["RELATION_MATRIX", "RELATION_NETWORK"],
        "relationCount": relation_count,
        "resultTables": [
            "INIT$_TB_COLREL_CAT_PAIR",
            "INIT$_TB_COLREL_NUM_PAIR",
            "INIT$_TB_COLREL_PAIR",
            "INIT$_TB_COLREL_SUMMARY",
            "INIT$_TB_COLREL_NETWORK_NODE",
            "INIT$_TB_COLREL_NETWORK_EDGE",
        ],
        "relationCriteria": relation_criteria,
        "network": network_result,
    }


@_limit_ml_concurrency
def run_integrated_rule_discover(conn, payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(payload)
    owner = require_identifier(get_value(payload, "P_TARGET_OWNER", "targetOwner", "owner"), "targetOwner")
    table = require_identifier(get_value(payload, "P_TARGET_TABLE", "targetTable", "tableName"), "targetTable")
    run_source_type = normalize_run_source_type(get_value(payload, "P_RUN_SOURCE_TYPE", "runSourceType"))
    run_id = parse_int(get_value(payload, "P_RUN_ID", "runId"), 0)
    parts = normalize_integrated_parts(get_value(payload, "P_RULE_PARTS", "ruleParts"))
    cluster_usage_mode = normalize_cluster_usage_mode(
        get_value(payload, "P_CLUSTER_USAGE_MODE", "clusterUsageMode"),
        "PREFER_SAME_CLUSTER",
    )
    payload["P_CLUSTER_USAGE_MODE"] = cluster_usage_mode
    payload["clusterUsageMode"] = cluster_usage_mode
    continue_on_error = parse_yes_no(get_value(payload, "P_CONTINUE_ON_ERROR", "continueOnError"), "Y") == "Y"
    continuous_criteria = {
        "targetColumn": str(get_value(payload, "P_TARGET_COLUMN", "targetColumn") or "(auto)"),
        "minR2Score": clamp_float(
            parse_optional_float(get_value(payload, "P_MIN_R2_SCORE", "minR2Score")),
            0.7,
            0.0,
            1.0,
        ),
        "maxAutoTargets": clamp(parse_int(get_value(payload, "P_MAX_AUTO_TARGETS", "maxAutoTargets"), 10), 1, 100),
        "maxFeatures": clamp(parse_int(get_value(payload, "P_MAX_FEATURES", "maxFeatures"), 10), 1, 10),
        "clusterUsageMode": cluster_usage_mode,
    }

    results: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []
    result_tables: List[str] = []
    result_models: List[str] = []
    cluster_usage: Dict[str, Any] = {
        "requestedMode": cluster_usage_mode,
        "effectiveMode": "NONE",
        "appliedYn": "N",
        "fallbackYn": "N",
        "reason": "Continuous rule discovery was not executed.",
    }

    if "CATEGORICAL" in parts:
        try:
            categorical_result = run_integrated_apriori_assoc_model(conn, payload, owner, table, run_source_type, run_id)
            results.append(categorical_result)
            result_tables.append(str(categorical_result.get("resultTable") or "INIT$_TB_RULEDISC_ASSOC_SUM"))
            if categorical_result.get("modelName"):
                result_models.append(str(categorical_result["modelName"]))
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
            if isinstance(lasso_result.get("clusterUsage"), dict):
                cluster_usage = dict(lasso_result["clusterUsage"])
            results.append({"task": "CONTINUOUS_LASSO", "resultTable": "INIT$_TB_COLREL_LASSO_FEATURE", **lasso_result})
            result_tables.append("INIT$_TB_COLREL_LASSO_FEATURE")
            if str(lasso_result.get("status") or "").lower() == "partial_success":
                failures.append({
                    "task": "CONTINUOUS_LASSO",
                    "message": summarize_partial_failures(lasso_result, "LASSO target"),
                    "details": lasso_result.get("failedTargets") or [],
                })
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
                results.append({"task": "CONTINUOUS_SYMBOLIC", "resultTable": "INIT$_TB_RULEDISC_SYMBOLIC", **symbolic_result})
                result_tables.append("INIT$_TB_RULEDISC_SYMBOLIC")
                if str(symbolic_result.get("status") or "").lower() == "partial_success":
                    failures.append({
                        "task": "CONTINUOUS_SYMBOLIC",
                        "message": summarize_partial_failures(symbolic_result, "Symbolic target"),
                        "details": symbolic_result.get("failedTargets") or [],
                    })
            except Exception as exc:
                failures.append({"task": "CONTINUOUS_SYMBOLIC", "message": get_error_message(exc)})
                if not continue_on_error:
                    raise

    if not results:
        detail = "; ".join(f"{item['task']}: {item['message']}" for item in failures) or "No integrated rule discovery task succeeded."
        raise HTTPException(status_code=400, detail=detail)

    task_count, success_count, failed_count = calculate_integrated_task_counts(results, failures)
    return {
        "status": "partial_success" if failures else "success",
        "taskCount": task_count,
        "successCount": success_count,
        "failedCount": failed_count,
        "failedTasks": failures,
        "parts": sorted(parts),
        "resultTables": list(dict.fromkeys(result_tables)),
        "resultModels": list(dict.fromkeys(result_models)),
        "continuousCriteria": continuous_criteria,
        "clusterUsage": cluster_usage,
        "results": results,
    }


@_limit_ml_concurrency
def run_integrated_rule_violation_detect(conn, payload: Dict[str, Any]) -> Dict[str, Any]:
    owner = require_identifier(get_value(payload, "P_TARGET_OWNER", "targetOwner", "owner"), "targetOwner")
    table = require_identifier(get_value(payload, "P_TARGET_TABLE", "targetTable", "tableName"), "targetTable")
    run_source_type = normalize_run_source_type(get_value(payload, "P_RUN_SOURCE_TYPE", "runSourceType"))
    run_id = parse_int(get_value(payload, "P_RUN_ID", "runId"), 0)
    parts = normalize_integrated_parts(get_value(payload, "P_RULE_PARTS", "ruleParts"))
    continue_on_error = parse_yes_no(get_value(payload, "P_CONTINUE_ON_ERROR", "continueOnError"), "Y") == "Y"

    results: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []
    result_tables: List[str] = []

    cursor = conn.cursor()
    try:
        disable_parallel_execution(
            cursor,
            include_query=True,
            context="integrated-rule-violation-detect",
        )
    finally:
        cursor.close()

    if "CATEGORICAL" in parts:
        set_integrated_task_savepoint(conn)
        try:
            categorical_result = run_integrated_assoc_rule_violation(conn, payload, owner, table, run_source_type, run_id)
            results.append(categorical_result)
            result_tables.append(str(categorical_result.get("resultTable") or "INIT$_TB_RULEVIOL_ASSOC"))
        except Exception as exc:
            rollback_integrated_task(conn)
            failures.append({"task": "CATEGORICAL_RULE_VIOLATION", "message": get_error_message(exc)})
            if not continue_on_error:
                raise

    if "CONTINUOUS" in parts:
        set_integrated_task_savepoint(conn)
        try:
            continuous_result = run_integrated_symbolic_rule_violation(conn, payload, owner, table, run_source_type, run_id)
            results.append(continuous_result)
            result_tables.append(str(continuous_result.get("resultTable") or "INIT$_TB_RULEVIOL_SYMBOLIC"))
        except Exception as exc:
            rollback_integrated_task(conn)
            failures.append({"task": "CONTINUOUS_SYMBOLIC_VIOLATION", "message": get_error_message(exc)})
            if not continue_on_error:
                raise

    if not results:
        detail = "; ".join(f"{item['task']}: {item['message']}" for item in failures) or "No integrated violation detection task succeeded."
        raise HTTPException(status_code=400, detail=detail)

    task_count, success_count, failed_count = calculate_integrated_task_counts(results, failures)
    return {
        "status": "partial_success" if failures else "success",
        "taskCount": task_count,
        "successCount": success_count,
        "failedCount": failed_count,
        "failedTasks": failures,
        "parts": sorted(parts),
        "resultTables": list(dict.fromkeys(result_tables)),
        "results": results,
    }


def set_integrated_task_savepoint(conn) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("ML_ANALYSIS_INTEGRATED_TASK_SAVEPOINT"))
    finally:
        cursor.close()


def rollback_integrated_task(conn) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("ML_ANALYSIS_INTEGRATED_TASK_ROLLBACK"))
    finally:
        cursor.close()


def summarize_partial_failures(result: Dict[str, Any], label: str) -> str:
    failures = result.get("failedTargets") or result.get("failedTasks") or []
    messages = []
    for item in failures:
        if not isinstance(item, dict):
            continue
        target = item.get("targetColumn") or item.get("task") or label
        message = item.get("message") or "failed"
        messages.append(f"{target}: {message}")
    detail = "; ".join(messages[:10])
    if len(messages) > 10:
        detail += f"; and {len(messages) - 10} more"
    return detail or f"One or more {label} operations failed."


def calculate_integrated_task_counts(
    results: Sequence[Dict[str, Any]],
    failures: Sequence[Dict[str, Any]],
) -> Tuple[int, int, int]:
    result_tasks = {
        str(item.get("task") or "").strip()
        for item in results
        if isinstance(item, dict) and item.get("task")
    }
    failed_tasks = {
        str(item.get("task") or "").strip()
        for item in failures
        if isinstance(item, dict) and item.get("task")
    }
    task_count = len(result_tasks | failed_tasks)
    return task_count, len(result_tasks - failed_tasks), len(failed_tasks)


def raise_for_partial_result(result: Dict[str, Any], label: str) -> None:
    if str(result.get("status") or "").strip().lower() != "partial_success":
        return
    detail = summarize_partial_failures(result, "integrated task")
    raise HTTPException(status_code=409, detail=f"{label} partially completed. {detail}")


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
            "INIT$_TB_RULEDISC_ASSOC_SUM",
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
            "resultTable": "INIT$_TB_RULEDISC_ASSOC_SUM",
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
            "INIT$_TB_RULEVIOL_ASSOC",
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
            "INIT$_TB_RULEDISC_SYMBOLIC",
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
            "INIT$_TB_RULEVIOL_SYMBOLIC",
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

    cluster_usages = [
        item.get("clusterUsage")
        for item in results
        if isinstance(item.get("clusterUsage"), dict)
    ]
    applied_cluster_usages = [item for item in cluster_usages if str(item.get("appliedYn") or "N").upper() == "Y"]
    fallback_cluster_usages = [item for item in cluster_usages if str(item.get("fallbackYn") or "N").upper() == "Y"]

    return {
        "status": "partial_success" if failures else "success",
        "targetCount": len(target_columns),
        "successCount": len(results),
        "failedCount": len(failures),
        "failedTargets": failures,
        "candidateCount": sum(int(item.get("candidateCount") or 0) for item in results),
        "selectedCount": sum(int(item.get("selectedCount") or 0) for item in results),
        "clusterUsage": {
            "requestedMode": normalize_cluster_usage_mode(
                get_value(payload, "P_CLUSTER_USAGE_MODE", "clusterUsageMode"),
                "NONE",
            ),
            "effectiveMode": applied_cluster_usages[0].get("effectiveMode") if applied_cluster_usages else "NONE",
            "appliedYn": "Y" if applied_cluster_usages else "N",
            "fallbackYn": "Y" if fallback_cluster_usages else "N",
            "appliedTargetCount": len(applied_cluster_usages),
            "fallbackTargetCount": len(fallback_cluster_usages),
            "targetCount": len(cluster_usages),
            "targets": cluster_usages,
        },
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

    cluster_usages = [
        item.get("clusterUsage")
        for item in results
        if isinstance(item.get("clusterUsage"), dict)
    ]
    applied_cluster_usages = [item for item in cluster_usages if str(item.get("appliedYn") or "N").upper() == "Y"]

    return {
        "status": "partial_success" if failures else "success",
        "targetCount": len(target_columns),
        "successCount": len(results),
        "failedCount": len(failures),
        "failedTargets": failures,
        "featureCount": sum(int(item.get("featureCount") or 0) for item in results),
        "method": "AUTO",
        "clusterUsage": {
            "requestedMode": normalize_cluster_usage_mode(
                get_value(payload, "P_CLUSTER_USAGE_MODE", "clusterUsageMode"),
                "NONE",
            ),
            "effectiveMode": applied_cluster_usages[0].get("effectiveMode") if applied_cluster_usages else "NONE",
            "appliedYn": "Y" if applied_cluster_usages else "N",
            "appliedTargetCount": len(applied_cluster_usages),
            "targetCount": len(cluster_usages),
            "targets": cluster_usages,
        },
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
    max_symbolic_terms: int = 8,
) -> Tuple[str, float, int, str, str]:
    require_sklearn()
    holdout_indexes = build_symbolic_holdout_indexes(len(y_values))
    linear_candidate = None
    if linear_first:
        linear_expression, linear_score, linear_complexity, linear_method, linear_message = fit_linear_expression(
            x_values,
            y_values,
            feature_names,
        )
        linear_validation = None
        if holdout_indexes is not None:
            train_mask, validation_mask = holdout_indexes
            linear_validation = evaluate_linear_holdout(x_values, y_values, train_mask, validation_mask)
        linear_selection_score = get_symbolic_selection_score(linear_score, linear_validation)
        linear_candidate = {
            "expression": linear_expression,
            "fitScore": linear_score,
            "score": linear_selection_score,
            "complexity": linear_complexity,
            "method": linear_method,
            "message": append_symbolic_validation_diagnostics(
                linear_message,
                linear_score,
                linear_validation,
            ),
            "validation": linear_validation,
        }
        if linear_selection_score >= linear_r2_threshold:
            linear_candidate["message"] = (
                f"{linear_candidate['message']} "
                f"selection=LINEAR; reason=R2_THRESHOLD_{linear_r2_threshold:.6g}."
            )
            return symbolic_candidate_tuple(linear_candidate)

    if not use_pysr:
        fallback_expression, fallback_score, fallback_complexity, fallback_method, fallback_message = fit_polynomial_fallback(
            x_values,
            y_values,
            feature_names,
            "PySR disabled by P_USE_PYSR=N.",
            max_symbolic_terms,
        )
        return choose_symbolic_candidate(
            x_values,
            y_values,
            feature_names,
            linear_candidate,
            {
                "expression": fallback_expression,
                "fitScore": fallback_score,
                "complexity": fallback_complexity,
                "method": fallback_method,
                "message": fallback_message,
            },
            holdout_indexes,
            "POLYNOMIAL_FALLBACK",
            max_symbolic_terms,
        )
    try:
        from pysr import PySRRegressor

        if holdout_indexes is None:
            x_train = x_values
            y_train = y_values
            x_validation = None
            y_validation = None
        else:
            train_mask, validation_mask = holdout_indexes
            x_train = x_values[train_mask]
            y_train = y_values[train_mask]
            x_validation = x_values[validation_mask]
            y_validation = y_values[validation_mask]
        model = PySRRegressor(
            niterations=max_iterations,
            binary_operators=["+", "-", "*", "/"],
            unary_operators=["square"],
            maxsize=20,
            verbosity=0,
            random_state=42,
        )
        model.fit(x_train, y_train, variable_names=list(feature_names))
        best = model.get_best()
        expression = normalize_oracle_symbolic_expression(
            str(best.get("sympy_format") or best.get("equation") or model),
            feature_names,
        )
        train_prediction = model.predict(x_train)
        fit_score = safe_regression_r2(y_train, train_prediction)
        validation_metrics = (
            calculate_regression_metrics(y_validation, model.predict(x_validation))
            if x_validation is not None and y_validation is not None
            else None
        )
        score = get_symbolic_selection_score(fit_score, validation_metrics)
        complexity = int(best.get("complexity") or len(expression))
        pysr_candidate = {
            "expression": expression,
            "fitScore": fit_score,
            "score": score,
            "complexity": complexity,
            "method": "PYSR",
            "message": append_symbolic_validation_diagnostics(
                "PySR symbolic regression completed.",
                fit_score,
                validation_metrics,
            ),
            "validation": validation_metrics,
        }
        if score <= 0 and (
            linear_candidate is None
            or float(linear_candidate.get("score") or 0.0) <= 0
        ):
            return symbolic_candidate_tuple(
                build_constant_baseline_candidate(
                    y_values,
                    holdout_indexes,
                    "Neither the linear nor PySR candidate achieved positive validation R2.",
                )
            )
        if linear_candidate and should_keep_linear_expression(
            x_values,
            y_values,
            feature_names,
            linear_candidate["fitScore"],
            fit_score,
            complexity,
            linear_metrics=linear_candidate.get("validation"),
            fallback_metrics=validation_metrics,
            max_symbolic_terms=max_symbolic_terms,
        ):
            linear_candidate["message"] = (
                f"{linear_candidate['message']} selection=LINEAR; reason=PARSIMONY; "
                f"candidateMethod=PYSR; candidateR2={score:.6g}; candidateComplexity={complexity}."
            )
            return symbolic_candidate_tuple(linear_candidate)
        pysr_selection_reason = (
            "VALIDATION_GAIN"
            if validation_metrics
            else "EXPLICIT_NONLINEAR_WITHOUT_HOLDOUT"
        )
        pysr_candidate["message"] = (
            f"{pysr_candidate['message']} selection=PYSR; reason={pysr_selection_reason}."
        )
        return symbolic_candidate_tuple(pysr_candidate)
    except Exception as exc:
        fallback_expression, fallback_score, fallback_complexity, fallback_method, fallback_message = fit_polynomial_fallback(
            x_values,
            y_values,
            feature_names,
            str(exc),
            max_symbolic_terms,
        )
        return choose_symbolic_candidate(
            x_values,
            y_values,
            feature_names,
            linear_candidate,
            {
                "expression": fallback_expression,
                "fitScore": fallback_score,
                "complexity": fallback_complexity,
                "method": fallback_method,
                "message": fallback_message,
            },
            holdout_indexes,
            "PYSR_ERROR_FALLBACK",
            max_symbolic_terms,
        )


def symbolic_candidate_tuple(candidate: Dict[str, Any]) -> Tuple[str, float, int, str, str]:
    return (
        str(candidate.get("expression") or ""),
        float(candidate.get("score") or 0.0),
        int(candidate.get("complexity") or 0),
        str(candidate.get("method") or ""),
        str(candidate.get("message") or ""),
    )


def get_symbolic_selection_score(fit_score: float, validation_metrics: Optional[Dict[str, float]]) -> float:
    if validation_metrics and math.isfinite(float(validation_metrics.get("r2", float("nan")))):
        return float(validation_metrics["r2"])
    return float(fit_score)


def append_symbolic_validation_diagnostics(
    message: str,
    fit_score: float,
    validation_metrics: Optional[Dict[str, float]],
) -> str:
    prefix = str(message or "").strip()
    if validation_metrics:
        return (
            f"{prefix} fitR2={fit_score:.6g}; "
            f"validationR2={validation_metrics['r2']:.6g}; "
            f"validationRMSE={validation_metrics['rmse']:.6g}; "
            f"validationMAE={validation_metrics['mae']:.6g}; "
            f"validationBias={validation_metrics['bias']:.6g}; "
            f"validationRows={int(validation_metrics['rowCount'])}; "
            "validationSource=DETERMINISTIC_20PCT_HOLDOUT."
        )
    return (
        f"{prefix} fitR2={fit_score:.6g}; validationR2=UNAVAILABLE; "
        "validationSource=IN_SAMPLE_ONLY; warning=HOLDOUT_UNAVAILABLE_OR_TOO_SMALL."
    )


def build_constant_baseline_candidate(
    y_values,
    holdout_indexes,
    reason: str,
) -> Dict[str, Any]:
    intercept = float(np.mean(np.asarray(y_values, dtype=float)))
    fit_prediction = np.full(len(y_values), intercept, dtype=float)
    fit_score = safe_regression_r2(y_values, fit_prediction)
    validation_metrics = None
    if holdout_indexes is not None:
        train_mask, validation_mask = holdout_indexes
        training_mean = float(np.mean(np.asarray(y_values[train_mask], dtype=float)))
        validation_prediction = np.full(int(validation_mask.sum()), training_mean, dtype=float)
        validation_metrics = calculate_regression_metrics(
            y_values[validation_mask],
            validation_prediction,
        )
    message = append_symbolic_validation_diagnostics(
        "An intercept-only baseline was retained instead of forcing an unstable formula.",
        fit_score,
        validation_metrics,
    )
    return {
        "expression": format_linear_expression(intercept, []),
        "fitScore": fit_score,
        "score": get_symbolic_selection_score(fit_score, validation_metrics),
        "complexity": 1,
        "method": "CONSTANT_BASELINE",
        "message": f"{message} selection=CONSTANT_BASELINE; reason={reason}",
        "validation": validation_metrics,
    }


def choose_symbolic_candidate(
    x_values,
    y_values,
    feature_names: Sequence[str],
    linear_candidate: Optional[Dict[str, Any]],
    fallback_candidate: Dict[str, Any],
    holdout_indexes,
    selection_reason: str,
    max_symbolic_terms: int = 8,
) -> Tuple[str, float, int, str, str]:
    min_meaningful_r2 = 0.05
    fallback_validation = None
    if holdout_indexes is not None:
        train_mask, validation_mask = holdout_indexes
        try:
            fallback_validation = evaluate_polynomial_holdout(
                x_values,
                y_values,
                train_mask,
                validation_mask,
                max_symbolic_terms,
            )
        except Exception as exc:
            fallback_candidate["message"] = (
                f"{fallback_candidate.get('message') or ''} "
                f"Holdout evaluation failed: {str(exc)[:300]}"
            ).strip()
    fallback_fit_score = float(fallback_candidate.get("fitScore") or 0.0)
    fallback_score = get_symbolic_selection_score(fallback_fit_score, fallback_validation)
    fallback_candidate["score"] = fallback_score
    fallback_candidate["validation"] = fallback_validation
    fallback_candidate["message"] = append_symbolic_validation_diagnostics(
        str(fallback_candidate.get("message") or ""),
        fallback_fit_score,
        fallback_validation,
    )

    linear_selection_score = (
        float(linear_candidate.get("score") or 0.0)
        if linear_candidate
        else float("-inf")
    )
    if max(linear_selection_score, fallback_score) < min_meaningful_r2:
        return symbolic_candidate_tuple(
            build_constant_baseline_candidate(
                y_values,
                holdout_indexes,
                f"No candidate reached the minimum meaningful validation R2 ({min_meaningful_r2:.3g}).",
            )
        )
    if (
        str(fallback_candidate.get("method") or "") != "CONSTANT_BASELINE"
        and fallback_score <= 0
        and linear_selection_score <= 0
    ):
        return symbolic_candidate_tuple(
            build_constant_baseline_candidate(
                y_values,
                holdout_indexes,
                "No fitted candidate achieved positive validation R2.",
            )
        )

    if linear_candidate and should_keep_linear_expression(
        x_values,
        y_values,
        feature_names,
        float(linear_candidate.get("fitScore") or 0.0),
        fallback_fit_score,
        int(fallback_candidate.get("complexity") or 0),
        linear_metrics=linear_candidate.get("validation"),
        fallback_metrics=fallback_validation,
        max_symbolic_terms=max_symbolic_terms,
    ):
        linear_candidate["message"] = (
            f"{linear_candidate['message']} selection=LINEAR; reason=PARSIMONY; "
            f"candidateMethod={fallback_candidate.get('method')}; "
            f"candidateR2={fallback_score:.6g}; "
            f"candidateComplexity={int(fallback_candidate.get('complexity') or 0)}."
        )
        return symbolic_candidate_tuple(linear_candidate)

    if str(fallback_candidate.get("method") or "") == "CONSTANT_BASELINE":
        fallback_selection_reason = "REGULARIZED_CONSTANT_BASELINE"
    elif fallback_validation:
        fallback_selection_reason = f"{selection_reason}_VALIDATION_GAIN"
    else:
        fallback_selection_reason = f"{selection_reason}_IN_SAMPLE_ONLY"
    fallback_candidate["message"] = (
        f"{fallback_candidate['message']} selection={fallback_candidate.get('method')}; "
        f"reason={fallback_selection_reason}."
    )
    return symbolic_candidate_tuple(fallback_candidate)


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
    message = "Simple linear regression was evaluated as the parsimony baseline."
    return expression, score, complexity, "LINEAR_REGRESSION", message


def safe_regression_rmse(actual, predicted) -> float:
    actual_arr = np.asarray(actual, dtype=float)
    predicted_arr = np.asarray(predicted, dtype=float)
    if actual_arr.size == 0:
        return float("inf")
    return float(np.sqrt(np.mean(np.square(actual_arr - predicted_arr))))


def safe_regression_mae(actual, predicted) -> float:
    actual_arr = np.asarray(actual, dtype=float)
    predicted_arr = np.asarray(predicted, dtype=float)
    if actual_arr.size == 0:
        return float("inf")
    return float(np.mean(np.abs(actual_arr - predicted_arr)))


def safe_regression_r2(actual, predicted) -> float:
    try:
        score = float(r2_score(actual, predicted))
        if math.isnan(score) or math.isinf(score):
            return 0.0
        return score
    except Exception:
        return 0.0


def calculate_regression_metrics(actual, predicted) -> Dict[str, float]:
    actual_arr = np.asarray(actual, dtype=float)
    predicted_arr = np.asarray(predicted, dtype=float)
    residual = actual_arr - predicted_arr
    return {
        "r2": safe_regression_r2(actual_arr, predicted_arr),
        "rmse": safe_regression_rmse(actual_arr, predicted_arr),
        "mae": safe_regression_mae(actual_arr, predicted_arr),
        "bias": float(np.mean(residual)) if residual.size else 0.0,
        "rowCount": int(actual_arr.size),
    }


def build_symbolic_holdout_indexes(row_count: int):
    if row_count < 30:
        return None
    validation_count = max(6, min(row_count - 20, int(round(row_count * 0.2))))
    if validation_count < 6 or row_count - validation_count < 20:
        return None
    shuffled_indexes = np.random.default_rng(42).permutation(row_count)
    validation_mask = np.zeros(row_count, dtype=bool)
    validation_mask[shuffled_indexes[:validation_count]] = True
    return ~validation_mask, validation_mask


def evaluate_linear_holdout(x_values, y_values, train_mask, validation_mask) -> Dict[str, float]:
    model = LinearRegression()
    model.fit(x_values[train_mask], y_values[train_mask])
    prediction = model.predict(x_values[validation_mask])
    return calculate_regression_metrics(y_values[validation_mask], prediction)


def select_polynomial_term_indexes(coefficients, max_terms: int = 8) -> List[int]:
    ranked = sorted(
        (
            (index, abs(float(coefficient)))
            for index, coefficient in enumerate(coefficients)
            if abs(float(coefficient)) > 1.0e-8
        ),
        key=lambda item: (-item[1], item[0]),
    )
    return [index for index, _ in ranked[:max_terms]]


def predict_selected_polynomial_terms(model, x_poly, selected_indexes: Sequence[int]):
    prediction = np.full(x_poly.shape[0], float(model.intercept_), dtype=float)
    if selected_indexes:
        prediction += x_poly[:, list(selected_indexes)] @ np.asarray(model.coef_)[list(selected_indexes)]
    return prediction


def evaluate_polynomial_holdout(
    x_values,
    y_values,
    train_mask,
    validation_mask,
    max_symbolic_terms: int = 8,
) -> Dict[str, float]:
    x_scaler = StandardScaler(copy=True)
    y_scaler = StandardScaler(copy=True)
    x_train = x_scaler.fit_transform(x_values[train_mask])
    y_train = y_scaler.fit_transform(y_values[train_mask].reshape(-1, 1)).ravel()
    x_validation = x_scaler.transform(x_values[validation_mask])
    poly = PolynomialFeatures(degree=2, include_bias=False)
    x_train_poly = poly.fit_transform(x_train)
    cv = min(5, max(2, len(y_train) // 5))
    model = LassoCV(cv=cv, max_iter=10000, random_state=42)
    model.fit(x_train_poly, y_train)
    selected_indexes = select_polynomial_term_indexes(model.coef_, max_symbolic_terms)
    prediction_scaled = predict_selected_polynomial_terms(
        model,
        poly.transform(x_validation),
        selected_indexes,
    )
    prediction = y_scaler.inverse_transform(prediction_scaled.reshape(-1, 1)).ravel()
    metrics = calculate_regression_metrics(y_values[validation_mask], prediction)
    metrics["complexity"] = len(selected_indexes) + 1
    return metrics


def should_keep_linear_expression(
    x_values,
    y_values,
    feature_names: Sequence[str],
    linear_score: float,
    fallback_score: float,
    fallback_complexity: int,
    linear_metrics: Optional[Dict[str, float]] = None,
    fallback_metrics: Optional[Dict[str, float]] = None,
    max_symbolic_terms: int = 8,
) -> bool:
    if linear_metrics is None or fallback_metrics is None:
        holdout_indexes = build_symbolic_holdout_indexes(len(y_values))
        if holdout_indexes is not None:
            train_mask, validation_mask = holdout_indexes
            try:
                linear_metrics = linear_metrics or evaluate_linear_holdout(
                    x_values,
                    y_values,
                    train_mask,
                    validation_mask,
                )
                fallback_metrics = fallback_metrics or evaluate_polynomial_holdout(
                    x_values,
                    y_values,
                    train_mask,
                    validation_mask,
                    max_symbolic_terms,
                )
            except Exception:
                linear_metrics = None
                fallback_metrics = None

    if linear_metrics and fallback_metrics:
        linear_rmse = float(linear_metrics.get("rmse", float("inf")))
        fallback_rmse = float(fallback_metrics.get("rmse", float("inf")))
        linear_r2 = float(linear_metrics.get("r2", 0.0))
        fallback_r2 = float(fallback_metrics.get("r2", 0.0))
        if not math.isfinite(fallback_rmse) or not math.isfinite(fallback_r2):
            return True
        if not math.isfinite(linear_rmse) or linear_rmse <= 0:
            return False
        if fallback_complexity <= 3 and fallback_r2 >= linear_r2 - 0.005:
            return False

        rmse_improvement = (linear_rmse - fallback_rmse) / max(linear_rmse, 1.0e-12)
        r2_improvement = fallback_r2 - linear_r2
        if fallback_complexity >= 10:
            required_r2_gain, required_rmse_gain = 0.03, 0.12
        elif fallback_complexity >= 6:
            required_r2_gain, required_rmse_gain = 0.02, 0.08
        else:
            required_r2_gain, required_rmse_gain = 0.01, 0.05
        candidate_overfit_gap = fallback_score - fallback_r2
        linear_overfit_gap = linear_score - linear_r2
        if candidate_overfit_gap > max(0.15, linear_overfit_gap + 0.10):
            return True
        return r2_improvement < required_r2_gain and rmse_improvement < required_rmse_gain

    if fallback_complexity <= 3:
        return False
    if fallback_score <= linear_score:
        return True
    if linear_score >= 0.98 and (fallback_score - linear_score) < 0.01:
        return True
    return linear_score >= 0.95 and fallback_complexity >= 8 and (fallback_score - linear_score) < 0.03


def fit_polynomial_fallback(
    x_values,
    y_values,
    feature_names: Sequence[str],
    reason: str,
    max_symbolic_terms: int = 8,
) -> Tuple[str, float, int, str, str]:
    x_scaler = StandardScaler(copy=True)
    y_scaler = StandardScaler(copy=True)
    x_scaled = x_scaler.fit_transform(x_values)
    y_scaled = y_scaler.fit_transform(y_values.reshape(-1, 1)).ravel()
    poly = PolynomialFeatures(degree=2, include_bias=False)
    x_poly = poly.fit_transform(x_scaled)
    cv = min(5, max(2, len(y_scaled) // 5))
    model = LassoCV(cv=cv, max_iter=10000, random_state=42)
    model.fit(x_poly, y_scaled)
    selected_indexes = select_polynomial_term_indexes(model.coef_, max_symbolic_terms)
    prediction_scaled = predict_selected_polynomial_terms(model, x_poly, selected_indexes)
    prediction = y_scaler.inverse_transform(prediction_scaled.reshape(-1, 1)).ravel()
    score = safe_regression_r2(y_values, prediction)
    y_mean = float(y_scaler.mean_[0])
    y_scale = float(y_scaler.scale_[0]) if abs(float(y_scaler.scale_[0])) > 1.0e-12 else 1.0
    x_means = [float(value) for value in x_scaler.mean_]
    x_scales = [float(value) if abs(float(value)) > 1.0e-12 else 1.0 for value in x_scaler.scale_]
    terms = []
    for index in selected_indexes:
        coef = model.coef_[index]
        powers = poly.powers_[index]
        raw_coef = float(coef) * y_scale
        term_expr = format_polynomial_raw_term(powers, feature_names, x_means, x_scales)
        if term_expr:
            terms.append((raw_coef, term_expr))
    intercept = y_mean + y_scale * float(model.intercept_)
    expression = format_polynomial_expression(intercept, terms)
    complexity = len(terms) + 1
    method = "CONSTANT_BASELINE" if complexity == 1 else "POLYNOMIAL_LASSO_FALLBACK"
    if complexity == 1:
        message = "Regularization removed all polynomial terms, so an intercept-only baseline was retained instead of forcing a formula."
    elif "P_USE_PYSR=N" in str(reason or ""):
        message = "Polynomial LASSO fallback was evaluated because PySR was disabled."
    else:
        message = "PySR was unavailable or failed; polynomial LASSO fallback was evaluated."
    if complexity > 1:
        message = (
            f"{message} The original-scale expression is capped at {max_symbolic_terms} terms, "
            "and its score is calculated from the same retained terms."
        )
    if reason:
        reason_label = "Configuration note" if "P_USE_PYSR=N" in str(reason) else "First PySR error"
        message = f"{message} {reason_label}: {reason[:500]}"
    return expression, score, complexity, method, message


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
            SqlLoader.get_sql("ML_ANALYSIS_CONTINUOUS_TARGET_COLUMNS"),
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
              FROM "INIT$_TB_COLREL_NUM_PAIR"
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
              FROM "INIT$_TB_COLREL_NUM_SUMMARY"
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
                              FROM "INIT$_TB_COLREL_NUM_PAIR"
                             WHERE "RUN_SOURCE_TYPE" = :runSourceType
                               AND "RUN_ID" = :runId
                               AND "OWNER" = :owner
                               AND "TABLE_NAME" = :tableName
                               AND "PASS_YN" = 'Y'
                            UNION ALL
                            SELECT "COL_B" AS COLUMN_NAME
                                 , "ABS_PEARSON_R" AS SORT_SCORE
                              FROM "INIT$_TB_COLREL_NUM_PAIR"
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
              FROM "INIT$_TB_COLREL_LASSO_FEATURE"
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
              FROM "INIT$_TB_COLREL_LASSO_FEATURE"
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


def _ml_in_memory_row_limit() -> int:
    return _positive_env_int("APP_ML_MAX_IN_MEMORY_ROWS", 25000, 1000)


def _ml_input_feature_limit() -> int:
    return _positive_env_int("APP_ML_MAX_INPUT_FEATURES", 50, 1)


def _ml_fetch_batch_rows() -> int:
    return _positive_env_int("APP_ML_FETCH_BATCH_ROWS", 1000, 100)


def _ml_runtime_limit(payload: Dict[str, Any], key: str, hard_limit: int, minimum: int) -> int:
    """Return a request/job limit without allowing it to exceed the server cap."""
    try:
        requested = int((payload or {}).get(key, hard_limit))
    except (TypeError, ValueError):
        requested = hard_limit
    return min(hard_limit, max(minimum, requested))


def fetch_numeric_matrix(
    conn,
    owner: str,
    table: str,
    target_column: str,
    feature_columns: Sequence[str],
    sample_rows: Optional[int],
    max_in_memory_rows: Optional[int] = None,
    max_input_features: Optional[int] = None,
):
    hard_row_limit = _ml_in_memory_row_limit()
    hard_feature_limit = _ml_input_feature_limit()
    row_limit = min(
        hard_row_limit,
        max(1000, int(max_in_memory_rows or hard_row_limit)),
    )
    feature_limit = min(
        hard_feature_limit,
        max(1, int(max_input_features or hard_feature_limit)),
    )
    requested_features = list(feature_columns)
    effective_features = requested_features[:feature_limit]
    if not effective_features:
        raise HTTPException(status_code=400, detail="At least one numeric feature column is required.")

    effective_sample_rows = min(
        int(sample_rows) if sample_rows and int(sample_rows) > 0 else row_limit,
        row_limit,
    )
    columns = [target_column] + effective_features
    select_list = ", ".join(quote_identifier(column) for column in columns)
    null_filter = " AND ".join(f"{quote_identifier(column)} IS NOT NULL" for column in columns)
    sql = (
        f"SELECT {select_list}\n"
        f"  FROM {quote_identifier(owner)}.{quote_identifier(table)}\n"
        f" WHERE {null_filter}"
    )
    binds = {"sampleRows": effective_sample_rows}
    sql += "\n   AND ROWNUM <= :sampleRows"

    cursor = conn.cursor()
    try:
        batch_rows = min(_ml_fetch_batch_rows(), effective_sample_rows)
        try:
            cursor.arraysize = batch_rows
            cursor.prefetchrows = batch_rows
        except Exception:
            pass
        cursor.execute(sql, binds)
        x_values = np.empty((effective_sample_rows, len(effective_features)), dtype=float)
        y_values = np.empty(effective_sample_rows, dtype=float)
        valid_row_count = 0
        while valid_row_count < effective_sample_rows:
            rows = cursor.fetchmany(min(batch_rows, effective_sample_rows - valid_row_count))
            if not rows:
                break
            for row in rows:
                values = [to_float(value) for value in row]
                if any(value is None or not math.isfinite(value) for value in values):
                    continue
                y_values[valid_row_count] = values[0]
                x_values[valid_row_count, :] = values[1:]
                valid_row_count += 1
                if valid_row_count >= effective_sample_rows:
                    break
        if not valid_row_count:
            raise HTTPException(status_code=400, detail="No complete numeric rows were found.")
        return (
            x_values[:valid_row_count],
            y_values[:valid_row_count],
            effective_features,
            {
                "requestedSampleRows": int(sample_rows) if sample_rows else None,
                "effectiveSampleRows": effective_sample_rows,
                "loadedRows": valid_row_count,
                "requestedFeatureCount": len(requested_features),
                "effectiveFeatureCount": len(effective_features),
                "maxInMemoryRows": row_limit,
                "maxInputFeatures": feature_limit,
            },
        )
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
        DELETE FROM "INIT$_TB_COLREL_NETWORK_EDGE"
         WHERE "RUN_SOURCE_TYPE" = :runSourceType
           AND "RUN_ID" = :runId
           AND "OWNER" = :owner
           AND "TABLE_NAME" = :tableName
        """,
        params,
    )
    cursor.execute(
        """
        DELETE FROM "INIT$_TB_COLREL_NETWORK_NODE"
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
          FROM "INIT$_TB_COLREL_PAIR"
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

    # Do not vary the partition by optional Python packages.  The previous fallback
    # used connected components when NetworkX/Louvain was unavailable, which turns a
    # connected graph into one cluster even when the same edges form multiple Louvain
    # communities on another server.
    communities = deterministic_weighted_communities(node_types, edge_rows)
    algorithm = "DETERMINISTIC_WEIGHTED_COMMUNITY"
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


def deterministic_weighted_communities(
    node_types: Dict[str, str],
    edge_rows: Sequence[Dict[str, Any]],
) -> List[Set[str]]:
    """Build a stable, weighted community partition without optional dependencies."""
    nodes = sorted(node_types)
    if not nodes:
        return []

    weighted_adjacency: Dict[str, Dict[str, float]] = {node: {} for node in nodes}
    for row in edge_rows:
        col_a = str(row.get("COL_A") or "").upper()
        col_b = str(row.get("COL_B") or "").upper()
        if not col_a or not col_b or col_a == col_b or col_a not in weighted_adjacency or col_b not in weighted_adjacency:
            continue
        weight = max(0.0, float(row.get("ABS_METRIC_VALUE") or 0.0))
        if weight <= 0:
            continue
        weighted_adjacency[col_a][col_b] = weighted_adjacency[col_a].get(col_b, 0.0) + weight
        weighted_adjacency[col_b][col_a] = weighted_adjacency[col_b].get(col_a, 0.0) + weight

    weighted_degree = {
        node: sum(weighted_adjacency[node].values())
        for node in nodes
    }
    total_weight = sum(weighted_degree.values()) / 2.0
    if total_weight <= 0:
        return [{node} for node in nodes]

    # This is the local-move phase of weighted modularity optimization.  Sorting both
    # nodes and candidate communities makes ties deterministic across Python processes.
    community_by_node = {node: node for node in nodes}
    community_weight = dict(weighted_degree)
    for _ in range(max(1, len(nodes) * 4)):
        moved = False
        for node in nodes:
            current_community = community_by_node[node]
            node_weight = weighted_degree[node]
            community_weight[current_community] -= node_weight
            neighbor_community_weight: Dict[str, float] = {}
            for neighbor in sorted(weighted_adjacency[node]):
                community = community_by_node[neighbor]
                neighbor_community_weight[community] = (
                    neighbor_community_weight.get(community, 0.0)
                    + weighted_adjacency[node][neighbor]
                )

            candidate_communities = sorted(set(neighbor_community_weight) | {current_community})

            def modularity_score(community: str) -> float:
                return (
                    neighbor_community_weight.get(community, 0.0)
                    - (community_weight.get(community, 0.0) * node_weight) / (2.0 * total_weight)
                )

            current_score = modularity_score(current_community)
            best_community = current_community
            best_score = current_score
            for community in candidate_communities:
                score = modularity_score(community)
                if score > best_score + 1.0e-12:
                    best_community = community
                    best_score = score

            community_by_node[node] = best_community
            community_weight[best_community] = community_weight.get(best_community, 0.0) + node_weight
            moved = moved or best_community != current_community
        if not moved:
            break

    grouped: Dict[str, Set[str]] = {}
    for node in nodes:
        grouped.setdefault(community_by_node[node], set()).add(node)
    return list(grouped.values())


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
        INSERT INTO "INIT$_TB_COLREL_NETWORK_NODE" (
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
        INSERT INTO "INIT$_TB_COLREL_NETWORK_EDGE" (
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
        UPDATE "INIT$_TB_COLREL_PAIR"
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
    global np, Lasso, LassoCV, LinearRegression, PolynomialFeatures, StandardScaler, r2_score
    global _sklearn_import_error
    if np is None or LassoCV is None or LinearRegression is None or StandardScaler is None:
        with _sklearn_import_lock:
            if np is None or LassoCV is None or LinearRegression is None or StandardScaler is None:
                try:
                    import numpy as numpy_module
                    from sklearn.linear_model import Lasso as lasso_class
                    from sklearn.linear_model import LassoCV as lasso_cv_class
                    from sklearn.linear_model import LinearRegression as linear_regression_class
                    from sklearn.metrics import r2_score as r2_score_function
                    from sklearn.preprocessing import PolynomialFeatures as polynomial_features_class
                    from sklearn.preprocessing import StandardScaler as standard_scaler_class

                    np = numpy_module
                    Lasso = lasso_class
                    LassoCV = lasso_cv_class
                    LinearRegression = linear_regression_class
                    PolynomialFeatures = polynomial_features_class
                    StandardScaler = standard_scaler_class
                    r2_score = r2_score_function
                    _sklearn_import_error = None
                except Exception as error:  # pragma: no cover - runtime dependency availability.
                    _sklearn_import_error = error

    if np is None or LassoCV is None or LinearRegression is None or StandardScaler is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Python ML dependencies are not installed. Install numpy and scikit-learn in the WAS environment."
                + (f" ({_sklearn_import_error})" if _sklearn_import_error else "")
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
