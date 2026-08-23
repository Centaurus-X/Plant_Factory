/**
 * v63_logic_ui.js — additive PF-LOGIC-V1 Function Block Diagram workspace.
 *
 * The module is intentionally a view/controller only. Canonical data,
 * validation, evaluation and target compilation live in logic_core.js.
 */

'use strict';

import { state, showStatus, utils } from './core.js';
import {
  LOGIC_STANDARD_ID,
  applyLogicCrossRulesToV8,
  buildLogicSignalCatalog,
  compileLogicArtifacts,
  createEmptyLogicModel,
  createLogicDiagram,
  createLogicEdge,
  createLogicNode,
  createTimerCounterDemo,
  generateLogicId,
  logicBlockDefinition,
  logicBlockLibrary,
  logicDataTypesCompatible,
  logicPortsForNode,
  normalizeLogicModel,
  validateLogicModel
} from './logic_core.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const library = logicBlockLibrary();
const BLOCKS = Array.isArray(library.blocks) ? library.blocks : [];
const CATEGORIES = Array.isArray(library.categories) ? library.categories : [];

const ui = {
  inventoryTab: 'diagrams',
  inspectorTab: 'details',
  mode: 'select',
  selectedNodeId: null,
  selectedEdgeId: null,
  pendingPort: null,
  drag: null,
  zoom: 1,
  artifacts: null,
  preview: 'report',
  diagramModalMode: 'create',
  contextTarget: null,
  renderPending: false,
  signalCatalog: []
};

function byId(id) {
  return document.getElementById(id);
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

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function modelValue() {
  return normalizeLogicModel(state.get('logic') || createEmptyLogicModel());
}

function activeDiagram(modelValueArg) {
  const model = modelValueArg || modelValue();
  if (!model || !Array.isArray(model.diagrams)) return null;
  return diagramById(model, model.active_diagram_id) || model.diagrams[0] || null;
}

function diagramById(model, diagramId) {
  return (model.diagrams || []).find(function (diagram) {
    return diagram.diagram_id === diagramId;
  }) || null;
}

function nodeById(diagram, nodeId) {
  return diagram && Array.isArray(diagram.nodes)
    ? diagram.nodes.find(function (node) { return node.node_id === nodeId; }) || null
    : null;
}

function edgeById(diagram, edgeId) {
  return diagram && Array.isArray(diagram.edges)
    ? diagram.edges.find(function (edge) { return edge.edge_id === edgeId; }) || null
    : null;
}

function commitModel(model, reason, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const normalized = normalizeLogicModel(model);
  state.set('logic', normalized);
  if (opts.history !== false && typeof state.saveHistory === 'function') state.saveHistory();
  state.emit('logic:updated', { reason: toText(reason, 'update'), model: normalized });
  scheduleRender();
  return normalized;
}

function mutateActiveDiagram(mutator, reason, options) {
  const model = modelValue();
  const diagram = activeDiagram(model);
  if (!diagram) return model;
  mutator(diagram, model);
  diagram.updated_at = new Date().toISOString();
  return commitModel(model, reason, options);
}

function scheduleRender() {
  if (ui.renderPending) return;
  ui.renderPending = true;
  window.requestAnimationFrame(function () {
    ui.renderPending = false;
    renderAll();
  });
}

function projectSnapshot() {
  const canonicalConfig = window.__v9 && typeof window.__v9.getConfig === 'function'
    ? window.__v9.getConfig() : (state.get('deviceConfig') || {});
  return {
    deviceConfig: canonicalConfig || {},
    elements: state.get('elements') || [],
    connections: state.get('connections') || [],
    devices: state.get('devices') || { version: 1, assignments: {} },
    hmi: state.get('hmi') || {},
    processes: state.get('processes') || {},
    freeRules: state.get('free_rules') || {}
  };
}

function refreshSignalCatalog() {
  ui.signalCatalog = buildLogicSignalCatalog(projectSnapshot());
  return ui.signalCatalog;
}

function currentContext() {
  const snapshot = projectSnapshot();
  const split = window.__v9 && typeof window.__v9.splitShards === 'function'
    ? window.__v9.splitShards(snapshot.deviceConfig) : null;
  let crossConfig = {};
  if (split && split.cross && typeof split.cross.values === 'function') {
    const iterator = split.cross.values();
    const first = iterator.next();
    crossConfig = first.done ? {} : first.value;
  }
  return {
    deviceConfig: snapshot.deviceConfig,
    crossConfig: crossConfig,
    signalCatalog: refreshSignalCatalog(),
    project: snapshot,
    runtimeProfile: 'universal'
  };
}

function selectDiagram(diagramId) {
  const model = modelValue();
  if (!diagramById(model, diagramId)) return;
  model.active_diagram_id = diagramId;
  ui.selectedNodeId = null;
  ui.selectedEdgeId = null;
  ui.pendingPort = null;
  commitModel(model, 'select_diagram', { history: false });
}

function selectNode(nodeId) {
  ui.selectedNodeId = nodeId || null;
  ui.selectedEdgeId = null;
  renderCanvasSelection();
  renderInspector();
}

function selectEdge(edgeId) {
  ui.selectedEdgeId = edgeId || null;
  ui.selectedNodeId = null;
  ui.pendingPort = null;
  renderCanvasSelection();
  renderInspector();
}

function clearSelection() {
  ui.selectedNodeId = null;
  ui.selectedEdgeId = null;
  ui.pendingPort = null;
  renderCanvasSelection();
  renderInspector();
}

function createDiagramAndSelect(values) {
  const model = modelValue();
  const diagram = createLogicDiagram(values || {});
  model.diagrams.push(diagram);
  model.active_diagram_id = diagram.diagram_id;
  ui.selectedNodeId = null;
  ui.selectedEdgeId = null;
  commitModel(model, 'diagram_add');
  return diagram;
}

function duplicateDiagram(diagramId) {
  const model = modelValue();
  const source = diagramById(model, diagramId);
  if (!source) return;
  const copy = cloneValue(source);
  copy.diagram_id = generateLogicId('diagram');
  copy.name = source.name + ' Kopie';
  copy.created_at = new Date().toISOString();
  copy.updated_at = copy.created_at;
  const nodeMap = {};
  copy.nodes.forEach(function (node) {
    const oldId = node.node_id;
    node.node_id = generateLogicId('node');
    nodeMap[oldId] = node.node_id;
  });
  copy.edges.forEach(function (edge) {
    edge.edge_id = generateLogicId('edge');
    edge.from.node_id = nodeMap[edge.from.node_id] || edge.from.node_id;
    edge.to.node_id = nodeMap[edge.to.node_id] || edge.to.node_id;
  });
  model.diagrams.push(copy);
  model.active_diagram_id = copy.diagram_id;
  commitModel(model, 'diagram_duplicate');
}

function deleteDiagram(diagramId) {
  const model = modelValue();
  const index = model.diagrams.findIndex(function (diagram) {
    return diagram.diagram_id === diagramId;
  });
  if (index < 0) return;
  model.diagrams.splice(index, 1);
  model.active_diagram_id = model.diagrams.length ? model.diagrams[Math.max(0, index - 1)].diagram_id : null;
  ui.selectedNodeId = null;
  ui.selectedEdgeId = null;
  commitModel(model, 'diagram_delete');
}

function nextNodePosition(diagram) {
  const count = diagram && Array.isArray(diagram.nodes) ? diagram.nodes.length : 0;
  return {
    x: 90 + (count % 4) * 240,
    y: 100 + Math.floor(count / 4) * 190
  };
}

function addBlock(blockType, position, binding) {
  const model = modelValue();
  let diagram = activeDiagram(model);
  if (!diagram) {
    diagram = createLogicDiagram({ name: 'Schaltplan 1' });
    model.diagrams.push(diagram);
    model.active_diagram_id = diagram.diagram_id;
  }
  const point = position || nextNodePosition(diagram);
  const options = {};
  if (binding) {
    options.binding = cloneValue(binding);
    options.label = binding.label;
    options.config = { data_type: binding.data_type };
    if (blockType === 'state_write') {
      options.config.state_id = binding.state_id;
      options.config.value_id_true = 1;
      options.config.value_id_false = 2;
      options.config.write_false = true;
      options.config.ownership_mode = 'logic';
    }
    if (blockType === 'state_parameter') {
      options.config.state_id = binding.state_id;
      options.config.parameter_key = binding.parameter_key;
      options.config.value = 0;
      options.config.ownership_mode = 'logic';
    }
  }
  const node = createLogicNode(blockType, point.x, point.y, options);
  diagram.nodes.push(node);
  ui.selectedNodeId = node.node_id;
  ui.selectedEdgeId = null;
  commitModel(model, 'node_add');
  return node;
}

function duplicateNode(nodeId) {
  mutateActiveDiagram(function (diagram) {
    const source = nodeById(diagram, nodeId);
    if (!source) return;
    const copy = cloneValue(source);
    copy.node_id = generateLogicId('node');
    copy.label = source.label + ' Kopie';
    copy.x += 34;
    copy.y += 34;
    copy.metadata = Object.assign({}, copy.metadata || {}, { created_at: new Date().toISOString() });
    diagram.nodes.push(copy);
    ui.selectedNodeId = copy.node_id;
    ui.selectedEdgeId = null;
  }, 'node_duplicate');
}

function deleteNode(nodeId) {
  mutateActiveDiagram(function (diagram) {
    diagram.nodes = diagram.nodes.filter(function (node) { return node.node_id !== nodeId; });
    diagram.edges = diagram.edges.filter(function (edge) {
      return edge.from.node_id !== nodeId && edge.to.node_id !== nodeId;
    });
    if (ui.selectedNodeId === nodeId) ui.selectedNodeId = null;
    ui.pendingPort = null;
  }, 'node_delete');
}

function deleteEdge(edgeId) {
  mutateActiveDiagram(function (diagram) {
    diagram.edges = diagram.edges.filter(function (edge) { return edge.edge_id !== edgeId; });
    if (ui.selectedEdgeId === edgeId) ui.selectedEdgeId = null;
  }, 'edge_delete');
}

function deleteSelection() {
  if (ui.selectedNodeId) deleteNode(ui.selectedNodeId);
  else if (ui.selectedEdgeId) deleteEdge(ui.selectedEdgeId);
}

function blockTypeForSignal(entry) {
  if (entry.access === 'read') return 'signal_in';
  if (entry.source_kind === 'process_state' && entry.field === 'value_id') return 'state_write';
  if (entry.source_kind === 'state_parameter') return 'state_parameter';
  if (entry.source_kind === 'actuator') return 'actuator_write';
  if (entry.source_kind === 'hmi') return 'hmi_write';
  return entry.access === 'write' ? 'signal_out' : 'signal_in';
}

function addSignal(entry) {
  addBlock(blockTypeForSignal(entry), null, entry);
}

function setMode(mode) {
  ui.mode = mode === 'connect' ? 'connect' : 'select';
  if (ui.mode !== 'connect') ui.pendingPort = null;
  const selectButton = byId('logic-tool-select');
  const connectButton = byId('logic-tool-connect');
  const hint = byId('logic-mode-hint');
  if (selectButton) selectButton.classList.toggle('active', ui.mode === 'select');
  if (connectButton) connectButton.classList.toggle('active', ui.mode === 'connect');
  if (hint) hint.textContent = ui.mode === 'connect' ? 'Port-Verbindung wählen' : 'Auswahlmodus';
  renderCanvasSelection();
}

function portDirectionPair(first, second) {
  if (first.port.direction === 'out' && second.port.direction === 'in') {
    return { from: first, to: second };
  }
  if (first.port.direction === 'in' && second.port.direction === 'out') {
    return { from: second, to: first };
  }
  return null;
}

function existingInputEdge(diagram, nodeId, portId) {
  return diagram.edges.find(function (edge) {
    return edge.enabled !== false && edge.to.node_id === nodeId && edge.to.port_id === portId;
  }) || null;
}

function connectPorts(first, second) {
  const pair = portDirectionPair(first, second);
  if (!pair) {
    showStatus('Eine Verbindung benötigt einen Ausgang und einen Eingang.', 'warning');
    return false;
  }
  if (pair.from.node.node_id === pair.to.node.node_id) {
    showStatus('Ein Baustein kann nicht direkt mit sich selbst verbunden werden.', 'warning');
    return false;
  }
  if (!logicDataTypesCompatible(pair.from.port.data_type, pair.to.port.data_type)) {
    showStatus('Datentypen sind nicht kompatibel: ' + pair.from.port.data_type + ' → ' + pair.to.port.data_type, 'error');
    return false;
  }
  const model = modelValue();
  const diagram = activeDiagram(model);
  if (!diagram) return false;
  if (pair.to.port.multi !== true && existingInputEdge(diagram, pair.to.node.node_id, pair.to.port.id)) {
    showStatus('Der Zielport ist bereits verbunden.', 'warning');
    return false;
  }
  const duplicate = diagram.edges.some(function (edge) {
    return edge.from.node_id === pair.from.node.node_id
      && edge.from.port_id === pair.from.port.id
      && edge.to.node_id === pair.to.node.node_id
      && edge.to.port_id === pair.to.port.id;
  });
  if (duplicate) {
    showStatus('Diese Portverbindung existiert bereits.', 'warning');
    return false;
  }
  const edge = createLogicEdge(
    pair.from.node.node_id,
    pair.from.port.id,
    pair.to.node.node_id,
    pair.to.port.id,
    pair.from.port.data_type === 'ANY' ? pair.to.port.data_type : pair.from.port.data_type,
    {}
  );
  diagram.edges.push(edge);
  ui.selectedEdgeId = edge.edge_id;
  ui.selectedNodeId = null;
  commitModel(model, 'edge_add');
  showStatus('Logikverbindung erstellt.', 'success', 1800);
  return true;
}

function handlePortSelection(nodeId, portId) {
  const diagram = activeDiagram(modelValue());
  const node = nodeById(diagram, nodeId);
  if (!node) return;
  const port = logicPortsForNode(node).find(function (entry) { return entry.id === portId; });
  if (!port) return;
  const selected = { node: node, port: port };
  if (!ui.pendingPort) {
    ui.pendingPort = selected;
    setMode('connect');
    renderCanvasSelection();
    return;
  }
  const connected = connectPorts(ui.pendingPort, selected);
  ui.pendingPort = null;
  if (connected) setMode('select');
  else renderCanvasSelection();
}

function createSvg(name, attributes) {
  const node = document.createElementNS(SVG_NS, name);
  Object.keys(attributes || {}).forEach(function (key) {
    node.setAttribute(key, String(attributes[key]));
  });
  return node;
}

function nodeHeaderClass(node) {
  if (['ton', 'tof', 'tp'].indexOf(node.block_type) >= 0) return 'logic-node-header logic-node-header--timer';
  if (['ctu', 'ctd'].indexOf(node.block_type) >= 0) return 'logic-node-header logic-node-header--counter';
  if (['state_write', 'state_parameter', 'notify', 'actuator_write', 'hmi_write', 'signal_out'].indexOf(node.block_type) >= 0) {
    return 'logic-node-header logic-node-header--action';
  }
  return 'logic-node-header';
}

function portPositions(node) {
  const ports = logicPortsForNode(node);
  const inputs = ports.filter(function (port) { return port.direction === 'in'; });
  const outputs = ports.filter(function (port) { return port.direction === 'out'; });
  const positions = [];
  function append(list, direction) {
    const usable = Math.max(30, node.height - 54);
    list.forEach(function (port, index) {
      const y = 46 + usable * ((index + 1) / (list.length + 1));
      positions.push({
        port: port,
        x: direction === 'in' ? 0 : node.width,
        y: y,
        direction: direction
      });
    });
  }
  append(inputs, 'in');
  append(outputs, 'out');
  return positions;
}

function portPosition(node, portId) {
  const entry = portPositions(node).find(function (item) { return item.port.id === portId; });
  if (!entry) return { x: node.x, y: node.y + node.height / 2 };
  return { x: node.x + entry.x, y: node.y + entry.y };
}

function edgePath(diagram, edge) {
  const fromNode = nodeById(diagram, edge.from.node_id);
  const toNode = nodeById(diagram, edge.to.node_id);
  if (!fromNode || !toNode) return '';
  const from = portPosition(fromNode, edge.from.port_id);
  const to = portPosition(toNode, edge.to.port_id);
  const span = Math.max(54, Math.abs(to.x - from.x) * 0.48);
  return 'M ' + from.x + ' ' + from.y
    + ' C ' + (from.x + span) + ' ' + from.y
    + ', ' + (to.x - span) + ' ' + to.y
    + ', ' + to.x + ' ' + to.y;
}

function drawEdge(layer, diagram, edge, validation) {
  const group = createSvg('g', {
    class: 'logic-edge' + (ui.selectedEdgeId === edge.edge_id ? ' selected' : '')
      + (validation.invalidEdges.has(edge.edge_id) ? ' invalid' : ''),
    'data-edge-id': edge.edge_id
  });
  const pathValue = edgePath(diagram, edge);
  const hit = createSvg('path', { class: 'logic-edge-hit', d: pathValue });
  const path = createSvg('path', { class: 'logic-edge-path', d: pathValue });
  group.appendChild(hit);
  group.appendChild(path);
  group.addEventListener('pointerdown', function (event) {
    event.stopPropagation();
    selectEdge(edge.edge_id);
  });
  group.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    event.stopPropagation();
    selectEdge(edge.edge_id);
    openContextMenu(event.clientX, event.clientY, { kind: 'edge', id: edge.edge_id });
  });
  layer.appendChild(group);
}

