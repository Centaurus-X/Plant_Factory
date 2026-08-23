# Diagnose und Freigabe – Plant Factory V64_r3

## Auftrag

Die Ebene **Anlage · Zeichnen** sollte als Konstruktionswerkzeug funktionieren: elementare
Rohre, Flansche, Geräte und Instrumente werden wie beim Bau einer realen Anlage
zusammengesteckt, daraus entstehen wiederverwendbare Baugruppen, die Baugruppen bleiben
aus einzeln konfigurierbaren Teilen zusammengesetzt, und es existieren zwei getrennte,
aber überführbare Inventare (Zeichen-Inventar und Anlagen-Inventar). Die vollständige
Codebasis V64_r2 wurde dazu analysiert; alle bis V64_r2 freigegebenen Funktionen bleiben
unverändert erhalten.

## Befund der Zeichenebene in V64_r2

### Architektur (tragfähig)

- `v64_plant_drawing_model.js` ist ein reines, normalisierendes Datenmodell mit
  Entity-/Port-/Verbindungsvertrag, Welt-Koordinaten für Ports inklusive Rotation und
  deterministischer Validierung.
- `v64_plant_drawing.js` rendert Entities als eingebettete Template-Viewports, besitzt
  Werkzeuge für Auswahl, Pan, klassische Portverbindung und freie Primitive, Undo/Redo
  über den App-State, SVG-/JSON-Export und die Übernahme einer Auswahl als Custom-Entity.
- Projekt-, V9-, SCADA- und Runtime-Pfade transportieren `plant_drawing` additiv.

### Festgestellte Mängel (reproduziert im Browser)

| Nr. | Befund | Ursache | Auswirkung |
|---|---|---|---|
| 1 | Rohre ließen sich nicht „zusammenstecken“. Zwei Rohre und ein Flansch blieben getrennte Objekte, dazwischen wurde eine dicke, gepfeilte Anlagenverbindung mit Mittelknick gezeichnet. | Es gab nur die klassische Zwei-Klick-Verbindung; keinerlei geometrisches Einrasten, kein Begriff einer Port-auf-Port-Kopplung. | Das Kernziel der Ebene (Anlage aus Teilen bauen) war nicht erreichbar; Zeichnungen wirkten wie ein zweites Anlagenbild. |
| 2 | Freie Ports waren im Auswahlmodus unsichtbar. | Ports wurden nur im Werkzeug „Verbinden“ gerendert. | Man wusste nicht, wo ein Teil angesetzt werden kann. |
| 3 | Dünne Teile (Rohre, Flansche) waren kaum greifbar; Klicks neben die Linie trafen ins Leere. | Das Entity-Element hatte keine Trefferfläche; nur gezeichnete Striche reagierten. | „Buggy“ wirkendes Ziehen, verlorene Auswahl. |
| 4 | Verbindungen waren kaum anklickbar. | 1,7–3 px Pfad ohne Trefferzone. | Verbindungen ließen sich nicht zuverlässig selektieren oder löschen. |
| 5 | Größe und Drehung nur numerisch im Inspektor. | Keine Griffe, keine Tastaturdrehung. | Rohre verlängern oder senkrecht stellen war mühsam. |
| 6 | Jeder Klick erzeugte einen History-Eintrag. | `finishDrag` committete auch ohne Bewegung. | Undo-Verlauf verwässert. |
| 7 | Das Zeichen-Inventar zeigte alle 35 Registry-Templates inklusive I/O-Hardware und künftige Custom-Entities; gespeicherte Baugruppen wurden als flaches SVG in dasselbe Inventar geschrieben. | Palette = gesamte Template-Registry; einziger Speicherweg = Custom-SVG-Upload. | Inventare vermischt; Baugruppen verloren beim Wiederverwenden ihre Einzelteile. |
| 8 | Eine in das Anlagenbild übernommene Baugruppe war eine einzige Entity. | Nur der Custom-Entity-Pfad existierte. | Einzelteile waren im Anlagenbild nicht mehr konfigurier- oder bindbar. |
| 9 | Das Rohrofen-Beispiel überlagerte Reaktor und Ofen und verband Geräte mit klassischen Linien. | Beispiel stammte aus der V64-Erstintegration. | Kein Vorbild für das Zusammenstecken. |
| 10 | Doppelklick auf ein Teil war nicht nutzbar. | Nach jedem Klick wird das SVG neu aufgebaut; native `dblclick`-Ereignisse benötigen dasselbe Zielelement. | Keine schnelle Verbundauswahl. |

## Korrekturen in V64_r3

### Modell (`v64_plant_drawing_model.js`, additiv)

- **Joints**: Verbindungen erhalten `joint: true` und `routing: 'direct'`. Ein Joint ist eine
  gesteckte Port-auf-Port-Kopplung ohne eigenen Leitungsverlauf.
- **Snap-Kandidaten**: `findPlantSnapCandidate` bewertet freie, medienkompatible Ports der
  bewegten Teile gegen alle freien Ports der ruhenden Teile (Toleranz zoomabhängig,
  Richtungskonflikt nur als Rangmalus). `snapPlantEntitiesToPorts` verschiebt exakt auf den
  Zielport und legt alle dann koinzidenten Joints an (`createPlantJoints`).
