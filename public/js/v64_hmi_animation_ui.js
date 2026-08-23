/**
 * v64_hmi_animation_ui.js — guided event animation designer.
 *
 * This module extends the existing HMI state/alarm step. It stores only
 * normalized hmi_ui.event_animations and never changes SVG geometry.
 *
 * Style: functional composition only; no classes and no arrow functions.
 */

'use strict';

import { state, showStatus } from './core.js';
import {
  SVG_EVENT_EFFECT_PRESETS,
  normalizeSvgEventAnimation,
  normalizeSvgEventAnimations,
  previewSvgEventAnimation,
  validateSvgEventAnimations
} from './svg_event_runtime.js';

let selectedAnimationId = '';
let lastHost = null;

function deepClone(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

function createNode(tagName, className, textValue) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (textValue !== undefined && textValue !== null) node.textContent = String(textValue);
  return node;
}

function append(parent, child) {
  if (parent && child) parent.appendChild(child);
  return child;
}

function createButton(label, className, action) {
  const button = createNode('button', className, label);
  button.type = 'button';
  if (typeof action === 'function') button.addEventListener('click', action);
  return button;
}

function createOption(value, label, selected) {
  const option = createNode('option', '', label);
  option.value = String(value);
  option.selected = String(value) === String(selected);
  return option;
}

function createSelect(id, values, selected) {
  const select = createNode('select', 'select-input');
  select.id = id;
  values.forEach(function (item) {
    select.appendChild(createOption(item.value, item.label, selected));
  });
  return select;
}

function createInput(id, type, value, attributes) {
  const input = createNode('input', type === 'checkbox' ? '' : 'text-input');
  input.id = id;
  input.type = type || 'text';
  if (type === 'checkbox') input.checked = value === true;
  else input.value = value === null || value === undefined ? '' : String(value);
  const attrs = attributes && typeof attributes === 'object' ? attributes : {};
  Object.keys(attrs).forEach(function (name) {
    input.setAttribute(name, String(attrs[name]));
  });
  return input;
}

function createField(labelText, control, helpText) {
  const field = createNode('div', 'form-group');
  const label = createNode('label', '', labelText);
  if (control && control.id) label.setAttribute('for', control.id);
  append(field, label);
  append(field, control);
  if (helpText) append(field, createNode('small', 'hint-text', helpText));
  return field;
}

function textValue(value, fallback) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || String(fallback || '');
}

