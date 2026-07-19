"""
Shared flow-work service.

The flow designer stores a header, canvas nodes, dependency edges, and run
history. Menu routers pass their menu code so this service can be reused by
multiple flow screens.
"""

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Any, Dict, List, Optional, Set
import json
import re
import time

from backend.database_helper import execute_query, SqlLoader
from backend.services import data_work_service as data_work
from backend.services import api_call_service
from backend.services import flow_contract_service as flow_contracts


class FlowWorkDmlError(Exception):
    def __init__(self, step: str, original: Exception):
        self.step = step
        self.original = original
        super().__init__(f"{step}: {original}")


IMPORT_CONTEXT_PARAMETER_PATTERN = re.compile(
    r"(?:^|_)(?:PROJECT|SCENARIO|FLOW|FLOW_NODE|FLOW_EDGE|WORK_JOB|PROFILE_JOB|OBJECT)_(?:ID|KEY)$"
)


def is_oracle_lock_error(error: Exception) -> bool:
    text = str(error)
    return any(code in text for code in ("ORA-00054", "ORA-00060", "ORA-12860"))


class FlowNodeRequest(BaseModel):
    nodeKey: str
    nodeType: str
    nodeName: str
    nodeDesc: Optional[str] = None
    useYn: Optional[str] = "Y"
    refMenuCode: Optional[str] = None
    refWorkJobId: Optional[int] = None
    refObjectId: Optional[int] = None
    ownerName: Optional[str] = None
    tableName: Optional[str] = None
    resultCreateYn: Optional[str] = "N"
    resultOwner: Optional[str] = None
    resultTableName: Optional[str] = None
    execObjectName: Optional[str] = None
    execMethod: Optional[str] = None
    positionLeft: Optional[float] = 0
    positionTop: Optional[float] = 0
    nodeWidth: Optional[float] = 170
    nodeHeight: Optional[float] = 112
    inputs: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    outputs: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    params: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    execPlsql: Optional[str] = None
    sortOrder: Optional[int] = None
    model_config = ConfigDict(extra="allow")


class FlowEdgeRequest(BaseModel):
    fromNodeKey: str
    fromPort: Optional[str] = "output"
    toNodeKey: str
    toPort: Optional[str] = "input"
    edgeMode: Optional[str] = "SERIAL"
    dashedYn: Optional[str] = "N"
    dashed: Optional[bool] = False
    params: Optional[Dict[str, Any]] = Field(default_factory=dict)
    sortOrder: Optional[int] = None
    model_config = ConfigDict(extra="allow")


class FlowWorkRequest(BaseModel):
    flowId: Optional[int] = None
    projectId: Optional[int] = None
    scenarioId: Optional[int] = None
    flowGroup: Optional[str] = None
    flowName: Optional[str] = None
    flowDesc: Optional[str] = None
    flowType: Optional[str] = None
    executionMode: Optional[str] = "DAG"
    useYn: Optional[str] = "Y"
    status: Optional[str] = "DRAFT"
    nodes: List[FlowNodeRequest] = Field(default_factory=list)
    edges: List[FlowEdgeRequest] = Field(default_factory=list)
    model_config = ConfigDict(extra="allow")


class FlowRunRequest(FlowWorkRequest):
    batch: Optional[bool] = False
    manualRunId: Optional[int] = None


class FlowNodeRunRequest(FlowWorkRequest):
    nodeKey: str
    downstream: Optional[bool] = False
    manualRunId: Optional[int] = None
    continueRunId: Optional[int] = None


def list_flows(conn, menu_code: str, project_id: int, scenario_id: int) -> Dict[str, Any]:
    result = execute_query(conn, "FLOW_WORK_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id
    })
    return data_work.require_success(result, "Flow query failed.")


def list_importable_flows(
    conn,
    menu_code: str,
    project_id: int,
    scenario_id: int,
    user_id: int,
    include_all_users: bool,
) -> Dict[str, Any]:
    result = execute_query(conn, "FLOW_WORK_IMPORT_FLOW_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": data_work.require_int(project_id, "projectId"),
        "scenarioId": data_work.require_int(scenario_id, "scenarioId"),
        "userId": data_work.require_int(user_id, "userId"),
        "includeAllUsers": "Y" if include_all_users else "N",
    })
    return data_work.require_success(result, "Importable flow query failed.")


def load_importable_flow(
    conn,
    menu_code: str,
    flow_id: int,
    project_id: int,
    scenario_id: int,
    user_id: int,
    include_all_users: bool,
) -> Dict[str, Any]:
    result = execute_query(conn, "FLOW_WORK_IMPORT_FLOW_DETAIL", {
        "menuCode": normalize_menu_code(menu_code),
        "flowId": data_work.require_int(flow_id, "flowId"),
        "projectId": data_work.require_int(project_id, "projectId"),
        "scenarioId": data_work.require_int(scenario_id, "scenarioId"),
        "userId": data_work.require_int(user_id, "userId"),
        "includeAllUsers": "Y" if include_all_users else "N",
    })
    rows = data_work.require_success(result, "Importable flow query failed.").get("data", [])
    if not rows:
        raise HTTPException(status_code=404, detail="Importable flow was not found.")

    source = load_flow(conn, menu_code, flow_id)
    return {
        "FLOW_NAME": source.get("FLOW_NAME") or "",
        "FLOW_DESC": source.get("FLOW_DESC") or "",
        "USE_YN": source.get("USE_YN") or "Y",
        "NODES": [sanitize_import_node(node) for node in source.get("NODES") or []],
        "EDGES": [
            {
                **edge,
                "flowEdgeId": None,
            }
            for edge in source.get("EDGES") or []
        ],
    }


def sanitize_import_node(node: Dict[str, Any]) -> Dict[str, Any]:
    safe_node = {
        **node,
        "flowNodeId": None,
        "refWorkJobId": None,
        "refObjectId": None,
    }
    params = safe_node.get("params")
    if not isinstance(params, list):
        safe_node["params"] = []
        return safe_node
    safe_node["params"] = [
        param for param in params
        if not is_import_context_parameter(param)
    ]
    return safe_node


def is_import_context_parameter(param: Any) -> bool:
    if not isinstance(param, dict):
        return False
    name = str(
        param.get("itemName")
        or param.get("ITEM_NAME")
        or param.get("bindName")
        or param.get("BIND_NAME")
        or ""
    ).strip().upper()
    return bool(IMPORT_CONTEXT_PARAMETER_PATTERN.search(name))


def load_flow(conn, menu_code: str, flow_id: int) -> Dict[str, Any]:
    result = execute_query(conn, "FLOW_WORK_DETAIL", {
        "menuCode": normalize_menu_code(menu_code),
        "flowId": flow_id
    })
    data = data_work.require_success(result, "Flow detail query failed.").get("data", [])
    if not data:
        raise HTTPException(status_code=404, detail="Flow was not found.")

    flow = data[0]
    graph_json = data_work.read_lob(flow.get("GRAPH_JSON"))
    flow["GRAPH_JSON"] = graph_json
    try:
        flow["GRAPH"] = json.loads(graph_json or "{}")
    except Exception:
        flow["GRAPH"] = {}

    node_result = execute_query(conn, "FLOW_WORK_NODE_LIST", {"flowId": flow_id})
    edge_result = execute_query(conn, "FLOW_WORK_EDGE_LIST", {"flowId": flow_id})
    nodes = data_work.require_success(node_result, "Flow node query failed.").get("data", [])
    edges = data_work.require_success(edge_result, "Flow edge query failed.").get("data", [])

    flow["NODES"] = [format_node(row) for row in nodes]
    flow["EDGES"] = [format_edge(row) for row in edges]
    return flow


