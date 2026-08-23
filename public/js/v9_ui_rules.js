/**
 * v9_ui_rules.js — Panel "RuleEngine (V9)".
 *
 * Konsolidiert fachlich die früher getrennten Regelquellen:
 *   A  rules_generator.js  → dynamic_rule_engine {condition, action}
 *   B  legacy automation_rule_sets → archived migration input only
 *   C  hmi.js              → sensor_cmp/actuator_cmp für Styles/Alarme
 *
 * V9 kennt genau ein Modell:
 *   rule_engine (Singleton) + rules[] mit when[]/until[]/do[]/else_do[]
 *   Bedingung: {src: state|sensor|timer, op: ==|!=|>|>=|<|<=|elapsed|fired,
 *               value: number|bool|{param_of_state,key[,scale]}}
 *   Aktion   : genau ein Handler-Marker — state_ids | p_ids | notify
 *
 * Das UI erzwingt diese Enums an der Quelle, statt sie beim Export zu reparieren.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { ENUMS, CRITICAL_GROUPS, RUNTIME_ONLY_OPERATORS } from './v9_schema.js';
import * as store from './v9_store.js';
import {
  h, mount, card, table, field, input, select, checkbox, button, badge, pill,
  toolbar, modal, toast, definitionList, textarea, disclosure
} from './v9_dom.js';
import { classifyScopes } from './v9_shard.js';
import {
  ensureArray, isPlainObject, toText, toIntOrNull, toNumberOrNull, indexBy,
  safeJsonParse, pretty, shrinkText
} from './shared_utils.js';

let host = null;

export function initRulesPanel(container) {
  host = container;
  store.on('config:changed', render);
  render();
}

function render() {
  if (!host) return;
  const config = store.getConfig();
  if (!config) {
    mount(host, h('p.v9-empty', { text: 'Keine Konfiguration geladen.' }));
    return;
  }
  mount(host, [
    renderToolbar(config),
    renderEngine(config),
    renderRules(config),
    renderFilters(config),
    renderTimers(config)
  ]);
}

const SCOPE_TONE = {
  local_controller: 'ok', cross_controller: 'warn',
  cross_worker: 'warn', unbound: 'muted', invalid: 'danger'
};

function renderToolbar(config) {
  const active = ensureArray(config.rules).filter(function (rule) {
    return rule.enabled !== false && toText(rule.activation_state) === 'active';
  }).length;
  return toolbar([
    pill(ensureArray(config.rules).length + ' Regeln (' + active + ' aktiv)', 'info'),
    pill(ensureArray(config.filters).length + ' Filter', 'info'),
    pill(ensureArray(config.timers).length + ' Timer', 'info'),
    button('Regel anlegen', { size: 'sm', icon: '＋', onClick: function () { openRuleModal(null); } }),
    button('Filter anlegen', { size: 'sm', variant: 'ghost', icon: '＋', onClick: openFilterModal }),
    button('Timer anlegen', { size: 'sm', variant: 'ghost', icon: '＋', onClick: openTimerModal })
  ]);
}

/* ------------------------------------------------------------- rule_engine */

function renderEngine(config) {
  const engine = ensureArray(config.rule_engine)[0] || {};
  const runtime = isPlainObject(engine.runtime) ? engine.runtime : {};
  const safety = isPlainObject(engine.safety) ? engine.safety : {};
  const modes = indexBy(config.process_modes, 'mode_id');
  const mode = modes.get(toIntOrNull(engine.required_mode_id));

  const node = card('Rule-Engine', {
    key: 'rule_engine',
    meta: pill('Singleton — V9 hat genau eine Engine', 'info'),
    actions: button('Bearbeiten', { size: 'sm', onClick: function () { openEngineModal(engine); } })
  });

  node.body.appendChild(definitionList([
    ['engine_id', String(toIntOrNull(engine.engine_id))],
    ['enabled', badge(engine.enabled !== false ? 'ja' : 'nein',
      engine.enabled !== false ? 'ok' : 'danger')],
    ['required_mode_id', toIntOrNull(engine.required_mode_id)
      + (mode ? ' (' + toText(mode.mode) + ')' : '')],
    ['writable_fields', ensureArray(engine.writable_fields).join(', ') || '—'],
    ['sp_tolerance', String(engine.sp_tolerance)],
    ['max_signal_age_s', String(runtime.max_signal_age_s)],
    ['coordinator_min_priority', String(runtime.coordinator_min_priority)],
    ['safety.on_missing_sensor', pretty(safety.on_missing_sensor)]
  ]));

  node.body.appendChild(h('p.v9-note', { text:
    'Von den runtime-Feldern liest der Worker nur max_signal_age_s und '
    + 'coordinator_min_priority; die übrigen sind deklarative Dokumentation. '
    + 'Aus safety wird ausschließlich on_missing_sensor ausgewertet.' }));

  return node;
}

