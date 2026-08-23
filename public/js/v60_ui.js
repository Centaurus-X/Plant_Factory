/**
 * v60_ui.js — merged interaction and accessibility layer for V60.1.
 *
 * Keeps the established workspace controller authoritative while combining
 * the V56.3 workspace refinements, V57.3 accessibility behavior and V58.2
 * canvas presentation without changing domain contracts.
 *
 * Style: functional composition, no classes and no arrow functions.
 */

'use strict';

import { showStatus, state, utils } from './core.js';
import { elementManager } from './elements.js';

const PALETTE_STORAGE_KEY = 'hmi-editor-dark-palette';
const PALETTES = ['navy', 'brown'];
let fitTimer = 0;
let minimapTimer = 0;

function byId(id) {
  return document.getElementById(id);
}

function readStoredPalette() {
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
    return PALETTES.indexOf(stored) !== -1 ? stored : 'navy';
  } catch (error) {
    return 'navy';
  }
}

function storePalette(palette) {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch (error) {
    // Persistence is optional; the active palette still remains usable.
  }
}

function paletteLabel(palette) {
  return palette === 'brown' ? 'Braun' : 'Dunkelblau';
}

function updatePaletteButton(palette) {
  const button = byId('palette-toggle');
  if (!button) return;
  const label = paletteLabel(palette);
  button.dataset.palette = palette;
  button.setAttribute('aria-pressed', palette === 'brown' ? 'true' : 'false');
  button.setAttribute('aria-label', 'Dunkle Farbpalette: ' + label);
  button.title = 'Aktiv: ' + label + ' · Dunkelblau/Braun umschalten';
}

function applyPalette(palette) {
  const next = PALETTES.indexOf(palette) !== -1 ? palette : 'navy';
  document.documentElement.setAttribute('data-dark-palette', next);
  updatePaletteButton(next);
  storePalette(next);
  document.dispatchEvent(new CustomEvent('v56:palette-changed', {
    detail: { palette: next }
  }));
}

function ensureDarkTheme() {
  if (document.documentElement.getAttribute('data-theme') === 'dark') return;
  const themeButton = byId('theme-toggle');
  if (themeButton) themeButton.click();
}

function togglePalette() {
  const current = document.documentElement.getAttribute('data-dark-palette') || 'navy';
  const next = current === 'brown' ? 'navy' : 'brown';
  applyPalette(next);
  ensureDarkTheme();
  showStatus('Farbpalette: ' + paletteLabel(next), 'success', 1800);
}

function bindPaletteSwitch() {
  applyPalette(readStoredPalette());
  const button = byId('palette-toggle');
  if (button) button.addEventListener('click', togglePalette);
}

function closeInspectorMenu() {
  const trigger = byId('btn-inspector-more');
  const menu = byId('inspector-more-menu');
  if (!trigger || !menu) return;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
}

function openInspectorMenu() {
  const trigger = byId('btn-inspector-more');
  const menu = byId('inspector-more-menu');
  if (!trigger || !menu) return;
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}

function toggleInspectorMenu() {
  const menu = byId('inspector-more-menu');
  if (!menu || menu.hidden) openInspectorMenu();
  else closeInspectorMenu();
}

function visibleMenuButtons(menu) {
  return toArray(menu ? menu.querySelectorAll('[role="menuitem"]') : []).filter(function (button) {
    return !button.disabled && button.offsetParent !== null;
  });
}

function bindMenuKeyboard(trigger, menu, openMenu, closeMenu) {
  if (!trigger || !menu) return;

  trigger.addEventListener('keydown', function (event) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) === -1) return;
    event.preventDefault();
    openMenu();
    const buttons = visibleMenuButtons(menu);
    if (!buttons.length) return;
    const target = event.key === 'ArrowUp' || event.key === 'End'
      ? buttons[buttons.length - 1]
      : buttons[0];
    target.focus({ preventScroll: true });
  });

  menu.addEventListener('keydown', function (event) {
    const buttons = visibleMenuButtons(menu);
    const current = buttons.indexOf(document.activeElement);
    const target = targetForNavigation(buttons, current, event.key);
    if (target) {
      event.preventDefault();
      target.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      trigger.focus({ preventScroll: true });
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  });
}

