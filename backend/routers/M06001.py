"""M06001 structured editing report APIs."""

from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request, Response

from backend.services.structured_report_renderers import (
    render_report_bundle_html,
    render_report_bundle_xlsx,
    render_report_html,
    render_report_pdf,
    render_report_xlsx,
    safe_report_filename,
)
from backend.services.structured_report_service import (
    build_batch_report_document,
    build_report_document,
    get_report_catalog,
    get_report_context,
    json_compatible,
    list_projects,
)


logger = logging.getLogger(__name__)
router = APIRouter()


def _apply_private_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"


def _raise_sanitized_http_error(error: HTTPException, public_detail: str) -> None:
    if error.status_code < 500:
        raise error
    logger.error("M06001 upstream error: %s", error.detail, exc_info=True)
    raise HTTPException(status_code=error.status_code, detail=public_detail) from error


def _download_headers(file_name: str) -> dict[str, str]:
    extension = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "bin"
    if extension not in {"html", "xlsx", "pdf"}:
        extension = "bin"
    return {
        "Content-Disposition": (
            f"attachment; filename=\"IN-DEPS-report.{extension}\"; "
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
        return list_projects(request, keyword=keyword, page=page, page_size=pageSize)
    except HTTPException as error:
        _raise_sanitized_http_error(error, "Project report data could not be loaded.")
    except Exception as error:
        logger.exception("M06001 project list failed")
        raise HTTPException(status_code=500, detail="Project report data could not be loaded.") from error


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
        _raise_sanitized_http_error(error, "Report context could not be loaded.")
    except Exception as error:
        logger.exception("M06001 context load failed")
        raise HTTPException(status_code=500, detail="Report context could not be loaded.") from error


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
        return get_report_catalog(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            flow_run_id=flowRunId,
            edit_session_id=editSessionId,
            language=lang,
        )
    except HTTPException as error:
        _raise_sanitized_http_error(error, "Report catalog could not be loaded.")
    except Exception as error:
        logger.exception("M06001 catalog load failed")
        raise HTTPException(status_code=500, detail="Report catalog could not be loaded.") from error


@router.get("/reports/batch/download")
def download_batch_report(
    request: Request,
    projectId: int = Query(..., gt=0),
    scenarioId: int | None = Query(None, gt=0),
    flowRunId: int | None = Query(None, gt=0),
    editSessionId: int | None = Query(None, gt=0),
    format: str = Query(..., pattern="^(html|xlsx|pdf)$"),
    lang: str = Query("ko", pattern="^(ko|en)$"),
):
    try:
        document = build_batch_report_document(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            flow_run_id=flowRunId,
            edit_session_id=editSessionId,
            language=lang,
        )
        context_data = document.get("context") or {}
        project = context_data.get("project") or {}
        scenario = context_data.get("scenario") or {}
        file_stem = safe_report_filename(
            "_".join(
                str(item)
                for item in (
                    "IN-DEPS",
                    "ALL",
                    project.get("PROJECT_CODE") or project.get("PROJECT_NAME") or "PROJECT",
                    scenario.get("SCENARIO_CODE") or scenario.get("SCENARIO_NAME") or "ALL",
                )
                if item
            )
        )
        if format == "html":
            content = render_report_bundle_html(document)
            media_type = "text/html; charset=utf-8"
            extension = "html"
        elif format == "xlsx":
            content = render_report_bundle_xlsx(document)
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            extension = "xlsx"
        else:
            html_content = render_report_bundle_html(document)
            content = render_report_pdf(html_content, batch=True)
            media_type = "application/pdf"
            extension = "pdf"
        return Response(
            content=content,
            media_type=media_type,
            headers=_download_headers(f"{file_stem}.{extension}"),
        )
    except HTTPException as error:
        _raise_sanitized_http_error(error, "The combined report file could not be generated.")
    except Exception as error:
        logger.exception("M06001 batch report download failed. format=%s", format)
        raise HTTPException(status_code=500, detail="The combined report file could not be generated.") from error


@router.get("/reports/batch")
def batch_report_detail(
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
        document = build_batch_report_document(
            request,
            project_id=projectId,
            scenario_id=scenarioId,
            flow_run_id=flowRunId,
            edit_session_id=editSessionId,
            language=lang,
        )
        return {"status": "success", "data": json_compatible(document)}
    except HTTPException as error:
        _raise_sanitized_http_error(error, "Combined report details could not be loaded.")
    except Exception as error:
        logger.exception("M06001 batch report detail failed")
        raise HTTPException(status_code=500, detail="Combined report details could not be loaded.") from error


@router.get("/reports/{report_code}/download")
def download_report(
    report_code: str,
    request: Request,
    projectId: int = Query(..., gt=0),
    scenarioId: int | None = Query(None, gt=0),
    flowRunId: int | None = Query(None, gt=0),
    editSessionId: int | None = Query(None, gt=0),
    format: str = Query(..., pattern="^(html|xlsx|pdf)$"),
    lang: str = Query("ko", pattern="^(ko|en)$"),
):
    try:
        document = build_report_document(
            request,
            report_code=report_code,
            project_id=projectId,
            scenario_id=scenarioId,
            flow_run_id=flowRunId,
            edit_session_id=editSessionId,
            language=lang,
        )
        report = document.get("report") or {}
        context_data = document.get("context") or {}
        project = context_data.get("project") or {}
        scenario = context_data.get("scenario") or {}
        file_stem = safe_report_filename(
            "_".join(
                str(item)
                for item in (
                    "IN-DEPS",
                    str(report.get("code") or report_code).upper(),
                    project.get("PROJECT_CODE") or project.get("PROJECT_NAME") or "PROJECT",
                    scenario.get("SCENARIO_CODE") or scenario.get("SCENARIO_NAME") or "ALL",
                )
                if item
            )
        )
        if format == "html":
            content = render_report_html(document)
            media_type = "text/html; charset=utf-8"
            extension = "html"
        elif format == "xlsx":
            content = render_report_xlsx(document)
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            extension = "xlsx"
        else:
            html_content = render_report_html(document)
            content = render_report_pdf(html_content)
            media_type = "application/pdf"
            extension = "pdf"
        return Response(
            content=content,
            media_type=media_type,
            headers=_download_headers(f"{file_stem}.{extension}"),
        )
    except HTTPException as error:
        _raise_sanitized_http_error(error, "The report file could not be generated.")
    except Exception as error:
        logger.exception("M06001 report download failed. report=%s format=%s", report_code, format)
        raise HTTPException(status_code=500, detail="The report file could not be generated.") from error


@router.get("/reports/{report_code}")
def report_detail(
    report_code: str,
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
        document = build_report_document(
            request,
            report_code=report_code,
            project_id=projectId,
            scenario_id=scenarioId,
            flow_run_id=flowRunId,
            edit_session_id=editSessionId,
            language=lang,
        )
        return {"status": "success", "data": json_compatible(document)}
    except HTTPException as error:
        _raise_sanitized_http_error(error, "Report details could not be loaded.")
    except Exception as error:
        logger.exception("M06001 report detail failed. report=%s", report_code)
        raise HTTPException(status_code=500, detail="Report details could not be loaded.") from error
