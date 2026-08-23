#!/usr/bin/env node
/** Verify PF-AUTOMATION-V9-BRIDGE canonical ownership and migration behavior. */

'use strict';

import assert from 'node:assert/strict';
import {
  AUTOMATION_CONTRACT_ID,
  AUTOMATION_CONTRACT_RELEASE,
  AUTOMATION_CONTRACT_VERSION,
  CANONICAL_RUNTIME_SECTIONS,
  automationContractSummary,
  emptyAutomationConfig,
  normalizeAutomationConfig,
  normalizeProjectAutomationModels
} from '../public/js/automation_contract.js';

let passed = 0;

function check(condition, label, detail) {
  assert.equal(Boolean(condition), true, detail ? label + ': ' + detail : label);
  passed += 1;
  console.log('   ok  ' + label);
}

function legacyRule(id, name) {
  return {
    rule_set_id: id,
    name: name,
    rules: [{ when: [], do: [] }]
  };
}

const expectedSections = ['process_states', 'filters', 'timers', 'rule_engine', 'rules'];
check(AUTOMATION_CONTRACT_ID === 'PF-AUTOMATION-V9-BRIDGE',
  'Vertragskennung ist PF-AUTOMATION-V9-BRIDGE');
check(AUTOMATION_CONTRACT_VERSION === '1.0', 'Vertragsversion ist 1.0');
check(AUTOMATION_CONTRACT_RELEASE === '63.4', 'Bridge ist auf V63.4 versioniert');
check(JSON.stringify(CANONICAL_RUNTIME_SECTIONS) === JSON.stringify(expectedSections),
  'Kanonische V9-Runtime-Sektionen sind vollständig und geordnet');

const empty = emptyAutomationConfig();
check(empty.version === 2, 'Leere Automationskonfiguration verwendet Schema 2');
check(empty.contract.id === AUTOMATION_CONTRACT_ID, 'Leere Konfiguration trägt den Bridge-Vertrag');
check(empty.contract.authority === 'v9_runtime', 'V9-Runtime bleibt die Runtime-Autorität');
check(empty.contract.project_rules_authority === 'dynamic_rule_engine',
  'Projektregeln besitzen genau eine Autorität');
check(empty.automation_rule_sets.length === 0, 'Leere Konfiguration besitzt keine aktive Legacy-Regelquelle');
check(empty.legacy_automation_rule_sets.length === 0,
  'Leere Konfiguration besitzt kein Legacy-Archiv');

const original = {
  version: 1,
  automation: [{ state_id: 1 }],
  automation_engines: [{ engine_id: 1 }],
  automation_filters: [{ filter_id: 1 }],
  automation_rule_sets: [legacyRule('legacy-a', 'A'), legacyRule('legacy-b', 'B')],
  legacy_automation_rule_sets: [legacyRule('legacy-a', 'A archived')],
  custom_extension: { retained: true }
};
const snapshot = JSON.stringify(original);
const normalized = normalizeAutomationConfig(original);
check(JSON.stringify(original) === snapshot, 'Normalisierung verändert den Eingang nicht');
check(normalized.version === 2, 'Legacy-Konfiguration wird auf Schema 2 normalisiert');
check(normalized.automation.length === 1, 'Automationseinträge bleiben erhalten');
check(normalized.automation_engines.length === 1, 'Engine-Einträge bleiben erhalten');
check(normalized.automation_filters.length === 1, 'Filter-Einträge bleiben erhalten');
check(normalized.automation_rule_sets.length === 0,
  'Aktive Legacy-Regelquelle wird vollständig deaktiviert');
check(normalized.legacy_automation_rule_sets.length === 2,
  'Legacy-Regeln werden dedupliziert archiviert');
check(normalized.legacy_automation_rule_sets[0].rule_set_id === 'legacy-a',
  'Vorhandene Archiv-Reihenfolge bleibt stabil');
check(normalized.legacy_automation_rule_sets[1].rule_set_id === 'legacy-b',
  'Neue Legacy-Regeln werden stabil ergänzt');
check(normalized.contract.legacy_rule_sets_preserved === 2,
  'Vertrag dokumentiert die Anzahl archivierter Regeln');
check(normalized.custom_extension.retained === true,
  'Unbekannte additive Erweiterungen bleiben erhalten');
check(normalized.contract.canonical_runtime_sections !== CANONICAL_RUNTIME_SECTIONS,
  'Runtime-Sektionsliste wird defensiv kopiert');

normalized.legacy_automation_rule_sets[0].name = 'changed';
check(original.legacy_automation_rule_sets[0].name === 'A archived',
  'Archivwerte werden tief kopiert');
normalized.contract.canonical_runtime_sections.push('invalid');
check(CANONICAL_RUNTIME_SECTIONS.length === 5,
  'Exportierter Runtime-Vertrag bleibt unveränderlich durch Verbraucher');

const projectInput = {
  name: 'legacy-project',
  automation_cfg: original
};
const projectNormalized = normalizeProjectAutomationModels(projectInput);
check(projectNormalized !== projectInput, 'Projektmodell wird nicht mutiert');
check(projectNormalized.processes.process_states.length === 0,
  'Fehlende Projekt-States werden kanonisch ergänzt');
check(projectNormalized.dynamic_rule_engine.rule_sets.length === 0,
  'Fehlende Projektregel-Autorität wird kanonisch ergänzt');
check(projectNormalized.free_rules.timers.length === 0,
  'Freie Timer werden kanonisch ergänzt');
check(projectNormalized.automation_cfg.automation_rule_sets.length === 0,
  'Projektmigration deaktiviert die zweite aktive Regelwahrheit');
check(projectNormalized.automation_cfg.legacy_automation_rule_sets.length === 2,
  'Projektmigration bewahrt Legacy-Regeln verlustfrei');
check(projectNormalized.name === 'legacy-project', 'Unabhängige Projektfelder bleiben erhalten');

const completeProject = {
  processes: { process_states: [{ state_id: 1 }] },
  dynamic_rule_engine: { rule_sets: [{ rule_set_id: 'project-rules' }] },
  free_rules: { version: 1, timers: [{ timer_id: 100 }], triggers: [], actions: [], transitions: [], events: [] },
  automation_cfg: emptyAutomationConfig()
};
const completeNormalized = normalizeProjectAutomationModels(completeProject);
check(completeNormalized.processes.process_states.length === 1,
  'Bestehende Projekt-States bleiben erhalten');
check(completeNormalized.dynamic_rule_engine.rule_sets.length === 1,
  'Bestehende Projektregeln bleiben erhalten');
check(completeNormalized.free_rules.timers.length === 1,
  'Bestehende freie Timer bleiben erhalten');

const summary = automationContractSummary(original);
check(summary.contract_id === AUTOMATION_CONTRACT_ID,
  'Zusammenfassung nennt die Bridge-Autorität');
check(summary.release === '63.4', 'Zusammenfassung nennt V63.4');
check(summary.authority === 'v9_runtime', 'Zusammenfassung nennt die Runtime-Autorität');
check(summary.project_rules_authority === 'dynamic_rule_engine',
  'Zusammenfassung nennt die Projektregel-Autorität');
check(summary.legacy_rule_sets_preserved === 2,
  'Zusammenfassung nennt archivierte Legacy-Regeln');
check(summary.duplicate_active_rule_sets === 0,
  'Zusammenfassung bestätigt null konkurrierende Regelquellen');

console.log('PF-AUTOMATION-V9-BRIDGE: ' + passed + '/' + passed + ' checks passed.');
