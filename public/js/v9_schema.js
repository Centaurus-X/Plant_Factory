/**
 * v9_schema.js — Kanonischer V9-Config-Kontrakt als Daten.
 *
 * Einzige Wahrheitsquelle für Factories, Validator, Migration und UI.
 * Alles Weitere (v9_factory, v9_validate, v9_ui_*) ist generisch und liest
 * ausschließlich aus diesen Tabellen — neue Felder erfordern hier eine
 * Zeile, nirgends sonst.
 *
 * Kontraktquelle:
 *   automation_system_v0101/src/library/_generic_type_library.py
 *   automation_system_v0101/src/library/_generic_system_contract_library/
 *     config_sharding_contracts.py  (SECTION_ORDER, KEY_FIELDS)
 *   automation_control_plane_release_v0025_r1/.../initial_config_v9.json
 *
 * Stil: rein funktional, kein OOP, keine Klassen.
 */

'use strict';

export const CANONICAL_VERSION = 9;
export const CANONICAL_SCHEMA = 'device_state_norm';
export const CROSS_VERSION = 8;
export const LEGACY_VERSION = 5;
/**
 * Kanonische Site der Bestandsflotte. Steckt in JEDER controller_uuid —
 * eine Abweichung (z. B. 'site-main' mit Bindestrich) erzeugt einen zweiten
 * Identitätsraum und macht jede abgeleitete UUID unauffindbar.
 */
export const DEFAULT_SITE_ID = 'site_main';
export const DEFAULT_NODE_ID = 'fn-01';
export const UNCONFIGURED_HOST = '0.0.0.0';

/** Exakte Sektionsmenge. decompose() lehnt jede Abweichung hart ab. */
export const SECTION_ORDER = Object.freeze([
  'meta', 'local_node', 'sites', 'nodes', 'site_controller_map',
  'modbus_functions', 'scaling_profiles', 'controllers', 'virtual_controllers',
  'sensors', 'actuators', 'sensor_types', 'actuator_types',
  'parameter_generic_templates', 'schema_mappings', 'processes',
  'process_values', 'process_modes', 'pid_configs',
  'control_method_templates', 'control_methods', 'process_states',
  'rule_engine', 'filters', 'timers', 'rules'
]);

/** Legacy-Sektionen aus V50 und ihr V9-Nachfolger (null = ersatzlos entfallen). */
export const LEGACY_SECTION_MAP = Object.freeze({
  node_registrar: 'nodes',
  nodes: 'nodes',
  controller_node_bindings: 'site_controller_map',
  event_types: null,
  parameter_schemas: 'parameter_generic_templates',
  state_type_parameter_schema_mappings: 'schema_mappings',
  automation: null,
  automation_engines: 'rule_engine',
  automation_filters: 'filters',
  automation_rule_sets: 'rules',
  triggers: 'rules',
  actions: 'rules',
  transitions: 'rules',
  events: null,
  dynamic_rule_engine: 'rules'
});

/* -------------------------------------------------------------------------
 * Enums — fail-closed übernommen aus dem Runtime-Vertrag
 * ---------------------------------------------------------------------- */

export const ENUMS = Object.freeze({
  meta_schema: ['device_state_norm'],
  meta_scope: ['node_local', 'cross', 'cross_controller', 'cross_worker', 'master_global'],
  node_role: ['worker', 'coordinator'],
  routing_role: ['owner', 'mirror', 'standby'],
  bus_type: ['modbus', 'plc_s7'],
  sensor_function_modbus: ['read_coil', 'read_holding_registers'],
  actuator_function_modbus: ['write_coil', 'write_register'],
  sensor_function_s7: ['read_s7'],
  actuator_function_s7: ['write_s7'],
  rule_src: ['state', 'sensor', 'timer'],
  rule_op: ['==', '!=', '>', '>=', '<', '<=', 'elapsed', 'fired'],
  rule_group: ['process', 'safety', 'notify'],
  activation_state: ['staged', 'active', 'retiring', 'inactive'],
  deployment_status: [
    'active_node', 'active_cross', 'replaced_local',
    'monitor_only', 'disabled_with_reason'
  ],
  latch: ['manual', 'auto'],
  control_strategy_type: ['PID', 'control_method'],
  filter_step_type: [
    'median', 'moving_average', 'lowpass', 'highpass', 'sampler',
    'scaler', 'scaler_profile', 'scaler_sensor_profile', 'expr'
  ],
  control_template_type: ['ramp', 'square', 'sine', 'impulse', 'expr'],
  control_template_expr_id: ['poly2', 'inv_sin', 'log_n', 'exp'],
  execution_scope_kind: ['local_controller', 'cross_controller', 'cross_worker'],
  deployment_active: ['active_node', 'active_cross', 'replaced_local', 'monitor_only']
});

