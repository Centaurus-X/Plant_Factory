/**
 * svg_event_runtime.js — event-driven SVG animation contract for Plant Factory V64.
 *
 * The runtime deliberately controls CSS classes and custom properties instead
 * of autonomous SMIL timelines. One normalized rule can therefore be driven by
 * live signals, alarms, HMI interactions or a named integration event.
 *
 * Style: functional composition only; no classes and no arrow functions.
 */

'use strict';

export const SVG_EVENT_SCHEMA_ID = 'plant-factory.svg-event-animation';
export const SVG_EVENT_SCHEMA_VERSION = 1;

export const SVG_EVENT_ANIMATION_CSS = [
  '/* --- Plant Factory V64 SVG event effects ---------------------------- */',
  '@keyframes pf64-event-blink { 0%,100%{opacity:1} 50%{opacity:.22} }',
  '@keyframes pf64-event-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(var(--pf-event-intensity,1.08))} }',
  '@keyframes pf64-event-flow { to{stroke-dashoffset:-32} }',
  '@keyframes pf64-event-rotate { to{transform:rotate(360deg)} }',
  '',
  '.pf-event-active {',
  '  --pf-event-duration: 1000ms;',
  '  --pf-event-color: #22c55e;',
  '  --pf-event-secondary-color: #f59e0b;',
  '  --pf-event-intensity: 1.08;',
  '  --pf-event-level: 1;',
  '  --pf-event-opacity: .55;',
  '}',
  '.pf-event-fill {',
  '  fill: var(--pf-event-color) !important;',
  '  transition: fill var(--pf-event-duration) ease, fill-opacity var(--pf-event-duration) ease;',
  '}',
  '.pf-event-stroke {',
  '  stroke: var(--pf-event-color) !important;',
  '  transition: stroke var(--pf-event-duration) ease, stroke-width var(--pf-event-duration) ease;',
  '}',
  '.pf-event-temperature {',
  '  fill: var(--pf-event-color) !important;',
  '  stroke: var(--pf-event-secondary-color) !important;',
  '  filter: drop-shadow(0 0 7px color-mix(in srgb, var(--pf-event-color) 65%, transparent));',
  '  transition: fill var(--pf-event-duration) ease, stroke var(--pf-event-duration) ease, filter var(--pf-event-duration) ease;',
  '}',
  '.pf-event-flow {',
  '  stroke: var(--pf-event-color) !important;',
  '  stroke-dasharray: 11 6;',
  '  animation: pf64-event-flow var(--pf-event-duration) linear infinite;',
  '}',
  '.pf-event-blink { animation: pf64-event-blink var(--pf-event-duration) steps(1,end) infinite }',
  '.pf-event-pulse {',
  '  animation: pf64-event-pulse var(--pf-event-duration) ease-in-out infinite;',
  '  transform-box: fill-box;',
  '  transform-origin: center;',
  '}',
  '.pf-event-rotate {',
  '  animation: pf64-event-rotate var(--pf-event-duration) linear infinite;',
  '  transform-box: fill-box;',
  '  transform-origin: center;',
  '}',
  '.pf-event-level {',
  '  transform: scaleY(var(--pf-event-level));',
  '  transform-box: fill-box;',
  '  transform-origin: center bottom;',
  '  transition: transform var(--pf-event-duration) ease;',
  '}',
  '.pf-event-opacity {',
  '  opacity: var(--pf-event-opacity);',
  '  transition: opacity var(--pf-event-duration) ease;',
  '}',
  '.pf-event-glow {',
  '  filter: drop-shadow(0 0 8px color-mix(in srgb, var(--pf-event-color) 72%, transparent));',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  .pf-event-flow,.pf-event-blink,.pf-event-pulse,.pf-event-rotate { animation: none !important }',
  '}'
].join('\n');

