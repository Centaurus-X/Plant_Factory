/**
 * v9_ui_cross.js — Panel "Cross V8".
 *
 * Bis V53 war der Cross-Shard ein reines ERGEBNIS: der Editor pflegte die
 * master_global-Config, `splitShards()` warf den V8-Shard aus, fertig. Wer
 * einen im Feld vorhandenen Cross-Shard anpassen wollte, musste ihn von Hand
 * bearbeiten — und damit gegen einen Vertrag, der fünf Feldgruppen
 * fail-closed VERBIETET.
 *
 * Dieses Panel schließt die Lücke. Es ist ein eigenständiger Editor für den
 * V8-Cross-Vertrag mit eigenem Arbeitsspeicher (`session`), unabhängig vom
 * Master-Store:
 *
 *   * Laden      — aus dem Master projizieren, vom Server holen oder eine
 *                  vorhandene Datei einlesen
 *   * Bearbeiten — meta (owner/domain), Controller-Stubs, logische I/O,
 *                  Routen und Regeln
 *   * Prüfen     — live gegen alle 15 Cross-Invarianten; jede verbotene
 *                  Eingabe wird gar nicht erst angeboten
 *   * Export     — im kanonischen Lesbarkeitsformat der Runtime
 *
 * Der Vertrag in einem Satz: ein Cross-Shard trägt LOGISCHE Identitäten
 * (controller_uuid + lokale I/O-ID) und NIEMALS Physik (bus_type, host, port,
 * unit, address, function_type) oder V9-Execution-Metadaten.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import {
  CROSS_VERSION, CROSS_PROFILE, CRITICAL_GROUPS, ENUMS, isCrossConfig,
  orderSections, SECTION_ORDER, crossDomainFor
} from './v9_schema.js';
import * as store from './v9_store.js';
import { classifyScopes, projectCrossShard, listCrossOwners, crossEligibility }
  from './v9_shard.js';
import { validateCrossShard, groupFindings } from './v9_validate.js';
import {
  createCrossMeta, createCrossController, createCrossSensor, createCrossActuator,
  createCrossRoute, createCrossRule, createCrossProcess, createEmptyV9Config,
  stripPhysicalFields
} from './v9_factory.js';
import { formatConfig, collectFloatLiterals } from './v9_json_format.js';
import {
  h, mount, card, table, button, badge, pill, toolbar, modal, toast,
  statusStrip, disclosure, definitionList, input, select, checkbox, textarea, field
} from './v9_dom.js';
import { ensureArray, toText, toIntOrNull, isPlainObject, shrinkText, safeJsonParse }
  from './shared_utils.js';
import { showConfirmation } from './dialog_service.js';

/* -------------------------------------------------------------------------
 * Sitzungszustand
 *
 * Bewusst NICHT im Master-Store: ein Cross-Shard ist ein eigenständiges
 * Artefakt mit eigenem Vertrag. Würde er im selben Store liegen, müsste jede
 * Master-Validierung zwischen zwei Profilen unterscheiden — genau die
 * Vermischung, an der die V50-Architektur gescheitert ist.
 * ---------------------------------------------------------------------- */

const session = {
  config: null,
  source: '',
  dirty: false,
  floatHints: null,
  report: null
};

let host = null;

export function initCrossPanel(container) {
  host = container;
  store.on('config:changed', function () {
    if (!session.config) autoProject();
    render();
  });
  autoProject();
  render();
}

/**
 * Projiziert beim ersten Öffnen automatisch, wenn der Master GENAU EINEN
 * cross-fähigen Owner hat.
 *
 * Begründung: in diesem Fall gibt es keine Wahl zu treffen — der Anwender
 * müsste einen Dialog bestätigen, dessen Ergebnis von vornherein feststeht.
 * Bei mehreren Ownern bleibt die Auswahl bewusst beim Anwender, weil dann eine
 * echte Entscheidung ansteht.
 */
function autoProject() {
  if (session.config) return;
  const master = store.getConfig();
  if (!master) return;
  const owners = listCrossOwners(master);
  if (owners.length !== 1) return;
  adopt(projectCrossShard(master, owners[0]),
    'automatisch aus dem Master projiziert (' + owners[0] + ')');
}

/** Setzt einen Cross-Shard als aktuellen Arbeitsstand. */
function adopt(config, source, floatHints) {
  session.config = orderSections(config);
  session.source = source;
  session.floatHints = floatHints || null;
  session.dirty = false;
  revalidate();
  render();
}

function revalidate() {
  session.report = session.config ? validateCrossShard(session.config) : null;
}

function touch() {
  session.dirty = true;
  revalidate();
  render();
}

/* -------------------------------------------------------------------------
 * Rendern
 * ---------------------------------------------------------------------- */

function render() {
  if (!host) return;
  if (!session.config) {
    mount(host, [renderIntro()]);
    return;
  }
  mount(host, [
    renderToolbar(),
    renderFindings(),
    renderMeta(),
    renderControllers(),
    renderRoutes(),
    renderIo('sensors'),
    renderIo('actuators'),
    renderRules(),
    renderContract()
  ]);
}

