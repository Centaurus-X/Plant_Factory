# Universeller Runtime-Kompatibilitätsvertrag

## Architektur

```text
Kanonisches Plant-Factory-Projekt
  ├─ Plant/P&ID
  ├─ HMI
  ├─ Process States / Rule Engine
  └─ project.logic
          ├─ Universal Runtime JSON
          ├─ Automation_System V9 + V8 Cross
          └─ Siemens SCL + Tag CSV
```

## Universal JSON

`*.logic.runtime.json` enthält den vollständigen normalisierten Graphen,
Signalbestand, Ausführungspläne und Validierungsbericht. Der mitgelieferte
funktionale Evaluator unterstützt Boolesche Logik, Vergleiche, Mathematik,
TON/TOF/TP, CTU/CTD und alle Runtime-Aktionen.

## Automation_System

Der Adapter bildet Laufzeit-Snapshots auf kanonische Signalpfade und Aktionen
auf vier Kanäle ab:

- `rule_engine` für Process-State- und Notify-Aktionen;
- `fieldbus` für lokale Aktorkommandos;
- `hmi` für Widget-Updates;
- `signal_bus` für interne Signale.

Native V9-Regeln und Bridge-Laufzeit können gleichzeitig eingesetzt werden,
solange Ownership und Zielkonflikte eindeutig sind.

## V8 Cross

Cross-Nachrichten enthalten nur logische Identität und grobe Site-/Node-Route.
Physische Felder `host`, `port`, `unit` und `address` werden vor dem Transport
entfernt. Der Owner-Node löst sie aus seinem lokalen V9-Shard auf.

## Siemens SCL

Der Compiler erzeugt Funktionsbausteine pro aktivem Diagramm und ein CSV mit
PLC-Tags. IEC-Timer und -Zähler werden nativ instanziiert. Die CSV ist die
explizite Grenze zwischen kanonischem Signalpfad und projektspezifischem PLC-Tag.

## Fail-closed-Regeln

- Typfehler oder Zyklen verhindern den Export.
- Nicht verlustfrei native V9-Blöcke werden als Bridge ausgewiesen.
- Widersprüchliche Writer verhindern den Export.
- Cross-Ausgaben mit physischen Koordinaten werden abgelehnt.
- Division durch null und ungültige Laufzeitzustände erzeugen Diagnosen statt
  stiller Ersatzwerte.
