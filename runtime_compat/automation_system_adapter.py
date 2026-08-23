"""Functional compatibility adapter between PF-LOGIC-V1 and Automation_System.

The adapter maps canonical signal facts and actions onto V9 process-state,
rule-engine, fieldbus and HMI concepts. It never adds unsupported sections to
strict V9 or V8 cross-shard JSON documents.
"""

from __future__ import annotations

import copy
from typing import Any

from runtime_compat.plant_logic_runtime import as_dict
from runtime_compat.plant_logic_runtime import as_list
from runtime_compat.plant_logic_runtime import evaluate_model
from runtime_compat.plant_logic_runtime import to_boolean
from runtime_compat.plant_logic_runtime import to_integer
from runtime_compat.plant_logic_runtime import to_text


def clone_value(value: Any) -> Any:
    """Return a defensive deep copy."""
    return copy.deepcopy(value)


def indexed_rows(rows: Any, fields: tuple[str, ...]) -> dict[tuple[Any, ...], dict[str, Any]]:
    """Index configuration rows by selected fields."""
    result: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in as_list(rows):
        item = as_dict(row)
        key = tuple(item.get(field) for field in fields)
        result[key] = item
    return result


def canonical_signal_facts(
    config_value: Any,
    sensor_values: Any = None,
    state_values: Any = None,
    timer_values: Any = None,
    hmi_values: Any = None,
    extra_signals: Any = None,
) -> dict[str, Any]:
    """Build stable signal-reference facts from runtime snapshots."""
    config = as_dict(config_value)
    sensors = as_dict(sensor_values)
    states = as_dict(state_values)
    timers = as_dict(timer_values)
    hmi = as_dict(hmi_values)
    facts = clone_value(as_dict(extra_signals))

    for row in as_list(config.get("sensors")):
        item = as_dict(row)
        controller_uuid = to_text(item.get("controller_uuid"))
        sensor_id = to_integer(item.get("sensor_id"), 0)
        signal_ref = "v9.sensor.%s.%s.value" % (controller_uuid, sensor_id)
        lookup_keys = (
            signal_ref,
            "%s:%s" % (controller_uuid, sensor_id),
            sensor_id,
            str(sensor_id),
        )
        for key in lookup_keys:
            if key in sensors:
                facts[signal_ref] = sensors[key]
                break

    for row in as_list(config.get("process_states")):
        item = as_dict(row)
        state_id = to_integer(item.get("state_id"), 0)
        runtime_state = as_dict(states.get(state_id, states.get(str(state_id), {})))
        value_id = runtime_state.get("value_id", item.get("value_id"))
        facts["v9.state.%s.value_id" % state_id] = value_id
        parameters = as_dict(item.get("parameters"))
        parameters.update(as_dict(runtime_state.get("parameters")))
        for key, value in parameters.items():
            facts["v9.state.%s.parameters.%s" % (state_id, key)] = value

    for row in as_list(config.get("timers")):
        item = as_dict(row)
        timer_id = to_integer(item.get("timer_id"), 0)
        runtime_timer = as_dict(timers.get(timer_id, timers.get(str(timer_id), {})))
        for field in ("elapsed", "fired", "running", "remaining_s"):
            if field in runtime_timer:
                facts["v9.timer.%s.%s" % (timer_id, field)] = runtime_timer[field]

    for key, value in hmi.items():
        signal_ref = key if str(key).startswith("hmi.widget.") else "hmi.widget.%s.value" % key
        facts[signal_ref] = value
    return facts