/** Operatoren, die die Runtime-Engine kennt, der Config-Vertrag aber verbietet. */
export const RUNTIME_ONLY_OPERATORS = Object.freeze([
  'eq', 'ne', 'gt', 'ge', 'lt', 'le', 'in', 'not_in', 'contains', 'not_contains',
  'startswith', 'endswith', 'regex', 'between', 'near', '~=',
  'is_none', 'not_none', 'is_true', 'is_false', 'changed', 'running'
]);

/** Regelgruppen, die niemals cross ausgeführt werden dürfen (CRITICAL_GROUPS). */
export const CRITICAL_GROUPS = Object.freeze([
  'emergency', 'hard_real_time', 'hard_realtime', 'interlock', 'real_time',
  'realtime', 'safety', 'safety_critical', 'soft_realtime', 'time_critical'
]);

/** Aktionsfelder, die keine Nutzlast sind, sondern den Handler wählen. */
export const ACTION_MARKER_ORDER = Object.freeze(['state_ids', 'p_ids', 'notify']);

/** Setpoint-Schlüssel in Auswertungsreihenfolge (extract_setpoint_from_state). */
export const SETPOINT_KEYS = Object.freeze([
  'target_temp_c', 'target_temp', 'target_bar', 'target_pressure_bar',
  'target', 'setpoint', 'value', 'power', 'rpm', 'flow_rate'
]);

/* -------------------------------------------------------------------------
 * Feldspezifikationen
 *
 * f(name, type, opts) — type: 'str' | 'int' | 'num' | 'bool' | 'list' |
 *                              'map' | 'obj' | 'any'
 * opts: { required, enumKey, min, max, minLen, ref, of, label, hint,
 *         default, readOnly, derived }
 * ---------------------------------------------------------------------- */

function f(name, type, opts) {
  return Object.assign({ name, type, required: true }, opts || {});
}

