# PF-AUTOMATION-V9-BRIDGE

## Ziel

Der Vertrag verhindert konkurrierende Konfigurationswahrheiten zwischen
Projekteditor, grafischer Schaltlogik und Automation_System V9.

## Autoritäten

| Fachbereich | Kanonischer Pfad | Rolle |
|---|---|---|
| Projekt-States | `project.processes.process_states` | editierbar |
| Projektregeln | `project.dynamic_rule_engine.rule_sets` | editierbar |
| Schaltlogik | `project.logic` | optional editierbar |
| Runtime-States | V9 `process_states` | Runtime-Projektion |
| Filter | V9 `filters` | Runtime-Projektion |
| Timer | V9 `timers` | Runtime-Projektion |
| Rule Engine | V9 `rule_engine` | Runtime-Konfiguration |
| Runtime-Regeln | V9 `rules` | Runtime-Projektion |

## Legacy-Migration

Alte `automation_rule_sets` werden in
`automation_cfg.legacy_automation_rule_sets` archiviert. Die Migration ist:

- nicht-destruktiv;
- deduplizierend;
- idempotent;
- unabhängig von der Runtime-Projektion;
- ohne aktive zweite Regelquelle.

## UI-Vertrag

Die Automation-Oberfläche bietet nur noch eindeutige Einstiege:

- Projekt-States;
- Projektregeln;
- Runtime-States V9;
- Runtime-Regeln V9;
- Parameter-Schemas;
- Runtime-Hilfen.

Historische Regeln können ausschließlich zur Diagnose gelesen werden.
