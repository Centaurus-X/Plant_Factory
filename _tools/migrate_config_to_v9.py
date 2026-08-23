#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Migration der Legacy-Editor-Config (V50) in den kanonischen V9-Kontrakt.

Quelle : config/_legacy/___device_state_data.json  (Pre-V9 Editor-Schema)
Ziel   : config/device_state_data_v9.json          (meta.scope = master_global)
         config/device_state_data_v9_node_<id>.json (meta.scope = node_local)
         config/migration_report_v9.json           (vollständiges Aenderungsprotokoll)

Kontraktquelle: automation_system_v0101/src/library/_generic_type_library.py
                automation_system_v0101/src/library/_generic_system_contract_library/
                automation_control_plane_release_v0025_r1/.../initial_config_v9.json

Designvorgaben:
  * kein OOP, keine Decorators, keine Klassen
  * functools.partial statt lambda
  * generisch/datengetrieben: Regeltabellen statt Sonderfall-Code
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from functools import partial
from operator import itemgetter
from pathlib import Path

# --------------------------------------------------------------------------
# Kanonische Kontraktkonstanten (Spiegel des Runtime-Vertrags)
# --------------------------------------------------------------------------

CANONICAL_VERSION = 9
CANONICAL_SCHEMA = "device_state_norm"
# Kanonische Site der Bestandsflotte. Steckt in jeder controller_uuid —
# eine Abweichung (z. B. "site-main") erzeugt einen zweiten Identitaetsraum.
DEFAULT_SITE_ID = "site_main"
DEFAULT_NODE_ID = "fn-01"
# Nicht routbarer Platzhalter für Controller ohne Adresse (V9 verlangt host non-empty).
UNCONFIGURED_HOST = "0.0.0.0"

SECTION_ORDER = (
    "meta", "local_node", "sites", "nodes", "site_controller_map",
    "modbus_functions", "scaling_profiles", "controllers", "virtual_controllers",
    "sensors", "actuators", "sensor_types", "actuator_types",
    "parameter_generic_templates", "schema_mappings", "processes",
    "process_values", "process_modes", "pid_configs",
    "control_method_templates", "control_methods", "process_states",
    "rule_engine", "filters", "timers", "rules",
)

# Legacy-Sektionen, die der V9-Kontrakt nicht mehr kennt (harter Fehler in decompose()).
DROPPED_SECTIONS = (
    "node_registrar", "controller_node_bindings", "event_types",
    "parameter_schemas", "state_type_parameter_schema_mappings",
    "automation", "automation_engines", "automation_filters",
    "automation_rule_sets", "triggers", "actions", "transitions", "events",
    "dynamic_rule_engine",
)

# V9-Enums (fail-closed übernommen)
MODBUS_SENSOR_FUNCTIONS = ("read_coil", "read_holding_registers")
MODBUS_ACTUATOR_FUNCTIONS = ("write_coil", "write_register")
RULE_OPERATORS = ("==", "!=", ">", ">=", "<", "<=", "elapsed", "fired")
RULE_SOURCES = ("state", "sensor", "timer")
RULE_GROUPS = ("process", "safety", "notify")
ACTIVATION_STATES = ("staged", "active", "retiring", "inactive")
DEPLOYMENT_STATUS = (
    "active_node", "active_cross", "replaced_local",
    "monitor_only", "disabled_with_reason",
)

# Legacy-Funktionstypen, die auf gültige V9-Werte abgebildet werden müssen.
FUNCTION_TYPE_REPAIR = {
    "write_data": "write_register",
    "read_data": "read_holding_registers",
    "read_register": "read_holding_registers",
    "read_holding_register": "read_holding_registers",
    "write_registers": "write_register",
    "read_input_registers": "read_holding_registers",
    "read_discrete_input": "read_coil",
}

# Legacy-Operatoren der alten Rule-UI -> V9
OPERATOR_REPAIR = {
    "eq": "==", "ne": "!=", "gt": ">", "ge": ">=", "lt": "<", "le": "<=",
    "=": "==", "<>": "!=", "=>": ">=", "=<": "<=",
}

# UUID-Ableitung: stabil, deterministisch, dokumentiert.
#
# VERBINDLICHE RUNTIME-KONVENTION (gegen alle fuenf Bestands-UUIDs verifiziert):
#
#     controller_uuid = uuid5(NAMESPACE_DNS, "<site_id>.<mint_node_id>.<device_name>")
#
# Namespace ist NAMESPACE_DNS, Trenner ist der PUNKT und massgeblich ist der
# `device_name` (`wago_1`), nicht der `controller_key` (`ctrl_wago_1`).
# Spiegelbild von public/js/v9_uuid.js.
MINT_SITE_ID = "site_main"
MINT_NODE_ID = "fn-01"

# Alte Editor-Konvention aus V52/V53 — nur noch zum ERKENNEN von Altbestaenden.
NS_AUTOMATION = uuid.uuid5(uuid.NAMESPACE_URL, "urn:automation:controller")

# Bestands-UUIDs der Runtime-Baseline, nach `device_name` geschluesselt.
# Pruef- statt Sonderwegtabelle: jeder Eintrag laesst sich mit
# controller_uuid_for(MINT_SITE_ID, MINT_NODE_ID, name) reproduzieren.
PINNED_CONTROLLER_UUIDS = {
    "wago_1": "cded47f3-4dc5-5439-9aa6-73f0fff5e335",
    "wago_2": "62671112-766c-59ed-b0ff-30a49d48f747",
    "wago_3": "d11032fa-33db-56de-a4ed-7e16cca3ded7",
    "wago_4": "82fb9eb0-3fd9-5db5-a04e-7f06e405cfdf",
    "wago_5": "06ab4528-f8a3-5ec7-a91f-eea79d60761e",
}


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _tools.provision_defaults import (  # noqa: E402
    PROVISION_NOTE_CONTROLLER, PROVISION_NOTE_PROCESS,
    provision_controller, provision_process)

# --------------------------------------------------------------------------
# Generische Helfer
# --------------------------------------------------------------------------

def as_list(value):
    """Liefert immer eine Liste - unabhängig vom Eingabetyp."""
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def as_dict(value):
    return value if isinstance(value, dict) else {}


def text(value, fallback=""):
    if value is None:
        return fallback
    return str(value)


def as_int(value, fallback=None):
    try:
        if isinstance(value, bool):
            return int(value)
        return int(value)
    except (TypeError, ValueError):
        return fallback


