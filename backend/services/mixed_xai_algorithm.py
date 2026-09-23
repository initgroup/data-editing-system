"""Bounded, unsupervised mixed-data analysis and auditable surrogate rules.

Physical Oracle types select the encoder; no learned column-type stage is used.
The holdout is reserved before fitting both encoders and models.  All labels and
purity metrics refer to Isolation Forest predictions, never confirmed errors.
"""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
from scipy import sparse
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import OneHotEncoder
from sklearn.tree import DecisionTreeClassifier


_NUMERIC_TYPES = {"NUMBER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE", "INTEGER", "DECIMAL"}
_TEXT_TYPES = {"VARCHAR2", "NVARCHAR2", "VARCHAR", "CHAR", "NCHAR"}
_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")
_ID_NAME = re.compile(r"(^|_)(ID|KEY|UUID|GUID|SEQ|ROWID|ROW_NO|RN)($|_)", re.I)


def _option(options, snake, camel, default, lower, upper, integer=False):
    value = options.get(snake, options.get(camel, default))
    if isinstance(value, bool):
        raise ValueError(f"{camel} must be a number")
    try:
        value = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{camel} must be a number") from exc
    if not math.isfinite(value) or value < lower or value > upper:
        raise ValueError(f"{camel} must be between {lower} and {upper}")
    if integer and value != int(value):
        raise ValueError(f"{camel} must be an integer")
    return int(value) if integer else value


def _missing(value):
    # Oracle treats an empty character value as NULL. Nonfinite numbers are not
    # NULL and are excluded separately, so the generated SQL remains equivalent.
    return value is None or (isinstance(value, str) and value == "")


def _atom(column, operator, value=None, value_type=None):
    result = {"column": column, "operator": operator}
    if operator not in {"IS_NULL", "NOT_NULL"}:
        result["value"] = value
    if value_type:
        result["valueType"] = value_type
    return result


def _group(operator, conditions):
    return conditions[0] if len(conditions) == 1 else {"operator": operator, "conditions": conditions}


def _float32_boundary(threshold):
    """Largest float32 <= sklearn's double threshold; preserves both branches."""
    value = np.float32(threshold)
    if float(value) > threshold:
        value = np.nextafter(value, np.float32(-np.inf), dtype=np.float32)
    return float(value)


def _branch_predicate(feature, threshold, left):
    column = feature["column"]
    if feature["kind"] == "numeric":
        boundary = _float32_boundary(threshold)
        comparison = _atom(column, "<=" if left else ">", boundary, "BINARY_FLOAT")
        nonnull = _group("AND", [_atom(column, "NOT_NULL"), comparison])
        missing_goes_left = feature["imputeValue"] <= threshold
        if missing_goes_left == left:
            return _group("OR", [_atom(column, "IS_NULL"), nonnull])
        return nonnull
    if feature["kind"] == "missing":
        return _atom(column, "NOT_NULL" if left else "IS_NULL")
    category = feature["category"]
    if category is None:
        return _atom(column, "NOT_NULL" if left else "IS_NULL")
    if left:
        return _group("OR", [_atom(column, "IS_NULL"), _atom(column, "!=", category)])
    return _atom(column, "=", category)


def evaluate_predicate(predicate: dict, row: dict) -> bool:
    """Reference evaluator for the emitted AST, including Oracle NULL semantics.

    Numeric BINARY_FLOAT atoms require CAST(column AS BINARY_FLOAT) in Oracle.
    Threshold values are exactly representable float32 values. Never interpolate
    a value into SQL: bind it and validate column names against source metadata.
    """
    operator = predicate["operator"]
    if operator == "AND":
        return all(evaluate_predicate(item, row) for item in predicate["conditions"])
    if operator == "OR":
        return any(evaluate_predicate(item, row) for item in predicate["conditions"])
    value = row.get(predicate["column"])
    if operator == "IS_NULL":
        return _missing(value)
    if operator == "NOT_NULL":
        return not _missing(value)
    if _missing(value):
        return False
    expected = predicate["value"]
    if predicate.get("valueType") == "BINARY_FLOAT":
        value = float(np.float32(value))
    elif isinstance(expected, str):
        value = str(value)
    if operator == "=":
        return value == expected
    if operator == "!=":
        return value != expected
    if operator == "<=":
        return value <= expected
    if operator == ">":
        return value > expected
    raise ValueError(f"Unsupported predicate operator: {operator}")