/** Sektionsdefinitionen: kind, Primärschlüssel, Felder, UI-Metadaten. */
export const SECTIONS = Object.freeze({
  meta: {
    kind: 'singleton', key: null, label: 'Meta',
    fields: [
      f('schema', 'str', { enumKey: 'meta_schema', default: CANONICAL_SCHEMA, readOnly: true }),
      f('version', 'int', { min: 1, default: CANONICAL_VERSION, readOnly: true }),
      f('scope', 'str', { enumKey: 'meta_scope', default: 'node_local' }),
      f('description', 'str', { minLen: 0 }),
      f('node_id', 'str', { required: false, hint: 'Pflicht bei scope=node_local' }),
      f('owner_node_id', 'str', { required: false, hint: 'Pflicht bei Cross-Scope' }),
      f('domain_id', 'str', { required: false, hint: 'Pflicht bei Cross-Scope' }),
      f('cross_domain_id', 'str', { required: false })
    ]
  },

  local_node: {
    kind: 'singleton', key: null, label: 'Lokaler Node',
    fields: [
      f('node_id', 'str', { ref: 'nodes.node_id' }),
      f('site_id', 'str', { required: false, ref: 'sites.site_id' }),
      f('active_controller_uuids', 'list', { of: 'str' }),
      f('active_controller_routes', 'list', { of: 'route' })
    ]
  },

  sites: {
    kind: 'table', key: 'site_id', label: 'Sites',
    fields: [
      f('site_id', 'str'),
      f('site_name', 'str'),
      f('enabled', 'bool', { default: true }),
      f('description', 'str', { minLen: 0 })
    ]
  },

  nodes: {
    kind: 'table', key: 'node_id', label: 'Nodes',
    fields: [
      f('node_id', 'str'),
      f('site_id', 'str', { required: false, ref: 'sites.site_id' }),
      f('node_role', 'str', { enumKey: 'node_role', default: 'worker' }),
      f('enabled', 'bool', { default: true }),
      f('description', 'str', { minLen: 0 })
    ]
  },

  site_controller_map: {
    kind: 'table', key: 'route_key', label: 'Controller-Routen',
    fields: [
      f('local_controller_id', 'int', { min: 1 }),
      f('node_id', 'str', { ref: 'nodes.node_id' }),
      f('site_id', 'str', { required: false, ref: 'sites.site_id' }),
      f('controller_uuid', 'str', { ref: 'controllers.controller_uuid' }),
      f('controller_key', 'str'),
      f('route_key', 'str', { derived: true }),
      f('routing_role', 'str', { enumKey: 'routing_role', default: 'owner' }),
      f('enabled', 'bool', { default: true })
    ]
  },

  modbus_functions: {
    kind: 'table', key: 'modbus_function_id', label: 'Modbus-Funktionen',
    fields: [
      f('modbus_function_id', 'int', { min: 1 }),
      f('module_type', 'str', { minLen: 0 }),
      f('modbus_function_type', 'str', { minLen: 0 })
    ]
  },

  scaling_profiles: {
    kind: 'table', key: 'profile_id', label: 'Skalierungsprofile',
    fields: [
      f('profile_id', 'int', { min: 1 }),
      f('name', 'str', { minLen: 0 }),
      f('raw_min', 'int', { default: 0 }),
      f('raw_max', 'int', { default: 65535 }),
      f('eng_min', 'num', { default: 0 }),
      f('eng_max', 'num', { default: 100 }),
      f('unit', 'str', { minLen: 0 })
    ]
  },

  controllers: {
    kind: 'table', key: 'controller_uuid', label: 'Controller',
    fields: [
      f('controller_id', 'int', { min: 1 }),
      f('controller_uuid', 'str', { derived: true }),
      f('controller_key', 'str', { derived: true }),
      f('device_name', 'str'),
      f('bus_type', 'str', { enumKey: 'bus_type', default: 'modbus' }),
      f('host', 'str'),
      f('port', 'int', { min: 1, max: 65535, default: 502 }),
      f('unit', 'str', { default: '0x1' }),
      f('tags', 'list', { of: 'str', default: [] }),
      f('comm', 'map', { required: false, hint: 'nur bus_type=plc_s7' })
    ]
  },

  virtual_controllers: {
    kind: 'table', key: 'virt_controller_id', label: 'Virtuelle Controller',
    fields: [
      f('virt_controller_id', 'int', { min: 1 }),
      f('controller_uuid', 'str', { ref: 'controllers.controller_uuid' }),
      f('device_name', 'str'),
      f('virt_active', 'bool', { default: false }),
      f('host', 'str'),
      f('port', 'int', { min: 1, max: 65535, default: 5020 })
    ]
  },

  sensors: {
    kind: 'io', key: 'sensor_id', label: 'Sensoren',
    idField: 'sensor_id', groupField: 'sensor_group',
    functionEnum: { modbus: 'sensor_function_modbus', plc_s7: 'sensor_function_s7' },
    fields: [
      f('local_controller_id', 'int', { min: 1, derived: true }),
      f('sensor_id', 'int', { min: 1 }),
      f('node_id', 'str', { derived: true, ref: 'nodes.node_id' }),
      f('site_id', 'str', { derived: true, ref: 'sites.site_id' }),
      f('controller_uuid', 'str', { ref: 'controllers.controller_uuid' }),
      f('controller_key', 'str', { derived: true }),
      f('enabled', 'bool', { default: true }),
      f('sensor_group', 'str', { default: 'S1' }),
      f('address', 'any', { default: 0 }),
      f('bus_type', 'str', { enumKey: 'bus_type', default: 'modbus' }),
      f('function_type', 'str', { default: 'read_holding_registers' }),
      f('profile_id', 'int', { required: false, min: 1, ref: 'scaling_profiles.profile_id' })
    ]
  },

  actuators: {
    kind: 'io', key: 'actuator_id', label: 'Aktoren',
    idField: 'actuator_id', groupField: 'actuator_group',
    functionEnum: { modbus: 'actuator_function_modbus', plc_s7: 'actuator_function_s7' },
    fields: [
      f('local_controller_id', 'int', { min: 1, derived: true }),
      f('actuator_id', 'int', { min: 1 }),
      f('node_id', 'str', { derived: true, ref: 'nodes.node_id' }),
      f('site_id', 'str', { derived: true, ref: 'sites.site_id' }),
      f('controller_uuid', 'str', { ref: 'controllers.controller_uuid' }),
      f('controller_key', 'str', { derived: true }),
      f('enabled', 'bool', { default: true }),
      f('actuator_group', 'str', { default: 'A' }),
      f('address', 'any', { default: 0 }),
      f('bus_type', 'str', { enumKey: 'bus_type', default: 'modbus' }),
      f('function_type', 'str', { default: 'write_coil' }),
      f('profile_id', 'int', { required: false, min: 1, ref: 'scaling_profiles.profile_id' })
    ]
  },

  sensor_types: {
    kind: 'table', key: 'sensor_types_id', label: 'Sensortypen',
    fields: [f('sensor_types_id', 'int', { min: 1 }), f('sensor_type', 'str')]
  },

  actuator_types: {
    kind: 'table', key: 'actuator_types_id', label: 'Aktortypen',
    fields: [f('actuator_types_id', 'int', { min: 1 }), f('actuator_type', 'str')]
  },

  parameter_generic_templates: {
    kind: 'table', key: 'schema_id', label: 'Parameter-Templates',
    fields: [
      f('schema_id', 'int', { min: 1 }),
      f('state_type', 'str'),
      // `fields` und `constraints` stammen aus dem V50-Vertrag
      // (parameter_schemas). Der V9-Vertrag schreibt sie nicht vor, die
      // Runtime-Type-Authority akzeptiert sie aber als additive Zusatzfelder
      // (empirisch gegen verify_storage_config_data belegt, siehe
      // test/test_v9_core.mjs). Deshalb werden sie NICHT verworfen, sondern
      // konvergiert: der Editor pflegt sie weiter, die Runtime ignoriert sie.
      f('fields', 'list', { required: false, default: [] }),
      f('constraints', 'list', { required: false, default: [] }),
      f('description', 'str', { minLen: 0 })
    ]
  },

  schema_mappings: {
    kind: 'table', key: 'mapping_id', label: 'Schema-Mappings',
    fields: [
      f('mapping_id', 'int', { min: 1 }),
      f('schema_id', 'int', { min: 1, ref: 'parameter_generic_templates.schema_id' })
    ]
  },

  processes: {
    kind: 'table', key: 'p_id', label: 'Prozesse',
    fields: [
      f('p_id', 'int', { min: 1 }),
      f('owner_node_id', 'str', { ref: 'nodes.node_id' }),
      f('process_name', 'str'),
      f('process_location', 'str', { minLen: 0 })
    ]
  },

  process_values: {
    kind: 'table', key: 'value_id', label: 'Prozesswerte',
    fields: [f('value_id', 'int', { min: 1 }), f('state_value', 'str')]
  },

  process_modes: {
    kind: 'table', key: 'mode_id', label: 'Betriebsarten',
    fields: [f('mode_id', 'int', { min: 1 }), f('mode', 'str')]
  },

  pid_configs: {
    kind: 'table', key: 'pid_config_id', label: 'PID-Konfigurationen',
    fields: [
      f('pid_config_id', 'int', { min: 1 }),
      f('pid_parameters', 'map', { of: 'num', default: { kp: 1.0, ki: 0.0, kd: 0.0 } })
    ]
  },

  control_method_templates: {
    kind: 'table', key: 'template_id', label: 'Regelverfahren-Templates',
    fields: [
      f('template_id', 'int', { min: 1 }),
      f('template_name', 'str'),
      f('type', 'str', { enumKey: 'control_template_type', enumOpen: true, default: 'ramp' }),
      f('parameters', 'list', { of: 'str', default: [] }),
      f('expr_id', 'str', { required: false, enumKey: 'control_template_expr_id', enumOpen: true }),
      f('template_description', 'str', { required: false, minLen: 0 })
    ]
  },

  control_methods: {
    kind: 'table', key: 'method_id', label: 'Regelverfahren',
    fields: [
      f('method_id', 'int', { min: 1 }),
      f('template_id', 'int', { min: 1, ref: 'control_method_templates.template_id' }),
      f('args', 'map', { of: 'num', default: {} })
    ]
  },

  process_states: {
    kind: 'table', key: 'state_id', label: 'Prozess-States',
    fields: [
      f('state_id', 'int', { min: 1 }),
      f('p_id', 'int', { min: 1, ref: 'processes.p_id' }),
      f('value_id', 'int', { min: 1, ref: 'process_values.value_id' }),
      f('mode_id', 'int', { min: 1, ref: 'process_modes.mode_id' }),
      f('mapping_id', 'int', { min: 1, ref: 'schema_mappings.mapping_id' }),
      f('io_refs', 'obj', { of: 'io_refs' }),
      f('control_strategy', 'obj', { nullable: true, of: 'control_strategy' }),
      f('setpoint_source', 'any', { nullable: true }),
      f('parameters', 'map', { of: 'scalar', default: {} })
    ]
  },

  rule_engine: {
    kind: 'singleton', key: 'engine_id', label: 'Rule-Engine',
    fields: [
      f('engine_id', 'int', { min: 1, default: 1 }),
      f('required_mode_id', 'int', { min: 1, ref: 'process_modes.mode_id', default: 2 }),
      f('enabled', 'bool', { default: true }),
      f('writable_fields', 'list', { required: false, of: 'str', default: ['value_id', 'parameters'] }),
      f('sp_tolerance', 'num', { required: false, min: 0, default: 0.5 }),
      f('defaults', 'map', { required: false }),
      f('runtime', 'map'),
      f('safety', 'map', { required: false }),
      f('debug', 'map', { required: false })
    ]
  },

  filters: {
    kind: 'table', key: 'filter_id', label: 'Filter',
    fields: [
      f('filter_id', 'int', { min: 1 }),
      f('sensor_refs', 'list', { of: 'sensor_ref', minLen: 1 }),
      f('chain', 'list', { of: 'filter_step', minLen: 1 })
    ]
  },

  timers: {
    kind: 'table', key: 'timer_id', label: 'Timer',
    fields: [
      f('timer_id', 'int', { min: 1 }),
      f('duration_s', 'num', { required: false, min: 0 }),
      f('interval_s', 'num', { required: false, min: 0 }),
      f('at', 'str', { required: false, hint: 'HH:MM (Lokalzeit)' }),
      f('cron', 'str', { required: false, hint: '5-Feld-Cron' }),
      f('description', 'str', { required: false, minLen: 0 })
    ]
  },

  rules: {
    kind: 'table', key: 'rule_id', label: 'Regeln',
    fields: [
      f('rule_id', 'int', { min: 1 }),
      f('engine_id', 'int', { min: 1, ref: 'rule_engine.engine_id', default: 1 }),
      f('owner_node_id', 'str', { ref: 'nodes.node_id' }),
      f('execution_owner', 'str'),
      f('execution_scope', 'str', { derived: true }),
      f('execution_epoch', 'int', { min: 0, default: 1 }),
      f('deployment_status', 'str', { enumKey: 'deployment_status', default: 'active_node' }),
      f('activation_state', 'str', { enumKey: 'activation_state', default: 'active' }),
      f('group', 'str', { enumKey: 'rule_group', default: 'process' }),
      f('priority', 'int', { min: 0, default: 100 }),
      f('name', 'str'),
      f('enabled', 'bool', { default: true }),
      f('when', 'list', { of: 'condition', minLen: 1 }),
      f('until', 'list', { required: false, of: 'condition', minLen: 1 }),
      f('do', 'list', { of: 'action', minLen: 1 }),
      f('else_do', 'list', { required: false, of: 'action', minLen: 1 }),
      f('latch', 'str', { required: false, enumKey: 'latch' }),
      f('disabled_reason', 'str', { required: false, hint: 'Pflicht bei disabled_with_reason' }),
      f('description', 'str', { required: false, minLen: 0 })
    ]
  }
});

