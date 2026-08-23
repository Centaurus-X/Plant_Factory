#!/usr/bin/env python3
"""Verify the complete static Plant Factory V64 integration contract."""

import ast
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parent.parent
PASSED = 0
V64_TEMPLATES = {
    'Pipe_straight',
    'Pipe_elbow_90',
    'Pipe_tee',
    'Flange_pair',
    'Gas_bottle',
    'Tubular_reactor',
    'Tube_furnace',
    'Double_pipe_cooler',
    'Plate_heat_exchanger',
}
V64_JS = (
    'public/js/svg_event_runtime.js',
    'public/js/v64_hmi_animation_ui.js',
    'public/js/v64_plant_drawing_model.js',
    'public/js/v64_plant_drawing.js',
)
NODE_BINARY = os.environ.get('NODE_BINARY') or shutil.which('node') or 'node'


def read(relative):
    """Read one UTF-8 release file."""
    return (ROOT / relative).read_text(encoding='utf-8')


def read_json(relative):
    """Read one JSON release file."""
    return json.loads(read(relative))


def check(condition, label, detail=''):
    """Record one deterministic release assertion."""
    global PASSED
    if not condition:
        raise AssertionError(label + (': ' + detail if detail else ''))
    PASSED += 1
    print('   ok  ' + label)


def python_style_failures(paths):
    """Return prohibited Python constructs in selected V64 files."""
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


def js_style_failures(paths):
    """Return prohibited JavaScript constructs in selected V64 files."""
    failures = []
    patterns = (
        (re.compile(r'=>'), 'arrow'),
        (re.compile(r'(^|\n)\s*class\s+[A-Za-z_$]'), 'class'),
    )
    for path in paths:
        text = path.read_text(encoding='utf-8')
        for pattern, label in patterns:
            if pattern.search(text):
                failures.append('%s %s' % (path.name, label))
    return failures


def local_name(tag):
    """Return the local XML name."""
    return tag.rsplit('}', 1)[-1]


