# Diagnose und Freigabe – Plant Factory V64_r4

## Auftrag

Nach dem ersten Praxiseinsatz des Steck-Editors (V64_r3) wurden fünf Mängel gemeldet und
weitere Funktionen gewünscht: Rohre verlängern sich beim Ziehen nicht, Rohrbögen lassen sich
nicht invertieren, die Zeichenfläche wächst nicht mit, das T-Stück wirkt fehlerhaft, es fehlen
Bauteile für Swagelok-Verschraubungen, Gasmischer, Rohrterminationen und Anschlüsse, die
Übernahme in das Anlagen-Inventar wirkt unvollständig, der Inspektor soll Register erhalten,
ein Rechtsklick-Menü fehlt und die Navigation mit **Strg** soll sich wie in der Ebene „Anlage“
verhalten. Alle Punkte wurden reproduziert, minimal-invasiv behoben und mit einem vollständigen
Neubau der Rohrofen-Anlage per Mausgesten verifiziert.

## Befunde (reproduziert im Browser, Stand V64_r3)

| Nr. | Befund | Ursache | Korrektur in V64_r4 |
|---|---|---|---|
| 1 | Rohr „länger ziehen“: der Rahmen wächst, das Rohr nicht; Ports wandern vom Symbol weg. | Jedes Teil wurde als ein Viewport mit `preserveAspectRatio="xMidYMid meet"` gezeichnet; das Template blieb proportional und zentriert, die Ports folgten der Rahmengröße. | **Streckprofile**: Rohr, T-Stück, Kapillare und Doppelmantel-Rohr tragen `stretch` (feste viewBox-Intervalle für Endkappen und Pfeil). Der Renderer zeichnet feste Segmente in Originalgröße und streckt nur die Zwischenräume; Ports werden über dieselbe Abbildung platziert. Geräte skalieren proportional (Griffe halten das Seitenverhältnis), „frei“ erlaubt bewusste Verzerrung. |
| 2 | Rohrbogen nicht invertierbar, Pfeil zeigt in die falsche Richtung. | Nur Drehung um 90°-Schritte; vier der acht möglichen Bogenlagen waren unerreichbar. | **Spiegeln** (`flip_x`/`flip_y`, Taste **F**/Umschalt+F) und **Invertieren** (`inverted`, Taste **I**): Spiegeln mappt Ports mit, Invertieren tauscht Ein-/Ausgang und dreht alle markierten Flusspfeile (`data-pf-role="flow-arrow"`) um 180°. |
| 3 | Zeichenfläche wächst nicht; Teile liegen außerhalb des Rasters. | Blattgröße fix, Raster nur über dem Blatt, Mauskoordinaten auf das Blatt begrenzt. | **Wachsendes Blatt**: Nach jeder Änderung wird das Blatt an den Inhalt angepasst; Teile oberhalb/links des Ursprungs verschieben den Inhalt rasterbündig in den Blattrand, die Ansicht folgt ohne Sprung. Das Raster deckt immer die gesamte Ansicht, ein gestrichelter Rahmen zeigt das Blatt. Referenzimporte bleiben unverschoben (pixelidentischer Export). |
| 4 | T-Stück sieht komisch aus. | Streulinie `M77 23 V60` durch die Oberwand im Template. | T-Stück neu gezeichnet (Abzweig aus der Unterwand, Flusspfeil), deterministisch über `_tools/build_symbol_standard.py`. |
| 5 | Übernahme ins Anlagen-Inventar „nicht korrekt“. | Das Speichern funktionierte, die Entity landete jedoch unsichtbar im Filter „Eigene Symbole“ und wurde beim Einsetzen außerhalb des sichtbaren Bereichs platziert. | Nach dem Speichern wechselt die Anlagen-Bibliothek auf **Eigene Symbole**, die Karte wird hervorgehoben und die Entity beim Einsetzen in der sichtbaren Bildmitte abgelegt. |
| 6 | Fehlende Bauteile. | Kein Fitting-, Mischer-, Terminations- oder Anschluss-Symbol. | Sieben neue PF-PID-V1-Teile: `Swagelok_union`, `Swagelok_tee`, `Swagelok_elbow`, `Capillary_line` (streckbar), `Pipe_cap`, `Boundary_connector` (Anschluss/Grenzstelle mit Tag-Beschriftung), `Gas_mixer` (zwei Eingänge, Ausgang, Instrumentenanschluss). |
| 7 | Inspektor ohne Register; Länge/Höhe und Invert nur indirekt. | Ein Formular für alles. | Register **Objekt · Ports · Eigenschaften · Blatt**: Länge/Höhe (bei Rohren „Länge“), Skalierungsmodus, Spiegeln X/Y, Invertieren, Portrichtungen je Port, freie Schlüssel/Wert-Eigenschaften, Blattgröße/Raster/Auto-Wachstum, „An Inhalt anpassen“. |
| 8 | Kein Rechtsklick-Menü. | — | Kontextmenü für Teil, Verbindung, Zeichenelement und Zeichenfläche (Drehen, Spiegeln, Invertieren, Skalierung, Duplizieren, Gruppieren, Baugruppe speichern, Teil lösen/zusammenziehen, Vordergrund/Hintergrund, Löschen, „hier platzieren“, Blatt anpassen, Raster/Einrasten/Ports). |
| 9 | Strg-Navigation wie in „Anlage“. | Strg nur als Mehrfachauswahl. | **Strg + Ziehen** verschiebt die Ansicht horizontal und vertikal, Strg + Klick ohne Bewegung schaltet die Auswahl weiterhin um, Strg + Pfeiltasten verschieben die Ansicht, Strg + Mausrad zoomt. |

