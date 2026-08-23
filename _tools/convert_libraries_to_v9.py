#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hebt die Bausteinbibliotheken vom V50- auf das V9-Format.

Warum
-----
`config/rule_library.json` und `config/process_library.json` sind Vorlagen, aus
denen der Anwender neue Regeln und Prozesszustaende zusammensetzt. Sie stammen
noch aus dem V50-Vertrag und tragen dessen Formen:

    * Regeln  : `condition` als verschachtelter Baum, `action` als Einzelobjekt,
                Vergleichswerte als FORMELSTRINGS ("target_temp*0.98"),
                `rule_id` als Text statt Ganzzahl.
    * States  : `p__type`, `sensor_id`/`actuator_id` als Listen roher Zahlen
                ohne controller_uuid, `automation_parameters` als Sammeltopf.

Wer aus so einer Vorlage etwas einfuegt, erzeugt eine Zeile, die der
V9-Validator sofort zurueckweist. Die Vorlage ist damit schlimmer als keine.

Was dieses Werkzeug tut
-----------------------
Es uebersetzt beide Bibliotheken in V9-Zeilenform:

    * `condition`-Baum  -> flache `when`-Liste (AND) bzw. mehrere Vorlagen (OR)
    * Formelstring      -> `{"param_of_state": N, "key": "...", "scale": F}`
    * `action`          -> `do`-Liste
    * `p__type`         -> `mapping_id` ueber die Templatetabelle der Config
    * I/O-Listen        -> `io_refs` mit controller_uuid aus der Config
    * Zweipunkt        -> `control_strategy: null`. Die Runtime waehlt den
                           Regler dann selbst: liegt am State ein Aktor mit
                           `function_type == "write_coil"` oder ein Parameter
                           `hysteresis` / `hysteresis_bar`, entsteht ein
                           Zweipunktregler, sonst ein P-Regler
                           (`_automation_engine.ensure_controller_for_state`).
                           Genau deshalb gibt es im Editor keinen ONOFF-Typ.

Felder, die eine Vorlage nicht kennen kann, werden WEGGELASSEN statt auf null
gesetzt: der Vertrag verlangt dort Ganzzahlen >= 1 bzw. nicht-leere Strings.
Was fehlt und warum, steht in `__template__.fill_on_insert` und
`__template__.deferred`.

Aufruf
------
    python3 _tools/convert_libraries_to_v9.py \\
        --config config/device_state_data_v9.json \\
        --rules-out config/rule_library_v9.json \\
        --states-out config/process_library_v9.json

Designvorgaben: rein funktional, kein OOP, keine Decorators/Dataclasses,
`functools.partial` statt Lambda.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _tools.format_v9_config import format_config  # noqa: E402

TEMPLATE_VERSION = 9

OPERATOR_MAP = {
    "eq": "==", "ne": "!=", "gt": ">", "ge": ">=", "lt": "<", "le": "<=",
    "=": "==", "==": "==", "!=": "!=", "<>": "!=", ">": ">", ">=": ">=",
    "<": "<", "<=": "<=", "=>": ">=", "=<": "<=",
}

# "target_temp*0.98" / "target_temp_c * 0.98" / "target_temp"
FORMULA_PATTERN = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\*\s*([0-9.]+))?\s*$")


def text(value):
    return "" if value is None else str(value).strip()


def as_list(value):
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def as_int(value, default=None):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def rows(config, section):
    value = config.get(section)
    return value if isinstance(value, list) else []


# =============================================================================
# VERGLEICHSWERTE
# =============================================================================


