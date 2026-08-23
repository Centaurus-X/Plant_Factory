/**
 * Functional runtime contract for the V64_r5 classic drawing variant:
 * layers, visual states, routed lines, regions, dimensions, the per-sheet
 * auto-grow margin and both reference examples rebuilt from classic parts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SHEET_MARGIN,
  DRAWING_LAYERS,
  LABEL_POSITIONS,
  LINE_STYLES,
  LINE_STYLE_PRESETS,
  createClassicReactorExample,
  createClassicTemplateExample,
  createEmptyPlantDrawing,
  createPlantEntity,
  fitPlantSheetToContent,
  getActivePlantSheet,
  lineStylePreset,
  normalizeAssemblyTemplate,
  normalizePlantDrawing,
  normalizePlantEntity,
  normalizePlantPoints,
  normalizePlantPrimitive,
  plantContentBounds,
  plantPortWorldPoint,
  plantPrimitiveBounds,
  setPlantEntityLayer,
  setPlantEntityVisualState,
  translatePlantPrimitive,
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

function countBy(items, keyOf) {
  return items.reduce(function (counts, item) {
    const key = keyOf(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

const manifest = readJson('public/svg_templates/library_manifest_v1.json');

function templateLookup(templateId) {
  return manifest.templates[templateId] || null;
}

// --- constants and presets ------------------------------------------------
check(DRAWING_LAYERS.join(',') === 'process,structure,annotation', 'Drei Ebenen: Prozess, Gestell, Beschriftung');
check(LINE_STYLES.length === 9 && LINE_STYLES.includes('capillary') && LINE_STYLES.includes('coolant'),
  'Neun Leitungsstile inklusive Kapillare und Kühlwasser');
check(LABEL_POSITIONS.join(',') === 'inside,above', 'Bereichs-Beschriftung innen oder über dem Rahmen');
check(LINE_STYLE_PRESETS.hot.stroke === '#b33a3a' && LINE_STYLE_PRESETS.hot.dashes === true
  && LINE_STYLE_PRESETS.signal.dash === '4 3' && LINE_STYLE_PRESETS.purge.stroke === '#2db34a',
  'Presets tragen die Referenzfarben (heiß rot mit Laufstrichen, Signal gestrichelt, Spülgas grün)');
check(lineStylePreset('nonsense') === LINE_STYLE_PRESETS.plain && lineStylePreset('pipe').width === 3.5,
  'Unbekannte Stile fallen auf „frei“ zurück, Rohrleitung ist 3,5 breit');
check(Object.isFrozen(LINE_STYLE_PRESETS) && Object.isFrozen(LINE_STYLE_PRESETS.pipe), 'Presets sind unveränderlich');

// --- points, routed lines, regions and dimensions -------------------------
const points = normalizePlantPoints([[10, 20], { x: 30, y: '40' }, 'junk', [5], null, { x: 'x', y: 60 }]);
check(points.length === 3 && points[1].y === 40 && points[2].x === 0 && points[2].y === 60,
  'Punktlisten akzeptieren Paare und Objekte, verwerfen Unbrauchbares', JSON.stringify(points));
const routed = normalizePlantPrimitive({ type: 'polyline', points: [[64, 318], [255, 318], [255, 110]], line_style: 'hot', animated: true });
check(routed.x1 === 64 && routed.y1 === 318 && routed.x2 === 255 && routed.y2 === 110 && routed.points.length === 3,
  'Leitung leitet Anfang und Ende aus ihren Punkten ab');
check(routed.line_style === 'hot' && routed.animated === true && routed.layer === 'process' && routed.fill === 'none',
  'Leitung behält Stil, Animation und Prozess-Ebene');
const region = normalizePlantPrimitive({ type: 'region', x1: 60, y1: 260, x2: 230, y2: 520, label: 'Ventilpanel', label_position: 'above' });
check(region.layer === 'annotation' && region.label === 'Ventilpanel' && region.label_position === 'above'
  && region.stroke === '#777777' && region.font_size === 12 && region.stroke_width === 1.5,
  'Bereich liegt auf der Beschriftungsebene mit Referenzstil');
const dimension = normalizePlantPrimitive({ type: 'dimension', x1: 300, y1: 38, x2: 890, y2: 38, label_position: 'weird' });
check(dimension.layer === 'annotation' && dimension.text === '1000 mm' && dimension.font_size === 13
  && dimension.label_position === 'inside' && dimension.stroke === '#555555',
  'Bemaßung mit Standardtext, 13 px und bereinigter Beschriftungslage');
check(normalizePlantPrimitive({ type: 'polyline', line_style: 'bogus', layer: 'sky' }).line_style === 'plain'
  && normalizePlantPrimitive({ type: 'polyline', layer: 'sky' }).layer === 'process',
  'Ungültige Stile und Ebenen werden neutralisiert');
const moved = translatePlantPrimitive(routed, 10, -5);
check(moved.points[0].x === 74 && moved.points[0].y === 313 && moved.x2 === 265 && moved.y2 === 105,
  'Verschieben wirkt auf alle Punkte und die Endpunkte');
const routedBounds = plantPrimitiveBounds(routed);
check(routedBounds.x === 64 && routedBounds.y === 110 && routedBounds.width === 191 && routedBounds.height === 208,
  'Grenzen einer Leitung umfassen alle Punkte', JSON.stringify(routedBounds));
const centredText = plantPrimitiveBounds({ type: 'text', x1: 720, y1: 747, text: 'Doppelrohr-Kühler', font_size: 11, text_anchor: 'middle' });
check(near(centredText.x + centredText.width / 2, 720), 'Zentrierter Text hat seine Mitte am Ankerpunkt');
const textDefaults = normalizePlantPrimitive({ type: 'text', text: 'Swagelok', font_family: 'Arial, Helvetica, sans-serif', text_anchor: 'end' });
check(textDefaults.font_family === 'Arial, Helvetica, sans-serif' && textDefaults.text_anchor === 'end' && textDefaults.font_size === 16,
  'Texte tragen Schriftfamilie und Ankerlage, Standardgröße bleibt 16');

// --- entity visual states and layers -------------------------------------
const tube = createPlantEntity(templateLookup('Classic_tube'), 0, 0, {});
check(tube.visual_state === 'flow' && tube.layer === 'process' && tube.scale_mode === 'stretch',
  'Klassisches Rohr startet im Zustand „flow“ auf der Prozessebene und ist streckbar');
check(tube.stretch.fixed.length === 2 && tube.stretch.fixed[0][1] === 2, 'Gefülltes Rohr hält nur 2 px feste Enden');
const post = createPlantEntity(templateLookup('Frame_post'), 0, 0, {});
check(post.layer === 'structure' && post.ports.every(function (port) { return port.kind === 'structure'; }),
  'Gestellpfosten liegt auf der Gestellebene mit Gestell-Ports');
check(createPlantEntity(templateLookup('Frame_post'), 0, 0, { layer: 'process' }).layer === 'process',
  'Die Ebene eines Teils kann beim Anlegen überschrieben werden');
check(setPlantEntityVisualState(tube, 'hot').visual_state === 'hot' && setPlantEntityVisualState(tube, '').visual_state === '',
  'Darstellungszustand wird gesetzt und geleert');
check(setPlantEntityLayer(tube, 'annotation').layer === 'annotation' && setPlantEntityLayer(tube, 'moon').layer === 'process',
  'Ebene wechselt nur auf bekannte Werte');
check(normalizePlantEntity({ template_id: 'X', layer: 'nowhere', visual_state: 42 }).layer === 'process'
  && normalizePlantEntity({ template_id: 'X', visual_state: 42 }).visual_state === '42',
  'Alte Entities normalisieren mit Prozessebene und Textzustand');
const flanged = createPlantEntity(templateLookup('Classic_tube_flanged'), 100, 100, { width: 240 });
check(flanged.stretch.fixed[0][1] === 22 && near(portOf(flanged, 'outlet').x, 240),
  'Rohr mit Flansch hält den Flanschbalken fest und streckt den Rest');
const bolted = templateLookup('Classic_flange_bolted');
check(bolted.breite === 40 && bolted.ports.length === 2 && bolted.style === 'classic',
  'Flansch mit Verschraubung ist eine 40 px breite Klassik-Variante');
const tap = createPlantEntity(templateLookup('Classic_tube_tap'), 0, 0, { rotation: 90, width: 53 });
const tapA = plantPortWorldPoint(tap, portOf(tap, 'tap_a'));
const tapB = plantPortWorldPoint(tap, portOf(tap, 'tap_b'));
check(near(Math.abs(tapA.x - tapB.x), 22) && near(tapA.y, tapB.y) && portOf(tap, 'tap_a').role === 'tap',
  'Rohrstück mit Seitenanschluss bietet senkrecht gedreht einen linken und rechten Wandanschluss', JSON.stringify([tapA, tapB]));

// --- per-sheet auto-grow margin ---------------------------------------------
const empty = getActivePlantSheet(createEmptyPlantDrawing());
check(empty.margin === DEFAULT_SHEET_MARGIN, 'Neue Blätter tragen den Standardrand 80');
check(getActivePlantSheet(normalizePlantDrawing({ sheets: [{ sheet_id: 's', margin: -5 }] })).margin === 0
  && getActivePlantSheet(normalizePlantDrawing({ sheets: [{ sheet_id: 's', margin: 'x' }] })).margin === DEFAULT_SHEET_MARGIN,
  'Blattrand ist nie negativ und fällt auf den Standard zurück');
const tight = normalizePlantDrawing({ sheets: [{ sheet_id: 's', width: 400, height: 300, margin: 4, entities: [
  Object.assign({}, tube, { x: 8, y: 8 })
] }], active_sheet_id: 's' });
check(fitPlantSheetToContent(tight, {}).changed === false, 'Referenzrand 4 lässt Teile nahe am Blattrand stehen');
check(fitPlantSheetToContent(tight, { margin: DEFAULT_SHEET_MARGIN }).dx === 80,
  'Ein expliziter Rand übersteuert den Blattrand (R4-Vertrag bleibt erhalten)');
const grown = fitPlantSheetToContent(normalizePlantDrawing({ sheets: [{ sheet_id: 's', width: 400, height: 300, margin: 4, entities: [
  Object.assign({}, tube, { x: 300, y: 280 })
] }], active_sheet_id: 's' }), {});
check(grown.changed && getActivePlantSheet(grown.model).width === 470 && getActivePlantSheet(grown.model).height === 340,
  'Mit kleinem Rand wächst das Blatt knapp hinter das letzte Teil', getActivePlantSheet(grown.model).width + 'x' + getActivePlantSheet(grown.model).height);

// --- assemblies keep the r5 fields ------------------------------------------
const assembly = normalizeAssemblyTemplate({ name: 'Strang', width: 300, height: 100,
  entities: [Object.assign({}, setPlantEntityVisualState(tube, 'cold'), { entity_id: 't' }), Object.assign({}, post, { entity_id: 'p' })],
  connections: [{ connection_id: 'j', from_entity_id: 'p', from_port_id: 'top', to_entity_id: 'p', to_port_id: 'bottom', kind: 'structure', joint: true }],
  primitives: [routed, region, dimension] });
check(assembly.entities[0].visual_state === 'cold' && assembly.entities[1].layer === 'structure',
  'Baugruppen bewahren Zustand und Ebene ihrer Teile');
check(assembly.connections.length === 1 && assembly.connections[0].kind === 'structure', 'Baugruppen bewahren Gestell-Verbindungen');
check(assembly.primitives[0].points.length === 3 && assembly.primitives[1].label === 'Ventilpanel' && assembly.primitives[2].type === 'dimension',
  'Baugruppen bewahren Leitungen, Bereiche und Bemaßungen');

// --- reference example 1: classic reactor P&ID ------------------------------
const reactor = createClassicReactorExample(templateLookup);
const reactorReport = validatePlantDrawing(reactor, templateLookup);
check(reactorReport.valid && reactorReport.counts.entities === 39 && reactorReport.counts.joints === 23
  && reactorReport.counts.open_joints === 0 && reactorReport.counts.primitives === 31,
  'Reaktor-P&ID: 39 Teile, 23 geschlossene Joints, 31 Zeichenelemente', JSON.stringify(reactorReport.counts));
const reactorSheet = getActivePlantSheet(reactor);
check(reactorSheet.width === 1300 && reactorSheet.height === 1110 && reactorSheet.margin === 4,
  'Reaktor-Blatt entspricht dem Referenzmaß 1300 × 1110 mit Referenzrand');
check(fitPlantSheetToContent(reactor, {}).changed === false, 'Automatisches Wachsen verändert das Referenzblatt nicht');
const reactorBounds = plantContentBounds(reactorSheet);
check(reactorBounds.x >= 0 && reactorBounds.y >= 0 && reactorBounds.x + reactorBounds.width <= 1300
  && reactorBounds.y + reactorBounds.height <= 1110, 'Alle Teile liegen innerhalb des Referenzblatts', JSON.stringify(reactorBounds));
const reactorLayers = countBy(reactorSheet.entities, function (entity) { return entity.layer; });
check(reactorLayers.process === 31 && reactorLayers.structure === 8, 'Gestell aus acht Teilen auf der Gestellebene', JSON.stringify(reactorLayers));
const reactorKinds = countBy(reactorSheet.connections, function (connection) { return connection.kind; });
check(reactorKinds.process === 18 && reactorKinds.structure === 5, 'Prozess- und Gestell-Joints getrennt gezählt', JSON.stringify(reactorKinds));
const reactorTemplates = new Set(reactorSheet.entities.map(function (entity) { return entity.template_id; }));
['Classic_tube', 'Classic_tube_tap', 'Classic_tube_head', 'Classic_flange', 'Classic_tube_ubend', 'Classic_swagelok', 'Classic_capillary',
  'Classic_furnace', 'Classic_cooler', 'Classic_valve', 'Classic_flag', 'Classic_flag_back', 'Classic_instrument',
  'Frame_post', 'Frame_beam', 'Frame_foot', 'Frame_floor', 'Frame_clamp'].forEach(function (templateId) {
  check(reactorTemplates.has(templateId), 'Reaktor-Beispiel nutzt ' + templateId);
});
const furnace = reactorSheet.entities.find(function (entity) { return entity.template_id === 'Classic_furnace'; });
const cooler = reactorSheet.entities.find(function (entity) { return entity.template_id === 'Classic_cooler'; });
check(furnace.visual_state === 'hot' && cooler.visual_state === 'cold', 'Rohrofen heiß, Kühler kalt');
check(reactorSheet.entities.filter(function (entity) { return entity.template_id === 'Classic_valve'; })
  .every(function (valve) { return valve.visual_state === 'open'; }), 'Alle Handventile stehen auf „open“ (grün)');
const tapJoint = reactorSheet.connections.find(function (connection) {
  return connection.from_port_id === 'tap_b' || connection.to_port_id === 'tap_b';
});
const headJoint = reactorSheet.connections.find(function (connection) { return connection.to_port_id === 'capillary'; });
check(Boolean(tapJoint) && Boolean(headJoint), 'Seitlicher Swagelok hängt am Wandanschluss, axialer Swagelok am Rohrkopf');
const sideCapillary = reactorSheet.entities.find(function (entity) { return entity.name === 'Kapillare zum Seitenanschluss'; });
const sideOutlet = plantPortWorldPoint(sideCapillary, portOf(sideCapillary, 'outlet'));
check(near(sideOutlet.x, 494) && near(sideOutlet.y, 210), 'Seitliche Kapillare endet an der Rohrwand (494, 210) wie im Referenzbild', JSON.stringify(sideOutlet));
const primitiveTypes = countBy(reactorSheet.primitives, function (primitive) { return primitive.type; });
check(primitiveTypes.region === 2 && primitiveTypes.dimension === 5 && primitiveTypes.polyline === 13 && primitiveTypes.text === 11,
  'Zwei Bereiche, fünf Bemaßungen, 13 Leitungen und elf Texte', JSON.stringify(primitiveTypes));
const lineStyles = new Set(reactorSheet.primitives.filter(function (primitive) { return primitive.type === 'polyline'; })
  .map(function (primitive) { return primitive.line_style; }));
check(['pipe', 'hot', 'coolant', 'signal'].every(function (style) { return lineStyles.has(style); }),
  'Rohr-, Heiß-, Kühlwasser- und Signalleitungen im Beispiel');
check(reactorSheet.primitives.some(function (primitive) { return primitive.type === 'region' && primitive.label === 'Ventilpanel' && primitive.label_position === 'above'; }),
  'Ventilpanel-Bereich mit Beschriftung über dem Rahmen');
const instruments = reactorSheet.entities.filter(function (entity) { return entity.template_id === 'Classic_instrument'; });
check(instruments.map(function (entity) { return entity.tag; }).join(',') === 'TIC-101,PI-101,TI-102'
  && instruments.every(function (entity) { return Boolean(entity.properties.value); }), 'Instrumentenkreise tragen Tag und Messwert');

// --- reference example 2: classic template variant --------------------------
const variant = createClassicTemplateExample(templateLookup);
const variantReport = validatePlantDrawing(variant, templateLookup);
check(variantReport.valid && variantReport.counts.entities === 19 && variantReport.counts.primitives === 22,
  'Symbolvariante: 19 Teile, 22 Zeichenelemente', JSON.stringify(variantReport.counts));
const variantSheet = getActivePlantSheet(variant);
check(variantSheet.width === 1150 && variantSheet.height === 830 && variantSheet.margin === 4
  && fitPlantSheetToContent(variant, {}).changed === false, 'Symbolvariante auf dem Referenzblatt 1150 × 830');
const variantTemplates = new Set(variantSheet.entities.map(function (entity) { return entity.template_id; }));
['Classic_column', 'Classic_coil_circle', 'Classic_cylinder', 'Classic_mixer_box', 'Classic_control_valve',
  'Classic_check_valve', 'Classic_valve', 'Classic_instrument', 'Classic_flag', 'Classic_flag_back'].forEach(function (templateId) {
  check(variantTemplates.has(templateId), 'Symbolvariante nutzt ' + templateId);
});
const vent = variantSheet.entities.find(function (entity) { return entity.tag === 'V-103'; });
check(vent.rotation === 90 && vent.inverted === true, 'Vent-Ventil senkrecht mit invertierter Flussrichtung');
const circles = variantSheet.entities.filter(function (entity) { return entity.template_id === 'Classic_coil_circle'; });
check(circles.length === 2 && circles.some(function (entity) { return entity.visual_state === 'hot'; })
  && circles.some(function (entity) { return entity.visual_state === 'cold'; }), 'Heizwendel-Kreise als Ofen (rot) und Kühler (blau)');
check(variantSheet.entities.some(function (entity) { return entity.properties.hide_labels === 'true'; })
  && variantSheet.primitives.some(function (primitive) { return primitive.type === 'text' && primitive.text_anchor === 'middle'; }),
  'Kühler blendet Symbolbeschriftung aus und nutzt zentrierte Texte');
const variantStyles = new Set(variantSheet.primitives.filter(function (primitive) { return primitive.type === 'polyline'; })
  .map(function (primitive) { return primitive.line_style; }));
check(['purge', 'feed', 'hot', 'cold', 'signal'].every(function (style) { return variantStyles.has(style); }),
  'Spülgas-, Gas-, Heiß-, Kalt- und Signalleitungen in der Symbolvariante');

console.log('V64_r5 model contract passed: ' + passed + ' checks.');
