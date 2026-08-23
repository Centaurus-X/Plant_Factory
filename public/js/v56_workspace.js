/**
 * v56_workspace.js — Product shell and routing contract for V60.1.
 *
 * Der Dateiname bleibt aus Kompatibilitaetsgruenden v56_workspace.js:
 * Testinvarianten und Dokumentation referenzieren ihn als Vertragspfad.
 *
 * The legacy tab controller remains the single source of truth for panel
 * activation. This module only projects those existing routes into the new
 * engineering workspace, global work areas, and contextual inspector.
 *
 * Style: functional composition, no classes and no arrow functions.
 */

'use strict';

import { state } from './core.js';
import * as store from './v9_store.js';

const GLOBAL_TABS = [
  'v9-automation',
  'processes',
  'rules',
  'v9-states',
  'v9-rules',
  'v9-topology',
  'v9-cross',
  'v9-validate',
  'export'
];

const INSPECTOR_TABS = ['elements', 'device', 'hmi', 'connections'];

const WORKSPACE_TABS = {
  engineering: ['elements', 'device', 'connections'],
  runtime: ['hmi'],
  automation: ['v9-automation', 'processes', 'rules', 'v9-states', 'v9-rules'],
  topology: ['v9-topology', 'v9-cross', 'v9-validate', 'export'],
  validation: ['v9-topology', 'v9-cross', 'v9-validate', 'export']
};

/** Legacy automation routes remain addressable but are hidden from the primary subnavigation. */
const LEGACY_HIDDEN_TABS = ['processes', 'rules', 'v9-states', 'v9-rules'];

const TAB_META = {
  'v9-automation': {
    workspace: 'automation',
    eyebrow: 'Automatisierung · V9',
    title: 'Automation Studio',
    subtitle: 'Prozesse, States, Regeln, Filter, Timer und Bibliothek auf der kanonischen V9-Konfiguration.'
  },
  processes: {
    workspace: 'automation',
    eyebrow: 'Automatisierung',
    title: 'Prozesse',
    subtitle: 'Prozesszustände, Bibliotheken und Ablaufmodelle zentral bearbeiten.'
  },
  rules: {
    workspace: 'automation',
    eyebrow: 'Automatisierung',
    title: 'Regelgenerator',
    subtitle: 'Dynamische Regeln, Bedingungen, Aktionen und Übergänge konfigurieren.'
  },
  'v9-states': {
    workspace: 'automation',
    eyebrow: 'Automatisierung · V9',
    title: 'Zustandsmodelle',
    subtitle: 'Kanonische Zustände und Parameterzuordnungen im V9-Vertrag pflegen.'
  },
  'v9-rules': {
    workspace: 'automation',
    eyebrow: 'Automatisierung · V9',
    title: 'Runtime-Regeln',
    subtitle: 'V9-Regelverträge mit Filtern, Triggern und Aktionen verwalten.'
  },
  'v9-topology': {
    workspace: 'topology',
    eyebrow: 'Topologie & Rollout',
    title: 'Anlagentopologie',
    subtitle: 'Standorte, Nodes, Controller und lokale Shards strukturiert zuordnen.'
  },
  'v9-cross': {
    workspace: 'topology',
    eyebrow: 'Topologie & Rollout',
    title: 'Cross-Node V8',
    subtitle: 'Node-übergreifende V8-Verträge und Kommunikationspfade bearbeiten.'
  },
  'v9-validate': {
    workspace: 'validation',
    eyebrow: 'Qualitätssicherung',
    title: 'Validierung',
    subtitle: 'Kontraktfehler, Hinweise und referenzielle Integrität gezielt prüfen.'
  },
  export: {
    workspace: 'topology',
    eyebrow: 'Auslieferung',
    title: 'SCADA-Export',
    subtitle: 'Runtime-Bundle, Signalvorlage und Recovery-Snapshot gemeinsam erzeugen.'
  }
};

let activeTabName = 'elements';
let activeInspectorView = 'elements';
let suppressChipRebuild = false;

function byId(id) {
  return document.getElementById(id);
}

function toText(value) {
  return value == null ? '' : String(value).trim();
}

function includes(list, value) {
  return list.indexOf(value) !== -1;
}

function tabButton(name) {
  return byId('tab-btn-' + name);
}

function tabPanel(name) {
  return byId('tab-' + name);
}

function isGlobalTab(name) {
  return includes(GLOBAL_TABS, name);
}