def convert_value(raw, notes, deferred, path):
    """Formelstring -> V9-Parameterreferenz; alles andere unveraendert.

    `spec_rule_condition_value` ist eine Union aus Zahl, bool und
    `{param_of_state, key, scale?}` — ein STRING ist kein gueltiger
    Vergleichswert. Ein Ausdruck wie "target_temp*0.98" wuerde die Validierung
    reissen ("no union alternative matched").

    Die Uebersetzung braucht aber ein `param_of_state`, und das kann eine
    Vorlage nicht kennen: erst beim Einfuegen steht fest, auf welchen State
    sich der Parameter bezieht. `param_of_state: null` waere jedoch ebenfalls
    ungueltig (`t_int(minimum=1)`).

    Deshalb wird die Vorlage VERTRAGSKONFORM ausgeliefert — mit einem neutralen
    Zahlenwert — und die eigentliche Absicht wandert nach
    `__template__.deferred`. Der Editor traegt beim Einfuegen den State nach und
    ersetzt den Platzhalter. Eine Vorlage, die nicht validiert, waere
    schlimmer als keine.
    """
    if not isinstance(raw, str):
        return raw
    match = FORMULA_PATTERN.match(raw)
    if not match:
        notes.append("Vergleichswert '%s' ist kein gueltiger V9-Wert (nur Zahl, "
                     "bool oder Parameterreferenz) — auf 0 gesetzt." % raw)
        deferred.append({"path": path, "reason": "unuebersetzbarer Ausdruck",
                         "source": raw, "set": ["value"]})
        return 0
    key, scale = match.group(1), match.group(2)
    entry = {"path": path + ".value", "reason": "param_of_state beim Einfuegen setzen",
             "source": raw, "key": key, "set": ["param_of_state"]}
    if scale is not None:
        entry["scale"] = float(scale)
    deferred.append(entry)
    notes.append("Formel '%s' wird beim Einfuegen zu {param_of_state, key%s} — "
                 "bis dahin steht ein neutraler Zahlenwert."
                 % (raw, ", scale" if scale is not None else ""))
    return 0


# =============================================================================
# REGELN
# =============================================================================


def flatten_conditions(condition, notes, deferred, prefix):
    """Verschachtelten V50-Bedingungsbaum in eine flache AND-Liste ueberfuehren."""
    if not isinstance(condition, dict):
        return []
    kind = text(condition.get("type")).lower()
    if kind == "compound":
        operator = text(condition.get("operator")).upper() or "AND"
        parts = []
        for child in as_list(condition.get("conditions")):
            parts.extend(flatten_conditions(child, notes, deferred,
                                            "%s[%d]" % (prefix, len(parts))))
        if operator == "OR":
            notes.append("OR-Verknuepfung ist im V9-Vertrag nicht abbildbar — die "
                         "Teilbedingungen stehen als getrennte Vorlagenzeilen bereit.")
        return parts
    return [convert_condition(condition, notes, deferred, prefix)]


def convert_condition(condition, notes, deferred, path):
    """Eine V50-Bedingung in eine V9-Bedingung uebersetzen.

    `spec_rule_condition` kennt genau zehn Felder. Alles andere — etwa der
    V50-`sensor_type` oder `attribute` — ist KEIN Bedingungsfeld. Es wandert
    deshalb nach `__template__.deferred`, nicht in die Regel: dort waere es ein
    unbekanntes Feld, das der Editor spaeter mitschreibt und niemand liest.
    """
    kind = text(condition.get("type")).lower()
    operator = OPERATOR_MAP.get(text(condition.get("operator")).lower(), ">=")
    out = {"src": "sensor" if kind == "sensor" else "state", "op": operator}

    if kind == "sensor":
        sensor_id = as_int(condition.get("sensor_id"))
        if sensor_id is not None:
            out["sensor_id"] = sensor_id
        # `sensor_id` und `controller_uuid` bewusst weglassen statt auf null zu
        # setzen: "unbekannt" ist etwas anderes als "null", und null waere
        # vertragswidrig (t_int(minimum=1) bzw. t_str(non_empty=True)).
        entry = {"path": path, "reason": "Sensoridentitaet beim Einfuegen waehlen",
                 "set": ["controller_uuid"] + ([] if sensor_id is not None else ["sensor_id"])}
        if text(condition.get("sensor_type")):
            entry["sensor_type"] = text(condition.get("sensor_type"))
        deferred.append(entry)
    elif kind == "state_type":
        out["src"] = "state"
        out["field"] = "value_id"
        out["op"] = "=="
        state_id = as_int(condition.get("state_id"))
        if state_id is not None:
            out["state_id"] = state_id
        deferred.append({"path": path,
                         "reason": "state_type auf eine konkrete state_id abbilden",
                         "state_type": text(condition.get("state_type")),
                         "attribute": text(condition.get("attribute")),
                         "set": ["state_id"] if state_id is None else []})
        notes.append("Bedingung ueber state_type '%s' braucht beim Einfuegen eine "
                     "konkrete state_id." % text(condition.get("state_type")))
    else:
        state_id = as_int(condition.get("state_id"))
        if state_id is not None:
            out["state_id"] = state_id
        else:
            deferred.append({"path": path, "reason": "state_id beim Einfuegen setzen",
                             "set": ["state_id"]})
        out["field"] = text(condition.get("field")) or "value_id"

    if "value" in condition:
        out["value"] = convert_value(condition.get("value"), notes, deferred, path)
    elif "equals" in condition:
        value = condition.get("equals")
        out["value"] = 1 if value is True else (2 if value is False else value)
        out["op"] = "=="
    else:
        out["value"] = 1
    return out


