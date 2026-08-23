# V64_r4 – Architektur und Bedienung

## Architektur

V64_r4 erweitert das rein funktionale Zeichenmodell (`v64_plant_drawing_model.js`) und die
Interaktionsschicht (`v64_plant_drawing.js`) additiv um Geometrie, Ansicht und Bedienung.
Die Symbolbibliothek PF-PID-V1 wird weiterhin deterministisch aus
`_tools/build_symbol_standard.py` erzeugt.

```text
Template (META: ports, stretch, Pfeilmarker, Beschriftungsziel)
        ↓ createPlantEntity
Entity { scale_mode, stretch, view_box, flip_x, flip_y, inverted, ports[rx, ry → x, y] }
        ↓ refreshPlantEntityPorts (Streckabbildung + Spiegelung)
Renderer: feste Segmente (Originalmaß) + flexible Segmente (gestreckt) · Spiegel-Transform ·
          Pfeile gedreht bei inverted · Tag als Beschriftung
        ↓ commitModel
fitPlantSheetToContent → Blatt wächst, Inhalt rasterbündig im Blattrand, Ansicht folgt
```

### Entity-Felder (optional, neutral normalisiert)

| Feld | Bedeutung |
|---|---|
| `scale_mode` | `uniform` (Gerät, Seitenverhältnis bleibt), `stretch` (lineares Teil), `free` (verzerrt) |
| `stretch` | `{axis, fixed:[[a,b],…]}` in viewBox-Einheiten, aus dem Template übernommen |
| `view_box` | viewBox des Templates (Basis der Streckabbildung) |
| `flip_x`, `flip_y` | Spiegelung um die lokale Mittelachse; Ports werden mitgeführt |
| `inverted` | Flussrichtung invertiert: Ein-/Ausgang getauscht, Pfeile um 180° gedreht |

### Streckabbildung

`plantStretchMap(stretch, viewBox, width, height)` teilt die Achse in feste und flexible
Segmente. Feste Segmente behalten den Querachsen-Maßstab, flexible teilen sich den Rest der
Länge; ist das Teil kürzer als die Summe der Kappen, wird gleichmäßig komprimiert. Ports,
Rendering und Export verwenden dieselbe Abbildung, deshalb sitzen Joints auch bei gestreckten
Rohren exakt.

### Orientierung eines Rohrbogens (Eingang → Ausgang)

| Drehung | ohne Spiegelung | `flip_x` | `flip_y` |
|---|---|---|---|
| 0° | links → unten | rechts → unten | links → oben |
| 90° | oben → links | unten → links | — |
| 180° | rechts → oben | links → oben | — |
| 270° | unten → rechts | oben → rechts | — |

Mit **I** wird jede Lage zusätzlich in der Flussrichtung umgekehrt.

## Bedienung

### Maus und Tastatur

| Aktion | Bedienung |
|---|---|
| Teil platzieren | Karte klicken und auf die Fläche klicken, oder Karte ziehen; nahe an einem freien Port rastet es ein |
| Rohr verlängern | Ost-/West-Griff ziehen (Länge), Nord-/Süd-Griff (Stärke) |
| Drehen | **R** / Umschalt+R, Drehgriff, Kontextmenü |
| Spiegeln | **F** horizontal, Umschalt+**F** vertikal, Inspektor-Häkchen, Kontextmenü |
| Invertieren | **I**, Inspektor-Häkchen, Kontextmenü |
| Ansicht verschieben | **Strg + Ziehen**, Leertaste/H + Ziehen, Mausrad, Strg + Pfeiltasten |
| Zoom | Strg + Mausrad, **+**/**−**, Toolbar, „Ansicht einpassen“ |
| Mehrfachauswahl | Strg/Umschalt + Klick (ohne Bewegung), Rahmen ziehen, Strg+A |
| Verbund | Doppelklick, Alt + Ziehen löst, „Zusammenziehen“ schließt offene Joints |
| Kontextmenü | Rechtsklick auf Teil, Verbindung, Zeichenelement oder Fläche; Escape schließt |

### Inspektor-Register

- **Objekt**: Name, Tag/Beschriftung, X, Y, Länge/Breite, Höhe, Drehung, Skalierung, Spiegeln,
  Invertieren, Aktionen (Drehen, Spiegeln, Invertieren, Verbund, Teil lösen, Zusammenziehen).
- **Ports**: Richtung je Port (Eingang/Ausgang/Beidseitig) und Status frei/gesteckt/verbunden.
- **Eigenschaften**: freie Schlüssel/Wert-Paare (z. B. `dn`, `werkstoff`, `label`); sie werden bei
  der Übernahme ins Anlagenbild mitgeführt. `label` ersetzt bei Grenzstellen die Beschriftung,
  wenn kein Tag gesetzt ist.
- **Blatt**: Name, Breite, Höhe, Raster, automatisches Wachstum, „An Inhalt anpassen“,
  „Ansicht einpassen“.

### Neue Elementarteile

| Template | Verwendung | Ports |
|---|---|---|
| `Swagelok_union` | Klemmring-Verschraubung im Rohrstrang | inlet, outlet |
| `Swagelok_tee` | T-Verschraubung | inlet, outlet, branch |
| `Swagelok_elbow` | Winkelverschraubung | inlet (links), outlet (unten) |
| `Capillary_line` | Titan-Kapillare, streckbar | inlet, outlet |
| `Pipe_cap` | Rohrtermination / Blindkappe | inlet |
| `Boundary_connector` | Anschluss / Grenzstelle mit Tag-Beschriftung (N₂, Educts, Vent, KW …) | line (beidseitig) |
| `Gas_mixer` | Gasphasen-Mischer M-101 | inlet_a, inlet_b, outlet, instrument |

### Anlage von Grund auf bauen (Kurzanleitung)

1. `Boundary_connector` platzieren, **F** drücken (Port rechts), Tag „N₂“ setzen.
2. `Capillary_line`, `Valve_(general)`, `Swagelok_union`, `Gas_mixer` nacheinander nahe an den
   jeweils freien Port ablegen – jedes Teil rastet ein.
3. `Swagelok_union`, `Pipe_straight`, `Flange_pair` frei platzieren, mit **R** drehen und an den
   Mischerausgang bzw. das vorherige Teil ziehen; `Tube_furnace` unter den Flansch setzen.
4. Rohre per Ost-/West-Griff auf Maß ziehen, Bögen mit **F**/**R** orientieren.
5. Doppelklick auf ein Rohr prüft den Verbund; Strg+A → „Als Baugruppe speichern“ oder
   „Als Einzelobjekte ins Anlagenbild“; „Als Custom-Entity“ legt die Anlage unter „Eigene
   Symbole“ des Anlagen-Inventars ab.

Die Schaltfläche **„Rohrofen mit Fittings & Mischer laden“** enthält genau diese Anlage
(31 Teile, 25 Joints) als Vorlage.
