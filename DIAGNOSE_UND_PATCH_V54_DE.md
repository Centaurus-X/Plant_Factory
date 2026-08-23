# Automated_SVG_Integration V54 — Diagnose, Patch, Verifikation

**Stand:** V54.0.0
**Vorgänger:** V53.0.0 (siehe `DIAGNOSE_UND_PATCH_V53_DE.md`)
**Referenzsysteme:** `automation_system_v0101`, `automation_control_plane_release_v0025_r1`

---

## 0. Kurzfassung

V54 schließt die fünf offenen Punkte aus V53 — und deckt dabei zwei Fehler auf,
die schwerer wogen als alles, was auf der Liste stand:

1. **Die `controller_uuid`-Ableitung des Editors war falsch.** Sie folgte einer
   selbst gesetzten Konvention statt der der Runtime. Jeder im Editor neu
   angelegte Controller hätte eine Identität bekommen, die die Runtime nicht
   reproduzieren kann — er wäre unauffindbar gewesen. Die richtige Konvention
   wurde aus der Bestandsflotte zurückgerechnet und gegen **alle fünf**
   vorhandenen UUIDs verifiziert.
2. **Die Identitätsauflösung war node-blind.** `local_controller_id` ist nur je
   Node eindeutig. Sobald zwei Worker in einer Config stehen, ordnete der
   Editor I/O-Zeilen dem falschen Controller zu. Bei einem Node fiel das nie
   auf; mit fn-02 sofort.

Beides ist behoben, beides ist durch Regressionstests abgesichert.

Dazu kommen die angefragten Punkte: Dummy-Werte (1), fn-02-Ausbau (2),
Ausgabeformat und Cross-Menü (3), Altlasten (4) und die Auflösung der
„Grenzen des Vertrags" (5).

---

## 1. Punkt 1 — Dummy-Werte für die provisionierten Platzhalter

### IST (V53)

Zwei Entitäten entstanden bei der Migration als tote Platzhalter:

| Entität | Wert in V53 | Problem |
|---|---|---|
| `ctrl_unconfigured_5` | `host = "0.0.0.0"` | verbindet nie; formal gültig, praktisch tot |
| `unconfigured_process_6` | `process_name = "unconfigured_process_6"` | sagt niemandem, was er tut |

### SOLL

Werte, die sich in die Anlage einfügen — abgeleitet, nicht geraten.

### Umsetzung

Neu: **`_tools/provision_defaults.py`** und sein Spiegel
**`public/js/v9_provision.js`**. Statt fester Platzhalter wird aus dem
Anlagenkontext abgeleitet:

* **Bustyp, Port, Unit, Funktionstyp** → Mehrheitswert der Geschwister
* **IP-Adresse** → aus dem Adressmuster der Anlage:
  `<Präfix>.<50 + controller_id>`, nächste freie Adresse
* **Feldbusadresse** → nächste freie Adresse auf demselben Controller
* **Prozessname** → `reserved_process_<N>`, `enabled: false`, sprechender Ort

Das Ergebnis ist überprüfbar richtig — und zwar erstaunlich genau:

```
wago_1  192.168.0.51   (Bestand)
wago_2  192.168.0.33   (Bestand)
wago_3  192.168.0.53   (abgeleitet — deckt sich mit dem historischen Wert)
wago_4  192.168.0.54   (Bestand)
wago_5  192.168.0.55   (abgeleitet — deckt sich mit dem echten fn-02-Controller)
```

Der frühere `ctrl_unconfigured_5` **ist** `wago_5` auf fn-02. Der Platzhalter
war nie ein Platzhalter, sondern ein Controller, den die V50-Config nur nicht
deklariert hatte. Die korrigierte UUID-Ableitung macht das sichtbar:
`controller_uuid` stimmt jetzt bitgenau mit dem echten fn-02-Shard überein.

Provisionierte Zeilen bleiben erkennbar: `tags` enthält `"provisioned"`,
`description` nennt den Grund.

---

## 2. Punkt 5 vorgezogen — „Grenzen des Vertrags" aufgelöst

