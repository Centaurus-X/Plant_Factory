# V54.1 — Regelvertrag, ONOFF, Plant-Factory-Kette

**Stand:** V54.1.0 · Vorgänger: V54.0.0 (`DIAGNOSE_UND_PATCH_V54_DE.md`)
**Referenz:** `automation_system_v0101`, `automation_control_plane_release_v0025_r1`
(beide Archive per SHA256 verifiziert, byte-identisch zur bisherigen Analysebasis)

---

## 0. Was diese Runde gefunden hat

Vier Punkte standen auf der Liste. Bei der vollständigen Durchsicht der beiden
Referenzsysteme kamen **drei Fehler** dazu, die vorher niemand sehen konnte,
weil sie alle *validieren*:

| # | Fund | Wirkung |
|---|---|---|
| **F-1** | `reconcile()` warf im `master_global`-Contract die zweite `local_node`-Zeile weg | **fn-02 verschwand aus der Topologie**, sobald der Editor die Config anfasste |
| **F-2** | Der Export löschte **reale** Controller, sobald ein virtueller dieselbe `controller_id` trug | `wago_2` (192.168.0.33) fiel samt Endpunkt aus dem Export — obwohl alle Zuweisungen darauf zeigten |
| **F-3** | I/O wurde allein über `sensor_id`/`actuator_id` aufgelöst | Bei zwei Workern gewann der erste Treffer; drei von vier „Sensor 1" verschwanden lautlos |

Dazu der Befund zur Kernfrage: **es wurden keine animierbaren SVGs erzeugt** —
an drei Stellen gleichzeitig gebrochen. Das ist jetzt behoben und im Browser
nachgewiesen.

---

## 1. Was „Authority-V5-Proposals" sind

### Die Kurzfassung

Ein **Proposal** ist der einzige regelkonforme Weg, eine Config im
`node_local`-Scope zu ändern. Es ist ein kanonischer Änderungsvorschlag im
Format **`config_scope_operations_v1`**, gestellt gegen eine Baseline. Der
**besitzende Worker** entscheidet ihn — nicht der Master, nicht der Proxy.

Das Leitmotiv steht wörtlich in der Spezifikation:
> *„centralize KNOWLEDGE, decentralize DECISION."*
> `CODE_AND_ARCHITECTURE_SPEZIFICATION_V005.md:502-504`

### Wo es definiert ist

| Was | Datei |
|---|---|
| Zustände, `make_proposal`, `validate_proposal`, `check_proposal_fence`, `apply_proposal` | `src/library/_generic_system_contract_library/authority_flow_contracts.py:20-325` |
| Operationsformat `config_scope_operations_v1` | `.../config_sharding_contracts.py:12-18`, Validator `:2114-2166` |
| Wire-Payload | `.../protocol_contracts.py:266-345`, Aktion `CONFIG_PROPOSE = "distributed.config.propose"` `:1162` |
| Persistenz + Monotonie-Guard | `src/library/_distributed_operation_store.py:803-866` |
| Sicherheits-Gate | `src/library/_config_safety_policy.py:240-291` |
| Normative Spezifikation | `AUTOMATION_AUTHORITY_V005_DOCUMENTATION/CODE_AND_ARCHITECTURE_SPEZIFICATION_V005.md` |

Die Contract-Library liegt **dreifach byte-identisch** — Worker, Master, Proxy.
Das ist Absicht: alle drei prüfen gegen denselben Text.

### Wie ein Proposal aussieht

Wire-Format, acht Felder, `reason` optional
(`protocol_contracts.py:288-293`):

```json
{
  "target_node_id": "fn-01",
  "operation": "scope_operations",
  "operation_format": "config_scope_operations_v1",
  "scope": "node:fn-01",
  "base_authority_epoch": 3,
  "base_scope_revision": 17,
  "base_scope_fingerprint": "<64 hex>",
  "reason": "Sollwert angepasst",
  "operations": [
    { "op": "replace_field", "section": "process_states", "entity_key": "1",
      "json_pointer": "/parameters/target_temp_c", "value": 560.0 }
  ]
}
```

