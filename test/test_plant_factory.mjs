/**
 * test_plant_factory.mjs — die Kette Zeichnen → Binden → Exportieren → Animieren.
 *
 * Warum dieser Test
 * -----------------
 * Bis V54.0 prüfte die gesamte Suite ausschließlich die V9-Schicht. Kein
 * einziger Test berührte `model_adapter.js`, `hmi_runtime.js`, den SVG-Export
 * oder das HMI-Modell — also genau den Teil, der aus einer Zeichnung eine
 * lauffähige Anlage macht. Drei belegte Fehler blieben dadurch unentdeckt:
 *
 *   1. Der Export löschte REALE Controller, sobald ein virtueller Controller
 *      dieselbe `controller_id` trug (die Editor-Projektion vergibt sie
 *      absichtlich gleich). Bei der ausgelieferten Config verschwand damit
 *      wago_2 samt Endpunkt — obwohl alle Zuweisungen darauf zeigten.
 *   2. I/O wurde allein über `sensor_id` / `actuator_id` aufgelöst. Die
 *      V9-Identität ist aber (controller_uuid, io_id). In einer Anlage mit
 *      zwei Workern gibt es "Sensor 1" mehrfach — der erste Treffer gewann,
 *      die übrigen verschwanden lautlos.
 *   3. Das exportierte SVG trug weder Zustands-CSS noch `viewBox`. Die
 *      Laufzeit setzte Klassen, zu denen es keine Regel gab, und der Inhalt
 *      wurde beschnitten statt skaliert.
 *
 * Der Test läuft ohne Browser: `model_adapter.js` und `hmi_animation.js` sind
 * reine Funktionsmodule. Für den SVG-Teil genügt ein schlanker DOM-Ersatz.
 *
 * Ausführen:  node test/test_plant_factory.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANIMATION_CSS, STATE_CLASSES, ANIMATION_CLASSES, buildSignalBridge,
  animationStyleTag
} from '../public/js/hmi_animation.js';
import { toEditorProjection } from '../public/js/v9_migrate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failed += 1;
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* -------------------------------------------------------------------------
 * Minimaler AppState-Ersatz
 *
 * `model_adapter.js` braucht von der App nur `get(key)`. Ein echtes
 * `core.js`-State-Objekt zu laden würde den halben Editor mitziehen.
 * ---------------------------------------------------------------------- */

function makeAppState(data) {
  return {
    get: function (key) { return data[key]; },
    set: function (key, value) { data[key] = value; },
    setSilent: function (key, value) { data[key] = value; }
  };
}

const canonical = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'config', 'device_state_data_v9.json'), 'utf8'));
const projection = toEditorProjection(canonical);

/* ------------------------------------------------- 1. Zwei-Node-Realität */

const sensorIdCounts = {};
projection.sensors.forEach(function (row) {
  sensorIdCounts[row.sensor_id] = (sensorIdCounts[row.sensor_id] || 0) + 1;
});
const collidingSensorIds = Object.keys(sensorIdCounts)
  .filter(function (id) { return sensorIdCounts[id] > 1; });

check('Die Testkonfiguration enthält kollidierende sensor_id (Zwei-Node-Fall)',
  collidingSensorIds.length > 0, JSON.stringify(sensorIdCounts));

// Genau diese Kollision nachstellen: zwei Zuweisungen mit derselben sensor_id
// auf verschiedenen Controllern.
const collidingId = Number(collidingSensorIds[0]);
const carriers = projection.sensors.filter(function (row) {
  return row.sensor_id === collidingId;
});
check('Kollidierende sensor_id liegt auf mehreren Controllern',
  new Set(carriers.map(function (row) { return row.controller_id; })).size > 1,
  JSON.stringify(carriers.map(function (row) { return row.controller_id; })));

/* ------------------------------------------------------- 2. Export bauen */

const assignments = {};
carriers.forEach(function (row, index) {
  assignments['elem_sensor_' + index] = {
    element_id: 'elem_sensor_' + index,
    role: 'sensor',
    controller_id: row.controller_id,
    sensor_id: row.sensor_id,
    sensor_type: 'temperature',
    bus_type: row.bus_type || 'modbus',
    function_type: row.function_type || 'read_holding_registers',
    address: row.address,
    widget: { type: 'text', label: 'T' + index }
  };
});
const firstActuator = projection.actuators[0];
assignments.elem_actuator_0 = {
  element_id: 'elem_actuator_0',
  role: 'actuator',
  controller_id: firstActuator.controller_id,
  actuator_id: firstActuator.actuator_id,
  actuator_type: 'valve',
  bus_type: firstActuator.bus_type || 'modbus',
  function_type: firstActuator.function_type || 'write_coil',
  address: firstActuator.address,
  widget: { type: 'indicator', label: 'V1' }
};

