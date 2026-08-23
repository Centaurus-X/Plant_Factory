# V64 – SVG-Ereignisse und Animationen

## Ziel

Eine Animation ist in V64 keine autonome Demonstrationszeitachse, sondern eine
deklarative Reaktion auf ein fachliches Signal oder Ereignis.

## Schema

Schema-ID:

~~~text
plant-factory.svg-event-animation
~~~

Beispiel:

~~~json
{
  "animation_id": "reactor_temperature_high",
  "name": "Reaktor heiß",
  "enabled": true,
  "view_id": "main",
  "trigger": {
    "type": "signal",
    "source": {
      "kind": "sensor",
      "sensor_id": 7,
      "field": "value"
    },
    "condition": {
      "operator": "gte",
      "value": 500
    }
  },
  "target": {
    "element_id": "reactor_1",
    "part_selector": "[data-pf-state-target=\"temperature\"]"
  },
  "effect": {
    "type": "temperature",
    "active_color": "#ef4444",
    "inactive_color": "#60a5fa",
    "duration_ms": 800,
    "intensity": 1
  }
}
~~~

## Trigger

### signal

Wertet einen Signalwert aus. Quellen:

- sensor;
- actuator;
- state;
- generischer key.

### event

Reagiert auf ein benanntes allgemeines Runtime-Ereignis.

### interaction

Reagiert auf HMI-Interaktionen. Der Payload kann eine element_id enthalten,
damit nur das betroffene Objekt reagiert.

### alarm

Reagiert auf Aktivierung oder Rücknahme eines Alarms.

## Bedingungen

Unterstützt werden:

- eq / neq;
- gt / gte;
- lt / lte;
- truthy / falsy;
- contains;
- between.

Numerische Vergleiche werden numerisch ausgewertet; ansonsten erfolgt eine
kontrollierte Text-/Bool-Auswertung.

## Ziele

### Vollständige Entity

Ist part_selector leer, wird die Entity-Wurzel animiert.

### SVG-Unterelement

Ist part_selector gesetzt, sucht die Runtime innerhalb der Entity. Empfohlen:

~~~text
[data-pf-state-target="temperature"]
[data-pf-state-target="flow"]
[data-pf-state-target="level"]
[data-pf-state-target="valve"]
~~~

IDs sind ebenfalls möglich, müssen bei mehreren Instanzen jedoch korrekt
präfixiert sein. Semantische data-Ziele sind deshalb robuster.

## Effekte

| Effekt | Zweck |
|---|---|
| fill | Füllfarbe wechseln |
| stroke | Konturfarbe wechseln |
| temperature | thermischen Zustand farblich darstellen |
| flow | Fluss über Strichbewegung darstellen |
| blink | Sichtbarkeit periodisch schalten |
| pulse | Größe/Deckkraft pulsieren |
| rotate | rotierende Maschine darstellen |
| level | Füllstand über Skalierung darstellen |
| opacity | Transparenz steuern |
| glow | leuchtende Hervorhebung |

Die Runtime setzt Effekte über dedizierte Klassen und CSS-Variablen. Beim
Deaktivieren werden die von der Regel gesetzten Werte entfernt.

## API der exportierten Runtime

Die HMI-Runtime stellt zusätzlich bereit:

~~~text
setSignal(ref, value)
setSignals(batch)
dispatchSvgEvent(name, payload)
getSvgEventState()
getSvgEventValidation()
~~~

Signalbatchs sind vorzuziehen, wenn mehrere Werte im selben Zyklus eintreffen.

## Editorvorschau

Die Vorschau:

- verwendet dieselbe Normalisierung wie die Runtime;
- adressiert dasselbe Entity-/Teilziel;
- hält den Effekt nur zeitlich begrenzt;
- ändert keine echte Sensor-, Aktor- oder Statequelle;
- speichert erst durch die explizite Aktion.

## Export

### Projekt

Regeln liegen in:

~~~text
project.hmi.event_animations
~~~

### SVG

Das animierbare SVG enthält einen Metadatenblock mit den normalisierten Regeln
und die benötigten Effektstile.

### Runtime-/V9-JSON

Regeln liegen in:

~~~text
hmi_ui.event_animations
~~~

Der Bericht liegt in:

~~~text
hmi_ui_report.event_animations
~~~

### SCADA-Bundle

Zusätzlich zu SVG, JSON, HTML und Signalmuster werden exportiert:

~~~text
hmi_runtime.js
svg_event_runtime.js
~~~

Beide Dateien müssen neben der exportierten HTML-Datei liegen.

## Verhältnis zu SMIL

SMIL bleibt zulässig und wird vom Sanitizer nicht pauschal entfernt. Die
V64-Event-Runtime hat jedoch andere Aufgaben:

- SMIL: autonome Zeitachse innerhalb eines SVG;
- V64 Event: fachlich ausgelöste, HMI-gekoppelte Zustandsreaktion.

Ein importiertes SMIL-SVG kann als Ganzes weiterlaufen. Für produktive
Teilsteuerung sollten seine relevanten Bereiche zusätzlich semantisch markiert
und durch V64-Regeln gesteuert werden.

## Fehlerdiagnose

Wenn eine Animation nicht reagiert:

1. Regel aktiviert?
2. element_id im aktuellen View vorhanden?
3. part_selector innerhalb der Entity gültig?
4. Signalref stimmt mit setSignal/setSignals überein?
5. Operator und Vergleichswert passend?
6. Runtime-Validierungsbericht prüfen.
7. Browserkonsole auf ungültige Selektoren prüfen.

## Sicherheitsgrenzen

- Selektoren werden in einer kontrollierten try/catch-Auswertung verwendet;
- externe SVG-Ressourcen werden beim Import entfernt;
- Event-Payloads führen keinen Code aus;
- Effektwerte werden normalisiert und begrenzt;
- SVG-Scripts oder Inline-Eventhandler sind nicht Teil des Vertrags.
