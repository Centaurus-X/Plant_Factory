/**
 * v9_json_format.js — kanonisches Lesbarkeitsformat für V9/V8-Configs.
 *
 * Portierung von `automation_system_v0101/src/library/_json_formator.py`
 * (FORMATTER_VERSION 3.0.0) nach JavaScript. Der Editor schreibt damit exakt
 * dasselbe Format wie die Runtime:
 *
 *   * Sektionen in domänenorientierter Reihenfolge (TOP_LEVEL_ORDER)
 *   * Identitätsfelder zuerst, parameters/description zuletzt
 *   * Datensatz-Arrays: EIN kompaktes Objekt pro Zeile
 *   * Leerzeilen als Gliederung zwischen Sektionsgruppen (TOP_SPACING)
 *   * idempotent: gleiche Eingabe -> byte-gleiche Ausgabe
 *
 * Wichtig: Die Schlüsselreihenfolge ist fingerprint-neutral. `canonical_bytes`
 * der Runtime sortiert die Schlüssel vor dem Hashen — Lesbarkeit kostet hier
 * also keine Identität.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { ensureArray, isPlainObject, toText } from './shared_utils.js';

/** Domänenorientierte Sektionsreihenfolge (_json_formator.py:TOP_LEVEL_ORDER). */
export const TOP_LEVEL_ORDER = Object.freeze([
  'meta', 'sites', 'nodes', 'local_node', 'site_controller_map',
  'controllers', 'virtual_controllers', 'modbus_functions', 'scaling_profiles',
  'sensor_types', 'actuator_types', 'sensors', 'actuators',
  'process_modes', 'process_values', 'parameter_generic_templates',
  'schema_mappings', 'pid_configs', 'control_method_templates',
  'control_methods', 'processes', 'process_states', 'filters', 'timers',
  'rule_engine', 'rules'
]);

/** Leerzeilen VOR der jeweiligen Sektion (_json_formator.py:DEFAULT_TOP_SPACING). */
export const TOP_SPACING = Object.freeze({
  sites: 1,
  controllers: 1,
  sensors: 1,
  process_modes: 1,
  processes: 1,
  process_states: 2,
  filters: 1,
  timers: 1,
  rule_engine: 1,
  rules: 1,
  control_method_templates: 1,
  control_methods: 1
});

