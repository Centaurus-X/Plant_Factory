/**
 * v9_ui_states.js — Panel "Prozess-States (V9)".
 *
 * Behebt die zentralen Lücken des V50-Prozess-UI:
 *   * `io_refs` statt `sensor_id[]`/`actuator_id[]` — mit controller_uuid.
 *   * `mapping_id` statt frei geratenem `parameter_schema_id`.
 *   * `control_strategy` ist editierbar (V50: nur indirekt aus
 *     automation_parameters.control_method synthetisiert).
 *   * `setpoint_source` ist sichtbar (V50: tot durchgereicht).
 *   * Scope-Klassifikation je State (local_controller / cross_controller /
 *     cross_worker) — vor dem Rollout statt danach.
 *   * Mode-Gate-Hinweis: States außerhalb rule_engine.required_mode_id werden
 *     von der Engine nicht geschrieben ("skipped_mode").
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { SETPOINT_KEYS } from './v9_schema.js';
import * as store from './v9_store.js';
import {
  h, mount, card, table, field, input, select, button, badge, pill, toolbar,
  modal, toast, definitionList, textarea, disclosure
} from './v9_dom.js';
import { classifyScopes } from './v9_shard.js';
import {
  ensureArray, isPlainObject, toText, toIntOrNull, toNumberOrNull, indexBy,
  safeJsonParse, pretty, shrinkText
} from './shared_utils.js';

let host = null;
let filterText = '';

export function initStatesPanel(container) {
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
    renderProcesses(config),
    renderStates(config),
    renderTemplates(config)
  ]);
}

const SCOPE_TONE = {
  local_controller: 'ok',
  cross_controller: 'warn',
  cross_worker: 'warn',
  unbound: 'muted',
  invalid: 'danger'
};

function renderToolbar(config) {
  const engine = ensureArray(config.rule_engine)[0] || {};
  const modes = indexBy(config.process_modes, 'mode_id');
  const requiredMode = modes.get(toIntOrNull(engine.required_mode_id));
  const search = input({ placeholder: 'State, Prozess oder Typ suchen …', value: filterText,
    onInput: function (event) {
      filterText = event.target.value.toLowerCase();
      render();
    } });

  return toolbar([
    search,
    pill(ensureArray(config.process_states).length + ' States', 'info'),
    pill('required_mode_id ' + toIntOrNull(engine.required_mode_id)
      + (requiredMode ? ' (' + toText(requiredMode.mode) + ')' : ''), 'info'),
    button('State anlegen', { size: 'sm', icon: '＋',
      onClick: function () { openStateModal(null); } }),
    button('Prozess anlegen', { size: 'sm', variant: 'ghost', icon: '＋',
      onClick: openProcessModal })
  ]);
}

function renderProcesses(config) {
  const node = card('Prozesse', { key: 'processes' });
  node.body.appendChild(table([
    { key: 'p_id', label: 'p_id', align: 'right' },
    { key: 'process_name', label: 'Name' },
    { key: 'process_location', label: 'Ort' },
    { key: 'owner_node_id', label: 'owner_node_id' },
    { label: 'States', align: 'right', render: function (row) {
      return String(ensureArray(config.process_states).filter(function (state) {
        return toIntOrNull(state.p_id) === toIntOrNull(row.p_id);
      }).length);
    } },
    { label: '', align: 'right', render: function (row) {
      return button('Löschen', { size: 'sm', variant: 'ghost', onClick: function () {
        modal({
          title: 'Prozess löschen',
          body: h('p', { text: 'Prozess ' + row.p_id
            + ' und alle zugehörigen Prozess-States löschen?' }),
          submitLabel: 'Löschen',
          onSubmit: function () {
            store.remove('processes', row.p_id);
            toast('Prozess gelöscht.', 'ok');
            return true;
          }
        });
      } });
    } }
  ], ensureArray(config.processes), { emptyText: 'Keine Prozesse' }));
  return node;
}

function renderStates(config) {
  const scopes = classifyScopes(config);
  const engine = ensureArray(config.rule_engine)[0] || {};
  const requiredModeId = toIntOrNull(engine.required_mode_id);
  const processes = indexBy(config.processes, 'p_id');
  const values = indexBy(config.process_values, 'value_id');
  const modes = indexBy(config.process_modes, 'mode_id');
  const mappings = indexBy(config.schema_mappings, 'mapping_id');
  const templates = indexBy(config.parameter_generic_templates, 'schema_id');

  const rows = ensureArray(config.process_states).filter(function (state) {
    if (!filterText) return true;
    const mapping = mappings.get(toIntOrNull(state.mapping_id));
    const template = mapping ? templates.get(toIntOrNull(mapping.schema_id)) : null;
    const process = processes.get(toIntOrNull(state.p_id));
    return [toText(state.state_id), toText(process && process.process_name),
      toText(template && template.state_type)].join(' ').toLowerCase().indexOf(filterText) >= 0;
  });

  const node = card('Prozess-States', {
    key: 'process_states',
    meta: pill('io_refs = controller_uuid + lokale I/O-ID', 'info')
  });

  node.body.appendChild(table([
    { key: 'state_id', label: 'state_id', align: 'right' },
    { label: 'Prozess', render: function (row) {
      const process = processes.get(toIntOrNull(row.p_id));
      return process ? toText(process.process_name) : badge('p_id ' + row.p_id + ' fehlt', 'danger');
    } },
    { label: 'Typ (via mapping_id)', render: function (row) {
      const mapping = mappings.get(toIntOrNull(row.mapping_id));
      const template = mapping ? templates.get(toIntOrNull(mapping.schema_id)) : null;
      return template ? toText(template.state_type) : badge('mapping fehlt', 'danger');
    } },
    { label: 'Wert', render: function (row) {
      const value = values.get(toIntOrNull(row.value_id));
      return badge(value ? toText(value.state_value) : '?',
        toIntOrNull(row.value_id) === 1 ? 'ok' : 'muted');
    } },
    { label: 'Modus', render: function (row) {
      const mode = modes.get(toIntOrNull(row.mode_id));
      const gated = toIntOrNull(row.mode_id) !== requiredModeId;
      return badge(mode ? toText(mode.mode) : '?', gated ? 'warn' : 'ok');
    } },
    { label: 'I/O', render: function (row) {
      const refs = isPlainObject(row.io_refs) ? row.io_refs : {};
      return h('div.v9-badges', null,
        badge('S: ' + ensureArray(refs.sensors).map(function (r) {
          return toIntOrNull(r.sensor_id);
        }).join(',') || 'S: —', 'info'),
        badge('A: ' + ensureArray(refs.actuators).map(function (r) {
          return toIntOrNull(r.actuator_id);
        }).join(',') || 'A: —', 'info'));
    } },
    { label: 'Strategie', render: function (row) {
      const strategy = row.control_strategy;
      if (!isPlainObject(strategy)) return badge('keine', 'muted');
      return badge(toText(strategy.type) === 'PID'
        ? 'PID #' + strategy.pid_config_id
        : 'method #' + strategy.method_id, 'info');
    } },
    { label: 'Scope', render: function (row) {
      const scope = scopes.states.get(toIntOrNull(row.state_id)) || 'unbound';
      return badge(scope, SCOPE_TONE[scope] || 'muted');
    } },
    { label: '', align: 'right', render: function (row) {
      return h('div.v9-row-actions', null,
        button('Bearbeiten', { size: 'sm', variant: 'ghost',
          onClick: function () { openStateModal(row); } }),
        button('Duplizieren', { size: 'sm', variant: 'ghost',
          onClick: function () { duplicateState(row); } }),
        button('Löschen', { size: 'sm', variant: 'ghost',
          onClick: function () { removeState(row); } }));
    } }
  ], rows, { emptyText: 'Keine Prozess-States', rowKey: 'state_id' }));

  return node;
}

function renderTemplates(config) {
  const node = card('Parameter-Templates & Mappings', {
    key: 'parameter_generic_templates',
    meta: pill('V9 kennt nur schema_id / state_type / description', 'info'),
    actions: [
      button('Template anlegen', { size: 'sm', icon: '＋', onClick: openTemplateModal }),
      button('Mapping anlegen', { size: 'sm', variant: 'ghost', icon: '＋',
        onClick: openMappingModal })
    ]
  });
  const templates = indexBy(config.parameter_generic_templates, 'schema_id');

  node.body.appendChild(h('p.v9-note', { text:
    'Die V50-Felder fields[] und constraints[] existieren im V9-Vertrag nicht mehr. '
    + 'Parametergrenzen prüft die Runtime über _config_safety_policy, nicht über die Config.' }));

  node.body.appendChild(table([
    { key: 'schema_id', label: 'schema_id', align: 'right' },
    { key: 'state_type', label: 'state_type' },
    { key: 'description', label: 'Beschreibung' },
    { label: '', align: 'right', render: function (row) {
      return button('Löschen', { size: 'sm', variant: 'ghost', onClick: function () {
        store.remove('parameter_generic_templates', row.schema_id);
        toast('Template gelöscht.', 'ok');
      } });
    } }
  ], ensureArray(config.parameter_generic_templates), { emptyText: 'Keine Templates' }));

  node.body.appendChild(disclosure('Schema-Mappings', table([
    { key: 'mapping_id', label: 'mapping_id', align: 'right' },
    { key: 'schema_id', label: 'schema_id', align: 'right' },
    { label: 'state_type', render: function (row) {
      const template = templates.get(toIntOrNull(row.schema_id));
      return template ? toText(template.state_type) : badge('unbekannt', 'danger');
    } },
    { label: 'Verwendet von', align: 'right', render: function (row) {
      return String(ensureArray(config.process_states).filter(function (state) {
        return toIntOrNull(state.mapping_id) === toIntOrNull(row.mapping_id);
      }).length);
    } },
    { label: '', align: 'right', render: function (row) {
      return button('Löschen', { size: 'sm', variant: 'ghost', onClick: function () {
        store.remove('schema_mappings', row.mapping_id);
        toast('Mapping gelöscht.', 'ok');
      } });
    } }
  ], ensureArray(config.schema_mappings), { emptyText: 'Keine Mappings' }), { open: false }));

  return node;
}

/* ------------------------------------------------------------------ Dialoge */