function renderIntro() {
  const master = store.getConfig();
  const owners = master ? listCrossOwners(master) : [];
  const node = card('Cross-Shard (V8) bearbeiten', {
    key: 'cross-intro',
    meta: pill('Vertragsversion ' + CROSS_VERSION, 'info')
  });

  node.body.appendChild(h('p.v9-note', { text:
    'Ein Cross-Shard enthält genau die Regeln, die über mehrere Controller oder '
    + 'mehrere Worker hinweg ausgeführt werden. Er trägt ausschließlich logische '
    + 'Identitäten — controller_uuid plus lokale I/O-ID. Physikalische '
    + 'Feldbus-Koordinaten sind darin fail-closed verboten, damit ein '
    + 'Coordinator niemals direkt auf fremde Hardware schreiben kann.' }));

  node.body.appendChild(toolbar([
    owners.length
      ? button('Aus Master projizieren (' + owners.join(', ') + ')',
        { size: 'sm', variant: 'primary', onClick: openProjectDialog })
      : button('Aus Master projizieren', { size: 'sm', variant: 'ghost', disabled: true,
        title: 'Der Master enthält aktuell keine cross-fähigen Regeln.' }),
    button('Vom Server laden', { size: 'sm', variant: 'ghost', onClick: openServerDialog }),
    button('Datei einlesen', { size: 'sm', variant: 'ghost', onClick: openImportDialog }),
    button('Leeren Shard anlegen', { size: 'sm', variant: 'ghost', onClick: openCreateDialog })
  ]));

  if (master && !owners.length) {
    const scopes = classifyScopes(master);
    const rows = ensureArray(master.rules).map(function (rule) {
      const result = crossEligibility(master, rule, scopes);
      return {
        rule_id: rule.rule_id,
        name: toText(rule.name),
        scope: result.scope,
        reasons: result.errors.join('; ') || '—'
      };
    });
    node.body.appendChild(disclosure('Warum gibt es keinen Cross-Shard?', table([
      { key: 'rule_id', label: 'ID', align: 'right' },
      { key: 'name', label: 'Regel' },
      { key: 'scope', label: 'Scope' },
      { key: 'reasons', label: 'Hindernis' }
    ], rows, { emptyText: 'Keine Regeln im Master' }), { open: true }));
  }
  return node;
}

function renderToolbar() {
  const report = session.report;
  return toolbar([
    statusStrip(report),
    pill(toText(metaRow().owner_node_id) || 'ohne Owner', 'info'),
    session.dirty ? pill('ungespeicherte Änderungen', 'warn') : pill('unverändert', 'ok'),
    button('Erneut prüfen', { size: 'sm', variant: 'ghost', onClick: function () {
      revalidate(); render();
    } }),
    button('Als JSON herunterladen', { size: 'sm', variant: 'primary', onClick: downloadShard }),
    button('Vorschau', { size: 'sm', variant: 'ghost', onClick: previewShard }),
    button('Anderen Shard laden', { size: 'sm', variant: 'ghost', onClick: function () {
      function resetSession() {
        session.config = null;
        render();
      }
      if (!session.dirty) {
        resetSession();
        return;
      }
      showConfirmation('Ungespeicherte Änderungen am Cross-Shard verwerfen?', {
        title: 'Shard wechseln',
        confirmLabel: 'Änderungen verwerfen',
        destructive: true
      }, resetSession);
    } })
  ]);
}

function renderFindings() {
  const report = session.report;
  const node = card('Cross-Gate', {
    key: 'cross-gate',
    meta: statusStrip(report)
  });
  if (!report) return node;

  if (!report.errors.length && !report.warnings.length) {
    node.body.appendChild(h('p.v9-note.v9-note--ok', { text:
      'Alle Cross-Invarianten erfüllt: Version 8, Scope cross, Owner und Domain gesetzt, '
      + 'local_node leer, keine Physikfelder an Controllern oder I/O, keine '
      + 'V9-Execution-Metadaten an Regeln, keine kritische Regelgruppe, jede Regel '
      + 'gehört dem Shard-Owner und schreibt ausschließlich cross-eigene States.' }));
    return node;
  }
  groupFindings(report).forEach(function (bucket, section) {
    const rows = bucket.errors.map(function (item) {
      return Object.assign({ severity: 'Fehler' }, item);
    }).concat(bucket.warnings.map(function (item) {
      return Object.assign({ severity: 'Hinweis' }, item);
    }));
    node.body.appendChild(disclosure(
      section + ' — ' + bucket.errors.length + ' Fehler, ' + bucket.warnings.length + ' Hinweise',
      table([
        { label: 'Schwere', render: function (row) {
          return badge(row.severity, row.severity === 'Fehler' ? 'danger' : 'warn');
        } },
        { key: 'path', label: 'Pfad', render: function (row) {
          return h('code.v9-code', { text: toText(row.path) });
        } },
        { key: 'code', label: 'Code' },
        { key: 'message', label: 'Meldung' }
      ], rows, { emptyText: '—' }),
      { open: bucket.errors.length > 0 }));
  });
  return node;
}

/* ------------------------------------------------------------------- meta */

function metaRow() {
  return ensureArray(session.config && session.config.meta)[0] || {};
}

function renderMeta() {
  const meta = metaRow();
  const node = card('Identität des Shards', {
    key: 'cross-meta',
    meta: pill('Quelle: ' + shrinkText(session.source, 42), 'info')
  });

  node.body.appendChild(definitionList([
    ['version', String(meta.version)],
    ['schema', toText(meta.schema)],
    ['scope', toText(meta.scope)],
    ['owner_node_id', toText(meta.owner_node_id)],
    ['domain_id', toText(meta.domain_id)],
    ['execution_scope der Regeln', 'cross:' + crossDomainFor(toText(meta.owner_node_id))]
  ]));

  node.body.appendChild(button('Owner und Domain ändern', {
    size: 'sm', variant: 'ghost', onClick: openMetaDialog
  }));
  return node;
}

