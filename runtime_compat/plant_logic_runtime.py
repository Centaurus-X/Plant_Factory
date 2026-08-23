"""Functional PF-LOGIC-V1 evaluator used by the universal compatibility layer.

The canonical graph is evaluated without modifying the strict Automation_System
V9/V8 configuration contracts. Persistent timer and counter state is returned
explicitly so callers can store it in their own runtime context.
"""

from __future__ import annotations

import copy
import math
import time
from typing import Any


ACTION_TYPES = {
    "state_write",
    "state_parameter",
    "notify",
    "actuator_write",
    "hmi_write",
    "signal_out",
}


def clone_value(value: Any) -> Any:
    """Return a defensive deep copy."""
    return copy.deepcopy(value)


def as_list(value: Any) -> list[Any]:
    """Normalize list-like input without accepting arbitrary iterables."""
    return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
    """Normalize mapping input."""
    return value if isinstance(value, dict) else {}


def to_text(value: Any, fallback: str = "") -> str:
    """Normalize a textual value."""
    text = "" if value is None else str(value).strip()
    return text or fallback


def to_number(value: Any, fallback: float = 0.0) -> float:
    """Normalize a finite numeric value."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def to_integer(value: Any, fallback: int = 0) -> int:
    """Normalize an integer value."""
    return int(to_number(value, float(fallback)))


def to_boolean(value: Any, fallback: bool = False) -> bool:
    """Normalize common Boolean representations."""
    if isinstance(value, bool):
        return value
    if value in (1, "1", "true", "TRUE", "True", "on", "ON"):
        return True
    if value in (0, "0", "false", "FALSE", "False", "off", "OFF"):
        return False
    return fallback if value is None else bool(value)


def canonical_model(payload: Any) -> dict[str, Any]:
    """Extract the canonical logic model from a project or runtime artifact."""
    source = as_dict(payload)
    if isinstance(source.get("logic"), dict):
        source = source["logic"]
    diagrams = source.get("diagrams")
    if not isinstance(diagrams, list):
        diagrams = []
    return {
        "version": to_integer(source.get("version"), 1),
        "standard": clone_value(as_dict(source.get("standard") or source.get("source_standard"))),
        "active_diagram_id": source.get("active_diagram_id"),
        "diagrams": clone_value(diagrams),
        "settings": clone_value(as_dict(source.get("settings"))),
    }


def node_map(diagram: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Index enabled and disabled nodes by stable node ID."""
    result: dict[str, dict[str, Any]] = {}
    for node in as_list(diagram.get("nodes")):
        item = as_dict(node)
        node_id = to_text(item.get("node_id"))
        if node_id:
            result[node_id] = item
    return result


def enabled_edges(diagram: dict[str, Any]) -> list[dict[str, Any]]:
    """Return enabled graph edges."""
    result: list[dict[str, Any]] = []
    for edge in as_list(diagram.get("edges")):
        item = as_dict(edge)
        if item.get("enabled") is not False:
            result.append(item)
    return result


def topological_order(diagram: dict[str, Any]) -> dict[str, Any]:
    """Create a deterministic topological execution order."""
    nodes = [
        as_dict(node)
        for node in as_list(diagram.get("nodes"))
        if as_dict(node).get("enabled") is not False
    ]
    identifiers = {
        to_text(node.get("node_id"))
        for node in nodes
        if to_text(node.get("node_id"))
    }
    indegree = {node_id: 0 for node_id in identifiers}
    adjacency = {node_id: [] for node_id in identifiers}
    for edge in enabled_edges(diagram):
        source = to_text(as_dict(edge.get("from")).get("node_id"))
        target = to_text(as_dict(edge.get("to")).get("node_id"))
        if source not in identifiers or target not in identifiers:
            continue
        indegree[target] += 1
        adjacency[source].append(target)
    queue = sorted(node_id for node_id, degree in indegree.items() if degree == 0)
    order: list[str] = []
    while queue:
        node_id = queue.pop(0)
        order.append(node_id)
        for next_id in sorted(adjacency[node_id]):
            indegree[next_id] -= 1
            if indegree[next_id] == 0:
                queue.append(next_id)
                queue.sort()
    unresolved = sorted(identifiers.difference(order))
    return {
        "order": order,
        "cyclic": bool(unresolved),
        "unresolved": unresolved,
    }