def as_float(value, fallback=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def note(report, kind, section, message, detail=None):
    """Hängt einen Eintrag ans Migrationsprotokoll an."""
    entry = {"kind": kind, "section": section, "message": message}
    if detail is not None:
        entry["detail"] = detail
    report.append(entry)
    return entry


def pick(row, keys):
    """Projiziert ein Dict auf die angegebenen Schlüssel (nur vorhandene)."""
    return {k: row[k] for k in keys if k in row}


def index_by(rows, key):
    out = {}
    for row in as_list(rows):
        if isinstance(row, dict) and key in row:
            out[row[key]] = row
    return out


def sort_rows(rows, key):
    """Stabile Sortierung nach numerischem/lexikalischem Primärschlüssel."""
    def sort_key(row):
        value = row.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return (0, float(value), "")
        return (1, 0.0, text(value))
    return sorted(rows, key=sort_key)


def device_name_for(value):
    """Geraetename aus `device_name` ODER `controller_key`.

    `ctrl_wago_1` und `wago_1` fuehren zur selben Identitaet — der Aufrufer
    muss sich nicht merken, welche Schreibweise er gerade in der Hand hat.
    """
    name = "_".join(str("" if value is None else value).split())
    if not name:
        return "controller"
    return name[5:] or "controller" if name.startswith("ctrl_") else name


def controller_uuid_for(site_id, node_id, name_or_key, mint_node_id=None):
    """Deterministische Controller-Identitaet nach Runtime-Konvention.

    `mint_node_id` ueberschreibt den Praegungs-Node fuer Controller, die den
    Node gewechselt haben — die Identitaet bleibt dabei stabil.
    """
    name = device_name_for(name_or_key)
    mint_node = mint_node_id or node_id
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, "%s.%s.%s" % (site_id, mint_node, name)))


def legacy_controller_uuid_for(site_id, node_id, controller_key):
    """Alte Editor-Konvention aus V52/V53 — nur zum Erkennen von Altbestaenden."""
    return str(uuid.uuid5(NS_AUTOMATION, "%s/%s/%s" % (site_id, node_id, controller_key)))


def route_key_for(site_id, node_id, local_controller_id):
    return "%s.%s.ctrl_%d" % (site_id, node_id, local_controller_id)


# --------------------------------------------------------------------------
# Topologie: sites / nodes / site_controller_map / local_node
# --------------------------------------------------------------------------

def make_identity(local_id, device_name, site_id, node_id):
    controller_key = "ctrl_%s" % device_name
    return {
        "local_controller_id": local_id,
        "device_name": device_name,
        "controller_key": controller_key,
        "controller_uuid": controller_uuid_for(site_id, node_id, controller_key),
        "node_id": node_id,
        "site_id": site_id,
        "enabled": True,
    }


def build_identity_map(legacy, site_id, node_id, report, provision_missing=True):
    """Erzeugt für jeden Legacy-controller_id die vollständige V9-Identität.

    Referenziert die Legacy-Config controller_ids, die in `controllers` gar nicht
    deklariert sind (Datenfehler der V50-Basis), wird der Controller bei
    provision_missing=True als unkonfigurierter Platzhalter angelegt. Damit gehen
    weder Sensoren noch Aktoren verloren; der Defekt bleibt im Report sichtbar.
    """
    identity = {}
    for row in sort_rows(as_list(legacy.get("controllers")), "controller_id"):
        local_id = as_int(row.get("controller_id"))
        if local_id is None or local_id < 1:
            note(report, "error", "controllers",
                 "controller_id fehlt oder ist ungültig - Zeile verworfen", row)
            continue
        identity[local_id] = make_identity(
            local_id, text(row.get("device_name"), "controller_%d" % local_id),
            site_id, node_id)

    if not provision_missing:
        return identity

    referenced = set()
    for section in ("sensors", "actuators", "virtual_controllers"):
        for row in as_list(legacy.get(section)):
            local_id = as_int(as_dict(row).get("controller_id"))
            if local_id is not None and local_id >= 1:
                referenced.add(local_id)
    for local_id in sorted(referenced - set(identity)):
        identity[local_id] = make_identity(
            local_id, "wago_%d" % local_id, site_id, node_id)
        identity[local_id]["provisioned"] = True
        note(report, "repair", "controllers",
             "controller_id %d wird von sensors/actuators referenziert, war in der V50-Basis "
             "aber nie deklariert - Endpunkt wird aus dem Anlagenkontext provisioniert "
             "(_tools/provision_defaults.py)" % local_id)
    return identity


def build_sites(site_id):
    return [{
        "site_id": site_id,
        "site_name": "Main Site",
        "enabled": True,
        "description": "Primäre Automatisierungs-Site (V52-Migration)",
    }]


def build_nodes(site_id, node_ids):
    return [{
        "node_id": nid,
        "site_id": site_id,
        "node_role": "worker",
        "enabled": True,
        "description": "Worker-Node mit lokalen Controller-Threads",
    } for nid in node_ids]


def build_site_controller_map(identity):
    rows = []
    for local_id in sorted(identity):
        ident = identity[local_id]
        rows.append({
            "local_controller_id": local_id,
            "node_id": ident["node_id"],
            "site_id": ident["site_id"],
            "controller_uuid": ident["controller_uuid"],
            "controller_key": ident["controller_key"],
            "route_key": route_key_for(ident["site_id"], ident["node_id"], local_id),
            "routing_role": "owner",
            "enabled": True,
        })
    return rows


def build_local_node(identity, site_id, node_id):
    routes = []
    uuids = []
    for local_id in sorted(identity):
        ident = identity[local_id]
        if ident["node_id"] != node_id:
            continue
        uuids.append(ident["controller_uuid"])
        routes.append({
            "local_controller_id": local_id,
            "controller_uuid": ident["controller_uuid"],
            "controller_key": ident["controller_key"],
        })
    return [{
        "node_id": node_id,
        "site_id": site_id,
        "active_controller_uuids": uuids,
        "active_controller_routes": routes,
    }]


# --------------------------------------------------------------------------
# Hardware: controllers / virtual_controllers / sensors / actuators
# --------------------------------------------------------------------------

def migrate_controllers(legacy, identity, report):
    by_local_id = index_by(as_list(legacy.get("controllers")), "controller_id")
    rows = []
    for local_id in sorted(identity):
        ident = identity[local_id]
        row = as_dict(by_local_id.get(local_id))
        bus_type = text(row.get("bus_type"), "modbus")
        if bus_type not in ("modbus", "plc_s7"):
            note(report, "repair", "controllers",
                 "bus_type '%s' nicht im V9-Enum - auf 'modbus' gesetzt" % bus_type,
                 {"controller_id": local_id})
            bus_type = "modbus"
        rows.append({
            "controller_id": local_id,
            "controller_uuid": ident["controller_uuid"],
            "controller_key": ident["controller_key"],
            "device_name": ident["device_name"],
            "bus_type": bus_type,
            # Leer bleiben darf host nicht (V9 verlangt non-empty). Fehlt er,
            # provisioniert provision_controller() ihn unten aus dem
            # Adressmuster der Anlage - statt einer toten 0.0.0.0.
            "host": text(row.get("host")),
            "port": as_int(row.get("port"), 502),
            "unit": text(row.get("unit"), "0x1"),
            "tags": [text(t) for t in as_list(row.get("tags"))],
        })
    for row in rows:
        filled = provision_controller(row, [item for item in rows if item is not row],
                                      PROVISION_NOTE_CONTROLLER)
        if filled:
            note(report, "repair", "controllers",
                 "%s: Endpunkt aus dem Anlagenkontext provisioniert (%s)"
                 % (row.get("controller_key"), ", ".join(filled)))
    note(report, "info", "controllers",
         "controller_uuid + controller_key additiv ergänzt", {"count": len(rows)})
    return rows


