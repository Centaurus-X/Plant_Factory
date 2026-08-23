/**
 * v62_ui.js — Plant Factory V62.1 interaction consolidation.
 *
 * Adds one managed modal-window contract, a keyboard-accessible canvas context
 * menu, a transition-safe inspector rail and release diagnostics without
 * replacing the established domain controllers.
 */

'use strict';

import { state, showStatus } from './core.js';
import { elementManager } from './elements.js';
import { connectionManager, connectionUI } from './connection_mapper.js';
import { showConfirmation, showNotice } from './dialog_service.js';

const managedWindows = new WeakMap();
let modalZIndex = 2200;
let modalLabelSequence = 0;
let contextMenu = null;
let contextData = null;

function byId(id) {
  return document.getElementById(id);
}

function toArray(list) {
  return Array.from(list || []);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function modalPanel(modal) {
  if (!modal) return null;
  return modal.querySelector(':scope > .modal-content')
    || modal.querySelector('.v9-modal__panel');
}

function modalHeader(panel) {
  if (!panel) return null;
  return panel.querySelector(':scope > .modal-header')
    || panel.querySelector(':scope > .v9-modal__head');
}

function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('button, input, select, textarea, a, [role="button"], [contenteditable="true"]');
}

function setWindowOffset(panel, x, y) {
  panel.style.setProperty('--pf-window-x', String(Math.round(x)) + 'px');
  panel.style.setProperty('--pf-window-y', String(Math.round(y)) + 'px');
  const record = managedWindows.get(panel.closest('.modal, .v9-modal'));
  if (record) {
    record.x = Math.round(x);
    record.y = Math.round(y);
  }
}

function readWindowOffset(panel) {
  const modal = panel ? panel.closest('.modal, .v9-modal') : null;
  const record = modal ? managedWindows.get(modal) : null;
  return record ? { x: record.x || 0, y: record.y || 0 } : { x: 0, y: 0 };
}

function centerManagedWindow(modal) {
  const record = managedWindows.get(modal);
  if (!record) return;
  record.panel.classList.remove('pf-window-maximized');
  record.maximized = false;
  record.maximizeButton.setAttribute('aria-pressed', 'false');
  record.maximizeButton.title = 'Dialog maximieren';
  setWindowOffset(record.panel, 0, 0);
  constrainManagedWindow(modal);
}

function resetManagedWindowGeometry(modal) {
  const record = managedWindows.get(modal);
  if (!record || modal.dataset.windowResetOnOpen !== 'true') return;
  record.maximized = false;
  record.restore = null;
  record.panel.classList.remove('pf-window-maximized');
  record.maximizeButton.setAttribute('aria-pressed', 'false');
  record.maximizeButton.title = 'Dialog maximieren';
  const width = Number(modal.dataset.windowDefaultWidth);
  const heightValue = String(modal.dataset.windowDefaultHeight || '').trim();
  if (Number.isFinite(width) && width > 0) {
    record.panel.style.width = String(Math.round(width)) + 'px';
  } else {
    record.panel.style.removeProperty('width');
  }
  if (heightValue && heightValue !== 'auto') {
    const height = Number(heightValue);
    if (Number.isFinite(height) && height > 0) {
      record.panel.style.height = String(Math.round(height)) + 'px';
    } else {
      record.panel.style.removeProperty('height');
    }
  } else {
    record.panel.style.removeProperty('height');
  }
  setWindowOffset(record.panel, 0, 0);
}

function constrainManagedWindow(modal) {
  const record = managedWindows.get(modal);
  if (!record || record.maximized) return;
  const panel = record.panel;
  const rect = panel.getBoundingClientRect();
  const margin = 12;
  let dx = 0;
  let dy = 0;
  if (rect.left < margin) dx = margin - rect.left;
  if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
  if (rect.top < margin) dy = margin - rect.top;
  if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom;
  if (dx || dy) {
    const offset = readWindowOffset(panel);
    setWindowOffset(panel, offset.x + dx, offset.y + dy);
  }
}

