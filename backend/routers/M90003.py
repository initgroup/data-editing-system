"""
@file           M90003.py
@description    Oracle Machine Learning model training and lifecycle management API
"""

import json
import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database_helper import SqlLoader, execute_query
from backend.services.background_jobs import BackgroundJobQueueFull, submit_background_job
from backend.target_database import (
    get_target_connection_id,
    get_target_db_connection,
    get_target_db_connection_by_id,
)


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])

MODEL_KEY_COLUMN_TYPE = "COLUMN_TYPE"
TRAINING_ADAPTERS = {
    "COLTYPE_V2": {
        "trainSqlId": "M90003_TYPE_MODEL_TRAIN_CALL",
        "algorithms": ["DECISION_TREE", "RANDOM_FOREST"],
        "featureVersions": ["V2"],
        "defaultMinTrainRows": 30,
    },
}
MODEL_FAMILY_CAPABILITIES = {
    MODEL_KEY_COLUMN_TYPE: {
        "displayNameKey": "modelFamily_COLUMN_TYPE",
        "supportsTraining": True,
        "supportsDataset": True,
        "trainerCode": "COLTYPE_V2",
        "sourceProfileTable": "INIT$_TB_COLTYPE_PROFILE",
        "sourceLabelTable": "INIT$_TB_COLTYPE_LABEL",
        "consumerObject": "INIT$_SP_PREDICTED_TYPE",
    },
}
ALLOWED_LABEL_SCOPES = {
    "ALL",
    "ELIGIBLE",
    "EXCLUDED",
    "EXCLUDED_AUTO",
    "EXCLUDED_LEGACY",
    "CONFLICT",
}
ALLOWED_TYPE_GROUP_CODES = {"ALL", "CATEGORICAL", "CONTINUOUS", "OTHER"}
ALLOWED_MODEL_STATUSES = {"ALL", "CANDIDATE", "ACTIVE", "ARCHIVED", "FAILED"}
ALLOWED_RUN_STATUSES = {"ALL", "REQUESTED", "RUNNING", "SUCCESS", "FAILED", "CANCELLED"}


class TrainingStartRequest(BaseModel):
    modelKey: str = MODEL_KEY_COLUMN_TYPE
    algorithmCode: str = "DECISION_TREE"
    featureVersion: str = "V2"
    labelVersion: str = "V2"
    maxRows: Optional[int] = None
    maxTrainingRows: Optional[int] = None
    minConfirmedLabels: int = 30
    holdoutRatio: Optional[float] = None
    validationPercent: Optional[int] = None
    testPercent: Optional[int] = None
    seed: Optional[int] = 42
    randomSeed: Optional[int] = None
    confirmedGoldOnly: bool = True
    description: Optional[str] = ""
    model_config = ConfigDict(extra="allow")


class ModelActionRequest(BaseModel):
    reason: Optional[str] = ""
    activationMode: Optional[str] = "ACTIVATE"
    model_config = ConfigDict(extra="allow")


class ModelRollbackRequest(BaseModel):
    modelKey: str = MODEL_KEY_COLUMN_TYPE
    reason: Optional[str] = ""
    model_config = ConfigDict(extra="forbid")


class LabelDeleteRequest(BaseModel):
    modelKey: str = MODEL_KEY_COLUMN_TYPE
    labelIds: list[int] = []
    model_config = ConfigDict(extra="forbid")


class LabelResetRequest(BaseModel):
    modelKey: str = MODEL_KEY_COLUMN_TYPE
    model_config = ConfigDict(extra="forbid")


def _normalize_choice(value: Any, allowed: set[str], field_name: str) -> str:
    text = str(value or "").strip().upper()
    if text not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return text


def _normalize_model_key(value: Any) -> str:
    text = str(value or MODEL_KEY_COLUMN_TYPE).strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_$#.-]{0,99}", text):
        raise HTTPException(status_code=400, detail="Invalid modelKey.")
    return text


def _require_training_adapter(value: Any) -> tuple[str, dict[str, Any]]:
    model_key = _normalize_model_key(value)
    family = MODEL_FAMILY_CAPABILITIES.get(model_key, {})
    adapter = TRAINING_ADAPTERS.get(str(family.get("trainerCode") or ""))
    if not family.get("supportsTraining") or not adapter:
        raise HTTPException(status_code=400, detail="This model family does not have a registered training adapter.")
    return model_key, adapter