- **Verbund**: `plantConnectedComponent` und `expandPlantSelectionToComponent` folgen Joints
  und Baugruppen-Zugehörigkeit; klassische Linien (Signal, Medium) trennen nicht.
- **Offene Joints**: Bewegt man ein Teil allein, bleibt der Joint als Datenbeziehung erhalten
  und wird als offener Joint gemeldet; `closePlantJoint` zieht die Teile wieder zusammen.
- **Transformation**: `rotatePlantSelection` dreht Teile und Primitive um den Auswahlmittelpunkt,
  `resizePlantEntityByHandle` ändert Breite/Höhe über acht Griffe und führt Ports relativ mit.
- **Baugruppen-Templates**: `createAssemblyTemplate` normalisiert Teile, interne Joints,
  freie Ports und Primitive auf lokale Koordinaten; `instantiateAssemblyTemplate` erzeugt
  daraus wieder einzelne Entities mit neuen IDs und gemeinsamer `assembly_id`.
- **Beispiel**: `createRohrofenAssemblyExample` baut die Rohrofen-Anlage aus 21 Elementarteilen
  mit 17 geschlossenen Joints (N₂-/Edukt-Flaschen, Ventile, T-Stück als Gasmischer,
  Rohrbögen, Flanschpaare, Rohrofen, Doppelrohr-Kühler, Vent-Ventil, PI/TIC/TI).
- Das bisherige Beispiel (`createRohrofenPlantExample`) und alle r1/r2-Exporte bleiben unverändert.

### Editor (`v64_plant_drawing.js`)

- Einrasten beim Ziehen und beim Platzieren aus dem Inventar, mit pulsierendem Zielport und
  Beschriftung „Koppeln: Rohr Ausgang → Flansch Eingang“.
- Verbund mitziehen (umschaltbar), **Alt + Ziehen** löst ein Teil und entfernt seine Joints,
  Doppelklick (manuell erkannt) wählt den Verbund.
- Transparente Trefferflächen für Entities und Verbindungen, freie Ports als dezente Hinweise,
  belegte Ports bleiben verborgen.
- Acht Größen-Griffe, Drehgriff (Umschalt = 15°-Raster), Taste **R**/Umschalt+R, Pfeiltasten,
  Strg+A, Strg+G, Rahmenauswahl.
- Joints werden als Steckmarke gezeichnet; geöffnete Joints erscheinen als orange gestrichelte
  Spannlinie mit Aktion „Teile zusammenziehen“.
- Zwei Inventar-Register: **Elemente** (PF-PID-V1-Standardteile und bewusst aus dem
  Anlagen-Inventar übernommene Symbole) und **Baugruppen** (Bibliothek und Projekt).
- Übernahme-Karte mit drei getrennten Wegen: *Als Baugruppe speichern* (Zeichen-Inventar),
  *Als Einzelobjekte ins Anlagenbild* (jedes Teil bleibt eigenständige Anlagen-Entity,
  Joints werden Anlagenverbindungen), *Als Custom-Entity ins Anlagen-Inventar* (bisheriger Weg).
- History-Einträge nur bei tatsächlicher Änderung.

### Server (`svg_editor_tool.py`)

- `GET/POST /api/drawing-assemblies` und `POST /api/drawing-assemblies/loeschen` persistieren
  Baugruppen als JSON in `public/svg_templates/assemblies/`, getrennt vom SVG-Template-Scan.
- Normalisierung verwirft Teile ohne Template, hängende Verbindungen, SVG-Fragmente, externe
  CSS-URLs und nicht-skalare Eigenschaften; IDs sind traversal-sicher; Schreiben erfolgt atomar.

## Abgrenzung und erhaltene Funktionen

- Klassische Verbindungen (Prozess, Medium, Signal, Energie) bleiben im Werkzeug „Verbinden“
  erhalten und werden weiterhin orthogonal gezeichnet; sie sind der passende Weg für
  Instrumentierung und Medienlinien, die nicht gesteckt werden.
- Referenzanlagen-Import, SVG-/JSON-Export, Custom-Entity-Übernahme, Projekt-/V9-/SCADA-Pfade,
  HMI, Logik, Automation Studio, Topologie und Prüfung sind unverändert.
- Das Schema `plant-factory.plant-drawing` bleibt Version 1; neue Felder sind optional und
  werden beim Normalisieren ergänzt. Alte Projekte laden unverändert.

## Bewusste Restgrenzen

1. Spiegeln (Flip) von Teilen ist nicht enthalten; Rohrbögen werden über Drehung orientiert.
2. Orthogonale Klassik-Verbindungen behalten den deterministischen Mittelknick.
3. Die Baugruppen-Bibliothek ist eine lokale JSON-Bibliothek des Dienstes ohne Versionierung.

## Freigabekriterium

V64_r3 ist freigabefähig, wenn alle geerbten statischen und Browser-Verträge (V62 bis V64_r2)
ohne Regression bestehen, die neuen Modell-, Server-, Release- und Browser-Verträge der
Revision r3 bestehen, Browserkonsole und Requests fehlerfrei bleiben und Archiv sowie
SHA-256-Manifeste verifiziert sind.