/* -------------------------------------------------------------------------
 * Subobjekt-Spezifikationen
 * ---------------------------------------------------------------------- */

export const SUB_SPECS = Object.freeze({
  route: {
    label: 'Aktive Route',
    fields: [
      f('local_controller_id', 'int', { min: 1 }),
      f('controller_uuid', 'str'),
      f('controller_key', 'str')
    ]
  },
  sensor_ref: {
    label: 'Sensor-Referenz',
    fields: [f('sensor_id', 'int', { min: 1 }), f('controller_uuid', 'str')]
  },
  actuator_ref: {
    label: 'Aktor-Referenz',
    fields: [f('actuator_id', 'int', { min: 1 }), f('controller_uuid', 'str')]
  },
  io_refs: {
    label: 'I/O-Referenzen',
    fields: [
      f('sensors', 'list', { of: 'sensor_ref', default: [] }),
      f('actuators', 'list', { of: 'actuator_ref', default: [] })
    ]
  },
  filter_step: {
    label: 'Filterstufe',
    fields: [
      f('type', 'str', { enumKey: 'filter_step_type', enumOpen: true, default: 'median' }),
      f('window', 'int', { required: false, min: 1 }),
      f('alpha', 'num', { required: false, min: 0, max: 1 }),
      f('period_s', 'num', { required: false, min: 0 })
    ]
  },
  condition: {
    label: 'Bedingung',
    fields: [
      f('src', 'str', { enumKey: 'rule_src', default: 'sensor' }),
      f('op', 'str', { enumKey: 'rule_op', default: '>=' }),
      f('value', 'any', { default: 0 }),
      f('state_id', 'int', { required: false, min: 1, ref: 'process_states.state_id' }),
      f('field', 'str', { required: false, default: 'value_id' }),
      f('controller_uuid', 'str', { required: false }),
      f('sensor_id', 'int', { required: false, min: 1 }),
      f('timer_id', 'int', { required: false, min: 1, ref: 'timers.timer_id' }),
      f('filter_id', 'int', { required: false, min: 1, ref: 'filters.filter_id' }),
      f('cooldown_s', 'num', { required: false, min: 0 })
    ]
  },
  action: {
    label: 'Aktion',
    fields: [
      f('state_ids', 'list', { required: false, of: 'int', minLen: 1 }),
      f('p_ids', 'list', { required: false, of: 'int', minLen: 1 }),
      f('value_id', 'int', { required: false, min: 1, ref: 'process_values.value_id' }),
      f('parameters', 'map', { required: false, of: 'scalar' }),
      f('notify', 'str', { required: false })
    ]
  },
  control_strategy: {
    label: 'Regelstrategie',
    variants: {
      PID: [
        f('type', 'str', { enumKey: 'control_strategy_type', default: 'PID' }),
        f('pid_config_id', 'int', { min: 1, ref: 'pid_configs.pid_config_id' }),
        f('anti_windup', 'bool', { required: false }),
        f('out_min', 'num', { required: false }),
        f('out_max', 'num', { required: false }),
        f('sample_time', 'num', { required: false, min: 0 }),
        f('error_scale', 'num', { required: false }),
        f('dt_max_s', 'num', { required: false, min: 0 })
      ],
      control_method: [
        f('type', 'str', { default: 'control_method' }),
        f('method_id', 'int', { min: 1, ref: 'control_methods.method_id' })
      ]
    }
  }
});

