#!/usr/bin/env python3
"""Verify the complete Plant Factory V62.1 integration contract."""

import ast
import json
import os
import re
import subprocess
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_PARTS = {
    '.git', '.venv', 'venv', 'node_modules', '__pycache__',
    '.pytest_cache', '.mypy_cache',
}


def check(condition, label, detail=''):
    if not condition:
        suffix = ': %s' % detail if detail else ''
        raise AssertionError(label + suffix)
    print('   ok  %s' % label)


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


def native_dialog_failures():
    pattern = re.compile(r'\b(?:window\s*\.\s*)?(?:alert|confirm|prompt)\s*\(')
    failures = []
    for path in sorted((ROOT / 'public' / 'js').glob('*.js')):
        source = path.read_text(encoding='utf-8')
        for match in pattern.finditer(source):
            line = source.count('\n', 0, match.start()) + 1
            failures.append('%s:%s' % (path.relative_to(ROOT), line))
    return failures


def main():
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    html = (ROOT / 'public' / 'index.html').read_text(encoding='utf-8')
    v62_source = (ROOT / 'public' / 'js' / 'v62_ui.js').read_text(encoding='utf-8')
    dialog_source = (ROOT / 'public' / 'js' / 'dialog_service.js').read_text(encoding='utf-8')
    connection_source = (ROOT / 'public' / 'js' / 'connection_mapper.js').read_text(encoding='utf-8')
    hmi_source = (ROOT / 'public' / 'js' / 'hmi.js').read_text(encoding='utf-8')
    v62_css = (ROOT / 'public' / 'css' / 'v62.css').read_text(encoding='utf-8')
    python_style = (ROOT / '_tools' / 'check_functional_style.py').read_text(encoding='utf-8')
    js_style = (ROOT / '_tools' / 'check_js_functional_style.cjs').read_text(encoding='utf-8')

    current_release = (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
    supported_releases = {'62.1': '62.1.0', '63.1': '63.1.0', '63.2': '63.2.0', '63.3': '63.3.0', '63.4': '63.4.0', '64': '64.0.0'}
    check(current_release in supported_releases,
          'Release ist V62.1 oder eine freigegebene kompatible Nachfolgeversion',
          current_release)
    check(package.get('version') == supported_releases[current_release],
          'package.json entspricht der kompatiblen Releasekennung')
    check(current_release + ' · V9' in html and ('V' + current_release) in html,
          'sichtbare kompatible Releasekennung ist konsistent')
    check('/public/css/v62.css' in html and '/public/js/v62_ui.js' in html,
          'V62.1 Integrationsschichten werden geladen')
    check(html.index('/public/css/v62.css') > html.index('/public/css/v61.css')
          and html.index('/public/js/v62_ui.js') > html.index('/public/js/v61_ui.js'),
          'V62.1 überschreibt V61.1 nur in der additiven Integrationsschicht')

    required = {
        ROOT / 'public' / 'js' / 'dialog_service.js',
        ROOT / 'public' / 'js' / 'v62_ui.js',
        ROOT / 'public' / 'css' / 'v62.css',
        ROOT / 'docs' / 'v62_1' / 'MODAL_STANDARD_PF_MODAL_V1.md',
        ROOT / 'docs' / 'v62_1' / 'KONTEXTMENUE_UND_CANVAS.md',
        ROOT / 'docs' / 'v62_1' / 'HMI_SETUP_PF_HMI_SETUP_V2.md',
        ROOT / 'docs' / 'v62_1' / 'TEST_UND_FREIGABE.md',
        ROOT / 'docs' / 'v62_1' / 'RELEASE_MANIFEST_V62_1.json',
        ROOT / 'RELEASE_NOTES_V62_1_DE.md',
    }
    missing = sorted(str(path.relative_to(ROOT)) for path in required if not path.is_file())
    check(not missing, 'V62.1 Code- und Dokumentationsartefakte vollständig', ', '.join(missing))

    check("querySelectorAll('.modal, .v9-modal')" in v62_source
          and 'MutationObserver' in v62_source
          and 'installWindowDrag' in v62_source
          and 'installWindowResize' in v62_source
          and 'toggleManagedWindowMaximize' in v62_source,
          'statische und dynamische Dialoge teilen den PF-MODAL-V1-Manager')
    check('Alt + Pfeiltasten' in v62_source
          and "event.key === '0'" in v62_source
          and "event.key === 'Enter'" in v62_source,
          'bewegliche Dialoge sind zusätzlich per Tastatur steuerbar')
    check('showNotice' in dialog_source and 'showConfirmation' in dialog_source
          and 'showInputDialog' in dialog_source,
          'themenfähiger Anwendungsdialogdienst ist vollständig')
    check(not native_dialog_failures(),
          'Produktcode enthält keine browser-nativen alert/confirm/prompt-Aufrufe',
          ', '.join(native_dialog_failures()))

    check('data-connection-action="edit"' in connection_source
          and 'showEditConnectionDialog' in connection_source
          and 'modal-verbindung-bearbeiten' in connection_source,
          'Verbindung bearbeiten öffnet den transaktionalen Modal-Editor')
    check('edit-von-select' in html and 'edit-nach' in html
          and 'edit-von-port' in html and 'edit-nach-port' in html
          and 'edit-connection-validation' in html,
          'Verbindungsmodal enthält Endpunkte, Ports und Validierung')
    check("reason: 'incompatible_endpoints'" in connection_source
          and "reason: 'incompatible_ports'" in connection_source,
          'Verbindungsvertrag differenziert Endpunkte und Ports')
    check("state.set('connections'" in connection_source
          and 'state.saveHistory()' in connection_source
          and "state.emit('connection:updated'" in connection_source,
          'Verbindungsänderungen bleiben atomar im Connection-Domainmodell')

    context_actions = {
        'object-properties', 'object-io', 'object-hmi-widget',
        'object-hmi-binding', 'object-connect', 'object-connections',
        'connection-edit', 'connection-delete', 'canvas-fit',
        'canvas-grid', 'canvas-snap', 'canvas-hmi', 'canvas-undo',
        'canvas-redo', 'canvas-deselect',
    }
    missing_context = sorted(action for action in context_actions if action not in v62_source)
    check(not missing_context, 'Canvas-, Objekt- und Verbindungskontextmenü vollständig',
          ', '.join(missing_context))
    check("setAttribute('role', 'menu')" in v62_source
          and "event.key === 'ArrowDown'" in v62_source
          and "event.key === 'Escape'" in v62_source,
          'Kontextmenü ist tastatur- und assistiv bedienbar')

    check("HMI_WORKFLOW_STEPS" in hmi_source
          and "label: 'Datenbindung'" in hmi_source
          and "label: 'Zustände & Alarme'" in hmi_source
          and "label: 'Darstellung'" in hmi_source,
          'HMI-Setup besitzt vier verständliche geführte Schritte')
    check('Widget → SVG' not in hmi_source
          and 'P&amp;ID-/SVG-Objekt' in hmi_source
          and 'Runtime-Quelle / Interaktion' in hmi_source,
          'HMI-Datenfluss wird explizit als Widget-Objekt-Runtime-Pipeline erklärt')
    check("name: 'Button (optional)'" in hmi_source
          and "name: 'Toggle (optional)'" in hmi_source,
          'Buttons und Toggle bleiben explizit optional')
    check("plant:hmi-open-subtab" in hmi_source
          and "decorateHmiPanel(panel, 'widgets'" in hmi_source
          and "decorateHmiPanel(panel, 'bindings'" in hmi_source
          and "decorateHmiPanel(panel, 'styles'" in hmi_source
          and "decorateHmiPanel(panel, 'appearance'" in hmi_source,
          'Rechtsklick und HMI-Workflow sind gekoppelt')
    check(hmi_source.count("showConfirmation('") >= 4,
          'destruktive HMI-Aktionen verwenden modale Bestätigungen')

    check('#sidebar-right.collapsed #btn-right-collapse' in v62_css
          and 'visibility: visible !important' in v62_css
          and 'pointer-events: auto !important' in v62_css
          and 'left: 7px !important' in v62_css,
          'Inspector-Einblendeschalter bleibt im 44-px-Rail sichtbar')
    check('.hmi-workflow-overview' in v62_css
          and '.hmi-binding-pipeline' in v62_css
          and '.hmi-step-navigation' in v62_css,
          'HMI-Workflow besitzt responsive V62.1-Darstellung')

    check("'.venv'" in python_style and "'venv'" in python_style
          and "part.startswith('.release_test.')" in python_style,
          'Python-Stilprüfung schließt virtuelle Umgebungen und Testarbeitsbereiche aus')
    check("'.venv'" in js_style and "'venv'" in js_style
          and "entry.name.startsWith('.release_test.')" in js_style,
          'JavaScript-Stilprüfung schließt virtuelle Umgebungen und Testarbeitsbereiche aus')

    release_manifest = json.loads(
        (ROOT / 'docs' / 'v62_1' / 'RELEASE_MANIFEST_V62_1.json').read_text(encoding='utf-8')
    )
    check(release_manifest.get('release') == '62.1'
          and release_manifest.get('status') in {'prepared', 'passed'},
          'maschinenlesbares V62.1 Release-Manifest ist konsistent')
    check(release_manifest.get('object_standard', {}).get('release') == '61.1',
          'PF-PID-V1 bleibt als stabiler V61.1 Objektstandard erhalten')

    svg_paths = sorted((ROOT / 'public' / 'svg_templates').glob('*.svg'))
    svg_paths.extend(sorted((ROOT / 'projekte').glob('*.svg')))
    svg_failures = []
    for path in svg_paths:
        try:
            ElementTree.parse(path)
        except Exception as error:
            svg_failures.append('%s: %s' % (path.relative_to(ROOT), error))
    check(not svg_failures, 'alle Template- und Projekt-SVGs sind valides XML',
          '; '.join(svg_failures))

    py_failures = python_style_failures()
    check(not py_failures, 'Python-Code bleibt rein funktional', '; '.join(py_failures))
    result = subprocess.run(
        [os.environ.get('NODE_BINARY', 'node'), str(ROOT / '_tools' / 'check_js_functional_style.cjs')],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, 'JavaScript-Code bleibt rein funktional',
          result.stderr.strip())
    print('Plant Factory V62.1 release contract passed.')


if __name__ == '__main__':
    main()
