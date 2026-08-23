# PF-LOGIC-V1 Runtime-Kompatibilität

Dieses Paket ist der funktionale, universelle Kompatibilitäts-Layer zwischen dem kanonischen Plant-Factory-Projektmodell und externen Laufzeiten.

- `plant_logic_runtime.py` wertet den vollständigen additiven Logic-Graphen einschließlich TON, TOF, TP, CTU, CTD, Vergleichen, Mathematik und Aktionen deterministisch aus.
- `automation_system_adapter.py` bildet Signale und Aktionen auf `process_states`, `rule_engine`, Feldbusbefehle, HMI-Updates und den internen Signalbus ab.
- Das strikte V9-/V8-JSON wird **nicht** um fremde Sektionen erweitert. Native kombinatorische Logik wird beim Export als V9-Regeln kompiliert; zustandsbehaftete oder erweiterte Blöcke laufen über diesen Bridge-Layer.
- Cross-Worker-Nachrichten verwenden ausschließlich logische Identitäten. Physische Feldbuskoordinaten werden erst am besitzenden Node aufgelöst.

Minimaler Zyklus:

```python
from runtime_compat import execute_cycle

result = execute_cycle(
    logic_payload=logic_runtime_json,
    config_value=device_state_v9,
    sensor_values={"<controller_uuid>:1": 550.0},
    state_values={1: {"value_id": 2}},
    runtime_state=previous_logic_state,
    now_ms=1000,
)
```

Der Aufrufer speichert `result["runtime_state"]` bis zum nächsten Zyklus und führt die ausgewählten `native_rule_actions`, `fieldbus_commands`, `hmi_updates` und `signal_updates` über die jeweilige Laufzeit aus.
