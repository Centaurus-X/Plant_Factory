#!/usr/bin/env python3
"""Verify the additive Plant Factory V64_r1 release contract."""

import ast
import json
import re
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parent.parent
PASSED = 0
REFERENCES = {
    'Reaktor_PID_animiert.svg': (118, 48),
    'Rohrofen_Template_animiert.svg': (85, 46),
    'PID_Anlage_animiert.svg': (94, 66),
}


def read(relative):
    """Read one UTF-8 release file."""
    return (ROOT / relative).read_text(encoding='utf-8')


def check(condition, label, detail=''):
    """Record one deterministic assertion."""
    global PASSED
    if not condition:
        raise AssertionError(label + (': ' + detail if detail else ''))
    PASSED += 1
    print('   ok  ' + label)


def local_name(tag):
    """Return the local XML element name."""
    return tag.rsplit('}', 1)[-1]


def python_style_failures(paths):
    """Return prohibited constructs in R1 Python sources."""
    failures = []
    for path in paths:
        tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                failures.append('%s:%s class' % (path.name, node.lineno))
            elif isinstance(node, ast.Lambda):
                failures.append('%s:%s lambda' % (path.name, node.lineno))
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.decorator_list:
                failures.append('%s:%s decorator' % (path.name, node.lineno))
    return failures


def main():
    """Execute the complete V64_r1 static contract."""
    package = json.loads(read('package.json'))
    index = read('public/index.html')
    drawing = read('public/js/v64_plant_drawing.js')
    model = read('public/js/v64_plant_drawing_model.js')
    css = read('public/css/v64_r1.css')

    check(package.get('releaseRevision') in {'r1', 'r2', 'r3', 'r4', 'r5', 'r6'}, 'Paket kennzeichnet R1 oder eine additive Folgerevision')
    check('test:v64:r1' in package.get('scripts', {}), 'R1-Vertragstest ist registriert')
    check('test:smoke:v64:r1' in package.get('scripts', {}), 'R1-Browsertest ist registriert')
    check(any(('V64_' + rev) in index and ('64_' + rev + ' · V9') in index for rev in ('r1', 'r2', 'r3', 'r4', 'r5', 'r6')), 'UI zeigt R1 oder eine additive Folgerevision')
    check('/public/css/v64_r1.css' in index, 'R1-CSS ist additiv eingebunden')
    check('data-tool="pan"' in index, 'Explizites Verschieben-Werkzeug ist vorhanden')
    check('plant-drawing-reference-select' in index, 'Referenzanlagen-Auswahl ist vorhanden')
    check('Flansch-Baugruppen verstehen' in index, 'Flanschhilfe ist integriert')

    for token in (
            'REFERENCE_DIAGRAMS', 'createReferenceModelFromSvg',
            'loadReferenceDiagram', 'renderedEntityBounds', 'getBBox',
            'dataTransfer.types', 'exportFullSvg', 'svg_fragment'):
        check(token in drawing, 'Zeicheneditor implementiert: ' + token)
    check("DRAWING_TOOLS = ['select', 'pan', 'connect'" in drawing,
          'Auswahl, Verschieben und Verbinden sind getrennte Modi')
    check('data-pf-event-target' in drawing and 'data-pf-state-target' in drawing,
          'Importfragmente sind an SVG-Event- und Zustandssystem gekoppelt')
    check('plantEntityVisualBounds' in model and "svg_fragment" in model,
          'Modell führt visuelle Bounds und SVG-Fragmente additiv')

    for selector in (
            '#plant-drawing-canvas',
            ':root[data-theme="dark"] #plant-drawing-canvas',
            ':root[data-theme="dark"][data-dark-palette="brown"] #plant-drawing-canvas',
            '.plant-drawing-template-card__preview',
            '.plant-drawing-stage.is-drop-target',
            '#plant-drawing-canvas.is-panning'):
        check(selector in css, 'R1-UX-Style vorhanden: ' + selector)

    reactor = read('public/svg_templates/Tubular_reactor.svg')
    check('M44 20 H56 V204 C56 216 67 220 92 220 V232 C61 232 44 223 44 204 Z' in reactor,
          'Vertikaler Rohrreaktor besitzt eine geschlossene, saubere Kontur')

    for filename, expected in REFERENCES.items():
        path = ROOT / 'public' / 'reference_diagrams' / filename
        check(path.is_file(), 'Referenzdiagramm vorhanden: ' + filename)
        root = ElementTree.fromstring(path.read_text(encoding='utf-8'))
        direct_count = len(list(root))
        animation_count = sum(
            1 for node in root.iter()
            if local_name(node.tag) in {'animate', 'animateTransform', 'animateMotion'}
        )
        check(direct_count == expected[0], 'Top-Level-Elemente unverändert: ' + filename,
              str(direct_count))
        check(animation_count == expected[1], 'SMIL-Sequenzen unverändert: ' + filename,
              str(animation_count))

    required_docs = (
        'RELEASE_NOTES_V64_R1_DE.md',
        'DIAGNOSE_UND_RELEASE_V64_R1_DE.md',
        'docs/v64_r1/ARCHITEKTUR_UND_BEDIENUNG.md',
        'docs/v64_r1/TEST_UND_FREIGABE.md',
        'docs/v64_r1/RELEASE_MANIFEST_V64_R1.json',
    )
    missing = [relative for relative in required_docs if not (ROOT / relative).is_file()]
    check(not missing, 'R1-Dokumentation ist vollständig', ', '.join(missing))
    archive_builder = read('_tools/build_release_archive.py')
    archive_verifier = read('_tools/verify_release_archive.py')
    archive_roots = ('Automated_SVG_Integration_64_r1', 'Automated_SVG_Integration_64_r2', 'Automated_SVG_Integration_64_r3', 'Automated_SVG_Integration_64_r4', 'Automated_SVG_Integration_64_r5', 'Automated_SVG_Integration_64_r6')
    check(any("default='" + root + "'" in archive_builder for root in archive_roots),
          'Archivbau verwendet den passenden Revisions-Wurzelordner')
    check(any("default='" + root + "'" in archive_verifier for root in archive_roots),
          'Archivprüfung erwartet den passenden Revisions-Wurzelordner')

    js_paths = (
        ROOT / 'public' / 'js' / 'v64_plant_drawing.js',
        ROOT / 'public' / 'js' / 'v64_plant_drawing_model.js',
    )
    style_failures = []
    for path in js_paths:
        text = path.read_text(encoding='utf-8')
        if '=>' in text:
            style_failures.append(path.name + ' arrow')
        if re.search(r'(^|\n)\s*class\s+[A-Za-z_$]', text):
            style_failures.append(path.name + ' class')
    check(not style_failures, 'R1-JavaScript bleibt rein funktional', ', '.join(style_failures))
    check(not python_style_failures((
        ROOT / 'test' / 'test_v64_r1_release.py',
        ROOT / 'test' / 'smoke_v64_r1.py',
    )), 'R1-Python bleibt rein funktional')

    print('V64_r1 release contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()