def save_flow(
    conn,
    menu_code: str,
    req: FlowWorkRequest,
    default_flow_group: str,
    default_flow_type: str
) -> int:
    menu_code = normalize_menu_code(menu_code)
    project_id = data_work.require_int(req.projectId, "projectId")
    scenario_id = data_work.require_int(req.scenarioId, "scenarioId")
    flow_group = normalize_text(req.flowGroup, default_flow_group, 100) or default_flow_group
    flow_name = normalize_text(req.flowName, "", 200)
    if not flow_name:
        raise HTTPException(status_code=400, detail="flowName is required.")

    clean_nodes, clean_edges = normalize_graph(req.nodes, req.edges)
    validation = validate_graph(clean_nodes, clean_edges)
    if validation["status"] != "success":
        raise HTTPException(status_code=400, detail=validation["message"])

    graph_json = json.dumps({
        "nodes": clean_nodes,
        "edges": clean_edges
    }, ensure_ascii=False)

    params = {
        "menuCode": menu_code,
        "flowId": req.flowId,
        "projectId": project_id,
        "scenarioId": scenario_id,
        "flowGroup": flow_group,
        "flowName": flow_name,
        "flowDesc": normalize_text(req.flowDesc, "", 1000),
        "flowType": normalize_text(req.flowType, default_flow_type, 100),
        "executionMode": "DAG",
        "useYn": "N" if str(req.useYn or "Y").upper() == "N" else "Y",
        "status": normalize_status(req.status, "DRAFT"),
        "graphJson": graph_json
    }

    cursor = conn.cursor()
    try:
        if req.flowId:
            execute_flow_dml(cursor, "FLOW_WORK_UPDATE", "FLOW_WORK_UPDATE", params)
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Flow was not found or does not belong to this context.")
            flow_id = int(req.flowId)
        else:
            insert_params = {key: value for key, value in params.items() if key != "flowId"}
            execute_flow_dml(cursor, "FLOW_WORK_INSERT", "FLOW_WORK_INSERT", insert_params)
            execute_flow_dml(cursor, "FLOW_WORK_ID_LATEST", "FLOW_WORK_ID_LATEST", {
                "menuCode": menu_code,
                "projectId": project_id,
                "scenarioId": scenario_id,
                "flowGroup": flow_group,
                "flowName": flow_name
            })
            row = cursor.fetchone()
            if not row or not row[0]:
                raise HTTPException(status_code=500, detail="Saved flow ID could not be found.")
            flow_id = int(row[0])

        replace_flow_graph(cursor, flow_id, clean_nodes, clean_edges)
        return flow_id
    finally:
        cursor.close()


def delete_flow(conn, menu_code: str, flow_id: int, project_id: int, scenario_id: int) -> int:
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("FLOW_WORK_DELETE"), {
            "menuCode": normalize_menu_code(menu_code),
            "flowId": data_work.require_int(flow_id, "flowId"),
            "projectId": data_work.require_int(project_id, "projectId"),
            "scenarioId": data_work.require_int(scenario_id, "scenarioId")
        })
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Flow was not found or does not belong to this context.")
        return cursor.rowcount
    finally:
        cursor.close()


def replace_flow_graph(cursor, flow_id: int, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]):
    execute_flow_dml(cursor, "FLOW_WORK_EDGE_DELETE_BY_FLOW", "FLOW_WORK_EDGE_DELETE_BY_FLOW", {"flowId": flow_id})

    execute_flow_dml(cursor, "FLOW_WORK_NODE_KEY_LIST", "FLOW_WORK_NODE_KEY_LIST", {"flowId": flow_id})
    existing_node_keys = {str(row[0]) for row in cursor.fetchall()}
    next_node_keys = {str(node["nodeKey"]) for node in nodes}

    for index, node in enumerate(nodes, start=1):
        sql_id = "FLOW_WORK_NODE_UPDATE_BY_KEY" if str(node["nodeKey"]) in existing_node_keys else "FLOW_WORK_NODE_INSERT"
        step = f"{sql_id}[{index}]"
        execute_flow_dml(cursor, step, sql_id, {
            "flowId": flow_id,
            "nodeKey": node["nodeKey"],
            "nodeType": node["nodeType"],
            "nodeName": node["nodeName"],
            "nodeDesc": node.get("nodeDesc"),
            "useYn": node.get("useYn", "Y"),
            "refMenuCode": node.get("refMenuCode"),
            "refWorkJobId": node.get("refWorkJobId"),
            "refObjectId": node.get("refObjectId"),
            "ownerName": node.get("ownerName"),
            "tableName": node.get("tableName"),
            "positionLeft": node.get("positionLeft"),
            "positionTop": node.get("positionTop"),
            "nodeWidth": node.get("nodeWidth"),
            "nodeHeight": node.get("nodeHeight"),
            "inputJson": json.dumps(node.get("inputs") or [], ensure_ascii=False),
            "outputJson": json.dumps(node.get("outputs") or [], ensure_ascii=False),
            "paramJson": json.dumps(node.get("params") or [], ensure_ascii=False),
            "execPlsql": node.get("execPlsql") or "",
            "sortOrder": node.get("sortOrder") or index
        })

    for node_key in sorted(existing_node_keys - next_node_keys):
        execute_flow_dml(cursor, f"FLOW_WORK_NODE_DELETE_BY_KEY[{node_key}]", "FLOW_WORK_NODE_DELETE_BY_KEY", {
            "flowId": flow_id,
            "nodeKey": node_key
        })

    for index, edge in enumerate(edges, start=1):
        execute_flow_dml(cursor, f"FLOW_WORK_EDGE_INSERT[{index}]", "FLOW_WORK_EDGE_INSERT", {
            "flowId": flow_id,
            "fromNodeKey": edge["fromNodeKey"],
            "fromPort": edge.get("fromPort") or "output",
            "toNodeKey": edge["toNodeKey"],
            "toPort": edge.get("toPort") or "input",
            "edgeMode": edge.get("edgeMode") or "SERIAL",
            "dashedYn": edge.get("dashedYn") or "N",
            "sortOrder": edge.get("sortOrder") or index,
            "paramJson": json.dumps(edge.get("params") or {}, ensure_ascii=False)
        })


def execute_flow_dml(cursor, step: str, sql_id: str, params: Dict[str, Any]):
    last_error = None
    for attempt in range(3):
        try:
            cursor.execute(SqlLoader.get_sql(sql_id), params)
            return
        except Exception as e:
            last_error = e
            if attempt < 2 and is_oracle_lock_error(e):
                time.sleep(0.35 * (attempt + 1))
                continue
            raise FlowWorkDmlError(step, e) from e
    if last_error:
        raise FlowWorkDmlError(step, last_error) from last_error


def prepare_flow_run_session(conn):
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("FLOW_WORK_DISABLE_PARALLEL_DML"))
    finally:
        cursor.close()


def list_runs(conn, menu_code: str, project_id: int, scenario_id: int, flow_id: Optional[int] = None) -> Dict[str, Any]:
    result = execute_query(conn, "FLOW_WORK_RUN_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id,
        "flowId": flow_id
    })
    response = data_work.require_success(result, "Flow run query failed.")
    for row in response.get("data", []):
        row["MESSAGE"] = data_work.read_lob(row.get("MESSAGE"))
        row["PLAN_JSON"] = data_work.read_lob(row.get("PLAN_JSON"))
    return response


def list_node_runs(conn, flow_run_id: int) -> Dict[str, Any]:
    result = execute_query(conn, "FLOW_WORK_NODE_RUN_LIST", {"flowRunId": flow_run_id})
    response = data_work.require_success(result, "Flow node run query failed.")
    for row in response.get("data", []):
        row["MESSAGE"] = data_work.read_lob(row.get("MESSAGE"))
        row["JOB_PARAM_JSON"] = data_work.read_lob(row.get("JOB_PARAM_JSON"))
        row["RUNTIME_PARAM_JSON"] = data_work.read_lob(row.get("RUNTIME_PARAM_JSON"))
        row["NODE_PAYLOAD_JSON"] = data_work.read_lob(row.get("NODE_PAYLOAD_JSON"))
        row["RUN_OUTPUT_JSON"] = data_work.read_lob(row.get("RUN_OUTPUT_JSON"))
    return response


def get_run(conn, menu_code: str, project_id: int, scenario_id: int, flow_run_id: int) -> Optional[Dict[str, Any]]:
    result = execute_query(conn, "FLOW_WORK_RUN_GET", {
        "flowRunId": flow_run_id,
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id,
    })
    response = data_work.require_success(result, "Flow run query failed.")
    rows = response.get("data", [])
    if not rows:
        return None
    row = rows[0]
    row["MESSAGE"] = data_work.read_lob(row.get("MESSAGE"))
    row["PLAN_JSON"] = data_work.read_lob(row.get("PLAN_JSON"))
    return row


def list_runs_by_flow(conn, flow_id: int) -> List[Dict[str, Any]]:
    result = execute_query(conn, "FLOW_WORK_RUN_LIST_BY_FLOW", {"flowId": flow_id})
    response = data_work.require_success(result, "Flow run query failed.")
    rows = response.get("data", [])
    for row in rows:
        row["MESSAGE"] = data_work.read_lob(row.get("MESSAGE"))
        row["PLAN_JSON"] = data_work.read_lob(row.get("PLAN_JSON"))
    return rows


