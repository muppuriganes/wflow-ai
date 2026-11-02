"""Workflow graph validation and compilation.

The builder saves React Flow's shape: nodes `{id, data: {nodeType, config}}` and edges
`{source, target, sourceHandle}`. Publishing compiles that into a small execution plan that the
engine interprets. Workflows must be acyclic in this version (loops are not supported yet).
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

from app.workflow_engine.nodes import REGISTRY, ConfigError, NodeDef, validate_config

MAX_NODES = 100


@dataclass
class Issue:
    message: str
    node_id: str | None = None


@dataclass
class ValidationResult:
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    plan: dict[str, Any] | None = None

    @property
    def ok(self) -> bool:
        return not self.errors


def _node_type(node: dict[str, Any]) -> str | None:
    data = node.get("data")
    return data.get("nodeType") if isinstance(data, dict) else None


def compile_definition(definition: dict[str, Any]) -> ValidationResult:
    result = ValidationResult()
    raw_nodes = definition.get("nodes") if isinstance(definition, dict) else None
    raw_edges = definition.get("edges") if isinstance(definition, dict) else None
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        result.errors.append(Issue("The workflow is empty"))
        return result
    if len(raw_nodes) > MAX_NODES:
        result.errors.append(Issue(f"A workflow can have at most {MAX_NODES} steps"))
        return result

    nodes: dict[str, tuple[NodeDef, dict[str, Any]]] = {}
    for raw in raw_nodes:
        node_id = str(raw.get("id", "")) if isinstance(raw, dict) else ""
        if not node_id or len(node_id) > 64 or node_id in nodes:
            result.errors.append(Issue("Every step needs a unique id"))
            continue
        node_type = _node_type(raw)
        node_def = REGISTRY.get(node_type or "")
        if node_def is None:
            result.errors.append(Issue(f"Unknown step type “{node_type}”", node_id))
            continue
        try:
            config = validate_config(node_def, (raw.get("data") or {}).get("config") or {})
        except ConfigError as exc:
            result.errors.append(Issue(f"{node_def.label}: {exc}", node_id))
            config = {}
        nodes[node_id] = (node_def, config)

    triggers = [nid for nid, (d, _) in nodes.items() if d.category == "trigger"]
    if len(triggers) != 1:
        result.errors.append(Issue("A workflow needs exactly one trigger" if not triggers
                                   else "A workflow can only have one trigger"))  # fmt: skip
        return result
    start = triggers[0]

    edges: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    incoming: dict[str, int] = defaultdict(int)
    for raw in raw_edges:
        if not isinstance(raw, dict):
            continue
        source, target = str(raw.get("source", "")), str(raw.get("target", ""))
        handle = str(raw.get("sourceHandle") or "out")
        if source not in nodes or target not in nodes:
            continue  # dangling edge from a deleted node: ignore
        if handle not in {h for h, _ in nodes[source][0].outputs}:
            result.errors.append(Issue("A connection leaves from an output this step doesn't have", source))
            continue
        if target == start:
            result.errors.append(Issue("Nothing can connect into the trigger", source))
            continue
        if target not in edges[source][handle]:
            edges[source][handle].append(target)
            incoming[target] += 1

    # Reachability and cycle check (Kahn's algorithm over the reachable subgraph).
    reachable: set[str] = set()
    queue = deque([start])
    while queue:
        nid = queue.popleft()
        if nid in reachable:
            continue
        reachable.add(nid)
        for targets in edges[nid].values():
            queue.extend(targets)
    for nid in nodes.keys() - reachable:
        result.warnings.append(Issue("This step is not connected to the trigger and will never run", nid))
    if reachable == {start}:
        result.errors.append(Issue("Connect at least one step after the trigger", start))

    indegree = {nid: 0 for nid in reachable}
    for src in reachable:
        for targets in edges[src].values():
            for t in targets:
                indegree[t] += 1
    ready = deque(n for n, d in indegree.items() if d == 0)
    seen = 0
    while ready:
        nid = ready.popleft()
        seen += 1
        for targets in edges[nid].values():
            for t in targets:
                indegree[t] -= 1
                if indegree[t] == 0:
                    ready.append(t)
    if seen != len(reachable):
        result.errors.append(Issue("The workflow contains a loop. Loops are not supported yet."))

    trigger_def = nodes[start][0]
    for nid in reachable:
        node_def = nodes[nid][0]
        if node_def.needs_conversation and not trigger_def.provides_conversation:
            result.errors.append(Issue(f"{node_def.label} needs a conversation, but “{trigger_def.label}” "
                                       "doesn't start from one", nid))  # fmt: skip
        elif node_def.needs_conversation and trigger_def.extra.get("conversation_optional"):
            result.warnings.append(Issue(f"{node_def.label} is skipped when the workflow is started "
                                         "without a conversation", nid))  # fmt: skip
        if node_def.needs_contact and not trigger_def.provides_contact:
            result.errors.append(Issue(f"{node_def.label} needs a contact, but “{trigger_def.label}” "
                                       "doesn't provide one", nid))  # fmt: skip
        if len(node_def.outputs) > 1 and any(edges[nid].values()):
            for handle, label in node_def.outputs:
                if not edges[nid].get(handle):
                    result.warnings.append(Issue(f"{node_def.label}: nothing happens on “{label}”", nid))

    if result.errors:
        return result
    result.plan = {
        "start": start,
        "trigger": {"type": trigger_def.type, "config": nodes[start][1]},
        "nodes": {nid: {"type": nodes[nid][0].type, "config": nodes[nid][1]} for nid in reachable},
        "edges": {
            nid: {h: list(t) for h, t in handles.items()}
            for nid, handles in edges.items()
            if nid in reachable
        },
    }
    return result


def referenced_ids(plan: dict[str, Any]) -> dict[str, set[str]]:
    """Tag/user/connection ids used in node settings, for existence checks at publish time."""
    refs: dict[str, set[str]] = {"tag": set(), "user": set(), "connection": set()}
    for node in plan["nodes"].values():
        node_def = REGISTRY[node["type"]]
        for f in node_def.fields:
            if f.type in refs and node["config"].get(f.key):
                refs[f.type].add(node["config"][f.key])
    return refs