def predicate_expression(predicate: dict) -> str:
    """Display text only. This is intentionally not an executable SQL builder."""
    operator = predicate["operator"]
    if operator in {"AND", "OR"}:
        return "(" + f" {operator} ".join(predicate_expression(p) for p in predicate["conditions"]) + ")"
    column = predicate["column"]
    if operator in {"IS_NULL", "NOT_NULL"}:
        return f"{column} {'IS NULL' if operator == 'IS_NULL' else 'IS NOT NULL'}"
    value = predicate["value"]
    literal = repr(value) if isinstance(value, str) else format(value, ".9g")
    return f"{column} {operator} {literal}"


def _prediction_metrics(actual, predicted):
    actual = np.asarray(actual, dtype=bool)
    predicted = np.asarray(predicted, dtype=bool)
    tp = int(np.sum(actual & predicted))
    fp = int(np.sum(~actual & predicted))
    fn = int(np.sum(actual & ~predicted))
    tn = int(np.sum(~actual & ~predicted))
    return {
        "sampleCount": len(actual), "anomalyCount": int(actual.sum()),
        "predictedAnomalyCount": int(predicted.sum()),
        "fidelity": float(np.mean(actual == predicted)) if len(actual) else None,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "truePositive": tp, "falsePositive": fp, "falseNegative": fn, "trueNegative": tn,
    }