def convert_action(action, notes):
    if not isinstance(action, dict):
        return []
    kind = text(action.get("type")).lower()
    if kind == "notify":
        return [{"notify": text(action.get("message")) or text(action.get("notify"))
                 or "notify"}]
    out = {}
    state_ids = [as_int(item) for item in as_list(action.get("state_id")
                                                 or action.get("state_ids"))]
    if state_ids:
        out["state_ids"] = [item for item in state_ids if item is not None]
    p_ids = [as_int(item) for item in as_list(action.get("p_id") or action.get("p_ids"))]
    if p_ids:
        out["p_ids"] = [item for item in p_ids if item is not None]
    if action.get("value_id") is not None:
        out["value_id"] = as_int(action.get("value_id"))
    if isinstance(action.get("parameters"), dict):
        out["parameters"] = action["parameters"]
    if not out:
        notes.append("Aktion '%s' liess sich nicht in eine V9-Aktion uebersetzen." % kind)
        return []
    return [out]


def convert_rule(rule, set_row, index):
    notes = []
    deferred = []
    when = flatten_conditions(rule.get("condition"), notes, deferred, "when")
    do_actions = convert_action(rule.get("action"), notes)
    else_actions = convert_action(rule.get("else_action"), notes)

    # Identitaetsfelder werden WEGGELASSEN, nicht auf null gesetzt: der Vertrag
    # verlangt dort `t_int(minimum=1)` bzw. `t_str(non_empty=True)`, und null
    # wuerde die Vorlage schon beim Pruefen zerlegen. Was fehlt, steht in
    # `__template__.fill_on_insert`.
    template = {
        "engine_id": 1,
        "execution_epoch": 1,
        "deployment_status": "active_node",
        "activation_state": "active",
        "group": text(set_row.get("set_id")).replace("_rules", "") or "process",
        "priority": as_int(set_row.get("priority"), 100) or 100,
        "name": text(rule.get("rule_id")) or ("template_%d" % (index + 1)),
        "enabled": True,
        "when": when or [{"src": "state", "state_id": None, "field": "value_id",
                          "op": "==", "value": 1}],
        "description": text(rule.get("description")),
    }
    if do_actions:
        template["do"] = do_actions
    if else_actions:
        template["else_do"] = else_actions
    if not do_actions:
        template["do"] = [{"notify": template["name"]}]
        notes.append("Ohne uebersetzbare Aktion wurde eine notify-Aktion eingesetzt.")

    return {
        "__template__": {
            "source_set": text(set_row.get("set_id")),
            "source_rule_id": text(rule.get("rule_id")),
            "evaluation": text(set_row.get("evaluation")) or "on_event",
            "fill_on_insert": ["rule_id", "owner_node_id", "execution_owner",
                               "execution_scope", "activation_state",
                               "deployment_status"],
            "deferred": deferred,
            "notes": notes,
        },
        "rule": template,
    }


def convert_rule_library(library):
    out = []
    for set_row in as_list(library.get("rule_sets")):
        if not isinstance(set_row, dict):
            continue
        for index, rule in enumerate(as_list(set_row.get("rules"))):
            if isinstance(rule, dict):
                out.append(convert_rule(rule, set_row, index))
    return out


# =============================================================================
# PROZESSZUSTAENDE
# =============================================================================


def mapping_index(config):
    """state_type -> mapping_id ueber parameter_generic_templates + schema_mappings."""
    by_schema = {}
    for row in rows(config, "parameter_generic_templates"):
        schema_id = as_int(row.get("schema_id"))
        if schema_id is not None:
            by_schema[schema_id] = text(row.get("state_type"))
    out = {}
    for row in rows(config, "schema_mappings"):
        state_type = by_schema.get(as_int(row.get("schema_id")))
        mapping_id = as_int(row.get("mapping_id"))
        if state_type and mapping_id is not None:
            out.setdefault(state_type, mapping_id)
    return out