Drei Operationsarten, mehr nicht (`config_sharding_contracts.py:2131-2143`):

| `op` | Pflichtfelder |
|---|---|
| `replace_field` | `op`, `section`, `entity_key`, `json_pointer`, `value` |
| `upsert_entity` | `op`, `section`, `entity_key`, `value`, `value_hash` |
| `delete_entity` | `op`, `section`, `entity_key` |

Kein Voll-Upload. Keine Pfad-Selektoren. `json_pointer` muss mit `/` beginnen,
Hashes sind lowercase-64-hex, und bei `upsert_entity` muss
`fingerprint(value) == value_hash` gelten.

### Der Lebenszyklus — kürzer als erwartet

Sechs Zustände: `received`, `accepted`, `already_committed`, `rejected`,
`not_authorized`, `expired`. **Nur `received` hat Nachfolger** — die anderen
fünf sind `frozenset()`, also terminal
(`authority_flow_contracts.py:29-42`).

Es gibt **kein Review, kein Zurückziehen, kein Reopen**. Ein Proposal wird
genau einmal entschieden. Wer eine Änderung nachbessern will, stellt ein neues.

### Das Fencing — mit einer Präzisierung

Die persistierte Scope-Identität ist das Quadrupel
`(authority_epoch, scope_revision, execution_epoch, fingerprint)`.
`check_proposal_fence` (`:236-253`) prüft davon aber nur **drei** Dinge:

| Prüfung | Fehlercode |
|---|---|
| `head["locked"]` | `scope_locked` |
| `base_authority_epoch` ≠ Head | `authority_epoch_stale` |
| `base_scope_revision` ≠ Head | `stale_revision` |

`execution_epoch` wird getrennt geprüft (`check_execution_epoch`, `:472-480`) —
sie fenced Cross-Events und Hardware-Writes, nicht Config-Proposals.
Der `fingerprint` ist im Proposal-Fence **Ausgabe, nicht Eingabe**:
`apply_proposal` (`:302`) berechnet ihn beim Erzeugen des neuen Heads.

Beim Persistieren greift ein Monotonie-Guard
(`_distributed_operation_store.py:826-833`): erlaubt sind nur
*gleiche Epoch + Revision+1* (Commit) oder *Epoch+1 + gleiche Revision*
(Authority-Transfer). Alles andere wirft.

### Was ein Client tun muss

1. **Head lesen** — `GET /api/v1/config?scope=node:fn-01` (`https_interface.py:706`)
   oder WSS-Aktion `config.get`.
2. **Operationen bauen** — nur die drei kanonischen Ops.
3. **Senden** — `POST /api/v1/config/proposals` (`https_interface.py:709`),
   WSS `config.propose`, oder MQTT
   `automation/v1/<site>/nodes/<node>/commands/distributed/config/propose`
   (QoS 1, `retain=false`, mTLS).
4. **CAS-Retry** — bei `stale_revision` / `authority_epoch_stale`: Head neu
   lesen, Operationen neu bauen, erneut senden.

### Warum der Editor das (noch) nicht tut

Der Editor arbeitet auf ganzen Configs, ein Proposal auf einzelnen Feldern mit
`entity_key` und `json_pointer`. Die Übersetzung „geänderte Config → Liste
kanonischer Operationen" ist ein eigenes Stück Arbeit — machbar, aber eine
Entscheidung über den Rollout-Weg. Bis dahin: Dateiexport, und die Datei geht
über den bestehenden Weg in die Anlage.

---

## 2. Punkt 1 — ONOFF entfernt

### Warum es weg musste

`spec_control_strategy()` (`_generic_type_library.py:1403-1421`) kennt genau
drei Formen: `null`, `{type:"PID", pid_config_id}`,
`{type:"control_method", method_id}`. `{"type":"ONOFF"}` scheitert mit
*„no union alternative matched (3 tried)"*.

### Was stattdessen passiert — belegt im Code

`ensure_controller_for_state` (`_automation_engine.py:2883-2904`) bei
`control_strategy: null`:

