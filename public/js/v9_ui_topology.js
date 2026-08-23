/**
 * v9_ui_topology.js — Panel "Topologie & I/O".
 *
 * Macht das V9-Identitäts- und Routingmodell erstmals im UI sichtbar und
 * editierbar: site → node → route (controller_uuid/controller_key/route_key)
 * → Controller → Sensoren/Aktoren.
 *
 * In V50 gab es dafür keinerlei Oberfläche: `nodes`, `node_registrar` und
 * `controller_node_bindings` wurden beim Export stets geleert
 * (model_adapter.js:587-588), Sensoren kannten nur `controller_id`.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { SECTIONS, ENUMS, functionTypesFor, routeKeyFor } from './v9_schema.js';
import * as store from './v9_store.js';
import {
  h, mount, card, table, field, input, select, checkbox, button, badge, pill,
  toolbar, modal, toast, definitionList, disclosure
} from './v9_dom.js';
import { classifyScopes, listNodes } from './v9_shard.js';
import {
  ensureArray, toText, toIntOrNull, indexBy, shrinkText
} from './shared_utils.js';

let host = null;

export function initTopologyPanel(container) {
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
    renderSiteNode(config),
    renderControllers(config),
    renderIo(config, 'sensors'),
    renderIo(config, 'actuators')
  ]);
}

function renderToolbar(config) {
  const scopes = classifyScopes(config);
  const counts = { local_controller: 0, cross_controller: 0, cross_worker: 0, unbound: 0, invalid: 0 };
  scopes.states.forEach(function (value) { counts[value] = (counts[value] || 0) + 1; });

  return toolbar([
    pill(listNodes(config).length + ' Node(s)', 'info'),
    pill(ensureArray(config.controllers).length + ' Controller', 'info'),
    pill(ensureArray(config.sensors).length + ' Sensoren', 'info'),
    pill(ensureArray(config.actuators).length + ' Aktoren', 'info'),
    counts.cross_controller || counts.cross_worker
      ? pill((counts.cross_controller + counts.cross_worker) + ' States cross-scoped', 'warn')
      : null,
    counts.invalid ? pill(counts.invalid + ' States ohne Owner', 'danger') : null
  ]);
}

/* ---------------------------------------------------------------- Site/Node */

function renderSiteNode(config) {
  const node = card('Site & Node', {
    key: 'topology',
    actions: [
      button('Site anlegen', { size: 'sm', icon: '＋', onClick: openSiteModal }),
      button('Node anlegen', { size: 'sm', icon: '＋', onClick: openNodeModal })
    ]
  });

  const meta = ensureArray(config.meta)[0] || {};
  node.body.appendChild(definitionList([
    ['Schema', toText(meta.schema) + ' v' + toText(meta.version)],
    ['Scope', badge(toText(meta.scope), meta.scope === 'node_local' ? 'ok' : 'info')],
    ['Node-ID', toText(meta.node_id) || '—'],
    ['Quelle', shrinkText(store.getState().source, 70)]
  ]));

  node.body.appendChild(table([
    { key: 'site_id', label: 'Site' },
    { key: 'site_name', label: 'Name' },
    { label: 'Aktiv', align: 'center',
      render: function (row) { return badge(row.enabled ? 'ja' : 'nein', row.enabled ? 'ok' : 'muted'); } },
    { label: '', align: 'right', render: function (row) {
      return button('Löschen', { size: 'sm', variant: 'ghost',
        onClick: function () { removeWithGuard('sites', row.site_id); } });
    } }
  ], ensureArray(config.sites), { emptyText: 'Keine Sites' }));

  node.body.appendChild(table([
    { key: 'node_id', label: 'Node' },
    { key: 'site_id', label: 'Site' },
    { key: 'node_role', label: 'Rolle' },
    { label: 'Routen', align: 'right', render: function (row) {
      const count = ensureArray(config.site_controller_map).filter(function (route) {
        return toText(route.node_id) === toText(row.node_id);
      }).length;
      return String(count);
    } },
    { label: '', align: 'right', render: function (row) {
      return button('Löschen', { size: 'sm', variant: 'ghost',
        onClick: function () { removeWithGuard('nodes', row.node_id); } });
    } }
  ], ensureArray(config.nodes), { emptyText: 'Keine Nodes' }));

  node.body.appendChild(disclosure('Controller-Routen (site_controller_map)',
    table([
      { key: 'route_key', label: 'route_key' },
      { key: 'local_controller_id', label: 'lokal', align: 'right' },
      { key: 'controller_key', label: 'controller_key' },
      { label: 'Rolle', render: function (row) {
        return badge(toText(row.routing_role),
          toText(row.routing_role) === 'owner' ? 'ok' : 'muted');
      } },
      { label: 'Aktiv', align: 'center', render: function (row) {
        return checkbox({ checked: row.enabled !== false, onChange: function (event) {
          store.update('site_controller_map', row.route_key,
            { enabled: event.target.checked });
        } });
      } },
      { key: 'controller_uuid', label: 'controller_uuid', render: function (row) {
        return h('code.v9-uuid', { text: toText(row.controller_uuid), title: row.controller_uuid });
      } }
    ], ensureArray(config.site_controller_map), { emptyText: 'Keine Routen' }),
    { open: false }));

  return node;
}

