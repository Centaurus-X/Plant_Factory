#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Beweist, dass Factory-Regeln die ECHTE Runtime bestehen — nicht nur den Editor.

Warum dieser Test
-----------------
Der Editor bringt eine eigene Validierung mit (`public/js/v9_validate.js`). Die
kann nur so gut sein wie das Bild, das sie sich vom Vertrag macht. Dieser Test
setzt daher eine Stufe tiefer an: er laesst die JS-Factory Regeln erzeugen und
schickt sie durch `verify_storage_config_data()` der Runtime — also durch
genau den Code, der im Feld ueber Annahme oder Ablehnung entscheidet.

Zusaetzlich werden die Regeln gegen die Invarianten geprueft, die im
Type-Schema NICHT stehen, aber trotzdem ueber Erfolg entscheiden:

    * Aktionsmarker  — `_generic_rule_engine._find_action_handler` nimmt den
      ERSTEN passenden Marker. Eine Aktion mit `state_ids` UND `notify` fuehrt
      nur den State-Write aus; das `notify` verschwindet lautlos.
    * writable_fields — `_config_safety_policy._action_fields_valid` laesst in
      einer Aktion nur `state_ids`, `p_ids`, `notify` sowie die in
      `rule_engine[].writable_fields` genannten Felder zu. Ein `description`
      in einer Aktion reisst das Sicherheits-Gate.
    * Vergleichswerte — `spec_rule_condition_value` ist eine Union aus Zahl,
      bool und `{param_of_state, key, scale?}`. Ein String ist KEIN gueltiger
      Vergleichswert, obwohl JSON ihn zulaesst.
    * Sensorbedingungen — `verify_rule_condition_refs` verlangt bei
      `src == "sensor"` ein aufloesbares Paar (controller_uuid, sensor_id).

Ohne Runtime im PYTHONPATH laeuft der Test trotzdem: dann greifen die
strukturellen Pruefungen, die Tiefpruefung wird als uebersprungen gemeldet.

Ausfuehren:  python3 test/test_rule_contract.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE_BINARY = os.environ.get("NODE_BINARY", "node")
sys.path.insert(0, str(ROOT))

CONFIG = ROOT / "config" / "device_state_data_v9.json"

# --- Vertragstabellen, woertlich aus _generic_type_library.py -----------------

RULE_FIELDS = frozenset((
    "rule_id", "engine_id", "group", "priority", "name", "enabled", "when", "do",
    "until", "else_do", "latch", "description", "owner_node_id", "domain_id",
    "activation_state", "deployment_status", "execution_epoch", "execution_owner",
    "execution_scope",
))
RULE_REQUIRED = ("rule_id", "engine_id", "group", "priority", "name", "enabled",
                 "when", "do")
V9_REQUIRED = ("activation_state", "deployment_status", "execution_epoch",
               "execution_owner", "execution_scope")

CONDITION_FIELDS = frozenset((
    "src", "op", "value", "state_id", "field", "controller_uuid", "sensor_id",
    "timer_id", "filter_id", "cooldown_s",
))
CONDITION_REQUIRED = ("src", "op", "value")

ACTION_FIELDS = frozenset(("state_ids", "p_ids", "value_id", "parameters", "notify"))
ACTION_MARKERS = ("state_ids", "p_ids", "notify")

RULE_SRC = frozenset(("state", "sensor", "timer"))
RULE_OP = frozenset(("==", "!=", ">", ">=", "<", "<=", "elapsed", "fired"))
RULE_GROUP = frozenset(("process", "safety", "notify"))
LATCH = frozenset(("manual", "auto"))
ACTIVATION_STATE = frozenset(("staged", "active", "retiring", "inactive"))
DEPLOYMENT_STATUS = frozenset(("active_node", "active_cross", "replaced_local",
                               "monitor_only", "disabled_with_reason"))

# Felder, die die Runtime an Regeln liest, obwohl sie nicht im Schema stehen.
# Sie sind erlaubt (nur Warning), aber der Editor muss wissen, dass er sie setzt.
TOLERATED_EXTRA_RULE_FIELDS = frozenset(("cross_domain_id", "disabled_reason", "emit"))

FAILURES = []
PASSED = [0]


def check(name, condition, detail=""):
    if condition:
        PASSED[0] += 1
        return True
    FAILURES.append(name + (" — " + detail if detail else ""))
    return False


