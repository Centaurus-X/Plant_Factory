# V64 – Architektur und Bedienung

## Zweck

Plant Factory V64 ist ein browserbasiertes Engineering- und HMI-Studio. Es
erstellt Anlagenbilder, I/O- und HMI-Bezüge, Logik- und
Automation-Konfigurationen und exportiert daraus SVG-, SCADA-, Runtime-,
Automation-V9-/V8-Cross- und SPS-Artefakte.

V64 ergänzt zwei Werkzeuge:

- signalgebundene SVG-Ereignisanimationen;
- einen elementaren Anlagen-Zeicheneditor.

## Schichten

~~~text
PF-PID-V1 Registry
  ├─ Anlagenbild-Editor
  │    ├─ I/O
  │    ├─ HMI / Bindings
  │    └─ Event-Animationen
  └─ Anlagen-Zeicheneditor
       ├─ elementare Entities
       ├─ semantische Ports
       ├─ Verbindungen
       └─ Custom-Entity-Übernahme

Projektmodell
  ├─ elements / connections
  ├─ devices
  ├─ hmi.event_animations
  ├─ plant_drawing
  ├─ logic
  └─ automation_cfg

Exporter
  ├─ animierbares SVG
  ├─ SCADA-Bundle
  ├─ Runtime-/V9-JSON
  ├─ V8-Cross-Shards
  └─ PF-LOGIC-/SCL-Artefakte
~~~

## Verantwortlichkeiten

### Registry

Die Registry ist die einzige Quelle für:

- Template-ID und Name;
- SVG-Geometrie;
- Kategorie;
- Breite, Höhe und ViewBox;
- semantische Ports;
- animierbare Bereiche;
- Fähigkeiten und HMI-Policy.

### Anlagenbild

Das Anlagenbild ist die kanonische Runtime-/HMI-Fläche. Nur dort platzierte
Entities werden unmittelbar durch HMI-Bindings und Event-Animationen
adressiert.

### Zeicheneditor

Der Zeicheneditor ist ein Konstruktionsmodell. Er erzeugt keine versteckten
Runtimeobjekte. Die Übernahme in das Anlagenbild ist eine ausdrückliche Aktion.

### HMI

HMI-Widgets, Bindings, Styles, Alarme und Event-Animationen referenzieren
Anlagenbild-Entities. Event-Animationen können innerhalb einer Entity ein
semantisches SVG-Ziel adressieren.

### Runtime

Die Runtime übernimmt Signalwerte, bewertet Regeln, setzt Effekte und entfernt
sie bei inaktiver Bedingung wieder. Sie verändert nicht das kanonische Modell.

## Projektpersistenz

Beim Speichern werden alle bestehenden Sektionen unverändert fortgeführt.
Zusätzlich werden gespeichert:

~~~text
plant_drawing
hmi.event_animations
~~~

Beim Laden alter Projekte gelten sichere Standardwerte:

~~~json
{
  "plant_drawing": {
    "schema": "plant-factory.plant-drawing",
    "version": 1,
    "sheets": []
  },
  "hmi": {
    "event_animations": []
  }
}
~~~

## Schnellstart

~~~bash
./start_plant_factory.sh
~~~

Optionale Umgebungswerte:

~~~bash
PLANT_FACTORY_HOST=127.0.0.1
PLANT_FACTORY_PORT=8090
PLANT_FACTORY_VENV=/pfad/zur/venv
PLANT_FACTORY_PYTHON=/pfad/zu/python
AUTOMATION_RUNTIME=/pfad/zur/runtime
~~~

## Standardablauf: Anlagenskizze

1. Workspace **Zeichnen** öffnen.
2. Inventar durchsuchen oder Kategorie filtern.
3. Komponente auswählen.
4. Auf Canvas platzieren.
5. Mit **Verbinden** Ports koppeln.
6. Bei Bedarf freie Geometrie ergänzen.
7. Entities verschieben, skalieren oder drehen.
8. Relevante Auswahl markieren.
9. Vorschau kontrollieren.
10. Als Inventar-Entity speichern oder direkt im Anlagenbild einsetzen.

## Standardablauf: Animation

1. Anlagenbild-Entity auswählen.
2. HMI öffnen.
3. **Zustände & Alarme** wählen.
4. Event-Animationspreset wählen.
5. Triggerquelle und Bedingung definieren.
6. Ziel-Entity bestätigen.
7. Optional SVG-Teilziel auswählen.
8. Effektparameter festlegen.
9. Vorschau ausführen.
10. Regel speichern und Export prüfen.

## Tastatur

Im Zeicheneditor:

- V: Auswahl;
- C: Verbinden;
- Entf/Rücktaste: Auswahl löschen;
- Strg/Cmd+D: Auswahl duplizieren;
- Escape: laufende Aktion abbrechen;
- Strg+Mausrad: zoomen;
- Strg-/Cmd-/Umschalt-Klick: Mehrfachauswahl.

## Validierung

Der Zeicheneditor prüft:

- doppelte Entity- und Verbindungs-IDs;
- fehlende Templates;
- fehlende semantische Ports;
- ungültige Verbindungsendpunkte.

Der HMI-Exporter prüft:

- doppelte animation_id;
- fehlende Ziel-Entity;
- ungültige Signalquelle;
- unbekannten Effekt;
- ungültigen Teilselektor zur Laufzeit.

## Betriebsgrenze

Die V64-Startvorgabe bindet für die Testumgebung an 0.0.0.0. Dies ist keine
Produktionshärtung. Eine Produktivbereitstellung benötigt mindestens TLS,
Authentifizierung, Rollen, Origin-/CSRF-Schutz, Rate-Limits, Service- und
Logmanagement.
