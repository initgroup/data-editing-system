"""Bounded numeric formula discovery using disjoint fit/calibration/validation.

The output predicts an actual column. Numeric tolerances come from a calibration
partition and must remain small relative to training variation; validation checks
both coverage and explanatory strength. Isolated corrupt values are retained in
reported coverage, MAE and R2, rather than relabeled as confirmed errors.
"""
from __future__ import annotations

import hashlib
import json
import math
from fractions import Fraction

import numpy as np

from backend.services.mixed_xai_algorithm import _NUMERIC_TYPES, _TEXT_TYPES, _ID_NAME, _atom, _group, _missing, _option
from backend.services.mixed_sparse_formula import (
    UnitFormulaScreen, UNIT_SAMPLE_ROWS, UNIT_BEAM_WIDTH, UNIT_CANDIDATE_LIMIT,
)


def formula_expression_text(expression):
    if "column" in expression:
        return expression["column"]
    if "value" in expression:
        return format(expression["value"], ".15g")
    operators = {"ADD": "+", "SUBTRACT": "-", "MULTIPLY": "*", "DIVIDE": "/"}
    return f"({formula_expression_text(expression['left'])} {operators[expression['operator']]} {formula_expression_text(expression['right'])})"


def evaluate_formula_expression(expression, row):
    """Reference finite evaluator. Missing inputs/zero divisors have no prediction."""
    try:
        if "column" in expression:
            value = row.get(expression["column"])
            if expression.get("numericText"):
                from backend.services.mixed_numeric import parse_numeric_text
                parsed = parse_numeric_text(value)
                value = float(parsed) if parsed is not None else None
            else:
                value = None if _missing(value) else float(value)
        elif "value" in expression:
            value = float(expression["value"])
        else:
            left, right = evaluate_formula_expression(expression["left"], row), evaluate_formula_expression(expression["right"], row)
            if left is None or right is None:
                return None
            operator = expression["operator"]
            if operator == "ADD":
                value = left + right
            elif operator == "SUBTRACT":
                value = left - right
            elif operator == "MULTIPLY":
                value = left * right
            elif operator == "DIVIDE":
                value = left / right if right else None
            else:
                raise ValueError("Unsupported arithmetic operator")
        return value if value is not None and math.isfinite(value) else None
    except (TypeError, ValueError, OverflowError, ZeroDivisionError):
        return None


def formula_result_accepts(predicate, row):
    expected = evaluate_formula_expression(predicate["expression"], row)
    actual = row.get(predicate["column"])
    if expected is None or _missing(actual):
        return False
    try:
        if predicate.get("numericText"):
            from backend.services.mixed_numeric import parse_numeric_text
            parsed = parse_numeric_text(actual)
            if parsed is None:
                return False
            actual = float(parsed)
        else:
            actual = float(actual)
        tolerance = max(float(predicate["absoluteTolerance"]), float(predicate.get("relativeTolerance", 0)) * abs(expected))
        return math.isfinite(actual) and abs(actual - expected) <= tolerance
    except (TypeError, ValueError, OverflowError):
        return False


def _binary(operator, left, right):
    return {"operator": operator, "left": left, "right": right}


def _finite_array(rows, name, *, numeric_text=False):
    if numeric_text:
        from backend.services.mixed_numeric import parse_numeric_text
    values = []
    for row in rows:
        try:
            if numeric_text:
                parsed = parse_numeric_text(row.get(name))
                value = float(parsed) if parsed is not None else np.nan
            else:
                value = float(row.get(name)) if not _missing(row.get(name)) else np.nan
        except (TypeError, ValueError, OverflowError):
            value = np.nan
        values.append(value if np.isfinite(value) else np.nan)
    return np.asarray(values, dtype=np.float64)


def _rank_targets(numeric, eligible, fit_indices, unit_screen=None):
    """Training-only correlation ranking keeps column order out of the cap."""
    if len(eligible) <= 1 or len(numeric) <= 1:
        return eligible
    sampled = fit_indices[np.linspace(0, len(fit_indices) - 1, min(2048, len(fit_indices)), dtype=int)]
    names, vectors = list(numeric), []
    for name in names:
        values = numeric[name][sampled].copy()
        present = values[np.isfinite(values)]
        if not len(present):
            vectors.append(np.zeros(len(values)))
            continue
        values[~np.isfinite(values)] = np.median(present)
        values = np.clip(values, *np.quantile(present, [.02, .98]))
        values /= max(float(np.max(np.abs(values))), 1e-20)
        spread = float(np.std(values))
        vectors.append((values - np.mean(values)) / spread if spread > 1e-15 else np.zeros(len(values)))
    matrix = np.asarray(vectors)
    coefficients = np.abs(matrix @ matrix.T / max(1, len(sampled)))
    np.fill_diagonal(coefficients, 0)
    scores = {name: float(coefficients[index].max()) ** 2 for index, name in enumerate(names)}
    unit_errors = {name: unit_screen.priority(name) if unit_screen else float("inf") for name in eligible}
    # A cancellation identity can have virtually no marginal correlation. Give
    # near-exact pair evidence a place before imposing the target-count budget.
    return sorted(eligible, key=lambda name: (unit_errors[name] > 1e-8,
        -max(scores[name], 1 - min(unit_errors[name], 1.) ** 2), name))


