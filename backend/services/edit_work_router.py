"""Reusable router for M05001-M07003 editing workflow pages."""

from fastapi import APIRouter, HTTPException, Request

from backend.services import edit_work_service as editing


def create_edit_work_router(menu_code: str) -> APIRouter:
    router = APIRouter()

    @router.get("/rules/discovered")
    def list_discovered_rules(
        request: Request,
        projectId: int | None = None,
        scenarioId: int | None = None,
        runSourceType: str | None = None,
        runId: int | None = None,
        targetOwner: str | None = None,
        targetTable: str | None = None,
        ruleGroup: str = "ALL",
        decisionStatus: str = "ALL",
        keyword: str | None = None,
        page: int = 1,
        pageSize: int = 100,
    ):
        return editing.list_rules(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            run_source_type=runSourceType,
            run_id=runId,
            target_owner=targetOwner,
            target_table=targetTable,
            rule_group=ruleGroup,
            decision_status=decisionStatus,
            keyword=keyword,
            page=page,
            page_size=pageSize,
        )

    @router.get("/rules")
    def list_rules(
        request: Request,
        projectId: int | None = None,
        scenarioId: int | None = None,
        decisionStatus: str = "ALL",
        sourceRuleType: str = "ALL",
    ):
        return editing.list_master_rules(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            decision_status=decisionStatus,
            source_rule_type=sourceRuleType,
        )

    @router.post("/rules")
    def save_rule(payload: editing.RuleDecisionRequest, request: Request):
        return editing.save_rule(request, payload)

    @router.post("/rules/validate")
    def validate_user_rule(payload: editing.UserRuleValidationRequest, request: Request):
        return editing.validate_user_rule(request, payload)

    @router.delete("/rules/{edit_rule_id}")
    def delete_user_rule(
        edit_rule_id: int,
        request: Request,
        projectId: int | None = None,
    ):
        return editing.delete_user_rule(
            request,
            edit_rule_id=edit_rule_id,
            project_id=projectId,
        )

    @router.post("/rules/{edit_rule_id}/exclude")
    def exclude_discovered_rule(
        edit_rule_id: int,
        request: Request,
        projectId: int | None = None,
    ):
        return editing.exclude_discovered_rule(
            request,
            edit_rule_id=edit_rule_id,
            project_id=projectId,
        )

    @router.post("/rules/exclude")
    def exclude_discovered_rules(
        payload: editing.RuleBulkExcludeRequest,
        request: Request,
    ):
        return editing.exclude_discovered_rules(request, payload)

    @router.get("/source-tables")
    def list_source_tables(
        request: Request,
        projectId: int | None = None,
        scenarioId: int | None = None,
    ):
        return editing.list_source_tables(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
        )

    @router.get("/editing-tables")
    def list_editing_tables(
        request: Request,
        projectId: int | None = None,
        scenarioId: int | None = None,
    ):
        return editing.list_editing_tables(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
        )

    @router.post("/editing-tables")
    def create_editing_table(
        payload: editing.EditingTableCreateRequest,
        request: Request,
    ):
        return editing.create_editing_table(request, payload)

    @router.get("/source-columns")
    def list_source_columns(
        request: Request,
        projectId: int | None = None,
        scenarioId: int | None = None,
        targetOwner: str = "",
        targetTable: str = "",
    ):
        return editing.list_source_columns(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            target_owner=targetOwner,
            target_table=targetTable,
        )

    @router.get("/violations")
    def list_violations(
        request: Request,
        projectId: int | None = None,
        scenarioId: int | None = None,
        targetOwner: str | None = None,
        targetTable: str | None = None,
        editSessionId: int | None = None,
        editRuleId: int | None = None,
        editRuleIds: str | None = None,
        changeStatus: str = "ALL",
        keyword: str | None = None,
        page: int = 1,
        pageSize: int = 100,
    ):
        selected_rule_ids: list[int] | None = None
        if editRuleIds is not None:
            try:
                selected_rule_ids = sorted({
                    int(value.strip())
                    for value in editRuleIds.split(",")
                    if value.strip() and int(value.strip()) > 0
                })
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail="최종 규칙 ID 목록 형식이 올바르지 않습니다.",
                ) from exc
        return editing.list_violations(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            target_owner=targetOwner,
            target_table=targetTable,
            edit_session_id=editSessionId,
            edit_rule_id=editRuleId,
            edit_rule_ids=selected_rule_ids,
            change_status=changeStatus,
            keyword=keyword,
            page=page,
            page_size=pageSize,
        )

    @router.get("/editing-table-status")
    def editing_table_status(
        request: Request,
        projectId: int | None = None,
        scenarioId: int | None = None,
        targetOwner: str = "",
        targetTable: str = "",
    ):
        return editing.editing_table_status(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            target_owner=targetOwner,
            target_table=targetTable,
        )

    @router.get("/sessions")
    def list_sessions(
        request: Request,
        projectId: int | None = None,
        scenarioId: int | None = None,
        sessionStatus: str = "ALL",
    ):
        return editing.list_sessions(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            session_status=sessionStatus,
        )

    @router.post("/sessions")
    def create_session(payload: editing.EditSessionCreateRequest, request: Request):
        return editing.create_session(request, payload)

    @router.delete("/sessions/{edit_session_id}")
    def delete_session(edit_session_id: int, request: Request):
        return editing.delete_session(request, edit_session_id)

    @router.post("/sessions/{edit_session_id}/prepare")
    def prepare_session(edit_session_id: int, request: Request):
        return editing.prepare_session(request, edit_session_id)

    @router.post("/sessions/{edit_session_id}/changes")
    def save_change(
        edit_session_id: int,
        payload: editing.EditChangeRequest,
        request: Request,
    ):
        return editing.save_change(request, edit_session_id, payload)

    @router.post("/sessions/{edit_session_id}/changes/bulk")
    def save_changes(
        edit_session_id: int,
        payload: editing.EditChangeBulkRequest,
        request: Request,
    ):
        return editing.save_changes(request, edit_session_id, payload)

    @router.get("/sessions/{edit_session_id}/changes")
    def list_changes(edit_session_id: int, request: Request):
        return editing.list_changes(request, edit_session_id)

    @router.get("/sessions/{edit_session_id}/validation")
    def validation_summary(edit_session_id: int, request: Request):
        return editing.validation_summary(request, edit_session_id)

    @router.post("/sessions/{edit_session_id}/validate")
    def mark_validated(edit_session_id: int, request: Request):
        return editing.mark_validated(request, edit_session_id)

    @router.post("/sessions/{edit_session_id}/reanalysis")
    def link_reanalysis(
        edit_session_id: int,
        payload: editing.ReanalysisLinkRequest,
        request: Request,
    ):
        return editing.link_reanalysis(request, edit_session_id, payload)

    @router.post("/sessions/{edit_session_id}/dml/generate")
    def generate_dml(edit_session_id: int, request: Request):
        return editing.generate_dml(request, edit_session_id)

    @router.get("/dml")
    def list_dml(request: Request, editSessionId: int | None = None):
        return editing.list_dml(request, editSessionId)

    @router.post("/dml")
    def save_dml(payload: editing.EditDmlRequest, request: Request):
        return editing.save_dml(request, payload)

    @router.post("/dml/validate")
    def validate_dml(payload: editing.EditDmlValidateRequest, request: Request):
        return editing.validate_dml(request, payload)

    @router.delete("/dml/{edit_dml_id}")
    def delete_dml(edit_dml_id: int, request: Request):
        return editing.delete_dml(request, edit_dml_id)

    @router.post("/dml/{edit_dml_id}/approve")
    def approve_dml(edit_dml_id: int, request: Request):
        return editing.approve_dml(request, edit_dml_id)

    @router.post("/dml/{edit_dml_id}/execute")
    def execute_dml(edit_dml_id: int, request: Request):
        return editing.execute_dml(request, edit_dml_id)

    @router.get("/history")
    def list_history(
        request: Request,
        editSessionId: int | None = None,
        projectId: int | None = None,
        eventType: str = "ALL",
    ):
        return editing.list_history(
            request,
            edit_session_id=editSessionId,
            project_id=projectId,
            event_type=eventType,
        )

    return router
