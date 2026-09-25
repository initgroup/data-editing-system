"""Bounded descriptive diagnostics for mixed data; no user type decisions."""
from collections import Counter
from decimal import Decimal
from itertools import combinations
import hashlib
import math
import re

NUMERIC_TYPES = {"NUMBER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE"}
TEXT_TYPES = {"VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR"}
_ID_NAME = re.compile(r"(^|_)(ID|KEY|UUID|GUID|SEQ|ROWID|ROW_NO|RN)($|_)", re.I)


def _missing(value):
    return value is None or value == ""


def _number(value):
    if _missing(value):
        return float("nan")
    try:
        number = float(value)
        return number if math.isfinite(number) else float("nan")
    except (TypeError, ValueError, OverflowError):
        return float("nan")


def _numeric_values(values, data_type, inference=None):
    if data_type in NUMERIC_TYPES:
        return [_number(value) for value in values], "PHYSICAL_NUMERIC"
    if data_type not in TEXT_TYPES:
        return None, None
    from backend.services.mixed_numeric import inspect_numeric_text, parse_numeric_decimal
    # Low-cardinality codes keep their existing categorical interpretation.
    inference = inference or inspect_numeric_text(values, min_count=1)
    if not inference["eligible"] or inference["distinctCount"] < 8:
        return None, None
    parsed = [parse_numeric_decimal(value) for value in values]
    return [float(value) if value is not None else float("nan") for value in parsed], "NUMERIC_TEXT"


def _semantic_type(name, data_type, present_count, distinct_count, numeric_source):
    if not present_count:
        return "EMPTY", "NO_NONMISSING_SAMPLE_VALUES"
    if distinct_count >= 16 and distinct_count / present_count >= .98 and _ID_NAME.search(name):
        return "IDENTIFIER", "IDENTIFIER_NAME_AND_NEAR_UNIQUENESS"
    if distinct_count <= 1:
        return "CONSTANT", "ONE_OBSERVED_VALUE"
    if numeric_source and distinct_count >= 8:
        return "CONTINUOUS", "NUMERIC_WITH_AT_LEAST_EIGHT_VALUES"
    if data_type in NUMERIC_TYPES | TEXT_TYPES:
        return "CATEGORICAL", "DISCRETE_OR_TEXT_VALUES"
    return "UNSUPPORTED", "UNSUPPORTED_PHYSICAL_TYPE"


def _key(value):
    if _missing(value):
        return ("NULL", "")
    if isinstance(value, int) and not isinstance(value, bool):
        return ("NUMBER", str(value))
    if isinstance(value, (float, Decimal)):
        number = Decimal(str(value))
        if number.is_finite():
            # Decimal fixed formatting keeps all 38 Oracle NUMBER digits;
            # trimming the fractional suffix unifies 1, 1.0 and Decimal(1).
            text = format(number, "f")
            text = text.rstrip("0").rstrip(".") if "." in text else text
            return ("NUMBER", "0" if number.is_zero() else text)
    return (type(value).__name__, str(value))


