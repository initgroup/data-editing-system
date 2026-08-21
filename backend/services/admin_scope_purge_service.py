import hmac
import logging
import os
import re
from typing import Any, Optional

from fastapi import HTTPException

from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)

SCOPE_PROJECT = "PROJECT"
SCOPE_SCENARIO = "SCENARIO"
MANAGED_SOURCE_PREFIX = "INITUP$"
MANAGED_EDIT_PREFIX = "INITDN$"
IDENTIFIER_PATTERN = re.compile(r"^[A-Z][A-Z0-9_$#]{0,127}$")

IMPACT_LABELS = {
    "SCENARIO_COUNT": "시나리오",
    "SCENARIO_TABLE_COUNT": "시나리오 테이블 등록",
    "DATA_WORK_JOB_COUNT": "데이터 작업",
    "DATA_WORK_RUN_COUNT": "데이터 작업 실행 이력",
    "FLOW_WORK_COUNT": "FLOW",
    "FLOW_WORK_RUN_COUNT": "FLOW 실행 이력",
    "EDIT_RULE_COUNT": "편집 규칙",
    "EDIT_SESSION_COUNT": "편집 실행",
}


def verify_admin_key(admin_key: str) -> None:
    configured_key = os.getenv("INIT_ADMIN_KEY") or ""
    if not configured_key:
        raise HTTPException(
            status_code=503,
            detail="관리자 인증키가 서버에 설정되어 있지 않아 완전 삭제를 실행할 수 없습니다.",
        )
    if not hmac.compare_digest(str(admin_key or ""), configured_key):
        raise HTTPException(status_code=403, detail="관리자 인증키가 일치하지 않습니다.")