/* -------------------------------------------------------------------------
 * Ableitungsregeln
 * ---------------------------------------------------------------------- */

/** route_key = "<site>.<node>.ctrl_<local_id>" (bzw. ohne site). */
export function routeKeyFor(siteId, nodeId, localControllerId) {
  const suffix = nodeId + '.ctrl_' + localControllerId;
  return siteId ? siteId + '.' + suffix : suffix;
}

/** execution_scope einer Node-Regel. */
export function executionScopeFor(nodeId) {
  return 'node:' + nodeId;
}

/**
 * Kanonische Cross-Domain eines Owners: `<owner>.default`.
 *
 * Schreibweise aus `config_sharding_contracts.py` der Control-Plane: bei
 * `deployment_status = "active_cross"` setzt die Runtime
 * `cross_domain_id = "<owner>.default"` und
 * `execution_scope = "cross:<owner>.default"`. Der Editor muss dieselbe
 * Zeichenkette erzeugen, sonst weist der Coordinator die Regel als
 * `stale_execution_scope` zurück.
 */
export function crossDomainFor(ownerNodeId) {
  return ownerNodeId + '.default';
}

/** `execution_scope` einer cross-ausgeführten Regel. */
export function crossExecutionScopeFor(ownerNodeId) {
  return 'cross:' + crossDomainFor(ownerNodeId);
}

