/**
 * Functional runtime contract for the V64_r4 drawing geometry:
 * stretch profiles, mirroring, flow inversion, scale modes, the growing
 * sheet and the r4 reference example.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SHEET_MARGIN,
  SCALE_MODES,
  createPlantEntity,
  createRohrofenAssemblyExample,
  createRohrofenR4Example,
  fitPlantSheetToContent,
  flipPlantEntity,
  getActivePlantSheet,
  invertPlantEntity,
  normalizeAssemblyTemplate,
  normalizePlantDrawing,
  normalizePlantEntity,
  normalizeStretchProfile,
  plantContentBounds,
  plantEntityPortLocalPoint,
  plantEntityTransformSummary,
  plantPortWorldPoint,
  plantStretchMap,
  refreshPlantEntityPorts,
  resizePlantEntityByHandle,
  resizePlantEntityPorts,
  setPlantEntityScaleMode,
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

function near(left, right, tolerance) {
  return Math.abs(left - right) <= (tolerance || 0.01);
}

function portOf(entity, portId) {
  return entity.ports.find(function (port) { return port.id === portId; });
}

const manifest = readJson('public/svg_templates/library_manifest_v1.json');

function templateLookup(templateId) {
  return manifest.templates[templateId] || null;
}

// --- stretch profiles and mapping ---------------------------------------
const pipeTemplate = templateLookup('Pipe_straight');
check(pipeTemplate && pipeTemplate.stretch && pipeTemplate.stretch.axis === 'x'
  && pipeTemplate.stretch.fixed.length === 3, 'Pipe_straight trägt ein Streckprofil mit drei festen Segmenten');
['Pipe_tee', 'Capillary_line', 'Jacked_pipeline'].forEach(function (templateId) {
  const template = templateLookup(templateId);
  check(template && template.stretch && template.stretch.axis === 'x', templateId + ' ist streckbar');
});
check(normalizeStretchProfile({ axis: 'y', fixed: [[40, 10], [0, 12], ['a', 'b'], [50, 60]] }).fixed.join('|') === '0,12|50,60',
  'Streckprofil wird bereinigt und sortiert');
check(normalizeStretchProfile('nonsense') === null, 'Ungültiges Streckprofil wird verworfen');

const pipe = createPlantEntity(pipeTemplate, 100, 100);
check(pipe.scale_mode === 'stretch' && pipe.stretch && pipe.view_box.join(',') === '0,0,140,60',
  'Rohr wird mit Streckmodus und Template-viewBox erzeugt');
const longPipe = resizePlantEntityPorts(pipe, 410, 60);
check(portOf(longPipe, 'outlet').x === 410 && portOf(longPipe, 'inlet').x === 0, 'Ports folgen dem gestreckten Rohr');
const mapping = plantStretchMap(pipe.stretch, pipe.view_box, 410, 60);
check(mapping.segments.length === 5 && mapping.segments.filter(function (s) { return s.fixed; }).length === 3,
  'Streckabbildung besteht aus drei festen und zwei flexiblen Segmenten');
check(near(mapping.segments[0].length, 12) && near(mapping.segments[2].length, 22) && near(mapping.segments[4].length, 12),
  'Feste Segmente behalten ihre native Länge', JSON.stringify(mapping.segments.map(function (s) { return s.length; })));
check(near(mapping.map(140), 410) && near(mapping.map(0), 0) && mapping.map(67) > 182 && mapping.map(67) < 204,
  'Abbildung bildet Anfang, Ende und Pfeilbereich korrekt ab', String(mapping.map(67)));
const shortPipe = resizePlantEntityPorts(pipe, 30, 60);
check(portOf(shortPipe, 'outlet').x === 30, 'Zu kurze Rohre werden gleichmäßig komprimiert');

const jacketTemplate = templateLookup('Jacked_pipeline');
const jacket = resizePlantEntityPorts(createPlantEntity(jacketTemplate, 0, 0), 300, 60);
check(portOf(jacket, 'utility_in').x === 20 && portOf(jacket, 'utility_out').x === 280,
  'Mantelanschlüsse bleiben an den festen Endkappen verankert', JSON.stringify(jacket.ports.map(function (p) { return [p.id, p.x]; })));

// --- mirroring and inversion --------------------------------------------
const flipped = flipPlantEntity(longPipe, 'x');
check(flipped.flip_x === true && portOf(flipped, 'inlet').x === 410 && portOf(flipped, 'outlet').x === 0,
  'Horizontales Spiegeln tauscht die Portlagen');
const flippedBack = flipPlantEntity(flipped, 'x');
check(flippedBack.flip_x === false && portOf(flippedBack, 'inlet').x === 0, 'Spiegeln ist reversibel');
const inverted = invertPlantEntity(longPipe);
check(inverted.inverted === true && portOf(inverted, 'inlet').direction === 'out' && portOf(inverted, 'outlet').direction === 'in',
  'Invertieren tauscht Ein- und Ausgang');
check(invertPlantEntity(inverted, true).inverted === true && portOf(invertPlantEntity(inverted, true), 'inlet').direction === 'out',
  'Erzwungener Zustand ist idempotent');
check(invertPlantEntity(inverted, false).inverted === false && portOf(invertPlantEntity(inverted, false), 'inlet').direction === 'in',
  'Invertieren ist reversibel');
const elbow = createPlantEntity(templateLookup('Pipe_elbow_90'), 0, 0, { rotation: 270, flip_x: true });
const elbowInlet = plantPortWorldPoint(elbow, portOf(elbow, 'inlet'));
const elbowOutlet = plantPortWorldPoint(elbow, portOf(elbow, 'outlet'));
check(near(elbowInlet.y, 0) && near(elbowInlet.x, 30) && near(elbowOutlet.x, 100) && near(elbowOutlet.y, 70),
  'Gespiegelter, gedrehter Bogen: Eingang oben, Ausgang rechts', JSON.stringify([elbowInlet, elbowOutlet]));
const flag = createPlantEntity(templateLookup('Boundary_connector'), 0, 0, { flip_x: true, tag: 'N₂' });
check(portOf(flag, 'line').x === 100 && flag.tag === 'N₂', 'Gespiegelte Grenzstelle trägt ihren Port rechts');
check(plantEntityTransformSummary(createPlantEntity(templateLookup('Pipe_straight'), 0, 0, { rotation: 90, flip_y: true, inverted: true }))
  === '90° · gespiegelt Y · invertiert · gestreckt', 'Transformationszusammenfassung ist lesbar');

// --- scale modes ----------------------------------------------------------
check(SCALE_MODES.join(',') === 'uniform,stretch,free', 'Drei Skalierungsmodi');
const furnace = createPlantEntity(templateLookup('Tube_furnace'), 0, 0);
check(furnace.scale_mode === 'uniform', 'Geräte skalieren proportional');
const resizedFurnace = resizePlantEntityByHandle(furnace, 'e', 80, 0, { minimum: 10 });
check(near(resizedFurnace.width / resizedFurnace.height, 160 / 220) && resizedFurnace.width === 240,
  'Griff hält bei proportionalen Geräten das Seitenverhältnis', resizedFurnace.width + 'x' + resizedFurnace.height);
const freeFurnace = resizePlantEntityByHandle(setPlantEntityScaleMode(furnace, 'free'), 'e', 80, 0, { minimum: 10 });
check(freeFurnace.width === 240 && freeFurnace.height === 220, 'Freie Skalierung erlaubt Verzerrung');
check(setPlantEntityScaleMode(furnace, 'stretch').scale_mode === 'free', 'Strecken ohne Profil fällt auf frei zurück');
const stretchedByHandle = resizePlantEntityByHandle(pipe, 'e', 200, 0, { minimum: 10 });
check(stretchedByHandle.width === 340 && stretchedByHandle.height === 60 && portOf(stretchedByHandle, 'outlet').x === 340,
  'Griff streckt Rohre nur entlang der Achse');
const local = plantEntityPortLocalPoint(Object.assign({}, longPipe, { flip_y: true }), portOf(longPipe, 'inlet'));
check(local.x === 0 && local.y === 30, 'Lokale Portposition berücksichtigt Spiegelung auf der Mittellinie');

// --- normalization and legacy data ---------------------------------------
const legacy = normalizePlantEntity({ entity_id: 'e', template_id: 'Tube_furnace', width: 190, height: 300 });
check(legacy.flip_x === false && legacy.inverted === false && legacy.scale_mode === 'uniform' && legacy.stretch === null
  && legacy.view_box.join(',') === '0,0,190,300', 'Alte Entities normalisieren mit neutralen r4-Feldern');
const legacyModel = normalizePlantDrawing(createRohrofenAssemblyExample(templateLookup));
check(validatePlantDrawing(legacyModel, templateLookup).valid, 'R3-Beispiel bleibt gültig');
const assembly = normalizeAssemblyTemplate({ name: 'A', entities: [Object.assign({}, flipped, { entity_id: 'f1' })], width: 410, height: 60 });
check(assembly.entities[0].flip_x === true && assembly.entities[0].scale_mode === 'stretch',
  'Baugruppen bewahren Spiegelung und Skalierungsmodus');
const refreshed = refreshPlantEntityPorts(Object.assign({}, longPipe, { width: 200 }));
check(portOf(refreshed, 'outlet').x === 200, 'Ports werden aus relativen Koordinaten neu berechnet');

// --- growing sheet ---------------------------------------------------------
const model = normalizePlantDrawing({ sheets: [{ sheet_id: 's', width: 1600, height: 1000, entities: [
  Object.assign({}, pipe, { x: -50, y: -120 }),
  Object.assign({}, furnace, { x: 1700, y: 950 })
] }], active_sheet_id: 's' });
const bounds = plantContentBounds(getActivePlantSheet(model));
check(bounds.x === -50 && bounds.y === -120, 'Inhaltsgrenzen umfassen alle Teile');
const fitted = fitPlantSheetToContent(model, { margin: DEFAULT_SHEET_MARGIN });
const fittedSheet = getActivePlantSheet(fitted.model);
check(fitted.changed && fitted.dx === 130 && fitted.dy === 200, 'Inhalt wird rasterbündig in den Blattrand verschoben', fitted.dx + '/' + fitted.dy);
check(fittedSheet.entities[0].x === 80 && fittedSheet.entities[0].y === 80, 'Verschiebung wirkt auf alle Teile');
check(fittedSheet.width >= 1700 + 130 + 160 + DEFAULT_SHEET_MARGIN && fittedSheet.height >= 950 + 200 + 220 + DEFAULT_SHEET_MARGIN,
  'Blatt wächst bis hinter das letzte Teil', fittedSheet.width + 'x' + fittedSheet.height);
const again = fitPlantSheetToContent(fitted.model, { margin: DEFAULT_SHEET_MARGIN });
check(again.changed === false, 'Passendes Blatt bleibt unverändert');
const shrunk = fitPlantSheetToContent(normalizePlantDrawing({ sheets: [{ sheet_id: 's', width: 5000, height: 4000, entities: [pipe] }], active_sheet_id: 's' }), { shrink: true });
check(getActivePlantSheet(shrunk.model).width === 400 && getActivePlantSheet(shrunk.model).height === 300, 'Anpassen an den Inhalt schrumpft auf Mindestmaße');
check(fitPlantSheetToContent(normalizePlantDrawing(null)).changed === false, 'Leeres Blatt bleibt unverändert');

// --- r4 reference example ---------------------------------------------------
const example = createRohrofenR4Example(templateLookup);
const report = validatePlantDrawing(example, templateLookup);
check(report.valid && report.counts.entities === 31 && report.counts.joints === 25 && report.counts.open_joints === 0,
  'R4-Beispiel: 31 Teile, 25 geschlossene Joints', JSON.stringify(report.counts));
const exampleSheet = getActivePlantSheet(example);
const templates = new Set(exampleSheet.entities.map(function (entity) { return entity.template_id; }));
['Boundary_connector', 'Capillary_line', 'Swagelok_union', 'Swagelok_elbow', 'Gas_mixer'].forEach(function (templateId) {
  check(templates.has(templateId), 'R4-Beispiel nutzt ' + templateId);
});
check(exampleSheet.entities.some(function (entity) { return entity.template_id === 'Pipe_elbow_90' && entity.flip_x && entity.rotation === 270; })
  && exampleSheet.entities.some(function (entity) { return entity.template_id === 'Pipe_elbow_90' && entity.flip_y; }),
  'U-Bogen entsteht aus gespiegelten Rohrbögen');
const cooler = exampleSheet.entities.find(function (entity) { return entity.template_id === 'Double_pipe_cooler'; });
const coolerIn = plantPortWorldPoint(cooler, portOf(cooler, 'process_in'));
const coolerOut = plantPortWorldPoint(cooler, portOf(cooler, 'process_out'));
check(coolerIn.y > coolerOut.y, 'Kühler ist gedreht: Prozess strömt von unten nach oben');
const flags = exampleSheet.entities.filter(function (entity) { return entity.template_id === 'Boundary_connector'; }).map(function (entity) { return entity.tag; });
check(flags.join(',') === 'N₂,Educts,Vent,KW ein,KW aus', 'Grenzstellen tragen ihre Tags', flags.join(','));

console.log('V64_r4 model contract passed: ' + passed + ' checks.');
