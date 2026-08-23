/**
 * hmi_snapshot.js — die V9-Konfiguration reist im SVG mit.
 *
 * Die Idee
 * --------
 * Bisher gab es zwei getrennte Artefakte: das Anlagenbild (SVG + HMI) und den
 * Automatisierungsvertrag (`device_state_data_v9.json`). Wer aus dem Bild die
 * Config zurückrechnen wollte, stand vor einer Frage, die niemand beantworten
 * kann: welche Seite gewinnt, wenn beide dieselbe Entität beschreiben?
 *
 * Der Snapshot dreht das um. Statt die Config aus dem Bild zu REKONSTRUIEREN,
 * legt der Export sie WÖRTLICH mit ins SVG. Damit ist die Frage nach der
 * Vorherrschaft gegenstandslos — es gibt keine zweite Wahrheit, nur eine Kopie.
 *
 * Was das löst:
 *
 *   * Wiederherstellung 1:1, byte-genau, mit unverändertem Fingerprint.
 *   * Das SVG wird selbsttragend: Anlagenbild UND Vertrag in einer Datei.
 *   * Ist die Worker-Config verloren, genügt das SVG zum Wiederanlauf.
 *
 * Warum der Klartext und keine Kompression
 * ----------------------------------------
 * Ein Snapshot ist eine Notfallmaßnahme. Er muss auch dann noch lesbar sein,
 * wenn kein Werkzeug dieser Codebasis mehr zur Hand ist — mit `grep`, mit
 * einem Texteditor, mit `sed`. gzip+Base64 spart etwa 80 % Platz und kostet
 * genau diese Eigenschaft. Bei ~30 kB je Config ist der Handel eindeutig.
 *
 * Warum der ORIGINALTEXT und nicht das geparste Objekt
 * ----------------------------------------------------
 * `JSON.parse("1000.0")` liefert `1000`. Der Fingerprint der Runtime hasht
 * aber die kanonischen Bytes, und dort sind `1000` und `1000.0` verschieden.
 * Ein aus dem geparsten Objekt wiederhergestellter Snapshot hätte deshalb
 * einen anderen Fingerprint als das Original — und Authority V5 würde die
 * Wiederherstellung als Abweichung werten. Der Snapshot trägt daher den
 * Dateitext, so wie er war.
 *
 * Wo im SVG
 * ---------
 * In `<metadata>`, dem vom SVG-Standard dafür vorgesehenen Ort: er wird nicht
 * gerendert, nicht ausgeführt, und Browser wie Vektoreditoren erhalten ihn beim
 * Öffnen und Speichern. Der Inhalt steht in einem CDATA-Abschnitt, damit
 * JSON-Sonderzeichen den XML-Parser nicht stören.
 *
 * Alles synchron: `crypto.subtle` waere asynchron und nur in Secure Contexts
 * verfuegbar. Ein Snapshot muss sich aber auch aus einem per `file://`
 * geoeffneten SVG pruefen lassen — genau der Fall, fuer den er gedacht ist.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import { sha256Hex } from './v9_uuid.js';
import { collectFloatLiterals } from './v9_json_format.js';

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_KIND = 'plant_factory_config_snapshot';
export const SNAPSHOT_NAMESPACE = 'urn:plantfactory:snapshot:1';
export const SNAPSHOT_TAG = 'plantfactory:snapshot';

/** Rollen, die ein eingebetteter Konfigurationsstand haben kann. */
export const SNAPSHOT_ROLES = Object.freeze({
  master: 'master_global',
  node: 'node_local',
  cross: 'cross'
});

/* -------------------------------------------------------------------------
 * Snapshot bauen
 * ---------------------------------------------------------------------- */

function roleOf(meta) {
  const scope = String((meta || {}).scope || '').trim();
  if (scope.indexOf('cross') === 0) return SNAPSHOT_ROLES.cross;
  if (scope === 'master_global') return SNAPSHOT_ROLES.master;
  return SNAPSHOT_ROLES.node;
}

