"""Bounded descriptive diagnostics for mixed data; no user type decisions."""
from collections import Counter
from decimal import Decimal
from itertools import combinations
import hashlib
import math

NUMERIC_TYPES = {"NUMBER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE"}
TEXT_TYPES = {"VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR"}


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


def _numeric_values(values, data_type):
    if data_type in NUMERIC_TYPES:
        return [_number(value) for value in values], "PHYSICAL_NUMERIC"
    if data_type not in TEXT_TYPES:
        return None, None
    from backend.services.mixed_numeric import parse_numeric_decimal
    parsed = [parse_numeric_decimal(value) for value in values]
    present = [index for index, value in enumerate(values)
               if not _missing(value) and not (isinstance(value, str) and not value.strip(" "))]
    # Low-cardinality codes keep their existing categorical interpretation.
    if (not present or any(parsed[index] is None for index in present)
            or len({parsed[index] for index in present}) < 8):
        return None, None
    return [float(value) if value is not None else float("nan") for value in parsed], "NUMERIC_TEXT"


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
        numeric_values, numeric_source = _numeric_values(values, column["DATA_TYPE"])
        detail["NUMERIC_SOURCE"] = numeric_source
        if numeric_values is not None:
            numeric_count += 1
            if numeric_source == "NUMERIC_TEXT":
                numeric_text_count += 1
                detail["NUMERIC_WARNINGS"].append("NUMERIC_TEXT_INFERRED")
            vector = np.array(numeric_values, dtype=float)
            numeric = vector[np.isfinite(vector)]
            detail["INVALID_NUMERIC_COUNT"] = len(present) - len(numeric)
            if detail["INVALID_NUMERIC_COUNT"]:
                detail["NUMERIC_WARNINGS"].append("NON_FINITE_INPUT_EXCLUDED")
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
    return {"kind": "MIXED_XAI_PROFILE", **(sampling or {}), "sampleCount": count,
        "columnCount": len(columns), "numericColumnCount": numeric_count,
        "numericTextColumnCount": numeric_text_count,
        "textColumnCount": len(columns) - numeric_count, "sourceColumnCount": source_column_count or len(columns),
        "skippedColumnCount": max(0, (source_column_count or len(columns)) - len(columns)),
        "duplicateRowCount": duplicates, "duplicateRowRate": duplicates / count if count else 0,
        "duplicateScope": "SELECTED_COLUMNS_IN_SAMPLE", "columns": details}


def relate_rows(rows, columns, *, profile=None, max_numeric_columns=64, max_pairs=100):
    import numpy as np
    count = len(rows)
    converted = {column["COLUMN_NAME"]: _numeric_values([row.get(column["COLUMN_NAME"]) for row in rows], column["DATA_TYPE"])
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
    profile = profile or describe_rows(rows, columns)
    return {"kind": "MIXED_XAI_RELATION", "sampleCount": count, "numericColumnCount": len(selected),
        "numericTextColumnCount": sum(converted[name][1] == "NUMERIC_TEXT" for name in selected),
        "skippedNumericColumnCount": max(0, len(numeric) - len(selected)), "pairCount": len(pairs),
        "correlationPairs": pairs[:max_pairs], "pairsTruncated": len(pairs) > max_pairs,
        "duplicateColumns": duplicates, "duplicateRowCount": profile["duplicateRowCount"],
        "missingColumns": [{key: column[key] for key in ("COLUMN_NAME", "NULL_COUNT", "NULL_RATE")}
                           for column in sorted(profile["columns"], key=lambda item: item["NULL_COUNT"], reverse=True) if column["NULL_COUNT"]],
        "limits": {"maxNumericColumns": max_numeric_columns, "maxPairs": max_pairs},
        "meaning": "Pairwise-complete Pearson correlations and coverage on the bounded sample; descriptive, not causal or editing rules."}
