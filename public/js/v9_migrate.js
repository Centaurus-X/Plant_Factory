/**
 * v9_migrate.js — Migration und Projektion zwischen Legacy-Editor und V9.
 *
 * Drei Richtungen:
 *
 *   1. migrateLegacyConfig(legacy)      Legacy (V50/Pre-V9)  ->  V9  (+ Report)
 *      Browser-Zwilling von _tools/migrate_config_to_v9.py. Beide erzeugen
 *      identische Ergebnisse (Regressionstest: test/test_v9_core.mjs).
 *
 *   2. toEditorProjection(v9)           V9  ->  Legacy-Sicht
 *      Der eigentliche Trick des minimal-invasiven Umbaus: die Altmodule
 *      (device.js, processes.js, hmi.js, rules_generator.js, automation_tabs.js)
 *      bleiben unverändert und sehen weiterhin ihre gewohnten Feldnamen.
 *      Die Projektion ist read-optimiert und trägt in `__v9` die kanonische
 *      Quelle mit.
 *
 *   3. fromEditorProjection(view, base) Legacy-Sicht  ->  V9
 *      Rückführung der im Alt-UI vorgenommenen Aenderungen in den Vertrag.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import {
  SECTION_ORDER, LEGACY_SECTION_MAP, ENUMS, DEFAULT_SITE_ID, DEFAULT_NODE_ID,
  UNCONFIGURED_HOST, executionScopeFor, emptyConfig, orderSections
} from './v9_schema.js';
import { controllerUuidFor, controllerKeyFor } from './v9_uuid.js';
import {
  provisionController, provisionProcess,
  PROVISION_NOTE_CONTROLLER, PROVISION_NOTE_PROCESS
} from './v9_provision.js';
import {
  createContext, createMeta, createSite, createNode, createRoute, createLocalNode,
  createController, createVirtualController, createSensor, createActuator,
  createProcess, createProcessState, createRuleEngine, createRule, createCondition,
  createAction, createFilter, createTimer, createParameterTemplate,
  createSchemaMapping, createPidConfig, createControlMethod, createScalingProfile,
  createIoRefs, createControlStrategy, reconcile
} from './v9_factory.js';
import {
  deepClone, ensureArray, isPlainObject, indexBy, toText, toIntOrNull,
  toNumberOrNull, toBool, uniqInts
} from './shared_utils.js';

/** Legacy-function_type -> V9-Wert. */
export const FUNCTION_TYPE_REPAIR = Object.freeze({
  write_data: 'write_register',
  read_data: 'read_holding_registers',
  read_register: 'read_holding_registers',
  read_holding_register: 'read_holding_registers',
  write_registers: 'write_register',
  read_input_registers: 'read_holding_registers',
  read_discrete_input: 'read_coil'
});

/** Legacy-Operatoren -> V9. */
export const OPERATOR_REPAIR = Object.freeze({
  eq: '==', ne: '!=', gt: '>', ge: '>=', lt: '<', le: '<=',
  '=': '==', '<>': '!=', '=>': '>=', '=<': '<='
});

function note(report, kind, section, message, detail) {
  report.push({ kind, section, message, detail: detail === undefined ? null : detail });
}

/** Erkennt, ob eine Config bereits im V9-Format vorliegt. */
export function isV9Config(config) {
  if (!isPlainObject(config)) return false;
  const meta = ensureArray(config.meta)[0];
  return isPlainObject(meta) && toIntOrNull(meta.version) === 9;
}

/* =========================================================================
 * 1. Legacy -> V9
 * ====================================================================== */

export function migrateLegacyConfig(legacy, options) {
  const opts = isPlainObject(options) ? options : {};
  const source = isPlainObject(legacy) ? legacy : {};
  const report = [];
  const siteId = toText(opts.site_id) || DEFAULT_SITE_ID;
  const nodeId = toText(opts.node_id) || DEFAULT_NODE_ID;
  const scope = toText(opts.scope) || 'master_global';
  const provision = opts.provision_missing !== false;

  const config = emptyConfig();
  config.meta = [createMeta({ scope, node_id: nodeId,
    description: 'Aus Legacy-Editor-Config migriert (Automated_SVG_Integration_52).' })];
  config.sites = [createSite({ site_id: siteId })];
  config.nodes = [createNode({ node_id: nodeId, site_id: siteId }, { siteId })];

  const identity = buildIdentityMap(source, siteId, nodeId, report, provision);
  config.controllers = migrateControllers(source, identity, report);
  config.site_controller_map = buildRoutes(identity, siteId, nodeId);
  config.local_node = [createLocalNode(config, nodeId, siteId)];

  const ctx = createContext(config);
  config.virtual_controllers = migrateVirtualControllers(source, ctx, identity, report);
  config.sensors = migrateIo(source, 'sensors', identity, ctx, report);
  config.actuators = migrateIo(source, 'actuators', identity, ctx, report);

  config.modbus_functions = copyTable(source.modbus_functions,
    ['modbus_function_id', 'module_type', 'modbus_function_type']);
  config.scaling_profiles = ensureArray(source.scaling_profiles).map(createScalingProfile);
  config.sensor_types = copyTable(source.sensor_types, ['sensor_types_id', 'sensor_type']);
  config.actuator_types = copyTable(source.actuator_types, ['actuator_types_id', 'actuator_type']);
  config.process_values = copyTable(source.process_values, ['value_id', 'state_value']);
  config.process_modes = copyTable(source.process_modes, ['mode_id', 'mode']);
  config.pid_configs = ensureArray(source.pid_configs).map(createPidConfig);
  config.control_method_templates = copyTable(source.control_method_templates,
    ['template_id', 'template_name', 'type', 'parameters', 'expr_id', 'template_description']);
  config.control_methods = ensureArray(source.control_methods).map(createControlMethod);

  const templates = migrateParameterTemplates(source, report);
  config.parameter_generic_templates = templates.templates;
  config.schema_mappings = templates.mappings;

  config.processes = migrateProcesses(source, nodeId, report, provision);

  const stateCtx = createContext(config);
  config.process_states = migrateProcessStates(source, config, stateCtx, templates.schemaIndex, report);

  const filterResult = migrateFilters(source, createContext(config), report);
  config.filters = filterResult.filters;
  config.timers = ensureArray(source.timers).map(createTimer);
  config.rule_engine = [migrateRuleEngine(source, config, report)];
  config.rules = migrateRules(source, config, filterResult.alias, nodeId, report);

  Object.keys(LEGACY_SECTION_MAP).forEach(function (section) {
    if (!source[section] || SECTION_ORDER.indexOf(section) >= 0) return;
    const successor = LEGACY_SECTION_MAP[section];
    note(report, 'breaking', section,
      successor
        ? 'Sektion existiert in V9 nicht mehr — Nachfolger: "' + successor + '".'
        : 'Sektion existiert in V9 ersatzlos nicht mehr.',
      { entries: ensureArray(source[section]).length });
  });

  reconcile(config);
  return { config: orderSections(config), report };
}