function openStateModal(row) {
  const config = store.getConfig();
  const isNew = !row;
  const state = row || {};
  const refs = isPlainObject(state.io_refs) ? state.io_refs : { sensors: [], actuators: [] };

  const idInput = input({ type: 'number', min: 1,
    value: state.state_id === undefined ? nextStateId(config) : state.state_id });
  const processSelect = select({
    items: ensureArray(config.processes).map(function (process) {
      return { value: String(process.p_id),
        label: '#' + process.p_id + ' · ' + toText(process.process_name) };
    }),
    value: state.p_id === undefined ? '' : String(state.p_id)
  });
  const valueSelect = select({
    items: ensureArray(config.process_values).map(function (value) {
      return { value: String(value.value_id),
        label: '#' + value.value_id + ' · ' + toText(value.state_value) };
    }),
    value: state.value_id === undefined ? '1' : String(state.value_id)
  });
  const modeSelect = select({
    items: ensureArray(config.process_modes).map(function (mode) {
      return { value: String(mode.mode_id), label: '#' + mode.mode_id + ' · ' + toText(mode.mode) };
    }),
    value: state.mode_id === undefined ? '2' : String(state.mode_id)
  });
  const templates = indexBy(config.parameter_generic_templates, 'schema_id');
  const mappingSelect = select({
    items: ensureArray(config.schema_mappings).map(function (mapping) {
      const template = templates.get(toIntOrNull(mapping.schema_id));
      return { value: String(mapping.mapping_id),
        label: '#' + mapping.mapping_id + ' → ' + (template ? toText(template.state_type) : '?') };
    }),
    value: state.mapping_id === undefined ? '' : String(state.mapping_id)
  });

  const sensorSelect = select({ multiple: true, size: 6,
    items: ensureArray(config.sensors).map(function (sensor) {
      return { value: toText(sensor.controller_uuid) + ':' + toIntOrNull(sensor.sensor_id),
        label: 'S' + sensor.sensor_id + ' · ' + toText(sensor.controller_key)
          + ' · Adr ' + sensor.address };
    }),
    value: ensureArray(refs.sensors).map(function (ref) {
      return toText(ref.controller_uuid) + ':' + toIntOrNull(ref.sensor_id);
    }) });
  const actuatorSelect = select({ multiple: true, size: 6,
    items: ensureArray(config.actuators).map(function (actuator) {
      return { value: toText(actuator.controller_uuid) + ':' + toIntOrNull(actuator.actuator_id),
        label: 'A' + actuator.actuator_id + ' · ' + toText(actuator.controller_key)
          + ' · Adr ' + actuator.address };
    }),
    value: ensureArray(refs.actuators).map(function (ref) {
      return toText(ref.controller_uuid) + ':' + toIntOrNull(ref.actuator_id);
    }) });

  const strategy = isPlainObject(state.control_strategy) ? state.control_strategy : {};
  const strategySelect = select({
    items: [{ value: '', label: '— keine (null) · Runtime wählt Zweipunkt oder P —' },
      { value: 'PID', label: 'PID' },
      { value: 'control_method', label: 'control_method' }],
    value: toText(strategy.type)
  });
  const pidSelect = select({
    items: ensureArray(config.pid_configs).map(function (pid) {
      return { value: String(pid.pid_config_id),
        label: '#' + pid.pid_config_id + ' · kp=' + (pid.pid_parameters || {}).kp };
    }),
    value: strategy.pid_config_id === undefined ? '' : String(strategy.pid_config_id)
  });
  const methodSelect = select({
    items: ensureArray(config.control_methods).map(function (method) {
      return { value: String(method.method_id),
        label: '#' + method.method_id + ' · Template ' + method.template_id };
    }),
    value: strategy.method_id === undefined ? '' : String(strategy.method_id)
  });
  const pidField = field('pid_config_id', pidSelect, { required: true });
  const methodField = field('method_id', methodSelect, { required: true });

  function syncStrategy() {
    pidField.hidden = strategySelect.value !== 'PID';
    methodField.hidden = strategySelect.value !== 'control_method';
  }
  strategySelect.addEventListener('change', syncStrategy);

  const parametersArea = textarea({ rows: 6,
    value: pretty(isPlainObject(state.parameters) ? state.parameters : {}) });
  const setpointArea = textarea({ rows: 3,
    value: state.setpoint_source === undefined ? 'null' : pretty(state.setpoint_source) });

  const dialog = modal({
    wide: true,
    title: isNew ? 'Prozess-State anlegen' : 'Prozess-State ' + state.state_id + ' bearbeiten',
    body: h('div.v9-form.v9-form--grid', null,
      field('state_id', idInput, { required: true }),
      field('p_id', processSelect, { required: true }),
      field('value_id (Sollzustand)', valueSelect, { required: true,
        hint: 'Nur value_id 1 gilt der Runtime als aktiv (DEFAULT_ACTIVE_VALUE_IDS).' }),
      field('mode_id (Betriebsart-Gate)', modeSelect, { required: true,
        hint: 'Die Rule-Engine schreibt nur bei mode_id == rule_engine.required_mode_id.' }),
      field('mapping_id', mappingSelect, { required: true, wide: true,
        hint: 'Verweist über schema_mappings auf parameter_generic_templates.state_type.' }),
      field('io_refs.sensors', sensorSelect, { wide: true,
        hint: 'Mehrfachauswahl. Die controller_uuid wird automatisch mitgeführt.' }),
      field('io_refs.actuators', actuatorSelect, { wide: true }),
      field('control_strategy', strategySelect, { required: true,
        hint: 'Genau drei Formen: PID, control_method oder null. Bei null wählt die '
          + 'Runtime selbst — Zweipunktregler, sobald am State ein write_coil-Aktor '
          + 'hängt oder ein Parameter "hysteresis"/"hysteresis_bar" gesetzt ist, '
          + 'sonst ein P-Regler.' }),
      pidField, methodField,
      field('parameters (JSON)', parametersArea, { wide: true,
        hint: 'Sollwert-Schlüssel in Auswertungsreihenfolge: ' + SETPOINT_KEYS.join(', ') }),
      field('setpoint_source (JSON)', setpointArea, { wide: true,
        hint: 'Beliebiger Wert oder null. Wirkt nur auf die Scope-Klassifikation, '
          + 'nicht auf die Regelung.' })),
    submitLabel: isNew ? 'Anlegen' : 'Speichern',
    onSubmit: function () {
      const parameters = safeJsonParse(parametersArea.value, undefined);
      if (!isPlainObject(parameters)) {
        toast('parameters muss ein JSON-Objekt sein.', 'danger');
        return false;
      }
      const setpoint = safeJsonParse(setpointArea.value, undefined);
      if (setpoint === undefined) {
        toast('setpoint_source ist kein gültiges JSON (null ist erlaubt).', 'danger');
        return false;
      }
      let controlStrategy = null;
      if (strategySelect.value === 'PID') {
        const pidConfigId = toIntOrNull(pidSelect.value);
        if (pidConfigId === null) {
          toast('PID verlangt eine pid_config_id.', 'danger');
          return false;
        }
        controlStrategy = Object.assign({}, strategy, { type: 'PID', pid_config_id: pidConfigId });
      } else if (strategySelect.value === 'control_method') {
        const methodId = toIntOrNull(methodSelect.value);
        if (methodId === null) {
          toast('control_method verlangt eine method_id.', 'danger');
          return false;
        }
        controlStrategy = { type: 'control_method', method_id: methodId };
      }

      const patch = {
        state_id: toIntOrNull(idInput.value) || 1,
        p_id: toIntOrNull(processSelect.value),
        value_id: toIntOrNull(valueSelect.value),
        mode_id: toIntOrNull(modeSelect.value),
        mapping_id: toIntOrNull(mappingSelect.value),
        io_refs: {
          sensors: readRefs(sensorSelect, 'sensor_id'),
          actuators: readRefs(actuatorSelect, 'actuator_id')
        },
        control_strategy: controlStrategy,
        setpoint_source: setpoint,
        parameters
      };
      if (patch.p_id === null || patch.mapping_id === null) {
        toast('p_id und mapping_id sind Pflicht.', 'danger');
        return false;
      }
      if (isNew) store.add('process_states', patch);
      else store.update('process_states', state.state_id, patch);
      toast(isNew ? 'State angelegt.' : 'State gespeichert.', 'ok');
      return true;
    }
  });
  syncStrategy();
  return dialog;
}

