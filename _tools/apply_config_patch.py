#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generischer Overlay-Mechanismus fuer V9-/V8-Configs.

Warum ein Overlay statt Code
----------------------------
Inhaltliche Erweiterungen (ein neuer Sensor, ein zusaetzlicher Prozesszustand,
eine Cross-Worker-Regel) sind DATEN, kein Programm. Sie gehoeren deshalb in
eine Patch-Datei, nicht in ein Spezialskript. Dieses Werkzeug legt beliebig
viele solcher Overlays deterministisch auf eine Basis-Config.

Patch-Format
------------
Eine Patch-Datei ist selbst wieder eine (Teil-)Config plus zwei Sonderfelder::

    {
      "__meta__":   {"name": "...", "description": "..."},
      "__remove__": {"rules": [{"rule_id": 5}]},

      "sensors":  [ { ...vollstaendige oder teilweise Zeile... } ],
      "rules":    [ { ... } ]
    }

Regeln:

    * Zeilen werden ueber die Schluesselfelder aus MERGE_KEYS identifiziert.
    * Existiert die Zeile schon, wird FLACH GEMISCHT (Patch-Felder gewinnen,
      verschachtelte Objekte werden rekursiv gemischt).
    * Existiert sie nicht, wird sie angehaengt.
    * `__remove__` loescht Zeilen ueber dieselben Schluessel.
    * Sektionen, die der Patch nicht nennt, bleiben unberuehrt.

Damit ist ein Patch idempotent: zweimal anwenden aendert nichts.

Aufruf
------
    python3 _tools/apply_config_patch.py base.json patch_a.json patch_b.json \\
        --out config/device_state_data_v9.json --verify

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
from _tools.merge_shards_to_master import MERGE_KEYS, key_of, rows, text  # noqa: E402

META_FIELD = "__meta__"
REMOVE_FIELD = "__remove__"
SPECIAL_FIELDS = (META_FIELD, REMOVE_FIELD)


def deep_merge(base, patch):
    """Mischt zwei Objekte. Listen ersetzen, Objekte mischen, Skalare gewinnen."""
    if isinstance(base, dict) and isinstance(patch, dict):
        out = dict(base)
        for key, value in patch.items():
            out[key] = deep_merge(base.get(key), value) if key in base else value
        return out
    return patch


def index_rows(section, items):
    index = {}
    for position, row in enumerate(items):
        index.setdefault(key_of(section, row), position)
    return index


def apply_patch(config, patch, report):
    """Legt EIN Overlay auf die Config. Liefert die neue Config."""
    out = {section: list(rows(config, section)) for section in config}
    name = text((patch.get(META_FIELD) or {}).get("name")) or "(unbenannt)"

    for section, items in patch.items():
        if section in SPECIAL_FIELDS:
            continue
        if section not in MERGE_KEYS:
            report.append({"patch": name, "section": section,
                           "action": "skip", "detail": "unbekannte Sektion"})
            continue
        target = out.setdefault(section, [])
        index = index_rows(section, target)
        for row in items if isinstance(items, list) else [items]:
            if not isinstance(row, dict):
                continue
            row_key = key_of(section, row)
            if row_key in index:
                position = index[row_key]
                merged = deep_merge(target[position], row)
                action = "unveraendert" if merged == target[position] else "gemischt"
                target[position] = merged
            else:
                index[row_key] = len(target)
                target.append(row)
                action = "ergaenzt"
            report.append({"patch": name, "section": section, "action": action,
                           "key": "/".join(row_key) or "(singleton)"})

    for section, items in (patch.get(REMOVE_FIELD) or {}).items():
        if section not in out:
            continue
        drop = {key_of(section, row) for row in items if isinstance(row, dict)}
        kept = [row for row in out[section] if key_of(section, row) not in drop]
        for row_key in sorted(drop):
            report.append({"patch": name, "section": section, "action": "entfernt",
                           "key": "/".join(row_key)})
        out[section] = kept

    return {section: out.get(section, []) for section in TOP_LEVEL_ORDER if section in out}


def apply_patches(config, patches):
    report = []
    for patch in patches:
        config = apply_patch(config, patch, report)
    return config, report


def verify_with_runtime(config):
    try:
        from src.library._generic_type_library import (  # noqa: PLC0415
            verify_storage_config_data, config_fingerprint)
    except Exception:  # noqa: BLE001
        return {"available": False}
    try:
        result = verify_storage_config_data(config)
        return {"available": True, "status": result.get("status"),
                "errors": result.get("errors") or [],
                "warnings": result.get("warnings") or [],
                "fingerprint": config_fingerprint(config)}
    except Exception as exc:  # noqa: BLE001
        return {"available": True, "status": "FAILED", "errors": [str(exc)]}


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Legt Overlay-Patches auf eine V9-/V8-Config.")
    parser.add_argument("base")
    parser.add_argument("patches", nargs="+")
    parser.add_argument("--out", default="-")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    config = load_json(args.base)
    patches = [load_json(path) for path in args.patches]
    config, report = apply_patches(config, patches)

    payload = format_config(config)
    if args.out == "-":
        sys.stdout.write(payload)
    else:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload, encoding="utf-8", newline="\n")
        if not args.quiet:
            print("Geschrieben: %s" % out)

    if not args.quiet and args.out != "-":
        counts = {}
        for item in report:
            counts[item["action"]] = counts.get(item["action"], 0) + 1
        print("  " + " | ".join("%s: %d" % (key, counts[key]) for key in sorted(counts)))
        for item in report:
            if item["action"] in ("ergaenzt", "entfernt", "skip"):
                print("    %-12s %-18s %s" % (item["action"], item["section"],
                                              item.get("key", item.get("detail", ""))))

    if args.verify:
        runtime = verify_with_runtime(config)
        if runtime.get("available"):
            if not args.quiet:
                print("  Runtime-Type-Authority: %s | Fingerprint %s"
                      % (runtime.get("status"), text(runtime.get("fingerprint"))[:16]))
            for item in (runtime.get("errors") or [])[:10]:
                print("    E %s" % item)
            if runtime.get("status") != "OK":
                return 1
        elif not args.quiet:
            print("  Runtime nicht im PYTHONPATH — Tiefpruefung uebersprungen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