function buildIdentityMap(legacy, siteId, nodeId, report, provision) {
  const identity = new Map();
  ensureArray(legacy.controllers).slice().sort(byNumeric('controller_id')).forEach(function (row) {
    const localId = toIntOrNull(row.controller_id);
    if (localId === null || localId < 1) {
      note(report, 'error', 'controllers', 'controller_id ungültig — Zeile verworfen', row);
      return;
    }
    const deviceName = toText(row.device_name) || 'controller_' + localId;
    identity.set(localId, {
      local_controller_id: localId,
      device_name: deviceName,
      controller_key: controllerKeyFor(deviceName),
      controller_uuid: controllerUuidFor(siteId, nodeId, controllerKeyFor(deviceName)),
      node_id: nodeId,
      site_id: siteId,
      source: row
    });
  });
  if (!provision) return identity;

  const referenced = new Set();
  ['sensors', 'actuators', 'virtual_controllers'].forEach(function (section) {
    ensureArray(legacy[section]).forEach(function (row) {
      const localId = toIntOrNull(isPlainObject(row) ? row.controller_id : null);
      if (localId !== null && localId >= 1) referenced.add(localId);
    });
  });
  Array.from(referenced).sort(function (a, b) { return a - b; }).forEach(function (localId) {
    if (identity.has(localId)) return;
    // Gerätename nach Anlagenkonvention statt "unconfigured_N": nur so
    // reproduziert die abgeleitete controller_uuid die Identität, die die
    // Runtime für denselben Controller vergeben hat.
    const deviceName = 'wago_' + localId;
    identity.set(localId, {
      local_controller_id: localId,
      device_name: deviceName,
      controller_key: controllerKeyFor(deviceName),
      controller_uuid: controllerUuidFor(siteId, nodeId, deviceName),
      node_id: nodeId,
      site_id: siteId,
      source: null,
      provisioned: true
    });
    note(report, 'repair', 'controllers',
      'controller_id ' + localId + ' wird referenziert, war aber nie deklariert — '
      + 'Endpunkt wird aus dem Anlagenkontext provisioniert (v9_provision.js).');
  });
  return identity;
}

function byNumeric(key) {
  return function (a, b) {
    return (toIntOrNull(a[key]) || 0) - (toIntOrNull(b[key]) || 0);
  };
}

function migrateControllers(legacy, identity, report) {
  const rows = [];
  Array.from(identity.keys()).sort(function (a, b) { return a - b; }).forEach(function (localId) {
    const ident = identity.get(localId);
    const src = isPlainObject(ident.source) ? ident.source : {};
    let busType = toText(src.bus_type) || 'modbus';
    if (ENUMS.bus_type.indexOf(busType) < 0) {
      note(report, 'repair', 'controllers',
        'bus_type "' + busType + '" nicht im V9-Enum — auf "modbus" gesetzt.',
        { controller_id: localId });
      busType = 'modbus';
    }
    rows.push(createController({
      controller_id: localId,
      controller_uuid: ident.controller_uuid,
      controller_key: ident.controller_key,
      device_name: ident.device_name,
      bus_type: busType,
      // Leer lassen: provisionController() unten leitet die Adresse aus dem
      // Adressmuster der Anlage ab, statt eine tote 0.0.0.0 einzutragen.
      host: toText(src.host),
      port: toIntOrNull(src.port) || 502,
      unit: toText(src.unit) || '0x1',
      tags: ensureArray(src.tags).map(toText)
    }, { siteId: ident.site_id, nodeId: ident.node_id }));
  });
  rows.forEach(function (row) {
    const filled = provisionController(row, rows.filter(function (item) {
      return item !== row;
    }), PROVISION_NOTE_CONTROLLER);
    if (filled.length) {
      note(report, 'repair', 'controllers',
        toText(row.controller_key) + ': Endpunkt aus dem Anlagenkontext provisioniert ('
        + filled.join(', ') + ').');
    }
  });
  note(report, 'info', 'controllers',
    'controller_uuid + controller_key additiv ergänzt (V9-Identitätsmodell).',
    { count: rows.length });
  return rows;
}

function buildRoutes(identity, siteId, nodeId) {
  return Array.from(identity.keys()).sort(function (a, b) { return a - b; })
    .map(function (localId) {
      const ident = identity.get(localId);
      return createRoute({
        local_controller_id: localId,
        node_id: ident.node_id,
        site_id: ident.site_id,
        controller_uuid: ident.controller_uuid,
        controller_key: ident.controller_key,
        routing_role: 'owner',
        enabled: true
      }, { siteId, nodeId });
    });
}

function migrateVirtualControllers(legacy, ctx, identity, report) {
  const rows = [];
  ensureArray(legacy.virtual_controllers).slice().sort(byNumeric('virt_controller_id'))
    .forEach(function (row) {
      const ident = identity.get(toIntOrNull(row.controller_id));
      if (!ident) {
        note(report, 'error', 'virtual_controllers',
          'controller_id nicht auflösbar — Zeile verworfen', row);
        return;
      }
      rows.push(createVirtualController(Object.assign({}, row,
        { controller_uuid: ident.controller_uuid }), ctx));
    });
  note(report, 'info', 'virtual_controllers',
    'controller_id -> controller_uuid ersetzt.', { count: rows.length });
  return rows;
}

function migrateIo(legacy, section, identity, ctx, report) {
  const isSensor = section === 'sensors';
  const idField = isSensor ? 'sensor_id' : 'actuator_id';
  const groupField = isSensor ? 'sensor_group' : 'actuator_group';
  const allowed = isSensor ? ENUMS.sensor_function_modbus : ENUMS.actuator_function_modbus;
  const factory = isSensor ? createSensor : createActuator;
  const rows = [];

  ensureArray(legacy[section]).slice().sort(byNumeric(idField)).forEach(function (row) {
    const ioId = toIntOrNull(row[idField]);
    const ident = identity.get(toIntOrNull(row.controller_id));
    if (ioId === null || ioId < 1) {
      note(report, 'error', section, idField + ' fehlt — Zeile verworfen', row);
      return;
    }
    if (!ident) {
      note(report, 'error', section,
        'controller_id ' + row.controller_id + ' nicht auflösbar — Zeile verworfen', row);
      return;
    }
    let functionType = toText(row.function_type);
    if (allowed.indexOf(functionType) < 0) {
      const mapped = FUNCTION_TYPE_REPAIR[functionType];
      const target = allowed.indexOf(mapped) >= 0 ? mapped : allowed[0];
      note(report, 'repair', section,
        'function_type "' + functionType + '" ist kein V9-Wert — auf "' + target + '" abgebildet.',
        { id: ioId });
      functionType = target;
    }
    const patch = {
      local_controller_id: ident.local_controller_id,
      controller_uuid: ident.controller_uuid,
      controller_key: ident.controller_key,
      node_id: ident.node_id,
      site_id: ident.site_id,
      enabled: true,
      address: toIntOrNull(row.address) === null ? 0 : toIntOrNull(row.address),
      bus_type: toText(row.bus_type) || 'modbus',
      function_type: functionType
    };
    patch[idField] = ioId;
    patch[groupField] = toText(row[groupField]) || (isSensor ? 'S1' : 'A');
    const profileId = toIntOrNull(row.profile_id);
    if (profileId !== null && profileId >= 1) patch.profile_id = profileId;
    rows.push(factory(patch, ctx));
  });

  rows.sort(function (a, b) {
    const delta = (toIntOrNull(a.local_controller_id) || 0) - (toIntOrNull(b.local_controller_id) || 0);
    return delta !== 0 ? delta : (toIntOrNull(a[idField]) || 0) - (toIntOrNull(b[idField]) || 0);
  });
  note(report, 'info', section,
    'Flaches V9-Layout; node_id/site_id/controller_uuid/controller_key/enabled denormalisiert. '
    + 'Die Felder ' + (isSensor ? 'sensor_number/sensor_type' : 'actuator_number/actuator_type')
    + ' entfallen (nicht Teil des V9-Vertrags).', { count: rows.length });
  return rows;
}

