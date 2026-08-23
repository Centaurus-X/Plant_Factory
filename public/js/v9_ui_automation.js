/**
 * v9_ui_automation.js — Automation Studio V9 (PF-AUTOMATION-STUDIO-V1).
 *
 * One editor for the five canonical runtime sections (process_states,
 * filters, timers, rule_engine, rules) plus every catalogue table the V9
 * contract requires (processes, parameter_generic_templates, schema_mappings,
 * pid_configs, control_method_templates, control_methods, process_modes,
 * process_values). Seven areas: cockpit, processes & states, rules,
 * filters & timers, library, engine, device map.
 *
 * Data flow (single authority):
 *   store.getConfig()  --adopt-->  CFG (working copy)  --commitModel()-->
 *   store.replaceSections(patch)  --config:changed-->  adopt again.
 * The module never mutates the store object directly and never touches
 * the legacy editor projection; undo/redo, validation, dirty flag and save stay in
 * v9_store.js / v9_bootstrap.js.
 *
 * Dependencies: v9_store.js (getConfig/getState/replaceSections/undo/on),
 * v9_shard.js (ownerIndex, scopeForControllers), v9_dom.js (modal, toast).
 * Optional read-only endpoints: /api/process-library-v9, /api/rule-library-v9.
 *
 * Style: pure functional, no classes, no arrow functions, no innerHTML for
 * data — every node is created with document.createElement (like v9_dom.js).
 */

'use strict';

import * as store from './v9_store.js';
import { ownerIndex, scopeForControllers } from './v9_shard.js';
import { modal as v9Modal, toast as v9Toast } from './v9_dom.js';


var CFG = null;           // working copy of store.getConfig()
var LIB = { process_templates: [], rule_templates: [] };  // loaded from the library endpoints
var AS_ROOT = null;       // panel root element
function asEl(key) { return (AS_ROOT || document).querySelector('[data-as="' + key + '"]'); }

/* ------------------------------------------------------------------ utils */
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function txt(v) { return (v === null || v === undefined) ? '' : String(v); }
function num(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }
function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
function indexBy(list, key) {
  var m = new Map();
  arr(list).forEach(function (row) { if (row && row[key] !== undefined) m.set(String(row[key]), row); });
  return m;
}
function maxId(list, key) {
  var mx = 0;
  arr(list).forEach(function (row) { var n = num(row && row[key]); if (n !== null && n > mx) mx = n; });
  return mx;
}
function uniq(list) { return Array.from(new Set(list)); }
function has(list, v) { return arr(list).indexOf(v) >= 0; }

/** Element factory: h('div.a.b', {attrs}, ...children) — no innerHTML for user data. */
function h(spec, attrs) {
  var children = Array.prototype.slice.call(arguments, 2);
  var parts = String(spec).split(/(?=[.#])/);
  var tag = parts[0] && parts[0][0] !== '.' && parts[0][0] !== '#' ? parts[0] : 'div';
  var node = document.createElement(tag);
  parts.forEach(function (p) {
    if (p[0] === '.') node.classList.add(p.slice(1));
    else if (p[0] === '#') node.id = p.slice(1);
  });
  if (isObj(attrs)) {
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') txt(v).split(/\s+/).filter(Boolean).forEach(function (c) { node.classList.add(c); });
      else if (k === 'text') node.textContent = txt(v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple') node[k] = v;
      else if (k === 'style' && isObj(v)) Object.keys(v).forEach(function (s) { node.style[s] = v[s]; });
      else node.setAttribute(k, v === true ? '' : txt(v));
    });
  }
  appendAll(node, children);
  return node;
}
function appendAll(node, children) {
  children.forEach(function (c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { appendAll(node, c); return; }
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  });
}
function mount(host, children) { while (host.firstChild) host.removeChild(host.firstChild); appendAll(host, Array.isArray(children) ? children : [children]); }
function icon(name, cls) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
  var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + name);
  svg.appendChild(use);
  return svg;
}
function badge(text, tone, mono) { return h('span.badge' + (tone ? '.badge--' + tone : '') + (mono ? '.badge--mono' : ''), { text: text }); }
function pill(text, tone) { return h('span.pill' + (tone ? '.pill--' + tone : ''), { text: text }); }
function btn(label, opts) {
  var o = opts || {};
  var cls = '.btn' + (o.variant ? '.btn--' + o.variant : '') + (o.size ? '.btn--' + o.size : '') + (o.block ? '.btn--block' : '');
  var b = h('button' + cls, { type: 'button', title: o.title, disabled: o.disabled, onClick: o.onClick });
  if (o.icon) b.appendChild(icon(o.icon, 'ico--sm'));
  if (label) b.appendChild(h('span', { text: label }));
  return b;
}
function field(label, control, opts) {
  var o = opts || {};
  var lab = h('label', null, h('span', { text: label }), o.key ? h('span.k', { text: o.key }) : null, o.required ? h('span.req', { text: '*' }) : null);
  var f = h('div.field' + (o.wide ? '.field--wide' : ''), null, lab, control, o.hint ? h('div.hint', { text: o.hint }) : null);
  return f;
}
function select(items, value, onChange, extra) {
  var s = h('select', Object.assign({ onChange: onChange }, extra || {}));
  arr(items).forEach(function (it) {
    var o = h('option', { value: txt(it.value), text: it.label, disabled: it.disabled });
    if (txt(it.value) === txt(value)) o.selected = true;
    s.appendChild(o);
  });
  return s;
}
function input(value, onChange, extra) {
  var x = Object.assign({ type: 'text', value: txt(value) }, extra || {});
  if (onChange) x.onChange = onChange;
  return h('input', x);
}
function unitInput(value, unit, onChange, extra) {
  return h('div.unit', null, input(value, onChange, Object.assign({ type: 'number', step: 'any' }, extra || {})), unit ? h('span', { text: unit }) : null);
}
function jsonPre(obj) {
  var s = JSON.stringify(obj, null, 2);
  var pre = h('pre.json');
  // lightweight highlighting by token class
  var re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|(true|false|null)/g;
  var last = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) pre.appendChild(document.createTextNode(s.slice(last, m.index)));
    if (m[1] !== undefined) {
      pre.appendChild(h('span' + (m[2] ? '.k' : '.s'), { text: m[1] }));
      if (m[2]) pre.appendChild(document.createTextNode(m[2]));
    } else if (m[3] !== undefined) pre.appendChild(h('span.n', { text: m[3] }));
    else pre.appendChild(h('span.n', { text: m[4] }));
    last = re.lastIndex;
  }
  if (last < s.length) pre.appendChild(document.createTextNode(s.slice(last)));
  return pre;
}
var toast = function (msg, tone) {
  var host = asEl('toast');
  if (!host) return;
  var n = h('div' + (tone ? '.' + tone : ''), { text: msg });
  host.appendChild(n);
  setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 2600);
};
/** Confirmation dialog — replaced by the host's managed modal (PF-MODAL-V1) in the integration build. */
var confirmAction = function (message, title, onOk) {
  var root = h('div.as-modal', { role: 'dialog', 'aria-modal': 'true' });
  function close() { if (root.parentNode) root.parentNode.removeChild(root); }
  root.appendChild(h('div.as-modal__backdrop', { onClick: close }));
  root.appendChild(h('div.as-modal__panel', null, h('h3', { text: title || 'Bestätigen' }), h('p', { text: message }),
    h('div.row', { style: { justifyContent: 'flex-end', marginTop: '12px' } }, btn('Abbrechen', { variant: 'ghost', onClick: close }), btn('Löschen', { variant: 'danger', icon: 'i-trash', onClick: function () { close(); onOk(); } }))));
  (AS_ROOT || document.body).appendChild(root);
};

/* ------------------------------------------------------------------ lookups */
var IDX = {};
function rebuildIndex() {
  IDX.ctrl = indexBy(CFG.controllers, 'controller_uuid');
  IDX.node = indexBy(CFG.nodes, 'node_id');
  IDX.profile = indexBy(CFG.scaling_profiles, 'profile_id');
  IDX.sensorType = indexBy(CFG.sensor_types, 'sensor_types_id');
  IDX.actuatorType = indexBy(CFG.actuator_types, 'actuator_types_id');
  IDX.mode = indexBy(CFG.process_modes, 'mode_id');
  IDX.value = indexBy(CFG.process_values, 'value_id');
  IDX.template = indexBy(CFG.parameter_generic_templates, 'schema_id');
  IDX.mapping = indexBy(CFG.schema_mappings, 'mapping_id');
  IDX.pid = indexBy(CFG.pid_configs, 'pid_config_id');
  IDX.cmTemplate = indexBy(CFG.control_method_templates, 'template_id');
  IDX.method = indexBy(CFG.control_methods, 'method_id');
  IDX.process = indexBy(CFG.processes, 'p_id');
  IDX.state = indexBy(CFG.process_states, 'state_id');
  IDX.filter = indexBy(CFG.filters, 'filter_id');
  IDX.timer = indexBy(CFG.timers, 'timer_id');
  IDX.rule = indexBy(CFG.rules, 'rule_id');
  IDX.sensor = new Map(); IDX.actuator = new Map();
  arr(CFG.sensors).forEach(function (s) { IDX.sensor.set(refKey(s, 'sensor_id'), s); });
  arr(CFG.actuators).forEach(function (a) { IDX.actuator.set(refKey(a, 'actuator_id'), a); });
}
function refKey(ref, idField) { return txt(ref.controller_uuid) + ':' + txt(ref[idField]); }
function ctrlOf(uuid) { return IDX.ctrl.get(txt(uuid)) || null; }
function ctrlKey(uuid) { var c = ctrlOf(uuid); return c ? c.controller_key : '?'; }
function nodeOfCtrl(uuid) { var c = ctrlOf(uuid); return c ? txt(c.node_id) : '?'; }
function profileOf(id) { return IDX.profile.get(txt(id)) || null; }
function unitOf(dev) { var p = profileOf(dev.profile_id); return p ? p.unit : ''; }
function sensorKindOf(s) {
  var t = IDX.sensorType.get(txt(s.sensor_types_id));
  if (t) return t.sensor_type;
  var p = profileOf(s.profile_id);
  if (!p) return 'unbekannt';
  if (p.unit === 'C') return 'temperature';
  if (p.unit === 'mA') return 'pressure/flow (4–20 mA)';
  if (p.unit === '%') return 'level';
  if (p.unit === 'V') return 'analog';
  return p.name;
}
function actuatorKindOf(a) {
  var t = IDX.actuatorType.get(txt(a.actuator_types_id));
  if (t) return t.actuator_type;
  return a.function_type === 'write_coil' ? 'Schaltausgang (coil)' : 'Stellausgang (register)';
}
function devShort(dev, kind) { return (kind === 'sensor' ? 'S' : 'A') + txt(dev[kind + '_id']) + ' · ' + ctrlKey(dev.controller_uuid); }
function devTitle(dev, kind) {
  if (dev.description) return dev.description.length > 44 ? dev.description.slice(0, 42) + '…' : dev.description;
  return kind === 'sensor' ? sensorKindOf(dev) : actuatorKindOf(dev);
}
function stateTypeOf(state) {
  var m = IDX.mapping.get(txt(state.mapping_id));
  var t = m ? IDX.template.get(txt(m.schema_id)) : null;
  return t ? t.state_type : null;
}
function templateOfMapping(mappingId) {
  var m = IDX.mapping.get(txt(mappingId));
  return m ? (IDX.template.get(txt(m.schema_id)) || null) : null;
}
var TYPE_ICON = { heating: 'i-temp', pressure: 'i-gauge', cooling: 'i-snow', flow: 'i-wave', valve: 'i-valve', stirring: 'i-stir', inflow: 'i-inflow', pump: 'i-pump', reaction: 'i-react', receiving: 'i-inbox' };
var TYPE_LABEL = { heating: 'Heizen', pressure: 'Druck', cooling: 'Kühlen', flow: 'Durchfluss', valve: 'Ventil', stirring: 'Rühren', inflow: 'Zulauf', pump: 'Pumpe', reaction: 'Reaktion', receiving: 'Annahme' };
/** Parameter fields per state_type — typed inputs instead of a raw JSON textarea. */
var TYPE_PARAMS = {
  heating: [{ key: 'target_temp_c', label: 'Solltemperatur', unit: '°C' }],
  pressure: [{ key: 'target_pressure_bar', label: 'Solldruck', unit: 'bar' }, { key: 'hysteresis_bar', label: 'Hysterese', unit: 'bar' }],
  cooling: [{ key: 'target_temp_c', label: 'Solltemperatur', unit: '°C' }, { key: 'power', label: 'Leistung', unit: '0–1' }],
  flow: [{ key: 'flow_rate', label: 'Durchfluss', unit: 'l/min' }],
  valve: [{ key: 'setpoint', label: 'Sollstellung', unit: '%' }, { key: 'flow_rate', label: 'Durchfluss', unit: 'l/min' }],
  stirring: [{ key: 'rpm', label: 'Drehzahl', unit: 'rpm' }, { key: 'target_rpm', label: 'Solldrehzahl', unit: 'rpm' }],
  inflow: [{ key: 'target_temp_c', label: 'Solltemperatur', unit: '°C' }, { key: 'flow_rate', label: 'Durchfluss', unit: 'l/min' }],
  pump: [{ key: 'target_pressure_bar', label: 'Solldruck', unit: 'bar' }, { key: 'hysteresis_bar', label: 'Hysterese', unit: 'bar' }, { key: 'max_pressure', label: 'Max. Druck', unit: 'bar' }, { key: 'target_level', label: 'Sollfüllstand', unit: '%' }],
  reaction: [{ key: 'target_temp_c', label: 'Solltemperatur', unit: '°C' }, { key: 'rpm', label: 'Drehzahl', unit: 'rpm' }, { key: 'hold_duration_s', label: 'Haltezeit', unit: 's' }],
  receiving: []
};
var SETPOINT_KEYS = ['target_temp_c', 'target_temp', 'target_bar', 'target_pressure_bar', 'target', 'setpoint', 'value', 'power', 'rpm', 'flow_rate'];
var CRITICAL_GROUPS = ['emergency', 'hard_real_time', 'hard_realtime', 'interlock', 'real_time', 'realtime', 'safety', 'safety_critical', 'soft_realtime', 'time_critical'];
var RULE_OPS = ['>=', '>', '<=', '<', '==', '!='];
var FILTER_STEPS = { median: ['window'], moving_average: ['window'], lowpass: ['alpha'], highpass: ['alpha'], sampler: ['period_s'], scaler: [], scaler_sensor_profile: [], expr: [] };

/* ------------------------------------------------------------------ analysis: usage & scope */
var USE = {};
function touch(map, key) { if (!map.has(key)) map.set(key, { states: [], rules: [], filters: [] }); return map.get(key); }
function rebuildUsage() {
  USE = { sensor: new Map(), actuator: new Map(), state: new Map(), filter: new Map(), timer: new Map(), pid: new Map(), method: new Map(), mapping: new Map(), process: new Map() };
  arr(CFG.process_states).forEach(function (st) {
    var refs = isObj(st.io_refs) ? st.io_refs : {};
    arr(refs.sensors).forEach(function (r) { touch(USE.sensor, refKey(r, 'sensor_id')).states.push(st.state_id); if (r.filter_id !== undefined) touch(USE.filter, txt(r.filter_id)).states.push(st.state_id); });
    arr(refs.actuators).forEach(function (r) { touch(USE.actuator, refKey(r, 'actuator_id')).states.push(st.state_id); });
    if (isObj(st.control_strategy)) {
      if (st.control_strategy.pid_config_id !== undefined) touch(USE.pid, txt(st.control_strategy.pid_config_id)).states.push(st.state_id);
      if (st.control_strategy.method_id !== undefined) touch(USE.method, txt(st.control_strategy.method_id)).states.push(st.state_id);
    }
    touch(USE.mapping, txt(st.mapping_id)).states.push(st.state_id);
    touch(USE.process, txt(st.p_id)).states.push(st.state_id);
    touch(USE.state, txt(st.state_id));
  });
  arr(CFG.filters).forEach(function (f) { arr(f.sensor_refs).forEach(function (r) { touch(USE.sensor, refKey(r, 'sensor_id')).filters.push(f.filter_id); }); touch(USE.filter, txt(f.filter_id)); });
  arr(CFG.rules).forEach(function (rule) {
    ['when', 'until'].forEach(function (b) {
      arr(rule[b]).forEach(function (c) {
        if (c.src === 'sensor') { touch(USE.sensor, refKey(c, 'sensor_id')).rules.push(rule.rule_id); if (c.filter_id !== undefined) touch(USE.filter, txt(c.filter_id)).rules.push(rule.rule_id); }
        if (c.src === 'state') touch(USE.state, txt(c.state_id)).rules.push(rule.rule_id);
        if (c.src === 'timer') touch(USE.timer, txt(c.timer_id)).rules.push(rule.rule_id);
        if (isObj(c.value) && c.value.param_of_state !== undefined) touch(USE.state, txt(c.value.param_of_state)).rules.push(rule.rule_id);
      });
    });
    ['do', 'else_do'].forEach(function (b) {
      arr(rule[b]).forEach(function (a) { arr(a.state_ids).forEach(function (id) { touch(USE.state, txt(id)).rules.push(rule.rule_id); }); });
    });
  });
  Object.keys(USE).forEach(function (k) { USE[k].forEach(function (v) { v.states = uniq(v.states); v.rules = uniq(v.rules); v.filters = uniq(v.filters); }); });
}
function use(kind, key) { return (USE[kind] && USE[kind].get(txt(key))) || { states: [], rules: [], filters: [] }; }

/** Scope classification on the controller graph — mirrors v9_shard.classifyScopes. */
var scopeOfUuids = function (uuids) {
  var list = uniq(arr(uuids).filter(Boolean));
  if (!list.length) return 'unbound';
  var nodes = uniq(list.map(nodeOfCtrl));
  if (nodes.indexOf('?') >= 0) return 'invalid';
  if (nodes.length > 1) return 'cross_worker';
  return list.length > 1 ? 'cross_controller' : 'local_controller';
};
function stateUuids(st) {
  var refs = isObj(st.io_refs) ? st.io_refs : {};
  return arr(refs.sensors).map(function (r) { return r.controller_uuid; }).concat(arr(refs.actuators).map(function (r) { return r.controller_uuid; }));
}
function stateScope(st) { return scopeOfUuids(stateUuids(st)); }
function ruleUuids(rule) {
  var out = [];
  ['when', 'until'].forEach(function (b) { arr(rule[b]).forEach(function (c) { if (c.src === 'sensor') out.push(c.controller_uuid); if (c.src === 'state' || (isObj(c.value) && c.value.param_of_state !== undefined)) { var st = IDX.state.get(txt(c.state_id !== undefined ? c.state_id : c.value.param_of_state)); if (st) out = out.concat(stateUuids(st)); } }); });
  ['do', 'else_do'].forEach(function (b) { arr(rule[b]).forEach(function (a) { arr(a.state_ids).forEach(function (id) { var st = IDX.state.get(txt(id)); if (st) out = out.concat(stateUuids(st)); }); }); });
  return out;
}
function ruleScope(rule) { return scopeOfUuids(ruleUuids(rule)); }
var SCOPE_TONE = { local_controller: 'ok', cross_controller: 'warn', cross_worker: 'cross', unbound: null, invalid: 'danger' };
var SCOPE_LABEL = { local_controller: 'lokal', cross_controller: 'cross-controller', cross_worker: 'cross-worker', unbound: 'ungebunden', invalid: 'ungültig' };
function scopeBadge(scope) { return badge(SCOPE_LABEL[scope] || scope, SCOPE_TONE[scope]); }

/** Strategy recommendation from the I/O signature of a draft state. */
function recommendStrategy(draft) {
  var refs = isObj(draft.io_refs) ? draft.io_refs : { sensors: [], actuators: [] };
  var acts = arr(refs.actuators).map(function (r) { return IDX.actuator.get(refKey(r, 'actuator_id')); }).filter(Boolean);
  var sens = arr(refs.sensors).map(function (r) { return IDX.sensor.get(refKey(r, 'sensor_id')); }).filter(Boolean);
  var type = stateTypeOf(draft) || '';
  var params = isObj(draft.parameters) ? draft.parameters : {};
  var hasHyst = Object.keys(params).some(function (k) { return k.indexOf('hysteresis') === 0; });
  if (!acts.length) return { kind: 'none', title: 'Beobachten (kein Aktor)', text: 'Ohne Aktor regelt der State nichts — er dient als Zustand/Freigabe für Regeln. control_strategy bleibt null.' };
  var coil = acts.some(function (a) { return a.function_type === 'write_coil'; });
  var reg = acts.some(function (a) { return a.function_type === 'write_register'; });
  if (coil && !reg) return { kind: 'twopoint', title: 'Zweipunkt (control_strategy = null)', text: 'Schaltaktor (write_coil): die Runtime wählt automatisch den Zweipunktregler' + (hasHyst ? '.' : ' — setze eine Hysterese (z. B. hysteresis_bar), sonst schaltet er am Sollwert flatternd.') , needHysteresis: !hasHyst };
  if (reg && !sens.length) return { kind: 'method', title: 'Control-Method (Sollwertverlauf)', text: 'Stellaktor ohne Messwert: eine Rampe oder ein Profil aus control_methods fährt den Aktor zeitgesteuert.' , method_id: 1 };
  if (reg) {
    var pid = type === 'heating' ? 1 : (type === 'stirring' ? 2 : 3);
    return { kind: 'pid', title: 'PID #' + pid + ' (' + (type === 'heating' ? 'träge Strecke' : type === 'stirring' ? 'mittlere Dynamik' : 'schnelle Strecke') + ')', text: 'Stellaktor (write_register) + Messwert: geschlossener Regelkreis. ' + (sens.some(function (s) { return use('sensor', refKey(s, 'sensor_id')).filters.length; }) ? 'Der Sensor ist gefiltert — gut für ein stabiles D-Glied.' : 'Tipp: lege einen Median/Lowpass-Filter auf den Sensor, damit das D-Glied nicht auf Rauschen reagiert.'), pid_config_id: pid };
  }
  return { kind: 'none', title: 'Keine Empfehlung', text: '' };
}

/* ------------------------------------------------------------------ recommendations (cockpit) */
function recommendations() {
  var out = [];
  arr(CFG.sensors).forEach(function (s) {
    var u = use('sensor', refKey(s, 'sensor_id'));
    if (!u.states.length && !u.rules.length) out.push({ tone: 'warn', kind: 'device', key: refKey(s, 'sensor_id'), title: 'Sensor ' + devShort(s, 'sensor') + ' ist nicht konfiguriert', text: (s.description || sensorKindOf(s)) + ' auf ' + nodeOfCtrl(s.controller_uuid) + ' wird von keinem State und keiner Regel gelesen.', action: { label: 'State anlegen', view: 'states', prefill: { sensor: s } }, action2: { label: 'Regel anlegen', view: 'rules', prefill: { sensor: s } } });
    if (s.profile_id === undefined) out.push({ tone: 'danger', kind: 'device', key: refKey(s, 'sensor_id'), title: 'Sensor ' + devShort(s, 'sensor') + ' ohne Skalierungsprofil', text: 'Ohne profile_id wirkt scaler_sensor_profile nicht; Schwellwerte in Regeln beziehen sich auf Rohwerte (0–65535).', action: { label: 'In Topologie öffnen', view: null } });
  });
  arr(CFG.actuators).forEach(function (a) {
    var u = use('actuator', refKey(a, 'actuator_id'));
    if (!u.states.length) out.push({ tone: 'warn', kind: 'device', key: refKey(a, 'actuator_id'), title: 'Aktor ' + devShort(a, 'actuator') + ' ist nicht konfiguriert', text: (a.description || actuatorKindOf(a)) + ' auf ' + nodeOfCtrl(a.controller_uuid) + ' wird von keinem State angesteuert.', action: { label: 'State anlegen', view: 'states', prefill: { actuator: a } } });
  });
  arr(CFG.process_states).forEach(function (st) {
    var u = use('state', st.state_id);
    if (!u.rules.length) out.push({ tone: 'info', kind: 'state', key: st.state_id, title: 'State #' + st.state_id + ' wird von keiner Regel geschaltet', text: 'Ohne Regel bleibt value_id dauerhaft auf ' + txt(st.value_id) + ' (' + valueName(st.value_id) + ') — nur manuell schaltbar.', action: { label: 'Regel anlegen', view: 'rules', prefill: { state: st } } });
    var engine = arr(CFG.rule_engine)[0] || {};
    if (u.rules.length && num(st.mode_id) !== num(engine.required_mode_id)) out.push({ tone: 'danger', kind: 'state', key: st.state_id, title: 'State #' + st.state_id + ': Regeln greifen nicht (mode_id ' + st.mode_id + ')', text: 'Die Engine schreibt nur bei mode_id == required_mode_id (' + engine.required_mode_id + ' · ' + modeName(engine.required_mode_id) + '). Regel ' + u.rules.join(', ') + ' endet mit skipped_mode.', action: { label: 'State öffnen', view: 'states', select: st.state_id } });
    var reco = recommendStrategy(st);
    if (reco.kind === 'twopoint' && reco.needHysteresis) out.push({ tone: 'warn', kind: 'state', key: st.state_id, title: 'State #' + st.state_id + ': Zweipunkt ohne Hysterese', text: 'Schaltaktor ohne hysteresis-Parameter flattert am Sollwert.', action: { label: 'State öffnen', view: 'states', select: st.state_id } });
    if (isObj(st.control_strategy) && st.control_strategy.type === 'PID') {
      var refs = isObj(st.io_refs) ? st.io_refs : {};
      var unfiltered = arr(refs.sensors).filter(function (r) { return r.filter_id === undefined && !use('sensor', refKey(r, 'sensor_id')).filters.length; });
      if (unfiltered.length) out.push({ tone: 'info', kind: 'state', key: st.state_id, title: 'State #' + st.state_id + ': PID auf ungefiltertem Sensor', text: 'S' + unfiltered[0].sensor_id + ' · ' + ctrlKey(unfiltered[0].controller_uuid) + ' hat keinen Filter. Median + Lowpass glätten das D-Glied.', action: { label: 'Filter anlegen', view: 'signals', prefill: { sensor: IDX.sensor.get(refKey(unfiltered[0], 'sensor_id')) } } });
    }
  });
  arr(CFG.timers).forEach(function (t) { if (!use('timer', t.timer_id).rules.length) out.push({ tone: 'info', kind: 'timer', key: t.timer_id, title: 'Timer #' + t.timer_id + ' ist ungenutzt', text: txt(t.description) + ' — keine Regel wertet ihn aus (op elapsed/fired).', action: { label: 'Regel anlegen', view: 'rules', prefill: { timer: t } } }); });
  arr(CFG.filters).forEach(function (f) { var u = use('filter', f.filter_id); if (!u.rules.length && !u.states.length) out.push({ tone: 'info', kind: 'filter', key: f.filter_id, title: 'Filter #' + f.filter_id + ' ist ungenutzt', text: 'Kein when[] und kein io_ref referenziert filter_id ' + f.filter_id + '.', action: { label: 'Filter öffnen', view: 'signals', select: 'f' + f.filter_id } }); });
  arr(CFG.rules).forEach(function (r) {
    var sc = ruleScope(r);
    var engine = arr(CFG.rule_engine)[0] || {};
    var minPrio = (isObj(engine.runtime) ? engine.runtime.coordinator_min_priority : 1000) || 1000;
    if (sc === 'cross_worker' && num(r.priority) < minPrio) out.push({ tone: 'warn', kind: 'rule', key: r.rule_id, title: 'Regel #' + r.rule_id + ' ist cross-worker, aber priority < ' + minPrio, text: 'Zwei Nodes beteiligt — der Site-Coordinator übernimmt erst ab coordinator_min_priority (cross_worker_exec: site_coordinator_optional).', action: { label: 'Regel öffnen', view: 'rules', select: r.rule_id } });
    if (CRITICAL_GROUPS.indexOf(txt(r.group)) >= 0 && sc !== 'local_controller') out.push({ tone: 'danger', kind: 'rule', key: r.rule_id, title: 'Regel #' + r.rule_id + ': kritische Gruppe darf nicht cross laufen', text: 'Gruppe ' + r.group + ' ist CRITICAL_GROUP, Scope ist ' + sc + '.', action: { label: 'Regel öffnen', view: 'rules', select: r.rule_id } });
  });
  var order = { danger: 0, warn: 1, info: 2 };
  out.sort(function (a, b) { return order[a.tone] - order[b.tone]; });
  return out;
}
function valueName(id) { var v = IDX.value.get(txt(id)); return v ? v.state_value : '?'; }
function modeName(id) { var m = IDX.mode.get(txt(id)); return m ? m.mode : '?'; }

