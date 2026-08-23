/**
 * v9_store.js — zentraler Config-Store mit Promise-Cache.
 *
 * Behebt den Kernfehler der V50-Architektur: dort luden device.js,
 * processes.js und rules_generator.js die Gerätekonfiguration jeweils
 * eigenständig per HTTP und überschrieben sich gegenseitig im AppState
 * (drei Requests, eine Race Condition, verlorene Nutzereingaben).
 *
 * Hier gilt: EIN Loader, N Konsumenten. Der Store hält
 *   * die kanonische V9-Config,
 *   * die Editor-Projektion (Kompatibilität zu den Altmodulen),
 *   * einen Validierungsbericht,
 *   * eine Undo-Historie der Config-Mutationen.
 *
 * Stil: rein funktional, kein OOP. Der Store ist eine Closure, keine Klasse.
 */

'use strict';

import { orderSections, SECTION_ORDER } from './v9_schema.js';
import { validateConfig } from './v9_validate.js';
import {
  migrateLegacyConfig, isV9Config, toEditorProjection, fromEditorProjection
} from './v9_migrate.js';
import {
  addEntity, removeEntity, updateEntity, createEmptyV9Config, reconcile
} from './v9_factory.js';
import { deepClone, canonicalJson, ensureArray, isPlainObject, toText } from './shared_utils.js';
import { collectFloatLiterals, formatConfig } from './v9_json_format.js';

const HISTORY_LIMIT = 60;

function createEmptyState() {
  return {
    config: null,
    projection: null,
    report: null,
    source: '',
    dirty: false,
    revision: 0,
    history: [],
    historyIndex: -1,
    migrationReport: [],
    floatHints: null,
    // Der Rohtext, wie er vom Server kam. Nur er trägt die
    // Gleitkomma-Literale, an denen der Runtime-Fingerprint hängt — deshalb
    // ist er die Primärquelle für Konfigurations-Snapshots.
    sourceText: '',
    fingerprint: ''
  };
}

const state = createEmptyState();
const listeners = new Map();
let loadPromise = null;

/* -------------------------------------------------------------------------
 * Ereignisse
 * ---------------------------------------------------------------------- */

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return function off() { listeners.get(event).delete(handler); };
}

function emit(event, payload) {
  const bucket = listeners.get(event);
  if (!bucket) return;
  bucket.forEach(function (handler) {
    try {
      handler(payload);
    } catch (error) {
      console.error('[v9_store] Listener-Fehler bei "' + event + '":', error);
    }
  });
}

/* -------------------------------------------------------------------------
 * Laden
 * ---------------------------------------------------------------------- */

// `?format=text` liefert die Datei im kanonischen Lesbarkeitsformat statt
// einer kompakten Serialisierung. Das ist nicht Kosmetik: der Rohtext ist die
// Primärquelle für Konfigurations-Snapshots, und ein Snapshot soll die DATEI
// enthalten, nicht eine andere Schreibweise desselben Inhalts.
const CANDIDATE_URLS = [
  '/api/v9/config?format=text',
  '/api/device-config'
];

/**
 * Lädt als TEXT, nicht als JSON. Grund: `response.json()` verliert die
 * Information, ob `1000` oder `1000.0` in der Datei stand. Der Fingerprint der
 * Runtime unterscheidet beides — deshalb merkt sich der Store die
 * Schreibweise beim Laden und reicht sie beim Schreiben zurück.
 */
async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(url + ' -> HTTP ' + response.status);
  const text = await response.text();
  state.floatHints = collectFloatLiterals(text);
  state.sourceText = text;
  state.fingerprint = toText(response.headers.get('X-Config-Fingerprint'));
  return JSON.parse(text);
}

/**
 * Der Originaltext der geladenen Config.
 *
 * Nur solange gültig, wie nichts verändert wurde: sobald der Store eine
 * Mutation verzeichnet, beschreibt der Text einen überholten Stand und wäre
 * als Snapshot irreführend.
 */