function copyTable(rows, fields) {
  return ensureArray(rows).filter(isPlainObject).map(function (row) {
    const out = {};
    fields.forEach(function (field) {
      if (row[field] !== undefined) out[field] = deepClone(row[field]);
    });
    return out;
  });
}

function migrateParameterTemplates(legacy, report) {
  const schemas = ensureArray(legacy.parameter_schemas);
  const mappingsIn = ensureArray(legacy.state_type_parameter_schema_mappings).slice()
    .sort(function (a, b) {
      const delta = (toIntOrNull(a.priority) || 0) - (toIntOrNull(b.priority) || 0);
      return delta !== 0 ? delta : (toIntOrNull(a.mapping_id) || 0) - (toIntOrNull(b.mapping_id) || 0);
    });

  const schemaIndex = new Map();
  const templates = [];
  let nextId = 1;

  mappingsIn.forEach(function (mapping) {
    const stateType = toText(mapping.state_type);
    const ref = toText(mapping.parameter_schema_id);
    if (!stateType || !ref || schemaIndex.has(ref)) return;
    const schema = schemas.filter(function (item) {
      return toText(item.parameter_schema_id) === ref;
    })[0];
    schemaIndex.set(ref, nextId);
    templates.push(createParameterTemplate({
      schema_id: nextId, state_type: stateType,
      description: toText((schema || {}).description) || stateType,
      fields: (schema || {}).fields,
      constraints: (schema || {}).constraints
    }));
    nextId += 1;
  });

  schemas.forEach(function (schema) {
    const ref = toText(schema.parameter_schema_id);
    if (!ref || schemaIndex.has(ref)) return;
    const derived = ref.replace(/^schema_/, '').split('_v')[0] || 'generic';
    schemaIndex.set(ref, nextId);
    templates.push(createParameterTemplate({
      schema_id: nextId, state_type: derived,
      description: toText(schema.description) || derived,
      fields: schema.fields,
      constraints: schema.constraints
    }));
    nextId += 1;
  });

  const mappings = [];
  const seen = new Set();
  mappingsIn.forEach(function (mapping) {
    const mappingId = toIntOrNull(mapping.mapping_id);
    const schemaId = schemaIndex.get(toText(mapping.parameter_schema_id));
    if (mappingId === null || schemaId === undefined || seen.has(mappingId)) return;
    seen.add(mappingId);
    mappings.push(createSchemaMapping({ mapping_id: mappingId, schema_id: schemaId }));
  });

  note(report, 'info', 'parameter_schemas',
    'Ersetzt durch parameter_generic_templates. fields/constraints bleiben additiv '
    + 'erhalten — der V9-Vertrag schreibt sie nicht vor, die Runtime akzeptiert sie.',
    { templates: templates.length });
  note(report, 'breaking', 'state_type_parameter_schema_mappings',
    'Ersetzt durch schema_mappings — match/priority/is_default entfallen, state_type wandert '
    + 'in parameter_generic_templates.', { mappings: mappings.length });

  return { templates, mappings, schemaIndex };
}

function migrateProcesses(legacy, nodeId, report, provision) {
  const rows = [];
  const known = new Set();
  ensureArray(legacy.processes).slice().sort(byNumeric('p_id')).forEach(function (row) {
    const pId = toIntOrNull(row.p_id);
    if (pId === null || pId < 1) return;
    known.add(pId);
    rows.push(createProcess(Object.assign({}, row, { p_id: pId }), { nodeId }));
  });
  if (provision) {
    const referenced = new Set();
    ensureArray(legacy.process_states).forEach(function (state) {
      const pId = toIntOrNull(isPlainObject(state) ? state.p_id : null);
      if (pId !== null && pId >= 1) referenced.add(pId);
    });
    Array.from(referenced).sort(function (a, b) { return a - b; }).forEach(function (pId) {
      if (known.has(pId)) return;
      const placeholder = createProcess({ p_id: pId }, { nodeId });
      const filled = provisionProcess(placeholder, rows, PROVISION_NOTE_PROCESS);
      rows.push(placeholder);
      note(report, 'repair', 'processes',
        'p_id ' + pId + ' wird von process_states referenziert, war aber nie deklariert — '
        + 'als reservierter Prozessplatz angelegt (' + filled.join(', ') + ').');
    });
  }
  note(report, 'info', 'processes', 'owner_node_id ergänzt (V9-Pflichtfeld).',
    { count: rows.length });
  return rows.sort(byNumeric('p_id'));
}