def migrate_virtual_controllers(legacy, identity, report):
    rows = []
    for row in sort_rows(as_list(legacy.get("virtual_controllers")), "virt_controller_id"):
        virt_id = as_int(row.get("virt_controller_id"))
        local_id = as_int(row.get("controller_id"))
        ident = identity.get(local_id)
        if virt_id is None or ident is None:
            note(report, "error", "virtual_controllers",
                 "virt_controller_id/controller_id nicht auflösbar - Zeile verworfen", row)
            continue
        rows.append({
            "virt_controller_id": virt_id,
            "controller_uuid": ident["controller_uuid"],
            "device_name": text(row.get("device_name"), "virtual_controller_%d" % virt_id),
            "virt_active": bool(row.get("virt_active")),
            "host": text(row.get("host")),
            "port": as_int(row.get("port"), 5020),
        })
    note(report, "info", "virtual_controllers",
         "controller_id -> controller_uuid ersetzt (V9-Identitätsmodell)",
         {"count": len(rows)})
    return rows


def repair_function_type(value, allowed, report, section, row_id):
    raw = text(value)
    if raw in allowed:
        return raw
    mapped = FUNCTION_TYPE_REPAIR.get(raw)
    if mapped in allowed:
        note(report, "repair", section,
             "function_type '%s' ist kein V9-Wert - auf '%s' abgebildet" % (raw, mapped),
             {"id": row_id})
        return mapped
    note(report, "repair", section,
         "function_type '%s' unbekannt - Default '%s' gesetzt" % (raw, allowed[0]),
         {"id": row_id})
    return allowed[0]


def migrate_io_section(legacy, identity, report, section, id_field, group_field, allowed_functions):
    """Generische Migration für sensors und actuators (flaches V9-Layout)."""
    rows = []
    for row in sort_rows(as_list(legacy.get(section)), id_field):
        io_id = as_int(row.get(id_field))
        local_id = as_int(row.get("controller_id"))
        ident = identity.get(local_id)
        if io_id is None or io_id < 1:
            note(report, "error", section, "%s fehlt - Zeile verworfen" % id_field, row)
            continue
        if ident is None:
            note(report, "error", section,
                 "controller_id %s nicht auflösbar - Zeile verworfen" % local_id, row)
            continue
        out = {
            "local_controller_id": local_id,
            id_field: io_id,
            "node_id": ident["node_id"],
            "site_id": ident["site_id"],
            "controller_uuid": ident["controller_uuid"],
            "controller_key": ident["controller_key"],
            "enabled": True,
            group_field: text(row.get(group_field), group_field[0].upper()),
            "address": as_int(row.get("address"), 0),
            "bus_type": text(row.get("bus_type"), "modbus"),
            "function_type": repair_function_type(
                row.get("function_type"), allowed_functions, report, section, io_id),
        }
        profile_id = as_int(row.get("profile_id"))
        if profile_id is not None and profile_id >= 1:
            out["profile_id"] = profile_id
        rows.append(out)
    # Kanonische Speicherordnung: nach Controller gruppiert, darin nach lokaler I/O-ID.
    # Nur so ist decompose()/materialize() der Entity-Registry byte-stabil (Roundtrip).
    rows.sort(key=itemgetter("local_controller_id", id_field))
    note(report, "info", section,
         "flaches V9-Layout: node_id/site_id/controller_uuid/controller_key/enabled denormalisiert; "
         "%s_number und %s_type entfallen (nicht Teil des V9-Vertrags)"
         % (section[:-1], section[:-1]),
         {"count": len(rows)})
    return rows


migrate_sensors = partial(
    migrate_io_section,
    section="sensors", id_field="sensor_id", group_field="sensor_group",
    allowed_functions=MODBUS_SENSOR_FUNCTIONS)

migrate_actuators = partial(
    migrate_io_section,
    section="actuators", id_field="actuator_id", group_field="actuator_group",
    allowed_functions=MODBUS_ACTUATOR_FUNCTIONS)


# --------------------------------------------------------------------------
# Stammdaten
# --------------------------------------------------------------------------

def migrate_simple_table(legacy, report, section, field_order, defaults=None):
    """Uebernimmt eine Legacy-Tabelle 1:1 in kanonischer Feldreihenfolge."""
    defaults = defaults or {}
    rows = []
    for row in as_list(legacy.get(section)):
        if not isinstance(row, dict):
            continue
        out = {}
        for field in field_order:
            if field in row:
                out[field] = row[field]
            elif field in defaults:
                out[field] = defaults[field]
        rows.append(out)
    if not rows and defaults.get("__seed__"):
        rows = list(defaults["__seed__"])
        note(report, "info", section, "Sektion fehlte - kanonischer Seed eingesetzt")
    return rows


def migrate_parameter_templates(legacy, report):
    """parameter_schemas (String-ID, fields, constraints) -> parameter_generic_templates.

    Der V9-Vertrag kennt nur (schema_id:int, state_type:str, description:str).
    fields/constraints/match/priority/is_default existieren nicht mehr.
    """
    legacy_schemas = as_list(legacy.get("parameter_schemas"))
    legacy_maps = as_list(legacy.get("state_type_parameter_schema_mappings"))

    schema_index = {}
    templates = []
    next_id = 1
    for mapping in sorted(legacy_maps, key=partial(_mapping_sort_key)):
        state_type = text(mapping.get("state_type"))
        schema_ref = text(mapping.get("parameter_schema_id"))
        if not state_type or not schema_ref:
            continue
        if schema_ref in schema_index:
            continue
        description = ""
        for schema in legacy_schemas:
            if text(schema.get("parameter_schema_id")) == schema_ref:
                description = text(schema.get("description"))
                break
        schema_index[schema_ref] = next_id
        templates.append({
            "schema_id": next_id,
            "state_type": state_type,
            "description": description or state_type,
        })
        next_id += 1

    # Schemata ohne Mapping ebenfalls übernehmen (state_type aus der ID ableiten).
    for schema in legacy_schemas:
        schema_ref = text(schema.get("parameter_schema_id"))
        if not schema_ref or schema_ref in schema_index:
            continue
        derived = schema_ref.replace("schema_", "").split("_v")[0] or "generic"
        schema_index[schema_ref] = next_id
        templates.append({
            "schema_id": next_id,
            "state_type": derived,
            "description": text(schema.get("description")) or derived,
        })
        next_id += 1

    mappings = []
    seen_mapping = set()
    for mapping in sorted(legacy_maps, key=partial(_mapping_sort_key)):
        mapping_id = as_int(mapping.get("mapping_id"))
        schema_ref = text(mapping.get("parameter_schema_id"))
        schema_id = schema_index.get(schema_ref)
        if mapping_id is None or schema_id is None or mapping_id in seen_mapping:
            continue
        seen_mapping.add(mapping_id)
        mappings.append({"mapping_id": mapping_id, "schema_id": schema_id})

    note(report, "breaking", "parameter_schemas",
         "ersetzt durch parameter_generic_templates; fields/constraints entfallen ersatzlos "
         "(V9 kennt nur schema_id/state_type/description)",
         {"templates": len(templates)})
    note(report, "breaking", "state_type_parameter_schema_mappings",
         "ersetzt durch schema_mappings; match/priority/is_default/state_type entfallen "
         "(state_type wandert in parameter_generic_templates)",
         {"mappings": len(mappings)})
    return templates, mappings, schema_index


