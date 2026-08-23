# Plant Factory · Automated_SVG_Integration V55.2

P&ID-/HMI-SVG-Editor auf Basis des kanonischen **V9-Config-Vertrags** mit
eigenständigem Editor für **V8-Cross-Shards**.

V55.1 hat die Oberfläche geändert, nicht das System: eigener Symbolsatz statt
Emoji, beschaffbare Schriften statt nie geladener, ein Farbsystem statt zweier,
zwölf Tabs in drei Gruppen, eine Statusleiste, die den Vertragszustand zeigt,
und eine Zeichenfläche mit Linealen und Zoom am Ort der Handlung.

**V55.2** behebt drei Layoutfehler aus V55.1: Tabzeile und Werkzeugleiste
schnitten Bedienelemente ab, statt zu rollen — „Export" und „Löschen" waren
unerreichbar; das Projektnamenfeld war auf 18 px geschrumpft. Beide Leisten
rollen jetzt waagerecht, das Namensfeld hat eine Mindestbreite, und die
Testkette prüft beides.

Format, Prüfungen und Funktionsumfang sind in beiden Runden unverändert —
Einzelheiten in **`DIAGNOSE_UND_PATCH_V55_2_DE.md`** und
**`DIAGNOSE_UND_PATCH_V55_1_DE.md`**. Die Konfigurations- und Stellpfad-
Korrekturen aus V54.3 stehen in **`DIAGNOSE_UND_PATCH_V54_3_DE.md`**.

---

## Schnellstart

```bash
pip install -r requirements.txt

# Optional, aber empfohlen: die Runtime für die Tiefprüfung sichtbar machen
export PYTHONPATH=/pfad/zu/automation_system_v0101

./run.sh                     # Editor unter http://localhost:8090

python3 _tools/fetch_fonts.py   # Schriften einmalig holen (optional)
```

---

## Die zwölf Bereiche, in drei Gruppen

Seit V55.1 liegen die Tabs nicht mehr gleichrangig in einer umbrechenden
Reihe, sondern in drei Gruppen entlang des Arbeitsablaufs. Passt eine Gruppe
nicht in die Leistenbreite, rollt die Zeile waagerecht — seit V55.2
verschwindet kein Tab hinter der Kante.

| Gruppe | Bereiche | Inhalt |
|---|---|---|
| **Zeichnung** | Elements · Connections · Device · HMI | Anlagenbild zeichnen und an I/O binden |
| **Automatisierung** | Processes · Rules · States V9 · Rules V9 | Prozesszustände (`io_refs`, `mapping_id`, `control_strategy`), RuleEngine, Filter, Timer |
| **Rollout** | Validierung · Topologie · Cross V8 · Export | Kontraktprüfung, Scope-Klassifikation, Rollout-Split, sites/nodes/Routen, V8-Cross-Editor, SCADA-Bundle |

Die Bezeichner im DOM sind unverändert (`#tab-btn-…`, `data-tab`); die Gruppe
steht als `data-group` daneben.

## Oberfläche

| | |
|---|---|
| Schrift | Public Sans (Oberfläche), IBM Plex Mono (IDs, UUIDs, Fingerprints, Koordinaten) — **mitgeliefert**, siehe `public/fonts/README.md` |
| Symbole | 33 Strichsymbole, inline in `index.html`, Einzelnachweis in `public/icons.svg` |
| Farbe | warme neutrale Basis, ein Akzent (Violett). Die fünf Zustandsfarben der Anlage bleiben unverändert — sie sind eine Sicherheitskonvention |
| Tokens | ausschließlich `public/css/tokens.css`, auch für die Alt-Variablen |
| Stylesheets | `tokens → fonts → style → layout → components → bridge` — die Reihenfolge ist bindend |

`public/css/bridge.css` hebt die Klassen der Bestandsoberfläche auf die
Geometrie der V9-Komponenten, ohne ein Modul anzufassen. Entfernt man die
Datei aus `index.html`, ist die Darstellung von V54.3 zurück.

---

## Konfiguration neu erzeugen