function idValue(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function elementEntries() {
  return (state.get('elements') || []).map(function (item) {
    return {
      value: String(item.id || ''),
      label: textValue(item.name || item.tag || item.templateId, item.id) + ' · ' + String(item.id || '')
    };
  }).filter(function (item) {
    return Boolean(item.value);
  });
}

function firstSelectedElementId() {
  const selected = state.get('selectedElements') || [];
  if (Array.isArray(selected) && selected.length === 1) return String(selected[0]);
  return '';
}

function sourceFromBinding(model, elementId) {
  const bindings = Array.isArray(model.bindings) ? model.bindings : [];
  const binding = bindings.find(function (item) {
    return item && item.element_id === elementId && item.source;
  }) || bindings.find(function (item) {
    return item && item.source;
  });
  return binding && binding.source ? deepClone(binding.source) : null;
}

function firstRuntimeSource() {
  const config = state.get('deviceConfig') || {};
  const sensors = Array.isArray(config.sensors) ? config.sensors : [];
  const actuators = Array.isArray(config.actuators) ? config.actuators : [];
  const processes = state.get('processes') || {};
  const processStates = Array.isArray(processes.process_states) ? processes.process_states : [];
  if (sensors.length) {
    return { kind: 'sensor', sensor_id: sensors[0].sensor_id ?? 1, field: 'value' };
  }
  if (actuators.length) {
    return { kind: 'actuator', actuator_id: actuators[0].actuator_id ?? 1, field: 'value' };
  }
  if (processStates.length) {
    return { kind: 'state', state_id: processStates[0].state_id ?? 1, field: 'value_id' };
  }
  return { kind: 'sensor', sensor_id: 1, field: 'value' };
}

function sourceId(source) {
  if (!source) return 1;
  if (source.kind === 'actuator') return source.actuator_id ?? source.id ?? 1;
  if (source.kind === 'state') return source.state_id ?? source.id ?? 1;
  return source.sensor_id ?? source.id ?? 1;
}

function effectDefaults(preset) {
  const presets = {
    color_fill: { color: '#22c55e', secondary_color: '#16a34a', duration_ms: 650 },
    color_stroke: { color: '#38bdf8', secondary_color: '#0ea5e9', duration_ms: 650 },
    temperature: { color: '#ef4444', secondary_color: '#f59e0b', duration_ms: 1200 },
    flow: { color: '#0ea5e9', secondary_color: '#22d3ee', duration_ms: 850 },
    level: { color: '#38bdf8', secondary_color: '#0ea5e9', duration_ms: 700, level: 0.72 },
    rotate: { color: '#8b5cf6', secondary_color: '#a78bfa', duration_ms: 950 },
    pulse: { color: '#22c55e', secondary_color: '#86efac', duration_ms: 1500, intensity: 1.08 },
    blink: { color: '#ef4444', secondary_color: '#f97316', duration_ms: 900 },
    opacity: { color: '#64748b', secondary_color: '#94a3b8', duration_ms: 650, opacity: 0.45 },
    glow: { color: '#f59e0b', secondary_color: '#fde047', duration_ms: 900 }
  };
  return Object.assign({
    preset: preset,
    color: '#22c55e',
    secondary_color: '#f59e0b',
    duration_ms: 1000,
    intensity: 1.08,
    level: 0.72,
    opacity: 0.55
  }, presets[preset] || {});
}

function defaultRule(model, preset) {
  const entries = elementEntries();
  const targetId = firstSelectedElementId() || (entries[0] ? entries[0].value : '');
  const source = sourceFromBinding(model, targetId) || firstRuntimeSource();
  const presetInfo = SVG_EVENT_EFFECT_PRESETS.find(function (item) {
    return item.value === preset;
  });
  return normalizeSvgEventAnimation({
    animation_id: idValue('svg_anim'),
    name: presetInfo ? presetInfo.label : 'SVG-Animation',
    enabled: true,
    view_id: model.active_view_id || 'main',
    trigger: {
      type: 'signal',
      source: source,
      operator: '>=',
      value: 1,
      event_name: '',
      mode: 'while_true',
      hold_ms: 1600
    },
    target: {
      element_id: targetId,
      part_selector: ''
    },
    effect: effectDefaults(preset)
  }, 0);
}

function commitModel(model, rules, reason) {
  const next = deepClone(model || {});
  next.version = Math.max(Number(next.version) || 1, 2);
  next.event_animations = normalizeSvgEventAnimations(rules);
  state.set('hmi', next);
  state.saveHistory();
  state.emit('hmi_ui:updated', { reason: reason || 'event_animation_update' });
  if (lastHost && lastHost.isConnected)
    renderHmiEventAnimationDesigner(lastHost, next);
}

function removeRule(model, animationId) {
  const rules = normalizeSvgEventAnimations(model.event_animations).filter(function (item) {
    return item.animation_id !== animationId;
  });
  selectedAnimationId = rules[0] ? rules[0].animation_id : '';
  commitModel(model, rules, 'event_animation_remove');
}

function duplicateRule(model, rule) {
  const nextRule = deepClone(rule);
  nextRule.animation_id = idValue('svg_anim');
  nextRule.name = rule.name + ' – Kopie';
  const rules = normalizeSvgEventAnimations(model.event_animations);
  rules.push(nextRule);
  selectedAnimationId = nextRule.animation_id;
  commitModel(model, rules, 'event_animation_duplicate');
}

function addRule(model, preset) {
  const rule = defaultRule(model, preset || 'color_fill');
  const rules = normalizeSvgEventAnimations(model.event_animations);
  rules.push(rule);
  selectedAnimationId = rule.animation_id;
  commitModel(model, rules, 'event_animation_add');
}

function selectorEscape(value) {
  const text = String(value || '');
  if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(text);
  return text.replace(/[^a-zA-Z0-9_-]/g, function (character) {
    return '\\' + character.codePointAt(0).toString(16) + ' ';
  });
}

function partSelectorEntries(elementId) {
  const result = [{ value: '', label: 'Gesamtes Objekt' }];
  if (!elementId) return result;
  const root = document.querySelector('#elements-layer #' + selectorEscape(elementId));
  if (!root) return result;
  const seen = new Set();
  Array.from(root.querySelectorAll('[data-pf-state-target]')).forEach(function (node) {
    const name = textValue(node.getAttribute('data-pf-state-target'), '');
    if (!name || seen.has(name)) return;
    seen.add(name);
    result.push({
      value: '[data-pf-state-target="' + name + '"]',
      label: 'Bauteil · ' + name
    });
  });
  ['pid-flow', 'pid-state-fill', 'pid-primary', 'pid-warning', 'pid-outline'].forEach(function (className) {
    if (!root.querySelector('.' + className)) return;
    const selector = '.' + className;
    if (seen.has(selector)) return;
    seen.add(selector);
    result.push({ value: selector, label: 'Gruppe · ' + selector });
  });
  return result;
}

function sourceCatalog(kind) {
  const config = state.get('deviceConfig') || {};
  const processes = state.get('processes') || {};
  let rows = [];
  let idKey = 'sensor_id';
  if (kind === 'actuator') {
    rows = Array.isArray(config.actuators) ? config.actuators : [];
    idKey = 'actuator_id';
  } else if (kind === 'state') {
    rows = Array.isArray(processes.process_states) ? processes.process_states : [];
    idKey = 'state_id';
  } else {
    rows = Array.isArray(config.sensors) ? config.sensors : [];
  }
  const result = rows.map(function (item) {
    const id = item[idKey] ?? item.id;
    const label = textValue(item.name || item.label || item.description, kind + ' ' + String(id));
    return { value: id, label: label + ' · ' + String(id) };
  }).filter(function (item) {
    return item.value !== null && item.value !== undefined;
  });
  if (!result.length) result.push({ value: 1, label: kind + ' · 1' });
  return result;
}

function renderPresetCards(host, model) {
  const section = createNode('section', 'hmi-event-preset-section');
  const heading = createNode('div', 'hmi-event-section-heading');
  append(heading, createNode('div', '', 'Animation mit einem Klick anlegen'));
  append(heading, createNode('small', 'hint-text',
    'Preset wählen, Runtime-Signal und Ziel prüfen, anschließend testen.'));
  append(section, heading);
  const grid = createNode('div', 'hmi-event-preset-grid');
  SVG_EVENT_EFFECT_PRESETS.forEach(function (preset) {
    const card = createButton('', 'hmi-event-preset-card', function () {
      addRule(model, preset.value);
    });
    card.dataset.preset = preset.value;
    append(card, createNode('strong', '', preset.label));
    append(card, createNode('small', '', preset.description));
    append(grid, card);
  });
  append(section, grid);
  append(host, section);
}

function renderValidation(host, rules) {
  const report = validateSvgEventAnimations(rules, {
    element_ids: elementEntries().map(function (item) { return item.value; })
  });
  const row = createNode('div', 'hmi-event-validation');
  const tone = report.valid ? 'hmi-config-badge--ok' : 'hmi-config-badge--danger';
  append(row, createNode('span', 'hmi-config-badge ' + tone,
    report.valid ? 'Vertrag gültig' : String(report.errors.length) + ' Fehler'));
  append(row, createNode('span', 'hmi-config-badge',
    String(report.count) + (report.count === 1 ? ' Animation' : ' Animationen')));
  if (report.warnings.length) {
    append(row, createNode('span', 'hmi-config-badge',
      String(report.warnings.length) + ' Hinweise'));
  }
  append(host, row);
}

function renderRuleList(host, model, rules) {
  const panel = createNode('aside', 'hmi-event-rule-list');
  const header = createNode('div', 'hmi-event-rule-list__header');
  append(header, createNode('strong', '', 'Ereignisanimationen'));
  append(header, createButton('+ Neu', 'btn btn-primary btn--sm', function () {
    addRule(model, 'color_fill');
  }));
  append(panel, header);
  if (!rules.length) {
    append(panel, createNode('p', 'hint-text',
      'Noch keine Animation. Wähle oben ein Preset.'));
    append(host, panel);
    return;
  }
  rules.forEach(function (rule) {
    const active = rule.animation_id === selectedAnimationId;
    const button = createButton('', 'hmi-event-rule-option' + (active ? ' active' : ''), function () {
      selectedAnimationId = rule.animation_id;
      renderHmiEventAnimationDesigner(lastHost, model);
    });
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    append(button, createNode('strong', '', rule.name));
    const target = rule.target.element_id || 'Ziel fehlt';
    append(button, createNode('small', '', rule.effect.preset + ' · ' + target));
    append(button, createNode('span', 'hmi-event-rule-option__status',
      rule.enabled ? 'Aktiv' : 'Pausiert'));
    append(panel, button);
  });
  append(host, panel);
}

function buildSourceControls(rule) {
  const source = rule.trigger.source || firstRuntimeSource();
  const group = createNode('div', 'hmi-event-form-grid hmi-event-source-grid');
  const kindSelect = createSelect('hmi-event-source-kind', [
    { value: 'sensor', label: 'Sensor' },
    { value: 'actuator', label: 'Aktor' },
    { value: 'state', label: 'Prozesszustand' }
  ], source.kind);
  const idSelect = createSelect('hmi-event-source-id', sourceCatalog(source.kind), sourceId(source));
  const fieldInput = createInput('hmi-event-source-field', 'text', source.field || 'value');
  append(group, createField('Quellentyp', kindSelect));
  append(group, createField('Quelle', idSelect));
  append(group, createField('Feld', fieldInput, 'z. B. value, value_id oder mode_id'));
  kindSelect.addEventListener('change', function () {
    idSelect.replaceChildren();
    sourceCatalog(kindSelect.value).forEach(function (item) {
      idSelect.appendChild(createOption(item.value, item.label, item.value));
    });
    fieldInput.value = kindSelect.value === 'state' ? 'value_id' : 'value';
  });
  return group;
}

function buildTriggerControls(rule) {
  const wrap = createNode('section', 'hmi-event-editor-section');
  append(wrap, createNode('h5', '', '1 · Ereignis oder Signal'));
  const top = createNode('div', 'hmi-event-form-grid');
  const typeSelect = createSelect('hmi-event-trigger-type', [
    { value: 'signal', label: 'Runtime-Signal' },
    { value: 'event', label: 'Benanntes SVG-Ereignis' },
    { value: 'interaction', label: 'HMI-Interaktion' },
    { value: 'alarm', label: 'Alarmzustand' }
  ], rule.trigger.type);
  const eventInput = createInput('hmi-event-event-name', 'text', rule.trigger.event_name,
    { placeholder: 'z. B. heating_started' });
  append(top, createField('Trigger', typeSelect));
  append(top, createField('Ereignisname', eventInput,
    'Für event/interaction; Runtime-API: dispatchSvgEvent(name, detail).'));
  append(wrap, top);
  append(wrap, buildSourceControls(rule));
  const condition = createNode('div', 'hmi-event-form-grid hmi-event-condition-grid');
  const operator = createSelect('hmi-event-operator', [
    { value: '>=', label: '≥' },
    { value: '>', label: '>' },
    { value: '<=', label: '≤' },
    { value: '<', label: '<' },
    { value: '==', label: '=' },
    { value: '!=', label: '≠' }
  ], rule.trigger.operator);
  const threshold = createInput('hmi-event-value', 'text', rule.trigger.value);
  const mode = createSelect('hmi-event-mode', [
    { value: 'while_true', label: 'Solange aktiv' },
    { value: 'pulse', label: 'Impuls' }
  ], rule.trigger.mode);
  append(condition, createField('Vergleich', operator));
  append(condition, createField('Wert', threshold));
  append(condition, createField('Verhalten', mode));
  append(wrap, condition);
  return wrap;
}

function buildTargetControls(rule) {
  const wrap = createNode('section', 'hmi-event-editor-section');
  append(wrap, createNode('h5', '', '2 · SVG-Ziel'));
  const grid = createNode('div', 'hmi-event-form-grid');
  const entries = elementEntries();
  if (!entries.length) entries.push({ value: '', label: 'Kein SVG-Objekt vorhanden' });
  const target = createSelect('hmi-event-target', entries, rule.target.element_id);
  const part = createSelect('hmi-event-part', partSelectorEntries(rule.target.element_id),
    rule.target.part_selector);
  append(grid, createField('Objekt / Entity', target));
  append(grid, createField('Elementarer Bereich', part,
    'Semantisches data-pf-state-target oder sichere SVG-Klasse.'));
  target.addEventListener('change', function () {
    part.replaceChildren();
    partSelectorEntries(target.value).forEach(function (item) {
      part.appendChild(createOption(item.value, item.label, ''));
    });
  });
  append(wrap, grid);
  return wrap;
}

function buildEffectControls(rule) {
  const wrap = createNode('section', 'hmi-event-editor-section');
  append(wrap, createNode('h5', '', '3 · Effekt'));
  const grid = createNode('div', 'hmi-event-form-grid');
  const preset = createSelect('hmi-event-preset', SVG_EVENT_EFFECT_PRESETS.map(function (item) {
    return { value: item.value, label: item.label };
  }), rule.effect.preset);
  const color = createInput('hmi-event-color', 'color', rule.effect.color);
  const secondary = createInput('hmi-event-secondary', 'color', rule.effect.secondary_color);
  const duration = createInput('hmi-event-duration', 'number', rule.effect.duration_ms,
    { min: 80, max: 60000, step: 50 });
  const intensity = createInput('hmi-event-intensity', 'number', rule.effect.intensity,
    { min: 1, max: 2, step: 0.01 });
  const level = createInput('hmi-event-level', 'number', rule.effect.level,
    { min: 0, max: 1, step: 0.01 });
  const opacity = createInput('hmi-event-opacity', 'number', rule.effect.opacity,
    { min: 0, max: 1, step: 0.01 });
  append(grid, createField('Preset', preset));
  append(grid, createField('Primärfarbe', color));
  append(grid, createField('Sekundärfarbe', secondary));
  append(grid, createField('Dauer (ms)', duration));
  append(grid, createField('Intensität', intensity));
  append(grid, createField('Füllstand', level));
  append(grid, createField('Deckkraft', opacity));
  append(wrap, grid);
  return wrap;
}

function readRuleForm(original) {
  const kind = document.getElementById('hmi-event-source-kind').value;
  const id = Number(document.getElementById('hmi-event-source-id').value);
  const source = {
    kind: kind,
    field: document.getElementById('hmi-event-source-field').value || (kind === 'state' ? 'value_id' : 'value')
  };
  if (kind === 'sensor') source.sensor_id = id;
  if (kind === 'actuator') source.actuator_id = id;
  if (kind === 'state') source.state_id = id;
  return normalizeSvgEventAnimation({
    animation_id: original.animation_id,
    name: document.getElementById('hmi-event-name').value,
    enabled: document.getElementById('hmi-event-enabled').checked,
    view_id: original.view_id,
    trigger: {
      type: document.getElementById('hmi-event-trigger-type').value,
      source: source,
      operator: document.getElementById('hmi-event-operator').value,
      value: document.getElementById('hmi-event-value').value,
      event_name: document.getElementById('hmi-event-event-name').value,
      mode: document.getElementById('hmi-event-mode').value,
      hold_ms: original.trigger.hold_ms
    },
    target: {
      element_id: document.getElementById('hmi-event-target').value,
      part_selector: document.getElementById('hmi-event-part').value
    },
    effect: {
      preset: document.getElementById('hmi-event-preset').value,
      color: document.getElementById('hmi-event-color').value,
      secondary_color: document.getElementById('hmi-event-secondary').value,
      duration_ms: Number(document.getElementById('hmi-event-duration').value),
      intensity: Number(document.getElementById('hmi-event-intensity').value),
      level: Number(document.getElementById('hmi-event-level').value),
      opacity: Number(document.getElementById('hmi-event-opacity').value)
    }
  }, 0);
}

function saveRule(model, original) {
  const nextRule = readRuleForm(original);
  const rules = normalizeSvgEventAnimations(model.event_animations).map(function (item) {
    return item.animation_id === original.animation_id ? nextRule : item;
  });
  selectedAnimationId = nextRule.animation_id;
  commitModel(model, rules, 'event_animation_save');
  showStatus('SVG-Ereignisanimation gespeichert', 'success');
}

function previewRule(original) {
  const rule = readRuleForm(original);
  const svgRoot = document.getElementById('main-canvas');
  const targets = previewSvgEventAnimation(svgRoot, rule, 2000);
  if (!targets.length) {
    showStatus('Animationsziel ist im Anlagenbild nicht sichtbar', 'warning');
    return;
  }
  showStatus('Animation wird zwei Sekunden am SVG-Ziel gezeigt', 'success');
}

function renderRuleEditor(host, model, rule) {
  const editor = createNode('div', 'hmi-event-rule-editor');
  if (!rule) {
    append(editor, createNode('div', 'hmi-event-empty',
      'Animation auswählen oder über ein Preset neu anlegen.'));
    append(host, editor);
    return;
  }
  const identity = createNode('section', 'hmi-event-editor-section');
  append(identity, createNode('h5', '', 'Animation'));
  const nameRow = createNode('div', 'hmi-event-form-grid hmi-event-identity-grid');
  append(nameRow, createField('Name',
    createInput('hmi-event-name', 'text', rule.name)));
  const enabled = createInput('hmi-event-enabled', 'checkbox', rule.enabled);
  const enabledCard = createNode('label', 'hmi-event-enabled-card');
  append(enabledCard, enabled);
  append(enabledCard, createNode('span', '', 'Regel aktiv'));
  append(nameRow, enabledCard);
  append(identity, nameRow);
  append(editor, identity);
  append(editor, buildTriggerControls(rule));
  append(editor, buildTargetControls(rule));
  append(editor, buildEffectControls(rule));
  const actions = createNode('div', 'hmi-event-editor-actions');
  append(actions, createButton('Speichern', 'btn btn-primary', function () {
    saveRule(model, rule);
  }));
  append(actions, createButton('Am SVG testen', 'btn btn-secondary', function () {
    previewRule(rule);
  }));
  append(actions, createButton('Duplizieren', 'btn btn-secondary', function () {
    duplicateRule(model, rule);
  }));
  append(actions, createButton('Entfernen', 'btn btn-danger', function () {
    removeRule(model, rule.animation_id);
  }));
  append(editor, actions);
  append(host, editor);
}

export function renderHmiEventAnimationDesigner(container, model) {
  if (!container) return;
  lastHost = container;
  const activeModel = model && typeof model === 'object' ? model : {};
  const rules = normalizeSvgEventAnimations(activeModel.event_animations);
  if (!selectedAnimationId || !rules.some(function (item) {
    return item.animation_id === selectedAnimationId;
  })) {
    selectedAnimationId = rules[0] ? rules[0].animation_id : '';
  }
  container.replaceChildren();
  const root = createNode('div', 'hmi-event-animation-designer');
  renderPresetCards(root, activeModel);
  renderValidation(root, rules);
  const layout = createNode('div', 'hmi-event-designer-layout');
  renderRuleList(layout, activeModel, rules);
  const selected = rules.find(function (item) {
    return item.animation_id === selectedAnimationId;
  }) || null;
  renderRuleEditor(layout, activeModel, selected);
  append(root, layout);
  append(container, root);
}
