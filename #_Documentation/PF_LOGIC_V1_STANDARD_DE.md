# PF-LOGIC-V1 in Plant Factory V63.1

PF-LOGIC-V1 ist seit V63.1 der verbindliche Standard für optionale grafische
Schaltlogik. Die kanonische Quelle ist `project.logic`; P&ID, HMI und Runtime
bleiben getrennte Sichten auf dasselbe Projektmodell.

Verbindliche Detaildokumente:

- `docs/v63_1/PF_LOGIC_V1_STANDARD.md`
- `docs/v63_1/UNIVERSAL_RUNTIME_COMPATIBILITY.md`
- `docs/v63_1/MIGRATION_UND_SINGLE_SOURCE_OF_TRUTH.md`
- `docs/v63_1/TEST_UND_FREIGABE.md`
- `config/logic_block_library_v1.json`
- `config/logic_compatibility_profiles_v1.json`

Neue Logik darf bestehende Entities, Process States oder Hardwareobjekte nicht
kopieren. Sie bindet diese ausschließlich über stabile Signalreferenzen.