export function getSourceText() {
  return state.dirty ? '' : state.sourceText;
}

/** Der vom Server gemeldete Fingerprint, falls vorhanden. */
export function getFingerprint() {
  return state.dirty ? '' : state.fingerprint;
}

/**
 * Lädt die Config genau einmal. Weitere Aufrufe erhalten dasselbe Promise.
 * Legacy-Configs werden transparent nach V9 migriert.
 */
export function load(options) {
  if (loadPromise && !(options && options.force)) return loadPromise;
  loadPromise = (async function () {
    let raw = null;
    let source = '';
    for (let i = 0; i < CANDIDATE_URLS.length; i += 1) {
      try {
        raw = await fetchJson(CANDIDATE_URLS[i]);
        source = CANDIDATE_URLS[i];
        break;
      } catch (error) {
        raw = null;
      }
    }
    if (!raw) {
      adopt(createEmptyV9Config({}), '(leer — kein Server erreichbar)', []);
      return getState();
    }
    if (isV9Config(raw)) {
      adopt(raw, source, []);
      return getState();
    }
    const migrated = migrateLegacyConfig(raw, { scope: 'master_global' });
    adopt(migrated.config, source + ' (Legacy → V9 migriert)', migrated.report);
    return getState();
  })();
  return loadPromise;
}

/** Setzt eine Config als aktuellen Stand (ohne Server-Roundtrip). */
export function adopt(config, source, migrationReport) {
  const next = orderSections(deepClone(config));
  reconcile(next);
  state.config = next;
  state.projection = toEditorProjection(next);
  state.report = validateConfig(next);
  state.source = toText(source);
  state.migrationReport = ensureArray(migrationReport);
  state.dirty = false;
  state.revision += 1;
  state.history = [canonicalJson(next)];
  state.historyIndex = 0;
  emit('config:loaded', getState());
  emit('config:changed', getState());
  return getState();
}

/* -------------------------------------------------------------------------
 * Zugriff
 * ---------------------------------------------------------------------- */

export function getConfig() {
  return state.config;
}

export function getProjection() {
  return state.projection;
}

export function getReport() {
  return state.report;
}

export function getMigrationReport() {
  return state.migrationReport;
}

export function getState() {
  return {
    config: state.config,
    projection: state.projection,
    report: state.report,
    source: state.source,
    dirty: state.dirty,
    revision: state.revision,
    canUndo: state.historyIndex > 0,
    canRedo: state.historyIndex >= 0 && state.historyIndex < state.history.length - 1
  };
}

export function section(name) {
  return ensureArray((state.config || {})[name]);
}

/* -------------------------------------------------------------------------
 * Mutation
 * ---------------------------------------------------------------------- */

function commit(next, reason) {
  const ordered = orderSections(next);
  reconcile(ordered);
  state.config = ordered;
  state.projection = toEditorProjection(ordered);
  state.report = validateConfig(ordered);
  state.dirty = true;
  state.revision += 1;

  const snapshot = canonicalJson(ordered);
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot);
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.historyIndex = state.history.length - 1;

  emit('config:changed', Object.assign(getState(), { reason: toText(reason) }));
  return getState();
}

/** Fügt eine Entity hinzu. */
export function add(sectionName, patch) {
  const result = addEntity(state.config, sectionName, patch);
  commit(result.config, 'add:' + sectionName);
  return result.row;
}

/** Aendert eine Entity. */
export function update(sectionName, keyValue, patch) {
  const result = updateEntity(state.config, sectionName, keyValue, patch);
  commit(result.config, 'update:' + sectionName);
  return result.row;
}

/** Entfernt eine Entity inkl. Kaskade. */
export function remove(sectionName, keyValue) {
  const result = removeEntity(state.config, sectionName, keyValue);
  commit(result.config, 'remove:' + sectionName);
  return result.removed;
}

/** Ersetzt eine komplette Sektion. */
export function replaceSection(sectionName, rows) {
  const next = deepClone(state.config);
  next[sectionName] = deepClone(ensureArray(rows));
  return commit(next, 'replace:' + sectionName);
}