/* -------------------------------------------------------------- Controllers */

function renderControllers(config) {
  const node = card('Controller', {
    key: 'controllers',
    meta: pill('controller_uuid + controller_key sind V9-Pflicht', 'info'),
    actions: button('Controller anlegen', { size: 'sm', icon: '＋',
      onClick: function () { openControllerModal(null); } })
  });

  const routesByUuid = indexBy(config.site_controller_map, 'controller_uuid');
  const virtualByUuid = indexBy(config.virtual_controllers, 'controller_uuid');

  node.body.appendChild(table([
    { key: 'controller_id', label: '#', align: 'right' },
    { key: 'device_name', label: 'Gerät' },
    { key: 'controller_key', label: 'controller_key' },
    { label: 'Bus', render: function (row) { return badge(toText(row.bus_type), 'info'); } },
    { label: 'Adresse', render: function (row) {
      return toText(row.host) + ':' + toText(row.port);
    } },
    { label: 'Route', render: function (row) {
      const route = routesByUuid.get(toText(row.controller_uuid));
      return route ? h('code.v9-code', { text: toText(route.route_key) })
        : badge('fehlt', 'danger');
    } },
    { label: 'Virtuell', align: 'center', render: function (row) {
      const virtual = virtualByUuid.get(toText(row.controller_uuid));
      if (!virtual) return '—';
      return badge(virtual.virt_active ? 'aktiv' : 'inaktiv',
        virtual.virt_active ? 'ok' : 'muted');
    } },
    { label: 'I/O', align: 'right', render: function (row) {
      const uuid = toText(row.controller_uuid);
      const sensors = ensureArray(config.sensors).filter(function (item) {
        return toText(item.controller_uuid) === uuid;
      }).length;
      const actuators = ensureArray(config.actuators).filter(function (item) {
        return toText(item.controller_uuid) === uuid;
      }).length;
      return sensors + ' / ' + actuators;
    } },
    { label: '', align: 'right', render: function (row) {
      return h('div.v9-row-actions', null,
        button('Bearbeiten', { size: 'sm', variant: 'ghost',
          onClick: function () { openControllerModal(row); } }),
        button('Löschen', { size: 'sm', variant: 'ghost',
          onClick: function () { removeWithGuard('controllers', row.controller_uuid); } }));
    } }
  ], ensureArray(config.controllers), { emptyText: 'Keine Controller' }));

  return node;
}