/** Feldreihenfolge je Sektion (_json_formator.py:FIELD_ORDER_BY_PATH). */
export const FIELD_ORDER_BY_SECTION = Object.freeze({
  meta: ['version', 'schema', 'scope', 'node_id', 'owner_node_id', 'domain_id',
    'cross_domain_id', 'global_revision', 'scope_revision', 'local_config_revision',
    'fingerprint', 'description'],
  sites: ['site_id', 'site_name', 'enabled', 'description'],
  nodes: ['node_id', 'site_id', 'node_role', 'enabled', 'description'],
  local_node: ['node_id', 'site_id', 'active_controller_uuids', 'active_controller_routes'],
  site_controller_map: ['local_controller_id', 'node_id', 'site_id', 'controller_uuid',
    'controller_key', 'route_key', 'routing_role', 'enabled', 'description'],
  controllers: ['controller_id', 'local_controller_id', 'node_id', 'site_id',
    'owner_node_id', 'controller_uuid', 'controller_key', 'device_name', 'enabled',
    'bus_type', 'host', 'port', 'unit', 'comm', 'tags', 'description'],
  virtual_controllers: ['virt_controller_id', 'controller_id', 'controller_uuid',
    'device_name', 'virt_active', 'host', 'port', 'description'],
  modbus_functions: ['modbus_function_id', 'module_type', 'modbus_function_type',
    'description'],
  scaling_profiles: ['profile_id', 'name', 'unit', 'raw_min', 'raw_max',
    'eng_min', 'eng_max', 'description'],
  sensor_types: ['sensor_types_id', 'sensor_type', 'description'],
  actuator_types: ['actuator_types_id', 'actuator_type', 'description'],
  sensors: ['local_controller_id', 'sensor_id', 'profile_id', 'sensor_types_id',
    'node_id', 'site_id', 'controller_uuid', 'controller_key', 'enabled',
    'sensor_group', 'address', 'bus_type', 'function_type', 'rows', 'parameters',
    'tags', 'description'],
  actuators: ['local_controller_id', 'actuator_id', 'profile_id', 'actuator_types_id',
    'node_id', 'site_id', 'controller_uuid', 'controller_key', 'enabled',
    'actuator_group', 'address', 'bus_type', 'function_type', 'rows', 'parameters',
    'tags', 'description'],
  process_modes: ['mode_id', 'mode', 'description'],
  process_values: ['value_id', 'state_value', 'description'],
  parameter_generic_templates: ['schema_id', 'state_type', 'fields', 'constraints',
    'description'],
  schema_mappings: ['mapping_id', 'schema_id', 'description'],
  pid_configs: ['pid_config_id', 'pid_parameters', 'description'],
  control_method_templates: ['template_id', 'template_name', 'type', 'expr_id',
    'parameters', 'template_description', 'description'],
  control_methods: ['method_id', 'template_id', 'type', 'args', 'parameters',
    'description'],
  processes: ['p_id', 'owner_node_id', 'execution_epoch', 'process_name',
    'process_location', 'enabled', 'parameters', 'description'],
  process_states: ['state_id', 'p_id', 'value_id', 'mode_id', 'mapping_id',
    'owner_node_id', 'execution_epoch', 'enabled', 'io_refs', 'control_strategy',
    'setpoint_source', 'parameters', 'tags', 'description'],
  filters: ['filter_id', 'sensor_refs', 'enabled', 'chain', 'parameters', 'description'],
  timers: ['timer_id', 'enabled', 'duration_s', 'interval_s', 'at', 'cron',
    'parameters', 'description'],
  rule_engine: ['engine_id', 'required_mode_id', 'enabled', 'writable_fields',
    'sp_tolerance', 'defaults', 'runtime', 'safety', 'parameters', 'debug', 'description'],
  rules: ['rule_id', 'engine_id', 'owner_node_id', 'execution_owner', 'execution_scope',
    'execution_epoch', 'deployment_status', 'activation_state', 'group', 'priority',
    'name', 'enabled', 'when', 'until', 'do', 'else_do', 'latch', 'disabled_reason',
    'parameters', 'tags', 'description']
});