def _require_dataset_family(value: Any) -> str:
    model_key = _normalize_model_key(value)
    family = MODEL_FAMILY_CAPABILITIES.get(model_key, {})
    if not family.get("supportsDataset") or not family.get("sourceLabelTable"):
        raise HTTPException(status_code=400, detail="This model family does not have a managed training dataset.")
    return model_key


def _normalize_label_ids(value: list[int]) -> list[int]:
    normalized = sorted({int(item) for item in (value or []) if int(item) > 0})
    if not normalized:
        raise HTTPException(status_code=400, detail="Select at least one label.")
    if len(normalized) > 1000:
        raise HTTPException(status_code=400, detail="At most 1,000 labels can be deleted at once.")
    return normalized


def _normalize_version(value: Any, field_name: str) -> str:
    text = str(value or "").strip().upper()
    if not text or len(text) > 30 or not all(char.isalnum() or char in {"_", "-", "."} for char in text):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")
    return text


def _normalize_keyword(value: Any) -> str:
    text = str(value or "").strip().upper()
    return text[:200]


def _normalize_reason(value: Any) -> str:
    return str(value or "").strip()[:1000]


def _query(conn, sql_id: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    result = execute_query(conn, sql_id, params or {})
    if result.get("status") != "success":
        detail = result.get("detail") or result.get("message") or f"{sql_id} failed."
        raise HTTPException(status_code=500, detail=detail)
    return result


def _read_lob(value: Any) -> Any:
    return value.read() if hasattr(value, "read") else value


def _normalize_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {key: _read_lob(value) for key, value in row.items()}
        for row in rows
    ]


