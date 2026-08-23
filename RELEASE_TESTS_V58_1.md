# Release-Prüfprotokoll V58.1

**Stand:** 2026-08-12 · **Release:** 58.1.0 · **Basis:** 56.1.0

Dieses Protokoll dokumentiert, was für V58.1 in der Paketierungsumgebung
tatsächlich ausgeführt wurde, mit welchem Ergebnis, und was auf der
Zielumgebung verbindlich bleibt.

## 1. Statische Release-Invarianten — ausgeführt, bestanden

Die Invarianten der Stufe „Engineering Workspace“ aus `test_all.sh` wurden
gegen den V58.1-Baum ausgewertet (39 Einzelprüfungen):

- Design-Token-Definitionen ausschließlich in `tokens.css`;
- `@keyframes hmi-blink` genau einmal; `.hidden`-Utility genau einmal
  (kanonisch in `layout.css`);
- keine Emoji in `index.html` und allen Stylesheets (eine tote
  `content: "⚙"`-Regel aus dem Bestand wurde entfernt);
- SVG-Sprite: 43 Symbole, 36 Verwendungen, `ico-help` in Inline-Sprite und
  `public/icons.svg`;
- Stylesheet-Kaskade `tokens → fonts → style → layout → components → bridge →
  workspace`;
- Schriften nur lokal (`local()`-Quellen, keine CDNs);
- exakt 12 Routen `#tab-btn-*` mit vorhandenen Panels, 5 Rail-Arbeitsräume,
  5 Rail-Labels, 5 Inspektoransichten;
- `v56_workspace.js`: funktionaler Stil ohne Arrow Functions, ohne Klassen,
  ohne `scrollIntoView`;
- Auswahl-Chip mit `max-width`-Begrenzung;
- HMI-Zustandsfarben (34,197,94 · 245,158,11 · 239,68,68) im Animationsmodul
  und farbgleich in den neuen Badge-Tönen;
- Versionskennungen 58.1.0 konsistent in `VERSION`, `package.json`,
  `<title>`, Versionschip, Serverbanner, `test_all.sh`, `test/smoke_ui.py`;
- alle 13 Modulreferenzen der `index.html` existieren; kein Test-Harness-Code
  im Release;
- alle JSON-Dateien in `config/` und `projekte/` parsen fehlerfrei;
- keine `font-size` unter 8 px; keine „56.1“-Reste unter `public/`.

**Ergebnis: bestanden, 0 Abweichungen.**

## 2. Funktionaler Browserlauf — ausgeführt, bestanden

Die vollständige Anwendung (unveränderte Release-Dateien) lief im
Chromium-Umfeld gegen eine `fetch`-seitige Simulation der Server-Endpunkte,
die die statischen Paketdateien ausliefert (`/api/v9/config` inkl.
Fingerprint-Header, `/api/templates`, `/api/projekte`, `/api/laden`,
Bibliotheks-Endpunkte). Ablauf und Ergebnisse:

| Schritt | Ergebnis |
|---|---|
| Boot (13 Module, ES-Module-Kette) | fehlerfrei, keine Konsolen-/Page-Fehler |
| Template-Bibliothek | 19 Templates geladen, Kategorien und Suche aktiv |
| Projekt `test4` über Dialog geladen | 3 Elemente, 1 Verbindung gerendert |
| Elementauswahl | Inspektor-Eigenschaften, Auswahl-Chip, Breadcrumb korrekt |
| Alle 12 Routen / 5 Arbeitsräume | durchgeschaltet, Panels rendern |
| Light/Dark | beide Themes, Eigenschaftenpanel korrekt (B1 behoben) |
| Leerer Einstiegzustand | zentriert im Zeichenflächen-Grid (B2 behoben) |
| Rail-Labels | DOM-Messung ohne Kürzung („Automation“ 50/50 px) |
| Kopfchip | „0 Fehler · 75 Hinweise“, Quelle nur im Tooltip (B3 behoben) |
| Tastaturkürzel-Overlay | öffnet per `?` und Schalter, `Esc` schließt (B7) |
| Fingerprint/Statusleiste | Anzeige aktiv, Node-Kontext sichtbar |

Bildnachweise: `release_evidence/13…20-v58-1-*.png` (1680 × 1000,
Light/Dark, alle Arbeitsräume, Overlay).

## 3. Auf der Zielumgebung verbindlich

```bash
./test_all.sh
```

führt zusätzlich aus: Konfigurations-Build (`build_config.sh`) mit
Determinismus-Doppellauf, Format-Paritäts- und Regelvertrags-Tests (Python),
V9-Kern-, Format-, Snapshot- und Plant-Factory-Regression (Node) sowie den
verpflichtenden Browser-Smoke (`test/smoke_ui.mjs`, Fallback
`test/smoke_ui.py`). Alle Versionserwartungen des Skripts wurden für V58.1
angehoben; die fachlichen Prüfketten berühren keine in V58.1 geänderte Datei.

## 4. Abgrenzung

Nicht Teil dieses Releases: Server-Härtung (`0.0.0.0`-Bind,
SVG-Vertrauensmodell, atomare Projektschreibvorgänge) — als Bestandsrisiken
in `DIAGNOSE_UND_RELEASE_V58_1_DE.md`, Abschnitt B9 dokumentiert.