def _mapping_sort_key(mapping):
    return (as_int(mapping.get("priority"), 0) or 0, as_int(mapping.get("mapping_id"), 0) or 0)


def migrate_processes(legacy, node_id, report, provision_missing=True):
    rows = []
    known = set()
    for row in sort_rows(as_list(legacy.get("processes")), "p_id"):
        p_id = as_int(row.get("p_id"))
        if p_id is None or p_id < 1:
            note(report, "error", "processes", "p_id ungültig - Zeile verworfen", row)
            continue
        known.add(p_id)
        rows.append({
            "p_id": p_id,
            "owner_node_id": text(row.get("owner_node_id"), node_id),
            "process_name": text(row.get("process_name"), "process_%d" % p_id),
            "process_location": text(row.get("process_location")),
        })

    if provision_missing:
        referenced = set()
        for state in as_list(legacy.get("process_states")):
            p_id = as_int(as_dict(state).get("p_id"))
            if p_id is not None and p_id >= 1:
                referenced.add(p_id)
        for p_id in sorted(referenced - known):
            placeholder = {"p_id": p_id, "owner_node_id": node_id}
            filled = provision_process(placeholder, rows, PROVISION_NOTE_PROCESS)
            rows.append(placeholder)
            note(report, "repair", "processes",
                 "p_id %d wird von process_states referenziert, war in der V50-Basis aber nie "
                 "deklariert - als reservierter Prozessplatz angelegt (%s)"
                 % (p_id, ", ".join(filled)))

    note(report, "info", "processes",
         "owner_node_id ergänzt (V9-Pflichtfeld für Execution-Entities)",
         {"count": len(rows)})
    return sort_rows(rows, "p_id")


# --------------------------------------------------------------------------
# process_states
# --------------------------------------------------------------------------

def build_io_refs(state, sensors_by_id, actuators_by_id, report):
    """sensor_ids/actuator_ids -> io_refs mit controller_uuid-Paaren."""
    refs = {"sensors": [], "actuators": []}
    plan = (
        ("sensors", ("sensor_ids", "sensor_id"), sensors_by_id, "sensor_id"),
        ("actuators", ("actuator_ids", "actuator_id"), actuators_by_id, "actuator_id"),
    )
    for bucket, source_keys, lookup, id_field in plan:
        raw = []
        for key in source_keys:
            raw.extend(as_list(state.get(key)))
        seen = set()
        for value in raw:
            io_id = as_int(value)
            if io_id is None or io_id in seen:
                continue
            seen.add(io_id)
            row = lookup.get(io_id)
            if row is None:
                note(report, "error", "process_states",
                     "%s %s in state %s existiert nicht - Referenz entfernt"
                     % (id_field, io_id, state.get("state_id")), None)
                continue
            refs[bucket].append({id_field: io_id, "controller_uuid": row["controller_uuid"]})
    return refs


def build_control_strategy(state, pid_ids, method_ids, report):
    """Auf die zwei V9-legalen Varianten reduzieren: PID | control_method | null."""
    legacy = as_dict(state.get("control_strategy"))
    params = as_dict(state.get("automation_parameters"))
    raw_type = text(legacy.get("type") or params.get("control_method")).strip()
    state_id = state.get("state_id")

    if raw_type.startswith("method:"):
        method_id = as_int(raw_type.split(":", 1)[1])
        if method_id in method_ids:
            return {"type": "control_method", "method_id": method_id}
        note(report, "repair", "process_states",
             "control_method %s in state %s unbekannt - control_strategy auf null gesetzt"
             % (method_id, state_id))
        return None

    upper = raw_type.upper()
    if upper in ("PID", "PI", "PD", "P"):
        pid_config_id = as_int(legacy.get("pid_config_id") or params.get("pid_config_id"))
        if pid_config_id not in pid_ids:
            pid_config_id = sorted(pid_ids)[0] if pid_ids else None
            note(report, "repair", "process_states",
                 "pid_config_id in state %s fehlte/unbekannt - auf %s gesetzt"
                 % (state_id, pid_config_id))
        if pid_config_id is None:
            return None
        if upper != "PID":
            note(report, "repair", "process_states",
                 "control_strategy.type '%s' in state %s ist nicht V9-legal - auf 'PID' normiert "
                 "(Runtime akzeptiert PI/PD nur außerhalb des Config-Vertrags)" % (upper, state_id))
        out = {"type": "PID", "pid_config_id": pid_config_id}
        for field, caster in (("anti_windup", bool), ("out_min", as_float),
                              ("out_max", as_float), ("sample_time", as_float),
                              ("error_scale", as_float), ("dt_max_s", as_float)):
            if field in legacy and legacy[field] is not None:
                value = caster(legacy[field])
                if value is not None:
                    out[field] = value
        return out

    if upper in ("ONOFF", "ON_OFF", "ON-OFF", "TWO_POINT"):
        note(report, "info", "process_states",
             "control_strategy.type '%s' in state %s ist kein V9-Typ "
             "(die Union kennt nur PID und control_method) - auf null gesetzt. "
             "Die Runtime waehlt daraufhin selbst einen Zweipunktregler, sobald am "
             "State ein write_coil-Aktor oder ein Hysterese-Parameter vorliegt "
             "(_automation_engine.ensure_controller_for_state)" % (upper, state_id))
        return None

    if raw_type:
        note(report, "repair", "process_states",
             "control_strategy.type '%s' in state %s unbekannt - auf null gesetzt"
             % (raw_type, state_id))
    return None


