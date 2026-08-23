#!/usr/bin/env python3
"""Verify the additive Plant Factory V64_r4 release contract (drawing geometry, inspector, navigation)."""

import ast
import json
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parent.parent
PASSED = 0
DOM_IDS = (
    'plant-drawing-sheet-frame', 'plant-drawing-r4-demo',
    # inherited r3 contract stays addressable
    'plant-drawing-assembly-palette', 'plant-drawing-save-assembly', 'plant-drawing-place-in-plant-parts',
    'plant-drawing-linked-toggle', 'plant-drawing-port-toggle', 'plant-drawing-rotate', 'plant-drawing-group',
    'plant-drawing-assembly-demo', 'plant-drawing-demo', 'plant-drawing-canvas', 'plant-drawing-template-palette',
    'plant-drawing-save-inventory', 'plant-drawing-use-in-plant',
)
DRAWING_TOKENS = (
    'appendStretchedGraphic', 'decorateTemplateClone', 'entityGraphicTransform', 'renderInspectorTabs',
    'renderEntityPartTab', 'renderEntityPortsTab', 'renderEntityPropertiesTab', 'renderSheetTab',
    'openContextMenu', 'contextMenuItems', 'onContextMenu', 'startCtrlGesture', 'finishCtrlGesture',
    'flipSelection', 'invertSelection', 'setScaleModeForSelection', 'fitSheetNow', 'reorderSelection',
    'revealCustomTemplateInPlantLibrary', 'insertCustomTemplateInPlant', 'resetView', 'viewScale',
    'window.__plantFactoryV64R4', "patchContract: 'PF-V64-R4-DRAWING-GEOMETRY'",
    'data-pf-stretch-segment', 'data-pf-role="flow-arrow"', 'data-pf-role="entity-label"', 'loadRohrofenR4Example',
    # inherited r3 tokens
    'findPlantSnapCandidate', 'createPlantJoints', 'expandPlantSelectionToComponent', 'placeSelectionInPlant',
    "'/api/drawing-assemblies'", 'window.__plantFactoryV64R3', 'REFERENCE_DIAGRAMS', 'exportFullSvg',
)
MODEL_TOKENS = (
    'export function normalizeStretchProfile', 'export function plantStretchMap',
    'export function plantEntityPortLocalPoint', 'export function refreshPlantEntityPorts',
    'export function flipPlantEntity', 'export function invertPlantEntity', 'export function setPlantEntityScaleMode',
    'export function plantContentBounds', 'export function fitPlantSheetToContent',
    'export function createRohrofenR4Example', "export const SCALE_MODES = ['uniform', 'stretch', 'free']",
    # inherited
    'export function createRohrofenAssemblyExample', 'export function createRohrofenPlantExample',
    'export function findPlantSnapCandidate', 'export function instantiateAssemblyTemplate',
)
SERVER_TOKENS = (
    "'stretch': stretch,", 'def _baugruppen_stretch', 'def _baugruppen_view_box', "ASSEMBLY_SCALE_MODES",
    "'flip_x': bool(source.get('flip_x'))", "'inverted': bool(source.get('inverted'))",
    "'/api/drawing-assemblies'", 'def baugruppe_normalisieren',
)
R4_TEMPLATES = ('Swagelok_union', 'Swagelok_tee', 'Swagelok_elbow', 'Capillary_line',
                'Pipe_cap', 'Boundary_connector', 'Gas_mixer')
