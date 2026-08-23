#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Konfigurations-Snapshots im SVG: einbetten, pruefen, wiederherstellen.

Der Gedanke
-----------
Anlagenbild und Automatisierungsvertrag waren bisher getrennte Artefakte. Wer
aus dem Bild die Config zurueckrechnen wollte, stand vor einer Frage, die
niemand beantworten kann: welche Seite gewinnt, wenn beide dieselbe Entitaet
beschreiben?

Der Snapshot dreht das um. Statt zu REKONSTRUIEREN, legt der Export die Config
WOERTLICH ins SVG. Damit gibt es keine zweite Wahrheit, nur eine Kopie — und
die Wiederherstellung ist byte-genau, mit unveraendertem Fingerprint.

Der Replikationsfall
--------------------
Ein Snapshot altert. Genau deshalb blockiert dieses Werkzeug NIE: es ordnet den
Snapshot gegenueber dem laufenden Stand ein und ueberlaesst die Entscheidung
dem Betreiber. Fuenf Lagen:

    identical   Fingerprints gleich — nichts zu tun
    stale       Snapshot ist aelter als der laufende Stand
    ahead       Snapshot ist NEUER (Rueckfall nach einem Ausfall)
    unrelated   anderer Node oder Scope — kein sinnvoller Bezug
    no_head     es gibt keinen laufenden Stand; der Snapshot ist alles

Nur `unrelated` verweigert die Wiederherstellung ohne `--force`. Alles andere
ist eine informierte Entscheidung, keine Fehlerlage.

Aufrufe
-------
    # Was steckt drin?
    python3 _tools/config_snapshot.py inspect anlage.svg

    # Config herausholen (byte-genau)
    python3 _tools/config_snapshot.py extract anlage.svg --out restored.json

    # Gegen den laufenden Stand halten
    python3 _tools/config_snapshot.py compare anlage.svg \\
        --head config/device_state_data_v9.json

    # Wiederherstellen — auch wenn keine Worker-Config mehr da ist
    python3 _tools/config_snapshot.py restore anlage.svg \\
        --out config/device_state_data_v9.json --verify

    # Snapshot in ein vorhandenes SVG legen (serverseitig / im Build)
    python3 _tools/config_snapshot.py embed anlage.svg \\
        --config config/device_state_data_v9.json \\
        --config config/shards/device_state_data_v9_node_fn-01.json

Designvorgaben: rein funktional, kein OOP, keine Decorators/Dataclasses,
`functools.partial` statt Lambda.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SNAPSHOT_VERSION = 1
SNAPSHOT_KIND = "plant_factory_config_snapshot"
SNAPSHOT_NAMESPACE = "urn:plantfactory:snapshot:1"
SNAPSHOT_TAG = "plantfactory:snapshot"

ROLE_MASTER = "master_global"
ROLE_NODE = "node_local"
ROLE_CROSS = "cross"


# =============================================================================
# GRUNDLAGEN
# =============================================================================


def text(value):
    return "" if value is None else str(value).strip()


def sha256_hex(payload):
    if isinstance(payload, bytes):
        return hashlib.sha256(payload).hexdigest()
    return hashlib.sha256(str(payload).encode("utf-8")).hexdigest()


