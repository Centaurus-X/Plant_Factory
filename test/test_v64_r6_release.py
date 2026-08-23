#!/usr/bin/env python3
"""Verify the additive Plant Factory V64_r6 release contract."""

import ast
import json
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parent.parent
PASSED = 0
ASSEMBLY_FILE = (
    'public/svg_templates/assemblies/'
    'assembly_template_mt4tvvee_tuvofeq.json'
)
REQUIRED_DOCS = (
    'RELEASE_NOTES_V64_R6_DE.md',
    'DIAGNOSE_UND_RELEASE_V64_R6_DE.md',
    'docs/v64_r6/ARCHITEKTUR_UND_BEDIENUNG.md',
    'docs/v64_r6/TEST_UND_FREIGABE.md',
    'docs/v64_r6/RELEASE_MANIFEST_V64_R6.json',
    'release_evidence/V64_r6_01_Accessible_Inventory_Scrollbar.png',
    'release_evidence/V64_r6_02_Drawing_Assembly_Inventory.png',
    'release_evidence/V64_r6_03_Structured_Assembly_Parts.png',
    'release_evidence/V64_r6_04_Legacy_Assembly_Upgrade.png',
)
MODIFIED_JAVASCRIPT = (
    'public/js/v64_plant_drawing.js',
    'public/js/elements.js',
    'public/js/v56_workspace.js',
    'public/js/registry.js',
    'public/js/connection_mapper.js',
)
DRAWING_TOKENS = (
    "window.__appVersion = '64_r6'",
    "patchContract: 'PF-V64-R6-ACCESSIBLE-STRUCTURED-ASSEMBLY'",
    "composition_mode: 'structured-assembly'",
    'placeStructuredAssemblyTemplate',
    'handleStructuredAssemblyPlacement',
    'assemblyTemplateForPlantTemplate',
    'transformAssemblyEntity',
    'addDrawingEntitiesToPlant',
    'addDrawingConnectionsToPlant',
    'legacyFlatAssemblyCandidate',
    'expandLegacyFlatAssembly',
    'appendAssemblyUpgradePanel',
    "drawing_assembly_role: 'layout'",
    "drawing_assembly_role: 'part'",
    'drawing_hide_embedded_entities: true',
    'transferAssemblyToPlantInventory',
)
SERVER_TOKENS = (
    "composition_mode = str(metadata.get('composition_mode', 'flat') or 'flat')",
    "if composition_mode != 'structured-assembly':",
    "embedded_assembly = baugruppe_normalisieren(metadata['assembly_template'])",
    "'assembly_template': embedded_assembly",
    "'assembly_export_bounds': assembly_export_bounds",
    "'assembly_part_count': assembly_part_count",
    "'assembly_connection_count': assembly_connection_count",
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


def python_style_failures(path):
    """Return forbidden Python syntax in one source file."""
    tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    failures = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            failures.append('%s:%s class' % (path.name, node.lineno))
        elif isinstance(node, ast.Lambda):
            failures.append('%s:%s lambda' % (path.name, node.lineno))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.decorator_list:
            failures.append('%s:%s decorator' % (path.name, node.lineno))
    return failures


def active_javascript(text):
    """Remove comments and quoted literals for a focused functional-style scan."""
    without_blocks = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    literal_pattern = r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|\x60(?:\\.|[^\x60\\])*\x60"
    without_literals = re.sub(literal_pattern, '', without_blocks, flags=re.S)
    return re.sub(r'//[^\n]*', '', without_literals)


def main():
    """Execute the complete V64_r6 static contract."""
    package = json.loads(read('package.json'))
    index = read('public/index.html')
    r6_css = read('public/css/v64_r6.css')
    workspace_css = read('public/css/workspace.css')
    workspace_js = read('public/js/v56_workspace.js')
    drawing = read('public/js/v64_plant_drawing.js')
    elements = read('public/js/elements.js')
    registry = read('public/js/registry.js')
    connections = read('public/js/connection_mapper.js')
    server = read('svg_editor_tool.py')
    assembly = json.loads(read(ASSEMBLY_FILE))

    check(package.get('version') == '64.0.0' and package.get('releaseRevision') == 'r6',
          'Paket kennzeichnet Plant Factory 64_r6')
    scripts = package.get('scripts', {})
    check('test:v64:r6' in scripts and 'test:smoke:v64:r6' in scripts and 'release:r6' in scripts,
          'R6-Vertrags-, Browser- und Archivprüfungen sind registriert')
    check('node test/test_v64_r6_model.mjs' in scripts.get('test', ''),
          'Allgemeine Modellkette enthält den R6-Vertrag')
    check('V64_r6' in index and '64_r6 · V9' in index,
          'Titel und Versionsbadge zeigen R6')
    check(index.index('/public/css/v64_r5.css') < index.index('/public/css/v64_r6.css'),
          'R6-CSS liegt additiv hinter R5')
    check('id="category-chips-help"' in index and 'role="tablist"' in index
          and 'aria-describedby="category-chips-help"' in index,
          'Inventarkategorien besitzen Anleitung und Tablisten-Semantik')
    check('scrollbar-width: none' in workspace_css and 'scrollbar-width: thin' in r6_css
          and '.category-chips::-webkit-scrollbar' in r6_css
          and 'display: block' in r6_css,
          'R6 überschreibt den früher verborgenen Scrollbalken sichtbar')
    check('scrollbar-gutter: stable' in r6_css and 'overscroll-behavior-inline: contain' in r6_css,
          'Scrollbar belegt stabilen Platz und begrenzt horizontales Überscrollen')
    check('.category-chip:focus-visible' in r6_css and '@media (forced-colors: active)' in r6_css,
          'Tastaturfokus und erzwungene Kontraste sind berücksichtigt')

    for token in (
        "setAttribute('role', 'tab')",
        "setAttribute('aria-controls', 'template-palette')",
        'aria-selected',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'revealCategoryChip',
        'scrollLeft',
    ):
        check(token in workspace_js, 'Kategorienavigation implementiert: ' + token)

    for token in DRAWING_TOKENS:
        check(token in drawing, 'Strukturierte Baugruppe implementiert: ' + token)
    check("window.__plantFactoryV64R5" in drawing
          and "inheritedPatchContract: 'PF-V64-R5-CLASSIC-DRAWING'" in drawing,
          'R5-Vertrag bleibt publiziert und ist explizite R6-Basis')
    check("'data-pf-source': 'plant-drawing-v64-r6'" in drawing,
          'SVG-Export kennzeichnet die R6-Quelle')
    check('registerTemplatePlacementHandler' in elements
          and 'runTemplatePlacementHandlers' in elements
          and 'skipStructuredPlacement' in elements,
          'Elementmanager besitzt generischen rekursionssicheren Platzierungshook')
    check('applyCompositionPresentation' in elements
          and "drawing_assembly_role === 'layout'" in elements
          and '[data-pf-entity-id], [data-pf-connection-id]' in elements,
          'Passive Zeichnungsebene blendet nur eingebettete Geräte und Verbindungen aus')
    check('structured-assembly' in registry and 'Baugruppe · ' in registry,
          'Strukturierte Vorlagen werden im Anlagen-Inventar verständlich gekennzeichnet')
    check('options.deferHistory !== true' in connections,
          'Strukturierte Platzierung erzeugt einen konsistenten Historienpunkt')

    for token in SERVER_TOKENS:
        check(token in server, 'Server validiert strukturiertes Feld: ' + token)
    check(assembly.get('schema') == 'plant-factory.plant-drawing-assembly'
          and assembly.get('version') == 1,
          'Gebündelter Anlagenentwurf nutzt das bestehende additive Schema')
    check(assembly.get('name') == 'Anlagen Entwurf'
          and assembly.get('category') == 'Baugruppen'
          and assembly.get('assembly_template_id') == 'assembly_template_mt4tvvee_tuvofeq',
          'Anlagenentwurf ist direkt unter Baugruppen inventarisiert')
    check(len(assembly.get('entities', [])) == 31
          and len(assembly.get('connections', [])) == 14
          and len(assembly.get('primitives', [])) == 45,
          'Anlagenentwurf ist mit allen 90 Bestandteilen vollständig')
    check(assembly.get('width') == 1152.0 and assembly.get('height') == 1068.0,
          'Anlagenentwurf behält Maßstab und Seitenverhältnis')

    missing = [relative for relative in REQUIRED_DOCS if not (ROOT / relative).is_file()]
    check(not missing, 'R6-Dokumentation ist vollständig', ', '.join(missing))
    manifest = json.loads(read('docs/v64_r6/RELEASE_MANIFEST_V64_R6.json'))
    check(manifest.get('release') == '64_r6'
          and manifest.get('patch_contract') == 'PF-V64-R6-ACCESSIBLE-STRUCTURED-ASSEMBLY',
          'Release-Manifest benennt Revision und Vertrag')
    check(manifest.get('bundled_assembly', {}).get('entities') == 31
          and manifest.get('bundled_assembly', {}).get('total_parts') == 90,
          'Release-Manifest dokumentiert den vollständigen Anlagenentwurf')
    check('V64_r6' in read('README.md'), 'README nennt die aktuelle Revision')
    check("default='Automated_SVG_Integration_64_r6'" in read('_tools/build_release_archive.py')
          and "default='Automated_SVG_Integration_64_r6'" in read('_tools/verify_release_archive.py'),
          'Archivbau und Archivprüfung erwarten den R6-Wurzelordner')

    style_failures = []
    for relative in MODIFIED_JAVASCRIPT:
        active = active_javascript(read(relative))
        if '=>' in active or re.search(r'(^|\n)\s*class\s+[A-Za-z_$]', active):
            style_failures.append(relative)
    check(not style_failures, 'Geändertes R6-JavaScript bleibt rein funktional', ', '.join(style_failures))

    python_failures = []
    for relative in (
        'svg_editor_tool.py',
        'test/test_v64_r6_release.py',
        'test/test_v64_r6_server.py',
    ):
        python_failures.extend(python_style_failures(ROOT / relative))
    check(not python_failures, 'Geändertes R6-Python bleibt rein funktional', ', '.join(python_failures))

    test_all = read('test_all.sh')
    check(test_all.count('python3 test/test_v64_r6_release.py') >= 2
          and 'node test/test_v64_r6_model.mjs' in test_all
          and 'python3 test/test_v64_r6_server.py' in test_all
          and 'python3 test/smoke_v64_r6.py' in test_all,
          'R6-Statik, Modell, Server und Browser liegen in der Gesamtkette')
    check('ALL V64_R6 RELEASE CHECKS PASSED' in test_all,
          'Gesamtkette besitzt eindeutige R6-Freigabemeldung')

    print('V64_r6 release contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()

