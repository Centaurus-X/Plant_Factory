#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sinnvolle Vorbelegung fuer unvollstaendig ueberlieferte Entitaeten.

Problemstellung
---------------
An zwei Stellen entstehen Zeilen, denen Pflichtfelder fehlen:

    1. Migration V50 -> V9: die Alt-Config verweist auf Controller- und
       Prozess-IDs, zu denen es keinen Datensatz gibt. Frueher entstanden
       daraus Platzhalter mit `host = "0.0.0.0"` und Namen wie
       `unconfigured_process_6` — formal gueltig, praktisch unbrauchbar.
    2. Merge Cross-Shard -> Master: ein V8-Cross-Shard fuehrt vertragsgemaess
       KEINE Physik. Im Master sind Adresse, Bus und Host aber Pflicht.

Loesung
-------
Statt fester Platzhalter werden die Werte aus dem ANLAGENKONTEXT abgeleitet:
Bustyp, Port, Unit und Funktionstyp per Mehrheit der vorhandenen Geschwister,
die IP-Adresse aus dem Adressmuster der Anlage, die Feldbusadresse als naechste
freie Adresse auf demselben Controller. Das Ergebnis ist eine Zeile, die sofort
plausibel dasteht, sich in die Anlage einfuegt — und trotzdem ueber ihre
`description` und ihre Tags als provisioniert erkennbar bleibt.

Der Zusatz `PROVISION_TAG` in `tags` ist die maschinenlesbare Markierung:
Der Editor faerbt solche Zeilen ein, der Rollout kann sie blockieren.

