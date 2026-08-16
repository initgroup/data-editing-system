"""Create the editable four-stage default jobs and M04001 sample flow."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from fastapi import HTTPException

from backend.database_helper import execute_query, SqlLoader
from backend.services import data_work_service as data_work
from backend.services import flow_contract_service as flow_contracts
from backend.services import flow_work_service as flow_work


FLOW_MENU_CODE = "M04001"
FLOW_GROUP = "M04001"
FLOW_TYPE = "INTEGRATED_EDITING_SCENARIO"
FLOW_DESCRIPTION_MARKER = "AUTO_SCENARIO_TABLE"
FLOW_NODE_WIDTH = 210
FLOW_NODE_HEIGHT = 164
FLOW_NODE_START_LEFT = 72
FLOW_NODE_START_TOP = 86
FLOW_NODE_GAP = 120

DEFAULT_STAGES = (
    {
        "menuCode": "M03001",
        "modelName": "INIT$_SP_PREDICTED_TYPE",
        "sourceType": "DB_OBJECT",
        "label": "컬럼 유형 분석",
        "resultCreateYn": "T",
        "resultName": "INIT$_TB_COLTYPE_FINAL",
    },
    {
        "menuCode": "M03002",
        "modelName": "INTEGRATED_RELATION_CLUSTER",
        "sourceType": "WEB_API",
        "label": "컬럼 관계 분석",
        "resultCreateYn": "T",
        "resultName": "INIT$_TB_COLREL_NETWORK_EDGE",
    },
    {
        "menuCode": "M03003",
        "modelName": "INTEGRATED_RULE_DISCOVER",
        "sourceType": "WEB_API",
        "label": "자동 규칙 발굴",
        "resultCreateYn": "M",
        "resultName": "OML_ASSOCIATION_MODEL_01",
    },
    {
        "menuCode": "M03004",
        "modelName": "INTEGRATED_RULE_VIOLATION_DETECT",
        "sourceType": "WEB_API",
        "label": "규칙 위반 탐지",
        "resultCreateYn": "T",
        "resultName": "INIT$_TB_RULEVIOL_ASSOC",
    },
)


def provision_default_design(
    conn,
    *,
    project_id: int,
    scenario_id: int,
    scenario_table_id: int,
) -> Dict[str, Any]:
    """Create or reuse the four default jobs and their editable sample flow."""
    context = lock_scenario_table(
        conn,
        project_id=project_id,
        scenario_id=scenario_id,
        scenario_table_id=scenario_table_id,
    )
    owner_name = context["ownerName"]
    table_name = context["tableName"]

    jobs: List[Dict[str, Any]] = []
    created_job_ids: List[int] = []
    reused_job_ids: List[int] = []
    for stage in DEFAULT_STAGES:
        job, created = ensure_default_job(
            conn,
            stage,
            project_id=project_id,
            scenario_id=scenario_id,
            scenario_table_id=scenario_table_id,
            owner_name=owner_name,
            table_name=table_name,
        )
        job_id = int(job.get("WORK_JOB_ID") or job.get("PROFILE_JOB_ID") or 0)
        jobs.append(job)
        (created_job_ids if created else reused_job_ids).append(job_id)

    flow, flow_created = ensure_default_flow(
        conn,
        project_id=project_id,
        scenario_id=scenario_id,
        scenario_table_id=scenario_table_id,
        owner_name=owner_name,
        table_name=table_name,
        jobs=jobs,
    )
    return {
        "status": "success",
        "scenarioTableId": scenario_table_id,
        "ownerName": owner_name,
        "tableName": table_name,
        "jobIds": [int(job.get("WORK_JOB_ID") or job.get("PROFILE_JOB_ID") or 0) for job in jobs],
        "createdJobIds": created_job_ids,
        "reusedJobIds": reused_job_ids,
        "flowId": int(flow.get("FLOW_ID") or 0),
        "flowName": flow.get("FLOW_NAME") or "",
        "flowCreated": flow_created,
    }


def lock_scenario_table(
    conn,
    *,
    project_id: int,
    scenario_id: int,
    scenario_table_id: int,
) -> Dict[str, Any]:
    cursor = conn.cursor()
    try:
        cursor.execute(
            SqlLoader.get_sql("M02002_SCENARIO_TABLE_LOCK"),
            {
                "scenarioTableId": scenario_table_id,
                "projectId": project_id,
                "scenarioId": scenario_id,
            },
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="The scenario table registration was not found.")
        owner_name = str(row[1] or "").strip().upper()
        table_name = str(row[2] or "").strip().upper()
        if not owner_name or not table_name or not table_name.startswith("INITUP$"):
            raise HTTPException(
                status_code=409,
                detail="Default design requires a registered INITUP$ managed source table.",
            )
        return {
            "scenarioTableId": int(row[0]),
            "ownerName": owner_name,
            "tableName": table_name,
            "editOwnerName": str(row[3] or "").strip().upper(),
            "editTableName": str(row[4] or "").strip().upper(),
        }
    finally:
        cursor.close()


def ensure_default_job(
    conn,
    stage: Dict[str, Any],
    *,
    project_id: int,
    scenario_id: int,
    scenario_table_id: int,
    owner_name: str,
    table_name: str,
) -> tuple[Dict[str, Any], bool]:
    menu_code = str(stage["menuCode"])
    model_name = str(stage["modelName"]).upper()
    existing_jobs = data_work.list_jobs(conn, menu_code, project_id, scenario_id).get("data", [])
    existing = next(
        (
            row for row in existing_jobs
            if safe_int(row.get("SCENARIO_TABLE_ID")) == scenario_table_id
            and str(row.get("EXEC_OBJECT_NAME") or row.get("EXEC_METHOD") or "").strip().upper() == model_name
        ),
        None,
    )
    if existing:
        job_id = int(existing.get("WORK_JOB_ID") or existing.get("PROFILE_JOB_ID"))
        return data_work.load_job(conn, menu_code, job_id), False

    sort_order = max(
        [safe_int(row.get("SORT_ORDER")) for row in existing_jobs]
        + [len(existing_jobs)],
    ) + 1
    if stage["sourceType"] == "DB_OBJECT":
        request = build_db_object_job_request(
            conn,
            stage,
            project_id=project_id,
            scenario_id=scenario_id,
            scenario_table_id=scenario_table_id,
            owner_name=owner_name,
            table_name=table_name,
            sort_order=sort_order,
        )
    else:
        request = build_web_api_job_request(
            conn,
            stage,
            project_id=project_id,
            scenario_id=scenario_id,
            scenario_table_id=scenario_table_id,
            owner_name=owner_name,
            table_name=table_name,
            sort_order=sort_order,
        )
    job_id = data_work.save_job(conn, menu_code, request, menu_code)
    return data_work.load_job(conn, menu_code, job_id), True


def build_db_object_job_request(
    conn,
    stage: Dict[str, Any],
    *,
    project_id: int,
    scenario_id: int,
    scenario_table_id: int,
    owner_name: str,
    table_name: str,
    sort_order: int,
) -> data_work.DataWorkJobRequest:
    result = data_work.require_success(
        execute_query(conn, "M03001_EXECUTABLE_OBJECT_LIST"),
        "Executable object query failed.",
    )
    model_name = str(stage["modelName"]).upper()
    candidates = [
        row for row in result.get("data", [])
        if str(row.get("OBJECT_NAME") or "").strip().upper() == model_name
    ]
    if not candidates:
        raise HTTPException(
            status_code=409,
            detail=f"Default executable object {model_name} is not registered or active.",
        )
    executable = next(
        (row for row in candidates if str(row.get("OWNER") or "").strip().upper() == owner_name),
        candidates[0],
    )
    object_id = int(executable.get("OBJECT_ID") or 0)
    detail = data_work.require_success(
        execute_query(conn, "M03001_EXECUTABLE_OBJECT_DETAIL", {"objectId": object_id}),
        "Executable object parameter query failed.",
    )
    params = [
        {
            "itemName": row.get("ITEM_NAME") or "",
            "itemValue": row.get("ITEM_VALUE") or "",
            "itemDesc": row.get("ITEM_DESC") or "",
            "itemDefault": normalize_default_value(row.get("ITEM_DEFAULT"), owner_name),
            "itemOrder": row.get("ITEM_ORDER") or index + 1,
        }
        for index, row in enumerate(detail.get("data", []))
        if row.get("ITEM_NAME")
    ]
    if not params:
        raise HTTPException(
            status_code=409,
            detail=f"Default executable object {model_name} has no registered parameters.",
        )
    result_mode = str(executable.get("RESULT_CREATE_YN") or stage["resultCreateYn"]).upper()
    result_owner = resolve_result_owner(executable.get("RESULT_OWNER"), owner_name)
    result_name = str(executable.get("RESULT_TABLE_NAME") or stage["resultName"]).strip().upper()
    return data_work.DataWorkJobRequest(
        projectId=project_id,
        scenarioId=scenario_id,
        scenarioTableId=scenario_table_id,
        jobGroup=stage["menuCode"],
        jobName=create_job_name(stage["menuCode"], table_name),
        jobDesc=f"{stage['label']} 기본 작업 · {owner_name}.{table_name}",
        ownerName=owner_name,
        tableName=table_name,
        execSourceType="DB_OBJECT",
        execObjectId=object_id,
        execOwner=str(executable.get("OWNER") or owner_name).strip().upper(),
        execObjectType=str(executable.get("OBJECT_TYPE") or "PROCEDURE").strip().upper(),
        execObjectName=model_name,
        execObjectLabel=str(executable.get("OBJECT_LABEL") or model_name),
        useYn="Y",
        sortOrder=sort_order,
        params=params,
        execPlsql=create_plsql_template(model_name, params),
        resultCreateYn=result_mode,
        resultOwner=result_owner,
        resultTableName=result_name,
        status="DRAFT",
    )


def build_web_api_job_request(
    conn,
    stage: Dict[str, Any],
    *,
    project_id: int,
    scenario_id: int,
    scenario_table_id: int,
    owner_name: str,
    table_name: str,
    sort_order: int,
) -> data_work.DataWorkJobRequest:
    resources = data_work.require_success(
        execute_query(conn, "DATA_WORK_OML_RESOURCE_LIST"),
        "Python API resource query failed.",
    ).get("data", [])
    model_name = str(stage["modelName"]).upper()
    resource = next(
        (
            row for row in resources
            if model_name in {
                str(row.get("RESOURCE_NAME") or "").strip().upper(),
                str(row.get("EXEC_METHOD") or "").strip().upper(),
                str(row.get("SCRIPT_NAME") or "").strip().upper(),
            }
        ),
        None,
    )
    if not resource:
        raise HTTPException(
            status_code=409,
            detail=f"Default Python API resource {model_name} is not registered or active.",
        )
    resource_id = int(resource.get("OML_RESOURCE_ID") or 0)
    detail = data_work.require_success(
        execute_query(conn, "DATA_WORK_OML_RESOURCE_DETAIL", {"resourceId": resource_id}),
        "Python API resource parameter query failed.",
    )
    rows = detail.get("data", [])
    if not rows:
        raise HTTPException(
            status_code=409,
            detail=f"Default Python API resource {model_name} has no registered detail.",
        )
    resource_detail = rows[0] if rows else resource
    spec_text = data_work.read_lob(resource_detail.get("SPEC_JSON"))
    spec = parse_json_object(spec_text)
    output = spec.get("output") if isinstance(spec.get("output"), dict) else {}
    result_mode = str(output.get("resultCreateYn") or stage["resultCreateYn"]).strip().upper()
    result_owner = resolve_result_owner(output.get("resultOwner"), owner_name)
    result_name = str(
        output.get("resultModelName")
        or output.get("resultTableName")
        or output.get("resultTable")
        or stage["resultName"]
    ).strip().upper()
    endpoint = str(spec.get("serviceUrl") or spec.get("endpoint") or "").strip()
    result_key = "resultModelName" if result_mode == "M" else "resultTableName"
    job_spec = {
        "apiRegistryVersion": spec.get("apiRegistryVersion") or 2,
        "apiType": spec.get("apiType") or "INTERNAL_API",
        "method": str(resource_detail.get("EXEC_METHOD") or model_name).strip().upper(),
        "endpoint": endpoint,
        "serviceUrl": endpoint,
        "adapter": spec.get("adapter") or "INTERNAL_PYTHON_API",
        "output": {
            "resultCreateYn": result_mode,
            "resultOwner": owner_name,
            result_key: result_name,
            "persistMode": output.get("persistMode") or "SERVICE_MANAGED",
        },
    }
    params = [
        {
            "itemName": row.get("PARAM_NAME") or "",
            "itemValue": row.get("DATA_TYPE") or "",
            "itemDesc": row.get("PARAM_DESC") or "",
            "itemDefault": normalize_default_value(row.get("DEFAULT_VALUE"), owner_name),
            "itemOrder": row.get("ITEM_ORDER") or index + 1,
            "bindName": row.get("BIND_NAME") or "",
        }
        for index, row in enumerate(rows)
        if row.get("PARAM_NAME")
    ]
    if not params:
        raise HTTPException(
            status_code=409,
            detail=f"Default Python API resource {model_name} has no registered input parameters.",
        )
    exec_method = str(resource_detail.get("EXEC_METHOD") or model_name).strip().upper()
    exec_plsql = json.dumps(
        {
            "type": "WEB_API",
            "method": exec_method,
            "endpoint": endpoint,
            "resultTable": result_name,
            "output": None,
            "note": "Executed by WAS Python API. Parameters are supplied from Parameter List.",
        },
        ensure_ascii=False,
        indent=2,
    )
    return data_work.DataWorkJobRequest(
        projectId=project_id,
        scenarioId=scenario_id,
        scenarioTableId=scenario_table_id,
        jobGroup=stage["menuCode"],
        jobName=create_job_name(stage["menuCode"], table_name),
        jobDesc=f"{stage['label']} 기본 작업 · {owner_name}.{table_name}",
        ownerName=owner_name,
        tableName=table_name,
        execSourceType="WEB_API",
        execResourceId=resource_id,
        execMethod=exec_method,
        execSpecJson=json.dumps(job_spec, ensure_ascii=False),
        execObjectType="WEB_API",
        execObjectName=str(resource_detail.get("RESOURCE_NAME") or model_name).strip().upper(),
        execObjectLabel=str(resource_detail.get("RESOURCE_LABEL") or model_name),
        useYn="Y",
        sortOrder=sort_order,
        params=params,
        execPlsql=exec_plsql,
        resultCreateYn=result_mode,
        resultOwner=result_owner,
        resultTableName=result_name,
        status="DRAFT",
    )


def ensure_default_flow(
    conn,
    *,
    project_id: int,
    scenario_id: int,
    scenario_table_id: int,
    owner_name: str,
    table_name: str,
    jobs: List[Dict[str, Any]],
) -> tuple[Dict[str, Any], bool]:
    flow_name = create_flow_name(table_name)
    marker = create_flow_marker(scenario_table_id)
    flows = flow_work.list_flows(conn, FLOW_MENU_CODE, project_id, scenario_id).get("data", [])
    existing = next(
        (
            row for row in flows
            if marker in str(row.get("FLOW_DESC") or "")
            or str(row.get("FLOW_NAME") or "").strip() == flow_name
        ),
        None,
    )
    job_ids = {
        int(job.get("WORK_JOB_ID") or job.get("PROFILE_JOB_ID") or 0)
        for job in jobs
    }
    if not existing:
        for candidate in flows:
            loaded = flow_work.load_flow(conn, FLOW_MENU_CODE, int(candidate["FLOW_ID"]))
            ref_ids = {
                int(node.get("REF_WORK_JOB_ID") or node.get("refWorkJobId") or 0)
                for node in loaded.get("NODES", [])
                if node.get("REF_WORK_JOB_ID") or node.get("refWorkJobId")
            }
            if job_ids and job_ids.issubset(ref_ids):
                existing = loaded
                break
    if existing:
        flow_id = int(existing.get("FLOW_ID") or 0)
        return flow_work.load_flow(conn, FLOW_MENU_CODE, flow_id), False

    nodes, edges = build_sample_flow_graph(jobs)
    request = flow_work.FlowWorkRequest(
        projectId=project_id,
        scenarioId=scenario_id,
        flowGroup=FLOW_GROUP,
        flowName=flow_name,
        flowDesc=f"{marker} M02002 대상 테이블 등록 시 생성된 기본 4단계 FLOW · {owner_name}.{table_name}",
        flowType=FLOW_TYPE,
        executionMode="DAG",
        useYn="Y",
        status="DRAFT",
        nodes=[flow_work.FlowNodeRequest(**node) for node in nodes],
        edges=[flow_work.FlowEdgeRequest(**edge) for edge in edges],
    )
    flow_id = flow_work.save_flow(conn, FLOW_MENU_CODE, request, FLOW_GROUP, FLOW_TYPE)
    return flow_work.load_flow(conn, FLOW_MENU_CODE, flow_id), True


def build_sample_flow_graph(jobs: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    nodes: List[Dict[str, Any]] = []
    for index, job in enumerate(jobs, start=1):
        menu_code = str(job.get("JOB_GROUP") or job.get("MENU_CODE") or f"M0300{index}").upper()
        node_key = f"{menu_code.lower()}-{index}"
        params = job.get("PARAMS") if isinstance(job.get("PARAMS"), list) else []
        node = {
            "nodeKey": node_key,
            "nodeType": menu_code,
            "nodeName": job.get("JOB_NAME") or f"{menu_code} Job",
            "nodeDesc": create_node_description(job),
            "useYn": "N" if str(job.get("USE_YN") or "Y").upper() == "N" else "Y",
            "refMenuCode": job.get("MENU_CODE") or menu_code,
            "refWorkJobId": int(job.get("WORK_JOB_ID") or job.get("PROFILE_JOB_ID") or 0),
            "refObjectId": safe_optional_int(job.get("EXEC_OBJECT_ID")),
            "ownerName": job.get("OWNER_NAME") or "",
            "tableName": job.get("TABLE_NAME") or "",
            "resultCreateYn": job.get("RESULT_CREATE_YN") or "N",
            "resultOwner": job.get("RESULT_OWNER") or "",
            "resultTableName": job.get("RESULT_TABLE_NAME") or "",
            "execObjectName": job.get("EXEC_OBJECT_NAME") or "",
            "execMethod": job.get("EXEC_METHOD") or "",
            "positionLeft": FLOW_NODE_START_LEFT + (index - 1) * (FLOW_NODE_WIDTH + FLOW_NODE_GAP),
            "positionTop": FLOW_NODE_START_TOP,
            "nodeWidth": FLOW_NODE_WIDTH,
            "nodeHeight": FLOW_NODE_HEIGHT,
            "params": params,
            "execPlsql": job.get("EXEC_PLSQL") or "",
            "sortOrder": index,
        }
        node["inputs"] = create_port_rows(node, "in")
        node["outputs"] = create_port_rows(node, "out")
        nodes.append(node)

    edges: List[Dict[str, Any]] = []
    for index in range(len(nodes) - 1):
        source = nodes[index]
        target = nodes[index + 1]
        source_port, target_port = find_compatible_ports(source, target)
        artifact = str(source_port.get("artifact") or "").upper()
        run_scope = str(target_port.get("runScope") or source_port.get("runScope") or "").upper()
        edge = {
            "fromNodeKey": source["nodeKey"],
            "fromPort": source_port.get("port") or "output",
            "toNodeKey": target["nodeKey"],
            "toPort": target_port.get("port") or "input",
            "edgeMode": "SERIAL",
            "dashedYn": "N",
            "dashed": False,
            "params": {
                "dependencyType": "DATA_REQUIRED" if artifact else "ORDER_REQUIRED",
                "artifact": artifact,
                "runScope": run_scope,
            },
            "sortOrder": index + 1,
        }
        edges.append(edge)
        annotate_port_link(source, target, edge)
    return nodes, edges


def create_port_rows(node: Dict[str, Any], direction: str) -> List[Dict[str, Any]]:
    rows = []
    for port in flow_contracts.get_contract_ports(node, direction):
        rows.append({
            **port,
            "type": port.get("kind") or "TABLE",
            "ownerName": node.get("ownerName") or "",
            "tableName": node.get("tableName") or "",
            "sourceNodeKey": "",
            "sourcePort": "",
            "targetNodeKeys": [],
            "targetPorts": [],
        })
    return rows


def find_compatible_ports(
    source: Dict[str, Any],
    target: Dict[str, Any],
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    outputs = source.get("outputs") or []
    inputs = target.get("inputs") or []
    for output in outputs:
        artifact = str(output.get("artifact") or "").upper()
        match = next(
            (item for item in inputs if artifact and str(item.get("artifact") or "").upper() == artifact),
            None,
        )
        if match:
            return output, match
    if not outputs or not inputs:
        raise HTTPException(
            status_code=409,
            detail=f"The default flow ports are not available between {source['nodeName']} and {target['nodeName']}.",
        )
    return outputs[0], inputs[0]


def annotate_port_link(source: Dict[str, Any], target: Dict[str, Any], edge: Dict[str, Any]) -> None:
    for output in source.get("outputs") or []:
        if output.get("port") != edge["fromPort"]:
            continue
        output.setdefault("targetNodeKeys", []).append(target["nodeKey"])
        output.setdefault("targetPorts", []).append(edge["toPort"])
    for input_port in target.get("inputs") or []:
        if input_port.get("port") != edge["toPort"]:
            continue
        input_port["sourceNodeKey"] = source["nodeKey"]
        input_port["sourcePort"] = edge["fromPort"]


def create_plsql_template(object_name: str, params: List[Dict[str, Any]]) -> str:
    declarations: List[str] = []
    arguments: List[str] = []
    for index, param in enumerate(params, start=1):
        param_name = str(param.get("itemName") or f"P{index}")
        item_value = str(param.get("itemValue") or "")
        direction = get_param_direction(item_value)
        if "OUT" in direction:
            variable_name = re.sub(r"[^a-z0-9_$#]", "_", f"v_{param_name.lower()}")
            initial_value = f" := {create_plsql_argument(param)}" if "IN" in direction else ""
            declarations.append(f"  {variable_name} {get_param_data_type(item_value)}{initial_value};")
            argument = variable_name
        else:
            argument = create_plsql_argument(param)
        arguments.append(f"    {param_name.ljust(22)} => {argument}")
    declaration_text = "\n".join(declarations)
    declare_block = f"DECLARE\n{declaration_text}\nBEGIN" if declarations else "BEGIN"
    if arguments:
        argument_text = ",\n".join(arguments)
        call_text = f"  {object_name}(\n{argument_text}\n  );"
    else:
        call_text = f"  {object_name};"
    return f"{declare_block}\n{call_text}\nEND;"


def create_plsql_argument(param: Dict[str, Any]) -> str:
    default_value = str(param.get("itemDefault") or "").strip()
    if ":" in default_value:
        return default_value
    return f":{to_bind_variable_name(param.get('itemName'))}"


def to_bind_variable_name(parameter_name: Any) -> str:
    parts = [part for part in str(parameter_name or "").strip().split("_") if part]
    if not parts:
        return "paramValue"
    return "".join(
        part.lower() if index == 0 else part.lower()[:1].upper() + part.lower()[1:]
        for index, part in enumerate(parts)
    )


def get_param_direction(item_value: Any) -> str:
    text = str(item_value or "").strip().upper()
    if text.startswith("IN OUT"):
        return "IN OUT"
    if text.startswith("OUT"):
        return "OUT"
    return "IN"


def get_param_data_type(item_value: Any) -> str:
    text = re.sub(r"^(IN\s+OUT|IN|OUT)\s+", "", str(item_value or "").strip(), flags=re.IGNORECASE)
    if not text:
        return "VARCHAR2(4000)"
    if text.upper() in {"VARCHAR2", "CHAR"}:
        return "VARCHAR2(4000)"
    if text.upper() in {"NVARCHAR2", "NCHAR"}:
        return "NVARCHAR2(2000)"
    return text


def normalize_default_value(value: Any, owner_name: str) -> str:
    text = str(value or "").strip()
    return owner_name if text == "__CURRENT_OWNER__" else text


def resolve_result_owner(value: Any, owner_name: str) -> str:
    text = str(value or "").strip().upper()
    if not text or text.startswith(":") or text == "__CURRENT_OWNER__":
        return owner_name
    return text


def parse_json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "").strip() or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def create_job_name(menu_code: str, table_name: str) -> str:
    return f"{menu_code}_{table_name}_AUTO"[:200]


def create_flow_name(table_name: str) -> str:
    return f"{table_name} 기본 규칙발굴 FLOW"[:200]


def create_flow_marker(scenario_table_id: int) -> str:
    return f"[{FLOW_DESCRIPTION_MARKER}:{scenario_table_id}]"


def create_node_description(job: Dict[str, Any]) -> str:
    owner_name = job.get("OWNER_NAME") or "-"
    table_name = job.get("TABLE_NAME") or "-"
    description = str(job.get("JOB_DESC") or "").strip()
    suffix = f" - {description}" if description else ""
    return f"{job.get('MENU_CODE') or job.get('JOB_GROUP') or 'JOB'} / {owner_name}.{table_name}{suffix}"


def safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def safe_optional_int(value: Any) -> int | None:
    number = safe_int(value)
    return number if number > 0 else None