def parse_manual_run_id(value: Any) -> Optional[int]:
    text = str(value if value is not None else "").strip()
    if not text or text.lower() in {"(auto)", "auto"}:
        return None
    if not re.fullmatch(r"[1-9][0-9]*", text):
        raise HTTPException(status_code=400, detail="Manual flow run id must be a positive integer or (auto).")
    return int(text)


def extract_manual_run_id_from_plan(plan: List[Dict[str, Any]]) -> Optional[int]:
    run_ids: List[int] = []
    run_keys = {"INIT$RunId", "INIT$FlowRunId", "runId", "flowRunId"}
    for step in plan or []:
        for item in step.get("params") or []:
            if not isinstance(item, dict):
                continue
            key = item.get("itemName") or item.get("ITEM_NAME") or item.get("name") or item.get("key")
            if str(key or "") not in run_keys:
                continue
            value = get_flow_param_runtime_value(item)
            parsed = parse_manual_run_id(value)
            if parsed is not None:
                run_ids.append(parsed)
    if not run_ids:
        return None
    if len(set(run_ids)) > 1:
        raise HTTPException(status_code=400, detail="Manual flow run id values must match across run id bind variables.")
    return run_ids[0]


def create_run(
    conn,
    flow_id: int,
    run_type: str,
    status: str,
    message: str,
    plan: Dict[str, Any],
    manual_run_id: Optional[int] = None
) -> int:
    cursor = conn.cursor()
    try:
        if manual_run_id is not None:
            execute_flow_dml(cursor, "FLOW_WORK_RUN_EXISTS_FOR_FLOW", "FLOW_WORK_RUN_EXISTS_FOR_FLOW", {
                "flowId": flow_id,
                "flowRunId": manual_run_id
            })
            row = cursor.fetchone()
            if not row or int(row[0] or 0) <= 0:
                raise HTTPException(status_code=400, detail="Manual flow run id must be an existing run id for the selected flow.")
            execute_flow_dml(cursor, "FLOW_WORK_RUN_RESTART", "FLOW_WORK_RUN_RESTART", {
                "flowId": flow_id,
                "flowRunId": manual_run_id,
                "runType": normalize_status(run_type, "MANUAL"),
                "status": normalize_status(status, "STARTED"),
                "message": normalize_text(message, "", 4000),
                "planJson": json.dumps(plan or {}, ensure_ascii=False),
                "startedYn": "Y" if normalize_status(status, "STARTED") != "QUEUED" else "N"
            })
            execute_flow_dml(cursor, "FLOW_WORK_NODE_RUN_DELETE_BY_RUN", "FLOW_WORK_NODE_RUN_DELETE_BY_RUN", {
                "flowRunId": manual_run_id
            })
            return int(manual_run_id)

        execute_flow_dml(cursor, "FLOW_WORK_RUN_INSERT", "FLOW_WORK_RUN_INSERT", {
            "flowId": flow_id,
            "runType": normalize_status(run_type, "MANUAL"),
            "status": normalize_status(status, "STARTED"),
            "message": normalize_text(message, "", 4000),
            "planJson": json.dumps(plan or {}, ensure_ascii=False)
        })
        execute_flow_dml(cursor, "FLOW_WORK_RUN_ID_LATEST", "FLOW_WORK_RUN_ID_LATEST", {"flowId": flow_id})
        row = cursor.fetchone()
        return int(row[0]) if row and row[0] else 0
    finally:
        cursor.close()


def resume_run(
    conn,
    flow_id: int,
    flow_run_id: int,
    run_type: str,
    status: str,
    message: str,
    plan: Dict[str, Any]
):
    cursor = conn.cursor()
    try:
        execute_flow_dml(cursor, "FLOW_WORK_RUN_EXISTS_FOR_FLOW", "FLOW_WORK_RUN_EXISTS_FOR_FLOW", {
            "flowId": flow_id,
            "flowRunId": flow_run_id
        })
        row = cursor.fetchone()
        if not row or int(row[0] or 0) <= 0:
            raise HTTPException(status_code=400, detail="Continue flow run id must be an existing run id for the selected flow.")
        execute_flow_dml(cursor, "FLOW_WORK_RUN_RESUME", "FLOW_WORK_RUN_RESUME", {
            "flowId": flow_id,
            "flowRunId": flow_run_id,
            "runType": normalize_status(run_type, "MANUAL_FROM_NODE"),
            "status": normalize_status(status, "STARTED"),
            "message": normalize_text(message, "", 4000),
            "planJson": json.dumps(plan or {}, ensure_ascii=False)
        })
    finally:
        cursor.close()


def create_node_run_records(conn, flow_run_id: int, flow_id: int, plan: List[Dict[str, Any]], replace_existing: bool = False):
    cursor = conn.cursor()
    try:
        for index, step in enumerate(plan or [], start=1):
            if replace_existing:
                execute_flow_dml(cursor, f"FLOW_WORK_NODE_RUN_DELETE_BY_RUN_KEY[{step.get('nodeKey')}]", "FLOW_WORK_NODE_RUN_DELETE_BY_RUN_KEY", {
                    "flowRunId": flow_run_id,
                    "nodeKey": step.get("nodeKey")
                })
            execute_flow_dml(cursor, f"FLOW_WORK_NODE_RUN_INSERT[{index}]", "FLOW_WORK_NODE_RUN_INSERT", {
                "flowRunId": flow_run_id,
                "flowId": flow_id,
                "nodeKey": step.get("nodeKey"),
                "nodeName": step.get("nodeName") or step.get("nodeKey"),
                "nodeType": step.get("nodeType") or "JOB",
                "runLevel": step.get("level", 0),
                "sortOrder": index,
                "status": "PENDING",
                "message": "Waiting for upstream dependencies.",
                "runtimeParamJson": json.dumps(step.get("params") or {}, ensure_ascii=False),
                "nodePayloadJson": json.dumps(step.get("nodePayload") or {}, ensure_ascii=False)
            })
    finally:
        cursor.close()


def update_node_run_runtime_params(conn, flow_run_id: int, node_key: str, runtime_values: Dict[str, Any]):
    cursor = conn.cursor()
    try:
        execute_flow_dml(cursor, f"FLOW_WORK_NODE_RUN_UPDATE_RUNTIME_PARAMS[{node_key}]", "FLOW_WORK_NODE_RUN_UPDATE_RUNTIME_PARAMS", {
            "flowRunId": flow_run_id,
            "nodeKey": node_key,
            "runtimeParamJson": json.dumps(runtime_values or {}, ensure_ascii=False)
        })
    finally:
        cursor.close()


def update_node_run_output(conn, flow_run_id: int, node_key: str, output: Dict[str, Any]):
    cursor = conn.cursor()
    try:
        execute_flow_dml(cursor, f"FLOW_WORK_NODE_RUN_UPDATE_OUTPUT[{node_key}]", "FLOW_WORK_NODE_RUN_UPDATE_OUTPUT", {
            "flowRunId": flow_run_id,
            "nodeKey": node_key,
            "runOutputJson": json.dumps(output or {}, ensure_ascii=False),
        })
    finally:
        cursor.close()


def start_node_run_by_key(conn, flow_run_id: int, node_key: str, runtime_values: Dict[str, Any]):
    cursor = conn.cursor()
    try:
        execute_flow_dml(cursor, f"FLOW_WORK_NODE_RUN_START_BY_KEY[{node_key}:RUNNING]", "FLOW_WORK_NODE_RUN_START_BY_KEY", {
            "flowRunId": flow_run_id,
            "nodeKey": node_key,
            "message": "Node execution started.",
            "runtimeParamJson": json.dumps(runtime_values or {}, ensure_ascii=False)
        })
    finally:
        cursor.close()


def skip_node_run_by_key(conn, flow_run_id: int, node_key: str, message: str, runtime_values: Dict[str, Any]):
    cursor = conn.cursor()
    try:
        execute_flow_dml(cursor, f"FLOW_WORK_NODE_RUN_SKIP_BY_KEY[{node_key}:SKIPPED]", "FLOW_WORK_NODE_RUN_SKIP_BY_KEY", {
            "flowRunId": flow_run_id,
            "nodeKey": node_key,
            "message": normalize_text(message, "", 4000),
            "runtimeParamJson": json.dumps(runtime_values or {}, ensure_ascii=False)
        })
    finally:
        cursor.close()


