"""Extend the existing four editing stages with bounded Python diagnostics.

The caller owns the transaction and run authorization. Stored Oracle jobs keep
their original dispatch; only the explicit UNIFIED_EDITING methods use this
orchestrator. Oracle mining-model DDL is not made transactional by this wrapper.
"""
from __future__ import annotations

import re
import hashlib
from copy import deepcopy
from typing import Any, Dict

from fastapi import HTTPException

from backend.services import ml_analysis_service as ml
from backend.services import mixed_analysis_profile_service as diagnostics
from backend.services import mixed_pattern_service as patterns
from backend.services import mixed_xai_service as xai


METHODS = {
    "UNIFIED_EDITING_PROFILE": "PROFILE",
    "UNIFIED_EDITING_RELATION": "RELATION",
    "UNIFIED_EDITING_DISCOVER": "DISCOVER",
    "UNIFIED_EDITING_DETECT": "DETECT",
}
_MIXED_OPTIONS = {
    "sampleRows", "excludeColumns", "featureColumns", "maxDepth", "maxCategories",
    "minSamplesLeaf", "maxTargets", "maxRules", "minConfidence",
    "minValidationConfidence", "minValidationCount", "minLift", "minConfidenceGain",
    "targetColumns", "continuousEnabled", "maxContinuousTargets", "maxContinuousRules",
    "maxFormulaFeatures", "minFormulaConfidence", "minFormulaValidationConfidence",
    "minFormulaR2", "maxToleranceFraction", "maxViolationRows", "samplingStrategy", "sampleSeed",
}
_RESOURCE_KEYS = {"APP_ML_MAX_IN_MEMORY_ROWS", "APP_ML_MAX_INPUT_FEATURES"}


def _oracle_key(name: str) -> str:
    return "P_" + re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()


_MIXED_KEYS = {_oracle_key(name): name for name in _MIXED_OPTIONS}


def _payloads(payload: Dict[str, Any]):
    """Keep legacy and mixed thresholds independent, and scope non-overridable."""
    ctx = xai.context(payload)
    discovery_id = xai._number(payload, "discoveryRunId", ctx["runId"], 1, 10**15, integer=True)
    if discovery_id != ctx["runId"]:
        raise HTTPException(400, "Unified editing discovery and detection must use the same persisted run.")
    scope = {
        "P_TARGET_OWNER": ctx["owner"], "P_TARGET_TABLE": ctx["tableName"],
        "P_RUN_SOURCE_TYPE": ctx["runSourceType"], "P_RUN_ID": ctx["runId"],
        "targetOwner": ctx["owner"], "targetTable": ctx["tableName"],
        "runSourceType": ctx["runSourceType"], "runId": ctx["runId"],
    }
    legacy = {key: value for key, value in payload.items()
              if key != "mixedOptions" and not key.startswith("P_MIXED_")}
    legacy.update(scope)
    # The two engines must evaluate the same registered source. An arbitrary
    # legacy data query could otherwise train OML on another table or subset.
    source_pattern = (r'\s*SELECT\s+\*\s+FROM\s+"?' + re.escape(ctx["owner"])
                      + r'"?\s*\.\s*"?' + re.escape(ctx["tableName"]) + r'"?\s*;?\s*')
    for key in ("P_DATA_QUERY", "dataQuery"):
        query = str(legacy.pop(key, None) or "").strip()
        if query and not re.fullmatch(source_pattern, query, re.IGNORECASE):
            raise HTTPException(422, "Unified editing dataQuery must select the complete registered target table.")
    # A unified stage cannot report success with a failed constituent task, nor
    # let one detector commit another detector's unfinished result rows.
    legacy.update(P_CONTINUE_ON_ERROR="N", continueOnError="N", P_COMMIT_YN="N", commitYn="N")
    mixed = {key: payload[key] for key in _RESOURCE_KEYS if key in payload}
    for name in ("sampleRows", "excludeColumns", "featureColumns", "samplingStrategy", "sampleSeed"):
        value = xai._value(payload, name)
        if value is not None:
            mixed[_oracle_key(name)] = value
    options = payload.get("mixedOptions", {})
    if not isinstance(options, dict):
        raise HTTPException(422, "mixedOptions must be a JSON object.")
    for key, value in options.items():
        name = _MIXED_KEYS.get(key, key)
        if name not in _MIXED_OPTIONS:
            raise HTTPException(422, f"Unsupported mixed option: {key}")
        mixed[_oracle_key(name)] = value
    for key, value in payload.items():
        if not key.startswith("P_MIXED_"):
            continue
        mixed_key = "P_" + key[len("P_MIXED_"):]
        if mixed_key not in _MIXED_KEYS:
            raise HTTPException(422, f"Unsupported mixed option: {key}")
        mixed[mixed_key] = value
    mixed.update(scope)
    return ctx, legacy, mixed