function bindInspectorMenu() {
  const trigger = byId('btn-inspector-more');
  const menu = byId('inspector-more-menu');
  if (!trigger || !menu) return;

  trigger.addEventListener('click', function (event) {
    event.stopPropagation();
    toggleInspectorMenu();
  });

  menu.addEventListener('click', function (event) {
    if (event.target.closest('button')) closeInspectorMenu();
  });

  document.addEventListener('click', function (event) {
    if (!event.target.closest('.inspector-menu')) closeInspectorMenu();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || menu.hidden) return;
    closeInspectorMenu();
    trigger.focus({ preventScroll: true });
  });

  bindMenuKeyboard(trigger, menu, openInspectorMenu, closeInspectorMenu);
}

function closeHeaderMenu() {
  const trigger = byId('btn-header-more');
  const menu = byId('header-more-menu');
  if (!trigger || !menu) return;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
}

function openHeaderMenu() {
  const trigger = byId('btn-header-more');
  const menu = byId('header-more-menu');
  if (!trigger || !menu) return;
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}

function toggleHeaderMenu() {
  const menu = byId('header-more-menu');
  if (!menu || menu.hidden) openHeaderMenu();
  else closeHeaderMenu();
}

function bindHeaderMenu() {
  const trigger = byId('btn-header-more');
  const menu = byId('header-more-menu');
  if (!trigger || !menu) return;

  trigger.addEventListener('click', function (event) {
    event.stopPropagation();
    toggleHeaderMenu();
  });

  menu.addEventListener('click', function (event) {
    if (event.target.closest('button')) closeHeaderMenu();
  });

  document.addEventListener('click', function (event) {
    if (!event.target.closest('.header-action-menu')) closeHeaderMenu();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || menu.hidden) return;
    closeHeaderMenu();
    trigger.focus({ preventScroll: true });
  });

  bindMenuKeyboard(trigger, menu, openHeaderMenu, closeHeaderMenu);
}

function bindInspectorApply() {
  const button = byId('inspector-apply');
  const status = byId('inspector-footer-status');
  if (!button) return;

  button.addEventListener('click', function () {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    if (status) status.textContent = 'Änderungen übernommen';
    showStatus('Elementänderungen übernommen', 'success', 1800);
  });
}

function fitDrawing() {
  const viewport = window.__viewportFixV2;
  const elements = state && typeof state.get === 'function'
    ? (state.get('elements') || [])
    : [];
  if (document.body.dataset.workspaceKind !== 'canvas' || elements.length === 0) return;
  if (viewport && typeof viewport.fitContent === 'function') viewport.fitContent(72);
  scheduleMinimapRefresh(40);
}

function scheduleDrawingFit(delay) {
  window.clearTimeout(fitTimer);
  fitTimer = window.setTimeout(fitDrawing, Number(delay) || 100);
}

function bindResponsiveDrawingFit() {
  if (state && typeof state.on === 'function') {
    state.on('elements:loaded', function () {
      scheduleDrawingFit(140);
    });
  }
  window.addEventListener('resize', function () {
    scheduleDrawingFit(180);
  });
}

function measureNode(node) {
  try {
    const box = node && node.getBBox ? node.getBBox() : null;
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  } catch (error) {
    return null;
  }
}