def output_key(node_id: str, port_id: str) -> str:
    """Create the stable key used for internal port values."""
    return "%s:%s" % (node_id, port_id)


def incoming_edge(diagram: dict[str, Any], node_id: str, port_id: str) -> dict[str, Any] | None:
    """Return the single enabled edge connected to an input port."""
    for edge in enabled_edges(diagram):
        target = as_dict(edge.get("to"))
        if target.get("node_id") == node_id and target.get("port_id") == port_id:
            return edge
    return None


def input_value(
    diagram: dict[str, Any],
    values: dict[str, Any],
    node_id: str,
    port_id: str,
    fallback: Any,
) -> Any:
    """Resolve an input port from its upstream output."""
    edge = incoming_edge(diagram, node_id, port_id)
    if edge is None:
        return fallback
    source = as_dict(edge.get("from"))
    return values.get(output_key(to_text(source.get("node_id")), to_text(source.get("port_id"))), fallback)


def compare_values(block_type: str, left: Any, right: Any) -> bool:
    """Evaluate a comparison block."""
    if block_type == "compare_eq":
        return left == right
    if block_type == "compare_ne":
        return left != right
    left_number = to_number(left)
    right_number = to_number(right)
    if block_type == "compare_gt":
        return left_number > right_number
    if block_type == "compare_ge":
        return left_number >= right_number
    if block_type == "compare_lt":
        return left_number < right_number
    if block_type == "compare_le":
        return left_number <= right_number
    return False


def node_memory(memory: dict[str, Any], node_id: str) -> dict[str, Any]:
    """Return and create the mutable state bucket for one node."""
    nodes = memory.setdefault("nodes", {})
    state = nodes.get(node_id)
    if not isinstance(state, dict):
        state = {}
        nodes[node_id] = state
    return state


def evaluate_timer(
    node: dict[str, Any],
    diagram: dict[str, Any],
    values: dict[str, Any],
    memory: dict[str, Any],
    now_ms: int,
) -> dict[str, Any]:
    """Evaluate IEC-like TON, TOF and TP blocks."""
    node_id = to_text(node.get("node_id"))
    block_type = to_text(node.get("block_type"))
    config = as_dict(node.get("config"))
    state = node_memory(memory, node_id)
    input_active = to_boolean(input_value(diagram, values, node_id, "IN", False))
    pt_ms = max(0, to_integer(input_value(diagram, values, node_id, "PT", config.get("pt_ms", 500)), 500))
    previous_input = to_boolean(state.get("previous_input"), False)
    started_at = state.get("started_at_ms")
    output = to_boolean(state.get("q"), False)
    elapsed = 0

    if block_type == "ton":
        if not input_active:
            started_at = None
            output = False
        else:
            if started_at is None:
                started_at = now_ms
            elapsed = max(0, now_ms - to_integer(started_at, now_ms))
            output = elapsed >= pt_ms
    elif block_type == "tof":
        if input_active:
            started_at = None
            output = True
        else:
            if previous_input or (output and started_at is None):
                started_at = now_ms
            if started_at is None:
                output = False
            else:
                elapsed = max(0, now_ms - to_integer(started_at, now_ms))
                output = elapsed < pt_ms
    elif block_type == "tp":
        rising = input_active and not previous_input
        if rising and not output:
            started_at = now_ms
            output = True
        if output and started_at is not None:
            elapsed = max(0, now_ms - to_integer(started_at, now_ms))
            if elapsed >= pt_ms:
                output = False
                started_at = None
                elapsed = pt_ms

    if started_at is not None and elapsed == 0:
        elapsed = max(0, now_ms - to_integer(started_at, now_ms))
    state.update({
        "previous_input": input_active,
        "started_at_ms": started_at,
        "q": output,
        "et_ms": min(pt_ms, elapsed),
    })
    return {"Q": output, "ET": min(pt_ms, elapsed)}


