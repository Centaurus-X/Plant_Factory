# V64 – Anlagen-Zeicheneditor

## Leitprinzip

Rohre, Flansche, Geräte, Messstellen und freie Zeichenobjekte bleiben
elementar. Eine Baugruppe entsteht erst durch Auswahl, Vorschau und eine
ausdrückliche Inventaraktion.

## Datenmodell

~~~json
{
  "schema": "plant-factory.plant-drawing",
  "version": 1,
  "active_sheet_id": "sheet_main",
  "sheets": [
    {
      "sheet_id": "sheet_main",
      "name": "Anlagenskizze",
      "width": 1600,
      "height": 1000,
      "grid": 10,
      "entities": [],
      "connections": [],
      "primitives": []
    }
  ],
  "custom_templates": []
}
~~~

## Entity

Eine Entity enthält:

- entity_id;
- template_id;
- Name und optionalen Tag;
- X/Y;
- Breite/Höhe;
- Drehung;
- lokale Portkopien mit relativen Koordinaten;
- additive Eigenschaften.

Die SVG-Geometrie wird nicht in jeder Entity dupliziert. Sie kommt aus der
Registry.

## Port

Ein Port enthält:

- stabile ID und Bezeichnung;
- lokale X/Y- und relative RX/RY-Koordinaten;
- Art: process, utility, signal oder power;
- Richtung: in, out oder bidirectional;
- Rolle.

Beim Skalieren bleiben RX/RY stabil. Beim Drehen wird die Weltkoordinate um das
Entityzentrum transformiert.

## Verbindung

Eine Verbindung referenziert:

~~~text
from_entity_id + from_port_id
to_entity_id   + to_port_id
~~~

Die Linie ist eine Projektion dieser Semantik. Sie wird nicht als unabhängige
anonyme Geometrie gespeichert.

### Typen

- process: Prozessrohr;
- utility: Versorgungsmedium;
- signal: Mess-/Steuersignal;
- power: Energie.

Nicht passende Portarten erzeugen einen Hinweis. Die Verbindung bleibt in
begründeten Sonderfällen möglich.

## Freie Primitiven

- Linie;
- Rechteck;
- Ellipse;
- Text.

Primitiven sind für Maße, Rahmen, Hilfslinien und Beschriftungen gedacht.
Prozessverbindungen sollten über semantische Ports erstellt werden.

## Inventar

Der Editor verwendet sämtliche geladenen Registry-Templates. V64 ergänzt:

### Rohrbauteile

- Pipe_straight;
- Pipe_elbow_90;
- Pipe_tee;
- Flange_pair.

### Geräte

- Gas_bottle;
- Tubular_reactor;
- Tube_furnace;
- Double_pipe_cooler;
- Plate_heat_exchanger.

Andere bestehende PF-PID-V1-, Legacy- und Custom-Templates können ebenfalls
verwendet werden.

## Auswahl und Bearbeitung

- einfacher Klick: Einzelobjekt;
- Strg/Cmd/Umschalt-Klick: Mehrfachauswahl;
- Ziehen: ausgewählte Entities oder Primitiven gemeinsam verschieben;
- Inspektor: Name, Tag, Position, Größe und Drehung;
- Strg/Cmd+D: Auswahl duplizieren;
- Entf/Rücktaste: Auswahl und abhängige Verbindungen entfernen;
- Escape: laufende Aktion abbrechen.

## Baugruppenvorschau

Die Vorschau enthält:

- ausgewählte Entities;
- ausgewählte Primitiven;
- alle Verbindungen, deren beide Endentities ausgewählt sind;
- einen normierten ViewBox-Rahmen;
- keine Editor-Hilfsobjekte.

## Externe Ports einer Baugruppe

Ein Port wird nicht veröffentlicht, wenn er durch eine interne Verbindung der
Auswahl belegt ist. Alle übrigen Ports werden:

- in Baugruppenkoordinaten umgerechnet;
- mit Entity- und Port-ID eindeutig benannt;
- mit Art, Richtung und Rolle übernommen.

So kann die neue Entity später erneut an Rohre, Geräte oder Signale gekoppelt
werden.

## Inventarübernahme

### Nur im Inventar speichern

Erzeugt ein sanitisiertes Custom-SVG und lädt die Registry neu. Die aktuelle
Konstruktionsauswahl bleibt unverändert.

### Speichern und im Anlagenbild einsetzen

Führt denselben Upload aus, wechselt anschließend in das Anlagenbild und
aktiviert das neue Template zum Platzieren.

### Metadaten

Die Custom-Entity erhält:

- Name und Kategorie;
- family und symbol_type custom-composition;
- Breite, Höhe und ViewBox;
- externe Ports;
- animierbare Bereiche;
- Runtimezustände;
- Fähigkeiten für Auswahl, Transformation, Binding und Animation.

## Rohrofen-Beispiel

Das Beispiel kombiniert:

- Gasflasche;
- Flansch;
- Rohrreaktor;
- Rohrofen;
- Doppelrohr-Kühler;
- Druckanzeige;
- Temperaturmessstelle;
- vier semantische Verbindungen;
- eine Beschriftung.

Es dient als Bedienbeispiel, nicht als starres Gesamtobjekt.

## Export

### SVG

Der vollständige Sheet-Inhalt wird mit Metadaten, Entities, Verbindungen,
Primitiven und semantischer Entity-/Template-Kennung exportiert.

### JSON

Exportiert den vollständigen, verlustfreien Konstruktionsvertrag.

### Projekt

Das Modell wird als project.plant_drawing gespeichert.

### Runtime/V9

Der Export enthält:

~~~text
plant_drawing
plant_drawing_report
hmi_ui.plant_drawing_ref
~~~

## Validierung

Fehler:

- doppelte IDs;
- fehlendes Template;
- Verbindung zu fehlender Entity;
- Verbindung zu fehlendem Port.

Hinweise:

- Template derzeit nicht geladen;
- Entity ohne semantische Ports;
- Portart weicht vom gewählten Verbindungstyp ab;
- ungewöhnliche Eingangs-/Ausgangskombination.

## Bewusste Grenzen

- automatische Rohr-Hindernisumfahrung ist nicht Bestandteil von V64;
- freie Bézierpfade und CAD-Bemaßungslogik sind nicht Bestandteil von V64;
- eine Inventarbaugruppe ist im Anlagenbild bewusst eine Entity;
- die elementare Ursprungskomposition bleibt im plant_drawing-Modell erhalten.
