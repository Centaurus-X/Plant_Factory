# Plant Factory · Automated_SVG_Integration V56.1

V56.1 überführt den vollständigen Funktionsumfang der V55.2 in einen neuen,
professionellen **Industrial Engineering Workspace**. Der fachliche Kern,
der V9-Konfigurationsvertrag, der V8-Cross-Rollout, die Projektdateien und die
bestehenden API-Verträge bleiben kompatibel. Geändert wurde vor allem, **wie**
die Funktionen organisiert und bedient werden.

## Ziel des Systems

Plant Factory ist eine integrierte Engineering-Umgebung für:

- P&ID-/R&I-Anlagenbilder auf SVG-Basis,
- HMI-Bindings, Zustände, Animationen und Runtime-Vorschau,
- Geräte-, Sensor- und Aktorzuordnung,
- Prozesszustände und Automatisierungsregeln,
- V9-Master-Konfiguration sowie lokale V9-Node-Shards,
- eigenständige V8-Cross-Shards,
- Validierung, Fingerprints, Migration und reproduzierbaren Rollout,
- SCADA-Export mit eingebettetem Konfigurations-Snapshot.

## Was V56.1 verändert

Die zwölf fachlichen Bereiche der V55.2 werden nicht mehr als gleichartige
Tabs in einer schmalen Seitenleiste dargestellt. V56.1 ordnet sie in fünf
Arbeitsräume ein:

| Arbeitsraum | Enthaltene Funktionen | Darstellung |
|---|---|---|
| **Engineering** | Elements, Connections, Device | Canvas, Bibliothek und Kontextinspektor |
| **Automatisierung** | Processes, Rules, States V9, Rules V9 | Vollbreiten-Arbeitsfläche |
| **Topologie & Rollout** | Topologie, Cross V8, Export | Vollbreiten-Arbeitsfläche |
| **Runtime** | HMI | Canvas mit HMI-Konfiguration und Vorschau |
| **Validierung** | Validierung | Vollbreiten-Prüfbereich |

Die neuen sichtbaren Bedienelemente sprechen weiterhin die vorhandenen
Controller an. Die ursprünglichen DOM-Verträge bleiben erhalten:

- alle zwölf `#tab-btn-*`-IDs,
- alle zwölf `#tab-*`-Panels,
- bestehende programmatische Tabwechsel aus den Fachmodulen,
- alle Projekt-, Config-, Shard- und Export-APIs.

`public/js/v56_workspace.js` bildet die neue Navigation auf diese bewährten
Verträge ab. Dadurch gibt es keine zweite, abweichende Fachlogik.

## Neue Oberfläche

### Anwendungskopf

Der Kopf zeigt den aktuellen Projektkontext, den V9-Vertragsstatus und die
primären Aktionen **Vorschau**, **Laden**, **Export** und **Speichern**. Der
Status unterscheidet Fehler und Hinweise, statt eine hohe Hinweiszahl als
Fehlerzustand erscheinen zu lassen.

### Workspace-Rail

Die dunkle linke Rail wechselt zwischen Engineering, Automatisierung,
Topologie, Runtime und Validierung. Ein Badge zeigt die Zahl aktueller
Prüfhinweise.

### Symbolbibliothek

Die Bibliothek besitzt Suche, Kategorieauswahl, kompakte Symbolkarten,
Template-Zähler und den Custom-SVG-Import. `Ctrl+K` fokussiert die Suche.

### Canvas

Der Canvas verwendet den verfügbaren Raum als primäre Arbeitsfläche. Er
enthält Lineale, Raster, Zoom, Auswahl- und Handwerkzeug, Einrasten,
Undo/Redo, einen leeren Einstiegzustand sowie einen begrenzten Auswahl-Chip.

### Kontextinspektor

Elementeigenschaften, I/O, HMI, Verbindungen und Ebenen erscheinen nur dort,
wo sie für die aktuelle Auswahl sinnvoll sind. Der Inspektor kann eingeklappt
und weiterhin über den vorhandenen Splitter in der Breite verändert werden.

### Vollbreitenbereiche

Prozesse, Regeln, V9-Zustände, V9-Regeln, Topologie, Cross V8, Validierung und
Export werden aus der alten Seitenleiste herausgelöst und als vollständige
Arbeitsflächen dargestellt. Tabellen und Formulare erhalten dadurch die
Breite, für die sie fachlich gebaut wurden.

## Start

```bash
python3 -m pip install -r requirements.txt
./run.sh
```