Die ausgelieferte Konfiguration entsteht reproduzierbar aus den Feld-Shards:

```bash
./build_config.sh
```

```
config/_incoming/*.json                     Feld-Shards (fn-01, fn-02, cross)
        │  merge_shards_to_master.py --assign ctrl_wago_3=fn-02
        ▼
   master_global (roh)
        │  apply_config_patch.py  ← config/_patches/*.json
        ▼
config/device_state_data_v9.json            Master, vom Editor bearbeitet
        │  build_shards.py
        ▼
config/shards/                              was auf die Worker geht
```

---

## Verifikation

```bash
./test_all.sh          # 13 Stufen (Stufe 3 neu: Oberflächen-Invarianten)
npm test               # JS-Regression + Format + Plant-Factory-Kette
npm run test:contract  # Regelvertrag gegen die echte Runtime
npm run test:factory   # Zeichnen -> Binden -> Exportieren -> Animieren
npm run test:snapshot  # Konfigurationssicherung im Anlagenbild
npm run test:format    # Formatparität Editor/Server/Runtime
```

Der UI-Smoke-Test braucht Playwright (`npm i playwright`). In Umgebungen mit
vorinstalliertem Chromium hilft `CHROMIUM_PATH=/pfad/zu/chrome`.

---

## Werkzeuge

| Werkzeug | Zweck |
|---|---|
| `_tools/merge_shards_to_master.py` | Feld-Shards → `master_global` |
| `_tools/build_shards.py` | `master_global` → Node- und Cross-Shards |
| `_tools/apply_config_patch.py` | Overlay-Patches auf eine Config legen |
| `_tools/migrate_config_to_v9.py` | V50-Config → V9 |
| `_tools/format_v9_config.py` | kanonisches Lesbarkeitsformat (auch `--check`) |
| `_tools/canonicalize_v9_config.py` | Zahlentypen für Fingerprint-Stabilität |
| `_tools/convert_libraries_to_v9.py` | Bausteinbibliotheken auf V9 heben |
| `_tools/declassify_js.py` | JS-Klassen → Factory-Funktionen |
| `_tools/fetch_fonts.py` | die acht Schriftdateien holen, benennen, prüfen |

---

## API

| Endpunkt | Zweck |
|---|---|
| `GET /api/v9/config` | Master-Config; `?format=text` liefert das Lesbarkeitsformat |
| `POST /api/v9/config` | speichern (kanonisiert, geprüft, formatiert, mit Backup) |
| `GET /api/v9/shard/{node_id}` | Node-Shard; `?download=<name>` als Datei |
| `GET /api/v9/cross/{owner_node_id}` | Cross-Shard (V8) |
| `GET /api/v9/split` | Rollout-Split mit Begründung je Regel |
| `GET /api/v9/report` | Sektionszähler, Fingerprint, Migrationsprotokoll |
| `GET /api/device-config` | Editor-Projektion für die Bestandsmodule |
| `GET /api/rule-library-v9`, `/api/process-library-v9` | V9-Bausteinvorlagen |

---

## Zwei Verträge

**V9 (`node_local` / `master_global`)** — 26 Sektionen, exakt. Identität ist
`controller_uuid` plus lokale I/O-ID, Routing ist
`site_id + node_id + local_controller_id`.

**V8-Cross (`cross`)** — dasselbe Schema mit drei Lockerungen und fünf
fail-closed-Verboten: keine Physik an Controllern (`bus_type`, `host`, `port`,
`unit`) und I/O (`address`, `bus_type`, `function_type`), keine
V9-Execution-Metadaten an Regeln, `local_node` leer, keine kritischen
Regelgruppen.

### `controller_uuid` — die verbindliche Ableitung

```
controller_uuid = uuid5(NAMESPACE_DNS, "<site_id>.<mint_node_id>.<device_name>")
```

Namespace ist `NAMESPACE_DNS`, Trenner ist der **Punkt**, maßgeblich ist der
`device_name` (`wago_1`), **nicht** der `controller_key` (`ctrl_wago_1`).
Die Identität wird einmal bei der Provisionierung geprägt und bleibt beim
Node-Wechsel stabil (`mintNodeId`).