function workspaceForTab(name) {
  if (name === 'logic') return 'logic';
  if (name === 'plant-drawing') return 'drawing';
  if (name === 'hmi') return 'runtime';
  if (includes(WORKSPACE_TABS.automation, name)) return 'automation';
  if (name === 'v9-validate') return 'validation';
  if (includes(WORKSPACE_TABS.topology, name)) return 'topology';
  return 'engineering';
}

function dispatchChange(node) {
  if (!node) return;
  node.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickExistingTab(name) {
  const button = tabButton(name);
  if (!button) {
    console.warn('[v56_workspace] Route nicht gefunden:', name);
    return false;
  }
  button.click();
  return true;
}

function moveGlobalPanels() {
  const host = byId('global-tab-panels');
  if (!host) return;

  GLOBAL_TABS.forEach(function (name) {
    const panel = tabPanel(name);
    if (panel && panel.parentElement !== host) host.appendChild(panel);
  });
}

function updateRail(workspace) {
  const buttons = document.querySelectorAll('#workspace-rail .workspace-nav-button[data-workspace]');
  buttons.forEach(function (button) {
    const active = button.dataset.workspace === workspace;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function updateSubnavigation(name, workspace) {
  const nav = byId('global-workspace-nav');
  if (!nav) return;

  const allowed = WORKSPACE_TABS[workspace] || WORKSPACE_TABS.topology;
  nav.querySelectorAll('button[data-target-tab]').forEach(function (button) {
    const target = button.dataset.targetTab;
    const visible = includes(allowed, target)
      && !(includes(LEGACY_HIDDEN_TABS, target) && target !== name);
    button.hidden = !visible;
    button.classList.toggle('active', target === name);
    button.setAttribute('aria-current', target === name ? 'page' : 'false');
  });
}

function updateGlobalHeading(name) {
  const meta = TAB_META[name] || TAB_META.processes;
  const eyebrow = byId('global-workspace-eyebrow');
  const title = byId('global-workspace-title');
  const subtitle = byId('global-workspace-subtitle');

  if (eyebrow) eyebrow.textContent = meta.eyebrow;
  if (title) title.textContent = meta.title;
  if (subtitle) subtitle.textContent = meta.subtitle;
}

function inspectorLabel(view) {
  const labels = {
    elements: 'Eigenschaften',
    device: 'Geräte- und I/O-Bindings',
    hmi: 'HMI-Konfiguration',
    connections: 'Verbindungen',
    layers: 'Ebenen'
  };
  return labels[view] || 'Inspektor';
}

function updateInspectorNavigation(view) {
  const next = view || 'elements';
  activeInspectorView = next;
  document.body.dataset.inspectorView = next;

  document.querySelectorAll('.inspector-nav-button[data-inspector-view]').forEach(function (button) {
    const active = button.dataset.inspectorView === next;
    button.classList.toggle('active', active);
    if (button.getAttribute('role') === 'tab') {
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    } else {
      button.setAttribute('aria-current', active ? 'page' : 'false');
    }
  });

  refreshSelectionContext();
}

function activateWorkspaceForTab(name) {
  const workspace = workspaceForTab(name);
  const global = isGlobalTab(name);
  activeTabName = name;

  document.body.dataset.workspace = workspace;
  document.body.dataset.workspaceKind = workspace === 'logic'
    ? 'logic' : (workspace === 'drawing' ? 'drawing' : (global ? 'global' : 'canvas'));
  const logicWorkspace = byId('logic-workspace');
  if (logicWorkspace) logicWorkspace.hidden = workspace !== 'logic';
  const drawingWorkspace = byId('plant-drawing-workspace');
  if (drawingWorkspace) drawingWorkspace.hidden = workspace !== 'drawing';
  updateRail(workspace);

  if (global) {
    updateGlobalHeading(name);
    updateSubnavigation(name, workspace);
  } else if (includes(INSPECTOR_TABS, name)) {
    updateInspectorNavigation(name);
  }

  const canvasMode = document.querySelector('.canvas-mode-label strong');
  if (canvasMode) {
    canvasMode.textContent = workspace === 'runtime'
      ? 'HMI / Runtime' : (workspace === 'drawing' ? 'Anlagen-Zeichnen' : 'Engineering');
  }

  document.dispatchEvent(new CustomEvent('plant:workspace-activated', {
    detail: { tab: name, workspace: workspace, kind: document.body.dataset.workspaceKind }
  }));
}

function bindCompatibilityTabs() {
  document.querySelectorAll('#right-tabs .tab-list .tab[data-tab]').forEach(function (button) {
    button.addEventListener('click', function () {
      activateWorkspaceForTab(button.dataset.tab);
    });
  });
}

function bindWorkspaceRail() {
  document.querySelectorAll('#workspace-rail [data-target-tab]').forEach(function (button) {
    button.addEventListener('click', function () {
      const target = button.dataset.targetTab;
      if (target === 'logic' || target === 'plant-drawing') {
        activateWorkspaceForTab(target);
        return;
      }
      clickExistingTab(target);
    });
  });
}

function bindGlobalNavigation() {
  const nav = byId('global-workspace-nav');
  if (!nav) return;
  nav.querySelectorAll('button[data-target-tab]').forEach(function (button) {
    button.addEventListener('click', function () {
      clickExistingTab(button.dataset.targetTab);
    });
  });
}

function expandInspector() {
  const sidebar = byId('sidebar-right');
  const collapse = byId('btn-right-collapse');
  if (!sidebar || !sidebar.classList.contains('collapsed') || !collapse) return;
  collapse.click();
}

function bindInspectorNavigation() {
  document.querySelectorAll('.inspector-nav-button[data-inspector-view]').forEach(function (button) {
    button.addEventListener('click', function () {
      expandInspector();
      const view = button.dataset.inspectorView;
      const target = button.dataset.targetTab;
      if (view === 'layers') {
        updateInspectorNavigation('layers');
        return;
      }
      if (target) clickExistingTab(target);
    });
  });
}

function focusPreviewRegion() {
  const panel = tabPanel('hmi');
  const preview = byId('hmi-live-preview');
  if (!panel || !preview) return;

  const panelBox = panel.getBoundingClientRect();
  const previewBox = preview.getBoundingClientRect();
  const targetTop = panel.scrollTop + previewBox.top - panelBox.top - 12;
  panel.scrollTop = Math.max(0, targetTop);
}

function bindPreviewButton() {
  const button = byId('btn-preview');
  if (!button) return;
  button.addEventListener('click', function () {
    if (!clickExistingTab('hmi')) return;
    window.setTimeout(focusPreviewRegion, 60);
  });
}

function bindExportAlias() {
  const alias = byId('btn-exportieren-alt');
  const primary = byId('btn-exportieren');
  if (!alias || !primary) return;

  alias.addEventListener('click', function (event) {
    if (event.defaultPrevented) return;
    primary.focus({ preventScroll: true });
  });
}

function isEditableTarget(node) {
  if (!node) return false;
  const tag = toText(node.tagName).toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return Boolean(node.isContentEditable);
}

/**
 * V58.1: Tastaturkuerzel-Uebersicht. Ein Werkzeug mit vielen Shortcuts muss
 * sie am Ort der Arbeit erklaeren — nicht nur in der Dokumentation.
 */
function bindShortcutsOverlay() {
  const modal = byId('modal-shortcuts');
  if (!modal) return;

  function openOverlay() { modal.classList.remove('hidden'); }
  function closeOverlay() { modal.classList.add('hidden'); }

  const trigger = byId('btn-shortcuts');
  if (trigger) trigger.addEventListener('click', openOverlay);

  modal.addEventListener('click', function (event) {
    const target = event.target;
    if (target === modal) { closeOverlay(); return; }
    if (target && typeof target.closest === 'function' && target.closest('.modal-close')) {
      closeOverlay();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { closeOverlay(); return; }
    if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    if (modal.classList.contains('hidden')) openOverlay();
    else closeOverlay();
  });
}

function updateProjectLabel(value) {
  const label = byId('canvas-project-label');
  const project = toText(value) || 'Unbenannt';
  if (label) label.textContent = project;
}

function bindProjectName() {
  const input = byId('projekt-name');
  if (input) {
    input.addEventListener('input', function () {
      updateProjectLabel(input.value);
    });
  }

  if (state && typeof state.subscribe === 'function') {
    state.subscribe('projektName', updateProjectLabel);
  }

  updateProjectLabel(input ? input.value : state.get('projektName'));
}

function templateCount() {
  return document.querySelectorAll(
    '#template-palette .template-item:not([data-library-duplicate="true"])'
  ).length;
}

function refreshTemplateCount() {
  const chip = byId('template-count');
  if (chip) chip.textContent = String(templateCount());
}

function categoryOptions() {
  const select = byId('kategorie-filter');
  if (!select) return [];
  return Array.prototype.slice.call(select.options).map(function (option) {
    return {
      value: option.value,
      label: toText(option.textContent) || (option.value ? option.value : 'Alle')
    };
  });
}

function categoryChipButtons(host) {
  return Array.prototype.slice.call((host || byId('category-chips')).querySelectorAll('.category-chip'));
}

function revealCategoryChip(button) {
  if (button && typeof button.scrollIntoView === 'function') {
    button.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    });
  }
}
function focusCategoryChipValue(value) {
  const host = byId('category-chips');
  if (!host) return;
  const button = categoryChipButtons(host).find(function (candidate) {
    return candidate.dataset.value === value;
  });
  if (!button) return;
  button.focus({ preventScroll: true });
  revealCategoryChip(button);
}


function syncCategoryChipSelection(revealActive) {
  const select = byId('kategorie-filter');
  const host = byId('category-chips');
  if (!select || !host) return;

  let activeButton = null;
  const buttons = categoryChipButtons(host);
  buttons.forEach(function (button) {
    const active = button.dataset.value === select.value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    if (active) activeButton = button;
  });

  if (!activeButton && buttons.length) {
    activeButton = buttons[0];
    activeButton.tabIndex = 0;
  }
  if (revealActive === true) revealCategoryChip(activeButton);
}

function activateCategoryChip(button) {
  const select = byId('kategorie-filter');
  if (!select || !button) return;
  const value = button.dataset.value || '';
  const restoreFocus = document.activeElement === button;
  select.value = value;
  dispatchChange(select);
  syncCategoryChipSelection(true);
  if (restoreFocus)
    window.setTimeout(focusCategoryChipValue.bind(null, value), 0);
}

function handleCategoryChipClick(event) {
  activateCategoryChip(event.currentTarget);
}

function handleCategoryChipKeydown(event) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;

  const host = event.currentTarget.parentElement;
  const buttons = categoryChipButtons(host);
  const currentIndex = buttons.indexOf(event.currentTarget);
  if (currentIndex < 0 || !buttons.length) return;

  event.preventDefault();
  let nextIndex = currentIndex;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = buttons.length - 1;
  else {
    const rtl = window.getComputedStyle(host).direction === 'rtl';
    const forward = event.key === 'ArrowRight' ? !rtl : rtl;
    nextIndex = (currentIndex + (forward ? 1 : -1) + buttons.length) % buttons.length;
  }
  buttons[nextIndex].focus();
  activateCategoryChip(buttons[nextIndex]);
}

function handleCategorySelectChange() {
  syncCategoryChipSelection(true);
}

function rebuildCategoryChips() {
  if (suppressChipRebuild) return;
  const select = byId('kategorie-filter');
  const host = byId('category-chips');
  if (!select || !host) return;

  const previousScroll = host.scrollLeft;
  suppressChipRebuild = true;
  host.replaceChildren();

  categoryOptions().forEach(function (entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-chip';
    button.dataset.value = entry.value;
    button.textContent = entry.value ? entry.label : 'Alle';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'template-palette');
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    button.addEventListener('click', handleCategoryChipClick);
    button.addEventListener('keydown', handleCategoryChipKeydown);
    host.appendChild(button);
  });

  suppressChipRebuild = false;
  syncCategoryChipSelection(false);
  host.scrollLeft = Math.min(previousScroll, Math.max(0, host.scrollWidth - host.clientWidth));
}

function bindLibraryEnhancements() {
  const palette = byId('template-palette');
  const select = byId('kategorie-filter');

  if (palette) {
    const paletteObserver = new MutationObserver(function () {
      refreshTemplateCount();
    });
    paletteObserver.observe(palette, { childList: true, subtree: true });
  }

  if (select) {
    const selectObserver = new MutationObserver(function () {
      rebuildCategoryChips();
    });
    selectObserver.observe(select, { childList: true });
    select.addEventListener('change', handleCategorySelectChange);
  }

  document.addEventListener('keydown', function (event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (toText(event.key).toLowerCase() !== 'k') return;
    const search = byId('template-suche');
    if (!search) return;
    event.preventDefault();
    search.focus();
    search.select();
  });

  refreshTemplateCount();
  rebuildCategoryChips();
}

function refreshCanvasEmptyState() {
  const empty = byId('canvas-empty-state');
  if (!empty) return;
  const elements = state && typeof state.get === 'function' ? (state.get('elements') || []) : [];
  if (elements.length === 0) empty.setAttribute('data-visible', '1');
  else empty.removeAttribute('data-visible');
}

function selectedElementData() {
  const selected = state.get('selectedElements') || [];
  const elements = state.get('elements') || [];
  if (selected.length !== 1) return null;

  return elements.filter(function (entry) {
    return toText(entry && entry.id) === toText(selected[0]);
  })[0] || null;
}

function refreshSelectionContext() {
  const heading = byId('right-breadcrumb');
  const context = byId('right-context');
  const selected = state && typeof state.get === 'function' ? (state.get('selectedElements') || []) : [];
  const data = selectedElementData();

  if (!heading || !context) return;

  if (selected.length > 1) {
    heading.textContent = selected.length + ' Elemente';
    context.textContent = 'Mehrfachauswahl · ' + inspectorLabel(activeInspectorView);
    return;
  }

  if (data) {
    heading.textContent = toText(data.name || data.template || data.id) || 'Element';
    const descriptor = toText(data.kategorie || data.category || data.type || data.template);
    context.textContent = (descriptor ? descriptor + ' · ' : '') + inspectorLabel(activeInspectorView);
    return;
  }

  heading.textContent = inspectorLabel(activeInspectorView);
  context.textContent = selected.length === 1 ? 'Auswahl wird synchronisiert' : 'Kein Element ausgewählt';
}

function refreshDirtyPresentation(dirty) {
  const footer = byId('inspector-footer-status');
  const body = document.body;
  const isDirty = Boolean(dirty);
  body.classList.toggle('project-is-dirty', isDirty);
  if (footer) {
    footer.textContent = isDirty
      ? 'Nicht gespeicherte Projektänderung'
      : 'Projektstand gespeichert';
  }
}

function bindStateProjection() {
  if (!state || typeof state.subscribe !== 'function') return;

  state.subscribe('elements', refreshCanvasEmptyState);
  state.subscribe('selectedElements', refreshSelectionContext);
  state.subscribe('elements', refreshSelectionContext);
  state.subscribe('isDirty', refreshDirtyPresentation);

  refreshCanvasEmptyState();
  refreshSelectionContext();
  refreshDirtyPresentation(state.get('isDirty'));
}

function validationCounts() {
  const report = store.getReport();
  return {
    errors: report && Array.isArray(report.errors) ? report.errors.length : 0,
    warnings: report && Array.isArray(report.warnings) ? report.warnings.length : 0,
    ready: Boolean(report)
  };
}

function refreshValidationBadge() {
  const badge = byId('workspace-validation-badge');
  if (!badge) return;

  const counts = validationCounts();
  if (!counts.ready) {
    badge.textContent = '…';
    badge.dataset.tone = 'muted';
    badge.title = 'Konfiguration wird geprüft';
    return;
  }

  const total = counts.errors + counts.warnings;
  badge.textContent = String(total);
  badge.dataset.tone = counts.errors ? 'danger' : (counts.warnings ? 'warn' : 'ok');
  badge.title = counts.errors + ' Fehler · ' + counts.warnings + ' Hinweise';
}

function bindValidationBadge() {
  store.on('config:loaded', refreshValidationBadge);
  store.on('config:changed', refreshValidationBadge);
  store.on('config:saved', refreshValidationBadge);

  const legacyBadge = byId('v9-tab-badge');
  if (legacyBadge) {
    const observer = new MutationObserver(refreshValidationBadge);
    observer.observe(legacyBadge, { childList: true, characterData: true, subtree: true });
  }

  refreshValidationBadge();
}

function restoreInitialRoute() {
  const active = document.querySelector('#right-tabs .tab-list .tab.active[data-tab]');
  activateWorkspaceForTab(active ? active.dataset.tab : 'elements');
}

function boot() {
  const required = ['right-tabs', 'global-tab-panels', 'workspace-rail', 'sidebar-right'];
  const missing = required.filter(function (id) { return !byId(id); });
  if (missing.length) {
    console.warn('[v56_workspace] Initialisierung abgebrochen. Fehlend:', missing.join(', '));
    return;
  }

  moveGlobalPanels();
  bindCompatibilityTabs();
  bindWorkspaceRail();
  bindGlobalNavigation();
  bindInspectorNavigation();
  bindPreviewButton();
  bindExportAlias();
  bindShortcutsOverlay();
  bindProjectName();
  bindLibraryEnhancements();
  bindStateProjection();
  bindValidationBadge();
  restoreInitialRoute();

  console.log('✓ Engineering Workspace V60.1 aktiv');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