def migrate_process_states(legacy, sensors, actuators, mappings, schema_index,
                           pid_configs, control_methods, process_ids, value_ids,
                           mode_ids, report):
    sensors_by_id = index_by(sensors, "sensor_id")
    actuators_by_id = index_by(actuators, "actuator_id")
    pid_ids = {row["pid_config_id"] for row in pid_configs}
    method_ids = {row["method_id"] for row in control_methods}
    mapping_ids = {row["mapping_id"] for row in mappings}
    default_mapping = sorted(mapping_ids)[0] if mapping_ids else None

    # state_type -> mapping_id (über parameter_generic_templates.schema_id)
    schema_to_mapping = {}
    for row in mappings:
        schema_to_mapping.setdefault(row["schema_id"], row["mapping_id"])

    rows = []
    for state in sort_rows(as_list(legacy.get("process_states")), "state_id"):
        state_id = as_int(state.get("state_id"))
        p_id = as_int(state.get("p_id"))
        if state_id is None or state_id < 1:
            note(report, "error", "process_states", "state_id ungültig - Zeile verworfen", state)
            continue
        if p_id not in process_ids:
            note(report, "error", "process_states",
                 "p_id %s in state %s existiert nicht - Zeile verworfen" % (p_id, state_id))
            continue

        mapping_id = as_int(state.get("mapping_id"))
        if mapping_id not in mapping_ids:
            schema_ref = text(state.get("parameter_schema_id"))
            schema_id = schema_index.get(schema_ref)
            mapping_id = schema_to_mapping.get(schema_id, default_mapping)
            if mapping_id is not None:
                note(report, "info", "process_states",
                     "parameter_schema_id '%s' in state %s -> mapping_id %s aufgelöst"
                     % (schema_ref, state_id, mapping_id))

        value_id = as_int(state.get("value_id"), 1)
        if value_id not in value_ids:
            note(report, "repair", "process_states",
                 "value_id %s in state %s unbekannt - auf 1 gesetzt" % (value_id, state_id))
            value_id = sorted(value_ids)[0] if value_ids else 1
        mode_id = as_int(state.get("mode_id"), 2)
        if mode_id not in mode_ids:
            note(report, "repair", "process_states",
                 "mode_id %s in state %s unbekannt - auf 2 gesetzt" % (mode_id, state_id))
            mode_id = 2 if 2 in mode_ids else (sorted(mode_ids)[0] if mode_ids else 2)

        parameters = {}
        source_params = as_dict(state.get("parameters")) or as_dict(state.get("automation_parameters"))
        for key, value in source_params.items():
            if key in ("control_method", "pid_config_id", "pid_parameters",
                       "heating_control_method"):
                continue
            if isinstance(value, bool) or isinstance(value, (int, float)):
                parameters[key] = value
            else:
                parameters[key] = text(value)

        rows.append({
            "state_id": state_id,
            "p_id": p_id,
            "value_id": value_id,
            "mode_id": mode_id,
            "mapping_id": mapping_id if mapping_id is not None else default_mapping,
            "io_refs": build_io_refs(state, sensors_by_id, actuators_by_id, report),
            "control_strategy": build_control_strategy(state, pid_ids, method_ids, report),
            "setpoint_source": state.get("setpoint_source"),
            "parameters": parameters,
        })

    note(report, "breaking", "process_states",
         "sensor_ids/actuator_ids -> io_refs{sensors[],actuators[]} mit controller_uuid; "
         "parameter_schema_id -> mapping_id; state_type entfällt (wandert nach "
         "parameter_generic_templates); automation_parameters -> parameters",
         {"count": len(rows)})
    return rows


# --------------------------------------------------------------------------
# filters / timers
# --------------------------------------------------------------------------

def migrate_filters(legacy, sensors, report):
    sensors_by_id = index_by(sensors, "sensor_id")
    rows = []
    alias = {}
    next_id = 1
    for row in as_list(legacy.get("automation_filters")):
        if not isinstance(row, dict):
            continue
        legacy_id = text(row.get("filter_id"))
        numeric = as_int(row.get("filter_id"))
        filter_id = numeric if numeric is not None and numeric >= 1 else next_id
        next_id = max(next_id, filter_id + 1)
        alias[legacy_id] = filter_id

        refs = []
        for value in as_list(as_dict(row.get("apply_to")).get("sensor_ids")):
            sensor_id = as_int(value)
            sensor = sensors_by_id.get(sensor_id)
            if sensor is None:
                note(report, "error", "filters",
                     "sensor_id %s in Filter '%s' existiert nicht - Referenz entfernt"
                     % (value, legacy_id))
                continue
            refs.append({"sensor_id": sensor_id, "controller_uuid": sensor["controller_uuid"]})
        if not refs:
            note(report, "error", "filters",
                 "Filter '%s' ohne auflösbare sensor_refs - verworfen (V9 verlangt min_len 1)"
                 % legacy_id)
            continue

        chain = []
        for step in as_list(row.get("chain")):
            if not isinstance(step, dict) or not text(step.get("type")):
                continue
            out = {"type": text(step["type"])}
            for field, caster in (("window", as_int), ("alpha", as_float), ("period_s", as_float)):
                if field in step:
                    value = caster(step[field])
                    if value is not None:
                        out[field] = value
            chain.append(out)
        if not chain:
            note(report, "error", "filters",
                 "Filter '%s' ohne chain - verworfen (V9 verlangt min_len 1)" % legacy_id)
            continue
        rows.append({"filter_id": filter_id, "sensor_refs": refs, "chain": chain})

    note(report, "breaking", "automation_filters",
         "umbenannt zu 'filters'; filter_id String -> int; "
         "apply_to.sensor_ids -> sensor_refs[{controller_uuid,sensor_id}]",
         {"alias": alias})
    return sort_rows(rows, "filter_id"), alias


def migrate_timers(legacy, report):
    rows = []
    for row in sort_rows(as_list(legacy.get("timers")), "timer_id"):
        timer_id = as_int(row.get("timer_id"))
        if timer_id is None or timer_id < 1:
            continue
        out = {"timer_id": timer_id}
        duration = as_float(row.get("duration_s"))
        if duration is None:
            duration = as_float(row.get("duration"))
            if duration is not None:
                note(report, "breaking", "timers",
                     "timer %s: 'duration' -> 'duration_s' umbenannt" % timer_id)
        if duration is not None and duration >= 0:
            out["duration_s"] = duration
        interval = as_float(row.get("interval_s"))
        if interval is None:
            frequency = as_float(row.get("frequency"))
            if frequency and frequency > 0:
                interval = round(60.0 / frequency, 4)
                note(report, "breaking", "timers",
                     "timer %s: 'frequency' (%s/min) existiert in V9 nicht - "
                     "als interval_s=%s übernommen" % (timer_id, frequency, interval))
        if interval is not None and interval >= 0:
            out["interval_s"] = interval
        for field in ("at", "cron"):
            if text(row.get(field)):
                out[field] = text(row[field])
        out["description"] = text(row.get("description"))
        if "duration_s" not in out and "interval_s" not in out \
                and "at" not in out and "cron" not in out:
            out["duration_s"] = 0.0
            note(report, "repair", "timers",
                 "timer %s ohne Zeitbasis - duration_s=0.0 gesetzt" % timer_id)
        rows.append(out)
    return rows


