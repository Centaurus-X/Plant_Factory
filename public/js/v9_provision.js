/**
 * v9_provision.js — sinnvolle Vorbelegung unvollständig überlieferter Zeilen.
 *
 * Spiegel von `_tools/provision_defaults.py`. Beide Seiten müssen dieselben
 * Werte erzeugen, sonst weicht die Browser-Migration von der Server-Migration
 * ab (Regressionstest: test/test_v9_core.mjs).
 *
 * Das Problem, das hier gelöst wird
 * ---------------------------------
 * An zwei Stellen entstehen Zeilen ohne Pflichtfelder:
 *
 *   1. Migration V50 → V9: die Alt-Config verweist auf Controller- und
 *      Prozess-IDs, zu denen es keinen Datensatz gibt.
 *   2. Rückführung eines V8-Cross-Shards in den Master: der Cross-Vertrag
 *      verbietet Physik, der Master verlangt sie.
 *
 * Bis V53 entstanden daraus tote Platzhalter — `host = "0.0.0.0"`,
 * `unconfigured_process_6`. Formal gültig, praktisch unbrauchbar: ein
 * Controller auf 0.0.0.0 verbindet nie, ein Prozess ohne Namen sagt niemandem,
 * was er tut.
 *
 * Stattdessen leitet dieses Modul die Werte aus dem ANLAGENKONTEXT ab:
 * Bustyp, Port, Unit und Funktionstyp per Mehrheit der Geschwister, die
 * IP-Adresse aus dem Adressmuster der Anlage, die Feldbusadresse als nächste
 * freie Adresse auf demselben Controller. Das Ergebnis fügt sich in die Anlage
 * ein und bleibt über `tags` und `description` als provisioniert erkennbar.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { ensureArray, isPlainObject, toText, toIntOrNull } from './shared_utils.js';

export const PROVISION_TAG = 'provisioned';

/**
 * Nicht routbarer Platzhalter-Host aus V52/V53. Er zählt hier als LEER —
 * sonst bliebe ein Controller für immer auf einer Adresse stehen, die nie
 * antwortet, nur weil das Feld formal belegt ist.
 */
export const UNCONFIGURED_HOSTS = Object.freeze(['0.0.0.0', '', '0']);

/**
 * Letztes Oktett = HOST_OCTET_BASE + controller_id. Reproduziert die
 * Adressvergabe der Bestandsflotte (wago_1 → .51, wago_4 → .54, wago_5 → .55).
 */
export const HOST_OCTET_BASE = 50;

export const CONTROLLER_FALLBACK = Object.freeze({
  bus_type: 'modbus',
  host: '192.168.0.1',
  port: 502,
  unit: '0x1'
});

export const IO_ADDRESS_BASE = Object.freeze({ sensors: 1, actuators: 512 });

export const IO_FUNCTION_FALLBACK = Object.freeze({
  sensors: 'read_holding_registers',
  actuators: 'write_register'
});

export const PROCESS_NAME_PREFIX = 'reserved_process';

export const PROVISION_NOTE_CONTROLLER =
  'Automatisch provisioniert aus dem Anlagenkontext — Endpunkt vor '
  + 'Inbetriebnahme pruefen.';
export const PROVISION_NOTE_IO =
  'Automatisch provisioniert aus dem Anlagenkontext — Feldbusadresse vor '
  + 'Inbetriebnahme pruefen.';
export const PROVISION_NOTE_PROCESS =
  'Reservierter Prozessplatz: wird von Prozesszustaenden referenziert, hatte '
  + 'in der Altkonfiguration aber keinen eigenen Datensatz.';

/* -------------------------------------------------------------------------
 * Generische Helfer
 * ---------------------------------------------------------------------- */