def build_purge_preview(
    conn,
    scope_type: str,
    target_id: int,
    *,
    lock_scope: bool = False,
) -> dict[str, Any]:
    normalized_scope = _normalize_scope(scope_type)
    context = _load_context(conn, normalized_scope, target_id, lock_scope=lock_scope)
    project_id = int(context["PROJECT_ID"])
    scenario_id = int(context["SCENARIO_ID"]) if normalized_scope == SCOPE_SCENARIO else None
    params = {"projectId": project_id, "scenarioId": scenario_id}

    current_schema = str(_fetch_one(conn, "ADMIN_PURGE_CURRENT_SCHEMA").get("CURRENT_SCHEMA") or "").upper()
    if not current_schema or not IDENTIFIER_PATTERN.fullmatch(current_schema):
        raise HTTPException(status_code=409, detail="현재 Target 스키마를 안전하게 확인할 수 없습니다.")

    missing_table_rows = _fetch_all(conn, "ADMIN_PURGE_REQUIRED_TABLES_MISSING")
    missing_tables = [str(row.get("TABLE_NAME") or "") for row in missing_table_rows]
    if missing_tables:
        target_code = context["PROJECT_CODE"] if normalized_scope == SCOPE_PROJECT else context["SCENARIO_CODE"]
        target_name = context["PROJECT_NAME"] if normalized_scope == SCOPE_PROJECT else context["SCENARIO_NAME"]
        return {
            "scopeType": normalized_scope,
            "targetId": target_id,
            "targetCode": str(target_code or ""),
            "targetName": str(target_name or ""),
            "projectId": project_id,
            "projectCode": str(context.get("PROJECT_CODE") or ""),
            "projectName": str(context.get("PROJECT_NAME") or ""),
            "ownerUserId": context.get("USER_ID"),
            "ownerEmail": str(context.get("USER_EMAIL") or ""),
            "counts": {
                key: {"label": label, "count": 0}
                for key, label in IMPACT_LABELS.items()
            },
            "managedPairs": [],
            "dropObjects": [],
            "dropObjectCount": 0,
            "activeCounts": {"dataWork": 0, "flowWork": 0},
            "warnings": [],
            "blockers": [
                "안전한 완전 삭제에 필요한 Target 메타 테이블이 누락되었습니다. "
                "먼저 INIT_TARGET_ALTER.sql을 적용하세요. "
                f"(누락: {', '.join(missing_tables)})"
            ],
            "canPurge": False,
        }

    mapping_sql_id = (
        "ADMIN_PURGE_PROJECT_MANAGED_TABLES"
        if normalized_scope == SCOPE_PROJECT
        else "ADMIN_PURGE_SCENARIO_MANAGED_TABLES"
    )
    mapping_rows = _fetch_all(conn, mapping_sql_id, params)
    managed_pairs = []
    blockers = []
    warnings = []
    seen_pairs = set()

    for row in mapping_rows:
        pair = _validate_managed_pair(row, current_schema)
        pair_key = (
            pair["sourceOwner"],
            pair["sourceTable"],
            pair["editOwner"],
            pair["editTable"],
        )
        if pair_key in seen_pairs:
            continue
        seen_pairs.add(pair_key)

        if pair["validationError"]:
            blockers.append(pair["validationError"])
            managed_pairs.append(pair)
            continue

        reference_count = int(
            _fetch_one(
                conn,
                "ADMIN_PURGE_MANAGED_TABLE_EXTERNAL_REFS",
                {
                    **params,
                    "sourceOwner": pair["sourceOwner"],
                    "sourceTable": pair["sourceTable"],
                    "editOwner": pair["editOwner"],
                    "editTable": pair["editTable"],
                },
            ).get("REFERENCE_COUNT")
            or 0
        )
        owner_rows = _fetch_all(
            conn,
            "ADMIN_PURGE_MANAGED_TABLE_PROJECT_OWNERS",
            {
                "sourceOwner": pair["sourceOwner"],
                "sourceTable": pair["sourceTable"],
                "editOwner": pair["editOwner"],
                "editTable": pair["editTable"],
            },
        )
        owner_project_ids = {
            int(owner_row["PROJECT_ID"])
            for owner_row in owner_rows
            if owner_row.get("PROJECT_ID") is not None
        }
        has_unknown_owner = any(owner_row.get("PROJECT_ID") is None for owner_row in owner_rows)

        if reference_count > 0:
            blockers.append(
                f"{pair['sourceOwner']}.{pair['sourceTable']} 물리 테이블 쌍을 "
                f"삭제 범위 밖에서 {reference_count}건 참조하고 있습니다."
            )
        if has_unknown_owner or owner_project_ids != {project_id}:
            owner_values = [str(value) for value in sorted(owner_project_ids)]
            if has_unknown_owner:
                owner_values.append("미지정")
            owner_text = ", ".join(owner_values) or "확인 불가"
            blockers.append(
                f"{pair['sourceOwner']}.{pair['sourceTable']}의 프로젝트 단독 소유권을 "
                f"확인할 수 없습니다. (확인된 프로젝트: {owner_text})"
            )

        pair["externalReferenceCount"] = reference_count
        pair["ownerProjectIds"] = sorted(owner_project_ids)
        pair["hasUnknownOwner"] = has_unknown_owner
        pair["editTableExists"] = _physical_table_exists(conn, pair["editTable"])
        pair["sourceTableExists"] = _physical_table_exists(conn, pair["sourceTable"])
        if not pair["editTableExists"]:
            warnings.append(f"{pair['editOwner']}.{pair['editTable']} 테이블은 이미 존재하지 않습니다.")
        if not pair["sourceTableExists"]:
            warnings.append(f"{pair['sourceOwner']}.{pair['sourceTable']} 테이블은 이미 존재하지 않습니다.")
        managed_pairs.append(pair)

    active = _fetch_one(conn, "ADMIN_PURGE_ACTIVE_RUN_COUNT", params)
    active_counts = {
        "dataWork": int(active.get("DATA_WORK_ACTIVE_COUNT") or 0),
        "flowWork": int(active.get("FLOW_WORK_ACTIVE_COUNT") or 0),
    }
    if active_counts["dataWork"] > 0 or active_counts["flowWork"] > 0:
        blockers.append(
            "실행 중이거나 대기 중인 작업이 있습니다. "
            f"(데이터 작업 {active_counts['dataWork']}건, FLOW {active_counts['flowWork']}건)"
        )

    external_data_run_count = int(
        _fetch_one(conn, "ADMIN_PURGE_DATA_RUN_EXTERNAL_REFS", params).get("REFERENCE_COUNT")
        or 0
    )
    if external_data_run_count > 0:
        blockers.append(
            "선택 범위의 DATA_WORK RUN_ID를 범위 밖 작업에서도 "
            f"{external_data_run_count}건 참조하고 있어 분석 결과를 안전하게 구분할 수 없습니다."
        )

    impact_row = _fetch_one(conn, "ADMIN_PURGE_IMPACT_COUNTS", params)
    counts = {
        key: {
            "label": label,
            "count": int(impact_row.get(key) or 0),
        }
        for key, label in IMPACT_LABELS.items()
    }
    drop_objects = []
    for pair in managed_pairs:
        if pair.get("validationError"):
            continue
        if pair.get("editTableExists"):
            drop_objects.append(f"{pair['editOwner']}.{pair['editTable']}")
        if pair.get("sourceTableExists"):
            drop_objects.append(f"{pair['sourceOwner']}.{pair['sourceTable']}")

    target_code = context["PROJECT_CODE"] if normalized_scope == SCOPE_PROJECT else context["SCENARIO_CODE"]
    target_name = context["PROJECT_NAME"] if normalized_scope == SCOPE_PROJECT else context["SCENARIO_NAME"]
    return {
        "scopeType": normalized_scope,
        "targetId": target_id,
        "targetCode": str(target_code or ""),
        "targetName": str(target_name or ""),
        "projectId": project_id,
        "projectCode": str(context.get("PROJECT_CODE") or ""),
        "projectName": str(context.get("PROJECT_NAME") or ""),
        "ownerUserId": context.get("USER_ID"),
        "ownerEmail": str(context.get("USER_EMAIL") or ""),
        "counts": counts,
        "managedPairs": managed_pairs,
        "dropObjects": drop_objects,
        "dropObjectCount": len(drop_objects),
        "activeCounts": active_counts,
        "warnings": list(dict.fromkeys(warnings)),
        "blockers": list(dict.fromkeys(blockers)),
        "canPurge": not blockers,
    }