/** Feldreihenfolge in Unterobjekten (_json_formator.py:FIELD_ORDER_BY_PARENT_KEY). */
export const FIELD_ORDER_BY_PARENT = Object.freeze({
  active_controller_routes: ['local_controller_id', 'node_id', 'site_id',
    'controller_uuid', 'controller_key', 'route_key', 'routing_role', 'enabled',
    'description'],
  io_refs: ['sensors', 'actuators'],
  sensor_refs: ['sensor_id', 'filter_id', 'profile_id', 'controller_uuid', 'node_id',
    'site_id', 'parameters', 'description'],
  sensors: ['sensor_id', 'filter_id', 'profile_id', 'controller_uuid', 'node_id',
    'site_id', 'parameters', 'description'],
  actuators: ['actuator_id', 'profile_id', 'controller_uuid', 'node_id', 'site_id',
    'parameters', 'description'],
  control_strategy: ['pid_config_id', 'method_id', 'template_id', 'type', 'sample_time',
    'dt_max_s', 'out_min', 'out_max', 'error_scale', 'anti_windup', 'parameters',
    'description'],
  pid_parameters: ['kp', 'ki', 'kd'],
  when: ['state_id', 'sensor_id', 'actuator_id', 'timer_id', 'filter_id',
    'controller_uuid', 'src', 'field', 'op', 'value', 'cooldown_s', 'parameters',
    'description'],
  until: ['state_id', 'sensor_id', 'actuator_id', 'timer_id', 'filter_id',
    'controller_uuid', 'src', 'field', 'op', 'value', 'cooldown_s', 'parameters',
    'description'],
  do: ['state_ids', 'p_ids', 'value_id', 'actuator_id', 'controller_uuid',
    'parameters', 'notify', 'description'],
  else_do: ['state_ids', 'p_ids', 'value_id', 'actuator_id', 'controller_uuid',
    'parameters', 'notify', 'description'],
  runtime: ['threading', 'tick_ms', 'snapshot_isolation', 'identity_model',
    'routing_model', 'remote_signal_refs', 'max_signal_age_s', 'cross_scope_exec',
    'cross_worker_exec', 'coordinator_min_priority', 'parameters', 'description'],
  safety: ['max_output_delta_per_step', 'on_missing_sensor', 'on_invalid_pid',
    'parameters', 'description'],
  defaults: ['eval', 'exec', 'priority'],
  debug: ['control', 'pid', 'pid_state_ids', 'pid_interval_s',
    'pid_saturation_interval_s', 'log', 'parameters', 'description'],
  on_missing_sensor: ['value_id', 'mode_id', 'parameters', 'description'],
  on_invalid_pid: ['value_id', 'mode_id', 'parameters', 'description']
});

/* -------------------------------------------------------------------------
 * Generische Fallback-Reihenfolge (_json_formator.py:_generic_field_sort_key)
 *
 * Schlüssel ohne Eintrag in den Tabellen oben (freie Maps wie `parameters`,
 * `args`, `value`) werden NICHT alphabetisch sortiert, sondern nach fachlicher
 * Kategorie: IDs zuerst, Identitäten, Status, Referenzen, Logik, dann alles
 * Übrige, zuletzt parameters/tags/description.
 * ---------------------------------------------------------------------- */

const IDENTITY_KEYS = new Set(['controller_uuid', 'message_id', 'operation_id',
  'entity_key', 'route_key', 'node_id', 'site_id', 'owner_node_id',
  'execution_owner', 'execution_scope', 'domain_id', 'fingerprint']);

const STATUS_KEYS = new Set(['enabled', 'active', 'activation_state',
  'deployment_status', 'routing_role', 'node_role', 'scope', 'type', 'mode',
  'state_value', 'name', 'controller_key', 'device_name']);

const LOGIC_KEYS = new Set(['when', 'until', 'do', 'else_do', 'io_refs', 'control_strategy']);
const PARAM_KEYS = new Set(['parameters', 'args']);
const ANNEX_KEYS = new Set(['debug', 'log', 'tags', 'metadata']);
const NOTE_KEYS = new Set(['description', 'template_description', 'comment',
  'comments', 'note', 'notes']);

function fieldCategory(key) {
  const text = String(key).trim().toLowerCase();
  if (text === 'id' || text.endsWith('_id') || text.endsWith('_ids')) return 10;
  if (text.endsWith('_uuid') || IDENTITY_KEYS.has(text)) return 20;
  if (STATUS_KEYS.has(text)) return 30;
  if (text.endsWith('_ref') || text.endsWith('_refs')) return 50;
  if (LOGIC_KEYS.has(text)) return 55;
  if (PARAM_KEYS.has(text)) return 80;
  if (ANNEX_KEYS.has(text)) return 90;
  if (NOTE_KEYS.has(text)) return 100;
  return 40;
}

