# Diagnose und Freigabe – Plant Factory V64_r5

## Auftrag

Nach der Abnahme von V64_r4 wurde gewünscht, dass die Zeichenebene beide Referenzbilder
(Reaktor-P&ID mit gefüllten Rohren, Flanschen, Swagelok-Fittings, Titan-Kapillaren mit weißen
Laufstrichen, Ventilpanel, Kühler, Skid und Bemaßung – sowie die Template-Symbolvariante mit
Gasflaschen, Regel- und Rückschlagventilen, Gasmischer, Kolonne, Kreis-Apparaten, Instrumenten
und grünen Gasleitungen) **100 % identisch** zeichnen kann. Bedingungen: die vorhandene Optik und
alle Funktionen bleiben erhalten, die neue Variante ist additiv; Rohre mit Flansch stecken
automatisch; Leitungen sind wie im Bild animiert; Ventile schalten grün/rot; Bereiche wie
„Ventilpanel“ sind optional; eine Aufhängung ist als eigene Ebene mit eigenem Inventar baubar;
Swagelok-Anbringung oben/seitlich und links/rechts; gefüllte Rohre; Flansch mit Verschraubung;
erweitertes Inventar.

## Befunde (reproduziert im Browser, Stand V64_r4)

| Nr. | Befund | Ursache | Korrektur in V64_r5 |
|---|---|---|---|
| 1 | Die PF-PID-V1-Symbole sind Umriss-Symbole (blau/grau); das Referenzbild nutzt gefüllte schwarze Doppellinien-Rohre mit weißer Bohrung. | Die Bibliothek besaß nur die Standard-Optik. | **Klassik-Familie** (`style: classic`) mit eigenem gekapselten Stylesheet (`.pf-pid-v1 .pc-*`): Wand 22 px schwarz, Bohrung 16 px weiß, Laufstriche weiß; alle Maße der Referenz (Rohrkopf-Balken, Flanschbalken 4 px, Swagelok-Muttern 9 × 14, U-Bogen-Radius 40). |
| 2 | Ein Rohr mit Flansch muss am Rohr automatisch einrasten. | — | `Classic_tube_flanged` (Flanschbalken fest im Streckprofil `[0,22]`), `Classic_flange`, `Classic_flange_bolted`; alle mit Ports `inlet/outlet` auf der Mittellinie y = 24 → Joints entstehen beim Ablegen wie bei allen Elementarteilen. |
| 3 | Leitungen sollen wie im Bild animiert sein (weiße Laufstriche). | Freie Linien waren statische Striche. | Zeichenelement **Leitung** (`polyline`) mit Stützpunkten, Presets (`pipe`, `capillary`, `hot`, `cold`, `coolant`, `purge`, `feed`, `signal`, `plain`) und SMIL-`<animate>` auf `stroke-dashoffset` (0 → −20, 0,5 s) exakt wie in der Referenz-SVG. Klassik-Teile tragen dieselbe Animation. Toolbar-Schalter pausiert über `canvas.pauseAnimations()`. |
| 4 | Ventile grün/rot, Ofen rot, Kühler blau, Aufheizen orange. | Keine Zustände im Zeichenmodell. | Entity-Feld `visual_state`; Templates deklarieren `visual_states` und `default_visual_state`; CSS-Regeln `[data-pf-visual-state="…"] .pf-pid-v1 .pc-*` färben Zustandsflächen, Ventilkörper und Bohrung. Inspektor-Auswahl, Taste **Z**, Kontextmenü „Darstellung“. |
| 5 | Bereichskennzeichnung „Ventilpanel“ optional. | — | Zeichenelement **Bereich** (`region`): gestrichelter Rahmen 1,5 px `#777`, Titel innen oder über dem Rahmen, Ebene Beschriftung. |
| 6 | Aufhängung / Gestell als eigene Ebene mit Inventar. | Keine Ebenen. | Ebenen `process`, `structure`, `annotation` für Teile und Zeichenelemente, Toolbar-Schalter, Reihenfolge Gestell → Beschriftung → Prozess. Gestell-Teile `Frame_post`, `Frame_beam`, `Frame_foot`, `Frame_clamp`, `Frame_floor` mit Port-Art `structure` (neue Verbindungsart) im Register **Gestell**. Ausgeblendete Ebenen fehlen im Export – inklusive ihrer Ports und Joints. |
| 7 | Swagelok nur „mit einem Rohr“ angebracht; Anbringung oben/seitlich, links/rechts gewünscht. | Kein Wandanschluss am Rohr, kein axialer Kopfanschluss. | `Classic_tube_head` (axialer Kapillaranschluss oben), `Classic_tube_tap` (Rohrstück mit zwei Wandanschlüssen `tap_a`/`tap_b`), `Classic_swagelok` drehbar/spiegelbar, `Classic_capillary` streckbar bis 4 px. Im Reaktor-Beispiel sind beide Fittings als echte Joints gesteckt (axial über 13,5 px Kapillare am Kopf, seitlich über 29 px Kapillare an der Rohrwand bei (494, 210)). |
| 8 | Flansch mit Verschraubung als weitere Optik. | — | `Classic_flange_bolted`: zwei weiße Flanschblätter, Schrauben und Muttern oben und unten, 40 px breit. |
| 9 | Inventar erweitern (Template-Bild). | — | `Classic_column` (abgerundete Kolonne), `Classic_coil_circle` (Kreis mit Heizwendel, rot/blau), `Classic_mixer_box`, `Classic_cylinder` (Gasflasche), `Classic_control_valve` (Membranantrieb), `Classic_check_valve`, `Classic_instrument` (Funktion · Nummer · Messwert), `Classic_flag`/`Classic_flag_back`, `Classic_line`. PF-PID-V1 umfasst 71 Templates. |
| 10 | Beispiele müssen auf dem Referenzblatt liegen (1300 × 1110 bzw. 1150 × 830). | Das automatische Wachsen (Rand 80) verschob Inhalte nahe dem Blattrand und vergrößerte das Blatt auf 1320 × 1240. | Optionales Blattfeld `margin` (Standard 80, Referenzbeispiele 4), Feld **Rand** im Register *Blatt*; R4-Verhalten für normale Blätter unverändert. |
| 11 | Canvas-Texte ignorierten Schriftgröße/-farbe (Export korrekt). | `.plant-drawing-label { font: 16px … }` überstimmte die SVG-Attribute. | Inline-Stil für Textelemente auf der Zeichenfläche; Standardtexte (16 px, `#0f172a`) bleiben pixelgleich. |
| 12 | Spaltbildung zwischen gesteckten Kolonnensegmenten. | Ein Teil gleicher Größe wie seine viewBox wurde in Segmente zerlegt. | Identitäts-Kurzschluss im Renderer: ungestreckte Teile zeichnen genau einen Viewport. |

