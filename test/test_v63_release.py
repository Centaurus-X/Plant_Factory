#!/usr/bin/env python3
"""Verify the complete Plant Factory V63.x additive logic integration contract."""

import ast
import json
import re
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_PARTS = {
    '.git', '.venv', 'venv', 'node_modules', '__pycache__',
    '.pytest_cache', '.mypy_cache',
}
PASSED = 0


def check(condition, label, detail=''):
    global PASSED
    if not condition:
        suffix = ': %s' % detail if detail else ''
        raise AssertionError(label + suffix)
    PASSED += 1
    print('   ok  %s' % label)


def read(relative):
    return (ROOT / relative).read_text(encoding='utf-8')


def load_json(relative):
    return json.loads(read(relative))


def is_excluded(path):
    return bool(EXCLUDED_PARTS.intersection(path.parts)) or any(
        part.startswith('.release_test.') for part in path.parts
    )


def python_style_failures():
    failures = []
    for path in sorted(ROOT.rglob('*.py')):
        if is_excluded(path):
            continue
        tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                failures.append('%s:%s class' % (path.relative_to(ROOT), node.lineno))
            elif isinstance(node, ast.Lambda):
                failures.append('%s:%s lambda' % (path.relative_to(ROOT), node.lineno))
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.decorator_list:
                failures.append('%s:%s decorator' % (path.relative_to(ROOT), node.lineno))
    return failures