function openMetaDialog() {
  const meta = metaRow();
  const ownerField = input({ value: toText(meta.owner_node_id) });
  const domainField = input({ value: toText(meta.domain_id) });
  const descField = textarea({ value: toText(meta.description), rows: 3 });

  modal({
    title: 'Owner und Domain',
    body: h('div.v9-form', null,
      h('p.v9-note', { text:
        'Der Owner ist der Worker, der die Cross-Regeln ausführt. Alle Regeln des '
        + 'Shards müssen ihm gehören — der Coordinator weist fremde Regeln ab.' }),
      field('owner_node_id', ownerField, { required: true }),
      field('domain_id', domainField, { hint: 'Pflicht bei Cross-Scope, z. B. cross-fn-01-default' }),
      field('description', descField)),
    submitLabel: 'Übernehmen',
    onSubmit: function () {
      const owner = toText(ownerField.value);
      if (!owner) { toast('owner_node_id darf nicht leer sein.', 'danger'); return false; }
      session.config.meta = [createCrossMeta({
        owner_node_id: owner,
        domain_id: toText(domainField.value) || ('cross-' + owner + '-default'),
        description: toText(descField.value)
      })];
      touch();
      return true;
    }
  });
}

/* ------------------------------------------------------------ Controller */

function renderControllers() {
  const rows = ensureArray(session.config.controllers);
  const node = card('Controller-Stubs', {
    key: 'cross-controllers',
    meta: pill(rows.length + ' Stück', 'info')
  });

  node.body.appendChild(h('p.v9-note', { text:
    'Ein Cross-Controller ist ein reiner Identitätsanker: controller_id, '
    + 'controller_uuid, controller_key und owner_node_id. Die verbotenen Felder '
    + CROSS_PROFILE.forbiddenControllerFields.join(', ')
    + ' werden vom Editor gar nicht erst angeboten.' }));

  node.body.appendChild(table([
    { key: 'controller_id', label: 'ID', align: 'right' },
    { key: 'controller_key', label: 'Schlüssel' },
    { key: 'owner_node_id', label: 'Owner' },
    { key: 'controller_uuid', label: 'UUID', render: function (row) {
      return h('code.v9-code', { text: shrinkText(toText(row.controller_uuid), 20) });
    } },
    { label: '', render: function (row) {
      return h('div.v9-row-actions', null,
        button('Bearbeiten', { size: 'sm', variant: 'ghost', onClick: function () {
          openControllerDialog(row);
        } }),
        button('Entfernen', { size: 'sm', variant: 'danger', onClick: function () {
          removeRow('controllers', 'controller_uuid', row.controller_uuid);
        } }));
    } }
  ], rows, { emptyText: 'Keine Controller' }));

  node.body.appendChild(button('Controller ergänzen', {
    size: 'sm', variant: 'primary', onClick: function () { openControllerDialog(null); }
  }));
  return node;
}

function openControllerDialog(current) {
  const source = current || {};
  const idField = input({ value: toText(source.controller_id), type: 'number' });
  const keyField = input({ value: toText(source.controller_key) });
  const uuidField = input({ value: toText(source.controller_uuid) });
  const ownerField = input({ value: toText(source.owner_node_id)
    || toText(metaRow().owner_node_id) });

  modal({
    title: current ? 'Controller bearbeiten' : 'Controller ergänzen',
    body: h('div.v9-form', null,
      field('controller_id', idField, { required: true }),
      field('controller_key', keyField, { required: true, hint: 'z. B. ctrl_wago_3' }),
      field('controller_uuid', uuidField, { required: true,
        hint: 'Muss exakt der UUID aus dem Node-Shard entsprechen.' }),
      field('owner_node_id', ownerField, { required: true })),
    submitLabel: 'Speichern',
    onSubmit: function () {
      const row = createCrossController({
        controller_id: toIntOrNull(idField.value),
        controller_key: toText(keyField.value),
        controller_uuid: toText(uuidField.value),
        owner_node_id: toText(ownerField.value)
      });
      upsertRow('controllers', 'controller_uuid', row, current);
      return true;
    }
  });
}

/* ---------------------------------------------------------------- Routen */

function renderRoutes() {
  const rows = ensureArray(session.config.site_controller_map);
  const node = card('Routen', {
    key: 'cross-routes',
    meta: pill(rows.length + ' Stück', 'info')
  });
  node.body.appendChild(h('p.v9-note', { text:
    'Im Cross-Shard entfällt die site_id — der route_key lautet deshalb '
    + '"<node>.ctrl_<local_id>". Jeder Controller braucht genau eine Route.' }));

  node.body.appendChild(table([
    { key: 'local_controller_id', label: 'lokale ID', align: 'right' },
    { key: 'node_id', label: 'Node' },
    { key: 'controller_key', label: 'Schlüssel' },
    { key: 'route_key', label: 'route_key' },
    { key: 'routing_role', label: 'Rolle' },
    { label: '', render: function (row) {
      return button('Entfernen', { size: 'sm', variant: 'danger', onClick: function () {
        removeRow('site_controller_map', 'controller_uuid', row.controller_uuid);
      } });
    } }
  ], rows, { emptyText: 'Keine Routen' }));

  node.body.appendChild(button('Routen aus Controllern erzeugen', {
    size: 'sm', variant: 'ghost', onClick: rebuildRoutes
  }));
  return node;
}

