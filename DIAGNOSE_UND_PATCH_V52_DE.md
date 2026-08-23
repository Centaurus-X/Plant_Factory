# Automated_SVG_Integration — Diagnose, IST/SOLL und Patch-Dokumentation V52

**Ausgangsstand:** `Automated_SVG_Integration_50`
**Zielstand:** `Automated_SVG_Integration_52`
**Referenzsysteme:** `automation_system_v0101` (Worker-Runtime), `automation_control_plane_release_v0025_r1` (Master/Control Plane), `AUTOMATION_AUTHORITY_V005_DOCUMENTATION`, `ARCHITEKTUR_V0101_DIAGRAMME`
**Vorgehen:** minimal-invasiv und additiv — die Bestandsmodule bleiben lauffähig, die V9-Konformität kommt über eine neue Schicht davor.

---

## Inhalt

1. [Executive Summary](#1-executive-summary)
2. [Diagnose der V50-Implementierung](#2-diagnose-der-v50-implementierung)
3. [SOLL: der kanonische V9-Vertrag](#3-soll-der-kanonische-v9-vertrag)
4. [Delta-Matrix V50 → V9](#4-delta-matrix-v50--v9)
5. [Umgesetzte Änderungen](#5-umgesetzte-änderungen)
6. [Behobene Fehler im Bestandscode](#6-behobene-fehler-im-bestandscode)
7. [UI/UX-Überarbeitung](#7-uiux-überarbeitung)
8. [Verifikation](#8-verifikation)
9. [Bekannte Grenzen und offene Punkte](#9-bekannte-grenzen-und-offene-punkte)
10. [Empfohlenes weiteres Vorgehen](#10-empfohlenes-weiteres-vorgehen)
11. [Anhang: Dateiverzeichnis und API](#11-anhang-dateiverzeichnis-und-api)

---

## 1. Executive Summary

`Automated_SVG_Integration_50` erzeugt Konfigurationen, die die aktuelle Runtime **nicht mehr laden kann**. Die Ursache ist kein Detailfehler, sondern ein Generationsbruch: der Editor schreibt das Vor-V9-Schema mit 31 Sektionen, `automation_system_v0101` verlangt exakt 26 andere. `config_sharding_contracts.decompose()` lehnt sowohl fehlende als auch zusätzliche Sektionen hart ab — 14 der vom Editor erzeugten Sektionen existieren im Vertrag nicht mehr, 9 vertraglich vorgeschriebene fehlen vollständig.

Dazu kommen drei strukturelle Altlasten:

* **Kein Identitätsmodell.** V9 identifiziert I/O über `(controller_uuid, lokale sensor_id)`. Der Editor kennt nur einen globalen `controller_id`-Zähler.
* **Drei konkurrierende Regelmodelle im UI** (`dynamic_rule_engine`, `automation_rule_sets`, HMI-Conditions), die keinen Code teilen und alle drei nicht V9-legal sind.
* **Drei unabhängige Ladevorgänge derselben Config**, die sich im AppState gegenseitig überschreiben.

**V52 löst das additiv.** Eine neue V9-Schicht (13 Module, ~11.200 Zeilen) übernimmt Vertrag, Factories, Migration, Validierung und Bedienung. Die 15 Bestandsmodule bleiben unverändert lauffähig, weil ihnen der Server dieselbe V9-Wahrheit in ihrer gewohnten Feldform ausliefert (Editor-Projektion). Zusätzlich wurden 12 konkrete Fehler im Bestandscode chirurgisch behoben.

**Ergebnis, gegen die echte Runtime geprüft:**

| Prüfung | Ergebnis |
|---|---|
| `verify_storage_config_data()` der Type Authority v0101 | **OK — 0 Fehler, 0 Warnungen** |
| `verify_roundtrip()` der Entity-Registry | **OK — 176 Entities, verlustfrei** |
| Kern-Regressionstests (`test/test_v9_core.mjs`) | **64 / 64** |
| UI-Smoke-Test (`test/smoke_ui.mjs`, headless) | **57 / 57** |
| Fingerprint-Stabilität über den Editor-Roundtrip | **identisch** |

---

## 2. Diagnose der V50-Implementierung

### 2.1 Architektur (IST)

```
Browser (ES-Module, kein Build, keine Abhängigkeiten)
  core.js ─ registry.js ─ elements.js ─ connection_mapper.js
          ├ ui.js ─ model_adapter.js / json_formator.js
          ├ device.js       ─┐
          ├ processes.js    ─┼─ laden ALLE dreimal /api/device-config
          ├ rules_generator ─┘
          ├ hmi.js (4.298 Z.)
          └ automation_tabs.js (dyn. Import)
  hmi_runtime.js  ← von KEINEM Modul importiert
Server: svg_editor_tool.py (aiohttp, Port hartkodiert)
```

15 JS-Module, ~20.300 Zeilen (JS+CSS+HTML), davon rund **950 Zeilen auskommentierter Alt-Code** aus vier Patch-Generationen.

### 2.2 Kernbefunde

#### B-K1 · Config-Schema ist zwei Generationen alt

`config/___device_state_data.json` schreibt `node_registrar`, `controller_node_bindings`, `event_types`, `parameter_schemas`, `state_type_parameter_schema_mappings`, `automation`, `automation_engines`, `automation_filters`, `automation_rule_sets`, `triggers`, `actions`, `transitions`, `events`, `dynamic_rule_engine`. **Keine dieser 14 Sektionen existiert im V9-Vertrag.** Umgekehrt fehlen `meta`, `sites`, `local_node`, `site_controller_map`, `parameter_generic_templates`, `schema_mappings`, `rule_engine`, `rules`, `filters` komplett.

Es gibt in der Datei nicht einmal einen `meta`-Block — die Runtime kann die Version also gar nicht bestimmen und bricht bereits in `verify_meta()` ab.

#### B-K2 · Kein Identitäts- und Routingmodell

V9 (`_generic_type_library.py:1952-1957`): *„Identity model: controller_uuid + local sensor_id/actuator_id; Routing model: site_id + node_id + local_controller_id."*

Der Editor kennt nichts davon. Sensoren tragen nur `controller_id`, Prozess-States referenzieren I/O über flache `sensor_ids[]`/`actuator_ids[]`. Damit ist weder die Zuordnung zu einem Worker möglich noch die Scope-Klassifikation (`local_controller` / `cross_controller` / `cross_worker`), von der abhängt, ob eine Regel überhaupt node-lokal ausführbar ist.

`model_adapter.js:587-588` **leert** `nodes` und `controller_node_bindings` beim Export sogar aktiv — der Editor hat die Topologie also nie transportiert.

#### B-K3 · Drei unverbundene Regelmodelle, keines V9-legal

| Modell | Ort | Felder | V9-Status |
|---|---|---|---|
| A `dynamic_rule_engine` | `rules_generator.js` | `condition{type,operator,value}` / `action{type,…}`, Condition-Typen `sensor`, `state_type`, `compound`, `expression` | Sektion existiert nicht mehr |
| B `automation_rule_sets` | `automation_tabs.js` | `when_all/when_any/when_none`, `do/else_do`, nur `state_value` + `sensor_threshold`, nur `actuator_set` | Sektion existiert nicht mehr |
| C HMI-Conditions | `hmi.js`, `hmi_runtime.js` | `sensor_cmp`/`actuator_cmp`/`signal_cmp` mit `op` | betrifft nur die Visualisierung |

V9 kennt genau ein Modell: `rules[]` mit `when[]`/`until[]`/`do[]`/`else_do[]`, Quellen `state|sensor|timer`, Operatoren `== != > >= < <= elapsed fired`, Aktionen mit genau einem Marker `state_ids | p_ids | notify`.

Besonders folgenreich:
* Modell B kennt als einzige Aktion `actuator_set` — **V9 schreibt niemals direkt auf Aktoren**, sondern setzt `value_id` an Prozess-States; die Aktorauflösung macht die Runtime über `io_refs`.
* Modell A erlaubt Formel-Strings als Vergleichswert (`"target_temp*0.98"`). V9 lässt als `value` nur `number`, `bool` oder `{param_of_state, key[, scale]}` zu — verifiziert: `"abc"` → *no union alternative matched*.
* Beide kennen die V9-Pflichtfelder `owner_node_id`, `execution_owner`, `execution_scope`, `execution_epoch`, `deployment_status`, `activation_state`, `group`, `priority` nicht.

#### B-K4 · Prozess-States: zwei konkurrierende Schemata im selben Projekt

`processes.js:525-535` schreibt das Editor-Legacy-Schema (`p__type`, `sensor_id[]`, `actuator_id[]`, `automation_parameters{}`), die Config und `model_adapter.js` nutzen das Runtime-Schema (`state_type`, `sensor_ids[]`, `parameters{}`, `control_strategy{}`). Die Konsumenten reagieren uneinheitlich: `automation_tabs.js:363` kennt beide, `hmi.js:301` und `rules_generator.js:258` nur `state_type` — eigene Prozess-States erscheinen dort namenlos als „State 20".

Nicht im UI vorhanden, obwohl vertraglich Pflicht bzw. relevant: `mapping_id`, `io_refs`, `control_strategy` (nur indirekt synthetisiert), `setpoint_source` (tot durchgereicht), `initial_value_id`. `p_groups` ist im UI editierbar, wird aber beim Export **verworfen**.

#### B-K5 · Keine Config-Validierung vor dem Export

`model_adapter.js:914` prüft eine Handvoll Struktureigenschaften. Referenzintegrität, Enums, Wertebereiche, Eindeutigkeit, Routing- und Execution-Ownership werden nirgends geprüft. Fehler fallen erst beim Laden im Worker auf — dann aber fail-closed.

#### B-K6 · Keine Schreibmöglichkeit für die Gerätekonfiguration

Es gibt keinen POST-Endpunkt für `___device_state_data.json`. Geänderte Controller und Schemata landen ausschließlich als `device_config_overrides` im Projekt-JSON — und auch das nur, wenn das jeweilige Array **nicht leer** ist (`ui.js:52`): löscht man alle Einträge, gewinnt beim nächsten Laden wieder die Serverdatei.

#### B-K7 · Verstreute Objekterzeugung statt Factory-Schicht

64 Stellen erzeugen Config-Objekte als handgeschriebene Literale, über acht Dateien verteilt — u. a. `defaultRule()` (`automation_tabs.js:1030`), `buildRuleFromWizard()` (`rules_generator.js:1012`), `handleAdd()` (`processes.js:525`), `buildStandardExportSkeleton()` (`model_adapter.js:537`), fünf Widget-Templates, drei Condition-Fabriken. Zwei davon sind exakte Copy-&-Paste-Klone (`hmi.js:2198` ≡ `hmi.js:2489`). Ein neues Vertragsfeld müsste an bis zu sieben Stellen nachgezogen werden.

#### B-K8 · Utility-Duplikate

`deepClone` 6×, `byId` 4×, `toNumberOrNull` 4× (in drei unterschiedlichen Implementierungen), `escapeHtml` 3× (eine davon fehlerhaft), `ensureArray` 3×, `isPlainObject` 3×, `computeAnchorPoint` 2×, `widgetPreviewLabel` 2× — insgesamt 25 Kopien.

#### B-K9 · Drei konkurrierende Ladevorgänge

`device.js:83`, `rules_generator.js:290` und `processes.js:32` laden je eigenständig `/api/device-config` und rufen anschließend `state.set('deviceConfig', …)`. Drei identische HTTP-Requests, und eine echte Race Condition: schreibt der Nutzer über den Controller-Inline-Editor, kann ein später eintreffender Response diesen Stand samt `deviceConfigUserEdited` überschreiben.

### 2.3 Vollständige Fehlerliste (Bestandscode)

| ID | Datei:Zeile | Symptom |
|---|---|---|
| B-1 | `ui.js:824, 868` | `findNodeById` **existiert nicht** → jeder Export verliert stillschweigend alle `data-hmi-*`-Attribute |
| B-2 | `processes.js:495` | ID-Suche mit Bindestrich, Felder heißen mit Unterstrich → `heating_temp`, `cooling_temp`, `flow_rate`, `reflux_rate` werden nie übernommen |
| B-3 | `processes.js:344` | kein `change`-Listener auf `#pf-ptype` → Parameterfelder bleiben beim Typwechsel stehen |
| B-4 | `processes.js:508` | `Number.isNaN(null) === false` → `pid_parameters` wird immer geschrieben, notfalls als `{kp:null,…}` |
| B-5 | `connection_mapper.js:479-491` | Division durch 0 bei exakt achsparallelen Elementen → `d="M NaN,NaN"`, Verbindung verschwindet |
| B-6 | `index.html:136-141` | `marker-end="url(#arrowhead)"` referenziert einen Marker, den es nicht gibt |
| B-8 | `hmi.js:4262` | `String(s \|\| '')` macht aus der Zahl `0` einen Leerstring → betrifft dx/dy, decimals, offset, priority, Schwellen |
| B-9 | `automation_tabs.js:550, 658` | `ensureArray(undefined)` liefert ein neues, nicht verlinktes Array → Eingaben in `when_any`/`when_none`/`else_do` gehen verloren |
| B-11 | `model_adapter.js:653-662` | Sensor-Sammler ignoriert `compound`-Bedingungen → `cfg.sensors` unvollständig |
| B-13 | `svg_editor_tool.py:253` | Pfad-Traversal: `GET /api/laden?name=../../etc/passwd` |
| B-15 | `ui.js:944` | Export-Bundle referenziert `hmi_runtime.js`, legt sie aber nicht bei |
| B-25 | `elements.js:1045 ff.` | State-Key heißt `currentTool`, gelesen wird `tool` → Element-Drag auch im Hand-Werkzeug aktiv |
| B-33 | `rules_generator.js:1030, 1070` | `sensor_id = 0` wird als falsy abgelehnt |
| B-34 | `processes.js:344` | Auto-ID-Button liefert immer denselben Wert |

Weitere, nicht gepatchte Befunde (siehe [§9](#9-bekannte-grenzen-und-offene-punkte)): B-7 (Port-Auswahl ohne Wirkung), B-14 (toter Preview-Runtime-Pfad), B-24 (Formular-Neuaufbau bei jedem Drag-Frame), B-27/B-28 (Undo-Lücken), B-30/B-31 (Doppelrendern, Stale-Snapshot), B-32 (unerreichbarer Library-Zweig).

### 2.4 CSS/HTML

`@keyframes hmi-blink` dreifach mit **unterschiedlichen** Werten (0.4 vs. 0.35), `.hmi-anim-blink` dreifach, `.hidden` doppelt (einmal mit `!important`), `#sidebar-right.collapsed .collapse-icon` doppelt, ein leerer Platzhalter-Selektor, ein leerer Regelblock, 17 Zeilen auskommentierter Scrollbar-Block. `<link rel="stylesheet">` steht doppelt im Dokument, das zweite Mal **im `<header>`-Element**. Die Klassen `.text-input`, `.form-row`, `.small` werden verwendet, sind aber nie definiert. `--sidebar-right-remember: 0` deaktiviert die Breitenpersistenz per Token.

Über 60 hartkodierte Farbwerte stehen außerhalb des Token-Systems.

---

## 3. SOLL: der kanonische V9-Vertrag

**Autoritäten:** `_generic_type_library.py` (`TYPE_SCHEMA_VERSION 2.0.0`), `_generic_system_contract_library/` (`CONTRACTS_VERSION 2.0`), `CANONICAL_VERSION = 9`.

### 3.1 Sektionen — exakt 26, keine mehr, keine weniger

```
meta · local_node · sites · nodes · site_controller_map · modbus_functions ·
scaling_profiles · controllers · virtual_controllers · sensors · actuators ·
sensor_types · actuator_types · parameter_generic_templates · schema_mappings ·
processes · process_values · process_modes · pid_configs ·
control_method_templates · control_methods · process_states · rule_engine ·
filters · timers · rules
```

`decompose()` (`config_sharding_contracts.py:140-187`) wirft bei Abweichung `missing config sections` bzw. `unsupported config sections`.

### 3.2 Identität und Routing

| Achse | Feld | Bedeutung |
|---|---|---|
| Harte I/O-Identität | `(controller_uuid, sensor_id)` / `(controller_uuid, actuator_id)` | einzige gültige Referenzform |
| Controller-Identität | `controller_uuid` | global stabil, Entity-Key `controller:<uuid>` |
| Controller-Alias | `controller_key` | muss in `controllers`, `site_controller_map` und I/O **exakt** übereinstimmen |
| Lokaler Slot | `local_controller_id` | node-lokal, darf je Node bei 1 neu beginnen |
| Deployment | `node_id`, `site_id` | Ownership-Ebene |
| Route-Name | `route_key` | muss `"<site>.<node>.ctrl_<local_id>"` sein |
| Routing-Rolle | `routing_role ∈ owner\|mirror\|standby` | genau **eine** aktivierte `owner`-Route je `controller_uuid` |

### 3.3 rules — die harten Enums

```
src               state | sensor | timer
op                == | != | > | >= | < | <= | elapsed | fired
value             number | bool | {param_of_state:int, key:str [, scale:num]}
group             process | safety | notify
activation_state  staged | active | retiring | inactive
deployment_status active_node | active_cross | replaced_local | monitor_only |
                  disabled_with_reason
Aktion            genau ein Marker: state_ids | p_ids | notify
                  (Nutzlast: value_id, parameters)
```

Pflicht für **jede** V9-Regel (`_verify_rule_execution_metadata` :2571-2603): `activation_state`, `deployment_status`, `execution_epoch`, `execution_owner`, `execution_scope` — zusätzlich `owner_node_id`. Bei `scope=node_local` muss `execution_scope == "node:<meta.node_id>"` sein.

> **Wichtig:** Die Runtime-Engine registriert deutlich mehr Operatoren (`in`, `between`, `near`, `regex`, `changed`, …) und Quellen (`fact`, `const`) sowie Konditionsbäume (`all/any/none/xor/not`). **Nichts davon ist config-legal.** Empirisch bestätigt: `op:"in"` → *value 'in' not in enum*, `src:"fact"` → *value 'fact' not in enum*.

### 3.4 process_states

Alle 9 Felder sind Pflicht: `state_id`, `p_id`, `value_id`, `mode_id`, `mapping_id`, `io_refs`, `control_strategy`, `setpoint_source`, `parameters`.

* `io_refs` = `{sensors:[{sensor_id, controller_uuid}], actuators:[{actuator_id, controller_uuid}]}` — beide Keys Pflicht, beide Felder je Referenz Pflicht.
* `control_strategy` ist eine Union aus **genau zwei** Varianten plus `null`: `{type:"PID", pid_config_id}` oder `{type:"control_method", method_id}`. `{"type":"ONOFF"}` ist **nicht** gültig — die Runtime wählt ONOFF selbst per Auto-Detect über `write_coil`-Aktoren.
* `value_id`: nur `1` gilt der Runtime als aktiv (`DEFAULT_ACTIVE_VALUE_IDS = {1}`).
* `mode_id`: die Rule-Engine schreibt **nur**, wenn `mode_id == rule_engine.required_mode_id`; sonst `status: "skipped_mode"`.
* `setpoint_source`: Typ `any`, aber nur für die Scope-Klassifikation relevant. Der reale Sollwert kommt aus `parameters` (`target_temp_c`, `target_temp`, `target_bar`, …).

### 3.5 Authority V5 — warum der Fingerprint zählt

Die normative Fencing-Identität ist `(authority_epoch, scope_revision, execution_epoch, fingerprint)`. `config_fingerprint()` hasht die **kanonischen Storage-Bytes**. Fingerprint-Gleichheit legitimiert weder eine Revisionserhöhung noch einen Owner-Wechsel; Abweichungen führen zu `stale_revision` / `authority_epoch_stale` / `execution_epoch_stale`.

Für den Editor heißt das: eine Konfiguration, die er speichert, muss **byte-identisch kanonisch** sein — sonst erzeugt jeder Speichervorgang eine scheinbare Änderung. Siehe [§5.6](#56-fingerprint-stabilität).

---

## 4. Delta-Matrix V50 → V9

### 4.1 Sektionen

| V50 | V9 | Art der Änderung |
|---|---|---|
| — | **`meta`** | neu, Pflicht-Singleton (schema/version/scope/description/node_id) |
| — | **`sites`** | neu |
| `nodes` (leer exportiert) | **`nodes`** | jetzt befüllt, `node_role`-Enum |
| `node_registrar` | — | **entfällt ersatzlos** (Admission ist Master-Sache) |
| `controller_node_bindings` | **`site_controller_map`** | ersetzt: Route-Tupel mit `route_key`, `routing_role`, `controller_uuid` |
| — | **`local_node`** | neu, Laufzeit-Ownership des Workers |
| `controllers` | `controllers` | **+ `controller_uuid`, + `controller_key`** (beide Pflicht) |
| `virtual_controllers` | `virtual_controllers` | `controller_id` → **`controller_uuid`** |
| `sensors` / `actuators` | `sensors` / `actuators` | flaches Layout; **+ `node_id`, `site_id`, `controller_uuid`, `controller_key`, `local_controller_id`, `enabled`**; `sensor_number`/`sensor_type` bzw. `actuator_number`/`actuator_type` **entfallen** |
| `parameter_schemas` | **`parameter_generic_templates`** | String-ID → int `schema_id`; **`fields[]` und `constraints[]` entfallen ersatzlos** |
| `state_type_parameter_schema_mappings` | **`schema_mappings`** | nur noch `(mapping_id, schema_id)`; `state_type`, `match`, `priority`, `is_default` entfallen |
| `processes` | `processes` | **+ `owner_node_id`** (Pflicht) |
| `process_states` | `process_states` | `sensor_ids[]`/`actuator_ids[]` → **`io_refs`**; `parameter_schema_id` → **`mapping_id`**; `state_type` entfällt; `automation_parameters` → `parameters`; `control_strategy` auf 2 Varianten reduziert |
| `automation` | — | **entfällt ersatzlos** (V9 hat genau eine Engine) |
| `automation_engines` | **`rule_engine`** | Singleton; `engine_id` String → int; `debug_*`-Flachfelder → `debug{}`; `safety.*` → `safety.on_missing_sensor` / `on_invalid_pid`; **+ `runtime{}`**, **+ `writable_fields`**, **+ `required_mode_id`** |
| `automation_filters` | **`filters`** | `filter_id` String → int; `apply_to.sensor_ids` → **`sensor_refs[{controller_uuid, sensor_id}]`** |
| `automation_rule_sets` | **`rules`** (flach) | Rule-Set-Hierarchie entfällt; `process_scope{}`, `execution{}`, `flags{}` entfallen; `when_any[]`/`when_none[]` entfallen; **+ 6 Execution-Pflichtfelder** |
| `dynamic_rule_engine` | — | **entfällt ersatzlos** |
| `triggers`, `actions`, `transitions`, `events`, `event_types` | — | **entfallen ersatzlos** (Ersatz: `rules` + `timers`) |
| `timers` | `timers` | `duration` → **`duration_s`**; `frequency` → **`interval_s`**; **+ `at`, `cron`** |

### 4.2 Was die Migration konkret gefunden hat

`config/migration_report_v9.json` — 56 Einträge:

| Art | Anzahl | Beispiele |
|---|---|---|
| `breaking` | 24 | Sektionswegfall, `actuator_set` ohne V9-Entsprechung, `when_any`/`when_none`, Formel-Vergleichswerte, `ONOFF` |
| `repair` | 11 | `write_data` → `write_register`, `PI/PD` → `PID`, fehlende Controller/Prozesse provisioniert |
| `info` | 20 | additive Feldergänzungen mit Zählwerten |
| `error` | 1 | eine Regel ohne V9-abbildbare Bedingung |

**Zwei echte Datenfehler in der V50-Basis** — beide werden repariert statt still zu verwerfen:

1. Die Aktoren 10, 11 und 12 referenzieren `controller_id: 5`, den es in `controllers` nie gab. → Platzhalter-Controller `ctrl_unconfigured_5` mit `host 0.0.0.0` (Adresse nachtragen!).
2. `process_states[state_id=17]` referenziert `p_id: 6`, den es in `processes` nie gab. → Platzhalter-Prozess `unconfigured_process_6`.

Ohne diese Provisionierung (`--no-provision-missing`) verlöre die Migration 3 Aktoren und 1 Prozess-State.

**Nicht abbildbare Inhalte** (bewusst verworfen, im Report protokolliert):

* `parameter_schemas.fields[]` / `constraints[]` — V9 kennt keine Parametergrenzen in der Config; die prüft `_config_safety_policy` zur Laufzeit.
* Formel-Vergleichswerte wie `"target_temp*0.98"` — V9-Ersatz ist `{param_of_state, key, scale}`.
* `emergency_shutdown` / `state_override` — V9-Äquivalent ist eine `safety`-Gruppenregel mit `state_ids` + `value_id`.
* `when_any[]` / `when_none[]` — V9 kennt nur `when[]` (UND) und `until[]`.

---

## 5. Umgesetzte Änderungen

### 5.1 Punkt 1 — flache Ordnerstruktur für JS und CSS

**Vorher:** `public/js/*.js` flach, `public/style.css` daneben, `public/_old_/`, `public/svg_templates/_old_/`, `svg_konverter/_old_/`.

**Nachher:**

```
public/
├── css/                   ← FLACH, eine Ebene, feste Ladereihenfolge
│   ├── tokens.css         (Design-Tokens, muss zuerst)
│   ├── style.css          (Bestand, unverändert)
│   ├── layout.css         (V52-Aufwertung der Bestandsoberfläche)
│   └── components.css     (V52-Komponentenbibliothek, Präfix v9-)
└── js/                    ← FLACH, eine Ebene
    ├── core.js … automation_tabs.js      (15 Bestandsmodule)
    ├── shared_utils.js                   (ersetzt 25 Duplikate)
    └── v9_*.js                           (13 V9-Module)
```

Namenskonvention: `v9_<schicht>[_<gegenstand>].js` — `v9_schema`, `v9_uuid`, `v9_factory`, `v9_migrate`, `v9_validate`, `v9_shard`, `v9_store`, `v9_dom`, `v9_ui_topology`, `v9_ui_states`, `v9_ui_rules`, `v9_ui_validate`, `v9_bootstrap`.

Die drei `_old_`-Verzeichnisse mit 26 Altdateien wurden entfernt, die Legacy-Configs nach `config/_legacy/` verschoben.

### 5.2 Punkt 3 — neue Config statt alter, UI entsprechend angepasst

| Datei | Inhalt |
|---|---|
| `config/device_state_data_v9.json` | **kanonische V9-Config**, `scope: master_global`, 26 Sektionen, 176 Entities |
| `config/device_state_data_v9_node_fn-01.json` | Node-Shard, `scope: node_local` |
| `config/migration_report_v9.json` | vollständiges Änderungsprotokoll der Migration |
| `config/_legacy/___device_state_data.json` | Ausgangsdatei, unverändert aufbewahrt |

Erzeugt und reproduzierbar durch `_tools/migrate_config_to_v9.py` (kein OOP, `functools.partial`, datengetriebene Regeltabellen). Der Browser hat mit `public/js/v9_migrate.js` einen funktional identischen Zwilling — ein Nutzer kann eine alte Config einfach in den Editor laden und bekommt sie migriert samt Protokoll.

Vier neue Tabs bedienen den Vertrag direkt:

* **Topologie** — Sites, Nodes, Routen (`route_key`, `routing_role`, `controller_uuid`), Controller, Sensoren, Aktoren; je I/O eine Verwendungsanzeige („State 3, Regel 1" / „ungenutzt").
* **States V9** — Prozesse und Prozess-States mit `io_refs`-Mehrfachauswahl, `mapping_id`, editierbarer `control_strategy`, sichtbarem `setpoint_source`, Scope-Badge und Mode-Gate-Warnung.
* **Rules V9** — `rule_engine`-Singleton plus flache Regeltabelle mit Lifecycle-Badges, Bedingungs- und Aktionseditor, Filter und Timer.
* **Validierung** — Kontraktprüfung, Scope-Klassifikation, Node-Shard-Vorschau mit Download, Migrationsprotokoll, Sektionsübersicht.

### 5.3 Punkt 4 — vollständig überarbeitete Config-Factories

Die 64 verstreuten Objektliterale werden durch eine dreistufige, schemagetriebene Factory-Schicht ersetzt (`v9_factory.js`, 830 Zeilen):

**Ebene 1 — generisch.** `createEntity(section, patch)` liest die Felddefinition aus `v9_schema.SECTIONS`, erzeugt Defaults, erzwingt Typen (`coerceField`) und verwirft Fremdfelder. Ein neues Vertragsfeld erfordert **eine Zeile in `v9_schema.js`** — Defaults, Formulare und Validierung ziehen automatisch nach.

**Ebene 2 — spezialisiert.** 19 Factories mit Fachlogik, adressierbar über die Dispatch-Tabelle `FACTORY_BY_SECTION` bzw. `make(section, patch, ctx)`:

```js
createController      // leitet controller_key + controller_uuid deterministisch ab
createSensor          // erbt node_id/site_id/controller_uuid aus der Route
createProcessState    // löst io_refs aus lokalen IDs auf, normiert control_strategy
createRule            // setzt alle 6 Execution-Pflichtfelder konsistent
createCondition       // erzwingt src/op-Enums, repariert Aliase (ge → >=)
createAction          // erzwingt genau einen Handler-Marker
createControlStrategy // reduziert auf PID | control_method | null
createTimer           // duration → duration_s, frequency → interval_s
…
```

**Ebene 3 — transaktional.** `addEntity` / `updateEntity` / `removeEntity` arbeiten auf einer Kopie, pflegen alle Derivate über `reconcile()` (route_key, local_node, I/O-Routingmetadaten, execution_scope) und kaskadieren Löschungen: ein entfernter Controller nimmt Routen, virtuelle Controller, Sensoren, Aktoren, `io_refs`-Einträge, Filter-Referenzen und verwaiste Regeln mit.

Dazu `createEmptyV9Config()` — erzeugt aus dem Nichts eine Config, die die Runtime-Type-Authority ohne weitere Eingriffe akzeptiert (21 Entities, verifiziert).

**Deterministische Identität.** `controller_uuid = uuid5(uuid5(NAMESPACE_URL, "urn:automation:controller"), "<site>/<node>/<controller_key>")`. In JavaScript (eigenes SHA-1, synchron, ohne SubtleCrypto) und Python bitgleich implementiert — inklusive UTF-8-Umlauten, per Regressionstest abgesichert. Die vier Controller der ausgelieferten Runtime-Baseline sind gepinnt, damit V52-Configs mit `automation_system_v0101` interoperabel bleiben.

### 5.4 RuleEngine und ProcessStates im UI

**RuleEngine.** Das UI erzwingt die Enums an der Quelle statt sie beim Export zu reparieren: `src` und `op` sind Auswahlfelder aus `v9_schema.ENUMS`, `value` akzeptiert Zahl, Boolean oder `{param_of_state,key,scale}` — Formelstrings werden gar nicht erst angeboten. Aktionen wählen genau einen Handler-Marker. Lifecycle (`activation_state`, `deployment_status`, `execution_epoch`) ist explizit editierbar; das Aktiv-Häkchen setzt die vier zusammenhängenden Felder konsistent. `disabled_with_reason` erzwingt einen `disabled_reason`. Kritische Regelgruppen werden rot markiert, sobald ihr Scope cross wird.

**ProcessStates.** `io_refs` als Mehrfachauswahl mit automatischer `controller_uuid`-Auflösung; `mapping_id` mit angezeigtem Ziel-`state_type`; `control_strategy` als Union-Auswahl mit kontextabhängigen Feldern; `parameters` und `setpoint_source` als validierte JSON-Felder mit Hinweis auf die Sollwert-Schlüsselreihenfolge; Scope-Badge und Mode-Gate-Hinweis je Zeile.

### 5.5 Ein Ladevorgang statt drei

`v9_store.js` lädt genau einmal (`load()` gibt bei Folgeaufrufen dasselbe Promise zurück) und stellt die Editor-Projektion in `state.deviceConfig` bereit. Die Bestandsmodule laden weiterhin `/api/device-config` — der Server liefert dort jetzt die **Projektion der V9-Config** statt der Legacy-Datei. Alt- und Neu-UI sehen damit garantiert denselben Stand, ohne dass eine einzige Zeile in `device.js`, `processes.js` oder `rules_generator.js` geändert werden musste.

Zusätzlich: Undo/Redo für Config-Mutationen (60 Schritte), `beforeunload`-Schutz, `Ctrl+Alt+Z/Y/S`.

### 5.6 Fingerprint-Stabilität

JavaScript kennt nur einen Zahlentyp: `JSON.stringify(1000.0)` liefert `1000`. Der Runtime-Fingerprint hasht die kanonischen JSON-Bytes — `1000.0` und `1000` sind darin **verschieden**. Eine im Browser gespeicherte Config bekäme also einen anderen Fingerprint als dieselbe Config aus der Runtime, und Authority V5 würde den Commit als abweichend werten.

Gelöst an genau einer Stelle: der Server kanonisiert beim Schreiben (`_tools/canonicalize_v9_config.py`).

1. Schemadeklarierte Gleitkommafelder an fester Position werden zu `float` gezwungen (`out_min`, `sp_tolerance`, `duration_s`, `alpha`, …).
2. Freie Maps (`control_methods.args`, `process_states.parameters`) lassen sich nicht per Typtabelle behandeln — dort greift `preserve_numeric_literals()`: ändert sich ein Zahlenwert **numerisch nicht**, behält er sein bisheriges Literal.

Nachgewiesen: Original → Editor-Projektion → Rückprojektion → Kanonisierung ergibt denselben Fingerprint `04bd44f1…`.

### 5.7 Server

| Endpunkt | Methode | Funktion |
|---|---|---|
| `/api/v9/config` | GET | kanonische V9-Config |
| `/api/v9/config` | POST | speichern: Sektionsprüfung → Kanonisierung → optionale Runtime-Tiefprüfung → Backup → schreiben |
| `/api/v9/shard/{node_id}` | GET | node_local-Projektion |
| `/api/v9/report` | GET | Sektionszählung, Verifikation, Fingerprint, Migrationsprotokoll |
| `/api/device-config` | GET | **Editor-Projektion** der V9-Config (Legacy-Sicht) |

Liegt `automation_system_v0101` im `PYTHONPATH`, prüft der Speicherpfad zusätzlich gegen die **echte** Type Authority und lehnt mit HTTP 422 ab (nachgewiesen: `op:"in"` → *value 'in' not in enum […]*). `force: true` erzwingt das Schreiben und markiert die Verifikation als `FAILED`. Ohne Runtime bleibt die Browser-Validierung maßgeblich.

Außerdem: `config/server.yaml` wird jetzt tatsächlich gelesen (war eine reine Doku-Attrappe — alle Werte lagen hartkodiert in `main()`), rollierende Backups unter `config/_backup/`, Pfad-Traversal geschlossen.

---

## 6. Behobene Fehler im Bestandscode

Alle Eingriffe sind einzeilig bis kurzblockig, jeweils mit `V52-Fix (B-n)` kommentiert.

| ID | Datei | Eingriff |
|---|---|---|
| **B-1** | `ui.js` | `findNodeById()` implementiert (Suchwurzel über `applyHmiDataAttributes` gesetzt, `CSS.escape`, mehrstufiger Fallback) — Exporte tragen wieder `data-hmi-*` |
| **B-2** | `processes.js` | `k.replace(/_/g,'-')` entfernt |
| **B-3** | `processes.js` | `change`-Listener auf `#pf-ptype` → `renderAutoFields()` |
| **B-4** | `processes.js` | `Number.isFinite()` statt `!Number.isNaN()` |
| **B-5** | `connection_mapper.js` | Nullteiler abgefangen, degenerierte BBox und deckungsgleiche Mittelpunkte behandelt, `Number.isFinite`-Schlussprüfung |
| **B-6** | `index.html` | `<marker id="arrowhead">` und `#arrowhead-open` in `<defs>` ergänzt (`context-stroke`, erben die Linienfarbe) |
| **B-8** | `hmi.js` | `String(s === null \|\| s === undefined ? '' : s)` |
| **B-9** | `automation_tabs.js` | fehlende Listen werden erkannt und mit Hinweis statt stillem Datenverlust behandelt |
| **B-11** | `model_adapter.js` | rekursiver Sensor-Sammler über `compound.conditions[]` (Tiefenlimit 8) |
| **B-13** | `svg_editor_tool.py` | `sicherer_projektname()` auch beim Laden und Listen |
| **B-15** | `ui.js` | Export lädt `hmi_runtime.js` nach und legt sie als 4. Datei bei |
| **B-25** | `elements.js` | 5× `state.get('tool')` → `state.get('currentTool')` |
| **B-33** | `rules_generator.js` | `nSid === null` statt `!nSid` |
| **B-34** | `processes.js` | Auto-ID-Button berechnet bei jedem Klick neu aus Projekt **und** Config |

---

## 7. UI/UX-Überarbeitung

### 7.1 Design-System (`css/tokens.css`)

Vollständige Tokenskala für Raster (8 px), Radien, Typografie, Flächen, Linien, Elevation, Bewegung und Semantik. Ein Akzent (Indigo), vier semantische Töne (`ok`/`warn`/`danger`/`info`) in je drei Ausprägungen (`--v9-<ton>` / `-fg` / `-bg`), sodass Text auf jeder Fläche mindestens 4,5:1 erreicht — in beiden Modi. Der Dark Mode ist keine Aufhellung, sondern eine eigene Slate-Palette (`#0b1220` … `#e8eefb`) mit gespiegelten Kontrastverhältnissen.

Die Bestands-Tokens (`--primary-color`, `--shadow-*`, `--border-color`) werden auf das neue System gehoben — dadurch profitieren **auch die Altpanels** sofort, ohne dass `style.css` angefasst wurde.

`prefers-reduced-motion` schaltet alle Übergänge ab.

### 7.2 Komponenten (`css/components.css`, `js/v9_dom.js`)

Karten, Toolbars, Tabellen mit klebendem Kopf, Badges, Pills, Statusstreifen, Formularfelder mit Label/Hinweis/Pflichtmarke, Modale mit Fokusfang und Escape, Toasts, Aufklappbereiche, Bedingungs-/Aktionszeilen.

**Kein `innerHTML`, keine Inline-Styles.** Jedes Element entsteht in `v9_dom.js` über `createElement` — HTML-Injection ist strukturell ausgeschlossen. (Die Altmodule interpolieren an sieben Stellen ungeprüfte Nutzereingaben in Template-Strings; die neuen Panels sind davon frei.)

### 7.3 Aufwertung der Bestandsoberfläche (`css/layout.css`)

Header, Footer, Sidebars, Toolbar und Tabs bekommen ruhigere Flächen, klare Trennlinien und eine konsistente Typo-Hierarchie. Der aktive Tab trägt eine Akzentkante, V52-Tabs sind zusätzlich markiert. Sichtbare Fokusringe auf allen bedienbaren Elementen, ein Skip-Link zum Zeichenbereich, vereinheitlichte Scrollbars, Responsive-Umbruch ab 900 px, Druckstile.

Nebenbei bereinigt: die dreifachen `hmi-blink`-Definitionen auf eine, `.hidden` eindeutig, die fehlenden Klassen `.text-input`/`.form-row`/`.small` nachgereicht, `--sidebar-right-remember` auf `1` (Breitenpersistenz war per Token deaktiviert), Standardbreite der rechten Sidebar 560 → 620 px.

### 7.4 Bedienbarkeit

* Statusabzeichen am Validierungs-Tab zeigt jederzeit Fehler-/Hinweiszahl.
* Jedes Vertragsfeld trägt einen Hinweistext, der die Runtime-Semantik erklärt („Die Rule-Engine schreibt nur bei `mode_id == required_mode_id`", „Ab `coordinator_min_priority` läuft die Aktion im Coordinator-Scope").
* Löschdialoge nennen die konkreten Folgen („Regel 1, 2 referenzieren diesen State").
* Undo/Redo, `beforeunload`-Schutz, Tastaturkürzel.
* Sortierbare, filterbare Tabellen mit tabellarischen Ziffern.

---

## 8. Verifikation

### 8.1 Testumfang

```
bash test_all.sh
```

| Stufe | Umfang | Ergebnis |
|---|---|---|
| 1 · Python-Syntax | 4 Dateien | ok |
| 2 · JavaScript-Syntax | 20 Dateien | ok |
| 3 · Migration reproduzierbar | Neuerzeugung == Auslieferung | ok |
| 4 · Kern-Regressionstests | 64 Prüfungen | **64/64** |
| 5 · UI-Smoke-Test (headless) | 57 Prüfungen | **57/57** |

### 8.2 Kern-Regressionstests (`test/test_v9_core.mjs`)

Schema-Konstanten · UUID-Determinismus inklusive RFC-4122-Vektor und Umlaut-Gleichheit mit Python · Factory-Defaults, Kaskaden, `reconcile` · Enum-Reparaturen (`ge` → `>=`, `"42,5"` → `42.5`, `src:"fact"` → `sensor`) · Ablehnung ungültiger `control_strategy` · Timer-Feldumbenennungen · Validator-Positiv- und Negativfälle (`execution_scope`-Bruch, Runtime-only-Operator, Fremdsektion, falscher `function_type`) · Browser-Migration gegen Python-Migration · **verlustfreier Editor-Projektions-Roundtrip** · Shard-Projektion · Scope-Klassifikation.

### 8.3 UI-Smoke-Test (`test/smoke_ui.mjs`)

Headless Chromium gegen den laufenden Server: keine Konsolen-, Page- oder Netzwerkfehler · alle vier Stylesheets geladen · Store gefüllt (26 Sektionen, 5 Controller, 6 Sensoren, 12 Aktoren, 15 States, 2 Regeln), Validierung `OK` · Editor-Projektion erreicht die Altmodule · alle 11 Tabs schalten um · alle vier V9-Panels rendern Karten **und Datenzeilen** · Dialoge öffnen/schließen (Escape) · der Regel-Dialog bietet exakt die V9-Enums an · Dark-Mode-Umschaltung greift bis in die Tokens · alle 7 API-Endpunkte antworten · Pfad-Traversal wird abgewiesen.

### 8.4 Prüfung gegen die echte Runtime

Alle erzeugten Artefakte wurden gegen `automation_system_v0101` geprüft:

| Artefakt | `verify_storage_config_data` | `verify_roundtrip` |
|---|---|---|
| `device_state_data_v9.json` (Python-Migration) | **OK**, 0/0 | **True**, 176 Entities |
| `device_state_data_v9_node_fn-01.json` | **OK**, 0/0 | **True**, 180 Entities |
| Browser-Migration derselben Quelle | **OK**, 0/0 | **True**, 176 Entities |
| Editor-Projektions-Roundtrip | **OK**, 0/0 | **True**, 176 Entities |
| Node-Shard aus `v9_shard.js` | **OK**, 0/0 | **True**, 180 Entities |
| `createEmptyV9Config()` (Neuanlage aus dem Nichts) | **OK**, 0/0 | **True**, 21 Entities |

Der Speicherpfad mit aktiver Runtime lehnt fehlerhafte Configs korrekt ab (HTTP 422) und akzeptiert sie mit `force: true` unter ausgewiesener `verification: FAILED`.

Reproduzieren:

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 ./run.sh
CHROMIUM_PATH=/pfad/zu/chrome bash test_all.sh
```

---

## 9. Bekannte Grenzen und offene Punkte

**Bewusst nicht angefasst** (jeweils > 1000 Zeilen und mehrere Konsumenten — eigene Vorhaben):

1. **Zusammenführung der Alt-Regelmodelle.** `dynamic_rule_engine` und `automation_rule_sets` bleiben als Editor-Bibliotheken bestehen. Sie fließen **nicht** mehr in die V9-Config; die Tabs *Rules* und *Processes ▸ Automation Rules* sind faktisch Vorlagenverwaltung. Verbindlich ist *Rules V9*.
2. **`installViewportFixV2` / `installPreciseElementDragV6`.** Zwei parallele Drag-Implementierungen und zwei Wheel-Handler. Nur der Tool-Key-Fehler (B-25) wurde behoben.
3. **`hmi.js` (4.298 Zeilen).** Nur B-8 chirurgisch gepatcht. Die Widget-Styling-Logik existiert weiterhin dreifach.
4. **~950 Zeilen auskommentierter Alt-Code** in `elements.js`, `hmi.js`, `connection_mapper.js`, `model_adapter.js`, `processes.js`, `ui.js` — belassen, um die Diffs klein und prüfbar zu halten.

**Nicht gepatchte Bestandsfehler:** B-7 (Port-Auswahl ohne Wirkung), B-14 (toter Preview-Runtime-Pfad), B-24 (Formular-Neuaufbau bei jedem Drag-Frame), B-27/B-28 (Undo-Lücken der Zeichenfläche), B-30/B-31 (Doppelrendern, Stale-Snapshot), B-32 (unerreichbarer Library-Zweig).

**Vertragliche Grenzen, die kein Patch beheben kann:**

* `parameter_schemas.fields[]`/`constraints[]` haben in V9 **kein Gegenstück**. Wer Parametergrenzen braucht, hinterlegt sie in `_config/application/app_config.yaml` der Runtime (`_config_safety_policy`).
* Formel-Vergleichswerte sind nicht abbildbar. Ersatz: `{param_of_state, key, scale}` — der referenzierte Parameter-Key **muss** in den `parameters` des Ziel-States existieren, sonst schlägt `verify_rule_condition_refs` fehl.
* `ONOFF` ist als `control_strategy` nicht config-legal. Die Runtime wählt es per Auto-Detect über `write_coil`-Aktoren bzw. `hysteresis`-Parameter.

**Cross-Shards (V8) werden noch nicht erzeugt.** Die Validierung weist aus, wie viele States und Regeln mehrere Nodes berühren und daher in einen Cross-Shard gehören; die Erzeugung selbst fehlt.

---

## 10. Empfohlenes weiteres Vorgehen

Vorschlag in der Reihenfolge des Nutzens:

**Stufe 1 — Datenhygiene (kurz).**
Die beiden provisionierten Platzhalter auflösen: reale Adresse für `ctrl_unconfigured_5` (Aktoren 10–12) und richtiger Name für `unconfigured_process_6` (State 17). Beides direkt im Topologie- bzw. States-Panel.

**Stufe 2 — Cross-Shard-Erzeugung (V8).**
`v9_shard.js` um `projectCrossShard()` erweitern: `meta.version = 8`, `scope = cross`, hardwarefrei, `controllers.required = [controller_uuid, controller_key, owner_node_id]`. Der Validator müsste `validate_cross_execution_shard` spiegeln (verbotene Felder `bus_type/host/port/unit`, leeres `local_node`, kein `virt_active`).

**Stufe 3 — Authority-V5-Anbindung.**
Statt Vollschreiben `config_scope_operations_v1` erzeugen (`replace_field` / `upsert_entity` / `delete_entity`, max. 500 Operationen, `value_hash` als Fingerprint). Der Store kennt seine Änderungshistorie bereits — daraus lässt sich ein Proposal ableiten. Voraussetzung ist die bereits erreichte Fingerprint-Stabilität.

**Stufe 4 — Alt-UI ablösen.**
Wenn *Rules V9* und *States V9* im Betrieb tragen: die Tabs *Rules* und *Processes* auf reine Vorlagenverwaltung reduzieren oder entfernen. Das macht `rules_generator.js` (2.013 Z.) und große Teile von `automation_tabs.js` (2.469 Z.) entbehrlich — rund 3.500 Zeilen weniger.

**Stufe 5 — HMI-Konsolidierung.**
Die dreifache Widget-Styling-Logik (`hmi.js:418`, `hmi.js:1915`, `hmi_runtime.js:200`) in ein Modul ziehen und `hmi_runtime.js` regulär importieren.

Gerne bespreche ich, welche Stufe zuerst kommen soll — Stufe 1 ist reine Dateneingabe, Stufe 2 und 3 sind die eigentlichen Anschlüsse an Master und Authority.

---

## 11. Anhang: Dateiverzeichnis und API

### 11.1 Neu in V52

```
DIAGNOSE_UND_PATCH_V52_DE.md        dieses Dokument
README_V52.md                       Kurzanleitung
VERSION                             52.0.0
run.sh / test_all.sh                Start und Verifikation
requirements.txt
_server_v9.py                       V9-Endpunkte, Editor-/Shard-Projektion, server.yaml-Leser
_tools/migrate_config_to_v9.py      Legacy → V9 (Python)
_tools/canonicalize_v9_config.py    Fingerprint-Kanonisierung
config/device_state_data_v9.json
config/device_state_data_v9_node_fn-01.json
config/migration_report_v9.json
config/_legacy/                     Ausgangsdateien
public/css/tokens.css               Design-Tokens
public/css/layout.css               Aufwertung der Bestandsoberfläche
public/css/components.css           V52-Komponentenbibliothek
public/js/shared_utils.js           ersetzt 25 duplizierte Helfer
public/js/v9_schema.js              Vertrag als Daten (einzige Wahrheitsquelle)
public/js/v9_uuid.js                UUIDv5, deterministisch, JS ≡ Python
public/js/v9_factory.js             Factory-Schicht (generisch/spezialisiert/transaktional)
public/js/v9_migrate.js             Legacy → V9, V9 ↔ Editor-Projektion
public/js/v9_validate.js            Portierung der Runtime-Invarianten
public/js/v9_shard.js               Scope-Klassifikation, Node-Shards
public/js/v9_store.js               ein Ladevorgang, Historie, Persistenz
public/js/v9_dom.js                 sichere DOM-Bausteine
public/js/v9_ui_topology.js         Panel Topologie & I/O
public/js/v9_ui_states.js           Panel Prozess-States
public/js/v9_ui_rules.js            Panel RuleEngine
public/js/v9_ui_validate.js         Panel Validierung & Rollout
public/js/v9_bootstrap.js           Verdrahtung
test/test_v9_core.mjs               64 Regressionstests
test/smoke_ui.mjs                   57 UI-Prüfungen
```

### 11.2 Geändert

| Datei | Art |
|---|---|
| `public/index.html` | CSS-Pfade, `<marker>`, 4 Tabs + 4 Panels, Skript-Reihenfolge, doppelter `<link>` im `<header>` entfernt |
| `public/js/ui.js` | B-1, B-15 |
| `public/js/processes.js` | B-2, B-3, B-4, B-34 |
| `public/js/hmi.js` | B-8 |
| `public/js/connection_mapper.js` | B-5 |
| `public/js/elements.js` | B-25 |
| `public/js/automation_tabs.js` | B-9 |
| `public/js/model_adapter.js` | B-11 |
| `public/js/rules_generator.js` | B-33 |
| `svg_editor_tool.py` | B-13, `server.yaml`, V9-Routen |

**Unverändert:** `core.js`, `registry.js`, `device.js`, `json_formator.js`, `hmi_runtime.js`, `style.css`.

### 11.3 API

| Endpunkt | Methode | Antwort |
|---|---|---|
| `/api/v9/config` | GET | kanonische V9-Config |
| `/api/v9/config` | POST | `{status, path, canonicalized_fields, fingerprint, verification}` |
| `/api/v9/shard/{node_id}` | GET | node_local-Shard |
| `/api/v9/report` | GET | `{source, section_counts, verification, fingerprint, migration}` |
| `/api/device-config` | GET | Editor-Projektion (Legacy-Feldform) |
| `/api/rule-library` | GET/POST | Editor-Regelbibliothek (unverändert) |
| `/api/process-library` | GET/POST | Editor-Prozessbibliothek (unverändert) |
| `/api/templates`, `/api/speichern`, `/api/laden`, `/api/projekte`, … | | unverändert |

### 11.4 Werkzeuge

```bash
# Legacy → V9 (master_global)
python3 _tools/migrate_config_to_v9.py

# Node-Shard erzeugen
python3 _tools/migrate_config_to_v9.py --scope node_local --node-id fn-01 \
    --target config/device_state_data_v9_node_fn-01.json

# Zahlentypen kanonisieren (Fingerprint-Stabilität)
python3 _tools/canonicalize_v9_config.py config/device_state_data_v9.json \
    --previous config/device_state_data_v9.json

# Vollständige Verifikation
bash test_all.sh
```
