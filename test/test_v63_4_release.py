#!/usr/bin/env python3
"""Verify the Plant Factory V63.4 HMI navigation and guided UX contract."""

import ast
import json
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PASSED = 0
EXCLUDED_PARTS = {
    '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache',
}


def read(relative):
    """Read one UTF-8 release file."""
    return (ROOT / relative).read_text(encoding='utf-8')


def load_json(relative):
    """Load one JSON release file."""
    return json.loads(read(relative))


def check(condition, label, detail=''):
    """Record one deterministic release assertion."""
    global PASSED
    if not condition:
        suffix = ': ' + detail if detail else ''
        raise AssertionError(label + suffix)
    PASSED += 1
    print('   ok  ' + label)


def python_style_failures():
    """Return functional-style violations in first-party Python files."""
    failures = []
    for path in sorted(ROOT.rglob('*.py')):
        relative = path.relative_to(ROOT)
        if EXCLUDED_PARTS.intersection(relative.parts):
            continue
        if any(part.startswith('.release_') for part in relative.parts):
            continue
        try:
            tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        except SyntaxError as error:
            failures.append('%s:%s syntax' % (relative, error.lineno))
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                failures.append('%s:%s class' % (relative, node.lineno))
            elif isinstance(node, ast.Lambda):
                failures.append('%s:%s lambda' % (relative, node.lineno))
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.decorator_list:
                failures.append('%s:%s decorator' % (relative, node.lineno))
    return failures