function openEngineModal(engine) {
  const config = store.getConfig();
  const modeSelect = select({
    items: ensureArray(config.process_modes).map(function (mode) {
      return { value: String(mode.mode_id), label: '#' + mode.mode_id + ' · ' + toText(mode.mode) };
    }),
    value: String(toIntOrNull(engine.required_mode_id))
  });
  const enabledCheck = checkbox({ checked: engine.enabled !== false });
  const toleranceInput = input({ type: 'number', step: '0.01', value: engine.sp_tolerance });
  const writableInput = input({ value: ensureArray(engine.writable_fields).join(', ') });
  const runtimeArea = textarea({ rows: 10,
    value: pretty(isPlainObject(engine.runtime) ? engine.runtime : {}) });
  const safetyArea = textarea({ rows: 6,
    value: pretty(isPlainObject(engine.safety) ? engine.safety : {}) });
  const debugArea = textarea({ rows: 6,
    value: pretty(isPlainObject(engine.debug) ? engine.debug : {}) });

  modal({
    wide: true,
    title: 'Rule-Engine bearbeiten',
    body: h('div.v9-form.v9-form--grid', null,
      field('required_mode_id', modeSelect, { required: true,
        hint: 'Regeln schreiben nur States mit genau dieser mode_id ("skipped_mode").' }),
      field('enabled', enabledCheck),
      field('sp_tolerance', toleranceInput),
      field('writable_fields', writableInput, { wide: true,
        hint: 'Kommagetrennt. Aktionsfelder außerhalb dieser Liste verwirft der Worker.' }),
      field('runtime (JSON)', runtimeArea, { wide: true }),
      field('safety (JSON)', safetyArea, { wide: true }),
      field('debug (JSON)', debugArea, { wide: true })),
    submitLabel: 'Speichern',
    onSubmit: function () {
      const runtime = safeJsonParse(runtimeArea.value, undefined);
      const safety = safeJsonParse(safetyArea.value, undefined);
      const debug = safeJsonParse(debugArea.value, undefined);
      if (!isPlainObject(runtime) || !isPlainObject(safety) || !isPlainObject(debug)) {
        toast('runtime, safety und debug müssen JSON-Objekte sein.', 'danger');
        return false;
      }
      store.replaceSection('rule_engine', [Object.assign({}, engine, {
        required_mode_id: toIntOrNull(modeSelect.value),
        enabled: enabledCheck.checked,
        sp_tolerance: toNumberOrNull(toleranceInput.value),
        writable_fields: writableInput.value.split(',').map(function (item) {
          return item.trim();
        }).filter(Boolean),
        runtime, safety, debug
      })]);
      toast('Rule-Engine gespeichert.', 'ok');
      return true;
    }
  });
}

/* -------------------------------------------------------------------- rules */