# =============================================================================
# STRUKTURPRUEFUNG EINER REGEL
# =============================================================================


def audit_rule(rule, writable_fields, label, profile="v9"):
    """Liefert (fehler, laufzeithinweise) einer einzelnen Regel.

    `profile="cross"` prueft den V8-Cross-Vertrag: dort sind die fuenf
    V9-Execution-Felder nicht nur optional, sondern VERBOTEN — der Shard traegt
    keine Ausfuehrungsidentitaet, die setzt erst der Master beim Ruecklauf.
    """
    errors = []
    notes = []
    rid = rule.get("rule_id")
    where = "%s Regel %s" % (label, rid)

    unknown = set(rule) - RULE_FIELDS - TOLERATED_EXTRA_RULE_FIELDS
    if unknown:
        errors.append("%s: unbekannte Regelfelder %s" % (where, sorted(unknown)))
    for field in RULE_REQUIRED:
        if field not in rule:
            errors.append("%s: Pflichtfeld '%s' fehlt" % (where, field))
    if profile == "cross":
        present = [field for field in V9_REQUIRED if field in rule]
        if present:
            errors.append("%s: V8-Cross verbietet die Execution-Felder %s"
                          % (where, present))
    else:
        for field in V9_REQUIRED:
            if field not in rule:
                errors.append("%s: V9-Pflichtfeld '%s' fehlt" % (where, field))

    if rule.get("group") not in RULE_GROUP:
        errors.append("%s: group=%r nicht im Enum" % (where, rule.get("group")))
    if not isinstance(rule.get("enabled"), bool):
        errors.append("%s: enabled muss echtes bool sein" % where)
    if not isinstance(rule.get("priority"), int) or isinstance(rule.get("priority"), bool) \
            or rule.get("priority", -1) < 0:
        errors.append("%s: priority muss int >= 0 sein" % where)
    if not str(rule.get("name") or "").strip():
        errors.append("%s: name darf nicht leer sein" % where)
    if "latch" in rule:
        if rule["latch"] not in LATCH:
            errors.append("%s: latch=%r nicht im Enum" % (where, rule["latch"]))
        elif rule["latch"] == "auto":
            notes.append("%s: latch='auto' ist zur Laufzeit wirkungslos "
                         "(_apply_rule_state_machine reagiert nur auf 'manual')" % where)
    if "activation_state" in rule and rule["activation_state"] not in ACTIVATION_STATE:
        errors.append("%s: activation_state=%r" % (where, rule["activation_state"]))
    if "deployment_status" in rule and rule["deployment_status"] not in DEPLOYMENT_STATUS:
        errors.append("%s: deployment_status=%r" % (where, rule["deployment_status"]))

    for bucket in ("when", "until"):
        if bucket in rule and not isinstance(rule[bucket], list):
            errors.append("%s: %s muss eine Liste sein" % (where, bucket))
            continue
        if bucket in rule and not rule[bucket]:
            errors.append("%s: %s ist leer (min_len=1)" % (where, bucket))
        for index, cond in enumerate(rule.get(bucket) or []):
            errors.extend(audit_condition(cond, "%s.%s[%d]" % (where, bucket, index)))
            notes.extend(runtime_notes(cond, "%s.%s[%d]" % (where, bucket, index)))

    for bucket in ("do", "else_do"):
        if bucket in rule and not rule[bucket]:
            errors.append("%s: %s ist leer (min_len=1)" % (where, bucket))
        for index, action in enumerate(rule.get(bucket) or []):
            errors.extend(audit_action(action, writable_fields,
                                       "%s.%s[%d]" % (where, bucket, index)))
    return errors, notes


