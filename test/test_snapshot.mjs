/**
 * test_snapshot.mjs — die Konfigurationssicherung im Anlagenbild.
 *
 * Was hier bewiesen wird
 * ----------------------
 * Der Snapshot ist eine Notfallmaßnahme. Er taugt nur, wenn drei Dinge
 * zutreffen — und zwar alle drei, nicht zwei davon:
 *
 *   1. **Byte-genau.** Was herauskommt, ist Zeichen für Zeichen die Datei, die
 *      hineinging. Sonst ändert sich der Fingerprint, und Authority V5 wertet
 *      die Wiederherstellung als Abweichung.
 *   2. **Manipulationsfest.** Wird am eingebetteten Text etwas geändert, fällt
 *      es auf — sonst stellt man im Ernstfall eine verfälschte Anlage wieder her.
 *   3. **Nicht blockierend.** Ein VERALTETER Snapshot muss sich einordnen
 *      lassen, nicht abgelehnt werden. Genau dafür ist er da.
 *
 * Zusätzlich: dieselben Regeln gelten in beiden Sprachen. Der JS-Snapshot muss
 * für Python lesbar sein und umgekehrt — sonst hilft das Werkzeug genau dann
 * nicht, wenn nur noch eines von beiden zur Hand ist.
 *
 * Ausführen:  node test/test_snapshot.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SNAPSHOT_KIND, SNAPSHOT_TAG, describeConfig, buildSnapshot, embedSnapshot,
  extractSnapshot, verifySnapshot, compareWithHead, pickConfig, diffSections,
  localFingerprint, canonicalJsonText, firstNumber
} from '../public/js/hmi_snapshot.js';
import { sha256Hex } from '../public/js/v9_uuid.js';

const PYTHON_BINARY = process.env.PYTHON_BINARY || process.env.PYTHON || 'python3';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON_OPTIONS = {
  encoding: 'utf8',
  cwd: ROOT,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
};

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failed += 1;
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* -------------------------------------------------------------------------
 * DOM-Ersatz — embedSnapshot braucht nur wenige Methoden
 * ---------------------------------------------------------------------- */

function makeSvgStub() {
  function makeNode(tagName) {
    const kids = [];
    const attrs = {};
    return {
      tagName,
      childNodes: kids,
      attrs,
      get firstChild() { return kids[0] || null; },
      setAttribute: function (name, value) { attrs[name] = String(value); },
      getAttribute: function (name) { return attrs[name] === undefined ? null : attrs[name]; },
      appendChild: function (child) { kids.push(child); child.parentNode = this; return child; },
      insertBefore: function (child) { kids.unshift(child); child.parentNode = this; return child; },
      removeChild: function (child) {
        const at = kids.indexOf(child);
        if (at >= 0) kids.splice(at, 1);
        return child;
      },
      querySelector: function (selector) {
        for (let i = 0; i < kids.length; i += 1) {
          if (kids[i].tagName === selector) return kids[i];
          if (typeof kids[i].querySelector === 'function') {
            const nested = kids[i].querySelector(selector);
            if (nested) return nested;
          }
        }
        return null;
      },
      serialize: function () {
        const attrText = Object.keys(attrs)
          .map(function (k) { return ' ' + k + '="' + attrs[k] + '"'; }).join('');
        if (this.cdata !== undefined) {
          return '<' + tagName + attrText + '><![CDATA[' + this.cdata + ']]></' + tagName + '>';
        }
        const inner = kids.map(function (kid) {
          return typeof kid.serialize === 'function' ? kid.serialize() : String(kid.text || '');
        }).join('');
        return '<' + tagName + attrText + '>' + inner + '</' + tagName + '>';
      }
    };
  }

  const root = makeNode('svg');
  root.ownerDocument = {
    createElementNS: function (ns, tag) { return makeNode(tag); },
    createCDATASection: function (data) {
      const node = makeNode('#cdata');
      node.cdata = data;
      node.serialize = function () { return '<![CDATA[' + data + ']]>'; };
      return node;
    },
    createTextNode: function (value) {
      const node = makeNode('#text');
      node.text = value;
      node.serialize = function () { return String(value); };
      return node;
    }
  };
  return root;
}

/* ---------------------------------------------------------- 1. Grundlagen */

const masterText = fs.readFileSync(
  path.join(ROOT, 'config', 'device_state_data_v9.json'), 'utf8');