Die Formulierung aus V53 war zu pessimistisch. Nachgeprüft ergibt sich:

### 2.1 `controller_uuid` — die Konvention war rekonstruierbar

**Befund.** V52/V53 leiteten ab als
`uuid5(NS_AUTOMATION, "<site>/<node>/<controller_key>")`. Keine einzige der
fünf Bestands-UUIDs ließ sich damit reproduzieren.

**Rekonstruktion.** Systematische Suche über Namespace, Trennzeichen und
Namensform ergab genau einen Treffer — und zwar für **alle fünf** UUIDs:

```
controller_uuid = uuid5(NAMESPACE_DNS, "<site_id>.<mint_node_id>.<device_name>")
```

Drei Details entscheiden:

| | falsch (V53) | richtig |
|---|---|---|
| Namespace | eigener `NS_AUTOMATION` | `NAMESPACE_DNS` |
| Trenner | `/` | `.` |
| Name | `controller_key` (`ctrl_wago_1`) | `device_name` (`wago_1`) |

**Prägungs- vs. Betriebs-Node.** `wago_5` läuft auf fn-02, seine UUID leitet
sich aber aus `site_main.fn-01.wago_5` ab. Die Identität wird also **einmal bei
der Provisionierung geprägt** und bleibt beim Node-Wechsel stabil — genau das,
was eine stabile Identität leisten muss. Dafür gibt es
`controllerUuidFor(site, node, name, { mintNodeId })`.

**Folge.** `PINNED_CONTROLLER_UUIDS` ist kein Sonderweg mehr, sondern eine
Prüftabelle: jeder Eintrag lässt sich aus der Formel reproduzieren
(`test/test_v9_core.mjs`, 11 Prüfungen).

**Nebenbefund.** `DEFAULT_SITE_ID` war `site-main` (Bindestrich), die
Bestandsflotte nutzt `site_main` (Unterstrich). Da die site_id in **jeder**
UUID steckt, hätte das einen zweiten Identitätsraum aufgemacht. Korrigiert.

### 2.2 `execution_scope` — die Schreibweise steht in der Control-Plane

`config_sharding_contracts.py` legt sie fest:

```python
if status == "active_node":
    rule["execution_scope"] = "node:" + owner
elif status == "active_cross":
    domain = owner + ".default"
    rule["cross_domain_id"] = domain
    rule["execution_scope"] = "cross:" + domain
```

Der Editor erzeugte `cross_controller:<domain_id>` — der Coordinator hätte das
als `stale_execution_scope` abgewiesen. Behoben über
`crossExecutionScopeFor()` / `executionScopeForStatus()`; der Validator prüft
die Schreibweise jetzt aktiv.

### 2.3 `parameter_schemas.fields` / `.constraints` — nicht verloren

**Befund.** V53 meldete: „entfallen ersatzlos (V9 kennt nur
schema_id/state_type/description)".

**Nachprüfung.** `verify_storage_config_data()` mit zusätzlichen Feldern an
`parameter_generic_templates` liefert **`OK`**. Der Vertrag verbietet keine
additiven Felder auf Zeilenebene — nur zusätzliche *Sektionen*.

**Folge.** `fields` und `constraints` werden konvergiert statt verworfen:

* `v9_schema.js` führt sie als optionale Felder
* die Migration übernimmt sie
* die Editor-Projektion reicht sie durch (vorher: immer `[]`)
* `fromEditorProjection()` überlagert die V9-Sicht mit den Legacy-Eingaben —
  der Bestands-Tab in `automation_tabs.js` ist damit nicht länger eine
  Oberfläche, deren Eingaben beim Speichern verschwinden
* der Formatter kennt ihre Position in der Feldreihenfolge

### 2.4 `ONOFF` — bleibt bewusst `null`

Der V9-Union für `control_strategy` kennt `PID` und `control_method`, sonst
nichts. `ONOFF` ist kein Datenverlust: fehlt eine Strategie, regelt die Runtime
ohnehin zweipunktförmig. Der Konverter schreibt das jetzt als Klartexthinweis
in die Vorlage, statt es kommentarlos zu schlucken.

---