def audit_condition(cond, where):
    errors = []
    if not isinstance(cond, dict):
        return ["%s: Bedingung ist kein Objekt" % where]
    unknown = set(cond) - CONDITION_FIELDS
    if unknown:
        errors.append("%s: unbekannte Bedingungsfelder %s" % (where, sorted(unknown)))
    for field in CONDITION_REQUIRED:
        if field not in cond:
            errors.append("%s: Pflichtfeld '%s' fehlt" % (where, field))
    if cond.get("src") not in RULE_SRC:
        errors.append("%s: src=%r nicht im Enum %s" % (where, cond.get("src"),
                                                       sorted(RULE_SRC)))
    if cond.get("op") not in RULE_OP:
        errors.append("%s: op=%r nicht im Enum" % (where, cond.get("op")))

    value = cond.get("value")
    if isinstance(value, str):
        errors.append("%s: value ist ein String (%r) — die Union kennt nur "
                      "Zahl, bool und {param_of_state,key,scale}" % (where, value))
    elif isinstance(value, dict):
        state_id = value.get("param_of_state")
        if not isinstance(state_id, int) or isinstance(state_id, bool) or state_id < 1:
            errors.append("%s: value.param_of_state muss int >= 1 sein, ist %r"
                          % (where, state_id))
        if not str(value.get("key") or "").strip():
            errors.append("%s: value.key ist Pflicht und darf nicht leer sein" % where)
        extra = set(value) - {"param_of_state", "key", "scale"}
        if extra:
            errors.append("%s: value hat unbekannte Felder %s" % (where, sorted(extra)))
    elif not isinstance(value, (int, float, bool)):
        errors.append("%s: value=%r ist keine erlaubte Form" % (where, value))

    if cond.get("src") == "sensor":
        if not isinstance(cond.get("sensor_id"), int) or isinstance(cond.get("sensor_id"), bool):
            errors.append("%s: src=sensor verlangt sensor_id (int)" % where)
        if not str(cond.get("controller_uuid") or "").strip():
            errors.append("%s: src=sensor verlangt eine nicht-leere controller_uuid"
                          % where)
    if cond.get("src") == "state" and not isinstance(cond.get("state_id"), int):
        errors.append("%s: src=state verlangt state_id (int)" % where)
    if cond.get("src") == "timer" and not isinstance(cond.get("timer_id"), int):
        errors.append("%s: src=timer verlangt timer_id (int)" % where)
    return errors


def runtime_notes(cond, where):
    """Hinweise auf schemakonforme, aber zur Laufzeit wirkungslose Konstrukte."""
    notes = []
    if cond.get("filter_id") is not None:
        notes.append("%s: filter_id gesetzt — die Runtime baut die Fakten mit "
                     "filters={} und faellt auf den Rohwert zurueck "
                     "(thread_management._build_rule_context)" % where)
    if cond.get("src") == "timer":
        notes.append("%s: src='timer' — die Fakten enthalten keine timers, die "
                     "Bedingung ist dauerhaft falsch" % where)
    return notes


def audit_action(action, writable_fields, where):
    errors = []
    if not isinstance(action, dict):
        return ["%s: Aktion ist kein Objekt" % where]
    unknown = set(action) - ACTION_FIELDS
    if unknown:
        errors.append("%s: unbekannte Aktionsfelder %s" % (where, sorted(unknown)))

    markers = [name for name in ACTION_MARKERS if name in action]
    if not markers:
        errors.append("%s: kein Aktionsmarker — die Runtime meldet 'unhandled'" % where)
    elif len(markers) > 1:
        errors.append("%s: mehrere Marker %s — _find_action_handler nimmt nur den "
                      "ersten, der Rest verschwindet lautlos" % (where, markers))

    for field in action:
        if field in ACTION_MARKERS:
            continue
        if field not in writable_fields:
            errors.append("%s: '%s' steht nicht in rule_engine.writable_fields %s — "
                          "_config_safety_policy lehnt die Aktion ab"
                          % (where, field, sorted(writable_fields)))
    if "parameters" in action and not isinstance(action["parameters"], dict):
        errors.append("%s: parameters muss ein Objekt sein" % where)
    for key, value in (action.get("parameters") or {}).items():
        if not isinstance(value, (int, float, bool, str)):
            errors.append("%s: parameters['%s'] muss Zahl, bool oder String sein"
                          % (where, key))
    return errors


# =============================================================================
# FACTORY-AUSGABEN ERZEUGEN
# =============================================================================

