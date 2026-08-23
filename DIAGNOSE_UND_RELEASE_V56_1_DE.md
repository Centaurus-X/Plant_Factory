# V56.1 — Vollständige Designmigration der V55.2

**Release:** 56.1.0  
**Ausgangsbasis:** 55.2.0  
**Ziel:** Alle vorhandenen Funktionen in einem neuen, professionellen
Industrial-Engineering-Design bereitstellen, ohne den fachlichen Datenvertrag
zu duplizieren oder zu verändern.

## 1. Ausgangsanalyse

Die V55.2 wurde vollständig entpackt und als eigenständige Release-Basis
geprüft. Der Bestand umfasste 189 Dateien. Das System besteht aus vier
aufeinander aufbauenden Schichten:

1. **SVG-/P&ID-Editor** mit Template-Bibliothek, Elementen, Verbindungen,
   Transformationen und Projektverwaltung.
2. **HMI-Schicht** mit Bindings, Zustandsfarben, Animationen, Runtime-Vorschau
   und SCADA-Export.
3. **Automatisierungsmodell** mit Prozessen, Regeln, Filtern, Timern,
   Prozesszuständen und RuleEngine-Verträgen.
4. **V9-/V8-Konfigurationsschicht** mit Master-Konfiguration, Node-Shards,
   Cross-Shards, Topologie, Validierung, Migration, Fingerprints und
   Snapshot-Recovery.

Die V55.2 hatte den Funktionsumfang bereits vollständig bereitgestellt. Ihr
visuelles Modell behandelte jedoch zwölf sehr unterschiedliche Fachbereiche
weiterhin als gleichartige Tabs. Tabellen, Automatisierungseditoren und
Topologieansichten mussten dadurch in einer schmalen rechten Seitenleiste
arbeiten.

## 2. Architekturentscheidung

Eine Neuentwicklung der Fachmodule wäre unnötig und riskant gewesen. V56.1
verwendet deshalb ein **Adaptermodell**:

```text
neue sichtbare Workspace-Navigation
               │
               ▼
public/js/v56_workspace.js
               │
               ▼
vorhandene #tab-btn-* / #tab-* Verträge
               │
               ▼
bestehende Fachmodule und APIs der V55.2
```

Die vorhandene Tab-Steuerung bleibt die einzige Quelle für den aktiven
Fachbereich. Acht große Panels werden beim Start in einen Vollbreiten-Host
verschoben. Vier Canvas-nahe Bereiche bleiben im Kontextinspektor. Alte
Navigationsleisten bleiben programmatisch vorhanden, werden jedoch nicht
mehr als Benutzeroberfläche angezeigt.

Damit bleiben auch interne Aufrufe wie das programmgesteuerte Öffnen von
`#tab-btn-hmi` funktionsfähig.

## 3. Funktionsabdeckung

| V55.2-Funktion | V56.1-Arbeitsraum | Verifikation |
|---|---|---|
| Elements | Engineering / Inspektor | Route, Panel, Auswahl und Properties geprüft |
| Connections | Engineering / Inspektor | Route und Panel geprüft |
| Device | Engineering / Inspektor | Route und Panel geprüft |
| HMI | Runtime / Inspektor | Route, Preview-Aktion und Panel geprüft |
| Processes | Automatisierung / Vollbreite | Route, Panel-Host und Sichtbarkeit geprüft |
| Rules | Automatisierung / Vollbreite | Route, Panel-Host und Sichtbarkeit geprüft |
| States V9 | Automatisierung / Vollbreite | Route, Panel-Host und Sichtbarkeit geprüft |
| Rules V9 | Automatisierung / Vollbreite | Route, Panel-Host und Sichtbarkeit geprüft |
| Topologie | Topologie / Vollbreite | Route, Tabellen und Panel-Host geprüft |
| Cross V8 | Topologie / Vollbreite | Route und Panel-Host geprüft |
| Validierung | Validierung / Vollbreite | Route, Badge und Panel-Host geprüft |
| Export | Topologie / Vollbreite | Route und Panel-Host geprüft |