def _value(row: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in row and row[key] is not None:
            return _read_lob(row[key])
    return default


def _build_model_metrics(model_row: dict[str, Any], metric_rows: list[dict[str, Any]]) -> dict[str, Any]:
    per_type: dict[str, dict[str, Any]] = {}
    confusion_matrix: list[dict[str, Any]] = []
    aggregate_metrics: dict[str, Any] = {}
    for row in metric_rows:
        metric_name = str(row.get("METRIC_NAME") or "").strip().upper()
        metric_value = row.get("METRIC_VALUE")
        type_code = str(row.get("TYPE_CODE") or "").strip().upper()
        predicted_type_code = str(row.get("PREDICTED_TYPE_CODE") or "").strip().upper()
        if metric_name == "CONFUSION" and type_code and predicted_type_code:
            confusion_matrix.append(
                {
                    "actual": type_code,
                    "predicted": predicted_type_code,
                    "count": int(metric_value or 0),
                }
            )
            continue
        if not type_code:
            aggregate_metrics[metric_name] = metric_value
            continue
        target = per_type.setdefault(
            type_code,
            {
                "typeCode": type_code,
                "typeGroupCode": row.get("TYPE_GROUP_CODE") or "OTHER",
                "precision": None,
                "recall": None,
                "f1": None,
                "support": row.get("SUPPORT_COUNT") or 0,
            },
        )
        if metric_name.endswith("PRECISION"):
            target["precision"] = metric_value
        elif metric_name.endswith("RECALL"):
            target["recall"] = metric_value
        elif metric_name in {"F1", "F1_SCORE", "CLASS_F1", "CLASS_F1_SCORE"}:
            target["f1"] = metric_value
    return {
        "accuracy": _value(model_row, "ACCURACY", default=aggregate_metrics.get("ACCURACY")),
        "macroF1": _value(model_row, "MACRO_F1", default=aggregate_metrics.get("MACRO_F1")),
        "balancedAccuracy": _value(
            model_row,
            "BALANCED_ACCURACY",
            default=aggregate_metrics.get("BALANCED_ACCURACY"),
        ),
        "holdoutRows": int(_value(model_row, "VALID_ROW_COUNT", default=0) or 0)
        + int(_value(model_row, "TEST_ROW_COUNT", default=0) or 0),
        "perClassRecall": list(per_type.values()),
        "confusionMatrix": confusion_matrix,
    }


def _paged_payload(result: dict[str, Any], page: int, page_size: int) -> dict[str, Any]:
    raw_rows = _normalize_rows(result.get("data") or [])
    total = int(raw_rows[0].get("TOTAL_COUNT") or 0) if raw_rows else 0
    rows = [
        {key: value for key, value in row.items() if key != "TOTAL_COUNT"}
        for row in raw_rows
    ]
    return {
        "status": "success",
        "data": rows,
        "columns": [column for column in result.get("columns", []) if column != "TOTAL_COUNT"],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


def _execute_proc(conn, sql_id: str, params: dict[str, Any]) -> None:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql(sql_id), params)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()


def _mark_training_submission_failed(
    conn,
    train_run_id: int,
    error_message: str,
) -> None:
    try:
        _execute_proc(
            conn,
            "M90003_TRAIN_RUN_QUEUE_FAILED",
            {
                "trainRunId": train_run_id,
                "errorMessage": str(error_message or "Background queue submission failed.")[:4000],
            },
        )
    except Exception:
        logger.exception("M90003 failed to record queue submission failure. train_run_id=%s", train_run_id)


def _run_training_background(
    train_run_id: int,
    connection_id: int,
    user_id: int,
    train_sql_id: str,
) -> None:
    conn = None
    try:
        conn = get_target_db_connection_by_id(connection_id, user_id)
        _execute_proc(
            conn,
            train_sql_id,
            {"trainRunId": train_run_id, "requestedBy": user_id},
        )
    except Exception as error:
        logger.exception("M90003 model training failed. train_run_id=%s", train_run_id)
        if conn:
            try:
                _execute_proc(
                    conn,
                    "M90003_TRAIN_RUN_EXECUTION_FAILED",
                    {
                        "trainRunId": train_run_id,
                        "errorMessage": str(error)[:4000],
                    },
                )
            except Exception:
                logger.exception("M90003 failed to record training failure. train_run_id=%s", train_run_id)
        raise
    finally:
        if conn:
            conn.close()


@router.get("/families")
def get_model_families(request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = _query(conn, "M90003_MODEL_FAMILY_LIST")
        rows = _normalize_rows(result.get("data") or [])
        rows_by_model_key = {
            _normalize_model_key(_value(row, "MODEL_KEY")): row
            for row in rows
        }
        model_keys = list(MODEL_FAMILY_CAPABILITIES)
        model_keys.extend(key for key in rows_by_model_key if key not in MODEL_FAMILY_CAPABILITIES)
        families = []
        for model_key in model_keys:
            row = rows_by_model_key.get(model_key, {})
            capabilities = MODEL_FAMILY_CAPABILITIES.get(model_key, {})
            adapter = TRAINING_ADAPTERS.get(str(capabilities.get("trainerCode") or ""), {})
            families.append({
                "modelKey": model_key,
                "displayNameKey": capabilities.get("displayNameKey", ""),
                "supportsTraining": bool(capabilities.get("supportsTraining")),
                "supportsDataset": bool(capabilities.get("supportsDataset")),
                "trainerCode": capabilities.get("trainerCode", ""),
                "sourceProfileTable": capabilities.get("sourceProfileTable", ""),
                "sourceLabelTable": capabilities.get("sourceLabelTable", ""),
                "consumerObject": capabilities.get("consumerObject", ""),
                "algorithms": adapter.get("algorithms", []),
                "featureVersions": adapter.get("featureVersions", []),
                "defaultMinTrainRows": adapter.get("defaultMinTrainRows", 30),
                "modelCount": int(_value(row, "MODEL_COUNT", default=0) or 0),
                "runCount": int(_value(row, "RUN_COUNT", default=0) or 0),
                "activeModelVersionId": _value(row, "ACTIVE_MODEL_VERSION_ID"),
                "latestVersionNo": _value(row, "LATEST_VERSION_NO"),
            })
        return {"status": "success", "data": families, "total": len(families)}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 model family list load failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.get("/summary")
def get_summary(request: Request, modelKey: str = Query(MODEL_KEY_COLUMN_TYPE)):
    model_key = _normalize_model_key(modelKey)
    supports_dataset = bool(MODEL_FAMILY_CAPABILITIES.get(model_key, {}).get("supportsDataset"))
    conn = None
    try:
        conn = get_target_db_connection(request)
        summary_sql_id = "M90003_SUMMARY" if supports_dataset else "M90003_MODEL_SUMMARY"
        summary = _query(conn, summary_sql_id, {"modelKey": model_key})
        group_distribution = _query(conn, "M90003_DATASET_GROUP_DISTRIBUTION") if supports_dataset else {"data": []}
        detail_distribution = _query(conn, "M90003_DATASET_DETAIL_DISTRIBUTION") if supports_dataset else {"data": []}
        active_metric_result = _query(conn, "M90003_ACTIVE_MODEL_METRIC_LIST", {"modelKey": model_key})
        summary_row = (_normalize_rows(summary.get("data") or []) or [{}])[0]
        group_rows = _normalize_rows(group_distribution.get("data") or [])
        detail_rows = _normalize_rows(detail_distribution.get("data") or [])
        active_metric_rows = _normalize_rows(active_metric_result.get("data") or [])
        active_metrics = _build_model_metrics(summary_row, active_metric_rows)
        active_model = None
        if _value(summary_row, "MODEL_VERSION_ID") is not None:
            active_model = {
                "id": _value(summary_row, "MODEL_VERSION_ID"),
                "modelName": _value(summary_row, "MODEL_NAME", "PHYSICAL_MODEL_NAME"),
                "modelVersion": _value(summary_row, "MODEL_VERSION", "VERSION_NO"),
                "algorithmCode": _value(summary_row, "ALGORITHM_CODE"),
                "featureVersion": _value(summary_row, "FEATURE_VERSION"),
                "status": _value(summary_row, "MODEL_STATUS_CODE", "STATUS_CODE"),
                "trainedAt": _value(summary_row, "TRAINED_AT", "CREATED_AT"),
                "macroF1": _value(summary_row, "MACRO_F1"),
                "balancedAccuracy": _value(summary_row, "BALANCED_ACCURACY"),
                "metrics": active_metrics,
            }
        payload = {
            "activeModel": active_model,
            "modelKey": model_key,
            "counts": {
                "confirmedEligible": int(_value(summary_row, "CONFIRMED_ELIGIBLE_COUNT", default=0) or 0),
                "excludedAuto": int(_value(summary_row, "EXCLUDED_AUTO_COUNT", default=0) or 0),
                "excludedLegacy": int(_value(summary_row, "EXCLUDED_LEGACY_COUNT", default=0) or 0),
                "conflicts": int(_value(summary_row, "CONFLICT_COUNT", default=0) or 0),
                "duplicates": int(_value(summary_row, "DUPLICATE_COUNT", default=0) or 0),
                "totalProfiles": int(_value(summary_row, "TOTAL_PROFILE_COUNT", default=0) or 0),
            },
            "groupDistribution": group_rows,
            "typeDistribution": detail_rows,
        }
        return {
            "status": "success",
            "data": payload,
            **payload,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 summary load failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.get("/dataset/stats")
@router.get("/dataset/distribution", include_in_schema=False)
def get_dataset_distribution(request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        group_result = _query(conn, "M90003_DATASET_GROUP_DISTRIBUTION")
        detail_result = _query(conn, "M90003_DATASET_DETAIL_DISTRIBUTION")
        return {
            "status": "success",
            "data": {
                "groupDistribution": _normalize_rows(group_result.get("data") or []),
                "typeDistribution": _normalize_rows(detail_result.get("data") or []),
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 dataset distribution load failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.get("/dataset")
@router.get("/labels", include_in_schema=False)
def get_labels(
    request: Request,
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=1000),
    scope: str = Query("ALL"),
    status: Optional[str] = Query(None),
    typeGroupCode: str = Query("ALL"),
    keyword: str = Query(""),
):
    normalized_scope = _normalize_choice(status or scope, ALLOWED_LABEL_SCOPES, "status")
    group_text = str(typeGroupCode or "ALL").strip().upper() or "ALL"
    normalized_group = _normalize_choice(group_text, ALLOWED_TYPE_GROUP_CODES, "typeGroupCode")
    offset = (page - 1) * pageSize
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = _query(
            conn,
            "M90003_LABEL_LIST",
            {
                "scope": normalized_scope,
                "typeGroupCode": normalized_group,
                "keyword": _normalize_keyword(keyword),
                "offsetRows": offset,
                "endRow": offset + pageSize,
            },
        )
        return _paged_payload(result, page, pageSize)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 label list load failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.post("/dataset/labels/delete")
def delete_selected_labels(req: LabelDeleteRequest, request: Request):
    _require_dataset_family(req.modelKey)
    label_ids = _normalize_label_ids(req.labelIds)
    conn = None
    try:
        conn = get_target_db_connection(request)
        _execute_proc(
            conn,
            "M90003_LABEL_DELETE_SELECTED",
            {
                "labelIds": ",".join(str(item) for item in label_ids),
                "requestedBy": get_request_user_id(request),
            },
        )
        return {"status": "success", "data": {"deletedCount": len(label_ids)}}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 selected label deletion failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.post("/dataset/labels/reset")
def reset_training_labels(req: LabelResetRequest, request: Request):
    _require_dataset_family(req.modelKey)
    conn = None
    try:
        conn = get_target_db_connection(request)
        _execute_proc(
            conn,
            "M90003_LABEL_RESET_TRAINING",
            {"requestedBy": get_request_user_id(request)},
        )
        return {"status": "success", "data": {"modelKey": _normalize_model_key(req.modelKey)}}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 training label reset failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.get("/models")
def get_models(
    request: Request,
    modelKey: str = Query(MODEL_KEY_COLUMN_TYPE),
    status: str = Query("ALL"),
    limit: int = Query(100, ge=1, le=500),
):
    normalized_status = _normalize_choice(status, ALLOWED_MODEL_STATUSES, "status")
    model_key = _normalize_model_key(modelKey)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = _query(
            conn,
            "M90003_MODEL_VERSION_LIST",
            {"modelKey": model_key, "statusCode": normalized_status, "limitRows": limit},
        )
        rows = _normalize_rows(result.get("data") or [])
        return {"status": "success", "data": rows, "columns": result.get("columns", []), "total": len(rows)}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 model version list load failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.get("/runs")
def get_runs(
    request: Request,
    modelKey: str = Query(MODEL_KEY_COLUMN_TYPE),
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=200),
    status: str = Query("ALL"),
):
    normalized_status = _normalize_choice(status, ALLOWED_RUN_STATUSES, "status")
    model_key = _normalize_model_key(modelKey)
    offset = (page - 1) * pageSize
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = _query(
            conn,
            "M90003_TRAIN_RUN_LIST",
            {
                "modelKey": model_key,
                "statusCode": normalized_status,
                "offsetRows": offset,
                "endRow": offset + pageSize,
            },
        )
        return _paged_payload(result, page, pageSize)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 training run list load failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.get("/runs/{train_run_id}")
def get_run_detail(train_run_id: int, request: Request):
    if train_run_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid train run ID.")
    conn = None
    try:
        conn = get_target_db_connection(request)
        run_result = _query(conn, "M90003_TRAIN_RUN_DETAIL", {"trainRunId": train_run_id})
        if not run_result.get("data"):
            raise HTTPException(status_code=404, detail="Training run was not found.")
        metric_result = _query(conn, "M90003_TRAIN_RUN_METRIC_LIST", {"trainRunId": train_run_id})
        run_row = _normalize_rows(run_result.get("data") or [])[0]
        metric_rows = _normalize_rows(metric_result.get("data") or [])
        return {
            "status": "success",
            "data": run_row,
            "metrics": metric_rows,
            "metricSummary": _build_model_metrics(run_row, metric_rows),
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 training run detail load failed. train_run_id=%s", train_run_id)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.post("/train")
@router.post("/training/start", include_in_schema=False)
def start_training(req: TrainingStartRequest, request: Request):
    model_key, adapter = _require_training_adapter(req.modelKey)
    algorithm_code = _normalize_choice(req.algorithmCode, set(adapter["algorithms"]), "algorithmCode")
    feature_version = _normalize_version(req.featureVersion, "featureVersion")
    if feature_version == "TYPE_FEATURE_V2":
        feature_version = "V2"
    if feature_version not in set(adapter["featureVersions"]):
        raise HTTPException(status_code=400, detail="Unsupported featureVersion for this training adapter.")
    label_version = _normalize_version(req.labelVersion, "labelVersion")
    max_rows_value = req.maxRows if req.maxRows is not None else req.maxTrainingRows
    seed_value = req.seed if req.seed is not None else req.randomSeed
    max_training_rows = int(max_rows_value if max_rows_value is not None else 25000)
    random_seed = int(seed_value if seed_value is not None else 42)
    if req.holdoutRatio is not None:
        holdout_percent = int(round(float(req.holdoutRatio) * 100))
    else:
        validation_percent = req.validationPercent if req.validationPercent is not None else 20
        test_percent = req.testPercent if req.testPercent is not None else 0
        holdout_percent = int(validation_percent) + int(test_percent)
    if not req.confirmedGoldOnly:
        raise HTTPException(status_code=400, detail="Only explicitly confirmed gold labels can be used for training.")
    if not 100 <= max_training_rows <= 1000000:
        raise HTTPException(status_code=400, detail="maxRows must be between 100 and 1,000,000.")
    if not 20 <= req.minConfirmedLabels <= 100000:
        raise HTTPException(status_code=400, detail="minConfirmedLabels must be between 20 and 100,000.")
    if not 10 <= holdout_percent <= 40:
        raise HTTPException(status_code=400, detail="holdoutRatio must be between 0.1 and 0.4.")
    if random_seed < 1 or random_seed > 2147483647:
        raise HTTPException(status_code=400, detail="Invalid random seed.")

    user_id = get_request_user_id(request)
    connection_id = get_target_connection_id(request)
    conn = None
    cursor = None
    train_run_id = None
    try:
        conn = get_target_db_connection(request)
        active_run_result = _query(
            conn,
            "M90003_ACTIVE_TRAIN_RUN_COUNT",
            {"modelKey": model_key},
        )
        active_run_count = int(
            _value((active_run_result.get("data") or [{}])[0], "ACTIVE_RUN_COUNT", default=0) or 0
        )
        if active_run_count > 0:
            raise HTTPException(status_code=409, detail="A training run for this model family is already active.")
        cursor = conn.cursor()
        train_run_id_var = cursor.var(int)
        cursor.execute(
            SqlLoader.get_sql("M90003_TRAIN_RUN_CREATE"),
            {
                "modelKey": model_key,
                "algorithmCode": algorithm_code,
                "featureVersion": feature_version,
                "labelVersion": label_version,
                "maxTrainingRows": max_training_rows,
                "minConfirmedLabels": req.minConfirmedLabels,
                "holdoutPercent": holdout_percent,
                "randomSeed": random_seed,
                "configJson": json.dumps(
                    {
                        "holdoutRatio": holdout_percent / 100,
                        "confirmedGoldOnly": True,
                        "description": _normalize_reason(req.description),
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                "requestedBy": user_id,
                "trainRunId": train_run_id_var,
            },
        )
        conn.commit()
        raw_id = train_run_id_var.getvalue()
        if isinstance(raw_id, (list, tuple)):
            raw_id = raw_id[0] if raw_id else None
        train_run_id = int(raw_id)
        try:
            submit_background_job(
                f"M90003 model training #{train_run_id}",
                _run_training_background,
                train_run_id,
                connection_id,
                user_id,
                adapter["trainSqlId"],
            )
        except BackgroundJobQueueFull as error:
            _mark_training_submission_failed(conn, train_run_id, str(error))
            raise HTTPException(status_code=503, detail=str(error))
        except Exception as error:
            _mark_training_submission_failed(conn, train_run_id, str(error))
            raise

        return {"status": "success", "data": {"trainRunId": train_run_id, "statusCode": "REQUESTED"}}
    except HTTPException:
        raise
    except Exception as error:
        if conn:
            conn.rollback()
        logger.exception("M90003 training start failed. train_run_id=%s", train_run_id)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/models/{model_version_id}/activate")
def activate_model(
    model_version_id: int,
    request: Request,
    req: Optional[ModelActionRequest] = None,
):
    if model_version_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid model version ID.")
    user_id = get_request_user_id(request)
    conn = None
    try:
        conn = get_target_db_connection(request)
        _execute_proc(
            conn,
            "M90003_TYPE_MODEL_ACTIVATE_CALL",
            {"modelVersionId": model_version_id, "userId": user_id},
        )
        return {"status": "success", "data": {"modelVersionId": model_version_id, "statusCode": "ACTIVE"}}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 model activation failed. model_version_id=%s", model_version_id)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.post("/models/{model_version_id}/archive")
def archive_model(
    model_version_id: int,
    request: Request,
    req: Optional[ModelActionRequest] = None,
):
    if model_version_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid model version ID.")
    user_id = get_request_user_id(request)
    conn = None
    try:
        conn = get_target_db_connection(request)
        _execute_proc(
            conn,
            "M90003_TYPE_MODEL_ARCHIVE_CALL",
            {"modelVersionId": model_version_id, "userId": user_id},
        )
        return {"status": "success", "data": {"modelVersionId": model_version_id, "statusCode": "ARCHIVED"}}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 model archive failed. model_version_id=%s", model_version_id)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()


@router.post("/models/rollback")
def rollback_model(req: ModelRollbackRequest, request: Request):
    model_key = _normalize_model_key(req.modelKey)
    user_id = get_request_user_id(request)
    conn = None
    try:
        conn = get_target_db_connection(request)
        _execute_proc(
            conn,
            "M90003_TYPE_MODEL_ROLLBACK_CALL",
            {"modelKey": model_key, "userId": user_id},
        )
        return {"status": "success", "data": {"modelKey": model_key}}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("M90003 model rollback failed. model_key=%s", model_key)
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if conn:
            conn.close()