function rebuildRoutes() {
  const owner = toText(metaRow().owner_node_id);
  session.config.site_controller_map = ensureArray(session.config.controllers)
    .map(function (controller, index) {
      const existing = ensureArray(session.config.site_controller_map).filter(
        function (route) {
          return toText(route.controller_uuid) === toText(controller.controller_uuid);
        })[0] || {};
      return createCrossRoute({
        local_controller_id: toIntOrNull(existing.local_controller_id)
          || toIntOrNull(controller.controller_id) || (index + 1),
        node_id: toText(existing.node_id) || toText(controller.owner_node_id) || owner,
        controller_uuid: toText(controller.controller_uuid),
        controller_key: toText(controller.controller_key),
        routing_role: toText(existing.routing_role) || 'owner',
        enabled: existing.enabled === undefined ? true : !!existing.enabled
      });
    });
  toast('Routen neu erzeugt.', 'ok');
  touch();
}

/* ------------------------------------------------------------- logische I/O */

function renderIo(section) {
  const rows = ensureArray(session.config[section]);
  const isSensor = section === 'sensors';
  const idKey = isSensor ? 'sensor_id' : 'actuator_id';
  const groupKey = isSensor ? 'sensor_group' : 'actuator_group';
  const node = card(isSensor ? 'Logische Sensoren' : 'Logische Aktoren', {
    key: 'cross-' + section,
    meta: pill(rows.length + ' Stück', 'info')
  });

  node.body.appendChild(h('p.v9-note', { text:
    'Identität ist controller_uuid + ' + idKey + '. Die Felder '
    + CROSS_PROFILE.forbiddenIoFields.join(', ')
    + ' gehören in den Node-Shard und sind hier verboten.' }));

  node.body.appendChild(table([
    { key: 'local_controller_id', label: 'ctrl', align: 'right' },
    { key: idKey, label: idKey, align: 'right' },
    { key: 'controller_key', label: 'Controller' },
    { key: groupKey, label: 'Gruppe' },
    { key: 'profile_id', label: 'Profil', align: 'right' },
    { label: '', render: function (row) {
      return h('div.v9-row-actions', null,
        button('Bearbeiten', { size: 'sm', variant: 'ghost', onClick: function () {
          openIoDialog(section, row);
        } }),
        button('Entfernen', { size: 'sm', variant: 'danger', onClick: function () {
          removeIo(section, row);
        } }));
    } }
  ], rows, { emptyText: 'Keine Einträge' }));

  node.body.appendChild(button(isSensor ? 'Sensor ergänzen' : 'Aktor ergänzen', {
    size: 'sm', variant: 'primary', onClick: function () { openIoDialog(section, null); }
  }));
  return node;
}

function controllerItems() {
  return ensureArray(session.config.controllers).map(function (row) {
    return { value: toText(row.controller_uuid),
      label: toText(row.controller_key) + '  ' + shrinkText(toText(row.controller_uuid), 14) };
  });
}

function openIoDialog(section, current) {
  const isSensor = section === 'sensors';
  const idKey = isSensor ? 'sensor_id' : 'actuator_id';
  const groupKey = isSensor ? 'sensor_group' : 'actuator_group';
  const source = current || {};

  const uuidField = select({ items: controllerItems(),
    value: toText(source.controller_uuid) });
  const idField = input({ value: toText(source[idKey]), type: 'number' });
  const localField = input({ value: toText(source.local_controller_id), type: 'number' });
  const groupField = input({ value: toText(source[groupKey]) });
  const profileField = input({ value: toText(source.profile_id), type: 'number' });
  const enabledField = checkbox({ checked: source.enabled === undefined ? true : !!source.enabled });

  modal({
    title: (current ? 'Bearbeiten: ' : 'Ergänzen: ') + (isSensor ? 'Sensor' : 'Aktor'),
    body: h('div.v9-form', null,
      field('controller_uuid', uuidField, { required: true }),
      field(idKey, idField, { required: true }),
      field('local_controller_id', localField,
        { hint: 'Muss zur Route dieses Controllers passen.' }),
      field(groupKey, groupField),
      field('profile_id', profileField, { hint: 'Optional — nur wenn skaliert wird.' }),
      field('enabled', enabledField)),
    submitLabel: 'Speichern',
    onSubmit: function () {
      const uuid = toText(uuidField.value);
      const localId = toIntOrNull(localField.value) || routeLocalId(uuid);
      const patch = {
        controller_uuid: uuid,
        local_controller_id: localId,
        controller_key: controllerKeyFor(uuid),
        enabled: !!enabledField.checked
      };
      patch[idKey] = toIntOrNull(idField.value);
      patch[groupKey] = toText(groupField.value);
      const profile = toIntOrNull(profileField.value);
      if (profile !== null) patch.profile_id = profile;
      patch.node_id = routeNodeId(uuid) || toText(metaRow().owner_node_id);

      const row = isSensor ? createCrossSensor(patch) : createCrossActuator(patch);
      if (!row[idKey]) { toast(idKey + ' ist Pflicht.', 'danger'); return false; }

      const list = ensureArray(session.config[section]).slice();
      const position = list.findIndex(function (item) {
        return toText(item.controller_uuid) === uuid
          && toIntOrNull(item[idKey]) === row[idKey];
      });
      if (position >= 0) list[position] = row; else list.push(row);
      if (current && (toText(current.controller_uuid) !== uuid
          || toIntOrNull(current[idKey]) !== row[idKey])) {
        const stale = list.findIndex(function (item) {
          return toText(item.controller_uuid) === toText(current.controller_uuid)
            && toIntOrNull(item[idKey]) === toIntOrNull(current[idKey]);
        });
        if (stale >= 0) list.splice(stale, 1);
      }
      session.config[section] = list;
      touch();
      return true;
    }
  });
}

