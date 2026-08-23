# Generic_Sensor_Entity

## Zweck

`Generic_Sensor_Entity` ist ein normalisiertes PF-PID-V1-Symbol für
Messstellen, deren konkreter Sensortyp erst während der I/O-Zuweisung
festgelegt wird. Das Symbol erweitert die Bibliothek von 25 auf 26 kanonische
Templates.

## Bibliotheksmetadaten

```text
Template-ID: Generic_Sensor_Entity
Name:        Generische Sensor-Entität
Kategorie:   Messstellen
Familie:     generic-sensor-entity
TAG-Präfix:  SE
Rolle:       sensor
Modus:       generic
```

## Ports

Die Entity besitzt standardisierte Ports für:

- Prozessbezug;
- Signalfluss;
- Datenbezug.

Dadurch kann sie im P&ID, im HMI-Binding und optional als Signalquelle im
PF-LOGIC-V1-Editor verwendet werden.

## Runtime-Abbildung

Das Symbol führt **keine neue konkurrierende Runtime-Entityklasse** ein. Bei
der I/O-Zuweisung wird es auf einen vorhandenen oder neu konfigurierten
Sensor der kanonischen V9-Sensortabelle gebunden. Der konkrete Sensortyp,
Controller, Bus, Adresse, Funktion und gegebenenfalls Skalierungsprofil werden
weiterhin im bestehenden I/O-/V9-Modell gepflegt.

## Normalisierung

- deterministisch durch `_tools/build_symbol_standard.py` erzeugt;
- lokale SVG-Geometrie ohne externe Ressourcen;
- PF-PID-V1-konforme Konturen, Ports und Zustandsklassen;
- keine automatische HMI-Widget-Erzeugung;
- kompatibel mit Legacy-Projekten und Custom-SVGs.