/**
 * Beschreibt EINEN Konfigurationsstand für den Snapshot.
 *
 * @param {string} text        Der Dateitext, wörtlich. Primäre Quelle.
 * @param {object} [options]   `source` (woher), `fingerprint` (vom Server),
 *                             `authority` ({authority_epoch, scope_revision}).
 */
export function describeConfig(text, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const payload = String(text === undefined || text === null ? '' : text);
  let config = null;
  try {
    config = JSON.parse(payload);
  } catch (error) {
    throw new Error('Snapshot: Konfigurationstext ist kein gültiges JSON — ' + error.message);
  }
  const meta = (Array.isArray(config.meta) ? config.meta[0] : config.meta) || {};

  const entry = {
    role: opts.role || roleOf(meta),
    scope: String(meta.scope || ''),
    version: Number(meta.version) || null,
    node_id: String(meta.node_id || ''),
    owner_node_id: String(meta.owner_node_id || ''),
    domain_id: String(meta.domain_id || ''),
    source: String(opts.source || ''),
    section_counts: countSections(config),
    // Der Fingerprint der Runtime, falls der Server ihn geliefert hat. Sonst
    // lokal über dieselbe Regel gebildet: sha256 der kanonischen Bytes.
    // Die Gleitkomma-Schreibweise kommt aus dem ROHTEXT — nur damit stimmt der
    // lokal gebildete Fingerprint mit dem der Runtime ueberein.
    fingerprint: String(opts.fingerprint || '')
      || localFingerprint(config, collectFloatLiterals(payload)),
    fingerprint_source: opts.fingerprint ? 'server' : 'local',
    // Prüfsumme des eingebetteten TEXTES. Sie beantwortet eine andere Frage
    // als der Fingerprint: ob die Bytes im SVG unverfälscht sind.
    text_sha256: sha256Hex(payload),
    text_bytes: payload.length,
    text: payload
  };
  // Die Authority-Baseline entscheidet später über "veraltet" oder "neuer".
  // Sie kommt entweder vom Server oder — als Rückfall — aus der meta-Zeile.
  // Ohne sie bliebe nur der Fingerprint, und der sagt nur DASS etwas anders
  // ist, nicht in welche Richtung.
  const given = opts.authority && typeof opts.authority === 'object' ? opts.authority : {};
  entry.authority = {
    authority_epoch: firstNumber(given.authority_epoch, meta.authority_epoch),
    scope_revision: firstNumber(given.scope_revision, meta.scope_revision),
    execution_epoch: firstNumber(given.execution_epoch, meta.execution_epoch),
    source: Object.keys(given).length ? 'server' : 'meta'
  };
  return entry;
}

/** Erster Wert, der eine echte Ganzzahl ist (bool zählt nicht). */
export function firstNumber() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (typeof value === 'boolean') continue;
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      return parseInt(value.trim(), 10);
    }
  }
  return null;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function countSections(config) {
  const out = {};
  Object.keys(config || {}).forEach(function (section) {
    if (Array.isArray(config[section])) out[section] = config[section].length;
  });
  return out;
}

/**
 * Fingerprint nach der Regel der Runtime: sha256 über die kanonischen Bytes
 * (`json.dumps(sort_keys=True, separators=(",", ":"))`).
 *
 * Achtung: im Browser gehen Gleitkomma-Literale beim Parsen verloren, der lokal
 * berechnete Wert kann daher von dem der Runtime abweichen. Deshalb wird er nur
 * als Rückfall verwendet und über `fingerprint_source` als solcher markiert.
 */
export function localFingerprint(config, floatHints) {
  return sha256Hex(canonicalJsonText(config, floatHints));
}

/**
 * Kanonische Bytes: Schlüssel sortiert, keine Leerzeichen.
 *
 * `floatHints` ist die Menge der Pfade, an denen in der Quelldatei ein
 * Gleitkomma-Literal stand (`collectFloatLiterals` aus v9_json_format.js).
 * Ohne sie schreibt JavaScript `1000` statt `1000.0` — und der Fingerprint
 * weicht von dem der Runtime ab, obwohl inhaltlich nichts anders ist.
 */