/* ------------------------------------------------------------------ session */
var S = {
  view: 'cockpit',
  sel: { states: null, rules: null, signals: null, library: null },
  editor: null,          // { kind, draft, isNew, step }
  changed: {},           // "states:1" -> true (visual change markers)
  history: [],
  invText: '',
  invChip: 'all',
  libTab: 'types',
  mapFocus: null,
  cockpitFilter: 'all'
};
function changedKey(kind, id) { return kind + ':' + txt(id); }
function markChanged(kind, id) { S.changed[changedKey(kind, id)] = true; refreshChrome(); }
function isChanged(kind, id) { return !!S.changed[changedKey(kind, id)]; }
/* History, commit and undo are service hooks: the stand-alone prototype keeps an
   in-memory snapshot list; the integration build rebinds them to v9_store.js. */
var pushHistory = function (label) { S.history.push({ label: label, snap: clone(CFG) }); if (S.history.length > 40) S.history.shift(); };
var undo = function () {
  var last = S.history.pop();
  if (!last) { toast('Nichts rückgängig zu machen.', 'warn'); return; }
  CFG = last.snap; commitModel(); toast('Rückgängig: ' + last.label, 'ok'); render();
};
var commitModel = function () { rebuildIndex(); rebuildUsage(); };
var isDirty = function () { return Object.keys(S.changed).length > 0; };
function refreshChrome() {
  var n = Object.keys(S.changed).length;
  var recos = recommendations();
  var d = recos.filter(function (r) { return r.tone === 'danger'; }).length;
  var w = recos.length - d;
  var status = asEl('status');
  if (status) mount(status, [badge(n + ' Änderung' + (n === 1 ? '' : 'en'), n ? 'accent' : null), badge(d + ' kritisch', d ? 'danger' : 'ok'), badge(w + ' Hinweise', w ? 'warn' : null), isDirty() ? badge('ungespeichert', 'accent') : badge('Bereit', 'ok')]);
}

/* ------------------------------------------------------------------ views: shell */
var VIEWS = [
  { id: 'cockpit', label: 'Übersicht', icon: 'i-chart' },
  { id: 'states', label: 'Prozesse & States', icon: 'i-layers', count: function () { return CFG.process_states.length; } },
  { id: 'rules', label: 'Regeln', icon: 'i-rule', count: function () { return CFG.rules.length; } },
  { id: 'signals', label: 'Filter & Timer', icon: 'i-filter', count: function () { return CFG.filters.length + CFG.timers.length; } },
  { id: 'library', label: 'Bibliothek', icon: 'i-copy' },
  { id: 'engine', label: 'Engine', icon: 'i-cpu' },
  { id: 'map', label: 'Geräte-Karte', icon: 'i-map' }
];
var VIEW_META = {
  cockpit: ['Automation Studio', 'Inventar aller V9-Tabellen, Geräteabdeckung und Empfehlungen — der Einstieg in jede Änderung.'],
  states: ['Prozesse & States', 'Ein State = Prozess + Typ + I/O + Strategie. Gerätewahl mit Kontext, Parameter als typisierte Felder, Strategie mit Empfehlung.'],
  rules: ['Regeln', 'WENN · BIS · DANN · SONST als Satzbaukasten. Scope, Owner und Lifecycle werden aus den beteiligten Geräten abgeleitet.'],
  signals: ['Filter & Timer', 'Filterketten als Stufen-Bausteine, Timer nach Art. Beide zeigen, wer sie nutzt.'],
  library: ['Bibliothek', 'Typen, Mappings, PID-Configs, Control-Methods, Modi und Werte — jede Katalogtabelle editierbar, mit Nutzungsnachweis.'],
  engine: ['Rule-Engine', 'Der Singleton als Formular: Gate, Schreibrechte, Runtime, Safety und Debug — ohne JSON-Textfelder.'],
  map: ['Geräte-Karte', 'Node → Controller → Sensor/Aktor und ihre States und Regeln. Gestrichelt = noch nicht konfiguriert, Punkt = in dieser Sitzung geändert.']
};
function setView(id, opts) {
  var o = opts || {};
  S.view = id; S.invText = ''; S.invChip = 'all';
  if (o.select !== undefined) S.sel[id] = o.select;
  if (o.editor) S.editor = o.editor; else if (!o.keepEditor) S.editor = null;
  render();
}
function render() {
  renderSubnav();
  var meta = VIEW_META[S.view];
  var title = asEl('title') || document.getElementById('global-workspace-title');
  var sub = asEl('sub') || document.getElementById('global-workspace-subtitle');
  if (title) title.textContent = meta[0];
  if (sub) sub.textContent = meta[1];
  var fn = { cockpit: renderCockpit, states: renderStatesView, rules: renderRulesView, signals: renderSignalsView, library: renderLibraryView, engine: renderEngineView, map: renderMapView }[S.view];
  fn();
  refreshChrome();
}
function renderSubnav() {
  var nav = asEl('subnav');
  if (!nav) return;
  mount(nav, VIEWS.map(function (v) {
    var b = h('button' + (S.view === v.id ? '.active' : ''), { type: 'button', onClick: function () { setView(v.id); } }, h('span', { text: v.label }));
    if (v.count) b.appendChild(h('span.cnt', { text: String(v.count()) }));
    return b;
  }));
}
function panes(inv, editor, ctx) {
  mount(asEl('inv'), inv);
  mount(asEl('editor'), editor);
  mount(asEl('ctx'), ctx);
}
function invHead(title, chips, footer) {
  var search = h('div.search', null, icon('i-search', 'ico--sm'), h('input', { placeholder: 'Suchen …', value: S.invText, onInput: function (e) { S.invText = e.target.value.toLowerCase(); render(); } }), h('kbd', { text: 'Ctrl K' }));
  var chipRow = chips ? h('div.inv-filters', null, chips.map(function (c) { return h('button.chip' + (S.invChip === c.id ? '.active' : ''), { type: 'button', text: c.label, onClick: function () { S.invChip = c.id; render(); } }); })) : null;
  return h('div.inv-head', null, h('h3', { text: title }), search, chipRow);
}
function invGroup(label, meta) { return h('div.inv-group', null, h('span', { text: label }), h('span.ln'), meta ? h('span', { text: meta }) : null); }
function invItem(opts) {
  return h('button.inv-item' + (opts.active ? '.active' : ''), { type: 'button', onClick: opts.onClick },
    h('span.st' + (opts.changed ? '.st--changed' : opts.tone ? '.st--' + opts.tone : '')),
    h('span', null, h('div.t', { text: opts.title }), h('div.d', { text: opts.sub })),
    h('span.m', { text: opts.meta || '' }));
}
function matchInv(text) { return !S.invText || text.toLowerCase().indexOf(S.invText) >= 0; }
function ctxSec(title, body, right) { return h('div.ctx-sec', null, h('h4', null, h('span', { text: title }), right || null), body); }
function recoCard(r) {
  var ic = r.tone === 'danger' ? 'i-warn' : r.tone === 'ok' ? 'i-check' : r.tone === 'accent' ? 'i-sparkle' : 'i-info';
  var acts = [];
  [r.action, r.action2].forEach(function (a) {
    if (!a || !a.view) return;
    acts.push(h('button.link', { type: 'button', text: a.label + ' →', onClick: function () { runAction(a); } }));
  });
  return h('div.reco.reco--' + (r.tone === 'info' ? 'accent' : r.tone), null, icon(ic), h('div', null, h('div.t', { text: r.title }), h('div.d', { text: r.text }), acts.length ? h('div.a', null, acts) : null));
}
function runAction(a) {
  if (a.view === 'states') { if (a.select !== undefined) setView('states', { select: a.select, editor: stateEditorFor(IDX.state.get(txt(a.select))) }); else setView('states', { editor: newStateEditor(a.prefill) }); }
  else if (a.view === 'rules') { if (a.select !== undefined) setView('rules', { select: a.select, editor: ruleEditorFor(IDX.rule.get(txt(a.select))) }); else setView('rules', { editor: newRuleEditor(a.prefill) }); }
  else if (a.view === 'signals') { if (a.select !== undefined) setView('signals', { select: a.select, editor: signalEditorFor(a.select) }); else setView('signals', { editor: newFilterEditor(a.prefill) }); }
  else if (a.view === 'map') { S.mapFocus = a.focus || null; setView('map'); }
  else if (a.view === 'library') { S.libTab = a.tab || S.libTab; setView('library'); }
  else if (a.view === 'engine') setView('engine');
}