```python
# Auto-detect: if write_coil actuator present -> ONOFF, else P
if has_coil or params.get("hysteresis") is not None \
        or params.get("hysteresis_bar") is not None:
    controller = create_onoff_controller(hysteresis)
else:
    controller = create_p_controller(1.0, out_min, out_max)
```

Die Zweipunktregelung ist also **kein verlorener Typ**, sondern das Ergebnis
einer Auswahl, die die Runtime selbst trifft. Und zwar deterministisch: die
Konfigurationssignatur (`:2710-2729`) zieht bei leerem Typ ausdrücklich die
Hysterese-Parameter **und** die `function_type`s der Aktoren mit ein.

Genau so steht es auch in der ausgelieferten Runtime-Config: die States 5, 9,
10, 11, 13 und 20 haben `control_strategy: null`, State 11 und 20 tragen
`hysteresis_bar` in `parameters`.

### Was geändert wurde

| Datei | Änderung |
|---|---|
| `public/js/model_adapter.js:223-229` | `ONOFF` erzeugt jetzt `control_strategy = null` statt `{type:'ONOFF'}` |
| `public/js/model_adapter.js:286` | Typnormierung liefert `''` statt `'ONOFF'` |
| `public/js/processes.js:377` | Auswahl heißt „Zweipunkt (Runtime wählt automatisch)" — kein ONOFF-Eintrag mehr |
| `public/js/v9_ui_states.js:309` | Strategie-Auswahl benennt das Verhalten beim Namen |
| `_tools/convert_libraries_to_v9.py` | ONOFF-Sonderzweig entfernt |
| `_tools/migrate_config_to_v9.py:680`, `public/js/v9_migrate.js:558` | erkennen ONOFF weiterhin als **Eingabe** aus Altbeständen und wandeln sie zu `null` — das muss bleiben, sonst bräche der Import |
| `test_all.sh` Stufe 2 | Gate: schlägt fehl, wenn irgendwo wieder `type: 'ONOFF'` **erzeugt** wird |

---

## 3. Punkte 2 + 3 — Regeln zu 100 % runtime-kompatibel

### Der Vertrag, vollständig extrahiert

Aus `_generic_type_library.py` und `_generic_rule_engine.py` wurde der
Regelvertrag Feld für Feld herausgezogen. Die wichtigsten Erkenntnisse — alle
neu, alle mit Folgen für den Editor:

**A. Aktionen: genau EIN Marker.**
`_find_action_handler` (`_generic_rule_engine.py:1520-1525`) nimmt den
**ersten** passenden Marker in der Reihenfolge `state_ids` → `p_ids` →
`notify`. Eine Aktion `{"state_ids":[1], "notify":"x"}` schreibt den State und
**verschluckt die Meldung**. Die Factory normiert deshalb auf genau einen
Marker.

**B. `writable_fields` ist eine harte Schranke.**
`_config_safety_policy._action_fields_valid` (`:370-371`) definiert
`controls = {state_ids, p_ids, notify}`. **Jedes andere Feld** einer Aktion
muss in `rule_engine[].writable_fields` stehen. Ein `description` in einer
Aktion reißt das Sicherheits-Gate — obwohl der JSON-Formatter der Runtime es in
der Feldreihenfolge führt.

**C. `value` kennt keinen String.**
`spec_rule_condition_value` (`:1358-1367`) ist eine Union aus Zahl, bool und
`{param_of_state, key, scale?}` — mit `param_of_state` und `key` als
**Pflichtfeldern**. Ein Formelstring wie `"target_temp*0.98"` scheitert.

**D. Bei `src: "sensor"` sind `controller_uuid` UND `sensor_id` Pflicht.**
Nicht im Schema, sondern in `verify_rule_condition_refs` (`:2474-2500`).

**E. `until` und `else_do` dürfen nicht leer sein** (`min_len=1`), aber sie
dürfen fehlen.

**F. Drei Konstrukte validieren und wirken trotzdem nicht:**

