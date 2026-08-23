#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fuehrt V9-Node-Shards (und V8-Cross-Shards) zu einer master_global-Config zusammen.

Warum
-----
`build_shards.py` zerlegt eine master_global-Config in das, was jeder Worker
tatsaechlich laden darf. Dieses Werkzeug ist der exakte Gegenweg: aus den im
Feld vorhandenen Shards entsteht wieder EINE Master-Sicht, die der Editor
bearbeiten kann. Beide zusammen ergeben einen beweisbaren Rundlauf:

    master --build_shards--> {node-shards, cross-shards} --merge--> master

Was der Merge dabei geradezieht
-------------------------------
Feld-Shards driften auseinander. Der Merge normalisiert deshalb aktiv:

    * site_id       — eine Site je Fleet. Die Schreibweise steckt in JEDER
                      controller_uuid; 'site-main' statt 'site_main' erzeugt
                      einen zweiten Identitaetsraum.
    * route_key     — wird aus (site_id, node_id, local_controller_id) neu
                      berechnet, statt aus dem Shard uebernommen.
    * routing_model — der Master fuehrt immer das dreiteilige Modell.
    * Kataloge      — node-freie Tabellen (Typen, Templates, Profile) muessen
                      in allen Shards gleich sein; Abweichungen werden als
                      Konflikt gemeldet, nicht stillschweigend ueberschrieben.
    * Cross-Shards  — liefern KEINE Physik (Adressen, Busse, Hosts). Sie
                      dienen nur als Quelle fuer Controller, die in keinem
                      Node-Shard mehr auftauchen, und werden als
                      Provisionierungs-Stubs uebernommen.

Aufruf
------
    python3 _tools/merge_shards_to_master.py shard_a.json shard_b.json \\
        --cross cross_fn01.json --out config/device_state_data_v9.json --verify