Designvorgaben: rein funktional, kein OOP, keine Decorators/Dataclasses,
`functools.partial` statt Lambda.
"""

from __future__ import annotations

import json
from functools import partial

PROVISION_TAG = "provisioned"

# Nicht routbarer Platzhalter-Host aus V52/V53. Er zaehlt hier als LEER -
# sonst bliebe ein Controller fuer immer auf einer Adresse stehen, die nie
# antwortet, nur weil das Feld formal belegt ist.
UNCONFIGURED_HOSTS = frozenset(("0.0.0.0", "", "0"))

# Letztes Oktett = HOST_OCTET_BASE + controller_id. Reproduziert die
# Adressvergabe der Bestandsflotte (wago_1 -> .51, wago_4 -> .54, wago_5 -> .55).
HOST_OCTET_BASE = 50

CONTROLLER_FALLBACK = {
    "bus_type": "modbus",
    "host": "192.168.0.1",
    "port": 502,
    "unit": "0x1",
}

IO_ADDRESS_BASE = {"sensors": 1, "actuators": 512}
IO_FUNCTION_FALLBACK = {"sensors": "read_holding_registers",
                        "actuators": "write_register"}

# Prozessnamen nach fachlichem Muster statt "unconfigured_process_N".
PROCESS_NAME_PREFIX = "reserved_process"

PROVISION_NOTE_CONTROLLER = (
    "Automatisch provisioniert aus dem Anlagenkontext — Endpunkt vor "
    "Inbetriebnahme pruefen.")
PROVISION_NOTE_IO = (
    "Automatisch provisioniert aus dem Anlagenkontext — Feldbusadresse vor "
    "Inbetriebnahme pruefen.")
PROVISION_NOTE_PROCESS = (
    "Reservierter Prozessplatz: wird von Prozesszustaenden referenziert, hatte "
    "in der Altkonfiguration aber keinen eigenen Datensatz.")


# =============================================================================
# GENERISCHE HELFER
# =============================================================================


def is_blank(value):
    return value in (None, "", [], {})


def text(value):
    return "" if value is None else str(value).strip()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _count_of(counts, marker):
    return counts[marker][0]


def majority_value(values, fallback):
    """Haeufigster Wert einer Liste; bei Gleichstand der zuerst gesehene."""
    counts = {}
    order = []
    for value in values:
        if is_blank(value):
            continue
        marker = canonical(value)
        if marker not in counts:
            counts[marker] = [0, value]
            order.append(marker)
        counts[marker][0] += 1
    if not order:
        return fallback
    return counts[max(order, key=partial(_count_of, counts))][1]


def numeric_values(items, field):
    result = []
    for row in items:
        value = row.get(field)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            result.append(value)
        elif isinstance(value, str) and value.strip().lstrip("-").isdigit():
            result.append(int(value.strip()))
    return result


def add_tag(row, tag):
    tags = row.get("tags")
    if not isinstance(tags, list):
        tags = []
    if tag not in tags:
        tags = tags + [tag]
    row["tags"] = tags
    return row


# =============================================================================
# CONTROLLER
# =============================================================================


def derive_host(siblings, controller_id, taken):
    """Freie IP aus dem Adressmuster der Geschwistercontroller."""
    prefixes = []
    for row in siblings:
        host = text(row.get("host"))
        if host.count(".") == 3 and host not in UNCONFIGURED_HOSTS \
                and host != CONTROLLER_FALLBACK["host"]:
            prefixes.append(host.rsplit(".", 1)[0])
    prefix = majority_value(prefixes, CONTROLLER_FALLBACK["host"].rsplit(".", 1)[0])
    try:
        octet = HOST_OCTET_BASE + int(controller_id)
    except (TypeError, ValueError):
        octet = HOST_OCTET_BASE + 1
    octet = min(max(octet, 2), 254)
    while "%s.%d" % (prefix, octet) in taken and octet < 254:
        octet += 1
    return "%s.%d" % (prefix, octet)


def provision_controller(row, siblings, note=None):
    """Ergaenzt fehlende Endpunktfelder eines Controllers. Liefert die Feldliste."""
    usable = [item for item in siblings if not is_blank(item.get("host"))]
    taken = {text(item.get("host")) for item in siblings}
    filled = []
    for field in ("bus_type", "host", "port", "unit"):
        placeholder = field == "host" and text(row.get(field)) in UNCONFIGURED_HOSTS
        if not is_blank(row.get(field)) and not placeholder:
            continue
        if field == "host":
            row[field] = derive_host(usable, row.get("controller_id"), taken)
        else:
            row[field] = majority_value([item.get(field) for item in usable],
                                        CONTROLLER_FALLBACK[field])
        filled.append("%s=%s" % (field, canonical(row[field])))
    if filled:
        row.setdefault("enabled", True)
        if is_blank(row.get("description")):
            row["description"] = note or PROVISION_NOTE_CONTROLLER
        add_tag(row, PROVISION_TAG)
    return filled


# =============================================================================
# SENSOREN / AKTOREN
# =============================================================================


def next_free_address(section, all_rows, controller_uuid):
    """Naechste freie Adresse — erst auf dem Controller, dann anlagenweit."""
    used = set(numeric_values(all_rows, "address"))
    same = [row for row in all_rows
            if text(row.get("controller_uuid")) == text(controller_uuid)]
    candidates = numeric_values(same, "address") or numeric_values(all_rows, "address")
    address = (max(candidates) + 1) if candidates else IO_ADDRESS_BASE.get(section, 1)
    while address in used:
        address += 1
    return address


def provision_io(section, row, all_rows, note=None):
    """Ergaenzt fehlende Feldbus-Koordinaten einer I/O-Zeile."""
    peers = [item for item in all_rows if item is not row and not is_blank(item.get("bus_type"))]
    filled = []
    for field in ("address", "bus_type", "function_type"):
        if not is_blank(row.get(field)):
            continue
        if field == "address":
            row[field] = next_free_address(section, all_rows, row.get("controller_uuid"))
        elif field == "bus_type":
            row[field] = majority_value([item.get("bus_type") for item in peers],
                                        CONTROLLER_FALLBACK["bus_type"])
        else:
            row[field] = majority_value([item.get("function_type") for item in peers],
                                        IO_FUNCTION_FALLBACK.get(section,
                                                                 "read_holding_registers"))
        filled.append("%s=%s" % (field, canonical(row[field])))
    if filled:
        row.setdefault("enabled", True)
        if is_blank(row.get("description")):
            row["description"] = note or PROVISION_NOTE_IO
    return filled


# =============================================================================
# PROZESSE
# =============================================================================


def provision_process(row, siblings, note=None):
    """Gibt einem reservierten Prozessplatz einen sprechenden Namen und Ort."""
    filled = []
    if is_blank(row.get("process_name")) or text(row.get("process_name")).startswith(
            "unconfigured_process"):
        row["process_name"] = "%s_%s" % (PROCESS_NAME_PREFIX, row.get("p_id"))
        filled.append("process_name=%s" % canonical(row["process_name"]))
    if is_blank(row.get("process_location")):
        row["process_location"] = majority_value(
            [item.get("process_location") for item in siblings], "Main Reactor")
        filled.append("process_location=%s" % canonical(row["process_location"]))
    if is_blank(row.get("enabled")):
        row["enabled"] = False
        filled.append("enabled=false")
    if filled and is_blank(row.get("description")):
        row["description"] = note or PROVISION_NOTE_PROCESS
    return filled
