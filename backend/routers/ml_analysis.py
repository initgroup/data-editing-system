from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict
from typing import Any, Dict, Optional

from backend.target_database import get_target_db_connection
from backend.runtime_settings import apply_server_resource_limits
from backend.services import ml_analysis_service


router = APIRouter()


class MlAnalysisRequest(BaseModel):
    targetOwner: Optional[str] = None
    targetTable: Optional[str] = None
    targetColumn: Optional[str] = None
    candidateColumns: Optional[Any] = None
    featureColumns: Optional[Any] = None
    maxFeatures: Optional[int] = None
    maxEdges: Optional[int] = None
    minMetric: Optional[float] = None
    relationTypes: Optional[Any] = None
    metricNames: Optional[Any] = None
    sampleRows: Optional[int] = None
    maxIterations: Optional[int] = None
    alpha: Optional[float] = None
    runSourceType: Optional[str] = "DATA_WORK"
    runId: Optional[int] = 0
    extra: Optional[Dict[str, Any]] = None
    model_config = ConfigDict(extra="allow")


def request_payload(req: MlAnalysisRequest, request: Request) -> Dict[str, Any]:
    payload = dict(req.extra or {})
    payload.update(req.model_dump(exclude={"extra"}, exclude_none=True))
    return apply_server_resource_limits(
        payload,
        getattr(request.state, "server_resource_limits", None),
    )


@router.post("/lasso-feature-select")
def lasso_feature_select(req: MlAnalysisRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = ml_analysis_service.run_lasso_feature_select(conn, request_payload(req, request))
        conn.commit()
        return result
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


@router.post("/symbolic-regression-rule")
def symbolic_regression_rule(req: MlAnalysisRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = ml_analysis_service.run_symbolic_regression_rule(conn, request_payload(req, request))
        conn.commit()
        return result
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


@router.post("/relation-network-cluster")
def relation_network_cluster(req: MlAnalysisRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = ml_analysis_service.run_relation_network_cluster(conn, request_payload(req, request))
        conn.commit()
        return result
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


@router.post("/integrated-relation-cluster")
def integrated_relation_cluster(req: MlAnalysisRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = ml_analysis_service.run_integrated_relation_cluster(conn, request_payload(req, request))
        conn.commit()
        return result
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


@router.post("/integrated-rule-discover")
def integrated_rule_discover(req: MlAnalysisRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = ml_analysis_service.run_integrated_rule_discover(conn, request_payload(req, request))
        conn.commit()
        return result
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


@router.post("/integrated-rule-violation-detect")
def integrated_rule_violation_detect(req: MlAnalysisRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = ml_analysis_service.run_integrated_rule_violation_detect(conn, request_payload(req, request))
        conn.commit()
        return result
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()