function readRefs(selectNode, idField) {
  return Array.prototype.slice.call(selectNode.selectedOptions).map(function (option) {
    const parts = String(option.value).split(':');
    const ref = { controller_uuid: parts.slice(0, -1).join(':') };
    ref[idField] = toIntOrNull(parts[parts.length - 1]);
    return ref;
  });
}

function nextStateId(config) {
  let max = 0;
  ensureArray(config.process_states).forEach(function (state) {
    const value = toIntOrNull(state.state_id);
    if (value !== null && value > max) max = value;
  });
  return max + 1;
}

function duplicateState(row) {
  const config = store.getConfig();
  const copy = JSON.parse(JSON.stringify(row));
  copy.state_id = nextStateId(config);
  store.add('process_states', copy);
  toast('State ' + row.state_id + ' dupliziert als ' + copy.state_id + '.', 'ok');
}

function removeState(row) {
  const config = store.getConfig();
  const usedBy = ensureArray(config.rules).filter(function (rule) {
    const inWhen = ensureArray(rule.when).some(function (cond) {
      return toText(cond.src) === 'state' && toIntOrNull(cond.state_id) === toIntOrNull(row.state_id);
    });
    const inActions = ['do', 'else_do'].some(function (bucket) {
      return ensureArray(rule[bucket]).some(function (action) {
        return ensureArray(action.state_ids).some(function (id) {
          return toIntOrNull(id) === toIntOrNull(row.state_id);
        });
      });
    });
    return inWhen || inActions;
  }).map(function (rule) { return toIntOrNull(rule.rule_id); });

  modal({
    title: 'Prozess-State löschen',
    body: h('div.v9-form', null,
      h('p', { text: 'State ' + row.state_id + ' löschen?' }),
      usedBy.length ? h('p.v9-note.v9-note--warn', { text: 'Regel(n) ' + usedBy.join(', ')
        + ' referenzieren diesen State. Die Referenzen werden entfernt; Regeln ohne '
        + 'verbleibende Bedingung oder Aktion werden gelöscht.' }) : null),
    submitLabel: 'Löschen',
    onSubmit: function () {
      store.remove('process_states', row.state_id);
      toast('State gelöscht.', 'ok');
      return true;
    }
  });
}

