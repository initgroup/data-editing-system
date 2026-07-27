"""
@file           [M02002].py 
@description    [대상 테이블 선정]
@author         [인아이티 김진열]
@date           2026-06-12
@version        1.0.0

[수정 이력]:
- 2026-06-12: 최초 생성 및 기본 기능 구현
@Copyright (c) 2026 [init]. All rights reserved.
@vLicense: MIT License
"""

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from typing import Optional
import logging
import re
import time
import uuid

from backend.database_helper import execute_query, SqlLoader
from backend.database import get_db_connection
from backend.target_database import get_target_connection_id, get_target_db_connection
from backend.auth_context import get_request_role_code, get_request_user_id
from backend.paging import create_page_window, normalize_page_number, normalize_page_size

logger = logging.getLogger(__name__)
router = APIRouter()
MANAGED_SOURCE_PREFIX = "INITUP$"
EDIT_TABLE_PREFIX = "INITDN$"
CASE_ID_COLUMN = "FILE_ROW_NO"


class TableRequest(BaseModel):
    owner: Optional[str] = None
    tableName: Optional[str] = None
    projectId: Optional[int] = None
    scenarioId: Optional[int] = None
    limit: Optional[int] = 100
    page: Optional[int] = 1
    model_config = ConfigDict(extra="allow")


class SqlRequest(BaseModel):
    sql: str
    limit: Optional[int] = 100
    page: Optional[int] = 1
    model_config = ConfigDict(extra="allow")


class ScenarioTableRequest(BaseModel):
    scenarioTableId: Optional[int] = None
    projectId: Optional[int] = None
    scenarioId: Optional[int] = None
    ownerName: Optional[str] = None
    tableName: Optional[str] = None
    tableComment: Optional[str] = None
    useYn: Optional[str] = "Y"
    sortOrder: Optional[int] = None
    model_config = ConfigDict(extra="allow")


class ScenarioTableDeleteRequest(BaseModel):
    scenarioTableId: int
    projectId: int
    scenarioId: int
    model_config = ConfigDict(extra="allow")


class ScenarioTableDeleteAllRequest(BaseModel):
    projectId: int
    scenarioId: int
    model_config = ConfigDict(extra="allow")


class ScenarioTableDropRequest(BaseModel):
    scenarioTableId: Optional[int] = None
    projectId: int
    scenarioId: Optional[int] = None
    ownerName: Optional[str] = None
    tableName: Optional[str] = None
    model_config = ConfigDict(extra="allow")


