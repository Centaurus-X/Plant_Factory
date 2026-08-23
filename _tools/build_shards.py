#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_shards.py — erzeugt aus einer V9-Config alle Rollout-Shards.

    node_local (V9)   je Node   — device_state_data_v9_node_<node>.json
    cross      (V8)   je Owner  — device_state_data_v8_cross_<owner>.json

Die Aufteilung folgt exakt `validate_split_shards()`: Local- und Cross-
Regelmengen sind disjunkt und decken zusammen jede ausführbare Regel ab.
Welche Regel wohin gehört, entscheidet `cross_rule_eligibility()`:

    cross-scoped + schreibt nur cross-eigene States   -> V8-Cross-Shard
    alles andere Ausführbare                          -> V9-Node-Shard

Beispiel:
    python3 _tools/build_shards.py config/device_state_data_v9.json --out config/shards

Mit `--verify` wird zusätzlich gegen die echte Runtime-Type-Authority geprüft,
sofern `automation_system_v0101` im PYTHONPATH liegt.

Designvorgaben: kein OOP, keine Decorators, functools.partial statt lambda.
"""

from __future__ import annotations

import argparse
import json
import sys
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _server_v9 import (  # noqa: E402
    split_shards, classify_scopes, cross_eligibility, rows)
from _tools.canonicalize_v9_config import canonicalize  # noqa: E402
from _tools.format_v9_config import format_config  # noqa: E402


def write_json(path, payload, previous_path=None):
    previous = None
    if previous_path and Path(previous_path).is_file():
        previous = json.loads(Path(previous_path).read_text(encoding="utf-8"))
    normalized, _ = canonicalize(payload, previous)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(format_config(normalized), encoding="utf-8", newline="\n")
    return normalized


def verify_with_runtime(path, kind):
    """Optionale Tiefprüfung gegen automation_system_v0101."""
    try:
        from src.library._generic_type_library import (  # noqa: PLC0415
            verify_storage_config_data, config_fingerprint)
        from src.library._generic_system_contract_library.config_sharding_contracts import (  # noqa: PLC0415,E501
            validate_cross_execution_shard)
    except Exception:  # noqa: BLE001
        return {"available": False}

    config = json.loads(Path(path).read_text(encoding="utf-8"))
    report = verify_storage_config_data(config)
    result = {
        "available": True,
        "type_authority": report.get("status"),
        "errors": len(report.get("errors") or []),
        "fingerprint": config_fingerprint(config),
    }
    if kind == "cross":
        gate = validate_cross_execution_shard(config)
        result["cross_gate"] = "OK" if gate.get("ok") else "FAILED"
        result["cross_errors"] = list(gate.get("errors") or [])
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Erzeugt node_local- (V9) und cross- (V8) Shards aus einer V9-Config.")
    parser.add_argument("source", nargs="?", default="config/device_state_data_v9.json")
    parser.add_argument("--out", default="config/shards")
    parser.add_argument("--verify", action="store_true",
                        help="Zusätzlich gegen die Runtime-Type-Authority prüfen.")
    args = parser.parse_args(argv)

    source = Path(args.source)
    if not source.is_file():
        print("Quelle nicht gefunden: %s" % source, file=sys.stderr)
        return 2

    config = json.loads(source.read_text(encoding="utf-8"))
    scopes = classify_scopes(config)
    result = split_shards(config)

    print("Quelle : %s" % source)
    print("Split  : %s" % ("gültig" if result["ok"] else "UNGÜLTIG"))
    print("Stats  : %s" % json.dumps(result["stats"], ensure_ascii=False))
    if result["overlap_rule_ids"]:
        print("  Überlappende Regeln: %s" % result["overlap_rule_ids"], file=sys.stderr)
    if result["missing_rule_ids"]:
        print("  Fehlende Regeln    : %s" % result["missing_rule_ids"], file=sys.stderr)

    print("\nCross-Eignung je Regel:")
    for entry in result["eligibility"]:
        target = "cross (V8)" if entry["ok"] else "node_local (V9)"
        reason = "; ".join(entry["reasons"]) or "—"
        print("  Regel %-4s scope=%-17s -> %-15s %s"
              % (entry["rule_id"], entry["scope"], target, reason))

    out_dir = Path(args.out)
    written = []
    for node, shard in sorted(result["local"].items()):
        path = out_dir / ("device_state_data_v9_node_%s.json" % node)
        write_json(path, shard)
        written.append((path, "node"))
    for owner, shard in sorted(result["cross"].items()):
        path = out_dir / ("device_state_data_v8_cross_%s.json" % owner)
        write_json(path, shard)
        written.append((path, "cross"))

    print("\nGeschrieben:")
    for path, kind in written:
        line = "  %-58s %s" % (path, kind)
        if args.verify:
            verification = verify_with_runtime(path, kind)
            if verification.get("available"):
                line += "  type=%s errors=%d" % (
                    verification["type_authority"], verification["errors"])
                if kind == "cross":
                    line += " cross_gate=%s" % verification["cross_gate"]
                line += " fp=%s" % verification["fingerprint"][:16]
            else:
                line += "  (Runtime nicht im PYTHONPATH — Tiefprüfung übersprungen)"
        print(line)

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
