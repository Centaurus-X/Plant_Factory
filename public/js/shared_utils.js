/**
 * shared_utils.js — gemeinsame Helfer für alle Module.
 *
 * Ersetzt die bisher 25-fach duplizierten Kopien von deepClone/byId/escapeHtml/
 * toNumberOrNull/ensureArray/isPlainObject/uniq. Die Altmodule behalten ihre
 * lokalen Kopien (minimal-invasiv); neue Module nutzen ausschließlich diese
 * Implementierung.
 *
 * Behobene Altfehler gegenüber den Kopien:
 *   * escapeHtml(0) lieferte '' (hmi.js:4262 `String(s || '')`) — hier korrekt.
 *   * toNumberOrNull('') lieferte teils 0 — hier konsequent null.
 *
 * Stil: rein funktional, kein OOP.
 */
'use strict';
export function byId(id) {
    return document.getElementById(id);
}
export function qs(selector, root) {
    return (root || document).querySelector(selector);
}
export function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
}
export function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function ensureArray(value) {
    if (Array.isArray(value))
        return value;
    if (value === null || value === undefined)
        return [];
    return [value];
}
export function deepClone(value) {
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(deepClone);
    const out = {};
    Object.keys(value).forEach(function (key) { out[key] = deepClone(value[key]); });
    return out;
}
/** Stabiler Vergleich zweier JSON-artiger Strukturen. */
export function deepEqual(a, b) {
    return canonicalJson(a) === canonicalJson(b);
}
/** JSON mit sortierten Schlüsseln — Basis für Fingerprints/Vergleiche. */
export function canonicalJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return '[' + value.map(canonicalJson).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map(function (key) {
        return JSON.stringify(key) + ':' + canonicalJson(value[key]);
    }).join(',') + '}';
}
export function escapeHtml(value) {
    if (value === null || value === undefined)
        return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
export function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}
export function toNumberOrNull(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    const text = String(value).trim();
    if (text === '')
        return null;
    const parsed = Number(text.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}
export function toIntOrNull(value) {
    const parsed = toNumberOrNull(value);
    if (parsed === null)
        return null;
    const rounded = Math.trunc(parsed);
    return Number.isFinite(rounded) ? rounded : null;
}
export function toBool(value, fallback) {
    if (typeof value === 'boolean')
        return value;
    if (value === null || value === undefined)
        return Boolean(fallback);
    const text = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'ja', 'on'].indexOf(text) >= 0)
        return true;
    if (['false', '0', 'no', 'nein', 'off'].indexOf(text) >= 0)
        return false;
    return Boolean(fallback);
}
export function toText(value, fallback) {
    if (value === null || value === undefined)
        return fallback === undefined ? '' : fallback;
    return String(value);
}
export function uniq(values) {
    return Array.from(new Set(ensureArray(values)));
}
/** Sortierte, eindeutige Ganzzahlliste. */
export function uniqInts(values) {
    const out = [];
    const seen = new Set();
    ensureArray(values).forEach(function (value) {
        const parsed = toIntOrNull(value);
        if (parsed === null || seen.has(parsed))
            return;
        seen.add(parsed);
        out.push(parsed);
    });
    return out.sort(function (a, b) { return a - b; });
}
/** Index einer Zeilenliste nach Schlüsselfeld. */
export function indexBy(rows, key) {
    const out = new Map();
    ensureArray(rows).forEach(function (row) {
        if (isPlainObject(row) && row[key] !== undefined && row[key] !== null) {
            out.set(row[key], row);
        }
    });
    return out;
}
/** Gruppiert Zeilen nach dem Ergebnis von keyOf(row). */
export function groupBy(rows, keyOf) {
    const out = new Map();
    ensureArray(rows).forEach(function (row) {
        const key = keyOf(row);
        if (!out.has(key))
            out.set(key, []);
        out.get(key).push(row);
    });
    return out;
}
/** Nächste freie numerische ID einer Tabelle. */
export function nextNumericId(rows, key, start) {
    let max = (start === undefined ? 1 : start) - 1;
    ensureArray(rows).forEach(function (row) {
        const value = toIntOrNull(isPlainObject(row) ? row[key] : row);
        if (value !== null && value > max)
            max = value;
    });
    return max + 1;
}
/** Kollisionsfreie String-ID auf Basis eines Präfixes. */
export function nextStringId(existing, base) {
    const taken = new Set(ensureArray(existing).map(String));
    if (!taken.has(base))
        return base;
    let counter = 2;
    while (taken.has(base + '_' + counter))
        counter += 1;
    return base + '_' + counter;
}
/** Wert entlang eines Pfads lesen ('a.b.0.c'). */
export function getPath(root, path) {
    const parts = String(path).split('.');
    let node = root;
    for (let i = 0; i < parts.length; i += 1) {
        if (node === null || node === undefined)
            return undefined;
        node = node[parts[i]];
    }
    return node;
}
/** Zahl auf einen Bereich begrenzen. */
export function clamp(value, min, max) {
    if (typeof min === 'number' && value < min)
        return min;
    if (typeof max === 'number' && value > max)
        return max;
    return value;
}
/** Rundet auf n Nachkommastellen (ohne Float-Rauschen). */
export function round(value, decimals) {
    const factor = Math.pow(10, decimals || 0);
    return Math.round(value * factor) / factor;
}
/**
 * Debounce. Bewusst ohne `this`-Weiterreichung — V53 ist durchgehend
 * funktional, Kontextbindung gibt es hier nicht mehr.
 */
export function debounce(fn, waitMs) {
    let handle = null;
    return function debounced(...args) {
        if (handle !== null)
            clearTimeout(handle);
        handle = setTimeout(function () {
            handle = null;
            fn(...args);
        }, waitMs || 0);
    };
}
/** Kurzt einen String mit Ellipse. */
export function shrinkText(value, maxLength) {
    const text = toText(value);
    const limit = maxLength || 120;
    return text.length <= limit ? text : text.slice(0, limit - 1) + '…';
}
/** JSON-Parse ohne Wurf. */
export function safeJsonParse(text, fallback) {
    try {
        return JSON.parse(text);
    }
    catch (error) {
        return fallback === undefined ? null : fallback;
    }
}
/** Formatiert JSON lesbar (2 Leerzeichen). */
export function pretty(value) {
    try {
        return JSON.stringify(value, null, 2);
    }
    catch (error) {
        return String(value);
    }
}