def main():
    """Execute the V64 static release contract."""
    package = read_json('package.json')
    index = read('public/index.html')
    css = read('public/css/v64.css')
    event_runtime = read('public/js/svg_event_runtime.js')
    event_ui = read('public/js/v64_hmi_animation_ui.js')
    drawing = read('public/js/v64_plant_drawing.js')
    drawing_model = read('public/js/v64_plant_drawing_model.js')
    hmi = read('public/js/hmi.js')
    hmi_runtime = read('public/js/hmi_runtime.js')
    model_adapter = read('public/js/model_adapter.js')
    ui = read('public/js/ui.js')
    manifest = read_json('public/svg_templates/library_manifest_v1.json')

    check(read('VERSION').strip() == '64', 'VERSION ist 64')
    check(package.get('version') == '64.0.0', 'package.json ist 64.0.0')
    check('test:v64' in package.get('scripts', {}), 'Gezielter V64-Test ist registriert')
    check('V64' in index and ('64 · V9' in index or '64_r1 · V9' in index or '64_r2 · V9' in index or '64_r3 · V9' in index or '64_r4 · V9' in index or '64_r5 · V9' in index or '64_r6 · V9' in index),
          'Browseroberfläche zeigt V64 oder eine additive Revision')
    check('/public/css/v64.css' in index, 'V64-CSS ist additiv eingebunden')
    check('/public/js/v64_plant_drawing.js' in index, 'V64-Zeicheneditor ist eingebunden')
    check('data-target-tab="plant-drawing"' in index and '>Zeichnen<' in index,
          'Anlage besitzt den neuen Menüpunkt Zeichnen')

    required = (
        'start_plant_factory.sh',
        'RELEASE_NOTES_V64_DE.md',
        'DIAGNOSE_UND_RELEASE_V64_DE.md',
        'docs/v64/ARCHITEKTUR_UND_BEDIENUNG.md',
        'docs/v64/SVG_EVENT_ANIMATIONEN.md',
        'docs/v64/ANLAGEN_ZEICHENEDITOR.md',
        'docs/v64/MIGRATION_UND_KOMPATIBILITAET.md',
        'docs/v64/TEST_UND_FREIGABE.md',
        'docs/v64/RELEASE_MANIFEST_V64.json',
    )
    missing = [relative for relative in required if not (ROOT / relative).is_file()]
    check(not missing, 'Alle V64-Dokumentationsartefakte sind vorhanden', ', '.join(missing))

    check('plant-factory.svg-event-animation' in event_runtime,
          'SVG-Ereignisschema besitzt eine stabile ID')
    for effect in (
            'fill', 'stroke', 'temperature', 'flow', 'blink',
            'pulse', 'rotate', 'level', 'opacity', 'glow'):
        check(("'" + effect + "'") in event_runtime,
              'Animationseffekt ist implementiert: ' + effect)
    check('createSvgEventRuntime' in event_runtime
          and 'dispatch: dispatch' in event_runtime
          and 'setSignals: setSignals' in event_runtime,
          'Runtime koppelt Signale und allgemeine Ereignisse')
    check('part_selector' in event_runtime and 'data-pf-state-target' in event_ui,
          'Semantische SVG-Unterelemente sind adressierbar')
    check('Ereignisgesteuerte SVG-Animationen' in hmi
          and 'renderHmiEventAnimationDesigner' in hmi,
          'Animationsdesigner ist nahtlos im HMI-Workflow integriert')
    check('createSvgEventRuntime' in hmi_runtime
          and 'dispatchSvgEvent' in hmi_runtime
          and 'setSignals' in hmi_runtime,
          'Export-Runtime verarbeitet Events und Signalbatches')
    check('eventAnimations' in ui and 'svg_event_runtime.js' in ui,
          'SVG- und SCADA-Export führen Animationsregeln und Runtime mit')

    check('plant-factory.plant-drawing' in drawing_model,
          'Zeicheneditor besitzt einen versionierten Datenvertrag')
    for feature in (
            'createPlantEntity', 'createPlantConnection',
            'collectExposedPlantPorts', 'duplicatePlantSelection',
            'createRohrofenPlantExample'):
        check(feature in drawing_model, 'Zeichenmodell implementiert: ' + feature)
    for ui_feature in (
            'saveToInventory', 'buildSvgArtifact', 'renderPreview',
            'handlePortClick', 'exportSvg', 'exportJson'):
        check(ui_feature in drawing, 'Zeichenoberfläche implementiert: ' + ui_feature)
    check('plant_drawing' in model_adapter
          and 'plant_drawing_report' in model_adapter
          and 'plant_drawing_ref' in model_adapter,
          'V9-Export enthält Zeichenmodell, Bericht und HMI-Referenz')
    check('plant_drawing' in ui and 'plant_drawing:loaded' in ui,
          'Projekt-Speichern und -Laden erhalten das Zeichenmodell')

    templates = manifest.get('templates', {})
    check(manifest.get('template_count') == len(templates) and len(templates) >= 35,
          'Symbolmanifest enthält deterministisch mindestens 35 Templates')
    check(V64_TEMPLATES.issubset(set(templates)),
          'Alle neun V64-Komponenten sind im Inventar')
    for template_id in sorted(V64_TEMPLATES):
        metadata = templates[template_id]
        template_path = ROOT / 'public' / 'svg_templates' / metadata['file']
        check(template_path.is_file(), 'SVG vorhanden: ' + template_id)
        root = ElementTree.fromstring(template_path.read_text(encoding='utf-8'))
        check(local_name(root.tag) == 'svg', 'Gültige SVG-Wurzel: ' + template_id)
        check(bool(metadata.get('ports')), 'Semantische Ports: ' + template_id)
        check(bool(metadata.get('animierbare_bereiche')),
              'Animierbare Bereiche: ' + template_id)
        check('data-pf-state-target' in template_path.read_text(encoding='utf-8'),
              'Semantische Animationsziele: ' + template_id)

    check('.plant-drawing-workspace' in css
          and '.hmi-event-animation-designer' in css,
          'V64-CSS deckt Zeichnen und Animations-UX ab')
    check('plant-drawing-preview' in index
          and 'plant-drawing-save-inventory' in index
          and 'plant-drawing-use-in-plant' in index,
          'Vorschau und beide Inventaraktionen sind vorhanden')
    check('process' in index and 'utility' in index
          and 'signal' in index and 'power' in index,
          'Vier fachliche Verbindungstypen sind auswählbar')

    js_paths = [ROOT / relative for relative in V64_JS]
    check(not js_style_failures(js_paths),
          'Neue V64-JavaScript-Module bleiben rein funktional')
    python_paths = [
        ROOT / '_tools' / 'build_symbol_standard.py',
        ROOT / 'test' / 'test_v64_release.py',
    ]
    check(not python_style_failures(python_paths),
          'Neue V64-Python-Module bleiben rein funktional')
    for relative in V64_JS + (
            'public/js/hmi.js',
            'public/js/hmi_runtime.js',
            'public/js/model_adapter.js'):
        result = subprocess.run(
            [NODE_BINARY, '--check', relative],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        check(result.returncode == 0, 'JavaScript-Syntax: ' + relative,
              result.stderr.strip())

    check('dirname -- "${SCRIPT_PATH}"' in read('start_plant_factory.sh')
          and 'PLANT_FACTORY_HOST:-0.0.0.0' in read('start_plant_factory.sh'),
          'Startskript löst sein eigenes Releaseverzeichnis robust auf')
    shell_scripts = (ROOT / 'start_plant_factory.sh', ROOT / 'test_all.sh')
    check(not any(b'\r\n' in path.read_bytes() for path in shell_scripts),
          'Linux-Start- und Testskript verwenden ausschließlich LF-Zeilenenden')
    check('Automated_SVG_Integration_64' in read('_tools/build_release_archive.py')
          and 'Automated_SVG_Integration_64' in read('_tools/verify_release_archive.py'),
          'Paketbau und Archivprüfung verwenden den V64-Wurzelordner')

    print('V64 release contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()