/* ------------------------------------------------------------------ cockpit */
var TABLES = [
  { key: 'processes', label: 'Prozesse', view: 'states', crud: 'CRUD', old: 'C·D' },
  { key: 'process_states', label: 'States', view: 'states', crud: 'CRUD', old: 'CRUD (JSON)' },
  { key: 'rules', label: 'Regeln', view: 'rules', crud: 'CRUD', old: 'CRUD (2 Editoren)' },
  { key: 'filters', label: 'Filter', view: 'signals', crud: 'CRUD', old: 'C·D (JSON)' },
  { key: 'timers', label: 'Timer', view: 'signals', crud: 'CRUD', old: 'C·D' },
  { key: 'rule_engine', label: 'Rule-Engine', view: 'engine', crud: 'U', old: 'U (JSON)' },
  { key: 'parameter_generic_templates', label: 'State-Typen', view: 'library', tab: 'types', crud: 'CRUD', old: 'C·D' },
  { key: 'schema_mappings', label: 'Schema-Mappings', view: 'library', tab: 'types', crud: 'CRUD', old: 'C·D' },
  { key: 'pid_configs', label: 'PID-Configs', view: 'library', tab: 'pid', crud: 'CRUD', old: '—' },
  { key: 'control_method_templates', label: 'Method-Templates', view: 'library', tab: 'methods', crud: 'R', old: '—' },
  { key: 'control_methods', label: 'Control-Methods', view: 'library', tab: 'methods', crud: 'CRUD', old: '—' },
  { key: 'process_modes', label: 'Betriebsarten', view: 'library', tab: 'modes', crud: 'CRUD', old: '—' },
  { key: 'process_values', label: 'Zustandswerte', view: 'library', tab: 'modes', crud: 'CRUD', old: '—' }
];
function renderCockpit() {
  var recos = recommendations();
  var sensUsed = CFG.sensors.filter(function (s) { var u = use('sensor', refKey(s, 'sensor_id')); return u.states.length || u.rules.length; }).length;
  var actUsed = CFG.actuators.filter(function (a) { return use('actuator', refKey(a, 'actuator_id')).states.length; }).length;
  var statesRuled = CFG.process_states.filter(function (s) { return use('state', s.state_id).rules.length; }).length;
  var timersUsed = CFG.timers.filter(function (t) { return use('timer', t.timer_id).rules.length; }).length;

  var inv = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '100%' } },
    h('div.inv-head', null, h('h3', { text: 'Tabellen-Inventar' }), h('div.hint', { text: '13 Automations-Tabellen des V9-Vertrags — jede mit Editor, Zähler und Nutzungsnachweis.' })),
    h('div.inv-list', null, TABLES.map(function (t) {
      var n = arr(CFG[t.key]).length;
      return invItem({ title: t.label, sub: t.key, meta: String(n), tone: n ? null : 'muted', onClick: function () { runAction({ view: t.view, tab: t.tab }); } });
    })),
    h('div.inv-foot', null, btn('Konfiguration prüfen', { icon: 'i-shield', block: true, onClick: function () { toast(recos.length + ' Hinweise, ' + recos.filter(function (r) { return r.tone === 'danger'; }).length + ' davon kritisch.', 'ok'); } })));

  function kpi(label, v, total, sub) {
    return h('div.kpi', null, h('div.l', { text: label }), h('div.v', null, String(v), h('small', { text: '/ ' + total })), h('div.bar', null, h('i', { style: { width: Math.round(100 * v / Math.max(1, total)) + '%' } })), h('div.s', { text: sub }));
  }
  var chips = [['all', 'Alle'], ['danger', 'Kritisch'], ['warn', 'Warnung'], ['info', 'Hinweis']];
  var filtered = recos.filter(function (r) { return S.cockpitFilter === 'all' || r.tone === S.cockpitFilter; });
  var editor = h('div', null,
    h('div.kpis', null,
      kpi('Sensoren konfiguriert', sensUsed, CFG.sensors.length, (CFG.sensors.length - sensUsed) + ' ohne State/Regel'),
      kpi('Aktoren konfiguriert', actUsed, CFG.actuators.length, (CFG.actuators.length - actUsed) + ' ohne State'),
      kpi('States mit Regel', statesRuled, CFG.process_states.length, (CFG.process_states.length - statesRuled) + ' nur manuell schaltbar'),
      kpi('Timer genutzt', timersUsed, CFG.timers.length, (CFG.timers.length - timersUsed) + ' ungenutzt')),
    h('div.twocol', null,
      h('div.card', null,
        h('div.card__head', null, h('h3', null, icon('i-sparkle', 'ico--sm'), 'Empfehlungen & Lücken', badge(String(recos.length), 'accent')),
          h('div.seg', null, chips.map(function (c) { return h('button' + (S.cockpitFilter === c[0] ? '.active' : ''), { type: 'button', text: c[1], onClick: function () { S.cockpitFilter = c[0]; render(); } }); }))),
        h('div.card__body', null, filtered.length ? filtered.map(recoCard) : h('div.note.note--ok', { text: 'Keine Hinweise in dieser Kategorie.' }))),
      h('div', null,
        h('div.card', null,
          h('div.card__head', null, h('h3', null, icon('i-cpu', 'ico--sm'), 'Geräteabdeckung je Controller')),
          h('div.card__body.card__body--flush', null, coverageTable())),
        h('div.card', null,
          h('div.card__head', null, h('h3', null, icon('i-layers', 'ico--sm'), 'Prozesse')),
          h('div.card__body.card__body--flush', null, processTable())))));

  var ctx = h('div', null,
    ctxSec('Schnellstart', h('div', { style: { display: 'grid', gap: '6px' } },
      btn('Neuer State aus Vorlage', { icon: 'i-plus', variant: 'primary', block: true, onClick: function () { setView('states', { editor: newStateEditor({}) }); } }),
      btn('Neue Regel (Satzbaukasten)', { icon: 'i-rule', block: true, onClick: function () { setView('rules', { editor: newRuleEditor({}) }); } }),
      btn('Nicht konfigurierte Geräte zeigen', { icon: 'i-map', block: true, onClick: function () { S.mapFocus = 'unused'; setView('map'); } }))),
    ctxSec('Sitzungsänderungen', changeLog()),
    ctxSec('Legende', h('div', { style: { display: 'grid', gap: '6px', fontSize: '11px' } },
      h('div.row', null, h('span.st', { class: 'st', style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' } }), 'konfiguriert / lokal'),
      h('div.row', null, h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--warn)', display: 'inline-block' } }), 'Lücke oder cross-controller'),
      h('div.row', null, h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--danger)', display: 'inline-block' } }), 'Vertragsverstoß'),
      h('div.row', null, h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-bg)', display: 'inline-block' } }), 'in dieser Sitzung geändert'))));
  panes(inv, editor, ctx);
}
function changeLog() {
  var keys = Object.keys(S.changed);
  if (!keys.length) return h('div.hint', { text: 'Noch keine Änderungen. Jede angelegte oder geänderte Entität erscheint hier und in der Geräte-Karte als Punkt.' });
  return h('div.impact', null, keys.map(function (k) { var p = k.split(':'); return h('div.i', null, h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' } }), h('span', { text: ({ states: 'State', rules: 'Regel', filters: 'Filter', timers: 'Timer', processes: 'Prozess', pid: 'PID', methods: 'Method', types: 'Typ', modes: 'Modus', values: 'Wert', engine: 'Engine' }[p[0]] || p[0]) + ' ' + p[1] })); }));
}
function coverageTable() {
  var rows = CFG.controllers.map(function (c) {
    var sens = CFG.sensors.filter(function (s) { return s.controller_uuid === c.controller_uuid; });
    var acts = CFG.actuators.filter(function (a) { return a.controller_uuid === c.controller_uuid; });
    var su = sens.filter(function (s) { var u = use('sensor', refKey(s, 'sensor_id')); return u.states.length || u.rules.length; }).length;
    var au = acts.filter(function (a) { return use('actuator', refKey(a, 'actuator_id')).states.length; }).length;
    var gap = (sens.length - su) + (acts.length - au);
    return h('tr', null, h('td', null, h('b', { text: c.controller_key }), h('div.hint', { text: c.device_name + ' · ' + c.host })), h('td.mono', { text: c.node_id }),
      h('td.r', { text: su + '/' + sens.length }), h('td.r', { text: au + '/' + acts.length }),
      h('td', null, gap ? badge(gap + ' offen', 'warn') : badge('vollständig', 'ok')),
      h('td', null, h('button.link', { type: 'button', text: 'Karte', onClick: function () { S.mapFocus = 'ctrl:' + c.controller_uuid; setView('map'); } })));
  });
  return h('div.tblwrap', null, h('table.tbl', null, h('thead', null, h('tr', null, h('th', { text: 'Controller' }), h('th', { text: 'Node' }), h('th.r', { text: 'Sensoren' }), h('th.r', { text: 'Aktoren' }), h('th', { text: 'Status' }), h('th'))), h('tbody', null, rows)));
}
function processTable() {
  var rows = CFG.processes.map(function (p) {
    var st = use('process', p.p_id).states;
    var ruled = st.filter(function (id) { return use('state', id).rules.length; }).length;
    return h('tr', null, h('td', null, h('b', { text: p.process_name }), h('div.hint', { text: p.process_location || '—' })), h('td.mono', { text: p.owner_node_id }), h('td.r', { text: String(st.length) }), h('td.r', { text: ruled + '/' + st.length }),
      h('td', null, h('button.link.link--accent', { type: 'button', text: 'Öffnen', onClick: function () { S.invChip = 'p' + p.p_id; setView('states'); S.invChip = 'p' + p.p_id; render(); } })));
  });
  return h('div.tblwrap', null, h('table.tbl', null, h('thead', null, h('tr', null, h('th', { text: 'Prozess' }), h('th', { text: 'Owner' }), h('th.r', { text: 'States' }), h('th.r', { text: 'mit Regel' }), h('th'))), h('tbody', null, rows)));
}

/* ------------------------------------------------------------------ states view */
function stateTitle(st) {
  var t = stateTypeOf(st);
  return 'State #' + st.state_id + ' · ' + (TYPE_LABEL[t] || t || '?');
}
function stateSub(st) {
  var refs = isObj(st.io_refs) ? st.io_refs : {};
  var p = IDX.process.get(txt(st.p_id));
  return (p ? p.process_name : 'p' + st.p_id) + ' · S' + arr(refs.sensors).map(function (r) { return r.sensor_id; }).join(',') + ' A' + arr(refs.actuators).map(function (r) { return r.actuator_id; }).join(',');
}
function stateTone(st) {
  var engine = arr(CFG.rule_engine)[0] || {};
  var u = use('state', st.state_id);
  if (u.rules.length && num(st.mode_id) !== num(engine.required_mode_id)) return 'danger';
  var sc = stateScope(st);
  if (sc === 'cross_controller' || sc === 'cross_worker') return 'warn';
  if (!u.rules.length) return 'muted';
  return null;
}
function renderStatesView() {
  var chips = [{ id: 'all', label: 'Alle' }].concat(CFG.processes.map(function (p) { return { id: 'p' + p.p_id, label: p.process_name.replace(/_/g, ' ') }; }));
  var groups = [];
  CFG.processes.forEach(function (p) {
    if (S.invChip !== 'all' && S.invChip !== 'p' + p.p_id) return;
    var states = CFG.process_states.filter(function (s) { return num(s.p_id) === num(p.p_id) && matchInv(stateTitle(s) + ' ' + stateSub(s) + ' ' + txt(s.description)); });
    if (!states.length && S.invText) return;
    groups.push(invGroup(p.process_name.replace(/_/g, ' '), p.owner_node_id));
    states.forEach(function (st) {
      groups.push(invItem({ title: stateTitle(st), sub: stateSub(st), meta: valueName(st.value_id) === 'activated' ? 'aktiv' : '', tone: stateTone(st), changed: isChanged('states', st.state_id), active: S.sel.states === st.state_id, onClick: function () { S.sel.states = st.state_id; S.editor = stateEditorFor(st); render(); } }));
    });
    if (!states.length) groups.push(h('div.hint', { style: { padding: '4px 10px' }, text: 'Keine States — Prozess ist leer.' }));
  });
  var inv = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '100%' } }, invHead('States', chips),
    h('div.inv-list', null, groups),
    h('div.inv-foot', null, btn('Neuer State', { icon: 'i-plus', variant: 'primary', block: true, onClick: function () { S.editor = newStateEditor({}); S.sel.states = null; render(); } }),
      btn('Neuer Prozess', { icon: 'i-plus', block: true, onClick: function () { S.editor = { kind: 'process', isNew: true, draft: { p_id: maxId(CFG.processes, 'p_id') + 1, process_name: '', process_location: '', owner_node_id: CFG.nodes[0].node_id } }; render(); } })));

  if (S.editor && S.editor.kind === 'state') { panes(inv, renderStateEditor(), renderStateContext()); return; }
  if (S.editor && S.editor.kind === 'process') { panes(inv, renderProcessEditor(), h('div', null, ctxSec('Hinweis', h('div.hint', { text: 'owner_node_id ist Pflicht für Execution-Entities. States eines Prozesses dürfen trotzdem Geräte anderer Nodes nutzen — dann werden sie cross-worker.' })))); return; }
  panes(inv, renderStatesOverview(), h('div', null, ctxSec('Wie geht es los?', h('div', { style: { display: 'grid', gap: '8px' } }, h('div.hint', { text: 'Links einen State wählen — er öffnet sich direkt im Editor. Oder „Neuer State“: der Editor startet mit Typ-Vorlagen und schlägt freie Geräte vor.' }), btn('Neuer State', { icon: 'i-plus', variant: 'primary', block: true, onClick: function () { S.editor = newStateEditor({}); render(); } }))), ctxSec('Sitzungsänderungen', changeLog())));
}
function renderStatesOverview() {
  var rows = CFG.process_states.map(function (st) {
    var refs = isObj(st.io_refs) ? st.io_refs : {};
    var u = use('state', st.state_id);
    var strat = isObj(st.control_strategy) ? (st.control_strategy.type === 'PID' ? 'PID #' + st.control_strategy.pid_config_id : 'method #' + st.control_strategy.method_id) : (recommendStrategy(st).kind === 'twopoint' ? 'Zweipunkt (auto)' : recommendStrategy(st).kind === 'none' ? '—' : 'P (auto)');
    var p = IDX.process.get(txt(st.p_id));
    return h('tr', null,
      h('td', null, h('b', { text: '#' + st.state_id }), h('div.hint', { text: p ? p.process_name : '?' })),
      h('td', null, h('span.row', null, icon(TYPE_ICON[stateTypeOf(st)] || 'i-layers', 'ico--sm'), TYPE_LABEL[stateTypeOf(st)] || stateTypeOf(st) || '?')),
      h('td', null, h('div.chips', null, arr(refs.sensors).map(function (r) { return badge('S' + r.sensor_id + ' ' + ctrlKey(r.controller_uuid), 'info', true); }), arr(refs.actuators).map(function (r) { return badge('A' + r.actuator_id + ' ' + ctrlKey(r.controller_uuid), 'accent', true); }))),
      h('td', { text: strat }),
      h('td', null, badge(valueName(st.value_id), num(st.value_id) === 1 ? 'ok' : null), ' ', badge(modeName(st.mode_id), stateTone(st) === 'danger' ? 'danger' : null)),
      h('td', null, scopeBadge(stateScope(st))),
      h('td', null, u.rules.length ? badge('Regel ' + u.rules.join(', '), 'info') : badge('keine Regel', 'warn')),
      h('td', null, h('div.acts-cell', null, h('button.link.link--accent', { type: 'button', text: 'Bearbeiten', onClick: function () { S.sel.states = st.state_id; S.editor = stateEditorFor(st); render(); } }), h('button.link.link--danger', { type: 'button', text: 'Löschen', onClick: function () { deleteState(st.state_id); } }))));
  });
  return h('div.card', null, h('div.card__head', null, h('h3', null, icon('i-layers', 'ico--sm'), 'Alle Prozess-States', badge(String(CFG.process_states.length), 'accent')), h('div.acts', null, pill('io_refs = controller_uuid + lokale I/O-ID', 'info'))),
    h('div.card__body.card__body--flush', null, h('div.tblwrap', null, h('table.tbl', null, h('thead', null, h('tr', null, h('th', { text: 'State' }), h('th', { text: 'Typ' }), h('th', { text: 'I/O' }), h('th', { text: 'Strategie' }), h('th', { text: 'Wert · Modus' }), h('th', { text: 'Scope' }), h('th', { text: 'Geschaltet von' }), h('th'))), h('tbody', null, rows)))));
}
function newStateEditor(prefill) {
  var p = prefill || {};
  var firstProc = CFG.processes[0];
  var draft = { state_id: maxId(CFG.process_states, 'state_id') + 1, p_id: firstProc ? firstProc.p_id : 1, value_id: 2, mode_id: 2, mapping_id: null, io_refs: { sensors: [], actuators: [] }, control_strategy: null, setpoint_source: null, parameters: {}, description: '' };
  if (p.sensor) { draft.io_refs.sensors.push({ sensor_id: p.sensor.sensor_id, controller_uuid: p.sensor.controller_uuid }); draft.p_id = processForNode(p.sensor.node_id); }
  if (p.actuator) { draft.io_refs.actuators.push({ actuator_id: p.actuator.actuator_id, controller_uuid: p.actuator.controller_uuid }); draft.p_id = processForNode(p.actuator.node_id); }
  if (p.template) applyStateTemplate(draft, p.template);
  return { kind: 'state', isNew: true, draft: draft, step: 1 };
}
function processForNode(nodeId) { var p = CFG.processes.filter(function (x) { return x.owner_node_id === nodeId; })[0]; return p ? p.p_id : (CFG.processes[0] ? CFG.processes[0].p_id : 1); }
function stateEditorFor(st) { return { kind: 'state', isNew: false, draft: clone(st), original: st.state_id, step: 1 }; }
function applyStateTemplate(draft, tpl) {
  draft.mapping_id = tpl.mapping_id;
  draft.parameters = clone(tpl.parameters || {});
  draft.control_strategy = clone(tpl.control_strategy === undefined ? null : tpl.control_strategy);
  draft.mode_id = tpl.mode_id === undefined ? 2 : tpl.mode_id;
  draft.value_id = tpl.value_id === undefined ? 2 : tpl.value_id;
}
/** Built-in state templates derived from the parameter_generic_templates catalogue + library. */
function stateTemplates() {
  var out = CFG.schema_mappings.map(function (m) {
    var t = IDX.template.get(txt(m.schema_id));
    var type = t ? t.state_type : '?';
    var params = {};
    (TYPE_PARAMS[type] || []).slice(0, 2).forEach(function (f) { params[f.key] = ({ target_temp_c: 120, target_pressure_bar: 1.5, hysteresis_bar: 0.1, flow_rate: 4, setpoint: 50, rpm: 120, target_rpm: 120, power: 1 })[f.key] || 0; });
    var strat = null;
    if (type === 'heating' || type === 'stirring' || type === 'cooling') strat = { type: 'PID', pid_config_id: type === 'heating' ? 1 : type === 'stirring' ? 2 : 3, sample_time: 0.1, dt_max_s: 0.5, out_min: 0.0, out_max: 10.0, error_scale: 1.0, anti_windup: true };
    if (type === 'inflow' || type === 'reaction') strat = { type: 'control_method', method_id: 1 };
    return { id: 'type:' + m.mapping_id, type: type, title: (TYPE_LABEL[type] || type), desc: t ? t.description : '', mapping_id: m.mapping_id, parameters: params, control_strategy: strat, mode_id: 2, value_id: 2, source: 'Katalog · mapping ' + m.mapping_id + ' → schema ' + m.schema_id, used: use('mapping', m.mapping_id).states.length };
  });
  arr(LIB.process_templates).forEach(function (lt) {
    var ps = lt.process_state;
    out.push({ id: 'lib:' + lt.__template__.source_state_id, type: lt.__template__.state_type, title: 'Vorlage „' + lt.__template__.state_type + '“ (Bibliothek)', desc: 'Aus process_library_v9 · beim Einfügen: ' + lt.__template__.fill_on_insert.join(', '), mapping_id: ps.mapping_id, parameters: ps.parameters, control_strategy: ps.control_strategy, mode_id: ps.mode_id, value_id: ps.value_id, source: 'process_library_v9.json', used: 0 });
  });
  return out;
}
function renderProcessEditor() {
  var d = S.editor.draft, isNew = S.editor.isNew;
  return h('div.card', null, h('div.card__head', null, h('h3', null, icon('i-layers', 'ico--sm'), isNew ? 'Neuer Prozess' : 'Prozess #' + d.p_id)),
    h('div.card__body', null, h('div.form.form--2', null,
      field('p_id', input(d.p_id, function (e) { d.p_id = num(e.target.value); }, { type: 'number', min: 1 }), { required: true }),
      field('Owner-Node', select(CFG.nodes.map(function (n) { return { value: n.node_id, label: n.node_id + ' · ' + n.description }; }), d.owner_node_id, function (e) { d.owner_node_id = e.target.value; }), { key: 'owner_node_id', required: true }),
      field('Name', input(d.process_name, function (e) { d.process_name = e.target.value.trim(); }, { placeholder: 'z. B. jacket_cooling' }), { key: 'process_name', required: true }),
      field('Ort', input(d.process_location, function (e) { d.process_location = e.target.value.trim(); }, { placeholder: 'Main Reactor' }), { key: 'process_location' })),
      h('div.row', { style: { marginTop: '14px' } }, btn(isNew ? 'Prozess anlegen' : 'Speichern', { variant: 'primary', onClick: function () {
        if (!d.process_name) { toast('process_name ist Pflicht.', 'warn'); return; }
        pushHistory('Prozess ' + d.p_id);
        if (isNew) CFG.processes.push(clone(d)); else Object.assign(IDX.process.get(txt(d.p_id)), clone(d));
        commitModel(); markChanged('processes', d.p_id); S.editor = null; toast('Prozess gespeichert.', 'ok'); render();
      } }), btn('Abbrechen', { variant: 'ghost', onClick: function () { S.editor = null; render(); } }))));
}
function renderStateEditor() {
  var ed = S.editor, d = ed.draft;
  var type = stateTypeOf(d);
  var refs = d.io_refs;
  var stepsDone = [true, !!d.mapping_id, refs.sensors.length + refs.actuators.length > 0, true];
  var steps = h('div.steps', null, [['Prozess & Typ', (IDX.process.get(txt(d.p_id)) || {}).process_name + (type ? ' · ' + type : '')], ['I/O-Geräte', 'S' + refs.sensors.map(function (r) { return r.sensor_id; }).join(',') + ' A' + refs.actuators.map(function (r) { return r.actuator_id; }).join(',')], ['Strategie & Parameter', isObj(d.control_strategy) ? d.control_strategy.type : 'auto'], ['Freigabe', valueName(d.value_id) + ' · ' + modeName(d.mode_id)]].map(function (s, i) {
    return h('button.step' + (ed.step === i + 1 ? '.active' : '') + (stepsDone[i] ? '.done' : ''), { type: 'button', onClick: function () { ed.step = i + 1; render(); var el = document.getElementById('sec-' + (i + 1)); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, h('span.n', { text: String(i + 1) }), h('span', null, h('div.t', { text: s[0] }), h('div.d', { text: s[1] })));
  }));

  // 1) process & type
  var tpls = stateTemplates().filter(function (t) { return t.id.indexOf('type:') === 0; });
  var sec1 = h('div.sec#sec-1', null, h('div.sec__head', null, h('h4', null, h('span.n', { text: '1' }), 'Prozess & Typ'), h('span.hint', { text: 'Der Typ (mapping_id) bestimmt die Parameterfelder und die Strategie-Empfehlung.' })),
    h('div.form.form--3', { style: { marginBottom: '12px' } },
      field('Prozess', select(CFG.processes.map(function (p) { return { value: p.p_id, label: '#' + p.p_id + ' · ' + p.process_name + ' (' + p.owner_node_id + ')' }; }), d.p_id, function (e) { d.p_id = num(e.target.value); render(); }), { key: 'p_id', required: true }),
      field('state_id', input(d.state_id, function (e) { d.state_id = num(e.target.value); render(); }, { type: 'number', min: 1 }), { key: 'state_id', required: true, hint: ed.isNew ? 'frei: ' + d.state_id : '' }),
      field('Beschreibung', input(d.description || '', function (e) { d.description = e.target.value; }, { placeholder: 'Was regelt dieser State?' }), { key: 'description' })),
    h('div.tcards', null, tpls.map(function (t) {
      return h('button.tcard' + (num(d.mapping_id) === num(t.mapping_id) ? '.active' : ''), { type: 'button', onClick: function () { var keepParams = stateTypeOf(d) === t.type; d.mapping_id = t.mapping_id; if (!keepParams) { d.parameters = clone(t.parameters); d.control_strategy = clone(t.control_strategy); } render(); } },
        h('div.t', null, icon(TYPE_ICON[t.type] || 'i-layers'), t.title), h('div.d', { text: t.desc }), h('div.m', { text: 'mapping ' + t.mapping_id + ' · ' + t.used + '× genutzt' }));
    })));

  // 2) I/O
  var sec2 = h('div.sec#sec-2', null, h('div.sec__head', null, h('h4', null, h('span.n', { text: '2' }), 'I/O-Geräte'), h('span.hint', { text: 'Identität = controller_uuid + lokale ID. Belegte Geräte zeigen, wer sie bereits nutzt.' })),
    h('div.devgrid', null, devicePicker('sensor', refs.sensors, d), devicePicker('actuator', refs.actuators, d)));

  // 3) strategy & params
  var reco = recommendStrategy(d);
  var stratKind = isObj(d.control_strategy) ? d.control_strategy.type : 'null';
  var stratSeg = h('div.seg', null, [['null', 'Automatisch (null)'], ['PID', 'PID'], ['control_method', 'Control-Method']].map(function (o) {
    return h('button' + (stratKind === o[0] ? '.active' : ''), { type: 'button', text: o[1], onClick: function () {
      if (o[0] === 'null') d.control_strategy = null;
      else if (o[0] === 'PID') d.control_strategy = { type: 'PID', pid_config_id: reco.pid_config_id || 1, sample_time: 0.1, dt_max_s: 0.5, out_min: 0.0, out_max: 10.0, error_scale: 1.0, anti_windup: true };
      else d.control_strategy = { type: 'control_method', method_id: reco.method_id || 1 };
      render();
    } });
  }));
  var stratBody = null;
  if (stratKind === 'PID') {
    var cs = d.control_strategy;
    stratBody = h('div.form.form--4', null,
      field('PID-Config', select(CFG.pid_configs.map(function (p) { var pp = p.pid_parameters; return { value: p.pid_config_id, label: '#' + p.pid_config_id + ' · kp ' + pp.kp + ' · ki ' + pp.ki + ' · kd ' + pp.kd + ' (' + use('pid', p.pid_config_id).states.length + '× genutzt)' }; }), cs.pid_config_id, function (e) { cs.pid_config_id = num(e.target.value); render(); }), { key: 'pid_config_id', required: true, wide: true }),
      field('Abtastzeit', unitInput(cs.sample_time, 's', function (e) { cs.sample_time = num(e.target.value); }), { key: 'sample_time' }),
      field('dt max', unitInput(cs.dt_max_s, 's', function (e) { cs.dt_max_s = num(e.target.value); }), { key: 'dt_max_s' }),
      field('Ausgang min', unitInput(cs.out_min, '', function (e) { cs.out_min = num(e.target.value); }), { key: 'out_min' }),
      field('Ausgang max', unitInput(cs.out_max, '', function (e) { cs.out_max = num(e.target.value); }), { key: 'out_max', hint: 'Stellventil 0–100 %: out_max 100' }),
      field('Fehlerskalierung', unitInput(cs.error_scale, '×', function (e) { cs.error_scale = num(e.target.value); }), { key: 'error_scale' }),
      field('Anti-Windup', select([{ value: 'true', label: 'ein' }, { value: 'false', label: 'aus' }], String(cs.anti_windup !== false), function (e) { cs.anti_windup = e.target.value === 'true'; }), { key: 'anti_windup' }));
  } else if (stratKind === 'control_method') {
    stratBody = h('div.form.form--2', null, field('Control-Method', select(CFG.control_methods.map(function (m) { var t = IDX.cmTemplate.get(txt(m.template_id)); return { value: m.method_id, label: '#' + m.method_id + ' · ' + (t ? t.template_name : '?') + ' · ' + Object.keys(m.args).map(function (k) { return k + '=' + m.args[k]; }).join(', ') }; }), d.control_strategy.method_id, function (e) { d.control_strategy.method_id = num(e.target.value); render(); }), { key: 'method_id', required: true, wide: true, hint: (function () { var m = IDX.method.get(txt(d.control_strategy.method_id)); var t = m ? IDX.cmTemplate.get(txt(m.template_id)) : null; return t ? t.template_description : ''; })() }));
  } else {
    stratBody = h('div.note' + (reco.needHysteresis ? '.note--warn' : ''), { text: reco.kind === 'twopoint' ? 'Runtime wählt Zweipunkt (write_coil-Aktor erkannt).' + (reco.needHysteresis ? ' Hysterese fehlt — unten setzen.' : ' Hysterese ist gesetzt.') : reco.kind === 'none' ? 'Kein Aktor gewählt — der State beobachtet nur.' : 'Runtime wählt einen P-Regler (Stellaktor ohne Hysterese-Parameter). Für Temperatur/Drehzahl ist PID meist besser.' });
  }
  var paramDefs = (TYPE_PARAMS[type] || []).slice();
  if (reco.kind === 'twopoint' && !paramDefs.some(function (f) { return f.key.indexOf('hysteresis') === 0; })) paramDefs.push({ key: 'hysteresis_bar', label: 'Hysterese', unit: '' });
  Object.keys(d.parameters || {}).forEach(function (k) { if (!paramDefs.some(function (f) { return f.key === k; })) paramDefs.push({ key: k, label: k, unit: '', custom: true }); });
  var paramGrid = h('div.form.form--4', null, paramDefs.map(function (f) {
    var val = d.parameters[f.key];
    var ctl = unitInput(val === undefined ? '' : val, f.unit, function (e) { var v = num(e.target.value); if (v === null) delete d.parameters[f.key]; else d.parameters[f.key] = v; render(); }, { placeholder: '—' });
    return field(f.label, ctl, { key: f.key + (SETPOINT_KEYS.indexOf(f.key) >= 0 ? ' · Sollwert' : '') });
  }), h('div.field', null, h('label', { text: 'Eigener Parameter' }), h('div.row', null, h('input.inp#param-k', { placeholder: 'key', style: { flex: '1' } }), h('input.inp#param-v', { placeholder: 'Wert', type: 'number', step: 'any', style: { width: '90px' } }), btn('', { icon: 'i-plus', size: 'sm', onClick: function () { var k = document.getElementById('param-k').value.trim(); var v = num(document.getElementById('param-v').value); if (k && v !== null) { d.parameters[k] = v; render(); } } }))));
  var sec3 = h('div.sec#sec-3', null, h('div.sec__head', null, h('h4', null, h('span.n', { text: '3' }), 'Strategie & Parameter'), h('span.hint', { text: 'Sollwert-Schlüssel in Auswertungsreihenfolge: ' + SETPOINT_KEYS.slice(0, 4).join(', ') + ' …' })),
    h('div.reco.reco--accent', null, icon('i-sparkle'), h('div', null, h('div.t', { text: 'Empfehlung: ' + reco.title }), h('div.d', { text: reco.text }), (reco.kind === 'pid' && stratKind !== 'PID') || (reco.kind === 'method' && stratKind !== 'control_method') || (reco.kind === 'twopoint' && stratKind !== 'null') ? h('div.a', null, h('button.link', { type: 'button', text: 'Empfehlung übernehmen →', onClick: function () { if (reco.kind === 'pid') d.control_strategy = { type: 'PID', pid_config_id: reco.pid_config_id, sample_time: 0.1, dt_max_s: 0.5, out_min: 0.0, out_max: 10.0, error_scale: 1.0, anti_windup: true }; else if (reco.kind === 'method') d.control_strategy = { type: 'control_method', method_id: reco.method_id }; else d.control_strategy = null; render(); } })) : null)),
    h('div.row', { style: { margin: '10px 0' } }, h('span.hint', { text: 'control_strategy' }), stratSeg),
    stratBody, h('div', { style: { height: '12px' } }), paramGrid);

  // 4) release
  var engine = arr(CFG.rule_engine)[0] || {};
  var gated = num(d.mode_id) !== num(engine.required_mode_id);
  var sec4 = h('div.sec#sec-4', null, h('div.sec__head', null, h('h4', null, h('span.n', { text: '4' }), 'Freigabe'), h('span.hint', { text: 'value_id 1 = aktiv. Regeln schreiben nur bei mode_id == required_mode_id.' })),
    h('div.form.form--3', null,
      field('Startwert', select(CFG.process_values.map(function (v) { return { value: v.value_id, label: '#' + v.value_id + ' · ' + v.state_value }; }), d.value_id, function (e) { d.value_id = num(e.target.value); render(); }), { key: 'value_id', required: true }),
      field('Betriebsart', select(CFG.process_modes.map(function (m) { return { value: m.mode_id, label: '#' + m.mode_id + ' · ' + m.mode + (num(m.mode_id) === num(engine.required_mode_id) ? ' · Engine-Gate' : '') }; }), d.mode_id, function (e) { d.mode_id = num(e.target.value); render(); }), { key: 'mode_id', required: true }),
      field('Sollwertquelle', select([{ value: 'null', label: 'keine (null)' }, { value: 'hmi', label: 'HMI-Vorgabe' }, { value: 'rule', label: 'Regel (parameters)' }], d.setpoint_source === null || d.setpoint_source === undefined ? 'null' : (isObj(d.setpoint_source) ? d.setpoint_source.kind : 'null'), function (e) { d.setpoint_source = e.target.value === 'null' ? null : { kind: e.target.value }; }), { key: 'setpoint_source' })),
    gated ? h('div.note.note--warn', { style: { marginTop: '10px' }, text: 'Betriebsart ' + modeName(d.mode_id) + ' ≠ required_mode_id ' + engine.required_mode_id + ' (' + modeName(engine.required_mode_id) + '): Regeln auf diesen State enden mit skipped_mode. Für Handbetrieb gewollt, für Automatik ein Fehler.' }) : h('div.note.note--ok', { style: { marginTop: '10px' }, text: 'Betriebsart passt zum Engine-Gate — Regeln dürfen diesen State schreiben.' }));

  var problems = validateStateDraft(d);
  var bar = h('div.row.row--between', { style: { marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--line)' } },
    h('div.row', null, problems.length ? problems.map(function (p) { return badge(p, 'danger'); }) : badge('gültig nach V9-Vertrag', 'ok')),
    h('div.row', null,
      ed.isNew ? null : btn('Duplizieren', { icon: 'i-copy', onClick: function () { var c = clone(d); c.state_id = maxId(CFG.process_states, 'state_id') + 1; S.editor = { kind: 'state', isNew: true, draft: c, step: 1 }; render(); } }),
      ed.isNew ? null : btn('Löschen', { icon: 'i-trash', variant: 'danger', onClick: function () { deleteState(d.state_id); } }),
      btn('Abbrechen', { variant: 'ghost', onClick: function () { S.editor = null; render(); } }),
      btn(ed.isNew ? 'State anlegen' : 'Speichern', { variant: 'primary', icon: 'i-check', disabled: problems.length > 0, onClick: function () { saveState(); } })));

  return h('div', null, h('div.row.row--between', { style: { marginBottom: '10px' } }, h('h3', { style: { fontSize: '15px', fontWeight: '750' }, text: ed.isNew ? 'Neuer Prozess-State' : 'State #' + ed.original + ' bearbeiten' }), h('div.row', null, scopeBadge(stateScope(d)), isChanged('states', d.state_id) ? badge('geändert', 'accent') : null)), steps, h('div.card', null, h('div.card__body', null, sec1, sec2, sec3, sec4, bar)));
}
function validateStateDraft(d) {
  var out = [];
  if (!d.mapping_id) out.push('Typ fehlt (mapping_id)');
  if (d.p_id === null || !IDX.process.get(txt(d.p_id))) out.push('Prozess fehlt');
  if (d.state_id === null) out.push('state_id fehlt');
  var dup = CFG.process_states.some(function (s) { return num(s.state_id) === num(d.state_id) && (S.editor.isNew || num(s.state_id) !== num(S.editor.original)); });
  if (dup) out.push('state_id ' + d.state_id + ' existiert');
  if (isObj(d.control_strategy) && d.control_strategy.type === 'PID' && !IDX.pid.get(txt(d.control_strategy.pid_config_id))) out.push('PID-Config fehlt');
  if (isObj(d.control_strategy) && d.control_strategy.type === 'PID' && !d.io_refs.sensors.length) out.push('PID braucht einen Sensor');
  return out;
}
function saveState() {
  var ed = S.editor, d = clone(ed.draft);
  pushHistory('State ' + d.state_id);
  if (ed.isNew) CFG.process_states.push(d);
  else { var i = CFG.process_states.findIndex(function (s) { return num(s.state_id) === num(ed.original); }); CFG.process_states[i] = d; if (num(ed.original) !== num(d.state_id)) retargetState(ed.original, d.state_id); }
  commitModel(); markChanged('states', d.state_id); S.sel.states = d.state_id; S.editor = null;
  toast((ed.isNew ? 'State angelegt: ' : 'State gespeichert: ') + '#' + d.state_id, 'ok'); render();
}
function retargetState(oldId, newId) {
  CFG.rules.forEach(function (r) { ['do', 'else_do'].forEach(function (b) { arr(r[b]).forEach(function (a) { if (Array.isArray(a.state_ids)) a.state_ids = a.state_ids.map(function (x) { return num(x) === num(oldId) ? newId : x; }); }); }); ['when', 'until'].forEach(function (b) { arr(r[b]).forEach(function (c) { if (num(c.state_id) === num(oldId)) c.state_id = newId; if (isObj(c.value) && num(c.value.param_of_state) === num(oldId)) c.value.param_of_state = newId; }); }); });
}
function deleteState(id) {
  var u = use('state', id);
  confirmAction('State #' + id + ' löschen?' + (u.rules.length ? ' Regel ' + u.rules.join(', ') + ' referenziert ihn — die Referenzen werden entfernt.' : ''), 'State löschen', function () {
    pushHistory('State ' + id + ' gelöscht');
    CFG.process_states = CFG.process_states.filter(function (s) { return num(s.state_id) !== num(id); });
    CFG.rules.forEach(function (r) { ['do', 'else_do'].forEach(function (b) { r[b] = arr(r[b]).filter(function (a) { if (Array.isArray(a.state_ids)) { a.state_ids = a.state_ids.filter(function (x) { return num(x) !== num(id); }); return a.state_ids.length > 0; } return true; }); }); });
    commitModel(); markChanged('states', id); S.editor = null; S.sel.states = null; toast('State #' + id + ' gelöscht.', 'ok'); render();
  });
}
/** Device picker grouped by node → controller with usage and availability context. */
function devicePicker(kind, selectedRefs, draft) {
  var list = kind === 'sensor' ? CFG.sensors : CFG.actuators;
  var idField = kind + '_id';
  var proc = IDX.process.get(txt(draft.p_id));
  var ownerNode = proc ? proc.owner_node_id : null;
  var groups = {};
  list.forEach(function (dev) { var k = dev.node_id + ' › ' + ctrlKey(dev.controller_uuid); (groups[k] = groups[k] || []).push(dev); });
  var body = Object.keys(groups).sort().map(function (g) {
    var node = g.split(' › ')[0];
    return h('div.devgroup', null, h('div.devgroup__t', null, g, node !== ownerNode ? badge('anderer Node → cross', 'warn') : null), groups[g].map(function (dev) {
      var key = refKey(dev, idField);
      var on = selectedRefs.some(function (r) { return refKey(r, idField) === key; });
      var u = use(kind, key);
      var others = u.states.filter(function (id) { return num(id) !== num(draft.state_id); });
      var usage = others.length ? 'State ' + others.join(', ') : (u.rules && u.rules.length ? 'Regel ' + u.rules.join(', ') : 'frei');
      var unit = unitOf(dev);
      return h('label.dev' + (on ? '.on' : ''), null,
        h('input', { type: 'checkbox', checked: on, onChange: function (e) {
          if (e.target.checked) selectedRefs.push(kind === 'sensor' ? { sensor_id: dev.sensor_id, controller_uuid: dev.controller_uuid } : { actuator_id: dev.actuator_id, controller_uuid: dev.controller_uuid });
          else { var i = selectedRefs.findIndex(function (r) { return refKey(r, idField) === key; }); if (i >= 0) selectedRefs.splice(i, 1); }
          render();
        } }),
        h('span', null, h('div.t', null, (kind === 'sensor' ? 'S' : 'A') + dev[idField], h('span', { style: { fontWeight: '500', color: 'var(--muted)' }, text: devTitle(dev, kind) }), unit ? badge(unit, null, true) : null, kind === 'actuator' ? badge(dev.function_type === 'write_coil' ? 'coil · schaltend' : 'register · stellend', dev.function_type === 'write_coil' ? 'warn' : 'accent') : null),
          h('div.d', { text: 'Adr ' + dev.address + ' · ' + dev.function_type + (dev.profile_id !== undefined ? ' · profile ' + dev.profile_id : ' · kein Profil') })),
        h('span.u', null, h('b', { text: usage }), u.filters && u.filters.length ? h('div', { text: 'Filter ' + u.filters.join(',') }) : null));
    }));
  });
  var sel = selectedRefs.length;
  return h('div.devbox', null, h('div.devbox__head', null, h('span', { text: kind === 'sensor' ? 'Sensoren (io_refs.sensors)' : 'Aktoren (io_refs.actuators)' }), h('span.mono', { text: sel + ' gewählt' })), body);
}
function renderStateContext() {
  var d = S.editor.draft;
  var scope = stateScope(d);
  var u = use('state', d.state_id);
  var devs = d.io_refs.sensors.map(function (r) { var s = IDX.sensor.get(refKey(r, 'sensor_id')); return s ? { label: devShort(s, 'sensor'), sub: devTitle(s, 'sensor'), node: s.node_id } : { label: 'S' + r.sensor_id, sub: 'unbekannt', node: '?' }; }).concat(d.io_refs.actuators.map(function (r) { var a = IDX.actuator.get(refKey(r, 'actuator_id')); return a ? { label: devShort(a, 'actuator'), sub: devTitle(a, 'actuator'), node: a.node_id } : { label: 'A' + r.actuator_id, sub: 'unbekannt', node: '?' }; }));
  var scopeText = { local_controller: 'Ein Controller — läuft im Node-Shard V9.', cross_controller: 'Mehrere Controller, ein Node — läuft im V8-Cross-Shard des Nodes.', cross_worker: 'Controller auf zwei Nodes — nur der Site-Coordinator darf Regeln hierauf ausführen (priority ≥ coordinator_min_priority).', unbound: 'Noch kein Gerät gewählt.', invalid: 'Unbekannte controller_uuid.' }[scope];
  return h('div', null,
    ctxSec('Scope (live)', h('div', null, h('div.row', { style: { marginBottom: '6px' } }, scopeBadge(scope)), h('div.hint', { text: scopeText }))),
    ctxSec('Betroffene Geräte', devs.length ? h('div.impact', null, devs.map(function (x) { return h('div.i', null, h('b', { text: x.label }), h('span.mono', { text: x.node }), h('span', { style: { color: 'var(--muted)' }, text: x.sub })); })) : h('div.hint', { text: 'Noch keine Geräte — in Schritt 2 wählen.' })),
    ctxSec('Regeln auf diesen State', u.rules.length ? h('div.impact', null, u.rules.map(function (id) { var r = IDX.rule.get(txt(id)); return h('div.i', null, h('b', { text: '#' + id }), h('span', { text: r ? r.name : '' }), h('button.link.link--accent', { type: 'button', text: 'Öffnen', style: { marginLeft: 'auto' }, onClick: function () { setView('rules', { select: id, editor: ruleEditorFor(r) }); } })); })) : h('div', null, h('div.hint', { text: 'Keine Regel schaltet diesen State.' }), h('div', { style: { marginTop: '6px' } }, h('button.link', { type: 'button', text: 'Regel für diesen State anlegen →', onClick: function () { setView('rules', { editor: newRuleEditor({ state: d }) }); } })))),
    ctxSec('V9-Vorschau (process_states[])', jsonPre(canonicalState(d))));
}
function canonicalState(d) {
  var out = { state_id: d.state_id, p_id: d.p_id, value_id: d.value_id, mode_id: d.mode_id, mapping_id: d.mapping_id, io_refs: d.io_refs, control_strategy: d.control_strategy, setpoint_source: d.setpoint_source === undefined ? null : d.setpoint_source, parameters: d.parameters };
  if (d.description) out.description = d.description;
  return out;
}

/* ------------------------------------------------------------------ rules view */
function describeCond(c) {
  var v = isObj(c.value) ? (c.value.scale !== undefined ? c.value.scale + ' × ' : '') + 'State ' + c.value.param_of_state + '.' + c.value.key : txt(c.value);
  if (c.src === 'sensor') { var s = IDX.sensor.get(refKey(c, 'sensor_id')); return (s ? devShort(s, 'sensor') : (c.sensor_id === undefined ? '(Sensor wählen)' : 'S' + c.sensor_id + ' (unbekannt)')) + (c.filter_id !== undefined ? ' [F' + c.filter_id + ']' : '') + ' ' + c.op + ' ' + v + (s && unitOf(s) && !isObj(c.value) ? ' ' + unitOf(s) : ''); }
  if (c.src === 'state') return 'State ' + c.state_id + '.' + (c.field || 'value_id') + ' ' + c.op + ' ' + v;
  if (c.src === 'timer') return 'Timer ' + c.timer_id + ' ' + c.op;
  return c.src + ' ' + c.op + ' ' + v;
}
function describeAct(a) {
  if (a.notify !== undefined) return 'notify „' + a.notify + '“';
  var tgt = Array.isArray(a.state_ids) ? 'State ' + a.state_ids.join(', ') : Array.isArray(a.p_ids) ? 'Prozess ' + a.p_ids.join(', ') : '?';
  var parts = [];
  if (a.value_id !== undefined) parts.push(':= ' + valueName(a.value_id));
  if (isObj(a.parameters)) parts.push(Object.keys(a.parameters).map(function (k) { return k + ' = ' + a.parameters[k]; }).join(', '));
  return tgt + ' ' + parts.join(' · ');
}
function ruleTone(r) {
  var sc = ruleScope(r);
  var engine = arr(CFG.rule_engine)[0] || {};
  var minPrio = (isObj(engine.runtime) ? engine.runtime.coordinator_min_priority : 1000) || 1000;
  if (sc === 'cross_worker' && num(r.priority) < minPrio) return 'warn';
  if (CRITICAL_GROUPS.indexOf(txt(r.group)) >= 0 && sc !== 'local_controller') return 'danger';
  if (r.enabled === false) return 'muted';
  if (sc !== 'local_controller') return 'warn';
  return null;
}
function renderRulesView() {
  var chips = [{ id: 'all', label: 'Alle' }, { id: 'local_controller', label: 'lokal' }, { id: 'cross_controller', label: 'cross-ctrl' }, { id: 'cross_worker', label: 'cross-worker' }, { id: 'notify', label: 'Meldungen' }];
  var groups = [];
  CFG.nodes.forEach(function (n) {
    var rules = CFG.rules.filter(function (r) { return r.owner_node_id === n.node_id && matchInv(r.name + ' ' + txt(r.description) + ' ' + r.rule_id) && (S.invChip === 'all' || (S.invChip === 'notify' ? r.group === 'notify' : ruleScope(r) === S.invChip)); });
    groups.push(invGroup('Owner ' + n.node_id, rules.length + ' Regeln'));
    rules.sort(function (a, b) { return num(a.priority) - num(b.priority) || num(a.rule_id) - num(b.rule_id); }).forEach(function (r) {
      groups.push(invItem({ title: '#' + r.rule_id + ' ' + r.name, sub: arr(r.when).map(describeCond).join(' ∧ '), meta: 'P' + r.priority, tone: ruleTone(r), changed: isChanged('rules', r.rule_id), active: S.sel.rules === r.rule_id, onClick: function () { S.sel.rules = r.rule_id; S.editor = ruleEditorFor(r); render(); } }));
    });
  });
  var inv = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '100%' } }, invHead('Regeln', chips), h('div.inv-list', null, groups),
    h('div.inv-foot', null, btn('Neue Regel', { icon: 'i-plus', variant: 'primary', block: true, onClick: function () { S.sel.rules = null; S.editor = newRuleEditor({}); render(); } }), btn('Aus Vorlage', { icon: 'i-copy', block: true, onClick: function () { S.sel.rules = null; S.editor = { kind: 'ruleTemplates' }; render(); } })));
  if (S.editor && S.editor.kind === 'rule') { panes(inv, renderRuleEditor(), renderRuleContext()); return; }
  if (S.editor && S.editor.kind === 'ruleTemplates') { panes(inv, renderRuleTemplates(), h('div', null, ctxSec('So funktionieren Vorlagen', h('div.hint', { text: 'Jede Vorlage kennt ihre offenen Stellen (fill_on_insert / deferred): Sensor-Identität, Ziel-State, Sollwert-Bezug. Beim Übernehmen fragt der Editor genau diese Stellen ab — der Rest ist vorbelegt.' })))); return; }
  panes(inv, renderRulesOverview(), h('div', null, ctxSec('Lesehilfe', h('div.hint', { text: 'when[] ist immer UND-verknüpft. until[] macht die Regel zum Schmitt-Trigger (Hysterese). do[] läuft bei erfüllter Bedingung, else_do[] sonst. Auswertung nach (priority, rule_id); der letzte Schreiber gewinnt.' })), ctxSec('Sitzungsänderungen', changeLog())));
}
function renderRulesOverview() {
  var rows = CFG.rules.slice().sort(function (a, b) { return num(a.priority) - num(b.priority) || num(a.rule_id) - num(b.rule_id); }).map(function (r) {
    return h('tr', null, h('td', null, h('b', { text: '#' + r.rule_id }), h('div.hint', { text: r.name })), h('td.r', { text: String(r.priority) }),
      h('td', null, h('div', { style: { display: 'grid', gap: '2px' } }, arr(r.when).map(function (c) { return h('code', { style: { fontSize: '11px' }, text: describeCond(c) }); }), arr(r.until).length ? h('code', { style: { fontSize: '11px', color: 'var(--warn-fg)' }, text: 'bis ' + arr(r.until).map(describeCond).join(' ∧ ') }) : null)),
      h('td', null, h('div', { style: { display: 'grid', gap: '2px' } }, arr(r.do).map(function (a) { return h('code', { style: { fontSize: '11px' }, text: describeAct(a) }); }), arr(r.else_do).length ? h('code', { style: { fontSize: '11px', color: 'var(--faint)' }, text: 'sonst ' + arr(r.else_do).map(describeAct).join('; ') }) : null)),
      h('td', null, badge(r.group, r.group === 'notify' ? 'info' : null)), h('td', null, scopeBadge(ruleScope(r))), h('td.mono', { text: r.owner_node_id }),
      h('td', null, h('label.row', null, h('input', { type: 'checkbox', checked: r.enabled !== false, onChange: function (e) { pushHistory('Regel ' + r.rule_id + ' ' + (e.target.checked ? 'aktiv' : 'inaktiv')); r.enabled = e.target.checked; r.activation_state = r.enabled ? 'active' : 'inactive'; r.deployment_status = r.enabled ? (ruleScope(r) === 'local_controller' ? 'active_node' : 'active_cross') : 'disabled_with_reason'; if (!r.enabled) r.disabled_reason = 'Im Editor deaktiviert'; else delete r.disabled_reason; commitModel(); markChanged('rules', r.rule_id); render(); } }))),
      h('td', null, h('div.acts-cell', null, h('button.link.link--accent', { type: 'button', text: 'Bearbeiten', onClick: function () { S.sel.rules = r.rule_id; S.editor = ruleEditorFor(r); render(); } }), h('button.link.link--danger', { type: 'button', text: 'Löschen', onClick: function () { deleteRule(r.rule_id); } }))));
  });
  var mode = S.rulesMode || 'table';
  var seg = h('div.seg', null, [['table', 'Tabelle'], ['matrix', 'Signal-Matrix'], ['ladder', 'Prioritäten']].map(function (m) { return h('button' + (mode === m[0] ? '.active' : ''), { type: 'button', text: m[1], onClick: function () { S.rulesMode = m[0]; render(); } }); }));
  var body = mode === 'matrix' ? renderRulesMatrix() : mode === 'ladder' ? renderRulesLadder() : h('div.tblwrap', null, h('table.tbl', null, h('thead', null, h('tr', null, h('th', { text: 'Regel' }), h('th.r', { text: 'Prio' }), h('th', { text: 'Wenn' }), h('th', { text: 'Dann' }), h('th', { text: 'Gruppe' }), h('th', { text: 'Scope' }), h('th', { text: 'Owner' }), h('th', { text: 'Aktiv' }), h('th'))), h('tbody', null, rows)));
  return h('div.card', null, h('div.card__head', null, h('h3', null, icon('i-rule', 'ico--sm'), mode === 'matrix' ? 'Signal-Matrix: wer liest was, wer schreibt wohin' : mode === 'ladder' ? 'Prioritätenleiter' : 'Alle Regeln', badge(String(CFG.rules.length), 'accent')), h('div.acts', null, seg)),
    h('div.card__body.card__body--flush', null, body));
}
/** Rule patterns — prefilled sentences, the open slots are asked in the editor. */
var RULE_PATTERNS = [
  { id: 'threshold', title: 'Schwellwert schaltet State', desc: 'Sensor ≥ Wert → State aktiv, sonst inaktiv.', needs: ['sensor', 'state'], build: function (p) { return { when: [{ src: 'sensor', op: '>=', value: 0 }], do: [{ state_ids: [], value_id: 1 }], else_do: [{ state_ids: [], value_id: 2 }] }; } },
  { id: 'hysteresis', title: 'Hysterese (Schmitt-Trigger)', desc: 'Ein ab oberem Wert, aus erst unter dem unteren — mit until[].', needs: ['sensor', 'state'], build: function () { return { when: [{ src: 'sensor', op: '>=', value: 25 }], until: [{ src: 'sensor', op: '<=', value: 15 }], do: [{ state_ids: [], value_id: 1 }], else_do: [{ state_ids: [], value_id: 2 }] }; } },
  { id: 'setpoint', title: 'Sollwert nachführen', desc: 'Ab Schwellwert einen Parameter des States setzen (writable_fields: parameters).', needs: ['sensor', 'state'], build: function () { return { when: [{ src: 'sensor', op: '>=', value: 150 }], do: [{ state_ids: [], parameters: { target_temp_c: 554 } }], priority: 200 }; } },
  { id: 'nominal', title: 'Meldung bei 98 % Sollwert', desc: 'Sensor ≥ 0,98 × Parameter des States UND State aktiv → notify.', needs: ['sensor', 'state'], build: function () { return { group: 'notify', priority: 10, when: [{ src: 'sensor', op: '>=', value: { param_of_state: null, key: 'target_temp_c', scale: 0.98 } }, { src: 'state', field: 'value_id', op: '==', value: 1 }], do: [{ notify: 'nominal' }] }; } },
  { id: 'timer', title: 'Timer-gesteuert', desc: 'Wenn Timer abgelaufen/ausgelöst → State umschalten.', needs: ['timer', 'state'], build: function () { return { when: [{ src: 'timer', op: 'elapsed', timer_id: null }], do: [{ state_ids: [], value_id: 2 }] }; } },
  { id: 'interlock', title: 'Verriegelung (safety, nur lokal)', desc: 'Sensor über Grenze → State aus, Gruppe safety, darf nie cross laufen.', needs: ['sensor', 'state'], build: function () { return { group: 'safety', priority: 5, when: [{ src: 'sensor', op: '>=', value: 0 }], do: [{ state_ids: [], value_id: 2 }] }; } }
];
function deleteRule(id) {
  var r = IDX.rule.get(txt(id)); if (!r) return;
  confirmAction('Regel #' + id + ' („' + r.name + '“) löschen?', 'Regel löschen', function () {
    pushHistory('Regel ' + id + ' gelöscht');
    CFG.rules = CFG.rules.filter(function (x) { return num(x.rule_id) !== num(id); });
    commitModel(); markChanged('rules', id); if (S.editor && S.editor.kind === 'rule' && num(S.editor.original) === num(id)) S.editor = null; if (num(S.sel.rules) === num(id)) S.sel.rules = null; toast('Regel #' + id + ' gelöscht.', 'ok'); render();
  });
}
function baseRule() {
  var eng = arr(CFG.rule_engine)[0] || {}; var dfl = isObj(eng.defaults) ? eng.defaults : {};
  return { rule_id: maxId(CFG.rules, 'rule_id') + 1, engine_id: 1, owner_node_id: CFG.nodes[0].node_id, execution_owner: CFG.nodes[0].node_id, execution_scope: 'node:' + CFG.nodes[0].node_id, execution_epoch: 1, deployment_status: 'active_node', activation_state: 'active', group: 'process', priority: num(dfl.priority) === null ? 100 : num(dfl.priority), name: '', enabled: true, when: [], until: [], do: [], else_do: [], description: '' };
}
function newRuleEditor(prefill) {
  var p = prefill || {};
  var d = baseRule();
  var pat = p.pattern || RULE_PATTERNS[0];
  Object.assign(d, clone(pat.build(p)));
  var sensor = p.sensor || (p.state ? IDX.sensor.get(refKey(arr(p.state.io_refs && p.state.io_refs.sensors)[0] || {}, 'sensor_id')) : null) || null;
  if (sensor) arr(d.when).concat(arr(d.until)).forEach(function (c) { if (c.src === 'sensor') { c.sensor_id = sensor.sensor_id; c.controller_uuid = sensor.controller_uuid; var f = use('sensor', refKey(sensor, 'sensor_id')).filters[0]; if (f !== undefined) c.filter_id = f; } });
  if (p.timer) arr(d.when).forEach(function (c) { if (c.src === 'timer') c.timer_id = p.timer.timer_id; });
  var st = p.state || (sensor ? IDX.state.get(txt(use('sensor', refKey(sensor, 'sensor_id')).states[0])) : null) || null;
  if (st) { arr(d.do).concat(arr(d.else_do)).forEach(function (a) { if (Array.isArray(a.state_ids)) a.state_ids = [st.state_id]; }); arr(d.when).forEach(function (c) { if (c.src === 'state') c.state_id = st.state_id; if (isObj(c.value)) c.value.param_of_state = st.state_id; }); }
  d.name = pat.id + (st ? '_state_' + st.state_id : '');
  return { kind: 'rule', isNew: true, draft: d, pattern: pat.id };
}
function ruleEditorFor(r) {
  var d = clone(r); d.until = arr(d.until); d.else_do = arr(d.else_do);
  var ov = {};
  var autoDeploy = r.enabled === false ? 'disabled_with_reason' : (ruleScope(r) === 'local_controller' ? 'active_node' : 'active_cross');
  if (r.deployment_status && r.deployment_status !== autoDeploy && r.enabled !== false) ov.deployment = r.deployment_status;
  if (r.activation_state && r.activation_state !== (r.enabled === false ? 'inactive' : 'active')) ov.activation = r.activation_state;
  return { kind: 'rule', isNew: false, draft: d, original: r.rule_id, overrides: ov };
}
function renderRuleTemplates() {
  var lib = arr(LIB.rule_templates);
  return h('div', null,
    h('div.card', null, h('div.card__head', null, h('h3', null, icon('i-sparkle', 'ico--sm'), 'Muster (Satzbaukasten)')), h('div.card__body', null, h('div.tcards', null, RULE_PATTERNS.map(function (p) {
      return h('button.tcard', { type: 'button', onClick: function () { S.editor = newRuleEditor({ pattern: p }); render(); } }, h('div.t', null, icon('i-rule'), p.title), h('div.d', { text: p.desc }), h('div.m', { text: 'braucht: ' + p.needs.join(' + ') }));
    })))),
    h('div.card', null, h('div.card__head', null, h('h3', null, icon('i-copy', 'ico--sm'), 'Regel-Bibliothek (rule_library_v9.json)', badge(String(lib.length), 'accent'))), h('div.card__body.card__body--flush', null, h('div.tblwrap', null, h('table.tbl', null, h('thead', null, h('tr', null, h('th', { text: 'Vorlage' }), h('th', { text: 'Wenn' }), h('th', { text: 'Dann' }), h('th', { text: 'Beim Einfügen zu wählen' }), h('th'))), h('tbody', null, lib.map(function (t) {
      var r = t.rule, meta = t.__template__;
      var open = arr(meta.deferred).map(function (x) { return x.sensor_type ? 'Sensor (' + x.sensor_type + ')' : x.state_type ? 'State (' + x.state_type + ')' : x.key ? 'Sollwertbezug ' + x.key : null; }).filter(Boolean);
      return h('tr', null, h('td', null, h('b', { text: r.name }), h('div.hint', { text: 'Prio ' + r.priority + ' · ' + r.group })), h('td', null, arr(r.when).map(function (c) { return h('code', { style: { fontSize: '11px', display: 'block' }, text: c.src + ' ' + c.op + ' ' + (isObj(c.value) ? 'param' : c.value) }); })), h('td', null, arr(r.do).map(function (a) { return h('code', { style: { fontSize: '11px', display: 'block' }, text: describeAct(a) }); })),
        h('td', null, h('div.chips', null, open.length ? open.map(function (o) { return badge(o, 'warn'); }) : badge('nichts offen', 'ok'))),
        h('td', null, h('button.link.link--accent', { type: 'button', text: 'Übernehmen', onClick: function () { var d = baseRule(); Object.assign(d, clone(r)); d.rule_id = maxId(CFG.rules, 'rule_id') + 1; d.until = arr(d.until); d.else_do = arr(d.else_do); d.name = r.name; var sensorType = (arr(meta.deferred).filter(function (x) { return x.sensor_type; })[0] || {}).sensor_type; var sensor = CFG.sensors.filter(function (s) { return sensorKindOf(s) === sensorType; })[0] || CFG.sensors[0]; arr(d.when).forEach(function (c) { if (c.src === 'sensor' && sensor) { c.sensor_id = sensor.sensor_id; c.controller_uuid = sensor.controller_uuid; } }); var stType = (arr(meta.deferred).filter(function (x) { return x.state_type; })[0] || {}).state_type; var st = CFG.process_states.filter(function (s) { return stateTypeOf(s) === stType; })[0]; arr(d.when).forEach(function (c) { if (c.src === 'state') c.state_id = st ? st.state_id : null; }); arr(meta.deferred).forEach(function (x) { if (x.key && x.set && x.set.indexOf('param_of_state') >= 0) { arr(d.when).forEach(function (c) { if (c.src === 'sensor') c.value = { param_of_state: st ? st.state_id : null, key: x.key, scale: x.scale }; }); } }); S.editor = { kind: 'rule', isNew: true, draft: d, fromLibrary: true, open: open }; toast('Vorlage übernommen — offene Stellen sind markiert.', 'ok'); render(); } })));
    })))))));
}
function deriveRuleMeta(d) {
  var uuids = ruleUuids(d);
  var nodes = uniq(uuids.map(nodeOfCtrl).filter(function (n) { return n !== '?'; }));
  var scope = scopeOfUuids(uuids);
  var owner = d.owner_node_id;
  if (nodes.length && nodes.indexOf(owner) < 0) owner = nodes[0];
  var targetNodes = uniq(arr(d.do).concat(arr(d.else_do)).reduce(function (acc, a) { return acc.concat(arr(a.state_ids).map(function (id) { var st = IDX.state.get(txt(id)); var p = st ? IDX.process.get(txt(st.p_id)) : null; return p ? p.owner_node_id : null; })); }, []).filter(Boolean));
  if (targetNodes.length === 1 && scope !== 'cross_worker') owner = targetNodes[0];
  var engine = arr(CFG.rule_engine)[0] || {};
  var minPrio = (isObj(engine.runtime) ? engine.runtime.coordinator_min_priority : 1000) || 1000;
  var autoDeploy = d.enabled === false ? 'disabled_with_reason' : (scope === 'local_controller' ? 'active_node' : 'active_cross');
  var ov = (S.editor && S.editor.overrides) || {};
  var deploy = ov.deployment && d.enabled !== false ? ov.deployment : autoDeploy;
  var activation = ov.activation ? ov.activation : (d.enabled === false ? 'inactive' : 'active');
  return { scope: scope, owner: owner, nodes: nodes, execution_scope: scope === 'local_controller' ? 'node:' + owner : 'cross:' + owner + '.default', deployment_status: deploy, autoDeploy: autoDeploy, activation_state: activation, minPrio: minPrio, needsCoordinator: scope === 'cross_worker', critical: CRITICAL_GROUPS.indexOf(txt(d.group)) >= 0 };
}
function sensorOptions() { return CFG.sensors.map(function (s) { var u = use('sensor', refKey(s, 'sensor_id')); return { value: refKey(s, 'sensor_id'), label: devShort(s, 'sensor') + ' · ' + devTitle(s, 'sensor') + (unitOf(s) ? ' [' + unitOf(s) + ']' : '') + (u.states.length ? ' · State ' + u.states.join(',') : '') }; }); }
function stateOptions() { return CFG.process_states.map(function (s) { return { value: s.state_id, label: '#' + s.state_id + ' · ' + (TYPE_LABEL[stateTypeOf(s)] || '?') + ' · ' + (IDX.process.get(txt(s.p_id)) || {}).process_name }; }); }
function condRow(c, list, idx) {
  var parts = [];
  parts.push(select([{ value: 'sensor', label: 'Sensor' }, { value: 'state', label: 'State' }, { value: 'timer', label: 'Timer' }], c.src, function (e) { var src = e.target.value; var n = { src: src, op: src === 'timer' ? 'elapsed' : '>=', value: src === 'timer' ? 0 : (src === 'state' ? 1 : 0) }; if (src === 'sensor') { var s0 = CFG.sensors[0]; n.sensor_id = s0.sensor_id; n.controller_uuid = s0.controller_uuid; } if (src === 'state') { n.state_id = CFG.process_states[0].state_id; n.field = 'value_id'; } if (src === 'timer') n.timer_id = CFG.timers[0].timer_id; list[idx] = n; render(); }));
  if (c.src === 'sensor') {
    var key = refKey(c, 'sensor_id');
    var missing = !IDX.sensor.get(key);
    parts.push(select((missing ? [{ value: '', label: '— Sensor wählen —' }] : []).concat(sensorOptions()), missing ? '' : key, function (e) { var s = IDX.sensor.get(e.target.value); if (s) { c.sensor_id = s.sensor_id; c.controller_uuid = s.controller_uuid; delete c.filter_id; } render(); }, { style: { maxWidth: '300px' }, class: missing ? 'need' : '' }));
    var filters = CFG.filters.filter(function (f) { return arr(f.sensor_refs).some(function (r) { return refKey(r, 'sensor_id') === key; }); });
    parts.push(select([{ value: '', label: filters.length ? 'ungefiltert' : 'kein Filter verfügbar' }].concat(filters.map(function (f) { return { value: f.filter_id, label: 'Filter #' + f.filter_id + ' (' + arr(f.chain).map(function (s) { return s.type; }).join('→') + ')' }; })), c.filter_id === undefined ? '' : c.filter_id, function (e) { if (e.target.value === '') delete c.filter_id; else c.filter_id = num(e.target.value); render(); }, { disabled: !filters.length }));
    parts.push(select(RULE_OPS.map(function (o) { return { value: o, label: o }; }), c.op, function (e) { c.op = e.target.value; render(); }, { class: 'op' }));
    var isParam = isObj(c.value);
    parts.push(h('span.lab', { text: 'mit' }));
    var isBool = typeof c.value === 'boolean';
    parts.push(select([{ value: 'num', label: 'Zahl' }, { value: 'param', label: 'Parameter eines States' }, { value: 'bool', label: 'Wahrheitswert' }], isParam ? 'param' : isBool ? 'bool' : 'num', function (e) { if (e.target.value === 'param') { var st = CFG.process_states[0]; c.value = { param_of_state: st.state_id, key: Object.keys(st.parameters || {})[0] || 'target_temp_c', scale: 1 }; } else if (e.target.value === 'bool') { c.value = true; c.op = '=='; } else c.value = 0; render(); }));
    if (isParam) {
      var st = IDX.state.get(txt(c.value.param_of_state));
      var keys = st ? Object.keys(st.parameters || {}) : [];
      parts.push(select([{ value: '', label: '— State —' }].concat(stateOptions()), c.value.param_of_state === null ? '' : c.value.param_of_state, function (e) { c.value.param_of_state = num(e.target.value); var s2 = IDX.state.get(e.target.value); c.value.key = s2 ? (Object.keys(s2.parameters || {})[0] || c.value.key) : c.value.key; render(); }, { class: c.value.param_of_state === null ? 'need' : '' }));
      parts.push(select(keys.length ? keys.map(function (k) { return { value: k, label: k }; }) : [{ value: c.value.key, label: c.value.key + ' (State hat keine Parameter)' }], c.value.key, function (e) { c.value.key = e.target.value; render(); }));
      parts.push(h('span.lab', { text: '×' }));
      parts.push(input(c.value.scale === undefined ? 1 : c.value.scale, function (e) { c.value.scale = num(e.target.value); render(); }, { type: 'number', step: '0.01', class: 'num' }));
    } else if (isBool) {
      parts.push(select([{ value: 'true', label: 'wahr (true)' }, { value: 'false', label: 'falsch (false)' }], String(c.value), function (e) { c.value = e.target.value === 'true'; render(); }));
    } else {
      var s = IDX.sensor.get(key);
      parts.push(input(c.value, function (e) { c.value = num(e.target.value) === null ? 0 : num(e.target.value); render(); }, { type: 'number', step: 'any', class: 'num' }));
      if (s && unitOf(s)) parts.push(h('span.lab', { text: unitOf(s) }));
    }
  } else if (c.src === 'state') {
    parts.push(select(stateOptions(), c.state_id, function (e) { c.state_id = num(e.target.value); render(); }, { style: { maxWidth: '300px' } }));
    parts.push(select([{ value: 'value_id', label: 'value_id (Zustand)' }, { value: 'mode_id', label: 'mode_id (Betriebsart)' }], c.field || 'value_id', function (e) { c.field = e.target.value; render(); }));
    parts.push(select(RULE_OPS.map(function (o) { return { value: o, label: o }; }), c.op, function (e) { c.op = e.target.value; render(); }, { class: 'op' }));
    var opts = (c.field || 'value_id') === 'mode_id' ? CFG.process_modes.map(function (m) { return { value: m.mode_id, label: '#' + m.mode_id + ' ' + m.mode }; }) : CFG.process_values.map(function (v) { return { value: v.value_id, label: '#' + v.value_id + ' ' + v.state_value }; });
    parts.push(select(opts, c.value, function (e) { c.value = num(e.target.value); render(); }));
  } else {
    parts.push(select(CFG.timers.map(function (t) { return { value: t.timer_id, label: 'Timer #' + t.timer_id + ' · ' + t.description }; }), c.timer_id, function (e) { c.timer_id = num(e.target.value); render(); }, { style: { maxWidth: '300px' } }));
    parts.push(select([{ value: 'elapsed', label: 'abgelaufen (elapsed)' }, { value: 'fired', label: 'ausgelöst (fired)' }], c.op, function (e) { c.op = e.target.value; render(); }));
  }
  parts.push(h('span.lab', { text: 'Cooldown' }));
  parts.push(input(c.cooldown_s === undefined ? '' : c.cooldown_s, function (e) { var v = num(e.target.value); if (v === null) delete c.cooldown_s; else c.cooldown_s = v; }, { type: 'number', step: '0.1', class: 'num', placeholder: 's', style: { width: '64px' } }));
  parts.push(btn('', { icon: 'i-trash', size: 'xs', variant: 'ghost', title: 'Bedingung entfernen', onClick: function () { list.splice(idx, 1); render(); } }));
  var row = h('div.crow', null, parts);
  row.lastChild.classList.add('x');
  return row;
}
function actRow(a, list, idx) {
  var kind = a.notify !== undefined ? 'notify' : Array.isArray(a.p_ids) ? 'p_ids' : 'state_ids';
  var parts = [select([{ value: 'state_ids', label: 'States setzen' }, { value: 'p_ids', label: 'Prozesse setzen' }, { value: 'notify', label: 'Meldung' }], kind, function (e) { var k = e.target.value; list[idx] = k === 'notify' ? { notify: '' } : k === 'p_ids' ? { p_ids: [], value_id: 1 } : { state_ids: [], value_id: 1 }; render(); })];
  if (kind === 'notify') parts.push(input(a.notify, function (e) { a.notify = e.target.value; }, { placeholder: 'Nachricht', style: { flex: '1', minWidth: '220px' } }));
  else {
    var ids = kind === 'state_ids' ? a.state_ids : a.p_ids;
    var pool = kind === 'state_ids' ? CFG.process_states.map(function (s) { return { id: s.state_id, label: '#' + s.state_id + ' ' + (TYPE_LABEL[stateTypeOf(s)] || '?') }; }) : CFG.processes.map(function (p) { return { id: p.p_id, label: 'P' + p.p_id + ' ' + p.process_name }; });
    parts.push(h('div.chips', null, pool.map(function (it) { var on = ids.some(function (x) { return num(x) === num(it.id); }); return h('button.chipsel' + (on ? '.on' : ''), { type: 'button', onClick: function () { if (on) { var i = ids.findIndex(function (x) { return num(x) === num(it.id); }); ids.splice(i, 1); } else ids.push(it.id); render(); } }, h('span.mono', { text: it.label })); })));
    parts.push(h('span.lab', { text: ':=' }));
    parts.push(select([{ value: '', label: 'Wert unverändert' }].concat(CFG.process_values.map(function (v) { return { value: v.value_id, label: '#' + v.value_id + ' ' + v.state_value }; })), a.value_id === undefined ? '' : a.value_id, function (e) { if (e.target.value === '') delete a.value_id; else a.value_id = num(e.target.value); render(); }));
    var params = isObj(a.parameters) ? a.parameters : null;
    var keys = uniq(ids.reduce(function (acc, id) { var st = IDX.state.get(txt(id)); return acc.concat(st ? Object.keys(st.parameters || {}) : []); }, []));
    parts.push(select([{ value: '', label: 'kein Parameter' }].concat(keys.map(function (k) { return { value: k, label: 'setze ' + k }; })), params ? Object.keys(params)[0] || '' : '', function (e) { if (e.target.value === '') delete a.parameters; else { var o = {}; o[e.target.value] = params && params[Object.keys(params)[0]] !== undefined ? params[Object.keys(params)[0]] : 0; a.parameters = o; } render(); }));
    if (params) parts.push(input(params[Object.keys(params)[0]], function (e) { params[Object.keys(params)[0]] = num(e.target.value); render(); }, { type: 'number', step: 'any', class: 'num' }));
  }
  parts.push(btn('', { icon: 'i-trash', size: 'xs', variant: 'ghost', title: 'Aktion entfernen', onClick: function () { list.splice(idx, 1); render(); } }));
  var row = h('div.crow', null, parts); row.lastChild.classList.add('x'); return row;
}
function clause(kw, rows, addLabel, onAdd, isElse, emptyHint) {
  return h('div.clause', null, h('div.clause__kw' + (isElse ? '.else' : ''), { text: kw }), h('div.sent', null, rows.length ? rows : h('div.hint', { style: { padding: '6px 0' }, text: emptyHint }), h('div.addrow', null, btn(addLabel, { icon: 'i-plus', size: 'sm', variant: 'ghost', onClick: onAdd }))));
}
function renderRuleEditor() {
  var ed = S.editor, d = ed.draft;
  var meta = deriveRuleMeta(d);
  var problems = validateRuleDraft(d, meta);
  var useUntil = arr(d.until).length > 0;
  var head = h('div.form.form--4', { style: { marginBottom: '12px' } },
    field('Name', input(d.name, function (e) { d.name = e.target.value.trim(); render(); }, { placeholder: 'z. B. heat_on_temp_threshold' }), { key: 'name', required: true, wide: false }),
    field('Gruppe', select([{ value: 'process', label: 'process' }, { value: 'notify', label: 'notify' }, { value: 'safety', label: 'safety (kritisch, nur lokal)' }], d.group, function (e) { d.group = e.target.value; render(); }), { key: 'group' }),
    field('Priorität', input(d.priority, function (e) { d.priority = num(e.target.value) || 0; render(); }, { type: 'number', min: 0 }), { key: 'priority', hint: meta.needsCoordinator ? 'cross-worker: ≥ ' + meta.minPrio : 'Auswertung aufsteigend' }),
    field('rule_id', input(d.rule_id, function (e) { d.rule_id = num(e.target.value); render(); }, { type: 'number', min: 1 }), { key: 'rule_id' }),
    field('Beschreibung', input(d.description || '', function (e) { d.description = e.target.value; }, { placeholder: 'Wozu dient die Regel?' }), { key: 'description', wide: true }));
  var sentence = h('div.sent', null,
    clause('WENN', arr(d.when).map(function (c, i) { return condRow(c, d.when, i); }), 'Bedingung (UND)', function () { var s0 = CFG.sensors[0]; d.when.push({ src: 'sensor', op: '>=', value: 0, sensor_id: s0.sensor_id, controller_uuid: s0.controller_uuid }); render(); }, false, 'Mindestens eine Bedingung — alle müssen zutreffen (UND).'),
    h('div.clause', null, h('div.clause__kw', { text: 'BIS' }), h('div', null, h('label.row', { style: { padding: '6px 0' } }, h('input', { type: 'checkbox', checked: useUntil, onChange: function (e) { if (e.target.checked) { var w = arr(d.when).filter(function (c) { return c.src === 'sensor'; })[0]; d.until = [w ? Object.assign(clone(w), { op: '<=', value: isObj(w.value) ? 0 : num(w.value) - 10 }) : { src: 'sensor', op: '<=', value: 0, sensor_id: CFG.sensors[0].sensor_id, controller_uuid: CFG.sensors[0].controller_uuid }]; } else d.until = []; render(); } }), h('span', { text: 'Hysterese: Regel bleibt erfüllt, bis diese Bedingung eintritt (Schmitt-Trigger, until[])' })), useUntil ? h('div.sent', null, arr(d.until).map(function (c, i) { return condRow(c, d.until, i); })) : null)),
    clause('DANN', arr(d.do).map(function (a, i) { return actRow(a, d.do, i); }), 'Aktion', function () { d.do.push({ state_ids: [], value_id: 1 }); render(); }, false, 'Mindestens eine Aktion.'),
    clause('SONST', arr(d.else_do).map(function (a, i) { return actRow(a, d.else_do, i); }), 'Gegenaktion', function () { var mirror = arr(d.do).filter(function (a) { return Array.isArray(a.state_ids) && a.value_id !== undefined; })[0]; d.else_do.push(mirror ? { state_ids: mirror.state_ids.slice(), value_id: num(mirror.value_id) === 1 ? 2 : 1 } : { state_ids: [], value_id: 2 }); render(); }, true, 'Optional — läuft, wenn WENN nicht (mehr) zutrifft. „Gegenaktion“ spiegelt DANN automatisch.'));
  var lifecycle = h('div.note', { style: { marginTop: '12px' } }, h('div.row', null, h('b', { text: 'Abgeleitet: ' }), badge('owner ' + meta.owner, null, true), badge(meta.execution_scope, null, true), badge(meta.deployment_status, meta.deployment_status === 'active_node' ? 'ok' : 'warn', true), badge(meta.activation_state, meta.activation_state === 'active' ? 'ok' : 'warn', true), scopeBadge(meta.scope), badge('epoch ' + d.execution_epoch, null, true), d.latch ? badge('latch ' + d.latch, d.latch === 'manual' ? 'info' : 'warn', true) : null, h('label.row', { style: { marginLeft: 'auto' } }, h('input', { type: 'checkbox', checked: d.enabled !== false, onChange: function (e) { d.enabled = e.target.checked; render(); } }), 'aktiv')), h('div.hint', { style: { marginTop: '4px' }, text: 'owner_node_id, execution_owner, execution_scope und deployment_status folgen aus den beteiligten Geräten und Ziel-States — sie müssen nicht mehr von Hand gesetzt werden. Abweichungen unter „Erweitert“.' }));
  var ov = ed.overrides = ed.overrides || {};
  var advanced = h('details.adv', { open: !!(ov.deployment || ov.activation || d.latch) }, h('summary', null, 'Erweitert: Latch, Lifecycle, Epoch', h('span.hint', { style: { fontWeight: '500' }, text: '— alle übrigen Felder des V9-Vertrags' })),
    h('div.adv__body', null, h('div.form.form--4', null,
      field('Latch (Verriegelung)', select([{ value: '', label: 'kein Latch' }, { value: 'manual', label: 'manual — hält bis reset_rule_latch()' }, { value: 'auto', label: 'auto — wirkungslos (Runtime-No-Op)' }], d.latch || '', function (e) { if (e.target.value) d.latch = e.target.value; else delete d.latch; render(); }), { key: 'latch', hint: d.latch === 'auto' ? 'Validator warnt: latch_auto_noop.' : 'Schmitt-Trigger lieber über BIS (until[]).' }),
      field('activation_state', select([{ value: '', label: 'automatisch (' + (d.enabled === false ? 'inactive' : 'active') + ')' }, { value: 'staged', label: 'staged — vorbereitet, noch nicht aktiv' }, { value: 'active', label: 'active' }, { value: 'retiring', label: 'retiring — läuft aus' }, { value: 'inactive', label: 'inactive' }], ov.activation || '', function (e) { if (e.target.value) ov.activation = e.target.value; else delete ov.activation; render(); }), { key: 'activation_state' }),
      field('deployment_status', select([{ value: '', label: 'automatisch (' + meta.autoDeploy + ')' }, { value: 'active_node', label: 'active_node' }, { value: 'active_cross', label: 'active_cross' }, { value: 'replaced_local', label: 'replaced_local — durch lokale Regel ersetzt' }, { value: 'monitor_only', label: 'monitor_only — nur beobachten' }, { value: 'disabled_with_reason', label: 'disabled_with_reason' }], ov.deployment || '', function (e) { if (e.target.value) ov.deployment = e.target.value; else delete ov.deployment; render(); }), { key: 'deployment_status', hint: d.enabled === false ? 'Regel ist deaktiviert → disabled_with_reason.' : '' }),
      field('execution_epoch', input(d.execution_epoch, function (e) { d.execution_epoch = num(e.target.value) || 0; render(); }, { type: 'number', min: 0 }), { key: 'execution_epoch', hint: 'Monotoner Fencing-Zähler; beim Rollout +1, veraltet → execution_epoch_stale.' }),
      (meta.deployment_status === 'disabled_with_reason') ? field('Begründung', input(d.disabled_reason || '', function (e) { d.disabled_reason = e.target.value; }, { placeholder: 'Pflicht bei disabled_with_reason' }), { key: 'disabled_reason', required: true, wide: true }) : null,
      field('engine_id', h('div.note', { text: '1 — V9 hat genau eine Engine (Singleton).' }), { key: 'engine_id' }))));
  var flow = h('div.card', { style: { marginBottom: '12px' } }, h('div.card__head', null, h('h3', null, icon('i-flow', 'ico--sm'), 'Signalfluss (live)'), h('div.acts', null, pill('Bedingungen → Gatter → Aktionen → Aktoren', 'info'))), h('div.card__body', { style: { padding: '10px 14px' } }, ruleFlowSvg(d, { noStamp: true })));
  var bar = h('div.row.row--between', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line)' } },
    h('div.row', null, problems.length ? problems.map(function (p) { return badge(p, 'danger'); }) : badge('gültig nach V9-Vertrag', 'ok')),
    h('div.row', null, ed.isNew ? null : btn('Duplizieren', { icon: 'i-copy', onClick: function () { var c = clone(d); c.rule_id = maxId(CFG.rules, 'rule_id') + 1; c.name = c.name + '_copy'; S.editor = { kind: 'rule', isNew: true, draft: c }; render(); } }), ed.isNew ? null : btn('Löschen', { icon: 'i-trash', variant: 'danger', onClick: function () { deleteRule(ed.original); } }), btn('Abbrechen', { variant: 'ghost', onClick: function () { S.editor = null; render(); } }), btn(ed.isNew ? 'Regel anlegen' : 'Speichern', { variant: 'primary', icon: 'i-check', disabled: problems.length > 0, onClick: function () { saveRule(meta); } })));
  var patternBar = ed.isNew ? h('div.row', { style: { marginBottom: '12px' } }, h('span.hint', { text: 'Muster:' }), h('div.seg', null, RULE_PATTERNS.map(function (p) { return h('button' + (ed.pattern === p.id ? '.active' : ''), { type: 'button', text: p.title, onClick: function () { S.editor = newRuleEditor({ pattern: p }); render(); } }); }))) : null;
  var openNote = ed.fromLibrary && ed.open && ed.open.length ? h('div.note.note--warn', { style: { marginBottom: '10px' }, text: 'Aus Bibliothek übernommen — bitte prüfen: ' + ed.open.join(', ') + '. Vorbelegt wurde der erste passende Sensor/State.' }) : null;
  return h('div', null, h('div.row.row--between', { style: { marginBottom: '10px' } }, h('h3', { style: { fontSize: '15px', fontWeight: '750' }, text: ed.isNew ? 'Neue Regel' : 'Regel #' + ed.original + ' bearbeiten' }), h('div.row', null, scopeBadge(meta.scope), isChanged('rules', d.rule_id) ? badge('geändert', 'accent') : null)), patternBar, openNote, flow, h('div.card', null, h('div.card__body', null, head, sentence, lifecycle, advanced, bar)));
}
function validateRuleDraft(d, meta) {
  var out = [];
  if (!d.name) out.push('Name fehlt');
  if (!arr(d.when).length) out.push('when[] leer');
  if (!arr(d.do).length) out.push('do[] leer');
  arr(d.when).concat(arr(d.until)).forEach(function (c) { if (c.src === 'sensor' && !IDX.sensor.get(refKey(c, 'sensor_id'))) out.push('Sensor fehlt'); if (c.src === 'state' && !IDX.state.get(txt(c.state_id))) out.push('State fehlt'); if (c.src === 'timer' && !IDX.timer.get(txt(c.timer_id))) out.push('Timer fehlt'); if (isObj(c.value) && c.value.param_of_state === null) out.push('param_of_state fehlt'); });
  arr(d.do).forEach(function (a) { if (Array.isArray(a.state_ids) && !a.state_ids.length) out.push('Aktion ohne Ziel'); if (a.notify !== undefined && !a.notify) out.push('Meldung leer'); });
  
  if (meta.critical && meta.scope !== 'local_controller') out.push('kritische Gruppe nicht lokal');
  var dup = CFG.rules.some(function (r) { return num(r.rule_id) === num(d.rule_id) && (S.editor.isNew || num(r.rule_id) !== num(S.editor.original)); });
  if (dup) out.push('rule_id existiert');
  if (meta.deployment_status === 'disabled_with_reason' && !txt(d.disabled_reason).trim()) out.push('disabled_reason fehlt');
  return uniq(out);
}
function saveRule(meta) {
  var ed = S.editor, d = clone(ed.draft);
  d.owner_node_id = meta.owner; d.execution_owner = meta.owner; d.execution_scope = meta.execution_scope; d.deployment_status = meta.deployment_status; d.activation_state = meta.activation_state;
  if (meta.scope !== 'local_controller') d.cross_domain_id = meta.owner + '.default'; else delete d.cross_domain_id;
  if (!arr(d.until).length) delete d.until; if (!arr(d.else_do).length) delete d.else_do;
  if (meta.deployment_status === 'disabled_with_reason') d.disabled_reason = d.disabled_reason || 'Im Editor deaktiviert'; else delete d.disabled_reason;
  if (!d.latch) delete d.latch;
  pushHistory('Regel ' + d.rule_id);
  if (ed.isNew) CFG.rules.push(d); else { var i = CFG.rules.findIndex(function (r) { return num(r.rule_id) === num(ed.original); }); CFG.rules[i] = d; }
  commitModel(); markChanged('rules', d.rule_id); S.sel.rules = d.rule_id; S.editor = null; toast((ed.isNew ? 'Regel angelegt: ' : 'Regel gespeichert: ') + '#' + d.rule_id, 'ok'); render();
}
function renderRuleContext() {
  var d = S.editor.draft, meta = deriveRuleMeta(d);
  var devs = [];
  arr(d.when).concat(arr(d.until)).forEach(function (c) { if (c.src === 'sensor') { var s = IDX.sensor.get(refKey(c, 'sensor_id')); if (s) devs.push({ label: devShort(s, 'sensor'), sub: 'liest · ' + devTitle(s, 'sensor'), node: s.node_id }); } });
  arr(d.do).concat(arr(d.else_do)).forEach(function (a) { arr(a.state_ids).forEach(function (id) { var st = IDX.state.get(txt(id)); if (!st) return; arr(st.io_refs.actuators).forEach(function (r) { var x = IDX.actuator.get(refKey(r, 'actuator_id')); if (x) devs.push({ label: devShort(x, 'actuator'), sub: 'schreibt via State ' + id, node: x.node_id }); }); }); });
  var scopeText = { local_controller: 'Alle Signale auf einem Controller — die Regel läuft im Node-Shard.', cross_controller: 'Mehrere Controller auf ' + meta.owner + ' — V8-Cross-Shard, Coordinator auf dem Node.', cross_worker: 'Signale auf ' + meta.nodes.join(' und ') + ' — nur der Site-Coordinator führt aus. Priorität ≥ ' + meta.minPrio + ' erforderlich.', unbound: 'Noch keine Geräte beteiligt.', invalid: 'Unbekannte Geräte-Identität.' }[meta.scope];
  var out = canonicalRule(d, meta);
  return h('div', null,
    ctxSec('Scope & Ausführung (live)', h('div', null, h('div.row', { style: { marginBottom: '6px' } }, scopeBadge(meta.scope), badge(meta.execution_scope, null, true)), h('div.hint', { text: scopeText }))),
    ctxSec('Betroffene Geräte', devs.length ? h('div.impact', null, uniq(devs.map(function (x) { return JSON.stringify(x); })).map(function (j) { var x = JSON.parse(j); return h('div.i', null, h('b', { text: x.label }), h('span.mono', { text: x.node }), h('span', { style: { color: 'var(--muted)' }, text: x.sub })); })) : h('div.hint', { text: 'Noch keine Geräte.' })),
    (function () { var band = switchingBehaviourSvg(d); return band ? ctxSec('Schaltverhalten', band) : null; })(),
    ctxSec('Klartext', h('div.note', { text: 'Wenn ' + arr(d.when).map(describeCond).join(' und ') + (arr(d.until).length ? ', bis ' + arr(d.until).map(describeCond).join(' und ') : '') + ' → ' + arr(d.do).map(describeAct).join('; ') + (arr(d.else_do).length ? ' — sonst ' + arr(d.else_do).map(describeAct).join('; ') : '') + '.' })),
    ctxSec('V9-Vorschau (rules[])', jsonPre(out)));
}
function canonicalRule(d, meta) {
  var o = { rule_id: d.rule_id, engine_id: 1, owner_node_id: meta.owner, execution_owner: meta.owner, execution_scope: meta.execution_scope, execution_epoch: d.execution_epoch, deployment_status: meta.deployment_status, activation_state: meta.activation_state, group: d.group, priority: d.priority, name: d.name, enabled: d.enabled !== false, when: d.when };
  if (arr(d.until).length) o.until = d.until;
  o.do = d.do; if (arr(d.else_do).length) o.else_do = d.else_do;
  if (d.latch) o.latch = d.latch;
  if (meta.deployment_status === 'disabled_with_reason') o.disabled_reason = d.disabled_reason || 'Im Editor deaktiviert';
  if (d.description) o.description = d.description;
  if (meta.scope !== 'local_controller') o.cross_domain_id = meta.owner + '.default';
  return o;
}

/* ------------------------------------------------------------------ rule visualisation: signal-flow diagram */
function svgEl(tag, attrs) {
  var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'onClick') n.addEventListener('click', attrs[k]); else n.setAttribute(k, attrs[k]); });
  return n;
}
function condLines(c) {
  if (c.src === 'sensor') {
    var s = IDX.sensor.get(refKey(c, 'sensor_id'));
    var v = isObj(c.value) ? (c.value.scale !== undefined ? c.value.scale + ' × ' : '') + 'State ' + c.value.param_of_state + '.' + c.value.key : txt(c.value) + (s && unitOf(s) ? ' ' + unitOf(s) : '');
    return { a: s ? devShort(s, 'sensor') : '(Sensor wählen)', b: (c.filter_id !== undefined ? 'Filter ' + c.filter_id + ' · ' : '') + c.op + ' ' + v, kind: 'sensor', sensor: s };
  }
  if (c.src === 'state') { var st = IDX.state.get(txt(c.state_id)); return { a: 'State ' + c.state_id + (st ? ' · ' + (TYPE_LABEL[stateTypeOf(st)] || '') : ''), b: (c.field || 'value_id') + ' ' + c.op + ' ' + ((c.field || 'value_id') === 'value_id' ? valueName(c.value) : modeName(c.value)), kind: 'state' }; }
  if (c.src === 'timer') { var t = IDX.timer.get(txt(c.timer_id)); return { a: 'Timer ' + c.timer_id + (t ? ' · ' + TIMER_KIND[timerKind(t)] : ''), b: c.op === 'fired' ? 'ausgelöst (fired)' : 'abgelaufen (elapsed)', kind: 'timer' }; }
  return { a: txt(c.src), b: txt(c.op) + ' ' + txt(c.value), kind: 'other' };
}
function actLines(a) {
  if (a.notify !== undefined) return { a: 'Meldung', b: '„' + txt(a.notify).slice(0, 30) + '“', kind: 'notify', targets: [] };
  var ids = Array.isArray(a.state_ids) ? a.state_ids : Array.isArray(a.p_ids) ? a.p_ids : [];
  var isProc = Array.isArray(a.p_ids);
  var parts = [];
  if (a.value_id !== undefined) parts.push(':= ' + valueName(a.value_id));
  if (isObj(a.parameters)) parts.push(Object.keys(a.parameters).map(function (k) { return k + ' = ' + a.parameters[k]; }).join(', '));
  return { a: (isProc ? 'Prozess ' : 'State ') + ids.join(', '), b: parts.join(' · ') || '—', kind: isProc ? 'process' : 'state', targets: isProc ? [] : ids };
}
/** Signal-flow diagram: conditions → AND gate (→ until loop) → actions → actuators. */
function ruleFlowSvg(rule, opts) {
  var o = opts || {};
  var when = arr(rule.when), until = arr(rule.until), dos = arr(rule.do), elses = arr(rule.else_do);
  var W = 760, rowH = 48, gap = 10;
  var condH = when.length * (rowH + gap), untilH = until.length * (rowH + gap);
  var acts = dos.map(function (a) { return { a: a, isElse: false }; }).concat(elses.map(function (a) { return { a: a, isElse: true }; }));
  var actH = acts.length * (rowH + gap);
  var leftH = condH + (until.length ? untilH + 26 : 0);
  var H = Math.max(leftH, actH, rowH) + 44;
  var svg = svgEl('svg', { class: 'flowsvg', viewBox: '0 0 ' + W + ' ' + H });
  var edges = svgEl('g'), nodes = svgEl('g'); svg.appendChild(edges); svg.appendChild(nodes);
  var xC = 8, wC = 236, xG = 280, wG = 44, xA = 372, wA = 238, xD = 640, wD = 112;
  var top = 26;
  function box(x, y, w, h, cls, l1, l2, extra) {
    var g = svgEl('g', extra || {});
    g.appendChild(svgEl('rect', { x: x, y: y, width: w, height: h, rx: 7, class: cls }));
    g.appendChild(svgEl('text', { x: x + 10, y: y + 19, class: 't', text: l1 }));
    if (l2) g.appendChild(svgEl('text', { x: x + 10, y: y + 35, class: 's', text: l2 }));
    nodes.appendChild(g); return g;
  }
  function edge(x1, y1, x2, y2, cls) { var mx = (x1 + x2) / 2; edges.appendChild(svgEl('path', { d: 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2, class: 'e ' + cls })); }
  nodes.appendChild(svgEl('text', { x: xC, y: 14, class: 'kw', text: 'WENN (UND)' }));
  nodes.appendChild(svgEl('text', { x: xA, y: 14, class: 'kw', text: 'DANN / SONST' }));
  nodes.appendChild(svgEl('text', { x: xD, y: 14, class: 'kw', text: 'AKTOREN' }));
  // conditions
  var gateY = top + Math.max(0, condH - gap) / 2;
  when.forEach(function (c, i) {
    var y = top + i * (rowH + gap); var L = condLines(c);
    var g = box(xC, y, wC, rowH, 'cond', L.a.slice(0, 34), L.b.slice(0, 40));
    if (L.kind === 'sensor' && L.sensor && !isObj(c.value)) thresholdBand(g, xC + 150, y + 6, 78, L.sensor, c, until.filter(function (u) { return u.src === 'sensor' && refKey(u, 'sensor_id') === refKey(c, 'sensor_id'); })[0]);
    edge(xC + wC, y + rowH / 2, xG, when.length > 1 ? gateY + 22 : y + rowH / 2, 'e--in');
  });
  // gate
  var gateH = when.length > 1 ? 44 : rowH;
  var gy = when.length > 1 ? gateY : top;
  var gate = svgEl('g', { class: 'gate' });
  gate.appendChild(svgEl('rect', { x: xG, y: gy, width: wG, height: gateH, rx: 8, class: 'gate' }));
  gate.appendChild(svgEl('text', { x: xG + wG / 2, y: gy + gateH / 2 + 5, 'text-anchor': 'middle', text: when.length > 1 ? '&' : '▶' }));
  nodes.appendChild(gate);
  var gateMid = gy + gateH / 2;
  // until
  if (until.length) {
    var uy0 = top + condH + 14;
    nodes.appendChild(svgEl('text', { x: xC, y: uy0 - 2, class: 'kw', text: 'BIS (Hysterese · until[])' }));
    until.forEach(function (c, i) {
      var y = uy0 + 4 + i * (rowH + gap); var L = condLines(c);
      box(xC, y, wC, rowH, 'cond cond--until', L.a.slice(0, 34), L.b.slice(0, 40));
      edges.appendChild(svgEl('path', { d: 'M' + (xC + wC) + ',' + (y + rowH / 2) + ' C' + (xG + 10) + ',' + (y + rowH / 2) + ' ' + (xG + wG / 2) + ',' + (gy + gateH + 30) + ' ' + (xG + wG / 2) + ',' + (gy + gateH), class: 'e e--loop' }));
    });
  }
  // actions
  acts.forEach(function (it, i) {
    var y = top + i * (rowH + gap); var L = actLines(it.a);
    var cls = 'act' + (it.isElse ? ' act--else' : '') + (L.kind === 'notify' ? ' act--notify' : '');
    box(xA, y, wA, rowH, cls, (it.isElse ? 'SONST · ' : '') + L.a.slice(0, 30), L.b.slice(0, 42));
    edge(xG + wG, gateMid, xA, y + rowH / 2, it.isElse ? 'e--else' : 'e--do');
    // actuators behind target states
    var devs = [];
    L.targets.forEach(function (id) { var st = IDX.state.get(txt(id)); if (st) arr(st.io_refs.actuators).forEach(function (r) { var a = IDX.actuator.get(refKey(r, 'actuator_id')); if (a) devs.push(a); }); });
    devs = devs.slice(0, 2);
    devs.forEach(function (a, j) {
      var dy = y + j * 24;
      var g = svgEl('g'); g.appendChild(svgEl('rect', { x: xD, y: dy, width: wD, height: 20, rx: 5, class: 'dev' }));
      g.appendChild(svgEl('text', { x: xD + 7, y: dy + 14, class: 's', text: devShort(a, 'actuator').slice(0, 18) }));
      nodes.appendChild(g);
      edge(xA + wA, y + rowH / 2, xD, dy + 10, it.isElse ? 'e--else' : '');
    });
  });
  // stamp
  if (!o.noStamp) {
    var sc = ruleScope(rule);
    var st = svgEl('g'); st.appendChild(svgEl('rect', { x: W - 150, y: 2, width: 148, height: 18, rx: 4, class: 'stamp' }));
    st.appendChild(svgEl('text', { x: W - 76, y: 14, 'text-anchor': 'middle', class: 's', text: 'P' + rule.priority + ' · ' + (SCOPE_LABEL[sc] || sc) + ' · ' + txt(rule.group) }));
    nodes.appendChild(st);
  }
  return svg;
}
/** Mini threshold band inside a condition node: sensor range, ON mark and OFF (until) mark. */
function thresholdBand(g, x, y, w, sensor, cond, untilCond) {
  var p = profileOf(sensor.profile_id);
  var lo = p ? num(p.eng_min) : 0, hi = p ? num(p.eng_max) : 100;
  var on = num(cond.value), off = untilCond && !isObj(untilCond.value) ? num(untilCond.value) : null;
  if (on === null) return;
  if (!p) { lo = 0; hi = Math.max(on, off || 0) * 1.5 || 100; }
  var h = 12;
  function px(v) { return x + Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1))) * w; }
  g.appendChild(svgEl('rect', { x: x, y: y, width: w, height: h, rx: 3, class: 'band' }));
  var geq = cond.op === '>=' || cond.op === '>';
  var onX = px(on);
  g.appendChild(svgEl('rect', { x: geq ? onX : x, y: y, width: geq ? x + w - onX : onX - x, height: h, rx: 3, class: 'band-on' }));
  if (off !== null) { var offX = px(off); g.appendChild(svgEl('rect', { x: Math.min(onX, offX), y: y + 2, width: Math.abs(onX - offX), height: h - 4, class: 'band-hyst' })); g.appendChild(svgEl('line', { x1: offX, y1: y - 2, x2: offX, y2: y + h + 2, class: 'mark-off' })); }
  g.appendChild(svgEl('line', { x1: onX, y1: y - 2, x2: onX, y2: y + h + 2, class: 'mark-on' }));
  g.appendChild(svgEl('text', { x: x, y: y + h + 11, class: 's', text: String(lo) }));
  g.appendChild(svgEl('text', { x: x + w, y: y + h + 11, 'text-anchor': 'end', class: 's', text: String(hi) + (p ? ' ' + p.unit : '') }));
}
/** Larger stand-alone band for the context pane ("Schaltverhalten"). */
function switchingBehaviourSvg(rule) {
  var c = arr(rule.when).filter(function (x) { return x.src === 'sensor' && !isObj(x.value); })[0];
  if (!c) return null;
  var s = IDX.sensor.get(refKey(c, 'sensor_id')); if (!s) return null;
  var u = arr(rule.until).filter(function (x) { return x.src === 'sensor' && refKey(x, 'sensor_id') === refKey(c, 'sensor_id'); })[0];
  var W = 300, H = 96;
  var svg = svgEl('svg', { class: 'flowsvg', viewBox: '0 0 ' + W + ' ' + H });
  var g = svgEl('g'); svg.appendChild(g);
  g.appendChild(svgEl('text', { x: 0, y: 12, class: 'kw', text: devShort(s, 'sensor') + (c.filter_id !== undefined ? ' · Filter ' + c.filter_id : '') }));
  thresholdBand(g, 6, 26, W - 12, s, c, u);
  var p = profileOf(s.profile_id);
  var lo = p ? num(p.eng_min) : 0, hi = p ? num(p.eng_max) : Math.max(num(c.value), u ? num(u.value) : 0) * 1.5;
  function px(v) { return 6 + Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1))) * (W - 12); }
  var onX = px(num(c.value));
  g.appendChild(svgEl('text', { x: Math.min(W - 60, Math.max(0, onX - 20)), y: 66, class: 's', text: 'EIN ' + c.op + ' ' + c.value }));
  if (u) { var offX = px(num(u.value)); g.appendChild(svgEl('text', { x: Math.min(W - 60, Math.max(0, offX - 20)), y: 80, class: 's', text: 'AUS ' + u.op + ' ' + u.value + ' (Hysterese ' + Math.abs(num(c.value) - num(u.value)) + ')' })); }
  else g.appendChild(svgEl('text', { x: 0, y: 80, class: 's', text: 'AUS sobald Bedingung nicht mehr gilt (keine Hysterese)' }));
  return svg;
}

