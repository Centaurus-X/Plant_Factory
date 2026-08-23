# -*- coding: utf-8 -*-
"""_server_v9.py — additive V9-Serverschicht für svg_editor_tool.py.

Bewusst als eigenes Modul, damit `svg_editor_tool.py` nur um zwei Zeilen
erweitert werden muss (Import + register_v9_routes).

Neue Endpunkte
--------------
GET  /api/v9/config              kanonische V9-Config
POST /api/v9/config              speichern (validieren + kanonisieren + Backup)
GET  /api/v9/shard/{node_id}     node_local-Projektion eines Nodes
GET  /api/v9/report              Validierungs-/Migrationsbericht
GET  /api/device-config          Editor-Projektion der V9-Config (Legacy-Sicht)

Warum die Editor-Projektion serverseitig?
-----------------------------------------
Die Altmodule device.js, processes.js und rules_generator.js laden
`/api/device-config` jeweils selbst. Statt diese drei Module anzufassen,
liefert der Server ihnen dieselbe V9-Wahrheit in der gewohnten Feldform.
Damit sehen Alt- und Neu-UI garantiert denselben Stand.

Designvorgaben: kein OOP, keine Decorators, functools.partial statt lambda.
"""

from __future__ import annotations

import json
import shutil
from functools import partial
from pathlib import Path

from aiohttp import web

from _tools.canonicalize_v9_config import canonicalize  # noqa: E402
from _tools.format_v9_config import format_config  # noqa: E402

CANONICAL_NAME = "device_state_data_v9.json"
LEGACY_NAME = "_legacy/___device_state_data.json"
BACKUP_DIR = "_backup"
MAX_BACKUPS = 20

SECTION_ORDER = (
    "meta", "local_node", "sites", "nodes", "site_controller_map",
    "modbus_functions", "scaling_profiles", "controllers", "virtual_controllers",
    "sensors", "actuators", "sensor_types", "actuator_types",
    "parameter_generic_templates", "schema_mappings", "processes",
    "process_values", "process_modes", "pid_configs",
    "control_method_templates", "control_methods", "process_states",
    "rule_engine", "filters", "timers", "rules",
)


# --------------------------------------------------------------------------
# Hilfen
# --------------------------------------------------------------------------

def rows(config, section):
    value = (config or {}).get(section)
    return value if isinstance(value, list) else []


def first(config, section):
    items = rows(config, section)
    return items[0] if items else {}


def text(value, fallback=""):
    return fallback if value is None else str(value)


def as_int(value, fallback=None):
    try:
        if isinstance(value, bool):
            return int(value)
        return int(value)
    except (TypeError, ValueError):
        return fallback


def index_by(items, key):
    return {row.get(key): row for row in items if isinstance(row, dict) and key in row}


def config_path(base_dir):
    return Path(base_dir) / "config" / CANONICAL_NAME


def atomic_write_text(target, payload):
    """Write a config through a sibling file before replacing the target."""
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(".%s.tmp" % path.name)
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(path)


def order_sections(config):
    out = {}
    for section in SECTION_ORDER:
        out[section] = rows(config, section)
    for key, value in (config or {}).items():
        if key not in out:
            out[key] = value
    return out


# --------------------------------------------------------------------------
# server.yaml — in V50 lag die Datei nur dekorativ herum
# --------------------------------------------------------------------------

def read_simple_yaml(path):
    """Minimaler YAML-Leser für die flache Struktur von config/server.yaml.

    Absichtlich ohne pyyaml-Abhängigkeit: unterstützt verschachtelte
    Schlüssel, skalare Listen, Inline-Leerlisten, Skalare und Kommentare.
    """
    result = {}
    if not Path(path).is_file():
        return result

    lines = []
    for raw_line in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if line.strip():
            lines.append(line)

    stack = [(-1, result)]
    for index, line in enumerate(lines):
        indent = len(line) - len(line.lstrip(" "))

        while stack and stack[-1][0] >= indent:
            stack.pop()
        parent = stack[-1][1] if stack else result

        stripped = line.strip()
        if stripped.startswith("- "):
            if isinstance(parent, list):
                parent.append(parse_scalar(stripped[2:].strip()))
            continue

        if ":" not in stripped or not isinstance(parent, dict):
            continue
        key, _, value = stripped.partition(":")
        key = key.strip()
        value = value.strip()

        if value == "":
            child = {}
            if index + 1 < len(lines):
                next_line = lines[index + 1]
                next_indent = len(next_line) - len(next_line.lstrip(" "))
                if next_indent > indent and next_line.strip().startswith("- "):
                    child = []
            parent[key] = child
            stack.append((indent, child))
            continue
        parent[key] = parse_scalar(value)
    return result


def parse_scalar(value):
    if value == "[]":
        return []
    if value == "{}":
        return {}
    lowered = value.lower()
    if lowered in ("true", "yes", "on"):
        return True
    if lowered in ("false", "no", "off"):
        return False
    if lowered in ("null", "none", "~"):
        return None
    if value and (value[0] == value[-1]) and value[0] in ("'", '"'):
        return value[1:-1]
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def server_settings(base_dir):
    """Liest config/server.yaml und liefert die effektiven Servereinstellungen."""
    data = read_simple_yaml(Path(base_dir) / "config" / "server.yaml")
    server = data.get("server") if isinstance(data.get("server"), dict) else {}
    return {
        "host": text(server.get("host"), "127.0.0.1"),
        "port": as_int(server.get("port"), 8090) or 8090,
        "debug": bool(server.get("debug")),
        "raw": data,
    }