## Architektur der Korrekturen (nur Zeichenebene, additiv)

- **Modell** (`v64_plant_drawing_model.js`): `normalizeStretchProfile`, `plantStretchMap`,
  `plantEntityPortLocalPoint`, `refreshPlantEntityPorts`, `flipPlantEntity`, `invertPlantEntity`,
  `setPlantEntityScaleMode`, `plantContentBounds`, `fitPlantSheetToContent`,
  `createRohrofenR4Example`. Neue Entity-Felder `flip_x`, `flip_y`, `inverted`, `scale_mode`,
  `stretch`, `view_box` sind optional; alte Zeichnungen normalisieren neutral.
- **Editor** (`v64_plant_drawing.js`): segmentiertes Rendering, Spiegel-Transformation,
  Pfeilumkehr, Beschriftungsziele, vom Blatt entkoppelte Ansicht (`resetView`, `viewScale`),
  wachsendes Blatt in `commitModel`, Inspektor-Register, Kontextmenü, Strg-Geste, Tastatur
  **F/I/+/−**, Offenlegen gespeicherter Custom-Entities im Anlagen-Inventar.
- **Symbolbibliothek** (`_tools/build_symbol_standard.py`): `stretch_profile`, Pfeilmarker,
  Beschriftungsziel, sieben neue Definitionen, 42 Templates; Manifest und SVGs deterministisch.
- **Server** (`svg_editor_tool.py`): `stretch` in der Template-Projektion, Geometriefelder in der
  Baugruppen-Normalisierung (`_baugruppen_stretch`, `_baugruppen_view_box`).
- **Styles** (`v64_r4.css`): Blattrahmen, Register, Flags, Port-Tabelle, Eigenschaftszeilen,
  Kontextmenü, Bibliotheks-Hervorhebung; alle Selektoren bleiben auf die Zeichenebene begrenzt.

## Verifikation

- Statisch: `test/test_v64_r4_release.py`, Modell `test/test_v64_r4_model.mjs` (48 Prüfungen),
  Server `test/test_v64_r4_server.py` (23 Prüfungen).
- Browser: `test/smoke_v64_r4.py` (82 Prüfungen) baut die Rohrofen-Anlage **von Grund auf** per
  Mausgesten (Grenzstelle spiegeln, Kapillare/Ventil/Verschraubung/Mischer beim Ablegen einrasten,
  gedrehte Teile per Ziehen einrasten, Flansch und Ofen anstecken), speichert sie als Baugruppe und
  als Custom-Entity, prüft den Wechsel des Anlagen-Inventars auf „Eigene Symbole“ und das Einsetzen.
- Geerbte Verträge (V62 … V64_r3) laufen unverändert; pixelidentischer Referenzexport bleibt erhalten.

## Bewusste Restgrenzen

1. Streckprofile existieren für lineare Rohrteile; Geräte skalieren proportional oder frei.
2. Klassische Verbindungen behalten den orthogonalen Mittelknick.
3. Die Baugruppen-Bibliothek bleibt eine lokale JSON-Bibliothek ohne Versionierung.
