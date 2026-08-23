/**
 * automation_contract.js - PF-AUTOMATION-V9-BRIDGE normalization.
 *
 * The project keeps one editable project-rule model and one canonical V9
 * runtime projection. Deprecated automation_rule_sets are retained as
 * read-only legacy payload and are never exported as a second active truth.
 */

'use strict';

export const AUTOMATION_CONTRACT_ID = 'PF-AUTOMATION-V9-BRIDGE';
export const AUTOMATION_CONTRACT_VERSION = '1.0';
export const AUTOMATION_CONTRACT_RELEASE = '63.4';
export const CANONICAL_RUNTIME_SECTIONS = [
  'process_states',
  'filters',
  'timers',
  'rule_engine',
  'rules'
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function legacyRuleIdentity(value, index) {
  if (!isObject(value)) return 'value:' + String(index) + ':' + JSON.stringify(value);
  const candidates = ['rule_set_id', 'rule_id', 'id', 'name', 'title'];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const key = candidates[candidateIndex];
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim()) {
      return key + ':' + String(value[key]);
    }
  }
  return 'json:' + JSON.stringify(value);
}

function mergeLegacyRuleSets(archivedValue, activeValue) {
  const merged = [];
  const seen = new Set();
  const append = function (item, index) {
    const identity = legacyRuleIdentity(item, index);
    if (seen.has(identity)) return;
    seen.add(identity);
    merged.push(cloneValue(item));
  };
  asArray(archivedValue).forEach(append);
  asArray(activeValue).forEach(append);
  return merged;
}

export function emptyAutomationConfig() {
  return {
    version: 2,
    contract: {
      id: AUTOMATION_CONTRACT_ID,
      version: AUTOMATION_CONTRACT_VERSION,
      release: AUTOMATION_CONTRACT_RELEASE,
      authority: 'v9_runtime',
      project_rules_authority: 'dynamic_rule_engine',
      canonical_runtime_sections: CANONICAL_RUNTIME_SECTIONS.slice(),
      legacy_rule_sets_preserved: 0
    },
    automation: [],
    automation_engines: [],
    automation_filters: [],
    automation_rule_sets: [],
    legacy_automation_rule_sets: []
  };
}

export function normalizeAutomationConfig(value) {
  const source = isObject(value) ? cloneValue(value) : {};
  const out = Object.assign(emptyAutomationConfig(), source);
  const activeLegacyRules = asArray(source.automation_rule_sets);
  const archivedRules = asArray(source.legacy_automation_rule_sets);
  const preservedRules = mergeLegacyRuleSets(archivedRules, activeLegacyRules);

  out.version = 2;
  out.automation = asArray(source.automation);
  out.automation_engines = asArray(source.automation_engines);
  out.automation_filters = asArray(source.automation_filters);
  out.automation_rule_sets = [];
  out.legacy_automation_rule_sets = cloneValue(preservedRules);
  out.contract = Object.assign({}, isObject(source.contract) ? source.contract : {}, {
    id: AUTOMATION_CONTRACT_ID,
    version: AUTOMATION_CONTRACT_VERSION,
    release: AUTOMATION_CONTRACT_RELEASE,
    authority: 'v9_runtime',
    project_rules_authority: 'dynamic_rule_engine',
    canonical_runtime_sections: CANONICAL_RUNTIME_SECTIONS.slice(),
    legacy_rule_sets_preserved: preservedRules.length
  });
  return out;
}

export function normalizeProjectAutomationModels(projectValue) {
  const project = isObject(projectValue) ? cloneValue(projectValue) : {};
  project.processes = isObject(project.processes)
    ? project.processes
    : { process_states: [] };
  project.dynamic_rule_engine = isObject(project.dynamic_rule_engine)
    ? project.dynamic_rule_engine
    : { rule_sets: [] };
  project.free_rules = isObject(project.free_rules)
    ? project.free_rules
    : { version: 1, timers: [], triggers: [], actions: [], transitions: [], events: [] };
  project.automation_cfg = normalizeAutomationConfig(project.automation_cfg);
  return project;
}

export function automationContractSummary(value) {
  const normalized = normalizeAutomationConfig(value);
  return {
    contract_id: normalized.contract.id,
    release: normalized.contract.release,
    authority: normalized.contract.authority,
    project_rules_authority: normalized.contract.project_rules_authority,
    canonical_runtime_sections: normalized.contract.canonical_runtime_sections.slice(),
    legacy_rule_sets_preserved: normalized.legacy_automation_rule_sets.length,
    duplicate_active_rule_sets: normalized.automation_rule_sets.length
  };
}