export function isBlank(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function marker(value) {
  return JSON.stringify(value === undefined ? null : value);
}

/** Häufigster Wert einer Liste; bei Gleichstand der zuerst gesehene. */
export function majorityValue(values, fallback) {
  const counts = new Map();
  const order = [];
  ensureArray(values).forEach(function (value) {
    if (isBlank(value)) return;
    const key = marker(value);
    if (!counts.has(key)) { counts.set(key, { count: 0, value: value }); order.push(key); }
    counts.get(key).count += 1;
  });
  if (!order.length) return fallback;
  let best = order[0];
  order.forEach(function (key) {
    if (counts.get(key).count > counts.get(best).count) best = key;
  });
  return counts.get(best).value;
}

function numericValues(rows, field) {
  const out = [];
  ensureArray(rows).forEach(function (row) {
    const value = toIntOrNull(row[field]);
    if (value !== null) out.push(value);
  });
  return out;
}

function addTag(row, tag) {
  const tags = ensureArray(row.tags).slice();
  if (tags.indexOf(tag) < 0) tags.push(tag);
  row.tags = tags;
  return row;
}

/* -------------------------------------------------------------------------
 * Controller
 * ---------------------------------------------------------------------- */

/** Freie IP aus dem Adressmuster der Geschwistercontroller. */
export function deriveHost(siblings, controllerId, taken) {
  const prefixes = [];
  ensureArray(siblings).forEach(function (row) {
    const host = toText(row.host);
    if (host.split('.').length === 4 && UNCONFIGURED_HOSTS.indexOf(host) < 0
        && host !== CONTROLLER_FALLBACK.host) {
      prefixes.push(host.slice(0, host.lastIndexOf('.')));
    }
  });
  const prefix = majorityValue(prefixes,
    CONTROLLER_FALLBACK.host.slice(0, CONTROLLER_FALLBACK.host.lastIndexOf('.')));
  const wanted = toIntOrNull(controllerId);
  let octet = HOST_OCTET_BASE + (wanted === null ? 1 : wanted);
  octet = Math.min(Math.max(octet, 2), 254);
  const used = taken instanceof Set ? taken : new Set(ensureArray(taken));
  while (used.has(prefix + '.' + octet) && octet < 254) octet += 1;
  return prefix + '.' + octet;
}

/**
 * Ergänzt fehlende Endpunktfelder eines Controllers.
 * Mutiert `row` und liefert die Liste der gefüllten Felder.
 */
export function provisionController(row, siblings, note) {
  const usable = ensureArray(siblings).filter(function (item) {
    return !isBlank(item.host);
  });
  const taken = new Set(ensureArray(siblings).map(function (item) {
    return toText(item.host);
  }));
  const filled = [];
  ['bus_type', 'host', 'port', 'unit'].forEach(function (field) {
    const placeholder = field === 'host'
      && UNCONFIGURED_HOSTS.indexOf(toText(row[field])) >= 0;
    if (!isBlank(row[field]) && !placeholder) return;
    if (field === 'host') {
      row[field] = deriveHost(usable, row.controller_id, taken);
    } else {
      row[field] = majorityValue(usable.map(function (item) { return item[field]; }),
        CONTROLLER_FALLBACK[field]);
    }
    filled.push(field + '=' + marker(row[field]));
  });
  if (filled.length) {
    if (row.enabled === undefined) row.enabled = true;
    if (isBlank(row.description)) row.description = note || PROVISION_NOTE_CONTROLLER;
    addTag(row, PROVISION_TAG);
  }
  return filled;
}

/* -------------------------------------------------------------------------
 * Sensoren / Aktoren
 * ---------------------------------------------------------------------- */

/** Nächste freie Adresse — erst auf dem Controller, dann anlagenweit. */
export function nextFreeAddress(section, allRows, controllerUuid) {
  const used = new Set(numericValues(allRows, 'address'));
  const same = ensureArray(allRows).filter(function (row) {
    return toText(row.controller_uuid) === toText(controllerUuid);
  });
  const candidates = numericValues(same, 'address').length
    ? numericValues(same, 'address')
    : numericValues(allRows, 'address');
  let address = candidates.length
    ? Math.max.apply(null, candidates) + 1
    : (IO_ADDRESS_BASE[section] || 1);
  while (used.has(address)) address += 1;
  return address;
}

/** Ergänzt fehlende Feldbus-Koordinaten einer I/O-Zeile. */
export function provisionIo(section, row, allRows, note) {
  const peers = ensureArray(allRows).filter(function (item) {
    return item !== row && !isBlank(item.bus_type);
  });
  const filled = [];
  ['address', 'bus_type', 'function_type'].forEach(function (field) {
    if (!isBlank(row[field])) return;
    if (field === 'address') {
      row[field] = nextFreeAddress(section, allRows, row.controller_uuid);
    } else if (field === 'bus_type') {
      row[field] = majorityValue(peers.map(function (item) { return item.bus_type; }),
        CONTROLLER_FALLBACK.bus_type);
    } else {
      row[field] = majorityValue(peers.map(function (item) { return item.function_type; }),
        IO_FUNCTION_FALLBACK[section] || 'read_holding_registers');
    }
    filled.push(field + '=' + marker(row[field]));
  });
  if (filled.length) {
    if (row.enabled === undefined) row.enabled = true;
    if (isBlank(row.description)) row.description = note || PROVISION_NOTE_IO;
  }
  return filled;
}

/* -------------------------------------------------------------------------
 * Prozesse
 * ---------------------------------------------------------------------- */

/** Gibt einem reservierten Prozessplatz einen sprechenden Namen und Ort. */
export function provisionProcess(row, siblings, note) {
  const filled = [];
  if (isBlank(row.process_name)
      || toText(row.process_name).indexOf('unconfigured_process') === 0) {
    row.process_name = PROCESS_NAME_PREFIX + '_' + row.p_id;
    filled.push('process_name=' + marker(row.process_name));
  }
  if (isBlank(row.process_location)) {
    row.process_location = majorityValue(ensureArray(siblings).map(function (item) {
      return item.process_location;
    }), 'Main Reactor');
    filled.push('process_location=' + marker(row.process_location));
  }
  if (isBlank(row.enabled)) {
    row.enabled = false;
    filled.push('enabled=false');
  }
  if (filled.length && isBlank(row.description)) {
    row.description = note || PROVISION_NOTE_PROCESS;
  }
  return filled;
}
