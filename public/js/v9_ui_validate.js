/**
 * v9_ui_validate.js — Panel "Validierung & Rollout".
 *
 * Zeigt vor dem Rollout genau das, was der Worker beim Laden prüfen würde:
 *   * Kontraktverstöße (Typen, Enums, Referenzen, Ownership, Execution)
 *   * Scope-Klassifikation je State/Regel
 *   * Node-Shard-Vorschau (was landet auf welchem Worker?)
 *   * Rollout-Split: node_local (V9) und cross (V8) — disjunkt und vollständig
 *   * Migrationsprotokoll (was ging beim Legacy-Import verloren?)
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { SECTION_ORDER } from './v9_schema.js';
import * as store from './v9_store.js';
import { groupFindings, validateConfig, validateCrossShard } from './v9_validate.js';
import {
  classifyScopes, projectAllShards, listNodes, splitShards, crossEligibility
} from './v9_shard.js';
import {
  h, mount, card, table, button, badge, pill, toolbar, modal, toast,
  statusStrip, disclosure, definitionList
} from './v9_dom.js';
import { ensureArray, toText, toIntOrNull, pretty, shrinkText } from './shared_utils.js';

let host = null;

export function initValidatePanel(container) {
  host = container;
  store.on('config:changed', render);
  render();
}

function render() {
  if (!host) return;
  const config = store.getConfig();
  const report = store.getReport();
  if (!config) {
    mount(host, h('p.v9-empty', { text: 'Keine Konfiguration geladen.' }));
    return;
  }
  mount(host, [
    renderToolbar(config, report),
    renderFindings(report),
    renderScopes(config),
    renderShards(config),
    renderSplit(config),
    renderMigration(),
    renderSections(report)
  ]);
}

function renderToolbar(config, report) {
  const state = store.getState();
  return toolbar([
    statusStrip(report),
    state.dirty ? pill('ungespeicherte Aenderungen', 'warn') : pill('gespeichert', 'ok'),
    button('Erneut prüfen', { size: 'sm', variant: 'ghost', onClick: render }),
    button('Speichern', { size: 'sm', variant: 'primary', onClick: saveConfig }),
    button('Als JSON herunterladen', { size: 'sm', variant: 'ghost', onClick: downloadConfig }),
    button('Rückgängig', { size: 'sm', variant: 'ghost', disabled: !state.canUndo,
      onClick: function () { store.undo(); } }),
    button('Wiederholen', { size: 'sm', variant: 'ghost', disabled: !state.canRedo,
      onClick: function () { store.redo(); } })
  ]);
}

async function saveConfig() {
  try {
    const result = await store.save({});
    toast('Gespeichert. Fingerprint ' + shrinkText(toText(result.fingerprint), 18), 'ok', 5000);
  } catch (error) {
    modal({
      title: 'Speichern nicht möglich',
      body: h('div.v9-form', null,
        h('p', { text: error.message }),
        error.report ? h('pre.v9-json', { text: error.report.errors.slice(0, 20)
          .map(function (item) { return item.path + '  ' + item.code + '  ' + item.message; })
          .join('\n') }) : null),
      submitLabel: 'Trotzdem speichern',
      onSubmit: function () {
        store.save({ force: true }).then(function () {
          toast('Erzwungen gespeichert.', 'warn');
        }).catch(function (inner) {
          toast(inner.message, 'danger', 6000);
        });
        return true;
      }
    });
  }
}

function downloadConfig() {
  const url = URL.createObjectURL(store.toBlob());
  const link = h('a', { href: url, download: 'device_state_data_v9.json' });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/* ------------------------------------------------------------------ Befunde */

