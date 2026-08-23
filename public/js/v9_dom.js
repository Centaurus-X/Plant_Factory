/**
 * v9_dom.js — schlanke, sichere DOM-Bausteine für die V9-Panels.
 *
 * Bewusst ohne innerHTML: die V50-Module bauen ihr Markup per Template-String
 * und interpolieren dort ungeprüft Nutzereingaben (Datei ui.js:429,
 * device.js:658-665, processes.js:731-737 …). Hier entsteht jedes Element über
 * document.createElement — HTML-Injection ist damit strukturell ausgeschlossen.
 *
 * Ebenfalls ohne Inline-Styles: alle Darstellung kommt aus public/css/*.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { ensureArray, isPlainObject, toText } from './shared_utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Element-Fabrik.
 *   h('div.card#main', { title: 'x' }, child1, child2)
 * Tag-Syntax: 'tag.klasse1.klasse2#id'
 */
export function h(spec, attrs) {
  const children = Array.prototype.slice.call(arguments, 2);
  const parts = String(spec).split(/(?=[.#])/);
  const tag = parts[0] && parts[0][0] !== '.' && parts[0][0] !== '#' ? parts[0] : 'div';
  const node = document.createElement(tag);

  parts.forEach(function (part) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else if (part[0] === '#') node.id = part.slice(1);
  });

  if (isPlainObject(attrs)) {
    Object.keys(attrs).forEach(function (key) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') {
        toText(value).split(/\s+/).filter(Boolean).forEach(function (name) {
          node.classList.add(name);
        });
      } else if (key === 'dataset' && isPlainObject(value)) {
        Object.keys(value).forEach(function (name) { node.dataset[name] = toText(value[name]); });
      } else if (key === 'text') {
        node.textContent = toText(value);
      } else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'value' || key === 'checked' || key === 'disabled'
          || key === 'selected' || key === 'multiple') {
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? '' : toText(value));
      }
    });
  }

  appendAll(node, children);
  return node;
}

function appendAll(node, children) {
  ensureArray(children).forEach(function (child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      appendAll(node, child);
      return;
    }
    node.appendChild(child instanceof Node ? child : document.createTextNode(toText(child)));
  });
}

/** Leert einen Knoten. */
export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Ersetzt den Inhalt eines Knotens. */
export function mount(node, children) {
  if (!node) return node;
  clear(node);
  appendAll(node, ensureArray(children));
  return node;
}

/* -------------------------------------------------------------------------
 * Bausteine
 * ---------------------------------------------------------------------- */

export function text(value) {
  return document.createTextNode(toText(value));
}

export function icon(name) {
  return h('span.v9-icon', { 'aria-hidden': 'true', text: name });
}

export function badge(label, tone) {
  return h('span.v9-badge' + (tone ? '.v9-badge--' + tone : ''), { text: label });
}

export function pill(label, tone) {
  return h('span.v9-pill' + (tone ? '.v9-pill--' + tone : ''), { text: label });
}

export function button(label, options) {
  const opts = isPlainObject(options) ? options : {};
  const variant = opts.variant ? '.v9-btn--' + opts.variant : '';
  const size = opts.size ? '.v9-btn--' + opts.size : '';
  return h('button.v9-btn' + variant + size, {
    type: 'button',
    title: opts.title || '',
    disabled: Boolean(opts.disabled),
    onclick: opts.onClick,
    'aria-label': opts.ariaLabel || null
  }, opts.icon ? icon(opts.icon) : null, h('span', { text: label }));
}

export function card(title, options) {
  const opts = isPlainObject(options) ? options : {};
  const body = h('div.v9-card__body');
  const header = h('div.v9-card__head',
    null,
    h('h3.v9-card__title', { text: title }),
    opts.meta ? h('div.v9-card__meta', null, opts.meta) : null,
    opts.actions ? h('div.v9-card__actions', null, opts.actions) : null);
  const node = h('section.v9-card', { dataset: { section: opts.key || '' } }, header, body);
  node.body = body;
  return node;
}