def canonical_json(value):
    """Kanonische Bytes wie `_generic_type_library.canonical_bytes`."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def fingerprint_of(config):
    """Fingerprint nach der Regel der Runtime.

    Python unterscheidet int und float nativ, der Wert stimmt daher mit dem der
    Runtime ueberein — anders als eine Berechnung im Browser, wo `1000.0` beim
    Parsen zu `1000` wird.
    """
    return sha256_hex(canonical_json(config))


def meta_of(config):
    meta = config.get("meta") if isinstance(config, dict) else None
    if isinstance(meta, list):
        return meta[0] if meta else {}
    return meta if isinstance(meta, dict) else {}


def role_of(meta):
    scope = text(meta.get("scope"))
    if scope.startswith("cross"):
        return ROLE_CROSS
    if scope == "master_global":
        return ROLE_MASTER
    return ROLE_NODE


def section_counts(config):
    return {name: len(rows) for name, rows in (config or {}).items()
            if isinstance(rows, list)}


# =============================================================================
# SNAPSHOT BAUEN
# =============================================================================


def describe_config(payload, source="", fingerprint="", authority=None, role=""):
    """Beschreibt EINEN Konfigurationsstand. `payload` ist der Dateitext."""
    body = str(payload)
    try:
        config = json.loads(body)
    except ValueError as exc:
        raise ValueError("Konfigurationstext ist kein gueltiges JSON: %s" % exc)
    meta = meta_of(config)

    entry = {
        "role": role or role_of(meta),
        "scope": text(meta.get("scope")),
        "version": meta.get("version"),
        "node_id": text(meta.get("node_id")),
        "owner_node_id": text(meta.get("owner_node_id")),
        "domain_id": text(meta.get("domain_id")),
        "source": text(source),
        "section_counts": section_counts(config),
        "fingerprint": text(fingerprint) or fingerprint_of(config),
        "fingerprint_source": "server" if text(fingerprint) else "local",
        "text_sha256": sha256_hex(body),
        "text_bytes": len(body),
        "text": body,
    }
    # Die Authority-Baseline entscheidet spaeter ueber "veraltet" oder "neuer".
    # Sie kommt entweder vom Server (Head-Abfrage) oder — als Rueckfall — aus
    # der meta-Zeile der Config selbst. Ohne sie bliebe nur der Fingerprint,
    # und der sagt nur DASS etwas anders ist, nicht in welche Richtung.
    source_authority = authority if isinstance(authority, dict) else {}
    entry["authority"] = {
        "authority_epoch": first_number(source_authority.get("authority_epoch"),
                                        meta.get("authority_epoch")),
        "scope_revision": first_number(source_authority.get("scope_revision"),
                                       meta.get("scope_revision")),
        "execution_epoch": first_number(source_authority.get("execution_epoch"),
                                        meta.get("execution_epoch")),
        "source": "server" if isinstance(authority, dict) and authority else "meta",
    }
    return entry


def first_number(*values):
    """Erster Wert, der eine echte Ganzzahl ist (bool zaehlt nicht)."""
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip().lstrip("-").isdigit():
            return int(value.strip())
    return None


def build_snapshot(entries, project="", captured_at="", notes="",
                   producer="Automated_SVG_Integration"):
    configs = [item for item in entries if item]
    snapshot = {
        "snapshot_version": SNAPSHOT_VERSION,
        "kind": SNAPSHOT_KIND,
        "captured_at": captured_at or datetime.now(timezone.utc)
        .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "producer": producer,
        "project": text(project),
        "notes": text(notes),
        "configs": configs,
    }
    snapshot["payload_sha256"] = sha256_hex(canonical_json(configs))
    return snapshot


# =============================================================================
# EINBETTEN UND LESEN
# =============================================================================


def unescape_xml(payload):
    """XML-Entities aufloesen — fuer den Fall ohne CDATA."""
    out = str(payload)
    for entity, char in (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'),
                         ("&apos;", "'"), ("&#39;", "'"), ("&amp;", "&")):
        out = out.replace(entity, char)
    return out


def cdata_safe(payload):
    """`]]>` darf in einem CDATA-Abschnitt nicht vorkommen."""
    return str(payload).replace("]]>", "]]]]><![CDATA[>")


def snapshot_element(snapshot):
    body = json.dumps(snapshot, indent=2, ensure_ascii=False)
    return (
        '<%s xmlns:plantfactory="%s" version="%d" captured-at="%s" configs="%d">'
        "<![CDATA[\n%s\n]]></%s>"
        % (SNAPSHOT_TAG, SNAPSHOT_NAMESPACE, SNAPSHOT_VERSION,
           snapshot.get("captured_at", ""), len(snapshot.get("configs") or []),
           cdata_safe(body), SNAPSHOT_TAG)
    )


def strip_snapshot(svg_text):
    """Entfernt einen vorhandenen Snapshot. Zwei waeren eine Einladung zum Irrtum."""
    body = str(svg_text)
    start = body.find("<" + SNAPSHOT_TAG)
    if start < 0:
        return body
    end = body.find("</" + SNAPSHOT_TAG + ">", start)
    if end < 0:
        return body
    return body[:start] + body[end + len(SNAPSHOT_TAG) + 3:]


def embed_snapshot(svg_text, snapshot):
    """Legt den Snapshot in `<metadata>` ab; erzeugt den Block bei Bedarf."""
    body = strip_snapshot(svg_text)
    element = snapshot_element(snapshot)

    close = body.find("</metadata>")
    if close >= 0:
        return body[:close] + element + body[close:]

    empty = body.find("<metadata/>")
    if empty >= 0:
        return body[:empty] + "<metadata>" + element + "</metadata>" \
            + body[empty + len("<metadata/>"):]

    # Kein metadata-Block: direkt hinter dem oeffnenden <svg ...> einfuegen.
    open_tag = body.find("<svg")
    if open_tag < 0:
        raise ValueError("Kein <svg>-Wurzelelement gefunden.")
    close_bracket = body.find(">", open_tag)
    if close_bracket < 0:
        raise ValueError("Das <svg>-Element ist unvollstaendig.")
    return (body[:close_bracket + 1] + "<metadata>" + element + "</metadata>"
            + body[close_bracket + 1:])


def extract_snapshot(svg_text):
    """Holt den Snapshot per Textschnitt.

    Bewusst ohne XML-Parser: die Wiederherstellung muss auch dann gelingen, wenn
    das SVG an anderer Stelle beschaedigt ist. Ein Parser gibt dann auf, ein
    Textschnitt zwischen bekannten Marken nicht.
    """
    body = str(svg_text)
    start = body.find("<" + SNAPSHOT_TAG)
    if start < 0:
        return None
    content = body.find(">", start)
    if content < 0:
        return None
    end = body.find("</" + SNAPSHOT_TAG + ">", content)
    if end < 0:
        return None
    payload = body[content + 1:end]
    had_cdata = "<![CDATA[" in payload
    payload = payload.replace("<![CDATA[", "").replace("]]>", "").strip()
    # Ohne CDATA hat der Serializer die Sonderzeichen maskiert. Der Browser
    # nimmt diesen Weg immer, wenn das SVG in einer HTML-Seite lebt.
    if not had_cdata:
        payload = unescape_xml(payload)
    if not payload:
        return None
    try:
        return json.loads(payload)
    except ValueError as exc:
        raise ValueError("Snapshot im SVG ist beschaedigt: %s" % exc)


# =============================================================================
# PRUEFEN
# =============================================================================


def verify_snapshot(snapshot):
    report = {"ok": True, "errors": [], "warnings": [], "configs": []}
    if not isinstance(snapshot, dict):
        report["ok"] = False
        report["errors"].append("Kein Snapshot vorhanden.")
        return report
    if snapshot.get("kind") != SNAPSHOT_KIND:
        report["ok"] = False
        report["errors"].append("Unbekannte Snapshot-Art: %s" % snapshot.get("kind"))
    if int(snapshot.get("snapshot_version") or 0) > SNAPSHOT_VERSION:
        report["warnings"].append(
            "Snapshot-Version %s ist neuer als diese Fassung (%d)."
            % (snapshot.get("snapshot_version"), SNAPSHOT_VERSION))

    configs = snapshot.get("configs") or []
    if not configs:
        report["ok"] = False
        report["errors"].append("Der Snapshot enthaelt keine Konfiguration.")
        return report

    expected = sha256_hex(canonical_json(configs))
    if snapshot.get("payload_sha256") and snapshot["payload_sha256"] != expected:
        report["ok"] = False
        report["errors"].append(
            "Die Nutzlast wurde nach dem Erzeugen veraendert (payload_sha256).")

    for index, entry in enumerate(configs):
        where = "configs[%d]" % index
        item = {"index": index, "role": entry.get("role"), "scope": entry.get("scope"),
                "node_id": entry.get("node_id"),
                "owner_node_id": entry.get("owner_node_id"),
                "fingerprint": entry.get("fingerprint"), "ok": True}
        payload = entry.get("text")
        if not isinstance(payload, str) or not payload:
            report["ok"] = False
            item["ok"] = False
            report["errors"].append("%s: kein Konfigurationstext." % where)
            report["configs"].append(item)
            continue
        if entry.get("text_sha256") and entry["text_sha256"] != sha256_hex(payload):
            report["ok"] = False
            item["ok"] = False
            report["errors"].append("%s: der Text wurde veraendert (text_sha256)." % where)
        try:
            item["config"] = json.loads(payload)
        except ValueError as exc:
            report["ok"] = False
            item["ok"] = False
            report["errors"].append("%s: Text ist kein gueltiges JSON — %s" % (where, exc))
        else:
            recomputed = fingerprint_of(item["config"])
            item["fingerprint_recomputed"] = recomputed
            if entry.get("fingerprint") and entry["fingerprint"] != recomputed:
                # Kein Fehler: ein im Browser gebildeter Fingerprint kann bei
                # Gleitkomma-Literalen abweichen. Der Text bleibt unversehrt.
                report["warnings"].append(
                    "%s: hinterlegter Fingerprint %s, nachgerechnet %s — "
                    "typisch fuer einen im Browser gebildeten Wert."
                    % (where, entry["fingerprint"][:16], recomputed[:16]))
        report["configs"].append(item)
    return report


# =============================================================================
# VERGLEICH UND REPLIKATION
# =============================================================================


def compare_with_head(entry, head):
    """Ordnet einen Snapshot-Eintrag gegenueber dem laufenden Stand ein."""
    result = {"state": "no_head", "snapshot_fingerprint": entry.get("fingerprint", ""),
              "head_fingerprint": "", "differences": [], "replicable": True, "reason": ""}
    if not isinstance(head, dict):
        result["reason"] = ("Kein laufender Stand vorhanden — der Snapshot ist die "
                            "einzige Quelle und kann unveraendert eingespielt werden.")
        return result

    snapshot_config = json.loads(entry["text"])
    snapshot_meta = meta_of(snapshot_config)
    head_meta = meta_of(head)
    result["head_fingerprint"] = fingerprint_of(head)
    result["snapshot_fingerprint"] = fingerprint_of(snapshot_config)

    same_scope = text(snapshot_meta.get("scope")) == text(head_meta.get("scope"))
    snapshot_node = text(snapshot_meta.get("node_id")) \
        or text(snapshot_meta.get("owner_node_id"))
    head_node = text(head_meta.get("node_id")) or text(head_meta.get("owner_node_id"))
    if not same_scope or snapshot_node != head_node:
        result["state"] = "unrelated"
        result["replicable"] = False
        result["reason"] = (
            "Snapshot und laufender Stand beschreiben verschiedene Geltungsbereiche "
            "(%s/%s gegen %s/%s)." % (snapshot_meta.get("scope"), snapshot_node or "-",
                                      head_meta.get("scope"), head_node or "-"))
        return result

    if result["snapshot_fingerprint"] == result["head_fingerprint"]:
        result["state"] = "identical"
        result["reason"] = "Snapshot und laufender Stand sind identisch."
        return result

    result["differences"] = diff_sections(snapshot_config, head)

    snapshot_revision = first_number((entry.get("authority") or {}).get("scope_revision"),
                                     snapshot_meta.get("scope_revision"))
    head_revision = first_number(head_meta.get("scope_revision"))
    if isinstance(snapshot_revision, int) and isinstance(head_revision, int):
        if snapshot_revision < head_revision:
            result["state"] = "stale"
        elif snapshot_revision > head_revision:
            result["state"] = "ahead"
        else:
            result["state"] = "stale"
        result["reason"] = "scope_revision %s gegen %s." % (snapshot_revision, head_revision)
    else:
        result["state"] = "stale"
        result["reason"] = ("Ohne scope_revision laesst sich das Alter nicht bestimmen — "
                            "die Fingerprints unterscheiden sich, der Snapshot wird als "
                            "aelter behandelt.")
    return result


def diff_sections(left, right):
    """Sektionsweiser Unterschied — grob genug fuer eine Entscheidung."""
    out = []
    for section in sorted(set(left or {}) | set(right or {})):
        a = (left or {}).get(section)
        b = (right or {}).get(section)
        if not isinstance(a, list) and not isinstance(b, list):
            continue
        if canonical_json(a) == canonical_json(b):
            continue
        out.append({"section": section,
                    "snapshot_rows": len(a) if isinstance(a, list) else None,
                    "head_rows": len(b) if isinstance(b, list) else None})
    return out


def pick_config(snapshot, target=""):
    configs = (snapshot or {}).get("configs") or []
    if not configs:
        return None
    wanted = text(target)
    if wanted:
        for entry in configs:
            if wanted in (text(entry.get("node_id")), text(entry.get("owner_node_id")),
                          text(entry.get("role")), text(entry.get("scope"))):
                return entry
        return None
    for entry in configs:
        if entry.get("role") == ROLE_MASTER:
            return entry
    return configs[0]


def verify_with_runtime(config):
    try:
        from src.library._generic_type_library import (  # noqa: PLC0415
            verify_storage_config_data, config_fingerprint)
    except Exception:  # noqa: BLE001
        return {"available": False}
    try:
        report = verify_storage_config_data(config)
        return {"available": True, "status": report.get("status"),
                "errors": report.get("errors") or [],
                "fingerprint": config_fingerprint(config)}
    except Exception as exc:  # noqa: BLE001
        return {"available": True, "status": "FAILED", "errors": [str(exc)]}


# =============================================================================
# CLI
# =============================================================================


def load_text(path):
    return Path(path).read_text(encoding="utf-8")


def print_entry(entry, prefix="  "):
    print("%s%-13s scope=%-13s node=%-8s owner=%-8s %6d B  fp=%s (%s)"
          % (prefix, entry.get("role"), entry.get("scope") or "-",
             entry.get("node_id") or "-", entry.get("owner_node_id") or "-",
             entry.get("text_bytes") or 0,
             text(entry.get("fingerprint"))[:16], entry.get("fingerprint_source")))


def command_inspect(args):
    snapshot = extract_snapshot(load_text(args.svg))
    if snapshot is None:
        print("Kein Snapshot im SVG gefunden.", file=sys.stderr)
        return 2
    report = verify_snapshot(snapshot)
    print("Snapshot   : Version %s, erzeugt %s von %s"
          % (snapshot.get("snapshot_version"), snapshot.get("captured_at"),
             snapshot.get("producer")))
    if snapshot.get("project"):
        print("Projekt    : %s" % snapshot["project"])
    print("Integritaet: %s" % ("unversehrt" if report["ok"] else "BESCHAEDIGT"))
    print("Konfigurationen (%d):" % len(snapshot.get("configs") or []))
    for entry in snapshot.get("configs") or []:
        print_entry(entry)
        counts = entry.get("section_counts") or {}
        interesting = {name: counts[name] for name in
                       ("controllers", "sensors", "actuators", "process_states", "rules")
                       if name in counts}
        print("               %s" % json.dumps(interesting, ensure_ascii=False))
    for item in report["warnings"]:
        print("  Hinweis: %s" % item)
    for item in report["errors"]:
        print("  FEHLER : %s" % item, file=sys.stderr)
    return 0 if report["ok"] else 1


def command_extract(args):
    snapshot = extract_snapshot(load_text(args.svg))
    if snapshot is None:
        print("Kein Snapshot im SVG gefunden.", file=sys.stderr)
        return 2
    entry = pick_config(snapshot, args.target)
    if entry is None:
        print("Kein passender Eintrag fuer '%s'." % args.target, file=sys.stderr)
        return 2
    if args.out == "-":
        sys.stdout.buffer.write(entry["text"].encode("utf-8"))
    else:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        encoded = entry["text"].encode("utf-8")
        Path(args.out).write_bytes(encoded)
        print("Geschrieben: %s (%d Bytes, byte-genau aus dem Snapshot)"
              % (args.out, len(encoded)))
    return 0


def command_compare(args):
    snapshot = extract_snapshot(load_text(args.svg))
    if snapshot is None:
        print("Kein Snapshot im SVG gefunden.", file=sys.stderr)
        return 2
    entry = pick_config(snapshot, args.target)
    if entry is None:
        print("Kein passender Eintrag fuer '%s'." % args.target, file=sys.stderr)
        return 2

    head = None
    if args.head and Path(args.head).is_file():
        head = json.loads(load_text(args.head))

    result = compare_with_head(entry, head)
    labels = {
        "identical": "identisch — nichts zu tun",
        "stale": "VERALTET — der laufende Stand ist neuer",
        "ahead": "NEUER als der laufende Stand — Rueckfall nach Ausfall",
        "unrelated": "anderer Geltungsbereich — kein sinnvoller Bezug",
        "no_head": "kein laufender Stand — der Snapshot ist die einzige Quelle",
    }
    print("Lage       : %s" % labels.get(result["state"], result["state"]))
    print("Begruendung: %s" % result["reason"])
    print("Snapshot   : %s" % result["snapshot_fingerprint"][:32])
    print("Laufend    : %s" % (result["head_fingerprint"][:32] or "-"))
    print("Replizierbar: %s" % ("ja" if result["replicable"] else "nein (--force noetig)"))
    if result["differences"]:
        print("Abweichende Sektionen:")
        for item in result["differences"]:
            print("  %-28s Snapshot %-5s  laufend %-5s"
                  % (item["section"],
                     "-" if item["snapshot_rows"] is None else item["snapshot_rows"],
                     "-" if item["head_rows"] is None else item["head_rows"]))
    return 0


def command_restore(args):
    snapshot = extract_snapshot(load_text(args.svg))
    if snapshot is None:
        print("Kein Snapshot im SVG gefunden.", file=sys.stderr)
        return 2
    report = verify_snapshot(snapshot)
    if not report["ok"] and not args.force:
        for item in report["errors"]:
            print("FEHLER: %s" % item, file=sys.stderr)
        print("Wiederherstellung abgebrochen (--force ueberschreibt).", file=sys.stderr)
        return 1

    entry = pick_config(snapshot, args.target)
    if entry is None:
        print("Kein passender Eintrag fuer '%s'." % args.target, file=sys.stderr)
        return 2

    head = None
    target = Path(args.out)
    if target.is_file():
        head = json.loads(target.read_text(encoding="utf-8"))
    comparison = compare_with_head(entry, head)

    if comparison["state"] == "unrelated" and not args.force:
        print("FEHLER: %s" % comparison["reason"], file=sys.stderr)
        print("Mit --force liesse sich das erzwingen — dann aber bewusst.",
              file=sys.stderr)
        return 1

    if comparison["state"] == "identical" and not args.force:
        print("Der laufende Stand ist bereits identisch — nichts geschrieben.")
        return 0

    config = json.loads(entry["text"])
    runtime = verify_with_runtime(config) if args.verify else {"available": False}
    if args.verify and runtime.get("available") and runtime.get("status") != "OK" \
            and not args.force:
        print("FEHLER: Die Runtime-Type-Authority lehnt den Snapshot ab.", file=sys.stderr)
        for item in (runtime.get("errors") or [])[:6]:
            print("  %s" % item, file=sys.stderr)
        return 1

    if target.is_file() and not args.no_backup:
        backup = target.with_suffix(target.suffix + ".vor_restore")
        backup.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
        print("Sicherung  : %s" % backup)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(entry["text"], encoding="utf-8")

    print("Lage       : %s" % comparison["state"])
    print("Begruendung: %s" % comparison["reason"])
    print("Geschrieben: %s (%d Bytes, byte-genau)" % (target, len(entry["text"])))
    if runtime.get("available"):
        print("Runtime    : %s | Fingerprint %s"
              % (runtime.get("status"), text(runtime.get("fingerprint"))[:16]))
    if comparison["state"] == "stale":
        print("Hinweis    : Der Snapshot war aelter als der ueberschriebene Stand. "
              "Die Sicherung liegt daneben.")
    return 0


def command_embed(args):
    entries = []
    for path in args.config:
        entries.append(describe_config(load_text(path), source=str(path)))
    snapshot = build_snapshot(entries, project=args.project, notes=args.notes)
    result = embed_snapshot(load_text(args.svg), snapshot)
    out = Path(args.out or args.svg)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(result, encoding="utf-8")
    print("Snapshot eingebettet: %s" % out)
    for entry in entries:
        print_entry(entry)
    print("Gesamt: %d Bytes Nutzlast" % sum(e["text_bytes"] for e in entries))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Konfigurations-Snapshots im SVG verwalten.")
    sub = parser.add_subparsers(dest="command", required=True)

    inspect = sub.add_parser("inspect", help="Snapshot anzeigen und pruefen")
    inspect.add_argument("svg")
    inspect.set_defaults(handler=command_inspect)

    extract = sub.add_parser("extract", help="Konfiguration herausholen")
    extract.add_argument("svg")
    extract.add_argument("--target", default="",
                         help="node_id, owner_node_id, Rolle oder Scope")
    extract.add_argument("--out", default="-")
    extract.set_defaults(handler=command_extract)

    compare = sub.add_parser("compare", help="Gegen den laufenden Stand halten")
    compare.add_argument("svg")
    compare.add_argument("--head", default="config/device_state_data_v9.json")
    compare.add_argument("--target", default="")
    compare.set_defaults(handler=command_compare)

    restore = sub.add_parser("restore", help="Konfiguration wiederherstellen")
    restore.add_argument("svg")
    restore.add_argument("--out", default="config/device_state_data_v9.json")
    restore.add_argument("--target", default="")
    restore.add_argument("--verify", action="store_true")
    restore.add_argument("--force", action="store_true")
    restore.add_argument("--no-backup", action="store_true")
    restore.set_defaults(handler=command_restore)

    embed = sub.add_parser("embed", help="Snapshot in ein SVG legen")
    embed.add_argument("svg")
    embed.add_argument("--config", action="append", required=True)
    embed.add_argument("--out", default="")
    embed.add_argument("--project", default="")
    embed.add_argument("--notes", default="")
    embed.set_defaults(handler=command_embed)

    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