## Architektur der Korrekturen (nur Zeichenebene, additiv)

- **Symbolbibliothek** (`_tools/build_symbol_standard.py`): `CLASSIC_STYLE`, `classic_body`,
  `dash`, `classic_definition`, `build_v64_r5_definitions` (24 Klassik- + 5 Gestell-Teile,
  Profile `classic_*`/`frame_*`); Manifest und SVGs deterministisch (`--check`).
- **Modell** (`v64_plant_drawing_model.js`): `DRAWING_LAYERS`, `LINE_STYLES`, `LABEL_POSITIONS`,
  `LINE_STYLE_PRESETS`, `normalizePlantPoints`, `translatePlantPrimitive`,
  `setPlantEntityVisualState`, `setPlantEntityLayer`, `lineStylePreset`, Blattfeld `margin`
  in `fitPlantSheetToContent`, `createClassicReactorExample`, `createClassicTemplateExample`.
- **Editor** (`v64_plant_drawing.js`): `renderPolyline`/`renderRegion`/`renderDimension`,
  Ebenen (`layerVisible`, `connectionVisible`, `layerOrderedEntities`), `applyAnimationState`,
  Zustands- und Ebenenauswahl im Inspektor, Register **Gestell**, Werkzeuge L/B/D, Taste **Z**,
  Kontextmenü „Darstellung“, Beschriftungsrollen (`applyLabelRole`), Feld **Rand**,
  API `setVisualState`, `setLayerVisible`, `setAnimation`, `addPolyline`,
  `loadClassicReactorExample`, `loadClassicTemplateExample`; `window.__plantFactoryV64R5`.