## 3. Punkt 2 — fn-02 geprüft und ausgebaut

### Diagnose der drei gelieferten Configs

| # | Befund | Auflösung |
|---|---|---|
| D-1 | `site_id`-Divergenz: fn-01 `site_main`, fn-02 `site-main` | Merge vereinheitlicht auf `site_main` (steckt in jeder UUID) |
| D-2 | `ctrl_wago_3` nur im Cross-Shard, in keinem Node-Shard | gehört laut E2E-Fixture der Control-Plane zu **fn-02**; als Stub übernommen und physikalisch provisioniert |
| D-3 | Cross-Shard ohne `sites` | im Master-Merge erzeugt; der Cross-Shard darf `sites` vertragsgemäß nicht führen |
| D-4 | `routing_model`-Divergenz | Master führt einheitlich `site_id_node_id_local_controller_id` |
| D-5 | fn-02: 0 Sensoren, 0 Regeln, State 30 ohne Strategie | ausgebaut, siehe unten |
| D-6 | keine ID-Kollisionen zwischen den Shards | sauberer Merge möglich |
| D-7 | alle drei Shards einzeln vertragskonform | bestätigt gegen die echte Type-Authority |

### Der entscheidende Fund: D-2 war kein Fehler, sondern eine Zuordnung

Die E2E-Fixture der Control-Plane
(`integration_test/e2e_v0025/fixtures/cross_worker_site-main.json`) beschreibt
den Cross-Worker-Fall verbindlich:

```json
{ "source": { "node_id": "fn-01", "controller_uuid": "62671112…", "sensor_id": 3 },
  "cross":  { "scope": "cross:fn-01.default", "owner_node_id": "fn-01", "rule_id": 3 },
  "target": { "node_id": "fn-02", "controller_uuid": "d11032fa…", "actuator_id": 4,
              "address": 544, "state_id": 14 } }
```

`d11032fa…` ist `ctrl_wago_3` — und sein Betriebs-Node ist **fn-02**. Damit
spannt State 14 zwei Nodes auf und Regel 3 ist eine echte `cross_worker`-Regel,
keine `cross_controller`-Regel. Der `owner_node_id: fn-01` im Cross-Shard ist
der **Domain**-Eigentümer, nicht der Betriebs-Node.

`merge_shards_to_master.py --assign ctrl_wago_3=fn-02` macht das explizit.
Der Patch `config/_patches/cross_worker_e2e_abgleich.json` gleicht Adresse
(544) und Funktionstyp (`write_register`) mit der Fixture ab — die
ausgelieferte Config ist damit direkt gegen den E2E-Test der Control-Plane
fahrbar.

### Ausbau von fn-02

`config/_patches/fn02_ausbau.json` (Overlay, kein Code):

| Was | Vorher | Nachher |
|---|---|---|
| Sensoren | 0 | 3 (Manteltemperatur, Füllstand, Kühlmitteldurchfluss) |
| Aktoren | 3 ohne Typ/Profil | 3 mit `actuator_types_id` und `profile_id` |
| Filter | 0 | 1 (Glättung der Manteltemperatur) |
| Prozesse | 1 (leer) | 2, beide mit Ort und Beschreibung |
| Zustände | 1 (State 30, ohne Strategie, ohne Parameter) | 3 (30 Rühren mit PID, 31 Mantelkühlung, 32 Ventil) |
| Regeln | 0 | 4 — davon **eine echte `cross_worker`-Regel** |

**Die cross_worker-Regel (rule_id 30).** State 31 liest bewusst *zwei* Sensoren:
die Reaktortemperatur auf fn-01 und die Manteltemperatur auf fn-02. Damit
berührt er zwei Controller auf zwei Nodes und ist selbst `cross_worker` —
erst dadurch ist Regel 30 ein vertragskonformer Cross-Writer. `priority: 1000`
entspricht `rule_engine.runtime.coordinator_min_priority`.

Ergebnis des Rollout-Splits:

```
Split : gültig
Stats : local_shards 2, cross_shards 1,
        local_rule_count 7, cross_rule_count 3, executable_rule_count 10
Regel  3  cross_worker  -> cross (V8)
Regel  6  cross_worker  -> cross (V8)
Regel 30  cross_worker  -> cross (V8)
```