function openControllerModal(row) {
  const config = store.getConfig();
  const isNew = !row;
  const nameInput = input({ id: 'v9-ctrl-name', value: toText((row || {}).device_name) });
  const busSelect = select({ items: ENUMS.bus_type, value: toText((row || {}).bus_type) || 'modbus' });
  const hostInput = input({ id: 'v9-ctrl-host', value: toText((row || {}).host) });
  const portInput = input({ id: 'v9-ctrl-port', type: 'number', min: 1, max: 65535,
    value: (row || {}).port === undefined ? 502 : row.port });
  const unitInput = input({ id: 'v9-ctrl-unit', value: toText((row || {}).unit) || '0x1' });
  const tagsInput = input({ id: 'v9-ctrl-tags',
    value: ensureArray((row || {}).tags).join(', ') });
  const routeCheck = checkbox({ checked: true });

  modal({
    title: isNew ? 'Controller anlegen' : 'Controller bearbeiten',
    body: h('div.v9-form', null,
      field('Gerätename', nameInput, { required: true,
        hint: 'Bestimmt controller_key ("ctrl_<name>") und damit die abgeleitete controller_uuid.' }),
      field('Bus-Typ', busSelect, { required: true }),
      field('Host', hostInput, { required: true, hint: 'V9 verlangt einen nicht-leeren Wert.' }),
      field('Port', portInput, { required: true }),
      field('Unit', unitInput, { required: true }),
      field('Tags', tagsInput, { hint: 'Kommagetrennt' }),
      isNew ? field('Owner-Route automatisch anlegen', routeCheck,
        { hint: 'V9 verlangt genau eine aktivierte owner-Route je Controller.' }) : null,
      row ? h('div.v9-note', null,
        h('strong', { text: 'controller_uuid: ' }),
        h('code.v9-code', { text: toText(row.controller_uuid) }),
        h('p', { text: 'Die UUID bleibt beim Umbenennen stabil — sie ist die globale '
          + 'Primäridentität und wird von Sensoren, Aktoren, Filtern und Regeln referenziert.' }))
        : null),
    submitLabel: isNew ? 'Anlegen' : 'Speichern',
    onSubmit: function () {
      const patch = {
        device_name: nameInput.value.trim(),
        bus_type: busSelect.value,
        host: hostInput.value.trim(),
        port: toIntOrNull(portInput.value) || 502,
        unit: unitInput.value.trim() || '0x1',
        tags: tagsInput.value.split(',').map(function (item) { return item.trim(); })
          .filter(Boolean)
      };
      if (!patch.device_name || !patch.host) {
        toast('Gerätename und Host sind Pflicht.', 'danger');
        return false;
      }
      if (isNew) {
        const created = store.add('controllers', patch);
        if (routeCheck.checked) {
          store.add('site_controller_map', {
            local_controller_id: created.controller_id,
            controller_uuid: created.controller_uuid,
            controller_key: created.controller_key,
            node_id: toText((ensureArray(config.nodes)[0] || {}).node_id),
            site_id: toText((ensureArray(config.sites)[0] || {}).site_id),
            routing_role: 'owner',
            enabled: true
          });
        }
        toast('Controller "' + created.device_name + '" angelegt.', 'ok');
      } else {
        store.update('controllers', row.controller_uuid, patch);
        toast('Controller aktualisiert.', 'ok');
      }
      return true;
    }
  });
}

/* ---------------------------------------------------------------------- I/O */

function renderIo(config, section) {
  const spec = SECTIONS[section];
  const idField = spec.idField;
  const groupField = spec.groupField;
  const label = section === 'sensors' ? 'Sensoren' : 'Aktoren';

  const node = card(label, {
    key: section,
    meta: pill('Identität = controller_uuid + lokale ' + idField, 'info'),
    actions: button(label.slice(0, -1) + ' anlegen', { size: 'sm', icon: '＋',
      onClick: function () { openIoModal(section, null); } })
  });

  node.body.appendChild(table([
    { key: idField, label: idField, align: 'right' },
    { key: 'controller_key', label: 'Controller' },
    { key: groupField, label: 'Gruppe' },
    { key: 'address', label: 'Adresse', align: 'right' },
    { key: 'function_type', label: 'Funktion' },
    { label: 'Profil', align: 'right', render: function (row) {
      return row.profile_id === undefined ? '—' : String(row.profile_id);
    } },
    { label: 'Aktiv', align: 'center', render: function (row) {
      return checkbox({ checked: row.enabled !== false, onChange: function (event) {
        replaceIoRow(section, row, { enabled: event.target.checked });
      } });
    } },
    { label: 'Verwendet in', render: function (row) { return usageBadges(config, section, row); } },
    { label: '', align: 'right', render: function (row) {
      return h('div.v9-row-actions', null,
        button('Bearbeiten', { size: 'sm', variant: 'ghost',
          onClick: function () { openIoModal(section, row); } }),
        button('Löschen', { size: 'sm', variant: 'ghost',
          onClick: function () { removeIoRow(section, row); } }));
    } }
  ], ensureArray(config[section]), { emptyText: 'Keine ' + label }));

  return node;
}