FACTORY_SCRIPT = r"""
import fs from 'node:fs';
const F = await import('file://%(root)s/public/js/v9_factory.js');
const config = JSON.parse(fs.readFileSync('%(config)s', 'utf8'));
const ctx = F.createContext(config);

const cases = [
  // 1. Minimalregel — alles Weggelassene muss die Factory ergaenzen.
  {},
  // 2. Sensorbedingung ohne controller_uuid: muss aus dem Kontext kommen.
  { rule_id: 901, name: 'sensor_ohne_uuid',
    when: [{ src: 'sensor', op: '>=', sensor_id: 1, value: 42 }],
    do: [{ state_ids: [1], value_id: 1 }] },
  // 3. Verbotene Aktionsfelder — muessen entfernt werden.
  { rule_id: 902, name: 'aktion_mit_verbotenen_feldern',
    when: [{ src: 'state', op: '==', state_id: 1, value: 1 }],
    do: [{ state_ids: [1], value_id: 1, description: 'weg damit',
           actuator_id: 3, controller_uuid: 'x' }] },
  // 4. Mehrere Marker in einer Aktion — nur einer darf ueberleben.
  { rule_id: 903, name: 'aktion_mit_zwei_markern',
    when: [{ src: 'state', op: '==', state_id: 1, value: 1 }],
    do: [{ state_ids: [1], p_ids: [1], notify: 'beides', value_id: 1 }] },
  // 5. String als Vergleichswert — die Union kennt keinen String.
  { rule_id: 904, name: 'string_als_vergleichswert',
    when: [{ src: 'state', op: '==', state_id: 1, value: 'aktiv' }],
    do: [{ state_ids: [1], value_id: 1 }] },
  // 6. Unvollstaendige Parameterreferenz.
  { rule_id: 905, name: 'unvollstaendige_parameterreferenz',
    when: [{ src: 'state', op: '>=', state_id: 1,
             value: { key: 'target_temp_c', scale: 0.98 } }],
    do: [{ state_ids: [1], value_id: 1 }] },
  // 7. Ungueltige Enums.
  { rule_id: 906, name: 'unbekannte_enums', group: 'wartung',
    when: [{ src: 'druck', op: '~=', state_id: 1, value: 1 }],
    do: [{ state_ids: [1], value_id: 1 }] },
  // 8. Leere Listen — until/else_do duerfen nicht leer gesetzt werden.
  { rule_id: 907, name: 'leere_listen', when: [], until: [], do: [], else_do: [] },
  // 9. Vollstaendige, korrekte Regel.
  { rule_id: 908, name: 'vollstaendig', group: 'process', priority: 120,
    when: [{ src: 'sensor', op: '>=', sensor_id: 1,
             controller_uuid: '62671112-766c-59ed-b0ff-30a49d48f747', value: 540 }],
    until: [{ src: 'sensor', op: '<=', sensor_id: 1,
              controller_uuid: '62671112-766c-59ed-b0ff-30a49d48f747', value: 500 }],
    do: [{ state_ids: [1], value_id: 1 }],
    else_do: [{ state_ids: [1], value_id: 2 }],
    latch: 'manual', description: 'Hysterese' },
  // 10. Reine Meldung.
  { rule_id: 909, name: 'nur_meldung', group: 'notify', priority: 10,
    when: [{ src: 'state', op: '==', state_id: 1, field: 'value_id', value: 1 }],
    do: [{ notify: 'State 1 aktiv' }] },
  // 11. Parameterreferenz mit Skalierung.
  { rule_id: 910, name: 'parameterreferenz',
    when: [{ src: 'sensor', op: '>=', sensor_id: 1,
             controller_uuid: '62671112-766c-59ed-b0ff-30a49d48f747',
             value: { param_of_state: 1, key: 'target_temp_c', scale: 0.98 } }],
    do: [{ state_ids: [1], parameters: { target_temp_c: 554.0 } }] },
  // 12. Cross-Regel.
  { rule_id: 911, name: 'cross_regel', deployment_status: 'active_cross',
    owner_node_id: 'fn-01',
    when: [{ src: 'state', op: '==', state_id: 1, value: 1 }],
    do: [{ state_ids: [1], value_id: 1 }] }
];

process.stdout.write(JSON.stringify(
  cases.map(function (patch) { return F.createRule(patch, ctx); })));
"""