def purge_scope(
    conn,
    scope_type: str,
    target_id: int,
    *,
    confirmation_code: str,
    admin_key: str,
) -> dict[str, Any]:
    normalized_scope = _normalize_scope(scope_type)
    verify_admin_key(admin_key)

    try:
        preview = build_purge_preview(conn, normalized_scope, target_id, lock_scope=True)
    except Exception as error:
        if "ORA-00054" in str(error):
            raise HTTPException(
                status_code=409,
                detail="다른 작업이 선택한 대상을 사용 중이므로 완전 삭제를 시작할 수 없습니다.",
            ) from error
        raise

    expected_code = str(preview["targetCode"] or "")
    if not expected_code or not hmac.compare_digest(str(confirmation_code or "").strip(), expected_code):
        raise HTTPException(status_code=400, detail="삭제 확인 코드가 선택한 대상 코드와 일치하지 않습니다.")
    if preview["blockers"]:
        raise HTTPException(
            status_code=409,
            detail="안전 조건을 충족하지 못해 완전 삭제가 차단되었습니다. " + " / ".join(preview["blockers"]),
        )

    dropped_objects = []
    cursor = conn.cursor()
    try:
        dropped_keys = set()
        scope_params = {
            "projectId": int(preview["projectId"]),
            "scenarioId": target_id if normalized_scope == SCOPE_SCENARIO else None,
        }
        for pair in preview["managedPairs"]:
            if pair.get("validationError"):
                continue
            for owner_name, table_name in (
                (pair["editOwner"], pair["editTable"]),
                (pair["sourceOwner"], pair["sourceTable"]),
            ):
                object_key = (owner_name, table_name)
                if object_key in dropped_keys:
                    continue
                try:
                    _assert_managed_pair_still_exclusive(conn, pair, scope_params)
                except HTTPException as error:
                    if not dropped_objects:
                        raise
                    raise HTTPException(
                        status_code=error.status_code,
                        detail=(
                            f"{error.detail} 이미 DROP된 오브젝트: {', '.join(dropped_objects)}. "
                            "공유 참조 상태를 확인한 후 같은 완전 삭제를 다시 실행하세요."
                        ),
                    ) from error
                if not _physical_table_exists(conn, table_name):
                    dropped_keys.add(object_key)
                    continue
                try:
                    cursor.execute(
                        f"DROP TABLE {_quote_identifier(owner_name)}.{_quote_identifier(table_name)} "
                        "CASCADE CONSTRAINTS PURGE"
                    )
                    dropped_keys.add(object_key)
                    dropped_objects.append(f"{owner_name}.{table_name}")
                except Exception as error:
                    conn.rollback()
                    completed = ", ".join(dropped_objects) if dropped_objects else "없음"
                    raise HTTPException(
                        status_code=500,
                        detail=(
                            f"{owner_name}.{table_name} DROP에 실패하여 메타데이터 삭제를 시작하지 않았습니다. "
                            f"이미 DROP된 오브젝트: {completed}. 원인을 조치한 후 같은 완전 삭제를 다시 실행하세요. "
                            f"DB 오류: {error}"
                        ),
                    ) from error

        params = {
            "projectId": int(preview["projectId"]),
            "scenarioId": target_id if normalized_scope == SCOPE_SCENARIO else None,
        }
        post_drop_preview = build_purge_preview(
            conn,
            normalized_scope,
            target_id,
            lock_scope=True,
        )
        if post_drop_preview["blockers"]:
            completed = ", ".join(dropped_objects) if dropped_objects else "없음"
            raise HTTPException(
                status_code=409,
                detail=(
                    "DROP 후 재검사에서 실행 상태, 공유 참조 또는 소유권 변경이 감지되어 "
                    "업무 데이터 삭제를 시작하지 않았습니다. "
                    f"이미 DROP된 오브젝트: {completed}. "
                    f"차단 사유: {' / '.join(post_drop_preview['blockers'])}"
                ),
            )
        cursor.execute(SqlLoader.get_sql("ADMIN_PURGE_RUN_RESULTS_DELETE"), params)

        cleaned_objects = set()
        for pair in preview["managedPairs"]:
            if pair.get("validationError"):
                continue
            for owner_name, table_name in (
                (pair["editOwner"], pair["editTable"]),
                (pair["sourceOwner"], pair["sourceTable"]),
            ):
                object_key = (owner_name, table_name)
                if object_key in cleaned_objects:
                    continue
                cleaned_objects.add(object_key)
                cursor.execute(
                    SqlLoader.get_sql("ADMIN_PURGE_MANAGED_OBJECT_DATA_DELETE"),
                    {"ownerName": owner_name, "tableName": table_name},
                )
            cursor.execute(
                SqlLoader.get_sql("ADMIN_PURGE_UPLOAD_META_DELETE"),
                {
                    "projectId": int(preview["projectId"]),
                    "ownerName": pair["sourceOwner"],
                    "tableName": pair["sourceTable"],
                },
            )

        cursor.execute(SqlLoader.get_sql("ADMIN_PURGE_SCOPE_DATA_DELETE"), params)
        if _context_exists(conn, normalized_scope, target_id):
            raise RuntimeError("완전 삭제 후에도 대상 마스터 데이터가 남아 있습니다.")
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as error:
        conn.rollback()
        completed = ", ".join(dropped_objects) if dropped_objects else "없음"
        raise HTTPException(
            status_code=500,
            detail=(
                "물리 오브젝트 DROP 후 업무 데이터 삭제 트랜잭션이 실패하여 롤백되었습니다. "
                f"이미 DROP된 오브젝트: {completed}. 같은 완전 삭제를 다시 실행하면 남은 데이터를 정리할 수 있습니다. "
                f"DB 오류: {error}"
            ),
        ) from error
    finally:
        cursor.close()

    return {
        "status": "success",
        "message": "관리자 완전 삭제가 완료되었습니다.",
        "scopeType": normalized_scope,
        "targetId": target_id,
        "targetCode": preview["targetCode"],
        "droppedObjects": dropped_objects,
        "droppedObjectCount": len(dropped_objects),
        "deletedCounts": preview["counts"],
        "warnings": preview["warnings"],
    }