export const SVG_EVENT_EFFECT_PRESETS = Object.freeze([
  { value: 'color_fill', label: 'Füllfarbe', description: 'Farbwechsel einer Fläche' },
  { value: 'color_stroke', label: 'Linienfarbe', description: 'Farbwechsel einer Kontur oder Rohrlinie' },
  { value: 'temperature', label: 'Temperatur / Heizen', description: 'Farbverlauf mit Leuchteffekt' },
  { value: 'flow', label: 'Medium fließt', description: 'Ereignisgesteuerte Flussbewegung' },
  { value: 'level', label: 'Füllstand', description: 'Vertikale Füllstandsbewegung' },
  { value: 'rotate', label: 'Rotation', description: 'Pumpe, Motor oder Rührer drehen' },
  { value: 'pulse', label: 'Pulsieren', description: 'Sanfte Größenbewegung' },
  { value: 'blink', label: 'Blinken', description: 'Deutliches Warnsignal' },
  { value: 'opacity', label: 'Ein-/Ausblenden', description: 'Deckkraft weich ändern' },
  { value: 'glow', label: 'Leuchten', description: 'Farbiger Statusschein' }
]);

const MANAGED_CLASSES = Object.freeze([
  'pf-event-active',
  'pf-event-fill',
  'pf-event-stroke',
  'pf-event-temperature',
  'pf-event-flow',
  'pf-event-blink',
  'pf-event-pulse',
  'pf-event-rotate',
  'pf-event-level',
  'pf-event-opacity',
  'pf-event-glow'
]);

const MANAGED_PROPERTIES = Object.freeze([
  '--pf-event-duration',
  '--pf-event-color',
  '--pf-event-secondary-color',
  '--pf-event-intensity',
  '--pf-event-level',
  '--pf-event-opacity'
]);

function deepClone(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function toText(value, fallback) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || String(fallback || '');
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeColor(value, fallback) {
  const text = toText(value, fallback);
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^(rgb|hsl)a?\([0-9.,%\s-]+\)$/i.test(text)) return text;
  if (/^[a-z]{3,24}$/i.test(text)) return text;
  return fallback;
}

function sourceFromCondition(condition) {
  const value = condition && typeof condition === 'object' ? condition : {};
  const type = toText(value.type, '').toLowerCase();
  if (type === 'sensor_cmp') {
    return { kind: 'sensor', sensor_id: value.sensor_id, field: value.field || 'value' };
  }
  if (type === 'actuator_cmp') {
    return { kind: 'actuator', actuator_id: value.actuator_id, field: value.field || 'value' };
  }
  if (type === 'state_cmp') {
    return { kind: 'state', state_id: value.state_id, field: value.field || 'value_id' };
  }
  return null;
}

function normalizeSource(value) {
  const source = value && typeof value === 'object' ? deepClone(value) : {};
  const kind = toText(source.kind, 'sensor').toLowerCase();
  const allowedKinds = ['sensor', 'actuator', 'state', 'key'];
  const normalized = {
    kind: allowedKinds.indexOf(kind) >= 0 ? kind : 'sensor',
    field: toText(source.field, kind === 'state' ? 'value_id' : 'value')
  };
  if (normalized.kind === 'sensor') normalized.sensor_id = toNumber(source.sensor_id ?? source.id, 1);
  if (normalized.kind === 'actuator') normalized.actuator_id = toNumber(source.actuator_id ?? source.id, 1);
  if (normalized.kind === 'state') normalized.state_id = toNumber(source.state_id ?? source.id, 1);
  if (normalized.kind === 'key') normalized.key = toText(source.key ?? source.id, '');
  return normalized;
}