/**
 * Replace multiple schema sections in one atomic commit and history entry.
 * Unknown extension keys are intentionally ignored at this contract boundary.
 */
export function replaceSections(patch) {
  const next = deepClone(state.config);
  const names = [];
  Object.keys(isPlainObject(patch) ? patch : {}).forEach(function (sectionName) {
    if (!SECTION_ORDER.includes(sectionName)) return;
    next[sectionName] = deepClone(ensureArray(patch[sectionName]));
    names.push(sectionName);
  });
  if (!names.length) return getState();
  return commit(next, 'replace:' + names.join('+'));
}

/** Uebernimmt Aenderungen, die die Altmodule an der Editor-Projektion gemacht haben. */
export function applyProjection(projection) {
  const next = fromEditorProjection(
    isPlainObject(projection) ? projection : state.projection, state.config);
  return commit(next, 'projection');
}

export function undo() {
  if (state.historyIndex <= 0) return getState();
  state.historyIndex -= 1;
  return restoreSnapshot('undo');
}

export function redo() {
  if (state.historyIndex >= state.history.length - 1) return getState();
  state.historyIndex += 1;
  return restoreSnapshot('redo');
}

function restoreSnapshot(reason) {
  const snapshot = JSON.parse(state.history[state.historyIndex]);
  state.config = orderSections(snapshot);
  state.projection = toEditorProjection(state.config);
  state.report = validateConfig(state.config);
  state.dirty = true;
  state.revision += 1;
  emit('config:changed', Object.assign(getState(), { reason }));
  return getState();
}

/* -------------------------------------------------------------------------
 * Persistenz
 * ---------------------------------------------------------------------- */

/** Speichert die Config auf dem Server (Server kanonisiert die Zahlentypen). */
export async function save(options) {
  const opts = isPlainObject(options) ? options : {};
  const report = validateConfig(state.config);
  if (report.status !== 'OK' && !opts.force) {
    const error = new Error('Config ist nicht kontraktkonform — '
      + report.errors.length + ' Fehler. Speichern abgebrochen.');
    error.report = report;
    throw error;
  }
  const response = await fetch('/api/v9/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: state.config, force: Boolean(opts.force) })
  });
  const payload = await response.json().catch(function () { return {}; });
  if (!response.ok || payload.status === 'error') {
    throw new Error(payload.message || ('Speichern fehlgeschlagen (HTTP ' + response.status + ')'));
  }
  state.dirty = false;
  emit('config:saved', Object.assign(getState(), { server: payload }));
  return payload;
}

/**
 * Formatiert beliebiges Config-JSON im kanonischen Lesbarkeitsformat der
 * Runtime — inklusive der beim Laden gemerkten Gleitkomma-Schreibweise.
 * EINE Stelle für Download, Vorschau und Zwischenablage.
 */
export function formatJson(payload) {
  return formatConfig(payload === undefined ? state.config : payload,
    { floatHints: state.floatHints });
}

/** Exportiert die Config als Download-Blob im Lesbarkeitsformat. */
export function toBlob(payload) {
  return new Blob([formatJson(payload)], { type: 'application/json' });
}

/** Importiert eine Config aus Text (V9 oder Legacy). */
export function importFromText(text, options) {
  const source = toText(text);
  state.floatHints = collectFloatLiterals(source);
  state.sourceText = source;
  state.fingerprint = '';
  const parsed = JSON.parse(source);
  if (isV9Config(parsed)) return adopt(parsed, (options && options.source) || 'Import', []);
  const migrated = migrateLegacyConfig(parsed, { scope: 'master_global' });
  return adopt(migrated.config, ((options && options.source) || 'Import') + ' (Legacy → V9)',
    migrated.report);
}

/** Setzt den Store zurück (Tests). */
export function reset() {
  Object.assign(state, createEmptyState());
  loadPromise = null;
}