---

## 4. Punkt 3a — Ausgabeformat

### IST

`JSON.stringify(config, null, 2)`. Eine 217-Zeilen-Runtime-Datei wurde zu über
2000 Zeilen; jedes Feld auf einer eigenen Zeile, keine Gliederung.

### SOLL

Byte-gleich zu `_json_formator.py` (FORMATTER_VERSION 3.0.0) der Runtime.

### Umsetzung

Zwei Module, ein Format:

* **`public/js/v9_json_format.js`** — Browser
* **`_tools/format_v9_config.py`** — Server

Beide setzen den Modus `fingerprint_safe` um: Sektionen und Objektfelder werden
umsortiert (fingerprint-neutral, weil `canonical_bytes` vor dem Hashen
sortiert), **Datensatz-Arrays behalten ihre Reihenfolge** (die wertet die
Kanonisierung als bedeutungstragend).

Portiert wurden: `TOP_LEVEL_ORDER`, `DEFAULT_TOP_SPACING`,
`FIELD_ORDER_BY_PATH`, `FIELD_ORDER_BY_PARENT_KEY` und — leicht zu übersehen —
die **generische Fallback-Sortierung** `_generic_field_sort_key`. Sie ist nicht
alphabetisch, sondern kategorial: IDs (10) → Identitäten (20) → Status (30) →
Referenzen (50) → Logik (55) → Rest (40) → `parameters` (80) → `tags` (90) →
`description` (100). Ohne sie hätte `{"key", "param_of_state", "scale"}` eine
andere Reihenfolge bekommen.

### Das Gleitkommaproblem

JavaScript kennt einen Zahlentyp. `JSON.stringify(1000.0)` liefert `1000`, die
Runtime schreibt `1000.0` — und `canonical_bytes` unterscheidet beides. Der
Fingerprint wäre also davon abhängig gewesen, wer zuletzt gespeichert hat.

Zweistufige Lösung:

1. **Vertragstabelle** (`FLOAT_PATHS`) — Felder, die der V9-Vertrag an fester
   Position als Gleitkommazahl führt, werden immer mit `.0` gerendert.
2. **Literalgedächtnis** (`collectFloatLiterals`) — ein kleiner JSON-Scanner
   liest beim Laden aus dem **Rohtext**, welche Zahlen als Gleitkomma
   geschrieben waren, und reicht das beim Schreiben zurück. Das deckt die
   freien Maps ab (`control_methods.args`, `process_states.parameters`), wo
   eine Typtabelle nichts ausrichtet — dort ist `period_s` mal `600` und mal
   `120.0`.

Der Store lädt deshalb als Text und parst selbst, statt `response.json()` zu
nutzen.

**Korrektur an der Vertragstabelle.** `timers.duration_s`, `timers.interval_s`
und `filters.chain.period_s` standen fälschlich in `FLOAT_PATHS` — die Runtime
schreibt dort `4000` (int). Entfernt; das Literalgedächtnis erledigt es.

### Nachweis

```
BYTE-IDENTISCH: config/_incoming/node_fn01.json  | idempotent: true
BYTE-IDENTISCH: config/_incoming/node_fn02.json  | idempotent: true
BYTE-IDENTISCH: config/_incoming/cross_fn01.json | idempotent: true
PARITÄT JS == Python für alle drei Referenzen
```

`test/test_format_parity.py` vergleicht zusätzlich die **Tabellen** beider
Implementierungen Feld für Feld (58 Prüfungen) — Drift zwischen Browser und
Server fällt sofort auf.

### Wo das Format wirkt

| Ort | vorher | jetzt |
|---|---|---|
| Server-Schreibpfad (`POST /api/v9/config`) | `json.dumps(indent=2)` | `format_config()` |
| `build_shards.py` | `json.dumps(indent=2)` | `format_config()` |
| Editor-Download | `JSON.stringify(…, 2)` | `store.toBlob()` |
| Shard-Vorschau im Panel | `pretty()` | `store.formatJson()` |
| `GET /api/v9/config?format=text` | — | neu |
| `GET /api/v9/cross/<owner>?download=<name>` | — | neu |