/* ------------------------------------------------------------------ rules overview modes: table | matrix | ladder */
function ruleReads(r) {
  var out = { sensors: new Map(), states: new Map(), timers: new Map() };
  arr(r.when).forEach(function (c) { if (c.src === 'sensor') out.sensors.set(refKey(c, 'sensor_id'), 'w'); if (c.src === 'state') out.states.set(txt(c.state_id), 'r'); if (c.src === 'timer') out.timers.set(txt(c.timer_id), 'r'); if (isObj(c.value) && c.value.param_of_state !== undefined) out.states.set(txt(c.value.param_of_state), 'p'); });
  arr(r.until).forEach(function (c) { if (c.src === 'sensor') out.sensors.set(refKey(c, 'sensor_id'), 'u'); });
  return out;
}
function ruleWrites(r) {
  var out = new Map();
  arr(r.do).forEach(function (a) { arr(a.state_ids).forEach(function (id) { out.set(txt(id), { kind: 'w', v: a.value_id, params: isObj(a.parameters) }); }); });
  arr(r.else_do).forEach(function (a) { arr(a.state_ids).forEach(function (id) { var cur = out.get(txt(id)); out.set(txt(id), Object.assign(cur || { kind: 'e' }, { ev: a.value_id })); }); });
  return out;
}
function renderRulesMatrix() {
  var rules = CFG.rules.slice().sort(function (a, b) { return num(a.priority) - num(b.priority) || num(a.rule_id) - num(b.rule_id); });
  var sensorKeys = [], stateKeys = [];
  rules.forEach(function (r) { var rd = ruleReads(r); rd.sensors.forEach(function (v, k) { if (sensorKeys.indexOf(k) < 0) sensorKeys.push(k); }); rd.states.forEach(function (v, k) { if (stateKeys.indexOf(k) < 0) stateKeys.push(k); }); ruleWrites(r).forEach(function (v, k) { if (stateKeys.indexOf(k) < 0) stateKeys.push(k); }); });
  stateKeys.sort(function (a, b) { return num(a) - num(b); });
  var writers = {}; stateKeys.forEach(function (k) { writers[k] = rules.filter(function (r) { return ruleWrites(r).has(k) && r.enabled !== false; }); });
  var head = h('tr', null, h('th.rowh', { text: 'Regel ↓ · Signal →' }), sensorKeys.map(function (k) { var s = IDX.sensor.get(k); return h('th', { title: s ? devTitle(s, 'sensor') : k }, h('div', { text: s ? 'S' + s.sensor_id : '?' }), h('div', { style: { fontWeight: '500' }, text: s ? ctrlKey(s.controller_uuid).replace('ctrl_', '') : '' })); }), stateKeys.map(function (k) { var st = IDX.state.get(k); var n = writers[k].length; return h('th' + (n > 1 ? '.conflict' : ''), { title: st ? TYPE_LABEL[stateTypeOf(st)] : '' }, h('div', { text: '#' + k }), h('div', { style: { fontWeight: '500' }, text: st ? (TYPE_LABEL[stateTypeOf(st)] || '') : 'fehlt' }), n > 1 ? h('div', { text: n + ' Schreiber' }) : null); }));
  var rows = rules.map(function (r) {
    var rd = ruleReads(r), wr = ruleWrites(r);
    return h('tr', null, h('td.rowh', null, h('div.row', { style: { gap: '6px' } }, h('span.prio', { text: 'P' + r.priority }), h('b', { text: '#' + r.rule_id }), h('span', { style: { color: r.enabled === false ? 'var(--faint)' : 'inherit', textDecoration: r.enabled === false ? 'line-through' : 'none' }, text: r.name })), h('div.row', { style: { gap: '4px', marginTop: '2px' } }, scopeBadge(ruleScope(r)), badge(r.group, r.group === 'notify' ? 'info' : null))),
      sensorKeys.map(function (k) { var v = rd.sensors.get(k); return h('td', null, v ? h('span.cell' + (v === 'u' ? '.cell--u' : '.cell--r'), { title: v === 'u' ? 'gelesen in when + until (Hysterese)' : 'gelesen in when', text: v === 'u' ? '⇅' : '●' }) : null); }),
      stateKeys.map(function (k) { var w = wr.get(k), rdv = rd.states.get(k); var cells = [];
        if (rdv === 'r') cells.push(h('span.cell.cell--n', { title: 'Bedingung auf State', text: '?' }));
        if (rdv === 'p') cells.push(h('span.cell.cell--p', { title: 'Parameterbezug (param_of_state)', text: 'ƒ' }));
        if (w && w.kind === 'w') cells.push(h('span.cell.cell--w', { title: 'do: ' + (w.v !== undefined ? 'value_id ' + w.v : '') + (w.params ? ' + parameters' : ''), text: w.v !== undefined ? String(w.v) : (w.params ? 'p' : '·') }));
        if (w && w.ev !== undefined) cells.push(h('span.cell.cell--e', { title: 'else_do: value_id ' + w.ev, text: String(w.ev) }));
        return h('td', null, h('div.row', { style: { gap: '2px', justifyContent: 'center' } }, cells)); }),
      h('td', null, h('button.link.link--accent', { type: 'button', text: 'Bearbeiten', onClick: function () { S.sel.rules = r.rule_id; S.editor = ruleEditorFor(r); render(); } })));
  });
  var conflicts = stateKeys.filter(function (k) { return writers[k].length > 1; }).map(function (k) { var ws = writers[k]; var same = ws.filter(function (a, i) { return ws.some(function (b, j) { return j !== i && num(a.priority) === num(b.priority); }); }); return h('div.conf', null, icon('i-warn', 'ico--sm'), h('span', null, h('b', { text: 'State #' + k + ': ' + ws.length + ' Schreiber' }), ' — ' + ws.map(function (r) { return '#' + r.rule_id + ' (P' + r.priority + ')'; }).join(', ') + '. Auswertung nach (priority, rule_id), der letzte Schreiber gewinnt' + (same.length ? '; gleiche Priorität bei ' + same.map(function (r) { return '#' + r.rule_id; }).join(', ') + ' → Reihenfolge nur über rule_id.' : '.'))); });
  return h('div', null, h('div.tblwrap', { style: { maxHeight: '60vh', overflow: 'auto' } }, h('table.mx', null, h('thead', null, head), h('tbody', null, rows))),
    h('div', { style: { padding: '10px 14px', display: 'grid', gap: '6px' } }, h('div.legend', null, h('span', null, h('span.cell.cell--r', { text: '●' }), ' liest Sensor'), h('span', null, h('span.cell.cell--u', { text: '⇅' }), ' Hysterese (when + until)'), h('span', null, h('span.cell.cell--n', { text: '?' }), ' Bedingung auf State'), h('span', null, h('span.cell.cell--p', { text: 'ƒ' }), ' Parameterbezug'), h('span', null, h('span.cell.cell--w', { text: '1' }), ' do → value_id'), h('span', null, h('span.cell.cell--e', { text: '2' }), ' else_do → value_id')), conflicts));
}
function renderRulesLadder() {
  var engine = arr(CFG.rule_engine)[0] || {};
  var minPrio = (isObj(engine.runtime) ? engine.runtime.coordinator_min_priority : 1000) || 1000;
  var groups = {};
  CFG.rules.forEach(function (r) { (groups[r.priority] = groups[r.priority] || []).push(r); });
  var prios = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
  var rows = [], coordDrawn = false;
  prios.forEach(function (p) {
    if (!coordDrawn && p >= minPrio) { rows.push(h('div.ladder__coord', { text: 'ab ' + minPrio + ': Site-Coordinator (cross-worker)' })); coordDrawn = true; }
    var rs = groups[p].sort(function (a, b) { return num(a.rule_id) - num(b.rule_id); });
    var written = {}; rs.forEach(function (r) { ruleWrites(r).forEach(function (v, k) { (written[k] = written[k] || []).push(r.rule_id); }); });
    var dup = Object.keys(written).filter(function (k) { return written[k].length > 1; });
    rows.push(h('div.ladder__row', null, h('div.ladder__p', { text: 'P' + p }), h('div', null, h('div.ladder__rules', null, rs.map(function (r) { var sc = ruleScope(r); return h('button.rchip' + (sc === 'cross_worker' ? '.rchip--cross' : sc === 'cross_controller' ? '.rchip--warn' : '') + (r.enabled === false ? '.rchip--off' : ''), { type: 'button', title: arr(r.when).map(describeCond).join(' ∧ ') + ' → ' + arr(r.do).map(describeAct).join('; '), onClick: function () { S.sel.rules = r.rule_id; S.editor = ruleEditorFor(r); render(); } }, h('b', { text: '#' + r.rule_id }), h('span', { text: r.name }), h('span.mono', { text: Array.from(ruleWrites(r).keys()).map(function (k) { return '→' + k; }).join(' ') || '→ notify' })); })), dup.length ? h('div.hint', { style: { marginTop: '4px', color: 'var(--warn-fg)' }, text: 'Gleiche Priorität, gleiches Ziel: State ' + dup.join(', ') + ' — Reihenfolge nur über rule_id.' }) : null)));
  });
  if (!coordDrawn) rows.push(h('div.ladder__coord', { text: 'ab ' + minPrio + ': Site-Coordinator (cross-worker) — keine Regel' }));
  return h('div', { style: { padding: '14px' } }, h('div.hint', { style: { marginBottom: '10px' }, text: 'Auswertung aufsteigend nach (priority, rule_id). Spätere Regeln überschreiben frühere auf demselben State. Violett = cross-worker, gelb = cross-controller.' }), h('div.ladder', null, rows));
}

