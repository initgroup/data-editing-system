"""Shared, read-only descriptive statistics for managed editing tables."""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
import logging
import math
import re
from typing import Any, Iterable

from fastapi import HTTPException

from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)

MAX_STATISTICS_COLUMNS = 100
DISTRIBUTION_BIN_COUNT = 12
TRACKING_COLUMN = "INIT$_SOURCE_ROWID"
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")

NUMERIC_DATA_TYPES = frozenset(
    {
        "BINARY_DOUBLE",
        "BINARY_FLOAT",
        "DEC",
        "DECIMAL",
        "DOUBLE PRECISION",
        "FLOAT",
        "INT",
        "INTEGER",
        "NUMBER",
        "NUMERIC",
        "REAL",
        "SMALLINT",
    }
)
CONVERTIBLE_TEXT_DATA_TYPES = frozenset({"CHAR", "NCHAR", "NVARCHAR2", "VARCHAR2"})
TEMPORAL_DATA_TYPES = frozenset({"DATE"})
METRIC_KEYS = (
    "totalRowCount",
    "valueCount",
    "nullCount",
    "sum",
    "mean",
    "variance",
    "stddev",
    "skewness",
    "kurtosis",
    "median",
    "min",
    "q1",
    "q3",
    "max",
    "distinctCount",
    "distinctRate",
    "minLength",
    "maxLength",
    "avgLength",
)
COUNT_METRIC_KEYS = frozenset({"totalRowCount", "valueCount", "nullCount", "distinctCount", "minLength", "maxLength"})
ROW_METRIC_MAP = {
    "totalRowCount": "TOTAL_ROW_COUNT",
    "valueCount": "VALUE_COUNT",
    "nullCount": "NULL_COUNT",
    "sum": "SUM_VALUE",
    "mean": "MEAN_VALUE",
    "variance": "VARIANCE_VALUE",
    "stddev": "STDDEV_VALUE",
    "skewness": "SKEWNESS_VALUE",
    "kurtosis": "KURTOSIS_VALUE",
    "median": "MEDIAN_VALUE",
    "min": "MIN_VALUE",
    "q1": "Q1_VALUE",
    "q3": "Q3_VALUE",
    "max": "MAX_VALUE",
    "distinctCount": "DISTINCT_COUNT",
    "distinctRate": "DISTINCT_RATE",
    "minLength": "MIN_LENGTH",
    "maxLength": "MAX_LENGTH",
    "avgLength": "AVG_LENGTH",
}


def _read_lob(value: Any) -> Any:
    if hasattr(value, "read") and callable(value.read):
        return value.read()
    return value


def _row_to_dict(columns: Iterable[str], row: Iterable[Any]) -> dict[str, Any]:
    return {name: _read_lob(value) for name, value in zip(columns, row)}


