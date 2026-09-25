"""Bounded, unsupervised source-column screening before capped pattern models.

Only column-level evidence is retained. This prefix probe does not fit rules or
relax their separate fit/calibration/selection-validation acceptance criteria.
"""
from __future__ import annotations

import math

from backend.services.analysis_sampling import sample_rows
from backend.services.mixed_numeric import inspect_numeric_text, parse_numeric_text
from backend.services.mixed_xai_algorithm import _ID_NAME, _NUMERIC_TYPES, _missing


SCREEN_ROWS = 512
SCREEN_BYTES = 2 * 1024 * 1024
SCREEN_BATCH_COLUMNS = 32


def column_screen_evidence(column, rows):
    name = column["COLUMN_NAME"]
    values = [row.get(name) for row in rows]
    present = [value for value in values if not _missing(value)]
    distinct = len(set(present))
    evidence = {"column": name, "probeRows": len(rows), "nonNullCount": len(present),
                "distinctCount": distinct, "numericEligible": False}
    numeric = []
    if column["DATA_TYPE"] in _NUMERIC_TYPES:
        for value in present:
            try:
                number = float(value)
                if math.isfinite(number):
                    numeric.append(number)
            except (TypeError, ValueError, OverflowError):
                pass
        numeric_ok = len(numeric) >= 30 and len(numeric) == len(present) and all(abs(value) < 1e125 for value in numeric)
    else:
        inspected = inspect_numeric_text(values)
        numeric_ok = inspected["eligible"]
        evidence.update(numericReason=inspected["reason"], numericRatio=inspected["numericRatio"],
                        leadingZeroCount=inspected["leadingZeroCount"])
        if numeric_ok:
            numeric = [number for value in present if (number := parse_numeric_text(value)) is not None]
    numeric_distinct = len(set(numeric))
    fractional_count = sum(value != math.floor(value) for value in numeric)
    sequence = (column["DATA_TYPE"] not in _NUMERIC_TYPES and len(numeric) >= 32 and numeric_distinct / len(numeric) >= .98
                and all(value == math.floor(value) for value in numeric)
                and max(numeric) - min(numeric) <= len(numeric) * 2
                and (all(a < b for a, b in zip(numeric, numeric[1:]))
                     or all(a > b for a, b in zip(numeric, numeric[1:]))))
    identifier = bool(_ID_NAME.search(name)) or sequence
    evidence.update(numericEligible=numeric_ok and not identifier, numericDistinctCount=numeric_distinct,
                    fractionalNumericCount=fractional_count)
    if identifier:
        priority, reason = 4, "IDENTIFIER_LIKE_PROBE"
    elif numeric_ok and (numeric_distinct >= 16 or numeric_distinct >= 2 and fractional_count):
        priority, reason = 0, "VARYING_NUMERIC_PROBE"
    elif 2 <= distinct <= 128:
        priority, reason = 1, "CATEGORICAL_OR_SMALL_COUNT_PROBE"
    elif distinct <= 1:
        priority, reason = 3, "CONSTANT_OR_EMPTY_PROBE"
    else:
        priority, reason = 2, "HIGH_CARDINALITY_OR_UNCONFIRMED_PROBE"
    evidence.update(priority=priority, reason=reason)
    return evidence


def screen_feature_columns(cursor, *, owner, table, columns, feature_limit,
                           mandatory_columns=(), probe_rows=SCREEN_ROWS, probe_byte_limit=SCREEN_BYTES):
    """Keep the model's feature cap while inspecting later source columns.

    Each small SELECT projects no more than the model cap. The probe never runs
    COUNT, a random sort, or a mandatory full-source scan. Rare/later values may
    be absent; final training independently rechecks all numeric eligibility.
    """
    mandatory = set(mandatory_columns)
    names = {column["COLUMN_NAME"] for column in columns}
    if not 1 <= feature_limit <= 128 or not 1 <= probe_rows <= SCREEN_ROWS or not 1 <= probe_byte_limit <= SCREEN_BYTES:
        raise ValueError("Invalid bounded feature-screening limits.")
    if mandatory - names or len(mandatory) > feature_limit:
        raise ValueError("Selected targets must fit within the eligible source feature limit.")
    batch_width = min(SCREEN_BATCH_COLUMNS, feature_limit)
    evidence, probes = [], []
    for start in range(0, len(columns), batch_width):
        batch = columns[start:start + batch_width]
        rows, info = sample_rows(cursor, owner=owner, table=table, columns=batch,
            row_limit=probe_rows, byte_limit=probe_byte_limit, strategy="FIRST_ROWS")
        evidence.extend(column_screen_evidence(column, rows) for column in batch)
        probes.append({"columnCount": len(batch), "sampleCount": info["sampleCount"],
                       "estimatedBytes": info["sampleEstimatedBytes"],
                       "byteLimitReached": info["sampleByteLimitReached"]})
        del rows
    order = {column["COLUMN_NAME"]: index for index, column in enumerate(columns)}
    ranked = sorted(evidence, key=lambda item: (item["column"] not in mandatory, item["priority"], order[item["column"]]))
    selected = {item["column"] for item in ranked[:feature_limit]}
    for item in evidence:
        item["selected"] = item["column"] in selected
        item["explicitTarget"] = item["column"] in mandatory
        if not item["selected"]:
            item["exclusionReason"] = "SOURCE_FEATURE_LIMIT_AFTER_SCREENING"
    return [column for column in columns if column["COLUMN_NAME"] in selected], {
        "policy": "BOUNDED_PREFIX_NUMERIC_VARIATION_THEN_SOURCE_ORDER",
        "sourceColumnCount": len(columns), "selectedColumnCount": len(selected),
        "modelFeatureLimit": feature_limit, "probeRowLimit": probe_rows,
        "probeByteLimit": probe_byte_limit, "probeColumnBatchLimit": batch_width,
        "probeQueryCount": len(probes), "probes": probes, "columns": evidence,
        "sourceSnapshotPinned": False, "fullSourceScanRequired": False,
        "validationMeaning": "UNSUPERVISED_COLUMN_SCREEN_ONLY_NOT_MODEL_FIT_OR_RULE_VALIDATION",
        "warnings": ["PREFIX_FEATURE_PROBE_MAY_MISS_LATE_OR_RARE_VALUES", "FEATURE_PROBE_SOURCE_NOT_SNAPSHOT_PINNED"],
    }