### `execution_scope`

```
active_node   ->  "node:<owner>"
active_cross  ->  "cross:<owner>.default"   (+ cross_domain_id)
```

### `control_strategy` — drei Formen, kein ONOFF

```
null                                   Runtime waehlt selbst:
                                       write_coil-Aktor oder hysteresis* -> Zweipunkt
                                       sonst                             -> P-Regler
{"type":"PID", "pid_config_id": N}
{"type":"control_method", "method_id": N}
```

---

## SCADA-Bundle exportieren

Export erzeugt fuenf Dateien:

| Datei | Inhalt |
|---|---|
| `<name>.svg` | Anlagenbild mit eingebetteter Zustands-CSS, `viewBox` **und der vollstaendigen V9-Konfiguration als Snapshot** |
| `<name>.json` | Editor-Sicht der Konfiguration inkl. HMI-Modell |
| `<name>.html` | Laufzeit-Layer: laedt SVG + JSON, startet die Signalbruecke |
| `signals.json` | Startvorlage der Signalquelle mit den echten Schluesseln |
| `hmi_runtime.js` | die Laufzeit |

Eigene Datenquelle anbinden: die HTML-Datei mit `?signals=<url>` aufrufen oder
`signals.json` durch einen Endpunkt ersetzen, der dasselbe Format liefert:

```json
{ "signals": { "sensor:1:value": 542.5, "state:1:value_id": 1 } }
```

Schluesselformat: `<kind>:<id>:<field>` — wie `hmi_runtime.toKeyFromRef()`.
Ohne erreichbare Quelle laeuft ein sichtbar gekennzeichneter Demo-Modus.

### Zustands- und Animationsklassen

| Klasse | Wirkung |
|---|---|
| `ok-green`, `warn-yellow`, `alarm-red`, `info-blue`, `idle-grey` | faerbt Rahmen und markierte Fuellflaechen (`data-hmi-fill="1"`) |
| `hmi-anim-blink`, `hmi-anim-pulse`, `hmi-anim-flow` | Blinken, Pulsieren, fliessende Linie |

Definiert an EINER Stelle: `public/js/hmi_animation.js`.

---

---

## Konfigurationssicherung im Anlagenbild

Jeder Export legt die V9-Konfiguration **woertlich** in das SVG — Master und
alle Shards, byte-genau, mit Fingerprint. Damit ist das Anlagenbild
selbsttragend: geht die Worker-Config verloren, genuegt diese eine Datei.

```bash
# Was steckt drin?
python3 _tools/config_snapshot.py inspect anlage.svg

# Konfiguration herausholen (byte-genau)
python3 _tools/config_snapshot.py extract anlage.svg --target fn-02 --out fn02.json

# Gegen den laufenden Stand halten
python3 _tools/config_snapshot.py compare anlage.svg --head config/device_state_data_v9.json

# Wiederherstellen — auch wenn keine Worker-Config mehr da ist
python3 _tools/config_snapshot.py restore anlage.svg --verify
```

Der Vergleich ordnet ein, statt zu blockieren:

| Lage | Bedeutung |
|---|---|
| `identical` | Fingerprints gleich — nichts zu tun |
| `stale` | Snapshot aelter als der laufende Stand |
| `ahead` | Snapshot **neuer** — Rueckfall nach einem Ausfall |
| `unrelated` | anderer Node oder Scope (nur hier braucht es `--force`) |
| `no_head` | kein laufender Stand — der Snapshot ist die einzige Quelle |

`restore` legt vor dem Ueberschreiben eine Sicherung `*.vor_restore` daneben.

Der Snapshot steht als Klartext in `<metadata>` — mit `grep` und einem
Texteditor rettbar, auch ohne dieses Werkzeug.

---

Details, Diagnose und Nachweise:
**`DIAGNOSE_UND_PATCH_V54_3_DE.md`** (aktuell, Oberfläche) und
**`DIAGNOSE_UND_PATCH_V54_2_DE.md`** (Vorrunde, Konfigurations-Snapshot).