/**
 * `execution_scope` aus Deployment-Status und Owner — die eine Stelle, an der
 * die Schreibweise entschieden wird.
 */
export function executionScopeForStatus(deploymentStatus, ownerNodeId) {
  return deploymentStatus === 'active_cross'
    ? crossExecutionScopeFor(ownerNodeId)
    : executionScopeFor(ownerNodeId);
}

/** Erlaubte function_type-Werte für eine I/O-Sektion + bus_type. */
export function functionTypesFor(section, busType) {
  const spec = SECTIONS[section];
  if (!spec || !spec.functionEnum) return [];
  const key = spec.functionEnum[busType] || spec.functionEnum.modbus;
  return ENUMS[key] || [];
}

/** Alle Referenzziele (`section.field`) als Index für den Validator. */
export function referenceTargets() {
  const out = [];
  Object.keys(SECTIONS).forEach(function (section) {
    SECTIONS[section].fields.forEach(function (field) {
      if (field.ref) out.push({ section, field: field.name, target: field.ref });
    });
  });
  return out;
}

/** Feldspezifikation nachschlagen. */
export function fieldSpec(section, name) {
  const spec = SECTIONS[section];
  if (!spec) return null;
  for (let i = 0; i < spec.fields.length; i += 1) {
    if (spec.fields[i].name === name) return spec.fields[i];
  }
  return null;
}

