#!/usr/bin/env python3
"""Verify the additive Plant Factory V64_r2 release contract."""

import ast
import json
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parent.parent
PASSED = 0
VIEWS = ('cockpit', 'states', 'rules', 'signals', 'library', 'engine', 'map')
SECTIONS = (
    'processes', 'process_states', 'rules', 'filters', 'timers', 'rule_engine',
    'parameter_generic_templates', 'schema_mappings', 'pid_configs',
    'control_methods', 'control_method_templates', 'process_modes', 'process_values',
)


def read(relative):
    """Read one UTF-8 release file."""
    return (ROOT / relative).read_text(encoding='utf-8')


def check(condition, label, detail=''):
    """Record one deterministic release assertion."""
    global PASSED
    if not condition:
        suffix = ': ' + detail if detail else ''
        raise AssertionError(label + suffix)
    PASSED += 1
    print('   ok  ' + label)


def css_selectors(css_text):
    """Return selector lists from the flat, studio-scoped stylesheet."""
    text = re.sub(r'/\*.*?\*/', '', css_text, flags=re.S)
    text = re.sub(r'@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}', '', text)
    text = re.sub(r'@media[^{]*\{', '', text)
    return [match.group(1).strip() for match in re.finditer(r'([^{}]+)\{[^{}]*\}', text)]


def python_style_failures(path):
    """Return forbidden Python syntax nodes in one source file."""
    tree = ast.parse(path.read_text(encoding='utf-8'))
    failures = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.ClassDef, ast.Lambda)):
            failures.append('%s:%s' % (path.name, node.lineno))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.decorator_list:
            failures.append('%s:%s decorator' % (path.name, node.lineno))
    return failures


