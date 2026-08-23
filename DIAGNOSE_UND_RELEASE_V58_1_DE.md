# V58.1 — Tiefendiagnose und UI-/UX-Aufwertung der V56.1

**Release:** 58.1.0  
**Ausgangsbasis:** 56.1.0  
**Ziel:** Vollständige Code-Diagnose des Bestands, Behebung der gefundenen
visuellen Fehler und eine gezielte, professionelle Aufwertung der Oberfläche —
ohne Änderung des fachlichen Datenvertrags, der API-Routen oder der
Modulverträge.

## 1. Systemverständnis aus der Diagnose

Plant Factory ist eine integrierte Engineering-Umgebung für die Automatisierung
verfahrenstechnischer Anlagen. Vier Schichten bauen aufeinander auf:

1. **SVG-/P&ID-Editor** — Template-Bibliothek (ISO-10628-Symbole, Wago-Geräte),
   Elemente, Verbindungen, Transformationen, Projektverwaltung
   (`public/js/core.js`, `registry.js`, `elements.js`, `connection_mapper.js`,
   `ui.js`).
2. **HMI-Schicht** — Bindings, Zustandsfarben, Animationen, Runtime-Vorschau
   und SCADA-Export mit eingebettetem Konfigurations-Snapshot (`hmi.js`,
   `hmi_animation.js`, `hmi_runtime.js`, `hmi_snapshot.js`, `model_adapter.js`).
3. **Automatisierungsmodell** — Prozesse, Prozesszustände, Regeln, Filter,
   Timer und RuleEngine-Verträge (`processes.js`, `rules_generator.js`,
   `automation_tabs.js`).
4. **V9-/V8-Konfigurationsschicht** — Master-Konfiguration mit 26 Sektionen,
   deterministische `controller_uuid`-Ableitung, V9-Node-Shards, V8-Cross-Shards,
   Topologie, Validierung, Migration, Fingerprints (`v9_*.js`, `_server_v9.py`,
   `_tools/`).

Die Oberfläche der V56.1 projiziert zwölf kompatible Fachrouten
(`#tab-btn-*`/`#tab-*`) über `public/js/v56_workspace.js` in fünf Arbeitsräume
(Engineering, Automatisierung, Topologie & Rollout, Runtime, Validierung).
Der Tab-Controller der Bestands-App bleibt die einzige Quelle des aktiven
Bereichs; acht große Panels laufen in Vollbreite, vier canvasnahe im
Kontextinspektor. Server: aiohttp (`svg_editor_tool.py` + `_server_v9.py`),
Konfigurations-Build deterministisch über `build_config.sh`.

Diese Architektur ist tragfähig und wurde in V58.1 **nicht** verändert.
V58.1 arbeitet ausschließlich auf der Präsentationsschicht.

## 2. Befunde der Tiefendiagnose

Reihenfolge nach Schwere. „Behoben“ verweist auf Abschnitt 3.

| Nr. | Schwere | Befund | Status |
|---|---|---|---|
| B1 | Fehler | `ui.js` schreibt hartcodierte Dunkel-Farben ins Eigenschaftenpanel: das Element-ID-Feld erhielt `background:#0b1220`/`#1f2a44` und erschien im **hellen** Modus als schwarzer Block; das Label „Innenfläche ausmalen“ stand fest auf `#cbd5e1` und war im hellen Modus kaum lesbar; Sublabels (`#6b7280`) und Hinweistexte (`#94a3b8`) folgten keinem Theme. | behoben |
| B2 | Fehler | Der leere Einstiegzustand (`#canvas-empty-state`) war `position: fixed` mit Korrektur-Transform `translate(-12%, -40%)` — zentriert relativ zum **Viewport**, nicht zur Zeichenfläche. Bei abweichenden Panelbreiten, eingeklapptem Inspektor oder Responsive-Stufen saß er sichtbar außermittig. | behoben |
| B3 | UX | Der Vertragschip im Anwendungskopf nannte dauerhaft die interne API-URL („… · /api/v9/config?format=text“). Interne Pfade gehören nicht in die ständige Kopfzeile. | behoben |
| B4 | UX | Die Workspace-Rail war rein ikonografisch. Fünf abstrakte Piktogramme ohne Beschriftung erklären die Arbeitsräume nur per Tooltip — schwache Auffindbarkeit für ein Werkzeug mit fünf sehr unterschiedlichen Bereichen. | behoben |
| B5 | UX | `v56_workspace.js` lieferte für das Validierungs-Badge bereits `data-tone` (ok/warn/danger/muted), das CSS ignorierte den Ton jedoch: das Badge war immer gelb. Fehlerzustand und fehlerfreier Zustand waren an der Rail nicht unterscheidbar. | behoben |
| B6 | Typografie | Mikrotexte unterhalb der Lesbarkeitsgrenze: 8 px (Inspektortabs, Canvas-Notiz, Shortcut-Leiste, Blatt-Tag, `kbd`-Chips) und 9 px (Statusleiste, Zoomanzeige, Inspektor-Kontextzeilen). Auf 100%-Displays unter der professionellen Untergrenze. | behoben |
| B7 | UX | Die zahlreichen Tastaturkürzel (V/H/G/S, Entf, Strg+S, Strg+K, Strg+Alt+Z/Y/S, Zoom) waren nur über verstreute Tooltips auffindbar; eine Übersicht fehlte. | behoben |
| B8 | Konsistenz | Kleinere Politurpunkte: leerer Inspektorzustand als nackter Text, Standard-Scrollbalken in den Arbeitsflächen, harter Panelwechsel ohne Übergang, Node-Kontext im Projektfeld früh gekürzt. | behoben |
| B9 | Bestand | Betriebsrisiken aus der V56.1-Diagnose bestehen unverändert fort: `0.0.0.0`-Bind ohne Authentifizierung, Vertrauensmodell für Custom-SVGs, nicht-atomare Projektschreibvorgänge, externe Runtime-Type-Authority nur bei gesetztem `PYTHONPATH`. | dokumentiert, bewusst nicht Teil dieser UI-Runde |