def actuator_endpoint(config_value: Any, controller_uuid: str, actuator_id: int) -> dict[str, Any]:
    """Resolve a local fieldbus endpoint while retaining logical identity."""
    config = as_dict(config_value)
    actuator_index = indexed_rows(config.get("actuators"), ("controller_uuid", "actuator_id"))
    controller_index = indexed_rows(config.get("controllers"), ("controller_uuid",))
    actuator = clone_value(actuator_index.get((controller_uuid, actuator_id), {}))
    controller = clone_value(controller_index.get((controller_uuid,), {}))
    return {
        "identity": {
            "controller_uuid": controller_uuid,
            "actuator_id": actuator_id,
        },
        "route": {
            "node_id": actuator.get("node_id"),
            "site_id": actuator.get("site_id"),
            "local_controller_id": actuator.get("local_controller_id"),
            "controller_key": actuator.get("controller_key") or controller.get("controller_key"),
        },
        "fieldbus": {
            "bus_type": actuator.get("bus_type") or controller.get("bus_type"),
            "host": controller.get("host"),
            "port": controller.get("port"),
            "unit": controller.get("unit"),
            "address": actuator.get("address"),
            "function_type": actuator.get("function_type"),
        },
    }


def automation_action(action_value: Any, config_value: Any) -> dict[str, Any]:
    """Translate one canonical action to the universal execution envelope."""
    action = as_dict(action_value)
    kind = to_text(action.get("kind"))
    common = {
        "source": "PF-LOGIC-V1",
        "diagram_id": to_text(action.get("diagram_id")),
        "node_id": to_text(action.get("node_id")),
        "priority": to_integer(action.get("priority"), 0),
        "ownership_mode": to_text(action.get("ownership_mode"), "logic"),
    }
    if kind == "state_write":
        common.update({
            "channel": "rule_engine",
            "native_action": {
                "state_ids": [to_integer(action.get("state_id"), 0)],
                "value_id": to_integer(action.get("value_id"), 1),
            },
        })
    elif kind == "state_parameter":
        common.update({
            "channel": "rule_engine",
            "native_action": {
                "state_ids": [to_integer(action.get("state_id"), 0)],
                "parameters": {
                    to_text(action.get("parameter_key"), "setpoint"): action.get("value")
                },
            },
        })
    elif kind == "notify":
        common.update({
            "channel": "rule_engine",
            "native_action": {"notify": to_text(action.get("message"), "Logic event")},
        })
    elif kind == "actuator_write":
        controller_uuid = to_text(action.get("controller_uuid"))
        actuator_id = to_integer(action.get("actuator_id"), 0)
        common.update({
            "channel": "fieldbus",
            "command": {
                "operation": "write_actuator",
                "endpoint": actuator_endpoint(config_value, controller_uuid, actuator_id),
                "value": action.get("value"),
            },
        })
    elif kind == "hmi_write":
        common.update({
            "channel": "hmi",
            "update": {
                "signal_ref": to_text(action.get("signal_ref")),
                "widget_id": to_text(action.get("widget_id")),
                "value": action.get("value"),
            },
        })
    elif kind == "signal_out":
        common.update({
            "channel": "signal_bus",
            "update": {
                "signal_ref": to_text(action.get("signal_ref")),
                "value": action.get("value"),
            },
        })
    else:
        common.update({"channel": "unsupported", "raw_action": clone_value(action)})
    return common


def target_key(envelope_value: Any) -> str:
    """Create an arbitration key for a translated action."""
    envelope = as_dict(envelope_value)
    channel = to_text(envelope.get("channel"))
    if channel == "rule_engine":
        action = as_dict(envelope.get("native_action"))
        states = as_list(action.get("state_ids"))
        state_id = states[0] if states else 0
        if "parameters" in action:
            keys = sorted(as_dict(action.get("parameters")))
            return "state:%s:parameters:%s" % (state_id, ",".join(keys))
        return "state:%s:value_id" % state_id
    if channel == "fieldbus":
        identity = as_dict(as_dict(envelope.get("command")).get("endpoint")).get("identity", {})
        return "actuator:%s:%s" % (identity.get("controller_uuid"), identity.get("actuator_id"))
    update = as_dict(envelope.get("update"))
    return "%s:%s" % (channel, update.get("signal_ref") or update.get("widget_id"))


