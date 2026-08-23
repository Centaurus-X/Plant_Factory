#!/usr/bin/env node
/** Verify PF-LOGIC-V1 canonical model, compilers and compatibility profiles. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    LOGIC_STANDARD_ID,
    activeLogicDiagram,
    applyLogicCrossRulesToV8,
    buildLogicSignalCatalog,
    compileLogicArtifacts,
    compileLogicToAutomationV9,
    createEmptyLogicModel,
    createLogicDiagram,
    createLogicEdge,
    createLogicNode,
    createTimerCounterDemo,
    evaluateLogicModel,
    logicBlockLibrary,
    logicDataTypesCompatible,
    logicTopologicalOrder,
    normalizeLogicModel,
    validateLogicModel
} from '../public/js/logic_core.js';
import { validateConfig, validateCrossShard } from '../public/js/v9_validate.js';

const currentFile = fileURLToPath(import.meta.url);
const root = path.dirname(path.dirname(currentFile));
const deviceConfig = JSON.parse(fs.readFileSync(
    path.join(root, 'config/device_state_data_v9.json'), 'utf8'
));
const crossConfig = JSON.parse(fs.readFileSync(
    path.join(root, 'config/shards/device_state_data_v8_cross_fn-01.json'), 'utf8'
));
const compatibility = JSON.parse(fs.readFileSync(
    path.join(root, 'config/logic_compatibility_profiles_v1.json'), 'utf8'
));
const runtimeReference = JSON.parse(fs.readFileSync(
    path.join(root, 'test/fixtures/device_state_data_v9_node_fn01_runtime_reference.json'), 'utf8'
));
let passed = 0;

function check(condition, label, detail) {
    assert.equal(Boolean(condition), true, detail ? label + ': ' + detail : label);
    passed += 1;
    console.log('   ok  ' + label);
}

function snapshotForCatalog() {
    return {
        deviceConfig: deviceConfig,
        elements: [],
        devices: { assignments: {} },
        processes: { process_states: [] },
        hmi: { widgets: [] },
        freeRules: { timers: [] }
    };
}

function catalogEntry(catalog, predicate) {
    return catalog.find(predicate) || null;
}

function isRealSensor(entry) {
    return entry.source_kind === 'sensor' && entry.data_type === 'REAL';
}

function isStateFive(entry) {
    return entry.source_kind === 'process_state' && entry.state_id === 5;
}

function isStateThirtyOne(entry) {
    return entry.source_kind === 'process_state' && entry.state_id === 31;
}

function createNativeModel(catalog, options) {
    const source = options || {};
    const sensor = catalogEntry(catalog, isRealSensor);
    const state = catalogEntry(catalog, source.cross ? isStateThirtyOne : isStateFive);
    const model = createEmptyLogicModel();
    const diagram = createLogicDiagram({
        diagram_id: source.cross ? 'logic_cross_native' : 'logic_native',
        name: source.cross ? 'Cross Native' : 'Native Threshold',
        target_profile: 'automation_system_v9',
        execution: {
            scope_kind: source.cross ? 'cross_worker' : 'node_local',
            owner_node_id: 'fn-01',
            engine_id: 1,
            priority: source.cross ? 1200 : 500
        }
    });
    const input = createLogicNode('signal_in', 40, 100, {
        node_id: 'native_sensor',
        label: 'Temperature',
        binding: sensor,
        config: { data_type: 'REAL', default_value: 0 }
    });
    const threshold = createLogicNode('constant_real', 280, 230, {
        node_id: 'native_threshold',
        label: '540.0',
        config: { value: 540.0 }
    });
    const compare = createLogicNode('compare_ge', 520, 100, {
        node_id: 'native_compare',
        label: '>='
    });
    const output = createLogicNode('state_write', 800, 100, {
        node_id: 'native_state_output',
        label: 'State write',
        binding: state,
        config: {
            state_id: state.state_id,
            value_id_true: 1,
            value_id_false: 2,
            write_false: true,
            ownership_mode: source.cross ? 'hybrid' : (source.ownership || 'logic'),
            priority: source.cross ? 1200 : 500
        }
    });
    diagram.nodes = [input, threshold, compare, output];
    diagram.edges = [
        createLogicEdge(input.node_id, 'Q', compare.node_id, 'A', 'REAL', { edge_id: 'native_e1' }),
        createLogicEdge(threshold.node_id, 'Q', compare.node_id, 'B', 'REAL', { edge_id: 'native_e2' }),
        createLogicEdge(compare.node_id, 'Q', output.node_id, 'EN', 'BOOL', { edge_id: 'native_e3' })
    ];
    model.diagrams = [diagram];
    model.active_diagram_id = diagram.diagram_id;
    return model;
}

function createCycleModel() {
    const model = createEmptyLogicModel();
    const diagram = createLogicDiagram({ diagram_id: 'cycle', name: 'Cycle' });
    const first = createLogicNode('not', 100, 100, { node_id: 'cycle_a' });
    const second = createLogicNode('not', 300, 100, { node_id: 'cycle_b' });
    diagram.nodes = [first, second];
    diagram.edges = [
        createLogicEdge(first.node_id, 'Q', second.node_id, 'IN', 'BOOL', { edge_id: 'cycle_e1' }),
        createLogicEdge(second.node_id, 'Q', first.node_id, 'IN', 'BOOL', { edge_id: 'cycle_e2' })
    ];
    model.diagrams = [diagram];
    model.active_diagram_id = diagram.diagram_id;
    return model;
}

const library = logicBlockLibrary();
check(LOGIC_STANDARD_ID === 'PF-LOGIC-V1', 'Kanonischer Standard ist PF-LOGIC-V1');
check(library.standard.release === '63.1', 'Bausteinbibliothek ist auf V63.1 versioniert');
check(library.blocks.length === 33, 'Bausteinbibliothek enthält 33 definierte Blöcke');
check(library.categories.includes('Schaltpläne'), 'Inventar besitzt die Kategorie Schaltpläne');
check(library.categories.includes('Timer') && library.categories.includes('Zähler'),
    'Timer und Zähler sind sauber kategorisiert');
check(compatibility.principles.single_source_of_truth === true,
    'Kompatibilitätsprofil erzwingt eine einzige Wahrheit');
check(compatibility.principles.strict_v9_sections_unchanged === true,
    'Strikter V9-Sektionsvertrag bleibt unverändert');
check(compatibility.profiles.automation_system_v8_cross.forbidden_transport_fields.includes('host'),
    'Cross-Profil verbietet physische Hostdaten');

check(logicDataTypesCompatible('BOOL', 'BOOL'), 'BOOL-Verbindung ist kompatibel');
check(logicDataTypesCompatible('INT', 'REAL'), 'INT kann deterministisch nach REAL geführt werden');
check(!logicDataTypesCompatible('REAL', 'BOOL'), 'REAL kann nicht an BOOL angeschlossen werden');
check(!logicDataTypesCompatible('TIME', 'INT'), 'TIME und INT bleiben typgetrennt');

const catalog = buildLogicSignalCatalog(snapshotForCatalog());
check(catalog.length >= 70, 'Signalinventar enthält die V9-Anlagenprojektion', String(catalog.length));
check(Boolean(catalogEntry(catalog, isRealSensor)), 'V9-Sensor ist als kanonisches Signal verfügbar');
check(Boolean(catalogEntry(catalog, isStateFive)), 'Process State ist als Lese-/Schreibsignal verfügbar');
check(catalog.some(function (entry) { return entry.source_kind === 'actuator'; }),
    'Aktoren sind als optionale Schreibziele verfügbar');
check(catalog.some(function (entry) { return entry.source_kind === 'timer'; }),
    'V9-Timer sind als Signale verfügbar');

const runtimeReferenceCatalog = buildLogicSignalCatalog({
    deviceConfig: runtimeReference,
    elements: [],
    devices: { assignments: {} },
    processes: { process_states: [] },
    hmi: { widgets: [] },
    freeRules: { timers: [] }
});
check(runtimeReference.meta[0].scope === 'node_local' && runtimeReference.meta[0].node_id === 'fn-01',
    'Bereitgestellte Runtime-Referenz bleibt ein V9 Node-Shard');
check(runtimeReference.controllers.length === 4 && runtimeReference.sensors.length === 10
    && runtimeReference.actuators.length === 11,
    'Bereitgestellte WAGO-/Modbus-Projektion wird vollständig gelesen');
check(runtimeReference.process_states.length === 8 && runtimeReference.rules.length === 4,
    'Process States und Rule Engine der Runtime-Referenz bleiben vollständig');
check(runtimeReferenceCatalog.some(function (entry) {
    return entry.signal_ref === 'v9.state.1.parameters.target_temp_c';
}), 'State-Parameter der Runtime-Referenz werden als kanonische Signale projiziert');
check(runtimeReferenceCatalog.some(function (entry) {
    return entry.source_kind === 'actuator' && entry.controller_uuid === '62671112-766c-59ed-b0ff-30a49d48f747';
}), 'Stabile controller_uuid-plus-local-id-Aktoridentität wird übernommen');
check(validateConfig(runtimeReference).errors.length === 0,
    'Bereitgestellte V9-Runtime-Referenz erfüllt den strikten Vertrag');

const empty = createEmptyLogicModel();
check(empty.standard.id === 'PF-LOGIC-V1', 'Leeres Modell trägt den Standardvertrag');
check(empty.diagrams.length === 0, 'Bestehende Projekte benötigen keinen Logic-Graphen');
check(validateLogicModel(empty, { signalCatalog: catalog }).status === 'OK',
    'Leeres additives Logic-Modell ist gültig');

const nativeModel = createNativeModel(catalog);
const normalizedNative = normalizeLogicModel(nativeModel);
check(activeLogicDiagram(normalizedNative).diagram_id === 'logic_native',
    'Aktiver Schaltplan wird stabil aufgelöst');
const nativeValidation = validateLogicModel(nativeModel, { signalCatalog: catalog });
check(nativeValidation.status === 'OK', 'Native V9-Logik ist strukturell gültig', JSON.stringify(nativeValidation.errors));
check(nativeValidation.stats.nodes === 4 && nativeValidation.stats.edges === 3,
    'Graphstatistik ist vollständig');
check(!logicTopologicalOrder(nativeModel.diagrams[0]).cyclic,
    'Native Logik besitzt eine deterministische Ausführungsreihenfolge');

const originalRules = JSON.stringify(deviceConfig.rules);
const nativeArtifacts = compileLogicArtifacts(nativeModel, {
    signalCatalog: catalog,
    deviceConfig: deviceConfig,
    crossConfig: crossConfig
});
check(nativeArtifacts.report.status === 'OK', 'Alle Zielartefakte der nativen Logik kompilieren');
check(nativeArtifacts.automation_v9.generated_rules.length === 2,
    'True- und False-Zweig werden als zwei V9-Regeln erzeugt');
check(nativeArtifacts.automation_v9.report.bridge_actions === 0,
    'Reine Schwellwertlogik benötigt keinen Bridge-Layer');
check(JSON.stringify(deviceConfig.rules) === originalRules,
    'Quellkonfiguration wird beim Kompilieren nicht mutiert');
check(nativeArtifacts.automation_v9.generated_rules.every(function (rule) {
    return rule.description.startsWith('[PF-LOGIC:');
}), 'Generierte Regeln sind eindeutig als abgeleitet markiert');
check(nativeArtifacts.automation_v9.generated_rules.every(function (rule) {
    return rule.execution_scope === 'node:fn-01' && rule.deployment_status === 'active_node';
}), 'Node-lokale Ownership wird korrekt übersetzt');
const v9Report = validateConfig(nativeArtifacts.automation_v9.config);
check(v9Report.errors.length === 0, 'Kompilierte V9-Konfiguration erfüllt den strikten Vertrag', JSON.stringify(v9Report.errors));
check(Object.keys(nativeArtifacts.automation_v9.config).sort().join('|')
    === Object.keys(deviceConfig).sort().join('|'),
    'Logic-Kompilierung fügt keine fremden V9-Sektionen hinzu');

const secondCompile = compileLogicToAutomationV9(
    nativeModel,
    nativeArtifacts.automation_v9.config,
    { signalCatalog: catalog, deviceConfig: deviceConfig }
);
check(secondCompile.generated_rules.length === 2, 'Wiederholte Kompilierung bleibt idempotent');
check(secondCompile.config.rules.filter(function (rule) {
    return String(rule.description || '').startsWith('[PF-LOGIC:');
}).length === 2, 'Vorherige generierte Regeln werden ersetzt statt dupliziert');

const conflictModel = createNativeModel(catalog);
conflictModel.diagrams[0].nodes[3].config.state_id = 1;
conflictModel.diagrams[0].nodes[3].binding = catalog.find(function (entry) {
    return entry.source_kind === 'process_state' && entry.state_id === 1;
});
const conflictArtifacts = compileLogicArtifacts(conflictModel, {
    signalCatalog: catalog,
    deviceConfig: deviceConfig,
    crossConfig: crossConfig
});
check(conflictArtifacts.report.status === 'FAILED',
    'Widersprüchlicher zweiter Writer wird fail-closed abgelehnt');
check(conflictArtifacts.automation_v9.report.conflicts.length === 1,
    'Writer-Konflikt wird explizit diagnostiziert');

conflictModel.diagrams[0].nodes[3].config.ownership_mode = 'hybrid';
const hybridArtifacts = compileLogicArtifacts(conflictModel, {
    signalCatalog: catalog,
    deviceConfig: deviceConfig,
    crossConfig: crossConfig
});
check(hybridArtifacts.automation_v9.report.conflicts.length === 0,
    'Expliziter Hybridmodus erlaubt kontrollierte Arbitration');
check(hybridArtifacts.automation_v9.report.warnings.some(function (message) {
    return message.includes('Hybridziel');
}), 'Hybridmodus wird als bewusste Runtime-Arbitration dokumentiert');

const crossModel = createNativeModel(catalog, { cross: true });
const crossArtifacts = compileLogicArtifacts(crossModel, {
    signalCatalog: catalog,
    deviceConfig: deviceConfig,
    crossConfig: crossConfig
});
check(crossArtifacts.automation_v9.cross_rules.length === 2,
    'Cross-Worker-Logik wird getrennt vom Node-Shard erzeugt');
check(crossArtifacts.automation_v9.generated_rules.length === 0,
    'Cross-Regeln werden nicht versehentlich in den V9-Node-Shard geschrieben');
check(crossArtifacts.automation_v9.cross_rules.every(function (rule) {
    return rule.execution_scope === 'cross:fn-01.default'
        && rule.deployment_status === 'active_cross';
}), 'Cross-Execution-Scope wird kanonisch erzeugt');
const rebuiltCross = applyLogicCrossRulesToV8(crossConfig, crossArtifacts.automation_v9.cross_rules);
const crossReport = validateCrossShard(rebuiltCross.config);
check(crossReport.errors.length === 0,
    'Generierter V8-Cross-Shard erfüllt den Cross-Vertrag', JSON.stringify(crossReport.errors));
check(rebuiltCross.config.controllers.every(function (row) {
    return row.host === undefined && row.port === undefined && row.unit === undefined;
}), 'V8-Cross-Shard enthält keine physischen Controller-Endpunkte');

check(nativeArtifacts.universal.schema === 'plant_factory.logic_runtime.v1',
    'Universelles Runtime-Artefakt besitzt ein stabiles Schema');
check(nativeArtifacts.universal.source_of_truth === 'project.logic',
    'Universelles Artefakt verweist auf das kanonische Projektmodell');
check(nativeArtifacts.universal.execution_plans.length === 1,
    'Universelles Artefakt enthält einen Ausführungsplan');
check(nativeArtifacts.siemens.scl.includes('FUNCTION_BLOCK "PF_Native_Threshold_logic_native"'),
    'Siemens-Ziel erzeugt einen benannten SCL-Funktionsbaustein');
check(nativeArtifacts.siemens.scl.includes('VAR_INPUT')
    && nativeArtifacts.siemens.scl.includes('VAR_OUTPUT'),
    'SCL-Ausgabe enthält typisierte Ein- und Ausgänge');
check(nativeArtifacts.siemens.tags_csv.startsWith('diagram_id,direction,plc_tag'),
    'Siemens-Tag-Mapping wird als CSV erzeugt');

const demo = createTimerCounterDemo(catalog);
const demoValidation = validateLogicModel(demo, { signalCatalog: catalog });
check(demoValidation.errors.length === 0, 'Timer-/Counter-Demo ist strukturell ausführbar');
const demoArtifacts = compileLogicArtifacts(demo, {
    signalCatalog: catalog,
    deviceConfig: deviceConfig,
    crossConfig: crossConfig
});
check(demoArtifacts.report.status === 'WARNING',
    'Bridge-pflichtige Blöcke werden als kompatible Warnung statt als Fehler markiert');
check(demoArtifacts.automation_v9.report.bridge_nodes.includes('demo_ctu'),
    'CTU wird korrekt dem universellen Bridge-Layer zugeordnet');
check(demoArtifacts.siemens.scl.includes('TON_TIME')
    && demoArtifacts.siemens.scl.includes('CTU_DINT'),
    'Siemens-SCL nutzt IEC-Timer und IEC-Zähler');

const tickRef = demo.diagrams[0].nodes[0].binding.signal_ref;
const counterTickRef = demo.diagrams[0].nodes.find(function (node) { return node.node_id === 'demo_counter_tick'; }).binding.signal_ref;
const resetRef = demo.diagrams[0].nodes.find(function (node) { return node.node_id === 'demo_reset'; }).binding.signal_ref;
let runtimeState = {};
let evaluated = evaluateLogicModel(demo, {
    [tickRef]: false,
    [counterTickRef]: false,
    [resetRef]: false
}, runtimeState, 0);
runtimeState = evaluated.runtime_state;
check(evaluated.diagrams.logic_timer_counter_demo.values['demo_ctu:CV'] === 0,
    'CTU startet deterministisch bei 0');
evaluated = evaluateLogicModel(demo, {
    [tickRef]: false,
    [counterTickRef]: true,
    [resetRef]: false
}, runtimeState, 100);
runtimeState = evaluated.runtime_state;
check(evaluated.diagrams.logic_timer_counter_demo.values['demo_ctu:CV'] === 1,
    'CTU zählt die erste steigende Flanke');
evaluated = evaluateLogicModel(demo, {
    [tickRef]: false,
    [counterTickRef]: true,
    [resetRef]: false
}, runtimeState, 200);
runtimeState = evaluated.runtime_state;
check(evaluated.diagrams.logic_timer_counter_demo.values['demo_ctu:CV'] === 1,
    'CTU zählt kein dauerhaftes High doppelt');
evaluated = evaluateLogicModel(demo, {
    [tickRef]: false,
    [counterTickRef]: false,
    [resetRef]: true
}, runtimeState, 300);
check(evaluated.diagrams.logic_timer_counter_demo.values['demo_ctu:CV'] === 0,
    'CTU lässt sich über den Reset-Port zurücksetzen');

const cycleModel = createCycleModel();
const cycleValidation = validateLogicModel(cycleModel, { signalCatalog: catalog });
check(cycleValidation.errors.some(function (entry) { return entry.code === 'cycle'; }),
    'Zyklische Schaltlogik wird fail-closed erkannt');
check(logicTopologicalOrder(cycleModel.diagrams[0]).cyclic,
    'Topologie markiert den Zyklus');

const invalidTypeModel = createEmptyLogicModel();
const invalidDiagram = createLogicDiagram({ diagram_id: 'invalid_type', name: 'Invalid type' });
const realConstant = createLogicNode('constant_real', 50, 50, { node_id: 'real_constant' });
const notNode = createLogicNode('not', 300, 50, { node_id: 'bool_not' });
invalidDiagram.nodes = [realConstant, notNode];
invalidDiagram.edges = [
    createLogicEdge(realConstant.node_id, 'Q', notNode.node_id, 'IN', 'REAL', { edge_id: 'invalid_edge' })
];
invalidTypeModel.diagrams = [invalidDiagram];
invalidTypeModel.active_diagram_id = invalidDiagram.diagram_id;
const invalidTypeReport = validateLogicModel(invalidTypeModel, { signalCatalog: catalog });
check(invalidTypeReport.errors.some(function (entry) { return entry.code === 'edge_type'; }),
    'Inkompatible Porttypen werden vor dem Export abgelehnt');

console.log('PF-LOGIC-V1 JavaScript contract: ' + String(passed) + ' checks passed.');