def describe_rows(rows, columns, *, sampling=None, source_column_count=None):
    import numpy as np
    count = len(rows)
    details = []
    numeric_count = 0
    numeric_text_count = 0
    for column in columns:
        name = column["COLUMN_NAME"]
        values = [row.get(name) for row in rows]
        present = [value for value in values if not _missing(value)]
        counts = Counter(_key(value) for value in present)
        detail = {"COLUMN_NAME": name, "DATA_TYPE": column["DATA_TYPE"],
            "COLUMN_COMMENT": column.get("COLUMN_COMMENT", ""), "ROW_COUNT": count,
            "NON_NULL_COUNT": len(present), "NULL_COUNT": count - len(present),
            "NULL_RATE": (count - len(present)) / count if count else 0,
            "DISTINCT_COUNT": len(counts), "DISTINCT_RATE": len(counts) / len(present) if present else 0,
            "MIN": None, "MAX": None, "MEAN": None, "STDDEV": None, "Q1": None, "MEDIAN": None, "Q3": None,
            "ZERO_COUNT": None, "INVALID_NUMERIC_COUNT": 0, "NUMERIC_WARNINGS": [],
            "TOP_VALUES": [{"value": key[1][:256], "count": frequency, "rate": frequency / count if count else 0}
                           for key, frequency in counts.most_common(8)]}
        if column["DATA_TYPE"] in TEXT_TYPES:
            from backend.services.mixed_numeric import inspect_numeric_text
            inference = inspect_numeric_text(values, min_count=1)
            detail.update(NUMERIC_INFERENCE=inference,
                          NUMERIC_PARSE_INVALID_COUNT=inference["invalidCount"],
                          NUMERIC_PARSE_RATIO=inference["numericRatio"],
                          BLANK_TEXT_COUNT=sum(isinstance(value, str) and bool(value) and not value.strip(" ") for value in values))
        numeric_values, numeric_source = _numeric_values(values, column["DATA_TYPE"], detail.get("NUMERIC_INFERENCE"))
        detail["NUMERIC_SOURCE"] = numeric_source
        semantic_type, semantic_reason = _semantic_type(name, column["DATA_TYPE"], len(present), len(counts), numeric_source)
        detail.update(SEMANTIC_TYPE=semantic_type, SEMANTIC_REASON=semantic_reason,
                      SEMANTIC_SCOPE="BOUNDED_SAMPLE_DIAGNOSTIC_NOT_A_SCHEMA_CHANGE")
        if numeric_values is not None:
            numeric_count += 1
            if numeric_source == "NUMERIC_TEXT":
                numeric_text_count += 1
                detail["NUMERIC_WARNINGS"].append("NUMERIC_TEXT_INFERRED")
            vector = np.array(numeric_values, dtype=float)
            numeric = vector[np.isfinite(vector)]
            detail["INVALID_NUMERIC_COUNT"] = (detail["NUMERIC_INFERENCE"]["invalidCount"]
                if numeric_source == "NUMERIC_TEXT" else len(present) - len(numeric))
            if detail["INVALID_NUMERIC_COUNT"]:
                detail["NUMERIC_WARNINGS"].append("INVALID_NUMERIC_TEXT_EXCLUDED" if numeric_source == "NUMERIC_TEXT" else "NON_FINITE_INPUT_EXCLUDED")
            detail["ZERO_COUNT"] = int(np.count_nonzero(numeric == 0))
            if len(numeric):
                scale = max(float(np.max(np.abs(numeric))), 1.0)
                scaled = numeric / scale
                with np.errstate(over="ignore", invalid="ignore"):
                    q1, median, q3 = np.percentile(scaled, [25, 50, 75]) * scale
                    mean = float(scaled.mean() * scale)
                    stddev = float(scaled.std(ddof=1) * scale) if len(numeric) > 1 else None
                detail.update({"MIN": float(numeric.min()), "MAX": float(numeric.max()),
                    "MEAN": mean if math.isfinite(mean) else None,
                    "STDDEV": stddev if stddev is not None and math.isfinite(stddev) else None,
                    "Q1": float(q1) if math.isfinite(q1) else None,
                    "MEDIAN": float(median) if math.isfinite(median) else None,
                    "Q3": float(q3) if math.isfinite(q3) else None})
                if not all(math.isfinite(value) for value in (q1, median, q3, mean)) or stddev is not None and not math.isfinite(stddev):
                    detail["NUMERIC_WARNINGS"].append("STATISTIC_OUT_OF_RANGE")
        details.append(detail)
    names = [column["COLUMN_NAME"] for column in columns]
    # Hash full selected-row values with separators; no raw data rows are persisted.
    unique_rows = {hashlib.sha256(repr(tuple(_key(row.get(name)) for name in names)).encode("utf-8")).digest() for row in rows}
    duplicates = count - len(unique_rows)
    semantic_counts = dict(Counter(detail["SEMANTIC_TYPE"] for detail in details))
    return {"kind": "MIXED_XAI_PROFILE", **(sampling or {}), "sampleCount": count,
        "columnCount": len(columns), "numericColumnCount": numeric_count,
        "numericTextColumnCount": numeric_text_count,
        "textColumnCount": len(columns) - numeric_count, "sourceColumnCount": source_column_count or len(columns),
        "skippedColumnCount": max(0, (source_column_count or len(columns)) - len(columns)),
        "semanticTypeCounts": semantic_counts,
        "invalidNumericValueCount": sum(detail["INVALID_NUMERIC_COUNT"] for detail in details),
        "duplicateRowCount": duplicates, "duplicateRowRate": duplicates / count if count else 0,
        "duplicateScope": "SELECTED_COLUMNS_IN_SAMPLE", "columns": details}