function migrateProcessStates(legacy, config, ctx, schemaIndex, report) {
  const mappingIds = new Set(ensureArray(config.schema_mappings)
    .map(function (row) { return toIntOrNull(row.mapping_id); }));
  const defaultMapping = Array.from(mappingIds).sort(function (a, b) { return a - b; })[0];
  const schemaToMapping = new Map();
  ensureArray(config.schema_mappings).forEach(function (row) {
    const schemaId = toIntOrNull(row.schema_id);
    if (!schemaToMapping.has(schemaId)) schemaToMapping.set(schemaId, toIntOrNull(row.mapping_id));
  });
  const processIds = new Set(ensureArray(config.processes)
    .map(function (row) { return toIntOrNull(row.p_id); }));
  const valueIds = new Set(ensureArray(config.process_values)
    .map(function (row) { return toIntOrNull(row.value_id); }));
  const modeIds = new Set(ensureArray(config.process_modes)
    .map(function (row) { return toIntOrNull(row.mode_id); }));
  const pidIds = new Set(ensureArray(config.pid_configs)
    .map(function (row) { return toIntOrNull(row.pid_config_id); }));
  const methodIds = new Set(ensureArray(config.control_methods)
    .map(function (row) { return toIntOrNull(row.method_id); }));

  const rows = [];
  ensureArray(legacy.process_states).slice().sort(byNumeric('state_id')).forEach(function (state) {
    const stateId = toIntOrNull(state.state_id);
    const pId = toIntOrNull(state.p_id);
    if (stateId === null || stateId < 1) {
      note(report, 'error', 'process_states', 'state_id ungültig — Zeile verworfen', state);
      return;
    }
    if (!processIds.has(pId)) {
      note(report, 'error', 'process_states',
        'p_id ' + pId + ' in state ' + stateId + ' existiert nicht — Zeile verworfen');
      return;
    }

    let mappingId = toIntOrNull(state.mapping_id);
    if (!mappingIds.has(mappingId)) {
      const schemaId = schemaIndex.get(toText(state.parameter_schema_id));
      mappingId = schemaToMapping.has(schemaId) ? schemaToMapping.get(schemaId) : defaultMapping;
    }

    let valueId = toIntOrNull(state.value_id);
    if (!valueIds.has(valueId)) {
      note(report, 'repair', 'process_states',
        'value_id in state ' + stateId + ' unbekannt — auf 1 gesetzt.');
      valueId = 1;
    }
    let modeId = toIntOrNull(state.mode_id);
    if (!modeIds.has(modeId)) {
      note(report, 'repair', 'process_states',
        'mode_id in state ' + stateId + ' unbekannt — auf 2 gesetzt.');
      modeId = 2;
    }

    const parameters = {};
    const raw = isPlainObject(state.parameters) ? state.parameters
      : (isPlainObject(state.automation_parameters) ? state.automation_parameters : {});
    Object.keys(raw).forEach(function (key) {
      if (['control_method', 'pid_config_id', 'pid_parameters',
        'heating_control_method'].indexOf(key) >= 0) return;
      const value = raw[key];
      parameters[key] = (typeof value === 'boolean' || typeof value === 'number')
        ? value : toText(value);
    });

    const strategy = normalizeLegacyStrategy(state, pidIds, methodIds, report);
    rows.push(createProcessState({
      state_id: stateId, p_id: pId, value_id: valueId, mode_id: modeId,
      mapping_id: mappingId,
      io_refs: {
        sensors: ensureArray(state.sensor_ids).concat(ensureArray(state.sensor_id)),
        actuators: ensureArray(state.actuator_ids).concat(ensureArray(state.actuator_id))
      },
      control_strategy: strategy,
      setpoint_source: state.setpoint_source === undefined ? null : state.setpoint_source,
      parameters
    }, ctx));
  });

  note(report, 'breaking', 'process_states',
    'sensor_ids/actuator_ids -> io_refs{sensors[],actuators[]} mit controller_uuid; '
    + 'parameter_schema_id -> mapping_id; state_type entfällt (wandert nach '
    + 'parameter_generic_templates); automation_parameters -> parameters.',
    { count: rows.length });
  return rows;
}

function normalizeLegacyStrategy(state, pidIds, methodIds, report) {
  const legacy = isPlainObject(state.control_strategy) ? state.control_strategy : {};
  const params = isPlainObject(state.automation_parameters) ? state.automation_parameters : {};
  const rawType = toText(legacy.type || params.control_method).trim();
  const stateId = toIntOrNull(state.state_id);

  if (rawType.indexOf('method:') === 0) {
    const methodId = toIntOrNull(rawType.split(':')[1]);
    if (methodIds.has(methodId)) return { type: 'control_method', method_id: methodId };
    note(report, 'repair', 'process_states',
      'control_method ' + methodId + ' in state ' + stateId + ' unbekannt — null gesetzt.');
    return null;
  }
  const upper = rawType.toUpperCase();
  if (['PID', 'PI', 'PD', 'P'].indexOf(upper) >= 0) {
    let pidConfigId = toIntOrNull(legacy.pid_config_id !== undefined
      ? legacy.pid_config_id : params.pid_config_id);
    if (!pidIds.has(pidConfigId)) {
      pidConfigId = Array.from(pidIds).sort(function (a, b) { return a - b; })[0];
      note(report, 'repair', 'process_states',
        'pid_config_id in state ' + stateId + ' fehlte/unbekannt — auf '
        + pidConfigId + ' gesetzt.');
    }
    if (pidConfigId === undefined || pidConfigId === null) return null;
    if (upper !== 'PID') {
      note(report, 'repair', 'process_states',
        'control_strategy.type "' + upper + '" in state ' + stateId
        + ' ist nicht V9-legal — auf "PID" normiert.');
    }
    return createControlStrategy(Object.assign({}, legacy,
      { type: 'PID', pid_config_id: pidConfigId }));
  }
  if (['ONOFF', 'ON_OFF', 'ON-OFF', 'TWO_POINT'].indexOf(upper) >= 0) {
    note(report, 'breaking', 'process_states',
      'control_strategy.type "' + upper + '" in state ' + stateId + ' ist kein V9-Typ '
      + '(Union kennt nur PID|control_method) — auf null gesetzt. Die Runtime wählt den Zweipunktregler '
      + 'weiterhin per Auto-Detect über write_coil-Aktoren.');
    return null;
  }
  if (rawType) {
    note(report, 'repair', 'process_states',
      'control_strategy.type "' + rawType + '" in state ' + stateId + ' unbekannt — null gesetzt.');
  }
  return null;
}

function migrateFilters(legacy, ctx, report) {
  const filters = [];
  const alias = new Map();
  let nextId = 1;

  ensureArray(legacy.automation_filters).forEach(function (row) {
    if (!isPlainObject(row)) return;
    const legacyId = toText(row.filter_id);
    const numeric = toIntOrNull(row.filter_id);
    const filterId = (numeric !== null && numeric >= 1) ? numeric : nextId;
    nextId = Math.max(nextId, filterId + 1);
    alias.set(legacyId, filterId);

    const sensorIds = ensureArray(isPlainObject(row.apply_to) ? row.apply_to.sensor_ids : []);
    const refs = createIoRefs({ sensors: sensorIds }, ctx).sensors;
    if (!refs.length) {
      note(report, 'error', 'filters',
        'Filter "' + legacyId + '" ohne auflösbare sensor_refs — verworfen '
        + '(V9 verlangt min_len 1).');
      return;
    }
    if (!ensureArray(row.chain).length) {
      note(report, 'error', 'filters',
        'Filter "' + legacyId + '" ohne chain — verworfen (V9 verlangt min_len 1).');
      return;
    }
    filters.push(createFilter({ filter_id: filterId, sensor_refs: refs, chain: row.chain }, ctx));
  });

  note(report, 'breaking', 'automation_filters',
    'Umbenannt zu "filters"; filter_id String -> int; '
    + 'apply_to.sensor_ids -> sensor_refs[{controller_uuid, sensor_id}].',
    { alias: Object.fromEntries(alias) });
  return { filters: filters.sort(byNumeric('filter_id')), alias };
}