| Konstrukt | Warum wirkungslos |
|---|---|
| `filter_id` in einer Bedingung | Die Runtime baut die Fakten mit `filters: {}` (`thread_management.py:622-630`) → Rückfall auf den **Rohwert** |
| `src: "timer"` | Die Fakten enthalten keine `timers`; `timers_evaluate()` wird im Produktivcode nirgends aufgerufen → Bedingung dauerhaft falsch |
| `latch: "auto"` | `_apply_rule_state_machine` (`:1122-1123`) reagiert nur auf `"manual"` |

Das ist die gefährlichste Sorte Fehler: sie *validiert*. Der Editor meldet sie
jetzt als **Hinweise** — kein Fehler, denn die Config ist vertragskonform; nur
die Erwartung des Anwenders ist es nicht.

### Was geändert wurde

| Datei | Änderung |
|---|---|
| `public/js/v9_validate.js` | neue `verifyRuntimeEffectiveness()`: Hinweise `filter_not_applied`, `timer_source_inactive`, `latch_auto_noop` |
| `public/js/v9_validate.js` | Cross-Regeln werden gegen `cross:<owner>.default` geprüft (`cross_execution_scope_mismatch`) |
| `_tools/convert_libraries_to_v9.py` | `parameters` in Bedingungen entfernt (kein Bedingungsfeld); Identitäten werden **weggelassen** statt auf `null` gesetzt; unübersetzbare Vergleichswerte werden neutralisiert und wandern nach `__template__.deferred` |
| `config/_patches/fn02_ausbau.json` | `latch: "auto"` an Regel 30 entfernt — `until` leistet die Hysterese bereits |

### Der Nachweis

Neu: **`test/test_rule_contract.py`**. Er lässt die JS-Factory zwölf Regeln
erzeugen — darunter bewusst kaputte Eingaben — und schickt jede durch
`verify_storage_config_data()` der **echten Runtime**:

```
bestanden: 29 | fehlgeschlagen: 0
REGELVERTRAG BESTANDEN
```

Geprüft wird unter anderem: Sensorbedingung ohne `controller_uuid` (wird aus
dem Kontext gefüllt), Aktion mit `description`/`actuator_id` (werden entfernt),
Aktion mit drei Markern (nur einer überlebt), String als Vergleichswert (wird
ersetzt), unvollständige Parameterreferenz, unbekannte Enums, leere Listen,
Cross-Regel mit korrektem `execution_scope`.

Zusätzlich prüft er die **ausgelieferten Configs**, die **Shards** und die
**Bausteinvorlagen** gegen denselben Vertrag.

---

## 4. Punkt 4 — Cross-Shard: nur Export

Bestätigt und so belassen. Der Cross-Editor lädt (vier Wege), prüft live gegen
alle 15 Invarianten und exportiert als Datei im Lesbarkeitsformat. Kein
Schreib-Endpunkt.

---

## 5. Die Plant Factory: Zeichnen → Binden → Exportieren → Animieren

### F-1: `local_node` — Datenverlust bei zwei Workern

**Befund.** Der Vertrag führt `local_node` als `t_list(min_len=1)` — **kein
Singleton**. Ein `master_global`-Contract mit zwei Workern gehört zweizeilig.
`reconcile()` leitete aber immer nur EINE Zeile ab:

```
vorher  local_node: fn-01, fn-02
nachher local_node: fn-01          <- fn-02 weg
```

**Behoben.** Neue `createLocalNodes()`; `reconcile()` unterscheidet jetzt nach
Scope: `node_local` → genau 1, `cross` → 0, `master_global` → eine Zeile je
Node. Der Validator prüft dieselbe Staffelung (`local_node_arity`) und schlägt
zusätzlich bei doppelter `node_id` an.

### F-2: Export löschte reale Controller

**Befund.** `model_adapter.js:1054-1059` filterte aus `cfg.controllers` alles
heraus, dessen `controller_id` auch in `virtual_controllers` vorkam. Die
Editor-Projektion vergibt virtuellen Controllern aber **absichtlich** die ID
des realen mit derselben UUID (`_server_v9.py:180-183`). Ergebnis bei der
ausgelieferten Config: `wago_2` (192.168.0.33) fiel aus dem Export — genau der
Controller, auf den alle drei Zuweisungen in `projekte/test4.json` zeigen.

