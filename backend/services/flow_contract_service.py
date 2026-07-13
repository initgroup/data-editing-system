"""Model input/output contracts used by FLOW validation and result lineage."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Set


CONTRACT_PATH = Path(__file__).resolve().parents[2] / "frontend" / "config" / "flow-model-contracts.json"


@lru_cache(maxsize=1)
def load_contract_catalog() -> Dict[str, Any]:
    with CONTRACT_PATH.open("r", encoding="utf-8") as handle:
        catalog = json.load(handle)
    catalog["models"] = {
        str(name).strip().upper(): contract
        for name, contract in (catalog.get("models") or {}).items()
    }
    catalog["artifacts"] = {
        str(name).strip().upper(): artifact
        for name, artifact in (catalog.get("artifacts") or {}).items()
    }
    return catalog


def normalize_model_name(value: Any) -> str:
    return str(value or "").strip().upper()


def get_model_contract(model_name: Any) -> Dict[str, Any]:
    return dict(load_contract_catalog().get("models", {}).get(normalize_model_name(model_name)) or {})


def get_artifact_definition(artifact_name: Any) -> Dict[str, Any]:
    return dict(load_contract_catalog().get("artifacts", {}).get(normalize_model_name(artifact_name)) or {})


def get_node_model_name(node: Dict[str, Any]) -> str:
    return normalize_model_name(
        node.get("execObjectName")
        or node.get("EXEC_OBJECT_NAME")
        or node.get("execMethod")
        or node.get("EXEC_METHOD")
    )


def get_node_contract(node: Dict[str, Any]) -> Dict[str, Any]:
    return get_model_contract(get_node_model_name(node))


def get_param_value(node: Dict[str, Any], target_name: str, default: Any = None) -> Any:
    target = normalize_model_name(target_name)
    for item in node.get("params") or []:
        if not isinstance(item, dict):
            continue
        name = item.get("itemName") or item.get("ITEM_NAME") or item.get("name") or item.get("key")
        if normalize_model_name(name) != target:
            continue
        for key in ("value", "VALUE", "itemDefault", "ITEM_DEFAULT", "defaultValue"):
            if key in item and item.get(key) not in (None, ""):
                return item.get(key)
    return default


def get_active_rule_parts(node: Dict[str, Any]) -> Set[str]:
    value = str(get_param_value(node, "P_RULE_PARTS", "ALL") or "ALL").strip().upper()
    if not value or value in {"ALL", "BOTH", "(AUTO)", "AUTO"}:
        return {"CATEGORICAL", "CONTINUOUS"}
    parts: Set[str] = set()
    for token in value.replace(";", ",").split(","):
        normalized = token.strip().upper()
        if normalized in {"CAT", "CATEGORY", "CATEGORICAL", "ASSOC", "ASSOCIATION", "APRIORI"}:
            parts.add("CATEGORICAL")
        elif normalized in {"NUM", "NUMERIC", "CONT", "CONTINUOUS", "LASSO", "SYMBOLIC", "REGRESSION"}:
            parts.add("CONTINUOUS")
    return parts or {"CATEGORICAL", "CONTINUOUS"}


def is_input_active(input_contract: Dict[str, Any], node: Dict[str, Any]) -> bool:
    required_parts = {
        normalize_model_name(value)
        for value in input_contract.get("requiredForParts") or []
        if value
    }
    return not required_parts or bool(required_parts & get_active_rule_parts(node))


def is_input_required(input_contract: Dict[str, Any], node: Dict[str, Any]) -> bool:
    if not input_contract.get("required"):
        return False
    required_when = input_contract.get("requiredWhen")
    if not isinstance(required_when, dict) or not required_when.get("param"):
        return True
    actual = normalize_model_name(get_param_value(node, str(required_when["param"]), required_when.get("default")))
    allowed_values = {normalize_model_name(value) for value in required_when.get("in") or []}
    excluded_values = {normalize_model_name(value) for value in required_when.get("notIn") or []}
    if allowed_values and actual not in allowed_values:
        return False
    if excluded_values and actual in excluded_values:
        return False
    return True


def get_contract_ports(node: Dict[str, Any], direction: str) -> List[Dict[str, Any]]:
    contract = get_node_contract(node)
    key = "inputs" if direction.lower() == "in" else "outputs"
    ports = []
    for item in contract.get(key) or []:
        if not isinstance(item, dict) or not is_input_active(item, node):
            continue
        artifact = normalize_model_name(item.get("artifact"))
        definition = get_artifact_definition(artifact)
        ports.append({
            **item,
            "port": str(item.get("port") or artifact.lower()).strip(),
            "artifact": artifact,
            "label": item.get("label") or definition.get("label") or artifact,
            "kind": item.get("kind") or definition.get("kind") or "TABLE",
            "shape": item.get("shape") or definition.get("shape") or "square",
            "required": is_input_required(item, node) if direction.lower() == "in" else bool(item.get("required")),
        })
    return ports


def get_output_artifacts(node: Dict[str, Any]) -> Set[str]:
    return {port.get("artifact") for port in get_contract_ports(node, "out") if port.get("artifact")}


def build_ancestor_map(nodes: Iterable[Dict[str, Any]], edges: Iterable[Dict[str, Any]]) -> Dict[str, Set[str]]:
    node_keys = {str(node.get("nodeKey") or "") for node in nodes}
    direct = {node_key: set() for node_key in node_keys}
    for edge in edges:
        source = str(edge.get("fromNodeKey") or "")
        target = str(edge.get("toNodeKey") or "")
        if source in node_keys and target in node_keys:
            direct[target].add(source)

    memo: Dict[str, Set[str]] = {}

    def collect(node_key: str, visiting: Set[str]) -> Set[str]:
        if node_key in memo:
            return set(memo[node_key])
        if node_key in visiting:
            return set()
        result: Set[str] = set()
        for source in direct.get(node_key, set()):
            result.add(source)
            result.update(collect(source, visiting | {node_key}))
        memo[node_key] = result
        return set(result)

    return {node_key: collect(node_key, set()) for node_key in node_keys}


def validate_flow_contracts(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> List[str]:
    errors: List[str] = []
    node_map = {str(node.get("nodeKey") or ""): node for node in nodes}
    ancestor_map = build_ancestor_map(nodes, edges)

    for edge in edges:
        source = node_map.get(str(edge.get("fromNodeKey") or ""))
        target = node_map.get(str(edge.get("toNodeKey") or ""))
        if not source or not target:
            continue
        source_contract = get_node_contract(source)
        target_contract = get_node_contract(target)
        source_stage = int(source_contract.get("stage") or 0)
        target_stage = int(target_contract.get("stage") or 0)
        if source_stage and target_stage:
            if source_stage > target_stage:
                errors.append(
                    f"{source.get('nodeName') or source.get('nodeKey')} (stage {source_stage}) cannot precede "
                    f"{target.get('nodeName') or target.get('nodeKey')} (stage {target_stage})."
                )

        from_port = str(edge.get("fromPort") or "output")
        to_port = str(edge.get("toPort") or "input")
        if from_port not in {"output", "out"} and to_port not in {"input", "in"}:
            source_port = next((item for item in get_contract_ports(source, "out") if item.get("port") == from_port), None)
            target_port = next((item for item in get_contract_ports(target, "in") if item.get("port") == to_port), None)
            if source_port and target_port and source_port.get("artifact") != target_port.get("artifact"):
                errors.append(
                    f"Incompatible artifacts: {source_port.get('artifact')} cannot connect to {target_port.get('artifact')}."
                )

    for node_key, node in node_map.items():
        contract = get_node_contract(node)
        if not contract:
            continue
        ancestor_artifacts: Set[str] = set()
        for ancestor_key in ancestor_map.get(node_key, set()):
            ancestor_artifacts.update(get_output_artifacts(node_map[ancestor_key]))
        missing = []
        for input_contract in get_contract_ports(node, "in"):
            if not input_contract.get("required") or input_contract.get("runScope") != "SAME_RUN":
                continue
            artifact = input_contract.get("artifact")
            if artifact and artifact not in ancestor_artifacts:
                missing.append(input_contract.get("label") or artifact)
        if missing:
            errors.append(
                f"{node.get('nodeName') or node_key} requires same-run upstream result(s): {', '.join(missing)}."
            )

    return errors
