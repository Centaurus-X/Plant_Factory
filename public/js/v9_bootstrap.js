/**
 * v9_bootstrap.js — Verdrahtung der V9-Schicht mit der Bestands-App.
 *
 * Minimal-invasives Prinzip: die V50-Module bleiben unangetastet. Der Bootstrap
 *   1. lädt die Config genau einmal über den Store,
 *   2. schiebt die Editor-Projektion in den bestehenden AppState
 *      (`state.deviceConfig`), sodass device.js/processes.js/hmi.js/
 *      rules_generator.js/automation_tabs.js unverändert weiterlaufen,
 *   3. montiert die neuen V9-Panels in die zusätzlichen Tabs,
 *   4. hält beide Welten synchron.
 *
 * Reihenfolge ist wichtig: der Bootstrap läuft VOR den Altmodulen, damit deren
 * eigene `api.getDeviceConfig()`-Aufrufe bereits einen befüllten State finden.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { state, showStatus } from './core.js';
import * as store from './v9_store.js';
import * as shard from './v9_shard.js';
import { validateConfig, validateCrossShard } from './v9_validate.js';
import { initTopologyPanel } from './v9_ui_topology.js';
import { initStatesPanel } from './v9_ui_states.js';
import { initRulesPanel } from './v9_ui_rules.js';
import * as cross from './v9_ui_cross.js';
import * as snapshot from './hmi_snapshot.js';
import { ANIMATION_CSS } from './hmi_animation.js';
import { initCrossPanel } from './v9_ui_cross.js';
import { initValidatePanel } from './v9_ui_validate.js';
import { initAutomationPanel, automationDebugApi } from './v9_ui_automation.js';
import { h, mount, toast } from './v9_dom.js';
import { formatConfig, formatConfigText, collectFloatLiterals } from './v9_json_format.js';
import { byId, toText } from './shared_utils.js';

const PANELS = [
  { id: 'v9-automation-panel', init: initAutomationPanel },
  { id: 'v9-topology-panel', init: initTopologyPanel },
  { id: 'v9-states-panel', init: initStatesPanel },
  { id: 'v9-rules-panel', init: initRulesPanel },
  { id: 'v9-cross-panel', init: initCrossPanel },
  { id: 'v9-validate-panel', init: initValidatePanel }
];

let bridging = false;

/**
 * Legt die Zustands- und Animations-CSS in den Editor.
 *
 * Bis V54.2 lebte sie ausschließlich im exportierten Bundle. Der Editor zeigte
 * damit eine ANDERE Darstellung als das Ergebnis: wer im Designer eine
 * Alarmfarbe vergab, sah sie erst nach dem Export. Eine Vorschau, die nicht
 * zeigt, was herauskommt, ist keine Vorschau.
 */
function installAnimationStyles() {
  if (document.getElementById('v9-animation-styles')) return;
  const style = document.createElement('style');
  style.id = 'v9-animation-styles';
  style.textContent = ANIMATION_CSS;
  document.head.appendChild(style);
}

/** Spiegelt die Editor-Projektion in den AppState der Bestands-App. */
function bridgeToLegacyState() {
  if (bridging) return;
  bridging = true;
  try {
    const projection = store.getProjection();
    if (projection) state.setSilent('deviceConfig', projection);
  } finally {
    bridging = false;
  }
}

/** Aktualisiert das Statusabzeichen im Tab-Kopf. */
function refreshBadge() {
  const badge = byId('v9-tab-badge');
  if (!badge) return;
  const report = store.getReport();
  const errors = report ? report.errors.length : 0;
  const warnings = report ? report.warnings.length : 0;
  badge.textContent = errors ? String(errors) : (warnings ? String(warnings) : '✓');
  badge.className = 'v9-tab-badge v9-tab-badge--'
    + (errors ? 'danger' : (warnings ? 'warn' : 'ok'));
  badge.title = errors + ' Fehler, ' + warnings + ' Hinweise';
}

/** Warnt vor dem Verlassen der Seite bei ungespeicherten Config-Aenderungen. */
function installUnloadGuard() {
  window.addEventListener('beforeunload', function (event) {
    if (!store.getState().dirty) return undefined;
    event.preventDefault();
    event.returnValue = '';
    return '';
  });
}

/** Tastaturkürzel für die Config-Historie. */
function installShortcuts() {
  document.addEventListener('keydown', function (event) {
    if (!(event.ctrlKey || event.metaKey) || !event.altKey) return;
    const key = String(event.key || '').toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      store.undo();
      toast('Config-Aenderung rückgängig gemacht.', 'info', 1800);
    } else if (key === 'y') {
      event.preventDefault();
      store.redo();
      toast('Config-Aenderung wiederhergestellt.', 'info', 1800);
    } else if (key === 's') {
      event.preventDefault();
      store.save({}).then(function () {
        toast('Config gespeichert.', 'ok');
      }).catch(function (error) {
        toast(error.message, 'danger', 6000);
      });
    }
  });
}

export async function initV9() {
  installAnimationStyles();
  PANELS.forEach(function (panel) {
    const container = byId(panel.id);
    if (container) {
      mount(container, h('p.v9-empty', { text: 'Konfiguration wird geladen …' }));
    }
  });

  store.on('config:changed', function () {
    bridgeToLegacyState();
    refreshBadge();
  });
  store.on('config:saved', refreshBadge);

  try {
    await store.load({});
  } catch (error) {
    console.error('[v9_bootstrap] Laden fehlgeschlagen:', error);
    showStatus('V9-Konfiguration konnte nicht geladen werden: ' + error.message, 'error', 6000);
  }

  bridgeToLegacyState();

  PANELS.forEach(function (panel) {
    const container = byId(panel.id);
    if (!container) return;
    try {
      panel.init(container);
    } catch (error) {
      console.error('[v9_bootstrap] Panel "' + panel.id + '" fehlgeschlagen:', error);
      mount(container, h('p.v9-empty', { text: 'Panel konnte nicht aufgebaut werden: '
        + error.message }));
    }
  });

  refreshBadge();
  installUnloadGuard();
  installShortcuts();

  const report = store.getReport();
  const source = toText(store.getState().source);
  if (report && report.status !== 'OK') {
    showStatus('V9-Config geladen (' + source + ') — ' + report.errors.length
      + ' Kontraktfehler, siehe Tab "Validierung".', 'warning', 7000);
  } else {
    showStatus('V9-Config geladen (' + source + ').', 'success', 3500);
  }

  // Für Konsole und Smoke-Tests erreichbar machen.
  window.__v9 = {
    store,
    shard,
    getConfig: store.getConfig,
    getReport: store.getReport,
    getProjection: store.getProjection,
    validateConfig,
    validateCrossShard,
    splitShards: shard.splitShards,
    projectCrossShard: shard.projectCrossShard,
    crossEligibility: shard.crossEligibility,
    cross,
    getSourceText: store.getSourceText,
    getFingerprint: store.getFingerprint,
    snapshot,
    formatConfig,
    formatConfigText,
    collectFloatLiterals,
    automation: automationDebugApi()
  };
}

initV9();