/** Vergleich nach (Kategorie, lowercase, Original) — wie das Python-Tupel. */
function compareGenericKeys(left, right) {
  const catLeft = fieldCategory(left);
  const catRight = fieldCategory(right);
  if (catLeft !== catRight) return catLeft - catRight;
  const lowLeft = String(left).toLowerCase();
  const lowRight = String(right).toLowerCase();
  if (lowLeft !== lowRight) return lowLeft < lowRight ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/* -------------------------------------------------------------------------
 * Zahlenliterale — Float vs. Int
 *
 * JavaScript kennt genau EINEN Zahlentyp. `JSON.stringify(1000.0)` liefert
 * `1000`, die Runtime schreibt aber `1000.0`. Ohne Gegenmaßnahme weicht jede
 * im Editor gespeicherte Datei vom Runtime-Original ab — optisch UND im
 * Fingerprint (`canonical_bytes` unterscheidet 1000 von 1000.0).
 *
 * Zweistufige Lösung, spiegelbildlich zu `_tools/canonicalize_v9_config.py`:
 *
 *   Stufe 1 — Vertragstabelle: Felder, die der V9-Vertrag an FESTER Position
 *             als Gleitkommazahl führt, werden immer mit `.0` gerendert.
 *   Stufe 2 — Literalgedächtnis: freie Maps (`args`, `parameters`, `value`)
 *             lassen sich nicht per Typtabelle klären. `collectFloatLiterals()`
 *             liest die Schreibweise beim Laden aus dem ROHTEXT und reicht sie
 *             als Hinweismenge weiter. Was unverändert bleibt, bleibt gleich
 *             geschrieben.
 * ---------------------------------------------------------------------- */

/** Vertraglich als Gleitkommazahl geführte Felder (canonicalize_v9_config.FLOAT_PATHS). */
export const FLOAT_PATHS = Object.freeze([
  'scaling_profiles.eng_min',
  'scaling_profiles.eng_max',
  'pid_configs.pid_parameters.*',
  'process_states.control_strategy.out_min',
  'process_states.control_strategy.out_max',
  'process_states.control_strategy.sample_time',
  'process_states.control_strategy.error_scale',
  'process_states.control_strategy.dt_max_s',
  'rule_engine.sp_tolerance',
  'rule_engine.runtime.max_signal_age_s',
  'rule_engine.safety.max_output_delta_per_step',
  'rule_engine.debug.pid_interval_s',
  'rule_engine.debug.pid_saturation_interval_s',
  'filters.chain.alpha',
  'rules.when.cooldown_s',
  'rules.until.cooldown_s'
]);

/** Vertraglich als Ganzzahl geführte Felder — schlägt Literalgedächtnis. */
export const INT_PATHS = Object.freeze([
  'scaling_profiles.profile_id', 'scaling_profiles.raw_min', 'scaling_profiles.raw_max',
  'controllers.controller_id', 'controllers.port',
  'virtual_controllers.virt_controller_id', 'virtual_controllers.port',
  'site_controller_map.local_controller_id',
  'sensors.sensor_id', 'sensors.local_controller_id', 'sensors.profile_id',
  'actuators.actuator_id', 'actuators.local_controller_id', 'actuators.profile_id',
  'processes.p_id', 'process_values.value_id', 'process_modes.mode_id',
  'process_states.state_id', 'process_states.p_id', 'process_states.value_id',
  'process_states.mode_id', 'process_states.mapping_id',
  'process_states.control_strategy.pid_config_id', 'process_states.control_strategy.method_id',
  'parameter_generic_templates.schema_id',
  'schema_mappings.mapping_id', 'schema_mappings.schema_id',
  'pid_configs.pid_config_id',
  'control_method_templates.template_id',
  'control_methods.method_id', 'control_methods.template_id',
  'rule_engine.engine_id', 'rule_engine.required_mode_id',
  'rule_engine.runtime.tick_ms', 'rule_engine.runtime.coordinator_min_priority',
  'filters.filter_id', 'filters.chain.window',
  'timers.timer_id',
  'rules.rule_id', 'rules.engine_id', 'rules.priority', 'rules.execution_epoch',
  'rules.when.state_id', 'rules.when.sensor_id', 'rules.when.timer_id', 'rules.when.filter_id',
  'rules.until.state_id', 'rules.until.sensor_id', 'rules.until.timer_id',
  'rules.until.filter_id',
  'meta.version'
]);

const FLOAT_PATH_SET = new Set(FLOAT_PATHS);
const INT_PATH_SET = new Set(INT_PATHS);

/** Entfernt Array-Indizes: `["rules",3,"when",0,"cooldown_s"] -> "rules.when.cooldown_s"`. */
function schemaPath(parts) {
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (typeof parts[i] !== 'number') out.push(parts[i]);
  }
  return out.join('.');
}