def main():
    """Execute the complete static V63.4 release contract."""
    version = read('VERSION').strip()
    package = load_json('package.json')
    index = read('public/index.html')
    hmi = read('public/js/hmi.js')
    css = read('public/css/v63_4.css')
    release_ui = read('public/js/v63_logic_ui.js')

    supported_releases = {'63.4', '64'}
    supported_packages = {'63.4.0', '64.0.0'}
    check(version in supported_releases,
          'Release ist V63.4 oder ein kompatibler Nachfolger', version)
    check(package.get('version') in supported_packages,
          'Paket ist V63.4 oder ein kompatibler Nachfolger')
    visible_version = (
        ('V64' in index and '64 · V9' in index)
        if version == '64'
        else ('V63.4' in index and '63.4 · V9' in index)
    )
    check(visible_version, 'Browseroberfläche zeigt den aktuellen Release')
    check('/public/css/v63_4.css' in index,
          'V63.4 Integrations-CSS ist nach V63.3 eingebunden')
    check(index.index('/public/css/v63_3.css') < index.index('/public/css/v63_4.css'),
          'V63.4 überschreibt die geerbte V63.3-UX minimal-invasiv')
    check('test:v63.4' in package.get('scripts', {}),
          'Gezielte V63.4-Prüfung ist im Paket definiert')

    required = [
        'public/css/v63_4.css',
        'test/test_v63_4_release.py',
        'test/smoke_v63_4.py',
        'RELEASE_NOTES_V63_4_DE.md',
        'DIAGNOSE_UND_PATCH_V63_4_DE.md',
        'docs/v63_4/HMI_NAVIGATION_UND_WIDGET_REGISTER.md',
        'docs/v63_4/HMI_ZUSTAENDE_UND_ALARME.md',
        'docs/v63_4/HMI_DARSTELLUNG.md',
        'docs/v63_4/TEST_UND_FREIGABE.md',
        'docs/v63_4/RELEASE_MANIFEST_V63_4.json',
    ]
    missing = [name for name in required if not (ROOT / name).is_file()]
    check(not missing, 'Alle V63.4 Releaseartefakte sind vorhanden', ', '.join(missing))

    check('class="hmi-workflow-overview" role="tablist"' in hmi,
          'Nummerierte HMI-Schritte sind die kanonische Tablist')
    check('class="hmi-workflow-step${active}"' in hmi
          and 'role="tab"' in hmi
          and 'aria-controls="hmi-ui-panel-${step.key}"' in hmi,
          'Workflow-Schritte besitzen vollständige Tab-Semantik')
    check('aria-selected="${selected}"' in hmi
          and 'tabindex="${tabIndex}"' in hmi,
          'Workflow-Navigation nutzt roving tabindex und aria-selected')
    check("['ArrowLeft', 'ArrowRight', 'Home', 'End']" in hmi,
          'Workflow-Navigation ist vollständig per Tastatur bedienbar')
    check('hmi-legacy-tab-list' in hmi
          and 'data-hmi-compatibility-tabs="PF-HMI-SETUP-V2"' in hmi,
          'Historische Untertabs bleiben als Kompatibilitätshaken im DOM')
    check('aria-hidden="true" hidden' in hmi,
          'Historische Untertabs sind nicht mehr als zweite Navigation sichtbar')
    check('.hmi-legacy-tab-list[hidden]' in css
          and 'display: none !important' in css,
          'V63.4 blendet die redundante Tabzeile robust aus')
    check('compatibility mirror' in hmi
          and 'intentionally hidden' in hmi,
          'Kompatibilitätsentscheidung ist direkt im Produktcode dokumentiert')

    check('<button type="button" class="hmi-widget-table__select"' in hmi,
          'Klickbare Widgetnamen sind semantische Buttons statt Links')
    check('aria-label="Widget ${escapeAttr(widget.name || widget.widget_id)} bearbeiten"' in hmi,
          'Widgetbuttons besitzen verständliche zugängliche Beschriftungen')
    check('.hmi-widget-table__select {' in css
          and 'border:' in css
          and 'border-radius:' in css
          and 'background:' in css,
          'Widgetauswahl ist als kompakter Button gestaltet')
    check('text-decoration: none' in css,
          'Widgetauswahl verwendet keine Link-Unterstreichung')
    check('.hmi-widget-table__row--active .hmi-widget-table__select' in css,
          'Aktives Widget behält den akzentuierten Farbcode')

    check('id="hmi-live-preview-section"' in hmi
          and 'stylesPreview' in hmi,
          'Signaltest ist als merkbarer, geführter Bereich strukturiert')
    check('id="hmi-threshold-wizard"' in hmi
          and 'Grenzwerte, Zustände und Alarm in einem Schritt' in hmi,
          'Empfohlener Zustands-/Alarm-Workflow bleibt prominent')
    check('id="hmi-manual-state-section"' in hmi
          and 'stylesManual' in hmi,
          'Vollständige manuelle Konfiguration bleibt additiv verfügbar')
    check('1 · Binding' in hmi and '2 · Schwellen' in hmi
          and '3 · Ausgabe' in hmi and '4 · Erzeugen' in hmi,
          'Grenzwert-Wizard erklärt den vollständigen Datenfluss')
    check('id="hmi-threshold-advanced"' in hmi
          and 'thresholdAdvanced' in hmi,
          'Erweiterte Klassen und Quittierung bleiben in einem Disclosure erhalten')
    for control_id in (
        'hmi-prev-sel', 'hmi-prev-val', 'hmi-prev-slider',
        'hmi-tw-binding', 'hmi-tw-warn', 'hmi-tw-alarm',
        'hmi-tw-apply-overlay', 'hmi-tw-apply-svg',
        'hmi-tw-create-alarm', 'hmi-tw-alarm-sev',
        'hmi-tw-alarm-latching', 'hmi-tw-alarm-ack',
        'hmi-tw-ok-w', 'hmi-tw-warn-w', 'hmi-tw-alarm-w',
        'hmi-tw-ok-s', 'hmi-tw-warn-s', 'hmi-tw-alarm-s',
        'hmi-tw-generate', 'hmi-style-list', 'hmi-alarm-list',
    ):
        check(('id="' + control_id + '"') in hmi,
              'Geerbtes Zustands-/Alarmfeld bleibt erhalten: ' + control_id)

    check('class="hmi-appearance-workflow"' in hmi,
          'Darstellung besitzt einen geführten Workflow')
    check('Canvas-Hintergrund festlegen' in hmi
          and 'Widget für die Gestaltung auswählen' in hmi
          and 'Widget-Darstellung bearbeiten' in hmi,
          'Darstellung trennt View, Widgetauswahl und Design verständlich')
    check('class="hmi-appearance-widget-option${active}"' in hmi,
          'Widgetauswahl der Darstellung nutzt verständliche Auswahlkarten')
    check('hmi-appearance-selection-summary' in hmi
          and 'P&amp;ID-/SVG-Objekt' in hmi
          and 'Datenstatus' in hmi,
          'Darstellung zeigt Widget-, Objekt- und Datenkontext gemeinsam')
    check('Grunddesign' in hmi and 'Farben und Schrift' in hmi,
          'Darstellungsfelder sind in fachliche Abschnitte gegliedert')
    check('id="hmi-appearance-advanced"' in hmi
          and 'appearanceAdvanced' in hmi,
          'Erweiterte Klassen bleiben optional erreichbar')
    for control_id in (
        'hmi-app-variant', 'hmi-app-size', 'hmi-app-shape',
        'hmi-app-bw', 'hmi-app-bg', 'hmi-app-tc', 'hmi-app-bc',
        'hmi-app-fs', 'hmi-app-classes', 'hmi-app-svg-classes',
        'hmi-app-preview', 'hmi-app-apply',
    ):
        check(('id="' + control_id + '"') in hmi,
              'Geerbtes Darstellungsfeld bleibt erhalten: ' + control_id)

    check("version: '63.4'" in release_ui,
          'Browser-Releasebericht ist V63.4')
    check("patchContract: 'PF-V63.4-HMI-UX'" in release_ui,
          'V63.4 HMI-UX-Vertrag wird publiziert')
    check("inheritedPatchContract: 'PF-V63.3-HMI-IO-UX'" in release_ui,
          'V63.3 I/O- und Widgetvertrag bleibt geerbt')
    check("hmiNavigation: 'single-guided-tablist'" in release_ui,
          'Single-Navigation wird maschinenlesbar publiziert')
    check("hmiLegacyTabs: 'hidden-compatibility-only'" in release_ui,
          'Verborgene Kompatibilitätstabs werden publiziert')
    check("hmiStatesAlarmsWorkflow: 'guided-with-advanced-disclosure'" in release_ui,
          'Geführte Zustands-/Alarm-UX wird publiziert')
    check("hmiAppearanceWorkflow: 'view-widget-design'" in release_ui,
          'Geführte Darstellungs-UX wird publiziert')

    style_failures = python_style_failures()
    check(not style_failures, 'Python-Code bleibt rein funktional', ', '.join(style_failures))
    result = subprocess.run(
        [os.environ.get('NODE_BINARY', 'node'), '_tools/check_js_functional_style.cjs'],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, 'JavaScript-Code bleibt rein funktional',
          result.stderr.strip() or result.stdout.strip())
    result = subprocess.run(
        [os.environ.get('NODE_BINARY', 'node'), '--check', 'public/js/hmi.js'],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, 'HMI-Modul ist syntaktisch valide',
          result.stderr.strip() or result.stdout.strip())

    print('Plant Factory V63.4 static release contract: %s checks passed.' % PASSED)


if __name__ == '__main__':
    main()