function routeFor(uuid) {
  return ensureArray(session.config.site_controller_map).filter(function (route) {
    return toText(route.controller_uuid) === toText(uuid);
  })[0] || null;
}

function routeLocalId(uuid) {
  const route = routeFor(uuid);
  return route ? toIntOrNull(route.local_controller_id) : null;
}

function routeNodeId(uuid) {
  const route = routeFor(uuid);
  return route ? toText(route.node_id) : '';
}

function controllerKeyFor(uuid) {
  const match = ensureArray(session.config.controllers).filter(function (row) {
    return toText(row.controller_uuid) === toText(uuid);
  })[0];
  return match ? toText(match.controller_key) : '';
}

function removeIo(section, row) {
  const idKey = section === 'sensors' ? 'sensor_id' : 'actuator_id';
  session.config[section] = ensureArray(session.config[section]).filter(function (item) {
    return !(toText(item.controller_uuid) === toText(row.controller_uuid)
      && toIntOrNull(item[idKey]) === toIntOrNull(row[idKey]));
  });
  touch();
}

/* ---------------------------------------------------------------- Regeln */

function renderRules() {
  const rows = ensureArray(session.config.rules);
  const node = card('Cross-Regeln', {
    key: 'cross-rules',
    meta: pill(rows.length + ' Stück', 'info')
  });

  node.body.appendChild(h('p.v9-note', { text:
    'Cross-Regeln tragen KEINE V9-Execution-Metadaten ('
    + CROSS_PROFILE.optionalRuleFields.join(', ')
    + ') — die setzt erst der Master beim Rückführen. Kritische Regelgruppen ('
    + CRITICAL_GROUPS.join(', ') + ') sind hier fail-closed verboten.' }));

  node.body.appendChild(table([
    { key: 'rule_id', label: 'ID', align: 'right' },
    { key: 'name', label: 'Name' },
    { key: 'group', label: 'Gruppe' },
    { key: 'priority', label: 'Priorität', align: 'right' },
    { label: 'aktiv', render: function (row) {
      return badge(row.enabled ? 'ja' : 'nein', row.enabled ? 'ok' : 'warn');
    } },
    { label: 'schreibt', render: function (row) {
      return h('code.v9-code', { text: writtenStateIds(row).join(', ') || 'notify' });
    } },
    { label: '', render: function (row) {
      return h('div.v9-row-actions', null,
        button('JSON', { size: 'sm', variant: 'ghost', onClick: function () {
          modal({ title: 'Regel ' + row.rule_id,
            body: h('pre.v9-json', { text: formatConfig({ rules: [row] }) }),
            cancelLabel: 'Schließen' });
        } }),
        button('Entfernen', { size: 'sm', variant: 'danger', onClick: function () {
          removeRow('rules', 'rule_id', row.rule_id);
        } }));
    } }
  ], rows, { emptyText: 'Keine Regeln' }));

  node.body.appendChild(toolbar([
    button('Regel aus dem Master übernehmen', { size: 'sm', variant: 'primary',
      onClick: openAdoptRuleDialog }),
    button('Leere Regel anlegen', { size: 'sm', variant: 'ghost',
      onClick: openNewRuleDialog })
  ]));
  return node;
}

function writtenStateIds(rule) {
  const out = [];
  ['do', 'else_do'].forEach(function (bucket) {
    ensureArray(rule[bucket]).forEach(function (action) {
      ensureArray(action.state_ids).forEach(function (value) {
        const id = toIntOrNull(value);
        if (id !== null && out.indexOf(id) < 0) out.push(id);
      });
    });
  });
  return out.sort(function (a, b) { return a - b; });
}