function nodeValidationSet(validation) {
  const set = new Set();
  (validation.errors || []).forEach(function (entry) {
    if (entry.node_id) set.add(entry.node_id);
  });
  return set;
}

function edgeValidationSet(validation) {
  const set = new Set();
  (validation.errors || []).forEach(function (entry) {
    if (entry.edge_id) set.add(entry.edge_id);
  });
  return set;
}

function drawNode(layer, node, invalidNodes) {
  const definition = logicBlockDefinition(node.block_type) || { name: node.block_type, category: '' };
  const group = createSvg('g', {
    class: 'logic-node' + (ui.selectedNodeId === node.node_id ? ' selected' : '')
      + (invalidNodes.has(node.node_id) ? ' invalid' : ''),
    transform: 'translate(' + node.x + ' ' + node.y + ')',
    'data-node-id': node.node_id,
    tabindex: '0',
    role: 'button',
    'aria-label': node.label + ', ' + definition.name
  });
  const frame = createSvg('rect', {
    class: 'logic-node-frame', x: 0, y: 0,
    width: node.width, height: node.height, rx: 8, ry: 8
  });
  const header = createSvg('path', {
    class: nodeHeaderClass(node),
    d: 'M 8 0 H ' + (node.width - 8) + ' Q ' + node.width + ' 0 ' + node.width + ' 8 V 38 H 0 V 8 Q 0 0 8 0 Z'
  });
  const title = createSvg('text', { class: 'logic-node-title', x: 12, y: 18 });
  title.textContent = node.label;
  const subtitle = createSvg('text', { class: 'logic-node-subtitle', x: 12, y: 31 });
  subtitle.textContent = definition.name;
  group.appendChild(frame);
  group.appendChild(header);
  group.appendChild(title);
  group.appendChild(subtitle);

  portPositions(node).forEach(function (entry) {
    const portGroup = createSvg('g', {
      class: 'logic-port' + (ui.pendingPort
        && ui.pendingPort.node.node_id === node.node_id
        && ui.pendingPort.port.id === entry.port.id ? ' pending' : ''),
      transform: 'translate(' + entry.x + ' ' + entry.y + ')',
      'data-node-id': node.node_id,
      'data-port-id': entry.port.id,
      'data-type': entry.port.data_type,
      role: 'button',
      tabindex: '0',
      'aria-label': entry.port.label + ', ' + entry.port.direction + ', ' + entry.port.data_type
    });
    const dot = createSvg('circle', { class: 'logic-port-dot', cx: 0, cy: 0, r: 5 });
    const label = createSvg('text', {
      class: 'logic-port-label',
      x: entry.direction === 'in' ? 10 : -10,
      y: 3,
      'text-anchor': entry.direction === 'in' ? 'start' : 'end'
    });
    label.textContent = entry.port.label;
    portGroup.appendChild(dot);
    portGroup.appendChild(label);
    portGroup.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      event.stopPropagation();
      handlePortSelection(node.node_id, entry.port.id);
    });
    portGroup.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handlePortSelection(node.node_id, entry.port.id);
    });
    group.appendChild(portGroup);
  });

  group.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || event.target.closest('.logic-port')) return;
    event.stopPropagation();
    selectNode(node.node_id);
    beginNodeDrag(event, node);
  });
  group.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectNode(node.node_id);
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      deleteNode(node.node_id);
    }
  });
  group.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    event.stopPropagation();
    selectNode(node.node_id);
    openContextMenu(event.clientX, event.clientY, { kind: 'node', id: node.node_id });
  });
  layer.appendChild(group);
}