function renderRules(config) {
  const scopes = classifyScopes(config);
  const node = card('Regeln', {
    key: 'rules',
    meta: pill('when[] ist immer UND-verknüpft — V9 kennt kein when_any/when_none', 'info')
  });

  node.body.appendChild(table([
    { key: 'rule_id', label: 'ID', align: 'right' },
    { key: 'name', label: 'Name' },
    { label: 'Gruppe', render: function (row) {
      const critical = CRITICAL_GROUPS.indexOf(toText(row.group)) >= 0;
      return badge(toText(row.group), critical ? 'danger' : 'info');
    } },
    { key: 'priority', label: 'Prio', align: 'right' },
    { label: 'Bedingung', render: function (row) {
      return h('div.v9-cond-list', null, ensureArray(row.when).map(function (cond) {
        return h('code.v9-code', { text: describeCondition(cond, config) });
      }));
    } },
    { label: 'Aktion', render: function (row) {
      return h('div.v9-cond-list', null, ensureArray(row.do).map(function (action) {
        return h('code.v9-code', { text: describeAction(action, config) });
      }));
    } },
    { label: 'Lifecycle', render: function (row) {
      return h('div.v9-badges', null,
        badge(toText(row.activation_state),
          toText(row.activation_state) === 'active' ? 'ok' : 'muted'),
        badge(toText(row.deployment_status),
          toText(row.deployment_status).indexOf('active') === 0 ? 'ok' : 'warn'),
        badge('epoch ' + row.execution_epoch, 'muted'));
    } },
    { label: 'Scope', render: function (row) {
      const scope = scopes.rules.get(toIntOrNull(row.rule_id)) || 'unbound';
      return badge(scope, SCOPE_TONE[scope] || 'muted');
    } },
    { label: 'Aktiv', align: 'center', render: function (row) {
      return checkbox({ checked: row.enabled !== false, onChange: function (event) {
        const enabled = event.target.checked;
        store.update('rules', row.rule_id, {
          enabled,
          execution_epoch: enabled ? Math.max(1, toIntOrNull(row.execution_epoch) || 0) : 0,
          activation_state: enabled ? 'active' : 'inactive',
          deployment_status: enabled ? 'active_node' : 'disabled_with_reason',
          disabled_reason: enabled ? undefined : 'Im Editor deaktiviert'
        });
      } });
    } },
    { label: '', align: 'right', render: function (row) {
      return h('div.v9-row-actions', null,
        button('Bearbeiten', { size: 'sm', variant: 'ghost',
          onClick: function () { openRuleModal(row); } }),
        button('JSON', { size: 'sm', variant: 'ghost',
          onClick: function () { showJson('Regel ' + row.rule_id, row); } }),
        button('Löschen', { size: 'sm', variant: 'ghost',
          onClick: function () {
            modal({
              title: 'Regel löschen',
              body: h('p', { text: 'Regel ' + row.rule_id + ' ("' + toText(row.name)
                + '") löschen?' }),
              submitLabel: 'Löschen',
              onSubmit: function () {
                store.remove('rules', row.rule_id);
                toast('Regel gelöscht.', 'ok');
                return true;
              }
            });
          } }));
    } }
  ], ensureArray(config.rules), { emptyText: 'Keine Regeln', rowKey: 'rule_id' }));

  return node;
}

export function describeCondition(cond, config) {
  if (!isPlainObject(cond)) return '(ungültig)';
  const src = toText(cond.src);
  const op = toText(cond.op);
  const value = isPlainObject(cond.value)
    ? 'param(' + cond.value.param_of_state + '.' + toText(cond.value.key) + ')'
    : String(cond.value);

  if (src === 'sensor') {
    const controllers = indexBy((config || {}).controllers, 'controller_uuid');
    const controller = controllers.get(toText(cond.controller_uuid));
    return 'sensor ' + cond.sensor_id + '@' + (controller ? toText(controller.controller_key) : '?')
      + (cond.filter_id !== undefined ? ' [filter ' + cond.filter_id + ']' : '')
      + ' ' + op + ' ' + value;
  }
  if (src === 'state') {
    return 'state ' + cond.state_id + '.' + (toText(cond.field) || 'value_id') + ' ' + op + ' ' + value;
  }
  if (src === 'timer') return 'timer ' + cond.timer_id + ' ' + op;
  return src + ' ' + op + ' ' + value;
}

export function describeAction(action, config) {
  if (!isPlainObject(action)) return '(ungültig)';
  if (action.notify !== undefined) return 'notify "' + shrinkText(action.notify, 40) + '"';
  const values = indexBy((config || {}).process_values, 'value_id');
  const value = values.get(toIntOrNull(action.value_id));
  const suffix = action.value_id !== undefined
    ? ' := ' + action.value_id + (value ? ' (' + toText(value.state_value) + ')' : '') : '';
  const parameters = isPlainObject(action.parameters) && Object.keys(action.parameters).length
    ? ' + params' : '';
  if (Array.isArray(action.state_ids)) {
    return 'states [' + action.state_ids.join(',') + ']' + suffix + parameters;
  }
  if (Array.isArray(action.p_ids)) {
    return 'processes [' + action.p_ids.join(',') + ']' + suffix + parameters;
  }
  return '(kein Handler-Marker)';
}

/* --------------------------------------------------------------- Regel-Dialog */