const fn01Text = fs.readFileSync(
  path.join(ROOT, 'config', 'shards', 'device_state_data_v9_node_fn-01.json'), 'utf8');
const crossText = fs.readFileSync(
  path.join(ROOT, 'config', 'shards', 'device_state_data_v8_cross_fn-01.json'), 'utf8');

const master = describeConfig(masterText, { source: 'test' });
const fn01 = describeConfig(fn01Text, { source: 'test' });
const cross = describeConfig(crossText, { source: 'test' });

check('Rolle master_global erkannt', master.role === 'master_global', master.role);
check('Rolle node_local erkannt', fn01.role === 'node_local', fn01.role);
check('Rolle cross erkannt', cross.role === 'cross', cross.role);
check('node_id übernommen', fn01.node_id === 'fn-01', fn01.node_id);
check('owner_node_id übernommen', cross.owner_node_id === 'fn-01', cross.owner_node_id);
check('Text wörtlich abgelegt', master.text === masterText);
check('text_sha256 stimmt', master.text_sha256 === sha256Hex(masterText));
check('Sektionszähler erfasst',
  master.section_counts.rules === JSON.parse(masterText).rules.length);
check('Authority-Baseline aus meta gelesen',
  master.authority && master.authority.source === 'meta');

check('firstNumber ignoriert bool und Müll',
  firstNumber(true, 'abc', null, '17', 4) === 17,
  String(firstNumber(true, 'abc', null, '17', 4)));

/* -------------------------------------------- 2. Einbetten und Auslesen */

const snapshot = buildSnapshot([master, fn01, cross], {
  project: 'Testanlage', capturedAt: '2026-08-01T00:00:00Z'
});
check('Snapshot trägt die richtige Art', snapshot.kind === SNAPSHOT_KIND);
check('Snapshot enthält drei Konfigurationen', snapshot.configs.length === 3);
check('payload_sha256 gesetzt', /^[0-9a-f]{64}$/.test(snapshot.payload_sha256));

const svgNode = makeSvgStub();
embedSnapshot(svgNode, snapshot);
const svgText = '<svg xmlns="http://www.w3.org/2000/svg">'
  + svgNode.childNodes.map(function (kid) { return kid.serialize(); }).join('')
  + '</svg>';

check('Snapshot steht in <metadata>', svgText.indexOf('<metadata') >= 0);
check('Snapshot trägt das eigene Element', svgText.indexOf('<' + SNAPSHOT_TAG) >= 0);
check('Snapshot liegt in CDATA', svgText.indexOf('<![CDATA[') >= 0);

const readBack = extractSnapshot(svgText);
check('Snapshot wieder auslesbar', readBack !== null);
check('Ausgelesener Snapshot ist inhaltsgleich',
  JSON.stringify(readBack) === JSON.stringify(snapshot));

/* ------------------------------------------------------- 3. Byte-Genauigkeit */

const restoredMaster = pickConfig(readBack);
check('pickConfig wählt ohne Ziel den Master',
  restoredMaster.role === 'master_global', restoredMaster.role);
check('Wiederhergestellter Text ist BYTE-GENAU', restoredMaster.text === masterText,
  restoredMaster.text.length + ' gegen ' + masterText.length + ' Zeichen');

const restoredFn01 = pickConfig(readBack, 'fn-01');
check('pickConfig findet den Node-Shard über node_id',
  restoredFn01 && restoredFn01.text === fn01Text);
const restoredCross = pickConfig(readBack, 'cross');
check('pickConfig findet den Cross-Shard über die Rolle',
  restoredCross && restoredCross.text === crossText);
check('pickConfig liefert null bei unbekanntem Ziel',
  pickConfig(readBack, 'fn-99') === null);

/* ------------------------------------------------------- 4. Integrität */

const clean = verifySnapshot(readBack);
check('Unversehrter Snapshot besteht die Prüfung', clean.ok,
  JSON.stringify(clean.errors));
check('Prüfbericht listet alle Konfigurationen', clean.configs.length === 3);

const tampered = JSON.parse(JSON.stringify(readBack));
tampered.configs[0].text = tampered.configs[0].text.replace('"version": 9', '"version": 5');
const tamperedReport = verifySnapshot(tampered);
check('Manipulation am Text fällt auf', !tamperedReport.ok
  && tamperedReport.errors.some(function (item) { return item.indexOf('text_sha256') >= 0; }),
  JSON.stringify(tamperedReport.errors));