export function field(label, control, options) {
  const opts = isPlainObject(options) ? options : {};
  const id = control && control.id ? control.id : null;
  return h('label.v9-field' + (opts.wide ? '.v9-field--wide' : ''), { for: id },
    h('span.v9-field__label', { text: label },
      opts.required ? h('span.v9-field__req', { text: '*', title: 'Pflichtfeld' }) : null),
    control,
    opts.hint ? h('span.v9-field__hint', { text: opts.hint }) : null);
}

export function input(options) {
  const opts = isPlainObject(options) ? options : {};
  return h('input.v9-input', {
    type: opts.type || 'text',
    id: opts.id || null,
    value: opts.value === null || opts.value === undefined ? '' : opts.value,
    placeholder: opts.placeholder || '',
    min: opts.min === undefined ? null : opts.min,
    max: opts.max === undefined ? null : opts.max,
    step: opts.step === undefined ? null : opts.step,
    disabled: Boolean(opts.disabled),
    readonly: Boolean(opts.readOnly),
    oninput: opts.onInput,
    onchange: opts.onChange
  });
}

export function checkbox(options) {
  const opts = isPlainObject(options) ? options : {};
  return h('input.v9-checkbox', {
    type: 'checkbox',
    id: opts.id || null,
    checked: Boolean(opts.checked),
    disabled: Boolean(opts.disabled),
    onchange: opts.onChange
  });
}

/**
 * Auswahlfeld. `options` ist eine Liste aus {value,label} oder Strings.
 */
export function select(options) {
  const opts = isPlainObject(options) ? options : {};
  const node = h('select.v9-select', {
    id: opts.id || null,
    multiple: Boolean(opts.multiple),
    size: opts.size || null,
    disabled: Boolean(opts.disabled),
    onchange: opts.onChange
  });
  if (opts.placeholder) {
    node.appendChild(h('option', { value: '', text: opts.placeholder }));
  }
  ensureArray(opts.items).forEach(function (item) {
    const value = isPlainObject(item) ? item.value : item;
    const label = isPlainObject(item) ? item.label : item;
    const option = h('option', { value: toText(value), text: toText(label) });
    if (opts.multiple) {
      option.selected = ensureArray(opts.value).map(toText).indexOf(toText(value)) >= 0;
    } else {
      option.selected = toText(opts.value) === toText(value);
    }
    node.appendChild(option);
  });
  return node;
}

export function textarea(options) {
  const opts = isPlainObject(options) ? options : {};
  const node = h('textarea.v9-textarea', {
    id: opts.id || null,
    rows: opts.rows || 6,
    placeholder: opts.placeholder || '',
    spellcheck: 'false',
    oninput: opts.onInput,
    onchange: opts.onChange
  });
  node.value = toText(opts.value);
  return node;
}

/**
 * Tabelle aus Spaltenbeschreibung und Zeilen.
 * columns: [{ key, label, align, render(row, index) }]
 */
export function table(columns, rows, options) {
  const opts = isPlainObject(options) ? options : {};
  const head = h('thead', null, h('tr', null, ensureArray(columns).map(function (column) {
    return h('th' + (column.align ? '.v9-align-' + column.align : ''), { text: column.label });
  })));
  const body = h('tbody', null, ensureArray(rows).map(function (row, index) {
    const tr = h('tr', {
      dataset: opts.rowKey ? { key: toText(row[opts.rowKey]) } : null,
      onclick: opts.onRowClick ? function () { opts.onRowClick(row, index); } : null,
      class: opts.rowClass ? opts.rowClass(row, index) : null
    }, ensureArray(columns).map(function (column) {
      const content = column.render ? column.render(row, index) : toText(row[column.key]);
      return h('td' + (column.align ? '.v9-align-' + column.align : ''), null,
        content instanceof Node ? content : text(content));
    }));
    return tr;
  }));
  if (!ensureArray(rows).length) {
    body.appendChild(h('tr.v9-table__empty', null,
      h('td', { colspan: ensureArray(columns).length, text: opts.emptyText || 'Keine Einträge' })));
  }
  return h('div.v9-table__wrap', null, h('table.v9-table', null, head, body));
}

