# V64_r5 – Architektur und Bedienung

## Architektur

V64_r5 erweitert das rein funktionale Zeichenmodell (`v64_plant_drawing_model.js`), die
Interaktionsschicht (`v64_plant_drawing.js`), die Symbolbibliothek PF-PID-V1
(`_tools/build_symbol_standard.py`) und die Baugruppen-Bibliothek des Servers additiv um eine
zweite optische Symbolfamilie, Darstellungszustände, Ebenen und drei neue Zeichenelemente.

```text
Template (META: style=classic, visual_states, default_visual_state, layer, ports, stretch)
        ↓ createPlantEntity
Entity { …r4-Felder…, visual_state, layer }
        ↓ renderEntity
<g data-pf-visual-state="hot" data-layer="process"> … <svg class="pf-pid-v1"> …
   .pc-wall / .pc-bore / .pc-dash (<animate stroke-dashoffset 0 → −20, 0,5 s>) / .pc-state / .pc-valve
   [data-pf-visual-state="hot"] .pf-pid-v1 .pc-state { fill: #ee1c24 }
        ↓ commitModel
fitPlantSheetToContent (Rand = sheet.margin, Standard 80; Referenzblätter 4)
        ↓ renderCanvas
Ebenen: Gestell (hinten) → Beschriftung → Prozess (vorn); ausgeblendete Ebenen ohne Ports/Joints
```

### Klassik-Geometrie (viewBox-Einheiten)

| Familie | Box | Mittellinie | Wand / Bohrung | Ports |
|---|---|---|---|---|
| Rohr, Rohr mit Flansch, Flansch, Rohrstück mit Seitenanschluss | 160 × 48 / 16 × 48 / 40 × 48 / 48 × 48 | y = 24 | 22 px schwarz / 16 px weiß | `inlet` (0, 24), `outlet` (Breite, 24); Seitenanschluss `tap_a` (24, 13), `tap_b` (24, 35) |
| Rohrkopf | 48 × 10 | x = 24 | Abschlussbalken 3 px bei y = 1,5 | `capillary` (24, 0), `tube` (24, 10) |
| Rohrbogen | 88 × 88 | Radius 40 | 22 / 16 px | `inlet` (0, 24), `outlet` (64, 88) |
| U-Bogen | 232 × 160, streckbar in y | Radius 40 | 22 / 16 px | `inlet` (11, 0), `outlet` (221, 0) |
| Kapillare, dünne Leitung, Swagelok, Kapillar-Bogen | 160 × 40 / 40 × 40 | y = 20 | 3,5 px `#333` + Laufstriche | `inlet` (0, 20), `outlet` (Breite, 20) |
| Handventil, Regelventil, Rückschlagventil | 60 × 40 / 40 × 40 | y = 20 | Ventilkörper `.pc-valve` grün/rot (Regel-/Rückschlagventil: Linien `.pc-thin` grün bei `open`) | `inlet`, `outlet`, `actuator` (Signal, nicht beim Rückschlagventil) |
| Rohrofen, Kühler, Kolonne, Kreis-Apparat, Gasmischer, Gasflasche | 200 × 206, 150 × 160, 160 × 420, 110 × 150, 130 × 48, 60 × 110 | — | Zustandsfläche `.pc-state` (Ofen/Kolonne/Kreis: `heat`/`hot`/`cold`/`cool`, Kühler: `cold`) | Prozess-, Energie-, Kühlwasser-, Instrumentenports; Instrumentenkreis 60 × 72 mit drei Signal- und einem Prozessport |
| Gestellpfosten, -träger, -fuß, Rohrschelle, Boden | 24 × 400, 400 × 24, 60 × 20, 40 × 30, 300 × 24 | — | `.pc-frame` grau | `kind: structure` |

### Darstellungszustände

| Zustand | Wirkung |
|---|---|
| `neutral` | keine Laufstriche, graue Zustandsfläche |
| `flow` | weiße Laufstriche sichtbar (Standard der Rohr- und Leitungsteile) |
| `heat` / `hot` / `cold` / `cool` | Bohrung orange / rot / blau; Zustandsfläche `#f7931e` / `#ee1c24` / `#1e9be8` / `#6fb7e8` |
| `purge` | grüne dünne Leitung mit Laufstrichen |
| `open` / `closed` | Ventilkörper `#2db34a` / `#ee1c24`, Regel-/Rückschlagventil-Linien grün bei `open` |

### Zeichenelemente

| Typ | Felder | Darstellung |
|---|---|---|
| `polyline` | `points[]`, `line_style`, `animated`, `layer` | Presets: Rohrleitung 3,5 px `#333`, Kapillare 3 px, heiß `#b33a3a`, kalt/Kühlwasser `#2f7fb8`, Spülgas `#2db34a` 2 px, Gasleitung `#888` 2 px, Signal `#555` 1,2 px gestrichelt `4 3`; Laufstriche per SMIL |
| `region` | `x1…y2`, `label`, `label_position` (`inside`/`above`), `layer` | Rahmen 1,5 px `#777` gestrichelt `10 6`, Titel 12 px |
| `dimension` | `x1…y2`, `text`, `label_position` (`inside`/`above` = andere Seite) | Endstriche 12 px, gefüllte Pfeile, Maßtext 13 px `#555`, senkrecht gedreht bei vertikalem Maß |
| `text` | `font_size`, `font_family`, `text_anchor`, `stroke` (Farbe) | auf der Zeichenfläche jetzt mit eigener Größe, Familie und Farbe |

