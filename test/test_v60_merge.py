#!/usr/bin/env python3
"""Verify the merged V60.1 release contract and cross-version invariants."""

import ast
import json
import os
import subprocess
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parent.parent


def check(condition, label, detail=''):
    if not condition:
        suffix = ': %s' % detail if detail else ''
        raise AssertionError(label + suffix)
    print('   ok  %s' % label)


def parse_all_svg_files():
    failures = []
    paths = sorted((ROOT / 'projekte').rglob('*.svg'))
    paths.extend(sorted((ROOT / 'public' / 'svg_templates').rglob('*.svg')))
    for path in paths:
        try:
            ElementTree.parse(path)
        except Exception as exc:
            failures.append('%s: %s' % (path.relative_to(ROOT), exc))
    return paths, failures


def verify_python_ast():
    failures = []
    for path in sorted(ROOT.rglob('*.py')):
        if any(part in {'.git', '.venv', 'venv', 'node_modules', '__pycache__'} for part in path.parts):
            continue
        tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                failures.append('%s:%s class %s' % (path.relative_to(ROOT), node.lineno, node.name))
            elif isinstance(node, ast.Lambda):
                failures.append('%s:%s lambda' % (path.relative_to(ROOT), node.lineno))
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.decorator_list:
                failures.append('%s:%s decorator' % (path.relative_to(ROOT), node.lineno))
    return failures


def main():
    version = (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    html = (ROOT / 'public' / 'index.html').read_text(encoding='utf-8')
    server_config = (ROOT / 'config' / 'server.yaml').read_text(encoding='utf-8')

    supported = {'60.1': '60.1.0', '63.4': '63.4.0', '64': '64.0.0'}
    check(version in supported, 'Releasekennung ist V60.1 oder kompatibler Nachfolger', version)
    check(package.get('version') == supported[version],
          'package.json entspricht der kompatiblen Releasekennung', package.get('version'))
    check((version + ' · V9') in html, 'sichtbare kompatible Releasekennung vorhanden')
    check('/public/css/v60.css' in html and '/public/js/v60_ui.js' in html,
          'V60.1 Merge-Schicht wird geladen')
    check('host: "127.0.0.1"' in server_config,
          'Server bleibt standardmäßig lokal gebunden')

    required_ids = {
        'canvas-minimap-svg',
        'inspector-apply',
        'modal-shortcuts',
        'palette-toggle',
    }
    missing_ids = sorted(item for item in required_ids if ('id="%s"' % item) not in html)
    registry_source = (ROOT / 'public' / 'js' / 'registry.js').read_text(encoding='utf-8')
    inspector_source = (ROOT / 'public' / 'js' / 'ui.js').read_text(encoding='utf-8')
    feature_contracts = {
        'Favoritenbibliothek': 'template-kategorie--favorites' in registry_source,
        'strukturierte Bindungsanzeige': 'v1-binding-card' in inspector_source,
        'Tastaturaktivierung von Templates': 'template:activate' in registry_source,
    }
    missing_features = sorted(name for name, present in feature_contracts.items() if not present)
    check(not missing_ids and not missing_features,
          'zusammengeführte UI-Funktionen vollständig',
          ', '.join(missing_ids + missing_features))

    svg_paths, svg_failures = parse_all_svg_files()
    check(not svg_failures, 'alle Projekt- und Template-SVGs sind valides XML', '; '.join(svg_failures))
    check(len(svg_paths) >= 70, 'vollständiger SVG-Bestand enthalten', str(len(svg_paths)))

    python_failures = verify_python_ast()
    check(not python_failures, 'Python-Code rein funktional', '; '.join(python_failures))

    result = subprocess.run(
        [os.environ.get('NODE_BINARY', 'node'), str(ROOT / '_tools' / 'check_js_functional_style.cjs')],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, 'JavaScript-Code rein funktional', result.stderr.strip())

    master = json.loads((ROOT / 'config' / 'device_state_data_v9.json').read_text(encoding='utf-8'))
    check(master.get('meta', [{}])[0].get('version') == 9,
          'kanonische Konfiguration verwendet Vertrag V9')
    check(len(master.get('controllers', [])) == 5,
          'fünf Controller aus der Runtime-Baseline enthalten')


if __name__ == '__main__':
    main()