def evaluate_counter(
    node: dict[str, Any],
    diagram: dict[str, Any],
    values: dict[str, Any],
    memory: dict[str, Any],
) -> dict[str, Any]:
    """Evaluate IEC-like count-up and count-down blocks."""
    node_id = to_text(node.get("node_id"))
    block_type = to_text(node.get("block_type"))
    config = as_dict(node.get("config"))
    state = node_memory(memory, node_id)
    pv = max(0, to_integer(input_value(diagram, values, node_id, "PV", config.get("pv", 10)), 10))
    cv = to_integer(state.get("cv"), 0 if block_type == "ctu" else pv)
    trigger_port = "CU" if block_type == "ctu" else "CD"
    control_port = "R" if block_type == "ctu" else "LD"
    trigger = to_boolean(input_value(diagram, values, node_id, trigger_port, False))
    control = to_boolean(input_value(diagram, values, node_id, control_port, False))
    previous_trigger = to_boolean(state.get("previous_trigger"), False)
    rising = trigger and not previous_trigger

    if block_type == "ctu":
        if control:
            cv = 0
        elif rising:
            cv += 1
        output = cv >= pv
    else:
        if control:
            cv = pv
        elif rising:
            cv -= 1
        output = cv <= 0

    state.update({"previous_trigger": trigger, "cv": cv, "q": output})
    return {"Q": output, "CV": cv}


def evaluate_arithmetic(
    node: dict[str, Any],
    diagram: dict[str, Any],
    values: dict[str, Any],
) -> float:
    """Evaluate arithmetic and limiting blocks."""
    node_id = to_text(node.get("node_id"))
    block_type = to_text(node.get("block_type"))
    config = as_dict(node.get("config"))
    if block_type == "limit":
        minimum = to_number(input_value(diagram, values, node_id, "MIN", config.get("minimum", 0.0)))
        current = to_number(input_value(diagram, values, node_id, "IN", config.get("value", 0.0)))
        maximum = to_number(input_value(diagram, values, node_id, "MAX", config.get("maximum", 100.0)))
        low = min(minimum, maximum)
        high = max(minimum, maximum)
        return max(low, min(high, current))
    left = to_number(input_value(diagram, values, node_id, "A", 0.0))
    right = to_number(input_value(diagram, values, node_id, "B", 0.0))
    if block_type == "add":
        return left + right
    if block_type == "sub":
        return left - right
    if block_type == "mul":
        return left * right
    if block_type == "div":
        return left / right if right != 0.0 else 0.0
    if block_type == "min":
        return min(left, right)
    if block_type == "max":
        return max(left, right)
    return 0.0


def action_value(node: dict[str, Any], diagram: dict[str, Any], values: dict[str, Any]) -> Any:
    """Resolve the optional VALUE port of an action node."""
    config = as_dict(node.get("config"))
    return input_value(diagram, values, to_text(node.get("node_id")), "VALUE", config.get("value"))