/** Behält Indizes: `["control_methods",5,"args","period_s"]`. */
function literalPath(parts) {
  return parts.join('.');
}

function matchesPathSet(set, path) {
  if (set.has(path)) return true;
  const cut = path.lastIndexOf('.');
  return cut > 0 && set.has(path.slice(0, cut) + '.*');
}

/* --- Rohliteral-Marker ------------------------------------------------- */

const RAW_LITERAL = Symbol('v9RawLiteral');

function rawLiteral(text) {
  const box = {};
  box[RAW_LITERAL] = text;
  return box;
}

function isRawLiteral(value) {
  return value !== null && typeof value === 'object' && RAW_LITERAL in value;
}

/** Rendert eine Zahl als Gleitkommaliteral — `20` -> `20.0`, `0.5` -> `0.5`. */
function floatLiteral(value) {
  if (!Number.isFinite(value)) return JSON.stringify(value);
  const text = String(value);
  return /[.eE]/.test(text) ? text : text + '.0';
}

/**
 * Liest aus dem ROHTEXT einer JSON-Datei, welche Zahlen als Gleitkomma
 * geschrieben waren. Rückgabe: Menge indizierter Pfade
 * (`"control_methods.5.args.period_s"`). Reiner Scanner, keine Zuweisung an
 * globalen Zustand — damit auch für Worker/Nebenläufigkeit unbedenklich.
 */
export function collectFloatLiterals(text) {
  const hints = new Set();
  const source = toText(text);
  let pos = 0;

  function skipSpace() {
    while (pos < source.length && /\s/.test(source[pos])) pos += 1;
  }

  function readString() {
    let out = '';
    pos += 1;
    while (pos < source.length) {
      const ch = source[pos];
      if (ch === '\\') {
        const next = source[pos + 1];
        if (next === 'u') {
          out += String.fromCharCode(parseInt(source.slice(pos + 2, pos + 6), 16));
          pos += 6;
        } else {
          const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
          out += map[next] === undefined ? next : map[next];
          pos += 2;
        }
        continue;
      }
      pos += 1;
      if (ch === '"') return out;
      out += ch;
    }
    return out;
  }

  function readValue(parts) {
    skipSpace();
    const ch = source[pos];
    if (ch === '{') {
      pos += 1;
      skipSpace();
      if (source[pos] === '}') { pos += 1; return; }
      for (;;) {
        skipSpace();
        const key = readString();
        skipSpace();
        pos += 1; // ':'
        parts.push(key);
        readValue(parts);
        parts.pop();
        skipSpace();
        if (source[pos] === ',') { pos += 1; continue; }
        pos += 1; // '}'
        return;
      }
    }
    if (ch === '[') {
      pos += 1;
      skipSpace();
      if (source[pos] === ']') { pos += 1; return; }
      let index = 0;
      for (;;) {
        parts.push(index);
        readValue(parts);
        parts.pop();
        index += 1;
        skipSpace();
        if (source[pos] === ',') { pos += 1; continue; }
        pos += 1; // ']'
        return;
      }
    }
    if (ch === '"') { readString(); return; }
    const start = pos;
    while (pos < source.length && /[^,}\]\s]/.test(source[pos])) pos += 1;
    const token = source.slice(start, pos);
    if (/^-?\d/.test(token) && /[.eE]/.test(token)) hints.add(literalPath(parts));
  }

  try {
    readValue([]);
  } catch (error) {
    return new Set();
  }
  return hints;
}

