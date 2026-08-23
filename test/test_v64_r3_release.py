#!/usr/bin/env python3
"""Verify the additive Plant Factory V64_r3 release contract (plug-together drawing layer)."""

import ast
import json
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parent.parent
PASSED = 0
DOM_IDS = (
    'plant-drawing-assembly-palette', 'plant-drawing-assembly-count',
    'plant-drawing-import-section', 'plant-drawing-import-select', 'plant-drawing-import-button',
    'plant-drawing-save-assembly', 'plant-drawing-place-in-plant-parts',
    'plant-drawing-linked-toggle', 'plant-drawing-port-toggle', 'plant-drawing-rotate',
    'plant-drawing-group', 'plant-drawing-assembly-demo',
    # inherited r1/r2 contract stays addressable
    'plant-drawing-save-inventory', 'plant-drawing-use-in-plant', 'plant-drawing-demo',
    'plant-drawing-reference-select', 'plant-drawing-canvas', 'plant-drawing-template-palette',
)
DRAWING_TOKENS = (
    'findPlantSnapCandidate', 'createPlantJoints', 'expandPlantSelectionToComponent',
    'instantiateAssemblyTemplate', 'createAssemblyTemplate', 'placeSelectionInPlant',
    'resizePlantEntityByHandle', 'rotatePlantSelection', 'closePlantJoint',
    "'/api/drawing-assemblies'", 'window.__plantFactoryV64R3',
    "patchContract: 'PF-V64-R3-DRAWING-ASSEMBLY'", 'data-handle', 'plant-drawing-port-hint',
    'data-pf-joint-state', 'loadRohrofenAssemblyExample', 'getDrawingInventory',
    'importPlantTemplateIntoDrawing', 'transferAssemblyToPlantInventory',
    # inherited r1 tokens
    'REFERENCE_DIAGRAMS', 'createReferenceModelFromSvg', 'loadReferenceDiagram', 'exportFullSvg',
)
MODEL_TOKENS = (
    'export function createRohrofenAssemblyExample', 'export function createRohrofenPlantExample',
    'export function attachPlantEntityToPort', 'export function plantConnectedComponent',
    'export function findPlantSnapCandidate', 'export function createPlantJoints',
    'export function instantiateAssemblyTemplate', 'export function normalizeAssemblyTemplate',
    "ASSEMBLY_TEMPLATE_SCHEMA = 'plant-factory.plant-drawing-assembly'",
)
SERVER_TOKENS = (
    "'/api/drawing-assemblies'", "'/api/drawing-assemblies/loeschen'",
    'def baugruppe_normalisieren', 'def sichere_baugruppen_id', 'def baugruppe_speichern',
    'def baugruppe_loeschen', "'assemblies'",
)
SCOPED_PREFIXES = (
    '.plant-drawing', '#plant-drawing', ':root[data-theme="dark"] .plant-drawing',
    ':root[data-theme="dark"] #plant-drawing', '[data-theme="dark"] .plant-drawing',
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
    """Return selector lists of the flat stylesheet without at-rule bodies."""
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


def javascript_style_failures(path):
    """Return arrow functions and classes in one JavaScript source file."""
    text = re.sub(r'/\*.*?\*/|//[^\n]*', '', path.read_text(encoding='utf-8'), flags=re.S)
    failures = []
    if '=>' in text:
        failures.append(path.name + ' arrow')
    if re.search(r'(^|\n)\s*class\s+[A-Za-z_$]', text):
        failures.append(path.name + ' class')
    return failures


def main():
    """Execute the complete V64_r3 static contract."""
    package = json.loads(read('package.json'))
    index = read('public/index.html')
    drawing = read('public/js/v64_plant_drawing.js')
    model = read('public/js/v64_plant_drawing_model.js')
    server = read('svg_editor_tool.py')
    css = read('public/css/v64_r3.css')
    test_all = read('test_all.sh')

    check(package.get('version') == '64.0.0', 'Basisversion bleibt 64.0.0')
    check(package.get('releaseRevision') in {'r3', 'r4', 'r5', 'r6'}, 'Paket kennzeichnet Revision r3 oder additive Folgerevision')
    check('test:v64:r3' in package.get('scripts', {}), 'R3-Vertragstest ist registriert')
    check('test:smoke:v64:r3' in package.get('scripts', {}), 'R3-Browsertest ist registriert')
    check(any(('V64_' + rev) in index and ('64_' + rev + ' · V9') in index for rev in ('r3', 'r4', 'r5', 'r6')), 'UI zeigt die R3-Version oder additive Folgerevision')
    check(all(layer in index for layer in ('/public/css/v64.css', '/public/css/v64_r1.css', '/public/css/v64_r2.css')),
          'V64-, R1- und R2-Schichten bleiben erhalten')
    check(index.index('/public/css/v64_r2.css') < index.index('/public/css/v64_r3.css'),
          'R3-CSS ist ausschließlich additiv nach R2 eingebunden')
    for dom_id in DOM_IDS:
        check('id="%s"' % dom_id in index, 'Bedienelement vorhanden: ' + dom_id)
    check('data-inventory-tab="elements"' in index and 'data-inventory-tab="assemblies"' in index,
          'Zeichen-Inventar besitzt getrennte Element- und Baugruppen-Register')
    check('Zeichen-Inventar' in index and 'Anlagen-Inventar' in index,
          'Beide Inventare sind in der Oberfläche benannt')

    for token in DRAWING_TOKENS:
        check(token in drawing, 'Zeicheneditor implementiert: ' + token)
    check("DRAWING_TOOLS = ['select', 'pan', 'connect'" in drawing,
          'Auswahl, Verschieben und Verbinden bleiben getrennte Modi (klassische Verbindung erhalten)')
    check("import { elementManager } from './elements.js'" in drawing
          and "import { connectionManager } from './connection_mapper.js'" in drawing,
          'Übernahme als Einzelobjekte nutzt die bestehenden Anlagen-Manager')
    for token in MODEL_TOKENS:
        check(token in model, 'Zeichenmodell exportiert: ' + token)
    check("PLANT_DRAWING_VERSION = 1" in model and "PLANT_DRAWING_SCHEMA = 'plant-factory.plant-drawing'" in model,
          'Zeichenschema bleibt versionsstabil (additive Felder)')
    for token in SERVER_TOKENS:
        check(token in server, 'Server implementiert: ' + token)
    check('def _ist_bibliotheks_template' in server and "'assemblies'" in server.split('def _ist_bibliotheks_template')[1].split('def ')[0],
          'Baugruppen-Bibliothek bleibt vom SVG-Template-Scan getrennt')

    selectors = css_selectors(css)
    leaking = [selector_list for selector_list in selectors if not all(
        selector.strip().startswith(SCOPED_PREFIXES) for selector in selector_list.split(','))]
    check(not leaking, 'R3-CSS bleibt vollständig auf den Zeicheneditor begrenzt', ', '.join(leaking[:5]))
    for selector in ('.plant-drawing-port-hint', '.plant-drawing-joint-mark', '.plant-drawing-handle',
                     '.plant-drawing-inventory-tabs', '.plant-drawing-assembly-card', '.plant-drawing-marquee'):
        check(selector in css, 'R3-Style vorhanden: ' + selector)

    required_docs = (
        'RELEASE_NOTES_V64_R3_DE.md',
        'DIAGNOSE_UND_RELEASE_V64_R3_DE.md',
        'docs/v64_r3/ARCHITEKTUR_UND_BEDIENUNG.md',
        'docs/v64_r3/TEST_UND_FREIGABE.md',
        'docs/v64_r3/RELEASE_MANIFEST_V64_R3.json',
    )
    missing = [relative for relative in required_docs if not (ROOT / relative).is_file()]
    check(not missing, 'R3-Dokumentation ist vollständig', ', '.join(missing))
    manifest = json.loads(read('docs/v64_r3/RELEASE_MANIFEST_V64_R3.json'))
    check(manifest.get('release') == '64_r3' and manifest.get('patch_contract') == 'PF-V64-R3-DRAWING-ASSEMBLY',
          'Release-Manifest benennt Revision und Vertrag')
    check(any(("default='Automated_SVG_Integration_64_" + rev + "'") in read('_tools/build_release_archive.py') for rev in ('r3', 'r4', 'r5', 'r6')),
          'Archivbau verwendet den R3- oder R4-Wurzelordner')
    check(any(("default='Automated_SVG_Integration_64_" + rev + "'") in read('_tools/verify_release_archive.py') for rev in ('r3', 'r4', 'r5', 'r6')),
          'Archivprüfung erwartet den R3- oder R4-Wurzelordner')
    check(test_all.count('python3 test/test_v64_r3_release.py') == 3,
          'R3-Vertrag liegt an allen drei Freigabegates')
    check('node test/test_v64_r3_model.mjs' in test_all and 'python3 test/test_v64_r3_server.py' in test_all,
          'R3-Modell- und Serververtrag sind Teil der Gesamtkette')
    check('python3 test/smoke_v64_r3.py' in test_all, 'R3-Browserprüfung ist Teil der Gesamtkette')

    style_failures = []
    for name in ('v64_plant_drawing.js', 'v64_plant_drawing_model.js'):
        style_failures.extend(javascript_style_failures(ROOT / 'public' / 'js' / name))
    check(not style_failures, 'R3-JavaScript bleibt rein funktional', ', '.join(style_failures))
    python_failures = []
    for name in ('test_v64_r3_release.py', 'smoke_v64_r3.py', 'test_v64_r3_server.py'):
        python_failures.extend(python_style_failures(ROOT / 'test' / name))
    python_failures.extend(python_style_failures(ROOT / 'svg_editor_tool.py'))
    check(not python_failures, 'R3-Python bleibt rein funktional', ', '.join(python_failures))

    print('V64_r3 release contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()