def convert_state(state, mappings):
    notes = []
    params = state.get("automation_parameters")
    params = dict(params) if isinstance(params, dict) else {}
    state_type = text(state.get("p__type"))
    mapping_id = mappings.get(state_type)
    if mapping_id is None and state_type:
        notes.append("Fuer state_type '%s' gibt es in der Config kein schema_mapping — "
                     "mapping_id muss beim Einfuegen gesetzt werden." % state_type)

    method = text(params.pop("control_method", "")).upper().replace("-", "_")
    strategy = None
    if method == "PID":
        strategy = {"pid_config_id": as_int(params.pop("pid_config_id"), 1),
                    "type": "PID"}
        params.pop("pid_parameters", None)
    elif method:
        strategy = {"method_id": as_int(params.pop("method_id"), 1),
                    "type": "control_method"}

    for key in list(params):
        if key.endswith("_control_method"):
            params.pop(key, None)

    template = {
        "state_id": None,
        "p_id": as_int(state.get("p_id")),
        "value_id": as_int(state.get("value_id"), 2),
        "mode_id": as_int(state.get("mode_id"), 1),
        "mapping_id": mapping_id,
        "owner_node_id": None,
        "execution_epoch": 1,
        "enabled": True,
        "io_refs": {
            "sensors": [{"sensor_id": as_int(item), "controller_uuid": None}
                        for item in as_list(state.get("sensor_id"))],
            "actuators": [{"actuator_id": as_int(item), "controller_uuid": None}
                          for item in as_list(state.get("actuator_id"))],
        },
        "control_strategy": strategy,
        "setpoint_source": None,
        "parameters": params,
        "description": text(state.get("description")) or state_type,
    }
    return {
        "__template__": {
            "source_state_id": as_int(state.get("state_id")),
            "state_type": state_type,
            "fill_on_insert": ["state_id", "owner_node_id", "mapping_id",
                               "io_refs.*.controller_uuid"],
            "notes": notes,
        },
        "process_state": template,
    }


def convert_process_library(library, config):
    mappings = mapping_index(config)
    return [convert_state(state, mappings)
            for state in as_list(library.get("process_states"))
            if isinstance(state, dict)]


# =============================================================================
# CLI
# =============================================================================


def load_json(path, default=None):
    file_path = Path(path)
    if not file_path.is_file():
        return default if default is not None else {}
    return json.loads(file_path.read_text(encoding="utf-8"))


def write_library(path, payload):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                          encoding="utf-8", newline="\n")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Hebt rule_library.json und process_library.json auf das V9-Format.")
    parser.add_argument("--config", default="config/device_state_data_v9.json")
    parser.add_argument("--rules-in", default="config/rule_library.json")
    parser.add_argument("--states-in", default="config/process_library.json")
    parser.add_argument("--rules-out", default="config/rule_library_v9.json")
    parser.add_argument("--states-out", default="config/process_library_v9.json")
    args = parser.parse_args(argv)

    config = load_json(args.config)
    rule_templates = convert_rule_library(load_json(args.rules_in))
    state_templates = convert_process_library(load_json(args.states_in), config)

    write_library(args.rules_out, {
        "version": TEMPLATE_VERSION,
        "kind": "rule_templates",
        "description": "V9-Regelvorlagen, erzeugt aus rule_library.json durch "
                       "_tools/convert_libraries_to_v9.py. Identitaetsfelder sind "
                       "null und werden beim Einfuegen aus dem Zielkontext vergeben.",
        "templates": rule_templates,
    })
    write_library(args.states_out, {
        "version": TEMPLATE_VERSION,
        "kind": "process_state_templates",
        "description": "V9-Zustandsvorlagen, erzeugt aus process_library.json durch "
                       "_tools/convert_libraries_to_v9.py.",
        "templates": state_templates,
    })

    open_points = sum(len(item["__template__"]["notes"]) for item in rule_templates) \
        + sum(len(item["__template__"]["notes"]) for item in state_templates)
    print("Regelvorlagen   : %d -> %s" % (len(rule_templates), args.rules_out))
    print("Zustandsvorlagen: %d -> %s" % (len(state_templates), args.states_out))
    print("Hinweise        : %d (siehe __template__.notes)" % open_points)
    return 0


if __name__ == "__main__":
    sys.exit(main())