function normalizeTrigger(value, fallbackSource, fallbackCondition) {
  const trigger = value && typeof value === 'object' ? deepClone(value) : {};
  const embeddedCondition = trigger.condition && typeof trigger.condition === 'object'
    ? trigger.condition : null;
  const condition = embeddedCondition || (
    fallbackCondition && typeof fallbackCondition === 'object'
      ? fallbackCondition : {}
  );
  const type = toText(trigger.type, 'signal').toLowerCase();
  const allowedTypes = ['signal', 'alarm', 'interaction', 'event'];
  const normalizedType = allowedTypes.indexOf(type) >= 0 ? type : 'signal';
  const source = trigger.source || fallbackSource || sourceFromCondition(condition);
  const operatorAliases = {
    eq: '==',
    neq: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    equals: '==',
    not_equals: '!='
  };
  const requestedOperator = toText(
    trigger.operator || trigger.op || condition.operator || condition.op,
    '>='
  ).toLowerCase();
  return {
    type: normalizedType,
    source: normalizeSource(source),
    operator: operatorAliases[requestedOperator] || requestedOperator,
    value: trigger.value !== undefined ? trigger.value
      : (condition.value !== undefined ? condition.value : 1),
    event_name: toText(trigger.event_name || trigger.name, ''),
    alarm_id: toText(trigger.alarm_id, ''),
    mode: toText(trigger.mode, 'while_true'),
    hold_ms: clamp(toNumber(trigger.hold_ms, 1600), 100, 30000)
  };
}

function normalizeEffect(value) {
  const effect = value && typeof value === 'object' ? deepClone(value) : {};
  const presetValues = SVG_EVENT_EFFECT_PRESETS.map(function (item) { return item.value; });
  const presetAliases = {
    fill: 'color_fill',
    stroke: 'color_stroke',
    color: 'color_fill'
  };
  const typeByPreset = {
    color_fill: 'fill',
    color_stroke: 'stroke',
    temperature: 'temperature',
    flow: 'flow',
    level: 'level',
    rotate: 'rotate',
    pulse: 'pulse',
    blink: 'blink',
    opacity: 'opacity',
    glow: 'glow'
  };
  const requested = toText(effect.preset || effect.type, 'color_fill').toLowerCase();
  const aliased = presetAliases[requested] || requested;
  const preset = presetValues.indexOf(aliased) >= 0 ? aliased : 'color_fill';
  return {
    preset: preset,
    type: typeByPreset[preset],
    color: normalizeColor(effect.color || effect.active_color, '#22c55e'),
    secondary_color: normalizeColor(
      effect.secondary_color || effect.inactive_color,
      '#f59e0b'
    ),
    duration_ms: clamp(toNumber(effect.duration_ms ?? effect.duration, 1000), 80, 60000),
    intensity: clamp(toNumber(effect.intensity, 1.08), 1, 2),
    level: clamp(toNumber(effect.level, 0.72), 0, 1),
    opacity: clamp(toNumber(effect.opacity, 0.55), 0, 1)
  };
}

export function normalizeSvgEventAnimation(value, index) {
  const source = value && typeof value === 'object' ? deepClone(value) : {};
  const target = source.target && typeof source.target === 'object' ? source.target : {};
  const animationId = toText(source.animation_id || source.id, 'svg_anim_' + String(index + 1));
  return {
    schema: SVG_EVENT_SCHEMA_ID,
    schema_version: SVG_EVENT_SCHEMA_VERSION,
    animation_id: animationId,
    name: toText(source.name, 'SVG-Animation ' + String(index + 1)),
    enabled: source.enabled !== false,
    view_id: toText(source.view_id, 'main'),
    trigger: normalizeTrigger(source.trigger, source.source, source.when || source.condition),
    target: {
      element_id: toText(target.element_id || source.element_id, ''),
      part_selector: toText(target.part_selector || target.selector, '').slice(0, 240)
    },
    effect: normalizeEffect(source.effect || source.apply)
  };
}

export function normalizeSvgEventAnimations(value) {
  return ensureArray(value).map(function (item, index) {
    return normalizeSvgEventAnimation(item, index);
  });
}