**Behoben.** Aussortiert wird nur noch, was **selbst** virtuell ist
(`bus_type === 'virtual'` bzw. `controller_is_virtual`).

### F-3: I/O-Auflösung war node-blind

**Befund.** `buildSensorsForExport` indizierte über `sensor_id` allein und
nahm den ersten Treffer. In der ausgelieferten Config kommt `sensor_id: 1`
**viermal** vor (Controller 2, 3, 4, 5) — drei davon waren unerreichbar.

**Behoben.** Neuer `ioKey(row, idField)` = `(controller_id, io_id)`.
`collectUsedIoIds` sammelt jetzt zusätzlich Paare aus den Zuweisungen — der
einzigen Stelle, an der beides zusammen vorliegt. Aufgelöst wird zuerst über
das Paar, danach über die reine ID (Rückfall für Altprojekte).

### Und die eigentliche Frage: animierbare SVGs

**Befund.** Die Kette brach an **drei** Stellen gleichzeitig:

1. Die Zustands-CSS lag nur in `public/css/style.css` und `layout.css`. Beide
   wurden dem Export weder beigelegt noch verlinkt — die Laufzeit setzte
   Klassen, zu denen es keine einzige Regel gab.
2. Das SVG trug kein `viewBox`. Mit `width:100%` wurde der Inhalt
   **beschnitten** statt skaliert. Zusätzlich war der Zoom/Pan der
   Arbeitsfläche eingebacken.
3. Es gab keine Datenquelle. `hmi_runtime.setSignal()` existierte, wurde aber
   von **keiner Zeile** im Projekt aufgerufen — kein Polling, kein WebSocket.

**Behoben** durch das neue Modul **`public/js/hmi_animation.js`**:

| Export | vorher | jetzt |
|---|---|---|
| `<style>` im SVG | fehlt | eingebettet, mit Keyframes und Zustandsregeln |
| `viewBox` | fehlt | aus `getBBox()` der Zeichnung, mit Rand |
| Zoom/Pan | eingebacken | entfernt |
| `<title>` | fehlt | Projektname |
| CSS im HTML-Layer | 5 Zeilen Rahmen | Widget- **und** Zustands-CSS |
| Datenanbindung | keine | Polling mit Demo-Rückfall |
| Bundle | 4 Dateien | 5 — `signals.json` als Startvorlage |

Fünf Zustandsklassen (`ok-green`, `warn-yellow`, `alarm-red`, `info-blue`,
`idle-grey`) und drei Animationen (`hmi-anim-blink`, `-pulse`, `-flow`).
`prefers-reduced-motion` wird respektiert.

**Warum CSS-Klassen und nicht SMIL:** die Laufzeit arbeitet ausschließlich über
`classList`. SMIL wäre ein zweiter, konkurrierender Mechanismus. Eine
klassengebundene Animation kann **jeder** Client steuern — auch ohne unsere
Laufzeit.

**Die Signalbrücke** pollt `./signals.json` (oder `?signals=<url>`) und reicht
die Werte an `runtime.setSignals()`. Schlüsselformat wie in
`hmi_runtime.toKeyFromRef()`: `<kind>:<id>:<field>`. Ist keine Quelle
erreichbar, läuft ein **sichtbar gekennzeichneter** Demo-Modus mit
deterministischen Werten. Das ist Absicht: ein Bundle, das beim Doppelklick tot
bleibt, lässt den Anwender im Unklaren, ob er etwas falsch gemacht hat oder ob
die Anlage stillsteht.

### Der Nachweis — im echten Browser

`test/smoke_ui.mjs` erzeugt jetzt ein Element, exportiert das SVG, parst es
zurück, hängt es ins Dokument und **misst den Computed Style**:

```
Zustandsklasse faerbt die markierte Fuellflaeche
  {"opacity":"1","fill":"rgb(0,0,0)"} -> {"opacity":"0.45","fill":"rgb(239,68,68)"}
Animationsklasse startet eine echte CSS-Animation
  hmi-blink / 1s
```