def _require_complete(result: Any, family: str) -> Dict[str, Any]:
    if not isinstance(result, dict):
        raise HTTPException(500, f"{family} returned an invalid result.")
    if (str(result.get("status", "")).lower() != "success"
            or result.get("failedTasks") or result.get("failedTargets")
            or int(result.get("failedCount") or 0) > 0):
        detail = ml.summarize_partial_failures(result, family)
        raise HTTPException(409, f"Unified editing stopped: {family} did not complete. {detail}")
    return result


def _profile_types(conn, payload, ctx):
    method = str(ml.get_value(payload, "P_PREDICTION_METHOD", "predictionMethod") or "AUTO").strip().upper()
    aliases = {"FIXED": "ONLY_RULE", "BASE": "ONLY_RULE", "RULE": "ONLY_RULE",
               "ML": "ONLY_MODEL", "MODEL": "ONLY_MODEL", "ALL": "ONLY_BOTH", "BOTH": "ONLY_BOTH"}
    method = aliases.get(method, method)
    if method not in {"AUTO", "ONLY_RULE", "ONLY_MODEL", "ONLY_BOTH", "FINAL_RULE", "FINAL_MODEL", "FINAL_BOTH"}:
        raise HTTPException(422, "Unsupported column type predictionMethod.")
    cursor = conn.cursor()
    try:
        cursor.callproc("INIT$_SP_PREDICTED_TYPE", [ctx["owner"], ctx["tableName"], method,
                                                  ctx["runSourceType"], ctx["runId"]])
    finally:
        cursor.close()
    return {"status": "success", "predictionMethod": method,
            "resultTable": "INIT$_TB_COLTYPE_FINAL",
            "resultTables": ["INIT$_TB_COLTYPE_PROFILE", "INIT$_TB_COLTYPE_RESULT", "INIT$_TB_COLTYPE_FINAL"]}


def _default_model(payload, ctx):
    requested = ml.get_value(payload, "P_ASSOC_MODEL_NAME", "P_MODEL_NAME", "modelName")
    value = str(requested or "").strip()
    if not value or value.startswith(":") or value.upper() in {"AUTO", "(AUTO)", "OML_ASSOCIATION_MODEL_01"}:
        source = "F" if ctx["runSourceType"] == "FLOW_WORK" else "D"
        target_key = hashlib.sha256(f"{ctx['owner']}.{ctx['tableName']}".encode("utf-8")).hexdigest()[:8].upper()
        payload["P_ASSOC_MODEL_NAME"] = f"UA_{source}_{ctx['runId']}_{target_key}"


def _legacy_diagnostics(result):
    """Retain eligibility/limits separately from the mixed formula diagnostics."""
    fields = {
        "task", "status", "skippedYn", "skipReason", "message", "method", "targetColumn",
        "parts", "taskCount", "targetCount", "successCount", "failedCount", "skippedCount",
        "candidateCount", "selectedCount", "featureCount", "ruleCount", "violationCount",
        "sampleCount", "sampleRows", "resultTable", "resultTables", "continuousCriteria",
        "targetSelection", "memoryLimits", "matrixLimits", "clusterUsage",
    }

    def project(value):
        diagnostic = {key: deepcopy(value[key]) for key in fields if key in value}
        for key in ("targets", "skippedTargets", "failedTargets", "failedTasks"):
            if isinstance(value.get(key), list):
                diagnostic[key] = [project(item) for item in value[key] if isinstance(item, dict)]
        return diagnostic

    diagnostic = project(result)
    diagnostic["tasks"] = [project(item) for item in result.get("results", []) if isinstance(item, dict)]
    return diagnostic


def _sampling_diagnostics(result):
    keys = {
        "sampling", "sampleCount", "sampleLimit", "sampleLimitReached", "sampleByteLimit",
        "sampleByteLimitReached", "sampleEstimatedBytes", "sampleSeed", "sampleFractionAtCount",
        "sourceRowCountAtSampling", "sourceColumnCount", "sampleColumnCount", "featureLimit",
        "featureLimitExcludedColumns", "hashCandidateCount", "hashCandidateFraction",
        "samplingWarnings", "sourceSnapshotPinned", "selectionMeaning", "memoryLimitMeaning",
    }
    return {key: deepcopy(result[key]) for key in keys if key in result}