export function signalKeyFromRef(value) {
  const source = value && typeof value === 'object' ? value : {};
  const kind = toText(source.kind, '').toLowerCase();
  const field = toText(source.field, kind === 'state' ? 'value_id' : 'value');
  if (kind === 'key') {
    const key = toText(source.key ?? source.id, '');
    return key ? 'key:' + key : '';
  }
  let id = null;
  if (kind === 'sensor') id = source.sensor_id ?? source.id;
  if (kind === 'actuator') id = source.actuator_id ?? source.id;
  if (kind === 'state') id = source.state_id ?? source.id;
  if (!kind || id === null || id === undefined) return '';
  return kind + ':' + String(id) + ':' + field;
}

function compareValues(actual, operator, expected) {
  if (operator === '==' || operator === '=') return String(actual) === String(expected);
  if (operator === '!=') return String(actual) !== String(expected);
  if (operator === 'truthy') return Boolean(actual);
  if (operator === 'falsy') return !actual;
  if (operator === 'contains') {
    if (Array.isArray(actual)) return actual.map(String).indexOf(String(expected)) >= 0;
    return String(actual ?? '').includes(String(expected ?? ''));
  }
  const left = Number(actual);
  if (!Number.isFinite(left)) return false;
  if (operator === 'between') {
    const range = Array.isArray(expected)
      ? expected
      : String(expected ?? '').split(/[;,]/);
    if (range.length < 2) return false;
    const minimum = Number(range[0]);
    const maximum = Number(range[1]);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return false;
    return left >= Math.min(minimum, maximum) && left <= Math.max(minimum, maximum);
  }
  const right = Number(expected);
  if (!Number.isFinite(right)) return false;
  if (operator === '>') return left > right;
  if (operator === '<') return left < right;
  if (operator === '<=') return left <= right;
  return left >= right;
}

function signalRuleActive(rule, signals) {
  if (!rule || !rule.trigger || rule.trigger.type !== 'signal') return false;
  const key = signalKeyFromRef(rule.trigger.source);
  if (!key || !Object.prototype.hasOwnProperty.call(signals, key)) return false;
  return compareValues(signals[key], rule.trigger.operator, rule.trigger.value);
}

function escapeSelectorId(value) {
  const text = String(value || '');
  if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
    return CSS.escape(text);
  }
  return text.replace(/[^a-zA-Z0-9_-]/g, function (character) {
    return '\\' + character.codePointAt(0).toString(16) + ' ';
  });
}

function rootTarget(svgRoot, elementId) {
  if (!svgRoot || !elementId) return null;
  if (svgRoot.getAttribute && svgRoot.getAttribute('id') === elementId) return svgRoot;
  try {
    return svgRoot.querySelector('#' + escapeSelectorId(elementId));
  } catch (error) {
    return null;
  }
}

function resolveTargets(svgRoot, rule) {
  const root = rootTarget(svgRoot, rule && rule.target ? rule.target.element_id : '');
  if (!root) return [];
  const selector = toText(rule.target.part_selector, '');
  if (!selector) return [root];
  try {
    const matches = Array.from(root.querySelectorAll(selector));
    return matches.length ? matches : [root];
  } catch (error) {
    return [root];
  }
}

function classesForPreset(preset) {
  const map = {
    color_fill: ['pf-event-fill'],
    color_stroke: ['pf-event-stroke'],
    temperature: ['pf-event-temperature'],
    flow: ['pf-event-flow'],
    level: ['pf-event-fill', 'pf-event-level'],
    rotate: ['pf-event-rotate'],
    pulse: ['pf-event-pulse'],
    blink: ['pf-event-blink'],
    opacity: ['pf-event-opacity'],
    glow: ['pf-event-stroke', 'pf-event-glow']
  };
  return map[preset] ? map[preset].slice() : ['pf-event-fill'];
}

function clearNodeEffect(node) {
  if (!node || !node.classList) return;
  MANAGED_CLASSES.forEach(function (className) {
    node.classList.remove(className);
  });
  if (node.style) {
    MANAGED_PROPERTIES.forEach(function (propertyName) {
      node.style.removeProperty(propertyName);
    });
  }
  node.removeAttribute('data-pf-event-animation-active');
}