function usageBadges(config, section, row) {
  const idField = SECTIONS[section].idField;
  const bucket = section;
  const uuid = toText(row.controller_uuid);
  const ioId = toIntOrNull(row[idField]);

  const states = ensureArray(config.process_states).filter(function (state) {
    const refs = state.io_refs || {};
    return ensureArray(refs[bucket]).some(function (ref) {
      return toText(ref.controller_uuid) === uuid && toIntOrNull(ref[idField]) === ioId;
    });
  }).map(function (state) { return toIntOrNull(state.state_id); });

  const rules = section !== 'sensors' ? [] : ensureArray(config.rules).filter(function (rule) {
    return ensureArray(rule.when).some(function (cond) {
      return toText(cond.src) === 'sensor' && toText(cond.controller_uuid) === uuid
        && toIntOrNull(cond.sensor_id) === ioId;
    });
  }).map(function (rule) { return toIntOrNull(rule.rule_id); });

  const nodes = [];
  if (states.length) nodes.push(badge('State ' + states.join(','), 'info'));
  if (rules.length) nodes.push(badge('Regel ' + rules.join(','), 'info'));
  if (!nodes.length) nodes.push(badge('ungenutzt', 'muted'));
  return h('div.v9-badges', null, nodes);
}

function openIoModal(section, row) {
  const config = store.getConfig();
  const spec = SECTIONS[section];
  const idField = spec.idField;
  const groupField = spec.groupField;
  const isNew = !row;

  const controllerItems = ensureArray(config.controllers).map(function (controller) {
    return { value: toText(controller.controller_uuid),
      label: '#' + controller.controller_id + ' · ' + toText(controller.device_name) };
  });
  const controllerSelect = select({ items: controllerItems,
    value: toText((row || {}).controller_uuid) || (controllerItems[0] || {}).value });
  const idInput = input({ type: 'number', min: 1,
    value: (row || {})[idField] === undefined ? nextIoId(config, section) : row[idField] });
  const groupInput = input({ value: toText((row || {})[groupField])
    || (section === 'sensors' ? 'S1' : 'A') });
  const addressInput = input({ type: 'number', min: 0,
    value: (row || {}).address === undefined ? 0 : row.address });
  const busSelect = select({ items: ENUMS.bus_type,
    value: toText((row || {}).bus_type) || 'modbus' });
  const functionSelect = select({ items: functionTypesFor(section, toText((row || {}).bus_type) || 'modbus'),
    value: toText((row || {}).function_type) });
  busSelect.addEventListener('change', function () {
    const items = functionTypesFor(section, busSelect.value);
    mount(functionSelect, items.map(function (item) {
      return h('option', { value: item, text: item });
    }));
  });
  const profileItems = [{ value: '', label: '— kein Profil —' }].concat(
    ensureArray(config.scaling_profiles).map(function (profile) {
      return { value: String(profile.profile_id),
        label: '#' + profile.profile_id + ' · ' + toText(profile.name) };
    }));
  const profileSelect = select({ items: profileItems,
    value: (row || {}).profile_id === undefined ? '' : String(row.profile_id) });

  modal({
    title: (isNew ? 'Anlegen: ' : 'Bearbeiten: ') + (section === 'sensors' ? 'Sensor' : 'Aktor'),
    body: h('div.v9-form', null,
      field('Controller', controllerSelect, { required: true,
        hint: 'Bestimmt controller_uuid, node_id, site_id und local_controller_id.' }),
      field(idField, idInput, { required: true,
        hint: 'Nur je Controller eindeutig — dieselbe ID darf an einem anderen Controller erneut vorkommen.' }),
      field(groupField, groupInput, { required: true }),
      field('Bus-Typ', busSelect, { required: true }),
      field('Funktion', functionSelect, { required: true }),
      field('Adresse', addressInput, { required: true }),
      field('Skalierungsprofil', profileSelect)),
    submitLabel: isNew ? 'Anlegen' : 'Speichern',
    onSubmit: function () {
      const patch = {
        controller_uuid: controllerSelect.value,
        [groupField]: groupInput.value.trim(),
        address: toIntOrNull(addressInput.value) || 0,
        bus_type: busSelect.value,
        function_type: functionSelect.value,
        enabled: row ? row.enabled !== false : true
      };
      patch[idField] = toIntOrNull(idInput.value) || 1;
      const profileId = toIntOrNull(profileSelect.value);
      if (profileId !== null) patch.profile_id = profileId;

      const rows = ensureArray(store.getConfig()[section]).filter(function (item) {
        if (!row) return true;
        return !(toText(item.controller_uuid) === toText(row.controller_uuid)
          && toIntOrNull(item[idField]) === toIntOrNull(row[idField]));
      });
      const clash = rows.some(function (item) {
        return toText(item.controller_uuid) === patch.controller_uuid
          && toIntOrNull(item[idField]) === patch[idField];
      });
      if (clash) {
        toast('Das Paar (controller_uuid, ' + idField + ') existiert bereits.', 'danger');
        return false;
      }
      store.replaceSection(section, rows.concat([patch]));
      toast(isNew ? 'Angelegt.' : 'Gespeichert.', 'ok');
      return true;
    }
  });
}