function mergeBounds(first, second) {
  if (!first) return second;
  if (!second) return first;
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function refreshMinimap() {
  const minimap = byId('canvas-minimap-svg');
  const elementsLayer = byId('elements-layer');
  const connectionsLayer = byId('connections-layer');
  const viewport = window.__viewportFixV2;
  if (!minimap || !elementsLayer || !connectionsLayer || !viewport) return;

  const bounds = mergeBounds(measureNode(elementsLayer), measureNode(connectionsLayer));
  if (!bounds) {
    minimap.setAttribute('viewBox', '0 0 2000 2000');
    return;
  }

  const view = viewport.getView();
  const zoom = Number(view.zoom) || 1;
  const x = (bounds.x * zoom) + (Number(view.panX) || 0);
  const y = (bounds.y * zoom) + (Number(view.panY) || 0);
  const width = bounds.width * zoom;
  const height = bounds.height * zoom;
  const padding = Math.max(18, Math.max(width, height) * 0.18);
  minimap.setAttribute('viewBox', [
    x - padding,
    y - padding,
    width + (padding * 2),
    height + (padding * 2)
  ].join(' '));
}

function scheduleMinimapRefresh(delay) {
  window.clearTimeout(minimapTimer);
  minimapTimer = window.setTimeout(refreshMinimap, Number(delay) || 80);
}

function bindMinimap() {
  if (state && typeof state.on === 'function') {
    ['elements:loaded', 'elements:rebuilt', 'element:updated',
      'connections:loaded', 'connection:updated'].forEach(function (eventName) {
      state.on(eventName, function () {
        scheduleMinimapRefresh(100);
      });
    });
  }
  if (state && typeof state.subscribe === 'function') {
    state.subscribe('zoom', function () {
      scheduleMinimapRefresh(40);
    });
    state.subscribe('pan', function () {
      scheduleMinimapRefresh(40);
    });
  }
  scheduleMinimapRefresh(150);
}


function toArray(list) {
  return Array.prototype.slice.call(list || []);
}

function setPressed(node, pressed) {
  if (!node) return;
  node.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

function canvasCenter() {
  const canvas = byId('main-canvas');
  if (!canvas) return { x: 100, y: 100 };

  const bounds = canvas.getBoundingClientRect();
  const point = canvas.createSVGPoint();
  point.x = bounds.left + (bounds.width / 2);
  point.y = bounds.top + (bounds.height / 2);

  const matrix = canvas.getScreenCTM();
  const mapped = matrix ? point.matrixTransform(matrix.inverse()) : point;
  const zoom = Number(state.get('zoom')) || 1;
  const pan = state.get('pan') || { x: 0, y: 0 };
  let x = (mapped.x - Number(pan.x || 0)) / zoom;
  let y = (mapped.y - Number(pan.y || 0)) / zoom;

  if (state.get('snapEnabled') && utils && typeof utils.snapToGrid === 'function') {
    x = utils.snapToGrid(x);
    y = utils.snapToGrid(y);
  }
  return { x: x, y: y };
}

function addTemplateAtCenter(payload) {
  const templateId = typeof payload === 'string'
    ? payload
    : String((payload && payload.templateId) || '');
  if (!templateId || !elementManager || typeof elementManager.addElement !== 'function') return;
  const center = canvasCenter();
  const id = elementManager.addElement(templateId, center.x, center.y);
  if (!id) return;
  if (typeof elementManager.selectElement === 'function') elementManager.selectElement(id);
  showStatus('Bauteil mittig eingefügt', 'success', 1800);
}

function bindTemplateKeyboardActivation() {
  if (state && typeof state.on === 'function') {
    state.on('template:activate', addTemplateAtCenter);
  }
}

function syncToolButtons() {
  if (!state || typeof state.get !== 'function') return;
  const current = state.get('currentTool');
  setPressed(byId('btn-select'), current === 'select');
  setPressed(byId('btn-pan'), current === 'pan');
  setPressed(byId('btn-grid'), Boolean(state.get('gridEnabled')));
  setPressed(byId('btn-snap'), Boolean(state.get('snapEnabled')));
}

function syncThemeButton() {
  const button = byId('theme-toggle');
  if (!button) return;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  setPressed(button, dark);
  button.setAttribute('aria-label', dark
    ? 'Helle Darstellung aktivieren'
    : 'Dunkle Darstellung aktivieren');
}

function bindToggleAccessibility() {
  if (state && typeof state.subscribe === 'function') {
    state.subscribe('currentTool', syncToolButtons);
    state.subscribe('gridEnabled', syncToolButtons);
    state.subscribe('snapEnabled', syncToolButtons);
  }
  const theme = byId('theme-toggle');
  if (theme) {
    theme.addEventListener('click', function () {
      window.setTimeout(syncThemeButton, 0);
    });
  }
  syncToolButtons();
  syncThemeButton();
}

function visibleTabs() {
  return toArray(document.querySelectorAll('#right-tabs .tab')).filter(function (tab) {
    return !tab.hidden && tab.offsetParent !== null;
  });
}

function syncTabAccessibility() {
  const tabs = toArray(document.querySelectorAll('#right-tabs .tab'));
  const panels = toArray(document.querySelectorAll('#right-tabs .tab-panel'));

  tabs.forEach(function (tab) {
    const active = tab.classList.contains('active');
    const panelId = 'tab-' + tab.dataset.tab;
    tab.setAttribute('aria-controls', panelId);
    tab.setAttribute('tabindex', active ? '0' : '-1');
  });

  panels.forEach(function (panel) {
    const active = panel.classList.contains('active');
    panel.hidden = !active;
    panel.setAttribute('tabindex', active ? '0' : '-1');
  });
}

function targetForNavigation(nodes, currentIndex, key) {
  if (!nodes.length || currentIndex < 0) return null;
  if (key === 'Home') return nodes[0];
  if (key === 'End') return nodes[nodes.length - 1];
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return nodes[(currentIndex + 1) % nodes.length];
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return nodes[(currentIndex - 1 + nodes.length) % nodes.length];
  }
  return null;
}

function handleTabKey(event) {
  const tabs = visibleTabs();
  const target = targetForNavigation(tabs, tabs.indexOf(event.currentTarget), event.key);
  if (!target) return;
  event.preventDefault();
  target.click();
  target.focus({ preventScroll: true });
  syncTabAccessibility();
}

function handleInspectorNavKey(event) {
  const buttons = toArray(document.querySelectorAll(
    '.inspector-nav > .inspector-nav-button:not([hidden])'
  )).filter(function (button) {
    return button.offsetParent !== null;
  });
  const target = targetForNavigation(buttons, buttons.indexOf(event.currentTarget), event.key);
  if (!target) return;
  event.preventDefault();
  target.click();
  target.focus({ preventScroll: true });
}

function workspaceNavigationButtons() {
  return toArray(document.querySelectorAll('.workspace-rail .workspace-nav-button[data-workspace]'));
}

function syncWorkspaceRailAccessibility() {
  const buttons = workspaceNavigationButtons();
  buttons.forEach(function (button) {
    const active = button.classList.contains('active');
    button.setAttribute('aria-current', active ? 'page' : 'false');
    button.setAttribute('tabindex', active ? '0' : '-1');
  });
}

function handleWorkspaceRailKey(event) {
  const buttons = workspaceNavigationButtons();
  const target = targetForNavigation(buttons, buttons.indexOf(event.currentTarget), event.key);
  if (!target) return;
  event.preventDefault();
  target.click();
  target.focus({ preventScroll: true });
  window.setTimeout(syncWorkspaceRailAccessibility, 0);
}

function bindWorkspaceRailKeyboard() {
  const buttons = workspaceNavigationButtons();
  buttons.forEach(function (button) {
    button.addEventListener('keydown', handleWorkspaceRailKey);
    button.addEventListener('click', function () {
      window.setTimeout(syncWorkspaceRailAccessibility, 0);
    });
  });
  syncWorkspaceRailAccessibility();
}

function bindTabKeyboard() {
  const tabs = toArray(document.querySelectorAll('#right-tabs .tab'));
  tabs.forEach(function (tab) {
    tab.addEventListener('keydown', handleTabKey);
    tab.addEventListener('click', function () {
      window.setTimeout(syncTabAccessibility, 0);
    });
  });
  const inspectorButtons = toArray(document.querySelectorAll(
    '.inspector-nav > .inspector-nav-button'
  ));
  inspectorButtons.forEach(function (button) {
    button.addEventListener('keydown', handleInspectorNavKey);
  });
  syncTabAccessibility();
}

function cssNumber(name, fallback) {
  const value = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue(name),
    10
  );
  return Number.isFinite(value) ? value : fallback;
}