def _fetch_all(cursor, sql_id: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    cursor.execute(SqlLoader.get_sql(sql_id), params)
    columns = [item[0] for item in cursor.description or []]
    return [_row_to_dict(columns, row) for row in cursor.fetchall()]


def _normalize_identifier(value: Any, field_name: str) -> str:
    normalized = str(value or "").strip().upper()
    if not IDENTIFIER_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return normalized


def _normalize_optional_identifier(value: Any, field_name: str) -> str | None:
    if value is None or not str(value).strip():
        return None
    return _normalize_identifier(value, field_name)


def _quote_identifier(value: Any) -> str:
    return f'"{_normalize_identifier(value, "identifier")}"'


def _sql_literal(value: Any) -> str:
    normalized = _normalize_identifier(value, "column name")
    return "'" + normalized.replace("'", "''") + "'"


def parse_requested_columns(value: str | Iterable[str] | None) -> list[str] | None:
    if value is None:
        return None
    values = value.split(",") if isinstance(value, str) else list(value)
    normalized: list[str] = []
    for item in values:
        if item is None or not str(item).strip():
            continue
        column_name = _normalize_identifier(item, "statistics column")
        if column_name not in normalized:
            normalized.append(column_name)
    if not normalized:
        return None
    if len(normalized) > MAX_STATISTICS_COLUMNS:
        raise HTTPException(
            status_code=400,
            detail=f"At most {MAX_STATISTICS_COLUMNS} statistics columns may be requested.",
        )
    return normalized


def _json_number(value: Any, *, integer: bool = False) -> int | float | None:
    value = _read_lob(value)
    if value is None:
        return None
    try:
        if integer:
            return int(value)
        numeric = float(value) if isinstance(value, Decimal) else float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return numeric if math.isfinite(numeric) else None


def _empty_metrics() -> dict[str, int | float | None]:
    return {
        key: 0 if key in COUNT_METRIC_KEYS else None
        for key in METRIC_KEYS
    }


def _metrics_from_row(row: dict[str, Any] | None) -> dict[str, int | float | None]:
    if not row:
        return _empty_metrics()
    return {
        key: _json_number(row.get(db_key), integer=key in COUNT_METRIC_KEYS)
        for key, db_key in ROW_METRIC_MAP.items()
    }


def _safe_metrics(value: Any) -> dict[str, int | float | None] | None:
    if not isinstance(value, dict):
        return None
    result: dict[str, int | float | None] = {}
    for key in METRIC_KEYS:
        result[key] = _json_number(value.get(key), integer=key in COUNT_METRIC_KEYS)
    result["modeValue"] = str(value.get("modeValue"))[:500] if value.get("modeValue") is not None else None
    result["modeCount"] = _json_number(value.get("modeCount"), integer=True)
    result["minValueText"] = str(value.get("minValueText"))[:500] if value.get("minValueText") is not None else None
    result["maxValueText"] = str(value.get("maxValueText"))[:500] if value.get("maxValueText") is not None else None
    return result


def _safe_distribution(value: Any, *, has_after: bool) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    lower = _json_number(value.get("min"))
    upper = _json_number(value.get("max"))
    raw_bins = value.get("bins") if isinstance(value.get("bins"), list) else []
    if lower is None or upper is None or not raw_bins:
        return None
    bins: list[dict[str, Any]] = []
    for index, raw_bin in enumerate(raw_bins[:DISTRIBUTION_BIN_COUNT], start=1):
        if not isinstance(raw_bin, dict):
            continue
        bins.append(
            {
                "index": index,
                "lower": _json_number(raw_bin.get("lower")),
                "upper": _json_number(raw_bin.get("upper")),
                "beforeCount": int(_json_number(raw_bin.get("beforeCount"), integer=True) or 0),
                "afterCount": (
                    int(_json_number(raw_bin.get("afterCount"), integer=True) or 0)
                    if has_after
                    else None
                ),
            }
        )
    if not bins:
        return None
    return {
        "binCount": len(bins),
        "min": lower,
        "max": upper,
        "bins": bins,
    }


def _safe_top_values(value: Any, *, has_after: bool) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    rows: list[dict[str, Any]] = []
    for raw in value[:10]:
        if not isinstance(raw, dict):
            continue
        rows.append(
            {
                "value": str(raw.get("value") or "")[:500],
                "beforeCount": int(_json_number(raw.get("beforeCount"), integer=True) or 0),
                "afterCount": (
                    int(_json_number(raw.get("afterCount"), integer=True) or 0)
                    if has_after
                    else None
                ),
            }
        )
    return rows


def unavailable_statistics(
    reason_code: str,
    reason: str,
    *,
    basis: str = "UNAVAILABLE",
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "available": False,
        "basis": basis,
        "reasonCode": str(reason_code or "STATISTICS_UNAVAILABLE")[:100],
        "reason": str(reason or "Descriptive statistics are unavailable.")[:500],
        "before": None,
        "after": None,
        "columns": [],
        "truncated": False,
        "summary": {
            "columnCount": 0,
            "totalCandidateColumnCount": 0,
        },
        "context": deepcopy(context or {}),
    }


def _table_columns(cursor, owner: str, table: str) -> list[dict[str, Any]]:
    return _fetch_all(
        cursor,
        "MCOMMON_STATS_TABLE_COLUMNS",
        {"ownerName": owner, "tableName": table},
    )


def _physical_type(value: Any) -> str:
    return str(value or "").strip().upper()


def _is_supported_type(value: Any) -> bool:
    physical_type = _physical_type(value)
    return (
        physical_type in NUMERIC_DATA_TYPES | CONVERTIBLE_TEXT_DATA_TYPES | TEMPORAL_DATA_TYPES
        or physical_type.startswith("TIMESTAMP")
    )


def _is_numeric_type(value: Any) -> bool:
    return _physical_type(value) in NUMERIC_DATA_TYPES


def _is_temporal_type(value: Any) -> bool:
    physical_type = _physical_type(value)
    return physical_type in TEMPORAL_DATA_TYPES or physical_type.startswith("TIMESTAMP")


def _select_candidates(
    source_columns: list[dict[str, Any]],
    edit_columns: list[dict[str, Any]] | None,
    *,
    requested_columns: list[str] | None,
    preferred_columns: Iterable[str] | None,
) -> tuple[list[dict[str, Any]], int, bool]:
    edit_map = {
        str(row.get("COLUMN_NAME") or "").strip().upper(): row
        for row in edit_columns or []
        if row.get("COLUMN_NAME")
    }
    preferred = {
        _normalize_identifier(value, "preferred statistics column")
        for value in preferred_columns or []
        if value is not None and str(value).strip()
    }
    requested = set(requested_columns or [])
    all_source_names = {
        str(row.get("COLUMN_NAME") or "").strip().upper()
        for row in source_columns
        if row.get("COLUMN_NAME")
    }
    if requested:
        unknown = requested - all_source_names
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown statistics column: {sorted(unknown)[0]}",
            )

    candidates: list[dict[str, Any]] = []
    for source_row in source_columns:
        name = str(source_row.get("COLUMN_NAME") or "").strip().upper()
        if not name or name == TRACKING_COLUMN:
            continue
        if requested and name not in requested:
            continue
        edit_row = edit_map.get(name) if edit_columns is not None else None
        if edit_columns is not None and not edit_row:
            continue
        if not _is_supported_type(source_row.get("DATA_TYPE")):
            continue
        if edit_row and not _is_supported_type(edit_row.get("DATA_TYPE")):
            continue

        source_group = str(source_row.get("TYPE_GROUP_CODE") or "").strip().upper()
        edit_group = str((edit_row or {}).get("TYPE_GROUP_CODE") or "").strip().upper()
        effective_group = edit_group or source_group
        profile_continuous = effective_group == "CONTINUOUS"
        profile_categorical = effective_group == "CATEGORICAL"
        symbolic_target = name in preferred
        numeric_fallback = _is_numeric_type(source_row.get("DATA_TYPE")) and (
            not edit_row or _is_numeric_type(edit_row.get("DATA_TYPE"))
        )
        has_non_continuous_profile = any(
            group and group != "CONTINUOUS"
            for group in (source_group, edit_group)
        )
        if profile_continuous:
            rank = 0
            basis = "PROFILE_CONTINUOUS"
            profile_kind = "NUMERIC"
        elif profile_categorical:
            rank = 1
            basis = "PROFILE_CATEGORICAL"
            profile_kind = "CATEGORICAL"
        elif symbolic_target:
            rank = 2
            basis = "SYMBOLIC_TARGET"
            profile_kind = "NUMERIC"
        elif numeric_fallback and not has_non_continuous_profile:
            rank = 3
            basis = "PHYSICAL_NUMERIC"
            profile_kind = "NUMERIC"
        elif _is_temporal_type(source_row.get("DATA_TYPE")):
            rank = 4
            basis = "PHYSICAL_TEMPORAL"
            profile_kind = "TEMPORAL"
        else:
            rank = 5
            basis = "PHYSICAL_CATEGORICAL"
            profile_kind = "CATEGORICAL"
        candidates.append(
            {
                "COLUMN_NAME": name,
                "COLUMN_COMMENT": str(source_row.get("COLUMN_COMMENT") or "")[:500],
                "DATA_TYPE": _physical_type(source_row.get("DATA_TYPE")),
                "EDIT_DATA_TYPE": _physical_type((edit_row or {}).get("DATA_TYPE")),
                "COLUMN_ID": int(source_row.get("COLUMN_ID") or 0),
                "SELECTION_BASIS": basis,
                "PROFILE_KIND": profile_kind,
                "TYPE_GROUP_CODE": effective_group or "OTHER",
                "RANK": rank,
            }
        )

    candidates.sort(key=lambda row: (row["RANK"], row["COLUMN_ID"], row["COLUMN_NAME"]))
    total = len(candidates)
    selected = candidates[:MAX_STATISTICS_COLUMNS]
    return selected, total, total > len(selected)


def _numeric_expression(column_name: str, data_type: str) -> str:
    reference = f"T.{_quote_identifier(column_name)}"
    physical_type = _physical_type(data_type)
    if _is_numeric_type(physical_type) and physical_type not in {
        "BINARY_DOUBLE",
        "BINARY_FLOAT",
    }:
        return f"CAST({reference} AS NUMBER)"
    return (
        f"TO_NUMBER(NULLIF(TRIM(TO_CHAR({reference})), '') "
        "DEFAULT NULL ON CONVERSION ERROR)"
    )


def _render_aggregate_sql(owner: str, table: str, columns: list[dict[str, Any]]) -> str:
    if not columns:
        raise HTTPException(status_code=400, detail="At least one statistics column is required.")
    dynamic_columns = "\n         , ".join(
        f"{_numeric_expression(row['COLUMN_NAME'], row['DATA_TYPE'])} "
        f"AS {_quote_identifier(row['COLUMN_NAME'])}"
        for row in columns
    )
    dynamic_unpivot = "\n         , ".join(
        f"{_quote_identifier(row['COLUMN_NAME'])} AS {_sql_literal(row['COLUMN_NAME'])}"
        for row in columns
    )
    table_reference = f"{_quote_identifier(owner)}.{_quote_identifier(table)}"
    return (
        SqlLoader.get_sql("MCOMMON_STATS_AGGREGATE")
        .replace("/* --DYNAMIC_COLUMNS-- */", dynamic_columns)
        .replace("/* --DYNAMIC_TABLE-- */", table_reference)
        .replace("/* --DYNAMIC_UNPIVOT-- */", dynamic_unpivot)
    )