def run():
    version = read('VERSION').strip()
    package = load_json('package.json')
    index = read('public/index.html')
    core = read('public/js/core.js')
    ui = read('public/js/ui.js')
    workspace = read('public/js/v56_workspace.js')
    logic_core = read('public/js/logic_core.js')
    logic_ui = read('public/js/v63_logic_ui.js')
    v64_ui = read('public/js/v64_plant_drawing.js')
    logic_css = read('public/css/v63.css')
    library = load_json('config/logic_block_library_v1.json')
    compatibility = load_json('config/logic_compatibility_profiles_v1.json')
    v9 = load_json('config/device_state_data_v9.json')
    cross = load_json('config/shards/device_state_data_v8_cross_fn-01.json')
    runtime_reference = load_json('test/fixtures/device_state_data_v9_node_fn01_runtime_reference.json')
    release_manifest = load_json('docs/v63_1/RELEASE_MANIFEST_V63_1.json')

    supported = {'63.1': '63.1.0', '63.2': '63.2.0', '63.3': '63.3.0', '63.4': '63.4.0', '64': '64.0.0'}
    logic_release = '63.4' if version == '64' else version
    check(version in supported, 'VERSION ist eine kompatible V63-Version', version)
    check(package['version'] == supported[version], 'Paketversion entspricht VERSION', package['version'])
    check('test:logic' in package['scripts'] and 'test:v63' in package['scripts'],
          'Paket stellt gezielte PF-LOGIC- und V63-Prüfungen bereit')
    check(('V' + version) in index and (version + ' · V9') in index,
          'Browseroberfläche zeigt die aktuelle V63-Version')
    check('/public/css/v63.css' in index and '/public/js/v63_logic_ui.js' in index,
          'V63-Assets sind eingebunden')

    required_files = [
        'config/logic_block_library_v1.json',
        'config/logic_compatibility_profiles_v1.json',
        'public/js/logic_library.js',
        'public/js/logic_core.js',
        'public/js/v63_logic_ui.js',
        'public/css/v63.css',
        'runtime_compat/plant_logic_runtime.py',
        'runtime_compat/automation_system_adapter.py',
        'runtime_compat/README.md',
        'test/fixtures/device_state_data_v9_node_fn01_runtime_reference.json',
        'test/test_logic_core.mjs',
        'test/test_logic_runtime.py',
        'test/smoke_v63.py',
        'RELEASE_NOTES_V63_1_DE.md',
        'DIAGNOSE_LOGIC_V9_V8_CROSS_V63_1_DE.md',
        'docs/v63_1/PF_LOGIC_V1_STANDARD.md',
        'docs/v63_1/UNIVERSAL_RUNTIME_COMPATIBILITY.md',
        'docs/v63_1/MIGRATION_UND_SINGLE_SOURCE_OF_TRUTH.md',
        'docs/v63_1/TEST_UND_FREIGABE.md',
        'docs/v63_1/RELEASE_MANIFEST_V63_1.json',
        'release_evidence/V63_1_Screenshot_01_Logic_FBD_Light.png',
        'release_evidence/V63_1_Screenshot_02_Logic_FBD_Dark.png',
        'release_evidence/V63_1_Screenshot_03_Universal_Compiler.png',
        'release_evidence/V63_1_Screenshot_04_V9_Signal_Inventory.png',
    ]
    missing = [name for name in required_files if not (ROOT / name).is_file()]
    check(not missing, 'Alle PF-LOGIC-V1-Dateien sind vorhanden', ', '.join(missing))

    check(library['standard']['id'] == 'PF-LOGIC-V1',
          'Bausteinbibliothek nutzt PF-LOGIC-V1')
    check(library['standard']['source_of_truth'] == 'canonical_project_model',
          'Bibliothek verweist auf das kanonische Modell')
    check(len(library['blocks']) == 33, 'Bibliothek enthält 33 Blöcke')
    block_types = [row['block_type'] for row in library['blocks']]
    check(len(block_types) == len(set(block_types)), 'Blocktypen sind eindeutig')
    check({'ton', 'tof', 'tp', 'ctu', 'ctd'}.issubset(set(block_types)),
          'IEC-Timer und Zähler sind vollständig')
    check({'and', 'or', 'xor', 'not'}.issubset(set(block_types)),
          'Boolesche Gatter sind vollständig')
    check({'state_write', 'state_parameter', 'actuator_write', 'hmi_write', 'signal_out'}.issubset(set(block_types)),
          'Runtime-, State-, Aktor- und HMI-Ausgänge sind vorhanden')
    check('Schaltpläne' in library['categories'],
          'Inventar besitzt die neue Kategorie Schaltpläne')
    check(all({'universal_json', 'automation_system_v9', 'siemens_scl'}
              == set(row['targets']) for row in library['blocks']),
          'Jeder Block deklariert alle Zielprofile')

    check(compatibility['standard'] == 'PF-LOGIC-COMPAT-V1',
          'Universeller Kompatibilitätsvertrag ist versioniert')
    check(compatibility['principles']['single_source_of_truth'] is True,
          'Kompatibilitätsvertrag verbietet eine zweite Wahrheit')
    check(compatibility['principles']['strict_v9_sections_unchanged'] is True,
          'V9-Sektionsvertrag bleibt unverändert')
    check(compatibility['principles']['strict_v8_cross_sections_unchanged'] is True,
          'V8-Cross-Sektionsvertrag bleibt unverändert')
    check(compatibility['profiles']['automation_system_v8_cross']['identity_model']
          == 'controller_uuid_plus_local_io_id',
          'Cross-Kompatibilität nutzt stabile logische I/O-Identität')

    check('id="workspace-logic-button"' in index,
          'Schaltlogik besitzt einen eigenen Workspace-Einstieg')
    check('id="logic-workspace"' in index,
          'Separater Logic-/FBD-Workspace ist vorhanden')
    check('data-logic-inventory="diagrams">Schaltpläne' in index,
          'Schaltpläne sind im Inventar separat kategorisiert')
    check('data-logic-inventory="blocks">Bausteine' in index
          and 'data-logic-inventory="signals">Signale' in index,
          'Bausteine und Signale besitzen getrennte Inventarbereiche')
    check('id="logic-canvas"' in index and 'id="logic-nodes-layer"' in index
          and 'id="logic-edges-layer"' in index,
          'FBD-Zeichenfläche besitzt getrennte Node-/Edge-Layer')
    check('id="logic-context-menu"' in index and 'role="menu"' in index,
          'Logic-Canvas besitzt ein eigenes Rechtsklickmenü')
    check('id="modal-logic-diagram"' in index and 'aria-modal="true"' in index,
          'Schaltplan-Konfiguration ist ein Modal')
    check('id="modal-logic-compile"' in index,
          'Übersetzungs-/Exportdialog ist ein Modal')
    check('Universal Runtime JSON' in index and 'Automation_System V9/V8' in index
          and 'Siemens / IEC SCL' in index,
          'Zielprofile sind in der UI verständlich dargestellt')

    check("function defaultLogicModel()" in core and "logic: defaultLogicModel()" in core,
          'Shared State enthält das kanonische Logic-Modell')
    check("self.eventBus.emit('state:logic'" in core,
          'Undo/Redo publiziert wiederhergestellte Logic-Zustände')
    check('logic: normalizeLogicModel' in ui,
          'Projekt-Speicherung persistiert den kanonischen Graphen')
    check("state.set('logic', normalizeLogicModel(projekt.logic || null))" in ui,
          'Legacy-Projekte laden ohne übernommene Fremdlogik')
    check("state.emit('logic:loaded'" in ui,
          'Projektladung publiziert den Logic-Lifecycle')
    for suffix in (
        '.logic.json', '.logic.runtime.json', '.runtime.v9.json',
        '.logic.scl', '.logic.tags.csv', '.logic.report.json',
        '.runtime.v8_cross_',
    ):
        check(suffix in ui and suffix in logic_ui,
              'Exportpfad enthält %s' % suffix)

    check("if (name === 'logic') return 'logic';" in workspace,
          'Workspace-Router kennt den Logic-Bereich')
    check("document.body.dataset.workspaceKind = workspace === 'logic'" in workspace,
          'Logic-Workspace erhält einen eigenen UI-Modus')
    check("logicWorkspace.hidden = workspace !== 'logic'" in workspace,
          'Workspace-Router schaltet das native hidden-Attribut korrekt')
    check('return diagramById(model, model.active_diagram_id) || model.diagrams[0] || null;' in logic_ui,
          'Graphmutationen arbeiten auf dem bereits normalisierten Modell')
    check("plant:workspace-activated" in workspace and "workspace === 'logic'" in logic_ui,
          'Workspace und Logic-Editor sind ereignisbasiert gekoppelt')

    check('export function validateLogicModel' in logic_core,
          'Logic-Core besitzt eine zentrale Validierung')
    check('export function evaluateLogicModel' in logic_core,
          'Logic-Core besitzt einen universellen Evaluator')
    check('export function compileLogicToAutomationV9' in logic_core,
          'Automation_System-V9-Compiler ist vorhanden')
    check('export function applyLogicCrossRulesToV8' in logic_core,
          'V8-Cross-Compiler ist vorhanden')
    check('export function compileLogicToSiemensScl' in logic_core,
          'Siemens-SCL-Compiler ist vorhanden')
    check('manualTargets.has(action.target)' in logic_core
          and "ownership !== 'hybrid'" in logic_core,
          'Compiler verhindert widersprüchliche Writer')
    check("source_of_truth: 'project.logic'" in logic_core,
          'Abgeleitete Artefakte markieren das kanonische Quellmodell')
    check('unsupported_section' not in logic_core,
          'Logic-Core erweitert den strikten V9-Vertrag nicht direkt')

    check('window.__plantFactoryV63' in logic_ui,
          'V63-Releasebericht wird publiziert')
    check("singleSourceOfTruth: true" in logic_ui,
          'UI-Releasevertrag dokumentiert die eine Wahrheit')
    check("inventoryCategory: 'Schaltpläne'" in logic_ui,
          'UI-Releasevertrag dokumentiert die Inventarkategorie')
    check(("document.documentElement.dataset.plantFactoryRelease = '" + version + "'") in (logic_ui + v64_ui),
          'DOM-Releasekennung entspricht der aktuellen V63-Version')
    check('.logic-node' in logic_css and '.logic-port' in logic_css
          and '.logic-edge' in logic_css,
          'CSS deckt Blöcke, Ports und Verbindungen ab')
    check('@media' in logic_css, 'Logic-Workspace besitzt responsive Regeln')

    expected_sections = {
        'meta', 'sites', 'nodes', 'local_node', 'site_controller_map',
        'controllers', 'virtual_controllers', 'modbus_functions',
        'scaling_profiles', 'sensor_types', 'actuator_types', 'sensors',
        'actuators', 'process_modes', 'process_values',
        'parameter_generic_templates', 'schema_mappings', 'pid_configs',
        'control_method_templates', 'control_methods', 'processes',
        'process_states', 'filters', 'timers', 'rule_engine', 'rules',
    }
    check(set(v9) == expected_sections,
          'Kanonische V9-Konfiguration behält exakt 26 Sektionen')
    check('logic' not in v9 and 'logic_graph' not in v9,
          'V9-JSON enthält keine redundante Logic-Sektion')
    check(cross['meta'][0]['version'] == 8 and cross['meta'][0]['scope'] == 'cross',
          'Cross-Shard bleibt ein V8-Cross-Vertrag')
    check(all(key not in row for row in cross['controllers']
              for key in ('host', 'port', 'unit', 'bus_type')),
          'Cross-Shard enthält keine physischen Controller-Endpunkte')

    check(set(runtime_reference) == expected_sections,
          'Bereitgestellte Runtime-V9-Referenz behält exakt 26 Sektionen')
    check(runtime_reference['meta'][0]['scope'] == 'node_local'
          and runtime_reference['meta'][0]['node_id'] == 'fn-01',
          'Runtime-Referenz ist ein V9 Node-Shard für fn-01')
    check(len(runtime_reference['controllers']) == 4
          and len(runtime_reference['sensors']) == 10
          and len(runtime_reference['actuators']) == 11,
          'Runtime-Referenz enthält die vollständige WAGO-/Modbus-Projektion')
    check(len(runtime_reference['process_states']) == 8
          and len(runtime_reference['rules']) == 4,
          'Runtime-Referenz enthält Process States und Rule Engine vollständig')

    check(release_manifest['release'] == '63.1'
          and release_manifest['status'] == 'passed',
          'Maschinenlesbares V63.1 Release-Manifest ist freigegeben')
    check(release_manifest['logic_standard']['id'] == 'PF-LOGIC-V1'
          and release_manifest['logic_standard']['canonical_block_count'] == 33,
          'Release-Manifest fixiert PF-LOGIC-V1 und 33 Bausteine')
    check(release_manifest['logic_standard']['single_source_of_truth'] == 'project.logic',
          'Release-Manifest fixiert die kanonische einzige Wahrheit')
    check(release_manifest['archive']['deterministic'] is True
          and release_manifest['archive']['fresh_extract_verification'] == 'passed',
          'Release-Manifest dokumentiert deterministischen Fresh-Extract-Check')

    check(not python_style_failures(), 'V63-Python bleibt rein funktional',
          ', '.join(python_style_failures()))
    subprocess.run([sys.executable, '_tools/build_logic_library.py', '--check'],
                   cwd=ROOT, check=True)
    check(True, 'Generierte Logic-Bibliothek ist deterministisch')
    ElementTree.parse(ROOT / 'public/index.html') if False else None
    check(('PF-LOGIC-V1 Function Block Workspace V' + logic_release + ' aktiv') in logic_ui,
          'Logic-UI meldet den aktiven V63-Vertrag')

    print('Plant Factory V63.x static release contract: %s checks passed.' % PASSED)


if __name__ == '__main__':
    run()