# --------------------------------------------------------------------------
# rule_engine + rules
# --------------------------------------------------------------------------

def build_rule_engine(legacy, mode_ids, report):
    engines = as_list(legacy.get("automation_engines"))
    source = as_dict(engines[0]) if engines else {}
    safety_src = as_dict(source.get("safety"))
    defaults_src = as_dict(source.get("defaults"))

    required_mode_id = as_int(source.get("required_mode_id"), 2)
    if required_mode_id not in mode_ids:
        required_mode_id = 2 if 2 in mode_ids else (sorted(mode_ids)[0] if mode_ids else 2)

    fallback_value_id = as_int(safety_src.get("default_state_value_id"), 2)

    engine = {
        "engine_id": 1,
        "required_mode_id": required_mode_id,
        "enabled": True,
        "writable_fields": ["value_id", "parameters"],
        "sp_tolerance": as_float(source.get("sp_tolerance"), 0.5),
        "defaults": {
            "eval": text(defaults_src.get("evaluation_mode"), "on_event"),
            "exec": text(defaults_src.get("exec_mode"), "parallel"),
            "priority": as_int(defaults_src.get("priority"), 100),
        },
        "runtime": {
            "threading": "per_controller",
            "tick_ms": 100,
            "snapshot_isolation": True,
            "identity_model": "controller_uuid_plus_local_io_id",
            "routing_model": "site_id_node_id_local_controller_id",
            "remote_signal_refs": "allowed_by_controller_uuid",
            "max_signal_age_s": 2.0,
            "cross_scope_exec": "coordinator",
            "cross_worker_exec": "site_coordinator_optional",
            "coordinator_min_priority": 1000,
        },
        "safety": {
            "max_output_delta_per_step": as_float(
                safety_src.get("max_output_delta_per_step"), 2.0),
            "on_missing_sensor": {"value_id": fallback_value_id},
            "on_invalid_pid": {"value_id": fallback_value_id},
        },
        "debug": {
            "control": bool(source.get("debug_control")),
            "pid": bool(source.get("debug_pid")),
            "pid_state_ids": [as_int(v) for v in as_list(source.get("debug_pid_state_ids"))
                              if as_int(v) is not None],
            "pid_interval_s": as_float(source.get("debug_pid_interval_s"), 1.0),
            "pid_saturation_interval_s": as_float(
                source.get("debug_pid_saturation_interval_s"), 10.0),
            "log": [name for name, flag in (
                ("transitions", source.get("debug_pid_log_transitions")),
                ("saturation", source.get("debug_pid_log_saturation")),
                ("clamps", source.get("debug_pid_log_clamps"))) if flag],
        },
    }
    note(report, "breaking", "automation_engines",
         "ersetzt durch 'rule_engine' (Singleton-Tabelle). engine_id String->int, "
         "debug_*-Flachfelder -> debug{}, safety.* -> safety.on_missing_sensor/on_invalid_pid, "
         "runtime{} additiv ergänzt")
    note(report, "breaking", "automation",
         "Profil-Sektion (automation/automation_id/engine_ids/filter_ids/"
         "automation_rule_set_ids) entfällt ersatzlos - V9 hat genau eine rule_engine")
    return [engine]


def convert_condition(cond, state_ids, sensors_by_id, filter_alias, filter_ids,
                      timer_ids, report, context):
    """Legacy-Bedingung -> V9-Bedingung {src, op, value, ...}. None = nicht abbildbar."""
    if not isinstance(cond, dict):
        note(report, "breaking", "rules",
             "%s: nicht-objektartige Bedingung (String-Expression) ist in V9 nicht "
             "abbildbar - verworfen" % context, cond)
        return None

    ctype = text(cond.get("type"))

    if ctype == "state_value" or "state_id" in cond:
        state_id = as_int(cond.get("state_id"))
        if state_id not in state_ids:
            note(report, "error", "rules",
                 "%s: state_id %s existiert nicht - Bedingung verworfen" % (context, state_id))
            return None
        value = as_int(cond.get("equals", cond.get("value")))
        if value is None:
            note(report, "error", "rules",
                 "%s: state-Bedingung ohne Vergleichswert - verworfen" % context)
            return None
        return {"src": "state", "state_id": state_id,
                "field": text(cond.get("field"), "value_id"),
                "op": OPERATOR_REPAIR.get(text(cond.get("op") or cond.get("operator")), "=="),
                "value": value}

    if ctype in ("sensor_threshold", "sensor") or "sensor_id" in cond:
        sensor_id = as_int(cond.get("sensor_id"))
        sensor = sensors_by_id.get(sensor_id)
        if sensor is None:
            note(report, "error", "rules",
                 "%s: sensor_id %s existiert nicht - Bedingung verworfen" % (context, sensor_id))
            return None
        op = text(cond.get("op") or cond.get("operator"))
        value = cond.get("value")
        if "ge" in cond:
            op, value = ">=", cond["ge"]
        elif "gt" in cond:
            op, value = ">", cond["gt"]
        elif "le" in cond:
            op, value = "<=", cond["le"]
        elif "lt" in cond:
            op, value = "<", cond["lt"]
        op = OPERATOR_REPAIR.get(op, op) or ">="
        if op not in RULE_OPERATORS:
            note(report, "repair", "rules",
                 "%s: Operator '%s' nicht im V9-Enum - auf '>=' gesetzt" % (context, op))
            op = ">="
        numeric = as_float(value)
        if numeric is None:
            note(report, "breaking", "rules",
                 "%s: Formel-/String-Vergleichswert '%s' ist in V9 nicht zulässig "
                 "(value muss number|bool|{param_of_state,key}) - Bedingung verworfen"
                 % (context, value))
            return None
        out = {"src": "sensor", "controller_uuid": sensor["controller_uuid"],
               "sensor_id": sensor_id, "op": op, "value": numeric}
        raw_filter = cond.get("filter_id")
        filter_id = filter_alias.get(text(raw_filter), as_int(raw_filter))
        if filter_id in filter_ids:
            out["filter_id"] = filter_id
        cooldown = as_float(cond.get("cooldown_s"))
        if cooldown is not None and cooldown >= 0:
            out["cooldown_s"] = cooldown
        return out

    if ctype == "timer" or "timer_id" in cond:
        timer_id = as_int(cond.get("timer_id"))
        if timer_id not in timer_ids:
            note(report, "error", "rules",
                 "%s: timer_id %s existiert nicht - Bedingung verworfen" % (context, timer_id))
            return None
        op = text(cond.get("op"), "elapsed")
        if op not in ("elapsed", "fired"):
            op = "elapsed"
        return {"src": "timer", "timer_id": timer_id, "op": op,
                "value": as_float(cond.get("value"), 0.0)}

    note(report, "breaking", "rules",
         "%s: Bedingungstyp '%s' hat keine V9-Entsprechung (V9 kennt nur "
         "src=state|sensor|timer) - verworfen" % (context, ctype), cond)
    return None