def _corr(left, right):
    keep = np.isfinite(left) & np.isfinite(right)
    if keep.sum() < 20 or np.std(left[keep]) <= 1e-15 or np.std(right[keep]) <= 1e-15:
        return 0.
    # Clip the tails for candidate ranking only. Actual rule metrics include them.
    a, b = left[keep], right[keep]
    a = np.clip(a, *np.quantile(a, [.02, .98]))
    b = np.clip(b, *np.quantile(b, [.02, .98]))
    if np.std(a) <= 1e-15 or np.std(b) <= 1e-15:
        return 0.
    coefficient = float(np.corrcoef(a, b)[0, 1])
    return abs(coefficient) if np.isfinite(coefficient) else 0.


def _robust_fit(matrix, actual):
    """Small deterministic Huber-IRLS fit; no model package or DB dependency."""
    center = np.median(matrix, axis=0)
    scale = np.maximum(np.quantile(matrix, .75, axis=0) - np.quantile(matrix, .25, axis=0), 1e-12)
    standardized = (matrix - center) / scale
    ordinary = np.all(np.abs(standardized) <= 20, axis=1)
    if ordinary.sum() >= max(30, matrix.shape[1] * 10):
        standardized, actual = standardized[ordinary], actual[ordinary]
    if len(actual) > 2500:
        sample = np.linspace(0, len(actual) - 1, 2500, dtype=int)
        standardized, actual = standardized[sample], actual[sample]
    design = np.column_stack([np.ones(len(actual)), standardized])
    target_center = float(np.median(actual))
    y = actual - target_center
    coefficients = np.linalg.lstsq(design, y, rcond=None)[0]
    for _ in range(12):
        residual = y - design @ coefficients
        residual_center = np.median(residual)
        spread = max(1e-10, 1.4826 * float(np.median(np.abs(residual - residual_center))))
        weights = np.minimum(1., 1.5 * spread / np.maximum(np.abs(residual), 1e-20))
        weighted = np.sqrt(weights)
        updated = np.linalg.lstsq(design * weighted[:, None], y * weighted, rcond=None)[0]
        if np.allclose(updated, coefficients, rtol=1e-10, atol=1e-10):
            coefficients = updated
            break
        coefficients = updated
    slopes = coefficients[1:] / scale
    intercept = target_center + coefficients[0] - float(np.dot(slopes, center))
    return float(intercept), slopes


def _linear_expression(expressions, intercept, coefficients, target_scale, *, canonical=False):
    terms = []
    for expression, coefficient in zip(expressions, coefficients):
        coefficient = float(coefficient)
        if not coefficient:
            continue
        magnitude = abs(coefficient)
        rational = Fraction(magnitude).limit_denominator(100)
        if magnitude == 1:
            term = expression
        elif canonical and rational.denominator > 1 and float(rational) == magnitude:
            term = expression if rational.numerator == 1 else _binary("MULTIPLY", {"value": rational.numerator}, expression)
            term = _binary("DIVIDE", term, {"value": rational.denominator})
        else:
            term = _binary("MULTIPLY", {"value": magnitude}, expression)
        terms.append((coefficient > 0, term))
    if not terms:
        return None
    if intercept:
        terms.append((intercept > 0, {"value": abs(float(intercept))}))
    terms.sort(key=lambda item: not item[0])
    expression = terms[0][1] if terms[0][0] else _binary("SUBTRACT", {"value": 0}, terms[0][1])
    for positive, term in terms[1:]:
        expression = _binary("ADD" if positive else "SUBTRACT", expression, term)
    return expression


