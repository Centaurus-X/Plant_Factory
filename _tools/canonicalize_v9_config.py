#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Numerische Kanonisierung einer V9-Config (Fingerprint-Stabilität).

Problem
-------
Der Runtime-Fingerprint (`config_fingerprint`) hasht die kanonischen JSON-Bytes.
Darin sind `1000.0` und `1000` VERSCHIEDEN. JavaScript kennt nur einen
Zahlentyp: `JSON.stringify(1000.0)` liefert immer `1000`. Eine im Browser
gespeicherte Config bekäme dadurch einen anderen Fingerprint als dieselbe
Config aus der Runtime — und Authority V5 würde den Commit als abweichend
werten.

Lösung
-------
Genau eine Stelle kanonisiert: der Server beim Schreiben. Jedes im Vertrag als
Gleitkommazahl deklarierte Feld wird zu `float`, jedes Ganzzahlfeld zu `int`.
Damit ist der Fingerprint unabhängig davon, ob Editor, Migrationstool oder
Runtime die Datei zuletzt geschrieben hat.

Die Feldtabelle spiegelt `public/js/v9_schema.js` (SECTIONS[*].fields.type).

Designvorgaben: kein OOP, functools.partial statt lambda.
"""

from __future__ import annotations

import argparse
import json
import sys
from functools import partial
from pathlib import Path

# Pfad -> Zieltyp. Pfadsyntax: "<sektion>.<feld>" bzw. "<sektion>.<feld>.*"
# ("*" = alle Werte eines Map-/Listeneintrags).
#
# Nur Felder, die der Vertrag an FESTER Position als Gleitkommazahl führt und
# die die Runtime-Baseline durchgängig als Float schreibt. Bewusst NICHT
# enthalten sind freie Maps (`control_methods.args`, `process_states.parameters`)
# und `rules.when.value` — dort ist die Integralität inhaltlich bedeutsam
# (value_id 1 ist keine 1.0). Für diese Fälle sorgt preserve_numeric_literals().
FLOAT_PATHS = frozenset({
    "scaling_profiles.eng_min",
    "scaling_profiles.eng_max",
    "pid_configs.pid_parameters.*",
    "process_states.control_strategy.out_min",
    "process_states.control_strategy.out_max",
    "process_states.control_strategy.sample_time",
    "process_states.control_strategy.error_scale",
    "process_states.control_strategy.dt_max_s",
    "rule_engine.sp_tolerance",
    "rule_engine.runtime.max_signal_age_s",
    "rule_engine.safety.max_output_delta_per_step",
    "rule_engine.debug.pid_interval_s",
    "rule_engine.debug.pid_saturation_interval_s",
    "filters.chain.alpha",
    "rules.when.cooldown_s",
    "rules.until.cooldown_s",
})

INT_PATHS = frozenset({
    "scaling_profiles.raw_min",
    "scaling_profiles.raw_max",
    "scaling_profiles.profile_id",
    "controllers.controller_id",
    "controllers.port",
    "virtual_controllers.virt_controller_id",
    "virtual_controllers.port",
    "site_controller_map.local_controller_id",
    "sensors.sensor_id",
    "sensors.local_controller_id",
    "sensors.profile_id",
    "actuators.actuator_id",
    "actuators.local_controller_id",
    "actuators.profile_id",
    "processes.p_id",
    "process_values.value_id",
    "process_modes.mode_id",
    "process_states.state_id",
    "process_states.p_id",
    "process_states.value_id",
    "process_states.mode_id",
    "process_states.mapping_id",
    "process_states.control_strategy.pid_config_id",
    "process_states.control_strategy.method_id",
    "parameter_generic_templates.schema_id",
    "schema_mappings.mapping_id",
    "schema_mappings.schema_id",
    "pid_configs.pid_config_id",
    "control_method_templates.template_id",
    "control_methods.method_id",
    "control_methods.template_id",
    "rule_engine.engine_id",
    "rule_engine.required_mode_id",
    "rule_engine.runtime.tick_ms",
    "rule_engine.runtime.coordinator_min_priority",
    "filters.filter_id",
    "filters.chain.window",
    "timers.timer_id",
    "rules.rule_id",
    "rules.engine_id",
    "rules.priority",
    "rules.execution_epoch",
    "rules.when.state_id",
    "rules.when.sensor_id",
    "rules.when.timer_id",
    "rules.when.filter_id",
    "rules.until.state_id",
    "rules.until.sensor_id",
    "rules.until.timer_id",
    "rules.until.filter_id",
    "meta.version",
})

# Zählbare Adressen (Modbus) bleiben int, S7-Adressen bleiben str.
INT_IF_NUMERIC = frozenset({"sensors.address", "actuators.address"})


def to_float(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return float(value)


def to_int(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    if isinstance(value, float) and not value.is_integer():
        return value
    return int(value)


def walk(node, path, stats):
    """Rekursive Kanonisierung entlang der Pfadtabelle."""
    if isinstance(node, list):
        return [walk(item, path, stats) for item in node]
    if not isinstance(node, dict):
        return node

    out = {}
    for key, value in node.items():
        child_path = "%s.%s" % (path, key) if path else key
        wildcard = "%s.*" % child_path

        if isinstance(value, dict):
            if wildcard in FLOAT_PATHS:
                out[key] = {k: apply_cast(to_float, v, stats, wildcard)
                            for k, v in value.items()}
                continue
            out[key] = walk(value, child_path, stats)
            continue
        if isinstance(value, list):
            out[key] = walk(value, child_path, stats)
            continue

        if child_path in FLOAT_PATHS:
            out[key] = apply_cast(to_float, value, stats, child_path)
        elif child_path in INT_PATHS or child_path in INT_IF_NUMERIC:
            out[key] = apply_cast(to_int, value, stats, child_path)
        else:
            out[key] = value
    return out


def apply_cast(cast, value, stats, path):
    result = cast(value)
    if type(result) is not type(value):
        stats[path] = stats.get(path, 0) + 1
    return result


def preserve_numeric_literals(candidate, previous):
    """Uebernimmt die Zahlenschreibweise der Vorversion, wo der Wert gleich blieb.

    JavaScript kann `554.0` nicht ausdrücken — `JSON.stringify(554.0)` liefert
    `554`. Für freie Maps (`parameters`, `args`) lässt sich das nicht per
    Typtabelle beheben. Deshalb gilt: ändert sich ein Zahlenwert NUMERISCH
    nicht, behält er sein bisheriges Literal. Nur echte Aenderungen schreiben
    eine neue Schreibweise. Damit bleibt der Fingerprint einer unveränderten
    Config über den Editor-Roundtrip identisch.
    """
    if isinstance(candidate, dict) and isinstance(previous, dict):
        return {key: preserve_numeric_literals(value, previous.get(key))
                for key, value in candidate.items()}
    if isinstance(candidate, list) and isinstance(previous, list):
        return [preserve_numeric_literals(item, previous[i] if i < len(previous) else None)
                for i, item in enumerate(candidate)]
    if isinstance(candidate, bool) or isinstance(previous, bool):
        return candidate
    if isinstance(candidate, (int, float)) and isinstance(previous, (int, float)):
        if float(candidate) == float(previous):
            return previous
    return candidate


def canonicalize(config, previous=None):
    """Liefert (kanonisierte Config, Statistik der Typkorrekturen)."""
    stats = {}
    out = {}
    for section, rows in config.items():
        out[section] = walk(rows, section, stats)
    if isinstance(previous, dict):
        out = preserve_numeric_literals(out, previous)
    return out, stats


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Kanonisiert die Zahlentypen einer V9-Config (Fingerprint-Stabilität).")
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--in-place", action="store_true", default=True)
    parser.add_argument("--stdout", dest="in_place", action="store_false")
    parser.add_argument("--previous", default=None,
                        help="Vorversion, deren Zahlenliterale bei gleichem Wert "
                             "erhalten bleiben sollen.")
    args = parser.parse_args(argv)

    previous = None
    if args.previous and Path(args.previous).is_file():
        previous = json.loads(Path(args.previous).read_text(encoding="utf-8"))

    for raw_path in args.paths:
        path = Path(raw_path)
        if not path.is_file():
            print("Nicht gefunden: %s" % path, file=sys.stderr)
            return 2
        config = json.loads(path.read_text(encoding="utf-8"))
        out, stats = canonicalize(config, previous)
        payload = json.dumps(out, indent=2, ensure_ascii=False) + "\n"
        if args.in_place:
            path.write_text(payload, encoding="utf-8")
            total = sum(stats.values())
            print("%s: %d Zahlenfelder kanonisiert" % (path, total))
            for key in sorted(stats):
                print("   %-55s %d" % (key, stats[key]))
        else:
            sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
