from fastapi import APIRouter, Request, Query
from pydantic import BaseModel, ConfigDict
from typing import Any, Dict, Optional

from backend.target_database import get_target_db_connection
from backend.runtime_settings import apply_server_resource_limits
from backend.services import ml_analysis_service
from backend.auth_context import get_request_user_id, get_request_role_code


router = APIRouter()


def _run_mixed_xai(req, request, operation):
    from backend.services import mixed_xai_service
    conn = None
    try:
        conn = get_target_db_connection(request)
        payload = request_payload(req, request)
        mixed_xai_service.require_scope(conn, payload, get_request_user_id(request))
        # A DATA_WORK detection can reference an earlier discovery only in the same user's scope.
        discovery_id = mixed_xai_service._value(payload, "discoveryRunId")
        if discovery_id:
            discovery_payload = {**payload, "P_RUN_ID": discovery_id}
            mixed_xai_service.require_scope(conn, discovery_payload, get_request_user_id(request))
        result = operation(conn, payload)
        conn.commit()
        return result
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


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
    maxSymbolicTerms: Optional[int] = None
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


@router.post("/mixed-xai-profile")
def mixed_xai_profile(req: MlAnalysisRequest, request: Request):
    from backend.services.mixed_analysis_profile_service import profile
    return _run_mixed_xai(req, request, profile)


@router.post("/unified-editing-profile")
def unified_editing_profile(req: MlAnalysisRequest, request: Request):
    from backend.services.integrated_editing_service import profile
    return _run_mixed_xai(req, request, profile)


@router.post("/unified-editing-relation")
def unified_editing_relation(req: MlAnalysisRequest, request: Request):
    from backend.services.integrated_editing_service import relationships
    return _run_mixed_xai(req, request, relationships)


@router.post("/unified-editing-discover")
def unified_editing_discover(req: MlAnalysisRequest, request: Request):
    from backend.services.integrated_editing_service import discover
    return _run_mixed_xai(req, request, discover)


@router.post("/unified-editing-detect")
def unified_editing_detect(req: MlAnalysisRequest, request: Request):
    from backend.services.integrated_editing_service import detect
    return _run_mixed_xai(req, request, detect)


@router.post("/mixed-xai-relation")
def mixed_xai_relation(req: MlAnalysisRequest, request: Request):
    from backend.services.mixed_analysis_profile_service import relationships
    return _run_mixed_xai(req, request, relationships)


@router.post("/mixed-xai-rule-discover")
def mixed_xai_rule_discover(req: MlAnalysisRequest, request: Request):
    from backend.services.mixed_xai_service import discover
    return _run_mixed_xai(req, request, discover)


@router.post("/mixed-xai-rule-detect")
def mixed_xai_rule_detect(req: MlAnalysisRequest, request: Request):
    from backend.services.mixed_xai_service import detect
    return _run_mixed_xai(req, request, detect)


@router.get("/editing-results")
def editing_results(request: Request, flowRunId: int = Query(..., gt=0), targetOwner: str = "", targetTable: str = "",
                    view: str = "rules", family: str = "CONDITION", page: int = Query(1, ge=1, le=1000000),
                    pageSize: int = Query(20, ge=1, le=100), source: str = "ALL", ruleKey: str = "",
                    conditionCount: str = "ALL", excludeZero: bool = False):
    from backend.services.editing_result_service import read_results
    conn = None
    try:
        conn = get_target_db_connection(request)
        include_all_users = not getattr(request.state, "internal_api_user_id", None) and get_request_role_code(request) == "ADMIN"
        return read_results(conn, flowRunId, get_request_user_id(request), include_all_users=include_all_users,
                            target_owner=targetOwner, target_table=targetTable, view=view, family=family,
                            page=page, page_size=pageSize, source=source, rule_key=ruleKey, condition_count=conditionCount, exclude_zero=excludeZero)
    finally:
        if conn:
            conn.close()


@router.get("/mixed-xai-results")
def mixed_xai_results(request: Request, flowRunId: int = Query(..., gt=0), targetOwner: str = "", targetTable: str = "",
                      page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100), includeViolations: bool = False,
                      view: str = "rules", ruleId: str = ""):
    from backend.services.mixed_xai_service import read_results
    conn = None
    try:
        conn = get_target_db_connection(request)
        include_all_users = not getattr(request.state, "internal_api_user_id", None) and get_request_role_code(request) == "ADMIN"
        return read_results(conn, flowRunId, get_request_user_id(request), include_all_users=include_all_users,
                            target_owner=targetOwner, target_table=targetTable, page=page, page_size=pageSize,
                            include_violations=includeViolations, view=view, rule_id=ruleId)
    finally:
        if conn:
            conn.close()
