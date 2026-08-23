#!/usr/bin/env python3
"""Verify the consolidated functional SVG converter."""

import importlib.util
import subprocess
import tempfile
import sys
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parent.parent
CONVERTER_PATH = ROOT / 'public' / 'svg_templates' / 'svg_konverter' / 'svg_converter.py'
COMPATIBILITY_PATH = ROOT / 'public' / 'svg_templates' / 'svg_konverter' / 'svg_converter_.py'
SAMPLE_PATH = ROOT / 'public' / 'svg_templates' / 'Jacketed_vessel_(wdeaadbem).svg'


def check(condition, label, detail=''):
    if not condition:
        suffix = ': %s' % detail if detail else ''
        raise AssertionError(label + suffix)
    print('   ok  %s' % label)


def load_converter():
    specification = importlib.util.spec_from_file_location('svg_converter_v61', CONVERTER_PATH)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def main():
    converter = load_converter()
    context = converter.erstelle_svg_kontext()
    check(isinstance(context, dict) and 'farbschemas' in context,
          'funktionaler Konverterkontext erstellt')
    check(converter.normalisiere_dateiname(context, 'Tank_-_ISO_10628-2') == 'Tank',
          'Dateinamen werden deterministisch normalisiert')

    with tempfile.TemporaryDirectory(prefix='svg-converter-v61-') as temporary:
        output = Path(temporary) / 'converted.svg'
        success = converter.konvertiere(
            context,
            SAMPLE_PATH,
            output,
            farbschema='universal',
            groesse='icon',
            verbose=False,
        )
        check(success and output.is_file(), 'Beispiel-SVG erfolgreich konvertiert')
        root = ElementTree.parse(output).getroot()
        width = int(str(root.get('width') or '0').removesuffix('px'))
        height = int(str(root.get('height') or '0').removesuffix('px'))
        check(max(width, height) == 64 and 0 < width <= 64 and 0 < height <= 64,
              'Zielgröße icon passt proportional in 64 × 64',
              '%s × %s' % (width, height))
        view_box = [float(value) for value in str(root.get('viewBox') or '').split()]
        check(len(view_box) == 4 and abs((width / height) - (view_box[2] / view_box[3])) < 0.02,
              'Seitenverhältnis bleibt bei der Größenanpassung erhalten')
        element_ids = [node.get('id') for node in root.iter() if node.get('id')]
        check(len(element_ids) > 0 and len(element_ids) == len(set(element_ids)),
              'Animations-IDs vorhanden und eindeutig')

    result = subprocess.run(
        [sys.executable, str(COMPATIBILITY_PATH), '--help'],
        cwd=COMPATIBILITY_PATH.parent,
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0 and 'SVG-Konverter' in result.stdout,
          'Kompatibilitätsstarter delegiert an die kanonische Implementierung')


if __name__ == '__main__':
    main()