function openProcessModal() {
  const config = store.getConfig();
  const idInput = input({ type: 'number', min: 1, value: nextProcessId(config) });
  const nameInput = input({ value: '' });
  const locationInput = input({ value: '' });
  const ownerSelect = select({ items: ensureArray(config.nodes).map(function (node) {
    return { value: toText(node.node_id), label: toText(node.node_id) };
  }) });
  modal({
    title: 'Prozess anlegen',
    body: h('div.v9-form', null,
      field('p_id', idInput, { required: true }),
      field('process_name', nameInput, { required: true }),
      field('process_location', locationInput),
      field('owner_node_id', ownerSelect, { required: true,
        hint: 'V9-Pflichtfeld für Execution-Entities.' })),
    submitLabel: 'Anlegen',
    onSubmit: function () {
      if (!nameInput.value.trim()) {
        toast('process_name ist Pflicht.', 'danger');
        return false;
      }
      store.add('processes', {
        p_id: toIntOrNull(idInput.value) || 1,
        process_name: nameInput.value.trim(),
        process_location: locationInput.value.trim(),
        owner_node_id: ownerSelect.value
      });
      toast('Prozess angelegt.', 'ok');
      return true;
    }
  });
}

function nextProcessId(config) {
  let max = 0;
  ensureArray(config.processes).forEach(function (row) {
    const value = toIntOrNull(row.p_id);
    if (value !== null && value > max) max = value;
  });
  return max + 1;
}

