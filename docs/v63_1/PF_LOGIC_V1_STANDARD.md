# PF-LOGIC-V1 — normativer Schaltlogikstandard

## 1. Geltungsbereich

PF-LOGIC-V1 definiert das kanonische Modell, die Editorsemantik und die
Validierungsregeln für additive Function-Block-Diagramme der Plant Factory.
Der Standard beschreibt ausführbare Logik, nicht SVG-Geometrie, HMI-Layout oder
physische Hardwareprojektierung.

## 2. Eine Quelle der Wahrheit

Die einzige editierbare Quelle ist:

```text
project.logic
```

Sie enthält `diagrams`, `nodes`, `edges`, `target_ownership` und
Modelleinstellungen. Zielartefakte sind abgeleitet und dürfen nicht zurück in
den Graphen importiert werden, ohne erneut normalisiert und validiert zu werden.

## 3. Schaltpläne

Jeder Schaltplan besitzt eine stabile `diagram_id`, Name, Beschreibung,
Aktivstatus, Zielprofil und Ausführungskontext. Der Ausführungskontext umfasst
mindestens Scope, Owner-Node, Rule-Engine und Priorität.

Zulässige Scopes:

- `node_local`;
- `cross_controller`;
- `cross_worker`.

## 4. Bausteine und Typen

Die verbindliche Bibliothek liegt in
`config/logic_block_library_v1.json`. Unterstützte Datentypen sind:

```text
BOOL INT DINT REAL TIME STRING ENUM ANY NUMERIC
```

Portverbindungen sind gerichtet. Ein Eingangsport akzeptiert standardmäßig nur
eine Quelle. Implizite, deterministische numerische Erweiterungen sind
`INT → DINT`, `INT → REAL` und `DINT → REAL`. `REAL → BOOL` oder `TIME → INT`
sind unzulässig.

## 5. Signalreferenzen

Signale werden über stabile logische Pfade referenziert. Beispiele:

```text
v9.sensor.<controller_uuid>.<sensor_id>.value
v9.actuator.<controller_uuid>.<actuator_id>.command
v9.state.<state_id>.value_id
v9.state.<state_id>.parameters.<parameter>
v9.timer.<timer_id>.<field>
hmi.widget.<widget_id>.value
plant.entity.<entity_id>.<field>
```

Eine Signalreferenz ersetzt keine physische Feldbusadresse. Diese wird am
besitzenden Runtime-Node aufgelöst.

## 6. Validierung

Ein Graph ist nur exportierbar, wenn:

- alle Blocktypen bekannt sind;
- Node- und Edge-IDs eindeutig sind;
- referenzierte Nodes und Ports existieren;
- Richtung und Datentyp kompatibel sind;
- erforderliche Bindings vorhanden sind;
- der kombinatorische Graph zyklenfrei ist;
- die maximale DNF-Komplexität nicht überschritten wird;
- keine widersprüchlichen Writer existieren.

Zustandsbehaftete Blöcke speichern ihren Zustand außerhalb des Projektmodells im
Runtime-State des jeweiligen Ausführungszyklus.

## 7. Ownership

`direct`, `logic` und `hybrid` sind die einzigen zulässigen Ownership-Modi.
Mehrere Writer sind nur bei explizitem `hybrid` erlaubt. Arbitration erfolgt
nach absteigender Priorität und anschließend stabil nach Diagramm- und Node-ID.

## 8. UI-Vertrag

Der Logic-Workspace ist getrennt vom P&ID-Canvas. Das Inventar besitzt die
Bereiche Schaltpläne, Bausteine und Signale. Der Inspector trennt Details,
Binding, Ziel und Diagnose. Kontextmenüs sind additiv und modalitätsfrei;
Konfigurations- und Exportfenster folgen PF-MODAL-V1.

## 9. Kompatibilität

Ein Projekt ohne Logic-Sektion wird als leeres, gültiges Modell normalisiert.
Legacy-Objekte, Custom-SVGs, HMI, Animationen, Runtime-Bindings und bestehende
Regeln werden dabei nicht verändert.