function canvasPoint(event) {
  const svg = byId('logic-canvas');
  if (!svg) return { x: 0, y: 0 };
  const box = svg.getBoundingClientRect();
  return {
    x: Math.max(0, (event.clientX - box.left) / ui.zoom),
    y: Math.max(0, (event.clientY - box.top) / ui.zoom)
  };
}

function beginNodeDrag(event, node) {
  if (ui.mode !== 'select') return;
  const point = canvasPoint(event);
  ui.drag = {
    nodeId: node.node_id,
    startX: point.x,
    startY: point.y,
    nodeX: node.x,
    nodeY: node.y,
    moved: false
  };
  document.addEventListener('pointermove', moveNodeDrag);
  document.addEventListener('pointerup', endNodeDrag, { once: true });
}

function moveNodeDrag(event) {
  if (!ui.drag) return;
  const point = canvasPoint(event);
  const x = Math.max(0, Math.round((ui.drag.nodeX + point.x - ui.drag.startX) / 10) * 10);
  const y = Math.max(0, Math.round((ui.drag.nodeY + point.y - ui.drag.startY) / 10) * 10);
  ui.drag.currentX = x;
  ui.drag.currentY = y;
  ui.drag.moved = ui.drag.moved || Math.abs(x - ui.drag.nodeX) > 1 || Math.abs(y - ui.drag.nodeY) > 1;
  const nodeGroup = document.querySelector('#logic-nodes-layer [data-node-id="' + CSS.escape(ui.drag.nodeId) + '"]');
  if (nodeGroup) nodeGroup.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
  redrawEdgesLive(ui.drag.nodeId, x, y);
}

function redrawEdgesLive(nodeId, x, y) {
  const diagram = activeDiagram(modelValue());
  const node = nodeById(diagram, nodeId);
  if (!diagram || !node) return;
  const oldX = node.x;
  const oldY = node.y;
  node.x = x;
  node.y = y;
  diagram.edges.forEach(function (edge) {
    if (edge.from.node_id !== nodeId && edge.to.node_id !== nodeId) return;
    const group = document.querySelector('#logic-edges-layer [data-edge-id="' + CSS.escape(edge.edge_id) + '"]');
    if (!group) return;
    const value = edgePath(diagram, edge);
    group.querySelectorAll('path').forEach(function (path) { path.setAttribute('d', value); });
  });
  node.x = oldX;
  node.y = oldY;
}

function endNodeDrag() {
  document.removeEventListener('pointermove', moveNodeDrag);
  const drag = ui.drag;
  ui.drag = null;
  if (!drag || !drag.moved) {
    scheduleRender();
    return;
  }
  mutateActiveDiagram(function (diagram) {
    const node = nodeById(diagram, drag.nodeId);
    if (!node) return;
    node.x = drag.currentX;
    node.y = drag.currentY;
  }, 'node_move');
}

function validationForModel(model) {
  return validateLogicModel(model, currentContext());
}

function renderCanvas() {
  const model = modelValue();
  const diagram = activeDiagram(model);
  const viewport = byId('logic-canvas-viewport');
  const svg = byId('logic-canvas');
  const transform = byId('logic-canvas-transform');
  const edgesLayer = byId('logic-edges-layer');
  const nodesLayer = byId('logic-nodes-layer');
  const previewLayer = byId('logic-preview-layer');
  if (!viewport || !svg || !transform || !edgesLayer || !nodesLayer || !previewLayer) return;

  viewport.dataset.empty = diagram ? 'false' : 'true';
  edgesLayer.replaceChildren();
  nodesLayer.replaceChildren();
  previewLayer.replaceChildren();
  svg.setAttribute('width', String(Math.round(2400 * ui.zoom)));
  svg.setAttribute('height', String(Math.round(1400 * ui.zoom)));
  transform.setAttribute('transform', 'scale(' + ui.zoom + ')');
  const background = svg.querySelector('.logic-canvas-background');
  if (background) {
    background.setAttribute('width', String(2400 * ui.zoom));
    background.setAttribute('height', String(1400 * ui.zoom));
  }
  if (!diagram) return;

  const validation = validationForModel(model);
  const invalidNodes = nodeValidationSet(validation);
  const invalidEdges = edgeValidationSet(validation);
  const validationSets = { invalidNodes: invalidNodes, invalidEdges: invalidEdges };
  diagram.edges.filter(function (edge) { return edge.enabled !== false; }).forEach(function (edge) {
    drawEdge(edgesLayer, diagram, edge, validationSets);
  });
  diagram.nodes.filter(function (node) { return node.enabled !== false; }).forEach(function (node) {
    drawNode(nodesLayer, node, invalidNodes);
  });
  renderCanvasSelection();
}

function renderCanvasSelection() {
  document.querySelectorAll('#logic-nodes-layer .logic-node').forEach(function (node) {
    node.classList.toggle('selected', node.dataset.nodeId === ui.selectedNodeId);
  });
  document.querySelectorAll('#logic-edges-layer .logic-edge').forEach(function (edge) {
    edge.classList.toggle('selected', edge.dataset.edgeId === ui.selectedEdgeId);
  });
  document.querySelectorAll('#logic-nodes-layer .logic-port').forEach(function (port) {
    const pending = ui.pendingPort
      && ui.pendingPort.node.node_id === port.dataset.nodeId
      && ui.pendingPort.port.id === port.dataset.portId;
    port.classList.toggle('pending', Boolean(pending));
  });
}

function targetProfileLabel(value) {
  const labels = {
    universal: 'Universal',
    automation_system_v9: 'Automation_System',
    siemens_scl: 'Siemens SCL'
  };
  return labels[value] || value || 'Universal';
}

function renderEditorHeading() {
  const diagram = activeDiagram(modelValue());
  const title = byId('logic-active-title');
  const description = byId('logic-active-description');
  const target = byId('logic-target-profile');
  if (title) title.textContent = diagram ? diagram.name : 'Kein Schaltplan';
  if (description) description.textContent = diagram
    ? (diagram.description || 'Kanonischer, additiver Logikgraph für Plant, HMI und Runtime.')
    : 'Plant, HMI und Logik greifen auf dasselbe kanonische Projektmodell zu.';
  if (target) target.textContent = targetProfileLabel(diagram ? diagram.target_profile : 'universal');
}

function inventorySearchValue() {
  const input = byId('logic-inventory-search');
  return toText(input && input.value, '').toLowerCase();
}

function inventoryCategoryValue() {
  const select = byId('logic-category-filter');
  return toText(select && select.value, '');
}

function filterMatches(parts, search) {
  if (!search) return true;
  return parts.join(' ').toLowerCase().indexOf(search) >= 0;
}

function renderDiagramInventory(host) {
  const model = modelValue();
  const search = inventorySearchValue();
  const list = document.createElement('div');
  list.className = 'logic-list';
  model.diagrams.filter(function (diagram) {
    return filterMatches([diagram.name, diagram.description, diagram.execution.scope_kind], search);
  }).forEach(function (diagram) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'logic-diagram-item' + (diagram.diagram_id === model.active_diagram_id ? ' active' : '');
    button.dataset.diagramId = diagram.diagram_id;
    button.innerHTML = '<span class="logic-item-icon">FBD</span>'
      + '<span class="logic-item-copy"><strong>' + escapeText(diagram.name) + '</strong>'
      + '<span>' + escapeText(diagram.description || diagram.execution.scope_kind) + '</span></span>'
      + '<span class="logic-item-meta">' + diagram.nodes.length + ' · ' + diagram.edges.length + '</span>';
    button.addEventListener('click', function () { selectDiagram(diagram.diagram_id); });
    button.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      selectDiagram(diagram.diagram_id);
      openContextMenu(event.clientX, event.clientY, { kind: 'diagram', id: diagram.diagram_id });
    });
    list.appendChild(button);
  });
  if (!list.children.length) {
    list.innerHTML = '<div class="logic-binding-summary">Noch keine Schaltpläne. Bestehende Anlagenprojekte bleiben ohne Logik unverändert lauffähig.</div>';
  }
  host.appendChild(list);
}

function renderBlockInventory(host) {
  const search = inventorySearchValue();
  const category = inventoryCategoryValue();
  const groups = new Map();
  BLOCKS.filter(function (block) {
    return (!category || block.category === category)
      && filterMatches([block.name, block.description, block.block_type, block.category], search);
  }).forEach(function (block) {
    if (!groups.has(block.category)) groups.set(block.category, []);
    groups.get(block.category).push(block);
  });
  const wrapper = document.createElement('div');
  wrapper.className = 'logic-block-list';
  CATEGORIES.forEach(function (categoryName) {
    const blocks = groups.get(categoryName) || [];
    if (!blocks.length || categoryName === 'Schaltpläne') return;
    const heading = document.createElement('div');
    heading.className = 'logic-list-section-title';
    heading.textContent = categoryName;
    wrapper.appendChild(heading);
    blocks.forEach(function (block) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'logic-block-item';
      button.draggable = true;
      button.dataset.blockType = block.block_type;
      button.innerHTML = '<span class="logic-item-icon">' + escapeText(block.name.slice(0, 3).toUpperCase()) + '</span>'
        + '<span class="logic-item-copy"><strong>' + escapeText(block.name) + '</strong>'
        + '<span>' + escapeText(block.description) + '</span></span>'
        + '<span class="logic-item-meta">' + escapeText(block.targets.automation_system_v9 || '–') + '</span>';
      button.addEventListener('click', function () { addBlock(block.block_type); });
      button.addEventListener('dragstart', function (event) {
        event.dataTransfer.setData('application/x-plant-logic-block', block.block_type);
        event.dataTransfer.effectAllowed = 'copy';
      });
      wrapper.appendChild(button);
    });
  });
  host.appendChild(wrapper);
}

