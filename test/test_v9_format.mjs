/**
 * test_v9_format.mjs — Regressionstests für das kanonische Lesbarkeitsformat.
 *
 * Prüft gegen ECHTE Runtime-Dateien (test/fixtures/format_ref_*.json), dass der
 * Editor byte-gleich zu `_json_formator.py` (FORMATTER_VERSION 3.0.0) schreibt:
 *
 *   * Sektionsreihenfolge, Leerzeilen-Gliederung, Feldreihenfolge
 *   * ein kompaktes Datensatzobjekt pro Zeile
 *   * Gleitkomma-Schreibweise (`1000.0` bleibt `1000.0`)
 *   * Idempotenz: zweites Formatieren ändert nichts
 *
 * Ausführen:  node test/test_v9_format.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TOP_LEVEL_ORDER, TOP_SPACING, FIELD_ORDER_BY_SECTION, FIELD_ORDER_BY_PARENT,
  FLOAT_PATHS, INT_PATHS, formatConfig, formatConfigText, parseConfig,
  collectFloatLiterals, reorderConfig, isIdempotent
} from '../public/js/v9_json_format.js';
import { SECTION_ORDER } from '../public/js/v9_schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failed += 1;
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function firstDiff(left, right) {
  const a = left.split('\n');
  const b = right.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return 'Zeile ' + (i + 1) + '\n    REF: ' + String(a[i]).slice(0, 160)
        + '\n    OUT: ' + String(b[i]).slice(0, 160);
    }
  }
  return '';
}

/* ------------------------------------------------- 1. Byte-Gleichheit */

const REFERENCES = [
  'format_ref_v9_node_fn01.json',
  'format_ref_v9_node_fn02.json',
  'format_ref_v8_cross_fn01.json'
];

REFERENCES.forEach(function (name) {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf8').replace(/\n+$/, '\n');
  const out = formatConfigText(raw);
  check('Byte-gleich zur Runtime: ' + name, out === raw, firstDiff(raw, out));
  check('Idempotent: ' + name, formatConfigText(out) === out);
});

/* ------------------------------------------------- 2. Gleitkommaliterale */

const refNode = fs.readFileSync(path.join(FIXTURES, 'format_ref_v9_node_fn01.json'), 'utf8');
const hints = collectFloatLiterals(refNode);

check('Literalscanner findet Gleitkommafelder', hints.size > 0, String(hints.size));
check('eng_max 1000.0 als Float erkannt', hints.has('scaling_profiles.0.eng_max'));
check('duration_s 4000 NICHT als Float erkannt', !hints.has('timers.0.duration_s'));
check('interval_s 4.29 als Float erkannt', hints.has('timers.1.interval_s'));
check('args.period_s 120.0 als Float erkannt', hints.has('control_methods.5.args.period_s'));
check('args.period_s 600 NICHT als Float erkannt', !hints.has('control_methods.1.args.period_s'));

const parsed = parseConfig(refNode);
check('parseConfig liefert Config und Hinweise',
  parsed.config && parsed.config.meta && parsed.floatHints instanceof Set);

// Vertragsfelder erzwingen Float auch OHNE Literalgedächtnis.
const bare = formatConfig(JSON.parse(refNode));
check('Vertragsfeld eng_max ohne Hinweise weiterhin Float',
  bare.indexOf('"eng_max": 1000.0') >= 0);
check('Vertragsfeld pid kd ohne Hinweise weiterhin Float',
  bare.indexOf('"kd": 0.0') >= 0);
check('Ganzzahlfeld profile_id bleibt Ganzzahl',
  bare.indexOf('"profile_id": 1,') >= 0 && bare.indexOf('"profile_id": 1.0') < 0);

// Freie Map ohne Hinweise -> Ganzzahl (dafür gibt es die Hinweise).
check('Freie Map ohne Hinweise verliert .0 (erwartetes Verhalten)',
  bare.indexOf('"v0": 20,') >= 0);
check('Freie Map MIT Hinweisen behält .0',
  formatConfig(parsed.config, { floatHints: parsed.floatHints }).indexOf('"v0": 20.0,') >= 0);

check('Kaputter Text liefert leere Hinweismenge',
  collectFloatLiterals('{"a": ').size === 0);
check('Umlaute im String stören den Scanner nicht',
  collectFloatLiterals('{"a":"Abkühlphase \\"x\\"","b":1.5}').has('b'));

/* ------------------------------------------------- 3. Tabellen-Invarianten */

check('TOP_LEVEL_ORDER enthält genau die 26 Vertragssektionen',
  TOP_LEVEL_ORDER.length === 26 && SECTION_ORDER.length === 26
  && TOP_LEVEL_ORDER.slice().sort().join(',') === SECTION_ORDER.slice().sort().join(','),
  TOP_LEVEL_ORDER.length + '/' + SECTION_ORDER.length);