def _categorical_association(left, right, left_levels, right_levels):
    import numpy as np
    mask = (left >= 0) & (right >= 0)
    count = int(mask.sum())
    if count < 3:
        return count, None, None
    observed = np.bincount(left[mask] * right_levels + right[mask],
                          minlength=left_levels * right_levels).reshape(left_levels, right_levels)
    observed = observed[observed.sum(axis=1) > 0][:, observed.sum(axis=0) > 0]
    row_count, column_count = observed.shape
    if min(row_count, column_count) < 2:
        return count, None, None
    expected = observed.sum(axis=1)[:, None] * observed.sum(axis=0)[None, :] / count
    phi2 = float(np.sum((observed - expected) ** 2 / expected)) / count
    corrected_phi2 = max(0., phi2 - (row_count - 1) * (column_count - 1) / (count - 1))
    corrected_rows = row_count - (row_count - 1) ** 2 / (count - 1)
    corrected_columns = column_count - (column_count - 1) ** 2 / (count - 1)
    denominator = min(corrected_rows - 1, corrected_columns - 1)
    value = math.sqrt(min(1., corrected_phi2 / denominator)) if denominator > 0 else None
    return count, value, float(np.mean(expected < 5))


def _categorical_numeric_association(categories, numeric, levels):
    import numpy as np
    mask = (categories >= 0) & np.isfinite(numeric)
    count = int(mask.sum())
    if count < 3:
        return count, None, 0, 0
    codes, values = categories[mask], numeric[mask]
    values = values / max(1., float(np.max(np.abs(values))))
    counts = np.bincount(codes, minlength=levels)
    sums = np.bincount(codes, weights=values, minlength=levels)
    present = counts > 0
    groups, minimum = int(present.sum()), int(counts[present].min())
    total = float(np.sum((values - values.mean()) ** 2))
    if groups < 2 or total <= 0:
        return count, None, groups, minimum
    between = float(np.sum(counts[present] * (sums[present] / counts[present] - values.mean()) ** 2))
    return count, max(0., min(1., between / total)), groups, minimum


