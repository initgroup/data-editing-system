"""
Shared flow-work service.

The flow designer stores a header, canvas nodes, dependency edges, and run
history. Menu routers pass their menu code so this service can be reused by
multiple flow screens.
"""

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Any, Dict, List, Optional
import json
import re

from backend.database_helper import execute_query, SqlLoader
from backend.services import data_work_service as data_work


class FlowNodeRequest(BaseModel):
    nodeKey: str
    nodeType: str
    nodeName: str
    nodeDesc: Optional[str] = None
    refMenuCode: Optional[str] = None
    refWorkJobId: Optional[int] = None
    refObjectId: Optional[int] = None
    ownerName: Optional[str] = None
    tableName: Optional[str] = None
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


def list_flows(conn, menu_code: str, project_id: int, scenario_id: int) -> Dict[str, Any]:
    result = execute_query(conn, "FLOW_WORK_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id
    })
    return data_work.require_success(result, "Flow query failed.")


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
        "executionMode": normalize_mode(req.executionMode, "DAG"),
        "useYn": "N" if str(req.useYn or "Y").upper() == "N" else "Y",
        "status": normalize_status(req.status, "DRAFT"),
        "graphJson": graph_json
    }

    cursor = conn.cursor()
    try:
        if req.flowId:
            cursor.execute(SqlLoader.get_sql("FLOW_WORK_UPDATE"), params)
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Flow was not found or does not belong to this context.")
            flow_id = int(req.flowId)
        else:
            insert_params = {key: value for key, value in params.items() if key != "flowId"}
            cursor.execute(SqlLoader.get_sql("FLOW_WORK_INSERT"), insert_params)
            cursor.execute(SqlLoader.get_sql("FLOW_WORK_ID_LATEST"), {
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
    cursor.execute(SqlLoader.get_sql("FLOW_WORK_EDGE_DELETE_BY_FLOW"), {"flowId": flow_id})
    cursor.execute(SqlLoader.get_sql("FLOW_WORK_NODE_DELETE_BY_FLOW"), {"flowId": flow_id})

    for index, node in enumerate(nodes, start=1):
        cursor.execute(SqlLoader.get_sql("FLOW_WORK_NODE_INSERT"), {
            "flowId": flow_id,
            "nodeKey": node["nodeKey"],
            "nodeType": node["nodeType"],
            "nodeName": node["nodeName"],
            "nodeDesc": node.get("nodeDesc"),
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

    for index, edge in enumerate(edges, start=1):
        cursor.execute(SqlLoader.get_sql("FLOW_WORK_EDGE_INSERT"), {
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


def list_runs(conn, menu_code: str, project_id: int, scenario_id: int, flow_id: Optional[int] = None) -> Dict[str, Any]:
    result = execute_query(conn, "FLOW_WORK_RUN_LIST", {
        "menuCode": normalize_menu_code(menu_code),
        "projectId": project_id,
        "scenarioId": scenario_id,
        "flowId": flow_id
    })
    response = data_work.require_success(result, "Flow run query failed.")
    for row in response.get("data", []):
        row["PLAN_JSON"] = data_work.read_lob(row.get("PLAN_JSON"))
    return response


def create_run(conn, flow_id: int, run_type: str, status: str, message: str, plan: Dict[str, Any]) -> int:
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("FLOW_WORK_RUN_INSERT"), {
            "flowId": flow_id,
            "runType": normalize_status(run_type, "MANUAL"),
            "status": normalize_status(status, "STARTED"),
            "message": normalize_text(message, "", 4000),
            "planJson": json.dumps(plan or {}, ensure_ascii=False)
        })
        cursor.execute(SqlLoader.get_sql("FLOW_WORK_RUN_ID_LATEST"), {"flowId": flow_id})
        row = cursor.fetchone()
        return int(row[0]) if row and row[0] else 0
    finally:
        cursor.close()


def update_run(conn, flow_run_id: int, status: str, message: str, plan: Dict[str, Any]):
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("FLOW_WORK_RUN_UPDATE"), {
            "flowRunId": flow_run_id,
            "status": normalize_status(status, "SUCCESS"),
            "message": normalize_text(message, "", 4000),
            "planJson": json.dumps(plan or {}, ensure_ascii=False)
        })
    finally:
        cursor.close()


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
            "level": level.get(node_key, 0),
            "upstream": sorted([edge["fromNodeKey"] for edge in edges if edge["toNodeKey"] == node_key]),
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
    node_type = normalize_token(node.nodeType, "JOB", 50)
    node_name = normalize_text(node.nodeName, node_key, 200) or node_key
    return {
        "nodeKey": node_key,
        "nodeType": node_type,
        "nodeName": node_name,
        "nodeDesc": normalize_text(node.nodeDesc, "", 1000),
        "refMenuCode": normalize_optional_token(node.refMenuCode, 30),
        "refWorkJobId": int(node.refWorkJobId) if node.refWorkJobId else None,
        "refObjectId": int(node.refObjectId) if node.refObjectId else None,
        "ownerName": normalize_optional_identifier(node.ownerName),
        "tableName": normalize_optional_identifier(node.tableName),
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
    return {
        "fromNodeKey": normalize_key(edge.fromNodeKey),
        "fromPort": normalize_text(edge.fromPort, "output", 100) or "output",
        "toNodeKey": normalize_key(edge.toNodeKey),
        "toPort": normalize_text(edge.toPort, "input", 100) or "input",
        "edgeMode": normalize_mode(edge.edgeMode, "REFERENCE" if dashed else "SERIAL"),
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