/* ------------------------------------------------------------------ signals: filters & timers */
function signalEditorFor(key) {
  var k = String(key);
  if (k[0] === 'f') { var f = IDX.filter.get(k.slice(1)); return f ? { kind: 'filter', isNew: false, draft: clone(f), original: f.filter_id } : null; }
  var t = IDX.timer.get(k.slice(1)); return t ? { kind: 'timer', isNew: false, draft: clone(t), original: t.timer_id } : null;
}
function newFilterEditor(prefill) {
  var p = prefill || {};
  var refs = p.sensor ? [{ sensor_id: p.sensor.sensor_id, controller_uuid: p.sensor.controller_uuid }] : [];
  return { kind: 'filter', isNew: true, draft: { filter_id: maxId(CFG.filters, 'filter_id') + 1, sensor_refs: refs, chain: [{ type: 'median', window: 5 }, { type: 'moving_average', window: 5 }, { type: 'lowpass', alpha: 0.2 }, { type: 'scaler_sensor_profile' }], description: '' } };
}
function newTimerEditor() { return { kind: 'timer', isNew: true, draft: { timer_id: maxId(CFG.timers, 'timer_id') + 1, duration_s: 600, description: '' } }; }
function timerKind(t) { return t.interval_s !== undefined ? 'interval' : t.at !== undefined ? 'at' : t.cron !== undefined ? 'cron' : 'duration'; }
var TIMER_KIND = { duration: 'Stoppuhr', interval: 'Taktgeber', at: 'Uhrzeit', cron: 'Cron' };
function timerDesc(t) { var k = timerKind(t); return k === 'duration' ? t.duration_s + ' s' : k === 'interval' ? 'alle ' + t.interval_s + ' s' : k === 'at' ? 'täglich ' + t.at : t.cron; }
function renderSignalsView() {
  var items = [invGroup('Filter', CFG.filters.length + '')];
  CFG.filters.forEach(function (f) {
    var u = use('filter', f.filter_id);
    if (!matchInv('filter ' + f.filter_id + ' ' + txt(f.description))) return;
    items.push(invItem({ title: 'Filter #' + f.filter_id + ' · ' + arr(f.sensor_refs).map(function (r) { return 'S' + r.sensor_id + ' ' + ctrlKey(r.controller_uuid); }).join(', '), sub: arr(f.chain).map(function (s) { return s.type; }).join(' → '), meta: (u.rules.length + u.states.length) ? (u.rules.length + u.states.length) + '×' : 'frei', tone: (u.rules.length + u.states.length) ? null : 'muted', changed: isChanged('filters', f.filter_id), active: S.sel.signals === 'f' + f.filter_id, onClick: function () { S.sel.signals = 'f' + f.filter_id; S.editor = signalEditorFor('f' + f.filter_id); render(); } }));
  });
  items.push(invGroup('Timer', CFG.timers.length + ''));
  CFG.timers.forEach(function (t) {
    var u = use('timer', t.timer_id);
    if (!matchInv('timer ' + t.timer_id + ' ' + txt(t.description))) return;
    items.push(invItem({ title: 'Timer #' + t.timer_id + ' · ' + TIMER_KIND[timerKind(t)], sub: timerDesc(t) + ' · ' + txt(t.description), meta: u.rules.length ? u.rules.length + '×' : 'frei', tone: u.rules.length ? null : 'muted', changed: isChanged('timers', t.timer_id), active: S.sel.signals === 't' + t.timer_id, onClick: function () { S.sel.signals = 't' + t.timer_id; S.editor = signalEditorFor('t' + t.timer_id); render(); } }));
  });
  var inv = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '100%' } }, invHead('Filter & Timer', null), h('div.inv-list', null, items),
    h('div.inv-foot', null, btn('Neuer Filter', { icon: 'i-plus', variant: 'primary', block: true, onClick: function () { S.sel.signals = null; S.editor = newFilterEditor({}); render(); } }), btn('Neuer Timer', { icon: 'i-clock', block: true, onClick: function () { S.sel.signals = null; S.editor = newTimerEditor(); render(); } })));
  if (S.editor && S.editor.kind === 'filter') { panes(inv, renderFilterEditor(), renderFilterContext()); return; }
  if (S.editor && S.editor.kind === 'timer') { panes(inv, renderTimerEditor(), renderTimerContext()); return; }
  panes(inv, h('div.card', null, h('div.card__head', null, h('h3', null, icon('i-filter', 'ico--sm'), 'Filter & Timer')), h('div.card__body', null, h('div.hint', { text: 'Links einen Filter oder Timer wählen. Filterketten werden als Stufen bearbeitet (median → moving_average → lowpass → scaler_sensor_profile), nicht als JSON.' }), h('div', { style: { height: '10px' } }), h('div.tcards', null, Object.keys(FILTER_STEPS).map(function (t) { return h('div.tcard', null, h('div.t', { text: t }), h('div.d', { text: ({ median: 'Ausreißer unterdrücken (Fenster)', moving_average: 'Gleitender Mittelwert (Fenster)', lowpass: 'Tiefpass, alpha 0–1 (klein = träge)', highpass: 'Hochpass, alpha 0–1', sampler: 'Abtastung alle period_s', scaler: 'Lineare Skalierung', scaler_sensor_profile: 'Rohwert → Einheit laut profile_id', expr: 'Ausdruck (Runtime)' })[t] })); })))), h('div', null, ctxSec('Sitzungsänderungen', changeLog())));
}
function renderFilterEditor() {
  var ed = S.editor, d = ed.draft;
  var steps = h('div.sent', null, arr(d.chain).map(function (step, i) {
    var fieldsFor = FILTER_STEPS[step.type] || [];
    return h('div.crow', null, h('span.lab.mono', { text: String(i + 1) }), select(Object.keys(FILTER_STEPS).map(function (t) { return { value: t, label: t }; }), step.type, function (e) { var n = { type: e.target.value }; (FILTER_STEPS[n.type] || []).forEach(function (k) { n[k] = k === 'alpha' ? 0.2 : k === 'window' ? 5 : 1; }); d.chain[i] = n; render(); }),
      fieldsFor.map(function (k) { return [h('span.lab', { text: k }), input(step[k], function (e) { step[k] = num(e.target.value); render(); }, { type: 'number', step: k === 'alpha' ? '0.05' : '1', class: 'num' })]; }),
      step.type === 'scaler_sensor_profile' ? h('span.lab', { text: '→ Einheit laut profile_id des Sensors' }) : null,
      h('span.x', null, btn('', { icon: 'i-undo', size: 'xs', variant: 'ghost', title: 'nach oben', disabled: i === 0, onClick: function () { var t = d.chain[i - 1]; d.chain[i - 1] = d.chain[i]; d.chain[i] = t; render(); } }), btn('', { icon: 'i-trash', size: 'xs', variant: 'ghost', onClick: function () { d.chain.splice(i, 1); render(); } })));
  }), h('div.addrow', null, btn('Stufe', { icon: 'i-plus', size: 'sm', variant: 'ghost', onClick: function () { d.chain.push({ type: 'lowpass', alpha: 0.2 }); render(); } })));
  var problems = [];
  if (!arr(d.sensor_refs).length) problems.push('mindestens ein Sensor');
  if (!arr(d.chain).length) problems.push('chain leer');
  var tmp = { io_refs: { sensors: d.sensor_refs, actuators: [] }, p_id: CFG.processes[0].p_id, state_id: -1 };
  return h('div', null, h('h3', { style: { fontSize: '15px', fontWeight: '750', marginBottom: '10px' }, text: ed.isNew ? 'Neuer Filter' : 'Filter #' + ed.original + ' bearbeiten' }),
    h('div.card', null, h('div.card__body', null,
      h('div.form.form--3', { style: { marginBottom: '12px' } }, field('filter_id', input(d.filter_id, function (e) { d.filter_id = num(e.target.value); }, { type: 'number', min: 1 }), { required: true }), field('Beschreibung', input(d.description || '', function (e) { d.description = e.target.value; }, { placeholder: 'z. B. Glättung Reaktortemperatur' }), { key: 'description', wide: false })),
      h('div.sec', null, h('div.sec__head', null, h('h4', { text: 'Sensoren (sensor_refs)' })), h('div.devgrid', null, devicePicker('sensor', d.sensor_refs, tmp))),
      h('div.sec', null, h('div.sec__head', null, h('h4', { text: 'Kette (chain) — Reihenfolge ist Ausführungsreihenfolge' })), steps),
      h('div.row.row--between', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line)' } }, h('div.row', null, problems.length ? problems.map(function (p) { return badge(p, 'danger'); }) : badge('gültig', 'ok')), h('div.row', null, ed.isNew ? null : btn('Löschen', { icon: 'i-trash', variant: 'danger', onClick: function () { var u = use('filter', d.filter_id); confirmAction('Filter #' + d.filter_id + ' löschen?' + (u.rules.length ? ' Regel ' + u.rules.join(', ') + ' verliert den Filter.' : ''), 'Filter löschen', function () { pushHistory('Filter gelöscht'); CFG.filters = CFG.filters.filter(function (f) { return num(f.filter_id) !== num(ed.original); }); CFG.rules.forEach(function (r) { ['when', 'until'].forEach(function (b) { arr(r[b]).forEach(function (c) { if (num(c.filter_id) === num(ed.original)) delete c.filter_id; }); }); }); commitModel(); markChanged('filters', d.filter_id); S.editor = null; render(); }); } }), btn('Abbrechen', { variant: 'ghost', onClick: function () { S.editor = null; render(); } }), btn(ed.isNew ? 'Filter anlegen' : 'Speichern', { variant: 'primary', icon: 'i-check', disabled: problems.length > 0, onClick: function () { pushHistory('Filter ' + d.filter_id); var c = clone(d); if (!c.description) delete c.description; if (ed.isNew) CFG.filters.push(c); else CFG.filters[CFG.filters.findIndex(function (f) { return num(f.filter_id) === num(ed.original); })] = c; commitModel(); markChanged('filters', c.filter_id); S.sel.signals = 'f' + c.filter_id; S.editor = null; toast('Filter gespeichert.', 'ok'); render(); } }))))));
}
function renderFilterContext() {
  var d = S.editor.draft, u = use('filter', d.filter_id);
  return h('div', null, ctxSec('Genutzt von', (u.rules.length || u.states.length) ? h('div.impact', null, u.rules.map(function (id) { return h('div.i', null, h('b', { text: 'Regel #' + id }), h('span', { text: (IDX.rule.get(txt(id)) || {}).name })); }), u.states.map(function (id) { return h('div.i', null, h('b', { text: 'State #' + id }), h('span', { text: 'io_refs.filter_id' })); })) : h('div.hint', { text: 'Noch nicht referenziert. Regeln wählen den Filter in der WENN-Zeile, sobald ihr Sensor hier gelistet ist.' })),
    ctxSec('Wirkung', h('div.hint', { text: 'Median(5) entfernt Spikes, gleitender Mittelwert glättet, Tiefpass alpha 0.2 dämpft Rauschen (Zeitkonstante ≈ 5 Abtastungen). scaler_sensor_profile zuletzt: erst dann liegt der Wert in der Einheit des Profils vor — Schwellwerte in Regeln beziehen sich darauf.' })),
    ctxSec('V9-Vorschau (filters[])', jsonPre(d)));
}
function renderTimerEditor() {
  var ed = S.editor, d = ed.draft, k = timerKind(d);
  function setKind(nk) { var desc = d.description, id = d.timer_id; var n = { timer_id: id, description: desc }; if (nk === 'duration') n.duration_s = 600; if (nk === 'interval') n.interval_s = 5; if (nk === 'at') n.at = '13:00'; if (nk === 'cron') n.cron = '0 */2 * * *'; S.editor.draft = n; render(); }
  var kindSeg = h('div.seg', null, Object.keys(TIMER_KIND).map(function (x) { return h('button' + (k === x ? '.active' : ''), { type: 'button', text: TIMER_KIND[x], onClick: function () { setKind(x); } }); }));
  var spec = k === 'duration' ? field('Dauer', unitInput(d.duration_s, 's', function (e) { d.duration_s = num(e.target.value); }), { key: 'duration_s', hint: 'Stoppuhr — braucht timer_start() in der Runtime; Regel prüft op elapsed.' })
    : k === 'interval' ? field('Intervall', unitInput(d.interval_s, 's', function (e) { d.interval_s = num(e.target.value); }), { key: 'interval_s', hint: 'Freilaufender Taktgeber; Regel prüft op fired.' })
    : k === 'at' ? field('Uhrzeit', input(d.at, function (e) { d.at = e.target.value; }, { type: 'time' }), { key: 'at', hint: 'Täglich zur Lokalzeit.' })
    : field('Cron', input(d.cron, function (e) { d.cron = e.target.value; }, { placeholder: '0 */2 * * *' }), { key: 'cron', hint: '5-Feld-Cron (min h dom mon dow).' });
  return h('div', null, h('h3', { style: { fontSize: '15px', fontWeight: '750', marginBottom: '10px' }, text: ed.isNew ? 'Neuer Timer' : 'Timer #' + ed.original + ' bearbeiten' }),
    h('div.card', null, h('div.card__body', null, h('div.row', { style: { marginBottom: '12px' } }, h('span.hint', { text: 'Art' }), kindSeg),
      h('div.form.form--3', null, field('timer_id', input(d.timer_id, function (e) { d.timer_id = num(e.target.value); }, { type: 'number', min: 1 }), { required: true }), spec, field('Beschreibung', input(d.description || '', function (e) { d.description = e.target.value; }), { key: 'description' })),
      h('div.row.row--between', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line)' } }, h('div'), h('div.row', null, ed.isNew ? null : btn('Löschen', { icon: 'i-trash', variant: 'danger', onClick: function () { confirmAction('Timer #' + d.timer_id + ' löschen?', 'Timer löschen', function () { pushHistory('Timer gelöscht'); CFG.timers = CFG.timers.filter(function (t) { return num(t.timer_id) !== num(ed.original); }); commitModel(); markChanged('timers', d.timer_id); S.editor = null; render(); }); } }), btn('Abbrechen', { variant: 'ghost', onClick: function () { S.editor = null; render(); } }), btn(ed.isNew ? 'Timer anlegen' : 'Speichern', { variant: 'primary', icon: 'i-check', onClick: function () { pushHistory('Timer ' + d.timer_id); var c = clone(d); if (ed.isNew) CFG.timers.push(c); else CFG.timers[CFG.timers.findIndex(function (t) { return num(t.timer_id) === num(ed.original); })] = c; commitModel(); markChanged('timers', c.timer_id); S.sel.signals = 't' + c.timer_id; S.editor = null; toast('Timer gespeichert.', 'ok'); render(); } }))))));
}
function renderTimerContext() {
  var d = S.editor.draft, u = use('timer', d.timer_id);
  return h('div', null, ctxSec('Genutzt von', u.rules.length ? h('div.impact', null, u.rules.map(function (id) { return h('div.i', null, h('b', { text: 'Regel #' + id }), h('span', { text: (IDX.rule.get(txt(id)) || {}).name })); })) : h('div', null, h('div.hint', { text: 'Kein when[] wertet diesen Timer aus.' }), h('button.link', { type: 'button', text: 'Regel mit diesem Timer anlegen →', onClick: function () { setView('rules', { editor: newRuleEditor({ pattern: RULE_PATTERNS[4], timer: d }) }); } }))), ctxSec('V9-Vorschau (timers[])', jsonPre(d)));
}

/* ------------------------------------------------------------------ library */
var LIB_TABS = [
  { id: 'types', label: 'State-Typen & Mappings', keys: ['parameter_generic_templates', 'schema_mappings'] },
  { id: 'pid', label: 'PID-Configs', keys: ['pid_configs'] },
  { id: 'methods', label: 'Control-Methods', keys: ['control_method_templates', 'control_methods'] },
  { id: 'modes', label: 'Betriebsarten & Werte', keys: ['process_modes', 'process_values'] },
  { id: 'stateTpl', label: 'State-Vorlagen', keys: [] },
  { id: 'ruleTpl', label: 'Regel-Vorlagen', keys: [] }
];
function renderLibraryView() {
  var inv = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '100%' } }, h('div.inv-head', null, h('h3', { text: 'Bibliothek' }), h('div.hint', { text: 'Katalogtabellen des Vertrags — bisher nur per Hand in der JSON änderbar.' })),
    h('div.inv-list', null, LIB_TABS.map(function (t) { var n = t.keys.reduce(function (a, k) { return a + arr(CFG[k]).length; }, 0); return invItem({ title: t.label, sub: t.keys.join(', ') || (t.id === 'stateTpl' ? 'process_library_v9 + Katalog' : 'rule_library_v9 + Muster'), meta: t.keys.length ? String(n) : '', active: S.libTab === t.id, onClick: function () { S.libTab = t.id; S.editor = null; render(); } }); })));
  var body = { types: renderLibTypes, pid: renderLibPid, methods: renderLibMethods, modes: renderLibModes, stateTpl: renderLibStateTemplates, ruleTpl: renderLibRuleTemplates }[S.libTab]();
  panes(inv, body, h('div', null, ctxSec('Warum hier?', h('div.hint', { text: 'POST /api/v9/config verlangt alle 26 Sektionen. Bisher waren pid_configs, control_methods, process_modes und process_values nirgends editierbar — jeder neue PID-Satz musste in die JSON-Datei.' })), ctxSec('Sitzungsänderungen', changeLog())));
}
function libCard(title, count, rows, head, addBtn) {
  return h('div.card', null, h('div.card__head', null, h('h3', null, title, badge(String(count), 'accent')), addBtn ? h('div.acts', null, addBtn) : null), h('div.card__body.card__body--flush', null, h('div.tblwrap', null, h('table.tbl', null, h('thead', null, h('tr', null, head.map(function (x) { return h('th' + (x[1] ? '.r' : ''), { text: x[0] }); }))), h('tbody', null, rows)))));
}
function inlineNum(obj, key, after) { return input(obj[key], function (e) { pushHistory('Wert ' + key); obj[key] = num(e.target.value); commitModel(); if (after) after(); render(); }, { type: 'number', step: 'any', class: 'inp', style: { width: '90px', minHeight: '26px', padding: '.15rem .4rem', fontFamily: 'var(--mono)', fontSize: '12px' } }); }
function inlineText(obj, key, after, w) { return input(obj[key], function (e) { pushHistory('Text ' + key); obj[key] = e.target.value; commitModel(); if (after) after(); render(); }, { class: 'inp', style: { width: w || '200px', minHeight: '26px', padding: '.15rem .4rem', fontSize: '12px' } }); }
function renderLibTypes() {
  var rows = CFG.parameter_generic_templates.map(function (t) {
    var maps = CFG.schema_mappings.filter(function (m) { return num(m.schema_id) === num(t.schema_id); });
    var used = maps.reduce(function (a, m) { return a + use('mapping', m.mapping_id).states.length; }, 0);
    return h('tr', null, h('td.r', { text: String(t.schema_id) }), h('td', null, h('span.row', null, icon(TYPE_ICON[t.state_type] || 'i-layers', 'ico--sm'), inlineText(t, 'state_type', function () { markChanged('types', t.schema_id); }, '130px'))), h('td', null, inlineText(t, 'description', function () { markChanged('types', t.schema_id); }, '260px')), h('td', null, h('div.chips', null, maps.map(function (m) { return badge('mapping ' + m.mapping_id, null, true); }), maps.length ? null : badge('kein Mapping', 'warn'))), h('td', null, h('div.chips', null, (TYPE_PARAMS[t.state_type] || []).map(function (f) { return badge(f.key, 'info', true); }))), h('td', null, used ? badge(used + ' States', 'ok') : badge('ungenutzt', null)),
      h('td', null, h('button.link.link--danger', { type: 'button', text: 'Löschen', disabled: used > 0, onClick: function () { pushHistory('Typ gelöscht'); CFG.parameter_generic_templates = CFG.parameter_generic_templates.filter(function (x) { return x !== t; }); CFG.schema_mappings = CFG.schema_mappings.filter(function (m) { return num(m.schema_id) !== num(t.schema_id); }); commitModel(); render(); } })));
  });
  return libCard('State-Typen (parameter_generic_templates) mit Mappings', CFG.parameter_generic_templates.length, rows, [['schema_id', 1], ['state_type'], ['Beschreibung'], ['schema_mappings'], ['Parameterfelder im Editor'], ['Genutzt'], ['']], btn('Typ + Mapping anlegen', { icon: 'i-plus', size: 'sm', onClick: function () { pushHistory('Typ angelegt'); var sid = maxId(CFG.parameter_generic_templates, 'schema_id') + 1; var mid = Math.max(100, maxId(CFG.schema_mappings, 'mapping_id') + 10); CFG.parameter_generic_templates.push({ schema_id: sid, state_type: 'new_type', description: 'Neuer Typ' }); CFG.schema_mappings.push({ mapping_id: mid, schema_id: sid }); commitModel(); markChanged('types', sid); render(); } }));
}
function renderLibPid() {
  var rows = CFG.pid_configs.map(function (p) {
    var u = use('pid', p.pid_config_id);
    var pp = p.pid_parameters;
    var ratio = pp.ki ? (pp.kp / pp.ki).toFixed(1) : '∞';
    return h('tr', null, h('td.r', { text: String(p.pid_config_id) }), h('td', null, inlineNum(pp, 'kp', function () { markChanged('pid', p.pid_config_id); })), h('td', null, inlineNum(pp, 'ki', function () { markChanged('pid', p.pid_config_id); })), h('td', null, inlineNum(pp, 'kd', function () { markChanged('pid', p.pid_config_id); })), h('td', { text: 'Tn ≈ ' + ratio + ' s' }), h('td', { text: pp.kp < 0.1 ? 'träge Strecke (Heizung)' : pp.kp < 1 ? 'mittlere Dynamik (Rührwerk)' : 'schnelle Strecke (Ventil, Kühlung)' }), h('td', null, u.states.length ? badge('State ' + u.states.join(', '), 'ok') : badge('ungenutzt', null)),
      h('td', null, h('button.link', { type: 'button', text: 'Duplizieren', onClick: function () { pushHistory('PID dupliziert'); var c = clone(p); c.pid_config_id = maxId(CFG.pid_configs, 'pid_config_id') + 1; CFG.pid_configs.push(c); commitModel(); markChanged('pid', c.pid_config_id); render(); } }), ' ', h('button.link.link--danger', { type: 'button', text: 'Löschen', disabled: u.states.length > 0, onClick: function () { pushHistory('PID gelöscht'); CFG.pid_configs = CFG.pid_configs.filter(function (x) { return x !== p; }); commitModel(); render(); } })));
  });
  return libCard('PID-Configs (pid_configs)', CFG.pid_configs.length, rows, [['id', 1], ['kp'], ['ki'], ['kd'], ['Nachstellzeit'], ['Einordnung'], ['Genutzt von'], ['']], btn('PID-Config anlegen', { icon: 'i-plus', size: 'sm', onClick: function () { pushHistory('PID angelegt'); var id = maxId(CFG.pid_configs, 'pid_config_id') + 1; CFG.pid_configs.push({ pid_config_id: id, pid_parameters: { kp: 1.0, ki: 0.1, kd: 0.01 } }); commitModel(); markChanged('pid', id); render(); } }));
}
function renderLibMethods() {
  var tplRows = CFG.control_method_templates.map(function (t) { return h('tr', null, h('td.r', { text: String(t.template_id) }), h('td', null, h('b', { text: t.template_name }), ' ', badge(t.type + (t.expr_id ? ' · ' + t.expr_id : ''), 'info', true)), h('td', null, h('div.chips', null, t.parameters.map(function (p) { return badge(p, null, true); }))), h('td', { text: t.template_description }), h('td', null, h('button.link', { type: 'button', text: 'Method daraus', onClick: function () { pushHistory('Method angelegt'); var id = maxId(CFG.control_methods, 'method_id') + 1; var args = {}; t.parameters.forEach(function (p) { args[p] = ({ v0: 20, v1: 80, t_ramp: 600, low: 0, high: 100, period_s: 600, duty: 0.5, duration_s: 600, amp: 10, offset: 0, phase_deg: 0, A: 1, B: 0, t0: 0, k: 0.02, sign: 1, eps: 0.01 })[p] || 0; }); CFG.control_methods.push({ method_id: id, template_id: t.template_id, args: args }); commitModel(); markChanged('methods', id); render(); } }))); });
  var rows = CFG.control_methods.map(function (m) {
    var t = IDX.cmTemplate.get(txt(m.template_id)); var u = use('method', m.method_id);
    return h('tr', null, h('td.r', { text: String(m.method_id) }), h('td', null, h('b', { text: t ? t.template_name : '?' }), h('div.hint', { text: t ? t.template_description : '' })), h('td', null, h('div.row', null, Object.keys(m.args).map(function (k) { return h('span.row', { style: { gap: '3px' } }, h('span.hint.mono', { text: k }), inlineNum(m.args, k, function () { markChanged('methods', m.method_id); })); }))), h('td', null, u.states.length ? badge('State ' + u.states.join(', '), 'ok') : badge('ungenutzt', null)), h('td', null, h('button.link.link--danger', { type: 'button', text: 'Löschen', disabled: u.states.length > 0, onClick: function () { pushHistory('Method gelöscht'); CFG.control_methods = CFG.control_methods.filter(function (x) { return x !== m; }); commitModel(); render(); } })));
  });
  return h('div', null, libCard('Control-Methods (control_methods)', CFG.control_methods.length, rows, [['id', 1], ['Template'], ['Argumente'], ['Genutzt von'], ['']]), libCard('Method-Templates (control_method_templates) — Katalog, Formeln', CFG.control_method_templates.length, tplRows, [['id', 1], ['Name · Typ'], ['Parameter'], ['Formel'], ['']]));
}
function renderLibModes() {
  var engine = arr(CFG.rule_engine)[0] || {};
  var modeRows = CFG.process_modes.map(function (m) { var n = CFG.process_states.filter(function (s) { return num(s.mode_id) === num(m.mode_id); }).length; return h('tr', null, h('td.r', { text: String(m.mode_id) }), h('td', null, inlineText(m, 'mode', function () { markChanged('modes', m.mode_id); }, '160px')), h('td', null, num(m.mode_id) === num(engine.required_mode_id) ? badge('Engine-Gate', 'ok') : badge('Regeln gesperrt', 'warn')), h('td', { text: n + ' States' }), h('td', null, h('button.link.link--danger', { type: 'button', text: 'Löschen', disabled: n > 0 || num(m.mode_id) === num(engine.required_mode_id), onClick: function () { pushHistory('Modus gelöscht'); CFG.process_modes = CFG.process_modes.filter(function (x) { return x !== m; }); commitModel(); render(); } }))); });
  var valRows = CFG.process_values.map(function (v) { var n = CFG.process_states.filter(function (s) { return num(s.value_id) === num(v.value_id); }).length; return h('tr', null, h('td.r', { text: String(v.value_id) }), h('td', null, inlineText(v, 'state_value', function () { markChanged('values', v.value_id); }, '160px')), h('td', null, num(v.value_id) === 1 ? badge('aktiv (DEFAULT_ACTIVE_VALUE_IDS)', 'ok') : badge('nicht aktiv', null)), h('td', { text: n + ' States als Startwert' }), h('td', null, h('button.link.link--danger', { type: 'button', text: 'Löschen', disabled: n > 0 || num(v.value_id) <= 2, onClick: function () { pushHistory('Wert gelöscht'); CFG.process_values = CFG.process_values.filter(function (x) { return x !== v; }); commitModel(); render(); } }))); });
  return h('div', null, libCard('Betriebsarten (process_modes)', CFG.process_modes.length, modeRows, [['id', 1], ['mode'], ['Engine'], ['Nutzung'], ['']], btn('Betriebsart', { icon: 'i-plus', size: 'sm', onClick: function () { pushHistory('Modus angelegt'); var id = maxId(CFG.process_modes, 'mode_id') + 1; CFG.process_modes.push({ mode_id: id, mode: 'new_mode' }); commitModel(); markChanged('modes', id); render(); } })), libCard('Zustandswerte (process_values)', CFG.process_values.length, valRows, [['id', 1], ['state_value'], ['Runtime'], ['Nutzung'], ['']], btn('Wert', { icon: 'i-plus', size: 'sm', onClick: function () { pushHistory('Wert angelegt'); var id = maxId(CFG.process_values, 'value_id') + 1; CFG.process_values.push({ value_id: id, state_value: 'new_value' }); commitModel(); markChanged('values', id); render(); } })));
}
function renderLibStateTemplates() {
  var tpls = stateTemplates();
  return h('div.card', null, h('div.card__head', null, h('h3', null, icon('i-layers', 'ico--sm'), 'State-Vorlagen', badge(String(tpls.length), 'accent')), h('div.acts', null, pill('Klick = neuer State mit dieser Vorlage', 'info'))), h('div.card__body', null, h('div.tcards', null, tpls.map(function (t) { return h('button.tcard', { type: 'button', onClick: function () { setView('states', { editor: newStateEditor({ template: t }) }); } }, h('div.t', null, icon(TYPE_ICON[t.type] || 'i-layers'), t.title), h('div.d', { text: t.desc }), h('div.d', { text: Object.keys(t.parameters).map(function (k) { return k + '=' + t.parameters[k]; }).join(', ') + (t.control_strategy ? ' · ' + t.control_strategy.type : ' · auto') }), h('div.m', { text: t.source + ' · ' + t.used + '× im Projekt' })); }))));
}
function renderLibRuleTemplates() { return renderRuleTemplates(); }

/* ------------------------------------------------------------------ engine */
function renderEngineView() {
  var e = arr(CFG.rule_engine)[0];
  var rt = e.runtime = isObj(e.runtime) ? e.runtime : {}; var sf = e.safety = isObj(e.safety) ? e.safety : {}; var dbg = e.debug = isObj(e.debug) ? e.debug : {};
  var onMissing = isObj(sf.on_missing_sensor) ? sf.on_missing_sensor : (sf.on_missing_sensor = { value_id: 2 });
  var onInvalid = isObj(sf.on_invalid_pid) ? sf.on_invalid_pid : (sf.on_invalid_pid = { value_id: 2 });
  function commit(kind) { pushHistory('Engine'); commitModel(); markChanged('engine', e.engine_id); render(); }
  var gatedStates = CFG.process_states.filter(function (s) { return num(s.mode_id) !== num(e.required_mode_id) && use('state', s.state_id).rules.length; });
  var inv = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '100%' } }, h('div.inv-head', null, h('h3', { text: 'Rule-Engine' }), h('div.hint', { text: 'Singleton — V9 hat genau eine Engine (engine_id 1).' })), h('div.inv-list', null, [['Gate & Schreibrechte', 'required_mode_id, writable_fields, sp_tolerance', 0], ['Defaults', 'eval, exec, priority', 4], ['Runtime', 'tick_ms, max_signal_age_s, coordinator_min_priority', 1], ['Safety', 'on_missing_sensor, on_invalid_pid, max_output_delta', 2], ['Debug', 'control, pid, log', 3]].map(function (x, i) { return invItem({ title: x[0], sub: x[1], onClick: function () { var el = document.getElementById('eng-' + x[2]); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }); })));
  var df = e.defaults = isObj(e.defaults) ? e.defaults : { eval: 'on_event', exec: 'parallel', priority: 100 };
  var wf = arr(e.writable_fields);
  var editor = h('div', null,
    h('div.card#eng-0', null, h('div.card__head', null, h('h3', null, icon('i-shield', 'ico--sm'), 'Gate & Schreibrechte')), h('div.card__body', null, h('div.form.form--3', null,
      field('Engine schreibt nur bei Betriebsart', select(CFG.process_modes.map(function (m) { return { value: m.mode_id, label: '#' + m.mode_id + ' · ' + m.mode }; }), e.required_mode_id, function (ev) { e.required_mode_id = num(ev.target.value); commit(); }), { key: 'required_mode_id', required: true, hint: gatedStates.length ? gatedStates.length + ' States mit Regeln stehen auf einer anderen Betriebsart → skipped_mode' : 'Alle geregelten States passen zum Gate.' }),
      field('Engine aktiv', select([{ value: 'true', label: 'ja' }, { value: 'false', label: 'nein' }], String(e.enabled !== false), function (ev) { e.enabled = ev.target.value === 'true'; commit(); }), { key: 'enabled' }),
      field('Sollwert-Toleranz', unitInput(e.sp_tolerance, '', function (ev) { e.sp_tolerance = num(ev.target.value); commit(); }), { key: 'sp_tolerance' }),
      field('Schreibbare Felder', h('div.chips', null, ['value_id', 'parameters', 'mode_id', 'setpoint_source'].map(function (f) { var on = wf.indexOf(f) >= 0; return h('button.chipsel' + (on ? '.on' : ''), { type: 'button', onClick: function () { e.writable_fields = on ? wf.filter(function (x) { return x !== f; }) : wf.concat([f]); commit(); } }, h('span.mono', { text: f })); })), { key: 'writable_fields', wide: true, hint: 'Aktionsfelder außerhalb dieser Liste verwirft der Worker. Standard: value_id, parameters.' })))),
    h('div.card#eng-4', null, h('div.card__head', null, h('h3', null, icon('i-rule', 'ico--sm'), 'Defaults für neue Regeln')), h('div.card__body', null, h('div.form.form--3', null,
      field('Auswertung', select([{ value: 'on_event', label: 'on_event — bei Signaländerung' }, { value: 'periodic', label: 'periodic — je Tick' }], df.eval, function (ev) { df.eval = ev.target.value; commit(); }), { key: 'defaults.eval' }),
      field('Ausführung', select([{ value: 'parallel', label: 'parallel' }, { value: 'serial', label: 'serial' }], df.exec, function (ev) { df.exec = ev.target.value; commit(); }), { key: 'defaults.exec' }),
      field('Standard-Priorität', input(df.priority, function (ev) { df.priority = num(ev.target.value); commit(); }, { type: 'number', min: 0 }), { key: 'defaults.priority', hint: 'Vorbelegung im Regel-Editor' })))),
    h('div.card#eng-1', null, h('div.card__head', null, h('h3', null, icon('i-cpu', 'ico--sm'), 'Runtime'), h('div.acts', null, pill('Worker liest nur max_signal_age_s und coordinator_min_priority', 'warn'))), h('div.card__body', null, h('div.form.form--4', null,
      field('Max. Signalalter', unitInput(rt.max_signal_age_s, 's', function (ev) { rt.max_signal_age_s = num(ev.target.value); commit(); }), { key: 'max_signal_age_s', hint: 'Ältere Messwerte gelten als fehlend → safety.on_missing_sensor' }),
      field('Coordinator ab Priorität', input(rt.coordinator_min_priority, function (ev) { rt.coordinator_min_priority = num(ev.target.value); commit(); }, { type: 'number' }), { key: 'coordinator_min_priority', hint: 'cross-worker-Regeln brauchen ≥ diesen Wert' }),
      field('Tick', unitInput(rt.tick_ms, 'ms', function (ev) { rt.tick_ms = num(ev.target.value); commit(); }), { key: 'tick_ms' }),
      field('Threading', select([{ value: 'per_controller', label: 'per_controller' }, { value: 'single', label: 'single' }], rt.threading, function (ev) { rt.threading = ev.target.value; commit(); }), { key: 'threading' }),
      field('Cross-Scope', select([{ value: 'coordinator', label: 'coordinator' }, { value: 'owner', label: 'owner' }], rt.cross_scope_exec, function (ev) { rt.cross_scope_exec = ev.target.value; commit(); }), { key: 'cross_scope_exec' }),
      field('Cross-Worker', select([{ value: 'site_coordinator_optional', label: 'site_coordinator_optional' }, { value: 'site_coordinator_required', label: 'site_coordinator_required' }], rt.cross_worker_exec, function (ev) { rt.cross_worker_exec = ev.target.value; commit(); }), { key: 'cross_worker_exec' }),
      field('Snapshot-Isolation', select([{ value: 'true', label: 'ein' }, { value: 'false', label: 'aus' }], String(rt.snapshot_isolation !== false), function (ev) { rt.snapshot_isolation = ev.target.value === 'true'; commit(); }), { key: 'snapshot_isolation' }),
      field('Identität', h('div.note', { text: txt(rt.identity_model) + ' · ' + txt(rt.routing_model) }), { key: 'identity_model · routing_model', hint: 'deklarativ, vom Vertrag fixiert' })))),
    h('div.card#eng-2', null, h('div.card__head', null, h('h3', null, icon('i-warn', 'ico--sm'), 'Safety'), h('div.acts', null, pill('Ausgewertet wird on_missing_sensor', 'warn'))), h('div.card__body', null, h('div.form.form--3', null,
      field('Bei fehlendem Sensor → value_id', select(CFG.process_values.map(function (v) { return { value: v.value_id, label: '#' + v.value_id + ' · ' + v.state_value }; }), onMissing.value_id, function (ev) { onMissing.value_id = num(ev.target.value); commit(); }), { key: 'safety.on_missing_sensor' }),
      field('Bei ungültigem PID → value_id', select(CFG.process_values.map(function (v) { return { value: v.value_id, label: '#' + v.value_id + ' · ' + v.state_value }; }), onInvalid.value_id, function (ev) { onInvalid.value_id = num(ev.target.value); commit(); }), { key: 'safety.on_invalid_pid' }),
      field('Max. Stellgrößenänderung je Schritt', unitInput(sf.max_output_delta_per_step, '', function (ev) { sf.max_output_delta_per_step = num(ev.target.value); commit(); }), { key: 'max_output_delta_per_step' })))),
    h('div.card#eng-3', null, h('div.card__head', null, h('h3', null, icon('i-info', 'ico--sm'), 'Debug')), h('div.card__body', null, h('div.form.form--4', null,
      field('Regelung loggen', select([{ value: 'true', label: 'ein' }, { value: 'false', label: 'aus' }], String(!!dbg.control), function (ev) { dbg.control = ev.target.value === 'true'; commit(); }), { key: 'control' }),
      field('PID loggen', select([{ value: 'true', label: 'ein' }, { value: 'false', label: 'aus' }], String(!!dbg.pid), function (ev) { dbg.pid = ev.target.value === 'true'; commit(); }), { key: 'pid' }),
      field('PID-Intervall', unitInput(dbg.pid_interval_s, 's', function (ev) { dbg.pid_interval_s = num(ev.target.value); commit(); }), { key: 'pid_interval_s' }),
      field('Sättigungs-Intervall', unitInput(dbg.pid_saturation_interval_s, 's', function (ev) { dbg.pid_saturation_interval_s = num(ev.target.value); commit(); }), { key: 'pid_saturation_interval_s' }),
      field('PID-States im Log', h('div.chips', null, CFG.process_states.filter(function (s) { return isObj(s.control_strategy) && s.control_strategy.type === 'PID'; }).map(function (s) { var ids = arr(dbg.pid_state_ids); var on = ids.some(function (x) { return num(x) === num(s.state_id); }); return h('button.chipsel' + (on ? '.on' : ''), { type: 'button', onClick: function () { dbg.pid_state_ids = on ? ids.filter(function (x) { return num(x) !== num(s.state_id); }) : ids.concat([s.state_id]); commit(); } }, h('span.mono', { text: 'State ' + s.state_id })); })), { key: 'pid_state_ids', wide: true, hint: 'Bisher stand hier [1, 2] — State 2 existiert nicht; die Liste zeigt jetzt nur echte PID-States.' }),
      field('Log-Kanäle', h('div.chips', null, ['transitions', 'saturation', 'clamps', 'skipped_mode', 'cross'].map(function (c) { var on = arr(dbg.log).indexOf(c) >= 0; return h('button.chipsel' + (on ? '.on' : ''), { type: 'button', onClick: function () { dbg.log = on ? arr(dbg.log).filter(function (x) { return x !== c; }) : arr(dbg.log).concat([c]); commit(); } }, h('span.mono', { text: c })); })), { key: 'log', wide: true })))));
  var ctx = h('div', null, ctxSec('Gate-Auswirkung', gatedStates.length ? h('div.impact', null, gatedStates.map(function (s) { return h('div.i', null, h('b', { text: 'State #' + s.state_id }), h('span', { text: modeName(s.mode_id) + ' ≠ ' + modeName(e.required_mode_id) }), h('button.link.link--accent', { type: 'button', text: 'Öffnen', style: { marginLeft: 'auto' }, onClick: function () { setView('states', { select: s.state_id, editor: stateEditorFor(s) }); } })); })) : h('div.hint', { text: 'Keine Konflikte zwischen Gate und geregelten States.' })), ctxSec('V9-Vorschau (rule_engine[])', jsonPre(e)));
  panes(inv, editor, ctx);
}

/* ------------------------------------------------------------------ device map (SVG) */
function renderMapView() {
  var focus = S.mapFocus;
  var items = [];
  CFG.nodes.forEach(function (n) {
    items.push(invGroup('Node ' + n.node_id, n.description));
    CFG.controllers.filter(function (c) { return c.node_id === n.node_id; }).forEach(function (c) {
      var sens = CFG.sensors.filter(function (s) { return s.controller_uuid === c.controller_uuid; });
      var acts = CFG.actuators.filter(function (a) { return a.controller_uuid === c.controller_uuid; });
      items.push(invItem({ title: c.controller_key, sub: c.device_name + ' · ' + c.host, meta: sens.length + 'S ' + acts.length + 'A', active: focus === 'ctrl:' + c.controller_uuid, onClick: function () { S.invChip = 'all'; S.mapFocus = 'ctrl:' + c.controller_uuid; render(); } }));
      sens.concat(acts).forEach(function (dev) {
        var kind = dev.sensor_id !== undefined ? 'sensor' : 'actuator'; var key = refKey(dev, kind + '_id'); var u = use(kind, key);
        var used = u.states.length || (u.rules && u.rules.length);
        if (!matchInv(devShort(dev, kind) + ' ' + devTitle(dev, kind))) return;
        items.push(invItem({ title: '   ' + devShort(dev, kind).split(' · ')[0] + ' · ' + devTitle(dev, kind), sub: 'Adr ' + dev.address + ' · ' + (unitOf(dev) || dev.function_type), meta: used ? (u.states.length + (u.rules ? u.rules.length : 0)) + '×' : 'frei', tone: used ? null : 'warn', changed: u.states.some(function (id) { return isChanged('states', id); }), active: focus === kind + ':' + key, onClick: function () { S.invChip = 'all'; S.mapFocus = kind + ':' + key; render(); } }));
      });
    });
  });
  var inv = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '100%' } }, invHead('Geräte', [{ id: 'all', label: 'Alle' }, { id: 'unused', label: 'Nicht konfiguriert' }]), h('div.inv-list', null, items), h('div.inv-foot', null, btn('Fokus aufheben', { variant: 'ghost', block: true, onClick: function () { S.mapFocus = null; render(); } })));
  if (S.invChip === 'unused' && focus !== 'unused') { S.mapFocus = 'unused'; focus = 'unused'; }
  panes(inv, h('div.card', null, h('div.card__head', null, h('h3', null, icon('i-map', 'ico--sm'), 'Node → Controller → I/O → State → Regel'), h('div.acts', null, h('div.legend', null, h('span', null, h('i.s'), 'Sensor → State'), h('span', null, h('i.a'), 'State → Aktor'), h('span', null, h('i.r'), 'Regel → State'), h('span', null, h('em'), 'geändert')))), h('div.card__body', null, buildMapSvg(focus))), renderMapContext(focus));
}
function buildMapSvg(focus) {
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) { var n = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'onClick') n.addEventListener('click', attrs[k]); else n.setAttribute(k, attrs[k]); }); return n; }
  // layout: column 0 devices (grouped by node/controller), column 1 states, column 2 rules
  var devs = [];
  CFG.nodes.forEach(function (n) { CFG.controllers.filter(function (c) { return c.node_id === n.node_id; }).forEach(function (c) { CFG.sensors.filter(function (s) { return s.controller_uuid === c.controller_uuid; }).forEach(function (s) { devs.push({ kind: 'sensor', dev: s, node: n.node_id, ctrl: c }); }); CFG.actuators.filter(function (a) { return a.controller_uuid === c.controller_uuid; }).forEach(function (a) { devs.push({ kind: 'actuator', dev: a, node: n.node_id, ctrl: c }); }); }); });
  var rowH = 26, top = 30, x0 = 20, wDev = 290, xState = 370, wState = 260, xRule = 690, wRule = 290;
  var y = top, lastCtrl = null, lastNode = null, boxes = [];
  devs.forEach(function (d) { if (d.node !== lastNode) { y += 30; lastNode = d.node; lastCtrl = null; } if (d.ctrl !== lastCtrl) { y += 28; lastCtrl = d.ctrl; } d.y = y; y += rowH; });
  var H = Math.max(y + 20, top + CFG.process_states.length * 34 + 40, top + CFG.rules.length * 34 + 40);
  var svg = el('svg', { class: 'map', viewBox: '0 0 1000 ' + H, width: '100%' });
  // focus sets
  var hlStates = new Set(), hlRules = new Set(), hlDevs = new Set();
  if (focus && focus.indexOf('sensor:') === 0 || focus && focus.indexOf('actuator:') === 0) { var k = focus.split(':').slice(1).join(':'); var kind = focus.split(':')[0]; hlDevs.add(focus); use(kind, k).states.forEach(function (id) { hlStates.add(num(id)); use('state', id).rules.forEach(function (r) { hlRules.add(num(r)); }); }); (use(kind, k).rules || []).forEach(function (r) { hlRules.add(num(r)); }); }
  if (focus && focus.indexOf('state:') === 0) { var sid = num(focus.slice(6)); hlStates.add(sid); use('state', sid).rules.forEach(function (r) { hlRules.add(num(r)); }); var st = IDX.state.get(txt(sid)); if (st) { st.io_refs.sensors.forEach(function (r) { hlDevs.add('sensor:' + refKey(r, 'sensor_id')); }); st.io_refs.actuators.forEach(function (r) { hlDevs.add('actuator:' + refKey(r, 'actuator_id')); }); } }
  if (focus && focus.indexOf('rule:') === 0) { var rid = num(focus.slice(5)); hlRules.add(rid); var rule = IDX.rule.get(txt(rid)); if (rule) { arr(rule.when).concat(arr(rule.until)).forEach(function (c) { if (c.src === 'sensor') hlDevs.add('sensor:' + refKey(c, 'sensor_id')); }); arr(rule.do).concat(arr(rule.else_do)).forEach(function (a) { arr(a.state_ids).forEach(function (id) { hlStates.add(num(id)); var st2 = IDX.state.get(txt(id)); if (st2) { st2.io_refs.sensors.forEach(function (r) { hlDevs.add('sensor:' + refKey(r, 'sensor_id')); }); st2.io_refs.actuators.forEach(function (r) { hlDevs.add('actuator:' + refKey(r, 'actuator_id')); }); } }); }); } }
  if (focus && focus.indexOf('ctrl:') === 0) { var cu = focus.slice(5); devs.forEach(function (d) { if (d.dev.controller_uuid === cu) hlDevs.add(d.kind + ':' + refKey(d.dev, d.kind + '_id')); }); }
  var anyFocus = hlDevs.size || hlStates.size || hlRules.size;
  var edges = el('g'); var nodes = el('g'); svg.appendChild(edges); svg.appendChild(nodes);
  // node / controller frames and labels
  lastNode = null; lastCtrl = null;
  devs.forEach(function (d) {
    if (d.node !== lastNode) { nodes.appendChild(el('text', { x: x0, y: d.y - 40, class: 'lbl', text: 'Node ' + d.node })); lastNode = d.node; lastCtrl = null; }
    if (d.ctrl !== lastCtrl) { nodes.appendChild(el('text', { x: x0 + 6, y: d.y - 17, class: 'sub', text: d.ctrl.controller_key + ' · ' + d.ctrl.host })); lastCtrl = d.ctrl; }
  });
  var stateY = {}; CFG.process_states.forEach(function (s, i) { stateY[s.state_id] = top + 20 + i * 34; });
  var ruleY = {}; CFG.rules.forEach(function (r, i) { ruleY[r.rule_id] = top + 20 + i * 34; });
  function path(x1, y1, x2, y2, cls) { var mx = (x1 + x2) / 2; edges.appendChild(el('path', { d: 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2, class: cls })); }
  devs.forEach(function (d) {
    var key = d.kind + ':' + refKey(d.dev, d.kind + '_id'); var u = use(d.kind, refKey(d.dev, d.kind + '_id'));
    var used = u.states.length || (u.rules && u.rules.length);
    var hl = hlDevs.has(key);
    var dim = focus === 'unused' ? !!used : (anyFocus && !hl);
    var g = el('g', { opacity: dim ? 0.25 : 1, onClick: function () { S.invChip = 'all'; S.mapFocus = key; render(); } });
    g.appendChild(el('rect', { x: x0, y: d.y - 10, width: wDev, height: 22, rx: 5, class: 'dev' + (used ? '' : ' dev--unused') + (hl ? ' dev--hl' : '') }));
    g.appendChild(el('text', { x: x0 + 8, y: d.y + 5, class: 'lbl', text: (d.kind === 'sensor' ? 'S' : 'A') + d.dev[d.kind + '_id'] + '  ' + devTitle(d.dev, d.kind).slice(0, 30) }));
    g.appendChild(el('text', { x: x0 + wDev - 8, y: d.y + 5, class: 'sub', 'text-anchor': 'end', text: unitOf(d.dev) || (d.dev.function_type === 'write_coil' ? 'coil' : d.dev.function_type === 'write_register' ? 'reg' : '') }));
    if (u.states.some(function (id) { return isChanged('states', id); })) g.appendChild(el('circle', { cx: x0 - 6, cy: d.y + 1, r: 3.5, class: 'changed' }));
    nodes.appendChild(g);
    u.states.forEach(function (id) { var sy = stateY[id]; if (sy === undefined) return; var ehl = hlStates.has(num(id)) && hl; path(x0 + wDev, d.y + 1, xState, sy + 1, 'edge ' + (d.kind === 'sensor' ? 'edge--sensor' : 'edge--act') + (anyFocus ? (ehl || (hlStates.has(num(id)) && hlDevs.has(key)) ? ' edge--hl' : ' edge--dim') : '')); });
  });
  CFG.process_states.forEach(function (s) {
    var sy = stateY[s.state_id]; var hl = hlStates.has(num(s.state_id)); var dim = anyFocus && !hl && focus !== 'unused';
    var g = el('g', { opacity: dim ? 0.25 : 1, onClick: function () { S.invChip = 'all'; S.mapFocus = 'state:' + s.state_id; render(); } });
    g.appendChild(el('rect', { x: xState, y: sy - 10, width: wState, height: 24, rx: 6, class: 'state' + (hl ? ' state--hl' : '') }));
    g.appendChild(el('text', { x: xState + 8, y: sy + 5, class: 'lbl', text: '#' + s.state_id + ' ' + (TYPE_LABEL[stateTypeOf(s)] || '?') + ' · ' + ((IDX.process.get(txt(s.p_id)) || {}).process_name || '').slice(0, 16) }));
    g.appendChild(el('text', { x: xState + wState - 8, y: sy + 5, class: 'sub', 'text-anchor': 'end', text: num(s.value_id) === 1 ? 'aktiv' : modeName(s.mode_id) }));
    if (isChanged('states', s.state_id)) g.appendChild(el('circle', { cx: xState - 6, cy: sy + 2, r: 3.5, class: 'changed' }));
    nodes.appendChild(g);
    use('state', s.state_id).rules.forEach(function (rid) { var ry = ruleY[rid]; if (ry === undefined) return; path(xState + wState, sy + 2, xRule, ry + 2, 'edge edge--rule' + (anyFocus ? ((hl && hlRules.has(num(rid))) ? ' edge--hl' : ' edge--dim') : '')); });
  });
  CFG.rules.forEach(function (r) {
    var ry = ruleY[r.rule_id]; var hl = hlRules.has(num(r.rule_id)); var dim = anyFocus && !hl && focus !== 'unused';
    var g = el('g', { opacity: dim ? 0.25 : 1, onClick: function () { S.invChip = 'all'; S.mapFocus = 'rule:' + r.rule_id; render(); } });
    g.appendChild(el('rect', { x: xRule, y: ry - 10, width: wRule, height: 24, rx: 6, class: 'rule' + (hl ? ' rule--hl' : '') }));
    g.appendChild(el('text', { x: xRule + 8, y: ry + 5, class: 'lbl', text: '#' + r.rule_id + ' ' + r.name.slice(0, 26) }));
    g.appendChild(el('text', { x: xRule + wRule - 8, y: ry + 5, class: 'sub', 'text-anchor': 'end', text: SCOPE_LABEL[ruleScope(r)].slice(0, 12) }));
    if (isChanged('rules', r.rule_id)) g.appendChild(el('circle', { cx: xRule - 6, cy: ry + 2, r: 3.5, class: 'changed' }));
    nodes.appendChild(g);
  });
  nodes.appendChild(el('text', { x: xState, y: 18, class: 'sub', text: 'process_states' }));
  nodes.appendChild(el('text', { x: xRule, y: 18, class: 'sub', text: 'rules' }));
  nodes.appendChild(el('text', { x: x0, y: 18, class: 'sub', text: 'sensors / actuators' }));
  return svg;
}
function renderMapContext(focus) {
  if (!focus || focus === 'unused') {
    var unusedS = CFG.sensors.filter(function (s) { var u = use('sensor', refKey(s, 'sensor_id')); return !u.states.length && !u.rules.length; });
    var unusedA = CFG.actuators.filter(function (a) { return !use('actuator', refKey(a, 'actuator_id')).states.length; });
    return h('div', null, ctxSec('Nicht konfigurierte Geräte', h('div.impact', null, unusedS.map(function (s) { return h('div.i', null, h('b', { text: devShort(s, 'sensor') }), h('span', { text: devTitle(s, 'sensor') }), h('button.link.link--accent', { type: 'button', text: 'State anlegen', style: { marginLeft: 'auto' }, onClick: function () { setView('states', { editor: newStateEditor({ sensor: s }) }); } })); }), unusedA.map(function (a) { return h('div.i', null, h('b', { text: devShort(a, 'actuator') }), h('span', { text: devTitle(a, 'actuator') }), h('button.link.link--accent', { type: 'button', text: 'State anlegen', style: { marginLeft: 'auto' }, onClick: function () { setView('states', { editor: newStateEditor({ actuator: a }) }); } })); }), (unusedS.length + unusedA.length) ? null : h('div.hint', { text: 'Alle Geräte sind konfiguriert.' }))), ctxSec('Bedienung', h('div.hint', { text: 'Gerät, State oder Regel anklicken — die Karte hebt alle verbundenen Elemente hervor. Gestrichelte Geräte sind frei.' })));
  }
  var p = focus.split(':'); var kind = p[0]; var key = p.slice(1).join(':');
  if (kind === 'sensor' || kind === 'actuator') {
    var dev = IDX[kind].get(key); var u = use(kind, key);
    if (!dev) return h('div');
    return h('div', null, ctxSec(devShort(dev, kind), h('dl.kv', null, h('dt', { text: 'Funktion' }), h('dd', { text: devTitle(dev, kind) }), h('dt', { text: 'Node' }), h('dd', { text: nodeOfCtrl(dev.controller_uuid) + ' · ' + ctrlKey(dev.controller_uuid) }), h('dt', { text: 'Adresse' }), h('dd', { text: dev.address + ' · ' + dev.function_type }), h('dt', { text: 'Profil' }), h('dd', { text: dev.profile_id !== undefined ? (profileOf(dev.profile_id) || {}).name + ' [' + unitOf(dev) + ']' : 'keins (Rohwert!)' }), h('dt', { text: 'uuid' }), h('dd.mono', { style: { fontSize: '10px' }, text: dev.controller_uuid }))),
      ctxSec('States', u.states.length ? h('div.impact', null, u.states.map(function (id) { var s = IDX.state.get(txt(id)); return h('div.i', null, h('b', { text: '#' + id }), h('span', { text: TYPE_LABEL[stateTypeOf(s)] || '' }), h('button.link.link--accent', { type: 'button', text: 'Bearbeiten', style: { marginLeft: 'auto' }, onClick: function () { setView('states', { select: id, editor: stateEditorFor(s) }); } })); })) : h('div', null, h('div.hint', { text: 'Kein State nutzt dieses Gerät.' }), h('button.link', { type: 'button', text: 'State anlegen →', onClick: function () { var pf = {}; pf[kind] = dev; setView('states', { editor: newStateEditor(pf) }); } }))),
      kind === 'sensor' ? ctxSec('Regeln (direkt)', u.rules.length ? h('div.impact', null, u.rules.map(function (id) { var r = IDX.rule.get(txt(id)); return h('div.i', null, h('b', { text: '#' + id }), h('span', { text: r ? r.name : '' }), h('button.link.link--accent', { type: 'button', text: 'Öffnen', style: { marginLeft: 'auto' }, onClick: function () { setView('rules', { select: id, editor: ruleEditorFor(r) }); } })); })) : h('div', null, h('div.hint', { text: 'Keine Regel liest diesen Sensor.' }), h('button.link', { type: 'button', text: 'Regel anlegen →', onClick: function () { setView('rules', { editor: newRuleEditor({ sensor: dev }) }); } }))) : null,
      kind === 'sensor' ? ctxSec('Filter', u.filters.length ? h('div.chips', null, u.filters.map(function (f) { return badge('Filter ' + f, 'info'); })) : h('button.link', { type: 'button', text: 'Filter anlegen →', onClick: function () { setView('signals', { editor: newFilterEditor({ sensor: dev }) }); } })) : null);
  }
  if (kind === 'state') { var s = IDX.state.get(key); if (!s) return h('div'); return h('div', null, ctxSec('State #' + s.state_id, h('div', null, h('div.row', { style: { marginBottom: '6px' } }, badge(TYPE_LABEL[stateTypeOf(s)] || '?', 'accent'), scopeBadge(stateScope(s)), badge(valueName(s.value_id) + ' · ' + modeName(s.mode_id))), h('div.hint', { text: s.description || '' }), h('div', { style: { marginTop: '8px' } }, btn('Bearbeiten', { size: 'sm', variant: 'primary', onClick: function () { setView('states', { select: s.state_id, editor: stateEditorFor(s) }); } })))), ctxSec('V9', jsonPre(canonicalState(s)))); }
  if (kind === 'rule') { var r = IDX.rule.get(key); if (!r) return h('div'); return h('div', null, ctxSec('Regel #' + r.rule_id, h('div', null, h('div.row', { style: { marginBottom: '6px' } }, badge(r.group, 'info'), scopeBadge(ruleScope(r)), badge('P' + r.priority, null, true)), h('div.note', { text: 'Wenn ' + arr(r.when).map(describeCond).join(' und ') + (arr(r.until).length ? ', bis ' + arr(r.until).map(describeCond).join(' und ') : '') + ' → ' + arr(r.do).map(describeAct).join('; ') + (arr(r.else_do).length ? ' — sonst ' + arr(r.else_do).map(describeAct).join('; ') : '') }), h('div', { style: { marginTop: '8px' } }, btn('Bearbeiten', { size: 'sm', variant: 'primary', onClick: function () { setView('rules', { select: r.rule_id, editor: ruleEditorFor(r) }); } })))), (function () { var band = switchingBehaviourSvg(r); return band ? ctxSec('Schaltverhalten', band) : null; })(), ctxSec('Signalfluss', h('div', { style: { overflow: 'auto' } }, ruleFlowSvg(r, {}))), ctxSec('V9', jsonPre(r))); }
  if (kind === 'ctrl') { var c = ctrlOf(key); if (!c) return h('div'); return h('div', null, ctxSec(c.controller_key, h('dl.kv', null, h('dt', { text: 'Gerät' }), h('dd', { text: c.device_name + ' · ' + c.bus_type }), h('dt', { text: 'Host' }), h('dd', { text: c.host + ':' + c.port + ' unit ' + c.unit }), h('dt', { text: 'Node' }), h('dd', { text: c.node_id }), h('dt', { text: 'uuid' }), h('dd.mono', { style: { fontSize: '10px' }, text: c.controller_uuid })))); }
  return h('div');
}