function migrateRuleEngine(legacy, config, report) {
  const source = ensureArray(legacy.automation_engines)[0] || {};
  const safety = isPlainObject(source.safety) ? source.safety : {};
  const defaults = isPlainObject(source.defaults) ? source.defaults : {};
  const fallbackValueId = toIntOrNull(safety.default_state_value_id) || 2;

  note(report, 'breaking', 'automation_engines',
    'Ersetzt durch "rule_engine" (Singleton). engine_id String -> int, debug_*-Flachfelder '
    + '-> debug{}, safety.* -> safety.on_missing_sensor/on_invalid_pid, runtime{} ergänzt.');
  note(report, 'breaking', 'automation',
    'Profil-Sektion entfällt ersatzlos — V9 hat genau eine rule_engine.');

  return createRuleEngine({
    engine_id: 1,
    required_mode_id: toIntOrNull(source.required_mode_id),
    enabled: true,
    sp_tolerance: toNumberOrNull(source.sp_tolerance),
    defaults: {
      eval: toText(defaults.evaluation_mode) || 'on_event',
      exec: toText(defaults.exec_mode) || 'parallel',
      priority: toIntOrNull(defaults.priority) === null ? 100 : toIntOrNull(defaults.priority)
    },
    safety: {
      max_output_delta_per_step: toNumberOrNull(safety.max_output_delta_per_step) === null
        ? 2.0 : toNumberOrNull(safety.max_output_delta_per_step),
      on_missing_sensor: { value_id: fallbackValueId },
      on_invalid_pid: { value_id: fallbackValueId }
    },
    debug: {
      control: toBool(source.debug_control, false),
      pid: toBool(source.debug_pid, false),
      pid_state_ids: uniqInts(source.debug_pid_state_ids),
      pid_interval_s: toNumberOrNull(source.debug_pid_interval_s) === null
        ? 1.0 : toNumberOrNull(source.debug_pid_interval_s),
      pid_saturation_interval_s: toNumberOrNull(source.debug_pid_saturation_interval_s) === null
        ? 10.0 : toNumberOrNull(source.debug_pid_saturation_interval_s),
      log: [['transitions', source.debug_pid_log_transitions],
        ['saturation', source.debug_pid_log_saturation],
        ['clamps', source.debug_pid_log_clamps]]
        .filter(function (entry) { return Boolean(entry[1]); })
        .map(function (entry) { return entry[0]; })
    }
  }, createContext(config));
}

function migrateRules(legacy, config, filterAlias, nodeId, report) {
  const ctx = createContext(config);
  const stateIds = new Set(ensureArray(config.process_states)
    .map(function (row) { return toIntOrNull(row.state_id); }));
  const processIds = new Set(ensureArray(config.processes)
    .map(function (row) { return toIntOrNull(row.p_id); }));
  const valueIds = new Set(ensureArray(config.process_values)
    .map(function (row) { return toIntOrNull(row.value_id); }));
  const filterIds = new Set(ensureArray(config.filters)
    .map(function (row) { return toIntOrNull(row.filter_id); }));
  const timerIds = new Set(ensureArray(config.timers)
    .map(function (row) { return toIntOrNull(row.timer_id); }));
  const sensorsById = new Map();
  ensureArray(config.sensors).forEach(function (row) {
    sensorsById.set(toIntOrNull(row.sensor_id), row);
  });
  const stateByActuator = new Map();
  ensureArray(config.process_states).forEach(function (state) {
    ensureArray((isPlainObject(state.io_refs) ? state.io_refs : {}).actuators)
      .forEach(function (ref) {
        const key = toIntOrNull(ref.actuator_id);
        if (!stateByActuator.has(key)) stateByActuator.set(key, []);
        stateByActuator.get(key).push(toIntOrNull(state.state_id));
      });
  });

  const rows = [];
  let nextRuleId = 1;

  ensureArray(legacy.automation_rule_sets).forEach(function (ruleSet) {
    const setId = toText(isPlainObject(ruleSet) ? ruleSet.rule_set_id : '') || 'main';
    ensureArray(isPlainObject(ruleSet) ? ruleSet.rules : []).forEach(function (rule) {
      if (!isPlainObject(rule)) return;
      let ruleId = toIntOrNull(rule.rule_id);
      if (ruleId === null || rows.some(function (r) { return r.rule_id === ruleId; })) {
        ruleId = nextRuleId;
      }
      nextRuleId = Math.max(nextRuleId, ruleId + 1);
      const context = 'rule_set "' + setId + '" / rule ' + ruleId;

      const conditions = [];
      ['when_all', 'when'].forEach(function (bucket) {
        ensureArray(rule[bucket]).forEach(function (cond) {
          const converted = convertLegacyCondition(cond, {
            stateIds, sensorsById, filterAlias, filterIds, timerIds, ctx, context, report
          });
          if (converted) conditions.push(converted);
        });
      });
      ['when_any', 'when_none'].forEach(function (bucket) {
        if (ensureArray(rule[bucket]).length) {
          note(report, 'breaking', 'rules',
            context + ': "' + bucket + '" existiert in V9 nicht (nur when[]=UND und until[]) '
            + '— Bedingungen verworfen.');
        }
      });
      if (!conditions.length) {
        note(report, 'error', 'rules', context + ': keine V9-abbildbare Bedingung — verworfen.');
        return;
      }

      const actions = [];
      ensureArray(rule.do).forEach(function (action) {
        const converted = convertLegacyAction(action, {
          stateIds, processIds, valueIds, stateByActuator, context, report
        });
        if (converted) actions.push(converted);
      });
      if (!actions.length) {
        note(report, 'error', 'rules', context + ': keine V9-abbildbare Aktion — verworfen.');
        return;
      }
      const elseActions = [];
      ensureArray(rule.else_do).forEach(function (action) {
        const converted = convertLegacyAction(action, {
          stateIds, processIds, valueIds, stateByActuator, context, report
        });
        if (converted) elseActions.push(converted);
      });

      const execution = isPlainObject(rule.execution) ? rule.execution : {};
      const flags = isPlainObject(rule.flags) ? rule.flags : {};
      const enabled = flags.enabled === undefined ? true : toBool(flags.enabled, true);

      rows.push(createRule({
        rule_id: ruleId,
        engine_id: 1,
        owner_node_id: nodeId,
        execution_owner: nodeId,
        execution_scope: executionScopeFor(nodeId),
        execution_epoch: enabled ? 1 : 0,
        deployment_status: enabled ? 'active_node' : 'disabled_with_reason',
        activation_state: enabled ? 'active' : 'inactive',
        disabled_reason: enabled ? '' : 'Migration V50->V9: Regel war deaktiviert',
        group: 'process',
        priority: toIntOrNull(execution.priority) === null ? 100 : toIntOrNull(execution.priority),
        name: toText(rule.rule_name || rule.name) || 'rule_' + ruleId,
        enabled,
        when: conditions,
        do: actions,
        else_do: elseActions,
        description: toText(rule.description)
      }, ctx));
    });
  });

  note(report, 'breaking', 'automation_rule_sets',
    'Ersetzt durch flache "rules"-Tabelle + "rule_engine". Entfallen: rule_set-Hierarchie, '
    + 'process_scope{}, execution{}, flags{one_shot,reset_mode}, when_any[], when_none[]. '
    + 'Neu (V9-Pflicht): owner_node_id, execution_owner, execution_scope, execution_epoch, '
    + 'deployment_status, activation_state, group, priority.', { count: rows.length });
  note(report, 'breaking', 'dynamic_rule_engine',
    'Sektion existiert im V9-Vertrag nicht mehr; Inhalte gehören in "rules" bzw. bleiben '
    + 'Editor-Bibliothek.');
  return rows.sort(byNumeric('rule_id'));
}

