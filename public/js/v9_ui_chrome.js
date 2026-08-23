/**
 * v9_ui_chrome.js — Status- und Canvas-Integration V60.1
 *
 * Kompatible Status- und Canvas-Helfer für den Engineering Workspace:
 *
 *   1. NAVIGATION IN ZWEI EBENEN
 *      Zwoelf gleichrangige Tabs lagen in einer Reihe, die je nach
 *      Fensterbreite auf zwei bis drei Zeilen umbrach — Schaltflaechen
 *      wanderten unter dem Zeiger weg. Hier bekommen sie eine Gruppe
 *      (data-group im Markup) und werden ausgeblendet, wenn ihre Gruppe nicht
 *      aktiv ist. Der Tab-Controller in ui.js bleibt unangetastet: er sieht
 *      dieselben Schaltflaechen mit denselben data-tab-Werten.
 *
 *   2. STATUSLEISTE MIT STATUS
 *      "0 Elemente | 0 Verbindungen · Bereit · X: 0, Y: 0" — waehrend der
 *      Store Fingerprint, Herkunft, Dirty-Zustand und Fehlerzahl kannte.
 *      Diese Datei verbindet beides.
 *
 *   3. LINEALE
 *      Die Streifen selbst sind CSS-Verlaufsmuster (layout.css). Hier wandert
 *      nur die Zeigermarke — ein Transform je Bewegung, gedrosselt auf einen
 *      Frame.
 *
 *   4. AUSWAHL-CHIP
 *      Was ist gewaehlt und woran haengt es. Bis V54.2 musste man dafuer in
 *      den Eigenschaften-Tab wechseln.
 *
 * Diese Datei erzeugt nichts, worauf andere Module warten. Sie darf als
 * letzte geladen werden und faellt still aus, wenn ein Element fehlt.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { state } from './core.js';
import * as store from './v9_store.js';
import { byId, ensureArray, toText } from './shared_utils.js';

const GROUPS = {
  zeichnung: 'Zeichnung',
  automation: 'Automatisierung',
  rollout: 'Rollout'
};

const TAB_LABELS = {
  elements: 'Elements',
  connections: 'Connections',
  device: 'Device',
  hmi: 'HMI',
  'v9-automation': 'Automation Studio',
  processes: 'Processes',
  rules: 'Projektregeln',
  'v9-states': 'Runtime-States V9',
  'v9-rules': 'Runtime-Regeln V9',
  'v9-validate': 'Validierung',
  'v9-topology': 'Topologie',
  'v9-cross': 'Cross V8',
  export: 'Export'
};

const STORAGE_GROUP = 'v9.ui.group';

/* =========================================================================
 * 1 — Navigation in zwei Ebenen
 * ====================================================================== */

function initGroupNav() {
  const bar = document.querySelector('.v9-groupbar');
  const list = document.querySelector('#right-tabs .tab-list');
  if (!bar || !list) return;

  const groupButtons = Array.prototype.slice.call(bar.querySelectorAll('[data-group]'));
  const tabs = Array.prototype.slice.call(list.querySelectorAll('.tab[data-group]'));
  const crumb = byId('right-breadcrumb');

  function activeTab() {
    return tabs.filter(function (tab) { return tab.classList.contains('active'); })[0] || null;
  }

  function updateCrumb() {
    if (!crumb) return;
    const tab = activeTab();
    const group = tab ? tab.dataset.group : 'zeichnung';
    const label = tab ? (TAB_LABELS[tab.dataset.tab] || tab.textContent.trim()) : '';
    crumb.textContent = (GROUPS[group] || '') + (label ? ' / ' + label : '');
  }

  function showGroup(group, options) {
    const opts = options || {};
    groupButtons.forEach(function (button) {
      button.setAttribute('aria-selected', button.dataset.group === group ? 'true' : 'false');
    });
    tabs.forEach(function (tab) {
      tab.hidden = tab.dataset.group !== group;
    });

    // Liegt der aktive Tab in einer anderen Gruppe, den ersten dieser Gruppe
    // oeffnen — sonst zeigte das Panel Inhalte, die zu keinem sichtbaren Tab
    // gehoeren.
    const current = activeTab();
    if (!opts.keepActive && (!current || current.dataset.group !== group)) {
      const first = tabs.filter(function (tab) { return tab.dataset.group === group; })[0];
      if (first) first.click();
    }

    try { localStorage.setItem(STORAGE_GROUP, group); } catch (error) { /* kein Drama */ }
    updateCrumb();
    revealActiveTab();
  }

  /**
   * Ist die Tabzeile schmaler als ihr Inhalt, rollt sie waagerecht. Dann muss
   * der aktive Tab sichtbar sein — sonst wirkt die Gruppe leer oder falsch.
   * Bewusst ueber scrollLeft statt scrollIntoView: letzteres verschiebt auch
   * die Vorfahren und laesst das Panel springen.
   */
  function revealActiveTab() {
    const list = document.querySelector('#right-tabs .tab-list');
    const tab = activeTab();
    if (!list || !tab) return;
    if (list.scrollWidth <= list.clientWidth) { list.scrollLeft = 0; return; }
    const left = tab.offsetLeft - list.offsetLeft;
    const right = left + tab.offsetWidth;
    const pad = 12;
    if (left - pad < list.scrollLeft) {
      list.scrollLeft = Math.max(0, left - pad);
    } else if (right + pad > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = right + pad - list.clientWidth;
    }
  }

  groupButtons.forEach(function (button) {
    button.addEventListener('click', function () { showGroup(button.dataset.group); });
  });

  // Wird ein Tab von aussen aktiviert (ui.js, Tastatur, Verweis aus einem
  // Panel), zieht die Gruppe nach.
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (tab.dataset.group) showGroup(tab.dataset.group, { keepActive: true });
      else revealActiveTab();
    });
  });

  let start = 'zeichnung';
  try {
    const stored = localStorage.getItem(STORAGE_GROUP);
    if (stored && GROUPS[stored]) start = stored;
  } catch (error) { /* kein Drama */ }

  const current = activeTab();
  showGroup(start, { keepActive: Boolean(current && current.dataset.group === start) });
}