def _combined(stage, ctx, legacy, mixed):
    tables = list(dict.fromkeys([*legacy.get("resultTables", []), *mixed.get("resultTables", [])]))
    primary = {"PROFILE": "INIT$_TB_COLTYPE_FINAL", "RELATION": "INIT$_TB_COLREL_NETWORK_EDGE",
               "DISCOVER": "INIT$_TB_RULEDISC_ASSOC_SUM", "DETECT": "INIT$_TB_RULEVIOL_ASSOC"}[stage]
    models = list(dict.fromkeys(legacy.get("resultModels", [])))
    return {
        "status": "success", "algorithm": "UNIFIED_EDITING", "version": 1,
        "stage": stage, "runSourceType": ctx["runSourceType"], "runId": ctx["runId"],
        "targetOwner": ctx["owner"], "targetTable": ctx["tableName"],
        "parts": ["EXISTING_ANALYSIS", "MIXED_PATTERN_SUPPLEMENT"],
        "legacy": legacy, "mixed": mixed, "taskCount": 2, "successCount": 2,
        "resultTable": primary, "resultTables": tables, "resultModels": models,
        "modelName": models[0] if models else legacy.get("modelName"),
        "sampleCount": mixed.get("sampleCount", 0), "columnCount": mixed.get("columnCount", 0),
        "mixedRuleCount": mixed.get("ruleCount", 0), "mixedViolationCount": mixed.get("violationCount", 0),
        "legacyDiagnostics": _legacy_diagnostics(legacy),
        "mixedContinuousDiagnostics": deepcopy(mixed.get("continuous")) if isinstance(mixed.get("continuous"), dict) else None,
        "samplingDiagnostics": _sampling_diagnostics(mixed),
        "countMeaning": "Family counts overlap; violations are rule-row evidence, not confirmed erroneous cells.",
    }


def _summary(cursor, ctx):
    xai._execute(cursor, "XAI_RUN_SUMMARY", ctx)
    row = cursor.fetchone()
    return xai._json_object(row[0], "SUMMARY_JSON") if row else {}


def _persist_stage(conn, ctx, previous, result):
    """Keep provenance beside the existing mixed summary, without changing its AST version."""
    integrated = previous.get("integratedEditing") or {}
    order = tuple(METHODS.values())
    prior_stages = set(order[:order.index(result["stage"])])
    stages = {name: value for name, value in (integrated.get("stages") or {}).items() if name in prior_stages}
    legacy, mixed = result["legacy"], result["mixed"]
    stages[result["stage"]] = {
        "status": "success", "resultTables": result["resultTables"],
        "resultModels": result["resultModels"], "sampleCount": result["sampleCount"],
        "mixedRuleCount": result["mixedRuleCount"], "mixedViolationCount": result["mixedViolationCount"],
        "legacyTaskCount": legacy.get("taskCount", 1), "legacySkippedCount": legacy.get("skippedCount", 0),
        "legacyDiagnostics": result["legacyDiagnostics"],
        "mixedContinuousDiagnostics": result["mixedContinuousDiagnostics"],
        "samplingDiagnostics": result["samplingDiagnostics"],
        "warnings": mixed.get("warnings", []),
    }
    with conn.cursor() as cursor:
        summary = _summary(cursor, ctx)
        if not summary:
            raise HTTPException(409, "Unified editing supplement did not persist its run summary.")
        summary["integratedEditing"] = {"version": 1, "processType": "UNIFIED", "stages": stages}
        xai._execute(cursor, "XAI_UPDATE_RUN", {**ctx, "summaryJson": xai._json(summary)})


@ml._limit_ml_concurrency
def execute(conn, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if method not in METHODS:
        raise HTTPException(400, f"Unsupported unified editing method: {method}")
    ctx, legacy_payload, mixed_payload = _payloads(payload)
    # Fail before modifying the established results if the optional schema has
    # not yet been installed. No schema installation occurs during analysis.
    with conn.cursor() as cursor:
        patterns.require_schema(cursor)
        previous = _summary(cursor, ctx)
    stage = METHODS[method]
    if stage == "PROFILE":
        legacy = _profile_types(conn, legacy_payload, ctx)
        mixed = diagnostics.profile(conn, mixed_payload)
    elif stage == "RELATION":
        legacy = _require_complete(ml.run_integrated_relation_cluster(conn, legacy_payload), "relation analysis")
        mixed = diagnostics.relationships(conn, mixed_payload)
    elif stage == "DISCOVER":
        _default_model(legacy_payload, ctx)
        legacy = _require_complete(ml.run_integrated_rule_discover(conn, legacy_payload), "rule discovery")
        mixed = patterns.discover(conn, mixed_payload)
    else:
        legacy = _require_complete(ml.run_integrated_rule_violation_detect(conn, legacy_payload), "violation detection")
        mixed = xai.detect(conn, mixed_payload)
    result = _combined(stage, ctx, _require_complete(legacy, "existing analysis"),
                       _require_complete(mixed, "mixed supplement"))
    _persist_stage(conn, ctx, previous, result)
    return result


def profile(conn, payload):
    return execute(conn, "UNIFIED_EDITING_PROFILE", payload)


def relationships(conn, payload):
    return execute(conn, "UNIFIED_EDITING_RELATION", payload)


def discover(conn, payload):
    return execute(conn, "UNIFIED_EDITING_DISCOVER", payload)


def detect(conn, payload):
    return execute(conn, "UNIFIED_EDITING_DETECT", payload)