def update_node_run_by_key(
    conn,
    flow_run_id: int,
    node_key: str,
    status: str,
    message: str,
    started: bool = False,
    finished: bool = False
):
    cursor = conn.cursor()
    try:
        execute_flow_dml(cursor, f"FLOW_WORK_NODE_RUN_UPDATE_BY_KEY[{node_key}:{status}]", "FLOW_WORK_NODE_RUN_UPDATE_BY_KEY", {
            "flowRunId": flow_run_id,
            "nodeKey": node_key,
            "status": normalize_status(status, "PENDING"),
            "message": normalize_text(message, "", 4000),
            "startedYn": "Y" if started else "N",
            "finishedYn": "Y" if finished else "N"
        })
    finally:
        cursor.close()


def update_run(conn, flow_run_id: int, status: str, message: str, plan: Dict[str, Any]):
    cursor = conn.cursor()
    try:
        execute_flow_dml(cursor, f"FLOW_WORK_RUN_UPDATE[{status}]", "FLOW_WORK_RUN_UPDATE", {
            "flowRunId": flow_run_id,
            "status": normalize_status(status, "SUCCESS"),
            "message": normalize_text(message, "", 4000),
            "planJson": json.dumps(plan or {}, ensure_ascii=False)
        })
    finally:
        cursor.close()


def start_run(conn, flow_run_id: int, message: str):
    cursor = conn.cursor()
    try:
        execute_flow_dml(cursor, "FLOW_WORK_RUN_START", "FLOW_WORK_RUN_START", {
            "flowRunId": flow_run_id,
            "message": normalize_text(message, "", 4000)
        })
    finally:
        cursor.close()


TERMINAL_NODE_STATUSES = {"SUCCESS", "FAILED", "SKIPPED"}


def is_on_complete_edge(edge: Dict[str, Any]) -> bool:
    edge_mode = str(edge.get("edgeMode") or "").upper()
    dashed_yn = str(edge.get("dashedYn") or "").upper()
    return dashed_yn == "Y" or edge_mode in {"REFERENCE", "ON_COMPLETE"}


def get_external_dependency_requirements(plan: List[Dict[str, Any]], selected_plan: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    selected_keys = {str(step.get("nodeKey") or "") for step in selected_plan or []}
    plan_by_key = {str(step.get("nodeKey") or ""): step for step in plan or []}
    requirements: Dict[str, Dict[str, Any]] = {}
    for step in selected_plan or []:
        for edge in step.get("incomingEdges") or []:
            if not isinstance(edge, dict):
                continue
            source_key = str(edge.get("fromNodeKey") or "")
            if not source_key or source_key in selected_keys:
                continue
            source_step = plan_by_key.get(source_key, {})
            required_status = "TERMINAL" if is_on_complete_edge(edge) else "SUCCESS"
            existing = requirements.get(source_key)
            if existing and existing.get("requiredStatus") == "SUCCESS":
                continue
            requirements[source_key] = {
                "nodeKey": source_key,
                "nodeName": source_step.get("nodeName") or source_key,
                "requiredStatus": required_status,
                "edgeMode": edge.get("edgeMode") or ("ON_COMPLETE" if is_on_complete_edge(edge) else "SERIAL")
            }
    return list(requirements.values())


def is_dependency_requirement_satisfied(requirement: Dict[str, Any], status: str) -> bool:
    value = str(status or "").upper()
    if requirement.get("requiredStatus") == "TERMINAL":
        return value in TERMINAL_NODE_STATUSES
    return value == "SUCCESS"


def build_dependency_requirement_message(requirements: List[Dict[str, Any]], status_by_key: Dict[str, str]) -> str:
    missing = []
    for requirement in requirements:
        node_key = requirement.get("nodeKey") or ""
        status = str(status_by_key.get(node_key) or "NOT_RUN").upper()
        if is_dependency_requirement_satisfied(requirement, status):
            continue
        required = "finished" if requirement.get("requiredStatus") == "TERMINAL" else "SUCCESS"
        missing.append(f"{requirement.get('nodeName') or node_key}({node_key}) needs {required}, current={status}")
    if not missing:
        return ""
    return "; ".join(missing)


def get_node_status_map(conn, flow_run_id: int) -> Dict[str, str]:
    rows = list_node_runs(conn, flow_run_id).get("data", [])
    status_by_key: Dict[str, str] = {}
    for row in rows:
        node_key = str(row.get("NODE_KEY") or "")
        if node_key:
            status_by_key[node_key] = str(row.get("STATUS") or "").upper()
    return status_by_key


def find_latest_compatible_run_id(
    conn,
    flow_id: int,
    plan: List[Dict[str, Any]],
    selected_plan: List[Dict[str, Any]]
) -> Optional[int]:
    requirements = get_external_dependency_requirements(plan, selected_plan)
    if not requirements:
        return None
    for row in list_runs_by_flow(conn, flow_id):
        status = str(row.get("STATUS") or "").upper()
        if status in {"STARTED", "RUNNING", "QUEUED", "PENDING"}:
            continue
        flow_run_id = int(row.get("FLOW_RUN_ID") or 0)
        if flow_run_id <= 0:
            continue
        status_by_key = get_node_status_map(conn, flow_run_id)
        if not build_dependency_requirement_message(requirements, status_by_key):
            return flow_run_id
    return None


def require_compatible_continue_run(
    conn,
    flow_id: int,
    flow_run_id: int,
    plan: List[Dict[str, Any]],
    selected_plan: List[Dict[str, Any]]
):
    requirements = get_external_dependency_requirements(plan, selected_plan)
    if not requirements:
        return
    status_by_key = get_node_status_map(conn, flow_run_id)
    missing = build_dependency_requirement_message(requirements, status_by_key)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Run from selected node cannot start because upstream results are missing in the selected FLOW_RUN_ID. "
                f"FLOW_RUN_ID={flow_run_id}. Missing upstream status: {missing}. "
                "Run the upstream node(s) first in the same flow run context, or use Run now from the beginning.\n"
                "선택 노드부터 실행하려면 같은 FLOW_RUN_ID 안에 선행 노드의 실행 결과가 있어야 합니다. "
                f"FLOW_RUN_ID={flow_run_id}, 부족한 선행 노드 상태: {missing}. "
                "선행 노드를 먼저 실행하거나 상단 Run now로 처음부터 실행해 주세요."
            )
        )


def get_dependency_skip_message(
    step: Dict[str, Any],
    node_status: Dict[str, str],
    plan_node_keys: Set[str]
) -> str:
    blocking: List[str] = []
    waiting: List[str] = []
    for edge in step.get("incomingEdges") or []:
        if not isinstance(edge, dict):
            continue
        source_key = str(edge.get("fromNodeKey") or "")
        if not source_key or source_key not in plan_node_keys:
            continue
        source_status = str(node_status.get(source_key) or "PENDING").upper()
        if is_on_complete_edge(edge):
            if source_status not in TERMINAL_NODE_STATUSES:
                waiting.append(f"{source_key}({source_status})")
            continue
        if source_status != "SUCCESS":
            blocking.append(f"{source_key}({source_status})")
    if blocking:
        return "Skipped because solid upstream node(s) did not finish with SUCCESS: " + ", ".join(blocking)
    if waiting:
        return "Skipped because upstream node(s) did not finish yet: " + ", ".join(waiting)
    return ""