# --------------------------------------------------------------------------
# Editor-Projektion (Python-Zwilling von public/js/v9_migrate.js)
# --------------------------------------------------------------------------

def project_editor_view(config):
    """V9 -> Feldform, die die V50-Module erwarten."""
    view = json.loads(json.dumps(config))
    view["schema_version"] = 9

    local_by_uuid = {text(row.get("controller_uuid")): as_int(row.get("controller_id"))
                     for row in rows(config, "controllers")}
    templates = index_by(rows(config, "parameter_generic_templates"), "schema_id")
    mappings = index_by(rows(config, "schema_mappings"), "mapping_id")

    view["virtual_controllers"] = [
        dict(row, controller_id=local_by_uuid.get(text(row.get("controller_uuid"))))
        for row in rows(config, "virtual_controllers")
    ]

    for section, id_field, number_field in (
            ("sensors", "sensor_id", "sensor_number"),
            ("actuators", "actuator_id", "actuator_number")):
        view[section] = [
            dict(row,
                 controller_id=local_by_uuid.get(text(row.get("controller_uuid"))),
                 **{number_field: index + 1})
            for index, row in enumerate(rows(config, section))
        ]

    projected_states = []
    for state in rows(config, "process_states"):
        refs = state.get("io_refs") if isinstance(state.get("io_refs"), dict) else {}
        mapping = mappings.get(as_int(state.get("mapping_id")))
        template = templates.get(as_int(mapping.get("schema_id"))) if mapping else None
        state_type = text(template.get("state_type")) if template else ""
        sensor_ids = [as_int(ref.get("sensor_id")) for ref in refs.get("sensors") or []]
        actuator_ids = [as_int(ref.get("actuator_id")) for ref in refs.get("actuators") or []]
        projected_states.append(dict(
            state,
            state_type=state_type,
            p__type=state_type,
            sensor_ids=sensor_ids,
            actuator_ids=actuator_ids,
            sensor_id=sensor_ids,
            actuator_id=actuator_ids,
            parameter_schema_id=("schema_%s" % state_type) if state_type else "",
            automation_parameters=dict(state.get("parameters") or {}),
        ))
    view["process_states"] = projected_states

    view["parameter_schemas"] = [{
        "parameter_schema_id": "schema_%s" % text(row.get("state_type")),
        "schema_id": as_int(row.get("schema_id")),
        "description": text(row.get("description")),
        "fields": [],
        "constraints": [],
    } for row in rows(config, "parameter_generic_templates")]

    view["state_type_parameter_schema_mappings"] = []
    for row in rows(config, "schema_mappings"):
        template = templates.get(as_int(row.get("schema_id")))
        state_type = text(template.get("state_type")) if template else ""
        view["state_type_parameter_schema_mappings"].append({
            "mapping_id": as_int(row.get("mapping_id")),
            "schema_id": as_int(row.get("schema_id")),
            "state_type": state_type,
            "parameter_schema_id": ("schema_%s" % state_type) if state_type else "",
            "match": {}, "priority": 10, "is_default": False,
        })

    view["automation_filters"] = [{
        "filter_id": as_int(row.get("filter_id")),
        "apply_to": {"sensor_ids": [as_int(ref.get("sensor_id"))
                                    for ref in row.get("sensor_refs") or []]},
        "chain": row.get("chain") or [],
    } for row in rows(config, "filters")]

    engine = first(config, "rule_engine")
    debug = engine.get("debug") if isinstance(engine.get("debug"), dict) else {}
    engine_id = as_int(engine.get("engine_id"), 1) or 1
    view["automation_engines"] = [{
        "engine_id": engine_id,
        "required_mode_id": as_int(engine.get("required_mode_id")),
        "sp_tolerance": engine.get("sp_tolerance"),
        "debug_control": bool(debug.get("control")),
        "debug_pid": bool(debug.get("pid")),
        "debug_pid_state_ids": debug.get("pid_state_ids") or [],
        "safety": engine.get("safety") or {},
        "defaults": engine.get("defaults") or {},
    }]
    view["automation"] = [{
        "automation_id": "default",
        "description": "Aus V9 rule_engine projiziert",
        "enabled": engine.get("enabled") is not False,
        "engine_ids": [engine_id],
        "filter_ids": [as_int(row.get("filter_id")) for row in rows(config, "filters")],
        "automation_rule_set_ids": ["main"],
    }]
    view["automation_rule_sets"] = [{
        "rule_set_id": "main",
        "rule_set_name": "main",
        "engine_id": engine_id,
        "rules": [project_rule(rule) for rule in rows(config, "rules")],
    }]

    for section in ("node_registrar", "controller_node_bindings", "event_types",
                    "triggers", "actions", "transitions", "events"):
        view.setdefault(section, [])
    view.setdefault("dynamic_rule_engine", {"rule_sets": []})
    return view


