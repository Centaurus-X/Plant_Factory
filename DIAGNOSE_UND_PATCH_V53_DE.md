# Automated_SVG_Integration V53 — Entklassung und V8-Cross-Kompatibilität

**Ausgangsstand:** `Automated_SVG_Integration_52`
**Zielstand:** `Automated_SVG_Integration_53`
**Referenzsysteme:** `automation_system_v0101`, `automation_control_plane_release_v0025_r1`

Die vollständige Diagnose der Ausgangslage (V50 → V52) steht in
`DIAGNOSE_UND_PATCH_V52_DE.md`. Dieses Dokument beschreibt ausschließlich, was
in V53 dazugekommen ist.

---

## Inhalt

1. [Auftrag und Ergebnis](#1-auftrag-und-ergebnis)
2. [OOP raus: 18 Klassen → Factory-Funktionen](#2-oop-raus-18-klassen--factory-funktionen)
3. [V8-Cross: der zweite Vertrag](#3-v8-cross-der-zweite-vertrag)
4. [Rollout-Split: V9 lokal + V8 cross](#4-rollout-split-v9-lokal--v8-cross)
5. [Verifikation](#5-verifikation)
6. [Neue und geänderte Dateien](#6-neue-und-geänderte-dateien)
7. [Bedienung](#7-bedienung)
8. [Offene Punkte und nächste Schritte](#8-offene-punkte-und-nächste-schritte)

---

## 1. Auftrag und Ergebnis

| Auftrag | Ergebnis |
|---|---|
| JS-Klassen durch funktionalen Code ersetzen | **18 Klassen, 193 Methoden** in Factory-Funktionen überführt. Kein `class`, kein `new`, kein `this` mehr im Frontend. API-Oberfläche nachweislich identisch. |
| Factory zu 100 % kompatibel mit V9 **und** V8-Cross | **Beide Verträge implementiert und beidseitig verifiziert.** Erzeugte Cross-Shards bestehen `validate_cross_execution_shard()` der echten Runtime; die Runtime-Baseline besteht umgekehrt unseren Validator. |

**Zahlen:**

| Prüfung | V52 | V53 |
|---|---|---|
| Kern-Regressionstests | 64 | **125** |
| UI-Smoke-Test | 57 | **73** |
| ES-Klassen im Frontend | 18 | **0** |
| `this`-Vorkommen im Frontend-Code | 662 | **0** |
| Unterstützte Config-Verträge | V9 (node_local, master_global) | **V9 + V8-Cross** |

---

## 2. OOP raus: 18 Klassen → Factory-Funktionen

### 2.1 Ausgangslage

Die Bestandsmodule aus V50 waren klassenbasiert:

| Datei | Klassen |
|---|---|
| `core.js` | `APIClient`, `EventBus`, `AppState`, `ThemeManager` |
| `registry.js` | `TemplateRegistry`, `TemplatePaletteController` |
| `elements.js` | `ElementManager`, `CanvasController`, `LayerSynchronizer` |
| `connection_mapper.js` | `ConnectionManager`, `ConnectionUIController` |
| `ui.js` | `ProjektManager`, `PropertiesPanel`, `LayersPanel`, `StatsUpdater`, `ApplicationController` |
| `processes.js` | `ProcessesPanelController` |
| `rules_generator.js` | `RulesGeneratorController` |

Vorprüfung: **keine** dieser Klassen nutzt `extends`, `static`, Getter/Setter oder Klassenfelder. Die Umwandlung war damit rein mechanisch möglich.

### 2.2 Die Transformation

```js
// vorher
class ElementManager {
  constructor() { this.elements = new Map(); }
  addElement(id) { this.elements.set(id, {}); return this.getElement(id); }
  getElement(id) { return this.elements.get(id); }
}
export const elementManager = new ElementManager();
```

```js
// nachher
function createElementManager() {
  const self = {};

  self.addElement = function (id) {
    self.elements.set(id, {});
    return self.getElement(id);
  };

  self.getElement = function (id) {
    return self.elements.get(id);
  };

  // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
  self.elements = new Map();

  return self;
}
export const elementManager = createElementManager();
```

Drei bewusste Entscheidungen:

1. **Methoden zuerst, Konstruktorkörper danach.** Mehrere Konstruktoren rufen eigene Methoden auf (`RulesGeneratorController` startet `init()`). Die umgekehrte Reihenfolge hätte das gebrochen.
2. **`self` statt `this`.** `self` ist lexikalisch gebunden. Eine Methode, die als Callback weitergereicht wird, verliert ihren Kontext nicht mehr — das ist strikt robuster als vorher.
3. **API-Oberfläche unverändert.** Alle Exporte (`elementManager`, `canvasController`, `api`, `state`, …) heißen gleich und bieten dieselben Methoden. Kein Aufrufer musste angepasst werden.

### 2.3 Das Werkzeug: `_tools/declassify_js.py`

Eine Textersetzung wäre hier fahrlässig: `this` kommt auch in Strings, Kommentaren, Template-Literalen und Regex-Literalen vor. Das Werkzeug bringt deshalb einen kleinen JS-Lexer mit, der genau die Bereiche liefert, die echter Code sind.

Zwei Fallen, die dabei tatsächlich zugeschlagen haben — beide gefunden, beide behoben:

**Falle 1 — verschachtelte Template-Literale.** `processes.js` enthält

```js
`… ${methodOptions ? `<option disabled>— Control Methods —</option>${methodOptions}` : ''} …`
```

Die erste Lexer-Fassung verschluckte daran **22.084 Zeichen** am Stück; ein `new ProcessesPanelController()` blieb dadurch unersetzt. Behoben durch gegenseitig rekursive `skip_template` / `skip_expression`.

**Falle 2 — das `var self = this;`-Idiom.** `rules_generator.js` nutzt es an 13 Stellen, um den Klassenkontext in Callbacks zu retten. Nach der Ersetzung stünde dort `var self = self;` — eine lokale, dank Hoisting **undefinierte** Variable, die das Closure-Objekt verdeckt. Der Fehler war real und wurde vom Smoke-Test gefangen:

```
TypeError: Cannot read properties of undefined (reading 'container')
    at self.buildUI (rules_generator.js:492)
```

Behoben: solche Zeilen entfallen ersatzlos, `self` ist ja bereits gebunden.

Der Lexer hat jetzt einen **Selbsttest mit 14 Fällen** (`selftest()` in `declassify_js.py`), der in `test_all.sh` mitläuft — darunter verschachtelte Templates, `${'}'}`, escapte Backticks, Regex-vs-Division und `this` in Strings.

### 2.4 Nachweis der Gleichwertigkeit

| Prüfung | Ergebnis |
|---|---|
| Methodenmenge je Klasse vorher/nachher | **identisch** für alle 18 (statisch verglichen) |
| `node --check` über alle 27 Frontend-Dateien | ok |
| `grep "^class "` im Frontend | **0 Treffer** |
| `this` außerhalb von Kommentaren | **0 Treffer** |
| UI-Smoke-Test | 73/73 |

Zusätzlich prüft `test/test_v9_core.mjs` beides jetzt als Regression: keine ES-Klasse, kein `this`.

`shared_utils.debounce()` wurde von Hand nachgezogen — es reichte `this` per `fn.apply` weiter. Jetzt Rest-Parameter und Pfeilfunktion, ganz ohne Kontextbindung.

---

## 3. V8-Cross: der zweite Vertrag

### 3.1 Was V8-Cross ist

Ein Cross-Shard trägt die Regeln, die **mehrere Controller berühren** und deshalb nicht node-lokal, sondern über den Coordinator laufen. Er ist kein eigenes Schema, sondern das V9-Node-Schema mit **drei Relaxierungen und fünf fail-closed Verboten**.

Quelle: `_generic_type_library.build_scope_config_schema()` (:1895-1946) und `config_sharding_contracts.validate_cross_execution_shard()`.

**Relaxierungen** (weniger streng als V9):

| Sektion | V9 | V8-Cross |
|---|---|---|
| `local_node` | genau 1 Zeile | `min_len 0` — muss sogar **leer** sein |
| `controllers` | `min_len 1`, 9 Pflichtfelder | `min_len 0`, `required = [controller_uuid, controller_key, owner_node_id]` |
| `site_controller_map` | `min_len 1` | `min_len 0` |
| I/O-Zeile | `[id, group, address, bus_type, function_type, …]` | `required = [<id_field>, <group_field>]` |
| `rules` | 5 Execution-Metadatenfelder Pflicht | **nicht verlangt** |
| `meta` | `node_id` bei `node_local` | `owner_node_id` + `domain_id` Pflicht, `version 8` |

**Verbote** (strenger als V9, fail-closed):

| Regel | Meldung der Runtime |
|---|---|
| Controller ohne `bus_type`, `host`, `port`, `unit` | `cross controller stub contains physical fields …` |
| I/O ohne `address`, `bus_type`, `function_type`, `unit` | `cross <section> catalog contains physical fields …` |
| `local_node` leer | `cross shard may not contain local_node runtime ownership` |
| kein `virt_active: true` | `cross shard may not activate a hardware virtual controller` |
| jede Regel `cross_controller` oder `cross_worker` | `cross shard rule <id> is <scope>` |
| Regel-Owner == Shard-Owner | `cross shard rule <id> has wrong owner` |
| keine kritische Regelgruppe | `critical rule <id> may not exist in cross shard` |
| Writer-Sicherheit | `cross shard rule <id> is not writer-safe: …` |

### 3.2 Implementierung

**Schema (`v9_schema.js`).** `CROSS_PROFILE` beschreibt alle Relaxierungen und Verbote als Daten. `fieldsFor(section, profile)` blendet im Cross-Profil Physikfelder aus, ergänzt `owner_node_id` an Controllern und macht die Execution-Felder an Regeln optional. `requiresRows(section, profile)` kennt die abweichenden Mindestlängen. Damit bleibt die Regel aus V52 erhalten: **ein neues Vertragsfeld ist eine Zeile in `v9_schema.js`** — jetzt für beide Profile.

**Factory (`v9_factory.js`).** Sieben Cross-Factories erzeugen gezielt reduzierte Datensätze, statt V9-Zeilen zu kopieren und hinterher zu putzen:

```
createCrossMeta        version 8, scope cross, owner_node_id + domain_id
createCrossController  nur controller_id/uuid/key/owner_node_id
createCrossSensor      logische Identität, kein address/bus_type/function_type
createCrossActuator    dito
createCrossRoute       ohne site_id, route_key = "<node>.ctrl_<id>"
createCrossRule        ohne die fünf Execution-Metadatenfelder
createCrossProcess     wie V9 (owner_node_id ist dort ohnehin Pflicht)
```

Dazu zwei Einstiegspunkte:

* `makeFor(profile, section, patch, ctx)` — profilbewusster Dispatch, `'node'` oder `'cross'`.
* `stripPhysicalFields(config)` — **der Kern der 100-%-Kompatibilität.** Reduziert eine beliebige Config auf die im Cross-Shard erlaubte Feldmenge. Idempotent, per Test abgesichert. Eine V9-Zeile wird damit garantiert zu einer vertragskonformen V8-Cross-Zeile.

**Validator (`v9_validate.js`).** `validateCrossShard(config, {scopes})` spiegelt alle 15 Prüfungen von `validate_cross_execution_shard()` in derselben Reihenfolge. `validateProfile(config)` wählt anhand von `meta.scope` automatisch Node- oder Cross-Prüfung.

Der Strukturprüfer ist profilbewusst geworden: `local_node` ist im Node-Profil ein Pflicht-Singleton, im Cross-Profil muss es leer sein. Beides wird jetzt korrekt unterschieden.

### 3.3 Beidseitige Kompatibilität

| Richtung | Ergebnis |
|---|---|
| Unser Cross-Shard → `verify_storage_config_data()` | **OK**, 0 Fehler, 0 Warnungen |
| Unser Cross-Shard → `validate_cross_execution_shard()` | **OK** |
| Unser Cross-Shard → `validate_controller_ownership()` | **OK** |
| Unser Cross-Shard → `decompose(allow_cross_v8=True)` | **148 Entities**, Roundtrip True |
| Runtime-Baseline `device_state_data_v8_cross_fn-01.json` → unser Validator | **OK**, 0 Fehler |
| JS-Projektion vs. Python-Projektion | nach Kanonisierung **byte- und fingerprint-identisch** |

Ein Detail, das dabei auffiel: `decompose()` verlangt auch für Cross-Shards die **vollständige Sektionsmenge (26)**, während die ausgelieferte Runtime-Baseline `sites` weglässt und deshalb nur `verify_storage_config_data()` besteht, nicht die Entity-Registry. V53 führt `sites` daher mit — das ist strikt kompatibler. Mit `options.omitSites` lässt sich das Baseline-Verhalten exakt nachbilden.

---

## 4. Rollout-Split: V9 lokal + V8 cross

### 4.1 Die Entscheidungsregel

Nicht jede cross-scoped Regel gehört in einen Cross-Shard. `cross_rule_eligibility()` verlangt vier Dinge:

```
a) Regelgraph ist cross_controller oder cross_worker
b) keine kritische Regelgruppe
c) die Regel schreibt ausschließlich cross-eigene States
d) sie hat überhaupt ein cross-eigenes Ziel (oder ist reine notify-Regel)
```

Punkt (c) ist der interessante. Eine Regel, die einen Sensor an Controller A liest und einen State an Controller B schreibt, ist graphseitig `cross_controller` — aber **nicht writer-safe**: der Coordinator würde in einen State schreiben, den der lokale Worker besitzt.

Die richtige Auflösung ist nicht „Fehler", sondern **node-lokale Ausführung mit entferntem Signal**. Genau dafür deklariert die Engine

```json
"remote_signal_refs": "allowed_by_controller_uuid"
```

V53 behandelt das entsprechend: solche Regeln bleiben im V9-Node-Shard, und die Oberfläche begründet das je Regel im Klartext. Das ist kein Mangel, sondern die vorgesehene Aufteilung.

**In der mitgelieferten Demo-Config trifft das auf beide Regeln zu** — es entsteht daher (korrekterweise) kein Cross-Shard. Für den Nachweis der Cross-Erzeugung liegt `test/fixtures/cross_demo_v9.json` bei: dort schreibt Regel 3 zwei echte cross-eigene States.

### 4.2 Die Split-Invariante

`validate_split_shards()` verlangt, dass Local- und Cross-Regelmengen **disjunkt** sind und zusammen **jede ausführbare Regel** abdecken. `splitShards()` erfüllt das konstruktiv:

1. `crossRuleIds()` bestimmt die cross-fähigen Regeln.
2. Die Node-Shards schließen genau diese IDs aus (`excludeRuleIds`).
3. `validateSplit()` prüft Überlappung, Lücken und ungebundene Regeln und meldet jede Abweichung mit Ursache.

Am Anfang der Implementierung war das nicht so: die erste Fassung ließ Regel 1 in **beiden** Shards landen. Der Test hat es gefangen (`split_overlap`), die Ursache war der zu grobe Scope-Filter statt der exakten ID-Menge.

### 4.3 Wo man das sieht

**Oberfläche** — Tab *Validierung*, neue Karte „Rollout-Split — V9 lokal + V8 cross":

* je Shard Art, Owner, Version, Zählwerte, Kontraktstatus, JSON-Ansicht und Download
* aufklappbar: Cross-Eignung je Regel mit Graph-Scope, geschriebenen States, Ziel-Shard und Begründung
* „Alle Shards herunterladen" für den kompletten Rollout-Satz

**API**

| Endpunkt | Antwort |
|---|---|
| `GET /api/v9/split` | Split-Status, Statistik, Eignung je Regel, Zählwerte je Shard |
| `GET /api/v9/cross/{owner_node_id}` | fertiger V8-Cross-Shard (404 mit Begründung, falls kein Owner cross-fähige Regeln hat) |

**Kommandozeile**

```bash
python3 _tools/build_shards.py config/device_state_data_v9.json --out config/shards --verify
```

Schreibt alle Shards, kanonisiert die Zahlentypen und prüft — falls die Runtime im `PYTHONPATH` liegt — jeden erzeugten Shard gegen Type Authority und Cross-Gate.

---

## 5. Verifikation

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 CHROMIUM_PATH=/pfad/zu/chrome bash test_all.sh
```

| Stufe | Umfang | Ergebnis |
|---|---|---|
| 1 · Python-Syntax | 5 Dateien | ok |
| 2 · JS-Syntax **+ kein OOP** | 27 Dateien, `class`-Sperre, Lexer-Selbsttest (14 Fälle) | ok |
| 3 · Migration reproduzierbar | Neuerzeugung == Auslieferung | ok |
| 4 · **Rollout-Split** | Demo-Config + Cross-Fixture, je mit Runtime-Tiefprüfung, danach 20 Struktur- und Verbotsassertions am V8-Shard | ok |
| 5 · Kern-Regressionstests | **125 Prüfungen** | **125/125** |
| 6 · UI-Smoke-Test | **73 Prüfungen** | **73/73** |

### Was die 61 neuen Kerntests abdecken

* `CROSS_PROFILE`-Konstanten gegen den Runtime-Vertrag
* jede Cross-Factory einzeln: erzeugte Feldmenge exakt geprüft
* `stripPhysicalFields`: vollständig und **idempotent**
* `fieldsFor(section, 'cross')`: Physikfelder ausgeblendet, Execution-Felder optional
* `makeFor('cross'|'node', …)`: korrekter Dispatch
* Split auf der Demo-Config (0 Cross-Shards, gültig) **und** auf der Fixture (1 Cross-Shard)
* Cross-Shard: Version, Scope, Owner, Domain, leeres `local_node`, 26 Sektionen, keine Physikfelder, keine Execution-Metadaten, nur cross-eigene Schreibziele
* **sieben Negativproben** — der Validator muss jeden einzelnen Vertragsbruch fangen: Physikfeld am Controller, Physikfeld am Sensor, gefülltes `local_node`, aktiver virtueller Controller, kritische Regelgruppe, falsche Version, fehlende Domain
* `validateSplit` erkennt künstlich erzeugte Überlappung
* `isCriticalRule` in allen vier Erkennungsformen, `mutatedStateIds` über `do` + `else_do`
* kein `class`, kein `this` im Frontend

### Was die 16 neuen Smoke-Tests abdecken

Rollout-Split-Karte im Panel vorhanden · `splitShards` im Browser aufrufbar · Split disjunkt und vollständig · Cross-Eignung begründet · Cross-Shard aus der Fixture **im Browser** erzeugt und validiert (Version, Scope, 26 Sektionen, leeres `local_node`, keine Physikfelder) · `/api/v9/split` erreichbar · Store liefert ein einfaches Objekt statt einer Klasseninstanz.

---

## 6. Neue und geänderte Dateien

### Neu

```
DIAGNOSE_UND_PATCH_V53_DE.md             dieses Dokument
_tools/declassify_js.py                  Klassen -> Factory-Funktionen, mit Lexer-Selbsttest
_tools/build_shards.py                   Rollout-Shards von der Kommandozeile
config/declassify_report_v53.json         Protokoll der Entklassung
config/device_state_data_v8_cross_fn-01.example.json   Beispiel-Cross-Shard
test/fixtures/cross_demo_v9.json         V9-Config mit echter cross-fähiger Regel
```

### Geändert

| Datei | Änderung |
|---|---|
| `public/js/core.js`, `registry.js`, `elements.js`, `connection_mapper.js`, `ui.js`, `processes.js`, `rules_generator.js` | **entklassifiziert** (18 Klassen, 193 Methoden, 662 `this`, 20 `new`, 13 `self`-Aliase) |
| `public/js/shared_utils.js` | `debounce` ohne `this` |
| `public/js/v9_schema.js` | `CROSS_PROFILE`, `isCrossConfig`, `profileOf`, `fieldsFor`, `requiresRows` |
| `public/js/v9_factory.js` | 7 Cross-Factories, `makeFor`, `stripPhysicalFields` |
| `public/js/v9_validate.js` | `validateCrossShard`, `validateProfile`, `isCriticalRule`, `mutatedStateIds`, profilbewusste Strukturprüfung |
| `public/js/v9_shard.js` | `projectCrossShard`, `crossEligibility`, `crossRuleIds`, `listCrossOwners`, `splitShards`, `validateSplit`, `ruleNodes` in `classifyScopes` |
| `public/js/v9_ui_validate.js` | Karte „Rollout-Split", Cross-Eignung je Regel, Shard-Downloads |
| `public/js/v9_bootstrap.js` | Split-API unter `window.__v9` |
| `_server_v9.py` | Python-Zwilling: `classify_scopes`, `cross_eligibility`, `project_cross_shard`, `split_shards`; Endpunkte `/api/v9/cross/{owner}` und `/api/v9/split` |
| `svg_editor_tool.py` | statische Route `/test/fixtures` für den Smoke-Test |
| `test/test_v9_core.mjs` | 64 → **125** Prüfungen |
| `test/smoke_ui.mjs` | 57 → **73** Prüfungen |
| `test_all.sh` | 5 → **6** Stufen, Split-Verifikation und OOP-Sperre |

---

## 7. Bedienung

```bash
./run.sh                                   # Editor starten
AUTOMATION_RUNTIME=/pfad/zu/v0101 ./run.sh # mit Runtime-Tiefprüfung
bash test_all.sh                           # vollständige Verifikation

# Rollout-Shards erzeugen
python3 _tools/build_shards.py config/device_state_data_v9.json --out config/shards --verify

# Klassen einer eigenen JS-Datei auflösen
python3 _tools/declassify_js.py pfad/zur/datei.js
```

Im Browser: Tab **Validierung** → Karte *Rollout-Split*. Dort steht je Regel, ob sie lokal oder cross läuft und warum.

---

## 8. Offene Punkte und nächste Schritte

**Unverändert offen aus V52** (siehe dort §9):

* Zusammenführung der Alt-Regelmodelle (`dynamic_rule_engine`, `automation_rule_sets`)
* zwei parallele Drag-Implementierungen in `elements.js`
* `hmi.js` mit 4.298 Zeilen und dreifacher Widget-Styling-Logik
* rund 950 Zeilen auskommentierter Alt-Code
* die zwei provisionierten Platzhalter (`ctrl_unconfigured_5`, `unconfigured_process_6`)

**Neu offen:**

* **Cross-Shard-Bearbeitung im UI.** V53 *erzeugt* und *prüft* Cross-Shards; ein eigener Editor dafür fehlt. Praktisch relevant erst, wenn Cross-Regeln direkt gepflegt werden sollen statt aus der Master-Config abgeleitet.
* **`cross_worker`-Fall ungetestet mit echten Daten.** Der Code behandelt ihn (mehrere Owner-Nodes → eigener Shard je Owner), die mitgelieferten Konfigurationen haben aber nur einen Node. Ein Zwei-Node-Testfall wäre der nächste sinnvolle Ausbau.

**Vorschlag für V54 — Authority-V5-Proposals.** Damit wäre der Anschluss an die Control Plane komplett: statt Vollschreiben erzeugt der Editor `config_scope_operations_v1` (`replace_field` / `upsert_entity` / `delete_entity`, max. 500 Operationen, `value_hash` als Fingerprint). Alle Voraussetzungen stehen:

* Der Store kennt seine Änderungshistorie (60 Schritte).
* Die Fingerprint-Stabilität über den Editor-Roundtrip ist seit V52 nachgewiesen.
* Die Entity-Keys sind über `decompose()` bereits definiert.

Sagen Sie gern Bescheid, ob V54 in diese Richtung gehen soll oder ob zuerst der `cross_worker`-Testfall mit zwei Nodes dran ist.