/**
 * Ersetzt Zahlen durch Rohliteral-Marker, wo Vertrag oder Literalgedächtnis
 * eine bestimmte Schreibweise verlangen. Arbeitet auf einer Kopie.
 */
function annotateNumbers(value, parts, hints) {
  if (Array.isArray(value)) {
    return value.map(function (item, index) {
      parts.push(index);
      const out = annotateNumbers(item, parts, hints);
      parts.pop();
      return out;
    });
  }
  if (isPlainObject(value)) {
    const out = {};
    Object.keys(value).forEach(function (key) {
      parts.push(key);
      out[key] = annotateNumbers(value[key], parts, hints);
      parts.pop();
    });
    return out;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;

  const byContract = schemaPath(parts);
  if (matchesPathSet(INT_PATH_SET, byContract)) return value;
  if (matchesPathSet(FLOAT_PATH_SET, byContract)) return rawLiteral(floatLiteral(value));
  if (hints && hints.has(literalPath(parts))) return rawLiteral(floatLiteral(value));
  return value;
}

/* -------------------------------------------------------------------------
 * Umsortierung
 * ---------------------------------------------------------------------- */

function orderKeys(keys, preferred) {
  const known = ensureArray(preferred).filter(function (name) {
    return keys.indexOf(name) >= 0;
  });
  const rest = keys.filter(function (name) { return known.indexOf(name) < 0; });
  rest.sort(compareGenericKeys);
  return known.concat(rest);
}

function reorderObject(value, parentKey) {
  if (Array.isArray(value)) {
    return value.map(function (item) { return reorderObject(item, parentKey); });
  }
  if (!isPlainObject(value)) return value;

  const preferred = FIELD_ORDER_BY_PARENT[parentKey] || [];
  const out = {};
  orderKeys(Object.keys(value), preferred).forEach(function (key) {
    out[key] = reorderObject(value[key], key);
  });
  return out;
}

/** Bringt eine ganze Config in kanonische Sektions- und Feldreihenfolge. */
export function reorderConfig(config) {
  if (!isPlainObject(config)) return config;
  const out = {};
  TOP_LEVEL_ORDER.forEach(function (section) {
    if (config[section] === undefined) return;
    out[section] = ensureArray(config[section]).map(function (row) {
      return reorderRow(section, row);
    });
  });
  Object.keys(config).sort().forEach(function (key) {
    if (out[key] === undefined) out[key] = reorderObject(config[key], key);
  });
  return out;
}

function reorderRow(section, row) {
  if (!isPlainObject(row)) return row;
  const preferred = FIELD_ORDER_BY_SECTION[section] || [];
  const out = {};
  orderKeys(Object.keys(row), preferred).forEach(function (key) {
    out[key] = reorderObject(row[key], key);
  });
  return out;
}

/* -------------------------------------------------------------------------
 * Ausgabe
 * ---------------------------------------------------------------------- */

/** Ein Objekt als kompakte Einzeile — exakt separators=(",", ": "). */
function objectToOneLine(value) {
  if (isRawLiteral(value)) return value[RAW_LITERAL];
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(objectToOneLine).join(',') + ']';
  }
  if (!isPlainObject(value)) return JSON.stringify(value);
  const parts = Object.keys(value).map(function (key) {
    return JSON.stringify(key) + ': ' + objectToOneLine(value[key]);
  });
  return '{' + parts.join(',') + '}';
}

function scalarLiteral(value) {
  return isRawLiteral(value) ? value[RAW_LITERAL] : JSON.stringify(value);
}

function isBranch(value) {
  return !isRawLiteral(value) && (isPlainObject(value) || Array.isArray(value));
}