def create_action(
    node: dict[str, Any],
    diagram: dict[str, Any],
    values: dict[str, Any],
) -> dict[str, Any] | None:
    """Create one canonical action from an enabled output block."""
    node_id = to_text(node.get("node_id"))
    block_type = to_text(node.get("block_type"))
    config = as_dict(node.get("config"))
    binding = as_dict(node.get("binding"))
    if block_type == "signal_out":
        enabled = True
    else:
        enabled = to_boolean(input_value(diagram, values, node_id, "EN", False))
    if not enabled:
        if block_type == "state_write" and config.get("write_false") is not False:
            return {
                "kind": "state_write",
                "node_id": node_id,
                "state_id": to_integer(config.get("state_id", binding.get("state_id")), 0),
                "value_id": to_integer(config.get("value_id_false"), 2),
                "active_branch": "false",
                "priority": to_integer(config.get("priority"), 500),
                "ownership_mode": to_text(config.get("ownership_mode"), "logic"),
            }
        return None
    common = {
        "kind": block_type,
        "node_id": node_id,
        "diagram_id": to_text(diagram.get("diagram_id")),
        "priority": to_integer(config.get("priority"), 500),
        "ownership_mode": to_text(config.get("ownership_mode"), "logic"),
    }
    if block_type == "state_write":
        common.update({
            "state_id": to_integer(config.get("state_id", binding.get("state_id")), 0),
            "value_id": to_integer(config.get("value_id_true"), 1),
            "active_branch": "true",
        })
    elif block_type == "state_parameter":
        common.update({
            "state_id": to_integer(config.get("state_id", binding.get("state_id")), 0),
            "parameter_key": to_text(config.get("parameter_key", binding.get("parameter_key")), "setpoint"),
            "value": action_value(node, diagram, values),
        })
    elif block_type == "notify":
        common.update({"message": to_text(config.get("message"), "Logic event")})
    elif block_type == "actuator_write":
        common.update({
            "signal_ref": to_text(binding.get("signal_ref")),
            "controller_uuid": to_text(binding.get("controller_uuid")),
            "actuator_id": to_integer(binding.get("actuator_id"), 0),
            "value": action_value(node, diagram, values),
        })
    elif block_type == "hmi_write":
        common.update({
            "signal_ref": to_text(binding.get("signal_ref")),
            "widget_id": to_text(binding.get("widget_id")),
            "value": action_value(node, diagram, values),
        })
    elif block_type == "signal_out":
        common.update({
            "signal_ref": to_text(binding.get("signal_ref")),
            "value": action_value(node, diagram, values),
        })
    return common