def _normalize_scope(scope_type: str) -> str:
    normalized = str(scope_type or "").strip().upper()
    if normalized not in {SCOPE_PROJECT, SCOPE_SCENARIO}:
        raise HTTPException(status_code=400, detail="지원하지 않는 완전 삭제 범위입니다.")
    return normalized


def _load_context(conn, scope_type: str, target_id: int, *, lock_scope: bool) -> dict[str, Any]:
    try:
        normalized_id = int(target_id)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail="삭제 대상 ID가 올바르지 않습니다.") from error
    if normalized_id <= 0:
        raise HTTPException(status_code=400, detail="삭제 대상 ID가 올바르지 않습니다.")

    if lock_scope:
        lock_sql_id = "ADMIN_PURGE_PROJECT_LOCK" if scope_type == SCOPE_PROJECT else "ADMIN_PURGE_SCENARIO_LOCK"
        lock_param = {"projectId": normalized_id} if scope_type == SCOPE_PROJECT else {"scenarioId": normalized_id}
        locked = _fetch_one(conn, lock_sql_id, lock_param, required=False)
        if not locked:
            raise HTTPException(status_code=404, detail="완전 삭제 대상을 찾을 수 없습니다.")

    context_sql_id = "ADMIN_PURGE_PROJECT_CONTEXT" if scope_type == SCOPE_PROJECT else "ADMIN_PURGE_SCENARIO_CONTEXT"
    context_param = {"projectId": normalized_id} if scope_type == SCOPE_PROJECT else {"scenarioId": normalized_id}
    return _fetch_one(conn, context_sql_id, context_param)


