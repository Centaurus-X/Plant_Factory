/**
 * dialog_service.js — Plant Factory application dialog service.
 *
 * Replaces browser-native alert/confirm/prompt surfaces with theme-aware,
 * accessible application modals. The window behavior itself is added by
 * v62_ui.js so static and dynamically created dialogs share one contract.
 */

'use strict';

let dialogSequence = 0;
let activeDialog = null;
let restoreFocusTarget = null;

function nextDialogId() {
  dialogSequence += 1;
  return 'pf-application-dialog-' + String(dialogSequence);
}

function dispatchModalEvent(modal, name) {
  if (!modal) return;
  modal.dispatchEvent(new CustomEvent(name, {
    bubbles: true,
    detail: { modal: modal }
  }));
}

function focusFirstControl(modal) {
  if (!modal) return;
  requestAnimationFrame(function () {
    const preferred = modal.querySelector('[data-dialog-primary="true"]');
    const fallback = modal.querySelector(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const target = preferred || fallback;
    if (target && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  });
}

export function openModalElement(modal, options) {
  if (!modal) return null;
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.captureFocus !== false) {
    restoreFocusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }
  modal.classList.remove('hidden');
  modal.removeAttribute('hidden');
  modal.removeAttribute('aria-hidden');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  dispatchModalEvent(modal, 'plant:modal-open');
  focusFirstControl(modal);
  return modal;
}

export function closeModalElement(modal, options) {
  if (!modal) return;
  const opts = options && typeof options === 'object' ? options : {};
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  dispatchModalEvent(modal, 'plant:modal-close');
  if (opts.restoreFocus !== false && restoreFocusTarget
      && document.contains(restoreFocusTarget)
      && typeof restoreFocusTarget.focus === 'function') {
    restoreFocusTarget.focus({ preventScroll: true });
  }
  restoreFocusTarget = null;
}

function createButton(label, className, action, primary) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  if (primary) button.dataset.dialogPrimary = 'true';
  button.addEventListener('click', action);
  return button;
}

function createApplicationDialog(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const modal = document.createElement('div');
  const dialogId = nextDialogId();
  const titleId = dialogId + '-title';

  modal.id = dialogId;
  modal.className = 'modal pf-application-dialog';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.dataset.dialogKind = opts.kind || 'notice';

  const panel = document.createElement('div');
  panel.className = 'modal-content pf-application-dialog__panel';

  const header = document.createElement('div');
  header.className = 'modal-header';

  const title = document.createElement('h2');
  title.id = titleId;
  title.textContent = opts.title || 'Hinweis';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'modal-close';
  closeButton.setAttribute('aria-label', 'Dialog schließen');
  closeButton.textContent = '×';

  const body = document.createElement('div');
  body.className = 'modal-body pf-application-dialog__body';

  const message = document.createElement('p');
  message.className = 'pf-dialog-message';
  message.textContent = String(opts.message || '');
  body.appendChild(message);

  if (opts.detail) {
    const detail = document.createElement('p');
    detail.className = 'pf-dialog-detail';
    detail.textContent = String(opts.detail);
    body.appendChild(detail);
  }

  if (opts.input) {
    const inputLabel = document.createElement('label');
    inputLabel.className = 'pf-dialog-input-label';
    inputLabel.textContent = opts.input.label || 'Wert';
    const input = document.createElement('input');
    input.className = 'text-input pf-dialog-input';
    input.type = opts.input.type || 'text';
    input.value = opts.input.value == null ? '' : String(opts.input.value);
    input.placeholder = opts.input.placeholder || '';
    input.dataset.dialogInput = 'true';
    inputLabel.appendChild(input);
    body.appendChild(inputLabel);
  }

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  header.appendChild(title);
  header.appendChild(closeButton);
  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);
  modal.appendChild(panel);
  document.body.appendChild(modal);

  function closeDialog(reason) {
    if (!document.body.contains(modal)) return;
    dispatchModalEvent(modal, 'plant:modal-close');
    document.body.removeChild(modal);
    if (activeDialog === modal) activeDialog = null;
    if (restoreFocusTarget && document.contains(restoreFocusTarget)
        && typeof restoreFocusTarget.focus === 'function') {
      restoreFocusTarget.focus({ preventScroll: true });
    }
    restoreFocusTarget = null;
    if (typeof opts.onClose === 'function') opts.onClose(reason || 'close');
  }

  function cancelDialog() {
    if (typeof opts.onCancel === 'function') opts.onCancel();
    closeDialog('cancel');
  }

  function confirmDialog() {
    const input = modal.querySelector('[data-dialog-input="true"]');
    const value = input ? input.value : undefined;
    let result = true;
    if (typeof opts.onConfirm === 'function') result = opts.onConfirm(value);
    if (result !== false) closeDialog('confirm');
  }

  closeButton.addEventListener('click', cancelDialog);
  modal.addEventListener('click', function (event) {
    if (event.target === modal && opts.closeOnBackdrop !== false) cancelDialog();
  });
  modal.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelDialog();
    }
    if (event.key === 'Enter' && opts.submitOnEnter === true
        && event.target && event.target.tagName !== 'TEXTAREA') {
      event.preventDefault();
      confirmDialog();
    }
  });

  if (opts.cancelLabel) {
    footer.appendChild(createButton(
      opts.cancelLabel,
      'btn btn-secondary',
      cancelDialog,
      false
    ));
  }

  const primaryClass = opts.destructive
    ? 'btn btn-danger'
    : 'btn btn-primary';
  footer.appendChild(createButton(
    opts.confirmLabel || 'OK',
    primaryClass,
    confirmDialog,
    true
  ));

  activeDialog = modal;
  openModalElement(modal);
  return {
    modal: modal,
    close: closeDialog,
    confirm: confirmDialog,
    cancel: cancelDialog
  };
}

