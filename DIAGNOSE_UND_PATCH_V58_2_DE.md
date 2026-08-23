# V58.2 — Zeichenfläche und Objekte im Zielstil (Patch auf V58.1)

**Release:** 58.2.0 · **Basis:** 58.1.0 · **Stand:** 2026-08-12

## Anlass und Diagnose

V58.1 hatte die Anwendungshülle auf das Designziel V1
(`release_evidence/00-design-target-v1.png`) gehoben, die **Zeichenfläche
selbst aber bewusst im V56.1-Stand belassen**. Der Vergleich beider Stände
zeigt drei Lücken der Zeichenfläche gegenüber dem Zielbild:

| Nr. | Befund | Ursache |
|---|---|---|
| C1 | Platzierte Symbole tragen keine Beschriftung — Namen sind nur im Inspektor sichtbar; das Zielbild zeigt „P-101 · Feed Pump“ unter jedem Symbol. | `elements.js` rendert nur die Symbolgruppe, kein Label. |
| C2 | Fließlinien sind neutral grau (`--gray-400`/`--gray-600`); das Zielbild führt Prozessflüsse in Teal mit Pfeilspitzen. | Altfarben in `style.css`; Pfeilmarker existierten bereits. |
| C3 | Symbole erben Altfarben aus den Template-Defs (`--hauptfarbe: #2196F3`, `--akzentfarbe: #FF9800`, grünliche Füllung) — bunter Mischcharakter statt einheitlicher Ingenieurs-Palette. | Jedes Template injiziert eigene `:root`-Variablen; die zuletzt geladene gewinnt dokumentweit. |

## Patch (minimal-invasiv)

- **`public/js/elements.js`** — neue Funktion `updateLabel()`: ein
  `<text class="element-label">` in der äußeren Elementgruppe, zentriert unter
  der Symbol-BBox (skalierungsbewusst, rotationsfest, `pointer-events: none`).
  Aufruf an den zwei bestehenden Stellen `createSVGElement()` und
  `updateElement()` — Namensänderungen im Inspektor aktualisieren das Label
  sofort. Ports, Pivot, Drag und Projektformat unverändert.
- **`public/css/workspace.css`** — neuer Abschnitt „Zeichenfläche im
  Zielstil“: Label-Typografie mit Raster-Halo (beide Themes);
  Fließlinien Teal `#0e7490` (dunkel `#38bdf8`), Signal amber gestrichelt,
  Daten blau gestrichelt, runde Fügungen; Auswahl mit definiertem Schatten
  statt breitem Glow; Symbol-Grundfarben als `html:root`- bzw.
  `:root[data-theme="dark"]`-Override (`--hauptfarbe: #334155`,
  `--akzentfarbe: #2563eb`, dezente Füllung) — gewinnt per Spezifität
  deterministisch gegen die Template-Defs, **ohne eine Template-Datei oder den
  SVG-Export anzufassen**.
- Versionskennungen auf 58.2.0 (`VERSION`, `package.json`, Titel, Chip,
  Serverbanner, `test_all.sh`, `test/smoke_ui.py`, Konsolenmeldungen).

Nicht angefasst: Template-SVGs, Projektdateien, Verbindungslogik,
V9-Konfigurationsvertrag, APIs.

## Verifikation

Funktionaler Browserlauf gegen die Paketdaten (wie V58.1, Protokollpfad
`RELEASE_TESTS_V58_1.md` sinngemäß): Boot fehlerfrei, Projekt `test4`
geladen — 3 Elemente **mit Beschriftung**, 1 Verbindung in Teal mit
Pfeilspitze, Auswahl + Inspektor funktionsfähig, HMI-Chips (Button/Indicator/
ON-OFF) unverändert, Light und Dark korrekt, 0 Konsolenfehler.
Nachweise: `release_evidence/21-v58-2-canvas-light.png` und
`22-v58-2-canvas-dark.png`. `./test_all.sh` bleibt auf der Zielumgebung
verbindlich (Erwartungswerte auf 58.2.0 angehoben).