function openRuleModal(row) {
  const config = store.getConfig();
  const isNew = !row;
  const rule = row || {};

  const idInput = input({ type: 'number', min: 1,
    value: rule.rule_id === undefined ? nextRuleId(config) : rule.rule_id });
  const nameInput = input({ value: toText(rule.name) });
  const groupSelect = select({ items: ENUMS.rule_group, value: toText(rule.group) || 'process' });
  const prioInput = input({ type: 'number', min: 0,
    value: rule.priority === undefined ? 100 : rule.priority });
  const ownerSelect = select({
    items: ensureArray(config.nodes).map(function (node) {
      return { value: toText(node.node_id), label: toText(node.node_id) };
    }),
    value: toText(rule.owner_node_id)
  });
  const enabledCheck = checkbox({ checked: rule.enabled !== false });
  const activationSelect = select({ items: ENUMS.activation_state,
    value: toText(rule.activation_state) || 'active' });
  const deploymentSelect = select({ items: ENUMS.deployment_status,
    value: toText(rule.deployment_status) || 'active_node' });
  const epochInput = input({ type: 'number', min: 0,
    value: rule.execution_epoch === undefined ? 1 : rule.execution_epoch });
  const latchSelect = select({ items: [{ value: '', label: '— kein Latch —' }]
    .concat(ENUMS.latch), value: toText(rule.latch) });
  const descriptionInput = input({ value: toText(rule.description) });
  const reasonInput = input({ value: toText(rule.disabled_reason) });

  // Neue Regeln starten mit je einer vorbelegten Bedingung und Aktion —
  // when[] und do[] sind im V9-Vertrag Pflicht (min_len 1), ein leeres
  // Formular wäre von vornherein ungültig.
  const seedWhen = ensureArray(rule.when);
  const seedDo = ensureArray(rule.do);
  const firstSensor = ensureArray(config.sensors)[0];
  const firstState = ensureArray(config.process_states)[0];

  const whenList = createConditionList(
    seedWhen.length ? seedWhen : [firstSensor
      ? { src: 'sensor', op: '>=', value: 0, sensor_id: toIntOrNull(firstSensor.sensor_id),
        controller_uuid: toText(firstSensor.controller_uuid) }
      : { src: 'state', op: '==', value: 1,
        state_id: firstState ? toIntOrNull(firstState.state_id) : 1, field: 'value_id' }],
    config, 'when');
  const untilList = createConditionList(ensureArray(rule.until), config, 'until');
  const doList = createActionList(
    seedDo.length ? seedDo : [{
      state_ids: firstState ? [toIntOrNull(firstState.state_id)] : [],
      value_id: 1
    }], config, 'do');
  const elseList = createActionList(ensureArray(rule.else_do), config, 'else_do');

  modal({
    wide: true,
    title: isNew ? 'Regel anlegen' : 'Regel ' + rule.rule_id + ' bearbeiten',
    body: h('div.v9-form.v9-form--grid', null,
      field('rule_id', idInput, { required: true }),
      field('Name', nameInput, { required: true }),
      field('group', groupSelect, { required: true,
        hint: 'Gruppen aus CRITICAL_GROUPS dürfen niemals cross ausgeführt werden.' }),
      field('priority', prioInput, { required: true,
        hint: 'Auswertung nach (priority, rule_id); der letzte Schreiber gewinnt. '
          + 'Ab coordinator_min_priority läuft die Aktion im Coordinator-Scope.' }),
      field('owner_node_id', ownerSelect, { required: true,
        hint: 'Bestimmt zugleich execution_owner und execution_scope ("node:<id>").' }),
      field('enabled', enabledCheck),
      field('activation_state', activationSelect, { required: true }),
      field('deployment_status', deploymentSelect, { required: true }),
      field('execution_epoch', epochInput, { required: true,
        hint: 'Monotoner Fencing-Zähler. Ein veralteter Wert führt zu execution_epoch_stale.' }),
      field('latch', latchSelect, { hint: '"manual" verriegelt bis reset_rule_latch(); '
        + '"auto" hat in der Runtime keine Wirkung.' }),
      field('disabled_reason', reasonInput, { wide: true,
        hint: 'Pflicht, sobald deployment_status = disabled_with_reason.' }),
      field('description', descriptionInput, { wide: true }),
      h('div.v9-form__span', null,
        h('h4.v9-subhead', { text: 'when[] — alle Bedingungen müssen zutreffen' }), whenList.node),
      h('div.v9-form__span', null,
        h('h4.v9-subhead', { text: 'until[] — optional, macht die Regel zum Schmitt-Trigger' }),
        untilList.node),
      h('div.v9-form__span', null,
        h('h4.v9-subhead', { text: 'do[] — Aktionen bei erfüllter Bedingung' }), doList.node),
      h('div.v9-form__span', null,
        h('h4.v9-subhead', { text: 'else_do[] — optional' }), elseList.node)),
    submitLabel: isNew ? 'Anlegen' : 'Speichern',
    onSubmit: function () {
      const when = whenList.read();
      const actions = doList.read();
      if (!when.length) {
        toast('when[] braucht mindestens eine Bedingung.', 'danger');
        return false;
      }
      if (!actions.length) {
        toast('do[] braucht mindestens eine Aktion.', 'danger');
        return false;
      }
      if (!nameInput.value.trim()) {
        toast('Name ist Pflicht.', 'danger');
        return false;
      }
      if (deploymentSelect.value === 'disabled_with_reason' && !reasonInput.value.trim()) {
        toast('deployment_status "disabled_with_reason" verlangt einen disabled_reason.', 'danger');
        return false;
      }
      const patch = {
        rule_id: toIntOrNull(idInput.value) || 1,
        engine_id: 1,
        owner_node_id: ownerSelect.value,
        execution_owner: ownerSelect.value,
        execution_scope: 'node:' + ownerSelect.value,
        execution_epoch: toIntOrNull(epochInput.value) || 0,
        deployment_status: deploymentSelect.value,
        activation_state: activationSelect.value,
        group: groupSelect.value,
        priority: toIntOrNull(prioInput.value) || 0,
        name: nameInput.value.trim(),
        enabled: enabledCheck.checked,
        when,
        do: actions,
        until: untilList.read(),
        else_do: elseList.read(),
        latch: latchSelect.value || undefined,
        disabled_reason: reasonInput.value.trim() || undefined,
        description: descriptionInput.value.trim()
      };
      if (isNew) store.add('rules', patch);
      else store.update('rules', rule.rule_id, patch);
      toast(isNew ? 'Regel angelegt.' : 'Regel gespeichert.', 'ok');
      return true;
    }
  });
}