## 3. Änderungen im Einzelnen

### 3.1 Fehlerbehebungen

- **`public/js/ui.js`** — alle hartcodierten Farben des Eigenschaftenpanels
  durch tokenbasierte Klassen ersetzt: `property-value--readonly`
  (Element-ID, Monospace, schreibgeschützt, per Klick markierbar),
  `property-sublabel`, `property-check`, `property-hint`. Beide Themes zeigen
  jetzt dieselbe Hierarchie mit korrekten Kontrasten.
- **`public/index.html` + `public/css/workspace.css`** — der leere
  Einstiegzustand liegt jetzt als Overlay in der Grid-Zelle der Zeichenfläche
  (`.canvas-stage`) und ist damit bei jeder Fenstergröße, Panelbreite und
  Scrollposition wirklich zentriert; der Fixed-Transform-Behelf ist entfernt.
- **`public/js/v9_ui_chrome.js`** — der Kopfchip zeigt nur noch
  „n Fehler · m Hinweise“; die Konfigurationsquelle wandert in den Tooltip.

### 3.2 Aufwertungen

- **Rail mit Beschriftung:** Anlage, Automation, Topologie, Runtime, Prüfung —
  9 px-Labels unter den Icons (Breakpoint-geführt, unterhalb 760 px wieder
  ikonografisch). `aria-label`/`title` bleiben die kanonischen Namen.
- **Validierungs-Badge mit Zustandston:** grün/gelb/rot/grau nach `data-tone`,
  farblich deckungsgleich mit den HMI-Zustandsfarben (34,197,94 · 245,158,11 ·
  239,68,68).
- **Lesbarkeitsdurchgang:** keine Dauertexte unter 9 px mehr; Statusleiste,
  Inspektornavigation (9,5 px + 13 px-Icons), Zoomanzeige, Canvas-Chips,
  Subnavigation und Arbeitsraum-Untertitel angehoben.
- **Tastaturkürzel-Übersicht:** neues Overlay (Taste `?` oder
  Toolbar-Schalter), zwei Gruppen (Zeichenfläche, Projekt & Konfiguration),
  `Esc` schließt; implementiert in `v56_workspace.js` im bestehenden
  funktionalen Stil (keine Klassen, keine Arrow Functions).
- **Inspektor-Politur:** leerer Zustand als ruhige gestrichelte Karte,
  einheitliche Feldbeschriftungen, `hr.sep` tokenisiert.
- **Arbeitsflächen:** thematisierte schmale Scrollbalken, kurzer
  Einblendschritt beim Panelwechsel (respektiert `prefers-reduced-motion`),
  Projektkarte zeigt den Node-Kontext breiter.
- **Neues Icon** `ico-help` im Inline-Sprite und in `public/icons.svg`
  (kanonische Quelle), Stil identisch zum bestehenden Satz (1.6er-Strich).

### 3.3 Versions- und Testpflege

