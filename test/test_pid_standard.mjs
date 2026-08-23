#!/usr/bin/env node
/** Verify the functional PF-PID-V1 normalization contract. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EXPLICIT_HMI_POLICY,
    PID_STANDARD_ID,
    buildStandardReport,
    choosePortPair,
    generateEntityTag,
    normalizeConnection,
    normalizeInstance,
    normalizeProjectModel,
    normalizeTemplate,
    portsCompatible,
    resolveInstancePorts
} from '../public/js/pid_standard.js';

const currentFile = fileURLToPath(import.meta.url);
const root = path.dirname(path.dirname(currentFile));
const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'public/svg_templates/library_manifest_v1.json'), 'utf8')
);
const templates = manifest.templates;
let passed = 0;

function check(condition, label) {
    assert.equal(Boolean(condition), true, label);
    passed += 1;
    console.log('   ok  ' + label);
}

function templateWithSvg(templateId) {
    const source = Object.assign({}, templates[templateId]);
    source.svg = fs.readFileSync(
        path.join(root, 'public/svg_templates', templateId + '.svg'),
        'utf8'
    );
    return normalizeTemplate(source);
}

function elementById(elements) {
    const map = new Map();
    elements.forEach(function (element) {
        map.set(element.id, element);
    });
    return function (id) {
        return map.get(id) || null;
    };
}

check(manifest.standard_id === PID_STANDARD_ID, 'Manifest nutzt PF-PID-V1');
check(Object.keys(templates).length >= 26 && Object.keys(templates).length === manifest.template_count,
    'Manifest enthält mindestens die 26 kanonischen Symbole und ist intern konsistent');
check(EXPLICIT_HMI_POLICY.auto_create_widgets === false, 'HMI-Autoerzeugung ist deaktiviert');
check(EXPLICIT_HMI_POLICY.button_policy === 'optional_explicit_only', 'Buttons sind explizit optional');

const pumpTemplate = templateWithSvg('Pump_liquid_type');
const pump = normalizeInstance({
    id: 'pump_1',
    templateId: 'Pump_liquid_type',
    x: 100,
    y: 200,
    width: 310,
    height: 220,
    bindings: [{ key: 'speed', target: '[data-pf-state-target="rotor"]' }],
    properties: { custom_parameter: 42 },
    integration_extension: { retained: true }
}, pumpTemplate, []);
check(pump.width === 90 && pump.height === 80, 'Legacy-Geometrie wird auf das Maschinenprofil normalisiert');
check(pump.tag === 'P-101', 'Engineering-TAG wird deterministisch erzeugt');
check(pump.bindings.length === 1 && pump.properties.custom_parameter === 42,
    'Bindings und Eigenschaften bleiben erhalten');
check(pump.integration_extension.retained === true, 'Unbekannte Erweiterungsfelder bleiben erhalten');
check(pump.capabilities.animatable === true && pump.capabilities.connectable === true,
    'Animation und Verbindung bleiben als Fähigkeiten aktiv');
check(pump.capabilities.auto_create_hmi_widgets === false,
    'Prozesssymbol erzeugt kein HMI-Widget');
check(pump.svgContent.includes('data-pf-standard="PF-PID-V1"'),
    'Kanonische SVG-Geometrie wird eingesetzt');

const customGeometry = normalizeInstance({
    id: 'pump_custom',
    templateId: 'Pump_liquid_type',
    geometry_custom: true,
    svgContent: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="7" height="9"/></svg>',
    width: 123,
    height: 77,
    tag: 'P-901'
}, pumpTemplate, [pump]);
check(customGeometry.width === 123 && customGeometry.height === 77,
    'Explizite Sondergeometrie behält ihre Abmessungen');
check(customGeometry.svgContent.includes('width="7"'),
    'Explizite Sondergeometrie behält ihren SVG-Inhalt');
check(customGeometry.viewBox[2] === 123 && customGeometry.viewBox[3] === 77,
    'Explizite Sondergeometrie behält eine passende ViewBox');

const normalizedRuntime = normalizeInstance({
    id: 'pump_runtime',
    templateId: 'Pump_liquid_type',
    tag: 'P-902',
    runtimeState: 'vendor-special'
}, pumpTemplate, [pump, customGeometry]);
check(normalizedRuntime.runtimeState === 'ready'
    && normalizedRuntime.properties.runtime_state_source === 'vendor-special',
    'Unbekannte Laufzeitzustände werden sicher und nachvollziehbar normalisiert');

const customTemplate = normalizeTemplate({
    id: 'custom_asset',
    name: 'Custom Asset',
    standard: 'CUSTOM',
    library_role: 'custom',
    width: 140,
    height: 60,
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H10"/></svg>'
});
const custom = normalizeInstance({
    id: 'custom_1',
    templateId: 'custom_asset',
    svgContent: customTemplate.svg,
    width: 140,
    height: 60,
    ports_custom: true,
    ports: [{ id: 'custom_out', rx: 1, ry: 0.5, kind: 'data', direction: 'out' }]
}, customTemplate, []);
check(custom.standard === 'CUSTOM' && custom.svgContent.includes('M0 0H10'),
    'Custom-SVG bleibt unverändert verfügbar');
check(custom.ports.some(function (port) {
    return port.id === 'custom_out';
}), 'Custom-Port bleibt erhalten');

const ports = resolveInstancePorts(Object.assign({}, pump, { width: 180, height: 160 }));
const discharge = ports.find(function (port) {
    return port.id === 'discharge';
});
check(discharge.x === 180 && discharge.y === 80, 'Relative Ports skalieren mit der Objektgeometrie');

const exchanger = normalizeInstance({
    id: 'exchanger_1',
    templateId: 'Heat_exchanger_(general)',
    x: 400,
    y: 200,
    tag: 'E-101'
}, templateWithSvg('Heat_exchanger_(general)'), [pump]);
const pair = choosePortPair(pump, exchanger, 'pipe');
check(pair && pair.fromPort === 'discharge' && pair.toPort === 'process_in',
    'Semantische Prozessports werden automatisch gewählt');
const pumpUtility = resolveInstancePorts(pump).find(function (port) {
    return port.kind === 'power';
});
const exchangerProcess = resolveInstancePorts(exchanger).find(function (port) {
    return port.id === 'process_in';
});
check(portsCompatible(pumpUtility, exchangerProcess, 'pipe') === false,
    'Inkompatible Portarten werden abgelehnt');

const connection = normalizeConnection({
    id: 'conn_1',
    from: pump.id,
    to: exchanger.id,
    type: 'pipe'
}, elementById([pump, exchanger]));
check(connection.fromPort === 'discharge' && connection.toPort === 'process_in',
    'Verbindungen erhalten semantische Portanker');
check(connection.object_standard.semantic_ports === true,
    'Verbindung dokumentiert den semantischen Standard');

const repairedConnection = normalizeConnection({
    id: 'conn_invalid_ports',
    from: pump.id,
    to: exchanger.id,
    type: 'pipe',
    fromPort: 'drive',
    toPort: 'utility_in'
}, elementById([pump, exchanger]));
check(repairedConnection.fromPort === 'discharge'
    && repairedConnection.toPort === 'process_in',
    'Ungültige explizite Portpaare werden deterministisch repariert');

const fixedConnection = normalizeConnection({
    id: 'conn_fixed',
    from: pump.id,
    to: exchanger.id,
    type: 'pipe',
    fromPort: 'discharge',
    toPort: 'process_in',
    fromAnchor: { mode: 'fixed', x: 90, y: 20 },
    toAnchor: { mode: 'port', portId: 'process_in' }
}, elementById([pump, exchanger]));
check(fixedConnection.fromPort === null
    && fixedConnection.object_standard.manual_anchor_override === true,
    'Feste Anker bleiben als kontrollierter Override erhalten');

const project = normalizeProjectModel({
    elements: [pump, exchanger],
    connections: [connection],
    hmi: {
        widgets: [{
            widget_id: 'manual_button',
            type: 'button',
            origin: 'explicit',
            auto_created: false
        }],
        bindings: [{ binding_id: 'manual_binding', element_id: pump.id }]
    },
    integration_payload: { keep: 'yes' }
}, templates);
check(project.hmi.widgets[0].widget_id === 'manual_button',
    'Explizite HMI-Widgets bleiben vollständig erhalten');
check(project.integration_payload.keep === 'yes', 'Projekt-Erweiterungsfelder bleiben erhalten');
check(project.object_standard.auto_create_hmi_widgets === false,
    'Projektvertrag deaktiviert HMI-Autoerzeugung');

const validReport = buildStandardReport(
    Object.values(templates),
    project.elements,
    project.connections,
    project.hmi
);
check(validReport.valid === true, 'Standardbericht akzeptiert normalisierte Objekte');
check(validReport.explicit_buttons === 1 && validReport.optional_buttons === 1,
    'Expliziter optionaler Button wird korrekt gezählt');
const invalidReport = buildStandardReport(
    Object.values(templates),
    project.elements,
    project.connections,
    { widgets: [{ widget_id: 'auto_button', type: 'button', origin: 'auto', auto_created: true }] }
);
check(invalidReport.valid === false && invalidReport.violations.automatic_widgets.length === 1,
    'Automatisch erzeugtes HMI-Widget wird als Verstoß erkannt');

check(generateEntityTag('CV', [{ tag: 'CV-101' }, { properties: { tag: 'CV-102' } }]) === 'CV-103',
    'TAG-Sequenz berücksichtigt vorhandene Entities');

console.log('PF-PID-V1 JavaScript contract: ' + String(passed) + ' checks passed.');
