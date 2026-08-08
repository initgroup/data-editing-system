"""M06002 user-owned custom report designer APIs."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from backend.services.custom_report_service import (
    build_custom_preview,
    build_saved_custom_preview,
    delete_template,
    get_designer_catalog,
    get_template,
    list_custom_report_projects,
    list_templates,
    render_custom_preview_html,
    save_template,
)
from backend.services.structured_report_renderers import render_report_pdf, safe_report_filename
from backend.services.structured_report_service import get_report_context


logger = logging.getLogger(__name__)
router = APIRouter()


class TemplateSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default="", max_length=1000)
    paperSize: str = Field(default="A4", min_length=2, max_length=2)
    orientation: str = Field(default="PORTRAIT", min_length=8, max_length=9)
    layout: dict[str, Any]
    expectedVersion: int | None = Field(default=None, ge=1)


class PreviewContextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    projectId: int = Field(gt=0)
    scenarioId: int | None = Field(default=None, gt=0)
    flowRunId: int | None = Field(default=None, gt=0)
    editSessionId: int | None = Field(default=None, gt=0)
    lang: str = Field(default="ko", pattern="^(ko|en)$")


class DraftPreviewRequest(TemplateSaveRequest, PreviewContextRequest):
    model_config = ConfigDict(extra="forbid")


def _apply_private_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"


def _raise_sanitized(error: HTTPException, public_detail: str) -> None:
    if error.status_code < 500:
        raise error
    logger.error("M06002 upstream error: %s", error.detail, exc_info=True)
    raise HTTPException(status_code=error.status_code, detail=public_detail) from error


def _context_kwargs(req: PreviewContextRequest) -> dict[str, int | str | None]:
    return {
        "project_id": req.projectId,
        "scenario_id": req.scenarioId,
        "flow_run_id": req.flowRunId,
        "edit_session_id": req.editSessionId,
        "language": req.lang,
    }


def _download_headers(file_name: str) -> dict[str, str]:
    extension = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "bin"
    if extension not in {"html", "pdf"}:
        extension = "bin"
    return {
        "Content-Disposition": (
            f'attachment; filename="IN-DEPS-Custom-Reports.{extension}"; '
            f"filename*=UTF-8''{quote(file_name)}"
        ),
        "Cache-Control": "private, no-store",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
    }


@router.get("/projects")
def projects(
    request: Request,
    response: Response,
    keyword: str = Query("", max_length=200),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=50),
):
    _apply_private_no_store(response)
    try:
        return list_custom_report_projects(request, keyword=keyword, page=page, page_size=pageSize)
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports projects could not be loaded.")
    except Exception as error:
        logger.exception("M06002 project list failed")
        raise HTTPException(status_code=500, detail="Custom Reports projects could not be loaded.") from error


@router.get("/context")
def context(
    request: Request,
    response: Response,
    projectId: int = Query(..., gt=0),
    scenarioId: int | None = Query(None, gt=0),
    flowRunId: int | None = Query(None, gt=0),
    editSessionId: int | None = Query(None, gt=0),
):
    _apply_private_no_store(response)
    try:
        return get_report_context(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            flow_run_id=flowRunId,
            edit_session_id=editSessionId,
        )
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports context could not be loaded.")
    except Exception as error:
        logger.exception("M06002 context load failed")
        raise HTTPException(status_code=500, detail="Custom Reports context could not be loaded.") from error


@router.get("/catalog")
def catalog(
    request: Request,
    response: Response,
    projectId: int = Query(..., gt=0),
    scenarioId: int | None = Query(None, gt=0),
    flowRunId: int | None = Query(None, gt=0),
    editSessionId: int | None = Query(None, gt=0),
    lang: str = Query("ko", pattern="^(ko|en)$"),
):
    _apply_private_no_store(response)
    try:
        return get_designer_catalog(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            flow_run_id=flowRunId,
            edit_session_id=editSessionId,
            language=lang,
        )
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports catalog could not be loaded.")
    except Exception as error:
        logger.exception("M06002 catalog load failed")
        raise HTTPException(status_code=500, detail="Custom Reports catalog could not be loaded.") from error


@router.get("/templates")
def templates(request: Request, response: Response):
    _apply_private_no_store(response)
    try:
        return list_templates(request)
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports templates could not be loaded.")
    except Exception as error:
        logger.exception("M06002 template list failed")
        raise HTTPException(status_code=500, detail="Custom Reports templates could not be loaded.") from error


@router.post("/templates")
def create_template(
    req: TemplateSaveRequest,
    request: Request,
    response: Response,
    projectId: int | None = Query(None, gt=0),
    scenarioId: int | None = Query(None, gt=0),
):
    _apply_private_no_store(response)
    try:
        saved = save_template(
            request,
            req.model_dump(exclude={"expectedVersion"}),
            project_id=projectId,
            scenario_id=scenarioId,
        )
        return {"status": "success", "message": "Custom Reports template saved.", "data": saved}
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports template could not be saved.")
    except Exception as error:
        logger.exception("M06002 template create failed")
        raise HTTPException(status_code=500, detail="Custom Reports template could not be saved.") from error


@router.post("/preview")
def preview_draft(req: DraftPreviewRequest, request: Request, response: Response):
    _apply_private_no_store(response)
    try:
        payload = req.model_dump(exclude={"projectId", "scenarioId", "flowRunId", "editSessionId", "expectedVersion", "lang"})
        preview = build_custom_preview(request, payload, allow_empty_layout=True, **_context_kwargs(req))
        return {"status": "success", "data": preview}
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports preview could not be generated.")
    except Exception as error:
        logger.exception("M06002 draft preview failed")
        raise HTTPException(status_code=500, detail="Custom Reports preview could not be generated.") from error


@router.get("/templates/{template_id}/render")
def render_saved_template(
    template_id: int,
    request: Request,
    response: Response,
    projectId: int = Query(..., gt=0),
    scenarioId: int | None = Query(None, gt=0),
    flowRunId: int | None = Query(None, gt=0),
    editSessionId: int | None = Query(None, gt=0),
    lang: str = Query("ko", pattern="^(ko|en)$"),
):
    _apply_private_no_store(response)
    try:
        preview = build_saved_custom_preview(
            request,
            template_id,
            project_id=projectId,
            scenario_id=scenarioId,
            flow_run_id=flowRunId,
            edit_session_id=editSessionId,
            language=lang,
        )
        return {"status": "success", "data": preview}
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports output could not be generated.")
    except Exception as error:
        logger.exception("M06002 saved report render failed. template_id=%s", template_id)
        raise HTTPException(status_code=500, detail="Custom Reports output could not be generated.") from error


@router.get("/templates/{template_id}/download")
def download_saved_template(
    template_id: int,
    request: Request,
    projectId: int = Query(..., gt=0),
    scenarioId: int | None = Query(None, gt=0),
    flowRunId: int | None = Query(None, gt=0),
    editSessionId: int | None = Query(None, gt=0),
    format: str = Query(..., pattern="^(html|pdf)$"),
    lang: str = Query("ko", pattern="^(ko|en)$"),
):
    try:
        preview = build_saved_custom_preview(
            request,
            template_id,
            project_id=projectId,
            scenario_id=scenarioId,
            flow_run_id=flowRunId,
            edit_session_id=editSessionId,
            language=lang,
        )
        html_content = render_custom_preview_html(preview)
        content = html_content if format == "html" else render_report_pdf(html_content, batch=True)
        extension = "html" if format == "html" else "pdf"
        media_type = "text/html; charset=utf-8" if format == "html" else "application/pdf"
        template = preview.get("template") or {}
        file_name = safe_report_filename(
            f"IN-DEPS_CUSTOM_REPORTS_{template.get('name') or template_id}"
        )
        return Response(
            content=content,
            media_type=media_type,
            headers=_download_headers(f"{file_name}.{extension}"),
        )
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports file could not be generated.")
    except Exception as error:
        logger.exception("M06002 report download failed. template_id=%s format=%s", template_id, format)
        raise HTTPException(status_code=500, detail="Custom Reports file could not be generated.") from error


@router.post("/templates/{template_id}/preview")
def preview_saved_template(
    template_id: int,
    req: PreviewContextRequest,
    request: Request,
    response: Response,
):
    _apply_private_no_store(response)
    try:
        preview = build_saved_custom_preview(
            request,
            template_id,
            record_usage=True,
            **_context_kwargs(req),
        )
        return {"status": "success", "data": preview}
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports preview could not be generated.")
    except Exception as error:
        logger.exception("M06002 saved preview failed. template_id=%s", template_id)
        raise HTTPException(status_code=500, detail="Custom Reports preview could not be generated.") from error


@router.get("/templates/{template_id}")
def template_detail(template_id: int, request: Request, response: Response):
    _apply_private_no_store(response)
    try:
        return {"status": "success", "data": get_template(request, template_id)}
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports template could not be loaded.")
    except Exception as error:
        logger.exception("M06002 template detail failed. template_id=%s", template_id)
        raise HTTPException(status_code=500, detail="Custom Reports template could not be loaded.") from error


@router.put("/templates/{template_id}")
def update_template(
    template_id: int,
    req: TemplateSaveRequest,
    request: Request,
    response: Response,
    projectId: int | None = Query(None, gt=0),
    scenarioId: int | None = Query(None, gt=0),
):
    _apply_private_no_store(response)
    try:
        saved = save_template(
            request,
            req.model_dump(exclude={"expectedVersion"}),
            template_id=template_id,
            expected_version=req.expectedVersion,
            project_id=projectId,
            scenario_id=scenarioId,
        )
        return {"status": "success", "message": "Custom Reports template updated.", "data": saved}
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports template could not be updated.")
    except Exception as error:
        logger.exception("M06002 template update failed. template_id=%s", template_id)
        raise HTTPException(status_code=500, detail="Custom Reports template could not be updated.") from error


@router.delete("/templates/{template_id}")
def remove_template(template_id: int, request: Request, response: Response):
    _apply_private_no_store(response)
    try:
        deleted_count = delete_template(request, template_id)
        return {
            "status": "success",
            "message": "Custom Reports template deleted.",
            "deletedCount": deleted_count,
        }
    except HTTPException as error:
        _raise_sanitized(error, "Custom Reports template could not be deleted.")
    except Exception as error:
        logger.exception("M06002 template delete failed. template_id=%s", template_id)
        raise HTTPException(status_code=500, detail="Custom Reports template could not be deleted.") from error