function convertLegacyCondition(cond, env) {
  if (!isPlainObject(cond)) {
    note(env.report, 'breaking', 'rules',
      env.context + ': String-Expression ist in V9 nicht abbildbar — verworfen.', cond);
    return null;
  }
  const type = toText(cond.type);

  if (type === 'state_value' || cond.state_id !== undefined) {
    const stateId = toIntOrNull(cond.state_id);
    if (!env.stateIds.has(stateId)) {
      note(env.report, 'error', 'rules',
        env.context + ': state_id ' + stateId + ' existiert nicht — Bedingung verworfen.');
      return null;
    }
    const value = toIntOrNull(cond.equals !== undefined ? cond.equals : cond.value);
    if (value === null) {
      note(env.report, 'error', 'rules',
        env.context + ': state-Bedingung ohne Vergleichswert — verworfen.');
      return null;
    }
    return createCondition({ src: 'state', state_id: stateId,
      field: toText(cond.field) || 'value_id',
      op: OPERATOR_REPAIR[toText(cond.op || cond.operator)] || '==', value }, env.ctx);
  }

  if (type === 'sensor_threshold' || type === 'sensor' || cond.sensor_id !== undefined) {
    const sensorId = toIntOrNull(cond.sensor_id);
    const sensor = env.sensorsById.get(sensorId);
    if (!sensor) {
      note(env.report, 'error', 'rules',
        env.context + ': sensor_id ' + sensorId + ' existiert nicht — Bedingung verworfen.');
      return null;
    }
    let op = toText(cond.op || cond.operator);
    let value = cond.value;
    [['ge', '>='], ['gt', '>'], ['le', '<='], ['lt', '<']].forEach(function (entry) {
      if (cond[entry[0]] !== undefined) { op = entry[1]; value = cond[entry[0]]; }
    });
    op = OPERATOR_REPAIR[op] || op || '>=';
    if (ENUMS.rule_op.indexOf(op) < 0) {
      note(env.report, 'repair', 'rules',
        env.context + ': Operator "' + op + '" nicht im V9-Enum — auf ">=" gesetzt.');
      op = '>=';
    }
    const numeric = toNumberOrNull(value);
    if (numeric === null) {
      note(env.report, 'breaking', 'rules',
        env.context + ': Formel-/String-Vergleichswert "' + value + '" ist in V9 nicht zulässig '
        + '(value muss number|bool|{param_of_state,key}) — Bedingung verworfen.');
      return null;
    }
    const rawFilter = cond.filter_id;
    const filterId = env.filterAlias.has(toText(rawFilter))
      ? env.filterAlias.get(toText(rawFilter)) : toIntOrNull(rawFilter);
    const patch = { src: 'sensor', sensor_id: sensorId,
      controller_uuid: toText(sensor.controller_uuid), op, value: numeric };
    if (env.filterIds.has(filterId)) patch.filter_id = filterId;
    if (toNumberOrNull(cond.cooldown_s) !== null) patch.cooldown_s = toNumberOrNull(cond.cooldown_s);
    return createCondition(patch, env.ctx);
  }

  if (type === 'timer' || cond.timer_id !== undefined) {
    const timerId = toIntOrNull(cond.timer_id);
    if (!env.timerIds.has(timerId)) {
      note(env.report, 'error', 'rules',
        env.context + ': timer_id ' + timerId + ' existiert nicht — Bedingung verworfen.');
      return null;
    }
    return createCondition({ src: 'timer', timer_id: timerId,
      op: toText(cond.op) === 'fired' ? 'fired' : 'elapsed',
      value: toNumberOrNull(cond.value) === null ? 0 : toNumberOrNull(cond.value) }, env.ctx);
  }

  note(env.report, 'breaking', 'rules',
    env.context + ': Bedingungstyp "' + type + '" hat keine V9-Entsprechung '
    + '(V9 kennt nur src=state|sensor|timer) — verworfen.', cond);
  return null;
}

function convertLegacyAction(action, env) {
  if (!isPlainObject(action)) return null;
  const kind = toText(action.action || action.type);

  if (kind === 'notify') {
    const message = toText(action.notify || action.message);
    return message ? { notify: message } : null;
  }

  if (action.state_ids !== undefined
      || ['process_state_set_value', 'process_state_set_active'].indexOf(kind) >= 0) {
    const ids = uniqInts(ensureArray(action.state_ids).concat(ensureArray(action.state_id)))
      .filter(function (id) { return env.stateIds.has(id); });
    if (!ids.length) {
      note(env.report, 'error', 'rules', env.context + ': Aktion ohne gültige state_ids — verworfen.');
      return null;
    }
    return createAction(Object.assign({}, action, { state_ids: ids,
      value_id: resolveValueId(action, env) }));
  }

  if (action.p_ids !== undefined
      || ['process_set_value', 'process_set_active'].indexOf(kind) >= 0) {
    const ids = uniqInts(ensureArray(action.p_ids).concat(ensureArray(action.p_id)))
      .filter(function (id) { return env.processIds.has(id); });
    if (!ids.length) return null;
    return createAction({ p_ids: ids, value_id: resolveValueId(action, env) });
  }

  if (kind === 'actuator_set') {
    const actuatorId = toIntOrNull(action.actuator_id);
    const owners = env.stateByActuator.get(actuatorId) || [];
    if (owners.length) {
      note(env.report, 'breaking', 'rules',
        env.context + ': "actuator_set" (actuator_id=' + actuatorId + ') existiert in V9 nicht — '
        + 'Aktionen adressieren States. Ueber io_refs aufgelöst auf state_ids='
        + owners.join(',') + '.');
      const value = toNumberOrNull(action.value);
      return createAction({ state_ids: owners, value_id: value ? 1 : 2 });
    }
    note(env.report, 'breaking', 'rules',
      env.context + ': "actuator_set" (actuator_id=' + actuatorId + ') nicht über io_refs '
      + 'auflösbar — verworfen.');
    return null;
  }

  note(env.report, 'breaking', 'rules',
    env.context + ': Aktionstyp "' + kind + '" hat keine V9-Entsprechung — verworfen.', action);
  return null;
}