export function canonicalJsonText(value, floatHints, path) {
  const hints = floatHints instanceof Set ? floatHints : null;
  const at = path === undefined ? '' : path;

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (hints && hints.has(at) && Number.isInteger(value)) return String(value) + '.0';
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(function (item, index) {
      return canonicalJsonText(item, hints, at ? at + '.' + index : String(index));
    }).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(function (key) {
    return JSON.stringify(key) + ':'
      + canonicalJsonText(value[key], hints, at ? at + '.' + key : key);
  }).join(',') + '}';
}

/**
 * Baut den vollständigen Snapshot.
 *
 * @param {Array} entries   Ergebnisse von `describeConfig()`.
 * @param {object} [options] `project`, `capturedAt` (ISO), `producer`, `notes`.
 */
export function buildSnapshot(entries, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const configs = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const snapshot = {
    snapshot_version: SNAPSHOT_VERSION,
    kind: SNAPSHOT_KIND,
    captured_at: String(opts.capturedAt || new Date().toISOString()),
    producer: String(opts.producer || 'Automated_SVG_Integration'),
    project: String(opts.project || ''),
    notes: String(opts.notes || ''),
    configs: configs
  };
  // Prüfsumme über die Nutzlast — erkennt Manipulation am Snapshot selbst.
  snapshot.payload_sha256 = sha256Hex(canonicalJsonText(configs));
  return snapshot;
}

/* -------------------------------------------------------------------------
 * In das SVG einbetten
 * ---------------------------------------------------------------------- */

/** XML-Entities auflösen — für den Fall ohne CDATA. */
function unescapeXml(text) {
  return String(text)
    .split('&lt;').join('<')
    .split('&gt;').join('>')
    .split('&quot;').join('"')
    .split('&apos;').join("'")
    .split('&#39;').join("'")
    .split('&amp;').join('&');
}

/** `]]>` darf in einem CDATA-Abschnitt nicht vorkommen — sicher aufteilen. */
function cdataSafe(text) {
  return String(text).split(']]>').join(']]]]><![CDATA[>');
}

/**
 * Legt den Snapshot in `<metadata>` ab. Mutiert `svgNode`.
 *
 * Ein vorhandener Snapshot wird ersetzt, nicht ergänzt: zwei
 * Konfigurationsstände in einer Datei wären eine Einladung, den falschen
 * wiederherzustellen.
 */
export function embedSnapshot(svgNode, snapshot) {
  if (!svgNode || !snapshot) return svgNode;
  const doc = svgNode.ownerDocument || document;
  const ns = 'http://www.w3.org/2000/svg';

  let metadata = svgNode.querySelector('metadata');
  if (!metadata) {
    metadata = doc.createElementNS(ns, 'metadata');
    svgNode.insertBefore(metadata, svgNode.firstChild);
  }

  // Nicht per querySelector suchen: der Doppelpunkt in "plantfactory:snapshot"
  // ist im CSS-Selektor der Trenner einer Pseudoklasse und wirft einen
  // SyntaxError. Die Kinderliste durchgehen ist ohnehin genauer.
  findSnapshotNodes(metadata).forEach(function (node) {
    if (node.parentNode) node.parentNode.removeChild(node);
  });

  const node = doc.createElementNS(SNAPSHOT_NAMESPACE, SNAPSHOT_TAG);
  // Kein manuelles xmlns:-Attribut — das Element wurde bereits im richtigen
  // Namensraum erzeugt, der Serializer schreibt die Deklaration selbst. Ein
  // handgesetztes "xmlns:..." wirft im echten DOM einen NamespaceError.
  node.setAttribute('version', String(SNAPSHOT_VERSION));
  node.setAttribute('captured-at', snapshot.captured_at);
  node.setAttribute('configs', String((snapshot.configs || []).length));
  // CDATA gibt es nur in XML-Dokumenten. Lebt das SVG in einer HTML-Seite —
  // der Normalfall im Editor — wirft `createCDATASection` einen
  // NotSupportedError. Dann wird ein Textknoten genommen; der Serializer
  // maskiert die Sonderzeichen, und `extractSnapshot()` löst sie wieder auf.
  const body = JSON.stringify(snapshot, null, 2);
  let payload = null;
  try {
    if (typeof doc.createCDATASection === 'function') {
      payload = doc.createCDATASection(cdataSafe(body));
    }
  } catch (error) {
    payload = null;
  }
  node.appendChild(payload || doc.createTextNode(body));
  metadata.appendChild(node);
  return svgNode;
}