function toggleManagedWindowMaximize(modal) {
  const record = managedWindows.get(modal);
  if (!record) return;
  if (!record.maximized) {
    record.restore = {
      x: record.x || 0,
      y: record.y || 0,
      width: record.panel.style.width || '',
      height: record.panel.style.height || ''
    };
    record.maximized = true;
    record.panel.classList.add('pf-window-maximized');
    record.panel.style.removeProperty('width');
    record.panel.style.removeProperty('height');
    setWindowOffset(record.panel, 0, 0);
    record.maximizeButton.setAttribute('aria-pressed', 'true');
    record.maximizeButton.title = 'Dialog wiederherstellen';
  } else {
    const restore = record.restore || {};
    record.maximized = false;
    record.panel.classList.remove('pf-window-maximized');
    record.panel.style.width = restore.width || '';
    record.panel.style.height = restore.height || '';
    setWindowOffset(record.panel, restore.x || 0, restore.y || 0);
    record.maximizeButton.setAttribute('aria-pressed', 'false');
    record.maximizeButton.title = 'Dialog maximieren';
    constrainManagedWindow(modal);
  }
}

function bringModalToFront(modal) {
  if (!modal) return;
  modalZIndex += 1;
  modal.style.zIndex = String(modalZIndex);
}

function createWindowControl(label, text, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pf-window-control ' + className;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.textContent = text;
  return button;
}

function installWindowDrag(modal, record) {
  const header = record.header;
  header.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || record.maximized || isInteractiveTarget(event.target)) return;
    bringModalToFront(modal);
    const start = readWindowOffset(record.panel);
    const startX = event.clientX;
    const startY = event.clientY;
    record.panel.classList.add('pf-window-moving');
    header.setPointerCapture(event.pointerId);

    function move(moveEvent) {
      if (moveEvent.pointerId !== event.pointerId) return;
      moveEvent.preventDefault();
      setWindowOffset(
        record.panel,
        start.x + moveEvent.clientX - startX,
        start.y + moveEvent.clientY - startY
      );
    }

    function finish(finishEvent) {
      if (finishEvent.pointerId !== event.pointerId) return;
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', finish);
      header.removeEventListener('pointercancel', finish);
      record.panel.classList.remove('pf-window-moving');
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
      constrainManagedWindow(modal);
    }

    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', finish);
    header.addEventListener('pointercancel', finish);
    event.preventDefault();
  });

  header.addEventListener('keydown', function (event) {
    if (!event.altKey) return;
    const offset = readWindowOffset(record.panel);
    const step = event.shiftKey ? 32 : 12;
    let handled = true;
    if (event.key === 'ArrowLeft') setWindowOffset(record.panel, offset.x - step, offset.y);
    else if (event.key === 'ArrowRight') setWindowOffset(record.panel, offset.x + step, offset.y);
    else if (event.key === 'ArrowUp') setWindowOffset(record.panel, offset.x, offset.y - step);
    else if (event.key === 'ArrowDown') setWindowOffset(record.panel, offset.x, offset.y + step);
    else if (event.key === '0') centerManagedWindow(modal);
    else if (event.key === 'Enter') toggleManagedWindowMaximize(modal);
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      constrainManagedWindow(modal);
    }
  });
}

function installWindowResize(modal, record) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'pf-window-resize-handle';
  handle.setAttribute('aria-label', 'Dialoggröße ändern');
  handle.title = 'Dialoggröße ändern';
  record.panel.appendChild(handle);
  record.resizeHandle = handle;

  handle.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || record.maximized) return;
    bringModalToFront(modal);
    const rect = record.panel.getBoundingClientRect();
    const startWidth = rect.width;
    const startHeight = rect.height;
    const startX = event.clientX;
    const startY = event.clientY;
    record.panel.classList.add('pf-window-resizing');
    handle.setPointerCapture(event.pointerId);

    function resize(moveEvent) {
      if (moveEvent.pointerId !== event.pointerId) return;
      moveEvent.preventDefault();
      const maxWidth = Math.max(360, window.innerWidth - 24);
      const maxHeight = Math.max(240, window.innerHeight - 24);
      const width = clamp(startWidth + moveEvent.clientX - startX, 320, maxWidth);
      const height = clamp(startHeight + moveEvent.clientY - startY, 220, maxHeight);
      record.panel.style.width = String(Math.round(width)) + 'px';
      record.panel.style.height = String(Math.round(height)) + 'px';
    }

    function finish(finishEvent) {
      if (finishEvent.pointerId !== event.pointerId) return;
      handle.removeEventListener('pointermove', resize);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      record.panel.classList.remove('pf-window-resizing');
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      constrainManagedWindow(modal);
    }

    handle.addEventListener('pointermove', resize);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    event.preventDefault();
    event.stopPropagation();
  });
}

