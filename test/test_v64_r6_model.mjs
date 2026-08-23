/**
 * Functional model contract for Plant Factory V64_r6.
 * Verifies the persisted Anlagen Entwurf as an elemental assembly and proves
 * that instantiation preserves every part, connection and drawing primitive.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    createAssemblyTemplate,
    createEmptyPlantDrawing,
    getActivePlantSheet,
    instantiateAssemblyTemplate,
    normalizeAssemblyTemplate,
    plantSelectionBounds
} from '../public/js/v64_plant_drawing_model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSEMBLY_PATH = path.join(
    ROOT,
    'public',
    'svg_templates',
    'assemblies',
    'assembly_template_mt4tvvee_tuvofeq.json'
);
let passed = 0;

function check(condition, label, detail) {
    assert.ok(condition, label + (detail ? ': ' + detail : ''));
    passed += 1;
    console.log('   ok  ' + label);
}

function unique(values) {
    return new Set(values).size === values.length;
}

function main() {
    const raw = JSON.parse(fs.readFileSync(ASSEMBLY_PATH, 'utf8'));
    const assembly = normalizeAssemblyTemplate(raw);

    check(assembly.schema === 'plant-factory.plant-drawing-assembly' && assembly.version === 1,
        'Baugruppe nutzt den stabilen Zeicheninventarvertrag');
    check(assembly.assembly_template_id === 'assembly_template_mt4tvvee_tuvofeq'
        && assembly.name === 'Anlagen Entwurf' && assembly.category === 'Baugruppen',
        'Anlagen Entwurf ist eindeutig im Baugruppen-Inventar benannt');
    check(assembly.width === 1152 && assembly.height === 1068,
        'Entwurf behält seine exakte Referenzgröße');
    check(assembly.entities.length === 31 && assembly.connections.length === 14
        && assembly.primitives.length === 45,
        '31 Einzelteile, 14 Verbindungen und 45 Zeichenelemente bleiben vollständig');
    check(assembly.exposed_ports.length === 49 && assembly.template_ids.length === 13,
        'Freie Ports und verwendete elementare Templates bleiben inventarisiert');
    check(unique(assembly.entities.map(function (entity) { return entity.entity_id; })),
        'Alle Quell-Entities besitzen eindeutige IDs');
    check(unique(assembly.connections.map(function (connection) { return connection.connection_id; })),
        'Alle Quell-Verbindungen besitzen eindeutige IDs');

    const result = instantiateAssemblyTemplate(
        createEmptyPlantDrawing(),
        assembly,
        120,
        80,
        { assembly_id: 'r6_structured_test' }
    );
    const sheet = getActivePlantSheet(result.model);
    check(sheet.entities.length === 31 && sheet.connections.length === 14
        && sheet.primitives.length === 45,
        'Instanziierung verliert weder Geräte noch Verbindungen noch Details');
    check(result.selection.entity_ids.length === 31
        && result.selection.connection_ids.length === 14
        && result.selection.primitive_ids.length === 45,
        'Die vollständige Instanz bleibt als Baugruppe auswählbar');
    check(sheet.entities.every(function (entity) {
        return entity.assembly_id === 'r6_structured_test'
            && entity.assembly_template_id === assembly.assembly_template_id
            && entity.assembly_name === assembly.name;
    }), 'Jedes Einzelteil trägt die gemeinsame Baugruppenidentität');
    check(unique(sheet.entities.map(function (entity) { return entity.entity_id; }))
        && sheet.entities.every(function (entity) {
            return !assembly.entities.some(function (source) { return source.entity_id === entity.entity_id; });
        }), 'Instanzen erhalten neue eindeutige Entity-IDs');

    const entityIds = new Set(sheet.entities.map(function (entity) { return entity.entity_id; }));
    check(sheet.connections.every(function (connection) {
        return entityIds.has(connection.from_entity_id) && entityIds.has(connection.to_entity_id);
    }), 'Alle 14 Verbindungen zeigen auf die neu instanziierten Einzelteile');

    const firstSource = assembly.entities[0];
    const firstPlaced = sheet.entities.find(function (entity) {
        return entity.template_id === firstSource.template_id && entity.name === firstSource.name;
    });
    check(Boolean(firstPlaced)
        && Math.abs(firstPlaced.x - firstSource.x - 120) < 0.001
        && Math.abs(firstPlaced.y - firstSource.y - 80) < 0.001,
        'Koordinaten werden ohne Maßstabsdrift verschoben');

    const bounds = plantSelectionBounds(sheet, result.selection);
    check(Boolean(bounds) && bounds.width > 0 && bounds.height > 0,
        'Der vollständige Entwurf besitzt gültige geometrische Grenzen');

    const roundTrip = createAssemblyTemplate(sheet, result.selection, {
        assembly_template_id: 'r6_round_trip',
        name: 'R6 Round Trip',
        category: 'Baugruppen'
    });
    check(roundTrip.entities.length === 31 && roundTrip.connections.length === 14
        && roundTrip.primitives.length === 45,
        'Speichern und erneutes Laden ist vollständig verlustfrei');
    check(roundTrip.entities.every(function (entity) {
        return entity.assembly_id === '' && entity.assembly_template_id === '';
    }), 'Gespeicherte Vorlage bleibt instanzneutral und wiederverwendbar');

    console.log('V64_r6 model contract passed: ' + passed + ' checks.');
}

main();

