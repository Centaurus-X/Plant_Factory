/**
 * logic_core.js — PF-LOGIC-V1 canonical model, validator and compilers.
 *
 * The logic graph is stored once in the project model. Plant, HMI and logic
 * editors only project views onto that model. Runtime and PLC artifacts are
 * deterministic derived products and are never edited as a second truth.
 */

'use strict';

import {
  LOGIC_LIBRARY,
  LOGIC_STANDARD,
  LOGIC_BLOCKS,
  LOGIC_TARGETS
} from './logic_library.js';

export const LOGIC_MODEL_VERSION = 1;
export const LOGIC_STANDARD_ID = 'PF-LOGIC-V1';
export const LOGIC_GENERATED_PREFIX = '[PF-LOGIC:';
export const LOGIC_MAX_DNF_CLAUSES = 64;

const blockIndex = new Map();
LOGIC_BLOCKS.forEach(function (block) {
  blockIndex.set(block.block_type, block);
});

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toText(value, fallback) {
  const text = value == null ? '' : String(value).trim();
  return text || (fallback == null ? '' : String(fallback));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function booleanValue(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return Boolean(fallback);
}

function stableTextCompare(left, right) {
  return String(left).localeCompare(String(right), 'de', { numeric: true });
}

function nowIso() {
  return new Date().toISOString();
}

export function generateLogicId(prefix) {
  const base = toText(prefix, 'logic');
  const random = Math.random().toString(36).slice(2, 9);
  return base + '_' + Date.now().toString(36) + '_' + random;
}

export function logicBlockDefinition(blockType) {
  return blockIndex.get(toText(blockType, '')) || null;
}

export function logicBlockLibrary() {
  return cloneValue(LOGIC_LIBRARY);
}

export function createEmptyLogicModel() {
  return {
    version: LOGIC_MODEL_VERSION,
    standard: cloneValue(LOGIC_STANDARD),
    active_diagram_id: null,
    diagrams: [],
    target_ownership: {},
    settings: {
      strict_types: true,
      reject_cycles: true,
      max_dnf_clauses: LOGIC_MAX_DNF_CLAUSES
    }
  };
}

export function createLogicDiagram(options) {
  const source = isObject(options) ? options : {};
  const diagramId = toText(source.diagram_id, generateLogicId('diagram'));
  const owner = toText(source.owner_node_id, 'fn-01');
  return {
    diagram_id: diagramId,
    name: toText(source.name, 'Schaltplan'),
    category: toText(source.category, 'Schaltpläne'),
    description: toText(source.description, ''),
    enabled: source.enabled !== false,
    target_profile: toText(source.target_profile, 'universal'),
    execution: {
      scope_kind: toText((source.execution || {}).scope_kind, 'node_local'),
      owner_node_id: toText((source.execution || {}).owner_node_id, owner),
      engine_id: integerValue((source.execution || {}).engine_id, 1),
      priority: integerValue((source.execution || {}).priority, 500)
    },
    viewport: {
      zoom: finiteNumber((source.viewport || {}).zoom, 1),
      scroll_x: finiteNumber((source.viewport || {}).scroll_x, 0),
      scroll_y: finiteNumber((source.viewport || {}).scroll_y, 0)
    },
    nodes: [],
    edges: [],
    created_at: toText(source.created_at, nowIso()),
    updated_at: toText(source.updated_at, nowIso())
  };
}

function defaultNodeSize(blockType) {
  if (blockType === 'signal_in' || blockType === 'signal_out') return { width: 190, height: 86 };
  if (blockType === 'state_write' || blockType === 'state_parameter'
      || blockType === 'actuator_write' || blockType === 'hmi_write'
      || blockType === 'notify') return { width: 218, height: 112 };
  if (blockType === 'ton' || blockType === 'tof' || blockType === 'tp'
      || blockType === 'ctu' || blockType === 'ctd') return { width: 176, height: 142 };
  return { width: 154, height: 112 };
}

export function createLogicNode(blockType, x, y, options) {
  const definition = logicBlockDefinition(blockType);
  if (!definition) throw new Error('Unbekannter Logikbaustein: ' + blockType);
  const source = isObject(options) ? options : {};
  const size = defaultNodeSize(blockType);
  const config = Object.assign({}, cloneValue(definition.defaults || {}), cloneValue(source.config || {}));
  return {
    node_id: toText(source.node_id, generateLogicId('node')),
    block_type: blockType,
    label: toText(source.label, definition.name),
    x: Math.max(0, finiteNumber(x, 80)),
    y: Math.max(0, finiteNumber(y, 80)),
    width: Math.max(120, finiteNumber(source.width, size.width)),
    height: Math.max(72, finiteNumber(source.height, size.height)),
    config: config,
    binding: isObject(source.binding) ? cloneValue(source.binding) : null,
    enabled: source.enabled !== false,
    metadata: Object.assign({ created_at: nowIso() }, cloneValue(source.metadata || {}))
  };
}

export function createLogicEdge(fromNodeId, fromPortId, toNodeId, toPortId, dataType, options) {
  const source = isObject(options) ? options : {};
  return {
    edge_id: toText(source.edge_id, generateLogicId('edge')),
    from: { node_id: toText(fromNodeId, ''), port_id: toText(fromPortId, '') },
    to: { node_id: toText(toNodeId, ''), port_id: toText(toPortId, '') },
    data_type: toText(dataType, 'ANY'),
    label: toText(source.label, ''),
    enabled: source.enabled !== false
  };
}

function normalizeExecution(value) {
  const source = isObject(value) ? value : {};
  return {
    scope_kind: ['node_local', 'cross_controller', 'cross_worker'].indexOf(source.scope_kind) >= 0
      ? source.scope_kind : 'node_local',
    owner_node_id: toText(source.owner_node_id, 'fn-01'),
    engine_id: Math.max(1, integerValue(source.engine_id, 1)),
    priority: Math.max(0, integerValue(source.priority, 500))
  };
}

function normalizeLogicNode(value) {
  const source = isObject(value) ? value : {};
  const definition = logicBlockDefinition(source.block_type);
  if (!definition) return null;
  const size = defaultNodeSize(source.block_type);
  return {
    node_id: toText(source.node_id, generateLogicId('node')),
    block_type: source.block_type,
    label: toText(source.label, definition.name),
    x: Math.max(0, finiteNumber(source.x, 80)),
    y: Math.max(0, finiteNumber(source.y, 80)),
    width: Math.max(120, finiteNumber(source.width, size.width)),
    height: Math.max(72, finiteNumber(source.height, size.height)),
    config: Object.assign({}, cloneValue(definition.defaults || {}), cloneValue(source.config || {})),
    binding: isObject(source.binding) ? cloneValue(source.binding) : null,
    enabled: source.enabled !== false,
    metadata: isObject(source.metadata) ? cloneValue(source.metadata) : { created_at: nowIso() }
  };
}

function normalizeLogicEdge(value) {
  const source = isObject(value) ? value : {};
  if (!isObject(source.from) || !isObject(source.to)) return null;
  return {
    edge_id: toText(source.edge_id, generateLogicId('edge')),
    from: {
      node_id: toText(source.from.node_id, ''),
      port_id: toText(source.from.port_id, '')
    },
    to: {
      node_id: toText(source.to.node_id, ''),
      port_id: toText(source.to.port_id, '')
    },
    data_type: toText(source.data_type, 'ANY'),
    label: toText(source.label, ''),
    enabled: source.enabled !== false
  };
}

function normalizeLogicDiagram(value) {
  const source = isObject(value) ? value : {};
  const diagram = createLogicDiagram(source);
  diagram.execution = normalizeExecution(source.execution);
  diagram.nodes = asArray(source.nodes).map(normalizeLogicNode).filter(Boolean);
  const nodeIds = new Set(diagram.nodes.map(function (node) { return node.node_id; }));
  diagram.edges = asArray(source.edges).map(normalizeLogicEdge).filter(function (edge) {
    return edge && nodeIds.has(edge.from.node_id) && nodeIds.has(edge.to.node_id);
  });
  diagram.updated_at = toText(source.updated_at, nowIso());
  return diagram;
}

export function normalizeLogicModel(value) {
  const source = isObject(value) ? value : {};
  const model = createEmptyLogicModel();
  model.version = LOGIC_MODEL_VERSION;
  model.standard = Object.assign({}, cloneValue(LOGIC_STANDARD), cloneValue(source.standard || {}), {
    id: LOGIC_STANDARD_ID,
    version: LOGIC_MODEL_VERSION,
    release: '63.1',
    source_of_truth: 'canonical_project_model'
  });
  model.diagrams = asArray(source.diagrams).map(normalizeLogicDiagram);
  const diagramIds = new Set(model.diagrams.map(function (diagram) { return diagram.diagram_id; }));
  model.active_diagram_id = diagramIds.has(source.active_diagram_id)
    ? source.active_diagram_id
    : (model.diagrams[0] ? model.diagrams[0].diagram_id : null);
  model.target_ownership = isObject(source.target_ownership)
    ? cloneValue(source.target_ownership) : {};
  model.settings = Object.assign({}, model.settings, cloneValue(source.settings || {}));
  return model;
}

export function activeLogicDiagram(modelValue) {
  const model = normalizeLogicModel(modelValue);
  return model.diagrams.find(function (diagram) {
    return diagram.diagram_id === model.active_diagram_id;
  }) || model.diagrams[0] || null;
}

export function logicPortsForNode(nodeValue) {
  const node = isObject(nodeValue) ? nodeValue : {};
  const definition = logicBlockDefinition(node.block_type);
  if (!definition) return [];
  const bindingType = toText((node.binding || {}).data_type, '');
  const configuredType = toText((node.config || {}).data_type, '');
  return asArray(definition.ports).map(function (port) {
    const out = cloneValue(port);
    if ((node.block_type === 'signal_in' || node.block_type === 'signal_out')
        && (out.data_type === 'ANY' || out.data_type === 'NUMERIC')) {
      out.data_type = bindingType || configuredType || 'ANY';
    }
    if ((node.block_type === 'actuator_write' || node.block_type === 'hmi_write')
        && out.id === 'VALUE') {
      out.data_type = bindingType || configuredType || 'ANY';
    }
    return out;
  });
}

export function logicPortForNode(nodeValue, portId) {
  return logicPortsForNode(nodeValue).find(function (port) {
    return port.id === portId;
  }) || null;
}

function numericType(dataType) {
  return ['INT', 'DINT', 'REAL', 'NUMERIC'].indexOf(dataType) >= 0;
}

export function logicDataTypesCompatible(outputTypeValue, inputTypeValue) {
  const outputType = toText(outputTypeValue, 'ANY');
  const inputType = toText(inputTypeValue, 'ANY');
  if (outputType === 'ANY' || inputType === 'ANY') return true;
  if (outputType === inputType) return true;
  if (outputType === 'NUMERIC' && numericType(inputType)) return true;
  if (inputType === 'NUMERIC' && numericType(outputType)) return true;
  if (outputType === 'INT' && inputType === 'DINT') return true;
  if ((outputType === 'INT' || outputType === 'DINT') && inputType === 'REAL') return true;
  return false;
}

function signalDataTypeFromIo(row, direction) {
  const functionType = toText(row && row.function_type, '');
  if (functionType === 'read_coil' || functionType === 'write_coil'
      || functionType === 'read_s7' || functionType === 'write_s7') {
    const declared = toText(row && row.data_type, '');
    return declared || 'BOOL';
  }
  if (direction === 'read' || direction === 'write') return 'REAL';
  return 'ANY';
}

function pushCatalogEntry(out, seen, entryValue) {
  const entry = isObject(entryValue) ? entryValue : {};
  const signalRef = toText(entry.signal_ref, '');
  if (!signalRef || seen.has(signalRef)) return;
  seen.add(signalRef);
  out.push(Object.assign({
    signal_ref: signalRef,
    label: signalRef,
    group: 'Weitere Signale',
    data_type: 'ANY',
    access: 'read',
    source_kind: 'fact',
    target_support: {
      universal_json: 'native',
      automation_system_v9: 'bridge',
      siemens_scl: 'native'
    }
  }, cloneValue(entry)));
}

function controllerNameByUuid(config) {
  const map = new Map();
  asArray(config && config.controllers).forEach(function (row) {
    map.set(toText(row.controller_uuid, ''), toText(row.device_name || row.controller_key, 'Controller'));
  });
  return map;
}

function stateNameById(config) {
  const processById = new Map();
  asArray(config && config.processes).forEach(function (row) {
    processById.set(integerValue(row.p_id, -1), toText(row.process_name, 'Prozess'));
  });
  const map = new Map();
  asArray(config && config.process_states).forEach(function (row) {
    const stateId = integerValue(row.state_id, -1);
    const processName = processById.get(integerValue(row.p_id, -1)) || 'Prozess';
    map.set(stateId, processName + ' · State ' + stateId);
  });
  return map;
}

export function buildLogicSignalCatalog(snapshotValue) {
  const snapshot = isObject(snapshotValue) ? snapshotValue : {};
  const config = isObject(snapshot.deviceConfig) ? snapshot.deviceConfig : {};
  const elements = asArray(snapshot.elements);
  const devices = isObject(snapshot.devices) ? snapshot.devices : {};
  const assignments = isObject(devices.assignments) ? devices.assignments : {};
  const processes = isObject(snapshot.processes) ? snapshot.processes : {};
  const hmi = isObject(snapshot.hmi) ? snapshot.hmi : {};
  const freeRules = isObject(snapshot.freeRules) ? snapshot.freeRules : {};
  const out = [];
  const seen = new Set();
  const controllers = controllerNameByUuid(config);
  const stateNames = stateNameById(config);

  asArray(config.sensors).forEach(function (row) {
    const uuid = toText(row.controller_uuid, '');
    const sensorId = integerValue(row.sensor_id, null);
    if (!uuid || sensorId == null) return;
    const type = signalDataTypeFromIo(row, 'read');
    const controller = controllers.get(uuid) || toText(row.controller_key, 'Controller');
    pushCatalogEntry(out, seen, {
      signal_ref: 'v9.sensor.' + uuid + '.' + sensorId + '.value',
      label: controller + ' · Sensor ' + sensorId,
      group: 'V9 · Sensoren',
      data_type: type,
      access: 'read',
      source_kind: 'sensor',
      controller_uuid: uuid,
      sensor_id: sensorId,
      filter_id: row.filter_id == null ? null : integerValue(row.filter_id, null),
      v9_condition: {
        src: 'sensor', controller_uuid: uuid, sensor_id: sensorId
      },
      target_support: {
        universal_json: 'native', automation_system_v9: 'native', siemens_scl: 'native'
      }
    });
  });

  asArray(config.actuators).forEach(function (row) {
    const uuid = toText(row.controller_uuid, '');
    const actuatorId = integerValue(row.actuator_id, null);
    if (!uuid || actuatorId == null) return;
    const type = signalDataTypeFromIo(row, 'write');
    const controller = controllers.get(uuid) || toText(row.controller_key, 'Controller');
    pushCatalogEntry(out, seen, {
      signal_ref: 'v9.actuator.' + uuid + '.' + actuatorId + '.command',
      label: controller + ' · Aktor ' + actuatorId,
      group: 'V9 · Aktoren',
      data_type: type,
      access: 'write',
      source_kind: 'actuator',
      controller_uuid: uuid,
      actuator_id: actuatorId,
      write_target: {
        kind: 'actuator', controller_uuid: uuid, actuator_id: actuatorId
      },
      target_support: {
        universal_json: 'native', automation_system_v9: 'bridge', siemens_scl: 'native'
      }
    });
  });

  asArray(config.process_states).forEach(function (row) {
    const stateId = integerValue(row.state_id, null);
    if (stateId == null) return;
    const stateLabel = stateNames.get(stateId) || ('State ' + stateId);
    pushCatalogEntry(out, seen, {
      signal_ref: 'v9.state.' + stateId + '.value_id',
      label: stateLabel + ' · value_id',
      group: 'V9 · Process States',
      data_type: 'INT',
      access: 'readwrite',
      source_kind: 'process_state',
      state_id: stateId,
      field: 'value_id',
      v9_condition: { src: 'state', state_id: stateId, field: 'value_id' },
      write_target: { kind: 'state_value', state_id: stateId },
      target_support: {
        universal_json: 'native', automation_system_v9: 'native', siemens_scl: 'native'
      }
    });
    const parameters = isObject(row.parameters) ? row.parameters : {};
    Object.keys(parameters).sort(stableTextCompare).forEach(function (key) {
      const value = parameters[key];
      const dataType = typeof value === 'number' ? 'REAL'
        : (typeof value === 'boolean' ? 'BOOL' : 'STRING');
      pushCatalogEntry(out, seen, {
        signal_ref: 'v9.state.' + stateId + '.parameters.' + key,
        label: stateLabel + ' · ' + key,
        group: 'V9 · State-Parameter',
        data_type: dataType,
        access: 'readwrite',
        source_kind: 'state_parameter',
        state_id: stateId,
        parameter_key: key,
        write_target: { kind: 'state_parameter', state_id: stateId, parameter_key: key },
        target_support: {
          universal_json: 'native', automation_system_v9: 'bridge', siemens_scl: 'native'
        }
      });
    });
  });

  asArray(config.timers).forEach(function (row) {
    const timerId = integerValue(row.timer_id, null);
    if (timerId == null) return;
    ['elapsed', 'fired', 'running'].forEach(function (field) {
      pushCatalogEntry(out, seen, {
        signal_ref: 'v9.timer.' + timerId + '.' + field,
        label: 'Timer ' + timerId + ' · ' + field,
        group: 'V9 · Timer',
        data_type: 'BOOL',
        access: 'read',
        source_kind: 'timer',
        timer_id: timerId,
        timer_field: field,
        v9_condition: { src: 'timer', timer_id: timerId, op: field, value: true },
        target_support: {
          universal_json: 'native', automation_system_v9: 'native', siemens_scl: 'native'
        }
      });
    });
    pushCatalogEntry(out, seen, {
      signal_ref: 'v9.timer.' + timerId + '.remaining_s',
      label: 'Timer ' + timerId + ' · Restzeit',
      group: 'V9 · Timer',
      data_type: 'TIME',
      access: 'read',
      source_kind: 'timer_remaining',
      timer_id: timerId,
      target_support: {
        universal_json: 'native', automation_system_v9: 'bridge', siemens_scl: 'native'
      }
    });
  });

  asArray(processes.process_states).forEach(function (row) {
    const stateId = integerValue(row.state_id, null);
    if (stateId == null) return;
    pushCatalogEntry(out, seen, {
      signal_ref: 'project.state.' + stateId + '.value_id',
      label: 'Projekt-State ' + stateId + ' · value_id',
      group: 'Projekt · Prozesszustände',
      data_type: 'INT',
      access: 'readwrite',
      source_kind: 'process_state',
      state_id: stateId,
      field: 'value_id',
      v9_condition: { src: 'state', state_id: stateId, field: 'value_id' },
      write_target: { kind: 'state_value', state_id: stateId },
      target_support: {
        universal_json: 'native', automation_system_v9: 'native', siemens_scl: 'native'
      }
    });
  });

  elements.forEach(function (element) {
    const elementId = toText(element && element.id, '');
    if (!elementId) return;
    const tag = toText(element.tag || (element.properties || {}).tag, element.name || elementId);
    const assignment = assignments[elementId];
    const dataType = assignment && assignment.role === 'sensor'
      ? signalDataTypeFromIo(assignment, 'read')
      : (assignment && assignment.role === 'actuator'
        ? signalDataTypeFromIo(assignment, 'write') : 'BOOL');
    const access = assignment && assignment.role === 'actuator' ? 'write'
      : (assignment && assignment.role === 'sensor' ? 'read' : 'readwrite');
    const entry = {
      signal_ref: 'entity.' + elementId + '.runtime',
      label: tag + ' · Laufzeitsignal',
      group: 'Anlagenobjekte',
      data_type: dataType,
      access: access,
      source_kind: 'entity',
      element_id: elementId,
      target_support: {
        universal_json: 'native', automation_system_v9: 'bridge', siemens_scl: 'native'
      }
    };
    if (assignment && assignment.role === 'sensor') {
      const controllerUuid = toText(assignment.controller_uuid, '');
      const sensorId = integerValue(assignment.sensor_id, null);
      if (controllerUuid && sensorId != null) {
        entry.source_kind = 'sensor';
        entry.controller_uuid = controllerUuid;
        entry.sensor_id = sensorId;
        entry.v9_condition = { src: 'sensor', controller_uuid: controllerUuid, sensor_id: sensorId };
        entry.target_support.automation_system_v9 = 'native';
      }
    }
    if (assignment && assignment.role === 'actuator') {
      const controllerUuid = toText(assignment.controller_uuid, '');
      const actuatorId = integerValue(assignment.actuator_id, null);
      if (controllerUuid && actuatorId != null) {
        entry.source_kind = 'actuator';
        entry.controller_uuid = controllerUuid;
        entry.actuator_id = actuatorId;
        entry.write_target = { kind: 'actuator', controller_uuid: controllerUuid, actuator_id: actuatorId };
      }
    }
    pushCatalogEntry(out, seen, entry);
  });

  asArray(hmi.widgets).forEach(function (widget) {
    const widgetId = toText(widget && widget.widget_id, '');
    if (!widgetId) return;
    pushCatalogEntry(out, seen, {
      signal_ref: 'hmi.widget.' + widgetId + '.value',
      label: toText(widget.label || widget.name, widgetId) + ' · HMI-Wert',
      group: 'HMI · Widgets',
      data_type: toText(widget.data_type, 'ANY'),
      access: 'readwrite',
      source_kind: 'hmi',
      widget_id: widgetId,
      write_target: { kind: 'hmi', widget_id: widgetId },
      target_support: {
        universal_json: 'native', automation_system_v9: 'bridge', siemens_scl: 'native'
      }
    });
  });

  asArray(freeRules.timers).forEach(function (row) {
    const timerId = integerValue(row && row.timer_id, null);
    if (timerId == null) return;
    pushCatalogEntry(out, seen, {
      signal_ref: 'project.timer.' + timerId + '.fired',
      label: 'Projekt-Timer ' + timerId + ' · fired',
      group: 'Projekt · Timer',
      data_type: 'BOOL',
      access: 'read',
      source_kind: 'timer',
      timer_id: timerId,
      timer_field: 'fired',
      v9_condition: { src: 'timer', timer_id: timerId, op: 'fired', value: true },
      target_support: {
        universal_json: 'native', automation_system_v9: 'native', siemens_scl: 'native'
      }
    });
  });

  out.sort(function (left, right) {
    const groupOrder = stableTextCompare(left.group, right.group);
    return groupOrder || stableTextCompare(left.label, right.label);
  });
  return out;
}

export function logicCatalogEntry(catalogValue, signalRef) {
  return asArray(catalogValue).find(function (entry) {
    return entry.signal_ref === signalRef;
  }) || null;
}

function nodeIndexForDiagram(diagram) {
  const map = new Map();
  asArray(diagram && diagram.nodes).forEach(function (node) {
    map.set(node.node_id, node);
  });
  return map;
}

function incomingEdgesForDiagram(diagram) {
  const map = new Map();
  asArray(diagram && diagram.edges).filter(function (edge) {
    return edge.enabled !== false;
  }).forEach(function (edge) {
    const key = edge.to.node_id + ':' + edge.to.port_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(edge);
  });
  return map;
}

function outgoingEdgesForDiagram(diagram) {
  const map = new Map();
  asArray(diagram && diagram.edges).filter(function (edge) {
    return edge.enabled !== false;
  }).forEach(function (edge) {
    const key = edge.from.node_id + ':' + edge.from.port_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(edge);
  });
  return map;
}

export function logicTopologicalOrder(diagramValue) {
  const diagram = isObject(diagramValue) ? diagramValue : { nodes: [], edges: [] };
  const nodes = asArray(diagram.nodes).filter(function (node) { return node.enabled !== false; });
  const nodeIds = new Set(nodes.map(function (node) { return node.node_id; }));
  const indegree = new Map();
  const adjacency = new Map();
  nodes.forEach(function (node) {
    indegree.set(node.node_id, 0);
    adjacency.set(node.node_id, []);
  });
  asArray(diagram.edges).filter(function (edge) {
    return edge.enabled !== false && nodeIds.has(edge.from.node_id) && nodeIds.has(edge.to.node_id);
  }).forEach(function (edge) {
    indegree.set(edge.to.node_id, (indegree.get(edge.to.node_id) || 0) + 1);
    adjacency.get(edge.from.node_id).push(edge.to.node_id);
  });
  const queue = nodes.filter(function (node) {
    return indegree.get(node.node_id) === 0;
  }).map(function (node) { return node.node_id; }).sort(stableTextCompare);
  const order = [];
  while (queue.length) {
    const nodeId = queue.shift();
    order.push(nodeId);
    adjacency.get(nodeId).sort(stableTextCompare).forEach(function (nextId) {
      const next = (indegree.get(nextId) || 0) - 1;
      indegree.set(nextId, next);
      if (next === 0) {
        queue.push(nextId);
        queue.sort(stableTextCompare);
      }
    });
  }
  return {
    order: order,
    cyclic: order.length !== nodes.length,
    unresolved: nodes.map(function (node) { return node.node_id; }).filter(function (nodeId) {
      return order.indexOf(nodeId) < 0;
    })
  };
}

function reportEntry(path, code, message, severity) {
  return { path: path, code: code, message: message, severity: severity };
}

function bindingRequired(blockType) {
  return ['signal_in', 'state_write', 'state_parameter', 'actuator_write', 'hmi_write', 'signal_out'].indexOf(blockType) >= 0;
}

function actionTargetToken(node) {
  const binding = isObject(node.binding) ? node.binding : {};
  const config = isObject(node.config) ? node.config : {};
  if (node.block_type === 'state_write') {
    const stateId = integerValue(config.state_id != null ? config.state_id : binding.state_id, null);
    return stateId == null ? '' : 'state:' + stateId + ':value_id';
  }
  if (node.block_type === 'state_parameter') {
    const stateId = integerValue(config.state_id != null ? config.state_id : binding.state_id, null);
    const key = toText(config.parameter_key || binding.parameter_key, '');
    return stateId == null || !key ? '' : 'state:' + stateId + ':parameters.' + key;
  }
  if (node.block_type === 'actuator_write') {
    return binding.signal_ref ? 'signal:' + binding.signal_ref : '';
  }
  if (node.block_type === 'hmi_write' || node.block_type === 'signal_out') {
    return binding.signal_ref ? 'signal:' + binding.signal_ref : '';
  }
  return '';
}

export function validateLogicModel(modelValue, contextValue) {
  const model = normalizeLogicModel(modelValue);
  const context = isObject(contextValue) ? contextValue : {};
  const catalog = asArray(context.signalCatalog);
  const catalogRefs = new Set(catalog.map(function (entry) { return entry.signal_ref; }));
  const errors = [];
  const warnings = [];
  const perDiagram = {};
  const globalTargets = new Map();
  const diagramIds = new Set();

  model.diagrams.forEach(function (diagram, diagramIndex) {
    const base = 'diagrams[' + diagramIndex + ']';
    const localErrors = [];
    const localWarnings = [];
    if (diagramIds.has(diagram.diagram_id)) {
      localErrors.push(reportEntry(base + '.diagram_id', 'duplicate_diagram_id', 'diagram_id ist nicht eindeutig.', 'error'));
    }
    diagramIds.add(diagram.diagram_id);
    const nodes = nodeIndexForDiagram(diagram);
    const nodeIds = new Set();
    const edgeIds = new Set();
    const incoming = incomingEdgesForDiagram(diagram);

    diagram.nodes.forEach(function (node, nodeIndex) {
      const nodePath = base + '.nodes[' + nodeIndex + ']';
      if (nodeIds.has(node.node_id)) {
        localErrors.push(reportEntry(nodePath + '.node_id', 'duplicate_node_id', 'node_id ist nicht eindeutig.', 'error'));
      }
      nodeIds.add(node.node_id);
      const definition = logicBlockDefinition(node.block_type);
      if (!definition) {
        localErrors.push(reportEntry(nodePath + '.block_type', 'unknown_block', 'Unbekannter Logikbaustein.', 'error'));
        return;
      }
      if (bindingRequired(node.block_type) && !isObject(node.binding)
          && node.block_type !== 'state_write' && node.block_type !== 'state_parameter') {
        localWarnings.push(reportEntry(nodePath + '.binding', 'binding_missing', 'Baustein ist noch nicht an ein kanonisches Signal gebunden.', 'warning'));
      }
      if (isObject(node.binding) && node.binding.signal_ref && catalog.length
          && !catalogRefs.has(node.binding.signal_ref)) {
        localWarnings.push(reportEntry(nodePath + '.binding.signal_ref', 'binding_orphan', 'Signalreferenz ist im aktuellen Projekt nicht auflösbar.', 'warning'));
      }
      logicPortsForNode(node).filter(function (port) {
        return port.direction === 'in' && port.required !== false;
      }).forEach(function (port) {
        const edges = incoming.get(node.node_id + ':' + port.id) || [];
        if (!edges.length && ['state_write', 'state_parameter', 'notify', 'actuator_write', 'hmi_write'].indexOf(node.block_type) < 0) {
          localWarnings.push(reportEntry(nodePath + '.ports.' + port.id, 'input_unconnected', 'Pflichteingang ' + port.label + ' ist nicht verbunden.', 'warning'));
        }
        if (edges.length > 1 && port.multi !== true) {
          localErrors.push(reportEntry(nodePath + '.ports.' + port.id, 'multiple_input_edges', 'Eingang besitzt mehr als eine Quelle.', 'error'));
        }
      });
      const target = actionTargetToken(node);
      if (target) {
        if (!globalTargets.has(target)) globalTargets.set(target, []);
        globalTargets.get(target).push({ diagram: diagram, node: node, path: nodePath });
      }
    });

    diagram.edges.forEach(function (edge, edgeIndex) {
      const edgePath = base + '.edges[' + edgeIndex + ']';
      if (edgeIds.has(edge.edge_id)) {
        localErrors.push(reportEntry(edgePath + '.edge_id', 'duplicate_edge_id', 'edge_id ist nicht eindeutig.', 'error'));
      }
      edgeIds.add(edge.edge_id);
      const fromNode = nodes.get(edge.from.node_id);
      const toNode = nodes.get(edge.to.node_id);
      if (!fromNode || !toNode) {
        localErrors.push(reportEntry(edgePath, 'edge_endpoint_missing', 'Start- oder Zielbaustein existiert nicht.', 'error'));
        return;
      }
      const fromPort = logicPortForNode(fromNode, edge.from.port_id);
      const toPort = logicPortForNode(toNode, edge.to.port_id);
      if (!fromPort || !toPort) {
        localErrors.push(reportEntry(edgePath, 'edge_port_missing', 'Start- oder Zielport existiert nicht.', 'error'));
        return;
      }
      if (fromPort.direction !== 'out' || toPort.direction !== 'in') {
        localErrors.push(reportEntry(edgePath, 'edge_direction', 'Verbindung muss von Ausgang zu Eingang verlaufen.', 'error'));
      }
      if (!logicDataTypesCompatible(fromPort.data_type, toPort.data_type)) {
        localErrors.push(reportEntry(edgePath, 'edge_type', 'Datentypen ' + fromPort.data_type + ' → ' + toPort.data_type + ' sind nicht kompatibel.', 'error'));
      }
      if (edge.from.node_id === edge.to.node_id) {
        localErrors.push(reportEntry(edgePath, 'self_edge', 'Selbstverbindungen sind nicht zulässig.', 'error'));
      }
    });

    const topology = logicTopologicalOrder(diagram);
    if (topology.cyclic) {
      localErrors.push(reportEntry(base + '.edges', 'cycle', 'Der Schaltplan enthält einen Zyklus. Rückkopplungen benötigen künftig explizite Speicherbausteine.', 'error'));
    }
    perDiagram[diagram.diagram_id] = {
      errors: localErrors,
      warnings: localWarnings,
      topology: topology,
      node_count: diagram.nodes.length,
      edge_count: diagram.edges.length
    };
    errors.push.apply(errors, localErrors);
    warnings.push.apply(warnings, localWarnings);
  });

  globalTargets.forEach(function (writers, target) {
    if (writers.length < 2) return;
    const hybrid = writers.every(function (item) {
      return toText((item.node.config || {}).ownership_mode, 'logic') === 'hybrid';
    });
    const message = 'Mehrere Logikbausteine schreiben dasselbe Ziel ' + target + '.';
    writers.forEach(function (item) {
      const entry = reportEntry(item.path + '.config.ownership_mode', hybrid ? 'hybrid_multi_writer' : 'logic_multi_writer', message, hybrid ? 'warning' : 'error');
      if (hybrid) warnings.push(entry);
      else errors.push(entry);
    });
  });

  return {
    status: errors.length ? 'FAILED' : (warnings.length ? 'WARNING' : 'OK'),
    errors: errors,
    warnings: warnings,
    per_diagram: perDiagram,
    stats: {
      diagrams: model.diagrams.length,
      nodes: model.diagrams.reduce(function (sum, diagram) { return sum + diagram.nodes.length; }, 0),
      edges: model.diagrams.reduce(function (sum, diagram) { return sum + diagram.edges.length; }, 0),
      errors: errors.length,
      warnings: warnings.length
    }
  };
}

function outputKey(nodeId, portId) {
  return nodeId + ':' + portId;
}

function incomingEdge(diagram, nodeId, portId) {
  return asArray(diagram.edges).find(function (edge) {
    return edge.enabled !== false && edge.to.node_id === nodeId && edge.to.port_id === portId;
  }) || null;
}

function inputValue(diagram, values, nodeId, portId, fallback) {
  const edge = incomingEdge(diagram, nodeId, portId);
  if (!edge) return fallback;
  const key = outputKey(edge.from.node_id, edge.from.port_id);
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compareValues(type, left, right) {
  if (type === 'compare_eq') return left === right;
  if (type === 'compare_ne') return left !== right;
  if (type === 'compare_gt') return left > right;
  if (type === 'compare_ge') return left >= right;
  if (type === 'compare_lt') return left < right;
  if (type === 'compare_le') return left <= right;
  return false;
}

function evaluateTimerNode(node, diagram, values, memory, nowMs) {
  const state = isObject(memory[node.node_id]) ? memory[node.node_id] : {};
  const input = Boolean(inputValue(diagram, values, node.node_id, 'IN', false));
  const ptInput = inputValue(diagram, values, node.node_id, 'PT', null);
  const pt = Math.max(0, numberOr(ptInput, numberOr((node.config || {}).pt_ms, 500)));
  let q = false;
  let et = 0;
  const previous = Boolean(state.previous_input);

  if (node.block_type === 'ton') {
    if (input) {
      if (!previous || !Number.isFinite(state.started_at)) state.started_at = nowMs;
      et = Math.max(0, nowMs - state.started_at);
      q = et >= pt;
    } else {
      state.started_at = null;
      et = 0;
      q = false;
    }
  } else if (node.block_type === 'tof') {
    if (input) {
      state.fell_at = null;
      q = true;
      et = 0;
    } else if (previous) {
      state.fell_at = nowMs;
      q = true;
      et = 0;
    } else if (Number.isFinite(state.fell_at)) {
      et = Math.max(0, nowMs - state.fell_at);
      q = et < pt;
      if (!q) state.fell_at = null;
    }
  } else if (node.block_type === 'tp') {
    if (input && !previous) state.pulse_started_at = nowMs;
    if (Number.isFinite(state.pulse_started_at)) {
      et = Math.max(0, nowMs - state.pulse_started_at);
      q = et < pt;
      if (!q) state.pulse_started_at = null;
    }
  }
  state.previous_input = input;
  state.q = q;
  state.et_ms = Math.min(et, pt);
  memory[node.node_id] = state;
  values[outputKey(node.node_id, 'Q')] = q;
  values[outputKey(node.node_id, 'ET')] = state.et_ms;
}

function evaluateCounterNode(node, diagram, values, memory) {
  const state = isObject(memory[node.node_id]) ? memory[node.node_id] : {};
  const triggerPort = node.block_type === 'ctu' ? 'CU' : 'CD';
  const resetPort = node.block_type === 'ctu' ? 'R' : 'LD';
  const trigger = Boolean(inputValue(diagram, values, node.node_id, triggerPort, false));
  const reset = Boolean(inputValue(diagram, values, node.node_id, resetPort, false));
  const pv = Math.max(0, integerValue(inputValue(diagram, values, node.node_id, 'PV', (node.config || {}).pv), 10));
  const previous = Boolean(state.previous_trigger);
  if (!Number.isFinite(state.cv)) state.cv = node.block_type === 'ctd' ? pv : 0;
  if (reset) state.cv = node.block_type === 'ctd' ? pv : 0;
  else if (trigger && !previous) {
    if (node.block_type === 'ctu') state.cv += 1;
    else state.cv -= 1;
  }
  state.previous_trigger = trigger;
  const q = node.block_type === 'ctu' ? state.cv >= pv : state.cv <= 0;
  memory[node.node_id] = state;
  values[outputKey(node.node_id, 'Q')] = q;
  values[outputKey(node.node_id, 'CV')] = state.cv;
}

function evaluateArithmeticNode(node, diagram, values) {
  const a = numberOr(inputValue(diagram, values, node.node_id, 'A', 0), 0);
  const b = numberOr(inputValue(diagram, values, node.node_id, 'B', 0), 0);
  let result = 0;
  if (node.block_type === 'add') result = a + b;
  else if (node.block_type === 'sub') result = a - b;
  else if (node.block_type === 'mul') result = a * b;
  else if (node.block_type === 'div') result = b === 0 ? 0 : a / b;
  else if (node.block_type === 'min') result = Math.min(a, b);
  else if (node.block_type === 'max') result = Math.max(a, b);
  else if (node.block_type === 'limit') {
    const min = numberOr(inputValue(diagram, values, node.node_id, 'MIN', 0), 0);
    const value = numberOr(inputValue(diagram, values, node.node_id, 'IN', 0), 0);
    const max = numberOr(inputValue(diagram, values, node.node_id, 'MAX', 100), 100);
    result = Math.max(min, Math.min(max, value));
  }
  values[outputKey(node.node_id, 'Q')] = result;
}

function evaluateActionNode(node, diagram, values, actions) {
  const config = isObject(node.config) ? node.config : {};
  const binding = isObject(node.binding) ? node.binding : null;
  if (node.block_type === 'signal_out') {
    const value = inputValue(diagram, values, node.node_id, 'VALUE', config.value);
    actions.push({ node_id: node.node_id, type: node.block_type, binding: cloneValue(binding), value: value });
    return;
  }
  const enabled = Boolean(inputValue(diagram, values, node.node_id, 'EN', false));
  if (node.block_type === 'state_write') {
    const value = enabled ? integerValue(config.value_id_true, 1) : integerValue(config.value_id_false, 2);
    if (enabled || config.write_false !== false) {
      actions.push({
        node_id: node.node_id,
        type: node.block_type,
        binding: cloneValue(binding),
        state_id: integerValue(config.state_id != null ? config.state_id : (binding || {}).state_id, null),
        value_id: value,
        active: enabled,
        priority: integerValue(config.priority, 500)
      });
    }
    return;
  }
  if (!enabled) return;
  const value = inputValue(diagram, values, node.node_id, 'VALUE', config.value);
  actions.push({
    node_id: node.node_id,
    type: node.block_type,
    binding: cloneValue(binding),
    state_id: integerValue(config.state_id != null ? config.state_id : (binding || {}).state_id, null),
    parameter_key: toText(config.parameter_key || (binding || {}).parameter_key, ''),
    value: value,
    message: toText(config.message, 'Logic event'),
    priority: integerValue(config.priority, 500)
  });
}

export function evaluateLogicDiagram(diagramValue, inputValues, runtimeStateValue, nowValue) {
  const diagram = normalizeLogicDiagram(diagramValue);
  const inputs = isObject(inputValues) ? inputValues : {};
  const memory = cloneValue(isObject(runtimeStateValue) ? runtimeStateValue : {});
  const nowMs = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now();
  const topology = logicTopologicalOrder(diagram);
  const nodes = nodeIndexForDiagram(diagram);
  const values = {};
  const actions = [];
  const diagnostics = [];
  if (topology.cyclic) {
    return { values: values, actions: actions, runtime_state: memory, diagnostics: ['cycle'], topology: topology };
  }
  topology.order.forEach(function (nodeId) {
    const node = nodes.get(nodeId);
    if (!node || node.enabled === false) return;
    const config = isObject(node.config) ? node.config : {};
    if (node.block_type === 'signal_in') {
      const signalRef = toText((node.binding || {}).signal_ref, '');
      const value = Object.prototype.hasOwnProperty.call(inputs, signalRef)
        ? inputs[signalRef] : config.default_value;
      values[outputKey(node.node_id, 'Q')] = value;
      return;
    }
    if (node.block_type === 'constant_bool') {
      values[outputKey(node.node_id, 'Q')] = booleanValue(config.value, false);
      return;
    }
    if (node.block_type === 'constant_int') {
      values[outputKey(node.node_id, 'Q')] = integerValue(config.value, 0);
      return;
    }
    if (node.block_type === 'constant_real') {
      values[outputKey(node.node_id, 'Q')] = finiteNumber(config.value, 0);
      return;
    }
    if (node.block_type === 'constant_time') {
      values[outputKey(node.node_id, 'Q')] = Math.max(0, finiteNumber(config.value_ms, 500));
      return;
    }
    if (node.block_type === 'not') {
      values[outputKey(node.node_id, 'Q')] = !Boolean(inputValue(diagram, values, node.node_id, 'IN', false));
      return;
    }
    if (node.block_type === 'and' || node.block_type === 'or' || node.block_type === 'xor') {
      const left = Boolean(inputValue(diagram, values, node.node_id, 'IN1', false));
      const right = Boolean(inputValue(diagram, values, node.node_id, 'IN2', false));
      const result = node.block_type === 'and' ? (left && right)
        : (node.block_type === 'or' ? (left || right) : (left !== right));
      values[outputKey(node.node_id, 'Q')] = result;
      return;
    }
    if (node.block_type.indexOf('compare_') === 0) {
      const left = inputValue(diagram, values, node.node_id, 'A', null);
      const right = inputValue(diagram, values, node.node_id, 'B', null);
      values[outputKey(node.node_id, 'Q')] = compareValues(node.block_type, left, right);
      return;
    }
    if (['ton', 'tof', 'tp'].indexOf(node.block_type) >= 0) {
      evaluateTimerNode(node, diagram, values, memory, nowMs);
      return;
    }
    if (['ctu', 'ctd'].indexOf(node.block_type) >= 0) {
      evaluateCounterNode(node, diagram, values, memory);
      return;
    }
    if (['add', 'sub', 'mul', 'div', 'min', 'max', 'limit'].indexOf(node.block_type) >= 0) {
      evaluateArithmeticNode(node, diagram, values);
      return;
    }
    if (['state_write', 'state_parameter', 'notify', 'actuator_write', 'hmi_write', 'signal_out'].indexOf(node.block_type) >= 0) {
      evaluateActionNode(node, diagram, values, actions);
      return;
    }
    diagnostics.push('unsupported:' + node.block_type);
  });
  return {
    values: values,
    actions: actions,
    runtime_state: memory,
    diagnostics: diagnostics,
    topology: topology
  };
}

export function evaluateLogicModel(modelValue, inputValues, runtimeStateValue, nowValue) {
  const model = normalizeLogicModel(modelValue);
  const runtime = isObject(runtimeStateValue) ? cloneValue(runtimeStateValue) : {};
  const results = {};
  const actions = [];
  model.diagrams.filter(function (diagram) { return diagram.enabled !== false; }).forEach(function (diagram) {
    const result = evaluateLogicDiagram(diagram, inputValues, runtime[diagram.diagram_id] || {}, nowValue);
    runtime[diagram.diagram_id] = result.runtime_state;
    results[diagram.diagram_id] = result;
    actions.push.apply(actions, result.actions.map(function (action) {
      return Object.assign({ diagram_id: diagram.diagram_id }, action);
    }));
  });
  return { diagrams: results, actions: actions, runtime_state: runtime };
}

function expressionConst(value) {
  return { kind: 'const', value: Boolean(value) };
}

function expressionLeaf(condition) {
  return { kind: 'leaf', condition: cloneValue(condition) };
}

function expressionGroup(kind, children) {
  return { kind: kind, children: children };
}

function expressionNot(child) {
  return { kind: 'not', child: child };
}

function literalFromOutput(diagram, nodes, nodeId, portId, visited) {
  const token = nodeId + ':' + portId;
  if (visited.has(token)) return { found: false };
  visited.add(token);
  const node = nodes.get(nodeId);
  if (!node) return { found: false };
  const config = isObject(node.config) ? node.config : {};
  if (node.block_type === 'constant_bool') return { found: true, value: booleanValue(config.value, false), data_type: 'BOOL' };
  if (node.block_type === 'constant_int') return { found: true, value: integerValue(config.value, 0), data_type: 'INT' };
  if (node.block_type === 'constant_real') return { found: true, value: finiteNumber(config.value, 0), data_type: 'REAL' };
  if (node.block_type === 'constant_time') return { found: true, value: finiteNumber(config.value_ms, 500), data_type: 'TIME' };
  return { found: false };
}

function sourceBindingFromOutput(nodes, nodeId, portId) {
  const node = nodes.get(nodeId);
  if (!node || node.block_type !== 'signal_in' || portId !== 'Q') return null;
  return isObject(node.binding) ? node.binding : null;
}

function comparisonOperator(blockType) {
  const map = {
    compare_eq: '==', compare_ne: '!=', compare_gt: '>', compare_ge: '>=',
    compare_lt: '<', compare_le: '<='
  };
  return map[blockType] || '==';
}

function reverseOperator(op) {
  const map = { '>': '<', '>=': '<=', '<': '>', '<=': '>=' };
  return map[op] || op;
}

function conditionFromBinding(bindingValue, opValue, valueValue) {
  const binding = isObject(bindingValue) ? bindingValue : {};
  const base = isObject(binding.v9_condition) ? cloneValue(binding.v9_condition) : null;
  if (!base) return null;
  base.op = toText(opValue, base.op || '==');
  base.value = valueValue;
  if (binding.filter_id != null && base.src === 'sensor') base.filter_id = integerValue(binding.filter_id, null);
  return base;
}

function expressionFromOutput(diagram, nodes, nodeId, portId, report, visited) {
  const token = nodeId + ':' + portId;
  if (visited.has(token)) {
    report.errors.push('Zyklische Ausdrucksreferenz an ' + token + '.');
    return null;
  }
  visited.add(token);
  const node = nodes.get(nodeId);
  if (!node) return null;
  if (node.block_type === 'constant_bool' && portId === 'Q') {
    return expressionConst(booleanValue((node.config || {}).value, false));
  }
  if (node.block_type === 'signal_in' && portId === 'Q') {
    const binding = isObject(node.binding) ? node.binding : {};
    const condition = conditionFromBinding(binding, '==', true);
    if (!condition) {
      report.bridge_nodes.push(node.node_id);
      report.warnings.push('Signalquelle ' + node.label + ' wird über den universellen Bridge-Layer ausgewertet.');
      return null;
    }
    return expressionLeaf(condition);
  }
  if (node.block_type === 'not' && portId === 'Q') {
    const edge = incomingEdge(diagram, node.node_id, 'IN');
    if (!edge) return expressionConst(true);
    const child = expressionFromOutput(diagram, nodes, edge.from.node_id, edge.from.port_id, report, visited);
    return child ? expressionNot(child) : null;
  }
  if (['and', 'or', 'xor'].indexOf(node.block_type) >= 0 && portId === 'Q') {
    const children = [];
    ['IN1', 'IN2'].forEach(function (inputPort) {
      const edge = incomingEdge(diagram, node.node_id, inputPort);
      if (!edge) children.push(expressionConst(false));
      else children.push(expressionFromOutput(diagram, nodes, edge.from.node_id, edge.from.port_id, report, new Set(visited)));
    });
    if (children.some(function (child) { return !child; })) return null;
    return expressionGroup(node.block_type, children);
  }
  if (node.block_type.indexOf('compare_') === 0 && portId === 'Q') {
    const edgeA = incomingEdge(diagram, node.node_id, 'A');
    const edgeB = incomingEdge(diagram, node.node_id, 'B');
    if (!edgeA || !edgeB) {
      report.errors.push('Vergleicher ' + node.label + ' ist nicht vollständig verbunden.');
      return null;
    }
    const bindingA = sourceBindingFromOutput(nodes, edgeA.from.node_id, edgeA.from.port_id);
    const bindingB = sourceBindingFromOutput(nodes, edgeB.from.node_id, edgeB.from.port_id);
    const literalA = literalFromOutput(diagram, nodes, edgeA.from.node_id, edgeA.from.port_id, new Set());
    const literalB = literalFromOutput(diagram, nodes, edgeB.from.node_id, edgeB.from.port_id, new Set());
    let binding = null;
    let literal = null;
    let op = comparisonOperator(node.block_type);
    if (bindingA && literalB.found) {
      binding = bindingA;
      literal = literalB.value;
    } else if (bindingB && literalA.found) {
      binding = bindingB;
      literal = literalA.value;
      op = reverseOperator(op);
    } else {
      report.bridge_nodes.push(node.node_id);
      report.warnings.push('Vergleicher ' + node.label + ' wird über den universellen Bridge-Layer ausgewertet.');
      return null;
    }
    const condition = conditionFromBinding(binding, op, literal);
    if (!condition) {
      report.bridge_nodes.push(node.node_id);
      report.warnings.push('Vergleicherquelle ist nicht V9-nativ und benötigt den Bridge-Layer.');
      return null;
    }
    return expressionLeaf(condition);
  }
  report.bridge_nodes.push(node.node_id);
  report.warnings.push('Baustein ' + node.label + ' (' + node.block_type + ') benötigt den universellen Bridge-Layer.');
  return null;
}

function expressionForInput(diagram, nodes, nodeId, portId, report) {
  const edge = incomingEdge(diagram, nodeId, portId);
  if (!edge) return expressionConst(false);
  return expressionFromOutput(diagram, nodes, edge.from.node_id, edge.from.port_id, report, new Set());
}

function invertCondition(conditionValue) {
  const condition = cloneValue(conditionValue);
  const inverted = {
    '==': '!=', '!=': '==', '>': '<=', '>=': '<', '<': '>=', '<=': '>',
    elapsed: 'running', running: 'elapsed', fired: '=='
  };
  if (condition.op === 'fired') {
    condition.op = 'fired';
    condition.value = condition.value === true ? false : true;
  } else if (inverted[condition.op]) {
    condition.op = inverted[condition.op];
  } else {
    return null;
  }
  return condition;
}

function dnfCross(leftClauses, rightClauses, maxClauses) {
  const out = [];
  leftClauses.forEach(function (left) {
    rightClauses.forEach(function (right) {
      if (out.length >= maxClauses) return;
      out.push(left.concat(right));
    });
  });
  return out;
}

function expressionToDnf(expression, negate, maxClauses, report) {
  if (!expression) return [];
  if (expression.kind === 'const') {
    const value = negate ? !expression.value : expression.value;
    return value ? [[]] : [];
  }
  if (expression.kind === 'leaf') {
    const condition = negate ? invertCondition(expression.condition) : cloneValue(expression.condition);
    if (!condition) {
      report.errors.push('Bedingung kann für NOT nicht V9-konform invertiert werden.');
      return [];
    }
    return [[condition]];
  }
  if (expression.kind === 'not') {
    return expressionToDnf(expression.child, !negate, maxClauses, report);
  }
  let kind = expression.kind;
  if (negate) {
    if (kind === 'and') kind = 'or';
    else if (kind === 'or') kind = 'and';
    else if (kind === 'xor') {
      const left = expression.children[0];
      const right = expression.children[1];
      const equalExpr = expressionGroup('or', [
        expressionGroup('and', [left, right]),
        expressionGroup('and', [expressionNot(left), expressionNot(right)])
      ]);
      return expressionToDnf(equalExpr, false, maxClauses, report);
    }
  }
  if (kind === 'xor') {
    const left = expression.children[0];
    const right = expression.children[1];
    const xorExpr = expressionGroup('or', [
      expressionGroup('and', [left, expressionNot(right)]),
      expressionGroup('and', [expressionNot(left), right])
    ]);
    return expressionToDnf(xorExpr, negate, maxClauses, report);
  }
  if (kind === 'or') {
    const clauses = [];
    expression.children.forEach(function (child) {
      const childClauses = expressionToDnf(child, negate, maxClauses, report);
      childClauses.forEach(function (clause) {
        if (clauses.length < maxClauses) clauses.push(clause);
      });
    });
    if (clauses.length >= maxClauses) report.warnings.push('DNF wurde auf ' + maxClauses + ' Klauseln begrenzt.');
    return clauses;
  }
  if (kind === 'and') {
    let clauses = [[]];
    expression.children.forEach(function (child) {
      const childClauses = expressionToDnf(child, negate, maxClauses, report);
      clauses = dnfCross(clauses, childClauses, maxClauses);
    });
    if (clauses.length >= maxClauses) report.warnings.push('DNF wurde auf ' + maxClauses + ' Klauseln begrenzt.');
    return clauses;
  }
  report.errors.push('Unbekannte Ausdrucksart: ' + expression.kind);
  return [];
}

function stableHash(textValue) {
  const text = String(textValue);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function uniqueNumericId(seed, used) {
  let candidate = 600000 + (stableHash(seed) % 300000);
  while (used.has(candidate)) {
    candidate += 1;
    if (candidate > 899999) candidate = 600000;
  }
  used.add(candidate);
  return candidate;
}

function sanitizeIdentifier(value, fallback) {
  let text = toText(value, fallback || 'logic').replace(/[^A-Za-z0-9_]+/g, '_');
  text = text.replace(/^_+|_+$/g, '');
  if (!text) text = fallback || 'logic';
  if (/^[0-9]/.test(text)) text = 'L_' + text;
  return text;
}

function configMeta(config) {
  return asArray(config && config.meta)[0] || {};
}

function generatedRule(rule) {
  return toText(rule && rule.description, '').indexOf(LOGIC_GENERATED_PREFIX) === 0;
}

function existingRuleTargets(rules) {
  const map = new Map();
  asArray(rules).filter(function (rule) { return !generatedRule(rule); }).forEach(function (rule) {
    ['do', 'else_do'].forEach(function (bucket) {
      asArray(rule[bucket]).forEach(function (action) {
        asArray(action.state_ids).forEach(function (stateId) {
          if (action.value_id != null) map.set('state:' + stateId + ':value_id', rule);
          if (isObject(action.parameters)) {
            Object.keys(action.parameters).forEach(function (key) {
              map.set('state:' + stateId + ':parameters.' + key, rule);
            });
          }
        });
      });
    });
  });
  return map;
}

function actionFromNodeNative(node, diagram, nodes, report) {
  const config = isObject(node.config) ? node.config : {};
  const binding = isObject(node.binding) ? node.binding : {};
  if (node.block_type === 'state_write') {
    const stateId = integerValue(config.state_id != null ? config.state_id : binding.state_id, null);
    if (stateId == null) {
      report.errors.push('State-Ausgang ' + node.label + ' hat keine state_id.');
      return null;
    }
    return {
      true_action: { state_ids: [stateId], value_id: Math.max(1, integerValue(config.value_id_true, 1)) },
      false_action: config.write_false === false ? null
        : { state_ids: [stateId], value_id: Math.max(1, integerValue(config.value_id_false, 2)) },
      target: 'state:' + stateId + ':value_id'
    };
  }
  if (node.block_type === 'state_parameter') {
    const stateId = integerValue(config.state_id != null ? config.state_id : binding.state_id, null);
    const key = toText(config.parameter_key || binding.parameter_key, '');
    if (stateId == null || !key) {
      report.errors.push('State-Parameter-Ausgang ' + node.label + ' ist unvollständig gebunden.');
      return null;
    }
    let value = config.value;
    const valueEdge = incomingEdge(diagram, node.node_id, 'VALUE');
    if (valueEdge) {
      const literal = literalFromOutput(diagram, nodes, valueEdge.from.node_id, valueEdge.from.port_id, new Set());
      if (!literal.found) {
        report.bridge_nodes.push(node.node_id);
        report.warnings.push('Dynamische State-Parameter benötigen den Bridge-Layer; V9-Aktionen sind statische Patches.');
        return null;
      }
      value = literal.value;
    }
    const parameters = {};
    parameters[key] = value;
    return {
      true_action: { state_ids: [stateId], parameters: parameters },
      false_action: null,
      target: 'state:' + stateId + ':parameters.' + key
    };
  }
  if (node.block_type === 'notify') {
    return {
      true_action: { notify: toText(config.message, 'Logic event') },
      false_action: null,
      target: ''
    };
  }
  report.bridge_nodes.push(node.node_id);
  report.warnings.push('Ausgang ' + node.label + ' wird für Automation_System über den Bridge-Layer ausgeführt.');
  return null;
}

function ruleBaseForDiagram(diagram, config, node) {
  const meta = configMeta(config);
  const execution = normalizeExecution(diagram.execution);
  const owner = toText(execution.owner_node_id || meta.node_id || meta.owner_node_id, 'fn-01');
  const cross = execution.scope_kind === 'cross_controller' || execution.scope_kind === 'cross_worker';
  return {
    engine_id: execution.engine_id,
    owner_node_id: owner,
    execution_owner: owner,
    execution_scope: cross ? 'cross:' + owner + '.default' : 'node:' + owner,
    execution_epoch: 1,
    deployment_status: cross ? 'active_cross' : 'active_node',
    activation_state: 'active',
    group: 'process',
    priority: Math.max(0, integerValue((node.config || {}).priority, execution.priority)),
    enabled: diagram.enabled !== false
  };
}

function appendRulesForClauses(target, clauses, action, ruleBase, nameBase, descriptionBase, usedIds, branch) {
  clauses.forEach(function (clause, index) {
    if (!clause.length) return;
    const rule = Object.assign({}, ruleBase, {
      rule_id: uniqueNumericId(descriptionBase + ':' + branch + ':' + index, usedIds),
      name: sanitizeIdentifier(nameBase + '_' + branch + '_' + (index + 1), 'logic_rule'),
      when: cloneValue(clause),
      do: [cloneValue(action)],
      description: descriptionBase + ':' + branch + ':' + (index + 1) + '] generated from the canonical PF-LOGIC-V1 graph'
    });
    target.push(rule);
  });
}

export function compileLogicToAutomationV9(modelValue, baseConfigValue, contextValue) {
  const model = normalizeLogicModel(modelValue);
  const baseConfig = cloneValue(isObject(baseConfigValue) ? baseConfigValue : {});
  const context = isObject(contextValue) ? contextValue : {};
  const report = {
    status: 'OK',
    errors: [],
    warnings: [],
    generated_rules: 0,
    native_actions: 0,
    bridge_actions: 0,
    bridge_nodes: [],
    cross_rules: [],
    conflicts: []
  };
  if (!Array.isArray(baseConfig.rules) || !Array.isArray(baseConfig.rule_engine)
      || !Array.isArray(baseConfig.process_states)) {
    report.errors.push('Die Automation_System-Basis ist keine vollständige kanonische V9-Konfiguration.');
    report.status = 'FAILED';
    return { config: baseConfig, report: report, generated_rules: [], cross_rules: [] };
  }
  const validation = validateLogicModel(model, context);
  if (validation.errors.length) {
    report.errors.push('PF-LOGIC-V1-Modell enthält ' + validation.errors.length + ' strukturelle Fehler.');
  }
  const manualTargets = existingRuleTargets(baseConfig.rules);
  const usedIds = new Set(asArray(baseConfig.rules).filter(function (rule) {
    return !generatedRule(rule);
  }).map(function (rule) { return integerValue(rule.rule_id, 0); }));
  const generated = [];
  const crossRules = [];
  const maxClauses = Math.max(1, integerValue((model.settings || {}).max_dnf_clauses, LOGIC_MAX_DNF_CLAUSES));

  model.diagrams.filter(function (diagram) { return diagram.enabled !== false; }).forEach(function (diagram) {
    const nodes = nodeIndexForDiagram(diagram);
    diagram.nodes.filter(function (node) {
      return node.enabled !== false && ['state_write', 'state_parameter', 'notify', 'actuator_write', 'hmi_write', 'signal_out'].indexOf(node.block_type) >= 0;
    }).forEach(function (node) {
      const localReport = { errors: [], warnings: [], bridge_nodes: [] };
      const expression = expressionForInput(diagram, nodes, node.node_id,
        node.block_type === 'signal_out' ? 'VALUE' : 'EN', localReport);
      const action = actionFromNodeNative(node, diagram, nodes, localReport);
      if (!expression || !action) {
        report.bridge_actions += 1;
        report.errors.push.apply(report.errors, localReport.errors);
        report.warnings.push.apply(report.warnings, localReport.warnings);
        report.bridge_nodes.push.apply(report.bridge_nodes, localReport.bridge_nodes);
        return;
      }
      const ownership = toText((node.config || {}).ownership_mode, 'logic');
      if (action.target && manualTargets.has(action.target) && ownership !== 'hybrid') {
        const conflict = 'Ziel ' + action.target + ' wird bereits von manueller Regel '
          + manualTargets.get(action.target).rule_id + ' geschrieben. ownership_mode muss explizit hybrid sein.';
        report.conflicts.push(conflict);
        report.errors.push(conflict);
        return;
      }
      if (action.target && manualTargets.has(action.target) && ownership === 'hybrid') {
        report.warnings.push('Hybridziel ' + action.target + ' nutzt Runtime-Prioritäten zur deterministischen Arbitration.');
      }
      const trueClauses = expressionToDnf(expression, false, maxClauses, localReport);
      const falseClauses = action.false_action
        ? expressionToDnf(expression, true, maxClauses, localReport) : [];
      if (!trueClauses.length) {
        report.errors.push('Ausgang ' + node.label + ' erzeugt keine V9-legale Bedingung.');
        report.bridge_actions += 1;
        return;
      }
      if (trueClauses.some(function (clause) { return !clause.length; })) {
        report.errors.push('Konstant aktive V9-Regeln sind im strikten Config-Vertrag nicht zulässig.');
        report.bridge_actions += 1;
        return;
      }
      const base = ruleBaseForDiagram(diagram, baseConfig, node);
      const destination = base.deployment_status === 'active_cross' ? crossRules : generated;
      const description = LOGIC_GENERATED_PREFIX + diagram.diagram_id + ':' + node.node_id;
      appendRulesForClauses(destination, trueClauses, action.true_action, base,
        diagram.name + '_' + node.label, description, usedIds, 'true');
      if (action.false_action) {
        appendRulesForClauses(destination, falseClauses, action.false_action, base,
          diagram.name + '_' + node.label, description, usedIds, 'false');
      }
      report.native_actions += 1;
      report.errors.push.apply(report.errors, localReport.errors);
      report.warnings.push.apply(report.warnings, localReport.warnings);
      report.bridge_nodes.push.apply(report.bridge_nodes, localReport.bridge_nodes);
    });
  });

  baseConfig.rules = baseConfig.rules.filter(function (rule) {
    return !generatedRule(rule);
  }).concat(generated).sort(function (left, right) {
    return integerValue(left.rule_id, 0) - integerValue(right.rule_id, 0);
  });
  report.generated_rules = generated.length;
  report.cross_rules = cloneValue(crossRules);
  report.bridge_nodes = Array.from(new Set(report.bridge_nodes)).sort(stableTextCompare);
  report.status = report.errors.length ? 'FAILED' : (report.warnings.length ? 'WARNING' : 'OK');
  return { config: baseConfig, report: report, generated_rules: generated, cross_rules: crossRules };
}

export function applyLogicCrossRulesToV8(baseCrossConfigValue, crossRulesValue) {
  const config = cloneValue(isObject(baseCrossConfigValue) ? baseCrossConfigValue : {});
  const rules = asArray(config.rules).filter(function (rule) {
    return !generatedRule(rule);
  });
  const generated = asArray(crossRulesValue).map(function (rule) {
    return cloneValue(rule);
  });
  config.rules = rules.concat(generated).sort(function (left, right) {
    return integerValue(left.rule_id, 0) - integerValue(right.rule_id, 0);
  });
  return {
    config: config,
    generated_rules: generated,
    report: {
      status: generated.length ? 'OK' : 'EMPTY',
      generated_rules: generated.length,
      scope: 'cross',
      source_of_truth: 'project.logic'
    }
  };
}

function universalExecutionPlan(diagram) {
  const topology = logicTopologicalOrder(diagram);
  return {
    diagram_id: diagram.diagram_id,
    order: topology.order,
    cyclic: topology.cyclic,
    execution: cloneValue(diagram.execution),
    target_profile: diagram.target_profile
  };
}

export function compileLogicToUniversalJson(modelValue, contextValue) {
  const model = normalizeLogicModel(modelValue);
  const context = isObject(contextValue) ? contextValue : {};
  const validation = validateLogicModel(model, context);
  return {
    schema: 'plant_factory.logic_runtime.v1',
    version: 1,
    generated_by: 'Plant Factory V64',
    source_standard: cloneValue(model.standard),
    source_of_truth: 'project.logic',
    generated_at: nowIso(),
    target_profile: 'universal_json',
    diagrams: cloneValue(model.diagrams),
    signal_catalog: cloneValue(asArray(context.signalCatalog)),
    execution_plans: model.diagrams.map(universalExecutionPlan),
    validation: validation,
    compatibility: cloneValue(LOGIC_TARGETS)
  };
}

function sclType(dataTypeValue) {
  const dataType = toText(dataTypeValue, 'ANY');
  if (dataType === 'BOOL') return 'Bool';
  if (dataType === 'INT') return 'Int';
  if (dataType === 'DINT') return 'DInt';
  if (dataType === 'REAL' || dataType === 'NUMERIC' || dataType === 'ANY') return 'Real';
  if (dataType === 'TIME') return 'Time';
  if (dataType === 'STRING' || dataType === 'ENUM') return 'String[254]';
  return 'Real';
}

function sclLiteral(value, dataTypeValue) {
  const dataType = toText(dataTypeValue, 'ANY');
  if (dataType === 'BOOL') return Boolean(value) ? 'TRUE' : 'FALSE';
  if (dataType === 'TIME') return 'T#' + Math.max(0, integerValue(value, 0)) + 'ms';
  if (dataType === 'STRING' || dataType === 'ENUM') return "'" + String(value == null ? '' : value).replace(/'/g, "''") + "'";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '0';
}

function sclNodeVar(node, portId) {
  return '#n_' + sanitizeIdentifier(node.node_id, 'node') + '_' + sanitizeIdentifier(portId, 'Q');
}

function sclSignalVar(binding, node) {
  return '#in_' + sanitizeIdentifier((binding || {}).signal_ref || node.label || node.node_id, 'signal');
}

function sclInputExpression(diagram, nodes, node, portId, outputExpressions, fallback, dataType) {
  const edge = incomingEdge(diagram, node.node_id, portId);
  if (!edge) return sclLiteral(fallback, dataType);
  return outputExpressions[outputKey(edge.from.node_id, edge.from.port_id)] || sclNodeVar(nodes.get(edge.from.node_id), edge.from.port_id);
}

function pushUniqueDeclaration(list, seen, name, type) {
  if (seen.has(name)) return;
  seen.add(name);
  list.push('      ' + name.replace(/^#/, '') + ' : ' + type + ';');
}

function compileSclDiagram(diagram, report, tagRows) {
  const nodes = nodeIndexForDiagram(diagram);
  const topology = logicTopologicalOrder(diagram);
  if (topology.cyclic) {
    report.errors.push('SCL: Schaltplan ' + diagram.name + ' enthält einen Zyklus.');
    return '';
  }
  const name = sanitizeIdentifier(diagram.name + '_' + diagram.diagram_id, 'LogicDiagram').slice(0, 80);
  const inputDecl = [];
  const inputSeen = new Set();
  const outputDecl = [];
  const outputSeen = new Set();
  const varDecl = [];
  const varSeen = new Set();
  const tempDecl = [];
  const tempSeen = new Set();
  const body = [];
  const outputExpressions = {};

  topology.order.forEach(function (nodeId) {
    const node = nodes.get(nodeId);
    if (!node || node.enabled === false) return;
    const config = isObject(node.config) ? node.config : {};
    if (node.block_type === 'signal_in') {
      const type = toText((node.binding || {}).data_type || config.data_type, 'BOOL');
      const variable = sclSignalVar(node.binding, node);
      pushUniqueDeclaration(inputDecl, inputSeen, variable, sclType(type));
      outputExpressions[outputKey(node.node_id, 'Q')] = variable;
      tagRows.push({
        diagram_id: diagram.diagram_id,
        direction: 'input',
        plc_tag: variable.replace(/^#/, ''),
        data_type: type,
        signal_ref: toText((node.binding || {}).signal_ref, ''),
        target: 'siemens_scl'
      });
      return;
    }
    if (node.block_type.indexOf('constant_') === 0) {
      const type = node.block_type === 'constant_bool' ? 'BOOL'
        : (node.block_type === 'constant_int' ? 'INT'
          : (node.block_type === 'constant_real' ? 'REAL' : 'TIME'));
      const value = node.block_type === 'constant_time' ? config.value_ms : config.value;
      outputExpressions[outputKey(node.node_id, 'Q')] = sclLiteral(value, type);
      return;
    }
    if (['not', 'and', 'or', 'xor'].indexOf(node.block_type) >= 0) {
      const variable = sclNodeVar(node, 'Q');
      pushUniqueDeclaration(tempDecl, tempSeen, variable, 'Bool');
      if (node.block_type === 'not') {
        body.push('    ' + variable + ' := NOT ' + sclInputExpression(diagram, nodes, node, 'IN', outputExpressions, false, 'BOOL') + ';');
      } else {
        const left = sclInputExpression(diagram, nodes, node, 'IN1', outputExpressions, false, 'BOOL');
        const right = sclInputExpression(diagram, nodes, node, 'IN2', outputExpressions, false, 'BOOL');
        const op = node.block_type === 'and' ? 'AND' : (node.block_type === 'or' ? 'OR' : 'XOR');
        body.push('    ' + variable + ' := ' + left + ' ' + op + ' ' + right + ';');
      }
      outputExpressions[outputKey(node.node_id, 'Q')] = variable;
      return;
    }
    if (node.block_type.indexOf('compare_') === 0) {
      const variable = sclNodeVar(node, 'Q');
      pushUniqueDeclaration(tempDecl, tempSeen, variable, 'Bool');
      const left = sclInputExpression(diagram, nodes, node, 'A', outputExpressions, 0, 'REAL');
      const right = sclInputExpression(diagram, nodes, node, 'B', outputExpressions, 0, 'REAL');
      const op = comparisonOperator(node.block_type).replace('==', '=').replace('!=', '<>');
      body.push('    ' + variable + ' := ' + left + ' ' + op + ' ' + right + ';');
      outputExpressions[outputKey(node.node_id, 'Q')] = variable;
      return;
    }
    if (['ton', 'tof', 'tp'].indexOf(node.block_type) >= 0) {
      const instance = '#fb_' + sanitizeIdentifier(node.node_id, 'timer');
      pushUniqueDeclaration(varDecl, varSeen, instance, node.block_type.toUpperCase() + '_TIME');
      const input = sclInputExpression(diagram, nodes, node, 'IN', outputExpressions, false, 'BOOL');
      const pt = sclInputExpression(diagram, nodes, node, 'PT', outputExpressions, config.pt_ms, 'TIME');
      body.push('    ' + instance + '(IN := ' + input + ', PT := ' + pt + ');');
      outputExpressions[outputKey(node.node_id, 'Q')] = instance + '.Q';
      outputExpressions[outputKey(node.node_id, 'ET')] = instance + '.ET';
      return;
    }
    if (['ctu', 'ctd'].indexOf(node.block_type) >= 0) {
      const instance = '#fb_' + sanitizeIdentifier(node.node_id, 'counter');
      pushUniqueDeclaration(varDecl, varSeen, instance, node.block_type.toUpperCase() + '_DINT');
      const triggerPort = node.block_type === 'ctu' ? 'CU' : 'CD';
      const resetPort = node.block_type === 'ctu' ? 'R' : 'LD';
      const trigger = sclInputExpression(diagram, nodes, node, triggerPort, outputExpressions, false, 'BOOL');
      const reset = sclInputExpression(diagram, nodes, node, resetPort, outputExpressions, false, 'BOOL');
      const pv = sclInputExpression(diagram, nodes, node, 'PV', outputExpressions, config.pv, 'DINT');
      body.push('    ' + instance + '(' + triggerPort + ' := ' + trigger + ', ' + resetPort + ' := ' + reset + ', PV := ' + pv + ');');
      outputExpressions[outputKey(node.node_id, 'Q')] = instance + '.Q';
      outputExpressions[outputKey(node.node_id, 'CV')] = instance + '.CV';
      return;
    }
    if (['add', 'sub', 'mul', 'div', 'min', 'max', 'limit'].indexOf(node.block_type) >= 0) {
      const variable = sclNodeVar(node, 'Q');
      pushUniqueDeclaration(tempDecl, tempSeen, variable, 'Real');
      if (node.block_type === 'limit') {
        const min = sclInputExpression(diagram, nodes, node, 'MIN', outputExpressions, 0, 'REAL');
        const input = sclInputExpression(diagram, nodes, node, 'IN', outputExpressions, 0, 'REAL');
        const max = sclInputExpression(diagram, nodes, node, 'MAX', outputExpressions, 100, 'REAL');
        body.push('    ' + variable + ' := LIMIT(MN := ' + min + ', IN := ' + input + ', MX := ' + max + ');');
      } else if (node.block_type === 'min' || node.block_type === 'max') {
        const left = sclInputExpression(diagram, nodes, node, 'A', outputExpressions, 0, 'REAL');
        const right = sclInputExpression(diagram, nodes, node, 'B', outputExpressions, 0, 'REAL');
        body.push('    ' + variable + ' := ' + node.block_type.toUpperCase() + '(IN1 := ' + left + ', IN2 := ' + right + ');');
      } else {
        const left = sclInputExpression(diagram, nodes, node, 'A', outputExpressions, 0, 'REAL');
        const right = sclInputExpression(diagram, nodes, node, 'B', outputExpressions, 0, 'REAL');
        const op = node.block_type === 'add' ? '+' : (node.block_type === 'sub' ? '-' : (node.block_type === 'mul' ? '*' : '/'));
        if (node.block_type === 'div') body.push('    ' + variable + ' := SEL(G := (' + right + ' = 0.0), IN0 := ' + left + ' / ' + right + ', IN1 := 0.0);');
        else body.push('    ' + variable + ' := ' + left + ' ' + op + ' ' + right + ';');
      }
      outputExpressions[outputKey(node.node_id, 'Q')] = variable;
      return;
    }
    if (['state_write', 'state_parameter', 'notify', 'actuator_write', 'hmi_write', 'signal_out'].indexOf(node.block_type) >= 0) {
      const binding = isObject(node.binding) ? node.binding : {};
      const configValue = isObject(node.config) ? node.config : {};
      const variable = '#out_' + sanitizeIdentifier((binding.signal_ref || node.label || node.node_id), 'output');
      const type = node.block_type === 'state_write' ? 'DINT'
        : toText(binding.data_type || configValue.data_type, node.block_type === 'notify' ? 'BOOL' : 'ANY');
      pushUniqueDeclaration(outputDecl, outputSeen, variable, sclType(type));
      if (node.block_type === 'state_write') {
        const enable = sclInputExpression(diagram, nodes, node, 'EN', outputExpressions, false, 'BOOL');
        body.push('    IF ' + enable + ' THEN');
        body.push('      ' + variable + ' := ' + integerValue(configValue.value_id_true, 1) + ';');
        if (configValue.write_false !== false) {
          body.push('    ELSE');
          body.push('      ' + variable + ' := ' + integerValue(configValue.value_id_false, 2) + ';');
        }
        body.push('    END_IF;');
      } else if (node.block_type === 'signal_out') {
        body.push('    ' + variable + ' := ' + sclInputExpression(diagram, nodes, node, 'VALUE', outputExpressions, configValue.value, type) + ';');
      } else if (node.block_type === 'notify') {
        body.push('    ' + variable + ' := ' + sclInputExpression(diagram, nodes, node, 'EN', outputExpressions, false, 'BOOL') + ';');
      } else {
        const enable = sclInputExpression(diagram, nodes, node, 'EN', outputExpressions, false, 'BOOL');
        const value = sclInputExpression(diagram, nodes, node, 'VALUE', outputExpressions, configValue.value, type);
        body.push('    IF ' + enable + ' THEN ' + variable + ' := ' + value + '; END_IF;');
      }
      tagRows.push({
        diagram_id: diagram.diagram_id,
        direction: 'output',
        plc_tag: variable.replace(/^#/, ''),
        data_type: type,
        signal_ref: toText(binding.signal_ref, actionTargetToken(node)),
        target: node.block_type
      });
      return;
    }
    report.warnings.push('SCL überspringt unbekannten Baustein ' + node.block_type + '.');
  });

  const lines = [];
  lines.push('FUNCTION_BLOCK "PF_' + name + '"');
  lines.push('{ S7_Optimized_Access := \'TRUE\' }');
  if (inputDecl.length) {
    lines.push('  VAR_INPUT');
    lines.push.apply(lines, inputDecl);
    lines.push('  END_VAR');
  }
  if (outputDecl.length) {
    lines.push('  VAR_OUTPUT');
    lines.push.apply(lines, outputDecl);
    lines.push('  END_VAR');
  }
  if (varDecl.length) {
    lines.push('  VAR');
    lines.push.apply(lines, varDecl);
    lines.push('  END_VAR');
  }
  if (tempDecl.length) {
    lines.push('  VAR_TEMP');
    lines.push.apply(lines, tempDecl);
    lines.push('  END_VAR');
  }
  lines.push('BEGIN');
  lines.push('    // Generated from the canonical PF-LOGIC-V1 diagram.');
  lines.push.apply(lines, body);
  lines.push('END_FUNCTION_BLOCK');
  return lines.join('\n');
}

function tagRowsToCsv(rows) {
  const lines = ['diagram_id,direction,plc_tag,data_type,signal_ref,target'];
  rows.forEach(function (row) {
    const fields = [row.diagram_id, row.direction, row.plc_tag, row.data_type, row.signal_ref, row.target];
    lines.push(fields.map(function (value) {
      const text = String(value == null ? '' : value).replace(/"/g, '""');
      return '"' + text + '"';
    }).join(','));
  });
  return lines.join('\n') + '\n';
}

export function compileLogicToSiemensScl(modelValue, contextValue) {
  const model = normalizeLogicModel(modelValue);
  const context = isObject(contextValue) ? contextValue : {};
  const validation = validateLogicModel(model, context);
  const report = { status: 'OK', errors: [], warnings: [], diagrams: 0 };
  if (validation.errors.length) {
    report.errors.push('PF-LOGIC-V1-Modell enthält ' + validation.errors.length + ' strukturelle Fehler.');
  }
  const tagRows = [];
  const sources = [];
  model.diagrams.filter(function (diagram) { return diagram.enabled !== false; }).forEach(function (diagram) {
    const source = compileSclDiagram(diagram, report, tagRows);
    if (source) {
      sources.push(source);
      report.diagrams += 1;
    }
  });
  report.status = report.errors.length ? 'FAILED' : (report.warnings.length ? 'WARNING' : 'OK');
  return {
    scl: sources.join('\n\n'),
    tags_csv: tagRowsToCsv(tagRows),
    tags: tagRows,
    report: report
  };
}

export function compileLogicArtifacts(modelValue, contextValue) {
  const context = isObject(contextValue) ? contextValue : {};
  const model = normalizeLogicModel(modelValue);
  const universal = compileLogicToUniversalJson(model, context);
  const v9 = compileLogicToAutomationV9(model, context.deviceConfig || {}, context);
  const v8Cross = applyLogicCrossRulesToV8(context.crossConfig || {}, v9.cross_rules);
  const siemens = compileLogicToSiemensScl(model, context);
  const report = {
    status: v9.report.errors.length || siemens.report.errors.length || universal.validation.errors.length
      ? 'FAILED'
      : (v9.report.warnings.length || siemens.report.warnings.length || universal.validation.warnings.length
        ? 'WARNING' : 'OK'),
    model: universal.validation,
    automation_system_v9: v9.report,
    automation_system_v8_cross: v8Cross.report,
    siemens_scl: siemens.report,
    compatibility: cloneValue(LOGIC_TARGETS)
  };
  return {
    model: model,
    universal: universal,
    automation_v9: v9,
    automation_v8_cross: v8Cross,
    siemens: siemens,
    report: report
  };
}

export function createTimerCounterDemo(signalCatalogValue) {
  const catalog = asArray(signalCatalogValue);
  const boolRead = catalog.find(function (entry) {
    return entry.access !== 'write' && entry.data_type === 'BOOL';
  });
  const writableState = catalog.find(function (entry) {
    return entry.source_kind === 'process_state' && entry.access !== 'read';
  });
  const model = createEmptyLogicModel();
  const diagram = createLogicDiagram({
    diagram_id: 'logic_timer_counter_demo',
    name: 'Timer & Counter Demo',
    description: 'Additives PF-LOGIC-V1 Beispiel mit Bool-Logik, IEC-Timern und Zähler.',
    target_profile: 'universal',
    execution: { scope_kind: 'node_local', owner_node_id: 'fn-01', engine_id: 1, priority: 500 }
  });
  const source = createLogicNode('signal_in', 70, 170, {
    node_id: 'demo_tick_in', label: 'Tick', binding: boolRead ? cloneValue(boolRead) : {
      signal_ref: 'demo.tick', label: 'Demo Tick', data_type: 'BOOL', access: 'read', source_kind: 'fact'
    }, config: { data_type: 'BOOL', default_value: false }
  });
  const notNode = createLogicNode('not', 320, 150, { node_id: 'demo_not', label: 'NOT' });
  const timeConst = createLogicNode('constant_time', 250, 360, { node_id: 'demo_time', label: 'T#500ms', config: { value_ms: 500 } });
  const ton = createLogicNode('ton', 540, 140, { node_id: 'demo_ton', label: 'TON0', config: { pt_ms: 500 } });
  const tof = createLogicNode('tof', 860, 140, { node_id: 'demo_tof', label: 'TOF0', config: { pt_ms: 500 } });
  const stateOut = createLogicNode('state_write', 1150, 150, {
    node_id: 'demo_state_out', label: 'State Output',
    binding: writableState ? cloneValue(writableState) : null,
    config: {
      state_id: writableState ? writableState.state_id : 1,
      value_id_true: 1, value_id_false: 2, write_false: true,
      ownership_mode: 'hybrid', priority: 500
    }
  });
  const counterTick = createLogicNode('signal_in', 300, 650, {
    node_id: 'demo_counter_tick', label: 'Counter Tick', binding: boolRead ? cloneValue(boolRead) : {
      signal_ref: 'demo.counter_tick', label: 'Demo Counter Tick', data_type: 'BOOL', access: 'read', source_kind: 'fact'
    }, config: { data_type: 'BOOL', default_value: false }
  });
  const reset = createLogicNode('signal_in', 300, 770, {
    node_id: 'demo_reset', label: 'Reset', binding: {
      signal_ref: 'demo.reset', label: 'Demo Reset', data_type: 'BOOL', access: 'read', source_kind: 'fact'
    }, config: { data_type: 'BOOL', default_value: false }
  });
  const pv = createLogicNode('constant_int', 310, 900, { node_id: 'demo_pv', label: '10', config: { value: 10 } });
  const ctu = createLogicNode('ctu', 650, 690, { node_id: 'demo_ctu', label: 'CTU0', config: { pv: 10 } });
  const countOut = createLogicNode('signal_out', 1040, 720, {
    node_id: 'demo_count_out', label: 'Count Value', binding: {
      signal_ref: 'demo.count_value', label: 'Count Value', data_type: 'INT', access: 'write', source_kind: 'fact'
    }, config: { data_type: 'INT', ownership_mode: 'logic' }
  });
  const reachedOut = createLogicNode('signal_out', 1040, 610, {
    node_id: 'demo_reached_out', label: 'Counter Reached', binding: {
      signal_ref: 'demo.counter_reached', label: 'Counter Reached', data_type: 'BOOL', access: 'write', source_kind: 'fact'
    }, config: { data_type: 'BOOL', ownership_mode: 'logic' }
  });
  diagram.nodes = [source, notNode, timeConst, ton, tof, stateOut, counterTick, reset, pv, ctu, countOut, reachedOut];
  diagram.edges = [
    createLogicEdge(source.node_id, 'Q', notNode.node_id, 'IN', 'BOOL', { edge_id: 'demo_e1' }),
    createLogicEdge(notNode.node_id, 'Q', ton.node_id, 'IN', 'BOOL', { edge_id: 'demo_e2' }),
    createLogicEdge(timeConst.node_id, 'Q', ton.node_id, 'PT', 'TIME', { edge_id: 'demo_e3' }),
    createLogicEdge(ton.node_id, 'Q', tof.node_id, 'IN', 'BOOL', { edge_id: 'demo_e4' }),
    createLogicEdge(timeConst.node_id, 'Q', tof.node_id, 'PT', 'TIME', { edge_id: 'demo_e5' }),
    createLogicEdge(tof.node_id, 'Q', stateOut.node_id, 'EN', 'BOOL', { edge_id: 'demo_e6' }),
    createLogicEdge(counterTick.node_id, 'Q', ctu.node_id, 'CU', 'BOOL', { edge_id: 'demo_e7' }),
    createLogicEdge(reset.node_id, 'Q', ctu.node_id, 'R', 'BOOL', { edge_id: 'demo_e8' }),
    createLogicEdge(pv.node_id, 'Q', ctu.node_id, 'PV', 'INT', { edge_id: 'demo_e9' }),
    createLogicEdge(ctu.node_id, 'CV', countOut.node_id, 'VALUE', 'INT', { edge_id: 'demo_e10' }),
    createLogicEdge(ctu.node_id, 'Q', reachedOut.node_id, 'VALUE', 'BOOL', { edge_id: 'demo_e11' })
  ];
  model.diagrams = [diagram];
  model.active_diagram_id = diagram.diagram_id;
  return model;
}