function openAdoptRuleDialog() {
  const master = store.getConfig();
  if (!master) { toast('Kein Master geladen.', 'warn'); return; }
  const scopes = classifyScopes(master);
  const owner = toText(metaRow().owner_node_id);
  const present = ensureArray(session.config.rules).map(function (row) {
    return toIntOrNull(row.rule_id);
  });

  const candidates = ensureArray(master.rules).map(function (rule) {
    const result = crossEligibility(master, rule, scopes);
    return { rule, result };
  }).filter(function (item) {
    return present.indexOf(toIntOrNull(item.rule.rule_id)) < 0;
  });

  const chosen = new Set();
  const rows = candidates.map(function (item) {
    return {
      rule_id: item.rule.rule_id,
      name: toText(item.rule.name),
      owner: toText(item.rule.owner_node_id),
      scope: item.result.scope,
      ok: item.result.ok && toText(item.rule.owner_node_id) === owner,
      reasons: item.result.ok
        ? (toText(item.rule.owner_node_id) === owner ? '—' : 'gehört ' + toText(item.rule.owner_node_id))
        : item.result.errors.join('; ')
    };
  });

  modal({
    title: 'Regeln aus dem Master übernehmen',
    body: h('div.v9-form', null,
      h('p.v9-note', { text:
        'Übernommen werden dürfen nur Regeln, die dem Owner "' + owner + '" gehören und '
        + 'das Cross-Gate bestehen. Alles andere bleibt node-lokal.' }),
      table([
        { label: '', render: function (row) {
          return checkbox({ checked: false, disabled: !row.ok, onChange: function (event) {
            if (event.target.checked) chosen.add(row.rule_id); else chosen.delete(row.rule_id);
          } });
        } },
        { key: 'rule_id', label: 'ID', align: 'right' },
        { key: 'name', label: 'Name' },
        { label: 'Scope', render: function (row) {
          return badge(row.scope, row.ok ? 'ok' : 'warn');
        } },
        { key: 'reasons', label: 'Hindernis' }
      ], rows, { emptyText: 'Keine übernehmbaren Regeln' })),
    submitLabel: 'Übernehmen',
    onSubmit: function () {
      const adopted = ensureArray(master.rules).filter(function (rule) {
        return chosen.has(rule.rule_id);
      }).map(function (rule) { return createCrossRule(rule, { owner_node_id: owner }); });
      if (!adopted.length) { toast('Nichts ausgewählt.', 'warn'); return false; }
      session.config.rules = ensureArray(session.config.rules).concat(adopted);
      adoptSupportingEntities(master, adopted);
      toast(adopted.length + ' Regel(n) übernommen.', 'ok');
      touch();
      return true;
    }
  });
}

/**
 * Zieht zu übernommenen Regeln alles nach, worauf sie zeigen.
 *
 * Eine Regel ohne ihre States, Prozesse und logische I/O ist im Cross-Shard
 * wertlos — die Validierung würde sofort über unbekannte Referenzen stolpern.
 * Deshalb wandert der Referenzabschluss automatisch mit, physikalisch
 * entkernt durch `stripPhysicalFields()`.
 */
function adoptSupportingEntities(master, rules) {
  const owner = toText(metaRow().owner_node_id);
  const wantedStates = new Set();
  rules.forEach(function (rule) {
    writtenStateIds(rule).forEach(function (id) { wantedStates.add(id); });
    ensureArray(rule.when).concat(ensureArray(rule.until)).forEach(function (cond) {
      const id = toIntOrNull(cond.state_id);
      if (id !== null) wantedStates.add(id);
    });
  });

  const haveStates = new Set(ensureArray(session.config.process_states).map(function (row) {
    return toIntOrNull(row.state_id);
  }));
  const newStates = ensureArray(master.process_states).filter(function (row) {
    return wantedStates.has(toIntOrNull(row.state_id)) && !haveStates.has(toIntOrNull(row.state_id));
  });
  session.config.process_states = ensureArray(session.config.process_states).concat(newStates);

  const wantedProcesses = new Set(session.config.process_states.map(function (row) {
    return toIntOrNull(row.p_id);
  }));
  const haveProcesses = new Set(ensureArray(session.config.processes).map(function (row) {
    return toIntOrNull(row.p_id);
  }));
  session.config.processes = ensureArray(session.config.processes).concat(
    ensureArray(master.processes).filter(function (row) {
      return wantedProcesses.has(toIntOrNull(row.p_id)) && !haveProcesses.has(toIntOrNull(row.p_id));
    }).map(function (row) { return createCrossProcess(row, { owner_node_id: owner }); }));

  // Logische I/O aller referenzierten States nachziehen.
  ['sensors', 'actuators'].forEach(function (section) {
    const idKey = section === 'sensors' ? 'sensor_id' : 'actuator_id';
    const wanted = new Map();
    ensureArray(session.config.process_states).forEach(function (state) {
      const refs = isPlainObject(state.io_refs) ? state.io_refs : {};
      ensureArray(refs[section]).forEach(function (ref) {
        wanted.set(toText(ref.controller_uuid) + '#' + toIntOrNull(ref[idKey]), ref);
      });
    });
    ensureArray(session.config.rules).forEach(function (rule) {
      ensureArray(rule.when).concat(ensureArray(rule.until)).forEach(function (cond) {
        if (toIntOrNull(cond[idKey]) === null) return;
        wanted.set(toText(cond.controller_uuid) + '#' + toIntOrNull(cond[idKey]), cond);
      });
    });
    const have = new Set(ensureArray(session.config[section]).map(function (row) {
      return toText(row.controller_uuid) + '#' + toIntOrNull(row[idKey]);
    }));
    const additions = ensureArray(master[section]).filter(function (row) {
      const key = toText(row.controller_uuid) + '#' + toIntOrNull(row[idKey]);
      return wanted.has(key) && !have.has(key);
    }).map(function (row) {
      return section === 'sensors' ? createCrossSensor(row) : createCrossActuator(row);
    });
    session.config[section] = ensureArray(session.config[section]).concat(additions);
  });

  // Controller und Routen für alles Nachgezogene schließen.
  const usedUuids = new Set();
  ['sensors', 'actuators'].forEach(function (section) {
    ensureArray(session.config[section]).forEach(function (row) {
      usedUuids.add(toText(row.controller_uuid));
    });
  });
  const haveControllers = new Set(ensureArray(session.config.controllers).map(function (row) {
    return toText(row.controller_uuid);
  }));
  const newControllers = ensureArray(master.controllers).filter(function (row) {
    return usedUuids.has(toText(row.controller_uuid))
      && !haveControllers.has(toText(row.controller_uuid));
  }).map(function (row) {
    return createCrossController(row, { owner_node_id: owner });
  });
  if (newControllers.length) {
    session.config.controllers = ensureArray(session.config.controllers).concat(newControllers);
    rebuildRoutesQuiet();
  }
}