function formatValue(value, level, isLast, indent) {
  if (isRawLiteral(value)) return value[RAW_LITERAL] + (isLast ? '' : ',');
  if (isPlainObject(value)) return formatDict(value, level, isLast, indent);
  if (Array.isArray(value)) return formatArray(value, level, isLast, indent);
  return JSON.stringify(value) + (isLast ? '' : ',');
}

function formatArray(items, level, isLast, indent) {
  if (!items.length) return '[]' + (isLast ? '' : ',');
  const pad = indent.repeat(level);
  const padNext = indent.repeat(level + 1);
  const lines = ['['];

  const allObjects = items.every(function (item) {
    return isPlainObject(item) && !isRawLiteral(item);
  });
  if (allObjects) {
    items.forEach(function (item, index) {
      lines.push(padNext + objectToOneLine(item) + (index === items.length - 1 ? '' : ','));
    });
    lines.push(pad + ']' + (isLast ? '' : ','));
    return lines.join('\n');
  }

  items.forEach(function (item, index) {
    lines.push(padNext + formatValue(item, level + 1, index === items.length - 1, indent));
  });
  lines.push(pad + ']' + (isLast ? '' : ','));
  return lines.join('\n');
}

function formatDict(value, level, isLast, indent) {
  const keys = Object.keys(value);
  if (!keys.length) return '{}' + (isLast ? '' : ',');
  const pad = indent.repeat(level);
  const padNext = indent.repeat(level + 1);
  const lines = ['{'];

  keys.forEach(function (key, index) {
    const isLastKey = index === keys.length - 1;
    if (level === 0 && index > 0) {
      const gap = TOP_SPACING[key] || 0;
      for (let i = 0; i < gap; i += 1) lines.push('');
    }
    const child = value[key];
    if (isBranch(child)) {
      lines.push(padNext + JSON.stringify(key) + ': '
        + formatValue(child, level + 1, isLastKey, indent));
    } else {
      lines.push(padNext + JSON.stringify(key) + ': ' + scalarLiteral(child)
        + (isLastKey ? '' : ','));
    }
  });

  lines.push(pad + '}' + (isLast ? '' : ','));
  return lines.join('\n');
}

/**
 * Formatiert beliebiges JSON im Lesbarkeitsformat der Runtime.
 *
 * @param {object} config    Config-Objekt.
 * @param {object} [options] `indent` (2), `reorder` (true),
 *                           `floatHints` (Set aus `collectFloatLiterals`),
 *                           `numbers` (`'contract'` = Standard, `'raw'` = aus).
 */
export function formatConfig(config, options) {
  const opts = isPlainObject(options) ? options : {};
  const indent = ' '.repeat(opts.indent === undefined ? 2 : opts.indent);
  const ordered = opts.reorder === false ? config : reorderConfig(config);
  const payload = opts.numbers === 'raw'
    ? ordered
    : annotateNumbers(ordered, [], opts.floatHints || null);
  return formatValue(payload, 0, true, indent) + '\n';
}

/**
 * Lädt eine Config aus Text und merkt sich dabei die Gleitkomma-Schreibweise.
 * Rückgabe `{ config, floatHints }` — `floatHints` unverändert an
 * `formatConfig()` zurückreichen, dann bleibt der Roundtrip byte-gleich.
 */
export function parseConfig(text) {
  const source = toText(text);
  return { config: JSON.parse(source), floatHints: collectFloatLiterals(source) };
}

/** Formatiert Text -> Text und erhält dabei die Zahlenliterale automatisch. */
export function formatConfigText(text, options) {
  const parsed = parseConfig(text);
  const opts = isPlainObject(options) ? Object.assign({}, options) : {};
  if (opts.floatHints === undefined) opts.floatHints = parsed.floatHints;
  return formatConfig(parsed.config, opts);
}

/** Prüft, ob eine Formatierung idempotent ist (Selbsttest der Panels). */
export function isIdempotent(config, options) {
  const once = formatConfig(config, options);
  const twice = formatConfigText(once, options);
  return once === twice;
}