def _fit_encoding(rows, columns, train_indices, options):
    max_columns = _option(options, "max_columns", "maxColumns", 64, 1, 128, True)
    max_categories = _option(options, "max_categories", "maxCategories", 32, 2, 128, True)
    max_features = _option(options, "max_features", "maxFeatures", 1024, 2, 4096, True)
    excluded_names = options.get("exclude_columns", options.get("excludeColumns", [])) or []
    if not isinstance(excluded_names, (list, tuple)) or not all(isinstance(x, str) for x in excluded_names):
        raise ValueError("excludeColumns must be a list of column names")
    excluded_names = set(excluded_names)
    blocks, descriptors, included, excluded, seen = [], [], [], [], set()

    def exclude(name, reason):
        excluded.append({"column": name, "reason": reason})

    for column in columns:
        name = column.get("name", column.get("columnName", column.get("COLUMN_NAME", column.get("column_name"))))
        raw_type = column.get("dataType", column.get("data_type", column.get("DATA_TYPE", "")))
        data_type = str(raw_type).upper().split("(", 1)[0].strip()
        if not isinstance(name, str) or not _IDENTIFIER.fullmatch(name):
            raise ValueError("Source metadata contains an invalid Oracle column identifier")
        if name in seen:
            raise ValueError(f"Duplicate source column: {name}")
        seen.add(name)
        if name in excluded_names:
            exclude(name, "USER_EXCLUDED")
            continue
        if data_type not in _NUMERIC_TYPES | _TEXT_TYPES:
            exclude(name, "UNSUPPORTED_PHYSICAL_TYPE")
            continue
        if len(included) >= max_columns:
            exclude(name, "COLUMN_LIMIT")
            continue
        values = [row.get(name) for row in rows]
        train_values = [values[int(i)] for i in train_indices]
        present = [v for v in train_values if not _missing(v)]
        if not present:
            exclude(name, "ALL_NULL_IN_TRAIN")
            continue
        if data_type in _NUMERIC_TYPES:
            try:
                with np.errstate(over="ignore", invalid="ignore"):
                    numeric = np.asarray([np.nan if _missing(v) else float(v) for v in values], dtype=np.float32)
                nonnull = np.asarray([not _missing(v) for v in values])
                if not np.all(np.isfinite(numeric[nonnull])):
                    raise ValueError("Nonfinite or unrepresentable value")
            except (TypeError, ValueError, OverflowError):
                exclude(name, "INVALID_OR_NONFINITE_NUMERIC")
                continue
            numeric_train = numeric[train_indices]
            finite_train = numeric_train[np.isfinite(numeric_train)]
            unique_count = len(np.unique(finite_train))
            if _ID_NAME.search(name) and unique_count / len(present) >= 0.98:
                exclude(name, "IDENTIFIER_LIKE")
                continue
            if unique_count <= 1 and len(present) == len(train_values):
                exclude(name, "CONSTANT_IN_TRAIN")
                continue
            if len(descriptors) + 2 > max_features:
                exclude(name, "ENCODED_FEATURE_LIMIT")
                continue
            # Compute in float64 to avoid median overflow for very large values.
            median = float(np.float32(np.median(finite_train.astype(np.float64))))
            missing = np.isnan(numeric)
            numeric[missing] = median
            blocks.append(sparse.csr_matrix(np.column_stack([numeric, missing.astype(np.float32)])))
            descriptors.extend([
                {"column": name, "kind": "numeric", "imputeValue": median},
                {"column": name, "kind": "missing"},
            ])
            included.append({"column": name, "physicalType": data_type, "encoding": "NUMERIC_MEDIAN_WITH_MISSING_FLAG", "imputeValue": median})
        else:
            if any(not _missing(v) and (not isinstance(v, str) or len(v) > 1024) for v in values):
                exclude(name, "UNSUPPORTED_OR_LONG_TEXT")
                continue
            categories = set(present)
            count = len(categories) + int(len(present) < len(train_values))
            if count <= 1:
                exclude(name, "CONSTANT_IN_TRAIN")
                continue
            if len(categories) / len(present) >= 0.98 and len(categories) >= 16:
                exclude(name, "IDENTIFIER_LIKE" if _ID_NAME.search(name) else "HIGH_CARDINALITY")
                continue
            if count > max_categories:
                exclude(name, "CATEGORY_LIMIT")
                continue
            if len(descriptors) + count > max_features:
                exclude(name, "ENCODED_FEATURE_LIMIT")
                continue
            tokens = np.asarray([["M:" if _missing(v) else "V:" + v] for v in values], dtype=object)
            encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=True, dtype=np.float32)
            encoder.fit(tokens[train_indices])
            blocks.append(encoder.transform(tokens))
            decoded = [None if token == "M:" else str(token)[2:] for token in encoder.categories_[0]]
            descriptors.extend({"column": name, "kind": "category", "category": value} for value in decoded)
            included.append({"column": name, "physicalType": data_type, "encoding": "SPARSE_ONE_HOT", "categories": decoded,
                             "unknownCategoryCount": int(sum(token[0] not in encoder.categories_[0] for token in tokens)), "unknownHandling": "ALL_ZERO"})
    if not blocks:
        raise ValueError("No usable features remain after excluding identifiers, constants, unsupported types, and high-cardinality columns")
    matrix = sparse.hstack(blocks, format="csr", dtype=np.float32)
    return matrix, descriptors, {"features": included, "excludedColumns": excluded, "sourceColumnCount": len(columns),
                                 "encodedFeatureCount": matrix.shape[1], "sparse": True, "fitSource": "TRAIN_ONLY",
                                 "numericPrecision": "BINARY_FLOAT", "maxColumns": max_columns, "maxCategories": max_categories,
                                 "maxEncodedFeatures": max_features}


