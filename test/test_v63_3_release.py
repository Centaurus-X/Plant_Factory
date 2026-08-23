#!/usr/bin/env python3
"""Verify the Plant Factory V63.3 I/O and HMI workflow release contract."""

import ast
import os
import json
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
    device = read('public/js/device.js')
    hmi = read('public/js/hmi.js')
    release_ui = read('public/js/v63_logic_ui.js')
    css = read('public/css/v63_3.css')
    manifest = load_json('public/svg_templates/library_manifest_v1.json')
    standard = load_json('config/symbol_standard_v1.json')
    release_manifest = load_json('docs/v63_3/RELEASE_MANIFEST_V63_3.json')

    supported = {'63.3': '63.3.0', '63.4': '63.4.0', '64': '64.0.0'}
    check(version in supported, 'VERSION ist V63.3 oder eine kompatible Nachfolgeversion', version)
    check(package.get('version') == supported[version],
          'package.json entspricht der aktuellen kompatiblen Version')
    check(('V' + version) in index and (version + ' · V9') in index,
          'Browseroberfläche zeigt die aktuelle kompatible Version')
    check('/public/css/v63_3.css' in index,
          'V63.3 Integrations-CSS ist eingebunden')
    check('test:v63.3' in package.get('scripts', {}),
          'Gezielte V63.3-Prüfung ist im Paket definiert')

    required = [
        'public/css/v63_3.css',
        'public/svg_templates/Generic_Sensor_Entity.svg',
        'test/test_v63_3_release.py',
        'test/test_hmi_widget_relation.mjs',
        'test/smoke_v63_3.py',
        'RELEASE_NOTES_V63_3_DE.md',
        'DIAGNOSE_UND_PATCH_V63_3_DE.md',
        'docs/v63_3/IO_ZUWEISUNGEN_UND_REGISTER.md',
        'docs/v63_3/HMI_WIDGET_OBJECT_WORKFLOW.md',
        'docs/v63_3/GENERIC_SENSOR_ENTITY.md',
        'docs/v63_3/TEST_UND_FREIGABE.md',
        'docs/v63_3/RELEASE_MANIFEST_V63_3.json',
    ]
    missing = [name for name in required if not (ROOT / name).is_file()]
    check(not missing, 'Alle V63.3 Releaseartefakte sind vorhanden', ', '.join(missing))

    check('device-assignment-actions' in device,
          'I/O-Aktionen besitzen einen gemeinsamen Container')
    action_block_start = device.index('<div class="form-row device-assignment-actions">')
    action_block_end = device.index('</div>', action_block_start)
    action_block = device[action_block_start:action_block_end]
    check('id="device-assign-btn"' in action_block
          and 'id="device-remove-btn"' in action_block,
          'Zuweisen und Entfernen stehen nebeneinander')
    check('assignmentsExpanded: false' in device,
          'Zuordnungsregister ist standardmäßig eingeklappt')
    check('id="device-assignments-panel"' in device and 'hidden>' in device,
          'Zuordnungstabelle startet verborgen')
    check('aria-expanded="false"' in device,
          'Registerzustand ist zugänglich deklariert')
    check('function setAssignmentsRegisterExpanded(expanded)' in device
          and 'function toggleAssignmentsRegister()' in device,
          'Zuordnungsregister besitzt eine zentrale Zustandssteuerung')
    check('device-assignment-table__truncate' in device
          and 'title="${escapeAttr(elementValue)}"' in device
          and 'title="${escapeAttr(aliasValue)}"' in device,
          'Element und Alias werden gekürzt mit vollständigem Tooltip')
    check('device-assignment-table__row--head' in css
          and 'grid-template-columns:' in css,
          'Zuordnungstabelle verwendet stabile Spaltengeometrie')
    check('.device-assignment-table__truncate' in css
          and 'text-overflow: ellipsis' in css,
          'lange Element- und Aliaswerte überlagern keine Nachbarspalten')
    check('function preferredRoleForElement(elementId)' in device,
          'Symbolmetadaten können die I/O-Rolle vorgeben')

    templates = manifest.get('templates', {})
    generic = templates.get('Generic_Sensor_Entity', {})
    check(manifest.get('template_count') == len(templates) and len(templates) >= 26,
          'PF-PID-V1 enthält mindestens 26 kanonische Symbole')
    check(generic.get('name') == 'Generische Sensor-Entität'
          and generic.get('kategorie') == 'Messstellen',
          'Generic_Sensor_Entity ist in Messstellen einsortiert')
    check(generic.get('family') == 'generic-sensor-entity'
          and generic.get('tag_prefix') == 'SE',
          'Generische Sensorfamilie besitzt stabile Semantik')
    bindings = generic.get('bindings', [])
    check(bindings == [{'mode': 'generic', 'role': 'sensor', 'sensor_type': None}],
          'Generische Sensor-Entität deklariert eine offene Sensorrolle')
    port_kinds = {row.get('kind') for row in generic.get('ports', [])}
    check(port_kinds == {'process', 'signal', 'data'},
          'Generische Sensor-Entität unterstützt Prozess-, Signal- und Datenports')
    check('Generic_Sensor_Entity' in read('_tools/build_symbol_standard.py'),
          'Generische Sensor-Entität wird deterministisch generiert')
    ElementTree.parse(ROOT / 'public/svg_templates/Generic_Sensor_Entity.svg')
    check(True, 'Generic_Sensor_Entity.svg ist valides XML')
    check(standard.get('standard_id') == 'PF-PID-V1'
          and standard.get('hmi_controls', {}).get('auto_binding') is False,
          'PF-PID-V1 und explizite HMI-Policy bleiben erhalten')

    check('id="hmi-quick-element"' in hmi,
          'Widget-Erzeugung besitzt eine Objekt-Auswahl')
    check('id="hmi-quick-use-selection"' in hmi,
          'Canvas-Auswahl kann in den Widget-Workflow übernommen werden')
    check('function defaultBindingForWidget(widget, elementId)' in hmi,
          'Widget-Objekt-Relation nutzt einen kanonischen Binding-Builder')
    check('function inferSourceFromDeviceAssignment(elementId, widgetType)' in hmi,
          'I/O-Quelle wird aus der bestehenden Device-Zuweisung abgeleitet')
    check("origin: 'explicit'" in hmi and 'auto_created: false' in hmi,
          'Widgets bleiben ausschließlich explizit')
    check("commitHmiModel(next, 'add_widget_with_object_relation')" in hmi,
          'Widget und Objektbindung werden atomar gespeichert')
    check('hmi-widget-register' in hmi
          and hmi.index('hmi-widget-register') < hmi.index('hmi-widget-config-grid'),
          'Widget-Tabelle steht vor Erzeugung und Editor')
    check('<th>Widget</th><th>Typ</th><th>P&amp;ID-/SVG-Objekt</th>' in hmi,
          'Widget-Tabelle zeigt Objektbezug und Datenfluss')
    check('hmi-widget-relation-card' in hmi
          and 'Datenbindung bearbeiten' in hmi,
          'Widget-Editor zeigt die aktive Relation und führt zum Binding')
    check('.hmi-widget-table td' in css and 'overflow-wrap: anywhere' in css,
          'Widget-Tabelle verhindert Textüberlagerungen ohne Informationsverlust')
    check('.hmi-widget-config-grid' in css,
          'Widget-Erzeugung und Bearbeitung sind klar getrennt')

    check(("version: '63.3'" in release_ui) or ("version: '63.4'" in release_ui),
          'Browser-Releasebericht ist V63.3 oder kompatible Nachfolgeversion')
    check(("patchContract: 'PF-V63.3-HMI-IO-UX'" in release_ui)
          or ("inheritedPatchContract: 'PF-V63.3-HMI-IO-UX'" in release_ui),
          'V63.3 UX-Vertrag wird direkt oder geerbt publiziert')
    check(("inheritedPatchContract: 'PF-V63.2-STABILITY'" in release_ui)
          or ("stabilityContract: 'PF-V63.2-STABILITY'" in release_ui),
          'V63.2 Stabilitätsvertrag bleibt geerbt')
    check('genericSensorEntity: true' in release_ui,
          'Generische Sensor-Entität wird im Releasebericht publiziert')
    check("hmiWidgetObjectWorkflow: 'explicit-one-step'" in release_ui,
          'Expliziter Widget-/Objekt-Workflow wird publiziert')

    check(release_manifest.get('release') == '63.3',
          'Maschinenlesbares Manifest ist V63.3')
    check(release_manifest.get('contracts', {}).get('ux_patch')
          == 'PF-V63.3-HMI-IO-UX',
          'Release-Manifest fixiert den V63.3 UX-Vertrag')
    check(release_manifest.get('symbol_library', {}).get('template_count') == 26,
          'Release-Manifest fixiert 26 PF-PID-V1-Symbole')
    check(release_manifest.get('status') == 'passed',
          'Release-Manifest ist freigegeben')

    result = subprocess.run(
        [sys.executable, '_tools/build_symbol_standard.py', '--check'],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, 'Symbolbibliothek ist deterministisch',
          result.stderr.strip() or result.stdout.strip())
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

    print('Plant Factory V63.3 static release contract: %s checks passed.' % PASSED)


if __name__ == '__main__':
    main()