function rebuildRoutesQuiet() {
  const owner = toText(metaRow().owner_node_id);
  session.config.site_controller_map = ensureArray(session.config.controllers)
    .map(function (controller, index) {
      const existing = routeFor(controller.controller_uuid) || {};
      return createCrossRoute({
        local_controller_id: toIntOrNull(existing.local_controller_id)
          || toIntOrNull(controller.controller_id) || (index + 1),
        node_id: toText(existing.node_id) || toText(controller.owner_node_id) || owner,
        controller_uuid: toText(controller.controller_uuid),
        controller_key: toText(controller.controller_key),
        routing_role: 'owner',
        enabled: true
      });
    });
}

function openNewRuleDialog() {
  const owner = toText(metaRow().owner_node_id);
  const idField = input({ value: String(nextRuleId()), type: 'number' });
  const nameField = input({ value: '' });
  const groupField = select({
    items: ENUMS.rule_group.filter(function (name) {
      return CRITICAL_GROUPS.indexOf(name) < 0;
    }).map(function (name) { return { value: name, label: name }; }),
    value: 'process'
  });
  const priorityField = input({ value: '1000', type: 'number' });
  const descField = textarea({ value: '', rows: 2 });

  modal({
    title: 'Leere Cross-Regel anlegen',
    body: h('div.v9-form', null,
      h('p.v9-note', { text:
        'Bedingungen und Aktionen werden anschließend im Regel-JSON ergänzt. '
        + 'Priorität ≥ coordinator_min_priority sorgt dafür, dass der Coordinator '
        + 'die Regel gegenüber node-lokalen Regeln vorrangig ausführt.' }),
      field('rule_id', idField, { required: true }),
      field('name', nameField, { required: true }),
      field('group', groupField, { hint: 'Kritische Gruppen sind im Cross-Shard verboten.' }),
      field('priority', priorityField),
      field('description', descField)),
    submitLabel: 'Anlegen',
    onSubmit: function () {
      const name = toText(nameField.value);
      if (!name) { toast('name ist Pflicht.', 'danger'); return false; }
      session.config.rules = ensureArray(session.config.rules).concat([
        createCrossRule({
          rule_id: toIntOrNull(idField.value),
          name: name,
          group: toText(groupField.value),
          priority: toIntOrNull(priorityField.value),
          description: toText(descField.value),
          enabled: true
        }, { owner_node_id: owner })
      ]);
      touch();
      return true;
    }
  });
}

function nextRuleId() {
  const used = ensureArray(session.config.rules).map(function (row) {
    return toIntOrNull(row.rule_id) || 0;
  });
  return used.length ? Math.max.apply(null, used) + 1 : 1;
}

/* ------------------------------------------------------------- Vertrag */

function renderContract() {
  const node = card('Was der V8-Vertrag verlangt', { key: 'cross-contract', open: false });
  node.body.appendChild(definitionList([
    ['Version', String(CROSS_VERSION) + ' (meta.version)'],
    ['Scope', CROSS_PROFILE.scopes.join(' | ')],
    ['Pflicht in meta', 'owner_node_id, domain_id'],
    ['Muss leer sein', CROSS_PROFILE.mustBeEmpty.join(', ')],
    ['Verboten an Controllern', CROSS_PROFILE.forbiddenControllerFields.join(', ')],
    ['Verboten an I/O', CROSS_PROFILE.forbiddenIoFields.join(', ')],
    ['Verboten an Regeln', CROSS_PROFILE.optionalRuleFields.join(', ')],
    ['Erlaubte Regel-Scopes', CROSS_PROFILE.ruleScopes.join(', ')],
    ['Sektionsanzahl', String(SECTION_ORDER.length) + ' — nicht mehr, nicht weniger']
  ]));
  return node;
}

/* ----------------------------------------------------------- Zeilenhilfen */

function upsertRow(section, keyField, row, current) {
  const list = ensureArray(session.config[section]).slice();
  const marker = toText(current && current[keyField]);
  const position = marker
    ? list.findIndex(function (item) { return toText(item[keyField]) === marker; })
    : list.findIndex(function (item) {
      return toText(item[keyField]) === toText(row[keyField]);
    });
  if (position >= 0) list[position] = row; else list.push(row);
  session.config[section] = list;
  touch();
}

function removeRow(section, keyField, value) {
  session.config[section] = ensureArray(session.config[section]).filter(function (row) {
    return toText(row[keyField]) !== toText(value);
  });
  touch();
}

/* ------------------------------------------------------------ Laden/Export */