function applyNodeEffect(node, rule) {
  if (!node || !node.classList || !rule) return;
  const effect = normalizeEffect(rule.effect);
  clearNodeEffect(node);
  node.classList.add('pf-event-active');
  classesForPreset(effect.preset).forEach(function (className) {
    node.classList.add(className);
  });
  node.style.setProperty('--pf-event-duration', String(effect.duration_ms) + 'ms');
  node.style.setProperty('--pf-event-color', effect.color);
  node.style.setProperty('--pf-event-secondary-color', effect.secondary_color);
  node.style.setProperty('--pf-event-intensity', String(effect.intensity));
  node.style.setProperty('--pf-event-level', String(effect.level));
  node.style.setProperty('--pf-event-opacity', String(effect.opacity));
  node.setAttribute('data-pf-event-animation-active', rule.animation_id);
}

export function applySvgEventAnimation(svgRoot, value, active) {
  const rule = normalizeSvgEventAnimation(value, 0);
  const targets = resolveTargets(svgRoot, rule);
  targets.forEach(function (node) {
    if (active) applyNodeEffect(node, rule);
    else clearNodeEffect(node);
  });
  return targets;
}

export function previewSvgEventAnimation(svgRoot, value, holdMs) {
  const rule = normalizeSvgEventAnimation(value, 0);
  const targets = applySvgEventAnimation(svgRoot, rule, true);
  const wait = clamp(toNumber(holdMs, 1800), 300, 10000);
  window.setTimeout(function () {
    targets.forEach(clearNodeEffect);
  }, wait);
  return targets;
}

export function validateSvgEventAnimations(value, context) {
  const rules = normalizeSvgEventAnimations(value);
  const options = context && typeof context === 'object' ? context : {};
  const validElements = new Set(ensureArray(options.element_ids).map(String));
  const ids = new Set();
  const errors = [];
  const warnings = [];
  rules.forEach(function (rule, index) {
    const path = 'event_animations[' + String(index) + ']';
    if (ids.has(rule.animation_id)) errors.push(path + ': animation_id ist doppelt');
    ids.add(rule.animation_id);
    if (!rule.target.element_id) errors.push(path + ': target.element_id fehlt');
    if (validElements.size && !validElements.has(rule.target.element_id)) {
      warnings.push(path + ': Zielobjekt ist im aktuellen Anlagenbild nicht vorhanden');
    }
    if (rule.trigger.type === 'signal' && !signalKeyFromRef(rule.trigger.source)) {
      errors.push(path + ': Signalquelle ist unvollständig');
    }
    if (rule.trigger.type !== 'signal'
        && rule.trigger.type !== 'alarm'
        && !rule.trigger.event_name) {
      errors.push(path + ': event_name fehlt');
    }
  });
  return {
    valid: errors.length === 0,
    count: rules.length,
    errors: errors,
    warnings: warnings
  };
}

