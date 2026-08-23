#!/usr/bin/env python3
"""Verify the Plant Factory V63.2 stability and Automation V9 bridge release."""

import ast
import json
import os
import subprocess
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
    if EXCLUDED_PARTS.intersection(path.parts):
        return True
    return any(part.startswith('.release_test.') for part in path.parts)


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


def main():
    version = read('VERSION').strip()
    package = load_json('package.json')
    index = read('public/index.html')
    css = read('public/css/v63_2.css')
    modal_ui = read('public/js/v62_ui.js')
    connections = read('public/js/connection_mapper.js')
    device = read('public/js/device.js')
    logic_ui = read('public/js/v63_logic_ui.js')
    automation = read('public/js/automation_contract.js')
    automation_tabs = read('public/js/automation_tabs.js')
    processes = read('public/js/processes.js')
    chrome = read('public/js/v9_ui_chrome.js')
    ui = read('public/js/ui.js')
    adapter = read('public/js/model_adapter.js')
    example = load_json('projekte/v63_2_komplettbeispiel.json')
    manifest = load_json('docs/v63_2/RELEASE_MANIFEST_V63_2.json')

    supported = {'63.2': '63.2.0', '63.3': '63.3.0', '63.4': '63.4.0', '64': '64.0.0'}
    check(version in supported,
          'VERSION ist V63.2 oder eine kompatible Nachfolgeversion', version)
    check(package.get('version') == supported[version],
          'package.json entspricht der aktuellen kompatiblen Version')
    check(('V' + version) in index and (version + ' · V9') in index,
          'Browseroberfläche zeigt die aktuelle kompatible Version')
    check('/public/css/v63_2.css' in index,
          'V63.2 Stabilitäts-CSS ist eingebunden')
    check("from './automation_contract.js'" in ui
          and "from './automation_contract.js'" in automation_tabs,
          'Automation-Vertrag ist an Lade-, Speicher- und UI-Grenzen eingebunden')
    check('test:v63.2' in package.get('scripts', {}),
          'Gezielte V63.2-Prüfung ist im Paket definiert')

    required_files = [
        'public/css/v63_2.css',
        'public/js/automation_contract.js',
        'test/test_automation_contract.mjs',
        'test/test_v63_2_release.py',
        '_tools/build_v63_2_example.mjs',
        'test/fixtures/v63_2_example_overlay.json',
        'projekte/v63_2_komplettbeispiel.json',
        'projekte/v63_2_komplettbeispiel.svg',
        'RELEASE_NOTES_V63_2_DE.md',
        'DIAGNOSE_UND_PATCH_V63_2_DE.md',
        'docs/v63_2/STABILITAETSVERTRAG.md',
        'docs/v63_2/AUTOMATION_V9_BRIDGE.md',
        'docs/v63_2/TEST_UND_FREIGABE.md',
        'docs/v63_2/RELEASE_MANIFEST_V63_2.json',
    ]
    missing = [name for name in required_files if not (ROOT / name).is_file()]
    check(not missing, 'Alle V63.2 Releaseartefakte sind vorhanden', ', '.join(missing))

    check('data-window-reset-on-open="true"' in index,
          'Verbindungsdialog setzt gespeicherte Geometrie zurück')
    check('data-window-default-width="620"' in index,
          'Verbindungsdialog deklariert 620 px Defaultbreite')
    check('data-window-default-height="auto"' in index,
          'Verbindungsdialog verwendet inhaltsabhängige Höhe')
    check('width: min(620px, calc(100vw - 32px))' in css,
          'Dialogbreite ist responsiv begrenzt')
    check('max-height: min(620px, calc(100vh - 32px))' in css,
          'Dialoghöhe ist responsiv begrenzt')
    check('function resetManagedWindowGeometry(modal)' in modal_ui,
          'Modalmanager besitzt eine gezielte Geometrie-Rücksetzung')
    check("modal.dataset.windowResetOnOpen !== 'true'" in modal_ui,
          'Geometrie-Rücksetzung ist opt-in und minimal-invasiv')
    check('record.panel.style.removeProperty(\'height\')' in modal_ui,
          'Automatische Höhe entfernt alte Inline-Höhen')
    check('resetManagedWindowGeometry(modal);' in modal_ui
          and "plant:modal-open" in modal_ui,
          'Rücksetzung erfolgt bei jedem erneuten Öffnen')

    check('self.layoutEpoch += 1' in connections,
          'Verbindungs-Rebuilds brechen alte Layoutzyklen ab')
    check('self.scheduleLayoutRefresh = function (reason, options)' in connections,
          'Verbindungslayout besitzt einen zentralen Retry-Scheduler')
    check('window.requestAnimationFrame(function ()' in connections,
          'Verbindungslayout wartet Browser-Layoutzyklen ab')
    check('maxAttempts' in connections and 'attempt < maxAttempts' in connections,
          'Layout-Retry ist begrenzt')
    check("state.emit('connections:layout-ready'" in connections,
          'Fertiges Verbindungslayout publiziert ein Lifecycle-Ereignis')
    check("state.emit('connections:layout-settled'" in connections,
          'Begrenztes Verbindungslayout publiziert einen Abschluss')
    check("line.setAttribute('data-render-state', 'pending')" in connections,
          'Noch nicht berechenbare Linien bleiben pending')
    check("line.setAttribute('data-render-state', 'ready')" in connections,
          'Nur gültige Linien werden ready geschaltet')
    check('Number.isFinite' in connections,
          'Verbindungskoordinaten werden auf Endlichkeit geprüft')
    check('/NaN|Infinity|undefined/.test(pathData)' in connections,
          'Ungültige SVG-Pfade werden abgewiesen')
    check('.connection-line[data-render-state="pending"]' in css
          and 'visibility: hidden' in css,
          'Pending-Linien werden nicht flackernd angezeigt')
    check("state.on('elements:rebuilt'" in connections
          and "state.on('connections:loaded'" in connections,
          'Objekt- und Verbindungs-Lifecycle lösen getrennte Layouts aus')

    check('function selectCurrentCanvasElement(selectedIds)' in device,
          'I/O-Editor besitzt eine zentrale Canvas-Auswahlsynchronisierung')
    check('source.length !== 1' in device,
          'Mehrfachauswahl wird nicht fälschlich reduziert')
    check("state.on('selection:changed'" in device,
          'I/O-Editor reagiert unmittelbar auf Canvas-Auswahl')
    check("state.on('elements:rebuilt'" in device,
          'I/O-Editor synchronisiert nach Objekt-Rebuild')
    check("state.on('history:restored'" in device,
          'I/O-Editor synchronisiert nach Undo/Redo')
    check('populateFromExisting();' in device,
          'I/O-Felder verwenden den bestehenden kanonischen Ladepfad')

    check("const demoId = 'logic_timer_counter_demo'" in logic_ui,
          'Timer-/Counter-Demo besitzt eine stabile ID')
    check('model.diagrams.push(demo);' in logic_ui,
          'Demo wird additiv in das bestehende Modell eingefügt')
    check("created ? 'demo_add' : 'demo_select'" in logic_ui,
          'Demo unterscheidet Einfügen und reinen Wechsel')
    check('{ history: created }' in logic_ui,
          'Nur das erstmalige Einfügen erzeugt einen History-Eintrag')
    check('state.set(\'logic\', createTimerCounterDemo' not in logic_ui,
          'Demo ersetzt project.logic nicht mehr')

    check("AUTOMATION_CONTRACT_ID = 'PF-AUTOMATION-V9-BRIDGE'" in automation,
          'Automation-Bridge besitzt eine stabile Vertragskennung')
    check("AUTOMATION_CONTRACT_RELEASE = '63.4'" in automation,
          'Automation-Bridge ist auf die kompatible V63.4-Fassung versioniert')
    for section in ('process_states', 'filters', 'timers', 'rule_engine', 'rules'):
        check("'%s'" % section in automation,
              'Automation-Bridge enthält Runtime-Sektion %s' % section)
    check('out.automation_rule_sets = []' in automation,
          'Aktive Legacy-Automation-Regeln werden deaktiviert')
    check('out.legacy_automation_rule_sets = cloneValue(preservedRules)' in automation,
          'Legacy-Regeln werden nicht-destruktiv archiviert')
    check('project_rules_authority' in automation
          and "'dynamic_rule_engine'" in automation,
          'Projektregel-Autorität ist eindeutig')
    check('normalizeProjectAutomationModels' in ui
          and 'normalizeAutomationConfig' in ui,
          'Lade- und Speichergrenzen normalisieren den Automation-Vertrag')
    check('cfg.automation_rule_sets = []' in adapter,
          'Runtime-Export enthält keine zweite aktive Regelquelle')

    check('data-proc-subtab="project">Projekt-States' in processes,
          'Automation-UI benennt Projekt-States eindeutig')
    check('data-open-automation-workspace="rules">Projektregeln öffnen' in processes,
          'Automation-UI verlinkt auf die Projektregel-Autorität')
    check('data-open-automation-workspace="v9-rules">Runtime-Regeln V9 öffnen' in processes,
          'Automation-UI trennt Runtime-Regeln eindeutig')
    check('data-proc-subtab="automation_config">Runtime-Hilfen' in processes,
          'Automation-UI kennzeichnet Hilfen als Runtime-Sicht')
    check("rules: 'Projektregeln'" in chrome,
          'Globale Navigation benennt Projektregeln')
    check("'v9-states': 'Runtime-States V9'" in chrome,
          'Globale Navigation benennt Runtime-States')
    check("'v9-rules': 'Runtime-Regeln V9'" in chrome,
          'Globale Navigation benennt Runtime-Regeln')
    check("text:'PF-AUTOMATION-V9-BRIDGE'" in automation_tabs,
          'Runtime-Hilfen zeigen den Automation-Bridge-Vertrag')
    check('Aktive doppelte Regelquellen:' in automation_tabs,
          'Runtime-Hilfen machen Regelkonflikte sichtbar')

    check(example.get('release') == '63.2',
          'Beispielprojekt ist auf V63.2 versioniert')
    check(example.get('example_contract', {}).get('id') == 'PF-V63.2-COMPLETE-EXAMPLE',
          'Beispielprojekt trägt einen stabilen Vertrag')
    check(len(example.get('elements', [])) == 6,
          'Beispielprojekt enthält sechs PF-PID-V1-Objekte')
    check(len(example.get('connections', [])) == 5,
          'Beispielprojekt enthält fünf semantische Verbindungen')
    check(len(example.get('devices', {}).get('assignments', {})) == 3,
          'Beispielprojekt enthält drei I/O-Zuweisungen')
    check(len(example.get('hmi', {}).get('widgets', [])) == 2
          and len(example.get('hmi', {}).get('bindings', [])) == 2,
          'Beispielprojekt enthält explizite HMI-Widgets und Bindings')
    check(len(example.get('processes', {}).get('process_states', [])) == 2,
          'Beispielprojekt enthält Projekt-States')
    check(len(example.get('dynamic_rule_engine', {}).get('rule_sets', [])) == 1,
          'Beispielprojekt enthält eine Projektregelgruppe')
    check(len(example.get('free_rules', {}).get('timers', [])) == 1,
          'Beispielprojekt enthält einen freien Timer')
    diagram_ids = {
        row.get('diagram_id')
        for row in example.get('logic', {}).get('diagrams', [])
    }
    check(diagram_ids == {
        'logic_reactor_temperature_interlock',
        'logic_timer_counter_demo',
    }, 'Beispielprojekt enthält zwei additive Schaltpläne', str(diagram_ids))
    check(example.get('automation_cfg', {}).get('automation_rule_sets') == [],
          'Beispielprojekt enthält keine aktive Legacy-Regelquelle')
    check(example.get('automation_cfg', {}).get('contract', {}).get('id')
          == 'PF-AUTOMATION-V9-BRIDGE',
          'Beispielprojekt verwendet die V9-Bridge')
    ElementTree.parse(ROOT / 'projekte' / 'v63_2_komplettbeispiel.svg')
    check(True, 'Beispiel-SVG ist valides XML')

    check(manifest.get('release') == '63.2',
          'Maschinenlesbares Release-Manifest ist V63.2')
    check(manifest.get('contracts', {}).get('automation_bridge')
          == 'PF-AUTOMATION-V9-BRIDGE',
          'Release-Manifest fixiert die Automation-Bridge')
    check(manifest.get('contracts', {}).get('stability_patch')
          == 'PF-V63.2-STABILITY',
          'Release-Manifest fixiert den Stabilitätsvertrag')
    check(manifest.get('canonical_models', {}).get('logic') == 'project.logic',
          'Release-Manifest fixiert die Logic-Quelle')
    check(manifest.get('patches', {}).get('logic_demo_additive') is True,
          'Release-Manifest fixiert die additive Demo')
    check(manifest.get('patches', {}).get('connection_modal_default_width_px') == 620,
          'Release-Manifest fixiert die Dialogbreite')
    check(manifest.get('status') == 'passed',
          'Release-Manifest ist final freigegeben')
    check(manifest.get('verification', {}).get('status') == 'passed',
          'Release-Manifest bestätigt die vollständige Prüfkette')
    check(manifest.get('verification', {}).get('fresh_extract') == 'passed',
          'Release-Manifest bestätigt die Fresh-Extract-Prüfung')
    check(manifest.get('archive', {}).get('deterministic') is True
          and manifest.get('archive', {}).get('double_build') == 'byte_identical',
          'Release-Manifest bestätigt den deterministischen Doppelbuild')

    subprocess.run(
        [os.environ.get('NODE_BINARY', 'node'), '_tools/build_v63_2_example.mjs', '--check'],
        cwd=ROOT,
        check=True,
    )
    check(True, 'V63.2 Beispielprojekt ist deterministisch')
    style_failures = python_style_failures()
    check(not style_failures, 'Python-Code bleibt rein funktional', ', '.join(style_failures))
    result = subprocess.run(
        [os.environ.get('NODE_BINARY', 'node'), '_tools/check_js_functional_style.cjs'],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, 'JavaScript-Code bleibt rein funktional',
          result.stderr.strip() or result.stdout.strip())

    print('Plant Factory V63.2 static release contract: %s checks passed.' % PASSED)


if __name__ == '__main__':
    main()