def convert_action(action, state_ids, process_ids, value_ids, io_owner, report, context):
    """Legacy-Aktion -> V9-Aktion. V9 schreibt States/Prozesse, niemals Aktoren direkt."""
    if not isinstance(action, dict):
        return None
    kind = text(action.get("action") or action.get("type"))

    if kind == "notify":
        message = text(action.get("notify") or action.get("message"))
        if not message:
            return None
        return {"notify": message}

    if "state_ids" in action or kind in ("process_state_set_value", "process_state_set_active"):
        ids = [as_int(v) for v in as_list(action.get("state_ids", action.get("state_id")))]
        ids = [v for v in ids if v in state_ids]
        if not ids:
            note(report, "error", "rules",
                 "%s: Aktion ohne gültige state_ids - verworfen" % context)
            return None
        out = {"state_ids": sorted(set(ids))}
        value_id = as_int(action.get("value_id"))
        if value_id is None and "active" in action:
            value_id = 1 if action.get("active") else 2
        if value_id in value_ids:
            out["value_id"] = value_id
        parameters = as_dict(action.get("parameters"))
        if parameters:
            out["parameters"] = parameters
        return out

    if "p_ids" in action or kind in ("process_set_value", "process_set_active"):
        ids = [as_int(v) for v in as_list(action.get("p_ids", action.get("p_id")))]
        ids = [v for v in ids if v in process_ids]
        if not ids:
            return None
        out = {"p_ids": sorted(set(ids))}
        value_id = as_int(action.get("value_id"))
        if value_id is None and "active" in action:
            value_id = 1 if action.get("active") else 2
        if value_id in value_ids:
            out["value_id"] = value_id
        return out

    if kind == "actuator_set":
        actuator_id = as_int(action.get("actuator_id"))
        owners = io_owner.get(actuator_id, [])
        if owners:
            note(report, "breaking", "rules",
                 "%s: 'actuator_set' (actuator_id=%s) existiert in V9 nicht - Aktionen "
                 "adressieren States (state_ids/value_id); über io_refs aufgelöst auf "
                 "state_ids=%s" % (context, actuator_id, owners))
            value = as_float(action.get("value"), 0.0)
            return {"state_ids": sorted(owners), "value_id": 1 if value else 2}
        note(report, "breaking", "rules",
             "%s: 'actuator_set' (actuator_id=%s) nicht über io_refs auflösbar - verworfen"
             % (context, actuator_id))
        return None

    if kind in ("emergency_shutdown", "state_override"):
        note(report, "breaking", "rules",
             "%s: Aktion '%s' hat keine V9-Entsprechung; V9-Aequivalent ist eine "
             "safety-Gruppenregel mit state_ids+value_id - verworfen" % (context, kind))
        return None

    note(report, "breaking", "rules",
         "%s: Aktionstyp '%s' hat keine V9-Entsprechung - verworfen" % (context, kind), action)
    return None


def migrate_rules(legacy, process_states, processes, value_ids, sensors, filters,
                  filter_alias, timers, node_id, report):
    state_ids = {row["state_id"] for row in process_states}
    process_ids = {row["p_id"] for row in processes}
    sensors_by_id = index_by(sensors, "sensor_id")
    filter_ids = {row["filter_id"] for row in filters}
    timer_ids = {row["timer_id"] for row in timers}

    io_owner = {}
    for state in process_states:
        for ref in as_list(as_dict(state.get("io_refs")).get("actuators")):
            io_owner.setdefault(ref.get("actuator_id"), []).append(state["state_id"])

    rows = []
    next_rule_id = 1
    for rule_set in as_list(legacy.get("automation_rule_sets")):
        set_id = text(as_dict(rule_set).get("rule_set_id"), "main")
        for rule in as_list(as_dict(rule_set).get("rules")):
            if not isinstance(rule, dict):
                continue
            rule_id = as_int(rule.get("rule_id"), next_rule_id)
            if any(r["rule_id"] == rule_id for r in rows):
                rule_id = next_rule_id
            next_rule_id = max(next_rule_id, rule_id + 1)
            context = "rule_set '%s' / rule %s" % (set_id, rule_id)

            conditions = []
            for bucket in ("when_all", "when"):
                for cond in as_list(rule.get(bucket)):
                    converted = convert_condition(
                        cond, state_ids, sensors_by_id, filter_alias, filter_ids,
                        timer_ids, report, context)
                    if converted:
                        conditions.append(converted)
            for bucket in ("when_any", "when_none"):
                if as_list(rule.get(bucket)):
                    note(report, "breaking", "rules",
                         "%s: '%s' existiert in V9 nicht (V9 kennt nur when[]=UND-Verknüpfung "
                         "und until[]) - Bedingungen verworfen" % (context, bucket))
            if not conditions:
                note(report, "error", "rules",
                     "%s: keine V9-abbildbare Bedingung - Regel verworfen" % context)
                continue

            actions = []
            for action in as_list(rule.get("do")):
                converted = convert_action(action, state_ids, process_ids, value_ids,
                                           io_owner, report, context)
                if converted:
                    actions.append(converted)
            if not actions:
                note(report, "error", "rules",
                     "%s: keine V9-abbildbare Aktion - Regel verworfen" % context)
                continue
            else_actions = []
            for action in as_list(rule.get("else_do")):
                converted = convert_action(action, state_ids, process_ids, value_ids,
                                           io_owner, report, context)
                if converted:
                    else_actions.append(converted)

            execution = as_dict(rule.get("execution"))
            flags = as_dict(rule.get("flags"))
            enabled = bool(flags.get("enabled", True))
            out = {
                "rule_id": rule_id,
                "engine_id": 1,
                "owner_node_id": node_id,
                "execution_owner": node_id,
                "execution_scope": "node:%s" % node_id,
                "execution_epoch": 1 if enabled else 0,
                "deployment_status": "active_node" if enabled else "disabled_with_reason",
                "activation_state": "active" if enabled else "inactive",
                "group": "process",
                "priority": as_int(execution.get("priority"), 100),
                "name": text(rule.get("rule_name") or rule.get("name"), "rule_%d" % rule_id),
                "enabled": enabled,
                "when": conditions,
                "do": actions,
            }
            if else_actions:
                out["else_do"] = else_actions
            if not enabled:
                out["disabled_reason"] = "Migration V50->V9: Regel war deaktiviert"
            out["description"] = text(rule.get("description"))
            rows.append(out)

    note(report, "breaking", "automation_rule_sets",
         "ersetzt durch flache 'rules'-Tabelle + 'rule_engine'. Entfallen: rule_set-Hierarchie, "
         "process_scope{}, execution{}, flags{one_shot,reset_mode}, when_any[], when_none[]. "
         "Neu (V9-Pflicht): owner_node_id, execution_owner, execution_scope, execution_epoch, "
         "deployment_status, activation_state, group, priority",
         {"count": len(rows)})
    note(report, "breaking", "dynamic_rule_engine",
         "Sektion existiert im V9-Vertrag nicht mehr (decompose() wirft "
         "'unsupported config sections'). Inhalte gehören in 'rules' bzw. bleiben "
         "als Editor-Bibliothek in config/_legacy/rule_library.json")
    for section in ("triggers", "actions", "transitions", "events", "event_types",
                    "node_registrar", "controller_node_bindings"):
        if legacy.get(section):
            note(report, "breaking", section,
                 "Sektion existiert im V9-Vertrag nicht mehr und wurde entfernt "
                 "(Ersatz: rules/timers bzw. sites/nodes/site_controller_map)",
                 {"entries": len(as_list(legacy.get(section)))})
    return sort_rows(rows, "rule_id")