Zusätzlich geprüft wurden Projektladen, Canvas-Rendering, leere Zustände,
Dark Mode, Sidebar-Einklappen, Template-Suche, Kategorie-Chips, Responsive
Layout, Headeraktionen und alle primären Bedienelemente.

## 4. Visuelle Änderungen

### 4.1 Informationsarchitektur

- fünf klar benannte Arbeitsräume statt zwölf gleichrangiger Tabs,
- globale Werkzeuge als Vollbreitenansichten,
- elementbezogene Werkzeuge im Kontextinspektor,
- Projekt- und Releaseaktionen im Anwendungskopf,
- Statusinformationen in Kopf und Fuß statt in konkurrierenden Panels.

### 4.2 Canvas und Bibliothek

- deutlich größere Arbeitsfläche,
- feste dunkle Rail und separate Symbolbibliothek,
- Suchfokus über `Ctrl+K`,
- sichtbarer leerer Einstiegzustand,
- Lineale, Raster, Zoom und Shortcuts am Ort der Handlung,
- begrenzter Auswahl-Chip, der nicht mehr über den Canvas hinausragt.

### 4.3 Inspektor

- fünf eindeutige Ansichten: Details, I/O, HMI, Linien und Ebenen,
- kompakte, vollständig lesbare Tabnavigation,
- bestehende Formulare bleiben funktional und scrollbar,
- langer Elementname wird im Kopf sauber gekürzt,
- ein- und ausklappbar ohne Verlust des aktuellen Kontextes.

### 4.4 Vollbreitenbereiche

Die acht großen Fachmodule erhalten die gesamte verfügbare Breite. Dadurch
sind Formulare, Prozessparameter, Regeldefinitionen, Topologietabellen und
Validierungsdetails deutlich besser erfassbar.

### 4.5 Designsystem

- kühle neutrale Oberflächen und blauer Primärakzent,
- dunkle Navigationsrail als stabiler räumlicher Anker,
- einheitlicher SVG-Iconstil ohne Emoji,
- konsistente Abstände, Radien, Linien und Zustandsfarben,
- Light und Dark Mode,
- lokale Schriftbindung ohne Netz- oder Fontdatei-Abhängigkeit.

## 5. Technische Änderungen

### Neu

- `public/css/workspace.css`
- `public/js/v56_workspace.js`
- `test/smoke_ui.py`
- `release_evidence/`
- `README_V56_1.md`
- `design-qa.md`

### Geändert

- `public/index.html`: vollständige neue Anwendungshülle bei Erhalt aller
  Controller-IDs und Modals.
- `public/css/tokens.css`: V56.1-Farb-, Größen- und Oberflächentokens.
- `public/css/fonts.css`: ausschließlich `local()` und System-Fallbacks.
- `public/css/layout.css`, `public/css/bridge.css`: aktive Releasekennung und
  Kompatibilität mit der neuen Hülle.
- `public/js/v9_ui_chrome.js`: V56.1-Boot, Auswahl-Chip-Begrenzung und
  Entfernung der alten sichtbaren Gruppennavigation.
- `test/smoke_ui.mjs`: Prüfung der neuen Workspace-Struktur.
- `test_all.sh`: neue statische Invarianten und verpflichtender
  Browser-Smoke mit Node-/Python-Fallback.
- `VERSION`, `package.json`, `svg_editor_tool.py`: Release 56.1.0.

## 6. Release-Verifikation

### 6.1 Statische und syntaktische Prüfung

- alle Python-Dateien parsbar,
- alle JavaScript- und MJS-Dateien syntaktisch gültig,
- keine ES-Klassen im Frontend,
- neue Workspace-Logik rein funktional und ohne Arrow Functions,
- exakt zwölf kompatible Routen und Panels,
- exakt fünf Hauptarbeitsräume,
- exakt fünf Inspektoransichten,
- exakt acht Vollbreiten-Panels,
- keine fehlenden oder externen Font-Ressourcen,
- Versionskennung 56.1.0 in allen aktiven Artefakten.

### 6.2 Fachliche Regression