function renderSignalInventory(host) {
  const search = inventorySearchValue();
  const category = inventoryCategoryValue();
  const catalog = refreshSignalCatalog();
  const groups = new Map();
  catalog.filter(function (entry) {
    return (!category || entry.group === category)
      && filterMatches([entry.label, entry.signal_ref, entry.group, entry.data_type, entry.source_kind], search);
  }).forEach(function (entry) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  });
  const wrapper = document.createElement('div');
  wrapper.className = 'logic-signal-list';
  Array.from(groups.keys()).sort().forEach(function (groupName) {
    const heading = document.createElement('div');
    heading.className = 'logic-list-section-title';
    heading.textContent = groupName;
    wrapper.appendChild(heading);
    groups.get(groupName).forEach(function (entry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'logic-signal-item';
      button.dataset.signalRef = entry.signal_ref;
      button.innerHTML = '<span class="logic-item-icon">' + escapeText(entry.data_type.slice(0, 3)) + '</span>'
        + '<span class="logic-item-copy"><strong>' + escapeText(entry.label) + '</strong>'
        + '<span>' + escapeText(entry.signal_ref) + '</span></span>'
        + '<span class="logic-item-meta">' + escapeText(entry.access) + '</span>';
      button.addEventListener('click', function () { addSignal(entry); });
      wrapper.appendChild(button);
    });
  });
  if (!wrapper.children.length) {
    wrapper.innerHTML = '<div class="logic-binding-summary">Keine Signale für den aktuellen Filter. V9-I/O, Process States, HMI und Anlagenobjekte werden automatisch katalogisiert.</div>';
  }
  host.appendChild(wrapper);
}