def _canonical_coefficients(matrix, actual, intercept, coefficients, scale):
    """Simplify only when TRAIN_FIT prediction evidence supports the change.

    A tiny coefficient multiplying a large input remains significant. Neither
    coefficient magnitude nor target scale alone authorizes dropping a term.
    """
    if len(actual) > 2500:
        selected = np.linspace(0, len(actual) - 1, 2500, dtype=int)
        matrix, actual = matrix[selected], actual[selected]
    coefficients = np.asarray(coefficients, dtype=float).copy()
    baseline = intercept + matrix @ coefficients
    original = np.quantile(np.abs(actual - baseline), [.5, .9])
    floor = max(1e-14, np.finfo(float).eps * 8 * max(float(np.median(np.abs(actual))), float(np.median(np.abs(baseline)))))
    values = [*coefficients, float(intercept)]
    for index, value in enumerate(values):
        choices = {float(round(value))}
        choices.update(float(Fraction(value).limit_denominator(denominator)) for denominator in (2, 4, 6, 12, 24, 60, 100))
        # Simple finite alternatives are proposals, not a formatting operation.
        choices = sorted((candidate for candidate in choices if abs(candidate - value) <= max(1., abs(value)) * 1e-6),
                         key=lambda candidate: (Fraction(candidate).limit_denominator(100).denominator, abs(candidate - value)))
        for candidate in choices:
            proposed_coefficients, proposed_intercept = coefficients.copy(), float(intercept)
            if index == len(coefficients):
                proposed_intercept = candidate
            else:
                proposed_coefficients[index] = candidate
            predicted = proposed_intercept + matrix @ proposed_coefficients
            displacement = float(np.max(np.abs(predicted - baseline)))
            errors = np.quantile(np.abs(actual - predicted), [.5, .9])
            if displacement <= floor or np.all(errors <= original + np.maximum(floor, original * .02)):
                coefficients, intercept = proposed_coefficients, proposed_intercept
                break
    simple = all(float(Fraction(float(value)).limit_denominator(100)) == value for value in [*coefficients, intercept])
    return float(intercept), coefficients, simple


def _diverse_regression_groups(numeric, actual, selection, ranked_names, max_features):
    """Bounded residual search avoids choosing only correlated proxy prefixes."""
    if max_features < 2 or len(ranked_names) < 2:
        return []
    sampled = selection[np.linspace(0, len(selection) - 1, min(512, len(selection)), dtype=int)]
    names = list(ranked_names)
    matrix = np.column_stack([numeric[name][sampled] for name in names])
    target = actual[sampled]
    keep = np.isfinite(target)
    matrix, target = matrix[keep], target[keep]
    for column in range(len(names)):
        present = matrix[:, column][np.isfinite(matrix[:, column])]
        matrix[~np.isfinite(matrix[:, column]), column] = np.median(present) if len(present) else 0.
    if len(target) < 30:
        return []
    groups = []
    for first in range(min(2, len(names))):
        chosen = [first]
        for _ in range(1, min(max_features, len(names))):
            fitting = matrix[:, chosen]
            intercept, slopes = _robust_fit(fitting, target)
            residual = target - (intercept + fitting @ slopes)
            design = np.column_stack([np.ones(len(target)), fitting])
            partial = matrix - design @ np.linalg.lstsq(design, matrix, rcond=None)[0]
            scores = []
            for index in range(len(names)):
                score = _corr(partial[:, index], residual) if index not in chosen else -1.
                scores.append(score)
            selected = int(np.argmax(scores))
            if scores[selected] <= 1e-8:
                break
            chosen.append(selected)
            groups.append([names[index] for index in chosen])
    return groups


def _expression_array(expression, numeric):
    if "column" in expression:
        return numeric[expression["column"]]
    if "value" in expression:
        return expression["value"]
    left, right = _expression_array(expression["left"], numeric), _expression_array(expression["right"], numeric)
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        return {"ADD": np.add, "SUBTRACT": np.subtract, "MULTIPLY": np.multiply, "DIVIDE": np.divide}[expression["operator"]](left, right)


def _cohort_metrics(indices, condition, actual, expected, tolerance, scale):
    matching = indices[condition[indices]]
    finite = np.isfinite(actual[matching]) & np.isfinite(expected[matching])
    errors = actual[matching][finite] - expected[matching][finite]
    accepted = np.abs(errors) <= tolerance
    support = int(accepted.sum())

    def r2(y, residual):
        if len(y) < 3 or not np.all(np.isfinite(residual)):
            return None
        normalizer = max(float(np.max(np.abs(y))), float(np.max(np.abs(residual))), 1e-20)
        scaled_y, scaled_residual = y / normalizer, residual / normalizer
        variance = float(np.sum((scaled_y - np.mean(scaled_y)) ** 2))
        score = float(1 - np.sum(scaled_residual ** 2) / variance) if variance > 1e-25 else None
        return score if score is not None and np.isfinite(score) else None

    values = actual[matching][finite]
    maximum = float(np.max(np.abs(errors))) if len(errors) else 0.
    finite_errors = np.isfinite(maximum)
    mae = float(np.mean(np.abs(errors) / maximum) * maximum) if maximum and finite_errors else (0. if len(errors) and finite_errors else None)
    rmse = float(np.sqrt(np.mean((errors / maximum) ** 2)) * maximum) if maximum and finite_errors else (0. if len(errors) and finite_errors else None)
    return {"conditionCount": len(matching), "supportCount": support, "totalCount": len(indices),
            "resultCount": None, "lift": None, "confidence": support / len(matching) if len(matching) else None,
            "support": support / len(indices) if len(indices) else None, "r2": r2(values, errors),
            "inlierR2": r2(values[accepted], errors[accepted]), "mae": mae,
            "rmse": rmse,
            "normalizedMae": mae / scale if mae is not None and np.isfinite(mae / scale) else None,
            "finiteActualCount": int(finite.sum()), "missingActualCount": int((~finite).sum())}