Danach ist die Anwendung standardmäßig unter folgender Adresse erreichbar:

```text
http://127.0.0.1:8090/
```

Der Bind-Host und Port kommen aus `config/server.yaml`. Die ausgelieferte
Konfiguration bindet aus Kompatibilitätsgründen weiterhin an `0.0.0.0`. In
einer nicht abgeschotteten Umgebung sollte der Host auf `127.0.0.1` gesetzt
oder ein authentifizierender Reverse Proxy vorgeschaltet werden.

## Verifikation

Die vollständige Release-Prüfung lautet:

```bash
./test_all.sh
```

Der UI-Smoke-Test ist in V56.1 verpflichtend. Er wird nicht mehr still
übersprungen. Unterstützt werden:

```bash
# Node-Playwright
npm install
npm run test:smoke

# Python-Playwright als Fallback
python3 -m pip install playwright
CHROMIUM_PATH=/usr/bin/chromium python3 test/smoke_ui.py
```

Weitere Einzelprüfungen:

```bash
npm test
npm run test:format
npm run test:contract
npm run test:factory
npm run test:snapshot
./build_config.sh
```

Im geprüften Release bestanden:

| Prüfbereich | Ergebnis |
|---|---:|
| Editor/Server/Runtime-Formatparität | 58 + 42 Prüfungen |
| Regelvertrag | 15 Prüfungen |
| Plant-Factory-Kette | 31 Prüfungen |
| Snapshot-Kette | 52 Prüfungen |
| V9-Kernregression | 145 Prüfungen |
| verpflichtender Browser-Smoke | 79 Prüfungen |
| erweiterter UI-/Routing-Audit | 103 Prüfungen, 0 Page- und 0 Request-Fehler |

Die Tiefprüfung gegen eine externe Automation-Runtime wird ausgeführt, sobald
diese über `PYTHONPATH` oder `AUTOMATION_RUNTIME` bereitgestellt wird. Ohne
diese externe Quelle bleiben alle lokalen Vertragsprüfungen aktiv; nur die
zusätzliche Runtime-Type-Authority-Prüfung wird ausdrücklich als
übersprungen gemeldet.

## Konfiguration und Rollout

Die Master-Konfiguration wird reproduzierbar aus den Feld-Shards erstellt:

```bash
./build_config.sh
```

Der Release behält die V55.2-Kette bei:

```text
config/_incoming/*.json
        │
        ├─ merge_shards_to_master.py
        ├─ apply_config_patch.py
        ▼
config/device_state_data_v9.json
        │
        └─ build_shards.py
           ├─ V9 Node-Shards
           └─ V8 Cross-Shard
```

Der Build ist deterministisch. Die ausgelieferte Master-Konfiguration blieb
bei der Release-Prüfung bytegleich.

## Typografie und Offlinebetrieb

`public/css/fonts.css` nutzt ausschließlich lokal installierte Familien über
`local()` und die robuste System-Fallbackkette aus `tokens.css`. V56.1 lädt
keine Schriftdateien aus dem Netz und enthält keine zu verteilenden
Font-Binärdateien. Dadurch entstehen weder CDN-Abhängigkeiten noch 404-Fehler.

## Relevante neue Dateien

| Datei | Aufgabe |
|---|---|
| `public/css/workspace.css` | neue Anwendungshülle, Rail, Canvas, Inspektor, Vollbreitenbereiche, Responsive Design und Dark Mode |
| `public/js/v56_workspace.js` | funktionale Navigation und Kompatibilitätsbrücke zu allen zwölf Bestandsrouten |
| `test/smoke_ui.py` | verpflichtender funktionaler Browser-Smoke als Python-Fallback |
| `release_evidence/` | geprüfte Screenshots und Designvergleiche |
| `design-qa.md` | visuelle Abnahme gegen den ausgewählten Designentwurf |
| `DIAGNOSE_UND_RELEASE_V56_1_DE.md` | technische und visuelle Release-Diagnose |

## Bewusst unveränderte Verträge

V56.1 verändert keine der folgenden Grundlagen:

- 26 Sektionen des V9-Config-Vertrags,
- Controller-UUID-Ableitung,
- V9-Node- und V8-Cross-Split,
- Regel-, Prozess- und Snapshot-Formate,
- Projektdateien und HMI-Modell,
- SCADA-Bundle-Struktur,
- API-Routen der V55.2.

Die Oberfläche ist neu; der fachliche Datenvertrag bleibt stabil.
