/**
 * Functional runtime contract for V64 drawing and SVG event models.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectExposedPlantPorts,
  createPlantConnection,
  createPlantEntity,
  createRohrofenPlantExample,
  deletePlantSelection,
  duplicatePlantSelection,
  getActivePlantSheet,
  normalizePlantDrawing,
  plantConnectionPoints,
  plantOrthogonalPath,
  validatePlantDrawing
} from '../public/js/v64_plant_drawing_model.js';
import {
  normalizeSvgEventAnimations,
  validateSvgEventAnimations
} from '../public/js/svg_event_runtime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;

function check(condition, label, detail) {
  if (!condition)
    throw new Error(label + (detail ? ': ' + detail : ''));
  passed += 1;
  console.log('   ok  ' + label);
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

function templateLookup(manifest, templateId) {
  return manifest.templates[templateId] || null;
}

function main() {
  const manifest = readJson('public/svg_templates/library_manifest_v1.json');
  const lookup = templateLookup.bind(null, manifest);
  const example = createRohrofenPlantExample(lookup);
  const sheet = getActivePlantSheet(example);
  const report = validatePlantDrawing(example, lookup);

  check(example.schema === 'plant-factory.plant-drawing',
    'Zeichenmodell besitzt eine stabile Schema-ID');
  check(example.version === 1,
    'Zeichenmodell besitzt eine explizite Version');
  check(sheet.entities.length === 7,
    'Rohrofen-Beispiel besteht aus sieben elementaren Entities',
    String(sheet.entities.length));
  check(sheet.connections.length === 4,
    'Rohrofen-Beispiel enthält semantische Verbindungen',
    String(sheet.connections.length));
  check(report.valid && report.errors.length === 0,
    'Rohrofen-Beispiel validiert fehlerfrei',
    report.errors.join('; '));

  const bottle = createPlantEntity(lookup('Gas_bottle'), 100, 100);
  const reactor = createPlantEntity(lookup('Tubular_reactor'), 300, 100);
  const isolated = normalizePlantDrawing({
    active_sheet_id: 'sheet_main',
    sheets: [{
      sheet_id: 'sheet_main',
      name: 'Porttest',
      width: 800,
      height: 600,
      grid: 10,
      entities: [bottle, reactor],
      connections: [],
      primitives: []
    }]
  });
  const isolatedSheet = getActivePlantSheet(isolated);
  const connectionResult = createPlantConnection(
    isolatedSheet,
    { entity_id: bottle.entity_id, port_id: 'gas_out' },
    { entity_id: reactor.entity_id, port_id: 'feed' },
    'process'
  );
  isolatedSheet.connections.push(connectionResult.connection);
  const points = plantConnectionPoints(isolatedSheet, connectionResult.connection);
  check(Boolean(points) && points.from.x !== points.to.x,
    'Semantische Ports werden in Weltkoordinaten aufgelöst');
  check(plantOrthogonalPath(points.from, points.to).startsWith('M'),
    'Verbindungen erhalten einen deterministischen orthogonalen Pfad');

  const selection = {
    entity_ids: [bottle.entity_id, reactor.entity_id],
    connection_ids: [],
    primitive_ids: []
  };
  const exposed = collectExposedPlantPorts(
    isolatedSheet,
    selection,
    { x: 80, y: 80, width: 450, height: 300 }
  );
  const exposedIds = exposed.map(function (port) { return port.id; });
  check(exposed.length === 2 && exposedIds.some(function (id) { return id.includes('product'); })
    && exposedIds.some(function (id) { return id.includes('service_in'); }),
    'Interne Ports verschwinden, externe Ports bleiben an der Baugruppe');

  const duplicate = duplicatePlantSelection(isolated, selection, 30);
  check(getActivePlantSheet(duplicate.model).entities.length === 4,
    'Mehrfachauswahl wird ohne Verlust elementar dupliziert');
  const deleted = deletePlantSelection(duplicate.model, duplicate.selection);
  check(getActivePlantSheet(deleted).entities.length === 2,
    'Löschen entfernt nur die neue Auswahl und ihre Verbindungen');

  const eventRules = normalizeSvgEventAnimations([{
    animation_id: 'reactor_temperature_high',
    name: 'Reaktor heiß',
    trigger: {
      type: 'signal',
      source: { kind: 'sensor', sensor_id: 7, field: 'value' },
      condition: { operator: 'gte', value: 500 }
    },
    target: {
      element_id: 'reactor_1',
      part_selector: '[data-pf-state-target="temperature"]'
    },
    effect: {
      type: 'temperature',
      active_color: '#ef4444',
      inactive_color: '#60a5fa',
      duration_ms: 800
    }
  }]);
  const eventReport = validateSvgEventAnimations(eventRules, {
    element_ids: ['reactor_1']
  });
  check(eventRules.length === 1 && eventRules[0].effect.type === 'temperature',
    'Farbanimation wird kanonisch normalisiert');
  check(eventReport.valid && eventReport.errors.length === 0,
    'Signalgebundene SVG-Ereignisregel validiert fehlerfrei',
    eventReport.errors.join('; '));
  check(eventRules[0].target.part_selector.includes('data-pf-state-target'),
    'Animation adressiert ein semantisches SVG-Unterelement');

  console.log('V64 model contract passed: ' + passed + ' checks.');
}

main();
