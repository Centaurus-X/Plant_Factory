#!/usr/bin/env python3
"""Verify the additive Plant Factory V64_r5 release contract (classic optical
variant, layers, visual states, routed lines, regions, dimensions, frame)."""

import ast
import json
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parent.parent
PASSED = 0
DOM_IDS = (
    'plant-drawing-classic-demo', 'plant-drawing-classic-template-demo', 'plant-drawing-animation-toggle',
    'plant-drawing-structure-count',
    # inherited r3/r4 contract stays addressable
    'plant-drawing-sheet-frame', 'plant-drawing-r4-demo', 'plant-drawing-assembly-palette',
    'plant-drawing-save-assembly', 'plant-drawing-place-in-plant-parts', 'plant-drawing-linked-toggle',
    'plant-drawing-port-toggle', 'plant-drawing-rotate', 'plant-drawing-group', 'plant-drawing-assembly-demo',
    'plant-drawing-demo', 'plant-drawing-canvas', 'plant-drawing-template-palette',
    'plant-drawing-save-inventory', 'plant-drawing-use-in-plant',
)
DOM_ATTRIBUTES = (
    'data-drawing-layer="process"', 'data-drawing-layer="structure"', 'data-drawing-layer="annotation"',
    'data-drawing-tool="polyline"', 'data-drawing-tool="region"', 'data-drawing-tool="dimension"',
    'data-inventory-tab="structure"', 'data-inventory-tab="elements"', 'data-inventory-tab="assemblies"',
)
DRAWING_TOKENS = (
    'renderPolyline', 'renderRegion', 'renderDimension', 'layerVisible', 'connectionVisible', 'layerOrderedEntities',
    'applyAnimationState', 'renderRoutedPrimitiveInspector', 'updatePrimitive', 'templateLayer', 'structureTemplates',
    'addPolylinePoint', 'finishPolyline', 'setVisualStateForSelection', 'cycleVisualStateOfSelection',
    'selectionWithoutLayer', 'applyLabelRole', 'tagParts', 'entityProperty', 'loadClassicReactorExample',
    'loadClassicTemplateExample', 'replaceWithClassicReactorExample', 'replaceWithClassicTemplateExample',
    'window.__plantFactoryV64R5', "patchContract: 'PF-V64-R5-CLASSIC-DRAWING'",
    "inheritedPatchContract: 'PF-V64-R4-DRAWING-GEOMETRY'", "'data-pf-source': 'plant-drawing-v64-r6'",
    'canvas.pauseAnimations', 'drawing-sheet-margin',
    # inherited r4/r3 tokens
    'appendStretchedGraphic', 'renderInspectorTabs', 'openContextMenu', 'startCtrlGesture', 'flipSelection',
    'invertSelection', 'fitSheetNow', 'window.__plantFactoryV64R4', 'window.__plantFactoryV64R3',
    'findPlantSnapCandidate', 'createPlantJoints', 'placeSelectionInPlant', 'exportFullSvg',
)
MODEL_TOKENS = (
    "export const DRAWING_LAYERS = ['process', 'structure', 'annotation']",
    "export const LINE_STYLES = ['plain', 'pipe', 'capillary', 'hot', 'cold', 'coolant', 'purge', 'feed', 'signal']",
    "export const LABEL_POSITIONS = ['inside', 'above']", 'export const LINE_STYLE_PRESETS',
    'export function normalizePlantPoints', 'export function translatePlantPrimitive',
    'export function setPlantEntityVisualState', 'export function setPlantEntityLayer', 'export function lineStylePreset',
    'export function createClassicReactorExample', 'export function createClassicTemplateExample',
    'margin: Math.max(0, finiteNumber(item.margin, DEFAULT_SHEET_MARGIN))',
    # inherited
    'export function fitPlantSheetToContent', 'export function createRohrofenR4Example',
    'export function createRohrofenAssemblyExample', 'export function findPlantSnapCandidate',
)
SERVER_TOKENS = (
    "ASSEMBLY_CONNECTION_KINDS = ('process', 'utility', 'signal', 'power', 'structure')",
    "ASSEMBLY_PRIMITIVE_TYPES = ('line', 'rect', 'ellipse', 'text', 'polyline', 'region', 'dimension')",
    "ASSEMBLY_LAYERS = ('process', 'structure', 'annotation')", 'ASSEMBLY_LINE_STYLES', 'ASSEMBLY_LABEL_POSITIONS',
    'MAX_PRIMITIVE_POINTS', 'def _baugruppen_punkte', "'visual_state': _text_feld(source.get('visual_state'), '', 40)",
    "'visual_states': [str(state) for state in visual_states[:16]]", "'default_visual_state'",
    # inherited
    'def _baugruppen_stretch', 'def baugruppe_normalisieren', "'/api/drawing-assemblies'",
)
CLASSIC_TEMPLATES = (
    'Classic_tube', 'Classic_tube_flanged', 'Classic_tube_tap', 'Classic_flange', 'Classic_flange_bolted',
    'Classic_tube_elbow', 'Classic_tube_ubend', 'Classic_tube_head', 'Classic_capillary', 'Classic_capillary_elbow',
    'Classic_swagelok', 'Classic_line', 'Classic_valve', 'Classic_control_valve', 'Classic_check_valve',
    'Classic_flag', 'Classic_flag_back', 'Classic_instrument', 'Classic_furnace', 'Classic_cooler',
    'Classic_column', 'Classic_coil_circle', 'Classic_mixer_box', 'Classic_cylinder',
)
FRAME_TEMPLATES = ('Frame_post', 'Frame_beam', 'Frame_foot', 'Frame_clamp', 'Frame_floor')
R4_TEMPLATES = ('Swagelok_union', 'Swagelok_tee', 'Swagelok_elbow', 'Capillary_line', 'Pipe_cap', 'Boundary_connector', 'Gas_mixer')
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
    """Execute the complete V64_r5 static contract."""
    package = json.loads(read('package.json'))
    index = read('public/index.html')
    drawing = read('public/js/v64_plant_drawing.js')
    model = read('public/js/v64_plant_drawing_model.js')
    server = read('svg_editor_tool.py')
    css = read('public/css/v64_r5.css')
    test_all = read('test_all.sh')
    manifest = json.loads(read('public/svg_templates/library_manifest_v1.json'))
    builder = read('_tools/build_symbol_standard.py')

    check(package.get('version') == '64.0.0', 'Basisversion bleibt 64.0.0')
    check(package.get('releaseRevision') in {'r5', 'r6'}, 'Paket kennzeichnet Revision r5 oder additive r6')
    check('test:v64:r5' in package.get('scripts', {}) and 'test:smoke:v64:r5' in package.get('scripts', {}),
          'R5-Vertrags- und Browsertests sind registriert')
    check('node test/test_v64_r5_model.mjs' in package['scripts']['test'] and 'node test/test_v64_r4_model.mjs' in package['scripts']['test'],
          'npm test führt den R5- und den R4-Modellvertrag aus')
    check(('V64_r5' in index and '64_r5 · V9' in index) or ('V64_r6' in index and '64_r6 · V9' in index), 'UI zeigt R5 oder additive R6')
    check(all(layer in index for layer in ('/public/css/v64.css', '/public/css/v64_r1.css', '/public/css/v64_r2.css',
                                           '/public/css/v64_r3.css', '/public/css/v64_r4.css')),
          'V64-, R1-, R2-, R3- und R4-Schichten bleiben erhalten')
    check(index.index('/public/css/v64_r4.css') < index.index('/public/css/v64_r5.css'),
          'R5-CSS ist ausschließlich additiv nach R4 eingebunden')
    for dom_id in DOM_IDS:
        check('id="%s"' % dom_id in index, 'Bedienelement vorhanden: ' + dom_id)
    for attribute in DOM_ATTRIBUTES:
        check(attribute in index, 'Bedienmerkmal vorhanden: ' + attribute)
    check('Klassik: Reaktor-P&amp;ID laden' in index and 'Klassik: Symbolvariante laden' in index,
          'Beide Referenzbilder sind als Beispiele ladbar')

    for token in DRAWING_TOKENS:
        check(token in drawing, 'Zeicheneditor implementiert: ' + token)
    check("DRAWING_TOOLS = ['select', 'pan', 'connect', 'line', 'rect', 'ellipse', 'text', 'place', 'polyline', 'region', 'dimension']" in drawing,
          'Werkzeugliste ist additiv um Leitung, Bereich und Bemaßung erweitert')
    check("INSPECTOR_TABS = ['part', 'ports', 'properties', 'sheet']" in drawing, 'Inspektor behält seine vier Register')
    check("!getActivePlantSheet(model).reference" in drawing, 'Referenzimporte werden weiterhin nie automatisch verschoben')
    check('fitPlantSheetToContent(model, {})' in drawing, 'Automatisches Wachsen nutzt den Blattrand des Blatts')
    for token in MODEL_TOKENS:
        check(token in model, 'Zeichenmodell exportiert: ' + token)
    check("PLANT_DRAWING_VERSION = 1" in model and "PLANT_DRAWING_SCHEMA = 'plant-factory.plant-drawing'" in model,
          'Zeichenschema bleibt versionsstabil (additive Felder)')
    check('sheet.margin = 4;' in model and 'sheet.width = 1300;' in model and 'sheet.width = 1150;' in model,
          'Beide Referenzbeispiele liegen auf Blättern mit Referenzmaß und Referenzrand')
    for token in SERVER_TOKENS:
        check(token in server, 'Server implementiert: ' + token)

    templates = manifest.get('templates', {})
    check(manifest.get('template_count') == len(templates) == 71, 'Symbolmanifest enthält deterministisch 71 Templates', str(len(templates)))
    for template_id in CLASSIC_TEMPLATES:
        metadata = templates.get(template_id)
        check(bool(metadata) and metadata.get('style') == 'classic' and bool(metadata.get('visual_states'))
              and metadata.get('layer') == 'process' and bool(metadata.get('ports')),
              'Klassik-Bauteil mit Zuständen und Ports: ' + template_id)
        svg_path = ROOT / 'public' / 'svg_templates' / metadata['file']
        svg = svg_path.read_text(encoding='utf-8')
        check(svg_path.is_file() and 'class="pf-pid-v1"' in svg and '.pf-pid-v1 .pc-' in svg,
              'Klassik-SVG mit gekapseltem Stylesheet vorhanden: ' + template_id)
    for template_id in FRAME_TEMPLATES:
        metadata = templates.get(template_id)
        check(bool(metadata) and metadata.get('layer') == 'structure'
              and all(port.get('kind') == 'structure' for port in metadata.get('ports', [])),
              'Gestellteil auf der Gestellebene: ' + template_id)
    for template_id in R4_TEMPLATES:
        check(templates.get(template_id, {}).get('standard') == 'PF-PID-V1', 'R4-Bauteil bleibt erhalten: ' + template_id)
    check(templates['Pipe_straight'].get('style') in (None, 'standard') and not templates['Pipe_straight'].get('visual_states')
          and not templates['Pipe_straight'].get('layer'), 'Standard-Symbole bleiben unverändert (keine Klassik-Metadaten)')
    tube_svg = read('public/svg_templates/Classic_tube.svg')
    check('<animate attributeName="stroke-dashoffset" values="0;-20" dur="0.5s" repeatCount="indefinite"/>' in tube_svg,
          'Laufstriche sind SMIL-animiert wie im Referenzbild')
    check('[data-pf-visual-state="hot"] .pf-pid-v1 .pc-state{fill:#ee1c24}' in tube_svg
          and '[data-pf-visual-state="cold"] .pf-pid-v1 .pc-state{fill:#1e9be8}' in tube_svg
          and '[data-pf-visual-state="open"] .pf-pid-v1 .pc-valve{fill:#2db34a}' in tube_svg
          and '[data-pf-visual-state="closed"] .pf-pid-v1 .pc-valve{fill:#ee1c24}' in tube_svg,
          'Zustandsfarben: Ofen rot, Kühler blau, Ventil grün/rot')
    check(templates['Classic_tube_tap']['ports'][2]['id'] == 'tap_a' and templates['Classic_tube_tap']['ports'][3]['id'] == 'tap_b',
          'Rohrstück mit Seitenanschluss trägt beide Wandanschlüsse')
    check('def build_v64_r5_definitions' in builder and 'def classic_definition' in builder and "'Classic_tube_tap'" in builder,
          'Symbolbibliothek wird deterministisch mit R5-Definitionen gebaut')

    selectors = css_selectors(css)
    leaking = [selector_list for selector_list in selectors if not all(
        selector.strip().startswith(SCOPED_PREFIXES) for selector in selector_list.split(','))]
    check(not leaking, 'R5-CSS bleibt auf den Zeicheneditor begrenzt', ', '.join(leaking[:5]))
    for selector in ('.plant-drawing-layer-toggle', '.plant-drawing-polyline', '.plant-drawing-region',
                     '.plant-drawing-dimension', '.plant-drawing-draft-point', '#plant-drawing-animation-toggle'):
        check(selector in css, 'R5-Style vorhanden: ' + selector)

    required_docs = (
        'RELEASE_NOTES_V64_R5_DE.md',
        'DIAGNOSE_UND_RELEASE_V64_R5_DE.md',
        'docs/v64_r5/ARCHITEKTUR_UND_BEDIENUNG.md',
        'docs/v64_r5/TEST_UND_FREIGABE.md',
        'docs/v64_r5/RELEASE_MANIFEST_V64_R5.json',
        'release_evidence/V64_r5_01_Classic_Reactor_Light.png',
        'release_evidence/V64_r5_02_Classic_Reactor_Frame.png',
        'release_evidence/V64_r5_03_Classic_Template_Light.png',
        'release_evidence/V64_r5_04_Classic_Template_Dark.png',
    )
    missing = [relative for relative in required_docs if not (ROOT / relative).is_file()]
    check(not missing, 'R5-Dokumentation und Nachweise sind vollständig', ', '.join(missing))
    release_manifest = json.loads(read('docs/v64_r5/RELEASE_MANIFEST_V64_R5.json'))
    check(release_manifest.get('release') == '64_r5' and release_manifest.get('patch_contract') == 'PF-V64-R5-CLASSIC-DRAWING',
          'Release-Manifest benennt Revision und Vertrag')
    check(release_manifest.get('symbol_library', {}).get('template_count') == 71, 'Release-Manifest kennt 71 Templates')
    check('V64_r5' in read('release_evidence/README.md'), 'Nachweis-README beschreibt die R5-Aufnahmen')
    check('V64_r5' in read('README.md'), 'README nennt die R5-Revision')
    check(any(("default='Automated_SVG_Integration_64_" + rev + "'") in read('_tools/build_release_archive.py') for rev in ('r5', 'r6')),
          'Archivbau verwendet den R5- oder R6-Wurzelordner')
    check(any(("default='Automated_SVG_Integration_64_" + rev + "'") in read('_tools/verify_release_archive.py') for rev in ('r5', 'r6')),
          'Archivprüfung erwartet den R5- oder R6-Wurzelordner')
    check(test_all.count('python3 test/test_v64_r5_release.py') == 3, 'R5-Vertrag liegt an allen drei Freigabegates')
    check('node test/test_v64_r5_model.mjs' in test_all and 'python3 test/test_v64_r5_server.py' in test_all,
          'R5-Modell- und Serververtrag sind Teil der Gesamtkette')
    check('python3 test/smoke_v64_r5.py' in test_all and 'python3 test/smoke_v64_r4.py' in test_all,
          'R5- und R4-Browserprüfungen sind Teil der Gesamtkette')
    check('ALL V64_R5 RELEASE CHECKS PASSED' in test_all or 'ALL V64_R6 RELEASE CHECKS PASSED' in test_all, 'Gesamtkette meldet die R5- oder R6-Freigabe')

    style_failures = []
    for name in ('v64_plant_drawing.js', 'v64_plant_drawing_model.js'):
        style_failures.extend(javascript_style_failures(ROOT / 'public' / 'js' / name))
    check(not style_failures, 'R5-JavaScript bleibt rein funktional', ', '.join(style_failures))
    python_failures = []
    for name in ('test_v64_r5_release.py', 'smoke_v64_r5.py', 'test_v64_r5_server.py'):
        python_failures.extend(python_style_failures(ROOT / 'test' / name))
    python_failures.extend(python_style_failures(ROOT / 'svg_editor_tool.py'))
    python_failures.extend(python_style_failures(ROOT / '_tools' / 'build_symbol_standard.py'))
    check(not python_failures, 'R5-Python bleibt rein funktional', ', '.join(python_failures))

    print('V64_r5 release contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()
