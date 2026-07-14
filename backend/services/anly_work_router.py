"""
Factory for reusable analysis-result work routers.
"""

from fastapi import APIRouter, Request

from backend.services import anly_work_service as anly_work


def create_anly_work_router(
    menu_code: str,
    flow_menu_code: str = "M04001",
) -> APIRouter:
    router = APIRouter()
    FLOW_MENU_CODE = flow_menu_code

    @router.get("/runs")
    def list_flow_runs(
        request: Request,
        page: int = 1,
        pageSize: int = 20,
        status: str = "ALL",
        keyword: str | None = None,
        projectId: int | None = None,
        scenarioId: int | None = None,
    ):
        return anly_work.list_flow_runs(
            request=request,
            page=page,
            pageSize=pageSize,
            status=status,
            keyword=keyword,
            projectId=projectId,
            scenarioId=scenarioId,
            flow_menu_code=FLOW_MENU_CODE,
        )

    @router.get("/runs/{flow_run_id}/position")
    def get_flow_run_position(
        flow_run_id: int,
        request: Request,
        pageSize: int = 20,
        status: str = "ALL",
        keyword: str | None = None,
        projectId: int | None = None,
        scenarioId: int | None = None,
    ):
        return anly_work.get_flow_run_position(
            flow_run_id=flow_run_id,
            request=request,
            pageSize=pageSize,
            status=status,
            keyword=keyword,
            projectId=projectId,
            scenarioId=scenarioId,
            flow_menu_code=FLOW_MENU_CODE,
        )

    @router.get("/runs/{flow_run_id}/nodes")
    def list_flow_run_nodes(flow_run_id: int, request: Request):
        return anly_work.list_flow_run_nodes(flow_run_id, request)

    @router.delete("/runs/{flow_run_id}")
    def delete_flow_run(flow_run_id: int, request: Request, force: bool = False):
        return anly_work.delete_flow_run(flow_run_id, request, flow_menu_code=FLOW_MENU_CODE, force=force)

    @router.post("/sql")
    def execute_select_sql(req: anly_work.SqlRequest, request: Request):
        return anly_work.execute_select_sql(req, request)

    @router.get("/result-table")
    def get_result_table(
        request: Request,
        owner: str,
        objectName: str,
        menuCode: str | None = None,
        targetOwner: str | None = None,
        targetTable: str | None = None,
        ruleModelName: str | None = None,
        violationRuleId: str | None = None,
        violationConditionCount: int | None = None,
        violationConfidenceScope: str | None = "NON_PERFECT",
        violationResultScope: str | None = "HIT",
        violationMinConfidence: float = 0.8,
        violationMinLift: float = 1.0,
        violationMaxRules: int = 500,
        violationRulePage: int = 1,
        violationRulePageSize: int = 20,
        symbolicMethod: str | None = None,
        symbolicTargetColumn: str | None = None,
        symbolicViolationMethod: str | None = None,
        symbolicViolationTargetColumn: str | None = None,
        symbolicViolationResultScope: str | None = None,
        predictedTypeCase: str | None = None,
        correlationColA: str | None = None,
        correlationColB: str | None = None,
        relationType: str | None = None,
        relationPassYn: str | None = None,
        relationColA: str | None = None,
        relationColB: str | None = None,
        networkClusterId: str | None = None,
        networkColA: str | None = None,
        networkColB: str | None = None,
        lassoTargetColumn: str | None = None,
        lassoFeatureName: str | None = None,
        lassoDirection: str | None = None,
        lassoMinR2Score: float = 0.7,
        lassoMaxAutoTargets: int = 10,
        lassoAutoTargetYn: str | None = "N",
        runSourceType: str | None = None,
        runId: int | None = None,
        flowRunId: int | None = None,
        page: int = 1,
        pageSize: int = 50,
    ):
        return anly_work.get_result_table(
            request=request,
            owner=owner,
            objectName=objectName,
            menuCode=menuCode,
            targetOwner=targetOwner,
            targetTable=targetTable,
            ruleModelName=ruleModelName,
            violationRuleId=violationRuleId,
            violationConditionCount=violationConditionCount,
            violationConfidenceScope=violationConfidenceScope,
            violationResultScope=violationResultScope,
            violationMinConfidence=violationMinConfidence,
            violationMinLift=violationMinLift,
            violationMaxRules=violationMaxRules,
            violationRulePage=violationRulePage,
            violationRulePageSize=violationRulePageSize,
            symbolicMethod=symbolicMethod,
            symbolicTargetColumn=symbolicTargetColumn,
            symbolicViolationMethod=symbolicViolationMethod,
            symbolicViolationTargetColumn=symbolicViolationTargetColumn,
            symbolicViolationResultScope=symbolicViolationResultScope,
            predictedTypeCase=predictedTypeCase,
            correlationColA=correlationColA,
            correlationColB=correlationColB,
            relationType=relationType,
            relationPassYn=relationPassYn,
            relationColA=relationColA,
            relationColB=relationColB,
            networkClusterId=networkClusterId,
            networkColA=networkColA,
            networkColB=networkColB,
            lassoTargetColumn=lassoTargetColumn,
            lassoFeatureName=lassoFeatureName,
            lassoDirection=lassoDirection,
            lassoMinR2Score=lassoMinR2Score,
            lassoMaxAutoTargets=lassoMaxAutoTargets,
            lassoAutoTargetYn=lassoAutoTargetYn,
            runSourceType=runSourceType,
            runId=runId,
            flowRunId=flowRunId,
            page=page,
            pageSize=pageSize,
        )

    @router.get("/model-view")
    def get_model_view(
        request: Request,
        owner: str,
        modelName: str,
        viewType: str = "VR",
        page: int = 1,
        pageSize: int = 50,
    ):
        return anly_work.get_model_view(request, owner, modelName, viewType, page, pageSize)

    @router.get("/symbolic-rule-sample")
    def get_symbolic_rule_sample(
        request: Request,
        owner: str,
        ruleId: str,
        runSourceType: str,
        runId: int,
        sampleLimit: int = 300,
    ):
        return anly_work.get_symbolic_rule_sample(
            request=request,
            owner=owner,
            ruleId=ruleId,
            runSourceType=runSourceType,
            runId=runId,
            sampleLimit=sampleLimit,
            flow_menu_code=FLOW_MENU_CODE,
        )

    @router.get("/model-detail-summary")
    def get_model_detail_summary(
        request: Request,
        owner: str,
        modelName: str,
        targetOwner: str | None = None,
        targetTable: str | None = None,
        limit: int = 120,
        includeSamples: bool = False,
    ):
        return anly_work.get_model_detail_summary(
            request=request,
            owner=owner,
            modelName=modelName,
            targetOwner=targetOwner,
            targetTable=targetTable,
            limit=limit,
            includeSamples=includeSamples,
        )

    @router.get("/model-rule-summary")
    def get_model_rule_summary(
        request: Request,
        owner: str,
        modelName: str,
        targetOwner: str | None = None,
        targetTable: str | None = None,
        conditionCount: int | None = None,
        resultColumn: str | None = None,
        conditionColumn: str | None = None,
        resultHasValueYn: str | None = None,
        confidenceScope: str | None = None,
        page: int = 1,
        pageSize: int = 20,
        resultColumnPage: int = 1,
        resultColumnPageSize: int = 12,
        runSourceType: str | None = None,
        runId: int | None = None,
        flowRunId: int | None = None,
    ):
        return anly_work.get_model_rule_summary(
            request=request,
            owner=owner,
            modelName=modelName,
            targetOwner=targetOwner,
            targetTable=targetTable,
            conditionCount=conditionCount,
            resultColumn=resultColumn,
            conditionColumn=conditionColumn,
            resultHasValueYn=resultHasValueYn,
            confidenceScope=confidenceScope,
            page=page,
            pageSize=pageSize,
            resultColumnPage=resultColumnPage,
            resultColumnPageSize=resultColumnPageSize,
            runSourceType=runSourceType,
            runId=runId,
            flowRunId=flowRunId,
        )

    @router.get("/model-readable-summary")
    def get_model_readable_summary(request: Request, owner: str, modelName: str):
        return anly_work.get_model_readable_summary(request, owner, modelName)

    return router