def main():
    """Execute the complete V64_r2 static contract."""
    package = json.loads(read('package.json'))
    index = read('public/index.html')
    module = read('public/js/v9_ui_automation.js')
    css = read('public/css/v64_r2.css')
    store = read('public/js/v9_store.js')
    drawing = read('public/js/v64_plant_drawing.js')
    test_all = read('test_all.sh')

    check(package.get('version') == '64.0.0', 'Basisversion bleibt 64.0.0')
    check(package.get('releaseRevision') in {'r2', 'r3', 'r4', 'r5', 'r6'}, 'Paket kennzeichnet Revision r2 oder additive Folgerevision')
    check('test:v64:r2' in package.get('scripts', {}), 'R2-Vertragstest ist registriert')
    check('test:smoke:v64:r2' in package.get('scripts', {}), 'R2-Browsertest ist registriert')
    check(any(('V64_' + rev) in index and ('64_' + rev + ' · V9') in index for rev in ('r2', 'r3', 'r4', 'r5', 'r6')), 'UI zeigt die R2-Version oder additive Folgerevision')
    check('/public/css/v64.css' in index and '/public/css/v64_r1.css' in index,
          'V64- und R1-Schichten bleiben erhalten')
    check(index.index('/public/css/v64_r1.css') < index.index('/public/css/v64_r2.css'),
          'R2-CSS ist ausschließlich additiv nach R1 eingebunden')
    check('data-target-tab="v9-automation" data-workspace="automation"' in index,
          'Automation-Rail öffnet ausschließlich das neue Studio')
    check(all('data-target-tab="' + route + '" data-legacy-route="true"' in index
              for route in ('processes', 'rules', 'v9-states', 'v9-rules')),
          'Legacy-Automation-Routen bleiben kompatibel adressierbar')
    check('id="tab-v9-automation"' in index and 'id="v9-automation-panel"' in index,
          'Automation Studio besitzt genau einen Panel-Host')

    check("window.__appVersion = '64_r2'" in drawing or "window.__appVersion = '64_r3'" in drawing or "window.__appVersion = '64_r4'" in drawing or "window.__appVersion = '64_r5'" in drawing or "window.__appVersion = '64_r6'" in drawing, 'Browser publiziert die R2- oder additive Gesamtkennung')
    check("window.__plantFactoryV64R1" in drawing, 'R1-Zeicheneditorvertrag bleibt publiziert')
    check("window.__plantFactoryV64R2" in drawing, 'R2-Releasevertrag ist publiziert')
    check("patchContract: 'PF-AUTOMATION-STUDIO-V1'" in drawing,
          'R2 benennt den Automation-Studio-Vertrag')

    for view in VIEWS:
        check("id: '" + view + "'" in module, 'Automation-View vorhanden: ' + view)
    for section in SECTIONS:
        check("'" + section + "'" in module, 'V9-Sektion im Studio: ' + section)

    check('export function initAutomationPanel(container)' in module,
          'Automation Studio besitzt einen funktionalen Einstiegspunkt')
    check('store.replaceSections(patch)' in module,
          'Studio speichert Mehrtabellenänderungen atomar')
    check('export function replaceSections(patch)' in store,
          'V9-Store stellt atomaren Mehrsektions-Commit bereit')
    check('SECTION_ORDER.includes(sectionName)' in store,
          'Mehrsektions-Commit ist auf den kanonischen V9-Vertrag begrenzt')
    check('applyProjection' not in module and 'state.deviceConfig' not in module,
          'Studio erzeugt keine zweite Automation-Wahrheit')
    check('window.confirm' not in module and 'localStorage' not in module,
          'Studio verwendet weder native Dialoge noch parallelen Browser-Speicher')
    check('innerHTML' not in re.sub(r'/\*.*?\*/|//[^\n]*', '', module, flags=re.S),
          'Studio erzeugt DOM ohne innerHTML')
    module_code = re.sub(r'/\*.*?\*/|//[^\n]*', '', module, flags=re.S)
    check('=>' not in module_code and not re.search(r'\bclass\s+[A-Za-z_$]', module_code),
          'Automation-Modul bleibt rein funktional')
    selectors = css_selectors(css)
    leaking = [selector_list for selector_list in selectors if not all(
        selector.strip().startswith(('.as-root', '#tab-v9-automation'))
        for selector in selector_list.split(','))]
    check(not leaking, 'R2-CSS bleibt vollständig auf das Automation Studio begrenzt',
          ', '.join(leaking[:5]))

    required_docs = (
        'RELEASE_NOTES_V64_R2_DE.md',
        'DIAGNOSE_UND_RELEASE_V64_R2_DE.md',
        'docs/v64_r2/ARCHITEKTUR_UND_BEDIENUNG.md',
        'docs/v64_r2/TEST_UND_FREIGABE.md',
        'docs/v64_r2/RELEASE_MANIFEST_V64_R2.json',
    )
    missing = [relative for relative in required_docs if not (ROOT / relative).is_file()]
    check(not missing, 'R2-Dokumentation ist vollständig', ', '.join(missing))
    archive_roots = ("default='Automated_SVG_Integration_64_r2'", "default='Automated_SVG_Integration_64_r3'", "default='Automated_SVG_Integration_64_r4'", "default='Automated_SVG_Integration_64_r5'", "default='Automated_SVG_Integration_64_r6'")
    check(any(root in read('_tools/build_release_archive.py') for root in archive_roots),
          'Archivbau verwendet den R2- oder R3-Wurzelordner')
    check(any(root in read('_tools/verify_release_archive.py') for root in archive_roots),
          'Archivprüfung erwartet den R2- oder R3-Wurzelordner')
    check(test_all.count('python3 test/test_v64_r2_release.py') == 3,
          'R2-Vertrag liegt an allen drei Freigabegates')
    check('python3 test/smoke_v64_r2.py' in test_all,
          'R2-Browserprüfung ist Teil der Gesamtkette')

    style_failures = python_style_failures(ROOT / 'test' / 'test_v64_r2_release.py')
    style_failures.extend(python_style_failures(ROOT / 'test' / 'smoke_v64_r2.py'))
    check(not style_failures, 'Neue R2-Python-Dateien bleiben rein funktional', ', '.join(style_failures))

    print('V64_r2 release contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()