def _aggregate_table(
    cursor,
    owner: str,
    table: str,
    columns: list[dict[str, Any]],
    *,
    use_edit_types: bool = False,
) -> dict[str, dict[str, int | float | None]]:
    aggregate_columns = [
        {
            **row,
            "DATA_TYPE": row.get("EDIT_DATA_TYPE") or row.get("DATA_TYPE")
            if use_edit_types
            else row.get("DATA_TYPE"),
        }
        for row in columns
    ]
    sql = _render_aggregate_sql(owner, table, aggregate_columns)
    try:
        cursor.execute(sql)
        result_columns = [item[0] for item in cursor.description or []]
        rows = [_row_to_dict(result_columns, row) for row in cursor.fetchall()]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Descriptive statistics query failed. owner=%s table=%s column_count=%s",
            owner,
            table,
            len(columns),
        )
        raise HTTPException(
            status_code=500,
            detail="Descriptive statistics could not be calculated for the managed table.",
        ) from exc
    row_map = {
        str(row.get("COLUMN_NAME") or "").strip().upper(): row
        for row in rows
        if row.get("COLUMN_NAME")
    }
    return {
        column["COLUMN_NAME"]: _metrics_from_row(row_map.get(column["COLUMN_NAME"]))
        for column in columns
    }


def _text_expression(column_name: str, data_type: str) -> str:
    reference = f"T.{_quote_identifier(column_name)}"
    physical_type = _physical_type(data_type)
    if physical_type == "DATE":
        return f"TO_CHAR({reference}, 'YYYY-MM-DD HH24:MI:SS')"
    if physical_type.startswith("TIMESTAMP"):
        return f"TO_CHAR({reference}, 'YYYY-MM-DD HH24:MI:SS.FF6')"
    return f"NULLIF(TRIM(TO_CHAR({reference})), '')"


def _render_general_sql(
    sql_id: str,
    owner: str,
    table: str,
    columns: list[dict[str, Any]],
    *,
    use_edit_types: bool = False,
) -> str:
    if not columns:
        raise HTTPException(status_code=400, detail="At least one general statistics column is required.")
    resolved_columns = [
        {
            **row,
            "RESOLVED_DATA_TYPE": (
                row.get("EDIT_DATA_TYPE") or row.get("DATA_TYPE")
                if use_edit_types
                else row.get("DATA_TYPE")
            ),
        }
        for row in columns
    ]
    dynamic_columns = "\n         , ".join(
        f"{_text_expression(row['COLUMN_NAME'], row['RESOLVED_DATA_TYPE'])} "
        f"AS {_quote_identifier(row['COLUMN_NAME'])}"
        for row in resolved_columns
    )
    dynamic_unpivot = "\n         , ".join(
        f"{_quote_identifier(row['COLUMN_NAME'])} AS {_sql_literal(row['COLUMN_NAME'])}"
        for row in resolved_columns
    )
    table_reference = f"{_quote_identifier(owner)}.{_quote_identifier(table)}"
    return (
        SqlLoader.get_sql(sql_id)
        .replace("/* --DYNAMIC_COLUMNS-- */", dynamic_columns)
        .replace("/* --DYNAMIC_TABLE-- */", table_reference)
        .replace("/* --DYNAMIC_UNPIVOT-- */", dynamic_unpivot)
    )


def _aggregate_general_table(
    cursor,
    owner: str,
    table: str,
    columns: list[dict[str, Any]],
    *,
    use_edit_types: bool = False,
) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    if not columns:
        return {}, {}
    try:
        cursor.execute(
            _render_general_sql(
                "MCOMMON_STATS_GENERAL_AGGREGATE",
                owner,
                table,
                columns,
                use_edit_types=use_edit_types,
            )
        )
        result_columns = [item[0] for item in cursor.description or []]
        aggregate_rows = [_row_to_dict(result_columns, row) for row in cursor.fetchall()]
        cursor.execute(
            _render_general_sql(
                "MCOMMON_STATS_TOP_VALUES",
                owner,
                table,
                columns,
                use_edit_types=use_edit_types,
            )
        )
        result_columns = [item[0] for item in cursor.description or []]
        top_rows = [_row_to_dict(result_columns, row) for row in cursor.fetchall()]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "General descriptive statistics query failed. owner=%s table=%s column_count=%s",
            owner,
            table,
            len(columns),
        )
        raise HTTPException(
            status_code=500,
            detail="General descriptive statistics could not be calculated for the managed table.",
        ) from exc
    top_values: dict[str, list[dict[str, Any]]] = {}
    for row in top_rows:
        name = str(row.get("COLUMN_NAME") or "").strip().upper()
        if not name:
            continue
        top_values.setdefault(name, []).append(
            {
                "value": str(_read_lob(row.get("TEXT_VALUE")) or "")[:500],
                "count": int(_json_number(row.get("VALUE_COUNT"), integer=True) or 0),
                "rank": int(_json_number(row.get("VALUE_RANK"), integer=True) or 0),
            }
        )
    row_map = {
        str(row.get("COLUMN_NAME") or "").strip().upper(): row
        for row in aggregate_rows
        if row.get("COLUMN_NAME")
    }
    metrics: dict[str, dict[str, Any]] = {}
    for column in columns:
        name = column["COLUMN_NAME"]
        row = row_map.get(name) or {}
        values = top_values.get(name) or []
        metric = _empty_metrics()
        metric.update(
            {
                "totalRowCount": _json_number(row.get("TOTAL_ROW_COUNT"), integer=True) or 0,
                "valueCount": _json_number(row.get("VALUE_COUNT"), integer=True) or 0,
                "nullCount": _json_number(row.get("NULL_COUNT"), integer=True) or 0,
                "distinctCount": _json_number(row.get("DISTINCT_COUNT"), integer=True) or 0,
                "distinctRate": _json_number(row.get("DISTINCT_RATE")),
                "minLength": _json_number(row.get("MIN_LENGTH"), integer=True),
                "maxLength": _json_number(row.get("MAX_LENGTH"), integer=True),
                "avgLength": _json_number(row.get("AVG_LENGTH")),
                "minValueText": str(_read_lob(row.get("MIN_TEXT_VALUE")) or "")[:500] or None,
                "maxValueText": str(_read_lob(row.get("MAX_TEXT_VALUE")) or "")[:500] or None,
                "modeValue": values[0]["value"] if values else None,
                "modeCount": values[0]["count"] if values else None,
            }
        )
        metrics[name] = metric
    return metrics, top_values