check('FIELD_ORDER_BY_SECTION deckt alle Sektionen ab',
  TOP_LEVEL_ORDER.every(function (name) { return FIELD_ORDER_BY_SECTION[name]; }));

check('TOP_SPACING verweist nur auf bekannte Sektionen',
  Object.keys(TOP_SPACING).every(function (name) {
    return TOP_LEVEL_ORDER.indexOf(name) >= 0;
  }));

check('FLOAT_PATHS und INT_PATHS sind disjunkt',
  FLOAT_PATHS.every(function (item) { return INT_PATHS.indexOf(item) < 0; }));

check('FIELD_ORDER_BY_PARENT ohne doppelte Feldnamen',
  Object.keys(FIELD_ORDER_BY_PARENT).every(function (key) {
    const list = FIELD_ORDER_BY_PARENT[key];
    return new Set(list).size === list.length;
  }));

/* ------------------------------------------------- 4. Umsortierung */

const scrambled = {
  rules: [{ description: 'x', rule_id: 7, when: [{ op: '>', state_id: 1, src: 'state' }] }],
  meta: [{ scope: 'node_local', version: 9 }],
  sensors: []
};
const ordered = reorderConfig(scrambled);
check('Sektionen kommen in Vertragsreihenfolge',
  Object.keys(ordered).join(',') === 'meta,sensors,rules', Object.keys(ordered).join(','));
check('meta: version vor scope',
  Object.keys(ordered.meta[0]).join(',') === 'version,scope');
check('rules: rule_id vor when vor description',
  Object.keys(ordered.rules[0]).join(',') === 'rule_id,when,description');
check('when: state_id vor src vor op',
  Object.keys(ordered.rules[0].when[0]).join(',') === 'state_id,src,op');

// Generische Kategorie-Sortierung für Felder ohne Tabelleneintrag
// (freie Map `parameters` — dort greift ausschließlich der Fallback).
const generic = reorderConfig({ process_states: [{
  parameters: {
    zzz_id: 1, description: 'd', tags: [], alpha: 2, controller_uuid: 'u', beta: 3
  }
}] });
check('Generische Sortierung: IDs, Identität, Rest alphabetisch, tags, description',
  Object.keys(generic.process_states[0].parameters).join(',')
  === 'zzz_id,controller_uuid,alpha,beta,tags,description',
  Object.keys(generic.process_states[0].parameters).join(','));

// Explizite Tabellen schlagen den Fallback: `meta` führt description NICHT ans Ende,
// wenn description der einzige bekannte Schlüssel ist.
const metaOrder = reorderConfig({ meta: [{ description: 'd', scope: 'node_local', version: 9 }] });
check('Explizite Sektionstabelle schlägt den Fallback',
  Object.keys(metaOrder.meta[0]).join(',') === 'version,scope,description',
  Object.keys(metaOrder.meta[0]).join(','));

/* ------------------------------------------------- 5. Randfälle */

check('Leere Config bleibt gültiges JSON', formatConfig({}) === '{}\n');
check('Leere Sektion wird als [] gerendert',
  formatConfig({ sensors: [] }).indexOf('"sensors": []') >= 0);
check('isIdempotent meldet true für die Referenz',
  isIdempotent(parsed.config, { floatHints: parsed.floatHints }));
check('Formatierte Ausgabe ist parsebar',
  JSON.parse(formatConfigText(refNode)).meta[0].version === 9);
check('reorder:false erhält vorhandene Reihenfolge',
  formatConfig({ rules: [], meta: [] }, { reorder: false }).indexOf('"rules"')
  < formatConfig({ rules: [], meta: [] }, { reorder: false }).indexOf('"meta"'));

/* ------------------------------------------------- 6. Datengleichheit */

REFERENCES.forEach(function (name) {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  const before = JSON.parse(raw);
  const after = JSON.parse(formatConfigText(raw));
  check('Formatierung verliert keine Daten: ' + name,
    JSON.stringify(before, Object.keys(before).sort())
    === JSON.stringify(after, Object.keys(after).sort()));
  const sections = Object.keys(before);
  check('Formatierung verliert keine Sektion: ' + name,
    sections.length === Object.keys(after).length, String(sections.length));
});

/* ------------------------------------------------------------------ Fazit */

console.log('bestanden: ' + passed + ' | fehlgeschlagen: ' + failed);
if (failed) {
  failures.forEach(function (item) { console.log('  FEHLER: ' + item); });
  process.exit(1);
}
console.log('FORMAT-TESTS BESTANDEN');