def analyze_mixed_rows(rows: list[dict], columns: list[dict], options: dict | None = None) -> dict[str, Any]:
    """Fit Isolation Forest and a shallow decision-tree explanation on a sample.

    Options accept snake_case and camelCase names. Defaults: maxRows=20000,
    contamination=0.05, holdoutFraction=0.25, treeMaxDepth=4, maxRules=16,
    minRulePurity=0.7, randomSeed=42. maxRows is hard bounded to 50000; rows over
    the cap are uniformly sampled with the fixed seed and retain original indices.
    Row labels outside the sample are deliberately not invented.
    """
    options = options or {}
    if not isinstance(options, dict):
        raise ValueError("options must be an object")
    options = dict(options)
    for service_name, algorithm_name in (("maxDepth", "treeMaxDepth"), ("minSamplesLeaf", "minLeafCount"), ("randomState", "randomSeed")):
        if service_name in options and algorithm_name not in options:
            options[algorithm_name] = options[service_name]
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError("rows must be a list of row objects")
    if not isinstance(columns, list) or not columns or not all(isinstance(col, dict) for col in columns):
        raise ValueError("columns must contain physical Oracle column metadata")
    if len(rows) < 32:
        raise ValueError("Mixed-data analysis requires at least 32 rows")
    max_rows = _option(options, "max_rows", "maxRows", 20000, 32, 50000, True)
    seed = _option(options, "random_seed", "randomSeed", 42, 0, 2**32 - 1, True)
    contamination = _option(options, "contamination", "contamination", .05, .001, .25)
    holdout_fraction = _option(options, "holdout_fraction", "holdoutFraction", .25, .15, .4)
    depth = _option(options, "tree_max_depth", "treeMaxDepth", 4, 1, 6, True)
    max_rules = _option(options, "max_rules", "maxRules", 16, 1, 32, True)
    purity_min = _option(options, "min_rule_purity", "minRulePurity", .7, .5, 1.)
    estimators = _option(options, "n_estimators", "nEstimators", 100, 32, 256, True)
    forest_samples = _option(options, "forest_max_samples", "forestMaxSamples", 256, 32, 1024, True)
    rng = np.random.default_rng(seed)
    selected = np.sort(rng.choice(len(rows), max_rows, replace=False)) if len(rows) > max_rows else np.arange(len(rows))
    sample = [rows[int(i)] for i in selected]
    indices = rng.permutation(len(sample))
    holdout_count = max(8, int(math.ceil(len(sample) * holdout_fraction)))
    holdout_indices = np.sort(indices[:holdout_count])
    train_indices = np.sort(indices[holdout_count:])
    min_leaf = _option(options, "min_leaf_count", "minLeafCount", max(3, int(len(train_indices) * .005)), 2, 10000, True)
    if min_leaf * 2 > len(train_indices):
        raise ValueError("minLeafCount is too large for the training sample")
    matrix, features, encoding = _fit_encoding(sample, columns, train_indices, options)
    forest = IsolationForest(n_estimators=estimators, max_samples=min(forest_samples, len(train_indices)),
                             contamination=contamination, random_state=seed, n_jobs=1)
    train_matrix = matrix[train_indices].tocsc()
    forest.fit(train_matrix)
    # Negated score_samples is the original anomaly score, not an error probability.
    scores = -forest.score_samples(matrix)
    threshold = float(-forest.offset_)
    labels = scores > threshold
    tree = DecisionTreeClassifier(max_depth=depth, max_leaf_nodes=max_rules * 2,
                                  min_samples_leaf=min_leaf, random_state=seed)
    tree.fit(train_matrix, labels[train_indices])
    surrogate = tree.predict(matrix).astype(bool)
    leaves = tree.apply(matrix)
    rules = []

    def collect(node, path):
        feature_index = tree.tree_.feature[node]
        if feature_index >= 0:
            feature = features[feature_index]
            split = float(tree.tree_.threshold[node])
            collect(tree.tree_.children_left[node], path + [_branch_predicate(feature, split, True)])
            collect(tree.tree_.children_right[node], path + [_branch_predicate(feature, split, False)])
            return
        predicted = bool(tree.classes_[int(np.argmax(tree.tree_.value[node][0]))])
        if not predicted or not path:
            return
        train_match = train_indices[leaves[train_indices] == node]
        holdout_match = holdout_indices[leaves[holdout_indices] == node]
        anomaly_count = int(labels[train_match].sum())
        purity = anomaly_count / len(train_match)
        if purity < purity_min:
            return
        predicate = _group("AND", path)
        all_match = np.flatnonzero(leaves == node)
        rules.append({"ruleId": f"MIXED_XAI_LEAF_{node}", "leafId": int(node), "predicate": predicate,
                      "expression": f"IF {predicate_expression(predicate)} THEN ANOMALY_CANDIDATE",
                      "status": "CANDIDATE", "supportCount": len(train_match), "anomalyCount": anomaly_count,
                      "anomalyPurity": purity, "sampleSupportCount": len(all_match),
                      "sampleAnomalyCount": int(labels[all_match].sum()), "holdoutSupportCount": len(holdout_match),
                      "holdoutAnomalyCount": int(labels[holdout_match].sum()),
                      "holdoutAnomalyPurity": float(labels[holdout_match].mean()) if len(holdout_match) else None,
                      "validationStatus": "HOLDOUT_OBSERVED" if len(holdout_match) >= 5 else "INSUFFICIENT_HOLDOUT_SUPPORT",
                      "metricMeaning": "AGREEMENT_WITH_ISOLATION_FOREST_NOT_CONFIRMED_ERROR"})

    collect(0, [])
    # Ranking uses training data only. Holdout evidence is not used for selection.
    rules.sort(key=lambda rule: (-rule["anomalyPurity"], -rule["anomalyCount"], rule["leafId"]))
    rules = rules[:max_rules]
    published = np.isin(leaves, [rule["leafId"] for rule in rules])
    holdout_metrics = _prediction_metrics(labels[holdout_indices], surrogate[holdout_indices])
    published_metrics = _prediction_metrics(labels[holdout_indices], published[holdout_indices])
    warnings = []
    if len(selected) < len(rows):
        warnings.append("ROW_LIMIT_UNIFORM_SAMPLE_ONLY")
    if not rules:
        warnings.append("NO_RELIABLE_SURROGATE_RULE_CANDIDATES")
    if holdout_metrics["anomalyCount"] < 5:
        warnings.append("FEW_HOLDOUT_ANOMALIES_METRICS_UNSTABLE")
    if any(rule["validationStatus"] != "HOLDOUT_OBSERVED" for rule in rules):
        warnings.append("SOME_RULES_HAVE_INSUFFICIENT_HOLDOUT_SUPPORT")
    holdout_set = set(holdout_indices.tolist())
    return {
        "algorithm": "ISOLATION_FOREST_SURROGATE_TREE", "version": 1,
        "rows": [{"rowIndex": int(original), "anomalyScore": float(scores[i]), "isAnomaly": bool(labels[i]),
                  "surrogateAnomaly": bool(surrogate[i]), "ruleCandidate": bool(published[i]),
                  "partition": "HOLDOUT" if i in holdout_set else "TRAIN"} for i, original in enumerate(selected)],
        "rules": rules, "encoding": encoding, "warnings": warnings,
        "metrics": {"inputCount": len(rows), "sampleCount": len(sample), "trainCount": len(train_indices),
                    "holdoutCount": len(holdout_indices), "anomalyCount": int(labels.sum()),
                    "anomalyThreshold": threshold, "contamination": contamination,
                    "holdoutFidelity": holdout_metrics["fidelity"], "holdoutPrecision": holdout_metrics["precision"],
                    "holdoutRecall": holdout_metrics["recall"], "holdout": holdout_metrics,
                    "publishedRulesHoldout": published_metrics, "randomSeed": seed,
                    "validationSource": "UNTOUCHED_HOLDOUT", "hasGroundTruth": False,
                    "scoreMeaning": "HIGHER_IS_MORE_ANOMALOUS_NOT_ERROR_PROBABILITY",
                    "ruleCount": len(rules), "treeDepth": int(tree.get_depth()), "treeLeafCount": int(tree.get_n_leaves())},
    }