---

## 5. Punkt 3b — Menüpunkt „Cross V8"

### IST

Der Cross-Shard war ein reines *Ergebnis*: der Editor pflegte den Master,
`splitShards()` warf den V8-Shard aus. Wer einen im Feld vorhandenen
Cross-Shard anpassen wollte, musste ihn von Hand bearbeiten — gegen einen
Vertrag, der fünf Feldgruppen fail-closed verbietet.

### SOLL

Ein eigenständiger Editor, der den V8-Vertrag kennt.

### Umsetzung

Neuer Tab **„Cross V8"** (`public/js/v9_ui_cross.js`, 12. Tab) mit eigenem
Sitzungsspeicher — bewusst **nicht** im Master-Store, weil ein Cross-Shard ein
eigenständiges Artefakt mit eigenem Vertrag ist.

**Vier Ladewege**

* aus dem Master projizieren (bei genau einem Owner **automatisch** — der
  Dialog hätte nur ein feststehendes Ergebnis zu bestätigen)
* vom Server: `GET /api/v9/cross/<owner>`
* Datei einlesen (prüft `meta.version`/`scope` vor dem Übernehmen)
* leeren Shard anlegen (Kataloge aus dem Master)

**Bearbeitbar**

`meta` (Owner/Domain) · Controller-Stubs · Routen (`route_key` ohne site_id) ·
logische Sensoren · logische Aktoren · Cross-Regeln

Die verbotenen Felder werden **gar nicht erst angeboten**. Das Panel nennt sie
im Klartext, damit nachvollziehbar ist, warum sie fehlen.

**Regeln aus dem Master übernehmen.** Der Dialog zeigt jede Master-Regel mit
ihrem Scope und — falls nicht übernehmbar — dem Grund. Beim Übernehmen wandert
der **Referenzabschluss** automatisch mit: States, Prozesse, logische I/O,
Controller und Routen, physikalisch entkernt. Eine Regel ohne ihre Umgebung
wäre im Cross-Shard wertlos.

**Live-Prüfung** gegen alle 15 Cross-Invarianten bei jeder Änderung.
**Export** im Lesbarkeitsformat mit dem korrekten Dateinamen.

---

## 6. Punkt 4 — Altlasten

### 6.1 Die zwei echten Fehler

**Node-blinde Identitätsauflösung.** `identityFor(ctx, localControllerId)`
schlug in `controllerByLocalId` nach — einem Index über die **globale**
`controller_id` — wurde aber mit der **node-lokalen** `local_controller_id`
aufgerufen. Bei einem Node fielen beide zusammen. Mit fn-02 nicht mehr: eine
fn-02-Zeile mit lokaler ID 2 landete beim fn-01-Controller mit globaler ID 2.

Neu, nach Stärke geordnet:

```
identityForUuid(ctx, uuid)                    // die UUID IST die Identität
identityForRoute(ctx, nodeId, localId)        // (node_id, local_controller_id)
identityFor(ctx, localId, nodeId)             // Route, dann Default-Node, dann global
```

`createIoRow()` und `reconcile()` fragen jetzt zuerst die UUID.

**`select({ options: … })`** — der DOM-Helfer erwartet `items`. Die Dropdowns im
neuen Panel blieben dadurch leer. Vom Smoke-Test gefunden.

### 6.2 Bausteinbibliotheken auf V9 gehoben

`rule_library.json` und `process_library.json` trugen noch V50-Formen:
`condition`-Bäume, Formelstrings als Vergleichswerte, `p__type`,
I/O-Listen ohne `controller_uuid`. Wer daraus etwas einfügte, erzeugte eine
Zeile, die der Validator sofort zurückwies — eine Vorlage, die schlimmer ist
als keine.

**`_tools/convert_libraries_to_v9.py`** übersetzt:

| V50 | V9 |
|---|---|
| `condition`-Baum | flache `when`-Liste (AND) |
| `"target_temp*0.98"` | `{"param_of_state": …, "key": "target_temp", "scale": 0.98}` |
| `action` (Einzelobjekt) | `do`-Liste |
| `p__type` | `mapping_id` über die Templatetabelle |
| `sensor_id: [7]` | `io_refs.sensors[{sensor_id, controller_uuid}]` |
| `control_method: "ONOFF"` | `control_strategy: null` + Klartexthinweis |

Ergebnis: `config/rule_library_v9.json` (11 Vorlagen),
`config/process_library_v9.json` (1 Vorlage), 12 Einfügehinweise.
Identitätsfelder, die eine Vorlage nicht kennen kann, bleiben `null` und stehen
unter `__template__.fill_on_insert`. Neue Endpunkte:
`/api/rule-library-v9`, `/api/process-library-v9`.

### 6.3 Entfernte Artefakte

`config/device_state_data_v8_cross_fn-01.example.json`,
`config/device_state_data_v9_node_fn-01.json`,
`config/migration_report_v9_node_fn-01.json` — ersetzt durch `config/shards/`,
das bei jedem `build_config.sh` reproduzierbar neu entsteht.
Dazu `__pycache__` und die Smoke-Test-Screenshots.

---

## 7. Neue Werkzeugkette

```
config/_incoming/*.json                     Feld-Shards (fn-01, fn-02, cross)
        │
        │  merge_shards_to_master.py --assign ctrl_wago_3=fn-02
        ▼
   master_global (roh)
        │
        │  apply_config_patch.py  ← config/_patches/*.json
        ▼
config/device_state_data_v9.json            Master, vom Editor bearbeitet
        │
        │  build_shards.py
        ▼
config/shards/                              was auf die Worker geht
```

`./build_config.sh` fährt die Kette in einem Zug und prüft jeden Schritt gegen
die Runtime-Type-Authority.

### `merge_shards_to_master.py` — das Gegenstück zu `build_shards.py`

Zieht beim Zusammenführen aktiv gerade:

* **site_id** auf die kanonische Schreibweise
* **route_key** neu berechnet aus `(site_id, node_id, local_controller_id)`
* **routing_model** auf das dreiteilige Modell
* **Kataloge** — Abweichungen zwischen Shards werden als Konflikt **gemeldet**,
  nicht stillschweigend überschrieben
* **Routing insgesamt** — `reconcile_routing()` macht die
  `site_controller_map` zur einzigen Quelle der Wahrheit und leitet
  `local_node` vollständig daraus ab. Ohne das kollidieren die
  Nummernkreise zweier Shards.

### `apply_config_patch.py` — Overlays statt Sonderskripte

Inhaltliche Erweiterungen sind **Daten**, kein Programm. Ein Patch ist eine
Teil-Config plus `__meta__` und `__remove__`; Zeilen werden über dieselben
Schlüssel wie beim Merge identifiziert, vorhandene tief gemischt, neue
angehängt. Zweimal anwenden ändert nichts.

---

## 8. Verifikation

`./test_all.sh` — neun Stufen:

| # | Stufe | Ergebnis |
|---|---|---|
| 1 | Python-Syntax | 9 Dateien ok |
| 2 | JS-Syntax + kein OOP | 30 Dateien ok, 0 Klassen, Lexer-Selbsttest 14/14 |
| 3 | Ausgabeformat Editor == Server == Runtime | 58 + 42 Prüfungen |
| 4 | Konfiguration reproduzierbar aus den Feld-Shards | Type-Authority OK |
| 5 | Migration reproduzierbar, 5/5 UUIDs = Baseline | ok |
| 6 | Rollout-Split, cross_worker durch echte Daten belegt | Split gültig |
| 7 | Bausteinbibliotheken auf V9-Format | 12 Vorlagen |
| 8 | Kern-Regressionstests | 139/139 |
| 9 | UI-Smoke-Test (Playwright, 12 Tabs) | 96/96 |

Insgesamt **335 automatisierte Prüfungen**, alle bestanden.