### Ebenen

`process` (Teile und Leitungen), `structure` (Gestell / Aufhängung, eigenes Inventar-Register),
`annotation` (Bereiche, Bemaßungen, Texte). Toolbar-Schalter blenden Ebenen aus; der Export
enthält nur sichtbare Ebenen einschließlich ihrer Joints. Die Verbindungsart `structure`
verbindet ausschließlich Gestell-Ports.

## Bedienung

### Maus und Tastatur (neu in r5)

| Aktion | Bedienung |
|---|---|
| Leitung zeichnen | **L** oder Werkzeug *Leitung*: Klick setzt Stützpunkte, Umschalt erzwingt orthogonale Segmente, Rücktaste entfernt den letzten Punkt, Enter/Doppelklick beendet, Escape verwirft |
| Bereich zeichnen | **B** oder *Bereich*: Rahmen aufziehen, Titel und Lage im Inspektor |
| Bemaßung zeichnen | **D** oder *Bemaßung*: von Punkt zu Punkt ziehen, Maßtext im Inspektor |
| Zustand wechseln | **Z** (nächster Zustand), Inspektor „Darstellung / Zustand“, Kontextmenü „Darstellung: …“ |
| Ebene wechseln | Inspektor „Ebene“ bei Teil oder Zeichenelement |
| Ebene ein-/ausblenden | Toolbar **Prozess · Gestell · Beschriftung** |
| Animation | Toolbar-Schalter (pausiert alle Laufstriche der Zeichenfläche) |
| Blattrand | Register *Blatt* → **Rand** (Standard 80; 0 … n) |

Alle r4-Gesten (R/F/I, Griffe, Strg-Navigation, Kontextmenü, Alt-Lösen, Doppelklick-Verbund)
gelten unverändert auch für Klassik- und Gestell-Teile.

### Swagelok-Anbringung

| Lage | Aufbau |
|---|---|
| Axial oben am Rohr | `Classic_tube_head` (Abschlussbalken) → `Classic_capillary` (kurz, senkrecht) → `Classic_swagelok` (R = 90°) → Kapillarleitung |
| Seitlich links/rechts | `Classic_tube_tap` im Rohrstrang (R = 90° für senkrechte Rohre); `tap_b` liegt links, `tap_a` rechts → `Classic_capillary` → `Classic_swagelok` |
| Oben/unten an waagerechtem Rohr | `Classic_tube_tap` ungedreht; `tap_a` oben, `tap_b` unten; Swagelok mit **R** senkrecht stellen |
| Richtung | **F** spiegelt die Verschraubung, **I** invertiert die Flussrichtung |

### Instrumentenkreise und Beschriftungen

`Classic_instrument` zeigt die Funktion (Buchstaben des Tags, z. B. `TIC`), die Nummer (`101`)
und den Messwert aus der Eigenschaft `value` (z. B. `500 °C`). `caption` ersetzt die zweite
Beschriftungszeile der Apparate, `hide_labels = true` blendet Symbolbeschriftungen aus (die
Symbolvariante setzt dann zentrierte freie Texte).

### Referenzbilder nachbauen

1. **Klassik: Reaktor-P&ID laden** – 39 Teile, 23 Joints, 31 Zeichenelemente auf 1300 × 1110:
   Rohrkopf, Rohre, vier Flanschpaare, Rohrofen (heiß), U-Bogen, Austrittsstutzen, axialer und
   seitlicher Swagelok mit Kapillaren, Kühler (kalt), drei Handventile (offen), fünf
   Grenzstellen, drei Instrumente, Ventilpanel- und Skid-Bereich, fünf Bemaßungen, Leitungen
   (Rohr, heiß, Kühlwasser, Signal) und das optionale Gestell (Ebene Gestell, zunächst
   ausgeblendet).
2. **Klassik: Symbolvariante laden** – 19 Teile, 22 Zeichenelemente auf 1150 × 830: zwei
   Gasflaschen, zwei Regelventile, zwei Rückschlagventile, Gasmischer-Kasten, Kolonne (heiß),
   Kreis-Ofen (heiß) und Kreis-Kühler (kalt), Vent-Ventil (senkrecht, invertiert), fünf
   Instrumente, drei Grenzstellen, Spülgas-, Gas-, Heiß-, Kalt- und Signalleitungen.

Beide Beispiele lassen sich wie jede Skizze bearbeiten, als Baugruppe speichern, als SVG
exportieren oder in das Anlagenbild übernehmen.