function nextRuleId(config) {
  let max = 0;
  ensureArray(config.rules).forEach(function (row) {
    const value = toIntOrNull(row.rule_id);
    if (value !== null && value > max) max = value;
  });
  return max + 1;
}

/* ------------------------------------------------- Bedingungs-/Aktionslisten */

function createConditionList(initial, config, label) {
  const rows = [];
  const body = h('div.v9-list');
  const node = h('div.v9-list-wrap', null, body,
    button('Bedingung hinzufügen', { size: 'sm', variant: 'ghost', icon: '＋',
      onClick: function () { addRow({ src: 'sensor', op: '>=', value: 0 }); } }));

  function addRow(cond) {
    const entry = createConditionRow(cond, config, function () {
      const index = rows.indexOf(entry);
      if (index >= 0) rows.splice(index, 1);
      body.removeChild(entry.node);
    });
    rows.push(entry);
    body.appendChild(entry.node);
  }

  ensureArray(initial).forEach(addRow);
  return { node, read: function () {
    return rows.map(function (entry) { return entry.read(); }).filter(Boolean);
  } };
}

function createConditionRow(cond, config, onRemove) {
  const source = isPlainObject(cond) ? cond : {};
  const srcSelect = select({ items: ENUMS.rule_src, value: toText(source.src) || 'sensor' });
  const opSelect = select({ items: ENUMS.rule_op, value: toText(source.op) || '>=' });

  const sensorSelect = select({
    items: ensureArray(config.sensors).map(function (sensor) {
      return { value: toText(sensor.controller_uuid) + ':' + toIntOrNull(sensor.sensor_id),
        label: 'S' + sensor.sensor_id + ' · ' + toText(sensor.controller_key) };
    }),
    value: toText(source.controller_uuid) + ':' + toIntOrNull(source.sensor_id)
  });
  const filterSelect = select({
    items: [{ value: '', label: '— ungefiltert —' }].concat(
      ensureArray(config.filters).map(function (filter) {
        return { value: String(filter.filter_id), label: 'Filter ' + filter.filter_id };
      })),
    value: source.filter_id === undefined ? '' : String(source.filter_id)
  });
  const stateSelect = select({
    items: ensureArray(config.process_states).map(function (state) {
      return { value: String(state.state_id), label: 'State ' + state.state_id };
    }),
    value: source.state_id === undefined ? '' : String(source.state_id)
  });
  const fieldInput = input({ value: toText(source.field) || 'value_id' });
  const timerSelect = select({
    items: ensureArray(config.timers).map(function (timer) {
      return { value: String(timer.timer_id), label: 'Timer ' + timer.timer_id };
    }),
    value: source.timer_id === undefined ? '' : String(source.timer_id)
  });
  const valueInput = input({ type: 'text',
    value: isPlainObject(source.value) ? JSON.stringify(source.value) : toText(source.value) });
  const cooldownInput = input({ type: 'number', min: 0, step: '0.1',
    value: source.cooldown_s === undefined ? '' : source.cooldown_s });

  const sensorCell = h('div.v9-list__cell', null, sensorSelect, filterSelect);
  const stateCell = h('div.v9-list__cell', null, stateSelect, fieldInput);
  const timerCell = h('div.v9-list__cell', null, timerSelect);

  function sync() {
    sensorCell.hidden = srcSelect.value !== 'sensor';
    stateCell.hidden = srcSelect.value !== 'state';
    timerCell.hidden = srcSelect.value !== 'timer';
    valueInput.hidden = srcSelect.value === 'timer';
  }
  srcSelect.addEventListener('change', sync);

  const node = h('div.v9-list__row', null,
    srcSelect, sensorCell, stateCell, timerCell, opSelect, valueInput, cooldownInput,
    button('×', { size: 'sm', variant: 'ghost', title: 'Bedingung entfernen',
      onClick: onRemove }));
  sync();

  return { node, read: function () {
    const out = { src: srcSelect.value, op: opSelect.value };
    const raw = valueInput.value.trim();
    if (srcSelect.value === 'timer') {
      out.timer_id = toIntOrNull(timerSelect.value);
      out.value = toNumberOrNull(raw) === null ? 0 : toNumberOrNull(raw);
      if (ENUMS.rule_op.indexOf(out.op) < 0 || ['elapsed', 'fired'].indexOf(out.op) < 0) {
        out.op = 'elapsed';
      }
      return out.timer_id === null ? null : out;
    }
    if (raw.charAt(0) === '{') {
      const parsed = safeJsonParse(raw, null);
      out.value = isPlainObject(parsed) ? parsed : 0;
    } else if (raw === 'true' || raw === 'false') {
      out.value = raw === 'true';
    } else {
      out.value = toNumberOrNull(raw) === null ? 0 : toNumberOrNull(raw);
    }
    if (srcSelect.value === 'sensor') {
      const parts = String(sensorSelect.value).split(':');
      out.controller_uuid = parts.slice(0, -1).join(':');
      out.sensor_id = toIntOrNull(parts[parts.length - 1]);
      const filterId = toIntOrNull(filterSelect.value);
      if (filterId !== null) out.filter_id = filterId;
      if (!out.controller_uuid || out.sensor_id === null) return null;
    } else {
      out.state_id = toIntOrNull(stateSelect.value);
      out.field = fieldInput.value.trim() || 'value_id';
      if (out.state_id === null) return null;
    }
    const cooldown = toNumberOrNull(cooldownInput.value);
    if (cooldown !== null) out.cooldown_s = cooldown;
    return out;
  } };
}

