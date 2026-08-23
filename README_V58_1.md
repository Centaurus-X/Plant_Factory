# Plant Factory · Automated_SVG_Integration V58.1

V58.1 ist die UI-/UX-Konsolidierung der V56.1: gleiche Architektur, gleicher
V9-Konfigurationsvertrag, gleiche APIs und Projektdateien — aber eine
beschriftete Navigation, zustandssichtbare Prüf-Badges, ein durchgängig
lesbares Schriftbild, ein korrekt zentrierter Einstiegzustand, ein
theme-fester Inspektor und eine eingebaute Tastaturkürzel-Übersicht.

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

## Was V58.1 verändert

| Bereich | V56.1 | V58.1 |
|---|---|---|
| Workspace-Rail | nur Icons | Icons mit Beschriftung: Anlage, Automation, Topologie, Runtime, Prüfung |
| Prüf-Badge | immer gelb | grün/gelb/rot/grau nach Prüfergebnis, farbgleich mit den HMI-Zustandsfarben |
| Kopf-Statuschip | nannte die interne API-URL | „n Fehler · m Hinweise“, Quelle im Tooltip |
| Eigenschaftenpanel | hartcodierte Dunkelfarben (im hellen Modus fehlerhaft) | tokenbasiert, in beiden Themes korrekt; Element-ID als Monospace-Lesefeld |
| Leerer Einstieg | viewport-fixiert, außermittig | Overlay in der Zeichenflächen-Zelle, immer zentriert |
| Mikrotypografie | 8–9 px an vielen Stellen | Untergrenze 9 px, Status-/Kontexttexte 10–11 px |
| Tastaturkürzel | nur Tooltips | Übersicht über Taste `?` oder den Toolbar-Schalter |
| Arbeitsflächen | Standard-Scrollbalken, harter Panelwechsel | thematisierte Scrollbalken, kurzer Einblendschritt (respektiert `prefers-reduced-motion`) |

Alle zwölf `#tab-btn-*`-Routen, die fünf Arbeitsräume, die fünf
Inspektoransichten und sämtliche Projekt-, Config-, Shard- und Export-APIs
bleiben unverändert. `public/js/v56_workspace.js` behält seinen Dateinamen als
Vertragspfad und kennzeichnet sich intern als V58.1.

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

## Bedienung

- **Rail links:** fünf Arbeitsräume; das Badge an „Prüfung“ zeigt Zahl und
  Ton des aktuellen Prüfergebnisses.
- **Bibliothek:** Suche (`Strg+K`), Kategorien, Custom-SVG-Import.
- **Zeichenfläche:** Auswahl/Hand (V/H), Raster (G), Einrasten (S), Zoom
  (+/−/0), Undo/Redo, Löschen (Entf).
- **Inspektor rechts:** Details, I/O, HMI, Linien, Ebenen — kontextabhängig,
  einklappbar, in der Breite ziehbar.
- **`?`** öffnet die Tastaturkürzel-Übersicht.

## Verifikation

Die vollständige Release-Prüfung lautet:

```bash
./test_all.sh
```

Der UI-Smoke-Test ist verpflichtend (Node-Playwright, Python-Playwright als
Fallback):

```bash
npm install && npm run test:smoke
# oder
python3 -m pip install playwright
CHROMIUM_PATH=/usr/bin/chromium python3 test/smoke_ui.py
```

Für V58.1 wurden zusätzlich alle statischen Release-Invarianten erneut
ausgewertet und die Anwendung im Browser funktional gegen die ausgelieferten
Konfigurations- und Projektdateien betrieben (fehlerfreier Boot, Projektladen,
Elementauswahl, alle Routen, beide Themes). Protokoll:
`RELEASE_TESTS_V58_1.md`, Bildnachweise: `release_evidence/`.

## Konfiguration und Rollout

Unverändert gegenüber V56.1; die Master-Konfiguration wird reproduzierbar aus
den Feld-Shards erstellt:

```bash
./build_config.sh
```

## Relevante Dokumente

| Datei | Aufgabe |
|---|---|
| `DIAGNOSE_UND_RELEASE_V58_1_DE.md` | Tiefendiagnose, Befunde B1–B9, Änderungsliste, Verifikation |
| `RELEASE_TESTS_V58_1.md` | reproduzierbares Prüfprotokoll dieses Release |
| `design-qa.md` | visuelle Abnahme mit Vergleichsnachweisen |
| `release_evidence/` | Screenshots V56.1 (Referenz) und V58.1 (Nachweis) |
| `README_V56_1.md`, `DIAGNOSE_UND_RELEASE_V56_1_DE.md` | Historie der Ausgangsbasis |