def project_rule(rule):
    return {
        "rule_id": as_int(rule.get("rule_id")),
        "rule_name": text(rule.get("name")),
        "description": text(rule.get("description")),
        "process_scope": {"p_ids": [], "state_ids": [], "modes": [], "selectors": {}},
        "execution": {"evaluation_mode": "on_event", "exec_mode": "parallel",
                      "priority": as_int(rule.get("priority"))},
        "flags": {"enabled": rule.get("enabled") is not False, "one_shot": False,
                  "one_shot_scope": "rule", "reset_mode": "never"},
        "when_all": [project_condition(item) for item in rule.get("when") or []],
        "when_any": [], "when_none": [],
        "do": [project_action(item) for item in rule.get("do") or []],
        "else_do": [project_action(item) for item in rule.get("else_do") or []],
        "__v9": rule,
    }


def project_condition(cond):
    src = text(cond.get("src"))
    if src == "state":
        return {"type": "state_value", "state_id": as_int(cond.get("state_id")),
                "equals": cond.get("value")}
    if src == "timer":
        return {"type": "timer", "timer_id": as_int(cond.get("timer_id")),
                "op": text(cond.get("op"))}
    return {"type": "sensor_threshold", "sensor_id": as_int(cond.get("sensor_id")),
            "ge": cond.get("value"), "op": text(cond.get("op")),
            "filter_id": as_int(cond.get("filter_id"))}


def project_action(action):
    if "notify" in action:
        return {"action": "notify", "message": text(action.get("notify"))}
    if isinstance(action.get("state_ids"), list):
        return {"action": "process_state_set_value",
                "state_ids": list(action["state_ids"]),
                "value_id": as_int(action.get("value_id"))}
    if isinstance(action.get("p_ids"), list):
        return {"action": "process_set_value", "p_ids": list(action["p_ids"]),
                "value_id": as_int(action.get("value_id"))}
    return {"action": "notify", "message": ""}


# --------------------------------------------------------------------------
# Node-Shard-Projektion (Python-Zwilling von public/js/v9_shard.js)
# --------------------------------------------------------------------------

def state_controller_uuids(state):
    refs = state.get("io_refs") if isinstance(state.get("io_refs"), dict) else {}
    out = []
    for bucket in ("sensors", "actuators"):
        for ref in refs.get(bucket) or []:
            uuid = text(ref.get("controller_uuid"))
            if uuid:
                out.append(uuid)
    return out


def project_node_shard(config, node_id):
    shard = order_sections(json.loads(json.dumps(config)))
    meta = dict(first(config, "meta"))
    meta["scope"] = "node_local"
    meta["node_id"] = node_id
    for key in ("owner_node_id", "domain_id", "cross_domain_id"):
        meta.pop(key, None)
    shard["meta"] = [meta]

    shard["nodes"] = [row for row in rows(config, "nodes")
                      if text(row.get("node_id")) == node_id]
    shard["site_controller_map"] = [row for row in rows(config, "site_controller_map")
                                    if text(row.get("node_id")) == node_id]
    own_uuids = {text(row.get("controller_uuid")) for row in shard["site_controller_map"]}

    shard["controllers"] = [row for row in rows(config, "controllers")
                            if text(row.get("controller_uuid")) in own_uuids]
    shard["virtual_controllers"] = [row for row in rows(config, "virtual_controllers")
                                    if text(row.get("controller_uuid")) in own_uuids]
    for section in ("sensors", "actuators"):
        shard[section] = [row for row in rows(config, section)
                          if text(row.get("controller_uuid")) in own_uuids]

    site_ids = {text(row.get("site_id")) for row in shard["site_controller_map"]}
    shard["sites"] = [row for row in rows(config, "sites")
                      if not site_ids or text(row.get("site_id")) in site_ids]
    if not shard["sites"]:
        shard["sites"] = rows(config, "sites")[:1]

    shard["processes"] = [row for row in rows(config, "processes")
                          if text(row.get("owner_node_id")) == node_id]
    process_ids = {as_int(row.get("p_id")) for row in shard["processes"]}

    shard["process_states"] = [
        state for state in rows(config, "process_states")
        if as_int(state.get("p_id")) in process_ids
        and all(uuid in own_uuids for uuid in state_controller_uuids(state))
    ]
    state_ids = {as_int(row.get("state_id")) for row in shard["process_states"]}

    filtered = []
    for item in rows(config, "filters"):
        refs = [ref for ref in item.get("sensor_refs") or []
                if text(ref.get("controller_uuid")) in own_uuids]
        if refs:
            filtered.append(dict(item, sensor_refs=refs))
    shard["filters"] = filtered
    filter_ids = {as_int(row.get("filter_id")) for row in filtered}

    shard["rules"] = [
        dict(rule, owner_node_id=node_id, execution_owner=node_id,
             execution_scope="node:%s" % node_id)
        for rule in rows(config, "rules")
        if text(rule.get("owner_node_id")) == node_id
        and rule_fits_shard(rule, own_uuids, state_ids, process_ids, filter_ids)
    ]

    routes = sorted(
        [row for row in shard["site_controller_map"]
         if text(row.get("routing_role")) == "owner" and row.get("enabled") is not False],
        key=partial(_route_sort_key))
    shard["local_node"] = [{
        "node_id": node_id,
        "site_id": text(routes[0].get("site_id")) if routes
        else text((shard["sites"][0] if shard["sites"] else {}).get("site_id")),
        "active_controller_uuids": [text(row.get("controller_uuid")) for row in routes],
        "active_controller_routes": [{
            "local_controller_id": as_int(row.get("local_controller_id")),
            "controller_uuid": text(row.get("controller_uuid")),
            "controller_key": text(row.get("controller_key")),
        } for row in routes],
    }]
    return shard