function createActionList(initial, config, label) {
  const rows = [];
  const body = h('div.v9-list');
  const node = h('div.v9-list-wrap', null, body,
    button('Aktion hinzufügen', { size: 'sm', variant: 'ghost', icon: '＋',
      onClick: function () { addRow({ state_ids: [], value_id: 1 }); } }));

  function addRow(action) {
    const entry = createActionRow(action, config, function () {
      const index = rows.indexOf(entry);
      if (index >= 0) rows.splice(index, 1);
      body.removeChild(entry.node);
    });
    rows.push(entry);
    body.appendChild(entry.node);
  }

  ensureArray(initial).forEach(addRow);
  return { node, read: function () {
    return rows.map(function (entry) { return entry.read(); }).filter(Boolean);
  } };
}

function createActionRow(action, config, onRemove) {
  const source = isPlainObject(action) ? action : {};
  const kind = source.notify !== undefined ? 'notify'
    : (Array.isArray(source.p_ids) ? 'p_ids' : 'state_ids');
  const kindSelect = select({ items: [
    { value: 'state_ids', label: 'states setzen' },
    { value: 'p_ids', label: 'prozesse setzen' },
    { value: 'notify', label: 'benachrichtigen' }
  ], value: kind });

  const stateSelect = select({ multiple: true, size: 4,
    items: ensureArray(config.process_states).map(function (state) {
      return { value: String(state.state_id), label: 'State ' + state.state_id };
    }),
    value: ensureArray(source.state_ids).map(String) });
  const processSelect = select({ multiple: true, size: 4,
    items: ensureArray(config.processes).map(function (process) {
      return { value: String(process.p_id), label: 'P' + process.p_id + ' · '
        + toText(process.process_name) };
    }),
    value: ensureArray(source.p_ids).map(String) });
  const valueSelect = select({
    items: [{ value: '', label: '— value_id unverändert —' }].concat(
      ensureArray(config.process_values).map(function (value) {
        return { value: String(value.value_id),
          label: '#' + value.value_id + ' · ' + toText(value.state_value) };
      })),
    value: source.value_id === undefined ? '' : String(source.value_id) });
  const notifyInput = input({ value: toText(source.notify),
    placeholder: 'Nachricht' });
  const parametersInput = input({ value: isPlainObject(source.parameters)
    && Object.keys(source.parameters).length ? JSON.stringify(source.parameters) : '',
  placeholder: 'parameters (JSON, optional)' });

  function sync() {
    stateSelect.hidden = kindSelect.value !== 'state_ids';
    processSelect.hidden = kindSelect.value !== 'p_ids';
    valueSelect.hidden = kindSelect.value === 'notify';
    parametersInput.hidden = kindSelect.value === 'notify';
    notifyInput.hidden = kindSelect.value !== 'notify';
  }
  kindSelect.addEventListener('change', sync);

  const node = h('div.v9-list__row', null,
    kindSelect, stateSelect, processSelect, valueSelect, parametersInput, notifyInput,
    button('×', { size: 'sm', variant: 'ghost', title: 'Aktion entfernen', onClick: onRemove }));
  sync();

  return { node, read: function () {
    if (kindSelect.value === 'notify') {
      const message = notifyInput.value.trim();
      return message ? { notify: message } : null;
    }
    const out = {};
    const picker = kindSelect.value === 'state_ids' ? stateSelect : processSelect;
    const ids = Array.prototype.slice.call(picker.selectedOptions).map(function (option) {
      return toIntOrNull(option.value);
    }).filter(function (value) { return value !== null; });
    if (!ids.length) return null;
    out[kindSelect.value] = ids;
    const valueId = toIntOrNull(valueSelect.value);
    if (valueId !== null) out.value_id = valueId;
    const parameters = safeJsonParse(parametersInput.value.trim(), null);
    if (isPlainObject(parameters) && Object.keys(parameters).length) out.parameters = parameters;
    return out;
  } };
}

