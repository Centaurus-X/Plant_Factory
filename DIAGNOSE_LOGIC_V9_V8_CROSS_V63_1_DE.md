# Diagnose: PF-LOGIC-V1, V9 Node-Shards und V8 Cross in V63.1

## Ziel

Die Schaltlogik soll optional und additiv sein, darf aber keine zweite Wahrheit
neben der klassischen Anlagen-, HMI- oder Runtime-Konfiguration erzeugen. Die
Diagnose bewertet deshalb Identität, Datenmodell, Ownership, Übersetzbarkeit
und Cross-Node-Grenzen getrennt.

## Analyse der bereitgestellten V9-Node-Konfiguration

Die als Runtime-Referenz aufgenommene Datei besitzt exakt 26 Sektionen und ist
als `version: 9`, `schema: device_state_norm`, `scope: node_local` und
`node_id: fn-01` deklariert. Sie enthält:

- vier WAGO-/Modbus-Controller mit stabilen `controller_uuid`;
- zehn Sensoren und elf Aktoren;
- acht `process_states`;
- fünf Timer;
- eine `rule_engine` und vier Regeln;
- PID-, Scaling-, Prozess-, Mapping- und Control-Method-Tabellen.

Die fachlich relevante Identität ist nicht die flüchtige Busadresse, sondern
`controller_uuid + sensor_id` beziehungsweise
`controller_uuid + actuator_id`. PF-LOGIC-V1 verwendet genau daraus erzeugte
Signalreferenzen. Ein Graph bleibt deshalb stabil, wenn lokale Controller-
Routen oder physische Netzwerkparameter neu provisioniert werden.

`process_states` bilden den zentralen Übergang zwischen Prozessmodell und
ausführbarer Aktion. Der Graph bindet beispielsweise
`v9.state.<id>.value_id` oder `v9.state.<id>.parameters.<name>`, ohne den State
zu duplizieren. Die vorhandene `rule_engine` beschränkt schreibbare Felder auf
den bestehenden Runtime-Vertrag. Der V9-Compiler erzeugt deshalb nur gültige
`rules`-Aktionen und erweitert die Konfiguration nicht um eine fremde
`logic_graph`-Sektion.

## Analyse des V8-Cross-Shards

Der vorhandene Cross-Shard ist `version: 8`, `scope: cross`. Er enthält keine
lokale Node-Projektion und keine physischen Controller-Endpunkte. Controller
werden ausschließlich mit logischer Identität und Owner-Node transportiert.
Host, Port, Unit, Bus-Typ und Feldbusadresse sind im Cross-Transport verboten.

PF-LOGIC-V1 hält diese Grenze ein:

1. Node-lokale Regeln werden in den jeweiligen V9-Node-Shard kompiliert.
2. Cross-Worker-Regeln werden getrennt an den V8-Cross-Compiler übergeben.
3. Direkte Feldbuskommandos werden vor Cross-Transport auf logische Identität
   reduziert.
4. Erst der besitzende Node löst die lokale Route und physische Adresse auf.

## Übersetzungsstrategie

### Nativ nach V9

Nativ übersetzbar sind Sensor-/State-Bedingungen, boolesche Kombinationen, die
verlustfrei als begrenzte disjunktive Normalform dargestellt werden können,
State-Write und Notify. Die Regeln erhalten eine eindeutige
`[PF-LOGIC:<diagram>:<node>]`-Kennzeichnung und ersetzen beim erneuten Export
ihre eigene vorherige Ableitung statt sie zu duplizieren.

### Universeller Bridge-Layer

Timer, Zähler, numerische Pipelines, berechnete State-Parameter, direkte
Aktoraktionen, HMI-Schreibzugriffe und interne Signalbus-Ausgänge benötigen
Zustand oder Semantik, die der flache V9-Regelvertrag nicht vollständig besitzt.
Sie werden nicht still vereinfacht, sondern im Bericht als Bridge-Bausteine
markiert und über `runtime_compat` ausgeführt.

### Siemens SCL

Für PLC-Ziele wird derselbe Graph nach SCL übersetzt. Kanonische Signalpfade
werden über ein separates Tag-Mapping gebunden. Hardwareadressen bleiben damit
außerhalb des Graphen und können projektspezifisch in TIA Portal zugeordnet
werden.

## Konsistenz und Ownership

Jedes beschreibbare Ziel erhält einen Ownership-Modus:

- `direct`: bestehende klassische Runtime-/Inspector-Konfiguration steuert;
- `logic`: ausschließlich der Logic-Graph steuert;
- `hybrid`: HMI/manuelle und Logikpfade sind bewusst kombiniert.

Ein nicht deklarierter zweiter Writer führt zu einem Compilerfehler. Im
Hybridmodus gewinnt deterministisch die höchste Priorität; bei gleicher
Priorität entscheiden Diagramm- und Node-ID stabil. Damit ist die Arbitration
reproduzierbar und auditierbar.

## Ergebnis

Die Integration ist additiv und kompatibel, weil der Logikgraph keine
bestehenden Runtimeobjekte kopiert und die strikten V9-/V8-Sektionen unverändert
lässt. Native Teile werden kompiliert, erweiterte Teile laufen über einen
expliziten universellen Layer. Ein bestehendes Projekt ohne `project.logic`
erhält beim Laden lediglich ein leeres gültiges PF-LOGIC-V1-Modell.