function enhanceModal(modal) {
  if (!modal || managedWindows.has(modal)) return;
  const panel = modalPanel(modal);
  const header = modalHeader(panel);
  if (!panel || !header) return;

  modal.classList.add('pf-managed-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const heading = header.querySelector('h1, h2, h3, h4, h5, h6, [data-modal-title]');
  if (heading && !heading.id) {
    modalLabelSequence += 1;
    heading.id = 'pf-managed-modal-title-' + String(modalLabelSequence);
  }
  if (heading && !modal.hasAttribute('aria-labelledby')) {
    modal.setAttribute('aria-labelledby', heading.id);
  }
  panel.classList.add('pf-window-panel');
  header.classList.add('pf-window-header');
  if (!header.hasAttribute('tabindex')) header.tabIndex = 0;
  header.title = 'Dialog verschieben · Alt + Pfeiltasten für Tastatursteuerung';

  const controls = document.createElement('div');
  controls.className = 'pf-window-controls';
  const centerButton = createWindowControl('Dialog zentrieren', '◎', 'pf-window-center');
  const maximizeButton = createWindowControl('Dialog maximieren', '□', 'pf-window-maximize');
  maximizeButton.setAttribute('aria-pressed', 'false');
  controls.appendChild(centerButton);
  controls.appendChild(maximizeButton);

  const existingClose = header.querySelector('.modal-close, .v9-modal__close');
  if (existingClose) header.insertBefore(controls, existingClose);
  else header.appendChild(controls);

  const record = {
    modal: modal,
    panel: panel,
    header: header,
    controls: controls,
    centerButton: centerButton,
    maximizeButton: maximizeButton,
    resizeHandle: null,
    x: 0,
    y: 0,
    maximized: false,
    restore: null
  };
  managedWindows.set(modal, record);

  centerButton.addEventListener('click', function () {
    centerManagedWindow(modal);
  });
  maximizeButton.addEventListener('click', function () {
    toggleManagedWindowMaximize(modal);
  });
  modal.addEventListener('pointerdown', function () {
    bringModalToFront(modal);
  });
  modal.addEventListener('plant:modal-open', function () {
    bringModalToFront(modal);
    resetManagedWindowGeometry(modal);
    requestAnimationFrame(function () {
      constrainManagedWindow(modal);
    });
  });

  installWindowDrag(modal, record);
  installWindowResize(modal, record);
  bringModalToFront(modal);
}

function scanModals(root) {
  const scope = root && root.querySelectorAll ? root : document;
  if (scope.matches && scope.matches('.modal, .v9-modal')) enhanceModal(scope);
  toArray(scope.querySelectorAll('.modal, .v9-modal')).forEach(enhanceModal);
}

function installModalManager() {
  scanModals(document);
  const observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      toArray(record.addedNodes).forEach(function (node) {
        if (node instanceof Element) scanModals(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', function () {
    toArray(document.querySelectorAll('.modal, .v9-modal')).forEach(function (modal) {
      constrainManagedWindow(modal);
    });
  });
}

function expandInspector() {
  const sidebar = byId('sidebar-right');
  const toggle = byId('btn-right-collapse');
  if (sidebar && sidebar.classList.contains('collapsed') && toggle) toggle.click();
}

function activateInspector(tabName, hmiSubtab) {
  expandInspector();
  const button = byId('tab-btn-' + tabName);
  if (button) button.click();
  if (tabName === 'hmi' && hmiSubtab) {
    requestAnimationFrame(function () {
      document.dispatchEvent(new CustomEvent('plant:hmi-open-subtab', {
        detail: { subtab: hmiSubtab }
      }));
    });
  }
}

function contextIcon(iconId) {
  return '<svg class="ico ico--sm" aria-hidden="true"><use href="#' + iconId + '"></use></svg>';
}

function menuItem(action, label, iconId, disabled, destructive) {
  return {
    action: action,
    label: label,
    icon: iconId,
    disabled: disabled === true,
    destructive: destructive === true
  };
}

function menuSeparator() {
  return { separator: true };
}

function objectMenuItems(elementId) {
  const connections = connectionManager.getConnectionsByElement(elementId);
  return [
    menuItem('object-properties', 'Eigenschaften öffnen', 'ico-properties'),
    menuItem('object-io', 'I/O und Runtime-Binding', 'ico-cpu'),
    menuItem('object-hmi-widget', 'HMI-Widget konfigurieren', 'ico-monitor'),
    menuItem('object-hmi-binding', 'HMI-Datenbindung konfigurieren', 'ico-link'),
    menuSeparator(),
    menuItem('object-connect', 'Neue Verbindung erstellen', 'ico-connection'),
    menuItem('object-connections', 'Verbindungen anzeigen (' + String(connections.length) + ')', 'ico-connection'),
    menuSeparator(),
    menuItem('object-delete', 'Objekt löschen', 'ico-trash', false, true)
  ];
}

function connectionMenuItems(connectionId) {
  const item = connectionManager.connections.get(connectionId);
  const data = item ? item.data : null;
  return [
    menuItem('connection-edit', 'Verbindung bearbeiten', 'ico-properties'),
    menuItem('connection-from', 'Startobjekt auswählen', 'ico-cursor', !data),
    menuItem('connection-to', 'Zielobjekt auswählen', 'ico-cursor', !data),
    menuSeparator(),
    menuItem('connection-delete', 'Verbindung löschen', 'ico-trash', false, true)
  ];
}

function canvasMenuItems() {
  const gridButton = byId('btn-grid');
  const snapButton = byId('btn-snap');
  const overlayButton = byId('btn-hmi-overlay');
  return [
    menuItem('canvas-fit', 'Zeichnung einpassen', 'ico-fit'),
    menuItem('canvas-grid', gridButton && gridButton.classList.contains('active') ? 'Raster ausblenden' : 'Raster einblenden', 'ico-grid'),
    menuItem('canvas-snap', snapButton && snapButton.classList.contains('active') ? 'Einrasten deaktivieren' : 'Einrasten aktivieren', 'ico-magnet'),
    menuItem('canvas-hmi', overlayButton && overlayButton.getAttribute('aria-pressed') === 'true' ? 'HMI-Ebene ausblenden' : 'HMI-Ebene einblenden', 'ico-monitor'),
    menuSeparator(),
    menuItem('canvas-undo', 'Rückgängig', 'ico-undo'),
    menuItem('canvas-redo', 'Wiederholen', 'ico-redo'),
    menuItem('canvas-deselect', 'Auswahl aufheben', 'ico-close')
  ];
}

function ensureContextMenu() {
  if (contextMenu) return contextMenu;
  contextMenu = document.createElement('div');
  contextMenu.id = 'canvas-context-menu';
  contextMenu.className = 'canvas-context-menu';
  contextMenu.setAttribute('role', 'menu');
  contextMenu.setAttribute('aria-label', 'Zeichenflächenaktionen');
  contextMenu.hidden = true;
  document.body.appendChild(contextMenu);

  contextMenu.addEventListener('click', function (event) {
    const button = event.target.closest('[data-context-action]');
    if (!button || button.disabled) return;
    executeContextAction(button.dataset.contextAction);
  });

  contextMenu.addEventListener('keydown', function (event) {
    const items = toArray(contextMenu.querySelectorAll('[role="menuitem"]:not([disabled])'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1 + items.length) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      closeContextMenu();
      return;
    } else return;
    event.preventDefault();
    items[next].focus({ preventScroll: true });
  });

  return contextMenu;
}

function renderContextMenu(items) {
  const menu = ensureContextMenu();
  menu.innerHTML = '';
  items.forEach(function (item) {
    if (item.separator) {
      const separator = document.createElement('span');
      separator.className = 'canvas-context-menu__separator';
      separator.setAttribute('role', 'separator');
      menu.appendChild(separator);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'canvas-context-menu__item';
    if (item.destructive) button.classList.add('canvas-context-menu__item--danger');
    button.dataset.contextAction = item.action;
    button.setAttribute('role', 'menuitem');
    button.disabled = item.disabled;
    button.innerHTML = contextIcon(item.icon) + '<span></span>';
    button.querySelector('span').textContent = item.label;
    menu.appendChild(button);
  });
}

function openContextMenu(event, type, id, items) {
  renderContextMenu(items);
  contextData = { type: type, id: id || '' };
  contextMenu.hidden = false;
  contextMenu.dataset.contextType = type;
  const rect = contextMenu.getBoundingClientRect();
  const margin = 8;
  const left = clamp(event.clientX, margin, Math.max(margin, window.innerWidth - rect.width - margin));
  const top = clamp(event.clientY, margin, Math.max(margin, window.innerHeight - rect.height - margin));
  contextMenu.style.left = String(Math.round(left)) + 'px';
  contextMenu.style.top = String(Math.round(top)) + 'px';
  const first = contextMenu.querySelector('[role="menuitem"]:not([disabled])');
  if (first) first.focus({ preventScroll: true });
}

function closeContextMenu() {
  if (!contextMenu) return;
  contextMenu.hidden = true;
  contextMenu.innerHTML = '';
  contextData = null;
}

function confirmObjectDeletion(elementId) {
  const item = elementManager.getElement(elementId);
  const label = item && item.data ? (item.data.tag || item.data.name || elementId) : elementId;
  showConfirmation('Objekt „' + label + '“ und seine Verbindungen löschen?', {
    title: 'Objekt löschen',
    confirmLabel: 'Objekt löschen',
    destructive: true,
    detail: 'Bindings und HMI-Konfigurationen bleiben im Modell erhalten und werden in der Validierung als verwaiste Referenzen sichtbar.'
  }, function () {
    elementManager.removeElement(elementId);
    showStatus('Objekt gelöscht', 'success');
  });
}

function confirmConnectionDeletion(connectionId) {
  showConfirmation('Diese Verbindung dauerhaft aus dem Anlagenbild entfernen?', {
    title: 'Verbindung löschen',
    confirmLabel: 'Verbindung löschen',
    destructive: true
  }, function () {
    connectionManager.removeConnection(connectionId);
    showStatus('Verbindung gelöscht', 'success');
  });
}

function selectConnectionEndpoint(connectionId, side) {
  const item = connectionManager.connections.get(connectionId);
  if (!item) return;
  const elementId = side === 'from' ? item.data.from : item.data.to;
  if (elementId) {
    elementManager.selectElement(elementId);
    activateInspector('elements');
  }
}

function executeContextAction(action) {
  const data = contextData ? { type: contextData.type, id: contextData.id } : null;
  closeContextMenu();
  if (!data) return;
  if (action === 'object-properties') activateInspector('elements');
  else if (action === 'object-io') activateInspector('device');
  else if (action === 'object-hmi-widget') activateInspector('hmi', 'widgets');
  else if (action === 'object-hmi-binding') activateInspector('hmi', 'bindings');
  else if (action === 'object-connect') connectionUI.showCreateConnectionDialog(data.id);
  else if (action === 'object-connections') activateInspector('connections');
  else if (action === 'object-delete') confirmObjectDeletion(data.id);
  else if (action === 'connection-edit') connectionUI.showEditConnectionDialog(data.id);
  else if (action === 'connection-from') selectConnectionEndpoint(data.id, 'from');
  else if (action === 'connection-to') selectConnectionEndpoint(data.id, 'to');
  else if (action === 'connection-delete') confirmConnectionDeletion(data.id);
  else if (action === 'canvas-fit') byId('btn-zoom-reset')?.click();
  else if (action === 'canvas-grid') byId('btn-grid')?.click();
  else if (action === 'canvas-snap') byId('btn-snap')?.click();
  else if (action === 'canvas-hmi') byId('btn-hmi-overlay')?.click();
  else if (action === 'canvas-undo') state.undo();
  else if (action === 'canvas-redo') state.redo();
  else if (action === 'canvas-deselect') elementManager.deselectAll();
}

function installCanvasContextMenu() {
  const canvas = byId('main-canvas');
  if (!canvas) return;
  ensureContextMenu();
  canvas.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    event.stopPropagation();
    const element = event.target.closest('g.svg-element');
    const connection = event.target.closest('path.connection-line');
    if (element) {
      const elementId = element.getAttribute('id');
      if (elementId) elementManager.selectElement(elementId, false);
      openContextMenu(event, 'object', elementId, objectMenuItems(elementId));
      return;
    }
    if (connection) {
      const connectionId = connection.getAttribute('id');
      if (connectionId) connectionManager.selectConnection(connectionId);
      openContextMenu(event, 'connection', connectionId, connectionMenuItems(connectionId));
      return;
    }
    openContextMenu(event, 'canvas', '', canvasMenuItems());
  }, true);

  document.addEventListener('pointerdown', function (event) {
    if (!contextMenu || contextMenu.hidden || contextMenu.contains(event.target)) return;
    closeContextMenu();
  }, true);
  document.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('resize', closeContextMenu);
}

function installInspectorRailGuard() {
  const sidebar = byId('sidebar-right');
  const button = byId('btn-right-collapse');
  if (!sidebar || !button) return;

  function sync() {
    const collapsed = sidebar.classList.contains('collapsed');
    sidebar.dataset.railState = collapsed ? 'collapsed' : 'expanded';
    button.setAttribute('aria-label', collapsed ? 'Inspektor einblenden' : 'Inspektor ausblenden');
    button.title = collapsed ? 'Inspektor einblenden' : 'Inspektor ausblenden';
  }

  const observer = new MutationObserver(sync);
  observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  button.addEventListener('click', function () {
    requestAnimationFrame(sync);
  });
  sync();
}

function installConnectionRejectionFeedback() {
  state.on('connection:rejected', function (event) {
    const reason = event && event.reason ? event.reason : 'unknown';
    if (reason === 'incompatible_endpoints') {
      showNotice('Start- und Zielobjekt können in dieser Kombination nicht verbunden werden.', {
        title: 'Verbindungsobjekte prüfen',
        detail: 'Beide Objekte müssen vorhanden, verschieden und strukturell verbindbar sein.'
      });
      return;
    }
    if (reason === 'incompatible_ports') {
      showNotice('Die gewählten semantischen Ports sind für diesen Verbindungstyp nicht kompatibel.', {
        title: 'Ports nicht kompatibel',
        detail: 'Prüfe Porttyp, Richtung und Verbindungskategorie oder verwende die automatische Portwahl.'
      });
    }
  });
}

function publishReleaseReport() {
  window.__plantFactoryV62 = {
    version: '62.1',
    modalContract: 'PF-MODAL-V1',
    contextMenuContract: 'PF-CANVAS-CONTEXT-V1',
    hmiWorkflowContract: 'PF-HMI-SETUP-V2',
    nativeDialogs: false,
    draggableModals: true,
    resizableModals: true,
    inspectorRailStable: true
  };
  document.documentElement.dataset.plantFactoryRelease = '62.1';
}

function init() {
  installModalManager();
  installInspectorRailGuard();
  installCanvasContextMenu();
  installConnectionRejectionFeedback();
  publishReleaseReport();
  console.log('✓ V62.1 UI-Erweiterungen initialisiert');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
