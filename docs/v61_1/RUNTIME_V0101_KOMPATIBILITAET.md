# Kompatibilität mit automation_system_v0101

## 1. Rolle der Runtime

Plant Factory V61.1 verwaltet Engineering-, HMI-, Regel-, Prozess- und
Konfigurationsmodelle. `automation_system_v0101` ist die externe
Laufzeitautorität für die tiefe Typ- und Vertragsprüfung der Automation.

Der Objektstandard PF-PID-V1 verändert keine Controller-UUIDs, V9-Schemas,
V9-Node-Shards oder V8-Cross-Shards. Geräte- und Kanalbindungen bleiben im
Projektmodell erhalten und werden weiterhin über den bestehenden
Model-Adapter exportiert.

## 2. Geprüfte Kopplung

Die mitgelieferte Runtime wurde über `AUTOMATION_RUNTIME` in den
Regelvertragstest eingebunden. Dadurch wird die lokale Vertragsprüfung um die
Runtime-Typautorität erweitert. Der Test prüft unter anderem Sensor-,
Aktuator-, Prozesszustands-, Regel- und Parameterstrukturen.

Aufruf:

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 ./test_all.sh
```

Alternativ:

```bash
PYTHONPATH=/pfad/zu/automation_system_v0101 python3 test/test_rule_contract.py
```

## 3. Abgrenzung

Die Runtime wird nicht in das Plant-Factory-Archiv eingebettet. Damit bleiben
Versionierung, Deployment, Abhängigkeiten und Sicherheitsfreigaben beider
Produkte getrennt. Plant Factory liefert den Engineering-Vertrag; die Runtime
liefert die operative Ausführung.

Eine bestandene Softwareprüfung ersetzt nicht die Punkt-zu-Punkt-Prüfung mit
realen Feldgeräten, SPS, Netzwerksegmenten und SCADA-Systemen.