export function showNotice(message, options) {
  const opts = options && typeof options === 'object' ? options : {};
  return createApplicationDialog({
    kind: opts.kind || 'notice',
    title: opts.title || 'Hinweis',
    message: message,
    detail: opts.detail || '',
    confirmLabel: opts.confirmLabel || 'Verstanden',
    closeOnBackdrop: opts.closeOnBackdrop !== false,
    onConfirm: opts.onConfirm,
    onClose: opts.onClose
  });
}

export function showConfirmation(message, options, onConfirm) {
  const opts = options && typeof options === 'object' ? options : {};
  const callback = typeof onConfirm === 'function'
    ? onConfirm
    : (typeof opts.onConfirm === 'function' ? opts.onConfirm : null);
  return createApplicationDialog({
    kind: opts.kind || 'confirmation',
    title: opts.title || 'Aktion bestätigen',
    message: message,
    detail: opts.detail || '',
    confirmLabel: opts.confirmLabel || 'Bestätigen',
    cancelLabel: opts.cancelLabel || 'Abbrechen',
    destructive: opts.destructive === true,
    closeOnBackdrop: opts.closeOnBackdrop !== false,
    onConfirm: callback,
    onCancel: opts.onCancel,
    onClose: opts.onClose
  });
}

export function showInputDialog(message, options, onConfirm) {
  const opts = options && typeof options === 'object' ? options : {};
  return createApplicationDialog({
    kind: opts.kind || 'input',
    title: opts.title || 'Eingabe',
    message: message,
    detail: opts.detail || '',
    input: {
      label: opts.label || 'Wert',
      value: opts.value || '',
      placeholder: opts.placeholder || '',
      type: opts.type || 'text'
    },
    confirmLabel: opts.confirmLabel || 'Übernehmen',
    cancelLabel: opts.cancelLabel || 'Abbrechen',
    submitOnEnter: true,
    onConfirm: onConfirm
  });
}

export function getActiveApplicationDialog() {
  return activeDialog;
}

if (typeof window !== 'undefined') {
  window.plantFactoryDialogs = {
    openModalElement: openModalElement,
    closeModalElement: closeModalElement,
    showNotice: showNotice,
    showConfirmation: showConfirmation,
    showInputDialog: showInputDialog,
    getActiveApplicationDialog: getActiveApplicationDialog
  };
}