/** Beschreibungsliste für Detailansichten. */
export function definitionList(entries) {
  return h('dl.v9-dl', null, ensureArray(entries).map(function (entry) {
    return [
      h('dt', { text: entry[0] }),
      h('dd', null, entry[1] instanceof Node ? entry[1] : text(entry[1]))
    ];
  }));
}

/** Ein-/ausklappbarer Abschnitt. */
export function disclosure(title, children, options) {
  const opts = isPlainObject(options) ? options : {};
  const node = h('details.v9-disclosure', { open: opts.open !== false },
    h('summary.v9-disclosure__summary', { text: title }),
    h('div.v9-disclosure__body', null, children));
  return node;
}

/** Kopfzeile eines Panels. */
export function toolbar(children) {
  return h('div.v9-toolbar', null, children);
}

/** Statusleiste mit Fehler-/Warnungszähler. */
export function statusStrip(report) {
  const errors = report ? report.errors.length : 0;
  const warnings = report ? report.warnings.length : 0;
  const tone = errors ? 'danger' : (warnings ? 'warn' : 'ok');
  return h('div.v9-status.v9-status--' + tone, null,
    badge(errors ? 'FEHLER' : (warnings ? 'HINWEISE' : 'GUELTIG'), tone),
    h('span.v9-status__text', {
      text: errors + ' Fehler · ' + warnings + ' Hinweise'
    }));
}

/* -------------------------------------------------------------------------
 * Modal
 * ---------------------------------------------------------------------- */

/**
 * Modaler Dialog. Liefert { close }.
 * onSubmit erhält den Body-Knoten; gibt es false zurück, bleibt der Dialog offen.
 */
export function modal(options) {
  const opts = isPlainObject(options) ? options : {};
  const body = h('div.v9-modal__body', null, opts.body);

  function close() {
    document.removeEventListener('keydown', onKey, true);
    if (root.parentNode) root.parentNode.removeChild(root);
    if (typeof opts.onClose === 'function') opts.onClose();
  }

  function submit() {
    if (typeof opts.onSubmit === 'function' && opts.onSubmit(body) === false) return;
    close();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  const footer = h('div.v9-modal__foot', null,
    opts.extraActions || null,
    button(opts.cancelLabel || 'Abbrechen', { variant: 'ghost', onClick: close }),
    opts.onSubmit ? button(opts.submitLabel || 'Uebernehmen',
      { variant: 'primary', onClick: submit }) : null);

  const root = h('div.v9-modal', { role: 'dialog', 'aria-modal': 'true' },
    h('div.v9-modal__backdrop', { onclick: close }),
    h('div.v9-modal__panel' + (opts.wide ? '.v9-modal__panel--wide' : ''), null,
      h('div.v9-modal__head', null,
        h('h3.v9-modal__title', { text: opts.title || '' }),
        h('button.v9-modal__close', { type: 'button', 'aria-label': 'Schließen',
          onclick: close, text: '×' })),
      body, footer));

  document.body.appendChild(root);
  document.addEventListener('keydown', onKey, true);
  const focusable = root.querySelector('input, select, textarea, button');
  if (focusable) focusable.focus();
  return { close, body, root };
}

/** Kurze Rückmeldung am unteren Bildrand. */
export function toast(message, tone, durationMs) {
  let host = document.getElementById('v9-toast-host');
  if (!host) {
    host = h('div.v9-toast-host#v9-toast-host', { 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const node = h('div.v9-toast.v9-toast--' + (tone || 'info'), { text: toText(message) });
  host.appendChild(node);
  setTimeout(function () {
    node.classList.add('v9-toast--out');
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 220);
  }, durationMs || 3200);
  return node;
}