function openProjectDialog() {
  const master = store.getConfig();
  const owners = listCrossOwners(master);
  const ownerField = select({
    items: owners.map(function (name) { return { value: name, label: name }; }),
    value: owners[0] || ''
  });
  modal({
    title: 'Cross-Shard aus dem Master projizieren',
    body: h('div.v9-form', null,
      h('p.v9-note', { text:
        'Projiziert genau die Regeln, die das Cross-Gate bestehen, samt allem, '
        + 'worauf sie zeigen — physikalisch entkernt.' }),
      field('owner_node_id', ownerField, { required: true })),
    submitLabel: 'Projizieren',
    onSubmit: function () {
      const owner = toText(ownerField.value);
      if (!owner) return false;
      adopt(projectCrossShard(master, owner), 'Projektion aus dem Master (' + owner + ')');
      toast('Cross-Shard für ' + owner + ' projiziert.', 'ok');
      return true;
    }
  });
}

function openServerDialog() {
  const master = store.getConfig();
  const owners = master ? listCrossOwners(master) : [];
  const ownerField = input({ value: owners[0] || 'fn-01' });
  modal({
    title: 'Cross-Shard vom Server laden',
    body: h('div.v9-form', null,
      h('p.v9-note', { text: 'Ruft GET /api/v9/cross/<owner_node_id> ab.' }),
      field('owner_node_id', ownerField, { required: true })),
    submitLabel: 'Laden',
    onSubmit: function () {
      const owner = toText(ownerField.value);
      if (!owner) return false;
      fetch('/api/v9/cross/' + encodeURIComponent(owner) + '?format=text',
        { headers: { Accept: 'application/json' } })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.text();
        })
        .then(function (payload) {
          adopt(JSON.parse(payload), '/api/v9/cross/' + owner,
            collectFloatLiterals(payload));
          toast('Vom Server geladen.', 'ok');
        })
        .catch(function (error) {
          toast('Laden fehlgeschlagen: ' + error.message, 'danger', 6000);
        });
      return true;
    }
  });
}

function openImportDialog() {
  const picker = h('input', { type: 'file', accept: '.json,application/json' });
  picker.addEventListener('change', function () {
    const file = picker.files && picker.files[0];
    if (!file) return;
    file.text().then(function (payload) {
      const parsed = safeJsonParse(payload, null);
      if (!parsed) { toast('Datei ist kein gültiges JSON.', 'danger'); return; }
      if (!isCrossConfig(parsed)) {
        toast('Das ist kein V8-Cross-Shard (meta.version/scope prüfen).', 'danger', 6000);
        return;
      }
      adopt(parsed, file.name, collectFloatLiterals(payload));
      toast('"' + file.name + '" eingelesen.', 'ok');
    });
  });
  picker.click();
}

function openCreateDialog() {
  const ownerField = input({ value: 'fn-01' });
  modal({
    title: 'Leeren Cross-Shard anlegen',
    body: h('div.v9-form', null,
      h('p.v9-note', { text:
        'Erzeugt alle ' + SECTION_ORDER.length + ' Sektionen mit V8-Meta. Kataloge '
        + '(Typen, Templates, Profile) werden aus dem Master übernommen, sofern '
        + 'einer geladen ist — sonst bleiben sie leer.' }),
      field('owner_node_id', ownerField, { required: true })),
    submitLabel: 'Anlegen',
    onSubmit: function () {
      const owner = toText(ownerField.value);
      if (!owner) return false;
      const empty = stripPhysicalFields(createEmptyV9Config({ node_id: owner }));
      empty.meta = [createCrossMeta({ owner_node_id: owner })];
      empty.local_node = [];
      const master = store.getConfig();
      if (master) {
        ['modbus_functions', 'scaling_profiles', 'sensor_types', 'actuator_types',
          'process_modes', 'process_values', 'parameter_generic_templates',
          'schema_mappings', 'pid_configs', 'control_method_templates',
          'control_methods', 'timers', 'rule_engine'].forEach(function (section) {
          empty[section] = ensureArray(master[section]).slice();
        });
      }
      adopt(empty, 'neu angelegt (' + owner + ')');
      toast('Leerer Cross-Shard für ' + owner + ' angelegt.', 'ok');
      return true;
    }
  });
}

function shardFileName() {
  const owner = toText(metaRow().owner_node_id) || 'owner';
  return 'device_state_data_v8_cross_' + owner + '.json';
}

function previewShard() {
  modal({
    title: shardFileName(),
    body: h('pre.v9-json', { text: formatConfig(session.config,
      { floatHints: session.floatHints }) }),
    cancelLabel: 'Schließen'
  });
}

function performShardDownload() {
  const blob = new Blob([formatConfig(session.config, { floatHints: session.floatHints })],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: shardFileName() });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  session.dirty = false;
  render();
}

function downloadShard() {
  const report = session.report;
  if (!report || !report.errors.length) {
    performShardDownload();
    return;
  }
  showConfirmation(report.errors.length
    + ' Vertragsverstöße wurden gefunden. Den Shard trotzdem herunterladen?', {
    title: 'Ungültigen Cross-Shard exportieren',
    confirmLabel: 'Trotzdem herunterladen',
    destructive: true,
    detail: 'Der Export bleibt möglich, ist aber nicht für eine produktive Runtime-Freigabe geeignet.'
  }, performShardDownload);
}

/** Nur für Tests: liefert den aktuellen Sitzungszustand. */
export function getSession() {
  return { config: session.config, source: session.source, dirty: session.dirty,
    report: session.report };
}

/** Nur für Tests: setzt einen Shard direkt. */
export function setSession(config, source) {
  adopt(config, source || '(test)');
}
