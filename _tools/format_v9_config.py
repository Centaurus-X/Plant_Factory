#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Kanonisches Lesbarkeitsformat fuer V9-/V8-Cross-Configs (Server-Seite).

Zweck
-----
Eigenstaendiger Zwilling von `public/js/v9_json_format.js`. Beide Module
schreiben BYTE-GLEICHE Dateien, damit es keine Rolle spielt, ob eine Config
zuletzt vom Editor (Browser), vom Server oder von der Runtime geschrieben
wurde. Die Tabellen sind aus
`automation_system_v0101/src/library/_json_formator.py` (FORMATTER_VERSION
3.0.0) uebernommen.

Modus
-----
Es wird ausschliesslich `fingerprint_safe` umgesetzt:

    * Sektionen und Objektfelder werden umsortiert (fingerprint-neutral,
      weil `canonical_bytes` der Runtime vor dem Hashen sortiert).
    * Datensatz-Arrays behalten IHRE REIHENFOLGE. Die Kanonisierung der
      Runtime wertet Listenreihenfolge als bedeutungstragend — ein Umsortieren
      wuerde den Fingerprint aendern.

Warum kein eigener Zahlen-Sonderweg
-----------------------------------
Python unterscheidet `int` und `float` nativ, `json.dumps(1000.0)` liefert
`1000.0`. Die Typkorrektur uebernimmt `canonicalize_v9_config.py`; dieses
Modul rendert nur noch.

