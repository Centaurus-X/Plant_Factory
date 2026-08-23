#!/usr/bin/env python3
"""Verify the preserved Plant Factory V61.1 compatibility contract."""

import ast
import json
import os
import subprocess
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_PARTS = {
    '.git',
    '.venv',
    'venv',
    'node_modules',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
}


def check(condition, label, detail=''):
    if not condition:
        suffix = ': %s' % detail if detail else ''
        raise AssertionError(label + suffix)
    print('   ok  %s' % label)


def python_style_failures():
    failures = []
    for path in sorted(ROOT.rglob('*.py')):
        if any(part in EXCLUDED_PARTS or part.startswith('.release_test.') for part in path.parts):
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
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    html = (ROOT / 'public' / 'index.html').read_text(encoding='utf-8')
    registry = (ROOT / 'public' / 'js' / 'registry.js').read_text(encoding='utf-8')
    elements = (ROOT / 'public' / 'js' / 'elements.js').read_text(encoding='utf-8')
    connections = (ROOT / 'public' / 'js' / 'connection_mapper.js').read_text(encoding='utf-8')
    hmi = (ROOT / 'public' / 'js' / 'hmi.js').read_text(encoding='utf-8')
    ui = (ROOT / 'public' / 'js' / 'ui.js').read_text(encoding='utf-8')
    server_config = (ROOT / 'config' / 'server.yaml').read_text(encoding='utf-8')

    current_release = (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
    supported_releases = {'61.1': '61.1.0', '62.1': '62.1.0', '63.1': '63.1.0', '63.2': '63.2.0', '63.3': '63.3.0', '63.4': '63.4.0', '64': '64.0.0'}
    check(current_release in supported_releases,
          'Release ist V61.1 oder eine freigegebene kompatible Nachfolgeversion',
          current_release)
    check(package.get('version') == supported_releases[current_release],
          'package.json entspricht der aktuellen kompatiblen Releasekennung')
    check(current_release + ' · V9' in html,
          'sichtbare kompatible Releasekennung vorhanden')
    check('/public/css/v61.css' in html and '/public/js/v61_ui.js' in html,
          'V61.1 Integrationsschicht wird geladen')
    check(html.index('/public/css/v61.css') > html.index('/public/css/v60.css'),
          'V61.1 CSS überschreibt die V60-Basis kontrolliert')
    check(html.index('id="connections-layer"') < html.index('id="elements-layer"'),
          'Verbindungen liegen hinter den Prozessobjekten')
    check('id="symbol-standard-badge"' in html and 'id="btn-hmi-overlay"' in html,
          'Standardstatus und optionaler HMI-Schalter vorhanden')
    check('host: "127.0.0.1"' in server_config,
          'Server bleibt standardmäßig lokal gebunden')

    required = {
        ROOT / 'config' / 'symbol_standard_v1.json',
        ROOT / 'public' / 'svg_templates' / 'library_manifest_v1.json',
        ROOT / 'public' / 'js' / 'pid_standard.js',
        ROOT / '_tools' / 'build_symbol_standard.py',
        ROOT / 'projekte' / 'designziel_v1_v61_1.json',
        ROOT / 'docs' / 'v61_1' / 'OBJEKTSTANDARD_PF_PID_V1.md',
        ROOT / 'docs' / 'v61_1' / 'MIGRATION_UND_KOMPATIBILITAET.md',
        ROOT / 'docs' / 'v61_1' / 'TEST_UND_FREIGABE.md',
        ROOT / 'docs' / 'v61_1' / 'RUNTIME_V0101_KOMPATIBILITAET.md',
        ROOT / 'docs' / 'v61_1' / 'RELEASE_MANIFEST_V61_1.json',
        ROOT / '#_Documentation' / 'Documentation.md',
        ROOT / 'release_evidence' / 'v61_1_pid_light.png',
        ROOT / 'release_evidence' / 'v61_1_pid_dark.png',
        ROOT / 'release_evidence' / 'v61_1_hmi_optional.png',
        ROOT / 'release_evidence' / 'v61_1_responsive.png',
        ROOT / 'RELEASE_NOTES_V61_1_DE.md',
    }
    missing = sorted(str(path.relative_to(ROOT)) for path in required if not path.is_file())
    check(not missing, 'V61.1 Standard-, Demo- und Dokumentationsdateien vollständig', ', '.join(missing))

    release_manifest = json.loads(
        (ROOT / 'docs' / 'v61_1' / 'RELEASE_MANIFEST_V61_1.json').read_text(encoding='utf-8')
    )
    check(release_manifest.get('status') == 'passed',
          'maschinenlesbares Release-Manifest ist freigegeben')
    standard_manifest = release_manifest.get('object_standard', {})
    check(standard_manifest.get('id') == 'PF-PID-V1'
          and standard_manifest.get('canonical_template_count') == 25,
          'Release-Manifest fixiert PF-PID-V1 und 25 Standardtemplates')
    hmi_policy = release_manifest.get('hmi_policy', {})
    check(hmi_policy.get('auto_create_widgets') is False
          and hmi_policy.get('button_policy') == 'optional_explicit_only',
          'Release-Manifest fixiert die explizite HMI-/Button-Policy')
    verification = release_manifest.get('verification', {})
    browser_result = verification.get('chromium_browser_smoke', {})
    runtime_result = verification.get('rule_contract_external_runtime', {})
    check(browser_result == {'passed': 119, 'total': 119}
          and runtime_result == {'passed': 29, 'total': 29},
          'Release-Manifest enthält Browser- und Runtime-Freigabeergebnis')

    check("TEMPLATE_SCOPE_STANDARD" in registry and "currentScope = TEMPLATE_SCOPE_STANDARD" in registry,
          'P&ID-V1-Bibliothek ist der Standardscope')
    check("state.emit('hmi:auto-widget-skipped'" in elements,
          'Objektdrop dokumentiert unterdrückte HMI-Autoerzeugung')
    check("data-runtime-state" in elements and "element-port-layer" in elements,
          'Entity-Zustände und semantische Ports werden gerendert')
    check('choosePortPair' in connections and 'portsCompatible' in connections,
          'Connection-Mapper nutzt semantische Portvalidierung')
    check("reason: 'incompatible_ports'" in connections
          and "reason: 'incompatible_endpoints'" in connections,
          'inkompatible Typ- und Endpunktänderungen werden abgelehnt')
    check('ports_custom: true' in elements,
          'benutzerdefinierte Portänderungen bleiben persistent')
    check("enabled: false" in hmi and "origin: 'explicit'" in hmi,
          'HMI-Overlay und Widgets sind standardmäßig explizit')
    check('Auto-Binding, wenn im Canvas etwas selektiert ist' not in hmi,
          'kein automatisches HMI-Binding beim Widget-Anlegen')
    check('normalizeProjectModel' in ui and 'PID_STANDARD_ID' in ui,
          'Projektladen und -speichern normalisieren den Objektstandard')
    pid_standard = (ROOT / 'public' / 'js' / 'pid_standard.js').read_text(encoding='utf-8')
    check('RUNTIME_STATES' in pid_standard and 'TAG_PATTERN' in pid_standard,
          'TAG- und Laufzeitzustandsvertrag ist ausführbar')
    check('manual_anchor_override' in pid_standard and 'geometry_custom' in pid_standard,
          'feste Anker und Sondergeometrie bleiben kontrollierte Ausnahmen')

    manager_source = (ROOT / 'svg_editor_tool.py').read_text(encoding='utf-8')
    check("'manifest': manager.get('manifest', {})" in manager_source,
          'Template-API liefert das Bibliotheksmanifest')
    check("'object_standard': {" in manager_source and "'release': '61.1'" in manager_source,
          'Template-API liefert den V61.1 Objektstandard')

    svg_paths = sorted((ROOT / 'public' / 'svg_templates').glob('*.svg'))
    svg_paths.extend(sorted((ROOT / 'projekte').glob('*.svg')))
    failures = []
    for path in svg_paths:
        try:
            ElementTree.parse(path)
        except Exception as error:
            failures.append('%s: %s' % (path.relative_to(ROOT), error))
    check(not failures, 'alle Template- und Projekt-SVGs sind valides XML', '; '.join(failures))

    py_failures = python_style_failures()
    check(not py_failures, 'Python-Code bleibt rein funktional', '; '.join(py_failures))
    result = subprocess.run(
        [os.environ.get('NODE_BINARY', 'node'), str(ROOT / '_tools' / 'check_js_functional_style.cjs')],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, 'JavaScript-Code bleibt rein funktional', result.stderr.strip())
    print('Plant Factory V61.1 compatibility contract passed.')


if __name__ == '__main__':
    main()