const appState = makeAppState({
  projektName: 'plant_factory_test',
  deviceConfig: projection,
  elements: carriers.map(function (row, index) {
    return { id: 'elem_sensor_' + index, templateId: 'sensor', name: 'Sensor ' + index,
      x: 100 * index, y: 100, width: 80, height: 80, properties: {}, bindings: {} };
  }),
  connections: [],
  devices: { assignments },
  processes: { process_states: [] },
  hmi: { bindings: [] },
  hmi_ui: { version: 1, active_view_id: 'main', views: [], widgets: [], bindings: [] },
  dynamic_rule_engine: { rule_sets: [] }
});

const adapter = await import('../public/js/model_adapter.js');
const exported = adapter.buildExportConfig(appState);

check('buildExportConfig liefert ein Objekt', exported && typeof exported === 'object');

/* --------------------------------- 3. Kollidierende I/O bleiben erhalten */

const exportedSensorKeys = new Set((exported.sensors || []).map(function (row) {
  return row.controller_id + ':' + row.sensor_id;
}));
const expectedKeys = carriers.map(function (row) {
  return row.controller_id + ':' + row.sensor_id;
});
check('Alle zugewiesenen Sensoren überleben den Export (kein first-wins)',
  expectedKeys.every(function (key) { return exportedSensorKeys.has(key); }),
  'erwartet ' + JSON.stringify(expectedKeys)
  + ' erhalten ' + JSON.stringify(Array.from(exportedSensorKeys)));

check('Exportierte Sensoren tragen ihre Adresse',
  (exported.sensors || []).every(function (row) {
    return row.controller_id === null || row.address !== null;
  }),
  JSON.stringify((exported.sensors || []).map(function (r) {
    return [r.controller_id, r.sensor_id, r.address];
  })));

/* ----------------------------- 4. Reale Controller bleiben im Export ---- */

const exportedControllerIds = new Set((exported.controllers || []).map(function (row) {
  return row.controller_id;
}));
const usedControllerIds = Array.from(new Set(Object.values(assignments).map(function (a) {
  return a.controller_id;
})));
check('Jeder benutzte Controller liegt im Export',
  usedControllerIds.every(function (id) { return exportedControllerIds.has(id); }),
  'benutzt ' + JSON.stringify(usedControllerIds)
  + ' exportiert ' + JSON.stringify(Array.from(exportedControllerIds)));

check('Exportierte Controller tragen einen Endpunkt',
  (exported.controllers || []).every(function (row) {
    return typeof row.host === 'string' && row.host.length > 0;
  }),
  JSON.stringify((exported.controllers || []).map(function (r) {
    return [r.controller_id, r.host];
  })));

check('Virtuelle Controller stehen in ihrer eigenen Sektion',
  Array.isArray(exported.virtual_controllers));
check('Kein realer Controller wurde als virtuell aussortiert',
  (exported.controllers || []).every(function (row) {
    return String(row.bus_type || '').toLowerCase() !== 'virtual';
  }));

/* ------------------------------------------------ 5. Animationsschicht -- */

check('ANIMATION_CSS definiert die Blink-Animation',
  ANIMATION_CSS.indexOf('@keyframes hmi-blink') >= 0
  && ANIMATION_CSS.indexOf('.hmi-anim-blink') >= 0);
check('ANIMATION_CSS deckt alle Zustandsklassen ab',
  STATE_CLASSES.every(function (entry) {
    return ANIMATION_CSS.indexOf('.' + entry.value) >= 0;
  }),
  STATE_CLASSES.map(function (e) { return e.value; }).join(','));
check('ANIMATION_CSS deckt alle Animationsklassen ab',
  ANIMATION_CLASSES.every(function (entry) {
    return ANIMATION_CSS.indexOf('.' + entry.value) >= 0;
  }));
check('ANIMATION_CSS färbt markierte Füllflächen',
  ANIMATION_CSS.indexOf('[data-hmi-fill="1"]') >= 0);
check('ANIMATION_CSS respektiert prefers-reduced-motion',
  ANIMATION_CSS.indexOf('prefers-reduced-motion') >= 0);
check('animationStyleTag liefert ein vollständiges style-Element',
  animationStyleTag().indexOf('<style') === 0
  && animationStyleTag().indexOf('</style>') > 0);

const bridge = buildSignalBridge({ sourceUrl: './signals.json', intervalMs: 750 });
check('Signalbrücke ruft setSignals auf', bridge.indexOf('runtime.setSignals(') >= 0);
check('Signalbrücke pollt zyklisch', bridge.indexOf('setInterval(step') >= 0);
check('Signalbrücke erlaubt eine eigene Quelle per Query',
  bridge.indexOf('URLSearchParams') >= 0 && bridge.indexOf('"signals"') >= 0);