function currentSidebarWidth() {
  const sidebar = byId('sidebar-right');
  if (!sidebar) return cssNumber('--sidebar-right-width', 400);
  return Math.round(sidebar.getBoundingClientRect().width);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function applySidebarWidth(width) {
  const splitter = byId('right-splitter');
  const minimum = cssNumber('--sidebar-right-min', 300);
  const maximum = cssNumber('--sidebar-right-max', 1100);
  const value = clamp(Math.round(width), minimum, maximum);
  document.documentElement.style.setProperty('--sidebar-right-width', value + 'px');
  if (splitter) {
    splitter.setAttribute('aria-valuemin', String(minimum));
    splitter.setAttribute('aria-valuemax', String(maximum));
    splitter.setAttribute('aria-valuenow', String(value));
    splitter.setAttribute('aria-valuetext', value + ' Pixel');
  }
  try {
    localStorage.setItem('sidebarRightWidth', String(value));
  } catch (error) {
    // Persistence is optional.
  }
}

function handleSplitterKey(event) {
  const minimum = cssNumber('--sidebar-right-min', 300);
  const maximum = cssNumber('--sidebar-right-max', 1100);
  const step = event.shiftKey ? 32 : 16;
  let next = currentSidebarWidth();

  if (event.key === 'ArrowLeft') next += step;
  else if (event.key === 'ArrowRight') next -= step;
  else if (event.key === 'Home') next = minimum;
  else if (event.key === 'End') next = maximum;
  else return;

  event.preventDefault();
  applySidebarWidth(next);
}

function bindSplitterKeyboard() {
  const splitter = byId('right-splitter');
  if (!splitter) return;
  splitter.setAttribute('tabindex', '0');
  splitter.addEventListener('keydown', handleSplitterKey);
  document.addEventListener('mouseup', function () {
    const sidebar = byId('sidebar-right');
    if (sidebar && !sidebar.classList.contains('collapsed')) {
      applySidebarWidth(currentSidebarWidth());
    }
  });
  applySidebarWidth(currentSidebarWidth());
}

let activeModal = null;
let focusBeforeModal = null;

function openLegacyModal() {
  return toArray(document.querySelectorAll('.modal')).filter(function (modal) {
    return !modal.classList.contains('hidden');
  })[0] || null;
}

function focusableNodes(root) {
  if (!root) return [];
  return toArray(root.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )).filter(function (node) {
    return node.offsetParent !== null;
  });
}