Designvorgaben: rein funktional, kein OOP, keine Decorators/Dataclasses,
`functools.partial` statt Lambda.
"""

from __future__ import annotations

import argparse
import json
import sys
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _tools.format_v9_config import TOP_LEVEL_ORDER, format_config  # noqa: E402
from _tools.provision_defaults import (  # noqa: E402
    provision_controller, provision_io, majority_value)

CANONICAL_VERSION = 9
CANONICAL_SCHEMA = "device_state_norm"
CANONICAL_SCOPE = "master_global"
CANONICAL_ROUTING_MODEL = "site_id_node_id_local_controller_id"

# Sektion -> Schluesselfelder. Ein Tupel dieser Felder identifiziert eine Zeile
# eindeutig. Leeres Tupel = Singleton (genau eine Zeile im Master).
MERGE_KEYS = {
    "meta": (),
    "sites": ("site_id",),
    "nodes": ("node_id",),
    "local_node": ("node_id",),
    "site_controller_map": ("node_id", "local_controller_id"),
    "controllers": ("controller_uuid",),
    "virtual_controllers": ("controller_uuid", "virt_controller_id"),
    "modbus_functions": ("modbus_function_id",),
    "scaling_profiles": ("profile_id",),
    "sensor_types": ("sensor_types_id",),
    "actuator_types": ("actuator_types_id",),
    "sensors": ("controller_uuid", "sensor_id"),
    "actuators": ("controller_uuid", "actuator_id"),
    "process_modes": ("mode_id",),
    "process_values": ("value_id",),
    "parameter_generic_templates": ("schema_id",),
    "schema_mappings": ("mapping_id",),
    "pid_configs": ("pid_config_id",),
    "control_method_templates": ("template_id",),
    "control_methods": ("method_id",),
    "processes": ("p_id",),
    "process_states": ("state_id",),
    "filters": ("filter_id",),
    "timers": ("timer_id",),
    "rule_engine": ("engine_id",),
    "rules": ("rule_id",),
}

# Node-freie Kataloge: muessen in allen Shards identisch sein.
CATALOG_SECTIONS = frozenset((
    "modbus_functions", "scaling_profiles", "sensor_types", "actuator_types",
    "process_modes", "process_values", "parameter_generic_templates",
    "schema_mappings", "pid_configs", "control_method_templates",
    "control_methods", "timers", "rule_engine",
))

# Felder, die ein Cross-Shard nie liefern darf (V8-Verbotsliste).
CROSS_FORBIDDEN = frozenset((
    "bus_type", "host", "port", "unit", "address", "function_type",
    "activation_state", "deployment_status", "execution_epoch",
    "execution_owner", "execution_scope",
))


# =============================================================================
# GENERISCHE HELFER
# =============================================================================


def rows(config, section):
    value = config.get(section)
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def text(value):
    return "" if value is None else str(value).strip()


def key_of(section, row):
    fields = MERGE_KEYS.get(section, ())
    return tuple(text(row.get(field)) for field in fields)


def canonical_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def note(report, kind, section, message):
    report.setdefault(kind, []).append({"section": section, "message": message})


# =============================================================================
# NORMALISIERUNG
# =============================================================================


def route_key_for(site_id, node_id, local_controller_id):
    return "%s.%s.ctrl_%s" % (site_id, node_id, local_controller_id)


def normalize_site(row, site_id, seen_sites):
    """Zieht site_id auf die kanonische Schreibweise; meldet Abweichungen."""
    if not isinstance(row, dict) or "site_id" not in row:
        return row
    current = text(row.get("site_id"))
    if current and current != site_id:
        seen_sites.add(current)
        row = dict(row)
        row["site_id"] = site_id
    return row


def normalize_row(section, row, site_id, seen_sites):
    row = normalize_site(row, site_id, seen_sites)
    if section == "site_controller_map":
        row = dict(row)
        row["site_id"] = site_id
        row["route_key"] = route_key_for(site_id, text(row.get("node_id")),
                                         row.get("local_controller_id"))
    elif section == "local_node":
        row = dict(row)
        row["site_id"] = site_id
        routes = []
        for route in row.get("active_controller_routes") or []:
            route = dict(route)
            route.setdefault("node_id", text(row.get("node_id")))
            route["site_id"] = site_id
            route["route_key"] = route_key_for(site_id, text(route.get("node_id")),
                                               route.get("local_controller_id"))
            routes.append(route)
        if routes:
            row["active_controller_routes"] = routes
    elif section == "rule_engine":
        runtime = row.get("runtime")
        if isinstance(runtime, dict) and \
                text(runtime.get("routing_model")) != CANONICAL_ROUTING_MODEL:
            row = dict(row)
            runtime = dict(runtime)
            runtime["routing_model"] = CANONICAL_ROUTING_MODEL
            row["runtime"] = runtime
    return row


def strip_cross_fields(row):
    """Entfernt alles, was ein Cross-Shard vertragsgemaess nicht fuehren darf."""
    return {key: value for key, value in row.items() if key not in CROSS_FORBIDDEN}


# =============================================================================
# MERGE
# =============================================================================


def merge_section(section, buckets, report):
    """Vereinigt gleichnamige Sektionen mehrerer Shards ueber ihre Schluessel."""
    merged = {}
    order = []
    for source, row in buckets:
        row_key = key_of(section, row)
        if row_key not in merged:
            merged[row_key] = (source, row)
            order.append(row_key)
            continue
        previous_source, previous = merged[row_key]
        if canonical_bytes(previous) == canonical_bytes(row):
            continue
        if section in CATALOG_SECTIONS:
            note(report, "conflicts", section,
                 "Katalogzeile %s weicht zwischen %s und %s ab — %s gewinnt."
                 % (row_key or "(singleton)", previous_source, source, previous_source))
            continue
        # Nicht-Katalog: die reichere Zeile gewinnt (mehr belegte Felder).
        if len([v for v in row.values() if v not in (None, "", [], {})]) > \
                len([v for v in previous.values() if v not in (None, "", [], {})]):
            merged[row_key] = (source, row)
            note(report, "merges", section,
                 "Zeile %s aus %s ersetzt die aermere Variante aus %s."
                 % (row_key or "(singleton)", source, previous_source))
        else:
            note(report, "merges", section,
                 "Zeile %s aus %s beibehalten, %s abweichend."
                 % (row_key or "(singleton)", previous_source, source))
    return [merged[row_key][1] for row_key in order]


def collect(shards, site_id, report, seen_sites):
    """Sammelt alle Zeilen je Sektion, bereits normalisiert."""
    buckets = {}
    for source, config in shards:
        for section in TOP_LEVEL_ORDER:
            if section not in config:
                note(report, "notes", section, "fehlt in %s" % source)
                continue
            for row in rows(config, section):
                if not isinstance(row, dict):
                    continue
                buckets.setdefault(section, []).append(
                    (source, normalize_row(section, row, site_id, seen_sites)))
    return buckets


def controller_stubs_from_cross(cross_shards, known_uuids, site_id, report, assign=None):
    """Controller, die NUR im Cross-Shard existieren, als Stub uebernehmen.

    Das ist der Fall D-2: `ctrl_wago_3` lebt im Cross-Shard von fn-01, aber in
    keinem Node-Shard. Ohne diesen Schritt haette der Master einen Aktor ohne
    besitzenden Worker — die Runtime wuerde die Regel spaeter nicht ausfuehren
    koennen, ohne dass es beim Speichern auffaellt.
    """
    stubs = []
    for source, config in cross_shards:
        owner = text((rows(config, "meta") or [{}])[0].get("owner_node_id"))
        for row in rows(config, "controllers"):
            controller_uuid = text(row.get("controller_uuid"))
            if not controller_uuid or controller_uuid in known_uuids:
                continue
            known_uuids.add(controller_uuid)
            stub = strip_cross_fields(dict(row))
            stub.setdefault("device_name",
                            text(row.get("controller_key")).replace("ctrl_", "") or "controller")
            # Der `owner_node_id` eines Cross-Shards ist der DOMAIN-Eigentuemer,
            # nicht zwingend der Betriebs-Node. Wer den Controller wirklich
            # bedient, sagt entweder `--assign` oder - ersatzweise - die Domain.
            controller_key = text(row.get("controller_key"))
            operating = text((assign or {}).get(controller_key)) \
                or text((assign or {}).get(controller_uuid)) \
                or text(row.get("owner_node_id")) or owner
            stub["node_id"] = operating
            stub["site_id"] = site_id
            stub["owner_node_id"] = operating
            stubs.append(stub)
            note(report, "provisioned", "controllers",
                 "%s (%s) existiert nur im Cross-Shard %s und wurde als "
                 "Provisionierungs-Stub uebernommen."
                 % (stub.get("controller_key"), controller_uuid, source))
    return stubs


def provision_physical_defaults(stub, master, report):
    """Ergaenzt fehlende Physikfelder eines Cross-Stubs aus dem Anlagenkontext.

    Ein Cross-Shard fuehrt bewusst KEINE Physik. Landet ein solcher Controller
    im Master, fehlen ihm genau die Felder, die der V9-Vertrag dort verlangt.
    Die Regeln dafuer stehen an EINER Stelle — `_tools/provision_defaults.py` —
    und gelten damit fuer Migration und Merge gleichermassen.
    """
    node_id = text(stub.get("node_id"))
    siblings = [row for row in master["controllers"]
                if text(row.get("node_id")) == node_id
                and text(row.get("controller_uuid")) != text(stub.get("controller_uuid"))]
    if not siblings:
        siblings = list(master["controllers"])
    filled = provision_controller(stub, siblings)
    if filled:
        note(report, "provisioned", "controllers",
             "%s: %s" % (stub.get("controller_key"), ", ".join(filled)))
    return stub


def provision_io_defaults(master, section, report):
    """Ergaenzt Physikfelder an I/O-Zeilen, die nur aus einem Cross-Shard stammen."""
    for row in master[section]:
        filled = provision_io(section, row, master[section])
        if not filled:
            continue
        note(report, "provisioned", section,
             "%s %s auf %s: %s"
             % (section[:-1], row.get("sensor_id", row.get("actuator_id")),
                text(row.get("controller_key")) or text(row.get("controller_uuid")),
                ", ".join(filled)))


def reconcile_routing(master, site_id, report):
    """Zieht ALLE Routing-Metadaten auf die site_controller_map als Wahrheit.

    Ein Shard nummeriert `local_controller_id` aus SEINER Sicht. Beim
    Zusammenfuehren treffen zwei Nummernkreise aufeinander — eine aus dem
    Cross-Shard uebernommene I/O-Zeile traegt dann eine local_controller_id,
    die es auf ihrem neuen Betriebs-Node gar nicht gibt. Die Runtime meldet das
    als "routing key not found in site_controller_map".

    Deshalb gilt hier genau eine Quelle der Wahrheit: die site_controller_map.
    Aus ihr werden node_id, site_id, local_controller_id, controller_key und
    route_key fuer Controller und I/O neu gesetzt, und `local_node` wird
    vollstaendig daraus abgeleitet.
    """
    index = {}
    for route in master["site_controller_map"]:
        controller_uuid = text(route.get("controller_uuid"))
        if controller_uuid:
            index[controller_uuid] = route

    fixed = 0
    for section in ("controllers", "sensors", "actuators", "virtual_controllers"):
        for row in master[section]:
            route = index.get(text(row.get("controller_uuid")))
            if not route:
                continue
            for field in ("node_id", "site_id", "local_controller_id", "controller_key"):
                if field == "local_controller_id" and section == "controllers":
                    # controllers fuehren zusaetzlich die globale controller_id
                    row[field] = route.get(field)
                    continue
                if row.get(field) != route.get(field):
                    row[field] = route.get(field)
                    fixed += 1
    if fixed:
        note(report, "normalized", "routing",
             "%d Routing-Felder an die site_controller_map angeglichen." % fixed)

    # local_node vollstaendig aus der Routing-Tabelle ableiten.
    by_node = {}
    for route in sort_rows(master["site_controller_map"], ("node_id", "local_controller_id")):
        by_node.setdefault(text(route.get("node_id")), []).append(route)
    master["local_node"] = [{
        "node_id": node_id,
        "site_id": site_id,
        "active_controller_uuids": [text(route.get("controller_uuid")) for route in routes],
        "active_controller_routes": [{
            "local_controller_id": route.get("local_controller_id"),
            "node_id": node_id,
            "site_id": site_id,
            "controller_uuid": text(route.get("controller_uuid")),
            "controller_key": text(route.get("controller_key")),
            "route_key": route_key_for(site_id, node_id, route.get("local_controller_id")),
            "routing_role": text(route.get("routing_role")) or "owner",
            "enabled": bool(route.get("enabled", True)),
        } for route in routes],
    } for node_id, routes in sorted(by_node.items())]


def next_local_controller_id(scm, node_id):
    used = {row.get("local_controller_id") for row in scm
            if text(row.get("node_id")) == node_id}
    candidate = 1
    while candidate in used:
        candidate += 1
    return candidate


def merge_shards(node_shards, cross_shards, site_id, description="", assign=None):
    """Liefert (master_config, report)."""
    report = {}
    seen_sites = set()
    buckets = collect(node_shards + cross_shards_as_catalogs(cross_shards),
                      site_id, report, seen_sites)

    # Cross-Regeln und logische Cross-I/O ergaenzen — Node-Shards haben Vorrang,
    # weil sie die physikalisch vollstaendigen Zeilen fuehren.
    for source, row in cross_rules_to_v9(cross_shards, report):
        buckets.setdefault("rules", []).append((source, row))
    for section in ("sensors", "actuators"):
        for source, row in cross_io_rows(cross_shards, section, site_id, assign):
            buckets.setdefault(section, []).append(
                (source, normalize_row(section, row, site_id, seen_sites)))

    master = {}
    for section in TOP_LEVEL_ORDER:
        master[section] = merge_section(section, buckets.get(section, []), report)

    if seen_sites - {site_id}:
        note(report, "normalized", "sites",
             "site_id vereinheitlicht auf '%s' (vorgefunden: %s)."
             % (site_id, ", ".join(sorted(seen_sites))))

    # --- Controller, die nur im Cross-Shard leben, nachziehen ---------------
    known_uuids = {text(row.get("controller_uuid")) for row in master["controllers"]}
    stubs = controller_stubs_from_cross(cross_shards, known_uuids, site_id, report, assign)
    for stub in stubs:
        master["controllers"].append(provision_physical_defaults(stub, master, report))

    # --- Topologie fuer neu hinzugekommene Controller schliessen ------------
    for stub in stubs:
        node_id = text(stub.get("node_id"))
        local_id = stub.get("local_controller_id") \
            or next_local_controller_id(master["site_controller_map"], node_id)
        stub["local_controller_id"] = local_id
        if not any(text(row.get("controller_uuid")) == text(stub.get("controller_uuid"))
                   for row in master["site_controller_map"]):
            master["site_controller_map"].append({
                "local_controller_id": local_id,
                "node_id": node_id,
                "site_id": site_id,
                "controller_uuid": text(stub.get("controller_uuid")),
                "controller_key": text(stub.get("controller_key")),
                "route_key": route_key_for(site_id, node_id, local_id),
                "routing_role": "owner",
                "enabled": bool(stub.get("enabled", True)),
            })

    # --- Routing anlagenweit konsistent machen ------------------------------
    reconcile_routing(master, site_id, report)

    # --- I/O aus Cross-Shards physikalisch vervollstaendigen ----------------
    for section in ("sensors", "actuators"):
        provision_io_defaults(master, section, report)

    # --- meta / sites / local_node fuer den Master neu setzen ---------------
    master["meta"] = [{
        "version": CANONICAL_VERSION,
        "schema": CANONICAL_SCHEMA,
        "scope": CANONICAL_SCOPE,
        "description": description or (
            "Master-Global-Contract, zusammengefuehrt aus den Feld-Shards "
            "(_tools/merge_shards_to_master.py)."),
    }]
    if not master["sites"]:
        master["sites"] = [{"site_id": site_id, "site_name": "Main Site",
                            "enabled": True, "description": "Primaere Automatisierungs-Site"}]

    master["local_node"] = sort_rows(master["local_node"], ("node_id",))
    master["controllers"] = sort_rows(master["controllers"], ("controller_id",))
    master["site_controller_map"] = sort_rows(master["site_controller_map"],
                                              ("node_id", "local_controller_id"))
    master["sensors"] = sort_rows(master["sensors"],
                                  ("node_id", "local_controller_id", "sensor_id"))
    master["actuators"] = sort_rows(master["actuators"],
                                    ("node_id", "local_controller_id", "actuator_id"))
    for section, fields in (("processes", ("p_id",)), ("process_states", ("state_id",)),
                            ("rules", ("rule_id",)), ("filters", ("filter_id",)),
                            ("timers", ("timer_id",)), ("nodes", ("node_id",))):
        master[section] = sort_rows(master[section], fields)

    report["stats"] = {section: len(master[section]) for section in TOP_LEVEL_ORDER}
    return master, report


# Sektionen, die ein Cross-Shard nur unvollstaendig fuehrt und die deshalb
# NICHT ueber den generischen Merge laufen duerfen — sie werden gesondert
# behandelt (Controller-Stubs, logische I/O, Regeln mit Execution-Metadaten).
CROSS_SPECIAL_SECTIONS = frozenset((
    "meta", "local_node", "controllers", "virtual_controllers",
    "sensors", "actuators", "site_controller_map", "nodes", "rules",
))


def cross_domain_of(config):
    meta = (rows(config, "meta") or [{}])[0]
    owner = text(meta.get("owner_node_id"))
    domain = text(meta.get("domain_id")) or ("cross-%s-default" % owner if owner else "cross")
    return owner, domain


def cross_domain_for(owner_node_id):
    """Kanonische Cross-Domain eines Owners: `<owner>.default`.

    Schreibweise aus `config_sharding_contracts.py` der Control-Plane
    (`_graph_migrate_legacy_config`) — dort wird bei `active_cross` genau
    `cross_domain_id = "<owner>.default"` gesetzt.
    """
    return "%s.default" % owner_node_id


def execution_scope_for(scope, node_id, owner_node_id=""):
    """Einheitliche `execution_scope`-Schreibweise.

    Verbindlich laut Control-Plane (config_sharding_contracts.py):

        active_node  -> "node:<owner>"
        active_cross -> "cross:<owner>.default"

    Die Ableitung ist rein funktional aus (Scope, Owner) — damit ist der
    Rundlauf master -> Shards -> master verlustfrei: `build_shards.py` streicht
    das Feld im V8-Vertrag, der Merge stellt es bitgleich wieder her.
    """
    if scope in ("cross", "cross_controller", "cross_worker"):
        return "cross:%s" % cross_domain_for(owner_node_id or node_id)
    return "node:%s" % node_id


def cross_shards_as_catalogs(cross_shards):
    """Nur die node-freien Katalogsektionen eines Cross-Shards.

    Prozesse und Prozesszustaende kommen mit — sie sind im Cross-Shard
    vollstaendig und tragen bereits ihren `owner_node_id`. Alles mit
    Physikbezug bleibt draussen, damit ein Cross-Shard den Master nicht mit
    unvollstaendigen Zeilen ueberschreibt.
    """
    result = []
    for source, config in cross_shards:
        reduced = {section: value for section, value in config.items()
                   if section not in CROSS_SPECIAL_SECTIONS}
        result.append((source + " (Katalog)", reduced))
    return result


def cross_rules_to_v9(cross_shards, report):
    """Stellt an Cross-Regeln die im V8-Vertrag gestrichenen V9-Felder wieder her."""
    restored = []
    for source, config in cross_shards:
        owner, domain = cross_domain_of(config)
        scope = text((rows(config, "meta") or [{}])[0].get("scope")) or "cross"
        for rule in rows(config, "rules"):
            row = dict(rule)
            row["owner_node_id"] = text(row.get("owner_node_id")) or owner
            row["execution_owner"] = row["owner_node_id"]
            row["execution_scope"] = execution_scope_for(scope, row["owner_node_id"],
                                                         row["owner_node_id"])
            row["cross_domain_id"] = cross_domain_for(row["owner_node_id"])
            row.setdefault("execution_epoch", 1)
            row.setdefault("deployment_status", "active_cross")
            row.setdefault("activation_state", "active")
            restored.append((source, row))
            note(report, "restored", "rules",
                 "Regel %s aus %s: Execution-Metadaten wiederhergestellt (%s)."
                 % (row.get("rule_id"), source, row["execution_scope"]))
    return restored


def cross_io_rows(cross_shards, section, site_id, assign=None):
    """Logische I/O-Zeilen eines Cross-Shards (ohne Physik).

    Der V8-Vertrag verbietet `site_id` in Cross-Shards. Im Master ist sie fuer
    das Routing (site_id, node_id, local_controller_id) aber Pflicht — sie wird
    hier aus der kanonischen Site des Merges nachgetragen.
    """
    result = []
    for source, config in cross_shards:
        owner, _ = cross_domain_of(config)
        for row in rows(config, section):
            row = dict(row)
            controller_key = text(row.get("controller_key"))
            operating = text((assign or {}).get(controller_key)) \
                or text((assign or {}).get(text(row.get("controller_uuid"))))
            row["node_id"] = operating or text(row.get("node_id")) or owner
            row["site_id"] = site_id
            result.append((source, row))
    return result


def sort_rows(items, fields):
    def sort_key(row):
        values = []
        for field in fields:
            value = row.get(field)
            if isinstance(value, bool):
                values.append((0, float(value), ""))
            elif isinstance(value, (int, float)):
                values.append((0, float(value), ""))
            else:
                values.append((1, 0.0, text(value)))
        return tuple(values)
    return sorted(items, key=sort_key)


# =============================================================================
# PRUEFUNG
# =============================================================================


def verify_master(master):
    """Strukturprüfung ohne Runtime — liefert eine Liste von Befunden."""
    findings = []
    if len(master) != len(TOP_LEVEL_ORDER):
        findings.append("Sektionsanzahl %d statt %d" % (len(master), len(TOP_LEVEL_ORDER)))

    node_ids = {text(row.get("node_id")) for row in rows(master, "nodes")}
    site_ids = {text(row.get("site_id")) for row in rows(master, "sites")}

    for row in rows(master, "site_controller_map"):
        if text(row.get("node_id")) not in node_ids:
            findings.append("Route zeigt auf unbekannten node '%s'" % row.get("node_id"))
        if text(row.get("site_id")) not in site_ids:
            findings.append("Route zeigt auf unbekannte site '%s'" % row.get("site_id"))

    routed = {text(row.get("controller_uuid")) for row in rows(master, "site_controller_map")}
    for row in rows(master, "controllers"):
        controller_uuid = text(row.get("controller_uuid"))
        if controller_uuid not in routed:
            findings.append("Controller %s hat keine Route" % controller_uuid)

    known = {text(row.get("controller_uuid")) for row in rows(master, "controllers")}
    for section in ("sensors", "actuators"):
        for row in rows(master, section):
            if text(row.get("controller_uuid")) not in known:
                findings.append("%s verweist auf unbekannten Controller %s"
                                % (section, row.get("controller_uuid")))

    for section, field in (("controllers", "controller_id"), ("processes", "p_id"),
                           ("process_states", "state_id"), ("rules", "rule_id"),
                           ("filters", "filter_id"), ("timers", "timer_id")):
        seen = {}
        for row in rows(master, section):
            value = row.get(field)
            if value in seen:
                findings.append("%s: %s %s doppelt" % (section, field, value))
            seen[value] = True
    return findings


def verify_with_runtime(master):
    try:
        from src.library._generic_type_library import (  # noqa: PLC0415
            verify_storage_config_data, config_fingerprint)
    except Exception:  # noqa: BLE001
        return {"available": False}
    try:
        report = verify_storage_config_data(master)
        return {"available": True, "status": report.get("status"),
                "errors": report.get("errors") or [],
                "warnings": report.get("warnings") or [],
                "fingerprint": config_fingerprint(master)}
    except Exception as exc:  # noqa: BLE001
        return {"available": True, "status": "FAILED", "errors": [str(exc)]}


# =============================================================================
# CLI
# =============================================================================


def load_shard(path):
    return (Path(path).name, json.loads(Path(path).read_text(encoding="utf-8")))


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Fuehrt V9-Node-Shards zu einer master_global-Config zusammen.")
    parser.add_argument("shards", nargs="+", help="V9-Node-Shards")
    parser.add_argument("--cross", action="append", default=[],
                        help="V8-Cross-Shard (mehrfach moeglich)")
    parser.add_argument("--site-id", default="site_main")
    parser.add_argument("--out", default="-")
    parser.add_argument("--report", default=None)
    parser.add_argument("--description", default="")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--assign", action="append", default=[],
                        help="Betriebs-Node fuer einen Cross-Controller festlegen, "
                             "z. B. --assign ctrl_wago_3=fn-02 (mehrfach moeglich)")
    args = parser.parse_args(argv)

    assign = {}
    for item in args.assign:
        if "=" not in item:
            print("--assign erwartet <controller_key>=<node_id>: %s" % item, file=sys.stderr)
            return 2
        key, node_id = item.split("=", 1)
        assign[key.strip()] = node_id.strip()

    node_shards = [load_shard(path) for path in args.shards]
    cross_shards = [load_shard(path) for path in args.cross]

    master, report = merge_shards(node_shards, cross_shards, args.site_id,
                                  args.description, assign)

    findings = verify_master(master)
    report["structure_findings"] = findings
    if args.verify:
        report["runtime"] = verify_with_runtime(master)

    payload = format_config(master)
    if args.out == "-":
        sys.stdout.write(payload)
    else:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload, encoding="utf-8", newline="\n")
        print("Master geschrieben: %s" % out)

    if args.report:
        Path(args.report).write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    if args.out != "-":
        print("Sektionen: %d | Controller: %d | Sensoren: %d | Aktoren: %d | "
              "States: %d | Regeln: %d"
              % (len(master), len(master["controllers"]), len(master["sensors"]),
                 len(master["actuators"]), len(master["process_states"]),
                 len(master["rules"])))
        for kind in ("normalized", "provisioned", "merges", "conflicts"):
            for item in report.get(kind, []):
                print("  %-12s %-22s %s" % (kind, item["section"], item["message"]))
        if findings:
            print("  STRUKTURBEFUNDE:")
            for item in findings:
                print("    - %s" % item)
        runtime = report.get("runtime") or {}
        if runtime.get("available"):
            print("  Runtime-Type-Authority: %s | Fingerprint %s"
                  % (runtime.get("status"), text(runtime.get("fingerprint"))[:16]))
            for item in (runtime.get("errors") or [])[:10]:
                print("    E %s" % item)

    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