function resolveValueId(action, env) {
  let valueId = toIntOrNull(action.value_id);
  if (valueId === null && action.active !== undefined) valueId = toBool(action.active, false) ? 1 : 2;
  return env.valueIds.has(valueId) ? valueId : undefined;
}

/* =========================================================================
 * 2. V9 -> Editor-Projektion
 * ====================================================================== */

/**
 * Projiziert eine V9-Config in die von den Altmodulen erwartete Form.
 * Alle V9-Sektionen bleiben zusätzlich erhalten; `__v9` trägt die Quelle.
 */
export function toEditorProjection(config) {
  const cfg = isPlainObject(config) ? config : emptyConfig();
  const controllersByUuid = indexBy(cfg.controllers, 'controller_uuid');
  const localIdByUuid = new Map();
  ensureArray(cfg.controllers).forEach(function (row) {
    localIdByUuid.set(toText(row.controller_uuid), toIntOrNull(row.controller_id));
  });
  const templatesById = indexBy(cfg.parameter_generic_templates, 'schema_id');
  const mappingsById = indexBy(cfg.schema_mappings, 'mapping_id');

  const view = deepClone(cfg);
  view.__v9 = deepClone(cfg);
  view.schema_version = 9;

  view.controllers = ensureArray(cfg.controllers).map(function (row) {
    return Object.assign({}, row, { controller_id: toIntOrNull(row.controller_id) });
  });
  view.virtual_controllers = ensureArray(cfg.virtual_controllers).map(function (row) {
    return Object.assign({}, row,
      { controller_id: localIdByUuid.get(toText(row.controller_uuid)) });
  });

  ['sensors', 'actuators'].forEach(function (section) {
    const idField = section === 'sensors' ? 'sensor_id' : 'actuator_id';
    const numberField = section === 'sensors' ? 'sensor_number' : 'actuator_number';
    view[section] = ensureArray(cfg[section]).map(function (row, index) {
      const patch = Object.assign({}, row);
      patch.controller_id = localIdByUuid.get(toText(row.controller_uuid));
      patch[numberField] = index + 1;
      patch[idField] = toIntOrNull(row[idField]);
      return patch;
    });
  });

  view.process_states = ensureArray(cfg.process_states).map(function (state) {
    const refs = isPlainObject(state.io_refs) ? state.io_refs : {};
    const mapping = mappingsById.get(toIntOrNull(state.mapping_id));
    const template = mapping ? templatesById.get(toIntOrNull(mapping.schema_id)) : null;
    const stateType = template ? toText(template.state_type) : '';
    return Object.assign({}, state, {
      state_type: stateType,
      p__type: stateType,
      sensor_ids: ensureArray(refs.sensors).map(function (r) { return toIntOrNull(r.sensor_id); }),
      actuator_ids: ensureArray(refs.actuators)
        .map(function (r) { return toIntOrNull(r.actuator_id); }),
      sensor_id: ensureArray(refs.sensors).map(function (r) { return toIntOrNull(r.sensor_id); }),
      actuator_id: ensureArray(refs.actuators)
        .map(function (r) { return toIntOrNull(r.actuator_id); }),
      parameter_schema_id: template ? 'schema_' + toText(template.state_type) : '',
      automation_parameters: deepClone(state.parameters || {})
    });
  });

  view.parameter_schemas = ensureArray(cfg.parameter_generic_templates).map(function (row) {
    return {
      parameter_schema_id: 'schema_' + toText(row.state_type),
      schema_id: toIntOrNull(row.schema_id),
      description: toText(row.description),
      // Nicht mehr leer: was der Editor hier pflegt, überlebt jetzt den
      // Rundlauf Projektion -> V9 -> Projektion.
      fields: deepClone(ensureArray(row.fields)),
      constraints: deepClone(ensureArray(row.constraints))
    };
  });
  view.state_type_parameter_schema_mappings = ensureArray(cfg.schema_mappings)
    .map(function (row) {
      const template = templatesById.get(toIntOrNull(row.schema_id));
      return {
        mapping_id: toIntOrNull(row.mapping_id),
        schema_id: toIntOrNull(row.schema_id),
        state_type: template ? toText(template.state_type) : '',
        parameter_schema_id: template ? 'schema_' + toText(template.state_type) : '',
        match: {}, priority: 10, is_default: false
      };
    });

  view.automation_filters = ensureArray(cfg.filters).map(function (row) {
    return {
      filter_id: toIntOrNull(row.filter_id),
      apply_to: { sensor_ids: ensureArray(row.sensor_refs)
        .map(function (ref) { return toIntOrNull(ref.sensor_id); }) },
      chain: deepClone(row.chain)
    };
  });

  const engine = ensureArray(cfg.rule_engine)[0] || {};
  view.automation_engines = [{
    engine_id: toIntOrNull(engine.engine_id) || 1,
    required_mode_id: toIntOrNull(engine.required_mode_id),
    sp_tolerance: toNumberOrNull(engine.sp_tolerance),
    debug_control: Boolean((engine.debug || {}).control),
    debug_pid: Boolean((engine.debug || {}).pid),
    debug_pid_state_ids: ensureArray((engine.debug || {}).pid_state_ids),
    safety: deepClone(engine.safety || {}),
    defaults: deepClone(engine.defaults || {})
  }];
  view.automation = [{
    automation_id: 'default',
    description: 'Aus V9 rule_engine projiziert',
    enabled: engine.enabled !== false,
    engine_ids: [toIntOrNull(engine.engine_id) || 1],
    filter_ids: ensureArray(cfg.filters).map(function (row) { return toIntOrNull(row.filter_id); }),
    automation_rule_set_ids: ['main']
  }];
  view.automation_rule_sets = [{
    rule_set_id: 'main',
    rule_set_name: 'main',
    engine_id: toIntOrNull(engine.engine_id) || 1,
    rules: ensureArray(cfg.rules).map(function (rule) {
      return {
        rule_id: toIntOrNull(rule.rule_id),
        rule_name: toText(rule.name),
        description: toText(rule.description),
        process_scope: { p_ids: [], state_ids: [], modes: [], selectors: {} },
        execution: { evaluation_mode: 'on_event', exec_mode: 'parallel',
          priority: toIntOrNull(rule.priority) },
        flags: { enabled: rule.enabled !== false, one_shot: false,
          one_shot_scope: 'rule', reset_mode: 'never' },
        when_all: ensureArray(rule.when).map(conditionToLegacy),
        when_any: [], when_none: [],
        do: ensureArray(rule.do).map(actionToLegacy),
        else_do: ensureArray(rule.else_do).map(actionToLegacy),
        __v9: deepClone(rule)
      };
    })
  }];

  // Sektionen, die es in V9 nicht mehr gibt — als leere Listen, damit die
  // Altmodule ohne Aenderung weiterlaufen.
  ['node_registrar', 'controller_node_bindings', 'event_types',
    'triggers', 'actions', 'transitions', 'events'].forEach(function (section) {
    if (!Array.isArray(view[section])) view[section] = [];
  });
  if (!isPlainObject(view.dynamic_rule_engine)) view.dynamic_rule_engine = { rule_sets: [] };
  return view;
}

