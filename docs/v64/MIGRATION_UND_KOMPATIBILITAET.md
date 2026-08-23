# V64 – Migration und Kompatibilität

## Migrationsstrategie

V64 ist additiv. Es gibt keine destruktive Migration und keine Umschreibung
vorhandener V63.4-Projektsektionen.

## Altprojekt nach V64

Fehlende Sektionen werden normalisiert:

~~~json
{
  "hmi": {
    "version": 2,
    "event_animations": []
  },
  "plant_drawing": {
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
}
~~~

## Erhaltene Sektionen

- elements;
- connections;
- devices;
- processes;
- dynamic_rule_engine;
- rule_library;
- free_rules;
- logic;
- automation_cfg;
- hmi widgets, bindings, styles und alarms;
- SVG-Content und Snapshots.

Unbekannte additive Felder bleiben erhalten, sofern der bisherige
Normalisierungsvertrag dies bereits vorsieht.

## PF-PID-V1

Die neun neuen Templates ergänzen das Manifest. Bestehende Template-IDs,
Kategorien und Dateien werden nicht umbenannt. Die Kategorie Rohrbauteile wird
in die bestehende Sortierung eingefügt.

## HMI

Die HMI-Version wird mindestens auf 2 normalisiert. Widgets, Bindings, Styles
und Alarme bleiben unverändert. event_animations ist ein zusätzliches Array.

## SVG

### Vorhandene Standardanimationen

Bestehende Klassenanimationen bleiben aktiv.

### Importierte SMIL-SVGs

SMIL bleibt erhalten, sofern der bestehende Sanitizer das konkrete Element und
seine Attribute zulässt. V64 entfernt SMIL nicht allein wegen der neuen
Event-Runtime.

### Event-Animationen

Neue Regeln werden als Metadaten und CSS-/Runtimevertrag ergänzt. Sie ändern
nicht automatisch bestehende animate-Elemente.

## V9 und V8 Cross

Die kanonischen Automationstabellen, Shardregeln und Cross-Projektionen bleiben
unverändert. plant_drawing und hmi_ui sind additive UI-/Engineering-Sektionen.

Die Node-/Cross-Projektion darf ihre bisherigen fachlichen Tabellen weiterhin
ohne Zeichenmodell ausrollen; der vollständige Runtime-/Projekt-Export bewahrt
das Zeichenmodell.

## PF-LOGIC-V1

Keine Änderung am Graph-, Compiler- oder Zielartefaktvertrag. Der
generated_by-Wert nennt V64; Semantik und IDs bleiben kompatibel.

## Custom-Templates

Vorhandene Custom-SVGs bleiben ladbar. V64-Kompositionen verwenden dieselbe
Server-API und denselben Sanitizer. Sie erhalten zusätzliche semantische
Metadaten, die ältere Clients ignorieren können.

## Rückwärtsnutzung

Ein in V64 gespeichertes Projekt kann in V63.4 die unbekannten V64-Sektionen
unter Umständen bewahren, aber nicht bearbeiten oder ausführen. Ein
verlustfreier Rückweg wird deshalb nicht als Freigabevertrag zugesichert.

Empfehlung:

1. V63.4-Projekt sichern.
2. In V64 öffnen.
3. Unter neuem Projektnamen speichern.
4. V64-Export und HMI-Verhalten prüfen.

## Start und Deployment

Das V64-Startskript verwendet ausschließlich sein eigenes aufgelöstes
Releaseverzeichnis. Dadurch tritt der frühere Fehler eines Wrapper-Skripts mit
relativem, falschem Zielverzeichnis nicht auf.

## Sicherheitskompatibilität

Die bestehenden Header, Pfadtraversal-, Sanitizer- und atomaren
Schreibverträge bleiben bestehen. V64 fügt clientseitig eine zweite
SVG-Absicherung für die Vorschau hinzu.

## Abnahmekriterien

- V63.4-Projekt ohne manuelle Migration laden;
- vorhandenes Anlagenbild identisch darstellen;
- vorhandene HMI-Konfiguration unverändert nutzen;
- neue Animation optional ergänzen;
- neues Zeichenmodell optional ergänzen;
- speichern, neu laden und exportieren;
- geerbte Regressionstests bestehen.