def _route_sort_key(route):
    return as_int(route.get("local_controller_id"), 0) or 0


def rule_fits_shard(rule, own_uuids, state_ids, process_ids, filter_ids):
    for bucket in ("when", "until"):
        for cond in rule.get(bucket) or []:
            src = text(cond.get("src"))
            if src == "sensor" and text(cond.get("controller_uuid")) not in own_uuids:
                return False
            if src == "state" and as_int(cond.get("state_id")) not in state_ids:
                return False
            if cond.get("filter_id") is not None \
                    and as_int(cond.get("filter_id")) not in filter_ids:
                return False
    for bucket in ("do", "else_do"):
        for action in rule.get(bucket) or []:
            for value in action.get("state_ids") or []:
                if as_int(value) not in state_ids:
                    return False
            for value in action.get("p_ids") or []:
                if as_int(value) not in process_ids:
                    return False
    return True


# --------------------------------------------------------------------------
# Optionale Tiefprüfung gegen die echte Runtime-Type-Authority
# --------------------------------------------------------------------------

def verify_with_runtime(config):
    """Nutzt automation_system_v0101, falls es im PYTHONPATH liegt.

    Ist die Runtime nicht verfügbar, läuft der Editor unverändert weiter —
    die Browser-Validierung in public/js/v9_validate.js bleibt maßgeblich.
    """
    try:
        from src.library._generic_type_library import (  # noqa: PLC0415
            verify_storage_config_data, config_fingerprint)
    except Exception:  # noqa: BLE001
        return {"available": False}
    try:
        report = verify_storage_config_data(config)
        return {
            "available": True,
            "status": report.get("status"),
            "errors": report.get("errors") or [],
            "warnings": report.get("warnings") or [],
            "fingerprint": config_fingerprint(config),
        }
    except Exception as exc:  # noqa: BLE001
        return {"available": True, "status": "FAILED", "errors": [str(exc)]}