function renderFindings(report) {
  const node = card('Kontraktprüfung', {
    key: 'validation',
    meta: statusStrip(report)
  });
  if (!report) return node;

  if (!report.errors.length && !report.warnings.length) {
    node.body.appendChild(h('p.v9-note.v9-note--ok', { text:
      'Die Konfiguration erfüllt alle geprüften V9-Invarianten: Struktur, Enums, '
      + 'Eindeutigkeit, Routing/Ownership, Execution-Metadaten und Referenzintegrität.' }));
    return node;
  }

  const grouped = groupFindings(report);
  grouped.forEach(function (bucket, section) {
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

/* -------------------------------------------------------------------- Scopes */

function renderScopes(config) {
  const scopes = classifyScopes(config);
  const node = card('Scope-Klassifikation', {
    key: 'scopes',
    meta: pill('abgeleitet aus dem controller_uuid-Graphen', 'info')
  });

  const counts = {};
  scopes.rules.forEach(function (value) { counts[value] = (counts[value] || 0) + 1; });
  node.body.appendChild(h('div.v9-badges', null, Object.keys(counts).map(function (key) {
    return badge(key + ': ' + counts[key],
      key === 'local_controller' ? 'ok' : (key === 'invalid' ? 'danger' : 'warn'));
  })));

  node.body.appendChild(h('p.v9-note', { text:
    'Eine Regel mit genau einem berührten Controller läuft node-lokal. Berührt sie mehrere '
    + 'Controller desselben Nodes, ist sie cross_controller; verteilt sich das auf mehrere '
    + 'Nodes, ist sie cross_worker und braucht einen Coordinator. Kritische Regelgruppen '
    + 'dürfen niemals cross ausgeführt werden.' }));

  if (scopes.issues.length) {
    node.body.appendChild(table([
      { label: 'Art', render: function (row) {
        return badge(row.kind === 'error' ? 'Fehler' : 'Hinweis',
          row.kind === 'error' ? 'danger' : 'warn');
      } },
      { key: 'path', label: 'Objekt' },
      { key: 'message', label: 'Meldung' }
    ], scopes.issues, { emptyText: '—' }));
  }

  const ruleRows = ensureArray(config.rules).map(function (rule) {
    return {
      rule_id: toIntOrNull(rule.rule_id),
      name: toText(rule.name),
      group: toText(rule.group),
      scope: scopes.rules.get(toIntOrNull(rule.rule_id)) || 'unbound',
      deployment_status: toText(rule.deployment_status)
    };
  });
  node.body.appendChild(disclosure('Regeln im Detail', table([
    { key: 'rule_id', label: 'ID', align: 'right' },
    { key: 'name', label: 'Name' },
    { key: 'group', label: 'Gruppe' },
    { label: 'Scope', render: function (row) {
      return badge(row.scope, row.scope === 'local_controller' ? 'ok'
        : (row.scope === 'invalid' ? 'danger' : 'warn'));
    } },
    { key: 'deployment_status', label: 'deployment_status' }
  ], ruleRows, { emptyText: 'Keine Regeln' }), { open: false }));

  return node;
}

/* -------------------------------------------------------------------- Shards */

function renderShards(config) {
  const node = card('Node-Shard-Vorschau', {
    key: 'shards',
    meta: pill('was landet auf welchem Worker?', 'info')
  });

  const shards = projectAllShards(config);
  if (!shards.size) {
    node.body.appendChild(h('p.v9-note', { text: 'Keine Nodes definiert.' }));
    return node;
  }

  const rows = [];
  shards.forEach(function (shard, nodeId) {
    rows.push({
      node_id: nodeId,
      controllers: ensureArray(shard.controllers).length,
      sensors: ensureArray(shard.sensors).length,
      actuators: ensureArray(shard.actuators).length,
      processes: ensureArray(shard.processes).length,
      states: ensureArray(shard.process_states).length,
      rules: ensureArray(shard.rules).length,
      shard
    });
  });

  node.body.appendChild(table([
    { key: 'node_id', label: 'Node' },
    { key: 'controllers', label: 'Controller', align: 'right' },
    { key: 'sensors', label: 'Sensoren', align: 'right' },
    { key: 'actuators', label: 'Aktoren', align: 'right' },
    { key: 'processes', label: 'Prozesse', align: 'right' },
    { key: 'states', label: 'States', align: 'right' },
    { key: 'rules', label: 'Regeln', align: 'right' },
    { label: '', align: 'right', render: function (row) {
      return h('div.v9-row-actions', null,
        button('JSON ansehen', { size: 'sm', variant: 'ghost', onClick: function () {
          modal({ wide: true, title: 'Node-Shard ' + row.node_id,
            body: h('pre.v9-json', { text: store.formatJson(row.shard) }),
            cancelLabel: 'Schließen' });
        } }),
        button('Herunterladen', { size: 'sm', variant: 'ghost', onClick: function () {
          downloadJson(row.shard,
            'device_state_data_v9_node_' + row.node_id + '.json');
        } }));
    } }
  ], rows, { emptyText: 'Keine Shards' }));

  const total = { states: ensureArray(config.process_states).length,
    rules: ensureArray(config.rules).length };
  const covered = rows.reduce(function (acc, row) {
    return { states: acc.states + row.states, rules: acc.rules + row.rules };
  }, { states: 0, rules: 0 });
  if (covered.states < total.states || covered.rules < total.rules) {
    node.body.appendChild(h('p.v9-note.v9-note--warn', { text:
      'Nicht alle Objekte sind in einem Node-Shard enthalten: '
      + (total.states - covered.states) + ' State(s) und ' + (total.rules - covered.rules)
      + ' Regel(n) berühren mehrere Nodes und gehören damit in einen Cross-Shard (V8).' }));
  }

  return node;
}

/* ---------------------------------------------------------------- Migration */

function renderMigration() {
  const entries = store.getMigrationReport();
  const node = card('Migrationsprotokoll', {
    key: 'migration',
    meta: entries.length ? pill(entries.length + ' Einträge', 'info')
      : pill('keine Migration nötig', 'ok')
  });
  if (!entries.length) {
    node.body.appendChild(h('p.v9-note.v9-note--ok', { text:
      'Die geladene Konfiguration lag bereits im V9-Format vor.' }));
    return node;
  }
  const order = { error: 0, breaking: 1, repair: 2, info: 3 };
  const rows = entries.slice().sort(function (a, b) {
    return (order[a.kind] === undefined ? 9 : order[a.kind])
      - (order[b.kind] === undefined ? 9 : order[b.kind]);
  });
  node.body.appendChild(table([
    { label: 'Art', render: function (row) {
      const tone = row.kind === 'error' ? 'danger'
        : (row.kind === 'breaking' ? 'warn' : (row.kind === 'repair' ? 'info' : 'muted'));
      return badge(row.kind, tone);
    } },
    { key: 'section', label: 'Sektion' },
    { key: 'message', label: 'Meldung' }
  ], rows, { emptyText: '—' }));
  return node;
}

/* ----------------------------------------------------------------- Sektionen */

function renderSections(report) {
  const node = card('Sektionsübersicht', { key: 'sections' });
  const rows = SECTION_ORDER.map(function (section) {
    return { section, count: report && report.stats ? report.stats[section] : 0 };
  });
  node.body.appendChild(table([
    { key: 'section', label: 'Sektion' },
    { key: 'count', label: 'Einträge', align: 'right' },
    { label: 'Status', render: function (row) {
      return badge(row.count > 0 ? 'befüllt' : 'leer', row.count > 0 ? 'ok' : 'muted');
    } }
  ], rows, { emptyText: '—' }));
  node.body.appendChild(h('p.v9-note', { text:
    'Alle 26 Sektionen müssen vorhanden sein — decompose() lehnt sowohl fehlende als auch '
    + 'zusätzliche Sektionen hart ab ("missing/unsupported config sections").' }));
  return node;
}

/* =========================================================================
 * Rollout-Split: node_local (V9) + cross (V8)
 * ====================================================================== */

function renderSplit(config) {
  const split = splitShards(config);
  const scopes = split.scopes;

  const node = card('Rollout-Split (V9 lokal + V8 cross)', {
    key: 'split',
    meta: split.ok
      ? pill('disjunkt und vollständig', 'ok')
      : pill(split.errors.length + ' Konflikt(e)', 'danger'),
    actions: button('Alle Shards herunterladen', { size: 'sm', variant: 'ghost',
      onClick: function () { downloadAllShards(split); } })
  });

  node.body.appendChild(h('p.v9-note', { text:
    'Der Worker führt eine Regel entweder node-lokal (V9-Shard) oder cross über den '
    + 'Coordinator aus (V8-Shard) — niemals beides. validate_split_shards() verlangt, '
    + 'dass beide Mengen disjunkt sind und zusammen jede ausführbare Regel abdecken.' }));

  split.errors.forEach(function (item) {
    node.body.appendChild(h('p.v9-note.v9-note--danger', { text: item.message }));
  });
  split.warnings.forEach(function (item) {
    node.body.appendChild(h('p.v9-note.v9-note--warn', { text: item.message }));
  });

  const rows = [];
  split.local.forEach(function (shard, nodeId) {
    rows.push(shardRow('node_local (V9)', nodeId, shard, validateConfig(shard)));
  });
  split.cross.forEach(function (shard, owner) {
    rows.push(shardRow('cross (V8)', owner, shard,
      validateCrossShard(shard, { scopes })));
  });

  node.body.appendChild(table([
    { label: 'Art', render: function (row) {
      return badge(row.kind, row.kind.indexOf('cross') === 0 ? 'warn' : 'ok');
    } },
    { key: 'owner', label: 'Owner' },
    { key: 'version', label: 'Version', align: 'right' },
    { key: 'controllers', label: 'Controller', align: 'right' },
    { key: 'sensors', label: 'Sensoren', align: 'right' },
    { key: 'actuators', label: 'Aktoren', align: 'right' },
    { key: 'states', label: 'States', align: 'right' },
    { key: 'rules', label: 'Regeln', align: 'right' },
    { label: 'Kontrakt', render: function (row) {
      return badge(row.status === 'OK' ? 'gültig' : (row.errors + ' Fehler'),
        row.status === 'OK' ? 'ok' : 'danger');
    } },
    { label: '', align: 'right', render: function (row) {
      return h('div.v9-row-actions', null,
        button('JSON', { size: 'sm', variant: 'ghost', onClick: function () {
          modal({ wide: true, title: row.kind + ' · ' + row.owner,
            body: h('pre.v9-json', { text: store.formatJson(row.shard) }), cancelLabel: 'Schließen' });
        } }),
        button('Download', { size: 'sm', variant: 'ghost', onClick: function () {
          downloadJson(row.shard, row.filename);
        } }));
    } }
  ], rows, { emptyText: 'Keine Shards' }));

  node.body.appendChild(renderEligibility(config, scopes));
  return node;
}

function shardRow(kind, owner, shard, report) {
  const meta = ensureArray(shard.meta)[0] || {};
  const isCross = kind.indexOf('cross') === 0;
  return {
    kind,
    owner,
    version: toIntOrNull(meta.version),
    controllers: ensureArray(shard.controllers).length,
    sensors: ensureArray(shard.sensors).length,
    actuators: ensureArray(shard.actuators).length,
    states: ensureArray(shard.process_states).length,
    rules: ensureArray(shard.rules).length,
    status: report.status,
    errors: report.errors.length,
    shard,
    filename: isCross
      ? 'device_state_data_v8_cross_' + owner + '.json'
      : 'device_state_data_v9_node_' + owner + '.json'
  };
}

function renderEligibility(config, scopes) {
  const rows = ensureArray(config.rules).map(function (rule) {
    const eligibility = crossEligibility(config, rule, scopes);
    return {
      rule_id: toIntOrNull(rule.rule_id),
      name: toText(rule.name),
      scope: eligibility.scope,
      ok: eligibility.ok,
      reasons: eligibility.reasons.join('; ') || '—',
      targets: eligibility.mutated_state_ids.join(', ') || '—'
    };
  });

  return disclosure('Cross-Eignung je Regel (cross_rule_eligibility)', [
    h('p.v9-note', { text:
      'Eine cross-scoped Regel darf nur dann im V8-Shard laufen, wenn sie ausschließlich '
      + 'cross-eigene States schreibt. Andernfalls gehört sie in den node_local-Shard ihres '
      + 'Owners und liest die entfernten Signale über '
      + 'rule_engine.runtime.remote_signal_refs = "allowed_by_controller_uuid" — das ist '
      + 'kein Fehler, sondern die vorgesehene Aufteilung.' }),
    table([
      { key: 'rule_id', label: 'ID', align: 'right' },
      { key: 'name', label: 'Name' },
      { label: 'Graph-Scope', render: function (row) {
        return badge(row.scope, row.scope === 'local_controller' ? 'ok'
          : (row.scope === 'invalid' ? 'danger' : 'warn'));
      } },
      { key: 'targets', label: 'schreibt States' },
      { label: 'Ziel-Shard', render: function (row) {
        return badge(row.ok ? 'cross (V8)' : 'node_local (V9)', row.ok ? 'warn' : 'ok');
      } },
      { key: 'reasons', label: 'Begründung' }
    ], rows, { emptyText: 'Keine Regeln' })
  ], { open: false });
}

function downloadJson(payload, filename) {
  const url = URL.createObjectURL(store.toBlob(payload));
  const link = h('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function downloadAllShards(split) {
  let index = 0;
  split.local.forEach(function (shard, nodeId) {
    setTimeout(function () {
      downloadJson(shard, 'device_state_data_v9_node_' + nodeId + '.json');
    }, index * 250);
    index += 1;
  });
  split.cross.forEach(function (shard, owner) {
    setTimeout(function () {
      downloadJson(shard, 'device_state_data_v8_cross_' + owner + '.json');
    }, index * 250);
    index += 1;
  });
  toast(index + ' Shard-Datei(en) werden heruntergeladen.', 'ok');
}