# --------------------------------------------------------------------------
# Zusammenbau
# --------------------------------------------------------------------------

def build_v9_config(legacy, site_id, node_id, scope, report, provision_missing=True):
    identity = build_identity_map(legacy, site_id, node_id, report, provision_missing)

    controllers = migrate_controllers(legacy, identity, report)
    virtual_controllers = migrate_virtual_controllers(legacy, identity, report)
    sensors = migrate_sensors(legacy, identity, report)
    actuators = migrate_actuators(legacy, identity, report)

    modbus_functions = migrate_simple_table(
        legacy, report, "modbus_functions",
        ("modbus_function_id", "module_type", "modbus_function_type"))
    scaling_profiles = migrate_simple_table(
        legacy, report, "scaling_profiles",
        ("profile_id", "name", "raw_min", "raw_max", "eng_min", "eng_max", "unit"))
    sensor_types = migrate_simple_table(
        legacy, report, "sensor_types", ("sensor_types_id", "sensor_type"))
    actuator_types = migrate_simple_table(
        legacy, report, "actuator_types", ("actuator_types_id", "actuator_type"))
    process_values = migrate_simple_table(
        legacy, report, "process_values", ("value_id", "state_value"))
    process_modes = migrate_simple_table(
        legacy, report, "process_modes", ("mode_id", "mode"))
    pid_configs = migrate_simple_table(
        legacy, report, "pid_configs", ("pid_config_id", "pid_parameters"))
    control_method_templates = migrate_simple_table(
        legacy, report, "control_method_templates",
        ("template_id", "template_name", "type", "parameters",
         "expr_id", "template_description"))
    control_methods = migrate_simple_table(
        legacy, report, "control_methods", ("method_id", "template_id", "args"))

    templates, mappings, schema_index = migrate_parameter_templates(legacy, report)
    processes = migrate_processes(legacy, node_id, report, provision_missing)

    value_ids = {row["value_id"] for row in process_values}
    mode_ids = {row["mode_id"] for row in process_modes}
    process_ids = {row["p_id"] for row in processes}

    process_states = migrate_process_states(
        legacy, sensors, actuators, mappings, schema_index, pid_configs,
        control_methods, process_ids, value_ids, mode_ids, report)
    filters, filter_alias = migrate_filters(legacy, sensors, report)
    timers = migrate_timers(legacy, report)
    rule_engine = build_rule_engine(legacy, mode_ids, report)
    rules = migrate_rules(legacy, process_states, processes, value_ids, sensors,
                          filters, filter_alias, timers, node_id, report)

    meta = {
        "schema": CANONICAL_SCHEMA,
        "version": CANONICAL_VERSION,
        "scope": scope,
        "description": ("Kanonischer V9-Contract, erzeugt aus der V50-Editor-Config durch "
                        "_tools/migrate_config_to_v9.py (Automated_SVG_Integration_52)."),
    }
    if scope == "node_local":
        meta["node_id"] = node_id

    config = {
        "meta": [meta],
        "local_node": build_local_node(identity, site_id, node_id),
        "sites": build_sites(site_id),
        "nodes": build_nodes(site_id, [node_id]),
        "site_controller_map": build_site_controller_map(identity),
        "modbus_functions": modbus_functions,
        "scaling_profiles": scaling_profiles,
        "controllers": controllers,
        "virtual_controllers": virtual_controllers,
        "sensors": sensors,
        "actuators": actuators,
        "sensor_types": sensor_types,
        "actuator_types": actuator_types,
        "parameter_generic_templates": templates,
        "schema_mappings": mappings,
        "processes": processes,
        "process_values": process_values,
        "process_modes": process_modes,
        "pid_configs": pid_configs,
        "control_method_templates": control_method_templates,
        "control_methods": control_methods,
        "process_states": process_states,
        "rule_engine": rule_engine,
        "filters": filters,
        "timers": timers,
        "rules": rules,
    }
    return {section: config[section] for section in SECTION_ORDER}


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Migriert die Legacy-Editor-Config in den kanonischen V9-Kontrakt.")
    parser.add_argument("--source", default="config/_legacy/___device_state_data.json")
    parser.add_argument("--target", default="config/device_state_data_v9.json")
    parser.add_argument("--report", default="config/migration_report_v9.json")
    parser.add_argument("--site-id", default=DEFAULT_SITE_ID)
    parser.add_argument("--node-id", default=DEFAULT_NODE_ID)
    parser.add_argument("--scope", default="master_global",
                        choices=("master_global", "node_local"))
    parser.add_argument("--no-provision-missing", dest="provision_missing",
                        action="store_false", default=True,
                        help="Nicht deklarierte, aber referenzierte Controller/Prozesse "
                             "NICHT als Platzhalter anlegen (Zeilen gehen verloren).")
    args = parser.parse_args(argv)

    source = Path(args.source)
    if not source.is_file():
        print("Quelle nicht gefunden: %s" % source, file=sys.stderr)
        return 2

    legacy = json.loads(source.read_text(encoding="utf-8"))
    report = []
    config = build_v9_config(legacy, args.site_id, args.node_id, args.scope, report,
                             args.provision_missing)

    target = Path(args.target)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    summary = {}
    for entry in report:
        summary[entry["kind"]] = summary.get(entry["kind"], 0) + 1
    payload = {
        "source": str(source),
        "target": str(target),
        "canonical_version": CANONICAL_VERSION,
        "scope": args.scope,
        "summary": summary,
        "section_counts": {k: len(v) for k, v in config.items()},
        "dropped_sections": [s for s in DROPPED_SECTIONS if s in legacy],
        "entries": report,
    }
    Path(args.report).write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("V9-Config geschrieben: %s" % target)
    for kind in sorted(summary):
        print("  %-9s %d" % (kind, summary[kind]))
    print("Report: %s" % args.report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