Der Smoke-Test fährt den Cross-Editor komplett durch die Oberfläche:
automatische Projektion → zurück auf den Startbildschirm → Projektionsdialog →
Prüfung aller sieben Vertragsbereiche → Version 8, Scope `cross`, 26 Sektionen,
`local_node` leer, keine Physik, keine Execution-Felder, Cross-Gate `OK` →
Export idempotent, beginnt mit `meta`, gliedert mit Leerzeilen, ein Objekt je
Zeile.

---

## 9. Geänderte und neue Dateien

**Neu**

| Datei | Zweck |
|---|---|
| `public/js/v9_json_format.js` | Lesbarkeitsformat (Browser) |
| `public/js/v9_provision.js` | Vorbelegung aus dem Anlagenkontext (Browser) |
| `public/js/v9_ui_cross.js` | Cross-V8-Editor |
| `_tools/format_v9_config.py` | Lesbarkeitsformat (Server) |
| `_tools/provision_defaults.py` | Vorbelegung (Server) |
| `_tools/merge_shards_to_master.py` | Shards → Master |
| `_tools/apply_config_patch.py` | Overlay-Mechanismus |
| `_tools/convert_libraries_to_v9.py` | Bibliotheken auf V9 |
| `build_config.sh` | reproduzierbare Konfigurationskette |
| `config/_patches/fn02_ausbau.json` | fn-02-Ausbau |
| `config/_patches/cross_worker_e2e_abgleich.json` | Abgleich mit der E2E-Fixture |
| `config/rule_library_v9.json`, `config/process_library_v9.json` | V9-Vorlagen |
| `config/shards/` | erzeugte Node- und Cross-Shards |
| `test/test_v9_format.mjs`, `test/test_format_parity.py` | Formattests |
| `package.json` | npm-Skripte, `type: module` |

**Geändert**

`public/js/v9_uuid.js` (Ableitung korrigiert) ·
`public/js/v9_factory.js` (Identitätsauflösung, Templatefelder) ·
`public/js/v9_schema.js` (`site_main`, Cross-Scope-Helfer, `fields`/`constraints`) ·
`public/js/v9_migrate.js` (Provisionierung, `fields`/`constraints`-Rundlauf) ·
`public/js/v9_store.js` (Textladen, Literalgedächtnis, `formatJson`) ·
`public/js/v9_validate.js` (Cross-`execution_scope`) ·
`public/js/v9_bootstrap.js` (Cross-Panel, erweiterte Test-API) ·
`public/js/v9_ui_validate.js` (Downloads im Lesbarkeitsformat) ·
`public/index.html` (12. Tab) ·
`_server_v9.py` (`format=text`, `download=`, Schreibpfad) ·
`svg_editor_tool.py` (V9-Bibliotheks-Endpunkte) ·
`_tools/canonicalize_v9_config.py` (Float-Tabelle korrigiert) ·
`_tools/migrate_config_to_v9.py` (UUID, Provisionierung) ·
`_tools/build_shards.py` (Formatter) ·
`test/test_v9_core.mjs`, `test/smoke_ui.mjs`, `test_all.sh`

---

## 10. Was bewusst offen bleibt

1. **`ONOFF` als Strategie.** Kein Editorproblem — der V9-Union sieht es nicht
   vor, die Runtime schaltet ohne Strategie ohnehin zweipunktförmig.
2. **OR-Verknüpfung in Regeln.** Der V9-Vertrag kennt `when` nur als
   UND-Liste. Der Bibliothekskonverter meldet betroffene Vorlagen im Klartext,
   statt eine Semantik zu erfinden.
3. **`match` / `priority` / `is_default` an `schema_mappings`.** Der V9-Vertrag
   führt dort nur `mapping_id` und `schema_id`. Anders als bei
   `parameter_generic_templates` gibt es hier keinen Konsumenten für additive
   Felder — sie würden mitgeschrieben, aber nie gelesen. Deshalb bewusst nicht
   konvergiert.
4. **Cross-Shard speichern.** Der Editor exportiert als Datei. Ein
   Schreib-Endpunkt wäre erst sinnvoll, wenn Authority-V5-Proposals über den
   Editor laufen sollen — das ist eine Entscheidung über den Rollout-Weg,
   keine über die Oberfläche.