function updateInventoryCategoryOptions() {
  const select = byId('logic-category-filter');
  if (!select) return;
  const previous = select.value;
  const values = ui.inventoryTab === 'signals'
    ? Array.from(new Set(refreshSignalCatalog().map(function (entry) { return entry.group; }))).sort()
    : CATEGORIES.filter(function (category) { return category !== 'Schaltpläne'; });
  select.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'Alle Kategorien';
  select.appendChild(all);
  values.forEach(function (value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = values.indexOf(previous) >= 0 ? previous : '';
  select.hidden = ui.inventoryTab === 'diagrams';
}

function renderInventory() {
  const host = byId('logic-inventory-content');
  if (!host) return;
  updateInventoryCategoryOptions();
  host.replaceChildren();
  if (ui.inventoryTab === 'diagrams') renderDiagramInventory(host);
  else if (ui.inventoryTab === 'blocks') renderBlockInventory(host);
  else renderSignalInventory(host);
}

function fieldHtml(id, label, control) {
  return '<div class="logic-field"><label for="' + id + '">' + escapeText(label) + '</label>' + control + '</div>';
}

function textInput(id, value, attributes) {
  return '<input id="' + id + '" type="text" value="' + escapeText(value) + '" ' + (attributes || '') + '>';
}

function numberInput(id, value, attributes) {
  return '<input id="' + id + '" type="number" value="' + escapeText(value) + '" ' + (attributes || '') + '>';
}

function selectControl(id, value, options) {
  const items = options.map(function (entry) {
    return '<option value="' + escapeText(entry.value) + '"'
      + (String(entry.value) === String(value) ? ' selected' : '') + '>'
      + escapeText(entry.label) + '</option>';
  }).join('');
  return '<select id="' + id + '">' + items + '</select>';
}

function nodeConfigFields(node) {
  const config = node.config || {};
  const fields = [];
  if (node.block_type === 'constant_bool') {
    fields.push(fieldHtml('logic-node-value-bool', 'Wert', selectControl('logic-node-value-bool', String(Boolean(config.value)), [
      { value: 'true', label: 'TRUE' }, { value: 'false', label: 'FALSE' }
    ])));
  }
  if (node.block_type === 'constant_int' || node.block_type === 'constant_real') {
    fields.push(fieldHtml('logic-node-value-number', 'Wert', numberInput('logic-node-value-number', config.value, 'step="any"')));
  }
  if (node.block_type === 'constant_time') {
    fields.push(fieldHtml('logic-node-value-time', 'Zeit [ms]', numberInput('logic-node-value-time', config.value_ms, 'min="0" step="1"')));
  }
  if (['ton', 'tof', 'tp'].indexOf(node.block_type) >= 0) {
    fields.push(fieldHtml('logic-node-pt', 'Vorgabezeit PT [ms]', numberInput('logic-node-pt', config.pt_ms, 'min="0" step="1"')));
  }
  if (['ctu', 'ctd'].indexOf(node.block_type) >= 0) {
    fields.push(fieldHtml('logic-node-pv', 'Grenzwert PV', numberInput('logic-node-pv', config.pv, 'step="1"')));
  }
  if (node.block_type === 'state_write') {
    fields.push('<div class="logic-field-row">'
      + fieldHtml('logic-node-state-id', 'State ID', numberInput('logic-node-state-id', config.state_id, 'min="1" step="1"'))
      + fieldHtml('logic-node-value-true', 'Wert bei TRUE', numberInput('logic-node-value-true', config.value_id_true, 'min="1" step="1"'))
      + '</div>');
    fields.push('<div class="logic-field-row">'
      + fieldHtml('logic-node-value-false', 'Wert bei FALSE', numberInput('logic-node-value-false', config.value_id_false, 'min="1" step="1"'))
      + fieldHtml('logic-node-write-false', 'FALSE-Zweig', selectControl('logic-node-write-false', String(config.write_false !== false), [
        { value: 'true', label: 'Schreiben' }, { value: 'false', label: 'Nicht schreiben' }
      ]))
      + '</div>');
  }
  if (node.block_type === 'state_parameter') {
    fields.push('<div class="logic-field-row">'
      + fieldHtml('logic-node-state-id', 'State ID', numberInput('logic-node-state-id', config.state_id, 'min="1" step="1"'))
      + fieldHtml('logic-node-parameter-key', 'Parameter', textInput('logic-node-parameter-key', config.parameter_key, ''))
      + '</div>');
    fields.push(fieldHtml('logic-node-param-value', 'Fallback-Wert', textInput('logic-node-param-value', config.value, '')));
  }
  if (node.block_type === 'notify') {
    fields.push(fieldHtml('logic-node-message', 'Meldung', textInput('logic-node-message', config.message, 'maxlength="240"')));
  }
  if (['signal_in', 'signal_out', 'actuator_write', 'hmi_write'].indexOf(node.block_type) >= 0) {
    fields.push(fieldHtml('logic-node-data-type', 'Datentyp', selectControl('logic-node-data-type', config.data_type || (node.binding || {}).data_type || 'BOOL', [
      { value: 'BOOL', label: 'BOOL' }, { value: 'INT', label: 'INT' },
      { value: 'DINT', label: 'DINT' }, { value: 'REAL', label: 'REAL' },
      { value: 'TIME', label: 'TIME' }, { value: 'STRING', label: 'STRING' },
      { value: 'ENUM', label: 'ENUM' }, { value: 'ANY', label: 'ANY' }
    ])));
  }
  return fields.join('');
}

function renderNodeDetails(host, node) {
  const definition = logicBlockDefinition(node.block_type) || {};
  host.innerHTML = '<div class="logic-inspector-card">'
    + '<section class="logic-inspector-section"><h3>Baustein</h3>'
    + fieldHtml('logic-node-label', 'Bezeichnung', textInput('logic-node-label', node.label, 'maxlength="100"'))
    + '<div class="logic-binding-summary"><strong>' + escapeText(definition.name || node.block_type) + '</strong><br>'
    + escapeText(definition.description || '') + '<br><code>' + escapeText(node.node_id) + '</code></div></section>'
    + '<section class="logic-inspector-section"><h3>Parameter</h3>' + (nodeConfigFields(node) || '<div class="logic-binding-summary">Dieser Baustein benötigt keine direkten Parameter.</div>') + '</section>'
    + '<section class="logic-inspector-section"><h3>Geometrie</h3><div class="logic-field-row">'
    + fieldHtml('logic-node-x', 'X', numberInput('logic-node-x', node.x, 'min="0" step="10"'))
    + fieldHtml('logic-node-y', 'Y', numberInput('logic-node-y', node.y, 'min="0" step="10"'))
    + '</div></section></div>';
  bindNodeDetailFields(node.node_id);
}

function signalOptions(selectedRef, filterAccess) {
  const options = ['<option value="">— nicht gebunden —</option>'];
  refreshSignalCatalog().filter(function (entry) {
    if (!filterAccess) return true;
    if (filterAccess === 'read') return entry.access !== 'write';
    if (filterAccess === 'write') return entry.access !== 'read';
    return true;
  }).forEach(function (entry) {
    options.push('<option value="' + escapeText(entry.signal_ref) + '"'
      + (entry.signal_ref === selectedRef ? ' selected' : '') + '>'
      + escapeText(entry.group + ' · ' + entry.label + ' [' + entry.data_type + ']') + '</option>');
  });
  return options.join('');
}

function bindingAccessForNode(node) {
  return ['signal_in'].indexOf(node.block_type) >= 0 ? 'read'
    : (['state_write', 'state_parameter', 'actuator_write', 'hmi_write', 'signal_out'].indexOf(node.block_type) >= 0 ? 'write' : '');
}

function renderNodeBinding(host, node) {
  const binding = node.binding || {};
  const access = bindingAccessForNode(node);
  host.innerHTML = '<div class="logic-inspector-card"><section class="logic-inspector-section"><h3>Kanonische Signalbindung</h3>'
    + '<div class="logic-field"><label for="logic-node-binding">Signal</label><select id="logic-node-binding">'
    + signalOptions(binding.signal_ref || '', access) + '</select></div>'
    + '<div class="logic-binding-summary">'
    + (binding.signal_ref
      ? '<strong>' + escapeText(binding.label || binding.signal_ref) + '</strong><br><code>' + escapeText(binding.signal_ref) + '</code><br>Datentyp: ' + escapeText(binding.data_type || 'ANY') + ' · Zugriff: ' + escapeText(binding.access || '–')
      : 'Ein Binding verknüpft diesen Baustein stabil mit einem Anlagenobjekt, V9-I/O, Process State, Timer oder HMI-Widget.')
    + '</div></section><section class="logic-inspector-section"><h3>Portvertrag</h3>'
    + '<div class="logic-binding-summary">' + logicPortsForNode(node).map(function (port) {
      return escapeText(port.direction.toUpperCase() + ' ' + port.label + ': ' + port.data_type);
    }).join('<br>') + '</div></section></div>';
  const select = byId('logic-node-binding');
  if (select) {
    select.addEventListener('change', function () {
      updateNodeBinding(node.node_id, select.value);
    });
  }
}

function renderNodeTarget(host, node, diagram) {
  const config = node.config || {};
  const definition = logicBlockDefinition(node.block_type) || { targets: {} };
  host.innerHTML = '<div class="logic-inspector-card"><section class="logic-inspector-section"><h3>Zielkompatibilität</h3>'
    + '<div class="logic-binding-summary">Universal JSON: <strong>' + escapeText((definition.targets || {}).universal_json || '–') + '</strong><br>'
    + 'Automation_System V9: <strong>' + escapeText((definition.targets || {}).automation_system_v9 || '–') + '</strong><br>'
    + 'Siemens SCL: <strong>' + escapeText((definition.targets || {}).siemens_scl || '–') + '</strong></div></section>'
    + '<section class="logic-inspector-section"><h3>Schreibhoheit</h3>'
    + fieldHtml('logic-node-ownership', 'Ownership Mode', selectControl('logic-node-ownership', config.ownership_mode || 'logic', [
      { value: 'logic', label: 'Logic-driven' },
      { value: 'hybrid', label: 'Hybrid mit Prioritätsarbitration' },
      { value: 'direct', label: 'Direkt / nur Darstellung' }
    ]))
    + fieldHtml('logic-node-priority', 'Priorität', numberInput('logic-node-priority', config.priority == null ? diagram.execution.priority : config.priority, 'min="0" step="1"'))
    + '<div class="logic-ownership-note">Nur ein kanonisches Modell schreibt die Zielkonfiguration. Hybrid ist eine explizite Runtime-Arbitration und keine zweite Wahrheit.</div></section></div>';
  const ownership = byId('logic-node-ownership');
  const priority = byId('logic-node-priority');
  if (ownership) ownership.addEventListener('change', function () { patchNodeConfig(node.node_id, { ownership_mode: ownership.value }); });
  if (priority) priority.addEventListener('change', function () { patchNodeConfig(node.node_id, { priority: integerValue(priority.value, diagram.execution.priority) }); });
}

function messagesForNode(validation, nodeId) {
  return (validation.errors || []).concat(validation.warnings || []).filter(function (entry) {
    return !entry.node_id || entry.node_id === nodeId;
  });
}

function renderDiagnostics(host, node) {
  const validation = validationForModel(modelValue());
  const messages = messagesForNode(validation, node ? node.node_id : null);
  let body = '';
  if (!messages.length) {
    body = '<div class="logic-diagnostic-item" data-level="ok"><span>✓</span><span>Keine strukturellen oder typbezogenen Probleme.</span></div>';
  } else {
    body = messages.map(function (entry) {
      const level = (validation.errors || []).indexOf(entry) >= 0 ? 'error' : 'warning';
      return '<div class="logic-diagnostic-item" data-level="' + level + '"><span>' + (level === 'error' ? '!' : '△') + '</span><span>' + escapeText(entry.message || entry.code || String(entry)) + '</span></div>';
    }).join('');
  }
  host.innerHTML = '<div class="logic-inspector-card"><section class="logic-inspector-section"><h3>Modellprüfung</h3>'
    + '<div class="logic-diagnostic-list">' + body + '</div></section>'
    + '<section class="logic-inspector-section"><h3>Gesamtstatus</h3><div class="logic-binding-summary">'
    + validation.errors.length + ' Fehler · ' + validation.warnings.length + ' Hinweise · ' + validation.stats.nodes + ' Bausteine · ' + validation.stats.edges + ' Verbindungen</div></section></div>';
}

function renderDiagramDetails(host, diagram) {
  host.innerHTML = '<div class="logic-inspector-card"><section class="logic-inspector-section"><h3>Schaltplan</h3>'
    + fieldHtml('logic-diagram-inline-name', 'Name', textInput('logic-diagram-inline-name', diagram.name, 'maxlength="100"'))
    + fieldHtml('logic-diagram-inline-description', 'Beschreibung', '<textarea id="logic-diagram-inline-description" rows="3">' + escapeText(diagram.description || '') + '</textarea>')
    + '</section><section class="logic-inspector-section"><h3>Ausführung</h3>'
    + fieldHtml('logic-diagram-inline-scope', 'Scope', selectControl('logic-diagram-inline-scope', diagram.execution.scope_kind, [
      { value: 'node_local', label: 'Node-lokal' }, { value: 'cross_controller', label: 'Controller-übergreifend' }, { value: 'cross_worker', label: 'Worker-übergreifend' }
    ]))
    + fieldHtml('logic-diagram-inline-target', 'Primäres Zielprofil', selectControl('logic-diagram-inline-target', diagram.target_profile, [
      { value: 'universal', label: 'Universal' }, { value: 'automation_system_v9', label: 'Automation_System V9/V8' }, { value: 'siemens_scl', label: 'Siemens SCL' }
    ]))
    + '<div class="logic-field-row">'
    + fieldHtml('logic-diagram-inline-owner', 'Owner Node', textInput('logic-diagram-inline-owner', diagram.execution.owner_node_id, ''))
    + fieldHtml('logic-diagram-inline-priority', 'Priorität', numberInput('logic-diagram-inline-priority', diagram.execution.priority, 'min="0" step="1"'))
    + '</div></section></div>';
  bindDiagramDetailFields(diagram.diagram_id);
}

function renderEdgeInspector(host, edge, diagram) {
  const from = nodeById(diagram, edge.from.node_id);
  const to = nodeById(diagram, edge.to.node_id);
  host.innerHTML = '<div class="logic-inspector-card"><section class="logic-inspector-section"><h3>Typisierte Verbindung</h3>'
    + '<div class="logic-binding-summary"><strong>' + escapeText(from ? from.label : edge.from.node_id) + '.' + escapeText(edge.from.port_id) + '</strong><br>↓<br><strong>'
    + escapeText(to ? to.label : edge.to.node_id) + '.' + escapeText(edge.to.port_id) + '</strong><br>Datentyp: ' + escapeText(edge.data_type) + '</div>'
    + fieldHtml('logic-edge-label', 'Beschriftung', textInput('logic-edge-label', edge.label || '', 'maxlength="100"'))
    + '</section><section class="logic-inspector-section"><button id="logic-edge-delete-inspector" class="btn btn-secondary btn--block" type="button">Verbindung löschen</button></section></div>';
  const label = byId('logic-edge-label');
  const remove = byId('logic-edge-delete-inspector');
  if (label) label.addEventListener('change', function () {
    mutateActiveDiagram(function (active) {
      const current = edgeById(active, edge.edge_id);
      if (current) current.label = label.value;
    }, 'edge_label');
  });
  if (remove) remove.addEventListener('click', function () { deleteEdge(edge.edge_id); });
}

function renderInspector() {
  const host = byId('logic-inspector-content');
  const title = byId('logic-inspector-title');
  const context = byId('logic-inspector-context');
  if (!host) return;
  const model = modelValue();
  const diagram = activeDiagram(model);
  if (!diagram) {
    if (title) title.textContent = 'Schaltlogik';
    if (context) context.textContent = 'Kein Schaltplan angelegt';
    host.innerHTML = '<div class="logic-binding-summary">Lege einen Schaltplan an. Die vorhandene Anlagen-, HMI- und Runtime-Konfiguration bleibt dabei unverändert.</div>';
    return;
  }
  const node = ui.selectedNodeId ? nodeById(diagram, ui.selectedNodeId) : null;
  const edge = ui.selectedEdgeId ? edgeById(diagram, ui.selectedEdgeId) : null;
  if (edge) {
    if (title) title.textContent = 'Verbindung';
    if (context) context.textContent = edge.data_type + ' · ' + edge.edge_id;
    renderEdgeInspector(host, edge, diagram);
    return;
  }
  if (node) {
    const definition = logicBlockDefinition(node.block_type) || {};
    if (title) title.textContent = node.label;
    if (context) context.textContent = definition.name || node.block_type;
    if (ui.inspectorTab === 'details') renderNodeDetails(host, node);
    else if (ui.inspectorTab === 'binding') renderNodeBinding(host, node);
    else if (ui.inspectorTab === 'target') renderNodeTarget(host, node, diagram);
    else renderDiagnostics(host, node);
    return;
  }
  if (title) title.textContent = diagram.name;
  if (context) context.textContent = diagram.nodes.length + ' Bausteine · ' + diagram.edges.length + ' Verbindungen';
  if (ui.inspectorTab === 'diagnostics') renderDiagnostics(host, null);
  else renderDiagramDetails(host, diagram);
}

function patchNode(nodeId, patch, reason) {
  mutateActiveDiagram(function (diagram) {
    const node = nodeById(diagram, nodeId);
    if (!node) return;
    Object.keys(patch).forEach(function (key) { node[key] = patch[key]; });
  }, reason || 'node_patch');
}

function patchNodeConfig(nodeId, patch) {
  mutateActiveDiagram(function (diagram) {
    const node = nodeById(diagram, nodeId);
    if (!node) return;
    node.config = Object.assign({}, node.config || {}, patch || {});
  }, 'node_config');
}

function bindNodeDetailFields(nodeId) {
  const handlers = [
    ['logic-node-label', function (input) { patchNode(nodeId, { label: input.value }, 'node_label'); }],
    ['logic-node-x', function (input) { patchNode(nodeId, { x: Math.max(0, finiteNumber(input.value, 0)) }, 'node_geometry'); }],
    ['logic-node-y', function (input) { patchNode(nodeId, { y: Math.max(0, finiteNumber(input.value, 0)) }, 'node_geometry'); }],
    ['logic-node-value-bool', function (input) { patchNodeConfig(nodeId, { value: input.value === 'true' }); }],
    ['logic-node-value-number', function (input) { patchNodeConfig(nodeId, { value: finiteNumber(input.value, 0) }); }],
    ['logic-node-value-time', function (input) { patchNodeConfig(nodeId, { value_ms: Math.max(0, integerValue(input.value, 0)) }); }],
    ['logic-node-pt', function (input) { patchNodeConfig(nodeId, { pt_ms: Math.max(0, integerValue(input.value, 0)) }); }],
    ['logic-node-pv', function (input) { patchNodeConfig(nodeId, { pv: integerValue(input.value, 0) }); }],
    ['logic-node-state-id', function (input) { patchNodeConfig(nodeId, { state_id: Math.max(1, integerValue(input.value, 1)) }); }],
    ['logic-node-value-true', function (input) { patchNodeConfig(nodeId, { value_id_true: Math.max(1, integerValue(input.value, 1)) }); }],
    ['logic-node-value-false', function (input) { patchNodeConfig(nodeId, { value_id_false: Math.max(1, integerValue(input.value, 2)) }); }],
    ['logic-node-write-false', function (input) { patchNodeConfig(nodeId, { write_false: input.value === 'true' }); }],
    ['logic-node-parameter-key', function (input) { patchNodeConfig(nodeId, { parameter_key: input.value }); }],
    ['logic-node-param-value', function (input) { patchNodeConfig(nodeId, { value: input.value }); }],
    ['logic-node-message', function (input) { patchNodeConfig(nodeId, { message: input.value }); }],
    ['logic-node-data-type', function (input) { patchNodeConfig(nodeId, { data_type: input.value }); }]
  ];
  handlers.forEach(function (entry) {
    const input = byId(entry[0]);
    if (input) input.addEventListener('change', function () { entry[1](input); });
  });
}

function bindDiagramDetailFields(diagramId) {
  const entries = [
    ['logic-diagram-inline-name', 'name'],
    ['logic-diagram-inline-description', 'description'],
    ['logic-diagram-inline-target', 'target_profile']
  ];
  entries.forEach(function (entry) {
    const input = byId(entry[0]);
    if (!input) return;
    input.addEventListener('change', function () {
      const model = modelValue();
      const diagram = diagramById(model, diagramId);
      if (!diagram) return;
      diagram[entry[1]] = input.value;
      commitModel(model, 'diagram_details');
    });
  });
  const scope = byId('logic-diagram-inline-scope');
  const owner = byId('logic-diagram-inline-owner');
  const priority = byId('logic-diagram-inline-priority');
  if (scope) scope.addEventListener('change', function () { patchDiagramExecution(diagramId, { scope_kind: scope.value }); });
  if (owner) owner.addEventListener('change', function () { patchDiagramExecution(diagramId, { owner_node_id: owner.value }); });
  if (priority) priority.addEventListener('change', function () { patchDiagramExecution(diagramId, { priority: Math.max(0, integerValue(priority.value, 500)) }); });
}

function patchDiagramExecution(diagramId, patch) {
  const model = modelValue();
  const diagram = diagramById(model, diagramId);
  if (!diagram) return;
  diagram.execution = Object.assign({}, diagram.execution || {}, patch || {});
  commitModel(model, 'diagram_execution');
}

function updateNodeBinding(nodeId, signalRef) {
  const catalog = refreshSignalCatalog();
  const entry = catalog.find(function (candidate) { return candidate.signal_ref === signalRef; }) || null;
  mutateActiveDiagram(function (diagram) {
    const node = nodeById(diagram, nodeId);
    if (!node) return;
    node.binding = entry ? cloneValue(entry) : null;
    if (entry) {
      node.label = entry.label;
      node.config = Object.assign({}, node.config || {}, { data_type: entry.data_type });
      if (node.block_type === 'state_write' && entry.state_id != null) node.config.state_id = entry.state_id;
      if (node.block_type === 'state_parameter') {
        if (entry.state_id != null) node.config.state_id = entry.state_id;
        if (entry.parameter_key) node.config.parameter_key = entry.parameter_key;
      }
    }
  }, 'node_binding');
}

function renderStatus() {
  const model = modelValue();
  const validation = validationForModel(model);
  const status = byId('logic-validation-status');
  const zoom = byId('logic-zoom-label');
  if (status) {
    status.textContent = validation.errors.length
      ? validation.errors.length + ' Fehler'
      : (validation.warnings.length ? validation.warnings.length + ' Hinweise' : 'Modell gültig');
    status.dataset.tone = validation.errors.length ? 'danger' : (validation.warnings.length ? 'warn' : 'ok');
  }
  if (zoom) zoom.textContent = Math.round(ui.zoom * 100) + ' %';
}

function renderAll() {
  renderEditorHeading();
  renderInventory();
  renderCanvas();
  renderInspector();
  renderStatus();
}

function setInventoryTab(tab) {
  ui.inventoryTab = ['diagrams', 'blocks', 'signals'].indexOf(tab) >= 0 ? tab : 'diagrams';
  document.querySelectorAll('.logic-inventory-tab').forEach(function (button) {
    const active = button.dataset.logicInventory === ui.inventoryTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  renderInventory();
}

function setInspectorTab(tab) {
  ui.inspectorTab = ['details', 'binding', 'target', 'diagnostics'].indexOf(tab) >= 0 ? tab : 'details';
  document.querySelectorAll('.logic-inspector-tab').forEach(function (button) {
    const active = button.dataset.logicInspector === ui.inspectorTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  renderInspector();
}

function setPreviewTab(tab) {
  ui.preview = ['report', 'universal', 'v9', 'scl'].indexOf(tab) >= 0 ? tab : 'report';
  document.querySelectorAll('.logic-preview-tab').forEach(function (button) {
    const active = button.dataset.logicPreview === ui.preview;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  renderCompilePreview();
}

function openModal(modal) {
  if (!modal) return;
  modal.classList.remove('hidden');
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.add('hidden');
}

function openDiagramModal(mode) {
  const modal = byId('modal-logic-diagram');
  if (!modal) return;
  const diagram = activeDiagram(modelValue());
  ui.diagramModalMode = mode === 'edit' && diagram ? 'edit' : 'create';
  byId('modal-logic-diagram-title').textContent = ui.diagramModalMode === 'edit' ? 'Schaltplan konfigurieren' : 'Neuen Schaltplan anlegen';
  byId('logic-diagram-name').value = ui.diagramModalMode === 'edit' ? diagram.name : 'Schaltplan ' + (modelValue().diagrams.length + 1);
  byId('logic-diagram-description').value = ui.diagramModalMode === 'edit' ? diagram.description : '';
  byId('logic-diagram-scope').value = ui.diagramModalMode === 'edit' ? diagram.execution.scope_kind : 'node_local';
  byId('logic-diagram-owner').value = ui.diagramModalMode === 'edit' ? diagram.execution.owner_node_id : 'fn-01';
  byId('logic-diagram-engine').value = ui.diagramModalMode === 'edit' ? diagram.execution.engine_id : 1;
  byId('logic-diagram-priority').value = ui.diagramModalMode === 'edit' ? diagram.execution.priority : 500;
  openModal(modal);
}

function saveDiagramModal() {
  const values = {
    name: byId('logic-diagram-name').value,
    description: byId('logic-diagram-description').value,
    execution: {
      scope_kind: byId('logic-diagram-scope').value,
      owner_node_id: byId('logic-diagram-owner').value,
      engine_id: Math.max(1, integerValue(byId('logic-diagram-engine').value, 1)),
      priority: Math.max(0, integerValue(byId('logic-diagram-priority').value, 500))
    }
  };
  if (ui.diagramModalMode === 'create') {
    createDiagramAndSelect(values);
  } else {
    const model = modelValue();
    const diagram = activeDiagram(model);
    if (diagram) {
      diagram.name = toText(values.name, diagram.name);
      diagram.description = values.description;
      diagram.execution = Object.assign({}, diagram.execution, values.execution);
      commitModel(model, 'diagram_edit');
    }
  }
  closeModal(byId('modal-logic-diagram'));
}

function loadDemo() {
  const model = modelValue();
  const demoId = 'logic_timer_counter_demo';
  let demo = diagramById(model, demoId);
  let created = false;
  if (!demo) {
    const demoModel = createTimerCounterDemo(refreshSignalCatalog());
    demo = cloneValue(diagramById(demoModel, demoId));
    if (demo) {
      model.diagrams.push(demo);
      created = true;
    }
  }
  if (!demo) return;
  model.active_diagram_id = demoId;
  commitModel(model, created ? 'demo_add' : 'demo_select', { history: created });
  ui.selectedNodeId = null;
  ui.selectedEdgeId = null;
  window.setTimeout(fitDiagram, 50);
  showStatus(created
    ? 'PF-LOGIC-V1 Timer-/Counter-Demo additiv hinzugefügt.'
    : 'PF-LOGIC-V1 Timer-/Counter-Demo geöffnet.', 'success');
}

function compileArtifacts() {
  const context = currentContext();
  ui.artifacts = compileLogicArtifacts(modelValue(), context);
  return ui.artifacts;
}

function statusText(report) {
  if (!report) return '–';
  const status = report.status || (report.errors && report.errors.length ? 'FAILED' : 'OK');
  if (status === 'OK') return 'Bereit';
  if (status === 'WARNING') return 'Bridge/Hinweise';
  if (status === 'EMPTY') return 'Keine Cross-Regeln';
  return 'Prüfung fehlgeschlagen';
}

function setTargetStatus(id, report) {
  const node = byId(id);
  if (!node) return;
  const status = report && report.status ? report.status
    : (report && report.errors && report.errors.length ? 'FAILED' : 'OK');
  node.dataset.status = status;
  node.textContent = statusText(report);
}

function openCompileModal() {
  const artifacts = compileArtifacts();
  const modal = byId('modal-logic-compile');
  const model = artifacts.model;
  const summary = byId('logic-compile-summary');
  if (summary) {
    const diagrams = model.diagrams.length;
    const nodes = model.diagrams.reduce(function (total, diagram) { return total + diagram.nodes.length; }, 0);
    const edges = model.diagrams.reduce(function (total, diagram) { return total + diagram.edges.length; }, 0);
    summary.innerHTML = '<span class="logic-summary-chip">' + diagrams + ' Schaltpläne</span>'
      + '<span class="logic-summary-chip">' + nodes + ' Bausteine</span>'
      + '<span class="logic-summary-chip">' + edges + ' Verbindungen</span>'
      + '<span class="logic-summary-chip">' + artifacts.automation_v9.report.generated_rules + ' native V9-Regeln</span>'
      + '<span class="logic-summary-chip">' + artifacts.automation_v9.report.bridge_nodes.length + ' Bridge-Bausteine</span>';
  }
  setTargetStatus('logic-status-universal', {
    status: artifacts.universal.validation.errors.length ? 'FAILED'
      : (artifacts.universal.validation.warnings.length ? 'WARNING' : 'OK')
  });
  setTargetStatus('logic-status-automation', artifacts.automation_v9.report);
  setTargetStatus('logic-status-siemens', artifacts.siemens.report);
  setPreviewTab('report');
  openModal(modal);
}

function previewContent() {
  if (!ui.artifacts) return '';
  if (ui.preview === 'universal') return JSON.stringify(ui.artifacts.universal, null, 2);
  if (ui.preview === 'v9') {
    return JSON.stringify({
      generated_rules: ui.artifacts.automation_v9.generated_rules,
      cross_rules: ui.artifacts.automation_v9.cross_rules,
      bridge_nodes: ui.artifacts.automation_v9.report.bridge_nodes,
      warnings: ui.artifacts.automation_v9.report.warnings
    }, null, 2);
  }
  if (ui.preview === 'scl') return ui.artifacts.siemens.scl || '// No enabled diagrams.';
  return JSON.stringify(ui.artifacts.report, null, 2);
}

function renderCompilePreview() {
  const preview = byId('logic-compile-preview');
  if (preview) preview.textContent = previewContent();
}

function safeBaseName(value) {
  return toText(value, 'plant_factory').replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function downloadText(filename, text, mime) {
  utils.downloadFile(new Blob([text], { type: mime || 'text/plain;charset=utf-8' }), filename);
}

function exportAllArtifacts() {
  const artifacts = ui.artifacts || compileArtifacts();
  const base = safeBaseName(state.get('projektName') || 'plant_factory');
  downloadText(base + '.logic.json', JSON.stringify(artifacts.model, null, 2) + '\n', 'application/json');
  downloadText(base + '.logic.runtime.json', JSON.stringify(artifacts.universal, null, 2) + '\n', 'application/json');
  downloadText(base + '.runtime.v9.json', JSON.stringify(artifacts.automation_v9.config, null, 2) + '\n', 'application/json');
  downloadText(base + '.logic.scl', artifacts.siemens.scl + '\n', 'text/plain;charset=utf-8');
  downloadText(base + '.logic.tags.csv', artifacts.siemens.tags_csv, 'text/csv;charset=utf-8');
  downloadText(base + '.logic.report.json', JSON.stringify(artifacts.report, null, 2) + '\n', 'application/json');

  const crossRules = artifacts.automation_v9.cross_rules || [];
  if (crossRules.length && window.__v9 && typeof window.__v9.splitShards === 'function') {
    const split = window.__v9.splitShards(currentContext().deviceConfig);
    const grouped = new Map();
    crossRules.forEach(function (rule) {
      const owner = toText(rule.owner_node_id, 'fn-01');
      if (!grouped.has(owner)) grouped.set(owner, []);
      grouped.get(owner).push(rule);
    });
    grouped.forEach(function (rules, owner) {
      const baseCross = split.cross.get(owner) || {};
      const compiled = applyLogicCrossRulesToV8(baseCross, rules);
      downloadText(base + '.runtime.v8_cross_' + safeBaseName(owner) + '.json', JSON.stringify(compiled.config, null, 2) + '\n', 'application/json');
    });
  }
  showStatus('PF-LOGIC-V1 Zielartefakte exportiert.', 'success', 5000);
}

function validateAndNotify() {
  const validation = validationForModel(modelValue());
  setInspectorTab('diagnostics');
  if (validation.errors.length) {
    showStatus('Schaltlogik: ' + validation.errors.length + ' Fehler. Details im Logik-Inspektor.', 'error', 5000);
  } else if (validation.warnings.length) {
    showStatus('Schaltlogik gültig, ' + validation.warnings.length + ' Hinweise.', 'warning', 4000);
  } else {
    showStatus('Schaltlogik vollständig und typkonsistent.', 'success', 3000);
  }
  renderStatus();
}

function fitDiagram() {
  const diagram = activeDiagram(modelValue());
  const viewport = byId('logic-canvas-viewport');
  if (!diagram || !diagram.nodes.length || !viewport) return;
  const bounds = diagram.nodes.reduce(function (acc, node) {
    acc.minX = Math.min(acc.minX, node.x);
    acc.minY = Math.min(acc.minY, node.y);
    acc.maxX = Math.max(acc.maxX, node.x + node.width);
    acc.maxY = Math.max(acc.maxY, node.y + node.height);
    return acc;
  }, { minX: Infinity, minY: Infinity, maxX: 0, maxY: 0 });
  const width = Math.max(1, bounds.maxX - bounds.minX + 160);
  const height = Math.max(1, bounds.maxY - bounds.minY + 160);
  ui.zoom = Math.max(0.35, Math.min(1.6, Math.min(viewport.clientWidth / width, viewport.clientHeight / height)));
  renderCanvas();
  renderStatus();
  window.requestAnimationFrame(function () {
    viewport.scrollLeft = Math.max(0, (bounds.minX - 80) * ui.zoom);
    viewport.scrollTop = Math.max(0, (bounds.minY - 80) * ui.zoom);
  });
}

function changeZoom(delta) {
  const viewport = byId('logic-canvas-viewport');
  if (!viewport) return;
  const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
  const centerY = viewport.scrollTop + viewport.clientHeight / 2;
  const logicalX = centerX / ui.zoom;
  const logicalY = centerY / ui.zoom;
  ui.zoom = Math.max(0.25, Math.min(2.5, ui.zoom + delta));
  renderCanvas();
  renderStatus();
  viewport.scrollLeft = logicalX * ui.zoom - viewport.clientWidth / 2;
  viewport.scrollTop = logicalY * ui.zoom - viewport.clientHeight / 2;
}

function contextMenuItems(target) {
  if (target.kind === 'node') {
    return [
      { action: 'node-details', label: 'Eigenschaften anzeigen' },
      { action: 'node-binding', label: 'Signal / Entity binden' },
      { action: 'node-target', label: 'Runtime-Ziel konfigurieren' },
      { action: 'node-connect', label: 'Verbindung von Ausgang starten' },
      { separator: true },
      { action: 'node-duplicate', label: 'Baustein duplizieren' },
      { action: 'node-delete', label: 'Baustein löschen', danger: true }
    ];
  }
  if (target.kind === 'edge') {
    return [
      { action: 'edge-details', label: 'Verbindung anzeigen' },
      { action: 'edge-delete', label: 'Verbindung löschen', danger: true }
    ];
  }
  if (target.kind === 'diagram') {
    return [
      { action: 'diagram-edit', label: 'Schaltplan konfigurieren' },
      { action: 'diagram-duplicate', label: 'Schaltplan duplizieren' },
      { action: 'diagram-delete', label: 'Schaltplan löschen', danger: true }
    ];
  }
  return [
    { action: 'canvas-new', label: 'Neuen Schaltplan anlegen' },
    { action: 'canvas-blocks', label: 'Bausteinbibliothek öffnen' },
    { action: 'canvas-signals', label: 'Signalinventar öffnen' },
    { separator: true },
    { action: 'canvas-fit', label: 'Schaltplan einpassen' },
    { action: 'canvas-validate', label: 'Schaltlogik prüfen' },
    { action: 'canvas-clear-selection', label: 'Auswahl aufheben' }
  ];
}

function openContextMenu(x, y, target) {
  const menu = byId('logic-context-menu');
  if (!menu) return;
  ui.contextTarget = target;
  menu.replaceChildren();
  contextMenuItems(target).forEach(function (item) {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'logic-context-separator';
      separator.setAttribute('role', 'separator');
      menu.appendChild(separator);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.dataset.action = item.action;
    if (item.danger) button.dataset.danger = 'true';
    button.textContent = item.label;
    button.addEventListener('click', function () {
      executeContextAction(item.action);
      closeContextMenu();
    });
    menu.appendChild(button);
  });
  menu.hidden = false;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - height - 8)) + 'px';
  const first = menu.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}

function closeContextMenu() {
  const menu = byId('logic-context-menu');
  if (menu) menu.hidden = true;
  ui.contextTarget = null;
}

function firstOutputPort(node) {
  return logicPortsForNode(node).find(function (port) { return port.direction === 'out'; }) || null;
}

function executeContextAction(action) {
  const target = ui.contextTarget || {};
  const diagram = activeDiagram(modelValue());
  const node = target.kind === 'node' ? nodeById(diagram, target.id) : null;
  if (action === 'node-details') setInspectorTab('details');
  else if (action === 'node-binding') setInspectorTab('binding');
  else if (action === 'node-target') setInspectorTab('target');
  else if (action === 'node-connect' && node) {
    const port = firstOutputPort(node);
    if (port) {
      ui.pendingPort = { node: node, port: port };
      setMode('connect');
    }
  }
  else if (action === 'node-duplicate') duplicateNode(target.id);
  else if (action === 'node-delete') deleteNode(target.id);
  else if (action === 'edge-details') renderInspector();
  else if (action === 'edge-delete') deleteEdge(target.id);
  else if (action === 'diagram-edit') openDiagramModal('edit');
  else if (action === 'diagram-duplicate') duplicateDiagram(target.id);
  else if (action === 'diagram-delete') deleteDiagram(target.id);
  else if (action === 'canvas-new') openDiagramModal('create');
  else if (action === 'canvas-blocks') setInventoryTab('blocks');
  else if (action === 'canvas-signals') setInventoryTab('signals');
  else if (action === 'canvas-fit') fitDiagram();
  else if (action === 'canvas-validate') validateAndNotify();
  else if (action === 'canvas-clear-selection') clearSelection();
}

function bindCanvas() {
  const viewport = byId('logic-canvas-viewport');
  if (!viewport) return;
  viewport.addEventListener('pointerdown', function (event) {
    if (event.target.closest('.logic-node') || event.target.closest('.logic-edge')) return;
    clearSelection();
  });
  viewport.addEventListener('pointermove', function (event) {
    const point = canvasPoint(event);
    const status = byId('logic-coordinate-status');
    if (status) status.textContent = 'X: ' + Math.round(point.x) + ' · Y: ' + Math.round(point.y);
  });
  viewport.addEventListener('contextmenu', function (event) {
    if (event.target.closest('.logic-node') || event.target.closest('.logic-edge')) return;
    event.preventDefault();
    openContextMenu(event.clientX, event.clientY, { kind: 'canvas' });
  });
  viewport.addEventListener('dragover', function (event) {
    if (!event.dataTransfer.types.includes('application/x-plant-logic-block')) return;
    event.preventDefault();
    viewport.classList.add('logic-drop-active');
    event.dataTransfer.dropEffect = 'copy';
  });
  viewport.addEventListener('dragleave', function () { viewport.classList.remove('logic-drop-active'); });
  viewport.addEventListener('drop', function (event) {
    event.preventDefault();
    viewport.classList.remove('logic-drop-active');
    const blockType = event.dataTransfer.getData('application/x-plant-logic-block');
    if (!blockType) return;
    addBlock(blockType, canvasPoint(event));
  });
  viewport.addEventListener('wheel', function (event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });
}

function bindStaticControls() {
  document.querySelectorAll('.logic-inventory-tab').forEach(function (button) {
    button.addEventListener('click', function () { setInventoryTab(button.dataset.logicInventory); });
  });
  document.querySelectorAll('.logic-inspector-tab').forEach(function (button) {
    button.addEventListener('click', function () { setInspectorTab(button.dataset.logicInspector); });
  });
  document.querySelectorAll('.logic-preview-tab').forEach(function (button) {
    button.addEventListener('click', function () { setPreviewTab(button.dataset.logicPreview); });
  });
  const search = byId('logic-inventory-search');
  const category = byId('logic-category-filter');
  if (search) search.addEventListener('input', renderInventory);
  if (category) category.addEventListener('change', renderInventory);
  byId('logic-new-diagram').addEventListener('click', function () { openDiagramModal('create'); });
  byId('logic-empty-create').addEventListener('click', function () { openDiagramModal('create'); });
  byId('logic-load-demo').addEventListener('click', loadDemo);
  byId('logic-tool-select').addEventListener('click', function () { setMode('select'); });
  byId('logic-tool-connect').addEventListener('click', function () { setMode('connect'); });
  byId('logic-delete').addEventListener('click', deleteSelection);
  byId('logic-undo').addEventListener('click', function () { state.undo(); });
  byId('logic-redo').addEventListener('click', function () { state.redo(); });
  byId('logic-fit').addEventListener('click', fitDiagram);
  byId('logic-zoom-out').addEventListener('click', function () { changeZoom(-0.1); });
  byId('logic-zoom-in').addEventListener('click', function () { changeZoom(0.1); });
  byId('logic-validate').addEventListener('click', validateAndNotify);
  byId('logic-compile').addEventListener('click', openCompileModal);
  byId('logic-diagram-save').addEventListener('click', saveDiagramModal);
  byId('logic-diagram-cancel').addEventListener('click', function () { closeModal(byId('modal-logic-diagram')); });
  byId('logic-compile-close').addEventListener('click', function () { closeModal(byId('modal-logic-compile')); });
  byId('logic-export-all').addEventListener('click', exportAllArtifacts);
  document.querySelectorAll('#modal-logic-diagram .modal-close').forEach(function (button) {
    button.addEventListener('click', function () { closeModal(byId('modal-logic-diagram')); });
  });
  document.querySelectorAll('#modal-logic-compile .modal-close').forEach(function (button) {
    button.addEventListener('click', function () { closeModal(byId('modal-logic-compile')); });
  });
  document.addEventListener('pointerdown', function (event) {
    const menu = byId('logic-context-menu');
    if (menu && !menu.hidden && !menu.contains(event.target)) closeContextMenu();
  });
  document.addEventListener('keydown', function (event) {
    if (document.body.dataset.workspaceKind !== 'logic') return;
    const tag = toText(event.target && event.target.tagName, '').toLowerCase();
    const editable = tag === 'input' || tag === 'select' || tag === 'textarea' || Boolean(event.target && event.target.isContentEditable);
    if (event.key === 'Escape') {
      closeContextMenu();
      ui.pendingPort = null;
      setMode('select');
      return;
    }
    if (editable) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
    } else if (event.key.toLowerCase() === 'c') {
      event.preventDefault();
      setMode('connect');
    } else if (event.key.toLowerCase() === 'v') {
      event.preventDefault();
      setMode('select');
    } else if (event.key === '0') {
      event.preventDefault();
      fitDiagram();
    }
  });
}

function bindStateEvents() {
  state.subscribe('logic', scheduleRender);
  state.subscribe('elements', function () { refreshSignalCatalog(); scheduleRender(); });
  state.subscribe('devices', function () { refreshSignalCatalog(); scheduleRender(); });
  state.subscribe('hmi', function () { refreshSignalCatalog(); scheduleRender(); });
  state.subscribe('processes', function () { refreshSignalCatalog(); scheduleRender(); });
  state.subscribe('deviceConfig', function () { refreshSignalCatalog(); scheduleRender(); });
  state.on('history:restored', scheduleRender);
  document.addEventListener('plant:workspace-activated', function (event) {
    if (event.detail && event.detail.workspace === 'logic') {
      refreshSignalCatalog();
      renderAll();
      window.setTimeout(function () { byId('logic-canvas-viewport').focus({ preventScroll: true }); }, 20);
    }
  });
}

function ensureLogicState() {
  const normalized = normalizeLogicModel(state.get('logic') || createEmptyLogicModel());
  state.setSilent('logic', normalized);
}

function publishReleaseReport() {
  const library = logicBlockLibrary();
  window.__plantFactoryV63 = {
    version: '63.4',
    logicStandard: LOGIC_STANDARD_ID,
    compatibilityStandard: 'PF-LOGIC-COMPAT-V1',
    canonicalSource: 'project.logic',
    additive: true,
    singleSourceOfTruth: true,
    inventoryCategory: 'Schaltpläne',
    blockCount: Array.isArray(library.blocks) ? library.blocks.length : 0,
    universalRuntime: true,
    automationSystemV9: true,
    automationSystemV8Cross: true,
    siemensScl: true,
    patchContract: 'PF-V63.4-HMI-UX',
    inheritedPatchContract: 'PF-V63.3-HMI-IO-UX',
    stabilityContract: 'PF-V63.2-STABILITY',
    automationContract: 'PF-AUTOMATION-V9-BRIDGE',
    connectionLayout: 'deferred-bounded-retry',
    connectionDialogDefaultWidth: 620,
    ioSelectionSync: true,
    ioAssignmentActions: 'co-located',
    ioAssignmentRegister: 'collapsed-responsive',
    logicDemoAdditive: true,
    genericSensorEntity: true,
    hmiWidgetObjectWorkflow: 'explicit-one-step',
    widgetObjectBindingRelation: true,
    hmiNavigation: 'single-guided-tablist',
    hmiLegacyTabs: 'hidden-compatibility-only',
    hmiStatesAlarmsWorkflow: 'guided-with-advanced-disclosure',
    hmiAppearanceWorkflow: 'view-widget-design',
    completeExampleProject: 'v63_2_komplettbeispiel',
    inheritedContracts: cloneValue(window.__plantFactoryV62 || {})
  };
  document.documentElement.dataset.plantFactoryRelease = '63.4';
  document.documentElement.dataset.logicStandard = LOGIC_STANDARD_ID;
  document.documentElement.dataset.automationContract = 'PF-AUTOMATION-V9-BRIDGE';
}

function exposeTestApi() {
  window.__logic = {
    getModel: modelValue,
    getActiveDiagram: function () { return activeDiagram(modelValue()); },
    getSignalCatalog: function () { return cloneValue(refreshSignalCatalog()); },
    addBlock: addBlock,
    addSignal: addSignal,
    loadDemo: loadDemo,
    validate: function () { return validationForModel(modelValue()); },
    compile: compileArtifacts,
    fit: fitDiagram,
    selectDiagram: selectDiagram,
    getUiState: function () {
      return {
        inventoryTab: ui.inventoryTab,
        inspectorTab: ui.inspectorTab,
        mode: ui.mode,
        selectedNodeId: ui.selectedNodeId,
        selectedEdgeId: ui.selectedEdgeId,
        drag: cloneValue(ui.drag),
        zoom: ui.zoom
      };
    },
    standard: LOGIC_STANDARD_ID
  };
}

function boot() {
  if (!byId('logic-workspace')) return;
  ensureLogicState();
  refreshSignalCatalog();
  bindCanvas();
  bindStaticControls();
  bindStateEvents();
  exposeTestApi();
  publishReleaseReport();
  renderAll();
  console.log('✓ PF-LOGIC-V1 Function Block Workspace V63.4 aktiv');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