/* ------------------------------------------------------------ filters/timers */

function renderFilters(config) {
  const node = card('Filter', {
    key: 'filters',
    meta: pill('sensor_refs = controller_uuid + sensor_id', 'info')
  });
  node.body.appendChild(table([
    { key: 'filter_id', label: 'ID', align: 'right' },
    { label: 'Sensoren', render: function (row) {
      return ensureArray(row.sensor_refs).map(function (ref) {
        return 'S' + ref.sensor_id;
      }).join(', ');
    } },
    { label: 'Kette', render: function (row) {
      return h('div.v9-cond-list', null, ensureArray(row.chain).map(function (step) {
        const detail = ['window', 'alpha', 'period_s'].filter(function (key) {
          return step[key] !== undefined;
        }).map(function (key) { return key + '=' + step[key]; }).join(' ');
        return h('code.v9-code', { text: toText(step.type) + (detail ? ' (' + detail + ')' : '') });
      }));
    } },
    { label: 'Genutzt von', render: function (row) {
      const rules = ensureArray(config.rules).filter(function (rule) {
        return ensureArray(rule.when).some(function (cond) {
          return toIntOrNull(cond.filter_id) === toIntOrNull(row.filter_id);
        });
      }).map(function (rule) { return toIntOrNull(rule.rule_id); });
      return rules.length ? badge('Regel ' + rules.join(','), 'info') : badge('ungenutzt', 'muted');
    } },
    { label: '', align: 'right', render: function (row) {
      return button('Löschen', { size: 'sm', variant: 'ghost', onClick: function () {
        store.remove('filters', row.filter_id);
        toast('Filter gelöscht.', 'ok');
      } });
    } }
  ], ensureArray(config.filters), { emptyText: 'Keine Filter' }));

  node.body.appendChild(h('p.v9-note', { text:
    'Die Runtime kennt median, moving_average, lowpass, highpass, sampler, scaler, '
    + 'scaler_sensor_profile und expr. Unbekannte Typen sind schema-gültig, werden aber '
    + 'wirkungslos übersprungen.' }));
  return node;
}