/** Alle Snapshot-Elemente unterhalb eines Knotens — ohne CSS-Selektor. */
function findSnapshotNodes(parent) {
  const out = [];
  const children = parent && parent.childNodes ? parent.childNodes : [];
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    const name = String(child.nodeName || child.tagName || '');
    const local = String(child.localName || '');
    if (name === SNAPSHOT_TAG || local === 'snapshot') out.push(child);
  }
  return out;
}

/* -------------------------------------------------------------------------
 * Aus dem SVG lesen
 * ---------------------------------------------------------------------- */

/**
 * Holt den Snapshot aus einem SVG-Text.
 *
 * Bewusst ohne DOM-Parser: die Wiederherstellung muss auch dann funktionieren,
 * wenn das SVG an anderer Stelle beschädigt ist. Ein Textschnitt zwischen den
 * bekannten Marken kommt damit zurecht, ein XML-Parser nicht.
 */
export function extractSnapshot(svgText) {
  const text = String(svgText || '');
  const openTag = text.indexOf('<' + SNAPSHOT_TAG);
  if (openTag < 0) return null;
  const contentStart = text.indexOf('>', openTag);
  if (contentStart < 0) return null;
  const closeTag = text.indexOf('</' + SNAPSHOT_TAG + '>', contentStart);
  if (closeTag < 0) return null;

  let payload = text.slice(contentStart + 1, closeTag);
  const hadCdata = payload.indexOf('<![CDATA[') >= 0;
  payload = payload.split('<![CDATA[').join('').split(']]>').join('').trim();
  // Ohne CDATA hat der Serializer die Sonderzeichen maskiert — hier wieder
  // auflösen, sonst scheitert JSON.parse an einem &quot; mitten im Text.
  if (!hadCdata) payload = unescapeXml(payload);
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error('Snapshot im SVG ist beschädigt: ' + error.message);
  }
}

/**
 * Prüft einen gelesenen Snapshot auf Vollständigkeit und Unverfälschtheit.
 * Liefert `{ ok, errors, warnings, configs }`.
 */
