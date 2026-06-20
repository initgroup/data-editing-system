"""
@file           [M90001].py 
@description    [내부 모델 등록]
@author         [인아이티 김진열]
@date           2026-04-18
@version        1.0.0

[수정 이력]:
- 2026-04-18: 최초 생성 및 기본 기능 구현
@Copyright (c) 2026 [init]. All rights reserved.
@vLicense: MIT License
"""

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from typing import Dict, Any, List, Optional, Tuple
from fastapi import Body
import logging
from backend.target_database import get_target_db_connection # 주석 해제하여 사용
from backend.database_helper import execute_query, SqlLoader, get_debug_sql

logger = logging.getLogger(__name__)
router = APIRouter()

# 조회입력파라미터선언
class SearchRequest(BaseModel):
    # 명시적으로 사용할 것들만 선언
    mainCombo: Optional[str] = None
    subCombo: Optional[str] = None
    checkValues: Optional[List[str]] = []  # IN 절에 사용될 리스트
    radioVal: Optional[str] = None
    textVal: Optional[str] = None
    dateVal: Optional[str] = None
    # [핵심] 선언되지 않은 나머지 필드들을 허용함
    model_config = ConfigDict(extra='allow')

class ObjectDetailRequest(BaseModel):
    owner: Optional[str] = None
    objectType: Optional[str] = None
    objectName: Optional[str] = None
    model_config = ConfigDict(extra='allow')

class ObjectDetailSaveRequest(BaseModel):
    object: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    items: Optional[List[Dict[str, Any]]] = []
    model_config = ConfigDict(extra='allow')

class ObjectDetailDeleteRequest(BaseModel):
    object: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    includeDetails: bool = False
    model_config = ConfigDict(extra='allow')