def arbitrate_actions(envelopes_value: Any) -> dict[str, Any]:
    """Select deterministic winners and report explicit hybrid arbitration."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for envelope in as_list(envelopes_value):
        item = as_dict(envelope)
        groups.setdefault(target_key(item), []).append(item)
    selected: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    for key in sorted(groups):
        candidates = sorted(
            groups[key],
            key=envelope_sort_key,
        )
        winner = candidates[0]
        selected.append(winner)
        if len(candidates) > 1:
            all_hybrid = all(to_text(item.get("ownership_mode")) == "hybrid" for item in candidates)
            conflicts.append({
                "target": key,
                "status": "resolved_hybrid" if all_hybrid else "conflict",
                "winner": clone_value(winner),
                "candidates": clone_value(candidates),
            })
    return {
        "selected": selected,
        "conflicts": conflicts,
        "status": "FAILED" if any(item["status"] == "conflict" for item in conflicts) else "OK",
    }


def envelope_sort_key(envelope: dict[str, Any]) -> tuple[int, str, str]:
    """Sort execution envelopes by priority and stable source identity."""
    return (
        -to_integer(envelope.get("priority"), 0),
        to_text(envelope.get("diagram_id")),
        to_text(envelope.get("node_id")),
    )


def execute_cycle(
    logic_payload: Any,
    config_value: Any,
    sensor_values: Any = None,
    state_values: Any = None,
    timer_values: Any = None,
    hmi_values: Any = None,
    extra_signals: Any = None,
    runtime_state: Any = None,
    now_ms: int | None = None,
) -> dict[str, Any]:
    """Evaluate logic and translate actions for an Automation_System cycle."""
    facts = canonical_signal_facts(
        config_value,
        sensor_values,
        state_values,
        timer_values,
        hmi_values,
        extra_signals,
    )
    evaluation = evaluate_model(logic_payload, facts, runtime_state, now_ms)
    envelopes = [automation_action(action, config_value) for action in evaluation["actions"]]
    arbitration = arbitrate_actions(envelopes)
    selected = arbitration["selected"]
    return {
        "status": "FAILED" if evaluation["status"] == "FAILED" or arbitration["status"] == "FAILED" else "OK",
        "facts": facts,
        "evaluation": evaluation,
        "runtime_state": evaluation["runtime_state"],
        "actions": selected,
        "native_rule_actions": [
            item["native_action"] for item in selected if item.get("channel") == "rule_engine"
        ],
        "fieldbus_commands": [
            item["command"] for item in selected if item.get("channel") == "fieldbus"
        ],
        "hmi_updates": [
            item["update"] for item in selected if item.get("channel") == "hmi"
        ],
        "signal_updates": [
            item["update"] for item in selected if item.get("channel") == "signal_bus"
        ],
        "arbitration": arbitration,
    }


def is_cross_safe_command(command_value: Any) -> bool:
    """Check that a cross-worker command contains no physical endpoint data."""
    command = as_dict(command_value)
    endpoint = as_dict(command.get("endpoint"))
    fieldbus = as_dict(endpoint.get("fieldbus"))
    return not any(fieldbus.get(field) is not None for field in ("host", "port", "unit", "address"))


def logical_cross_command(command_value: Any) -> dict[str, Any]:
    """Strip local physical coordinates before cross-worker transport."""
    command = clone_value(as_dict(command_value))
    endpoint = as_dict(command.get("endpoint"))
    command["endpoint"] = {
        "identity": clone_value(as_dict(endpoint.get("identity"))),
        "route": {
            "node_id": as_dict(endpoint.get("route")).get("node_id"),
            "site_id": as_dict(endpoint.get("route")).get("site_id"),
        },
    }
    return command


def boolean_fact(value: Any) -> bool:
    """Public helper for external bridge implementations."""
    return to_boolean(value)