function openTemplateModal() {
  const config = store.getConfig();
  const typeInput = input({ value: '' });
  const descriptionInput = input({ value: '' });
  const withMapping = input({ type: 'checkbox' });
  withMapping.checked = true;
  modal({
    title: 'Parameter-Template anlegen',
    body: h('div.v9-form', null,
      field('state_type', typeInput, { required: true }),
      field('Beschreibung', descriptionInput),
      field('Passendes schema_mapping gleich anlegen', withMapping)),
    submitLabel: 'Anlegen',
    onSubmit: function () {
      if (!typeInput.value.trim()) {
        toast('state_type ist Pflicht.', 'danger');
        return false;
      }
      const created = store.add('parameter_generic_templates', {
        state_type: typeInput.value.trim(),
        description: descriptionInput.value.trim() || typeInput.value.trim()
      });
      if (withMapping.checked) {
        let mappingId = 100;
        ensureArray(store.getConfig().schema_mappings).forEach(function (row) {
          const value = toIntOrNull(row.mapping_id);
          if (value !== null && value >= mappingId) mappingId = value + 1;
        });
        store.add('schema_mappings', { mapping_id: mappingId, schema_id: created.schema_id });
      }
      toast('Template angelegt.', 'ok');
      return true;
    }
  });
}

function openMappingModal() {
  const config = store.getConfig();
  const idInput = input({ type: 'number', min: 1, value: 100 });
  const schemaSelect = select({ items: ensureArray(config.parameter_generic_templates)
    .map(function (row) {
      return { value: String(row.schema_id),
        label: '#' + row.schema_id + ' · ' + toText(row.state_type) };
    }) });
  modal({
    title: 'Schema-Mapping anlegen',
    body: h('div.v9-form', null,
      field('mapping_id', idInput, { required: true }),
      field('schema_id', schemaSelect, { required: true })),
    submitLabel: 'Anlegen',
    onSubmit: function () {
      store.add('schema_mappings', {
        mapping_id: toIntOrNull(idInput.value) || 100,
        schema_id: toIntOrNull(schemaSelect.value) || 1
      });
      toast('Mapping angelegt.', 'ok');
      return true;
    }
  });
}