@router.get("/init")
def get_init_data(request: Request):
    conn = None
    try:
        conn = get_target_db_connection(request)
        # 첫번째 데이터셋
        result1 = execute_query(conn, "INIT_COMBO")
        # 두번째 데이터셋
        result2 = execute_query(conn, "INIT_COMBO")

        return {
            "status": "success", 
            "data": {
                "data1" : result1["data"],
                "data2" : result2["data"]
            },
            "total": {
                "total1" : result1["total"],
                "total2" : result2["total"]
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="초기 데이터 로드 실패")
    
# 웹페이지 파라미터를 지정해서 사용할 경우
@router.post("/searchCombo")
def search_combo(req: SearchRequest, request: Request):
    conn = None
    try:        
        params = {}

        params['parentId'] = req.mainCombo or 'XXX'

        # 실행전 SQL 로그 출력
        logger.info(f"실행될 쿼리:\n{get_debug_sql('SUB_COMBO', params)}")

        # [실제 호출 예시]
        conn = get_target_db_connection(request)
        result = execute_query(conn, "SUB_COMBO", params)

        return {
            "status": "success", 
            "data": result["data"], 
            "columns": result.get("columns", []), # [추가]
            "total": result["total"]
        }
    except Exception as e:
        # 이 부분이 없거나 잘못되면 브라우저는 에러인 줄 모릅니다!
        raise HTTPException(status_code=500, detail=str(e))


# 웹페이지 파라미터를 지정해서 사용할 경우
@router.post("/search2Combo")
def search2_combo(req: SearchRequest, request: Request):
    conn = None
    try:        
        params = {}

        params['parentId'] = req.mainCombo or 'XXX'
        params['secondId'] = req.subCombo or 'XXXX'

        # 실행전 SQL 로그 출력
        logger.info(f"실행될 쿼리:\n{get_debug_sql('SUB2_COMBO', params)}")

        # [실제 호출 예시]
        conn = get_target_db_connection(request)
        result = execute_query(conn, "SUB2_COMBO", params)

        return {
            "status": "success", 
            "data": result["data"], 
            "columns": result.get("columns", []), # [추가]
            "total": result["total"]
        }
    except Exception as e:
        # 이 부분이 없거나 잘못되면 브라우저는 에러인 줄 모릅니다!
        raise HTTPException(status_code=500, detail=str(e))

# 웹페이지 파라미터를 지정해서 사용할 경우
@router.post("/search")
def search_data(req: SearchRequest, request: Request):
    conn = None
    try:
        in_sql = ""
        params = {}
        if req.checkValues:
            bind_names = [f":chk{i}" for i in range(len(req.checkValues))]
            in_sql = f" AND COL1 IN ({','.join(bind_names)})"
            for i, val in enumerate(req.checkValues):
                params[f"chk{i}"] = val
        
        params['tableName'] = req.subCombo or 'DUAL'
        
        # 실행전 SQL 로그 출력
        logger.info(f"실행될 쿼리:\n{get_debug_sql('SEARCH_DATA', params)}")

        # [실제 호출 예시]
        conn = get_target_db_connection(request)
        # database_helper의 execute_query 내부에서 SqlLoader.get_sql("SEARCH_DATA")를 호출하게 됩니다.
        result = execute_query(conn, "SEARCH_DATA", params)

        # [수정] result에 담긴 columns 정보를 함께 리턴합니다.
        return {
            "status": "success", 
            "data": result["data"], 
            "columns": result.get("columns", []), # [추가]
            "total": result["total"]
        }
    except Exception as e:
        # 이 부분이 없거나 잘못되면 브라우저는 에러인 줄 모릅니다!
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/object-tree")
def get_object_tree(
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
    keyword: str = Query(""),
    registeredOnly: str = Query("N"),
    categoryFilter: str = Query("ALL"),
    includePackageMembers: str = Query("N")
):
    conn = None
    try:
        conn = get_target_db_connection(request)
        allowed_categories = {"TABLE", "PLSQL", "PACKAGE", "ML_PACKAGE", "MODEL"}
        selected_categories = [
            item.strip().upper()
            for item in str(categoryFilter or "ALL").split(",")
            if item.strip().upper() in allowed_categories
        ]
        params = {
            "offset": offset,
            "endRow": offset + limit + 1,
            "keyword": f"%{str(keyword or '').strip().upper()}%" if str(keyword or "").strip() else None,
            "registeredOnly": "Y" if str(registeredOnly).upper() == "Y" else "N",
            "categoryFilter": ",".join(selected_categories) if selected_categories else "ALL",
            "includePackageMembers": "Y" if str(includePackageMembers).upper() == "Y" else "N"
        }
        result = execute_query(conn, "M90001_OBJECT_TREE", params)
        if result.get("status") != "success":
            logger.error(f"M90001_OBJECT_TREE failed: {result}")
            raise HTTPException(status_code=500, detail=result.get("message") or "M90001 object tree query failed.")

        raw_data = result["data"]
        has_more = len(raw_data) > limit
        data = raw_data[:limit]
        total_count = offset + len(data) + (1 if has_more else 0)

        return {
            "status": "success",
            "data": data,
            "columns": result.get("columns", []),
            "total": total_count,
            "nextOffset": offset + len(data),
            "hasMore": has_more
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"M90001_OBJECT_TREE exception: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()

@router.get("/package-members")
def get_package_members(
    request: Request,
    owner: str = Query(...),
    packageName: str = Query(...),
    registeredOnly: str = Query("N")
):
    conn = None
    try:
        conn = get_target_db_connection(request)
        params = {
            "owner": owner,
            "packageName": packageName,
            "registeredOnly": "Y" if str(registeredOnly).upper() == "Y" else "N"
        }
        result = execute_query(conn, "M90001_PACKAGE_MEMBERS", params)
        if result.get("status") != "success":
            logger.error(f"M90001_PACKAGE_MEMBERS failed: {result}")
            raise HTTPException(status_code=500, detail=result.get("message") or "M90001 package members query failed.")

        return {
            "status": "success",
            "data": result["data"],
            "columns": result.get("columns", []),
            "total": result["total"]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"M90001_PACKAGE_MEMBERS exception: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()

@router.post("/object-detail")
def get_object_detail(req: ObjectDetailRequest, request: Request):
    conn = None
    try:
        params = {
            "owner": req.owner or "INIT$EDIT01",
            "objectType": req.objectType or "TABLE",
            "objectName": req.objectName or ""
        }

        conn = get_target_db_connection(request)
        metadata = get_object_metadata(conn, params)
        params["objectId"] = metadata.get("OBJECT_ID")
        result = execute_query(conn, "M90001_OBJECT_DETAIL", params)
        if result.get("status") != "success":
            logger.warning(f"M90001_OBJECT_DETAIL failed, using dictionary fallback: {result}")
            detail_rows = fetch_dictionary_object_detail(conn, params)
            return {
                "status": "success",
                "data": detail_rows,
                "metadata": metadata,
                "columns": ["OBJECT_ID", "ITEM_NAME", "ITEM_VALUE", "ITEM_DESC", "ITEM_DEFAULT", "ITEM_ORDER", "DETAIL_SOURCE"],
                "total": len(detail_rows),
                "source": "dictionary_fallback"
            }

        return {
            "status": "success",
            "data": result["data"],
            "metadata": metadata,
            "columns": result.get("columns", []),
            "total": result["total"]
        }
    except Exception as e:
        logger.warning(f"M90001_OBJECT_DETAIL exception, using dictionary fallback: {str(e)}")
        fallback_rows = []
        fallback_metadata = build_default_object_metadata(req.owner, req.objectType, req.objectName)
        if conn:
            try:
                fallback_params = {
                    "owner": req.owner or "INIT$EDIT01",
                    "objectType": req.objectType or "TABLE",
                    "objectName": req.objectName or "",
                    "objectId": fallback_metadata.get("OBJECT_ID")
                }
                fallback_rows = fetch_dictionary_object_detail(conn, fallback_params)
            except Exception as fallback_error:
                logger.warning(f"M90001 dictionary fallback failed: {str(fallback_error)}")
        return {
            "status": "success",
            "data": fallback_rows,
            "metadata": fallback_metadata,
            "columns": ["OBJECT_ID", "ITEM_NAME", "ITEM_VALUE", "ITEM_DESC", "ITEM_DEFAULT", "ITEM_ORDER", "DETAIL_SOURCE"],
            "total": len(fallback_rows),
            "source": "dictionary_fallback" if fallback_rows else "dictionary_fallback_empty"
        }
    finally:
        if conn:
            conn.close()

@router.post("/object-detail/save")
def save_object_detail(req: ObjectDetailSaveRequest, request: Request):
    items = req.items or []
    target = req.object or {}
    metadata = req.metadata or {}
    owner = target.get("OWNER")
    object_type = target.get("OBJECT_TYPE")
    object_name = target.get("OBJECT_NAME")

    if not owner or not object_type or not object_name:
        raise HTTPException(status_code=400, detail="A table or procedure must be selected before saving.")

    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        object_upsert_sql = SqlLoader.get_sql("M90001_OBJECT_UPSERT")
        object_id_sql = SqlLoader.get_sql("M90001_OBJECT_ID_SELECT")
        delete_sql = SqlLoader.get_sql("M90001_OBJECT_DETAIL_DELETE")
        insert_sql = SqlLoader.get_sql("M90001_OBJECT_DETAIL_INSERT")

        object_params = {
            "owner": owner,
            "objectType": object_type,
            "objectName": object_name,
            "objectLabel": metadata.get("objectLabel") or metadata.get("OBJECT_LABEL") or target.get("OBJECT_LABEL") or object_name,
            "description": metadata.get("description") or metadata.get("DESCRIPTION") or target.get("OBJECT_LABEL") or object_name,
            "useYn": metadata.get("useYn") or metadata.get("USE_YN") or "Y",
            "sortOrder": int(metadata.get("sortOrder") or metadata.get("SORT_ORDER") or 0)
        }

        cursor.execute(object_upsert_sql, object_params)
        cursor.execute(
            object_id_sql,
            {
                "owner": owner,
                "objectType": object_type,
                "objectName": object_name
            }
        )
        object_id_row = cursor.fetchone()
        if not object_id_row:
            raise HTTPException(status_code=500, detail="Saved object ID could not be found.")
        object_id = object_id_row[0]

        cursor.execute(
            delete_sql,
            {
                "objectId": object_id
            }
        )

        saved_count = 0
        for index, item in enumerate(items, start=1):
            item_name = (item.get("key") or "").strip()
            item_value = item.get("value") or ""
            item_desc = item.get("desc") or item.get("itemDesc") or ""
            item_default = item.get("defaultValue") or item.get("itemDefault") or ""
            item_order = item.get("order") or item.get("itemOrder") or index
            if not item_name and not item_value and not item_desc and not item_default:
                continue

            cursor.execute(
                insert_sql,
                {
                    "objectId": object_id,
                    "owner": owner,
                    "objectType": object_type,
                    "objectName": object_name,
                    "itemName": item_name,
                    "itemValue": item_value,
                    "itemDesc": item_desc,
                    "itemDefault": item_default,
                    "itemOrder": item_order
                }
            )
            saved_count += 1

        conn.commit()

        return {
            "status": "success",
            "message": "Object detail changes were saved.",
            "data": {
                "object": target,
                "metadata": {
                    "OBJECT_ID": object_id,
                    "OWNER": owner,
                    "OBJECT_TYPE": object_type,
                    "OBJECT_NAME": object_name,
                    "OBJECT_LABEL": object_params["objectLabel"],
                    "DESCRIPTION": object_params["description"],
                    "USE_YN": object_params["useYn"],
                    "SORT_ORDER": object_params["sortOrder"]
                },
                "savedCount": saved_count,
                "items": items
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M90001 object detail save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@router.post("/object-detail/delete")
def delete_object_detail(req: ObjectDetailDeleteRequest, request: Request):
    target = req.object or {}
    metadata = req.metadata or {}
    owner = target.get("OWNER")
    object_type = target.get("OBJECT_TYPE")
    object_name = target.get("OBJECT_NAME")
    object_id = metadata.get("objectId") or metadata.get("OBJECT_ID")

    if not object_id and (not owner or not object_type or not object_name):
        raise HTTPException(status_code=400, detail="A registered object must be selected before deleting.")

    conn = None
    cursor = None
    try:
        conn = get_target_db_connection(request)
        cursor = conn.cursor()
        object_id_sql = SqlLoader.get_sql("M90001_OBJECT_ID_SELECT")
        object_scope_sql = SqlLoader.get_sql("M90001_OBJECT_DELETE_SCOPE")
        detail_count_sql = SqlLoader.get_sql("M90001_OBJECT_DETAIL_COUNT")
        reference_count_sql = SqlLoader.get_sql("M90001_OBJECT_REFERENCE_COUNT")
        reference_clear_sql = SqlLoader.get_sql("M90001_OBJECT_REFERENCE_CLEAR")
        detail_delete_sql = SqlLoader.get_sql("M90001_OBJECT_DETAIL_DELETE")
        object_delete_sql = SqlLoader.get_sql("M90001_OBJECT_DELETE")

        if not object_id:
            cursor.execute(
                object_id_sql,
                {
                    "owner": owner,
                    "objectType": object_type,
                    "objectName": object_name
                }
            )
            object_id_row = cursor.fetchone()
            if object_id_row:
                object_id = object_id_row[0]

        cursor.execute(
            object_scope_sql,
            {
                "objectId": object_id,
                "owner": owner,
                "objectType": object_type,
                "objectName": object_name
            }
        )
        object_ids = [row[0] for row in cursor.fetchall()]

        if not object_ids:
            return {
                "status": "success",
                "message": "No registered object was found to delete.",
                "data": {
                    "deletedDetailCount": 0,
                    "deletedObjectCount": 0
                }
            }

        detail_count = 0
        for target_object_id in object_ids:
            cursor.execute(detail_count_sql, {"objectId": target_object_id})
            detail_count_row = cursor.fetchone()
            detail_count += int(detail_count_row[0] or 0) if detail_count_row else 0

        if detail_count > 0 and not req.includeDetails:
            raise HTTPException(
                status_code=409,
                detail=f"{detail_count} detail rows exist. Confirm detail deletion before deleting the object."
            )

        deleted_detail_count = 0
        deleted_object_count = 0
        detached_reference_count = 0

        for target_object_id in object_ids:
            cursor.execute(reference_count_sql, {"objectId": target_object_id})
            reference_count_row = cursor.fetchone()
            reference_count = int(reference_count_row[0] or 0) if reference_count_row else 0
            if reference_count > 0:
                cursor.execute(reference_clear_sql, {"objectId": target_object_id})
                detached_reference_count += cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0

        for target_object_id in object_ids:
            cursor.execute(detail_delete_sql, {"objectId": target_object_id})
            deleted_detail_count += cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0

        for target_object_id in object_ids:
            cursor.execute(object_delete_sql, {"objectId": target_object_id})
            deleted_object_count += cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0

        conn.commit()

        return {
            "status": "success",
            "message": "Object registration was deleted.",
            "data": {
                "objectId": object_id,
                "deletedObjectIds": object_ids,
                "detachedReferenceCount": detached_reference_count,
                "deletedDetailCount": deleted_detail_count,
                "deletedObjectCount": deleted_object_count
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"M90001 object delete failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

def get_object_metadata(conn, params: Dict[str, Any]) -> Dict[str, Any]:
    result = execute_query(conn, "M90001_OBJECT_META", params)
    if result.get("status") == "success" and result.get("data"):
        return result["data"][0]

    logger.warning(f"M90001_OBJECT_META failed, using default metadata: {result}")
    return build_default_object_metadata(
        params.get("owner"),
        params.get("objectType"),
        params.get("objectName")
    )

def build_default_object_metadata(owner: Optional[str], object_type: Optional[str], object_name: Optional[str]) -> Dict[str, Any]:
    name = object_name or ""
    return {
        "OBJECT_ID": None,
        "OWNER": owner or "",
        "OBJECT_TYPE": object_type or "",
        "OBJECT_NAME": name,
        "OBJECT_LABEL": name,
        "DESCRIPTION": name,
        "USE_YN": "Y",
        "SORT_ORDER": 0
    }

def fetch_dictionary_object_detail(conn, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    object_type = (params.get("objectType") or "").upper()
    if object_type == "TABLE":
        return fetch_dictionary_table_columns(conn, params)
    if object_type in {"PROCEDURE", "FUNCTION"}:
        return fetch_dictionary_arguments(conn, params)
    if object_type == "PACKAGE":
        return fetch_dictionary_package_members(conn, params)
    if object_type in {"PACKAGE_PROCEDURE", "PACKAGE_FUNCTION"}:
        return fetch_dictionary_package_arguments(conn, params)
    if object_type == "MINING_MODEL":
        return fetch_dictionary_model_attributes(conn, params)
    return []

def fetch_rows(conn, sql: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        columns = [col[0] for col in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        if cursor:
            cursor.close()

def fetch_dictionary_table_columns(conn, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    sql = """
        SELECT
            :objectId AS OBJECT_ID,
            C.COLUMN_NAME AS ITEM_NAME,
            C.DATA_TYPE
                || CASE
                    WHEN C.DATA_TYPE IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR') THEN '(' || C.CHAR_LENGTH || ')'
                    WHEN C.DATA_TYPE = 'NUMBER' AND C.DATA_PRECISION IS NOT NULL THEN '(' || C.DATA_PRECISION || NVL2(C.DATA_SCALE, ',' || C.DATA_SCALE, '') || ')'
                    ELSE ''
                   END
                || CASE WHEN C.NULLABLE = 'N' THEN ' NOT NULL' ELSE '' END AS ITEM_VALUE,
            CC.COMMENTS AS ITEM_DESC,
            CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
            C.COLUMN_ID AS ITEM_ORDER,
            'DICTIONARY' AS DETAIL_SOURCE
          FROM ALL_TAB_COLUMNS C
          LEFT JOIN ALL_COL_COMMENTS CC
            ON CC.OWNER = C.OWNER
           AND CC.TABLE_NAME = C.TABLE_NAME
           AND CC.COLUMN_NAME = C.COLUMN_NAME
         WHERE C.OWNER = :owner
           AND C.TABLE_NAME = :objectName
         ORDER BY C.COLUMN_ID
    """
    return fetch_rows(conn, sql, params)

def fetch_dictionary_arguments(conn, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    sql = """
        SELECT
            :objectId AS OBJECT_ID,
            A.ARGUMENT_NAME AS ITEM_NAME,
            A.IN_OUT || ' ' || A.DATA_TYPE AS ITEM_VALUE,
            CAST(NULL AS VARCHAR2(4000)) AS ITEM_DESC,
            CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
            A.POSITION AS ITEM_ORDER,
            'DICTIONARY' AS DETAIL_SOURCE
          FROM ALL_ARGUMENTS A
         WHERE A.OWNER = :owner
           AND A.OBJECT_NAME = :objectName
           AND A.PACKAGE_NAME IS NULL
           AND A.ARGUMENT_NAME IS NOT NULL
         ORDER BY A.POSITION
    """
    return fetch_rows(conn, sql, params)

def fetch_dictionary_package_members(conn, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    sql = """
        SELECT
            :objectId AS OBJECT_ID,
            P.PROCEDURE_NAME AS ITEM_NAME,
            CASE
                WHEN EXISTS (
                    SELECT 1
                      FROM ALL_ARGUMENTS A
                     WHERE A.OWNER = P.OWNER
                       AND A.PACKAGE_NAME = P.OBJECT_NAME
                       AND A.OBJECT_NAME = P.PROCEDURE_NAME
                       AND A.POSITION = 0
                ) THEN 'FUNCTION'
            ELSE 'PROCEDURE'
        END AS ITEM_VALUE,
            CAST(NULL AS VARCHAR2(4000)) AS ITEM_DESC,
            CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
            ROW_NUMBER() OVER (ORDER BY P.PROCEDURE_NAME) AS ITEM_ORDER,
            'DICTIONARY' AS DETAIL_SOURCE
          FROM ALL_PROCEDURES P
         WHERE P.OWNER = :owner
           AND P.OBJECT_NAME = :objectName
           AND P.PROCEDURE_NAME IS NOT NULL
         ORDER BY P.PROCEDURE_NAME
    """
    return fetch_rows(conn, sql, params)

def fetch_dictionary_package_arguments(conn, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    package_name, procedure_name = split_package_member_name(params.get("objectName") or "")
    sql_params = {
        **params,
        "packageName": package_name,
        "procedureName": procedure_name
    }
    sql = """
        SELECT
            :objectId AS OBJECT_ID,
            A.ARGUMENT_NAME AS ITEM_NAME,
            A.IN_OUT || ' ' || A.DATA_TYPE AS ITEM_VALUE,
            CAST(NULL AS VARCHAR2(4000)) AS ITEM_DESC,
            CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
            A.POSITION AS ITEM_ORDER,
            'DICTIONARY' AS DETAIL_SOURCE
          FROM ALL_ARGUMENTS A
         WHERE A.OWNER = :owner
           AND A.PACKAGE_NAME = :packageName
           AND A.OBJECT_NAME = :procedureName
           AND A.ARGUMENT_NAME IS NOT NULL
         ORDER BY A.POSITION
    """
    return fetch_rows(conn, sql, sql_params)

def fetch_dictionary_model_attributes(conn, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    sql = """
        SELECT
            :objectId AS OBJECT_ID,
            A.ATTRIBUTE_NAME AS ITEM_NAME,
            A.ATTRIBUTE_TYPE || NVL2(A.DATA_TYPE, ' ' || A.DATA_TYPE, '') AS ITEM_VALUE,
            CAST(NULL AS VARCHAR2(4000)) AS ITEM_DESC,
            CAST(NULL AS VARCHAR2(4000)) AS ITEM_DEFAULT,
            ROW_NUMBER() OVER (ORDER BY A.ATTRIBUTE_NAME) AS ITEM_ORDER,
            'DICTIONARY' AS DETAIL_SOURCE
          FROM ALL_MINING_MODEL_ATTRIBUTES A
         WHERE A.OWNER = :owner
           AND A.MODEL_NAME = :objectName
         ORDER BY A.ATTRIBUTE_NAME
    """
    return fetch_rows(conn, sql, params)

def split_package_member_name(object_name: str) -> Tuple[str, str]:
    parts = str(object_name or "").split(".", 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return "", object_name

@router.post("/procedure")
def call_proc(req: dict, request: Request):
    """[요구사항 6] 오라클 프로시저 호출 예시"""
    # 실제 구현: result = execute_query(conn, "SP_MY_PROCEDURE", {"input_val": req.get("val")}, is_proc=True)
    return {
        "status": "success", 
        "proc_result": "SUCCESS", # 또는 FAIL
        "message": "프로시저가 정상적으로 실행되었습니다.",
        "affected_rows": 5
    }