const swapped = JSON.parse(JSON.stringify(readBack));
swapped.configs.reverse();
check('Manipulation an der Nutzlast fällt auf',
  !verifySnapshot(swapped).ok);

check('Leerer Snapshot wird abgelehnt', !verifySnapshot({ kind: SNAPSHOT_KIND, configs: [] }).ok);
check('Fremde Snapshot-Art wird abgelehnt',
  !verifySnapshot({ kind: 'etwas_anderes', configs: [master] }).ok);
check('Kein Snapshot im SVG liefert null',
  extractSnapshot('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>') === null);

/* --------------------------------------------- 5. Vergleich mit dem Head */

const headConfig = JSON.parse(masterText);

const identical = compareWithHead(restoredMaster, headConfig);
check('Gleicher Stand wird als identisch erkannt', identical.state === 'identical',
  identical.state + ' / ' + identical.reason);

const noHead = compareWithHead(restoredMaster, null);
check('Ohne laufenden Stand ist der Snapshot die einzige Quelle',
  noHead.state === 'no_head' && noHead.replicable === true);

// Der Kernfall: der laufende Stand ist weiter als der Snapshot.
const newerHead = JSON.parse(masterText);
newerHead.meta[0].scope_revision = 42;
newerHead.rules.push(Object.assign({}, newerHead.rules[0],
  { rule_id: 999, name: 'spaeter_dazugekommen' }));
const staleEntry = describeConfig(
  JSON.stringify(Object.assign(JSON.parse(masterText), {
    meta: [Object.assign({}, JSON.parse(masterText).meta[0], { scope_revision: 17 })]
  }), null, 2), { source: 'test' });
const stale = compareWithHead(staleEntry, newerHead);
check('Veralteter Snapshot wird als veraltet erkannt', stale.state === 'stale',
  stale.state + ' / ' + stale.reason);
check('Veralteter Snapshot bleibt replizierbar', stale.replicable === true);
check('Der Vergleich nennt die Revisionen', stale.reason.indexOf('17') >= 0
  && stale.reason.indexOf('42') >= 0, stale.reason);
check('Der Vergleich zeigt die abweichenden Sektionen',
  stale.differences.some(function (item) { return item.section === 'rules'; }),
  JSON.stringify(stale.differences));

// Rückfall nach Ausfall: der Snapshot ist NEUER als das, was noch da ist.
const olderHead = JSON.parse(masterText);
olderHead.meta[0].scope_revision = 3;
olderHead.rules = olderHead.rules.slice(0, 2);
const aheadEntry = describeConfig(
  JSON.stringify(Object.assign(JSON.parse(masterText), {
    meta: [Object.assign({}, JSON.parse(masterText).meta[0], { scope_revision: 30 })]
  }), null, 2), { source: 'test' });
const ahead = compareWithHead(aheadEntry, olderHead);
check('Neuerer Snapshot wird als "ahead" erkannt', ahead.state === 'ahead',
  ahead.state + ' / ' + ahead.reason);

// Falscher Node: hier soll das Werkzeug bremsen.
const foreign = compareWithHead(restoredFn01, headConfig);
check('Fremder Geltungsbereich wird erkannt', foreign.state === 'unrelated',
  foreign.state + ' / ' + foreign.reason);

check('diffSections meldet gleiche Configs als unverändert',
  diffSections(headConfig, JSON.parse(masterText)).length === 0);

/* ------------------------------------------- 6. Fingerprint-Berechnung */

check('canonicalJsonText sortiert die Schlüssel',
  canonicalJsonText({ b: 1, a: [3, { d: 4, c: 5 }] })
  === '{"a":[3,{"c":5,"d":4}],"b":1}',
  canonicalJsonText({ b: 1, a: [3, { d: 4, c: 5 }] }));
check('localFingerprint ist deterministisch',
  localFingerprint(headConfig) === localFingerprint(JSON.parse(masterText)));
check('localFingerprint reagiert auf Änderungen',
  localFingerprint(headConfig) !== localFingerprint(newerHead));

/* ------------------------------------- 7. Beide Sprachen lesen dasselbe */