function syncModalFocus() {
  const modal = openLegacyModal();
  if (modal && modal !== activeModal) {
    focusBeforeModal = document.activeElement;
    activeModal = modal;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const focusable = focusableNodes(modal);
    if (focusable[0]) focusable[0].focus({ preventScroll: true });
    return;
  }
  if (!modal && activeModal) {
    activeModal = null;
    if (focusBeforeModal && typeof focusBeforeModal.focus === 'function') {
      focusBeforeModal.focus({ preventScroll: true });
    }
    focusBeforeModal = null;
  }
}

function closeActiveModal() {
  if (!activeModal) return;
  const close = activeModal.querySelector('.modal-close, .modal-cancel');
  if (close) close.click();
  else activeModal.classList.add('hidden');
  window.setTimeout(syncModalFocus, 0);
}

function handleModalKey(event) {
  const modal = openLegacyModal();
  if (!modal) return;
  activeModal = modal;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeActiveModal();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = focusableNodes(modal);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function bindModalFocus() {
  const modals = toArray(document.querySelectorAll('.modal'));
  modals.forEach(function (modal) {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
  });
  const observer = new MutationObserver(function () {
    window.setTimeout(syncModalFocus, 0);
  });
  modals.forEach(function (modal) {
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  });
  document.addEventListener('keydown', handleModalKey);
  syncModalFocus();
}

function boot() {
  const steps = [
    bindPaletteSwitch,
    bindInspectorMenu,
    bindHeaderMenu,
    bindInspectorApply,
    bindResponsiveDrawingFit,
    bindMinimap,
    bindTemplateKeyboardActivation,
    bindToggleAccessibility,
    bindWorkspaceRailKeyboard,
    bindTabKeyboard,
    bindSplitterKeyboard,
    bindModalFocus
  ];
  steps.forEach(function (step) {
    try {
      step();
    } catch (error) {
      console.warn('[v60_ui] Initialisierung unvollständig:', error);
    }
  });
  console.log('✓ V60.1 Merge- und Accessibility-Schicht aktiv');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