def local_fingerprint(config):
    """Fingerprint über die kanonischen Bytes (Fallback ohne Runtime)."""
    import hashlib
    payload = json.dumps(order_sections(config), sort_keys=True,
                         separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Ausgabe im kanonischen Lesbarkeitsformat
# --------------------------------------------------------------------------

def wants_readable(request):
    """`?format=text` oder `?download=<name>` -> lesbares Format statt kompaktem JSON."""
    query = request.rel_url.query
    return query.get("format") in ("text", "readable", "pretty") \
        or bool(query.get("download"))


def readable_response(request, payload, default_name, extra_headers=None):
    """Liefert die Config als formatierten Text — optional als Datei-Download."""
    headers = dict(extra_headers or {})
    name = request.rel_url.query.get("download")
    if name:
        safe = "".join(ch for ch in str(name) if ch.isalnum() or ch in "._-") or default_name
        if not safe.endswith(".json"):
            safe += ".json"
        headers["Content-Disposition"] = 'attachment; filename="%s"' % safe
    headers.setdefault("X-Config-Format", "readable_v3")
    return web.Response(text=format_config(payload), content_type="application/json",
                        charset="utf-8", headers=headers)


def config_response(request, payload, default_name, extra_headers=None):
    """JSON-Antwort; auf Wunsch im Lesbarkeitsformat."""
    if wants_readable(request):
        return readable_response(request, payload, default_name, extra_headers)
    return web.json_response(payload, headers=extra_headers or {})


# --------------------------------------------------------------------------
# Handler
# --------------------------------------------------------------------------

def load_config(base_dir):
    path = config_path(base_dir)
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8")), str(path)
    legacy = Path(base_dir) / "config" / LEGACY_NAME
    if legacy.is_file():
        return json.loads(legacy.read_text(encoding="utf-8")), str(legacy)
    return None, ""


async def v9_config_get(request, *, base_dir):
    config, source = load_config(base_dir)
    if config is None:
        return web.json_response({"status": "error",
                                  "message": "Keine V9-Config gefunden."}, status=404)
    # Der Fingerprint als Header: der Editor kann ihn im Browser nicht
    # zuverlaessig nachrechnen (JSON.parse verliert Gleitkomma-Literale), soll
    # ihn aber in Konfigurations-Snapshots hinterlegen koennen.
    return config_response(request, config, "device_state_data_v9.json",
                           {"X-Config-Source": source,
                            "X-Config-Fingerprint": local_fingerprint(config)})


async def v9_config_post(request, *, base_dir):
    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001
        return web.json_response({"status": "error",
                                  "message": "Ungültiges JSON: %s" % exc}, status=400)

    candidate = payload.get("config") if isinstance(payload, dict) else None
    if not isinstance(candidate, dict):
        return web.json_response({"status": "error",
                                  "message": "Feld 'config' fehlt."}, status=400)

    missing = [section for section in SECTION_ORDER if section not in candidate]
    extra = [key for key in candidate if key not in SECTION_ORDER]
    if missing or extra:
        return web.json_response({
            "status": "error",
            "message": "Sektionsmenge weicht vom V9-Vertrag ab.",
            "missing_sections": missing,
            "unsupported_sections": extra,
        }, status=400)

    target = config_path(base_dir)
    previous = None
    if target.is_file():
        previous = json.loads(target.read_text(encoding="utf-8"))

    normalized, stats = canonicalize(order_sections(candidate), previous)

    verification = verify_with_runtime(normalized)
    if verification.get("available") and verification.get("status") != "OK" \
            and not payload.get("force"):
        return web.json_response({
            "status": "error",
            "message": "Runtime-Type-Authority hat die Config abgelehnt.",
            "verification": verification,
        }, status=422)

    if previous is not None:
        backup_dir = Path(base_dir) / "config" / BACKUP_DIR
        backup_dir.mkdir(parents=True, exist_ok=True)
        existing = sorted(backup_dir.glob("device_state_data_v9.*.json"))
        shutil.copy2(target, backup_dir / ("device_state_data_v9.%04d.json"
                                           % (len(existing) + 1)))
        for stale in existing[:-(MAX_BACKUPS - 1)] if len(existing) >= MAX_BACKUPS else []:
            stale.unlink(missing_ok=True)

    # Kanonisches Lesbarkeitsformat — byte-gleich zu Runtime und Editor.
    atomic_write_text(target, format_config(normalized))

    return web.json_response({
        "status": "ok",
        "path": str(target),
        "canonicalized_fields": sum(stats.values()),
        "canonicalization": stats,
        "fingerprint": verification.get("fingerprint") or local_fingerprint(normalized),
        "verification": verification,
    })


async def v9_shard_get(request, *, base_dir):
    config, _ = load_config(base_dir)
    if config is None:
        return web.json_response({"status": "error",
                                  "message": "Keine V9-Config gefunden."}, status=404)
    node_id = request.match_info.get("node_id", "")
    known = {text(row.get("node_id")) for row in rows(config, "nodes")}
    if node_id not in known:
        return web.json_response({"status": "error",
                                  "message": "Unbekannter node_id '%s'." % node_id,
                                  "known_nodes": sorted(known)}, status=404)
    shard = project_node_shard(config, node_id)
    return config_response(request, shard,
                           "device_state_data_v9_node_%s.json" % node_id.replace("-", ""),
                           {"X-Config-Fingerprint": local_fingerprint(shard)})


async def v9_report_get(request, *, base_dir):
    config, source = load_config(base_dir)
    if config is None:
        return web.json_response({"status": "error",
                                  "message": "Keine V9-Config gefunden."}, status=404)
    report_path = Path(base_dir) / "config" / "migration_report_v9.json"
    migration = json.loads(report_path.read_text(encoding="utf-8")) \
        if report_path.is_file() else {}
    return web.json_response({
        "source": source,
        "section_counts": {section: len(rows(config, section)) for section in SECTION_ORDER},
        "verification": verify_with_runtime(config),
        "fingerprint": local_fingerprint(config),
        "migration": migration,
    })


async def device_config_get(request, *, base_dir):
    """Legacy-Endpunkt — liefert die Editor-Projektion der V9-Config."""
    config, source = load_config(base_dir)
    if config is None:
        return web.json_response({"erfolg": False,
                                  "fehler": "Keine Config gefunden."}, status=404)
    meta = first(config, "meta")
    if as_int(meta.get("version")) != 9:
        # Alte Datei unverändert durchreichen (Browser migriert selbst).
        return web.json_response(config, headers={"X-Config-Source": source})
    return web.json_response(project_editor_view(config),
                             headers={"X-Config-Source": source,
                                      "X-Config-Projection": "editor_view_v9"})



# --------------------------------------------------------------------------
# Cross-V8-Shards (Python-Zwilling von public/js/v9_shard.js)
# --------------------------------------------------------------------------

CROSS_VERSION = 8
CROSS_RULE_SCOPES = ("cross_controller", "cross_worker")
CROSS_CRITICAL_GROUPS = frozenset({
    "emergency", "hard_real_time", "hard_realtime", "interlock", "real_time",
    "realtime", "safety", "safety_critical", "soft_realtime", "time_critical",
})
CROSS_CONTROLLER_FIELDS = ("controller_id", "controller_uuid", "controller_key",
                           "owner_node_id")
CROSS_SENSOR_FIELDS = ("local_controller_id", "sensor_id", "node_id",
                       "controller_uuid", "controller_key", "enabled", "sensor_group")
CROSS_ACTUATOR_FIELDS = ("local_controller_id", "actuator_id", "node_id",
                         "controller_uuid", "controller_key", "enabled", "actuator_group")


def owner_index(config):
    """Owner-Node je controller_uuid aus den aktivierten owner-Routen."""
    owners = {}
    for route in rows(config, "site_controller_map"):
        if text(route.get("routing_role")) != "owner" or route.get("enabled") is False:
            continue
        owners.setdefault(text(route.get("controller_uuid")), set()).add(
            text(route.get("node_id")))
    return owners


def scope_for_controllers(uuids, owners):
    unique = sorted({text(u) for u in uuids if text(u)})
    if not unique:
        return "unbound", []
    nodes = set()
    for uuid in unique:
        candidates = owners.get(uuid)
        if not candidates or len(candidates) != 1:
            return "invalid", []
        nodes.add(next(iter(candidates)))
    if len(unique) == 1:
        return "local_controller", sorted(nodes)
    return ("cross_controller" if len(nodes) == 1 else "cross_worker"), sorted(nodes)


def rule_controller_uuids(rule, states_by_id):
    out = []

    def add_state(state_id):
        state = states_by_id.get(as_int(state_id))
        if state:
            out.extend(state_controller_uuids(state))

    for bucket in ("when", "until"):
        for cond in rule.get(bucket) or []:
            if not isinstance(cond, dict):
                continue
            if text(cond.get("controller_uuid")):
                out.append(text(cond.get("controller_uuid")))
            if text(cond.get("src")) == "state":
                add_state(cond.get("state_id"))
            value = cond.get("value")
            if isinstance(value, dict) and value.get("param_of_state") is not None:
                add_state(value.get("param_of_state"))
    for bucket in ("do", "else_do"):
        for action in rule.get(bucket) or []:
            for state_id in (action.get("state_ids") or []) if isinstance(action, dict) else []:
                add_state(state_id)
    return out


def mutated_state_ids(rule):
    out = set()
    for bucket in ("do", "else_do"):
        for action in rule.get(bucket) or []:
            if not isinstance(action, dict):
                continue
            for state_id in action.get("state_ids") or []:
                value = as_int(state_id)
                if value is not None:
                    out.add(value)
    return sorted(out)


def is_critical_rule(rule):
    group = text(rule.get("group")).lower().replace("-", "_")
    if group in CROSS_CRITICAL_GROUPS:
        return True
    for key in ("critical", "safety_critical", "time_critical", "hard_realtime"):
        if rule.get(key) is True:
            return True
    for key in ("deadline_ms", "max_latency_ms"):
        value = rule.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            return True
    return text(rule.get("latency_class")).lower().replace("-", "_") in CROSS_CRITICAL_GROUPS


def classify_scopes(config):
    """Scope je State und Regel plus Owner-Nodes je Regel."""
    owners = owner_index(config)
    states_by_id = {as_int(row.get("state_id")): row for row in rows(config, "process_states")}
    state_scopes = {}
    rule_scopes = {}
    rule_nodes = {}
    for state in rows(config, "process_states"):
        scope, _ = scope_for_controllers(state_controller_uuids(state), owners)
        state_scopes[as_int(state.get("state_id"))] = scope
    for rule in rows(config, "rules"):
        scope, nodes = scope_for_controllers(
            rule_controller_uuids(rule, states_by_id), owners)
        rule_id = as_int(rule.get("rule_id"))
        rule_scopes[rule_id] = scope
        rule_nodes[rule_id] = nodes
    return {"states": state_scopes, "rules": rule_scopes, "rule_nodes": rule_nodes,
            "owners": owners}


def cross_eligibility(rule, scopes):
    """Fail-closed Cross-Writer-Eignung — Spiegel von cross_rule_eligibility()."""
    rule_id = as_int(rule.get("rule_id"))
    scope = scopes["rules"].get(rule_id)
    reasons = []
    if scope not in CROSS_RULE_SCOPES:
        reasons.append("Regelgraph ist nicht cross-scoped (%s)" % scope)
    if is_critical_rule(rule):
        reasons.append("sicherheits-/zeitkritische Regeln dürfen nicht cross laufen")
    mutated = mutated_state_ids(rule)
    invalid = [sid for sid in mutated if scopes["states"].get(sid) not in CROSS_RULE_SCOPES]
    if invalid:
        reasons.append("geschriebene States sind nicht cross-eigen: %s"
                       % ",".join(str(x) for x in invalid))
    notify_only = not mutated and any(
        text(action.get("notify")) for bucket in ("do", "else_do")
        for action in rule.get(bucket) or [] if isinstance(action, dict))
    if not mutated and not notify_only:
        reasons.append("Regel hat kein cross-eigenes State-Ziel")
    return {"ok": not reasons, "rule_id": rule_id, "scope": scope,
            "mutated_state_ids": mutated, "invalid_target_state_ids": invalid,
            "notify_only": notify_only, "reasons": reasons}


def rule_owner_for(rule, scopes):
    explicit = text(rule.get("owner_node_id"))
    if explicit:
        return explicit
    nodes = scopes["rule_nodes"].get(as_int(rule.get("rule_id"))) or []
    return nodes[0] if len(nodes) == 1 else ""


def strip_cross_fields(section_rows, allowed):
    return [{key: row[key] for key in allowed if key in row} for row in section_rows]


def project_cross_shard(config, owner_node_id, scopes=None):
    """Erzeugt den V8-Cross-Shard eines Owners — ohne jedes Physikfeld."""
    scopes = scopes or classify_scopes(config)
    owner = text(owner_node_id)
    states_by_id = {as_int(row.get("state_id")): row for row in rows(config, "process_states")}

    rules = [rule for rule in rows(config, "rules")
             if cross_eligibility(rule, scopes)["ok"]
             and rule_owner_for(rule, scopes) == owner]

    shard = order_sections(json.loads(json.dumps(config)))
    shard["meta"] = [{
        "version": CROSS_VERSION,
        "schema": "device_state_norm",
        "scope": "cross",
        "owner_node_id": owner,
        "domain_id": "cross-%s-default" % owner,
        # Wortgleich mit createCrossMeta() in public/js/v9_factory.js —
        # nur so sind JS- und Python-Projektion fingerprint-identisch.
        "description": ("V8 Cross-Execution-Shard für %s. Kanonisch flach, ausschließlich "
                        "logische Identitäten (controller_uuid plus lokale I/O-ID), keine "
                        "physischen Endpunkte oder Feldbus-Koordinaten." % owner),
    }]
    shard["local_node"] = []

    referenced = set()
    for rule in rules:
        for state_id in mutated_state_ids(rule):
            referenced.add(state_id)
        for bucket in ("when", "until"):
            for cond in rule.get(bucket) or []:
                if text(cond.get("src")) == "state":
                    referenced.add(as_int(cond.get("state_id")))
    for state_id, scope in scopes["states"].items():
        if scope in CROSS_RULE_SCOPES:
            referenced.add(state_id)

    shard["process_states"] = [state for state in rows(config, "process_states")
                               if as_int(state.get("state_id")) in referenced]
    process_ids = {as_int(state.get("p_id")) for state in shard["process_states"]}
    shard["processes"] = [dict(row, owner_node_id=owner) for row in rows(config, "processes")
                          if as_int(row.get("p_id")) in process_ids]

    used_sensors, used_actuators = set(), set()
    for state in shard["process_states"]:
        refs = state.get("io_refs") if isinstance(state.get("io_refs"), dict) else {}
        for ref in refs.get("sensors") or []:
            used_sensors.add((text(ref.get("controller_uuid")), as_int(ref.get("sensor_id"))))
        for ref in refs.get("actuators") or []:
            used_actuators.add((text(ref.get("controller_uuid")), as_int(ref.get("actuator_id"))))
    for rule in rules:
        for bucket in ("when", "until"):
            for cond in rule.get(bucket) or []:
                if text(cond.get("src")) == "sensor":
                    used_sensors.add((text(cond.get("controller_uuid")),
                                      as_int(cond.get("sensor_id"))))

    shard["sensors"] = strip_cross_fields(
        [row for row in rows(config, "sensors")
         if (text(row.get("controller_uuid")), as_int(row.get("sensor_id"))) in used_sensors],
        CROSS_SENSOR_FIELDS)
    shard["actuators"] = strip_cross_fields(
        [row for row in rows(config, "actuators")
         if (text(row.get("controller_uuid")), as_int(row.get("actuator_id"))) in used_actuators],
        CROSS_ACTUATOR_FIELDS)

    used_uuids = {row["controller_uuid"] for row in shard["sensors"] + shard["actuators"]}
    owners = scopes["owners"]
    controllers = []
    for row in rows(config, "controllers"):
        uuid = text(row.get("controller_uuid"))
        if uuid not in used_uuids:
            continue
        candidates = owners.get(uuid) or set()
        controllers.append({
            "controller_id": as_int(row.get("controller_id")),
            "owner_node_id": next(iter(candidates)) if len(candidates) == 1 else owner,
            "controller_uuid": uuid,
            "controller_key": text(row.get("controller_key")),
        })
    shard["controllers"] = controllers
    shard["virtual_controllers"] = []

    routes = []
    for route in rows(config, "site_controller_map"):
        if text(route.get("controller_uuid")) not in used_uuids:
            continue
        node_id = text(route.get("node_id"))
        local_id = as_int(route.get("local_controller_id"))
        routes.append({
            "local_controller_id": local_id,
            "node_id": node_id,
            "controller_uuid": text(route.get("controller_uuid")),
            "controller_key": text(route.get("controller_key")),
            "route_key": "%s.ctrl_%s" % (node_id, local_id),
            "routing_role": text(route.get("routing_role")) or "owner",
            "enabled": route.get("enabled") is not False,
        })
    shard["site_controller_map"] = routes

    node_ids = {route["node_id"] for route in routes} | {owner}
    shard["nodes"] = [{key: value for key, value in row.items() if key != "site_id"}
                      for row in rows(config, "nodes")
                      if text(row.get("node_id")) in node_ids]

    filters = []
    for item in rows(config, "filters"):
        refs = [ref for ref in item.get("sensor_refs") or []
                if (text(ref.get("controller_uuid")), as_int(ref.get("sensor_id")))
                in used_sensors]
        if refs:
            filters.append(dict(item, sensor_refs=refs))
    shard["filters"] = filters
    filter_ids = {as_int(row.get("filter_id")) for row in filters}

    keep = ("rule_id", "engine_id", "owner_node_id", "group", "priority", "name",
            "enabled", "when", "until", "do", "else_do", "latch", "description")
    trimmed = []
    for rule in rules:
        row = {key: rule[key] for key in keep if key in rule}
        row["owner_node_id"] = owner
        for bucket in ("when", "until"):
            if bucket not in row:
                continue
            cleaned = []
            for cond in row[bucket]:
                copy = dict(cond)
                if copy.get("filter_id") is not None \
                        and as_int(copy["filter_id"]) not in filter_ids:
                    copy.pop("filter_id")
                cleaned.append(copy)
            row[bucket] = cleaned
        trimmed.append(row)
    shard["rules"] = trimmed

    timer_ids = set()
    for rule in trimmed:
        for bucket in ("when", "until"):
            for cond in rule.get(bucket) or []:
                if text(cond.get("src")) == "timer":
                    timer_ids.add(as_int(cond.get("timer_id")))
    shard["timers"] = [row for row in rows(config, "timers")
                       if as_int(row.get("timer_id")) in timer_ids]

    return order_sections(shard)


def list_cross_owners(config, scopes=None):
    scopes = scopes or classify_scopes(config)
    owners = []
    for rule in rows(config, "rules"):
        if not cross_eligibility(rule, scopes)["ok"]:
            continue
        owner = rule_owner_for(rule, scopes)
        if owner and owner not in owners:
            owners.append(owner)
    return owners


def split_shards(config):
    """node_local-Shards (V9) + cross-Shards (V8), disjunkt und vollständig."""
    scopes = classify_scopes(config)
    cross_ids = {as_int(rule.get("rule_id")) for rule in rows(config, "rules")
                 if cross_eligibility(rule, scopes)["ok"]}

    local = {}
    for node in {text(row.get("node_id")) for row in rows(config, "nodes")}:
        shard = project_node_shard(config, node)
        shard["rules"] = [rule for rule in shard.get("rules") or []
                          if as_int(rule.get("rule_id")) not in cross_ids]
        local[node] = shard

    cross = {owner: project_cross_shard(config, owner, scopes)
             for owner in list_cross_owners(config, scopes)}

    local_rules = {as_int(rule.get("rule_id")) for shard in local.values()
                   for rule in shard.get("rules") or []}
    cross_rules = {as_int(rule.get("rule_id")) for shard in cross.values()
                   for rule in shard.get("rules") or []}
    executable = {as_int(rule.get("rule_id")) for rule in rows(config, "rules")
                  if scopes["rules"].get(as_int(rule.get("rule_id")))
                  in ("local_controller",) + CROSS_RULE_SCOPES}
    overlap = sorted(local_rules & cross_rules)
    missing = sorted(executable - local_rules - cross_rules)

    return {
        "local": local,
        "cross": cross,
        "ok": not overlap and not missing,
        "overlap_rule_ids": overlap,
        "missing_rule_ids": missing,
        "stats": {
            "local_shards": len(local),
            "cross_shards": len(cross),
            "local_rule_count": len(local_rules),
            "cross_rule_count": len(cross_rules),
            "executable_rule_count": len(executable),
        },
        "eligibility": [cross_eligibility(rule, scopes) for rule in rows(config, "rules")],
    }


async def v9_cross_get(request, *, base_dir):
    config, _ = load_config(base_dir)
    if config is None:
        return web.json_response({"status": "error",
                                  "message": "Keine V9-Config gefunden."}, status=404)
    owner = request.match_info.get("owner_node_id", "")
    scopes = classify_scopes(config)
    known = list_cross_owners(config, scopes)
    if owner not in known:
        return web.json_response({
            "status": "error",
            "message": "Für '%s' gibt es keine cross-fähigen Regeln." % owner,
            "known_cross_owners": known,
            "eligibility": [cross_eligibility(rule, scopes) for rule in rows(config, "rules")],
        }, status=404)
    shard = project_cross_shard(config, owner, scopes)
    return config_response(request, shard,
                           "device_state_data_v8_cross_%s.json" % owner.replace("-", ""),
                           {"X-Config-Fingerprint": local_fingerprint(shard)})


async def v9_split_get(request, *, base_dir):
    config, source = load_config(base_dir)
    if config is None:
        return web.json_response({"status": "error",
                                  "message": "Keine V9-Config gefunden."}, status=404)
    result = split_shards(config)
    return web.json_response({
        "status": "ok" if result["ok"] else "error",
        "source": source,
        "ok": result["ok"],
        "stats": result["stats"],
        "overlap_rule_ids": result["overlap_rule_ids"],
        "missing_rule_ids": result["missing_rule_ids"],
        "eligibility": result["eligibility"],
        "local": {node: {"rules": len(shard.get("rules") or []),
                         "process_states": len(shard.get("process_states") or []),
                         "controllers": len(shard.get("controllers") or [])}
                  for node, shard in result["local"].items()},
        "cross": {owner: {"rules": len(shard.get("rules") or []),
                          "process_states": len(shard.get("process_states") or []),
                          "controllers": len(shard.get("controllers") or [])}
                  for owner, shard in result["cross"].items()},
    })


def register_v9_routes(app, base_dir):
    """Registriert alle V9-Endpunkte. Rückgabe: die App (verkettbar)."""
    app.router.add_get("/api/v9/config", partial(v9_config_get, base_dir=base_dir))
    app.router.add_post("/api/v9/config", partial(v9_config_post, base_dir=base_dir))
    app.router.add_get("/api/v9/shard/{node_id}", partial(v9_shard_get, base_dir=base_dir))
    app.router.add_get("/api/v9/cross/{owner_node_id}", partial(v9_cross_get, base_dir=base_dir))
    app.router.add_get("/api/v9/split", partial(v9_split_get, base_dir=base_dir))
    app.router.add_get("/api/v9/report", partial(v9_report_get, base_dir=base_dir))
    app.router.add_get("/api/device-config", partial(device_config_get, base_dir=base_dir))
    return app