def execute_flow_plan(
    conn,
    flow_run_id: int,
    plan: List[Dict[str, Any]],
    runtime_defaults: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    prepare_flow_run_session(conn)
    executed = 0
    failed = 0
    skipped = 0
    enriched_plan = []
    plan_steps = plan or []
    plan_node_keys = {str(step.get("nodeKey") or "") for step in plan_steps}
    node_status: Dict[str, str] = {}
    node_outputs: Dict[str, Dict[str, Any]] = {}

    for step in plan_steps:
        node_key = step.get("nodeKey") or ""
        node_name = step.get("nodeName") or node_key
        step_result = {**step}
        runtime_values = create_runtime_values(step, node_outputs, flow_run_id)
        runtime_values.update(runtime_defaults or {})
        dependency_skip_message = get_dependency_skip_message(step, node_status, plan_node_keys)
        if dependency_skip_message:
            output = build_node_output(step, {})
            node_outputs[node_key] = output
            skip_node_run_by_key(conn, flow_run_id, node_key, dependency_skip_message, runtime_values)
            conn.commit()
            step_result.update({"status": "SKIPPED", "message": dependency_skip_message, "output": output})
            enriched_plan.append(step_result)
            node_status[node_key] = "SKIPPED"
            skipped += 1
            continue

        if str(step.get("useYn") or "Y").upper() == "N":
            output = build_node_output(step, {})
            node_outputs[node_key] = output
            message = "Node execution skipped because node useYn is N."
            skip_node_run_by_key(conn, flow_run_id, node_key, message, runtime_values)
            conn.commit()
            step_result.update({"status": "SKIPPED", "message": message, "output": output})
            enriched_plan.append(step_result)
            node_status[node_key] = "SKIPPED"
            skipped += 1
            continue

        start_node_run_by_key(conn, flow_run_id, node_key, runtime_values)
        conn.commit()
        try:
            node_result = execute_flow_node(conn, step, runtime_values)
            message = node_result.get("message") or "Node executed."
            execution_status = str(node_result.get("status") or "SUCCESS").strip().upper()
            update_node_run_runtime_params(conn, flow_run_id, node_key, runtime_values)
            update_node_run_output(conn, flow_run_id, node_key, node_result.get("output") or {})
            if execution_status in {"PARTIAL", "PARTIAL_SUCCESS", "FAILED", "ERROR"}:
                failed_message = f"Node partially completed and requires review. {message}" if execution_status in {"PARTIAL", "PARTIAL_SUCCESS"} else message
                update_node_run_by_key(conn, flow_run_id, node_key, "FAILED", failed_message, False, True)
                conn.commit()
                node_outputs[node_key] = node_result.get("output") or {}
                step_result.update({"status": "FAILED", "message": failed_message, "output": node_outputs[node_key]})
                node_status[node_key] = "FAILED"
                failed += 1
                enriched_plan.append(step_result)
                continue
            update_node_run_by_key(conn, flow_run_id, node_key, "SUCCESS", message, False, True)
            conn.commit()
            node_outputs[node_key] = node_result.get("output") or {}
            step_result.update({"status": "SUCCESS", "message": message, "output": node_outputs[node_key]})
            node_status[node_key] = "SUCCESS"
            executed += 1
        except Exception as exc:
            message = str(exc)
            conn.rollback()
            output = build_node_output(step, {})
            node_outputs[node_key] = output
            step_result.update({"status": "FAILED", "message": message})
            update_node_run_by_key(conn, flow_run_id, node_key, "FAILED", message, False, True)
            conn.commit()
            node_status[node_key] = "FAILED"
            failed += 1
            enriched_plan.append(step_result)
            continue
        enriched_plan.append(step_result)

    if failed:
        failed_step = next((step for step in enriched_plan if step.get("status") == "FAILED"), {}) if enriched_plan else {}
        failed_name = failed_step.get("nodeName") or failed_step.get("nodeKey") or "Unknown node"
        failed_message = normalize_text(failed_step.get("message") or "", "", 1000)
        message = (
            f"Flow execution completed with failures. {executed} node(s) succeeded, "
            f"{failed} failed, {skipped} skipped. First failed node: {failed_name}. {failed_message}"
        ).strip()
        update_run(conn, flow_run_id, "FAILED", message, {"plan": enriched_plan})
        conn.commit()
        return {
            "status": "FAILED",
            "message": message,
            "plan": enriched_plan
        }

    update_run(conn, flow_run_id, "SUCCESS", f"Flow execution completed. {executed} node(s) executed, {skipped} skipped.", {"plan": enriched_plan})
    conn.commit()
    return {
        "status": "SUCCESS",
        "message": f"Flow execution completed. {executed} node(s) executed, {skipped} skipped.",
        "plan": enriched_plan
    }


def execute_flow_node(conn, step: Dict[str, Any], runtime_values: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    node_type = str(step.get("nodeType") or "").upper()
    ref_work_job_id = step.get("refWorkJobId")
    ref_menu_code = step.get("refMenuCode")
    if ref_work_job_id and ref_menu_code:
        job = data_work.load_job(conn, ref_menu_code, int(ref_work_job_id))
        if str(job.get("EXEC_SOURCE_TYPE") or "").upper() == "WEB_API":
            values = runtime_values if runtime_values is not None else create_runtime_values(step)
            apply_scoped_model_runtime_values(step, job, values)
            execution = api_call_service.execute_api_job(
                conn,
                job,
                values,
                values.get("INIT$RunId") or values.get("runId"),
                include_result=True,
            )
            api_result = execution.get("result") or {}
            api_status = str(api_result.get("status") or "success").strip().lower()
            return {
                "status": "PARTIAL" if api_status == "partial_success" else ("FAILED" if api_status in {"failed", "error"} else "SUCCESS"),
                "message": execution.get("message") or "API node executed.",
                "output": build_contract_node_output(step, job, values, api_result),
            }
        executable_script = normalize_executable_script(job.get("EXEC_PLSQL") or "")
        if not executable_script:
            return {
                "message": "No executable script was saved. Node skipped.",
                "output": build_contract_node_output(step, job, runtime_values or {})
            }
        values = runtime_values if runtime_values is not None else create_runtime_values(step)
        apply_scoped_model_runtime_values(step, job, values)
        message = execute_saved_job_script(conn, executable_script, job, values)
        return {
            "message": message,
            "output": build_contract_node_output(step, job, values)
        }
    if node_type in {"JOB", "DATA_PROFILE", "COLUMN_CORR", "AUTO_RULE", "RULE_VIOLATION"}:
        raise HTTPException(status_code=400, detail="Job node does not reference a saved work job.")
    return {
        "message": f"{node_type or 'NODE'} node has no executable job. Marked as success.",
        "output": build_node_output(step, {}, runtime_values or {})
    }


def execute_saved_job_script(
    conn,
    executable_script: Dict[str, str],
    job: Dict[str, Any],
    runtime_bind_values: Optional[Dict[str, Any]] = None
) -> str:
    cursor = conn.cursor()
    try:
        script_text, bind_values = prepare_saved_job_script(executable_script["text"], job, runtime_bind_values or {})
        output_enabled = False
        if executable_script["type"] == "PLSQL":
            try:
                cursor.callproc("DBMS_OUTPUT.ENABLE")
                output_enabled = True
            except Exception:
                output_enabled = False
        cursor.execute(script_text, bind_values)
        script_type = executable_script["type"]
        label = job.get("EXEC_OBJECT_LABEL") or job.get("EXEC_OBJECT_NAME") or job.get("JOB_NAME") or script_type
        if script_type == "SELECT":
            return f"{label} SELECT statement executed."
        if script_type == "DDL":
            return f"{label} DDL statement executed."
        if script_type == "DML":
            rowcount = cursor.rowcount if cursor.rowcount is not None else 0
            return f"{label} DML statement executed. {rowcount} rows affected."
        output_lines = collect_dbms_output(cursor) if output_enabled else []
        message = f"{label} PL/SQL block executed."
        if output_lines:
            message += "\n\nDBMS_OUTPUT:\n" + "\n".join(output_lines)
        return message
    finally:
        cursor.close()


def collect_dbms_output(cursor) -> List[str]:
    lines = []
    line_var = cursor.var(str)
    status_var = cursor.var(int)
    while True:
        cursor.callproc("DBMS_OUTPUT.GET_LINE", [line_var, status_var])
        if status_var.getvalue() != 0:
            break
        line = line_var.getvalue()
        if line is not None:
            lines.append(str(line))
    return lines


def create_runtime_values(
    step: Dict[str, Any],
    node_outputs: Optional[Dict[str, Dict[str, Any]]] = None,
    flow_run_id: Optional[int] = None
) -> Dict[str, Any]:
    values = {}
    for item in step.get("params") or []:
        if not isinstance(item, dict):
            continue
        key = item.get("itemName") or item.get("ITEM_NAME") or item.get("name") or item.get("key")
        value = get_flow_param_runtime_value(item)
        if key:
            values[str(key)] = value
    apply_upstream_result_mappings(values, step, node_outputs or {})
    values.update(build_step_system_bind_values(step, node_outputs or {}, flow_run_id))
    return values


def get_flow_param_runtime_value(item: Dict[str, Any]) -> Any:
    if "value" in item and normalize_bind_value(item.get("value")) is not None:
        return item.get("value")
    if "VALUE" in item and normalize_bind_value(item.get("VALUE")) is not None:
        return item.get("VALUE")
    if "itemDefault" in item and normalize_bind_value(item.get("itemDefault")) is not None:
        return item.get("itemDefault")
    if "ITEM_DEFAULT" in item and normalize_bind_value(item.get("ITEM_DEFAULT")) is not None:
        return item.get("ITEM_DEFAULT")
    return item.get("value", item.get("VALUE", item.get("itemDefault", item.get("ITEM_DEFAULT"))))


def build_step_system_bind_values(
    step: Dict[str, Any],
    node_outputs: Dict[str, Dict[str, Any]],
    flow_run_id: Optional[int] = None
) -> Dict[str, Any]:
    current = build_node_output(step, {})
    previous = find_previous_node_output(step, node_outputs)
    effective_run_id = int(flow_run_id or 0)
    return {
        "INIT$TargetOwner": current.get("targetOwner") or "",
        "INIT$TargetTable": current.get("targetTable") or "",
        "INIT$ResultOwner": current.get("resultOwner") or "",
        "INIT$ResultTable": current.get("resultTableName") or "",
        "INIT$ResultModelName": current.get("resultTableName") or "",
        "INIT$PreTargetOwner": previous.get("targetOwner") or "",
        "INIT$PreTargetTable": previous.get("targetTable") or "",
        "INIT$PreResultOwner": previous.get("resultOwner") or "",
        "INIT$PreResultTable": previous.get("resultTableName") or "",
        "INIT$RunSourceType": "FLOW_WORK",
        "INIT$RunId": effective_run_id,
        "INIT$FlowRunId": effective_run_id,
        "runSourceType": "FLOW_WORK",
        "runId": effective_run_id,
        "flowRunId": effective_run_id
    }


def find_previous_node_output(step: Dict[str, Any], node_outputs: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    incoming_edges = step.get("incomingEdges") or step.get("inputMappings") or []
    if not incoming_edges:
        return {}
    preferred_edges = [
        edge for edge in incoming_edges
        if str(edge.get("dashedYn") or "").upper() != "Y"
        and str(edge.get("edgeMode") or "SERIAL").upper() not in {"REFERENCE", "ON_COMPLETE"}
    ] or incoming_edges
    edge = preferred_edges[0] if preferred_edges else {}
    source_key = edge.get("fromNodeKey")
    source = node_outputs.get(str(source_key or ""), {})
    if source:
        return source
    return build_node_output({"nodePayload": edge.get("fromNodePayload") or {}}, {})


def apply_upstream_result_mappings(values: Dict[str, Any], step: Dict[str, Any], node_outputs: Dict[str, Dict[str, Any]]):
    for edge in step.get("inputMappings") or []:
        if not isinstance(edge, dict):
            continue
        params = edge.get("params") or {}
        if not isinstance(params, dict) or params.get("inputSource") != "UPSTREAM_RESULT":
            continue
        source_key = edge.get("fromNodeKey") or params.get("fromNodeKey")
        source = node_outputs.get(str(source_key or ""), {})
        if not source:
            source = build_node_output({"nodePayload": edge.get("fromNodePayload") or {}}, {})
        if data_work.normalize_result_create_mode(source.get("resultCreateYn")) != "T":
            continue
        if not source.get("resultOwner") or not source.get("resultTableName"):
            continue
        bind_to = params.get("bindTo") if isinstance(params.get("bindTo"), dict) else {}
        for bind_name, expression in bind_to.items():
            value = resolve_upstream_expression(expression, source)
            if value is not None:
                values[str(bind_name)] = value


def resolve_upstream_expression(expression: Any, source: Dict[str, Any]) -> Any:
    if not isinstance(expression, str):
        return expression
    if not expression.startswith("$from."):
        return expression
    return source.get(expression[6:])


LEGACY_ASSOCIATION_MODEL_NAMES = {"OML_ASSOCIATION_MODEL_01"}


def is_apriori_association_job(job: Dict[str, Any]) -> bool:
    object_name = str(job.get("EXEC_OBJECT_NAME") or job.get("execObjectName") or "").strip().upper()
    method_name = str(job.get("EXEC_METHOD") or job.get("execMethod") or "").strip().upper()
    return object_name in {
        "INIT$_SP_APRIORI_ASSOC_MODEL",
        "INTEGRATED_RULE_DISCOVER",
    } or method_name == "INTEGRATED_RULE_DISCOVER"


def create_scoped_model_name(prefix: str, seed: str, run_id: Optional[int] = None) -> str:
    safe_prefix = re.sub(r"[^A-Z0-9_$#]", "_", str(prefix or "OML_MODEL").strip().upper())
    safe_prefix = re.sub(r"^[^A-Z]+", "", safe_prefix) or "OML_MODEL"
    safe_seed = re.sub(r"[^A-Z0-9_$#]", "_", str(seed or "MODEL").strip().upper())
    safe_seed = re.sub(r"^[^A-Z]+", "", safe_seed) or "MODEL"
    suffix = f"{safe_seed}_{int(run_id or 0)}" if run_id else safe_seed
    max_suffix_length = max(1, 128 - len(safe_prefix) - 1)
    return f"{safe_prefix}_{suffix[-max_suffix_length:]}"[:128]


def resolve_scoped_apriori_model_name(step: Dict[str, Any], job: Dict[str, Any], runtime_values: Optional[Dict[str, Any]] = None) -> str:
    runtime_values = runtime_values or {}
    current = step.get("nodePayload") or {}
    base_name = (
        runtime_values.get("INIT$ResultModelName")
        or runtime_values.get("INIT$ResultTable")
        or current.get("resultTableName")
        or job.get("RESULT_TABLE_NAME")
        or ""
    )
    normalized_base = str(base_name or "").strip().upper()
    if not is_apriori_association_job(job) or normalized_base not in LEGACY_ASSOCIATION_MODEL_NAMES:
        return normalized_base
    target_table = (
        runtime_values.get("INIT$TargetTable")
        or current.get("tableName")
        or job.get("TABLE_NAME")
        or normalized_base
    )
    run_id = runtime_values.get("INIT$RunId") or runtime_values.get("runId") or runtime_values.get("flowRunId")
    return create_scoped_model_name("OML_ASSOC", str(target_table or normalized_base), int(run_id or 0))


def apply_scoped_model_runtime_values(step: Dict[str, Any], job: Dict[str, Any], runtime_values: Dict[str, Any]):
    if not is_apriori_association_job(job):
        return
    model_name = resolve_scoped_apriori_model_name(step, job, runtime_values)
    if not model_name:
        return
    runtime_values["INIT$ResultModelName"] = model_name
    runtime_values["INIT$ResultTable"] = model_name
    for key in ("P_MODEL_NAME", "P_ASSOC_MODEL_NAME", "pModelName", "modelName"):
        value = str(runtime_values.get(key) or "").strip()
        if not value or value.upper() in LEGACY_ASSOCIATION_MODEL_NAMES or value in {":INIT$ResultModelName", ":INIT$ResultTable"}:
            runtime_values[key] = model_name


def build_node_output(step: Dict[str, Any], job: Dict[str, Any], runtime_values: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = step.get("nodePayload") or {}
    runtime_values = runtime_values or {}
    target_owner = payload.get("ownerName") or job.get("OWNER_NAME")
    target_table = payload.get("tableName") or job.get("TABLE_NAME")
    result_create_yn = data_work.normalize_result_create_mode(payload.get("resultCreateYn") or job.get("RESULT_CREATE_YN"))
    result_owner = payload.get("resultOwner") or job.get("RESULT_OWNER") or payload.get("ownerName") or job.get("OWNER_NAME")
    result_table = (
        runtime_values.get("INIT$ResultModelName")
        if result_create_yn == "M" and runtime_values.get("INIT$ResultModelName")
        else payload.get("resultTableName") or job.get("RESULT_TABLE_NAME") or payload.get("tableName") or job.get("TABLE_NAME")
    )
    target_owner = str(target_owner or "").strip().upper()
    target_table = str(target_table or "").strip().upper()
    result_owner = str(result_owner or "").strip().upper()
    result_table = str(result_table or "").strip().upper()
    output = {
        "targetOwner": target_owner,
        "targetTable": target_table,
        "resultCreateYn": result_create_yn,
        "resultOwner": result_owner,
        "resultTableName": result_table,
        "resultTable": result_table,
        "qualifiedTable": f"{result_owner}.{result_table}" if result_owner and result_table else "",
        "quotedTable": quote_qualified_table(result_owner, result_table) if result_owner and result_table else ""
    }
    return output


def build_contract_node_output(
    step: Dict[str, Any],
    job: Dict[str, Any],
    runtime_values: Optional[Dict[str, Any]] = None,
    execution_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    runtime_values = runtime_values or {}
    execution_result = execution_result or {}
    output = build_node_output(step, job, runtime_values)
    node_payload = dict(step.get("nodePayload") or {})
    if not node_payload.get("execObjectName"):
        node_payload["execObjectName"] = job.get("EXEC_OBJECT_NAME") or job.get("execObjectName")
    if not node_payload.get("execMethod"):
        node_payload["execMethod"] = job.get("EXEC_METHOD") or job.get("execMethod")
    contract_ports = flow_contracts.get_contract_ports(node_payload, "out")
    if not contract_ports:
        output["resultObjects"] = [{
            "artifact": "",
            "kind": "MODEL" if output.get("resultCreateYn") == "M" else "TABLE",
            "owner": output.get("resultOwner"),
            "objectName": output.get("resultTableName"),
            "runScope": "SAME_RUN",
        }] if output.get("resultTableName") else []
        return output

    reported_tables = {
        str(value or "").strip().upper()
        for value in execution_result.get("resultTables") or []
        if value
    }
    reported_table = str(execution_result.get("resultTable") or "").strip().upper()
    if reported_table:
        reported_tables.add(reported_table)
    reported_models = {
        str(value or "").strip().upper()
        for value in execution_result.get("resultModels") or []
        if value
    }
    has_explicit_outputs = "resultTables" in execution_result or "resultModels" in execution_result

    result_objects = []
    for port in contract_ports:
        object_name = str(port.get("objectName") or "").strip()
        if object_name.startswith(":INIT$"):
            object_name = str(
                runtime_values.get(object_name[1:])
                or output.get("resultTableName")
                or ""
            )
        object_name = object_name.strip().upper()
        if not object_name:
            continue
        kind = str(port.get("kind") or "TABLE").strip().upper()
        if has_explicit_outputs:
            if kind == "MODEL" and object_name not in reported_models:
                continue
            if kind != "MODEL" and object_name not in reported_tables:
                continue
        result_objects.append({
            "port": port.get("port"),
            "artifact": port.get("artifact"),
            "label": port.get("label") or port.get("artifact"),
            "kind": kind,
            "owner": output.get("resultOwner"),
            "objectName": object_name,
            "runScope": port.get("runScope") or "SAME_RUN",
        })
    output["resultObjects"] = result_objects
    output["apiResult"] = execution_result
    return output


def quote_identifier(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def quote_qualified_table(owner: str, table_name: str) -> str:
    return f"{quote_identifier(owner)}.{quote_identifier(table_name)}"


def prepare_saved_job_script(script_text: str, job: Dict[str, Any], runtime_bind_values: Optional[Dict[str, Any]] = None) -> tuple[str, Dict[str, Any]]:
    params = job.get("PARAMS") or []
    param_values = {
        str(param.get("itemName") or param.get("ITEM_NAME") or ""): param.get("itemDefault", param.get("ITEM_DEFAULT"))
        for param in params
        if param.get("itemName") or param.get("ITEM_NAME")
    }
    runtime_values = runtime_bind_values or {}

    def replace_dynamic_token(match):
        key = match.group(1).strip()
        value = runtime_values.get(key)
        if value is None:
            value = runtime_values.get(to_bind_variable_name(key))
        if value is None:
            value = param_values.get(key)
        return "" if normalize_bind_value(value) is None else str(value)

    prepared_text = re.sub(
        r"/\*\s*--\s*([A-Za-z][A-Za-z0-9_$#]*(?:_[A-Za-z0-9_$#]+)*)\s*--\s*\*/",
        replace_dynamic_token,
        script_text or "",
    )
    bind_values_by_name = {
        to_bind_variable_name(param_name): value
        for param_name, value in param_values.items()
    }
    for runtime_name, runtime_value in runtime_values.items():
        runtime_bind_names = [str(runtime_name)]
        if "_" in str(runtime_name):
            runtime_bind_names.append(to_bind_variable_name(str(runtime_name)))
        for bind_name in runtime_bind_names:
            if normalize_bind_value(runtime_value) is None and normalize_bind_value(bind_values_by_name.get(bind_name)) is not None:
                continue
            bind_values_by_name[bind_name] = runtime_value
    used_bind_names = set(re.findall(r"(?<!:):([A-Za-z][A-Za-z0-9_$#]*)", mask_sql_for_bind_scan(prepared_text)))
    bind_values = {
        bind_name: normalize_bind_value(bind_values_by_name.get(bind_name))
        for bind_name in used_bind_names
    }
    return prepared_text, bind_values


def normalize_executable_script(script: str) -> Optional[Dict[str, str]]:
    text = (script or "").strip()
    text = re.sub(r"(?m)^\s*/\s*$", "", text).strip()
    if not text:
        return None
    if re.match(r"(?is)^(declare|begin)\b", text):
        return {"type": "PLSQL", "text": normalize_plsql_script(text)}

    sql = re.sub(r";+\s*$", "", text).strip()
    if re.search(r";\s*\S", sql):
        raise HTTPException(status_code=400, detail="Only a single executable statement is allowed.")
    if re.match(r"(?is)^(select|with)\b", sql):
        return {"type": "SELECT", "text": sql}
    if re.match(r"(?is)^create\s+table\b", sql):
        return {"type": "DDL", "text": sql}
    if re.match(r"(?is)^(insert|update|delete|merge)\b", sql):
        return {"type": "DML", "text": sql}
    raise HTTPException(status_code=400, detail="Executable script must be PL/SQL, SELECT, CREATE TABLE, or DML.")


def normalize_plsql_script(script: str) -> str:
    text = (script or "").strip()
    text = re.sub(r"(?m)^\s*/\s*$", "", text).strip()
    if not text:
        return ""
    if not re.match(r"(?is)^(declare|begin)\b", text):
        raise HTTPException(status_code=400, detail="Executable script must start with DECLARE or BEGIN.")
    if not re.search(r"(?is)\bend\s*;\s*$", text):
        raise HTTPException(status_code=400, detail="Executable PL/SQL script must end with END;.")
    return text


def mask_sql_for_bind_scan(sql_text: str) -> str:
    text = sql_text or ""
    text = re.sub(r"(?s)'(?:''|[^'])*'", lambda match: " " * len(match.group(0)), text)
    text = re.sub(r'(?s)"(?:""|[^"])*"', lambda match: " " * len(match.group(0)), text)
    text = re.sub(r"(?s)/\*.*?\*/", lambda match: " " * len(match.group(0)), text)
    text = re.sub(r"(?m)--[^\r\n]*", lambda match: " " * len(match.group(0)), text)
    return text


def to_bind_variable_name(parameter_name: str) -> str:
    parts = [part for part in str(parameter_name or "").strip().split("_") if part]
    if not parts:
        return "paramValue"
    result = []
    for index, part in enumerate(parts):
        lower = part.lower()
        result.append(lower if index == 0 else lower[:1].upper() + lower[1:])
    return "".join(result)


def normalize_bind_value(value: Any) -> Any:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.lower() in {"null", "(null)", "(auto)"}:
        return None
    if re.fullmatch(r"-?\d+", text):
        try:
            return int(text)
        except Exception:
            return text
    if re.fullmatch(r"-?\d+\.\d+", text):
        try:
            return float(text)
        except Exception:
            return text
    return value


def build_execution_plan(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    node_keys = [node["nodeKey"] for node in nodes]
    node_map = {node["nodeKey"]: node for node in nodes}
    incoming = {node_key: 0 for node_key in node_keys}
    outgoing = {node_key: [] for node_key in node_keys}

    for edge in edges:
        source = edge["fromNodeKey"]
        target = edge["toNodeKey"]
        if source not in outgoing or target not in incoming:
            continue
        outgoing[source].append(target)
        incoming[target] += 1

    queue = sorted([node_key for node_key, count in incoming.items() if count == 0])
    level = {node_key: 0 for node_key in queue}
    result = []

    while queue:
        node_key = queue.pop(0)
        node = node_map[node_key]
        result.append({
            "nodeKey": node_key,
            "nodeName": node.get("nodeName"),
            "nodeType": node.get("nodeType"),
            "useYn": node.get("useYn", "Y"),
            "refMenuCode": node.get("refMenuCode"),
            "refWorkJobId": node.get("refWorkJobId"),
            "refObjectId": node.get("refObjectId"),
            "params": node.get("params") or [],
            "nodePayload": node,
            "level": level.get(node_key, 0),
            "upstream": sorted([edge["fromNodeKey"] for edge in edges if edge["toNodeKey"] == node_key]),
            "incomingEdges": [
                {
                    **edge,
                    "fromNodePayload": node_map.get(edge["fromNodeKey"], {})
                }
                for edge in edges
                if edge["toNodeKey"] == node_key
            ],
            "inputMappings": [
                {
                    **edge,
                    "fromNodePayload": node_map.get(edge["fromNodeKey"], {})
                }
                for edge in edges
                if edge["toNodeKey"] == node_key and edge.get("params")
            ],
            "downstream": sorted(outgoing.get(node_key, []))
        })
        for target in sorted(outgoing.get(node_key, [])):
            incoming[target] -= 1
            level[target] = max(level.get(target, 0), level.get(node_key, 0) + 1)
            if incoming[target] == 0:
                queue.append(target)
                queue.sort()

    return result


def validate_graph(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not nodes:
        return {"status": "error", "message": "At least one node is required.", "plan": []}

    node_keys = [node["nodeKey"] for node in nodes]
    if len(node_keys) != len(set(node_keys)):
        return {"status": "error", "message": "Duplicate node IDs exist.", "plan": []}

    node_set = set(node_keys)
    for edge in edges:
        if edge["fromNodeKey"] not in node_set or edge["toNodeKey"] not in node_set:
            return {"status": "error", "message": "An edge references a missing node.", "plan": []}
        if edge["fromNodeKey"] == edge["toNodeKey"]:
            return {"status": "error", "message": "Self-loop edges are not allowed.", "plan": []}

    plan = build_execution_plan(nodes, edges)
    if len(plan) != len(nodes):
        return {"status": "error", "message": "The flow has a cycle. Remove circular dependencies.", "plan": plan}

    contract_errors = flow_contracts.validate_flow_contracts(nodes, edges)
    if contract_errors:
        return {
            "status": "error",
            "message": "Flow model contract validation failed. " + " ".join(contract_errors),
            "errors": contract_errors,
            "plan": plan,
        }

    return {"status": "success", "message": "Flow validation succeeded.", "plan": plan}


def normalize_graph(nodes: List[FlowNodeRequest], edges: List[FlowEdgeRequest]):
    clean_nodes = [normalize_node(node, index) for index, node in enumerate(nodes or [], start=1)]
    clean_edges = [
        normalize_edge(edge, index)
        for index, edge in enumerate(edges or [], start=1)
    ]
    return clean_nodes, clean_edges


def normalize_node(node: FlowNodeRequest, sort_order: int) -> Dict[str, Any]:
    node_key = normalize_key(node.nodeKey)
    node_type = normalize_token(node.nodeType, "JOB", 100)
    node_name = normalize_text(node.nodeName, node_key, 200) or node_key
    return {
        "nodeKey": node_key,
        "nodeType": node_type,
        "nodeName": node_name,
        "nodeDesc": normalize_text(node.nodeDesc, "", 1000),
        "useYn": "N" if str(getattr(node, "useYn", "Y") or "Y").upper() == "N" else "Y",
        "refMenuCode": normalize_optional_token(node.refMenuCode, 30),
        "refWorkJobId": int(node.refWorkJobId) if node.refWorkJobId else None,
        "refObjectId": int(node.refObjectId) if node.refObjectId else None,
        "ownerName": normalize_optional_identifier(node.ownerName),
        "tableName": normalize_optional_identifier(node.tableName),
        "resultCreateYn": data_work.normalize_result_create_mode(getattr(node, "resultCreateYn", None)),
        "resultOwner": normalize_optional_identifier(getattr(node, "resultOwner", None)),
        "resultTableName": normalize_optional_identifier(getattr(node, "resultTableName", None)),
        "execObjectName": normalize_optional_identifier(getattr(node, "execObjectName", None)),
        "execMethod": normalize_optional_token(getattr(node, "execMethod", None), 128),
        "positionLeft": round_number(node.positionLeft),
        "positionTop": round_number(node.positionTop),
        "nodeWidth": round_number(node.nodeWidth),
        "nodeHeight": round_number(node.nodeHeight),
        "inputs": node.inputs or [],
        "outputs": node.outputs or [],
        "params": node.params or [],
        "execPlsql": node.execPlsql or "",
        "sortOrder": node.sortOrder or sort_order
    }


def normalize_edge(edge: FlowEdgeRequest, sort_order: int) -> Dict[str, Any]:
    dashed = bool(edge.dashed) or str(edge.dashedYn or "N").upper() == "Y"
    edge_mode = edge.edgeMode
    if dashed and str(edge_mode or "").strip().upper() in {"", "SERIAL"}:
        edge_mode = "ON_COMPLETE"
    return {
        "fromNodeKey": normalize_key(edge.fromNodeKey),
        "fromPort": normalize_text(edge.fromPort, "output", 100) or "output",
        "toNodeKey": normalize_key(edge.toNodeKey),
        "toPort": normalize_text(edge.toPort, "input", 100) or "input",
        "edgeMode": normalize_mode(edge_mode, "ON_COMPLETE" if dashed else "SERIAL"),
        "dashedYn": "Y" if dashed else "N",
        "params": edge.params or {},
        "sortOrder": edge.sortOrder or sort_order
    }


def format_node(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "flowNodeId": row.get("FLOW_NODE_ID"),
        "nodeKey": row.get("NODE_KEY"),
        "nodeType": row.get("NODE_TYPE"),
        "nodeName": row.get("NODE_NAME"),
        "nodeDesc": row.get("NODE_DESC"),
        "useYn": row.get("USE_YN") or "Y",
        "refMenuCode": row.get("REF_MENU_CODE"),
        "refWorkJobId": row.get("REF_WORK_JOB_ID"),
        "refObjectId": row.get("REF_OBJECT_ID"),
        "ownerName": row.get("OWNER_NAME"),
        "tableName": row.get("TABLE_NAME"),
        "positionLeft": row.get("POSITION_LEFT"),
        "positionTop": row.get("POSITION_TOP"),
        "nodeWidth": row.get("NODE_WIDTH"),
        "nodeHeight": row.get("NODE_HEIGHT"),
        "inputs": parse_json(row.get("INPUT_JSON"), []),
        "outputs": parse_json(row.get("OUTPUT_JSON"), []),
        "params": parse_json(row.get("PARAM_JSON"), []),
        "execPlsql": data_work.read_lob(row.get("EXEC_PLSQL")),
        "sortOrder": row.get("SORT_ORDER")
    }


def format_edge(row: Dict[str, Any]) -> Dict[str, Any]:
    dashed_yn = row.get("DASHED_YN") or "N"
    return {
        "flowEdgeId": row.get("FLOW_EDGE_ID"),
        "fromNodeKey": row.get("FROM_NODE_KEY"),
        "fromPort": row.get("FROM_PORT"),
        "toNodeKey": row.get("TO_NODE_KEY"),
        "toPort": row.get("TO_PORT"),
        "edgeMode": row.get("EDGE_MODE"),
        "dashedYn": dashed_yn,
        "dashed": dashed_yn == "Y",
        "params": parse_json(row.get("PARAM_JSON"), {}),
        "sortOrder": row.get("SORT_ORDER")
    }


def parse_json(value: Any, default: Any):
    try:
        text = data_work.read_lob(value)
        return json.loads(text or "")
    except Exception:
        return default


def normalize_key(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="nodeKey is required.")
    text = re.sub(r"[^A-Za-z0-9_.:-]+", "-", text)[:100]
    if not text:
        raise HTTPException(status_code=400, detail="nodeKey is invalid.")
    return text


def normalize_text(value: Any, default: str = "", max_length: int = 4000) -> str:
    return data_work.normalize_text(value, default, max_length)


def normalize_menu_code(value: Any) -> str:
    return data_work.normalize_menu_code(value)


def normalize_status(value: Any, default: str = "DRAFT") -> str:
    text = str(value or default).strip().upper()
    text = re.sub(r"[^A-Z0-9_]+", "_", text)
    return (text or default)[:30]


def normalize_mode(value: Any, default: str = "DAG") -> str:
    text = str(value or default).strip().upper()
    text = re.sub(r"[^A-Z0-9_]+", "_", text)
    return (text or default)[:50]


def normalize_token(value: Any, default: str, max_length: int) -> str:
    text = str(value or default).strip().upper()
    text = re.sub(r"[^A-Z0-9_]+", "_", text)
    return (text or default)[:max_length]


def normalize_optional_token(value: Any, max_length: int) -> Optional[str]:
    if value is None or str(value).strip() == "":
        return None
    return normalize_token(value, "", max_length)


def normalize_optional_identifier(value: Any) -> Optional[str]:
    return data_work.normalize_optional_identifier(value)


def round_number(value: Any) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0
