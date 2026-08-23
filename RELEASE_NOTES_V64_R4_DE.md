# Plant Factory V64_r4 – Release Notes

## Ergebnis

V64_r4 perfektioniert den Steck-Editor der Ebene **Anlage · Zeichnen**: Rohre strecken sich
wirklich, jedes Teil lässt sich spiegeln und in der Flussrichtung invertieren, das Blatt wächst
mit der Konstruktion, der Inspektor besitzt Register, ein Kontextmenü und die Strg-Navigation
entsprechen der Ebene „Anlage“, und sieben neue Elementarteile (Swagelok-Fittings, Titan-Kapillare,
Gasmischer, Rohrtermination, Anschluss/Grenzstelle) decken die Rohrofen-Anlage vollständig ab.
Alle Funktionen bis V64_r3 bleiben erhalten.

## Neu in der Zeichenebene

1. **Streckbare Rohrteile**: Gerades Rohr, T-Stück, Kapillare und Doppelmantel-Rohr tragen ein
   Streckprofil. Endkappen und Flusspfeil behalten ihre Größe, nur der Körper wird länger; die
   Ports folgen exakt. Geräte skalieren proportional, „frei“ erlaubt bewusste Verzerrung.
2. **Spiegeln und Invertieren**: **F**/Umschalt+F spiegelt horizontal/vertikal, **I** invertiert
   die Flussrichtung (Ein-/Ausgang tauschen, Pfeile drehen). Damit sind alle acht Lagen eines
   Rohrbogens erreichbar.
3. **Wachsendes Blatt**: Das Blatt passt sich nach jeder Änderung dem Inhalt an, das Raster deckt
   die gesamte Ansicht, ein gestrichelter Rahmen zeigt das Exportmaß. „An Inhalt anpassen“
   schrumpft das Blatt bewusst.
4. **Inspektor-Register**: *Objekt* (Name, Tag, Position, Länge/Höhe, Drehung, Skalierung,
   Spiegeln, Invertieren), *Ports* (Richtung je Port, Status frei/gesteckt/verbunden),
   *Eigenschaften* (freie Schlüssel/Wert-Paare, wandern in das Anlagenbild mit), *Blatt*.
5. **Kontextmenü** per Rechtsklick auf Teil, Verbindung, Zeichenelement oder Zeichenfläche.
6. **Navigation wie in „Anlage“**: Strg + Ziehen verschiebt die Ansicht, Strg + Klick schaltet
   die Auswahl um, Strg + Pfeiltasten verschieben, Strg + Mausrad zoomt, **+**/**−** zoomen.
7. **Neue Elementarteile**: `Swagelok_union`, `Swagelok_tee`, `Swagelok_elbow`, `Capillary_line`,
   `Pipe_cap`, `Boundary_connector` (zeigt den Tag als Beschriftung), `Gas_mixer`; das T-Stück
   wurde bereinigt. PF-PID-V1 umfasst jetzt 42 Templates.
8. **Anlagen-Inventar**: Gespeicherte Custom-Entities werden sofort unter „Eigene Symbole“
   angezeigt, hervorgehoben und beim Einsetzen in der sichtbaren Bildmitte platziert.
9. **Beispiel „Rohrofen mit Fittings & Mischer“**: 31 Teile, 25 gesteckte Verbindungen mit
   Grenzstellen N₂/Educts/Vent/KW, Kapillaren, Fittings, Gasmischer, gespiegeltem U-Bogen und
   gedrehtem Kühler.

## Kompatibilität

- Projekt-, V9-, SCADA-, Runtime-, HMI-, Logik- und Automation-Verträge sind unverändert.
- `plant-factory.plant-drawing` und `plant-factory.plant-drawing-assembly` bleiben Version 1;
  die neuen Entity-Felder `flip_x`, `flip_y`, `inverted`, `scale_mode`, `stretch`, `view_box`
  sind optional und werden neutral ergänzt.
- Klassische Verbindungen im Werkzeug „Verbinden“ bleiben erhalten; Referenzimporte werden nie
  automatisch verschoben (pixelidentischer Export).
- Die geerbten Browser- und Releaseverträge akzeptieren die Revision r4 additiv.

## Prüfung

`./test_all.sh` umfasst jetzt den statischen R4-Vertrag, den R4-Modellvertrag (48 Prüfungen),
den R4-Serververtrag (23 Prüfungen) und die R4-Browserprüfung (82 Prüfungen inklusive Neubau
der Anlage per Mausgesten). Details in **DIAGNOSE_UND_RELEASE_V64_R4_DE.md** und
**docs/v64_r4/**.