Designvorgaben: rein funktional, kein OOP, keine Decorators/Dataclasses,
`functools.partial` statt Lambda.
"""

from __future__ import annotations

import argparse
import json
import sys
from functools import partial
from pathlib import Path

FORMAT_PROFILE_VERSION = "3.0.0"
DEFAULT_INDENT_SIZE = 2


# =============================================================================
# TABELLEN  (Spiegel von public/js/v9_json_format.js)
# =============================================================================

TOP_LEVEL_ORDER = (
    "meta", "sites", "nodes", "local_node", "site_controller_map",
    "controllers", "virtual_controllers", "modbus_functions", "scaling_profiles",
    "sensor_types", "actuator_types", "sensors", "actuators",
    "process_modes", "process_values", "parameter_generic_templates",
    "schema_mappings", "pid_configs", "control_method_templates",
    "control_methods", "processes", "process_states", "filters", "timers",
    "rule_engine", "rules",
)

TOP_SPACING = {
    "sites": 1,
    "controllers": 1,
    "sensors": 1,
    "process_modes": 1,
    "processes": 1,
    "process_states": 2,
    "filters": 1,
    "timers": 1,
    "rule_engine": 1,
    "rules": 1,
    "control_method_templates": 1,
    "control_methods": 1,
}

FIELD_ORDER_BY_SECTION = {
    "meta": ("version", "schema", "scope", "node_id", "owner_node_id", "domain_id",
             "cross_domain_id", "global_revision", "scope_revision",
             "local_config_revision", "fingerprint", "description"),
    "sites": ("site_id", "site_name", "enabled", "description"),
    "nodes": ("node_id", "site_id", "node_role", "enabled", "description"),
    "local_node": ("node_id", "site_id", "active_controller_uuids",
                   "active_controller_routes"),
    "site_controller_map": ("local_controller_id", "node_id", "site_id",
                            "controller_uuid", "controller_key", "route_key",
                            "routing_role", "enabled", "description"),
    "controllers": ("controller_id", "local_controller_id", "node_id", "site_id",
                    "owner_node_id", "controller_uuid", "controller_key",
                    "device_name", "enabled", "bus_type", "host", "port", "unit",
                    "comm", "tags", "description"),
    "virtual_controllers": ("virt_controller_id", "controller_id", "controller_uuid",
                            "device_name", "virt_active", "host", "port", "description"),
    "modbus_functions": ("modbus_function_id", "module_type", "modbus_function_type",
                         "description"),
    "scaling_profiles": ("profile_id", "name", "unit", "raw_min", "raw_max",
                         "eng_min", "eng_max", "description"),
    "sensor_types": ("sensor_types_id", "sensor_type", "description"),
    "actuator_types": ("actuator_types_id", "actuator_type", "description"),
    "sensors": ("local_controller_id", "sensor_id", "profile_id", "sensor_types_id",
                "node_id", "site_id", "controller_uuid", "controller_key", "enabled",
                "sensor_group", "address", "bus_type", "function_type", "rows",
                "parameters", "tags", "description"),
    "actuators": ("local_controller_id", "actuator_id", "profile_id",
                  "actuator_types_id", "node_id", "site_id", "controller_uuid",
                  "controller_key", "enabled", "actuator_group", "address",
                  "bus_type", "function_type", "rows", "parameters", "tags",
                  "description"),
    "process_modes": ("mode_id", "mode", "description"),
    "process_values": ("value_id", "state_value", "description"),
    "parameter_generic_templates": ("schema_id", "state_type", "fields",
                                    "constraints", "description"),
    "schema_mappings": ("mapping_id", "schema_id", "description"),
    "pid_configs": ("pid_config_id", "pid_parameters", "description"),
    "control_method_templates": ("template_id", "template_name", "type", "expr_id",
                                 "parameters", "template_description", "description"),
    "control_methods": ("method_id", "template_id", "type", "args", "parameters",
                        "description"),
    "processes": ("p_id", "owner_node_id", "execution_epoch", "process_name",
                  "process_location", "enabled", "parameters", "description"),
    "process_states": ("state_id", "p_id", "value_id", "mode_id", "mapping_id",
                       "owner_node_id", "execution_epoch", "enabled", "io_refs",
                       "control_strategy", "setpoint_source", "parameters", "tags",
                       "description"),
    "filters": ("filter_id", "sensor_refs", "enabled", "chain", "parameters",
                "description"),
    "timers": ("timer_id", "enabled", "duration_s", "interval_s", "at", "cron",
               "parameters", "description"),
    "rule_engine": ("engine_id", "required_mode_id", "enabled", "writable_fields",
                    "sp_tolerance", "defaults", "runtime", "safety", "parameters",
                    "debug", "description"),
    "rules": ("rule_id", "engine_id", "owner_node_id", "execution_owner",
              "execution_scope", "execution_epoch", "deployment_status",
              "activation_state", "group", "priority", "name", "enabled", "when",
              "until", "do", "else_do", "latch", "disabled_reason", "parameters",
              "tags", "description"),
}

FIELD_ORDER_BY_PARENT = {
    "active_controller_routes": ("local_controller_id", "node_id", "site_id",
                                 "controller_uuid", "controller_key", "route_key",
                                 "routing_role", "enabled", "description"),
    "io_refs": ("sensors", "actuators"),
    "sensor_refs": ("sensor_id", "filter_id", "profile_id", "controller_uuid",
                    "node_id", "site_id", "parameters", "description"),
    "sensors": ("sensor_id", "filter_id", "profile_id", "controller_uuid", "node_id",
                "site_id", "parameters", "description"),
    "actuators": ("actuator_id", "profile_id", "controller_uuid", "node_id",
                  "site_id", "parameters", "description"),
    "control_strategy": ("pid_config_id", "method_id", "template_id", "type",
                         "sample_time", "dt_max_s", "out_min", "out_max",
                         "error_scale", "anti_windup", "parameters", "description"),
    "pid_parameters": ("kp", "ki", "kd"),
    "when": ("state_id", "sensor_id", "actuator_id", "timer_id", "filter_id",
             "controller_uuid", "src", "field", "op", "value", "cooldown_s",
             "parameters", "description"),
    "until": ("state_id", "sensor_id", "actuator_id", "timer_id", "filter_id",
              "controller_uuid", "src", "field", "op", "value", "cooldown_s",
              "parameters", "description"),
    "do": ("state_ids", "p_ids", "value_id", "actuator_id", "controller_uuid",
           "parameters", "notify", "description"),
    "else_do": ("state_ids", "p_ids", "value_id", "actuator_id", "controller_uuid",
                "parameters", "notify", "description"),
    "runtime": ("threading", "tick_ms", "snapshot_isolation", "identity_model",
                "routing_model", "remote_signal_refs", "max_signal_age_s",
                "cross_scope_exec", "cross_worker_exec", "coordinator_min_priority",
                "parameters", "description"),
    "safety": ("max_output_delta_per_step", "on_missing_sensor", "on_invalid_pid",
               "parameters", "description"),
    "defaults": ("eval", "exec", "priority"),
    "debug": ("control", "pid", "pid_state_ids", "pid_interval_s",
              "pid_saturation_interval_s", "log", "parameters", "description"),
    "on_missing_sensor": ("value_id", "mode_id", "parameters", "description"),
    "on_invalid_pid": ("value_id", "mode_id", "parameters", "description"),
}

IDENTITY_KEYS = frozenset((
    "controller_uuid", "message_id", "operation_id", "entity_key", "route_key",
    "node_id", "site_id", "owner_node_id", "execution_owner", "execution_scope",
    "domain_id", "fingerprint",
))

STATUS_KEYS = frozenset((
    "enabled", "active", "activation_state", "deployment_status", "routing_role",
    "node_role", "scope", "type", "mode", "state_value", "name", "controller_key",
    "device_name",
))

LOGIC_KEYS = frozenset(("when", "until", "do", "else_do", "io_refs", "control_strategy"))
PARAM_KEYS = frozenset(("parameters", "args"))
ANNEX_KEYS = frozenset(("debug", "log", "tags", "metadata"))
NOTE_KEYS = frozenset(("description", "template_description", "comment", "comments",
                       "note", "notes"))


# =============================================================================
# GENERISCHE FALLBACK-REIHENFOLGE
# =============================================================================


def field_category(key):
    """Fachliche Kategorie eines unbekannten Feldnamens (kleiner = weiter vorn)."""
    text = str(key).strip().lower()
    if text == "id" or text.endswith("_id") or text.endswith("_ids"):
        return 10
    if text.endswith("_uuid") or text in IDENTITY_KEYS:
        return 20
    if text in STATUS_KEYS:
        return 30
    if text.endswith("_ref") or text.endswith("_refs"):
        return 50
    if text in LOGIC_KEYS:
        return 55
    if text in PARAM_KEYS:
        return 80
    if text in ANNEX_KEYS:
        return 90
    if text in NOTE_KEYS:
        return 100
    return 40


def generic_field_sort_key(key):
    text = str(key)
    return (field_category(text), text.lower(), text)


# =============================================================================
# UMSORTIERUNG
# =============================================================================


def order_keys(keys, preferred):
    known = [name for name in preferred if name in keys]
    emitted = set(known)
    rest = sorted((name for name in keys if name not in emitted),
                  key=generic_field_sort_key)
    return known + rest


def reorder_node(value, parent_key):
    """Rekursive Feldsortierung unterhalb einer Sektion."""
    if isinstance(value, list):
        return [reorder_node(item, parent_key) for item in value]
    if not isinstance(value, dict):
        return value
    preferred = FIELD_ORDER_BY_PARENT.get(parent_key, ())
    out = {}
    for key in order_keys(list(value.keys()), preferred):
        out[key] = reorder_node(value[key], key)
    return out


def reorder_row(section, row):
    if not isinstance(row, dict):
        return row
    preferred = FIELD_ORDER_BY_SECTION.get(section, ())
    out = {}
    for key in order_keys(list(row.keys()), preferred):
        out[key] = reorder_node(row[key], key)
    return out


def reorder_config(config):
    """Bringt eine ganze Config in kanonische Sektions- und Feldreihenfolge."""
    if not isinstance(config, dict):
        return config
    out = {}
    for section in TOP_LEVEL_ORDER:
        if section not in config:
            continue
        rows = config[section]
        if isinstance(rows, list):
            out[section] = [reorder_row(section, row) for row in rows]
        else:
            out[section] = reorder_row(section, rows)
    for key in sorted((name for name in config if name not in out),
                      key=partial(str.lower)):
        out[key] = reorder_node(config[key], key)
    return out


# =============================================================================
# AUSGABE
# =============================================================================


def scalar_literal(value):
    return json.dumps(value, ensure_ascii=False)


def object_to_one_line(value):
    """Ein Objekt als kompakte Einzeile — exakt separators=(",", ": ")."""
    if isinstance(value, dict):
        parts = ['%s: %s' % (json.dumps(key, ensure_ascii=False),
                             object_to_one_line(item))
                 for key, item in value.items()]
        return "{" + ",".join(parts) + "}"
    if isinstance(value, list):
        return "[" + ",".join(object_to_one_line(item) for item in value) + "]"
    return scalar_literal(value)


def format_array(items, level, is_last, indent):
    if not items:
        return "[]" + ("" if is_last else ",")
    pad = indent * level
    pad_next = indent * (level + 1)
    lines = ["["]

    if all(isinstance(item, dict) for item in items):
        for index, item in enumerate(items):
            suffix = "" if index == len(items) - 1 else ","
            lines.append(pad_next + object_to_one_line(item) + suffix)
        lines.append(pad + "]" + ("" if is_last else ","))
        return "\n".join(lines)

    for index, item in enumerate(items):
        lines.append(pad_next + format_value(item, level + 1,
                                             index == len(items) - 1, indent))
    lines.append(pad + "]" + ("" if is_last else ","))
    return "\n".join(lines)


def format_dict(value, level, is_last, indent):
    keys = list(value.keys())
    if not keys:
        return "{}" + ("" if is_last else ",")
    pad = indent * level
    pad_next = indent * (level + 1)
    lines = ["{"]

    for index, key in enumerate(keys):
        is_last_key = index == len(keys) - 1
        if level == 0 and index > 0:
            lines.extend([""] * TOP_SPACING.get(key, 0))
        child = value[key]
        label = json.dumps(key, ensure_ascii=False)
        if isinstance(child, (dict, list)):
            lines.append(pad_next + label + ": "
                         + format_value(child, level + 1, is_last_key, indent))
        else:
            lines.append(pad_next + label + ": " + scalar_literal(child)
                         + ("" if is_last_key else ","))

    lines.append(pad + "}" + ("" if is_last else ","))
    return "\n".join(lines)


def format_value(value, level, is_last, indent):
    if isinstance(value, dict):
        return format_dict(value, level, is_last, indent)
    if isinstance(value, list):
        return format_array(value, level, is_last, indent)
    return scalar_literal(value) + ("" if is_last else ",")


def format_config(config, indent_size=DEFAULT_INDENT_SIZE, reorder=True):
    """Formatiert eine Config im Lesbarkeitsformat der Runtime (mit \\n am Ende)."""
    indent = " " * int(indent_size)
    payload = reorder_config(config) if reorder else config
    return format_value(payload, 0, True, indent) + "\n"


def format_config_text(text, indent_size=DEFAULT_INDENT_SIZE):
    """Text -> Text. Erhaelt int/float-Schreibweise, weil Python beides kennt."""
    return format_config(json.loads(text), indent_size)


def is_idempotent(config, indent_size=DEFAULT_INDENT_SIZE):
    once = format_config(config, indent_size)
    return once == format_config_text(once, indent_size)


# =============================================================================
# CLI
# =============================================================================


def format_file(path, in_place=True, indent_size=DEFAULT_INDENT_SIZE):
    """Formatiert eine Datei; liefert (geaendert, Ausgabetext)."""
    source = Path(path).read_text(encoding="utf-8")
    payload = format_config_text(source, indent_size)
    changed = payload != source
    if in_place and changed:
        Path(path).write_text(payload, encoding="utf-8")
    return changed, payload


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Formatiert V9-/V8-Cross-Configs im kanonischen Lesbarkeitsformat.")
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--in-place", action="store_true", default=True)
    parser.add_argument("--stdout", dest="in_place", action="store_false")
    parser.add_argument("--indent", type=int, default=DEFAULT_INDENT_SIZE)
    parser.add_argument("--check", action="store_true",
                        help="Nur pruefen; Exitcode 1 bei Formatabweichung.")
    args = parser.parse_args(argv)

    drifted = []
    for raw_path in args.paths:
        path = Path(raw_path)
        if not path.is_file():
            print("Nicht gefunden: %s" % path, file=sys.stderr)
            return 2
        changed, payload = format_file(path, args.in_place and not args.check,
                                       args.indent)
        if args.check:
            if changed:
                drifted.append(str(path))
            continue
        if args.in_place:
            print("%s %s" % ("formatiert:" if changed else "unveraendert:", path))
        else:
            sys.stdout.write(payload)

    if args.check and drifted:
        print("Formatabweichung: %s" % ", ".join(drifted), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
