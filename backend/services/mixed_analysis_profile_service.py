"""Early mixed-scenario stages, persisted in existing XAI run summaries."""
from backend.services import mixed_xai_service as xai
from backend.services import mixed_pattern_service as patterns
from backend.services.mixed_analysis_profile import describe_rows, relate_rows


def _run(conn, payload, *, relation):
    ctx = xai.context(payload)
    with conn.cursor() as cursor:
        patterns.require_schema(cursor)
        rows, eligible, columns, sampling = patterns._sample(cursor, ctx, payload)
        xai._execute(cursor, "MCOMMON_EDIT_TABLE_COLUMNS", {"ownerName": ctx["owner"], "tableName": ctx["tableName"]})
        comments = {item["COLUMN_NAME"]: item.get("COLUMN_COMMENT") or "" for item in xai._rows(cursor)}
        eligible = [dict(column, COLUMN_COMMENT=comments.get(column["COLUMN_NAME"], "")) for column in eligible]
        profile = describe_rows(rows, eligible, sampling=sampling, source_column_count=len(columns))
        profile["unsupportedColumnCount"] = sum(column["DATA_TYPE"] not in xai.NUMERIC_TYPES | xai.TEXT_TYPES
            or column["DATA_TYPE"] in xai.TEXT_TYPES and column["DATA_LENGTH"] > 4000 for column in columns)
        xai._execute(cursor, "XAI_RUN_SUMMARY", ctx)
        old = cursor.fetchone()
        summary = xai._json_object(old[0], "SUMMARY_JSON") if old else {"algorithm": "MIXED_PROFILE", "version": 3}
        summary["profile"] = profile
        if relation:
            summary["relationships"] = relate_rows(rows, eligible, profile=profile)
        xai._execute(cursor, "XAI_UPDATE_RUN" if old else "XAI_INSERT_RUN", {**ctx, "summaryJson": xai._json(summary)})
        return {"status": "success", "algorithm": "MIXED_PROFILE", "version": 3,
            "stage": "MIXED_XAI_RELATION" if relation else "MIXED_XAI_PROFILE",
            "profile": profile, **({"relationships": summary["relationships"]} if relation else {}),
            "sampleCount": len(rows), "columnCount": len(eligible), "resultTable": "INIT$_TB_XAI_RUN", "resultTables": ["INIT$_TB_XAI_RUN"]}


@xai.ml._limit_ml_concurrency
def profile(conn, payload):
    return _run(conn, payload, relation=False)


@xai.ml._limit_ml_concurrency
def relationships(conn, payload):
    return _run(conn, payload, relation=True)