function conditionToLegacy(cond) {
  if (toText(cond.src) === 'state') {
    return { type: 'state_value', state_id: toIntOrNull(cond.state_id), equals: cond.value };
  }
  if (toText(cond.src) === 'timer') {
    return { type: 'timer', timer_id: toIntOrNull(cond.timer_id), op: toText(cond.op) };
  }
  return {
    type: 'sensor_threshold',
    sensor_id: toIntOrNull(cond.sensor_id),
    ge: cond.value,
    op: toText(cond.op),
    filter_id: cond.filter_id === undefined ? null : toIntOrNull(cond.filter_id)
  };
}

function actionToLegacy(action) {
  if (action.notify !== undefined) return { action: 'notify', message: toText(action.notify) };
  if (Array.isArray(action.state_ids)) {
    return { action: 'process_state_set_value', state_ids: action.state_ids.slice(),
      value_id: toIntOrNull(action.value_id) };
  }
  if (Array.isArray(action.p_ids)) {
    return { action: 'process_set_value', p_ids: action.p_ids.slice(),
      value_id: toIntOrNull(action.value_id) };
  }
  return { action: 'notify', message: '' };
}

/* =========================================================================
 * 3. Editor-Projektion -> V9
 * ====================================================================== */

/**
 * Führt eine im Alt-UI bearbeitete Projektion in den V9-Vertrag zurück.
 * `base` liefert die kanonischen Teile, die das Alt-UI nicht kennt.
 */
export function fromEditorProjection(view, base) {
  const source = isPlainObject(view) ? view : {};
  const fallback = isPlainObject(base) ? base
    : (isPlainObject(source.__v9) ? source.__v9 : emptyConfig());
  const config = orderSections(deepClone(fallback));

  ['meta', 'sites', 'nodes', 'local_node', 'site_controller_map', 'modbus_functions',
    'scaling_profiles', 'sensor_types', 'actuator_types', 'process_values', 'process_modes',
    'pid_configs', 'control_method_templates', 'control_methods', 'timers'].forEach(
    function (section) {
      if (Array.isArray(source[section])) config[section] = deepClone(source[section]);
    });

  const ctx0 = createContext(config);
  if (Array.isArray(source.controllers)) {
    config.controllers = source.controllers.map(function (row) {
      return createController(row, ctx0);
    });
  }
  reconcile(config);

  const ctx = createContext(config);
  if (Array.isArray(source.virtual_controllers)) {
    config.virtual_controllers = source.virtual_controllers.map(function (row) {
      return createVirtualController(row, ctx);
    });
  }
  if (Array.isArray(source.sensors)) {
    config.sensors = source.sensors.map(function (row) { return createSensor(row, ctx); });
  }
  if (Array.isArray(source.actuators)) {
    config.actuators = source.actuators.map(function (row) { return createActuator(row, ctx); });
  }
  if (Array.isArray(source.processes)) {
    config.processes = source.processes.map(function (row) {
      return createProcess(row, ctx);
    });
  }

  if (Array.isArray(source.parameter_generic_templates)) {
    config.parameter_generic_templates = source.parameter_generic_templates
      .map(createParameterTemplate);
  }
  // Der Bestands-Tab in automation_tabs.js pflegt `parameter_schemas[].fields`
  // und `.constraints`. Die Projektion trägt beide Sichten nebeneinander, also
  // gewinnt die V9-Sicht bei Struktur und Identität — die Legacy-Sicht liefert
  // aber die Zusatzfelder nach. Ohne diese Überlagerung wäre der Legacy-Tab
  // eine Oberfläche, deren Eingaben beim Speichern spurlos verschwinden.
  if (Array.isArray(source.parameter_schemas)) {
    const extrasByRef = new Map();
    source.parameter_schemas.forEach(function (row) {
      extrasByRef.set(toIntOrNull(row.schema_id), row);
      extrasByRef.set(toText(row.parameter_schema_id), row);
    });
    config.parameter_generic_templates = ensureArray(config.parameter_generic_templates)
      .map(function (row) {
        const extra = extrasByRef.get(toIntOrNull(row.schema_id))
          || extrasByRef.get('schema_' + toText(row.state_type));
        if (!extra) return row;
        return createParameterTemplate({
          schema_id: row.schema_id,
          state_type: row.state_type,
          description: toText(extra.description) || toText(row.description),
          fields: ensureArray(extra.fields).length ? extra.fields : row.fields,
          constraints: ensureArray(extra.constraints).length
            ? extra.constraints : row.constraints
        });
      });
  }
  if (Array.isArray(source.schema_mappings)) {
    config.schema_mappings = source.schema_mappings.map(createSchemaMapping);
  }

  const stateCtx = createContext(config);
  if (Array.isArray(source.process_states)) {
    config.process_states = source.process_states.map(function (state) {
      const refs = isPlainObject(state.io_refs) && ensureArray(state.io_refs.sensors).length
        + ensureArray(state.io_refs.actuators).length > 0
        ? state.io_refs
        : { sensors: state.sensor_ids || state.sensor_id,
          actuators: state.actuator_ids || state.actuator_id };
      return createProcessState(Object.assign({}, state, { io_refs: refs }), stateCtx);
    });
  }
  if (Array.isArray(source.filters)) {
    config.filters = source.filters.map(function (row) { return createFilter(row, stateCtx); });
  }
  if (Array.isArray(source.rule_engine)) {
    config.rule_engine = [createRuleEngine(source.rule_engine[0], stateCtx)];
  }

  const ruleCtx = createContext(config);
  if (Array.isArray(source.rules)) {
    config.rules = source.rules.map(function (rule) { return createRule(rule, ruleCtx); });
  } else if (Array.isArray(source.automation_rule_sets)) {
    const collected = [];
    source.automation_rule_sets.forEach(function (ruleSet) {
      ensureArray(ruleSet.rules).forEach(function (rule) {
        if (isPlainObject(rule.__v9)) collected.push(createRule(rule.__v9, ruleCtx));
      });
    });
    if (collected.length) config.rules = collected;
  }

  reconcile(config);
  return orderSections(config);
}