| Prüfung | Ergebnis |
|---|---:|
| Python-Formatparität | 58 bestanden, 0 fehlgeschlagen |
| JavaScript-Formatvertrag | 42 bestanden, 0 fehlgeschlagen |
| Regelvertrag | 15 bestanden, 0 fehlgeschlagen |
| Plant-Factory-Kette | 31 bestanden, 0 fehlgeschlagen |
| Snapshot-Kette | 52 bestanden, 0 fehlgeschlagen |
| V9-Kernregression | 145 bestanden, 0 fehlgeschlagen |
| deterministische Migration | bestanden |
| Controller-UUID-Baseline | 5 von 5 korrekt |
| reproduzierbarer Config-Build | bytegleich |
| V9-Node-/V8-Cross-Split | gültig |
| Cross-Worker-Fall | durch Regeln 3, 6 und 30 belegt |

### 6.3 Browserprüfung

Der verpflichtende Release-Smoke bestand **79 Prüfungen ohne Fehler**. Der
erweiterte Audit bestand **103 Prüfungen** mit:

- 0 JavaScript-Page-Errors,
- 0 fehlgeschlagenen Requests,
- allen zwölf Routen,
- allen acht verschobenen Vollbreiten-Panels,
- Projektladen mit drei gerenderten Elementen,
- Light und Dark Mode,
- Desktop 1680 × 1000,
- Responsive-Viewport 1366 × 768.

Die visuellen Nachweise liegen unter `release_evidence/`.

## 7. Bewusst erhaltene Datenverträge

V56.1 ändert nicht:

- die 26 V9-Sektionen,
- `controller_uuid` und Routingidentität,
- `execution_scope`,
- V9-Node- und V8-Cross-Shards,
- Prozess- und Regelzeilen,
- Snapshot-Struktur und Fingerprint-Verfahren,
- Projektdateien, HMI-Modell und SCADA-Bundle,
- bestehende API-Endpunkte.

Der Config-Build bestätigte, dass
`config/device_state_data_v9.json` vor und nach dem Build denselben SHA-256
besitzt.

## 8. Verbleibende Betriebsrisiken aus dem Bestand

Diese Punkte wurden bewusst nicht als Teil der Designmigration umdefiniert:

1. **Externe Runtime-Type-Authority:** In der Prüfungsumgebung war die
   Automation-Runtime nicht im `PYTHONPATH`. Alle lokalen Tests bestanden;
   nur die zusätzliche Typprüfung gegen die externe Runtime wurde als
   übersprungen gemeldet.
2. **`filter_id`-Semantik:** Der Regelvertrag meldet weiterhin, dass die
   referenzierte Runtime Fakten mit `filters={}` aufbaut und daher bei einigen
   Bedingungen auf Rohwerte zurückfällt. Das ist ein fachlicher
   Integrationspunkt, kein UI-Fehler.
3. **Netzexposition:** `config/server.yaml` bindet aus Kompatibilitätsgründen
   an `0.0.0.0`, während die schreibenden APIs keine integrierte
   Authentifizierung besitzen. Für Mehrbenutzer- oder LAN-Betrieb sind
   Loopback-Binding oder ein Reverse Proxy mit Authentifizierung erforderlich.
4. **Custom-SVG-Vertrauen:** Hochgeladene SVGs sollten nur aus vertrauenswürdigen
   Quellen stammen, solange keine strikte serverseitige SVG-Allowlist
   aktiviert ist.
5. **Dateischreibvorgänge:** Für hochkritische Mehrprozessumgebungen sollten
   Projekt- und Bibliotheksschreibvorgänge zusätzlich atomar und mit
   Revisionsprüfung ausgeführt werden.

Diese Grenzen sind im Release sichtbar dokumentiert. Sie beeinträchtigen die
geprüfte lokale Einzelbenutzerfunktion nicht, dürfen für produktive
Mehrbenutzerbereitstellungen aber nicht übersehen werden.

## 9. Ergebnis

Die V55.2 wurde vollständig in die neue V56.1-Anwendungshülle überführt. Alle
zwölf Fachbereiche sind erreichbar, die bestehenden Controller- und
Datenverträge bleiben erhalten, und die kritischen Arbeitsbereiche nutzen nun
die jeweils passende Fläche. Der Release ist syntaktisch, fachlich,
funktional und visuell geprüft.