def evaluate_node(
    node: dict[str, Any],
    diagram: dict[str, Any],
    input_values: dict[str, Any],
    values: dict[str, Any],
    memory: dict[str, Any],
    now_ms: int,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Evaluate one graph node and return port values plus an optional action."""
    node_id = to_text(node.get("node_id"))
    block_type = to_text(node.get("block_type"))
    config = as_dict(node.get("config"))
    binding = as_dict(node.get("binding"))
    outputs: dict[str, Any] = {}
    action = None

    if block_type == "signal_in":
        signal_ref = to_text(binding.get("signal_ref"))
        outputs["Q"] = input_values.get(signal_ref, config.get("default_value"))
    elif block_type == "constant_bool":
        outputs["Q"] = to_boolean(config.get("value"), False)
    elif block_type == "constant_int":
        outputs["Q"] = to_integer(config.get("value"), 0)
    elif block_type == "constant_real":
        outputs["Q"] = to_number(config.get("value"), 0.0)
    elif block_type == "constant_time":
        outputs["Q"] = max(0, to_integer(config.get("value_ms"), 500))
    elif block_type == "not":
        outputs["Q"] = not to_boolean(input_value(diagram, values, node_id, "IN", False))
    elif block_type in ("and", "or", "xor"):
        first = to_boolean(input_value(diagram, values, node_id, "IN1", False))
        second = to_boolean(input_value(diagram, values, node_id, "IN2", False))
        if block_type == "and":
            outputs["Q"] = first and second
        elif block_type == "or":
            outputs["Q"] = first or second
        else:
            outputs["Q"] = first != second
    elif block_type.startswith("compare_"):
        left = input_value(diagram, values, node_id, "A", config.get("a", 0))
        right = input_value(diagram, values, node_id, "B", config.get("b", 0))
        outputs["Q"] = compare_values(block_type, left, right)
    elif block_type in ("ton", "tof", "tp"):
        outputs.update(evaluate_timer(node, diagram, values, memory, now_ms))
    elif block_type in ("ctu", "ctd"):
        outputs.update(evaluate_counter(node, diagram, values, memory))
    elif block_type in ("add", "sub", "mul", "div", "min", "max", "limit"):
        outputs["Q"] = evaluate_arithmetic(node, diagram, values)
    elif block_type in ACTION_TYPES:
        action = create_action(node, diagram, values)
    return outputs, action


def evaluate_diagram(
    diagram_value: Any,
    input_values: Any,
    memory_value: Any = None,
    now_ms: int | None = None,
) -> dict[str, Any]:
    """Evaluate one diagram in deterministic topological order."""
    diagram = clone_value(as_dict(diagram_value))
    inputs = clone_value(as_dict(input_values))
    memory = clone_value(as_dict(memory_value))
    memory.setdefault("nodes", {})
    timestamp = int(time.monotonic() * 1000) if now_ms is None else int(now_ms)
    topology = topological_order(diagram)
    nodes = node_map(diagram)
    values: dict[str, Any] = {}
    actions: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []

    if topology["cyclic"]:
        diagnostics.append({
            "severity": "error",
            "code": "logic_cycle",
            "message": "Diagram contains a cycle and was not executed.",
            "nodes": topology["unresolved"],
        })
        return {
            "diagram_id": to_text(diagram.get("diagram_id")),
            "outputs": values,
            "actions": actions,
            "memory": memory,
            "topology": topology,
            "diagnostics": diagnostics,
        }

    for node_id in topology["order"]:
        node = nodes.get(node_id)
        if node is None or node.get("enabled") is False:
            continue
        outputs, action = evaluate_node(node, diagram, inputs, values, memory, timestamp)
        for port_id, value in outputs.items():
            values[output_key(node_id, port_id)] = value
        if action is not None:
            actions.append(action)

    actions.sort(key=action_sort_key)
    return {
        "diagram_id": to_text(diagram.get("diagram_id")),
        "outputs": values,
        "actions": actions,
        "memory": memory,
        "topology": topology,
        "diagnostics": diagnostics,
    }


def action_sort_key(action: dict[str, Any]) -> tuple[int, str, str]:
    """Sort actions deterministically by priority and stable identities."""
    return (
        -to_integer(action.get("priority"), 0),
        to_text(action.get("diagram_id")),
        to_text(action.get("node_id")),
    )


def evaluate_model(
    payload: Any,
    input_values: Any,
    runtime_state: Any = None,
    now_ms: int | None = None,
) -> dict[str, Any]:
    """Evaluate all enabled diagrams and return explicit state and actions."""
    model = canonical_model(payload)
    state = clone_value(as_dict(runtime_state))
    diagram_memory = state.setdefault("diagrams", {})
    results: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    outputs: dict[str, Any] = {}
    diagnostics: list[dict[str, Any]] = []

    for diagram in as_list(model.get("diagrams")):
        item = as_dict(diagram)
        if item.get("enabled") is False:
            continue
        diagram_id = to_text(item.get("diagram_id"))
        result = evaluate_diagram(item, input_values, diagram_memory.get(diagram_id), now_ms)
        diagram_memory[diagram_id] = result["memory"]
        results.append(result)
        actions.extend(result["actions"])
        diagnostics.extend(result["diagnostics"])
        for key, value in result["outputs"].items():
            outputs["%s:%s" % (diagram_id, key)] = value

    actions.sort(key=action_sort_key)
    return {
        "standard": "PF-LOGIC-V1",
        "status": "FAILED" if any(item.get("severity") == "error" for item in diagnostics) else "OK",
        "outputs": outputs,
        "actions": actions,
        "runtime_state": state,
        "diagrams": results,
        "diagnostics": diagnostics,
    }