@router.get("/table-tree")
def get_table_tree(
    request: Request,
    keyword: str = Query(""),
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
    registeredOnly: str = Query("N"),
    projectId: Optional[int] = Query(None),
    scenarioId: Optional[int] = Query(None),
):
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        ensure_upload_table_metadata(cursor)
        cursor.close()
        cursor = None
        exclude_patterns = get_table_exclude_patterns(request)
        include_owner_patterns = get_table_include_owner_patterns(request, conn)
        safe_offset = max(0, int(offset or 0))
        safe_limit = max(1, min(int(limit or 200), 500))
        keyword_text = str(keyword or "").strip().upper()
        registered_only = str(registeredOnly or "N").strip().upper() == "Y"
        selected_project_id = require_int(projectId, "projectId") if projectId is not None else None
        selected_scenario_id = require_int(scenarioId, "scenarioId") if scenarioId is not None else None
        if registered_only and selected_project_id is None:
            raise HTTPException(status_code=400, detail="projectId is required for registered table filtering.")
        padded_excludes = (exclude_patterns + [None] * 5)[:5]
        result = execute_query(conn, "M02002_TABLE_TREE", {
            "keyword": f"%{keyword_text}%" if keyword_text else None,
            "ownerPattern": include_owner_patterns[0] if include_owner_patterns else None,
            "excludePattern1": padded_excludes[0],
            "excludePattern2": padded_excludes[1],
            "excludePattern3": padded_excludes[2],
            "excludePattern4": padded_excludes[3],
            "excludePattern5": padded_excludes[4],
            "registeredOnly": "Y" if registered_only else "N",
            "projectId": selected_project_id,
            "scenarioId": selected_scenario_id,
            "offset": safe_offset,
            "endRow": safe_offset + safe_limit + 1,
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Table tree query failed.")
        raw_data = result.get("data", [])
        has_more = len(raw_data) > safe_limit
        data = raw_data[:safe_limit]
        return {
            "status": "success",
            "data": data,
            "columns": result.get("columns", []),
            "total": len(data),
            "offset": safe_offset,
            "limit": safe_limit,
            "nextOffset": safe_offset + len(data),
            "hasMore": has_more
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/table-info")
def get_table_info(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02002_TABLE_INFO", {
            "owner": owner,
            "tableName": table_name,
            "projectId": req.projectId,
            "scenarioId": req.scenarioId,
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Table info query failed.")
        data = result.get("data", [])
        return {
            "status": "success",
            "data": data[0] if data else {},
            "columns": result.get("columns", []),
            "total": len(data)
        }
    finally:
        if conn:
            conn.close()


@router.post("/columns")
def get_columns(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02002_TABLE_COLUMNS", {"owner": owner, "tableName": table_name})
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Column query failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
    finally:
        if conn:
            conn.close()


@router.post("/data")
def get_table_data(req: TableRequest, request: Request):
    owner, table_name = require_table(req)
    limit = normalize_page_size(req.limit)
    page = normalize_page_number(req.page)
    qualified_table = quote_identifier(owner) + "." + quote_identifier(table_name)
    conn = None
    try:
        conn = get_target_db_connection(request)
        exists_result = execute_query(
            conn,
            "M02002_SOURCE_TABLE_EXISTS",
            {"ownerName": owner, "tableName": table_name},
        )
        exists_rows = exists_result.get("data", []) if exists_result.get("status") == "success" else []
        if not exists_rows or int(exists_rows[0].get("TABLE_COUNT") or 0) <= 0:
            raise HTTPException(status_code=404, detail="The selected table has not been created or no longer exists.")
        count_result = execute_query(
            conn,
            "M02002_TABLE_DATA_COUNT",
            {
                "dynamicTable": qualified_table
            }
        )
        if count_result.get("status") != "success":
            raise HTTPException(status_code=500, detail=count_result.get("detail") or count_result.get("message") or "Data count query failed.")
        total_rows = count_result.get("data", [])
        total = int(total_rows[0].get("TOTAL_COUNT") or 0) if total_rows else 0
        page_window = create_page_window(page, limit, total)
        result = execute_query(
            conn,
            "M02002_TABLE_DATA_PAGE",
            {
                "dynamicTable": qualified_table,
                "offset": page_window.offset,
                "limit": page_window.page_size
            }
        )
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Data query failed.")
        response = {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": total
        }
        response.update(page_window.response_metadata())
        return response
    finally:
        if conn:
            conn.close()


@router.post("/sql")
def execute_sql(req: SqlRequest, request: Request):
    sql = normalize_select_sql(req.sql)
    limit = normalize_page_size(req.limit)
    page = normalize_page_number(req.page)
    conn = None
    try:
        conn = get_target_db_connection(request)
        count_result = execute_query(
            conn,
            "M02002_SQL_WORKSHEET_COUNT",
            {
                "dynamicSql": sql
            }
        )
        if count_result.get("status") != "success":
            raise HTTPException(status_code=500, detail=count_result.get("detail") or count_result.get("message") or "SQL count query failed.")
        total_rows = count_result.get("data", [])
        total = int(total_rows[0].get("TOTAL_COUNT") or 0) if total_rows else 0
        page_window = create_page_window(page, limit, total)
        result = execute_query(
            conn,
            "M02002_SQL_WORKSHEET_PAGE",
            {
                "dynamicSql": sql,
                "offset": page_window.offset,
                "limit": page_window.page_size
            }
        )
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "SQL execution failed.")
        response = {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": total
        }
        response.update(page_window.response_metadata())
        return response
    finally:
        if conn:
            conn.close()


@router.get("/scenario-tables")
def get_scenario_tables(request: Request, projectId: int, scenarioId: Optional[int] = None):
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        ensure_upload_table_metadata(cursor)
        cursor.close()
        cursor = None
        result = execute_query(conn, "M02002_SCENARIO_TABLE_LIST", {
            "projectId": projectId,
            "scenarioId": scenarioId
        })
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Scenario table query failed.")
        return {
            "status": "success",
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "total": result.get("total", 0)
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/scenario-table/save")
def save_scenario_table(req: ScenarioTableRequest, request: Request):
    project_id = require_int(req.projectId, "projectId")
    scenario_id = require_int(req.scenarioId, "scenarioId")
    owner_name = (req.ownerName or "").strip().upper()
    table_name = (req.tableName or "").strip().upper()
    if not owner_name or not table_name:
        raise HTTPException(status_code=400, detail="ownerName and tableName are required.")
    if not is_identifier(owner_name) or not is_identifier(table_name):
        raise HTTPException(status_code=400, detail="Invalid owner or table name.")

    params = {
        "scenarioTableId": req.scenarioTableId,
        "projectId": project_id,
        "scenarioId": scenario_id,
        "ownerName": owner_name,
        "tableName": table_name,
        "tableComment": req.tableComment or "",
        "useYn": "N" if str(req.useYn or "Y").upper() == "N" else "Y",
        "sortOrder": req.sortOrder
    }

    conn = None
    cursor = None
    created_snapshot: Optional[tuple[str, str]] = None
    pending_column_mappings: list[dict] = []
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        require_project_scenario_access(cursor, request, project_id, scenario_id)
        ensure_upload_table_metadata(cursor)
        ensure_table_column_map(cursor)
        if req.scenarioTableId:
            cursor.execute(
                SqlLoader.get_sql("M02002_SCENARIO_TABLE_BY_ID"),
                {
                    "scenarioTableId": req.scenarioTableId,
                    "projectId": project_id,
                    "scenarioId": scenario_id,
                },
            )
            current = cursor.fetchone()
            if not current:
                raise HTTPException(status_code=404, detail="The scenario table registration was not found.")
            if current[3] and current[4]:
                update_params = {
                    "scenarioTableId": req.scenarioTableId,
                    "projectId": project_id,
                    "scenarioId": scenario_id,
                    "tableComment": params["tableComment"],
                    "useYn": params["useYn"],
                    "sortOrder": params["sortOrder"]
                }
                cursor.execute(SqlLoader.get_sql("M02002_SCENARIO_TABLE_UPDATE"), update_params)
            else:
                mapping = prepare_table_mapping(
                    cursor,
                    project_id=project_id,
                    scenario_id=scenario_id,
                    source_owner=str(current[1] or owner_name).upper(),
                    source_table=str(current[2] or table_name).upper(),
                    source_comment=params["tableComment"],
                    scenario_table_id=req.scenarioTableId,
                )
                if mapping.get("createdSnapshot"):
                    created_snapshot = (mapping["ownerName"], mapping["tableName"])
                pending_column_mappings = list(mapping.get("columnMappings") or [])
                cursor.execute(
                    SqlLoader.get_sql("M02002_SCENARIO_TABLE_MAPPING_UPDATE"),
                    {
                        **mapping_params(mapping),
                        "scenarioTableId": req.scenarioTableId,
                        "projectId": project_id,
                        "scenarioId": scenario_id,
                        "useYn": params["useYn"],
                        "sortOrder": params["sortOrder"],
                    },
                )
            scenario_table_id = req.scenarioTableId
        else:
            mapping = prepare_table_mapping(
                cursor,
                project_id=project_id,
                scenario_id=scenario_id,
                source_owner=owner_name,
                source_table=table_name,
                source_comment=params["tableComment"],
            )
            if mapping.get("createdSnapshot"):
                created_snapshot = (mapping["ownerName"], mapping["tableName"])
            pending_column_mappings = list(mapping.get("columnMappings") or [])
            insert_params = {
                **{key: value for key, value in params.items() if key != "scenarioTableId"},
                **mapping_params(mapping),
            }
            cursor.execute(SqlLoader.get_sql("M02002_SCENARIO_TABLE_INSERT"), insert_params)
            cursor.execute(SqlLoader.get_sql("M02002_SCENARIO_TABLE_ID_BY_KEY"), {
                "projectId": project_id,
                "scenarioId": scenario_id,
                "ownerName": mapping["ownerName"],
                "tableName": mapping["tableName"]
            })
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Saved scenario table ID could not be found.")
            scenario_table_id = row[0]
        save_column_mappings(cursor, int(scenario_table_id), pending_column_mappings)
        conn.commit()

        result = execute_query(conn, "M02002_SCENARIO_TABLE_LIST", {
            "projectId": project_id,
            "scenarioId": scenario_id
        })
        data = result.get("data", [])
        saved = next((row for row in data if row.get("SCENARIO_TABLE_ID") == scenario_table_id), None)
        return {
            "status": "success",
            "message": (
                "DB table snapshot imported and saved."
                if created_snapshot
                else "Scenario table saved."
            ),
            "data": saved or {},
            "list": data,
            "snapshotCreated": bool(created_snapshot),
        }
    except HTTPException:
        if conn:
            conn.rollback()
        if cursor and created_snapshot:
            drop_created_snapshot(cursor, *created_snapshot)
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        if cursor and created_snapshot:
            drop_created_snapshot(cursor, *created_snapshot)
        logger.exception("M02002 scenario table save failed.")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/scenario-table/delete")
def delete_scenario_table(req: ScenarioTableDeleteRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02002_SCENARIO_TABLE_DELETE", {
            "scenarioTableId": req.scenarioTableId,
            "projectId": req.projectId,
            "scenarioId": req.scenarioId
        }, is_dml=True)
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Scenario table delete failed.")
        return {
            "status": "success",
            "message": "Scenario table registration removed.",
            "deletedCount": result.get("rowcount", 0)
        }
    finally:
        if conn:
            conn.close()


@router.post("/scenario-table/registration")
def get_scenario_table_registration(req: TableRequest, request: Request):
    project_id = require_int(req.projectId, "projectId")
    scenario_id = require_int(req.scenarioId, "scenarioId")
    owner_name, table_name = require_table(req)
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        require_project_scenario_access(cursor, request, project_id, scenario_id)
        cursor.execute(
            SqlLoader.get_sql("M02002_SCENARIO_TABLE_BY_PHYSICAL_TABLE"),
            {
                "projectId": project_id,
                "scenarioId": scenario_id,
                "ownerName": owner_name,
                "tableName": table_name,
            },
        )
        row = cursor.fetchone()
        if not row:
            return {"status": "success", "data": None}
        columns = [item[0] for item in cursor.description]
        return {
            "status": "success",
            "data": dict(zip(columns, row)),
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/scenario-table/delete-all")
def delete_all_scenario_tables(req: ScenarioTableDeleteAllRequest, request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        result = execute_query(conn, "M02002_SCENARIO_TABLE_DELETE_ALL", {
            "projectId": req.projectId,
            "scenarioId": req.scenarioId
        }, is_dml=True)
        if result.get("status") != "success":
            raise HTTPException(status_code=500, detail=result.get("detail") or result.get("message") or "Scenario table delete failed.")
        return {
            "status": "success",
            "message": "Scenario table registrations removed.",
            "deletedCount": result.get("rowcount", 0)
        }
    finally:
        if conn:
            conn.close()


@router.post("/scenario-table/drop-managed")
def drop_managed_scenario_table(req: ScenarioTableDropRequest, request: Request):
    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        project_id = require_int(req.projectId, "projectId")
        scenario_id = require_int(req.scenarioId, "scenarioId")
        require_project_scenario_access(cursor, request, project_id, scenario_id)
        owner_name = str(req.ownerName or "").strip().upper()
        table_name = str(req.tableName or "").strip().upper()
        validate_unregistered_managed_drop_target(cursor, owner_name, table_name)

        cursor.execute(
            SqlLoader.get_sql("M02002_SCENARIO_TABLE_BY_PHYSICAL_TABLE"),
            {
                "projectId": project_id,
                "scenarioId": scenario_id,
                "ownerName": owner_name,
                "tableName": table_name,
            },
        )
        registration = cursor.fetchone()
        scenario_table_id = int(registration[0]) if registration else None

        if scenario_table_id is None:
            cursor.execute(
                SqlLoader.get_sql("M02002_MANAGED_TABLE_ANY_REFERENCE_COUNT"),
                {"ownerName": owner_name, "tableName": table_name},
            )
            if int((cursor.fetchone() or [0])[0] or 0) > 0:
                raise HTTPException(
                    status_code=409,
                    detail="This physical table is registered by another scenario and cannot be deleted here.",
                )
            drop_targets = [(owner_name, table_name)]
        else:
            mapping = {
                "ownerName": str(registration[1] or "").upper(),
                "tableName": str(registration[2] or "").upper(),
                "editOwnerName": str(registration[3] or "").upper(),
                "editTableName": str(registration[4] or "").upper(),
            }
            validate_managed_drop_target(cursor, mapping)
            cursor.execute(
                SqlLoader.get_sql("M02002_MANAGED_TABLE_REFERENCE_COUNT"),
                {
                    "scenarioTableId": scenario_table_id,
                    "sourceOwnerName": mapping["ownerName"],
                    "sourceTableName": mapping["tableName"],
                    "editOwnerName": mapping["editOwnerName"],
                    "editTableName": mapping["editTableName"],
                },
            )
            if int((cursor.fetchone() or [0])[0] or 0) > 0:
                raise HTTPException(
                    status_code=409,
                    detail="The physical table is registered by another scenario and cannot be deleted here.",
                )
            drop_targets = [
                (mapping["editOwnerName"], mapping["editTableName"]),
                (mapping["ownerName"], mapping["tableName"]),
            ]

        cursor.execute(SqlLoader.get_sql("M02002_EDIT_SESSION_TABLE_EXISTS"))
        if int((cursor.fetchone() or [0])[0] or 0) > 0:
            if scenario_table_id is None:
                cursor.execute(
                    SqlLoader.get_sql("M02002_EDIT_SESSION_PHYSICAL_TABLE_REFERENCE_COUNT"),
                    {"targetOwner": owner_name, "tableName": table_name},
                )
            else:
                cursor.execute(
                    SqlLoader.get_sql("M02002_EDIT_SESSION_REFERENCE_COUNT"),
                    {
                        "targetOwner": mapping["ownerName"],
                        "sourceTable": mapping["tableName"],
                        "editTable": mapping["editTableName"],
                    },
                )
            if int((cursor.fetchone() or [0])[0] or 0) > 0:
                raise HTTPException(
                    status_code=409,
                    detail="The managed table pair is referenced by editing sessions and cannot be deleted.",
                )

        dropped_tables = []
        for drop_owner, drop_table in drop_targets:
            if drop_table_if_exists(cursor, drop_owner, drop_table):
                dropped_tables.append(f"{drop_owner}.{drop_table}")
        if scenario_table_id is not None:
            cursor.execute(
                SqlLoader.get_sql("M02002_SCENARIO_TABLE_DELETE"),
                {
                    "scenarioTableId": scenario_table_id,
                    "projectId": project_id,
                    "scenarioId": scenario_id,
                },
            )
        conn.commit()
        return {
            "status": "success",
            "message": "Managed table pair dropped." if scenario_table_id is not None else "Physical table dropped.",
            "droppedTables": dropped_tables,
            "registrationRemoved": scenario_table_id is not None,
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as error:
        if conn:
            conn.rollback()
        logger.exception("M02002 managed table drop failed.")
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def prepare_table_mapping(
    cursor,
    *,
    project_id: int,
    scenario_id: int,
    source_owner: str,
    source_table: str,
    source_comment: str,
    scenario_table_id: Optional[int] = None,
) -> dict:
    cursor.execute(
        SqlLoader.get_sql("M02002_SCENARIO_TABLE_BY_ORIGINAL"),
        {
            "projectId": project_id,
            "scenarioId": scenario_id,
            "originalOwnerName": source_owner,
            "originalTableName": source_table,
            "scenarioTableId": scenario_table_id,
        },
    )
    existing = cursor.fetchone()
    if existing:
        raise HTTPException(
            status_code=409,
            detail="This source table is already imported or registered in the selected scenario.",
        )

    cursor.execute(
        SqlLoader.get_sql("M02002_SOURCE_TABLE_EXISTS"),
        {"ownerName": source_owner, "tableName": source_table},
    )
    if int((cursor.fetchone() or [0])[0] or 0) <= 0:
        raise HTTPException(status_code=404, detail="The selected source table was not found.")

    cursor.execute(SqlLoader.get_sql("M02002_CURRENT_SCHEMA"))
    managed_owner = str((cursor.fetchone() or [""])[0] or "").strip().upper()
    if not is_identifier(managed_owner):
        raise HTTPException(status_code=500, detail="The managed table owner could not be resolved.")
    project_code = fetch_project_code(cursor, project_id)

    source_columns = fetch_source_columns(cursor, source_owner, source_table)
    if not source_columns:
        raise HTTPException(status_code=409, detail="The source table has no importable columns.")
    has_case_id_column = any(
        column_name.upper() == CASE_ID_COLUMN
        for column_name in source_columns
    )
    has_managed_case_id_column = CASE_ID_COLUMN in source_columns
    edit_table = create_mapped_table_name(EDIT_TABLE_PREFIX)
    if (
        source_table.startswith(MANAGED_SOURCE_PREFIX)
        and source_owner == managed_owner
        and has_managed_case_id_column
    ):
        return {
            "ownerName": source_owner,
            "tableName": source_table,
            "originalOwnerName": source_owner,
            "originalTableName": source_table,
            "editOwnerName": source_owner,
            "editTableName": edit_table,
            "dataOriginType": "MANAGED_TABLE",
            "caseIdColumn": CASE_ID_COLUMN,
            "importedAt": None,
            "tableComment": source_comment or "",
            "createdSnapshot": False,
            "columnMappings": [],
        }

    managed_column_names = {column.upper() for column in source_columns}
    column_mappings: list[dict] = []
    renamed_columns: dict[str, str] = {}
    if has_case_id_column:
        for column_name in source_columns:
            if column_name.upper() != CASE_ID_COLUMN:
                continue
            managed_column_name = create_available_column_name(
                "SOURCE_FILE_ROW_NO",
                managed_column_names,
            )
            managed_column_names.add(managed_column_name.upper())
            renamed_columns[column_name] = managed_column_name
            column_mappings.append(
                {
                    "sourceColumnName": column_name,
                    "managedColumnName": managed_column_name,
                    "mappingType": "RENAMED_RESERVED_COLUMN",
                }
            )

    managed_table = create_managed_snapshot_table_name(project_code)
    managed_ref = f"{quote_identifier(managed_owner)}.{quote_identifier(managed_table)}"
    source_ref = f"{quote_identifier(source_owner)}.{quote_identifier(source_table)}"
    cursor.execute(SqlLoader.get_sql("M02002_DISABLE_PARALLEL_DML"))
    cursor.execute(SqlLoader.get_sql("M02002_DISABLE_PARALLEL_QUERY"))
    source_select_list = []
    for column_name in source_columns:
        source_expression = f"T.{quote_metadata_identifier(column_name)}"
        managed_column_name = renamed_columns.get(column_name)
        if managed_column_name:
            source_expression += f" AS {quote_identifier(managed_column_name)}"
        source_select_list.append(source_expression)
    cursor.execute(
        f"CREATE TABLE {managed_ref} NOLOGGING AS "
        f"SELECT ROW_NUMBER() OVER (ORDER BY NULL) AS {quote_identifier(CASE_ID_COLUMN)}, "
        f"{', '.join(source_select_list)} FROM {source_ref} T"
    )

    table_comment = fetch_source_table_comment(cursor, source_owner, source_table)
    apply_comment(cursor, f"TABLE {managed_ref}", table_comment)
    apply_comment(
        cursor,
        f"COLUMN {managed_ref}.{quote_identifier(CASE_ID_COLUMN)}",
        "Managed source row number",
    )
    cursor.execute(
        SqlLoader.get_sql("M02002_SOURCE_COLUMN_COMMENTS"),
        {"ownerName": source_owner, "tableName": source_table},
    )
    for column_name, column_comment in cursor.fetchall():
        if column_name:
            managed_column_name = renamed_columns.get(str(column_name), str(column_name))
            apply_comment(
                cursor,
                f"COLUMN {managed_ref}.{quote_metadata_identifier(managed_column_name)}",
                str(column_comment or ""),
            )

    return {
        "ownerName": managed_owner,
        "tableName": managed_table,
        "originalOwnerName": source_owner,
        "originalTableName": source_table,
        "editOwnerName": managed_owner,
        "editTableName": edit_table,
        "dataOriginType": "DB_TABLE_IMPORT",
        "caseIdColumn": CASE_ID_COLUMN,
        "importedAt": None,
        "tableComment": table_comment,
        "createdSnapshot": True,
        "columnMappings": column_mappings,
    }


def fetch_source_columns(cursor, owner_name: str, table_name: str) -> list[str]:
    cursor.execute(
        SqlLoader.get_sql("M02002_SOURCE_COLUMNS"),
        {"ownerName": owner_name, "tableName": table_name},
    )
    return [str(row[0]) for row in cursor.fetchall() if row and row[0]]


def create_available_column_name(base_name: str, used_names: set[str]) -> str:
    normalized_used_names = {str(name).upper() for name in used_names}
    if base_name.upper() not in normalized_used_names:
        return base_name
    suffix = 1
    while True:
        suffix_text = f"_{suffix}"
        candidate = f"{base_name[:128 - len(suffix_text)]}{suffix_text}"
        if candidate.upper() not in normalized_used_names:
            return candidate
        suffix += 1


def quote_metadata_identifier(value: str) -> str:
    text = str(value or "")
    if not text or len(text) > 128 or "\x00" in text:
        raise HTTPException(status_code=400, detail="The source table contains an invalid column name.")
    return f'"{text.replace(chr(34), chr(34) * 2)}"'


def save_column_mappings(cursor, scenario_table_id: int, mappings: list[dict]) -> None:
    for mapping in mappings:
        cursor.execute(
            SqlLoader.get_sql("M02002_TABLE_COLUMN_MAP_MERGE"),
            {
                "scenarioTableId": scenario_table_id,
                "sourceColumnName": mapping["sourceColumnName"],
                "managedColumnName": mapping["managedColumnName"],
                "mappingType": mapping["mappingType"],
            },
        )


def ensure_table_column_map(cursor) -> None:
    cursor.execute(SqlLoader.get_sql("M02002_TABLE_COLUMN_MAP_EXISTS"))
    if int((cursor.fetchone() or [0])[0] or 0) > 0:
        return
    try:
        cursor.execute(SqlLoader.get_sql("M02002_TABLE_COLUMN_MAP_CREATE"))
    except Exception as error:
        if "ORA-00955" not in str(error):
            raise


def ensure_upload_table_metadata(cursor) -> None:
    cursor.execute(SqlLoader.get_sql("M02002_UPLOAD_TABLE_META_EXISTS"))
    if int((cursor.fetchone() or [0])[0] or 0) <= 0:
        try:
            cursor.execute(SqlLoader.get_sql("M02002_UPLOAD_TABLE_META_CREATE"))
        except Exception as error:
            if "ORA-00955" not in str(error):
                raise
    cursor.execute(SqlLoader.get_sql("M02002_UPLOAD_TABLE_META_PROJECT_EXISTS"))
    if int((cursor.fetchone() or [0])[0] or 0) <= 0:
        try:
            cursor.execute(SqlLoader.get_sql("M02002_UPLOAD_TABLE_META_PROJECT_ADD"))
        except Exception as error:
            if "ORA-01430" not in str(error):
                raise


def require_project_scenario_access(
    cursor,
    request: Request,
    project_id: int,
    scenario_id: int,
) -> None:
    cursor.execute(
        SqlLoader.get_sql("M02002_PROJECT_SCENARIO_ACCESS"),
        {
            "projectId": project_id,
            "scenarioId": scenario_id,
            "includeAllUsers": "Y" if get_request_role_code(request) == "ADMIN" else "N",
            "userId": get_request_user_id(request),
        },
    )
    if int((cursor.fetchone() or [0])[0] or 0) <= 0:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to the selected project and scenario.",
        )


def mapping_params(mapping: dict) -> dict:
    return {
        "ownerName": mapping["ownerName"],
        "tableName": mapping["tableName"],
        "originalOwnerName": mapping["originalOwnerName"],
        "originalTableName": mapping["originalTableName"],
        "editOwnerName": mapping["editOwnerName"],
        "editTableName": mapping["editTableName"],
        "dataOriginType": mapping["dataOriginType"],
        "caseIdColumn": CASE_ID_COLUMN,
        "tableComment": mapping["tableComment"],
    }


def create_mapped_table_name(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex.upper()}"


def create_managed_snapshot_table_name(project_code: str) -> str:
    timestamp = str(int(time.time() * 1000))
    normalized_project_code = normalize_identifier_token(project_code) or "PROJECT"
    prefix = "INITUP$_"
    suffix = f"_DB_{timestamp}"
    max_project_length = 128 - len(prefix) - len(suffix)
    return f"{prefix}{normalized_project_code[:max_project_length]}{suffix}"


def normalize_identifier_token(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_$#]", "_", str(value or "").upper())
    return re.sub(r"_+", "_", normalized).strip("_")


def fetch_project_code(cursor, project_id: int) -> str:
    cursor.execute(
        SqlLoader.get_sql("M02002_PROJECT_CODE"),
        {"projectId": project_id},
    )
    row = cursor.fetchone()
    project_code = str((row or [""])[0] or "").strip()
    if not project_code:
        raise HTTPException(status_code=409, detail="The selected project has no project code.")
    return project_code


def fetch_source_table_comment(cursor, owner_name: str, table_name: str) -> str:
    cursor.execute(
        SqlLoader.get_sql("M02002_SOURCE_TABLE_COMMENT"),
        {"ownerName": owner_name, "tableName": table_name},
    )
    row = cursor.fetchone()
    return str(row[0] or "") if row else ""


def apply_comment(cursor, target: str, comment: str) -> None:
    normalized = str(comment or "")
    escaped = normalized.replace("'", "''")
    comment_sql = "''" if not normalized else f"'{escaped}'"
    cursor.execute(f"COMMENT ON {target} IS {comment_sql}")


def drop_created_snapshot(cursor, owner_name: str, table_name: str) -> None:
    try:
        cursor.execute(f"DROP TABLE {quote_identifier(owner_name)}.{quote_identifier(table_name)} PURGE")
    except Exception:
        logger.exception("Failed to clean up incomplete managed snapshot %s.%s", owner_name, table_name)


def validate_managed_drop_target(cursor, mapping: dict) -> None:
    cursor.execute(SqlLoader.get_sql("M02002_CURRENT_SCHEMA"))
    current_schema = str((cursor.fetchone() or [""])[0] or "").upper()
    source_owner = mapping["ownerName"]
    source_table = mapping["tableName"]
    edit_owner = mapping["editOwnerName"]
    edit_table = mapping["editTableName"]
    if (
        source_owner != current_schema
        or edit_owner != current_schema
        or not source_table.startswith(MANAGED_SOURCE_PREFIX)
        or not edit_table.startswith(EDIT_TABLE_PREFIX)
    ):
        raise HTTPException(
            status_code=409,
            detail="Only managed INITUP$ and INITDN$ tables in the current schema can be dropped.",
        )


def validate_unregistered_managed_drop_target(cursor, owner_name: str, table_name: str) -> None:
    cursor.execute(SqlLoader.get_sql("M02002_CURRENT_SCHEMA"))
    current_schema = str((cursor.fetchone() or [""])[0] or "").upper()
    if (
        owner_name != current_schema
        or not is_identifier(owner_name)
        or not is_identifier(table_name)
        or not (table_name.startswith(MANAGED_SOURCE_PREFIX) or table_name.startswith(EDIT_TABLE_PREFIX))
    ):
        raise HTTPException(
            status_code=409,
            detail="Only unregistered INITUP$ or INITDN$ tables in the current schema can be dropped.",
        )


def drop_table_if_exists(cursor, owner_name: str, table_name: str) -> bool:
    cursor.execute(
        SqlLoader.get_sql("M02002_SOURCE_TABLE_EXISTS"),
        {"ownerName": owner_name, "tableName": table_name},
    )
    if int((cursor.fetchone() or [0])[0] or 0) <= 0:
        return False
    cursor.execute(f"DROP TABLE {quote_identifier(owner_name)}.{quote_identifier(table_name)} PURGE")
    return True


def require_table(req: TableRequest) -> tuple[str, str]:
    owner = (req.owner or "").strip().upper()
    table_name = (req.tableName or "").strip().upper()
    if not owner or not table_name:
        raise HTTPException(status_code=400, detail="owner and tableName are required.")
    if not is_identifier(owner) or not is_identifier(table_name):
        raise HTTPException(status_code=400, detail="Invalid owner or table name.")
    return owner, table_name


def require_int(value: Optional[int], field_name: str) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")
    if result <= 0:
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")
    return result


def normalize_limit(value: Optional[int]) -> int:
    try:
        limit = int(value or 100)
    except (TypeError, ValueError):
        limit = 100
    return max(1, min(limit, 1000))


def get_table_exclude_patterns(request: Request) -> list[str]:
    patterns = ["BIN$%", "DM$%", "INIT$%"]
    conn = None
    cursor = None
    try:
        user_id = get_request_user_id(request)
        connection_id = get_target_connection_id(request)
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M02002_EXCLUDE_TABLE_FILTER_SETTING"), {"userId": user_id, "connectionId": connection_id})
        row = cursor.fetchone()
        if row and row[0]:
            raw_value = row[0].read() if hasattr(row[0], "read") else row[0]
            custom_patterns = parse_setting_lines(raw_value)
            if custom_patterns:
                patterns = custom_patterns
    except Exception as e:
        logger.warning(f"M02002 setting pattern load failed, using defaults: {str(e)}")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
    return patterns


def get_table_include_owner_patterns(request: Request, target_conn) -> list[str]:
    patterns = [get_current_target_owner(target_conn)]
    conn = None
    cursor = None
    try:
        user_id = get_request_user_id(request)
        connection_id = get_target_connection_id(request)
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M02002_INCLUDE_OWNER_FILTER_SETTING"), {"userId": user_id, "connectionId": connection_id})
        row = cursor.fetchone()
        if row and row[0]:
            raw_value = row[0].read() if hasattr(row[0], "read") else row[0]
            custom_patterns = parse_setting_lines(raw_value)
            if custom_patterns:
                patterns = custom_patterns
    except Exception as e:
        logger.warning(f"M02002 include owner setting load failed, using current owner: {str(e)}")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
    return [pattern for pattern in patterns if pattern]


def get_current_target_owner(conn) -> str:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("M02002_CURRENT_SCHEMA"))
        row = cursor.fetchone()
        return str(row[0] if row and row[0] else "").strip().upper()
    finally:
        if cursor:
            cursor.close()


def parse_setting_lines(value) -> list[str]:
    return [
        line.strip().upper()
        for line in str(value or "").replace(",", "\n").splitlines()
        if line.strip()
    ]


def is_identifier(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Z][A-Z0-9_$#]*", value))


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def normalize_select_sql(sql: str) -> str:
    text = (sql or "").strip()
    text = re.sub(r";+\s*$", "", text)
    if not re.match(r"(?is)^(select|with)\b", text):
        raise HTTPException(status_code=400, detail="Only SELECT statements are allowed.")
    if re.search(r";\s*\S", sql or ""):
        raise HTTPException(status_code=400, detail="Only a single SELECT statement is allowed.")
    blocked = r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|begin|declare|execute|exec)\b"
    if re.search(blocked, text, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Only read-only SELECT statements are allowed.")
    return text