const tmpSvg = path.join(ROOT, 'test', '_snapshot_probe.svg');
fs.writeFileSync(tmpSvg, svgText, 'utf8');
try {
  const inspect = execFileSync(PYTHON_BINARY,
    [path.join(ROOT, '_tools', 'config_snapshot.py'), 'inspect', tmpSvg],
    PYTHON_OPTIONS);
  check('Python liest den JS-Snapshot', inspect.indexOf('Integritaet: unversehrt') >= 0,
    inspect.split('\n')[0]);
  check('Python findet alle drei Konfigurationen',
    inspect.indexOf('Konfigurationen (3)') >= 0);

  const extracted = execFileSync(PYTHON_BINARY,
    [path.join(ROOT, '_tools', 'config_snapshot.py'), 'extract', tmpSvg, '--target', 'fn-01'],
    PYTHON_OPTIONS);
  check('Python holt den Node-Shard byte-genau heraus', extracted === fn01Text,
    extracted.length + ' gegen ' + fn01Text.length + ' Zeichen');
} catch (error) {
  check('Python liest den JS-Snapshot', false, String(error.message).slice(0, 200));
} finally {
  fs.unlinkSync(tmpSvg);
}

// Umgekehrt: was Python einbettet, muss JS lesen können.
const pySvg = path.join(ROOT, 'test', '_snapshot_py.svg');
const plainSvg = path.join(ROOT, 'test', '_snapshot_plain.svg');
fs.writeFileSync(plainSvg,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>', 'utf8');
try {
  execFileSync(PYTHON_BINARY, [path.join(ROOT, '_tools', 'config_snapshot.py'), 'embed',
    plainSvg, '--config', path.join(ROOT, 'config', 'device_state_data_v9.json'),
    '--out', pySvg], PYTHON_OPTIONS);
  const fromPython = extractSnapshot(fs.readFileSync(pySvg, 'utf8'));
  check('JS liest den Python-Snapshot', fromPython !== null);
  check('Python-Snapshot besteht die JS-Prüfung', verifySnapshot(fromPython).ok,
    JSON.stringify(verifySnapshot(fromPython).errors));
  check('Python-Snapshot ist byte-genau',
    pickConfig(fromPython).text === masterText);
    // Der springende Punkt: JavaScript verliert beim Parsen die
  // Gleitkomma-Literale. Ohne die Hinweise aus dem Rohtext waere der im
  // Browser gebildete Fingerprint ein anderer als der der Runtime — und der
  // Snapshot damit nicht gegen den laufenden Stand pruefbar.
  const jsFingerprint = describeConfig(masterText, { source: 'test' }).fingerprint;
  check('Python und JS bilden denselben Fingerprint',
    pickConfig(fromPython).fingerprint === jsFingerprint,
    pickConfig(fromPython).fingerprint + ' gegen ' + jsFingerprint);
  check('Der Fingerprint ist der der Runtime',
    jsFingerprint === pickConfig(fromPython).fingerprint
    && /^[0-9a-f]{64}$/.test(jsFingerprint));
} catch (error) {
  check('JS liest den Python-Snapshot', false, String(error.message).slice(0, 200));
} finally {
  [pySvg, plainSvg].forEach(function (file) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });
}

/* -------------------------------------------------- 8. Robustheit */

// Ein Snapshot muss auch aus einem sonst beschädigten SVG lesbar sein — das
// ist der Fall, für den er gedacht ist.
const damaged = svgText.replace('</svg>', '<rect unclosed=');
check('Snapshot bleibt aus beschädigtem SVG lesbar',
  extractSnapshot(damaged) !== null);

const truncated = svgText.slice(0, svgText.indexOf('<' + SNAPSHOT_TAG) + 200);
let truncatedResult = 'kein Fehler';
try {
  truncatedResult = extractSnapshot(truncated) === null ? 'null' : 'Objekt';
} catch (error) {
  truncatedResult = 'Fehler';
}
check('Abgeschnittener Snapshot liefert null statt Halbwissen',
  truncatedResult === 'null', truncatedResult);

/* ------------------------------------------------------------------ Fazit */

console.log('bestanden: ' + passed + ' | fehlgeschlagen: ' + failed);
if (failed) {
  failures.forEach(function (item) { console.log('  FEHLER: ' + item); });
  process.exit(1);
}
console.log('SNAPSHOT-KETTE BESTANDEN');