/** Primärschlüssel einer Sektion. */
export function primaryKey(section) {
  const spec = SECTIONS[section];
  return spec ? spec.key : null;
}

/* =========================================================================
 * Cross-V8-Profil
 * =========================================================================
 * Der Cross-Shard ist kein eigenes Schema, sondern das V9-Node-Schema mit
 * exakt drei Relaxierungen und zwei fail-closed Verboten. Quelle:
 *   _generic_type_library.build_scope_config_schema()        (:1895-1946)
 *   config_sharding_contracts.validate_cross_execution_shard()
 *
 * Relaxierung (weniger streng als V9):
 *   local_node          min_len 0  — muss sogar LEER sein
 *   controllers         min_len 0, required = [uuid, key, owner_node_id]
 *   site_controller_map min_len 0
 *   I/O-Zeile           required = [<id_field>, <group_field>]
 *
 * Verbot (strenger als V9, fail-closed):
 *   controllers  dürfen KEINE Physikfelder tragen: bus_type, host, port, unit
 *   sensors/actuators dürfen KEINE Physikfelder tragen:
 *                      address, bus_type, function_type, unit
 *   virtual_controllers: kein virt_active === true
 *   rules: nur cross_controller/cross_worker, keine kritischen Gruppen
 * ====================================================================== */