def factory_rules():
    script = FACTORY_SCRIPT % {"root": ROOT.as_posix(), "config": CONFIG.as_posix()}
    result = subprocess.run([NODE_BINARY, "--input-type=module", "-e", script],
                            capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(result.stdout)


# =============================================================================
# TESTS
# =============================================================================


def test_factory_rules(config):
    engine = (config.get("rule_engine") or [{}])[0]
    writable = set(engine.get("writable_fields") or [])
    rules = factory_rules()
    check("Factory liefert alle 12 Faelle", len(rules) == 12, str(len(rules)))

    all_errors = []
    for rule in rules:
        errors, _ = audit_rule(rule, writable, "Factory")
        all_errors.extend(errors)
    check("Jede Factory-Regel erfuellt den Runtime-Vertrag",
          not all_errors, "\n      " + "\n      ".join(all_errors[:12]))

    by_name = {rule.get("name"): rule for rule in rules}

    rule = by_name.get("sensor_ohne_uuid")
    check("Sensorbedingung bekommt die controller_uuid aus dem Kontext",
          rule and str(rule["when"][0].get("controller_uuid") or "").strip(),
          json.dumps(rule["when"][0]) if rule else "fehlt")

    rule = by_name.get("aktion_mit_verbotenen_feldern")
    check("Verbotene Aktionsfelder werden entfernt",
          rule and not ({"description", "actuator_id", "controller_uuid"} & set(rule["do"][0])),
          json.dumps(rule["do"][0]) if rule else "fehlt")

    rule = by_name.get("aktion_mit_zwei_markern")
    check("Aktion behaelt genau einen Marker",
          rule and len([m for m in ACTION_MARKERS if m in rule["do"][0]]) == 1,
          json.dumps(rule["do"][0]) if rule else "fehlt")

    rule = by_name.get("string_als_vergleichswert")
    check("String als Vergleichswert wird ersetzt",
          rule and not isinstance(rule["when"][0].get("value"), str),
          json.dumps(rule["when"][0]) if rule else "fehlt")

    rule = by_name.get("unvollstaendige_parameterreferenz")
    value = rule["when"][0].get("value") if rule else None
    check("Unvollstaendige Parameterreferenz wird nicht durchgereicht",
          not isinstance(value, dict) or (
              isinstance(value.get("param_of_state"), int) and value.get("key")),
          json.dumps(value))

    rule = by_name.get("unbekannte_enums")
    check("Unbekannte Enums fallen auf gueltige Werte zurueck",
          rule and rule["group"] in RULE_GROUP
          and rule["when"][0]["src"] in RULE_SRC and rule["when"][0]["op"] in RULE_OP,
          json.dumps({"group": rule["group"], "cond": rule["when"][0]}) if rule else "fehlt")

    rule = by_name.get("leere_listen")
    check("Leere when/do werden gefuellt, leere until/else_do weggelassen",
          rule and rule["when"] and rule["do"]
          and "until" not in rule and "else_do" not in rule,
          json.dumps({k: rule.get(k) for k in ("when", "do", "until", "else_do")})
          if rule else "fehlt")

    rule = by_name.get("cross_regel")
    check("Cross-Regel traegt execution_scope 'cross:<owner>.default'",
          rule and rule.get("execution_scope") == "cross:fn-01.default",
          rule.get("execution_scope") if rule else "fehlt")

    return rules


def test_shipped_configs():
    """Die ausgelieferten Configs muessen denselben Vertrag erfuellen."""
    paths = [CONFIG] + sorted((ROOT / "config" / "shards").glob("*.json"))
    for path in paths:
        config = json.loads(path.read_text(encoding="utf-8"))
        engine = (config.get("rule_engine") or [{}])[0]
        writable = set(engine.get("writable_fields") or [])
        meta = (config.get("meta") or [{}])[0]
        profile = "cross" if meta.get("version") == 8 else "v9"
        errors = []
        notes = []
        for rule in config.get("rules") or []:
            rule_errors, rule_notes = audit_rule(rule, writable, path.name, profile)
            errors.extend(rule_errors)
            notes.extend(rule_notes)
        check("Regelvertrag erfuellt: %s" % path.name, not errors,
              "\n      " + "\n      ".join(errors[:8]))
        for note in notes:
            print("   Hinweis: %s" % note)


def test_library():
    """Auch die Bausteinvorlagen muessen den Vertrag erfuellen."""
    path = ROOT / "config" / "rule_library_v9.json"
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    writable = {"value_id", "parameters"}
    errors = []
    for item in payload.get("templates") or []:
        rule = dict(item.get("rule") or {})
        # Vorlagen tragen bewusst null-Identitaeten; sie werden beim Einfuegen
        # gefuellt. Fuer die Vertragspruefung werden sie plausibel belegt.
        rule["rule_id"] = rule.get("rule_id") or 1
        rule["owner_node_id"] = rule.get("owner_node_id") or "fn-01"
        rule["execution_owner"] = rule.get("execution_owner") or "fn-01"
        rule["execution_scope"] = rule.get("execution_scope") or "node:fn-01"
        for bucket in ("when", "until"):
            for cond in rule.get(bucket) or []:
                if cond.get("src") == "sensor":
                    cond.setdefault("sensor_id", 1)
                    if not cond.get("controller_uuid"):
                        cond["controller_uuid"] = "00000000-0000-5000-8000-000000000000"
                if cond.get("src") == "state":
                    cond["state_id"] = cond.get("state_id") or 1
                value = cond.get("value")
                if isinstance(value, dict) and not value.get("param_of_state"):
                    value["param_of_state"] = 1
        for bucket in ("do", "else_do"):
            for action in rule.get(bucket) or []:
                for field in ("state_ids", "p_ids"):
                    if field in action and not action[field]:
                        action[field] = [1]
        rule_errors, _ = audit_rule(rule, writable, "Vorlage")
        errors.extend(rule_errors)
    check("Bausteinvorlagen erfuellen den Regelvertrag", not errors,
          "\n      " + "\n      ".join(errors[:10]))


def test_runtime_deep(config, rules):
    """Tiefpruefung: die Factory-Regeln durch die echte Type-Authority schicken."""
    try:
        from src.library._generic_type_library import (  # noqa: PLC0415
            verify_storage_config_data)
    except Exception:  # noqa: BLE001
        print("   Hinweis: Runtime nicht im PYTHONPATH — Tiefpruefung uebersprungen.")
        return

    baseline = verify_storage_config_data(config)
    check("Ausgelieferte Config besteht die Runtime-Type-Authority",
          baseline.get("status") == "OK",
          json.dumps((baseline.get("errors") or [])[:3], ensure_ascii=False))

    # Nur die Regeln austauschen, die sich mit den vorhandenen Entitaeten
    # aufloesen lassen — der Rest der Config bleibt unveraendert.
    state_ids = {row.get("state_id") for row in config.get("process_states") or []}
    value_ids = {row.get("value_id") for row in config.get("process_values") or []}
    sensor_keys = {(row.get("controller_uuid"), row.get("sensor_id"))
                   for row in config.get("sensors") or []}

    def resolvable(rule):
        for bucket in ("when", "until"):
            for cond in rule.get(bucket) or []:
                if cond.get("src") == "sensor" \
                        and (cond.get("controller_uuid"), cond.get("sensor_id")) not in sensor_keys:
                    return False
                if cond.get("src") == "state" and cond.get("state_id") not in state_ids:
                    return False
                if cond.get("src") == "timer":
                    return False
                value = cond.get("value")
                if isinstance(value, dict) and value.get("param_of_state") not in state_ids:
                    return False
        for bucket in ("do", "else_do"):
            for action in rule.get(bucket) or []:
                if not set(action.get("state_ids") or []) <= state_ids:
                    return False
                if action.get("value_id") is not None \
                        and action["value_id"] not in value_ids:
                    return False
        return True

    candidates = [rule for rule in rules if resolvable(rule)]
    check("Mindestens die Haelfte der Factory-Regeln ist im Bestand aufloesbar",
          len(candidates) >= len(rules) // 2, "%d/%d" % (len(candidates), len(rules)))

    for index, rule in enumerate(candidates):
        probe = json.loads(json.dumps(config))
        merged = dict(rule)
        merged["rule_id"] = 9000 + index
        # Parameterreferenzen muessen auf einen existierenden Schluessel zeigen.
        for bucket in ("when", "until"):
            for cond in merged.get(bucket) or []:
                value = cond.get("value")
                if not isinstance(value, dict):
                    continue
                state = [row for row in probe["process_states"]
                         if row.get("state_id") == value.get("param_of_state")]
                if state and value.get("key") not in (state[0].get("parameters") or {}):
                    state[0].setdefault("parameters", {})[value["key"]] = 0.0
        probe["rules"] = list(probe["rules"]) + [merged]
        report = verify_storage_config_data(probe)
        check("Runtime akzeptiert Factory-Regel '%s'" % rule.get("name"),
              report.get("status") == "OK",
              json.dumps((report.get("errors") or [])[:4], ensure_ascii=False))


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    rules = test_factory_rules(config)
    test_shipped_configs()
    test_library()
    test_runtime_deep(config, rules)

    print("bestanden: %d | fehlgeschlagen: %d" % (PASSED[0], len(FAILURES)))
    if FAILURES:
        for item in FAILURES:
            print("  FEHLER: " + item)
        return 1
    print("REGELVERTRAG BESTANDEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