def _validate_managed_pair(row: dict[str, Any], current_schema: str) -> dict[str, Any]:
    source_owner = str(row.get("SOURCE_OWNER") or "").strip().upper()
    source_table = str(row.get("SOURCE_TABLE") or "").strip().upper()
    edit_owner = str(row.get("EDIT_OWNER") or "").strip().upper()
    edit_table = str(row.get("EDIT_TABLE") or "").strip().upper()
    data_origin_type = str(row.get("DATA_ORIGIN_TYPE") or "").strip().upper()
    expected_edit_table = (
        MANAGED_EDIT_PREFIX + source_table[len(MANAGED_SOURCE_PREFIX):]
        if source_table.startswith(MANAGED_SOURCE_PREFIX)
        else ""
    )

    errors = []
    for label, value in (
        ("원본 소유자", source_owner),
        ("원본 테이블", source_table),
        ("편집 소유자", edit_owner),
        ("편집 테이블", edit_table),
    ):
        if not IDENTIFIER_PATTERN.fullmatch(value):
            errors.append(f"{label} 식별자가 안전하지 않습니다: {value or '(없음)'}")
    if source_owner != current_schema or edit_owner != current_schema:
        errors.append(
            f"현재 Target 스키마({current_schema}) 밖의 오브젝트는 DROP할 수 없습니다: "
            f"{source_owner}.{source_table}, {edit_owner}.{edit_table}"
        )
    if not source_table.startswith(MANAGED_SOURCE_PREFIX):
        errors.append(f"관리 대상이 아닌 원본 테이블은 DROP할 수 없습니다: {source_owner}.{source_table}")
    if not edit_table.startswith(MANAGED_EDIT_PREFIX) or edit_table != expected_edit_table:
        errors.append(
            f"INITUP$/INITDN$ 쌍을 안전하게 확인할 수 없습니다: "
            f"{source_owner}.{source_table}, {edit_owner}.{edit_table}"
        )

    return {
        "sourceOwner": source_owner,
        "sourceTable": source_table,
        "editOwner": edit_owner,
        "editTable": edit_table,
        "dataOriginType": data_origin_type,
        "validationError": " / ".join(errors),
    }


