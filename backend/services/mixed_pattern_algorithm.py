"""Bounded, target-column IF/THEN discovery with independent validation.

Each model predicts an actual source column from the other source columns. A
published rule is a normal data pattern, not a surrogate for an anomaly label.
Training and validation denominators include missing target values; an absent
value consequently violates a nonmissing expected value/range. Validation is
used for rule selection and is deliberately not described as an unbiased test.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json
import math
from typing import Any

import numpy as np
from sklearn.tree import DecisionTreeClassifier

from backend.services.mixed_xai_algorithm import (
    _ID_NAME, _IDENTIFIER, _NUMERIC_TYPES, _TEXT_TYPES, _atom,
    _branch_predicate, _fit_encoding, _group, _missing, _option,
    evaluate_predicate,
)


def _decimal(value):
    if isinstance(value, bool):
        raise ValueError("Boolean is not a numeric source value")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("Invalid numeric source value") from exc
    if not result.is_finite():
        raise ValueError("Nonfinite numeric source value")
    return result


def _number_value(value):
    """JSON-safe NUMBER without silently reducing Oracle decimal precision."""
    value = _decimal(value)
    if value == value.to_integral_value():
        return int(value)
    as_float = float(value)
    if math.isfinite(as_float) and Decimal(str(as_float)) == value:
        return as_float
    return format(value, "f")


def evaluate_pattern_predicate(predicate: dict, row: dict) -> bool:
    """Evaluate IF/THEN ASTs; NUMBER consequents retain decimal precision."""
    operator = predicate["operator"]
    if operator == "WITHIN_TOLERANCE":
        from backend.services.mixed_continuous_algorithm import formula_result_accepts
        return formula_result_accepts(predicate, row)
    if operator in {"AND", "OR"}:
        children = (evaluate_pattern_predicate(item, row) for item in predicate["conditions"])
        return all(children) if operator == "AND" else any(children)
    if predicate.get("numericText"):
        from backend.services.mixed_numeric import parse_numeric_decimal
        actual = parse_numeric_decimal(row.get(predicate["column"]))
        if operator in {"IS_NULL", "NOT_NULL"}:
            return (actual is None) if operator == "IS_NULL" else (actual is not None)
        if actual is None:
            return False
        expected = _decimal(predicate["value"])
        return {"=": actual == expected, "!=": actual != expected,
                "<=": actual <= expected, ">": actual > expected}[operator]
    if predicate.get("valueType") != "NUMBER" or operator in {"IS_NULL", "NOT_NULL"}:
        return evaluate_predicate(predicate, row)
    value = row.get(predicate["column"])
    if _missing(value):
        return False
    try:
        actual, expected = _decimal(value), _decimal(predicate["value"])
    except ValueError:
        return False
    if operator == "=":
        return actual == expected
    if operator == "!=":
        return actual != expected
    if operator == "<=":
        return actual <= expected
    if operator == ">":
        return actual > expected
    raise ValueError(f"Unsupported predicate operator: {operator}")


def pattern_expression(predicate: dict) -> str:
    """Exact readable text only; SQL must compile validated ASTs with binds."""
    operator = predicate["operator"]
    if operator == "WITHIN_TOLERANCE":
        from backend.services.mixed_continuous_algorithm import formula_expression_text
        return f"{predicate['column']} ≈ {formula_expression_text(predicate['expression'])} (absoluteTolerance={predicate['absoluteTolerance']}, relativeTolerance={predicate.get('relativeTolerance', 0)})"
    if operator in {"AND", "OR"}:
        return "(" + f" {operator} ".join(pattern_expression(p) for p in predicate["conditions"]) + ")"
    name = predicate["column"]
    if operator in {"IS_NULL", "NOT_NULL"}:
        if predicate.get("numericText"):
            return f"NUMERIC({name}) {'IS NULL' if operator == 'IS_NULL' else 'IS NOT NULL'}"
        return f"{name} {'IS NULL' if operator == 'IS_NULL' else 'IS NOT NULL'}"
    value = predicate["value"]
    literal = str(value) if predicate.get("valueType") in {"NUMBER", "BINARY_FLOAT"} or not isinstance(value, str) else "'" + value.replace("'", "''") + "'"
    return f"{name} {operator} {literal}"


def _column_metadata(columns):
    result, seen = [], set()
    for column in columns:
        name = column.get("name", column.get("columnName", column.get("COLUMN_NAME", column.get("column_name"))))
        data_type = str(column.get("dataType", column.get("data_type", column.get("DATA_TYPE", "")))).upper().split("(", 1)[0].strip()
        if not isinstance(name, str) or not _IDENTIFIER.fullmatch(name) or name in seen:
            raise ValueError("Source metadata has an invalid or duplicate Oracle column identifier")
        seen.add(name)
        result.append({"name": name, "dataType": data_type})
    return result


def _identifier_like(name, present, numeric):
    unique = set(present)
    if len(unique) < 16 or len(unique) / len(present) < .98:
        return False
    if _ID_NAME.search(name) or not numeric:
        return True
    # Unnamed spreadsheet row numbers also leak position. Continuous measurements
    # are retained even when every value is unique; only consecutive integers go.
    if len(present) >= 32 and all(value == value.to_integral_value() for value in present):
        differences = [right - left for left, right in zip(present, present[1:])]
        monotonic = all(value > 0 for value in differences) or all(value < 0 for value in differences)
        return bool(differences) and monotonic and max(unique) - min(unique) <= len(present) * 1.5
    return False


def _target_encoding(rows, name, numeric, train_indices, category_limit, bin_count):
    """Fit target classes/boundaries on training values only, with no imputation."""
    values = []
    for row in rows:
        value = row.get(name)
        if _missing(value):
            values.append(None)
        elif numeric:
            try:
                values.append(_decimal(value))
            except ValueError:
                values.append(None)
        elif isinstance(value, str) and len(value) <= 1024:
            values.append(value)
        else:
            values.append(None)
    present = [values[int(index)] for index in train_indices if values[int(index)] is not None]
    unique = sorted(set(present))
    if len(unique) < 2:
        return None, "CONSTANT_OR_ALL_NULL_TARGET"
    if _identifier_like(name, present, numeric):
        # A high-cardinality uploaded VARCHAR2 can be a numeric measurement.
        # Exclude it from equality mining without excluding it from the separate
        # numeric-text formula analysis. Named identifiers remain excluded.
        return None, "IDENTIFIER_LIKE" if numeric or _ID_NAME.search(name) else "HIGH_CARDINALITY_TEXT"
    if not numeric and len(unique) > category_limit:
        return None, "TARGET_CATEGORY_LIMIT"
    if len(unique) <= category_limit:
        lookup = {value: index for index, value in enumerate(unique)}
        labels = np.asarray([lookup.get(value, -1) if value is not None else -1 for value in values], dtype=np.int32)
        results = []
        for value in unique:
            literal = _number_value(value) if numeric else value
            predicate = _atom(name, "=", literal, "NUMBER" if numeric else None)
            results.append({"resultPredicate": predicate, "resultValue": str(literal), "resultKind": "VALUE"})
        return {"labels": labels, "results": results, "encoding": "EXACT_SOURCE_VALUES", "classCount": len(unique)}, None
    # Decimal interpolation avoids narrowing high-precision NUMBER boundaries.
    ordered = sorted(present)
    boundaries = []
    with localcontext() as decimal_context:
        decimal_context.prec = 64  # Oracle NUMBER supports 38 significant digits.
        for index in range(1, bin_count):
            position = Decimal(len(ordered) - 1) * Decimal(index) / Decimal(bin_count)
            lower = int(position)
            fraction = position - lower
            boundary = ordered[lower] + (ordered[min(lower + 1, len(ordered) - 1)] - ordered[lower]) * fraction
            if boundary < ordered[-1] and (not boundaries or boundary > boundaries[-1]):
                boundaries.append(boundary)
    if not boundaries:
        return None, "NO_DISTINCT_TARGET_BINS"
    import bisect
    labels = np.asarray([bisect.bisect_left(boundaries, value) if value is not None else -1 for value in values], dtype=np.int32)
    results = []
    for index in range(len(boundaries) + 1):
        atoms = []
        if index:
            atoms.append(_atom(name, ">", _number_value(boundaries[index - 1]), "NUMBER"))
        if index < len(boundaries):
            atoms.append(_atom(name, "<=", _number_value(boundaries[index]), "NUMBER"))
        predicate = _group("AND", atoms)
        expected = (f"> {_number_value(boundaries[index - 1])}" if index else "")
        if index < len(boundaries):
            expected += (" AND " if expected else "") + f"<= {_number_value(boundaries[index])}"
        results.append({"resultPredicate": predicate, "resultValue": expected, "resultKind": "RANGE"})
    return {"labels": labels, "results": results, "encoding": "TRAIN_QUANTILE_BINS", "classCount": len(results),
            "boundaries": [_number_value(value) for value in boundaries]}, None


def analyze_pattern_rows(rows: list[dict], columns: list[dict], options: dict | None = None) -> dict[str, Any]:
    """Discover accepted normal patterns using bounded shallow column models.

    Confidence/support/lift refer to actual observed values on the stated cohort.
    The validation cohort participates in selection, not model/encoder fitting.
    No anomaly score, confirmed-error probability, or target value is invented.
    """
    if options is not None and not isinstance(options, dict):
        raise ValueError("options must be an object")
    options = dict(options or {})
    for alias, canonical in (("maxDepth", "treeMaxDepth"), ("minSamplesLeaf", "minLeafCount"), ("randomState", "randomSeed")):
        if alias in options and canonical not in options:
            options[canonical] = options[alias]
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows) or len(rows) < 32:
        raise ValueError("Pattern discovery requires at least 32 row objects")
    if not isinstance(columns, list) or not columns or not all(isinstance(column, dict) for column in columns):
        raise ValueError("columns must contain physical Oracle metadata")
    metadata = _column_metadata(columns)
    cap = _option(options, "max_rows", "maxRows", 25000, 32, 25000, True)
    seed = _option(options, "random_seed", "randomSeed", 42, 0, 2**32 - 1, True)
    fraction = _option(options, "holdout_fraction", "holdoutFraction", .25, .15, .4)
    depth = _option(options, "tree_max_depth", "treeMaxDepth", 4, 1, 6, True)
    max_rules = _option(options, "max_rules", "maxRules", 64, 1, 256, True)
    max_targets = _option(options, "max_targets", "maxTargets", 64, 1, 64, True)
    category_limit = _option(options, "max_target_categories", "maxTargetCategories", 32, 2, 128, True)
    bins = _option(options, "target_bins", "targetBins", 5, 2, 10, True)
    min_confidence = _option(options, "min_confidence", "minConfidence", .99, .5, 1.)
    validation_confidence = _option(options, "min_validation_confidence", "minValidationConfidence", .9, .5, 1.)
    min_lift = _option(options, "min_lift", "minLift", 1.01, 1., 1000.)
    min_gain = _option(options, "min_confidence_gain", "minConfidenceGain", .01, 0., .5)
    min_impurity = _option(options, "min_impurity_decrease", "minImpurityDecrease", .001, 0., .1)
    minimum_validation = _option(options, "min_validation_count", "minValidationCount", 10, 2, 10000, True)
    excluded_option = options.get("exclude_columns", options.get("excludeColumns", [])) or []
    target_option = options.get("target_columns", options.get("targetColumns"))
    if target_option == [] or target_option == ():
        target_option = None
    for value, label in ((excluded_option, "excludeColumns"), (target_option, "targetColumns")):
        if value is not None and (not isinstance(value, (list, tuple)) or not all(isinstance(name, str) for name in value)):
            raise ValueError(f"{label} must be a list of column names")
    known = {column["name"] for column in metadata}
    if target_option is not None and any(name not in known for name in target_option):
        raise ValueError("targetColumns contains an unknown source column")
    rng = np.random.default_rng(seed)
    selected = np.sort(rng.choice(len(rows), cap, replace=False)) if len(rows) > cap else np.arange(len(rows))
    sample = [rows[int(index)] for index in selected]
    permutation = rng.permutation(len(sample))
    validation_size = max(8, int(math.ceil(len(sample) * fraction)))
    validation_indices, train_indices = np.sort(permutation[:validation_size]), np.sort(permutation[validation_size:])
    min_condition = _option(options, "min_condition_count", "minConditionCount", max(20, int(math.ceil(len(train_indices) * .01))), 2, 10000, True)
    min_leaf = _option(options, "min_leaf_count", "minLeafCount", max(3, min_condition), 2, 10000, True)
    targets, excluded_targets, excluded_features = [], [], []
    excluded_names = set(excluded_option)
    # Training data alone decides whether an apparent row number is a feature.
    for column in metadata:
        name, numeric = column["name"], column["dataType"] in _NUMERIC_TYPES
        if name in excluded_names or column["dataType"] not in _NUMERIC_TYPES | _TEXT_TYPES:
            excluded_targets.append({"column": name, "reason": "USER_EXCLUDED" if name in excluded_names else "UNSUPPORTED_PHYSICAL_TYPE"})
            continue
        target, reason = _target_encoding(sample, name, numeric, train_indices, category_limit, bins)
        if reason == "IDENTIFIER_LIKE":
            excluded_names.add(name)
            excluded_features.append({"column": name, "reason": reason})
        if reason:
            excluded_targets.append({"column": name, "reason": reason})
        elif target_option is not None and name not in target_option:
            excluded_targets.append({"column": name, "reason": "NOT_SELECTED_TARGET"})
        elif len(targets) >= max_targets:
            excluded_targets.append({"column": name, "reason": "TARGET_LIMIT"})
        else:
            targets.append((name, target))
    encoding_options = dict(options, excludeColumns=sorted(excluded_names))
    encoding_options.pop("exclude_columns", None)
    try:
        matrix, features, encoding = _fit_encoding(sample, metadata, train_indices, encoding_options)
    except ValueError as exc:
        if not str(exc).startswith("No usable features remain"):
            raise
        matrix, features = None, []
        encoding = {"features": [], "excludedColumns": excluded_features, "sourceColumnCount": len(metadata), "encodedFeatureCount": 0, "fitSource": "TRAIN_ONLY"}
    encoding["targetEncodings"] = [{"column": name, **{key: value for key, value in target.items() if key not in {"labels", "results"}}} for name, target in targets]
    encoding["excludedTargets"] = excluded_targets
    encoding["targetFeaturePolicy"] = "EXCLUDE_ALL_FEATURES_DERIVED_FROM_CURRENT_TARGET"
    rules, fitted_targets, rejected = [], [], {"trainEvidence": 0, "validationEvidence": 0}
    for name, target in targets:
        feature_indices = [index for index, feature in enumerate(features) if feature["column"] != name]
        labels = target["labels"]
        fit_indices = train_indices[labels[train_indices] >= 0]
        if matrix is None or not feature_indices or len(fit_indices) < min_leaf * 2:
            continue
        predictors = [features[index] for index in feature_indices]
        target_matrix = matrix[:, feature_indices]
        tree = DecisionTreeClassifier(max_depth=depth, max_leaf_nodes=max(2, min(2 ** depth, max_rules)),
                                      min_samples_leaf=min_leaf, min_impurity_decrease=min_impurity, random_state=seed)
        tree.fit(target_matrix[fit_indices].tocsc(), labels[fit_indices])
        leaves = tree.apply(target_matrix)
        fitted_targets.append(name)

        def collect(node, path):
            feature_index = tree.tree_.feature[node]
            if feature_index >= 0:
                feature, threshold = predictors[feature_index], float(tree.tree_.threshold[node])
                collect(tree.tree_.children_left[node], path + [_branch_predicate(feature, threshold, True)])
                collect(tree.tree_.children_right[node], path + [_branch_predicate(feature, threshold, False)])
                return
            if not path:
                return
            expected_class = int(tree.classes_[int(np.argmax(tree.tree_.value[node][0]))])
            train_match, validation_match = train_indices[leaves[train_indices] == node], validation_indices[leaves[validation_indices] == node]
            support_count = int(np.sum(labels[train_match] == expected_class))
            result_count = int(np.sum(labels[train_indices] == expected_class))
            confidence = support_count / len(train_match) if len(train_match) else 0.
            baseline = result_count / len(train_indices)
            lift = confidence / baseline if baseline else 0.
            if len(train_match) < min_condition or confidence < min_confidence or confidence - baseline < min_gain or lift < min_lift:
                rejected["trainEvidence"] += 1
                return
            validation_support = int(np.sum(labels[validation_match] == expected_class))
            validation_result = int(np.sum(labels[validation_indices] == expected_class))
            validation_rate = validation_support / len(validation_match) if len(validation_match) else 0.
            validation_baseline = validation_result / len(validation_indices)
            validation_lift = validation_rate / validation_baseline if validation_baseline else 0.
            if len(validation_match) < minimum_validation or validation_rate < validation_confidence or validation_rate - validation_baseline < min_gain or validation_lift < min_lift:
                rejected["validationEvidence"] += 1
                return
            predicate = _group("AND", path)
            consequent = target["results"][expected_class]
            result_text = pattern_expression(consequent["resultPredicate"])
            expression = pattern_expression(predicate)
            digest = hashlib.sha256(json.dumps([predicate, consequent["resultPredicate"]], sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:24].upper()
            validation = {"conditionCount": len(validation_match), "supportCount": validation_support,
                          "confidence": validation_rate, "totalCount": len(validation_indices), "resultCount": validation_result,
                          "support": validation_support / len(validation_indices), "lift": validation_lift,
                          "status": "VALIDATED", "source": "SELECTION_VALIDATION"}
            rules.append({"ruleId": f"MIXED_PATTERN_{digest}", "leafId": int(node), "predicate": predicate,
                          "expression": expression, "fullText": f"IF {expression} THEN {result_text}",
                          "resultColumn": name, "resultText": result_text, **consequent,
                          "supportCount": support_count, "conditionCount": len(train_match), "resultCount": result_count,
                          "totalCount": len(train_indices), "confidence": confidence,
                          "support": support_count / len(train_indices), "lift": lift, "confidenceGain": confidence - baseline,
                          "validation": validation, "validationStatus": "VALIDATED", "status": "PATTERN",
                          "metricMeaning": "OBSERVED_SOURCE_VALUE_FREQUENCY_NOT_ERROR_PROBABILITY"})

        collect(0, [])
    # Rank across targets before imposing the global cap so the first column does
    # not consume the entire rule budget. Validation only gates publication.
    rules.sort(key=lambda rule: (-rule["confidence"], -rule["supportCount"], -rule["lift"], rule["ruleId"]))
    from backend.services.mixed_continuous_algorithm import discover_continuous_rules
    continuous = discover_continuous_rules(sample, metadata, train_indices, validation_indices,
                                          dict(options, excludeColumns=sorted(excluded_names)))
    formula_rules = continuous["rules"]
    uncapped_count = len(rules) + len(formula_rules)
    # Preserve room for validated numeric formulas rather than allowing simple
    # categorical leaves to consume the entire shared result budget.
    formula_budget = min(len(formula_rules), max(1, max_rules // 2))
    selected_patterns = rules[:max_rules - formula_budget]
    formula_budget = min(len(formula_rules), max_rules - len(selected_patterns))
    rules = selected_patterns + formula_rules[:formula_budget]
    continuous["metrics"]["publishedRuleCount"] = formula_budget
    continuous["metrics"]["globalRuleLimit"] = max_rules
    continuous["metrics"]["globalRuleLimitDroppedCount"] = len(formula_rules) - formula_budget
    if continuous["metrics"].get("enabled"):
        continuous["metrics"]["status"] = ("RULES_AVAILABLE" if formula_budget else
            "NO_ELIGIBLE_TARGETS" if not continuous["metrics"].get("eligibleTargetCount") else "NO_VALIDATED_RULES")
    warnings = ["VALIDATION_USED_FOR_RULE_SELECTION", "NUMERIC_TARGET_RANGES_ARE_TRAIN_QUANTILE_BINS"] if any(rule["resultKind"] == "RANGE" for rule in rules) else ["VALIDATION_USED_FOR_RULE_SELECTION"]
    warnings.extend(continuous["warnings"])
    if len(selected) < len(rows):
        warnings.append("ROW_LIMIT_UNIFORM_SAMPLE_ONLY")
    if any(item["reason"] == "TARGET_LIMIT" for item in excluded_targets):
        warnings.append("TARGET_COLUMN_LIMIT")
    if uncapped_count > len(rules):
        warnings.append("RULE_LIMIT")
    if not rules:
        warnings.append("NO_VALIDATED_COLUMN_PATTERNS")
    validation_set = set(validation_indices.tolist())
    return {"algorithm": "MIXED_PATTERN_TREE", "algorithmVersion": 2, "version": 2,
            "rules": rules, "encoding": encoding, "warnings": warnings,
            "rows": [{"rowIndex": int(original), "partition": "VALIDATION" if index in validation_set else "TRAIN"} for index, original in enumerate(selected)],
            "metrics": {"inputCount": len(rows), "sampleCount": len(sample), "trainCount": len(train_indices), "trainRows": len(train_indices),
                        "holdoutCount": len(validation_indices), "holdoutRows": len(validation_indices), "validationRows": len(validation_indices),
                        "ruleCount": len(rules), "candidateRuleCount": uncapped_count, "fittedTargetCount": len(fitted_targets), "fittedTargets": fitted_targets,
                        "rejectedRules": rejected, "randomSeed": seed, "validationSource": "SELECTION_VALIDATION", "hasGroundTruth": False,
                        "continuous": continuous["metrics"], "formulaRuleCount": sum(rule["resultKind"] == "FORMULA" for rule in rules),
                        "minConfidence": min_confidence, "minValidationConfidence": validation_confidence,
                        "minConditionCount": min_condition, "minValidationCount": minimum_validation, "minLift": min_lift, "minConfidenceGain": min_gain,
                        "confidenceMeaning": "P_ACTUAL_THEN_GIVEN_IF_IN_STATED_COHORT", "nullTargetPolicy": "VIOLATION_OF_NONMISSING_EXPECTATION"}}