/* =========================================================================
 * 2 — Statusleiste
 * ====================================================================== */

function setField(node, tone, text) {
  if (!node) return;
  node.className = 'status-field' + (tone ? ' status-field--' + tone : '');
  const dot = node.querySelector('.status-field__dot');
  const label = node.querySelector('span:last-child');
  if (label && label !== dot) label.textContent = text;
  else node.textContent = text;
}

function shortFingerprint(value) {
  const text = toText(value);
  return text ? text.slice(0, 8) : '—';
}

function activeNodeLabel(config) {
  if (!config) return '—';
  const local = ensureArray(config.local_node)[0];
  if (local && (local.node_id || local.site_id)) {
    return [toText(local.site_id), toText(local.node_id)].filter(Boolean).join(' · ');
  }
  const site = ensureArray(config.sites)[0];
  const node = ensureArray(config.nodes)[0];
  const parts = [toText(site && site.site_id), toText(node && node.node_id)].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function countBindings(config) {
  if (!config) return 0;
  return ensureArray(config.sensors).length + ensureArray(config.actuators).length;
}

function refreshStatus() {
  const report = store.getReport();
  const storeState = store.getState();
  const config = store.getConfig();

  const errors = report ? report.errors.length : 0;
  const warnings = report ? report.warnings.length : 0;
  const tone = errors ? 'danger' : (warnings ? 'warn' : 'ok');
  const text = !report
    ? 'keine Konfiguration'
    : (errors
      ? errors + ' Kontraktfehler'
      : (warnings ? 'gültig · ' + warnings + ' Hinweise' : 'Vertrag gültig'));

  // Statusleiste unten
  const contract = byId('status-contract');
  if (contract) {
    contract.className = 'status-field status-field--' + tone;
    const label = byId('status-contract-text');
    if (label) label.textContent = text;
  }

  const fp = byId('status-fingerprint');
  if (fp) {
    fp.textContent = storeState.dirty
      ? 'fp — (ungespeichert)'
      : 'fp ' + shortFingerprint(store.getFingerprint());
  }

  const nodeField = byId('status-node');
  if (nodeField) nodeField.textContent = activeNodeLabel(config);

  const bindings = byId('binding-count');
  if (bindings) bindings.textContent = countBindings(config) + ' gebunden';

  // Abzeichen in der Werkzeugleiste
  const chip = byId('contract-chip');
  const chipBadge = byId('contract-chip-badge');
  const chipText = byId('contract-chip-text');
  if (chip) chip.className = 'v9-status v9-status--' + tone;
  if (chipBadge) {
    chipBadge.className = 'v9-badge v9-badge--' + tone;
    chipBadge.textContent = errors ? 'FEHLER' : (warnings ? 'HINWEISE' : 'GÜLTIG');
  }
  if (chipText) {
    chipText.textContent = errors + ' Fehler · ' + warnings + ' Hinweise';
  }
  // V58.1: Die Konfigurationsquelle ist Diagnose-Detail, kein Dauertext.
  // Sie wandert in den Tooltip, damit der Kopf ruhig und lesbar bleibt.
  if (chip) {
    chip.title = storeState.source
      ? 'Zustand der V9-Konfiguration · Quelle: ' + toText(storeState.source)
      : 'Zustand der V9-Konfiguration';
  }

  const fpChip = byId('fingerprint-chip');
  if (fpChip) {
    fpChip.textContent = storeState.dirty
      ? 'ungespeichert'
      : 'fp ' + shortFingerprint(store.getFingerprint());
    fpChip.title = toText(store.getFingerprint()) || 'kein Fingerprint';
  }

  // Kontextfeld in der Kopfleiste
  const ctxText = byId('node-context-text');
  const ctxDot = byId('node-context-dot');
  if (ctxText) ctxText.textContent = activeNodeLabel(config);
  if (ctxDot) {
    ctxDot.className = 'v9-context__dot'
      + (errors ? ' v9-context__dot--danger' : (warnings ? ' v9-context__dot--warn' : ''));
  }
}

function initStatusBar() {
  store.on('config:changed', refreshStatus);
  store.on('config:saved', refreshStatus);
  refreshStatus();

  // Ungespeicherte Projektaenderung am Namen zeigen, nicht in einer Meldung,
  // die nach drei Sekunden verschwindet.
  const header = document.getElementById('app-header');
  if (header && state && typeof state.subscribe === 'function') {
    state.subscribe('isDirty', function (dirty) {
      header.classList.toggle('is-dirty', Boolean(dirty));
    });
  }
}

/* =========================================================================
 * 3 — Lineale
 * ====================================================================== */

function initRulers() {
  const container = byId('canvas-container');
  const hCursor = byId('ruler-h-cursor');
  const vCursor = byId('ruler-v-cursor');
  if (!container || !hCursor || !vCursor) return;

  let pending = 0;
  let lastX = 0;
  let lastY = 0;

  function paint() {
    pending = 0;
    hCursor.style.transform = 'translateX(' + lastX + 'px)';
    vCursor.style.transform = 'translateY(' + lastY + 'px)';
  }

  container.addEventListener('mousemove', function (event) {
    const box = container.getBoundingClientRect();
    lastX = event.clientX - box.left;
    lastY = event.clientY - box.top;
    if (pending) return;
    pending = requestAnimationFrame(paint);
  }, { passive: true });

  // Das Blattmass mitfuehren: die Rasterweite ist fest, die sichtbare
  // Ausdehnung haengt am Zoom.
  const note = byId('canvas-note');
  if (note && state && typeof state.subscribe === 'function') {
    state.subscribe('zoom', function (zoom) {
      const factor = Number(zoom) || 1;
      note.textContent = '2000 × 2000 px · Raster 20 · '
        + Math.round(factor * 100) + ' %';
    });
  }
}

/* =========================================================================
 * 4 — Auswahl-Chip
 * ====================================================================== */

function initSelectionChip() {
  const chip = byId('canvas-selection-chip');
  const nameNode = byId('canvas-selection-name');
  const metaNode = byId('canvas-selection-meta');
  const container = byId('canvas-container');
  if (!chip || !nameNode || !metaNode || !container || !state) return;

  function bindingFor(elementId) {
    const devices = state.get('devices') || {};
    const assignments = devices.assignments || {};
    const entry = assignments[elementId];
    if (!entry) return '';
    const kind = toText(entry.kind || entry.type || entry.role).toLowerCase();
    const id = entry.sensor_id != null ? entry.sensor_id
      : (entry.actuator_id != null ? entry.actuator_id : entry.state_id);
    if (!kind || id == null) return '';
    const labels = {
      actuator: 'Aktor',
      sensor: 'Sensor',
      state: 'State'
    };
    const label = labels[kind] || kind;
    const controller = entry.controller_id != null
      ? ' · C' + toText(entry.controller_id)
      : '';
    return label + ' ' + toText(id) + controller;
  }

  function hide() { chip.removeAttribute('data-visible'); }

  function place(node, elementId) {
    let box;
    try {
      box = node.getBoundingClientRect();
    } catch (error) {
      hide();
      return;
    }
    const host = container.getBoundingClientRect();
    if (!box.width && !box.height) { hide(); return; }

    const data = (state.get('elements') || []).filter(function (item) {
      return toText(item.id) === toText(elementId);
    })[0] || {};

    nameNode.textContent = toText(data.name || data.template || elementId);
    const binding = bindingFor(elementId);
    metaNode.textContent = binding || 'nicht gebunden';

    const preferredLeft = Math.max(4, box.left - host.left);
    chip.style.left = '4px';
    chip.style.top = Math.max(4, box.top - host.top - 24) + 'px';
    chip.setAttribute('data-visible', '1');
    const chipWidth = chip.getBoundingClientRect().width;
    const maximumLeft = Math.max(4, host.width - chipWidth - 4);
    chip.style.left = Math.min(preferredLeft, maximumLeft) + 'px';
  }

  function update() {
    const selected = state.get('selectedElements') || [];
    if (selected.length !== 1) { hide(); return; }
    const id = selected[0];
    let node = null;
    try {
      node = container.querySelector('[data-element-id="' + CSS.escape(String(id)) + '"]')
        || container.querySelector('#' + CSS.escape(String(id)));
    } catch (error) {
      node = null;
    }
    if (!node) { hide(); return; }
    place(node, id);
  }

  state.subscribe('selectedElements', update);
  state.subscribe('zoom', update);
  state.subscribe('pan', update);
  state.subscribe('elements', update);
  window.addEventListener('resize', update);
}

/* =========================================================================
 * Start
 * ====================================================================== */

function boot() {
  const steps = [
    ['Statusleiste', initStatusBar],
    ['Lineale', initRulers],
    ['Auswahl-Chip', initSelectionChip]
  ];
  steps.forEach(function (entry) {
    try {
      entry[1]();
    } catch (error) {
      console.warn('[v9_ui_chrome] ' + entry[0] + ' nicht aufgebaut:', error);
    }
  });
  console.log('✓ Status- und Canvas-Integration V60.1 aktiv');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
