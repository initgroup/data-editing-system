"""Bounded source samples with explicit cost, repeatability and bias metadata.

HASH performs an exact count and a hash-filtered scan, not a random full sort.
All matching rows are consumed: a streaming bottom-k heap makes the retained
sample independent of source scan order. ROWID stability and an unchanged source
are required for reuse; these two statements do not pin an Oracle snapshot.
"""
from __future__ import annotations

import hashlib
import heapq
import re

from backend.database_helper import SqlLoader


_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")
_HASH_BUCKETS = 2**32 - 1
_DEFAULT_BYTES = 32 * 1024 * 1024


def _identifier(value):
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise ValueError("Sampling requires validated Oracle identifiers.")
    return '"' + value + '"'


def _render(sql_id, owner, table, names):
    return (SqlLoader.get_sql(sql_id)
            .replace("/*TARGET*/", _identifier(owner) + "." + _identifier(table))
            .replace("/*COLUMNS*/", ", ".join("T." + _identifier(name) for name in names)))


def _row_bytes(values):
    # Conservative retained-row estimate; driver buffers/process RSS are separate.
    return 128 + 72 * len(values) + sum(
        len(value.encode("utf-8")) + 80 if isinstance(value, str) else 96
        for value in values)


def sample_rows(cursor, *, owner, table, columns, row_limit,
                byte_limit=_DEFAULT_BYTES, strategy="FIRST_ROWS", seed=42):
    """Return (row dictionaries, metadata), without writes or transaction changes.

    HASH retains the smallest deterministic hash priorities from approximately
    twice the desired row count. A memory shortage retains a shorter hash prefix
    and is explicitly marked as byte-truncated, not a representative sample.
    No candidate ROW cap is used, because it would reintroduce source-order bias.
    """
    if isinstance(row_limit, bool) or not isinstance(row_limit, int) or not 1 <= row_limit <= 25000:
        raise ValueError("sample row_limit must be between 1 and 25000.")
    if isinstance(byte_limit, bool) or not isinstance(byte_limit, int) or not 1 <= byte_limit <= _DEFAULT_BYTES:
        raise ValueError("sample byte_limit must be between 1 and 33554432.")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= _HASH_BUCKETS:
        raise ValueError("sample seed must be an unsigned 32-bit integer.")
    strategy = str(strategy).strip().upper()
    if strategy not in {"FIRST_ROWS", "HASH"}:
        raise ValueError("samplingStrategy must be FIRST_ROWS or HASH.")
    names = [column["COLUMN_NAME"] for column in columns]
    if not names or len(names) > 128 or len(set(names)) != len(names):
        raise ValueError("Sampling requires 1 to 128 distinct source columns.")
    for value in (owner, table, *names):
        _identifier(value)
    projected_size = 128 + sum(max(96, int(column.get("DATA_LENGTH") or 128)) + 152 for column in columns)
    batch_size = max(1, min(250, min(byte_limit, 1024 * 1024) // max(1, projected_size)))
    common = {"sampling": strategy, "sampleLimit": row_limit, "sampleByteLimit": byte_limit,
              "sampleSeed": seed, "sourceSnapshotPinned": False,
              "memoryLimitMeaning": "ESTIMATED_RETAINED_ROWS_EXCLUDES_DRIVER_BUFFERS"}
    if strategy == "FIRST_ROWS":
        cursor.execute(_render("ANALYSIS_SAMPLE_FIRST_ROWS", owner, table, names), {"rowLimit": row_limit})
        rows, size, byte_truncated = [], 0, False
        while len(rows) < row_limit and not byte_truncated:
            batch = cursor.fetchmany(min(batch_size, row_limit - len(rows)))
            if not batch:
                break
            for values in batch:
                row_size = _row_bytes(values)
                if size + row_size > byte_limit:
                    byte_truncated = True
                    break
                rows.append(dict(zip(names, values)))
                size += row_size
        return rows, {**common, "sampleCount": len(rows), "sampleLimitReached": len(rows) == row_limit,
                      "sampleByteLimitReached": byte_truncated, "sampleEstimatedBytes": size,
                      "selectionMeaning": "SOURCE_PREFIX_NOT_POPULATION_REPRESENTATIVE",
                      "samplingWarnings": ["FIRST_ROWS_SAMPLE_NOT_POPULATION_REPRESENTATIVE"]}

    cursor.execute(_render("ANALYSIS_SAMPLE_COUNT", owner, table, names))
    counted = cursor.fetchone()
    source_count = int(counted[0]) if counted else 0
    # Ceil and clamp preserve a positive probability even for very large tables.
    target_candidates = min(source_count, row_limit * 2)
    threshold = min(_HASH_BUCKETS, max(0,
        (target_candidates * (_HASH_BUCKETS + 1) + max(1, source_count) - 1) // max(1, source_count) - 1))
    base = {**common, "sourceRowCountAtSampling": source_count,
            "hashCandidateFraction": (threshold + 1) / (_HASH_BUCKETS + 1),
            "hashThreshold": threshold, "samplingSourcePasses": 2 if source_count else 1,
            "scanCost": "EXACT_COUNT_AND_HASH_FILTER_MAY_SCAN_FULL_SOURCE",
            "repeatability": "SAME_SEED_AND_UNCHANGED_SOURCE_ROWIDS_AND_VALUES",
            "selectionMeaning": "DETERMINISTIC_HASH_PRIORITY_NOT_STRATIFIED",
            "samplingWarnings": ["SOURCE_NOT_SNAPSHOT_PINNED", "HASH_SAMPLE_FULL_SCAN_COST"]}
    if not source_count:
        return [], {**base, "sampleCount": 0, "sampleLimitReached": False,
                    "sampleByteLimitReached": False, "sampleEstimatedBytes": 0,
                    "hashCandidateCount": 0, "sampleFractionAtCount": 0.0}
    cursor.execute(_render("ANALYSIS_SAMPLE_HASH", owner, table, names),
                   {"sampleSeed": seed, "hashThreshold": threshold})
    heap, total_bytes, candidate_count = [], 0, 0
    cutoff = None
    byte_eviction = False
    while True:
        batch = cursor.fetchmany(batch_size)
        if not batch:
            break
        for values in batch:
            rowid, hash_value, *data = values
            rowid = str(rowid)
            candidate_count += 1
            # SHA256 only breaks ORA_HASH collisions; raw row identifiers are not
            # included in result dictionaries or persisted diagnostics.
            priority = (int(hash_value) << 256) + int.from_bytes(hashlib.sha256(rowid.encode()).digest(), "big")
            if cutoff is not None and priority >= cutoff:
                continue
            if len(heap) == row_limit and priority >= -heap[0][0]:
                continue
            size = _row_bytes(data)
            heapq.heappush(heap, (-priority, rowid, size, dict(zip(names, data))))
            total_bytes += size
            while len(heap) > row_limit or total_bytes > byte_limit:
                byte_eviction = byte_eviction or total_bytes > byte_limit
                removed = heapq.heappop(heap)
                total_bytes -= removed[2]
                cutoff = min(cutoff, -removed[0]) if cutoff is not None else -removed[0]
    rows = [item[3] for item in sorted(heap, key=lambda item: -item[0])]
    byte_truncated = byte_eviction and len(rows) < min(row_limit, candidate_count)
    warnings = list(base["samplingWarnings"])
    if byte_truncated:
        warnings.append("HASH_SAMPLE_BYTE_TRUNCATED_NOT_REPRESENTATIVE")
    if candidate_count < min(row_limit, source_count):
        warnings.append("HASH_SAMPLE_UNDERFILLED")
    if candidate_count > source_count:
        warnings.append("SOURCE_COUNT_CHANGED_DURING_SAMPLING")
    return rows, {**base, "sampleCount": len(rows), "sampleLimitReached": len(rows) == row_limit,
                  "sampleByteLimitReached": byte_truncated, "sampleEstimatedBytes": total_bytes,
                  "hashCandidateCount": candidate_count,
                  "sampleFractionAtCount": len(rows) / source_count if len(rows) <= source_count else None,
                  "samplingWarnings": warnings}