def discover_continuous_rules(rows, columns, train_indices, validation_indices, options=None):
    """Return accepted linear/additive/ratio rules, including bounded subgroups."""
    options = options or {}
    if options.get("continuousEnabled", options.get("continuous_enabled", True)) is False:
        return {"rules": [], "metrics": {"diagnosticVersion": 1, "enabled": False, "status": "DISABLED",
            "sourceColumnCount": len(columns), "eligibleTargetCount": 0, "attemptedTargetCount": 0,
            "targetCount": 0, "ruleCount": 0, "acceptedRuleCount": 0, "candidateRuleCount": 0,
            "testedCandidateCount": 0, "fittedCandidateCount": 0, "rejectionReasons": {},
            "eligibilityReasons": {}, "targetDiagnostics": [], "excludedColumns": [], "excludedTargets": []}, "warnings": []}
    max_targets = _option(options, "max_continuous_targets", "maxContinuousTargets", 16, 1, 32, True)
    max_rules = _option(options, "max_continuous_rules", "maxContinuousRules", 32, 1, 128, True)
    max_features = _option(options, "max_formula_features", "maxFormulaFeatures", 3, 1, 4, True)
    min_confidence = _option(options, "min_formula_confidence", "minFormulaConfidence", .95, .5, 1.)
    min_validation = _option(options, "min_formula_validation_confidence", "minFormulaValidationConfidence", .9, .5, 1.)
    min_r2 = _option(options, "min_formula_r2", "minFormulaR2", .9, .5, .99999)
    max_fraction = _option(options, "max_tolerance_fraction", "maxToleranceFraction", .05, .001, .2)
    calibration_fraction = _option(options, "calibration_fraction", "calibrationFraction", .25, .15, .4)
    minimum = _option(options, "min_formula_condition_count", "minFormulaConditionCount", 30, 20, 10000, True)
    max_groups = _option(options, "max_conditional_groups", "maxConditionalGroups", 8, 0, 16, True)
    seed = _option(options, "random_seed", "randomSeed", options.get("randomState", 42), 0, 2**32 - 1, True)
    excluded = set(options.get("excludeColumns", options.get("exclude_columns", [])) or [])
    targets_option = options.get("targetColumns", options.get("target_columns")) or None
    train_indices, validation_indices = np.asarray(train_indices, dtype=int), np.asarray(validation_indices, dtype=int)
    shuffled = np.random.default_rng(seed + 1).permutation(train_indices)
    calibration_size = max(12, int(math.ceil(len(shuffled) * calibration_fraction)))
    calibration_indices, fit_indices = np.sort(shuffled[:calibration_size]), np.sort(shuffled[calibration_size:])
    numeric, metadata, excluded_numeric, numeric_text = {}, [], [], set()
    column_diagnostics, target_diagnostics = [], {}
    eligibility_reasons, rejection_reasons = {}, {}
    physical_numeric_count = inferred_text_count = 0

    def exclude(name, kind, reason, **evidence):
        item = {"column": name, "physicalType": kind, "reason": reason, **evidence}
        excluded_numeric.append(item)
        eligibility_reasons[reason] = eligibility_reasons.get(reason, 0) + 1

    def reject(diagnostic, reason):
        rejection_reasons[reason] = rejection_reasons.get(reason, 0) + 1
        diagnostic["rejectionReasons"][reason] = diagnostic["rejectionReasons"].get(reason, 0) + 1

    for column in columns:
        name = column.get("name", column.get("COLUMN_NAME"))
        kind = str(column.get("dataType", column.get("DATA_TYPE", ""))).upper().split("(", 1)[0].strip()
        physical_numeric_count += int(kind in _NUMERIC_TYPES)
        if name in excluded or _ID_NAME.search(name):
            exclude(name, kind, "USER_OR_IDENTIFIER_EXCLUDED")
            continue
        metadata.append((name, kind))
        evidence = {"column": name, "physicalType": kind, "fitSource": "TRAIN_FIT"}
        if kind in _TEXT_TYPES:
            from backend.services.mixed_numeric import inspect_numeric_text
            inspected = inspect_numeric_text([rows[int(i)].get(name) for i in fit_indices], min_count=minimum)
            evidence.update(inspected)
            if not inspected["eligible"]:
                exclude(name, kind, inspected["reason"], **{key: value for key, value in inspected.items() if key not in {"eligible", "reason"}})
                column_diagnostics.append(evidence)
                continue
            numeric_text.add(name)
            inferred_text_count += 1
            evidence["effectiveType"] = "NUMERIC_TEXT"
        elif kind in _NUMERIC_TYPES:
            evidence["effectiveType"] = "NUMBER"
        else:
            exclude(name, kind, "UNSUPPORTED_PHYSICAL_TYPE")
            continue
        values = _finite_array(rows, name, numeric_text=name in numeric_text)
        present = values[fit_indices][np.isfinite(values[fit_indices])]
        distinct = len(np.unique(present))
        evidence.update(fitNonNullCount=len(present), fitDistinctCount=distinct)
        column_diagnostics.append(evidence)
        if len(present) and np.any(np.abs(present) >= 1e125):
            exclude(name, kind, "ORACLE_FORMULA_NUMERIC_RANGE")
            continue
        if len(present) < minimum:
            exclude(name, kind, "INSUFFICIENT_FIT_VALUES", fitNonNullCount=len(present), minimum=minimum)
            continue
        if distinct < 2 or np.ptp(present) <= 1e-10:
            exclude(name, kind, "CONSTANT_NUMERIC_VALUES", fitDistinctCount=distinct)
            continue
        # Uploaded row numbers must not become formula predictors merely because
        # their physical type is text. Keep genuinely continuous unique values.
        if (name in numeric_text and distinct / len(present) >= .98 and len(present) >= 32
                and np.all(present == np.floor(present))
                and (np.all(np.diff(present) > 0) or np.all(np.diff(present) < 0))
                and np.ptp(present) <= len(present) * 2):
            exclude(name, kind, "IDENTIFIER_LIKE_SEQUENCE")
            continue
        numeric[name] = values
        target_diagnostics[name] = {"column": name, "physicalType": kind,
            "numericText": name in numeric_text, "fitDistinctCount": distinct,
            "status": "ELIGIBLE", "proposalCount": 0, "fittedModelCount": 0,
            "acceptedRuleCount": 0, "rejectionReasons": {}}
        if targets_option is not None and name not in targets_option:
            target_diagnostics[name].update(status="NOT_SELECTED", reason="TARGET_NOT_SELECTED")
        elif distinct < 8:
            target_diagnostics[name].update(status="PREDICTOR_ONLY", reason="LOW_CARDINALITY_TARGET")
            eligibility_reasons["LOW_CARDINALITY_TARGET"] = eligibility_reasons.get("LOW_CARDINALITY_TARGET", 0) + 1
    unit_screen = UnitFormulaScreen(numeric, fit_indices) if numeric and max_features >= 2 else None
    for name, diagnostic in target_diagnostics.items():
        error = unit_screen.priority(name) if unit_screen else float("inf")
        diagnostic["unitPairScreenError"] = error if np.isfinite(error) else None
        # Small nonnegative integer totals can still be genuine sum identities.
        # This exception authorizes only unit sums, never arbitrary regression.
        if diagnostic["status"] == "PREDICTOR_ONLY" and diagnostic["fitDistinctCount"] >= 4 and error <= 1e-10:
            present = numeric[name][fit_indices]
            present = present[np.isfinite(present)]
            if np.all(present >= 0) and np.all(present == np.floor(present)):
                diagnostic.update(status="ELIGIBLE", unitIdentityOnly=True)
                diagnostic.pop("reason", None)
                eligibility_reasons["LOW_CARDINALITY_TARGET"] -= 1
                if not eligibility_reasons["LOW_CARDINALITY_TARGET"]:
                    del eligibility_reasons["LOW_CARDINALITY_TARGET"]
    eligible_targets = [name for name in numeric if target_diagnostics[name]["status"] == "ELIGIBLE"]
    ranked_targets = _rank_targets(numeric, eligible_targets, fit_indices, unit_screen)
    targets = ranked_targets[:max_targets]
    for name in ranked_targets[max_targets:]:
        target_diagnostics[name].update(status="CAPPED", reason="CONTINUOUS_TARGET_LIMIT")
    group_cohorts = []
    # Group membership is independent of the result target. Inspect it once,
    # stopping after a fifth distinct value rather than rescanning all source
    # rows/columns for every target. Keep four extra groups for target exclusion.
    for name, kind in metadata if max_groups else []:
        categories = set()
        for index in fit_indices:
            value = rows[int(index)].get(name)
            if not _missing(value):
                categories.add(value)
                if len(categories) > 4:
                    break
        if not 2 <= len(categories) <= 4:
            continue
        for category in sorted(categories, key=str):
            mask = np.asarray([row.get(name) == category for row in rows], dtype=bool)
            if mask[fit_indices].sum() >= minimum and mask[calibration_indices].sum() >= 12:
                value = float(category) if kind in _NUMERIC_TYPES else category
                group_cohorts.append((name, _atom(name, "=", value, "NUMBER" if kind in _NUMERIC_TYPES else None), mask))
        if len(group_cohorts) >= max_groups + 4:
            break
    rules, attempted = [], []
    for target in targets:
        diagnostic = target_diagnostics[target]
        actual = numeric[target]
        training_values = actual[fit_indices][np.isfinite(actual[fit_indices])]
        target_scale = float(np.quantile(training_values, .75) - np.quantile(training_values, .25))
        if not np.isfinite(target_scale) or target_scale <= 1e-10:
            diagnostic.update(status="REJECTED", reason="INSUFFICIENT_TARGET_VARIATION")
            reject(diagnostic, "INSUFFICIENT_TARGET_VARIATION")
            continue
        attempted.append(target)
        diagnostic["status"] = "ATTEMPTED"
        cohorts = [(None, np.ones(len(rows), dtype=bool))]
        cohorts.extend((atom, mask) for name, atom, mask in group_cohorts if name != target)
        cohorts = cohorts[:max_groups + 1]
        global_accepted = False
        for subgroup, cohort in cohorts:
            if subgroup is not None and global_accepted:
                break
            selection = fit_indices[cohort[fit_indices]]
            ranked = sorted(((_corr(values[selection], actual[selection]), name) for name, values in numeric.items() if name != target), reverse=True)
            predictor_names = [name for _, name in ranked[:max(4, max_features)]]
            if not predictor_names:
                reject(diagnostic, "NO_USABLE_PREDICTORS")
                continue

            def column_leaf(name):
                return {"column": name, **({"numericText": True} if name in numeric_text else {})}

            proposals = [([column_leaf(name)], [name], [], "ROBUST_LINEAR", None) for name in predictor_names[:3]]
            for size in range(2, min(len(predictor_names), max_features) + 1):
                chosen = predictor_names[:size]
                proposals.append(([column_leaf(name) for name in chosen], chosen, [], "ROBUST_LINEAR", None))
            groups = _diverse_regression_groups(numeric, actual, selection, [name for _, name in ranked], max_features)
            present_groups = {tuple(sorted(item[1])) for item in proposals}
            for chosen in groups:
                key = tuple(sorted(chosen))
                if key not in present_groups:
                    proposals.append(([column_leaf(name) for name in chosen], chosen, [], "ROBUST_LINEAR", None))
                    present_groups.add(key)
            ratios = []
            ratio_names = [name for _, name in ranked[:6]] if max_features >= 2 else []
            for numerator in ratio_names:
                for denominator in ratio_names:
                    if numerator == denominator:
                        continue
                    expression = _binary("DIVIDE", column_leaf(numerator), column_leaf(denominator))
                    values = _expression_array(expression, numeric)
                    score = _corr(values[selection], actual[selection])
                    if score >= .65:
                        ratios.append((score, expression, [numerator, denominator], [denominator]))
            ratios.sort(key=lambda item: -item[0])
            proposals.extend(([expression], names, denominators, "ROBUST_RATIO", None) for _, expression, names, denominators in ratios[:2])
            simple = ((unit_screen if subgroup is None else UnitFormulaScreen(numeric, selection)).candidates(target, max_terms=max_features)
                      if unit_screen else [])
            if diagnostic.get("unitIdentityOnly"):
                proposals = []
                simple = [candidate for candidate in simple if all(sign == 1 for sign in candidate["coefficients"])]
            diagnostic["unitCandidateCount"] = diagnostic.get("unitCandidateCount", 0) + len(simple)
            proposals.extend(([column_leaf(name) for name in candidate["names"]], candidate["names"], [],
                              "SUM_DIFFERENCE", candidate["coefficients"]) for candidate in simple)
            accepted = []
            for expressions, names, denominators, method, fixed_coefficients in proposals:
                diagnostic["proposalCount"] += 1
                condition = cohort.copy()
                atoms = [subgroup] if subgroup else []
                for name in names:
                    condition &= np.isfinite(numeric[name])
                    atoms.append({**_atom(name, "NOT_NULL"), **({"numericText": True} if name in numeric_text else {})})
                for name in denominators:
                    condition &= numeric[name] != 0
                    atoms.append({**_atom(name, "!=", 0, "NUMBER"), **({"numericText": True} if name in numeric_text else {})})
                matrix = np.column_stack([_expression_array(expression, numeric) for expression in expressions])
                fitting = fit_indices[condition[fit_indices] & np.isfinite(actual[fit_indices]) & np.all(np.isfinite(matrix[fit_indices]), axis=1)]
                calibration = calibration_indices[condition[calibration_indices] & np.isfinite(actual[calibration_indices]) & np.all(np.isfinite(matrix[calibration_indices]), axis=1)]
                if len(fitting) < minimum or len(calibration) < 12:
                    reject(diagnostic, "INSUFFICIENT_FIT_OR_CALIBRATION_ROWS")
                    continue
                try:
                    if fixed_coefficients is not None:
                        coefficients = np.asarray(fixed_coefficients, dtype=float)
                        intercept = float(np.median(actual[fitting] - matrix[fitting] @ coefficients))
                    else:
                        intercept, coefficients = _robust_fit(matrix[fitting], actual[fitting])
                except np.linalg.LinAlgError:
                    reject(diagnostic, "FIT_FAILED")
                    continue
                diagnostic["fittedModelCount"] += 1
                if (not np.isfinite(intercept) or not np.all(np.isfinite(coefficients))
                        or abs(intercept) >= 1e125 or np.any(np.abs(coefficients) >= 1e125)):
                    reject(diagnostic, "INVALID_COEFFICIENTS")
                    continue
                intercept, coefficients, canonical = _canonical_coefficients(matrix[fitting], actual[fitting], intercept, coefficients, target_scale)
                canonical = canonical or method == "SUM_DIFFERENCE"
                expression = _linear_expression(expressions, intercept, coefficients, target_scale, canonical=canonical)
                if expression is None:
                    reject(diagnostic, "CONSTANT_PREDICTION")
                    continue
                expected = np.asarray(_expression_array(expression, numeric), dtype=float)
                fit_selection_error = float(np.quantile(np.abs(actual[fitting] - expected[fitting]), .9)) / target_scale
                residuals = actual[calibration] - expected[calibration]
                if not np.all(np.isfinite(residuals)):
                    reject(diagnostic, "NONFINITE_CALIBRATION_RESIDUALS")
                    continue
                residual_center = float(np.median(residuals))
                mad = 1.4826 * float(np.median(np.abs(residuals - residual_center)))
                # Bound arithmetic roundoff in input units, including large
                # cancelling terms, rather than permitting 1e-10 of target IQR.
                # The latter hides small but real additive components.
                operation_magnitude = abs(intercept) + float(np.max(np.abs(matrix[fitting]), axis=0) @ np.abs(coefficients))
                floor = max(1e-12, np.finfo(float).eps * 16 * max(operation_magnitude, float(np.max(np.abs(expected[fitting])))))
                tolerance = max(floor, float(np.median(np.abs(residuals))) + 3.5 * mad)
                if not np.isfinite(tolerance) or tolerance >= 1e125 or tolerance > target_scale * max_fraction:
                    reject(diagnostic, "TOLERANCE_TOO_WIDE")
                    continue
                train = _cohort_metrics(fit_indices, condition, actual, expected, tolerance, target_scale)
                validation = _cohort_metrics(validation_indices, condition, actual, expected, tolerance, target_scale)
                calibration_metrics = _cohort_metrics(calibration_indices, condition, actual, expected, tolerance, target_scale)
                failed_evidence = []
                if train["conditionCount"] < minimum or validation["conditionCount"] < 10:
                    failed_evidence.append("INSUFFICIENT_VALIDATION_ROWS")
                if (train["confidence"] or 0) < min_confidence:
                    failed_evidence.append("TRAIN_COVERAGE_BELOW_MINIMUM")
                if (validation["confidence"] or 0) < min_validation:
                    failed_evidence.append("VALIDATION_COVERAGE_BELOW_MINIMUM")
                if train["inlierR2"] is None or train["inlierR2"] < min_r2:
                    failed_evidence.append("TRAIN_R2_BELOW_MINIMUM")
                if validation["inlierR2"] is None or validation["inlierR2"] < min_r2:
                    failed_evidence.append("VALIDATION_R2_BELOW_MINIMUM")
                if failed_evidence:
                    for reason in failed_evidence:
                        reject(diagnostic, reason)
                    continue
                predicate = _group("AND", atoms)
                result = {"operator": "WITHIN_TOLERANCE", "column": target, "expression": expression,
                          "absoluteTolerance": tolerance, "relativeTolerance": 0.0}
                if target in numeric_text:
                    result["numericText"] = True
                formula = formula_expression_text(expression)
                expected_text = f"{formula} ± {tolerance:.9g}"
                condition_text = " AND ".join((f"{atom['column']} = {repr(atom['value'])}" if atom["operator"] == "=" else
                                                f"{atom['column']} != 0" if atom["operator"] == "!=" else
                                                f"NUMERIC({atom['column']}) IS NOT NULL" if atom.get("numericText") else
                                                f"{atom['column']} IS NOT NULL") for atom in atoms)
                digest = hashlib.sha256(json.dumps([predicate, result], sort_keys=True).encode()).hexdigest()[:24].upper()
                validation.update({"status": "VALIDATED", "source": "SELECTION_VALIDATION", "metricKind": "FORMULA_WITHIN_TOLERANCE",
                                   "absoluteTolerance": tolerance, "relativeTolerance": 0., "targetTrainingIqr": target_scale,
                                   "toleranceFraction": tolerance / target_scale, "train": train, "calibration": calibration_metrics,
                                   "discoveryMethod": method, "coefficientPolicy": "CANONICAL_SIMPLE" if canonical else "FITTED",
                                   "selectionMetric": "TRAIN_FIT_RELATIVE_P90_ERROR", "selectionError": fit_selection_error,
                                   "numericalToleranceFloor": floor})
                accepted.append({"ruleId": "MIXED_FORMULA_" + digest, "predicate": predicate, "expression": condition_text,
                    "fullText": f"IF {condition_text} THEN {target} ≈ {expected_text}", "resultPredicate": result,
                    "resultColumn": target, "resultValue": expected_text, "resultText": f"{target} ≈ {expected_text}", "resultKind": "FORMULA",
                    "supportCount": train["supportCount"], "conditionCount": train["conditionCount"], "totalCount": train["totalCount"],
                    "resultCount": None, "confidence": train["confidence"], "support": train["support"], "lift": None,
                    "validation": validation, "validationStatus": "VALIDATED", "status": "PATTERN",
                    "metricMeaning": "WITHIN_CALIBRATED_NUMERIC_TOLERANCE_NOT_ERROR_PROBABILITY",
                    "formulaDiagnostics": {"train": train, "calibration": calibration_metrics, "validation": dict(validation, train=None, calibration=None)},
                    "formulaFeatures": names, "formulaComplexity": len(names), "fitSource": "TRAIN_FIT", "toleranceSource": "CALIBRATION"})
            if accepted:
                best_error = min(item["validation"]["selectionError"] for item in accepted)
                best_floor = min(item["validation"]["numericalToleranceFloor"] for item in accepted if item["validation"]["selectionError"] == best_error)
                accepted.sort(key=lambda item: (item["validation"]["selectionError"] > best_error * 1.05
                    + (best_floor + item["validation"]["numericalToleranceFloor"]) / target_scale,
                    item["validation"]["coefficientPolicy"] != "CANONICAL_SIMPLE", item["formulaComplexity"],
                    item["validation"]["discoveryMethod"] != "SUM_DIFFERENCE",
                    item["validation"]["selectionError"], -item["confidence"], item["ruleId"]))
                rules.append(accepted[0])
                diagnostic["acceptedRuleCount"] += 1
                diagnostic["status"] = "ACCEPTED"
                if subgroup is None:
                    global_accepted = True
        if diagnostic["status"] == "ATTEMPTED":
            diagnostic["status"] = "REJECTED"
    rules.sort(key=lambda rule: (-rule["confidence"], -rule["supportCount"], rule["formulaComplexity"], rule["ruleId"]))
    warnings = ["FORMULA_TOLERANCE_CALIBRATED_SEPARATELY"] if rules else []
    if len(eligible_targets) > len(targets):
        warnings.append("CONTINUOUS_TARGET_COLUMN_LIMIT")
    if any(item["reason"] == "ORACLE_FORMULA_NUMERIC_RANGE" for item in excluded_numeric):
        warnings.append("EXTREME_NUMERIC_FORMULA_COLUMNS_SKIPPED")
    if numeric_text:
        warnings.append("NUMERIC_TEXT_INTERPRETED_WITH_EXPLICIT_SAFE_CONVERSION")
    return {"rules": rules[:max_rules], "metrics": {"diagnosticVersion": 1, "enabled": True,
            "status": "RULES_AVAILABLE" if rules else "NO_ELIGIBLE_TARGETS" if not eligible_targets else "NO_VALIDATED_RULES",
            "sourceColumnCount": len(columns), "physicalNumericColumnCount": physical_numeric_count,
            "inferredNumericTextColumnCount": inferred_text_count, "numericColumnCount": len(numeric),
            "targetCount": len(attempted), "attemptedTargetCount": len(attempted), "targets": attempted,
            "eligibleTargetCount": len(eligible_targets), "excludedTargets": ranked_targets[max_targets:],
            "excludedColumns": excluded_numeric, "columnInference": column_diagnostics,
            "eligibilityReasons": eligibility_reasons, "rejectionReasons": rejection_reasons,
            "targetDiagnostics": list(target_diagnostics.values()),
            "testedCandidateCount": sum(item["proposalCount"] for item in target_diagnostics.values()),
            "fittedCandidateCount": sum(item["fittedModelCount"] for item in target_diagnostics.values()),
            "acceptedRuleCount": len(rules), "targetSelection": "TRAIN_ONLY_PAIR_EVIDENCE_AND_RELATION_STRENGTH",
            "unitSearch": {"maxTerms": max_features, "sampleRows": UNIT_SAMPLE_ROWS, "beamWidth": UNIT_BEAM_WIDTH,
                           "candidateLimitPerCohort": UNIT_CANDIDATE_LIMIT, "fitSource": "TRAIN_FIT"},
            "fitRows": len(fit_indices), "calibrationRows": len(calibration_indices), "validationRows": len(validation_indices),
            "ruleCount": min(len(rules), max_rules), "candidateRuleCount": len(rules), "minFormulaConfidence": min_confidence,
            "minFormulaValidationConfidence": min_validation, "minFormulaR2": min_r2, "maxToleranceFraction": max_fraction,
            "fitSource": "TRAIN_FIT", "toleranceSource": "CALIBRATION", "validationSource": "SELECTION_VALIDATION",
            "r2AcceptanceMetric": "INLIER_R2_WITH_COVERAGE_AND_TOLERANCE_GUARDS"},
            "warnings": warnings}
