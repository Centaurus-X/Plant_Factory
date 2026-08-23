# Release Notes Plant Factory V63.2

## Zweck

V63.2 ist ein minimal-invasives Stabilitäts- und Konsistenzrelease auf Basis
von V63.1. PF-PID-V1, PF-MODAL-V1, PF-HMI-SETUP-V2 und PF-LOGIC-V1 bleiben
unverändert erhalten. Die Änderungen beheben vier reproduzierbare UI-/Lifecycle-
Fehler und konsolidieren die Automation-Oberfläche auf den kanonischen
Automation_System-V9-Vertrag.

## Behobene Fehler

### Kompakter Verbindungsdialog

Der Dialog **Verbindung erstellen** startet wieder mit einer kontrollierten
Breite von 620 Pixeln, responsiver Maximalbreite und automatischer Höhe. Eine
zuvor maximierte oder manuell vergrößerte Fenstergeometrie wird beim nächsten
Öffnen dieses Dialogs bewusst zurückgesetzt. Verschieben, Skalieren,
Maximieren und Tastaturbedienung bleiben erhalten.

### Deterministisches Rendering gespeicherter Verbindungen

Gespeicherte Verbindungen werden zunächst als `pending` aufgebaut und erst
nach gültiger SVG-Geometrie sichtbar geschaltet. Ein begrenzter, abbrechbarer
Layout-Retry wartet auf Bounding Box und Transformationsmatrix der Objekte.
Dadurch erscheinen bestehende Linien sofort nach dem Projektaufbau und nicht
erst zufällig nach dem Verschieben eines Objekts. Das Verschieben aktualisiert
die Pfade weiterhin dynamisch, ohne neue Modellverbindungen zu erzeugen.

### Direkte Canvas-Auswahl im I/O-Editor

Eine eindeutige Auswahl auf der Zeichenfläche wird direkt in den I/O-Editor
übernommen. Vorhandene Rolle, I/O-ID, Controller, Bus, Adresse, Funktion,
Alias und Widgetdaten werden ohne erneute Dropdown-Auswahl geladen.
Mehrfachauswahl verändert den I/O-Editor bewusst nicht automatisch.

### Additive Timer-/Counter-Demo

Das Öffnen der Timer-/Counter-Demo ersetzt nicht mehr `project.logic`.
Die Demo wird einmalig als zusätzlicher Schaltplan eingefügt oder bei erneutem
Öffnen lediglich aktiviert. Eigene Schaltpläne, Nodes, Edges, Bindings,
Ownership und Ausführungsparameter bleiben erhalten.

## PF-AUTOMATION-V9-BRIDGE

V63.2 führt den Vertrag `PF-AUTOMATION-V9-BRIDGE` ein. Die kanonische
Runtime-Struktur bleibt:

```text
process_states
filters
timers
rule_engine
rules
```

Die Zuständigkeiten sind eindeutig:

```text
project.processes.process_states       editierbare Projekt-States
project.dynamic_rule_engine.rule_sets  editierbare Projektregeln
project.logic                          optionale grafische Schaltlogik
V9 process_states/filters/timers/
   rule_engine/rules                   erzeugte bzw. geladene Runtime-Sicht
```

Historische `automation_rule_sets` werden nicht gelöscht. Sie werden
schreibgeschützt unter `legacy_automation_rule_sets` archiviert und nicht als
zweite aktive Regelquelle exportiert.

## UI-Konsolidierung Automation

Der Automation-Arbeitsbereich unterscheidet nun verständlich zwischen:

- Projekt-States;
- Projektregeln;
- Runtime-States V9;
- Runtime-Regeln V9;
- Parameter-Schemas;
- Runtime-Hilfen.

Der frühere aktive Bereich **Automation Rules** wurde aus der Bearbeitungs-
oberfläche entfernt. Die dahinterliegenden Legacy-Daten bleiben für Migration
und Diagnose erhalten.

## Vollständiges Beispielprojekt

`projekte/v63_2_komplettbeispiel.json` und die zugehörige SVG-Datei zeigen:

- sechs normalisierte PF-PID-V1-Objekte;
- fünf semantische Anlagenverbindungen;
- Sensor-/Aktorbindungen;
- explizite HMI-Widgets und Bindings;
- Projekt-States und Projektregeln;
- freie Timer;
- zwei additive PF-LOGIC-V1-Schaltpläne;
- den PF-AUTOMATION-V9-BRIDGE-Vertrag.

Das Beispiel wird deterministisch aus der V61.1-Referenzgeometrie und einem
V63.2-Overlay erzeugt.

## Kompatibilität

V63.2 erhält vollständig:

- PF-PID-V1 und alle Legacy-/Custom-SVG-Objekte;
- HMI-Widgets, Animationen, Bindings, Styles und Alarme;
- modale Fenster und Canvas-Kontextmenüs;
- Undo/Redo, Snapshots, Projektladen und -speichern;
- PF-LOGIC-V1 mit 33 Bausteinen und allen Zieladaptern;
- V9- und V8-Cross-Konfigurationen;
- Universal Runtime JSON und Siemens-/IEC-SCL-Ausgabe.

## Freigabegrenze

Die automatisierte Prüfkette verifiziert die Software-Baseline. Vor dem Einsatz
an einer realen Anlage bleiben FAT/SAT, reale I/O-Punktprüfung, Safety- und
Security-Freigabe sowie die Abnahme der konkreten SPS-/SCADA-, Feldbus- und
Netzwerkinfrastruktur erforderlich.

## Verifikation

Die finale Freigabekette umfasst 18 Stufen und wird sowohl im Entwicklungsstand
als auch aus dem unveränderten, frisch extrahierten Releasearchiv ausgeführt.
Sie enthält die externe `automation_system_v0101`-Autorität sowie die
Chromium-Verträge der Baseline V61.1, V62.1, V63.1 und den neuen V63.2-
Regressionslauf.

Zentrale Ergebnisse:

- PF-PID-V1: 31 Prüfungen;
- PF-LOGIC-V1 JavaScript: 66 Prüfungen;
- PF-LOGIC-V1 Runtime: 35 Prüfungen;
- PF-AUTOMATION-V9-BRIDGE: 40 Prüfungen;
- statischer V63.2-Vertrag: 86 Prüfungen;
- Plant-Factory-Kette: 31 Prüfungen;
- Snapshot-Kette: 52 Prüfungen;
- V9-Kern: 145 Prüfungen;
- externe Runtime-Autorität: 29 Prüfungen;
- Browser-Baseline: 119 + 45 + 51 Prüfungen;
- V63.2-Browserregressionen: 45 Prüfungen.

Die vollständigen Ergebnisse stehen in `V63_2_VERIFICATION_SUMMARY.txt` und
`docs/v63_2/RELEASE_MANIFEST_V63_2.json`.