def _merge_top_values(
    before_values: list[dict[str, Any]] | None,
    after_values: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for item in before_values or []:
        value = str(item.get("value") or "")
        merged.setdefault(value, {"value": value, "beforeCount": 0, "afterCount": None})
        merged[value]["beforeCount"] = int(item.get("count") or 0)
    for item in after_values or []:
        value = str(item.get("value") or "")
        merged.setdefault(value, {"value": value, "beforeCount": 0, "afterCount": 0})
        merged[value]["afterCount"] = int(item.get("count") or 0)
    return sorted(
        merged.values(),
        key=lambda item: (
            -max(int(item.get("beforeCount") or 0), int(item.get("afterCount") or 0)),
            str(item.get("value") or ""),
        ),
    )[:10]


def _distribution_bounds(
    columns: list[dict[str, Any]],
    before_metrics: dict[str, dict[str, int | float | None]],
    after_metrics: dict[str, dict[str, int | float | None]],
) -> dict[str, tuple[float, float]]:
    bounds: dict[str, tuple[float, float]] = {}
    for column in columns:
        name = column["COLUMN_NAME"]
        metric_sets = [before_metrics.get(name) or {}, after_metrics.get(name) or {}]
        minimums = [_json_number(metrics.get("min")) for metrics in metric_sets]
        maximums = [_json_number(metrics.get("max")) for metrics in metric_sets]
        valid_minimums = [float(value) for value in minimums if value is not None]
        valid_maximums = [float(value) for value in maximums if value is not None]
        if not valid_minimums or not valid_maximums:
            continue
        lower = min(valid_minimums)
        upper = max(valid_maximums)
        if math.isfinite(lower) and math.isfinite(upper):
            bounds[name] = (lower, upper)
    return bounds


def _render_distribution_sql(
    owner: str,
    table: str,
    columns: list[dict[str, Any]],
    bounds: dict[str, tuple[float, float]],
    *,
    use_edit_types: bool = False,
) -> tuple[str, dict[str, Any]]:
    selected = [row for row in columns if row["COLUMN_NAME"] in bounds]
    if not selected:
        raise HTTPException(status_code=400, detail="At least one distribution column is required.")
    aggregate_columns = [
        {
            **row,
            "DATA_TYPE": (
                row.get("EDIT_DATA_TYPE") or row.get("DATA_TYPE")
                if use_edit_types
                else row.get("DATA_TYPE")
            ),
        }
        for row in selected
    ]
    params: dict[str, Any] = {"binCount": DISTRIBUTION_BIN_COUNT}
    bound_rows: list[str] = []
    for index, row in enumerate(selected):
        name = row["COLUMN_NAME"]
        lower, upper = bounds[name]
        params[f"columnName{index}"] = name
        params[f"minimumValue{index}"] = lower
        params[f"maximumValue{index}"] = upper
        bound_rows.append(
            "SELECT :columnName{0} AS COLUMN_NAME\n"
            "     , :minimumValue{0} AS MIN_VALUE\n"
            "     , :maximumValue{0} AS MAX_VALUE\n"
            "  FROM DUAL".format(index)
        )
    dynamic_columns = "\n         , ".join(
        f"{_numeric_expression(row['COLUMN_NAME'], row['DATA_TYPE'])} "
        f"AS {_quote_identifier(row['COLUMN_NAME'])}"
        for row in aggregate_columns
    )
    dynamic_unpivot = "\n         , ".join(
        f"{_quote_identifier(row['COLUMN_NAME'])} AS {_sql_literal(row['COLUMN_NAME'])}"
        for row in aggregate_columns
    )
    table_reference = f"{_quote_identifier(owner)}.{_quote_identifier(table)}"
    sql = (
        SqlLoader.get_sql("MCOMMON_STATS_DISTRIBUTION")
        .replace("/* --DYNAMIC_BOUNDS-- */", "\n    UNION ALL\n    ".join(bound_rows))
        .replace("/* --DYNAMIC_COLUMNS-- */", dynamic_columns)
        .replace("/* --DYNAMIC_TABLE-- */", table_reference)
        .replace("/* --DYNAMIC_UNPIVOT-- */", dynamic_unpivot)
    )
    return sql, params


def _aggregate_distribution(
    cursor,
    owner: str,
    table: str,
    columns: list[dict[str, Any]],
    bounds: dict[str, tuple[float, float]],
    *,
    use_edit_types: bool = False,
) -> dict[str, list[int]]:
    if not bounds:
        return {}
    try:
        sql, params = _render_distribution_sql(
            owner,
            table,
            columns,
            bounds,
            use_edit_types=use_edit_types,
        )
        cursor.execute(sql, params)
        result_columns = [item[0] for item in cursor.description or []]
        rows = [_row_to_dict(result_columns, row) for row in cursor.fetchall()]
    except Exception as exc:
        # Distribution is an explanatory enhancement. The required aggregate
        # statistics remain usable if an older Target DB has not reloaded the
        # new read-only SQL template yet.
        logger.info("Descriptive distribution query skipped: %s", exc)
        return {}
    result = {
        name: [0 for _ in range(DISTRIBUTION_BIN_COUNT)]
        for name in bounds
    }
    for row in rows:
        name = str(row.get("COLUMN_NAME") or "").strip().upper()
        bucket_no = int(_json_number(row.get("BUCKET_NO"), integer=True) or 0)
        if name in result and 1 <= bucket_no <= DISTRIBUTION_BIN_COUNT:
            result[name][bucket_no - 1] = int(
                _json_number(row.get("BUCKET_COUNT"), integer=True) or 0
            )
    return result


def _distribution_payload(
    bounds: tuple[float, float] | None,
    before_counts: list[int] | None,
    after_counts: list[int] | None,
) -> dict[str, Any] | None:
    if not bounds or not before_counts:
        return None
    lower, upper = bounds
    width = (upper - lower) / DISTRIBUTION_BIN_COUNT if upper != lower else 0.0
    bins = []
    for index in range(DISTRIBUTION_BIN_COUNT):
        bin_lower = lower + width * index if width else lower
        bin_upper = lower + width * (index + 1) if width else upper
        bins.append(
            {
                "index": index + 1,
                "lower": bin_lower,
                "upper": bin_upper,
                "beforeCount": int(before_counts[index] if index < len(before_counts) else 0),
                "afterCount": (
                    int(after_counts[index] if after_counts and index < len(after_counts) else 0)
                    if after_counts is not None
                    else None
                ),
            }
        )
    return {
        "binCount": DISTRIBUTION_BIN_COUNT,
        "min": lower,
        "max": upper,
        "bins": bins,
    }


def _delta_metrics(
    before: dict[str, int | float | None],
    after: dict[str, int | float | None],
) -> dict[str, int | float | None]:
    result: dict[str, int | float | None] = {}
    for key in METRIC_KEYS:
        before_value = before.get(key)
        after_value = after.get(key)
        if before_value is None or after_value is None:
            result[key] = None
        elif key in COUNT_METRIC_KEYS:
            result[key] = int(after_value) - int(before_value)
        else:
            result[key] = float(after_value) - float(before_value)
    before_variance = before.get("variance")
    after_variance = after.get("variance")
    if before_variance is None or after_variance is None:
        reduction_rate = None
        direction = "UNAVAILABLE"
    else:
        before_value = float(before_variance)
        after_value = float(after_variance)
        tolerance = max(1e-12, abs(before_value) * 1e-9)
        if abs(after_value - before_value) <= tolerance:
            direction = "UNCHANGED"
        elif after_value < before_value:
            direction = "DECREASED"
        else:
            direction = "INCREASED"
        if before_value == 0:
            reduction_rate = 0.0 if after_value == 0 else None
        else:
            reduction_rate = (before_value - after_value) / abs(before_value)
    result["varianceReductionRate"] = reduction_rate
    result["varianceDirection"] = direction
    return result


def load_violation_column_insights(
    cursor,
    *,
    target_owner: str,
    target_table: str,
    run_source_type: str | None,
    run_id: Any,
) -> list[dict[str, Any]]:
    source_type = str(run_source_type or "").strip().upper()
    try:
        normalized_run_id = int(run_id)
    except (TypeError, ValueError):
        return []
    if source_type not in {"DATA_WORK", "FLOW_WORK"} or normalized_run_id <= 0:
        return []
    try:
        return _fetch_all(
            cursor,
            "MCOMMON_STATS_VIOLATION_COLUMNS",
            {
                "runSourceType": source_type,
                "runId": normalized_run_id,
                "targetOwner": _normalize_identifier(target_owner, "violation target owner"),
                "targetTable": _normalize_identifier(target_table, "violation target table"),
            },
        )
    except Exception as exc:
        logger.info("Descriptive-statistics violation insight query skipped: %s", exc)
        return []


def attach_column_insights(
    statistics: dict[str, Any],
    violation_rows: Iterable[dict[str, Any]] | None,
) -> dict[str, Any]:
    columns = statistics.get("columns") if isinstance(statistics.get("columns"), list) else []
    statistics_by_name = {
        str(column.get("columnName") or "").strip().upper(): column
        for column in columns
        if isinstance(column, dict) and column.get("columnName")
    }
    violations_by_name = {
        str(row.get("COLUMN_NAME") or "").strip().upper(): row
        for row in (violation_rows or [])
        if isinstance(row, dict) and row.get("COLUMN_NAME")
    }
    maximum_violation_count = max(
        [int(_json_number(row.get("VIOLATION_COUNT"), integer=True) or 0) for row in violations_by_name.values()],
        default=0,
    )
    names = list(statistics_by_name)
    names.extend(name for name in violations_by_name if name not in statistics_by_name)
    ranked: list[dict[str, Any]] = []

    for column_name in names:
        column = statistics_by_name.get(column_name)
        violation = violations_by_name.get(column_name, {})
        before = column.get("before") if isinstance(column, dict) and isinstance(column.get("before"), dict) else {}
        after = column.get("after") if isinstance(column, dict) and isinstance(column.get("after"), dict) else {}
        totals = [
            float(value)
            for value in (
                _json_number(before.get("totalRowCount")),
                _json_number(after.get("totalRowCount")),
            )
            if value is not None and float(value) > 0
        ]
        missing_rates = []
        for metrics in (before, after):
            total = _json_number(metrics.get("totalRowCount"))
            missing = _json_number(metrics.get("nullCount"))
            if total is not None and float(total) > 0 and missing is not None:
                missing_rates.append(max(0.0, float(missing) / float(total)))
        missing_rate = max(missing_rates, default=0.0)

        before_variance = _json_number(before.get("variance"))
        after_variance = _json_number(after.get("variance"))
        variance_change_rate = None
        if before_variance is not None and after_variance is not None:
            variance_denominator = max(abs(float(before_variance)), 1e-12)
            variance_change_rate = abs(float(after_variance) - float(before_variance)) / variance_denominator

        before_distinct_rate = _json_number(before.get("distinctRate"))
        after_distinct_rate = _json_number(after.get("distinctRate"))
        distinct_rate_change = None
        if before_distinct_rate is not None and after_distinct_rate is not None:
            distinct_rate_change = abs(float(after_distinct_rate) - float(before_distinct_rate))

        before_mean = _json_number(before.get("mean"))
        after_mean = _json_number(after.get("mean"))
        before_stddev = _json_number(before.get("stddev"))
        mean_shift_std = None
        if before_mean is not None and after_mean is not None:
            mean_shift_std = abs(float(after_mean) - float(before_mean)) / max(abs(float(before_stddev or 0)), 1e-12)

        range_shift_rate = None
        before_min = _json_number(before.get("min"))
        before_max = _json_number(before.get("max"))
        after_min = _json_number(after.get("min"))
        after_max = _json_number(after.get("max"))
        if None not in {before_min, before_max, after_min, after_max}:
            range_denominator = max(
                abs(float(before_max) - float(before_min)),
                abs(float(after_max) - float(after_min)),
                1e-12,
            )
            range_shift_rate = (
                abs(float(after_min) - float(before_min))
                + abs(float(after_max) - float(before_max))
            ) / (2 * range_denominator)

        violation_count = int(_json_number(violation.get("VIOLATION_COUNT"), integer=True) or 0)
        violated_row_count = int(_json_number(violation.get("VIOLATED_ROW_COUNT"), integer=True) or 0)
        rule_count = int(_json_number(violation.get("RULE_COUNT"), integer=True) or 0)
        categorical_count = int(_json_number(violation.get("CATEGORICAL_VIOLATION_COUNT"), integer=True) or 0)
        continuous_count = int(_json_number(violation.get("CONTINUOUS_VIOLATION_COUNT"), integer=True) or 0)
        violation_component = (
            55.0 * math.log1p(violation_count) / math.log1p(maximum_violation_count)
            if violation_count > 0 and maximum_violation_count > 0
            else 0.0
        )
        missing_component = 15.0 * min(1.0, missing_rate / 0.2)
        variance_component = 15.0 * min(1.0, variance_change_rate if variance_change_rate is not None else (distinct_rate_change or 0.0) * 5)
        mean_component = 10.0 * min(1.0, (mean_shift_std or 0.0) / 2.0)
        range_component = 5.0 * min(1.0, range_shift_rate or 0.0)
        importance_score = round(
            violation_component
            + missing_component
            + variance_component
            + mean_component
            + range_component,
            1,
        )
        priority_level = "HIGH" if importance_score >= 50 else ("MEDIUM" if importance_score >= 25 else "LOW")
        reasons: list[str] = []
        if violation_count:
            reasons.append(f"규칙 위반 {violation_count:,}건")
        if missing_rate >= 0.01:
            reasons.append(f"결측률 {missing_rate * 100:.1f}%")
        if variance_change_rate is not None and variance_change_rate >= 0.1:
            reasons.append(f"분산 변화 {variance_change_rate * 100:.1f}%")
        if variance_change_rate is None and distinct_rate_change is not None and distinct_rate_change >= 0.02:
            reasons.append(f"고유값 비율 변화 {distinct_rate_change * 100:.1f}%p")
        if mean_shift_std is not None and mean_shift_std >= 0.25:
            reasons.append(f"평균 이동 {mean_shift_std:.2f}σ")
        if range_shift_rate is not None and range_shift_rate >= 0.1:
            reasons.append(f"범위 이동 {range_shift_rate * 100:.1f}%")
        if not reasons:
            reasons.append("큰 변화 없음")

        insight = {
            "columnName": column_name,
            "columnComment": str((column or {}).get("columnComment") or violation.get("COLUMN_COMMENT") or ""),
            "dataType": str((column or {}).get("dataType") or violation.get("DATA_TYPE") or ""),
            "hasStatistics": bool(column),
            "importanceScore": importance_score,
            "priorityLevel": priority_level,
            "priorityReasons": reasons,
            "violationCount": violation_count,
            "violatedRowCount": violated_row_count,
            "ruleCount": rule_count,
            "categoricalViolationCount": categorical_count,
            "continuousViolationCount": continuous_count,
            "missingRate": missing_rate,
            "varianceChangeRate": variance_change_rate,
            "distinctRateChange": distinct_rate_change,
            "meanShiftStd": mean_shift_std,
            "rangeShiftRate": range_shift_rate,
            "totalRowCount": int(max(totals, default=0)),
        }
        ranked.append(insight)
        if column is not None:
            column["insight"] = deepcopy(insight)

    ranked.sort(
        key=lambda item: (
            -float(item.get("importanceScore") or 0),
            -int(item.get("violationCount") or 0),
            str(item.get("columnName") or ""),
        )
    )
    for index, item in enumerate(ranked, start=1):
        item["importanceRank"] = index
        column = statistics_by_name.get(str(item.get("columnName") or ""))
        if column and isinstance(column.get("insight"), dict):
            column["insight"]["importanceRank"] = index
    statistics["insights"] = {
        "rankedColumns": ranked,
        "summary": {
            "columnCount": len(ranked),
            "highPriorityColumnCount": sum(item["priorityLevel"] == "HIGH" for item in ranked),
            "mediumPriorityColumnCount": sum(item["priorityLevel"] == "MEDIUM" for item in ranked),
            "violationColumnCount": sum(int(item["violationCount"] or 0) > 0 for item in ranked),
            "totalViolationCount": sum(int(item["violationCount"] or 0) for item in ranked),
            "comparisonAvailable": bool(statistics.get("after")),
        },
        "methodology": {
            "violationWeight": 55,
            "missingWeight": 15,
            "varianceWeight": 15,
            "meanShiftWeight": 10,
            "rangeShiftWeight": 5,
        },
    }
    return statistics


def build_statistics(
    cursor,
    *,
    before_owner: str,
    before_table: str,
    after_owner: str | None = None,
    after_table: str | None = None,
    requested_columns: str | Iterable[str] | None = None,
    preferred_columns: Iterable[str] | None = None,
    context: dict[str, Any] | None = None,
    basis: str | None = None,
) -> dict[str, Any]:
    normalized_before_owner = _normalize_identifier(before_owner, "statistics owner")
    normalized_before_table = _normalize_identifier(before_table, "statistics table")
    normalized_after_owner = _normalize_optional_identifier(after_owner, "statistics comparison owner")
    normalized_after_table = _normalize_optional_identifier(after_table, "statistics comparison table")
    if bool(normalized_after_owner) != bool(normalized_after_table):
        raise HTTPException(status_code=409, detail="The comparison table mapping is incomplete.")
    selected_columns = parse_requested_columns(requested_columns)
    before_columns = _table_columns(cursor, normalized_before_owner, normalized_before_table)
    if not before_columns:
        raise HTTPException(status_code=404, detail="The managed statistics table was not found.")
    after_columns = (
        _table_columns(cursor, normalized_after_owner, normalized_after_table)
        if normalized_after_owner and normalized_after_table
        else None
    )
    if after_columns is not None and not after_columns:
        raise HTTPException(status_code=404, detail="The managed comparison table was not found.")
    candidates, total_candidates, truncated = _select_candidates(
        before_columns,
        after_columns,
        requested_columns=selected_columns,
        preferred_columns=preferred_columns,
    )
    has_after = bool(normalized_after_owner and normalized_after_table)
    result_basis = str(basis or ("BEFORE_AFTER" if has_after else "SINGLE")).strip().upper()
    before_source = {
        "owner": normalized_before_owner,
        "table": normalized_before_table,
        "label": "수정 전" if has_after else "현재 데이터",
    }
    after_source = (
        {
            "owner": normalized_after_owner,
            "table": normalized_after_table,
            "label": "수정 후",
        }
        if has_after
        else None
    )
    if not candidates:
        return {
            "available": True,
            "basis": result_basis,
            "before": before_source,
            "after": after_source,
            "columns": [],
            "truncated": truncated,
            "summary": {
                "columnCount": 0,
                "totalCandidateColumnCount": total_candidates,
                "sourceTotalRowCount": 0,
                "editTotalRowCount": 0 if has_after else None,
                "varianceDecreasedColumnCount": 0,
                "varianceIncreasedColumnCount": 0,
                "varianceUnchangedColumnCount": 0,
            },
            "methodology": {
                "classificationPriority": "COLUMN_TYPE_ANALYSIS_THEN_PHYSICAL_TYPE",
                "variance": "POPULATION",
                "standardDeviation": "POPULATION",
                "kurtosis": "EXCESS",
                "numericConversionFailure": "NULL",
                "categorical": "DISTINCT_MODE_TOP10_LENGTH",
                "temporal": "DISTINCT_EARLIEST_LATEST",
                "maxColumns": MAX_STATISTICS_COLUMNS,
            },
            "context": deepcopy(context or {}),
        }

    numeric_candidates = [row for row in candidates if row.get("PROFILE_KIND") == "NUMERIC"]
    general_candidates = [row for row in candidates if row.get("PROFILE_KIND") != "NUMERIC"]
    before_metrics = (
        _aggregate_table(
            cursor,
            normalized_before_owner,
            normalized_before_table,
            numeric_candidates,
        )
        if numeric_candidates
        else {}
    )
    before_general_metrics, before_top_values = _aggregate_general_table(
        cursor,
        normalized_before_owner,
        normalized_before_table,
        general_candidates,
    )
    before_metrics.update(before_general_metrics)
    after_metrics: dict[str, dict[str, Any]] = {}
    after_top_values: dict[str, list[dict[str, Any]]] = {}
    if normalized_after_owner and normalized_after_table:
        if numeric_candidates:
            after_metrics.update(
                _aggregate_table(
                    cursor,
                    normalized_after_owner,
                    normalized_after_table,
                    numeric_candidates,
                    use_edit_types=True,
                )
            )
        after_general_metrics, after_top_values = _aggregate_general_table(
            cursor,
            normalized_after_owner,
            normalized_after_table,
            general_candidates,
            use_edit_types=True,
        )
        after_metrics.update(after_general_metrics)
    distribution_bounds = _distribution_bounds(numeric_candidates, before_metrics, after_metrics)
    before_distributions = _aggregate_distribution(
        cursor,
        normalized_before_owner,
        normalized_before_table,
        numeric_candidates,
        distribution_bounds,
    )
    after_distributions = (
        _aggregate_distribution(
            cursor,
            normalized_after_owner,
            normalized_after_table,
            numeric_candidates,
            distribution_bounds,
            use_edit_types=True,
        )
        if has_after
        else {}
    )
    columns: list[dict[str, Any]] = []
    directions = {"DECREASED": 0, "INCREASED": 0, "UNCHANGED": 0}
    for candidate in candidates:
        name = candidate["COLUMN_NAME"]
        before = before_metrics.get(name) or _empty_metrics()
        after = after_metrics.get(name) if has_after else None
        delta = _delta_metrics(before, after) if after else None
        if delta and delta.get("varianceDirection") in directions:
            directions[str(delta["varianceDirection"])] += 1
        columns.append(
            {
                "columnName": name,
                "columnComment": candidate.get("COLUMN_COMMENT") or "",
                "dataType": candidate.get("DATA_TYPE") or "",
                "selectionBasis": candidate.get("SELECTION_BASIS"),
                "profileKind": candidate.get("PROFILE_KIND") or "NUMERIC",
                "typeGroupCode": candidate.get("TYPE_GROUP_CODE") or "OTHER",
                "before": before,
                "after": after,
                "delta": delta,
                "distribution": _distribution_payload(
                    distribution_bounds.get(name),
                    before_distributions.get(name),
                    after_distributions.get(name) if has_after else None,
                ),
                "topValues": (
                    _merge_top_values(
                        before_top_values.get(name),
                        after_top_values.get(name) if has_after else None,
                    )
                    if candidate.get("PROFILE_KIND") != "NUMERIC"
                    else []
                ),
            }
        )

    return {
        "available": True,
        "basis": result_basis,
        "before": before_source,
        "after": after_source,
        "columns": columns,
        "truncated": truncated,
        "summary": {
            "columnCount": len(columns),
            "totalCandidateColumnCount": total_candidates,
            "sourceTotalRowCount": columns[0]["before"].get("totalRowCount") if columns else 0,
            "editTotalRowCount": (
                columns[0]["after"].get("totalRowCount")
                if columns and columns[0].get("after")
                else None
            ),
            "varianceDecreasedColumnCount": directions["DECREASED"],
            "varianceIncreasedColumnCount": directions["INCREASED"],
            "varianceUnchangedColumnCount": directions["UNCHANGED"],
            "numericColumnCount": len(numeric_candidates),
            "categoricalColumnCount": sum(row.get("PROFILE_KIND") == "CATEGORICAL" for row in candidates),
            "temporalColumnCount": sum(row.get("PROFILE_KIND") == "TEMPORAL" for row in candidates),
        },
        "methodology": {
            "classificationPriority": "COLUMN_TYPE_ANALYSIS_THEN_PHYSICAL_TYPE",
            "variance": "POPULATION",
            "standardDeviation": "POPULATION",
            "kurtosis": "EXCESS",
            "numericConversionFailure": "NULL",
            "categorical": "DISTINCT_MODE_TOP10_LENGTH",
            "temporal": "DISTINCT_EARLIEST_LATEST",
            "maxColumns": MAX_STATISTICS_COLUMNS,
        },
        "context": deepcopy(context or {}),
    }


def preferred_edit_session_columns(cursor, edit_session_id: int) -> list[str]:
    return [
        str(row.get("COLUMN_NAME") or "").strip().upper()
        for row in _fetch_all(
            cursor,
            "MCOMMON_STATS_EDIT_CONTINUOUS_COLUMNS",
            {"editSessionId": int(edit_session_id)},
        )
        if row.get("COLUMN_NAME")
    ]


def build_edit_session_statistics(
    cursor,
    session: dict[str, Any],
    *,
    mapping: dict[str, Any] | None = None,
    requested_columns: str | Iterable[str] | None = None,
    basis: str = "BEFORE_AFTER",
) -> dict[str, Any]:
    edit_session_id = int(session.get("EDIT_SESSION_ID") or 0)
    table_mapping = mapping or {}
    source_owner = str(table_mapping.get("SOURCE_OWNER") or session.get("TARGET_OWNER") or "")
    source_table = str(table_mapping.get("SOURCE_TABLE") or session.get("SOURCE_TABLE") or "")
    edit_table = str(table_mapping.get("EDIT_TABLE") or session.get("EDIT_TABLE") or "").strip()
    edit_owner = (
        str(table_mapping.get("EDIT_OWNER") or session.get("TARGET_OWNER") or "").strip()
        if edit_table
        else None
    )
    context = {
        "projectId": session.get("PROJECT_ID"),
        "scenarioId": session.get("SCENARIO_ID"),
        "editSessionId": edit_session_id,
        "sessionStatus": session.get("SESSION_STATUS"),
    }
    preferred_columns = preferred_edit_session_columns(cursor, edit_session_id)
    try:
        result = build_statistics(
            cursor,
            before_owner=source_owner,
            before_table=source_table,
            after_owner=edit_owner,
            after_table=edit_table or None,
            requested_columns=requested_columns,
            preferred_columns=preferred_columns,
            basis=basis if edit_table else "SINGLE",
            context=context,
        )
        if not edit_table:
            result["notice"] = (
                "INITDN$ 수정 테이블 정보가 없어 INITUP$ 원본 데이터만 분석했습니다. "
                "비교 화면 구조는 유지되며 수정 통계는 비교 대상 없음으로 표시됩니다."
            )
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        result = build_statistics(
            cursor,
            before_owner=source_owner,
            before_table=source_table,
            requested_columns=requested_columns,
            preferred_columns=preferred_columns,
            basis="SINGLE",
            context={
                **context,
                "statisticsSource": "LIVE_SOURCE_ONLY",
                "comparisonAvailable": False,
            },
        )
        result["notice"] = (
            "INITDN$ 수정 테이블이 존재하지 않아 INITUP$ 원본 데이터만 분석했습니다. "
            "비교 화면 구조는 유지되며 수정 통계는 비교 대상 없음으로 표시됩니다."
        )
    return attach_column_insights(
        result,
        load_violation_column_insights(
            cursor,
            target_owner=source_owner,
            target_table=source_table,
            run_source_type=session.get("SOURCE_RUN_SOURCE_TYPE"),
            run_id=session.get("SOURCE_RUN_ID"),
        ),
    )


def build_applied_session_current_statistics(
    cursor,
    session: dict[str, Any],
    *,
    mapping: dict[str, Any],
    requested_columns: str | Iterable[str] | None = None,
) -> dict[str, Any]:
    edit_session_id = int(session.get("EDIT_SESSION_ID") or 0)
    source_owner = str(mapping.get("SOURCE_OWNER") or session.get("TARGET_OWNER") or "")
    source_table = str(mapping.get("SOURCE_TABLE") or session.get("SOURCE_TABLE") or "")
    edit_owner = str(mapping.get("EDIT_OWNER") or session.get("TARGET_OWNER") or "").strip()
    edit_table = str(mapping.get("EDIT_TABLE") or session.get("EDIT_TABLE") or "").strip()
    preferred_columns = preferred_edit_session_columns(cursor, edit_session_id)
    context = {
        "projectId": session.get("PROJECT_ID"),
        "scenarioId": session.get("SCENARIO_ID"),
        "editSessionId": edit_session_id,
        "sessionStatus": session.get("SESSION_STATUS"),
        "statisticsSource": "LIVE_CURRENT_PHYSICAL_PAIR",
        "historicalComparisonAvailable": False,
        "comparisonAvailable": bool(edit_owner and edit_table),
    }
    try:
        result = build_statistics(
            cursor,
            before_owner=source_owner,
            before_table=source_table,
            after_owner=edit_owner or None,
            after_table=edit_table or None,
            requested_columns=requested_columns,
            preferred_columns=preferred_columns,
            basis="LIVE_CURRENT_PHYSICAL_PAIR" if edit_table else "LIVE_CURRENT_AFTER_APPLY",
            context=context,
        )
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        result = build_statistics(
            cursor,
            before_owner=source_owner,
            before_table=source_table,
            requested_columns=requested_columns,
            preferred_columns=preferred_columns,
            basis="LIVE_CURRENT_AFTER_APPLY",
            context={
                **context,
                "statisticsSource": "LIVE_CURRENT_PHYSICAL_TABLE",
                "comparisonAvailable": False,
            },
        )
        result["notice"] = (
            "이 작업은 기초통계 스냅샷 기능 도입 전에 운영 반영되었고 현재 INITDN$ 수정 테이블을 찾을 수 없습니다. "
            "현재 INITUP$ 운영 데이터의 통계만 실시간으로 계산했습니다."
        )
    else:
        if result.get("after"):
            result["notice"] = (
                "이 작업은 기초통계 스냅샷 기능 도입 전에 운영 반영되어 실행 당시의 변경 전·후 값은 복원할 수 없습니다. "
                "현재 물리적으로 존재하는 INITUP$ 원본과 INITDN$ 수정 테이블을 실시간으로 비교했습니다."
            )
        else:
            result["notice"] = (
                "이 작업은 기초통계 스냅샷 기능 도입 전에 운영 반영되었고 INITDN$ 수정 테이블 정보가 없습니다. "
                "현재 INITUP$ 운영 데이터의 통계만 실시간으로 계산했습니다."
            )
    return attach_column_insights(
        result,
        load_violation_column_insights(
            cursor,
            target_owner=source_owner,
            target_table=source_table,
            run_source_type=session.get("SOURCE_RUN_SOURCE_TYPE"),
            run_id=session.get("SOURCE_RUN_ID"),
        ),
    )


def resolve_registered_pair(
    cursor,
    *,
    project_id: int,
    scenario_id: int | None,
    target_owner: str,
    target_table: str,
) -> dict[str, Any] | None:
    normalized_owner = _normalize_identifier(target_owner, "target owner")
    normalized_table = _normalize_identifier(target_table, "target table")
    rows = _fetch_all(
        cursor,
        "MCOMMON_STATS_TABLE_PAIR",
        {
            "projectId": int(project_id),
            "scenarioId": int(scenario_id) if scenario_id else None,
            "targetOwner": normalized_owner,
            "targetTable": normalized_table,
        },
    )
    if not rows:
        return None
    pairs: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for row in rows:
        source_owner = _normalize_identifier(row.get("SOURCE_OWNER"), "source owner")
        source_table = _normalize_identifier(row.get("SOURCE_TABLE"), "source table")
        edit_owner = _normalize_optional_identifier(row.get("EDIT_OWNER"), "edit owner")
        edit_table = _normalize_optional_identifier(row.get("EDIT_TABLE"), "edit table")
        if not edit_owner or not edit_table:
            continue
        pairs[(source_owner, source_table, edit_owner, edit_table)] = {
            **row,
            "SOURCE_OWNER": source_owner,
            "SOURCE_TABLE": source_table,
            "EDIT_OWNER": edit_owner,
            "EDIT_TABLE": edit_table,
        }
    if not pairs:
        return None
    if len(pairs) != 1:
        raise HTTPException(
            status_code=409,
            detail="The selected run target has multiple registered source/edit mappings.",
        )
    return next(iter(pairs.values()))


def resolve_physical_pair(
    cursor,
    *,
    target_owner: str,
    target_table: str,
) -> dict[str, Any] | None:
    owner = _normalize_identifier(target_owner, "physical pair owner")
    table = _normalize_identifier(target_table, "physical pair table")
    if table.startswith("INITUP$"):
        source_table = table
        edit_table = f"INITDN${table[len('INITUP$'):]}"
    elif table.startswith("INITDN$"):
        source_table = f"INITUP${table[len('INITDN$'):]}"
        edit_table = table
    else:
        return None
    try:
        if not _table_columns(cursor, owner, source_table):
            return None
        if not _table_columns(cursor, owner, edit_table):
            return None
    except Exception as exc:
        logger.info("Physical INITUP$/INITDN$ pair lookup skipped: %s", exc)
        return None
    return {
        "SOURCE_OWNER": owner,
        "SOURCE_TABLE": source_table,
        "EDIT_OWNER": owner,
        "EDIT_TABLE": edit_table,
        "PAIR_SOURCE": "PHYSICAL_NAME_PAIR",
    }


def sanitize_snapshot_statistics(
    value: Any,
    *,
    requested_columns: str | Iterable[str] | None = None,
    basis: str = "VALIDATION_SNAPSHOT",
    snapshot_at: Any = None,
) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    selected_columns = parse_requested_columns(requested_columns)
    selected = set(selected_columns or [])
    raw_columns = value.get("columns") if isinstance(value.get("columns"), list) else []
    raw_context = value.get("context") if isinstance(value.get("context"), dict) else {}
    result_columns: list[dict[str, Any]] = []
    for raw_column in raw_columns:
        if not isinstance(raw_column, dict):
            continue
        try:
            column_name = _normalize_identifier(raw_column.get("columnName"), "snapshot column")
        except HTTPException:
            continue
        if selected and column_name not in selected:
            continue
        before = _safe_metrics(raw_column.get("before"))
        after = _safe_metrics(raw_column.get("after"))
        if before is None:
            continue
        delta = _delta_metrics(before, after) if after is not None else None
        column_comment = raw_column.get("columnComment")
        data_type = _physical_type(raw_column.get("dataType"))
        selection_basis = str(raw_column.get("selectionBasis") or "").strip().upper()
        profile_kind = str(raw_column.get("profileKind") or "NUMERIC").strip().upper()
        type_group_code = str(raw_column.get("typeGroupCode") or "OTHER").strip().upper()
        result_columns.append(
            {
                "columnName": column_name,
                "columnComment": column_comment[:500] if isinstance(column_comment, str) else "",
                "dataType": data_type if _is_supported_type(data_type) else "",
                "selectionBasis": (
                    selection_basis
                    if selection_basis in {
                        "PROFILE_CONTINUOUS",
                        "PROFILE_CATEGORICAL",
                        "SYMBOLIC_TARGET",
                        "PHYSICAL_NUMERIC",
                        "PHYSICAL_TEMPORAL",
                        "PHYSICAL_CATEGORICAL",
                    }
                    else None
                ),
                "profileKind": profile_kind if profile_kind in {"NUMERIC", "CATEGORICAL", "TEMPORAL"} else "CATEGORICAL",
                "typeGroupCode": type_group_code if type_group_code in {"CONTINUOUS", "CATEGORICAL", "OTHER"} else "OTHER",
                "before": before,
                "after": after,
                "delta": delta,
                "distribution": _safe_distribution(
                    raw_column.get("distribution"),
                    has_after=after is not None,
                ),
                "topValues": _safe_top_values(
                    raw_column.get("topValues"),
                    has_after=after is not None,
                ),
            }
        )
        if len(result_columns) >= MAX_STATISTICS_COLUMNS:
            break

    def safe_source(source: Any, fallback_label: str) -> dict[str, Any] | None:
        if not isinstance(source, dict):
            return None
        try:
            owner = _normalize_identifier(source.get("owner"), "snapshot owner")
            table = _normalize_identifier(source.get("table"), "snapshot table")
        except HTTPException:
            return None
        return {
            "owner": owner,
            "table": table,
            "label": fallback_label,
        }

    before_source = safe_source(
        value.get("before"),
        "수정 전" if value.get("after") else "현재 데이터",
    )
    after_source = safe_source(value.get("after"), "수정 후")
    if not before_source:
        return None
    directions = {"DECREASED": 0, "INCREASED": 0, "UNCHANGED": 0}
    for column in result_columns:
        direction = (column.get("delta") or {}).get("varianceDirection")
        if direction in directions:
            directions[direction] += 1
    return {
        "available": bool(value.get("available", True)),
        "basis": str(basis or "VALIDATION_SNAPSHOT").strip().upper(),
        "snapshotAt": snapshot_at,
        "before": before_source,
        "after": after_source,
        "columns": result_columns,
        "truncated": bool(value.get("truncated")) or (
            not selected and len(raw_columns) > len(result_columns)
        ),
        "summary": {
            "columnCount": len(result_columns),
            "totalCandidateColumnCount": _json_number(
                (value.get("summary") or {}).get("totalCandidateColumnCount"),
                integer=True,
            ) or len(result_columns),
            "sourceTotalRowCount": (
                result_columns[0]["before"].get("totalRowCount") if result_columns else 0
            ),
            "editTotalRowCount": (
                result_columns[0]["after"].get("totalRowCount")
                if result_columns and result_columns[0].get("after")
                else None
            ),
            "varianceDecreasedColumnCount": directions["DECREASED"],
            "varianceIncreasedColumnCount": directions["INCREASED"],
            "varianceUnchangedColumnCount": directions["UNCHANGED"],
        },
        "methodology": {
            "variance": "POPULATION",
            "standardDeviation": "POPULATION",
            "kurtosis": "EXCESS",
            "numericConversionFailure": "NULL",
            "maxColumns": MAX_STATISTICS_COLUMNS,
        },
        "context": {
            "projectId": _json_number(raw_context.get("projectId"), integer=True),
            "scenarioId": _json_number(raw_context.get("scenarioId"), integer=True),
            "editSessionId": _json_number(raw_context.get("editSessionId"), integer=True),
            "sessionStatus": (
                str(raw_context.get("sessionStatus") or "").strip().upper()
                if str(raw_context.get("sessionStatus") or "").strip().upper()
                in {"DRAFT", "EDITING", "VALIDATED", "APPLY_READY", "APPLIED", "CANCELLED"}
                else None
            ),
        },
    }