check('Signalbrücke kennzeichnet den Demo-Modus',
  bridge.indexOf('Demo-Modus') >= 0 && bridge.indexOf('showBanner') >= 0);
check('Signalbrücke bildet die Schlüssel wie die Laufzeit',
  bridge.indexOf('kind + ":" + id + ":"') >= 0);
check('Signalbrücke übernimmt das konfigurierte Intervall',
  bridge.indexOf('SIGNAL_INTERVAL_MS = 750') >= 0);

/* -------------------------------- 6. SVG wird tatsächlich animierbar ---- */

// Schlanker DOM-Ersatz: makeSvgAnimatable braucht nur createElementNS,
// querySelector, insertBefore und die Attributmethoden.
function makeSvgStub() {
  const children = [];
  const attrs = {};
  const node = {
    ownerDocument: {
      createElementNS: function (ns, tag) {
        return { tagName: tag, textContent: '', attrs: {}, ns,
          setAttribute: function (k, v) { this.attrs[k] = v; },
          remove: function () {} };
      }
    },
    childNodes: children,
    get firstChild() { return children[0] || null; },
    getAttribute: function (name) { return attrs[name] === undefined ? null : attrs[name]; },
    setAttribute: function (name, value) { attrs[name] = String(value); },
    removeAttribute: function (name) { delete attrs[name]; },
    querySelector: function (selector) {
      if (selector === 'style[data-hmi-animation]') {
        const match = children.filter(function (c) { return c.tagName === 'style'; })[0];
        if (!match) return null;
        match.remove = function () {
          const at = children.indexOf(match);
          if (at >= 0) children.splice(at, 1);
        };
        return match;
      }
      return null;
    },
    insertBefore: function (child) { children.unshift(child); return child; },
    attrs
  };
  return node;
}

const animationModule = await import('../public/js/hmi_animation.js');
const svgStub = makeSvgStub();
svgStub.setAttribute('width', '2000');
svgStub.setAttribute('height', '2000');
animationModule.makeSvgAnimatable(svgStub, {
  viewBox: { x: 0, y: 0, width: 800, height: 600 },
  title: 'Testanlage'
});

check('SVG bekommt ein viewBox', svgStub.getAttribute('viewBox') === '0 0 800 600',
  String(svgStub.getAttribute('viewBox')));
check('SVG skaliert proportional',
  svgStub.getAttribute('preserveAspectRatio') === 'xMidYMid meet');
check('Feste width/height werden entfernt (sonst skaliert nichts)',
  svgStub.getAttribute('width') === null && svgStub.getAttribute('height') === null);
check('SVG trägt den xmlns', svgStub.getAttribute('xmlns') === 'http://www.w3.org/2000/svg');

const styleNodes = svgStub.childNodes.filter(function (c) { return c.tagName === 'style'; });
check('Genau ein eingebettetes style-Element', styleNodes.length === 1,
  String(styleNodes.length));
check('Eingebettete CSS enthält die Zustandsregeln',
  styleNodes[0] && styleNodes[0].textContent.indexOf('.alarm-red') >= 0
  && styleNodes[0].textContent.indexOf('@keyframes hmi-blink') >= 0);
check('style-Element ist als Animationsschicht markiert',
  styleNodes[0] && styleNodes[0].attrs['data-hmi-animation'] === '1');

const titleNodes = svgStub.childNodes.filter(function (c) { return c.tagName === 'title'; });
check('SVG trägt einen Titel', titleNodes.length === 1
  && titleNodes[0].textContent === 'Testanlage');

// Zweimal anwenden darf nicht zwei style-Elemente hinterlassen.
animationModule.makeSvgAnimatable(svgStub, { viewBox: { x: 0, y: 0, width: 800, height: 600 } });
check('Erneutes Anwenden bleibt idempotent',
  svgStub.childNodes.filter(function (c) { return c.tagName === 'style'; }).length === 1);

/* ------------------------------------------- 7. Laufzeit-Schlüsselformat */

const runtime = await import('../public/js/hmi_runtime.js');
check('hmi_runtime exportiert createHmiRuntime',
  typeof runtime.createHmiRuntime === 'function');

/* ------------------------------------------------------------------ Fazit */

console.log('bestanden: ' + passed + ' | fehlgeschlagen: ' + failed);
if (failed) {
  failures.forEach(function (item) { console.log('  FEHLER: ' + item); });
  process.exit(1);
}
console.log('PLANT-FACTORY-KETTE BESTANDEN');