Das ist keine Strukturprüfung, sondern der Beweis, dass die Animation läuft.

### Kleinere Korrekturen

`svg_editor_tool.py` lieferte `'größe'`, `'geändert'`, `'höhe'` — das JS las
`groesse`, `geaendert`, `hoehe`. Folge: „NaN undefined" und „Invalid Date" in
der Projektliste, Template-Höhe immer 100. Serverseitig auf ASCII-Schlüssel
umgestellt.

---

## 6. Verifikation

`./test_all.sh` — jetzt **elf** Stufen:

| # | Stufe | Ergebnis |
|---|---|---|
| 1 | Python-Syntax | 14 Dateien |
| 2 | JS-Syntax, kein OOP, **kein ONOFF** | 31 Dateien, 0 Klassen |
| 3 | Ausgabeformat Editor == Server == Runtime | 58 + 42 |
| 4 | Konfiguration reproduzierbar | Type-Authority OK |
| 5 | Migration, 5/5 UUIDs = Baseline | ok |
| 6 | Rollout-Split, cross_worker belegt | Split gültig |
| 7 | Bausteinbibliotheken | 12 Vorlagen |
| 8 | **Regelvertrag gegen die echte Runtime** | 29 |
| 9 | **Plant-Factory-Kette** | 31 |
| 10 | Kern-Regressionstests | 145 |
| 11 | UI-Smoke-Test (12 Tabs, Export, Animation) | 111 |

**358 automatisierte Prüfungen, alle bestanden** — nachgefahren aus dem
entpackten Auslieferungspaket.

---

## 7. Was jetzt geht — und was nicht

| Frage | Antwort |
|---|---|
| HMI-Anlagen zeichnen? | **Ja.** Drag&Drop, Transform, Ports, Verbindungen, Speichern/Laden. |
| Config exportieren? | **Ja** — vollständig und ohne Datenverlust. Format ist die Editor-Sicht (V50-Feldnamen), **nicht** der V9-Vertrag. |
| Animierbare SVGs? | **Ja.** Das SVG ist für sich genommen animierbar: CSS eingebettet, `viewBox` gesetzt, im Browser nachgewiesen. |
| Export nach V9 zurückspielbar? | **Nein.** Siehe unten. |

### Der Export ist bewusst zwei Welten

Der Editor-Export (`buildExportConfig`) liefert die **Designer-Sicht**:
`elements`, `connections`, `hmi_ui`, `devices` plus die I/O-Tabellen in
V50-Feldnamen. `POST /api/v9/config` verlangt dagegen exakt die 26
V9-Sektionen und lehnt jede zusätzliche ab.

Das ist kein Versehen, sondern zwei verschiedene Artefakte:

* **Anlagenbild + HMI** → das SCADA-Bundle (SVG, HTML, `signals.json`)
* **Automatisierungsvertrag** → `config/device_state_data_v9.json`,
  gepflegt über die V9-Tabs und `build_config.sh`

Eine Rückführung Designer-Sicht → V9 wäre der nächste sinnvolle Schritt. Sie
braucht eine Entscheidung, die nur der Anlagenbetreiber treffen kann: **welche
Seite gewinnt**, wenn beide dieselbe Entität beschreiben.

### Bewusst offen

1. **`src: "timer"` und `filter_id`** — die Runtime baut die Fakten ohne
   Timer und mit leerer Filtertabelle. Kein Editorproblem; der Editor warnt.
2. **OR-Verknüpfung** — der Vertrag kennt `when` nur als UND-Liste. Die Engine
   könnte `any`/`none`/`xor`, das Schema lässt es nicht zu.
3. **`schema_mappings.match/priority/is_default`** — kein Konsument.
4. **Proposal-Weg** — siehe Abschnitt 1.
5. **Race auf `state.deviceConfig`** — vier Module laden die Config weiterhin
   selbst. Der V9-Store hat den Pfad für die neuen Panels bereinigt, die
   Altmodule ziehen noch nach. Sichtbar wird das nur, wenn im Device-Tab
   Controller geändert werden: das schreibt nicht in den V9-Store zurück.