function openFilterModal() {
  const config = store.getConfig();
  const idInput = input({ type: 'number', min: 1, value: nextFilterId(config) });
  const sensorSelect = select({ multiple: true, size: 6,
    items: ensureArray(config.sensors).map(function (sensor) {
      return { value: toText(sensor.controller_uuid) + ':' + toIntOrNull(sensor.sensor_id),
        label: 'S' + sensor.sensor_id + ' · ' + toText(sensor.controller_key) };
    }) });
  const chainArea = textarea({ rows: 8,
    value: pretty([{ type: 'median', window: 5 }, { type: 'moving_average', window: 5 }]) });

  modal({
    title: 'Filter anlegen',
    body: h('div.v9-form', null,
      field('filter_id', idInput, { required: true }),
      field('sensor_refs', sensorSelect, { required: true,
        hint: 'Mindestens ein Sensor (V9: min_len 1).' }),
      field('chain (JSON)', chainArea, { required: true,
        hint: 'Erlaubte Felder je Stufe: type (Pflicht), window, alpha, period_s.' })),
    submitLabel: 'Anlegen',
    onSubmit: function () {
      const chain = safeJsonParse(chainArea.value, null);
      if (!Array.isArray(chain) || !chain.length) {
        toast('chain muss eine nicht-leere JSON-Liste sein.', 'danger');
        return false;
      }
      const refs = Array.prototype.slice.call(sensorSelect.selectedOptions).map(function (option) {
        const parts = String(option.value).split(':');
        return { sensor_id: toIntOrNull(parts[parts.length - 1]),
          controller_uuid: parts.slice(0, -1).join(':') };
      });
      if (!refs.length) {
        toast('Mindestens ein Sensor ist Pflicht.', 'danger');
        return false;
      }
      store.add('filters', { filter_id: toIntOrNull(idInput.value) || 1,
        sensor_refs: refs, chain });
      toast('Filter angelegt.', 'ok');
      return true;
    }
  });
}

function nextFilterId(config) {
  let max = 0;
  ensureArray(config.filters).forEach(function (row) {
    const value = toIntOrNull(row.filter_id);
    if (value !== null && value > max) max = value;
  });
  return max + 1;
}

function renderTimers(config) {
  const node = card('Timer', { key: 'timers' });
  node.body.appendChild(table([
    { key: 'timer_id', label: 'ID', align: 'right' },
    { label: 'Art', render: function (row) {
      const kinds = [];
      if (row.duration_s !== undefined) kinds.push('duration_s=' + row.duration_s + ' (Stoppuhr)');
      if (row.interval_s !== undefined) kinds.push('interval_s=' + row.interval_s + ' (Taktgeber)');
      if (row.at !== undefined) kinds.push('at=' + row.at);
      if (row.cron !== undefined) kinds.push('cron=' + row.cron);
      return kinds.join(' · ') || '—';
    } },
    { key: 'description', label: 'Beschreibung' },
    { label: '', align: 'right', render: function (row) {
      return button('Löschen', { size: 'sm', variant: 'ghost', onClick: function () {
        store.remove('timers', row.timer_id);
        toast('Timer gelöscht.', 'ok');
      } });
    } }
  ], ensureArray(config.timers), { emptyText: 'Keine Timer' }));
  return node;
}

function openTimerModal() {
  const config = store.getConfig();
  let max = 0;
  ensureArray(config.timers).forEach(function (row) {
    const value = toIntOrNull(row.timer_id);
    if (value !== null && value > max) max = value;
  });
  const idInput = input({ type: 'number', min: 1, value: max + 1 });
  const durationInput = input({ type: 'number', min: 0, step: '0.1', value: '' });
  const intervalInput = input({ type: 'number', min: 0, step: '0.1', value: '' });
  const atInput = input({ placeholder: 'HH:MM' });
  const cronInput = input({ placeholder: '*/5 * * * *' });
  const descriptionInput = input({ value: '' });

  modal({
    title: 'Timer anlegen',
    body: h('div.v9-form', null,
      field('timer_id', idInput, { required: true }),
      field('duration_s', durationInput, { hint: 'Stoppuhr — braucht timer_start() in der Runtime.' }),
      field('interval_s', intervalInput, { hint: 'Freilaufender Taktgeber.' }),
      field('at', atInput, { hint: 'Tägliche Uhrzeit (Lokalzeit).' }),
      field('cron', cronInput, { hint: '5-Feld-Cron.' }),
      field('description', descriptionInput)),
    submitLabel: 'Anlegen',
    onSubmit: function () {
      const patch = { timer_id: toIntOrNull(idInput.value) || 1,
        description: descriptionInput.value.trim() };
      if (toNumberOrNull(durationInput.value) !== null) {
        patch.duration_s = toNumberOrNull(durationInput.value);
      }
      if (toNumberOrNull(intervalInput.value) !== null) {
        patch.interval_s = toNumberOrNull(intervalInput.value);
      }
      if (atInput.value.trim()) patch.at = atInput.value.trim();
      if (cronInput.value.trim()) patch.cron = cronInput.value.trim();
      store.add('timers', patch);
      toast('Timer angelegt.', 'ok');
      return true;
    }
  });
}

function showJson(title, payload) {
  modal({
    wide: true, title,
    body: h('pre.v9-json', { text: pretty(payload) }),
    cancelLabel: 'Schließen'
  });
}