/* ==================================================================== host bridge
 * Everything above is host-agnostic UI logic shared with the design prototype.
 * The bridge binds the service hooks to the existing V9 infrastructure.
 * ================================================================================ */

/** Sections the studio may write. Everything else is read-only here (Topologie owns I/O). */
var AS_WRITABLE_SECTIONS = [
  'processes', 'process_states', 'rules', 'filters', 'timers', 'rule_engine',
  'parameter_generic_templates', 'schema_mappings', 'pid_configs', 'control_methods',
  'control_method_templates', 'process_modes', 'process_values'
];
var AS_ICONS = [["i-workspace",[["rect",{"x":"3.5","y":"3.5","width":"7","height":"7","rx":"1.2"}],["rect",{"x":"13.5","y":"3.5","width":"7","height":"7","rx":"1.2"}],["rect",{"x":"3.5","y":"13.5","width":"7","height":"7","rx":"1.2"}],["path",{"d":"M17 13.5v7M13.5 17h7"}]]],["i-flow",[["circle",{"cx":"6","cy":"6","r":"2.2"}],["circle",{"cx":"18","cy":"6","r":"2.2"}],["circle",{"cx":"12","cy":"18","r":"2.2"}],["path",{"d":"M8.2 6h7.6M7.5 8l3.2 7.8M16.5 8l-3.2 7.8"}]]],["i-topology",[["rect",{"x":"9","y":"3","width":"6","height":"5","rx":"1"}],["rect",{"x":"3","y":"16","width":"6","height":"5","rx":"1"}],["rect",{"x":"15","y":"16","width":"6","height":"5","rx":"1"}],["path",{"d":"M12 8v4M6 12h12M6 12v4M18 12v4"}]]],["i-monitor",[["rect",{"x":"3","y":"4","width":"18","height":"13","rx":"1.5"}],["path",{"d":"M8 21h8M12 17v4M6.5 13l3-3 2.3 2.2 4.2-5 1.5 1.6"}]]],["i-shield",[["path",{"d":"M12 3l7 3v5.3c0 4.6-2.8 7.7-7 9.7-4.2-2-7-5.1-7-9.7V6z"}],["path",{"d":"M8.5 12l2.2 2.2 4.8-5"}]]],["i-settings",[["circle",{"cx":"12","cy":"12","r":"3.2"}],["path",{"d":"M12 3.5v2.6M12 17.9v2.6M20.5 12h-2.6M6.1 12H3.5M18 6l-1.8 1.8M7.8 16.2L6 18M18 18l-1.8-1.8M7.8 7.8L6 6"}]]],["i-moon",[["path",{"d":"M20.5 14.2A8 8 0 119.8 3.5a7 7 0 0010.7 10.7z"}]]],["i-sun",[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1L5.3 5.3"}]]],["i-save",[["path",{"d":"M5 5h11l3 3v11H5z"}],["path",{"d":"M9 5v5h6V5M8 19v-6h8v6"}]]],["i-eye",[["path",{"d":"M2.8 12s3.5-6 9.2-6 9.2 6 9.2 6-3.5 6-9.2 6-9.2-6-9.2-6z"}],["circle",{"cx":"12","cy":"12","r":"2.5"}]]],["i-check",[["path",{"d":"M4.5 12.5l4.5 4.5 10-10"}]]],["i-folder",[["path",{"d":"M3 19V6h6l2 2.5h10V19z"}]]],["i-more",[["circle",{"cx":"5","cy":"12","r":"1.7","fill":"currentColor","stroke":"none"}],["circle",{"cx":"12","cy":"12","r":"1.7","fill":"currentColor","stroke":"none"}],["circle",{"cx":"19","cy":"12","r":"1.7","fill":"currentColor","stroke":"none"}]]],["i-search",[["circle",{"cx":"10.5","cy":"10.5","r":"6.5"}],["path",{"d":"M15.5 15.5L21 21"}]]],["i-plus",[["path",{"d":"M12 6v12M6 12h12"}]]],["i-warn",[["path",{"d":"M12 4l9 16H3z"}],["path",{"d":"M12 10v4.5M12 17.4v.1"}]]],["i-help",[["circle",{"cx":"12","cy":"12","r":"8.2"}],["path",{"d":"M9.7 9.5a2.35 2.35 0 114 1.65c-.65.65-1.7 1.05-1.7 2.15"}],["path",{"d":"M12 16.5v.1"}]]],["i-cpu",[["rect",{"x":"6","y":"6","width":"12","height":"12","rx":"1.5"}],["path",{"d":"M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"}]]],["i-rule",[["path",{"d":"M5 6h14M5 12h9M5 18h5"}]]],["i-clock",[["circle",{"cx":"12","cy":"12","r":"8"}],["path",{"d":"M12 7v5l3.2 2"}]]],["i-chart",[["path",{"d":"M4 18V7M9 18V4M14 18v-8M19 18v-5"}]]],["i-layers",[["path",{"d":"M12 3l9 5-9 5-9-5z"}],["path",{"d":"M3 13l9 5 9-5"}]]],["i-link",[["path",{"d":"M10 14a4 4 0 005.7 0l3-3a4 4 0 10-5.7-5.7L11.6 6.7"}],["path",{"d":"M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 105.7 5.7l1.4-1.4"}]]],["i-temp",[["path",{"d":"M10 4.5a2 2 0 014 0v9.2a4 4 0 11-4 0z"}],["path",{"d":"M12 9v6"}]]],["i-gauge",[["path",{"d":"M4 16a8 8 0 1116 0"}],["path",{"d":"M12 16l4-5"}],["circle",{"cx":"12","cy":"16","r":"1.2"}]]],["i-snow",[["path",{"d":"M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"}]]],["i-wave",[["path",{"d":"M3 12c2.5-4 5-4 7.5 0s5 4 7.5 0 3-3 3-3"}]]],["i-valve",[["path",{"d":"M4 7l8 5-8 5zM20 7l-8 5 8 5z"}],["path",{"d":"M12 12V5M9 5h6"}]]],["i-stir",[["path",{"d":"M12 3v12"}],["path",{"d":"M6 15c0 3 2.7 5 6 5s6-2 6-5"}],["path",{"d":"M8 9h8"}]]],["i-inflow",[["path",{"d":"M3 12h12M11 8l4 4-4 4"}],["rect",{"x":"17","y":"5","width":"4","height":"14","rx":"1"}]]],["i-pump",[["circle",{"cx":"12","cy":"13","r":"6"}],["path",{"d":"M12 7V3M8 3h8M12 13l3-3"}]]],["i-react",[["path",{"d":"M9 3h6M10 3v6l-5 9a2 2 0 001.8 3h10.4a2 2 0 001.8-3l-5-9V3"}]]],["i-inbox",[["path",{"d":"M3 13l2-8h14l2 8v6H3z"}],["path",{"d":"M3 13h5l1.5 2h5L16 13h5"}]]],["i-bolt",[["path",{"d":"M13 3L5 13h6l-1 8 8-10h-6z"}]]],["i-trash",[["path",{"d":"M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"}]]],["i-copy",[["rect",{"x":"8","y":"8","width":"12","height":"12","rx":"1.5"}],["path",{"d":"M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"}]]],["i-undo",[["path",{"d":"M8 7L4 11l4 4"}],["path",{"d":"M4 11h9a5 5 0 010 10H9"}]]],["i-info",[["circle",{"cx":"12","cy":"12","r":"8.2"}],["path",{"d":"M12 11v5M12 8v.1"}]]],["i-bell",[["path",{"d":"M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"}],["path",{"d":"M10 20a2 2 0 004 0"}]]],["i-filter",[["path",{"d":"M4 5h16l-6 7v6l-4 2v-8z"}]]],["i-map",[["circle",{"cx":"5","cy":"12","r":"2.2"}],["circle",{"cx":"19","cy":"7","r":"2.2"}],["circle",{"cx":"19","cy":"17","r":"2.2"}],["path",{"d":"M7.2 12h4.2c2.3 0 2.8-5 5.4-5M11.4 12c2.3 0 2.8 5 5.4 5"}]]],["i-sparkle",[["path",{"d":"M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"}],["path",{"d":"M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"}]]]];
var asSyncing = false;
var asOwners = new Map();

function installIconSprite() {
  if (document.getElementById('as-icon-sprite')) return;
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('id', 'as-icon-sprite');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.setAttribute('style', 'position:absolute');
  svg.setAttribute('aria-hidden', 'true');
  AS_ICONS.forEach(function (entry) {
    var symbol = document.createElementNS(NS, 'symbol');
    symbol.setAttribute('id', entry[0]);
    symbol.setAttribute('viewBox', '0 0 24 24');
    entry[1].forEach(function (shape) {
      var node = document.createElementNS(NS, shape[0]);
      Object.keys(shape[1]).forEach(function (k) { node.setAttribute(k, shape[1][k]); });
      symbol.appendChild(node);
    });
    svg.appendChild(symbol);
  });
  document.body.appendChild(svg);
}

/** Copies the store config into the working copy and rebuilds the indexes. */
function adoptFromStore() {
  var cfg = store.getConfig();
  if (!cfg) return false;
  CFG = clone(cfg);
  asOwners = ownerIndex(CFG);
  rebuildIndex();
  rebuildUsage();
  return true;
}

/* --- service hooks ------------------------------------------------------------- */
pushHistory = function () { /* history lives in v9_store (HISTORY_LIMIT 60) */ };
commitModel = function () {
  var current = store.getConfig() || {};
  var patch = {};
  var changed = false;
  AS_WRITABLE_SECTIONS.forEach(function (name) {
    if (JSON.stringify(arr(CFG[name])) !== JSON.stringify(arr(current[name]))) {
      patch[name] = clone(arr(CFG[name]));
      changed = true;
    }
  });
  if (changed) {
    asSyncing = true;
    try { store.replaceSections(patch); } finally { asSyncing = false; }
  }
  adoptFromStore();
};
undo = function () {
  if (!store.getState().canUndo) { toast('Nichts rückgängig zu machen.', 'warn'); return; }
  store.undo();
  toast('Rückgängig.', 'ok');
};
isDirty = function () { return !!store.getState().dirty; };
toast = function (message, tone) {
  v9Toast(message, tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'info');
};
confirmAction = function (message, title, onOk) {
  v9Modal({
    title: title || 'Bestätigen',
    body: h('p', { text: message }),
    submitLabel: 'Löschen',
    onSubmit: function () { onOk(); return true; }
  });
};
scopeOfUuids = function (uuids) { return scopeForControllers(uuids, asOwners); };

/* --- libraries (read-only server endpoints) ------------------------------------- */
function loadLibraries() {
  function fetchTemplates(url) {
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (response) { return response.ok ? response.json() : { templates: [] }; })
      .then(function (payload) { return arr(payload && payload.templates); })
      .catch(function () { return []; });
  }
  return Promise.all([fetchTemplates('/api/process-library-v9'), fetchTemplates('/api/rule-library-v9')])
    .then(function (result) { LIB = { process_templates: result[0], rule_templates: result[1] }; });
}

/* --- shell inside the panel ------------------------------------------------------ */
function buildShell(container) {
  var root = h('div.as-root', { 'data-as': 'root' },
    h('div.as-bar', null,
      h('nav.subnav', { 'data-as': 'subnav', 'aria-label': 'Automation Studio Bereiche' }),
      h('div.as-bar__status', { 'data-as': 'status' })),
    h('div.stage', { 'data-as': 'stage' },
      h('aside.pane.pane--inv', { 'data-as': 'inv', 'aria-label': 'Inventar' }),
      h('main.pane.pane--editor', { 'data-as': 'editor', 'aria-label': 'Editor' }),
      h('aside.pane.pane--ctx', { 'data-as': 'ctx', 'aria-label': 'Kontext' })));
  mount(container, root);
  return root;
}

function panelVisible() {
  var panel = document.getElementById('tab-v9-automation');
  return !!(panel && panel.classList.contains('active'));
}

/** Entry point, registered in v9_bootstrap.PANELS. */
export function initAutomationPanel(container) {
  installIconSprite();
  AS_ROOT = buildShell(container);
  var stale = false;

  store.on('config:changed', function () {
    if (asSyncing) return;          // our own commit: the caller renders
    adoptFromStore();
    if (panelVisible()) render(); else stale = true;
  });
  store.on('config:saved', function () { S.changed = {}; refreshChrome(); });
  document.addEventListener('plant:workspace-activated', function (event) {
    if (!event.detail || event.detail.tab !== 'v9-automation') return;
    if (stale) { stale = false; adoptFromStore(); }
    if (CFG) render();
  });
  // Fallback when the route is activated through the compatibility tab list only.
  var tabButton = document.getElementById('tab-btn-v9-automation');
  if (tabButton) tabButton.addEventListener('click', function () { if (CFG && !AS_ROOT.querySelector('.subnav button')) render(); });
  document.addEventListener('keydown', function (event) {
    if (!panelVisible()) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      var search = AS_ROOT.querySelector('.search input');
      if (search) { event.preventDefault(); search.focus(); }
    }
  });

  // First render is lazy: the panel builds its DOM when the route is opened,
  // so hidden studio content never competes with other panels (text locators, focus order).
  if (!adoptFromStore()) mount(AS_ROOT, h('p.v9-empty', { text: 'Keine Konfiguration geladen.' }));
  else if (panelVisible()) render();
  else stale = true;
  loadLibraries().then(function () { if (CFG && panelVisible()) render(); });
}

/** Console/test access (window.__v9.automation). */
export function automationDebugApi() {
  return { state: S, config: function () { return CFG; }, render: render, setView: setView, recommendations: recommendations };
}