- `VERSION`, `package.json`, `<title>`, Versionschip „58.1 · V9“,
  Serverbanner, Konsolenmeldungen: **58.1.0**.
- `test_all.sh`: Versionserwartungen auf 58.1.0/„V58.1“/„58.1 · V9“ angehoben,
  Temporärpfade `_v58_`; alle übrigen Invarianten unverändert.
- `test/smoke_ui.py`: Titelprüfung auf „V58.1“.
- `SHA256SUMS` und `Verzeichnisstruktur.txt` neu erzeugt;
  `release_evidence/` um acht V58.1-Nachweise ergänzt.

## 4. Bewusst unverändert

- die 26 Sektionen des V9-Config-Vertrags, `controller_uuid`-Ableitung,
  `execution_scope`, V9-Node-/V8-Cross-Split, Regel-, Prozess- und
  Snapshot-Formate, Projektdateien, HMI-Modell, SCADA-Bundle, API-Routen;
- alle zwölf `#tab-btn-*`/`#tab-*`-Verträge und die fünf Inspektoransichten;
- der Dateiname `public/js/v56_workspace.js` (Vertragspfad in Tests und
  Dokumentation; die Datei kennzeichnet sich intern als V58.1);
- die fünf HMI-Zustandsfarben zwischen Editor und Export;
- `config/device_state_data_v9.json` und sämtliche Shards (bytegleich).

## 5. Verifikation

### 5.1 Statische Release-Invarianten

Die Stage-3-Prüfungen aus `test_all.sh` wurden gegen den V58.1-Baum erneut
ausgewertet: Tokens nur in `tokens.css`, `hmi-blink` genau einmal, `.hidden`
genau einmal, keine Emoji, ≥ 40 Sprite-Symbole und ≥ 25 Verwendungen,
Stylesheet-Reihenfolge, lokale Schriftbindung, exakt zwölf Routen mit Panels,
fünf Rail-Bereiche, fünf Inspektoransichten, acht Vollbreiten-Panels,
funktionale Workspace-Logik ohne Arrow Functions und ohne `scrollIntoView`,
Auswahl-Chip-Begrenzung, Zustandsfarben deckungsgleich, Versionskennungen
58.1.0. Ergebnis: **alle Prüfungen bestanden** (Protokoll in
`RELEASE_TESTS_V58_1.md`).

### 5.2 Funktionaler Browserlauf

Die vollständige Anwendung wurde im Chromium-Umfeld gegen die statischen
Konfigurations- und Projektdateien des Pakets betrieben (API-Simulation auf
`fetch`-Ebene, identische Antwortformen wie `svg_editor_tool.py`):

- Boot ohne einen einzigen Konsolen- oder Page-Fehler; alle Module melden sich,
- 19 Templates geladen, Suche/Kategoriechips funktionsfähig,
- Projekt `test4` über den Dialog geladen: 3 Elemente, 1 Verbindung gerendert,
- Elementauswahl: Inspektor zeigt Eigenschaften, Auswahl-Chip erscheint,
  Breadcrumb „Compressor Vacuum Pump (General)“,
- alle acht Vollbreiten-Routen und beide Canvas-Arbeitsräume durchgeschaltet,
- Light- und Dark-Mode, Rail-Labels ohne Kürzung (DOM-Messung),
- Tastaturkürzel-Overlay öffnet und schließt (`?`, Schalter, `Esc`),
- Kopfchip ohne URL, Quelle im Tooltip, Fingerprint-Anzeige aktiv.

Bildnachweise: `release_evidence/13…20-v58-1-*.png`.

### 5.3 Auf der Zielumgebung auszuführen

`./test_all.sh` (Python 3, Node, Playwright) bleibt die verbindliche
Release-Prüfung inklusive Konfigurations-Build, Migrations-, Format-, Regel-,
Snapshot- und Kernregression sowie verpflichtendem Browser-Smoke. Alle in
V58.1 geänderten Erwartungswerte des Skripts sind angehoben; die fachlichen
Prüfketten berühren keine der in V58.1 geänderten Dateien.

## 6. Ergebnis

Die V56.1 wurde vollständig diagnostiziert; zwei echte visuelle Fehler
(Cross-Theme-Farben, dezentrierter Einstiegzustand) und sechs
UX-/Lesbarkeitsbefunde sind behoben. Die Oberfläche ist beschriftet,
zustandssichtbar und typografisch konsolidiert, der fachliche Kern bleibt
bytegleich. Der Release ist statisch geprüft und im Browser funktional
verifiziert.