export function createSvgEventRuntime(options) {
  const settings = options && typeof options === 'object' ? options : {};
  const state = {
    svgRoot: settings.svgRoot || null,
    rules: [],
    signals: {},
    active: {},
    nodes: {},
    timers: {},
    destroyed: false
  };

  function clearRule(rule) {
    const id = rule ? rule.animation_id : '';
    ensureArray(state.nodes[id]).forEach(clearNodeEffect);
    state.nodes[id] = [];
    state.active[id] = false;
    if (state.timers[id]) {
      window.clearTimeout(state.timers[id]);
      delete state.timers[id];
    }
  }

  function setRuleActive(rule, active) {
    if (!rule || !rule.enabled || state.destroyed) return;
    const id = rule.animation_id;
    if (!active) {
      clearRule(rule);
      return;
    }
    const targets = resolveTargets(state.svgRoot, rule);
    ensureArray(state.nodes[id]).forEach(clearNodeEffect);
    targets.forEach(function (node) { applyNodeEffect(node, rule); });
    state.nodes[id] = targets;
    state.active[id] = true;
  }

  function evaluateSignals() {
    state.rules.forEach(function (rule) {
      if (rule.trigger.type !== 'signal') return;
      setRuleActive(rule, signalRuleActive(rule, state.signals));
    });
  }

  function setSignal(ref, value) {
    const key = signalKeyFromRef(ref);
    if (!key) return;
    state.signals[key] = value;
    evaluateSignals();
  }

  function setSignals(batch) {
    if (!batch) return;
    if (Array.isArray(batch)) {
      batch.forEach(function (item) {
        if (item) state.signals[signalKeyFromRef(item.ref)] = item.value;
      });
    } else if (typeof batch === 'object') {
      Object.keys(batch).forEach(function (key) {
        state.signals[String(key)] = batch[key];
      });
    }
    evaluateSignals();
  }

  function eventMatches(rule, eventName, detail) {
    const trigger = rule.trigger || {};
    const payload = detail && typeof detail === 'object' ? detail : {};
    if (trigger.type === 'alarm') {
      if (eventName !== 'alarm' && eventName !== 'alarm:' + trigger.alarm_id) return false;
      if (trigger.alarm_id && payload.alarm_id && trigger.alarm_id !== payload.alarm_id) return false;
      return payload.active !== false;
    }
    const expected = trigger.event_name || trigger.type;
    if (eventName !== expected && eventName !== trigger.type + ':' + expected) return false;
    if (payload.element_id && rule.target.element_id
        && payload.element_id !== rule.target.element_id) return false;
    return payload.active !== false;
  }

  function dispatch(eventName, detail) {
    const name = toText(eventName, '');
    if (!name) return 0;
    let matched = 0;
    state.rules.forEach(function (rule) {
      if (rule.trigger.type === 'signal') return;
      if (!eventMatches(rule, name, detail)) {
        if (detail && detail.active === false) setRuleActive(rule, false);
        return;
      }
      matched += 1;
      const active = !(detail && detail.active === false);
      setRuleActive(rule, active);
      if (active && rule.trigger.mode === 'pulse') {
        state.timers[rule.animation_id] = window.setTimeout(function () {
          setRuleActive(rule, false);
        }, rule.trigger.hold_ms);
      }
    });
    return matched;
  }

  function setAlarmStates(alarmStates) {
    const values = alarmStates && typeof alarmStates === 'object' ? alarmStates : {};
    Object.keys(values).forEach(function (alarmId) {
      const value = values[alarmId] || {};
      dispatch('alarm:' + alarmId, {
        alarm_id: alarmId,
        active: value.active === true,
        severity: value.severity || 'info'
      });
    });
  }

  function updateModel(model) {
    state.rules.forEach(clearRule);
    const source = model && typeof model === 'object' ? model.event_animations : [];
    state.rules = normalizeSvgEventAnimations(source);
    evaluateSignals();
  }

  function refresh() {
    state.rules.forEach(function (rule) {
      if (rule.trigger.type === 'signal') {
        setRuleActive(rule, signalRuleActive(rule, state.signals));
      } else if (state.active[rule.animation_id]) {
        setRuleActive(rule, true);
      }
    });
  }

  function getState() {
    return deepClone({
      signals: state.signals,
      active: state.active,
      rules: state.rules
    });
  }

  function destroy() {
    state.destroyed = true;
    state.rules.forEach(clearRule);
    state.rules = [];
    state.signals = {};
  }

  updateModel(settings.hmiUi || settings.model || {});
  return {
    setSignal: setSignal,
    setSignals: setSignals,
    setAlarmStates: setAlarmStates,
    dispatch: dispatch,
    updateModel: updateModel,
    refresh: refresh,
    getState: getState,
    validate: function () { return validateSvgEventAnimations(state.rules); },
    destroy: destroy
  };
}