export function verifySnapshot(snapshot) {
  const report = { ok: true, errors: [], warnings: [], configs: [] };
  if (!snapshot || typeof snapshot !== 'object') {
    report.ok = false;
    report.errors.push('Kein Snapshot vorhanden.');
    return report;
  }
  if (snapshot.kind !== SNAPSHOT_KIND) {
    report.ok = false;
    report.errors.push('Unbekannte Snapshot-Art: ' + String(snapshot.kind));
  }
  if (Number(snapshot.snapshot_version) > SNAPSHOT_VERSION) {
    report.warnings.push('Snapshot-Version ' + snapshot.snapshot_version
      + ' ist neuer als diese Fassung (' + SNAPSHOT_VERSION
      + ') — unbekannte Felder werden ignoriert.');
  }

  const configs = Array.isArray(snapshot.configs) ? snapshot.configs : [];
  if (!configs.length) {
    report.ok = false;
    report.errors.push('Der Snapshot enthält keine Konfiguration.');
    return report;
  }

  const expected = sha256Hex(canonicalJsonText(configs));
  if (snapshot.payload_sha256 && snapshot.payload_sha256 !== expected) {
    report.ok = false;
    report.errors.push('Die Nutzlast wurde nach dem Erzeugen verändert '
      + '(payload_sha256 stimmt nicht).');
  }

  for (let index = 0; index < configs.length; index += 1) {
    const entry = configs[index];
    const where = 'configs[' + index + ']';
    const item = { index, role: entry.role, scope: entry.scope,
      node_id: entry.node_id, owner_node_id: entry.owner_node_id,
      fingerprint: entry.fingerprint, ok: true };

    if (typeof entry.text !== 'string' || !entry.text) {
      report.ok = false;
      item.ok = false;
      report.errors.push(where + ': kein Konfigurationstext.');
      report.configs.push(item);
      continue;
    }
    const actual = sha256Hex(entry.text);
    if (entry.text_sha256 && entry.text_sha256 !== actual) {
      report.ok = false;
      item.ok = false;
      report.errors.push(where + ': der Text wurde verändert (text_sha256 weicht ab).');
    }
    try {
      item.config = JSON.parse(entry.text);
    } catch (error) {
      report.ok = false;
      item.ok = false;
      report.errors.push(where + ': Text ist kein gültiges JSON — ' + error.message);
    }
    if (entry.fingerprint_source === 'local') {
      report.warnings.push(where + ': der Fingerprint wurde im Browser berechnet. '
        + 'Gleitkomma-Literale können dort abweichen — für den Abgleich mit der '
        + 'Runtime gilt der Fingerprint des Servers.');
    }
    report.configs.push(item);
  }
  return report;
}

/* -------------------------------------------------------------------------
 * Vergleich mit dem laufenden Stand
 * ---------------------------------------------------------------------- */

/**
 * Vergleicht einen Snapshot-Eintrag mit dem aktuell vorliegenden Stand.
 *
 * Das ist der Kern des Replikationsgedankens: ein VERALTETER Snapshot darf die
 * Wiederherstellung nicht blockieren. Er wird eingeordnet, nicht abgelehnt —
 * die Entscheidung trifft der Betreiber, nicht das Werkzeug.
 *
 * Liefert eine von vier Lagen:
 *   `identical`  — Fingerprint gleich, nichts zu tun
 *   `stale`      — Snapshot älter als der laufende Stand
 *   `ahead`      — Snapshot NEUER als der laufende Stand (Rückfall nach Ausfall)
 *   `unrelated`  — kein gemeinsamer Bezug (anderer Node/Scope)
 *   `no_head`    — es gibt keinen laufenden Stand; der Snapshot ist alles
 */