function nextIoId(config, section) {
  const idField = SECTIONS[section].idField;
  let max = 0;
  ensureArray(config[section]).forEach(function (row) {
    const value = toIntOrNull(row[idField]);
    if (value !== null && value > max) max = value;
  });
  return max + 1;
}

function replaceIoRow(section, row, patch) {
  const idField = SECTIONS[section].idField;
  const rows = ensureArray(store.getConfig()[section]).map(function (item) {
    if (toText(item.controller_uuid) === toText(row.controller_uuid)
        && toIntOrNull(item[idField]) === toIntOrNull(row[idField])) {
      return Object.assign({}, item, patch);
    }
    return item;
  });
  store.replaceSection(section, rows);
}

function removeIoRow(section, row) {
  const idField = SECTIONS[section].idField;
  const config = store.getConfig();
  const uuid = toText(row.controller_uuid);
  const ioId = toIntOrNull(row[idField]);

  const usedByStates = ensureArray(config.process_states).filter(function (state) {
    return ensureArray((state.io_refs || {})[section]).some(function (ref) {
      return toText(ref.controller_uuid) === uuid && toIntOrNull(ref[idField]) === ioId;
    });
  }).length;

  modal({
    title: 'Löschen bestätigen',
    body: h('div.v9-form', null,
      h('p', { text: idField + ' ' + ioId + ' an Controller ' + toText(row.controller_key)
        + ' wirklich löschen?' }),
      usedByStates
        ? h('p.v9-note.v9-note--warn', { text: 'Achtung: ' + usedByStates
          + ' Prozess-State(s) referenzieren dieses I/O. Die Referenzen werden mitentfernt.' })
        : null),
    submitLabel: 'Löschen',
    onSubmit: function () {
      const rows = ensureArray(store.getConfig()[section]).filter(function (item) {
        return !(toText(item.controller_uuid) === uuid && toIntOrNull(item[idField]) === ioId);
      });
      store.replaceSection(section, rows);
      // Kaskade auf io_refs / filters / rules erledigt der Factory-Layer.
      store.remove(section, ioId);
      toast('Gelöscht.', 'ok');
      return true;
    }
  });
}

/* -------------------------------------------------------------- Hilfsdialoge */

function openSiteModal() {
  const idInput = input({ value: 'site-' });
  const nameInput = input({ value: '' });
  modal({
    title: 'Site anlegen',
    body: h('div.v9-form', null,
      field('site_id', idInput, { required: true }),
      field('Name', nameInput, { required: true })),
    submitLabel: 'Anlegen',
    onSubmit: function () {
      if (!idInput.value.trim() || !nameInput.value.trim()) {
        toast('site_id und Name sind Pflicht.', 'danger');
        return false;
      }
      store.add('sites', { site_id: idInput.value.trim(), site_name: nameInput.value.trim(),
        enabled: true, description: '' });
      toast('Site angelegt.', 'ok');
      return true;
    }
  });
}

function openNodeModal() {
  const config = store.getConfig();
  const idInput = input({ value: 'fn-' });
  const siteSelect = select({ items: ensureArray(config.sites).map(function (site) {
    return { value: toText(site.site_id), label: toText(site.site_id) };
  }) });
  const roleSelect = select({ items: ENUMS.node_role, value: 'worker' });
  modal({
    title: 'Node anlegen',
    body: h('div.v9-form', null,
      field('node_id', idInput, { required: true }),
      field('Site', siteSelect, { required: true }),
      field('Rolle', roleSelect, { required: true })),
    submitLabel: 'Anlegen',
    onSubmit: function () {
      if (!idInput.value.trim()) {
        toast('node_id ist Pflicht.', 'danger');
        return false;
      }
      store.add('nodes', { node_id: idInput.value.trim(), site_id: siteSelect.value,
        node_role: roleSelect.value, enabled: true, description: '' });
      toast('Node angelegt.', 'ok');
      return true;
    }
  });
}

function removeWithGuard(section, keyValue) {
  modal({
    title: 'Löschen bestätigen',
    body: h('p', { text: 'Eintrag "' + keyValue + '" aus ' + section
      + ' löschen? Abhängige Referenzen werden mitbereinigt.' }),
    submitLabel: 'Löschen',
    onSubmit: function () {
      store.remove(section, keyValue);
      toast('Gelöscht.', 'ok');
      return true;
    }
  });
}