export const CROSS_PROFILE = Object.freeze({
  version: CROSS_VERSION,
  scopes: ['cross', 'cross_controller', 'cross_worker'],
  defaultScope: 'cross',

  /** Sektionen, die im Cross-Shard leer sein müssen. */
  mustBeEmpty: ['local_node'],

  /** Sektionen, die im Cross-Shard keine Rolle spielen (leer erlaubt). */
  optionalEmpty: ['virtual_controllers', 'filters', 'modbus_functions'],

  /** Physikfelder, die ein Cross-Controller nicht tragen darf. */
  forbiddenControllerFields: ['bus_type', 'host', 'port', 'unit'],

  /** Physikfelder, die eine Cross-I/O-Zeile nicht tragen darf. */
  forbiddenIoFields: ['address', 'bus_type', 'function_type', 'unit'],

  /** Feldmenge eines Cross-Controller-Stubs (mehr ist nicht erlaubt). */
  controllerFields: ['controller_id', 'controller_uuid', 'controller_key', 'owner_node_id'],

  /** Feldmenge einer logischen Cross-I/O-Zeile. */
  sensorFields: ['local_controller_id', 'sensor_id', 'node_id',
    'controller_uuid', 'controller_key', 'enabled', 'sensor_group'],
  actuatorFields: ['local_controller_id', 'actuator_id', 'node_id',
    'controller_uuid', 'controller_key', 'enabled', 'actuator_group'],

  /** Felder, die im Cross-Shard an Regeln NICHT verlangt werden. */
  optionalRuleFields: ['activation_state', 'deployment_status', 'execution_epoch',
    'execution_owner', 'execution_scope'],

  /** Erlaubte Ausführungs-Scopes einer Cross-Regel. */
  ruleScopes: ['cross_controller', 'cross_worker']
});

/** Ist die Config ein Cross-Shard? */
export function isCrossConfig(config) {
  const meta = (config && Array.isArray(config.meta) ? config.meta[0] : null) || {};
  const scope = String(meta.scope || '');
  return scope.indexOf('cross') === 0;
}

/** Liefert das aktive Profil ('node' | 'cross') einer Config. */
export function profileOf(config) {
  return isCrossConfig(config) ? 'cross' : 'node';
}

/**
 * Feldliste einer Sektion im jeweiligen Profil.
 * Im Cross-Profil werden Physikfelder ausgeblendet und owner_node_id ergänzt.
 */
export function fieldsFor(section, profile) {
  const spec = SECTIONS[section];
  if (!spec) return [];
  if (profile !== 'cross') return spec.fields;

  if (section === 'controllers') {
    return spec.fields
      .filter(function (field) {
        return CROSS_PROFILE.forbiddenControllerFields.indexOf(field.name) < 0
          && ['device_name', 'tags', 'comm'].indexOf(field.name) < 0;
      })
      .concat([f('owner_node_id', 'str', { ref: 'nodes.node_id' })]);
  }
  if (section === 'sensors' || section === 'actuators') {
    return spec.fields.filter(function (field) {
      return CROSS_PROFILE.forbiddenIoFields.indexOf(field.name) < 0
        && ['site_id', 'profile_id'].indexOf(field.name) < 0;
    });
  }
  if (section === 'rules') {
    return spec.fields.map(function (field) {
      if (CROSS_PROFILE.optionalRuleFields.indexOf(field.name) < 0) return field;
      return Object.assign({}, field, { required: false });
    });
  }
  if (section === 'site_controller_map' || section === 'nodes') {
    return spec.fields.map(function (field) {
      return field.name === 'site_id' ? Object.assign({}, field, { required: false }) : field;
    });
  }
  return spec.fields;
}

/** Muss die Sektion im Profil mindestens eine Zeile haben? */
export function requiresRows(section, profile) {
  const spec = SECTIONS[section];
  if (!spec) return false;
  if (profile === 'cross') {
    if (CROSS_PROFILE.mustBeEmpty.indexOf(section) >= 0) return false;
    if (['controllers', 'site_controller_map', 'sites'].indexOf(section) >= 0) return false;
    if (section === 'meta' || section === 'rule_engine') return true;
    return false;
  }
  return spec.kind === 'singleton';
}

/** Leeres, kontraktkonformes Config-Gerüst (alle Sektionen vorhanden). */
export function emptyConfig() {
  const out = {};
  SECTION_ORDER.forEach(function (section) { out[section] = []; });
  return out;
}

/** Sektionen in kanonische Reihenfolge bringen (fingerprint-relevant). */
export function orderSections(config) {
  const out = {};
  SECTION_ORDER.forEach(function (section) {
    out[section] = Array.isArray(config[section]) ? config[section] : [];
  });
  Object.keys(config).forEach(function (key) {
    if (!(key in out)) out[key] = config[key];
  });
  return out;
}