export function compareWithHead(entry, head, headText) {
  const result = {
    state: 'no_head',
    snapshot_fingerprint: (entry || {}).fingerprint || '',
    head_fingerprint: '',
    differences: [],
    replicable: true,
    reason: ''
  };
  if (!head || typeof head !== 'object') {
    result.reason = 'Kein laufender Stand vorhanden — der Snapshot ist die '
      + 'einzige Quelle und kann unverändert eingespielt werden.';
    return result;
  }

  const headMeta = (Array.isArray(head.meta) ? head.meta[0] : head.meta) || {};
  // Der Vergleich muss SYMMETRISCH sein. Liegt für den laufenden Stand kein
  // Rohtext vor, kennt man dort die Gleitkomma-Schreibweise nicht — dann wird
  // auch die Snapshot-Seite ohne Hinweise gerechnet. Sonst meldete der
  // Vergleich einen Unterschied, den es inhaltlich gar nicht gibt.
  const hasHeadText = typeof headText === 'string' && headText.length > 0;
  const headHints = hasHeadText ? collectFloatLiterals(headText) : null;
  const snapshotHints = hasHeadText ? collectFloatLiterals(entry.text || '') : null;
  result.head_fingerprint = localFingerprint(head, headHints);

  const snapshotConfig = entry && entry.text ? safeParse(entry.text) : null;
  const snapshotMeta = snapshotConfig
    ? ((Array.isArray(snapshotConfig.meta) ? snapshotConfig.meta[0] : snapshotConfig.meta) || {})
    : {};

  const sameScope = String(headMeta.scope || '') === String(snapshotMeta.scope || '');
  const sameNode = String(headMeta.node_id || headMeta.owner_node_id || '')
    === String(snapshotMeta.node_id || snapshotMeta.owner_node_id || '');
  if (!sameScope || !sameNode) {
    result.state = 'unrelated';
    result.reason = 'Snapshot und laufender Stand beschreiben verschiedene '
      + 'Geltungsbereiche (' + (snapshotMeta.scope || '?') + '/'
      + (snapshotMeta.node_id || snapshotMeta.owner_node_id || '?') + ' gegen '
      + (headMeta.scope || '?') + '/'
      + (headMeta.node_id || headMeta.owner_node_id || '?') + ').';
    return result;
  }

  const snapshotLocal = snapshotConfig
    ? localFingerprint(snapshotConfig, snapshotHints) : '';
  result.snapshot_fingerprint = snapshotLocal || result.snapshot_fingerprint;
  if (snapshotLocal && snapshotLocal === result.head_fingerprint) {
    result.state = 'identical';
    result.reason = 'Snapshot und laufender Stand sind identisch.';
    return result;
  }

  result.differences = diffSections(snapshotConfig, head);
  const snapshotRevision = firstNumber((entry.authority || {}).scope_revision,
    snapshotMeta.scope_revision);
  const headRevision = firstNumber(headMeta.scope_revision);
  if (snapshotRevision !== null && headRevision !== null) {
    result.state = snapshotRevision < headRevision ? 'stale'
      : (snapshotRevision > headRevision ? 'ahead' : 'stale');
    result.reason = 'scope_revision ' + snapshotRevision + ' gegen ' + headRevision + '.';
  } else {
    result.state = 'stale';
    result.reason = 'Ohne scope_revision lässt sich das Alter nicht bestimmen — '
      + 'die Fingerprints unterscheiden sich, der Snapshot wird als älter behandelt.';
  }
  return result;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch (error) { return null; }
}

/** Sektionsweiser Unterschied — grob genug für eine Entscheidung. */
export function diffSections(left, right) {
  const out = [];
  const sections = new Set(
    Object.keys(left || {}).concat(Object.keys(right || {})));
  sections.forEach(function (section) {
    const a = (left || {})[section];
    const b = (right || {})[section];
    if (!Array.isArray(a) && !Array.isArray(b)) return;
    const textA = canonicalJsonText(a === undefined ? null : a);
    const textB = canonicalJsonText(b === undefined ? null : b);
    if (textA === textB) return;
    out.push({
      section,
      snapshot_rows: Array.isArray(a) ? a.length : null,
      head_rows: Array.isArray(b) ? b.length : null
    });
  });
  return out.sort(function (x, y) { return x.section < y.section ? -1 : 1; });
}

/**
 * Wählt aus einem Snapshot den Eintrag, der zu einem Ziel passt.
 * Ohne Ziel gewinnt der Master, sonst der erste Eintrag.
 */
export function pickConfig(snapshot, target) {
  const configs = Array.isArray((snapshot || {}).configs) ? snapshot.configs : [];
  if (!configs.length) return null;
  const wanted = String(target || '').trim();
  if (wanted) {
    // Bei einem AUSDRUECKLICHEN Ziel gibt es keinen Rueckfall. Wer "fn-99"
    // angibt und den Master zurueckbekaeme, stellte im Ernstfall den falschen
    // Stand wieder her — ein stiller Treffer waere hier gefaehrlicher als
    // ein klares "nicht gefunden".
    return configs.filter(function (entry) {
      return String(entry.node_id || '') === wanted
        || String(entry.owner_node_id || '') === wanted
        || String(entry.role || '') === wanted
        || String(entry.scope || '') === wanted;
    })[0] || null;
  }
  const master = configs.filter(function (entry) {
    return entry.role === SNAPSHOT_ROLES.master;
  })[0];
  return master || configs[0];
}