def relate_rows(rows, columns, *, profile=None, max_numeric_columns=64, max_pairs=100,
                max_categorical_columns=32, max_categories=32, max_mixed_pairs=256):
    import numpy as np
    count = len(rows)
    profile = profile or describe_rows(rows, columns)
    profile_columns = {column["COLUMN_NAME"]: column for column in profile["columns"]}
    converted = {column["COLUMN_NAME"]: _numeric_values([row.get(column["COLUMN_NAME"]) for row in rows], column["DATA_TYPE"],
                 profile_columns[column["COLUMN_NAME"]].get("NUMERIC_INFERENCE"))
                 for column in columns}
    numeric = [name for name, (values, _source) in converted.items() if values is not None]
    selected = numeric[:max_numeric_columns]
    vectors = {name: np.array(converted[name][0], dtype=float) for name in selected}
    pairs = []
    for left, right in combinations(selected, 2):
        mask = np.isfinite(vectors[left]) & np.isfinite(vectors[right])
        pair_count = int(np.count_nonzero(mask))
        correlation = None
        if pair_count >= 3:
            x, y = vectors[left][mask], vectors[right][mask]
            x = x / max(float(np.max(np.abs(x))), 1.0)
            y = y / max(float(np.max(np.abs(y))), 1.0)
            if np.ptp(x) > 0 and np.ptp(y) > 0:
                coefficient = float(np.corrcoef(x, y)[0, 1])
                correlation = coefficient if math.isfinite(coefficient) else None
        pairs.append({"COLUMN_X": left, "COLUMN_Y": right, "PAIR_COUNT": pair_count,
                      "COVERAGE": pair_count / count if count else 0, "CORRELATION": correlation})
    pairs.sort(key=lambda pair: (pair["CORRELATION"] is not None, abs(pair["CORRELATION"] or 0), pair["PAIR_COUNT"]), reverse=True)
    categorical, categorical_excluded = {}, []
    for column in columns:
        name = column["COLUMN_NAME"]
        detail = profile_columns[name]
        if detail.get("SEMANTIC_TYPE") != "CATEGORICAL":
            continue
        if not 2 <= detail["DISTINCT_COUNT"] <= max_categories:
            categorical_excluded.append({"column": name, "reason": "CATEGORY_COUNT_LIMIT"})
            continue
        if len(categorical) >= max_categorical_columns:
            categorical_excluded.append({"column": name, "reason": "CATEGORICAL_COLUMN_LIMIT"})
            continue
        keys = [_key(row.get(name)) for row in rows]
        categories = sorted(set(key for key in keys if key[0] != "NULL"))
        mapping = {key: index for index, key in enumerate(categories)}
        categorical[name] = (np.asarray([mapping.get(key, -1) for key in keys], dtype=int), len(categories))
    categorical_pairs = []
    categorical_pair_total = len(categorical) * (len(categorical) - 1) // 2
    for index, (left, right) in enumerate(combinations(categorical, 2)):
        if index >= max_mixed_pairs:
            break
        left_codes, left_levels = categorical[left]
        right_codes, right_levels = categorical[right]
        pair_count, value, sparse_fraction = _categorical_association(left_codes, right_codes, left_levels, right_levels)
        categorical_pairs.append({"COLUMN_X": left, "COLUMN_Y": right, "PAIR_COUNT": pair_count,
            "COVERAGE": pair_count / count if count else 0., "CRAMERS_V": value,
            "METRIC": "BIAS_CORRECTED_CRAMERS_V", "SPARSE_EXPECTED_CELL_FRACTION": sparse_fraction})
    categorical_pairs.sort(key=lambda pair: (pair["CRAMERS_V"] is not None, pair["CRAMERS_V"] or 0., pair["PAIR_COUNT"]), reverse=True)
    continuous = [name for name in selected if profile_columns[name].get("SEMANTIC_TYPE") == "CONTINUOUS"]
    mixed_pairs = []
    mixed_pair_total = len(categorical) * len(continuous)
    for left in categorical:
        codes, levels = categorical[left]
        for right in continuous:
            if len(mixed_pairs) >= max_mixed_pairs:
                break
            pair_count, eta2, groups, minimum = _categorical_numeric_association(codes, vectors[right], levels)
            mixed_pairs.append({"COLUMN_X": left, "COLUMN_Y": right, "PAIR_COUNT": pair_count,
                "COVERAGE": pair_count / count if count else 0., "ETA_SQUARED": eta2,
                "CORRELATION_RATIO": math.sqrt(eta2) if eta2 is not None else None,
                "METRIC": "CORRELATION_RATIO_ETA", "GROUP_COUNT": groups,
                "MIN_GROUP_COUNT": minimum, "LOW_GROUP_SUPPORT": minimum < 5})
    mixed_pairs.sort(key=lambda pair: (pair["CORRELATION_RATIO"] is not None, pair["CORRELATION_RATIO"] or 0., pair["PAIR_COUNT"]), reverse=True)
    fingerprints = {}
    duplicates = []
    for column in columns:
        name = column["COLUMN_NAME"]
        signature = hashlib.sha256()
        for row in rows:
            value = repr(_key(row.get(name))).encode("utf-8")
            signature.update(len(value).to_bytes(4, "big"))
            signature.update(value)
        digest = signature.digest()
        previous = fingerprints.get(digest)
        if count and previous and all(_key(row.get(previous)) == _key(row.get(name)) for row in rows):
            duplicates.append({"COLUMN_X": previous, "COLUMN_Y": name, "MATCH_COUNT": count, "COVERAGE": 1.0})
        else:
            fingerprints[digest] = name
    return {"kind": "MIXED_XAI_RELATION", "sampleCount": count, "numericColumnCount": len(selected),
        "numericTextColumnCount": sum(converted[name][1] == "NUMERIC_TEXT" for name in selected),
        "skippedNumericColumnCount": max(0, len(numeric) - len(selected)), "pairCount": len(pairs),
        "correlationPairs": pairs[:max_pairs], "pairsTruncated": len(pairs) > max_pairs,
        "categoricalPairs": categorical_pairs[:max_pairs], "categoricalColumnCount": len(categorical),
        "categoricalPairCount": len(categorical_pairs), "categoricalCandidatePairCount": categorical_pair_total,
        "categoricalPairsTruncated": categorical_pair_total > min(len(categorical_pairs), max_pairs),
        "categoricalNumericPairs": mixed_pairs[:max_pairs], "categoricalNumericPairCount": len(mixed_pairs),
        "categoricalNumericCandidatePairCount": mixed_pair_total,
        "categoricalNumericPairsTruncated": mixed_pair_total > min(len(mixed_pairs), max_pairs),
        "excludedCategoricalColumns": categorical_excluded,
        "duplicateColumns": duplicates, "duplicateRowCount": profile["duplicateRowCount"],
        "missingColumns": [{key: column[key] for key in ("COLUMN_NAME", "NULL_COUNT", "NULL_RATE")}
                           for column in sorted(profile["columns"], key=lambda item: item["NULL_COUNT"], reverse=True) if column["NULL_COUNT"]],
        "limits": {"maxNumericColumns": max_numeric_columns, "maxPairs": max_pairs,
                   "maxCategoricalColumns": max_categorical_columns, "maxCategories": max_categories,
                   "maxMixedPairsPerFamily": max_mixed_pairs},
        "candidateSelection": "BOUNDED_SOURCE_COLUMN_ORDER_NO_MARGINAL_CORRELATION_GATE",
        "meaning": "Pairwise-complete Pearson correlation, bias-corrected Cramer's V and correlation ratio on the bounded sample; descriptive, not causal, error probabilities or editing rules."}