- **Server** (`svg_editor_tool.py`): Template-Projektion `style`, `visual_states`,
  `default_visual_state`, `layer`; Baugruppen-Normalisierung `visual_state`, `layer`, `points`
  (max. 256), `line_style`, `animated`, `label`, `label_position`, `font_family`;
  Verbindungsart `structure`.
- **Oberfläche** (`index.html`, `v64_r5.css`): Register Gestell, Werkzeuge Leitung/Bereich/
  Bemaßung, Ebenen-Schalter, Animationsschalter, Klassik-Beispielschaltflächen; alle Selektoren
  auf die Zeichenebene begrenzt.

## Verifikation

- Statisch: `test/test_v64_r5_release.py`; Modell `test/test_v64_r5_model.mjs` (82 Prüfungen);
  Server `test/test_v64_r5_server.py` (56 Prüfungen).
- Browser: `test/smoke_v64_r5.py` (95 Prüfungen): Inventar 66 + 5 Karten, Stecken
  Rohr → Flansch → Rohr mit Flansch (Streckkappe `[22]` bleibt fest), Zustände mit berechneten
  Farben (`rgb(238, 28, 36)` / `rgb(45, 179, 74)`), Taste Z, Animation anhalten/starten,
  Leitung per Klicks + Enter/Escape, Bereich und Bemaßung per Ziehen, Ebenen ein-/ausblenden,
  Gestell-Joint, Bibliotheks-Roundtrip, beide Referenzbeispiele (39/23/31 und 19/22) auf
  Referenzblatt mit Referenzrand, Sicherheitsabfrage, Exporte mit Laufstrichen/Zuständen/
  Leitungen ohne ausgeblendete Ebene, Light/Dark.
- Visuell: Seite-an-Seite-Vergleich beider Beispiele mit den Referenz-SVGs (Geometrie,
  Farben, Schriftgrößen 11/13 px Arial, Strichstärken 3,5/22/16 px).
- Geerbte Verträge (V62 … V64_r4) laufen unverändert; pixelidentischer Referenzexport bleibt.

## Antwort auf „Wurden alle Punkte nahtlos umgesetzt?“ (V64_r4)

Ja. Alle neun r4-Punkte (Strecken, Invertieren, wachsendes Blatt, T-Stück, neue Elementarteile,
Inventar-Übernahme, Inspektor-Register, Kontextmenü, Strg-Navigation) sind in r5 unverändert
aktiv; der r4-Browservertrag läuft weiterhin vollständig. Dokumentierte Restgrenzen aus r4:
Geräte skalieren proportional oder frei (kein Streckprofil), klassische Verbindungen behalten
den Mittelknick, die Baugruppen-Bibliothek ist unversioniert.

## Bewusste Restgrenzen

1. Die Klassik-Optik ist eine zweite Symbolfamilie; gemischte Stränge (Standard + Klassik)
   stecken zusammen, wechseln aber die Optik nicht automatisch.
2. Der Seitenanschluss sitzt auf der Mitte des Rohrstücks; die Position wird über die Länge
   des Rohrstücks bzw. angrenzende Rohre bestimmt.
3. Bemaßungen tragen freien Text; es gibt keine automatische Maßermittlung.
