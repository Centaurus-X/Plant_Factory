/**
 * Functional runtime contract for the V64_r3 plug-together drawing model.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attachPlantEntityToPort,
  closePlantJoint,
  createAssemblyTemplate,
  createPlantEntity,
  createPlantJoints,
  createRohrofenAssemblyExample,
  createRohrofenPlantExample,
  expandPlantSelectionToComponent,
  findPlantSnapCandidate,
  getActivePlantSheet,
  instantiateAssemblyTemplate,
  normalizeAssemblyTemplate,
  normalizePlantDrawing,
  plantConnectedComponent,
  plantJointGap,
  plantPortWorldPoint,
  resizePlantEntityByHandle,
  rotatePlantSelection,
  snapPlantEntitiesToPorts,
  translatePlantEntities,
  upsertAssemblyTemplate,
  validatePlantDrawing
} from '../public/js/v64_plant_drawing_model.js';

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

function sheetWith(entities, connections) {
  return normalizePlantDrawing({
    active_sheet_id: 'sheet_main',
    sheets: [{
      sheet_id: 'sheet_main',
      name: 'Steckprobe',
      width: 1600,
      height: 1000,
      grid: 10,
      entities: entities,
      connections: connections || [],
      primitives: []
    }]
  });
}

function main() {
  const manifest = readJson('public/svg_templates/library_manifest_v1.json');
  const lookup = templateLookup.bind(null, manifest);

  // --- inherited r1 example stays byte-for-byte compatible -----------------
  const legacy = createRohrofenPlantExample(lookup);
  check(getActivePlantSheet(legacy).entities.length === 7
    && getActivePlantSheet(legacy).connections.length === 4,
    'R1-Rohrofen-Beispiel bleibt unverändert (7 Entities, 4 Verbindungen)');
  check(legacy.assembly_templates.length === 0 && Array.isArray(legacy.inventory.imported_template_ids),
    'Normalisierung ergänzt Baugruppen- und Inventarfelder additiv');

  // --- snapping: a pipe dragged near a flange inlet snaps and joins --------
  const pipe = createPlantEntity(lookup('Pipe_straight'), 100, 100);
  const flange = createPlantEntity(lookup('Flange_pair'), 100 + 140 + 9, 104);
  let model = sheetWith([pipe, flange]);
  let sheet = getActivePlantSheet(model);
  const candidate = findPlantSnapCandidate(sheet, [flange.entity_id], 18);
  check(Boolean(candidate) && candidate.moving_port_id === 'inlet' && candidate.target_port_id === 'outlet',
    'Snap-Kandidat koppelt Flansch-Eingang an Rohr-Ausgang', JSON.stringify(candidate));
  check(candidate.distance > 9 && candidate.distance < 10,
    'Snap-Abstand wird exakt gemessen', String(candidate.distance));
  const snapped = snapPlantEntitiesToPorts(model, [flange.entity_id], 18);
  sheet = getActivePlantSheet(snapped.model);
  check(snapped.connections.length === 1 && snapped.connections[0].joint === true
    && snapped.connections[0].routing === 'direct',
    'Einrasten erzeugt genau eine gesteckte Verbindung (Joint)');
  check(plantJointGap(sheet, snapped.connections[0]) < 0.001,
    'Gesteckte Ports liegen exakt aufeinander');
  const movedFlange = sheet.entities.find(function (entity) { return entity.entity_id === flange.entity_id; });
  check(movedFlange.x === 240 && movedFlange.y === 100,
    'Flansch wurde auf die Rohrachse verschoben', movedFlange.x + '/' + movedFlange.y);

  // --- occupied ports are never offered again --------------------------------
  const second = createPlantEntity(lookup('Pipe_straight'), 240 + 60 + 5, 100);
  model = sheetWith(sheet.entities.concat([second]), sheet.connections);
  const secondCandidate = findPlantSnapCandidate(getActivePlantSheet(model), [second.entity_id], 18);
  check(Boolean(secondCandidate) && secondCandidate.target_entity_id === flange.entity_id
    && secondCandidate.target_port_id === 'outlet',
    'Zweites Rohr rastet am freien Flansch-Ausgang ein');
  const chain = snapPlantEntitiesToPorts(model, [second.entity_id], 18);
  sheet = getActivePlantSheet(chain.model);
  check(sheet.connections.length === 2 && sheet.connections.every(function (c) { return c.joint; }),
    'Kette Rohr-Flansch-Rohr besteht aus zwei Joints');
  const blocked = findPlantSnapCandidate(sheet, [second.entity_id], 18);
  check(blocked === null, 'Belegte Ports werden nicht erneut als Snap-Ziel angeboten');

  // --- connected component and linked move ------------------------------------
  const component = plantConnectedComponent(sheet, pipe.entity_id);
  check(component.size === 3, 'Verbund über Joints umfasst alle drei Teile', String(component.size));
  const expanded = expandPlantSelectionToComponent(sheet, { entity_ids: [second.entity_id], connection_ids: [], primitive_ids: [] });
  check(expanded.entity_ids.length === 3, 'Auswahl lässt sich auf den Verbund erweitern');
  const shifted = translatePlantEntities(chain.model, Array.from(component), 30, 40);
  const shiftedSheet = getActivePlantSheet(shifted);
  check(shiftedSheet.connections.every(function (c) { return plantJointGap(shiftedSheet, c) < 0.001; }),
    'Verschieben des Verbunds hält alle Joints geschlossen');

  // --- opening and closing a joint ------------------------------------------
  const opened = translatePlantEntities(chain.model, [second.entity_id], 55, -20);
  const openedSheet = getActivePlantSheet(opened);
  const openJoint = openedSheet.connections.find(function (c) {
    return c.from_entity_id === second.entity_id || c.to_entity_id === second.entity_id;
  });
  check(plantJointGap(openedSheet, openJoint) > 50, 'Einzeln verschobenes Teil öffnet seinen Joint');
  const openReport = validatePlantDrawing(opened, lookup);
  check(openReport.valid && openReport.counts.open_joints === 1
    && openReport.warnings.some(function (w) { return w.includes('geöffnet'); }),
    'Validierung meldet offene Joints als Hinweis, nicht als Fehler');
  const closed = closePlantJoint(opened, openJoint.connection_id, second.entity_id);
  const closedSheet = getActivePlantSheet(closed);
  check(plantJointGap(closedSheet, openJoint) < 0.001, 'Zusammenziehen schließt den Joint wieder');

  // --- rotation keeps joints, resize keeps relative ports ---------------------
  const rotated = rotatePlantSelection(chain.model, expanded, 90);
  const rotatedSheet = getActivePlantSheet(rotated);
  check(rotatedSheet.connections.every(function (c) { return plantJointGap(rotatedSheet, c) < 0.01; }),
    'Drehen des Verbunds um 90° hält alle Joints geschlossen');
  check(rotatedSheet.entities.every(function (e) { return e.rotation === 90; }),
    'Alle Teile tragen die neue Drehung');
  const resized = resizePlantEntityByHandle(pipe, 'e', 120, 0);
  check(resized.width === 260 && resized.ports.find(function (p) { return p.id === 'outlet'; }).x === 260
    && resized.ports.find(function (p) { return p.id === 'inlet'; }).x === 0,
    'Griff-Resize streckt das Rohr und führt die Ports mit');
  const resizedWest = resizePlantEntityByHandle(pipe, 'w', 40, 0);
  check(resizedWest.width === 100 && resizedWest.x === 140,
    'West-Griff hält die rechte Kante fest');

  // --- assembly template round trip -------------------------------------------
  const assembly = createAssemblyTemplate(sheet, expanded, { name: 'Rohrstrecke', category: 'Test', scope: 'project' });
  check(assembly.entities.length === 3 && assembly.connections.length === 2
    && assembly.exposed_ports.length === 2,
    'Baugruppen-Template bewahrt Teile, Joints und die zwei freien Endports');
  check(assembly.entities.every(function (e) { return e.x >= 0 && e.y >= 0; }) && assembly.width === 340,
    'Baugruppe wird auf lokale Koordinaten normalisiert', assembly.width + '');
  const stored = upsertAssemblyTemplate(createRohrofenPlantExample(lookup), assembly);
  check(stored.assembly_templates.length === 1
    && normalizePlantDrawing(JSON.parse(JSON.stringify(stored))).assembly_templates[0].entities.length === 3,
    'Baugruppe bleibt im Projekt nach JSON-Roundtrip erhalten');
  const instance = instantiateAssemblyTemplate(stored, assembly, 500, 600);
  const instanceSheet = getActivePlantSheet(instance.model);
  const placed = instanceSheet.entities.filter(function (e) { return e.assembly_id === instance.assembly_id; });
  check(placed.length === 3 && placed.every(function (e) { return e.assembly_template_id === assembly.assembly_template_id; }),
    'Platzierte Baugruppe entsteht wieder aus drei einzelnen Entities');
  check(new Set(placed.map(function (e) { return e.entity_id; })).size === 3
    && placed.every(function (e) { return !assembly.entities.some(function (t) { return t.entity_id === e.entity_id; }); }),
    'Instanzen erhalten neue Entity-IDs');
  const placedJoints = instanceSheet.connections.filter(function (c) {
    return placed.some(function (e) { return e.entity_id === c.from_entity_id; });
  });
  check(placedJoints.length === 2 && placedJoints.every(function (c) { return plantJointGap(instanceSheet, c) < 0.001; }),
    'Interne Joints werden mit neuen IDs übernommen und bleiben geschlossen');
  const normalizedAssembly = normalizeAssemblyTemplate({ name: 'x', entities: [{ template_id: 'Pipe_straight' }], connections: [{ from_entity_id: 'a', to_entity_id: 'b' }] });
  check(normalizedAssembly.connections.length === 0 && normalizedAssembly.schema === 'plant-factory.plant-drawing-assembly',
    'Baugruppen-Normalisierung verwirft hängende Verbindungen');

  // --- attach helper and assembly example -------------------------------------
  const valve = attachPlantEntityToPort(createPlantEntity(lookup('Valve_(general)'), 0, 0), 'inlet', pipe, 'outlet');
  const valvePoint = plantPortWorldPoint(valve, valve.ports.find(function (p) { return p.id === 'inlet'; }));
  const pipePoint = plantPortWorldPoint(pipe, pipe.ports.find(function (p) { return p.id === 'outlet'; }));
  check(Math.abs(valvePoint.x - pipePoint.x) < 0.001 && Math.abs(valvePoint.y - pipePoint.y) < 0.001,
    'attachPlantEntityToPort setzt Port auf Port');
  const example = createRohrofenAssemblyExample(lookup);
  const exampleSheet = getActivePlantSheet(example);
  const exampleReport = validatePlantDrawing(example, lookup);
  check(exampleSheet.entities.length === 21 && exampleReport.counts.joints === 17 && exampleReport.counts.open_joints === 0,
    'Zusammengesteckte Rohrofen-Anlage: 21 Teile, 17 geschlossene Joints', JSON.stringify(exampleReport.counts));
  check(exampleReport.valid && exampleReport.errors.length === 0,
    'Zusammengesteckte Rohrofen-Anlage validiert fehlerfrei', exampleReport.errors.join('; '));
  check(exampleSheet.entities.every(function (e) {
    return e.x >= 0 && e.y >= 0 && e.x + e.width <= exampleSheet.width && e.y + e.height <= exampleSheet.height;
  }), 'Alle Teile liegen innerhalb des Blatts');
  const furnace = exampleSheet.entities.find(function (e) { return e.template_id === 'Tube_furnace'; });
  check(plantConnectedComponent(exampleSheet, furnace.entity_id).size === 18,
    'Der Rohrstrang bildet einen Verbund aus 18 gesteckten Teilen');
  const joined = createPlantJoints(example, [furnace.entity_id], 0.75);
  check(joined.connections.length === 0, 'Bereits gesteckte Ports erzeugen keine doppelten Joints');

  console.log('V64_r3 model contract passed: ' + passed + ' checks.');
}

main();