STRETCH_TEMPLATES = ('Pipe_straight', 'Pipe_tee', 'Capillary_line', 'Jacked_pipeline')
SCOPED_PREFIXES = (
    '.plant-drawing', '#plant-drawing', ':root[data-theme="dark"] .plant-drawing',
    ':root[data-theme="dark"] #plant-drawing', '[data-theme="dark"] .plant-drawing',
    '#template-palette .template-item.is-drawing-highlight',
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
    """Execute the complete V64_r4 static contract."""
    package = json.loads(read('package.json'))
    index = read('public/index.html')
    drawing = read('public/js/v64_plant_drawing.js')
    model = read('public/js/v64_plant_drawing_model.js')
    server = read('svg_editor_tool.py')
    css = read('public/css/v64_r4.css')
    test_all = read('test_all.sh')
    manifest = json.loads(read('public/svg_templates/library_manifest_v1.json'))

    check(package.get('version') == '64.0.0', 'Basisversion bleibt 64.0.0')
    check(package.get('releaseRevision') in {'r4', 'r5', 'r6'}, 'Paket kennzeichnet Revision r4 oder additive Folgerevision')
    check('test:v64:r4' in package.get('scripts', {}) and 'test:smoke:v64:r4' in package.get('scripts', {}),
          'R4-Vertrags- und Browsertests sind registriert')
    check('node test/test_v64_r4_model.mjs' in package['scripts']['test'], 'npm test führt den R4-Modellvertrag aus')
    check(any(('V64_' + rev) in index and ('64_' + rev + ' · V9') in index for rev in ('r4', 'r5', 'r6')), 'UI zeigt die R4-Version oder additive Folgerevision')
    check(all(layer in index for layer in ('/public/css/v64.css', '/public/css/v64_r1.css', '/public/css/v64_r2.css', '/public/css/v64_r3.css')),
          'V64-, R1-, R2- und R3-Schichten bleiben erhalten')
    check(index.index('/public/css/v64_r3.css') < index.index('/public/css/v64_r4.css'),
          'R4-CSS ist ausschließlich additiv nach R3 eingebunden')
    for dom_id in DOM_IDS:
        check('id="%s"' % dom_id in index, 'Bedienelement vorhanden: ' + dom_id)
    check('Strg + Ziehen' in index and 'Rechtsklick' in index, 'Leerer Zustand erklärt Kontextmenü und Strg-Navigation')

    for token in DRAWING_TOKENS:
        check(token in drawing, 'Zeicheneditor implementiert: ' + token)
    check("DRAWING_TOOLS = ['select', 'pan', 'connect'" in drawing,
          'Auswahl, Verschieben und Verbinden bleiben getrennte Modi (klassische Verbindung erhalten)')
    check("INSPECTOR_TABS = ['part', 'ports', 'properties', 'sheet']" in drawing, 'Inspektor besitzt vier Register')
    check("canvas.addEventListener('contextmenu', onContextMenu)" in drawing, 'Kontextmenü ist an die Zeichenfläche gebunden')
    check("!getActivePlantSheet(model).reference" in drawing, 'Referenzimporte werden nie automatisch verschoben')
    for token in MODEL_TOKENS:
        check(token in model, 'Zeichenmodell exportiert: ' + token)
    check("PLANT_DRAWING_VERSION = 1" in model and "PLANT_DRAWING_SCHEMA = 'plant-factory.plant-drawing'" in model,
          'Zeichenschema bleibt versionsstabil (additive Felder)')
    for token in SERVER_TOKENS:
        check(token in server, 'Server implementiert: ' + token)

    templates = manifest.get('templates', {})
    check(manifest.get('template_count') == len(templates) and len(templates) >= 42, 'Symbolmanifest enthält deterministisch mindestens 42 Templates')
    for template_id in R4_TEMPLATES:
        metadata = templates.get(template_id)
        check(bool(metadata) and metadata.get('standard') == 'PF-PID-V1' and bool(metadata.get('ports')),
              'Neues PF-PID-V1-Bauteil mit Ports: ' + template_id)
        svg_path = ROOT / 'public' / 'svg_templates' / metadata['file']
        check(svg_path.is_file() and 'data-pf-state-target' in svg_path.read_text(encoding='utf-8'),
              'SVG mit Animationszielen vorhanden: ' + template_id)
    for template_id in STRETCH_TEMPLATES:
        stretch = templates[template_id].get('stretch')
        check(bool(stretch) and stretch.get('axis') == 'x' and len(stretch.get('fixed', [])) >= 3,
              'Streckprofil im Manifest: ' + template_id)
    check('data-pf-role="flow-arrow"' in read('public/svg_templates/Pipe_elbow_90.svg'), 'Rohrbogen markiert den Flusspfeil')
    check('data-pf-role="entity-label"' in read('public/svg_templates/Boundary_connector.svg'), 'Grenzstelle trägt ein Beschriftungsziel')
    check('M77 23 V60' not in read('public/svg_templates/Pipe_tee.svg'), 'T-Stück wurde bereinigt')
    check('def build_v64_r4_definitions' in read('_tools/build_symbol_standard.py')
          and 'def stretch_profile' in read('_tools/build_symbol_standard.py'),
          'Symbolbibliothek wird deterministisch mit R4-Definitionen gebaut')

    selectors = css_selectors(css)
    leaking = [selector_list for selector_list in selectors if not all(
        selector.strip().startswith(SCOPED_PREFIXES) for selector in selector_list.split(','))]
    check(not leaking, 'R4-CSS bleibt auf den Zeicheneditor begrenzt', ', '.join(leaking[:5]))
    for selector in ('.plant-drawing-sheet-frame', '.plant-drawing-inspector-tabs', '.plant-drawing-context-menu',
                     '.plant-drawing-port-table', '.plant-drawing-property-row', '.plant-drawing-checkbox'):
        check(selector in css, 'R4-Style vorhanden: ' + selector)

    required_docs = (
        'RELEASE_NOTES_V64_R4_DE.md',
        'DIAGNOSE_UND_RELEASE_V64_R4_DE.md',
        'docs/v64_r4/ARCHITEKTUR_UND_BEDIENUNG.md',
        'docs/v64_r4/TEST_UND_FREIGABE.md',
        'docs/v64_r4/RELEASE_MANIFEST_V64_R4.json',
    )
    missing = [relative for relative in required_docs if not (ROOT / relative).is_file()]
    check(not missing, 'R4-Dokumentation ist vollständig', ', '.join(missing))
    release_manifest = json.loads(read('docs/v64_r4/RELEASE_MANIFEST_V64_R4.json'))
    check(release_manifest.get('release') == '64_r4' and release_manifest.get('patch_contract') == 'PF-V64-R4-DRAWING-GEOMETRY',
          'Release-Manifest benennt Revision und Vertrag')
    check(release_manifest.get('symbol_library', {}).get('template_count') == 42, 'Release-Manifest kennt 42 Templates')
    check(any(("default='Automated_SVG_Integration_64_" + rev + "'") in read('_tools/build_release_archive.py') for rev in ('r4', 'r5', 'r6')),
          'Archivbau verwendet den R4- oder R5-Wurzelordner')
    check(any(("default='Automated_SVG_Integration_64_" + rev + "'") in read('_tools/verify_release_archive.py') for rev in ('r4', 'r5', 'r6')),
          'Archivprüfung erwartet den R4- oder R5-Wurzelordner')
    check(test_all.count('python3 test/test_v64_r4_release.py') == 3, 'R4-Vertrag liegt an allen drei Freigabegates')
    check('node test/test_v64_r4_model.mjs' in test_all and 'python3 test/test_v64_r4_server.py' in test_all,
          'R4-Modell- und Serververtrag sind Teil der Gesamtkette')
    check('python3 test/smoke_v64_r4.py' in test_all, 'R4-Browserprüfung ist Teil der Gesamtkette')
    check('ALL V64_R4 RELEASE CHECKS PASSED' in test_all or 'ALL V64_R5 RELEASE CHECKS PASSED' in test_all or 'ALL V64_R6 RELEASE CHECKS PASSED' in test_all, 'Gesamtkette meldet die R4-Freigabe oder additive Folgerevision')

    style_failures = []
    for name in ('v64_plant_drawing.js', 'v64_plant_drawing_model.js'):
        style_failures.extend(javascript_style_failures(ROOT / 'public' / 'js' / name))
    check(not style_failures, 'R4-JavaScript bleibt rein funktional', ', '.join(style_failures))
    python_failures = []
    for name in ('test_v64_r4_release.py', 'smoke_v64_r4.py', 'test_v64_r4_server.py'):
        python_failures.extend(python_style_failures(ROOT / 'test' / name))
    python_failures.extend(python_style_failures(ROOT / 'svg_editor_tool.py'))
    python_failures.extend(python_style_failures(ROOT / '_tools' / 'build_symbol_standard.py'))
    check(not python_failures, 'R4-Python bleibt rein funktional', ', '.join(python_failures))

    print('V64_r4 release contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()