def _assert_managed_pair_still_exclusive(conn, pair: dict[str, Any], params: dict[str, Any]) -> None:
    query_params = {
        **params,
        "sourceOwner": pair["sourceOwner"],
        "sourceTable": pair["sourceTable"],
        "editOwner": pair["editOwner"],
        "editTable": pair["editTable"],
    }
    reference_count = int(
        _fetch_one(conn, "ADMIN_PURGE_MANAGED_TABLE_EXTERNAL_REFS", query_params).get("REFERENCE_COUNT")
        or 0
    )
    owner_rows = _fetch_all(conn, "ADMIN_PURGE_MANAGED_TABLE_PROJECT_OWNERS", query_params)
    owner_project_ids = {
        int(row["PROJECT_ID"])
        for row in owner_rows
        if row.get("PROJECT_ID") is not None
    }
    has_unknown_owner = any(row.get("PROJECT_ID") is None for row in owner_rows)
    if (
        reference_count > 0
        or has_unknown_owner
        or owner_project_ids != {int(params["projectId"])}
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                f"DROP 직전 재검사에서 {pair['sourceOwner']}.{pair['sourceTable']}의 "
                "공유 참조 또는 단독 소유권 변경이 감지되어 완전 삭제를 중단했습니다."
            ),
        )


def _physical_table_exists(conn, table_name: str) -> bool:
    row = _fetch_one(
        conn,
        "ADMIN_PURGE_PHYSICAL_TABLE_EXISTS",
        {"tableName": str(table_name or "").upper()},
    )
    return int(row.get("TABLE_COUNT") or 0) > 0


def _context_exists(conn, scope_type: str, target_id: int) -> bool:
    sql_id = "ADMIN_PURGE_PROJECT_CONTEXT" if scope_type == SCOPE_PROJECT else "ADMIN_PURGE_SCENARIO_CONTEXT"
    params = {"projectId": target_id} if scope_type == SCOPE_PROJECT else {"scenarioId": target_id}
    return bool(_fetch_all(conn, sql_id, params))


def _fetch_one(
    conn,
    sql_id: str,
    params: Optional[dict[str, Any]] = None,
    *,
    required: bool = True,
) -> dict[str, Any]:
    rows = _fetch_all(conn, sql_id, params)
    if rows:
        return rows[0]
    if required:
        raise HTTPException(status_code=404, detail="완전 삭제 대상을 찾을 수 없습니다.")
    return {}


def _fetch_all(conn, sql_id: str, params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    cursor = conn.cursor()
    try:
        sql = SqlLoader.get_sql(sql_id)
        bind_names = set(re.findall(r":([A-Za-z0-9_]+)", sql))
        filtered_params = {
            key: value
            for key, value in (params or {}).items()
            if key in bind_names
        }
        cursor.execute(sql, filtered_params)
        columns = [str(item[0]).upper() for item in (cursor.description or [])]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        cursor.close()


def _quote_identifier(value: str) -> str:
    normalized = str(value or "").strip().upper()
    if not IDENTIFIER_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=409, detail=f"안전하지 않은 DB 식별자입니다: {value}")
    return f'"{normalized}"'
