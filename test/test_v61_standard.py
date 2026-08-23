#!/usr/bin/env python3
"""Verify PF-PID-V1 geometry, metadata, demo and deterministic generation."""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parent.parent
STANDARD_PATH = ROOT / 'config' / 'symbol_standard_v1.json'
MANIFEST_PATH = ROOT / 'public' / 'svg_templates' / 'library_manifest_v1.json'
DEMO_PATH = ROOT / 'projekte' / 'designziel_v1_v61_1.json'


def check(condition, label, detail=''):
    if not condition:
        suffix = ': %s' % detail if detail else ''
        raise AssertionError(label + suffix)
    print('   ok  %s' % label)


def meta_comment(path):
    text = path.read_text(encoding='utf-8')
    match = re.search(r'<!-- META: (.*?) -->', text)
    check(match is not None, 'META-Kommentar vorhanden: %s' % path.name)
    return json.loads(match.group(1)), text


def local_name(value):
    return str(value).split('}', 1)[-1]


def main():
    result = subprocess.run(
        [sys.executable, str(ROOT / '_tools' / 'build_symbol_standard.py'), '--check'],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, 'Symbolbibliothek ist deterministisch', result.stderr.strip())

    standard = json.loads(STANDARD_PATH.read_text(encoding='utf-8'))
    manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
    templates = manifest.get('templates', {})
    check(standard.get('standard_id') == 'PF-PID-V1', 'Objektstandard PF-PID-V1 definiert')
    check(standard.get('release') == '61.1', 'Objektstandard gehört zu Release 61.1')
    check(manifest.get('template_count') == len(templates) and len(templates) >= 26,
          'mindestens 26 kanonische Prozesssymbole vorhanden')
    check(standard['hmi_controls']['default'] is None,
          'kein standardmäßiges HMI-Control definiert')
    check(standard['hmi_controls']['button_policy'] == 'optional_explicit_only',
          'Button-Richtlinie ist explizit optional')
    check(standard['hmi_controls']['auto_binding'] is False,
          'automatisches HMI-Binding ist deaktiviert')
    check('io' in standard.get('port_kinds', []),
          'I/O-Brückenports sind im Standard definiert')
    check(standard['connection_types']['signal']['accepted_port_kinds'] == ['signal', 'io']
          and standard['connection_types']['data']['accepted_port_kinds'] == ['data', 'io'],
          'Signal- und Datenverbindungen unterstützen kontrollierte I/O-Brücken')

    serialized = json.dumps(templates, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    expected_hash = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
    check(expected_hash == manifest.get('templates_sha256'), 'Manifest-Hash stimmt')

    required_families = {
        'tank', 'centrifugal-pump', 'heat-exchanger', 'control-valve',
        'jacketed-reactor', 'temperature-transmitter', 'generic-sensor-entity',
        'remote-io-detailed',
    }
    actual_families = set()
    template_failures = []
    total_ports = 0
    for template_id, metadata in sorted(templates.items()):
        path = ROOT / 'public' / 'svg_templates' / metadata['file']
        if not path.is_file():
            template_failures.append('%s: Datei fehlt' % metadata['file'])
            continue
        text = path.read_text(encoding='utf-8')
        match = re.search(r'<!-- META: (.*?) -->', text)
        if match is None:
            template_failures.append('%s: META-Kommentar fehlt' % path.name)
            continue
        try:
            parsed_meta = json.loads(match.group(1))
            root = ElementTree.fromstring(text)
        except Exception as error:
            template_failures.append('%s: %s' % (path.name, error))
            continue
        actual_families.add(metadata.get('family'))
        ports = metadata.get('ports', [])
        total_ports += len(ports)
        checks = [
            (local_name(root.tag) == 'svg', 'SVG-Wurzel'),
            (root.attrib.get('data-pf-standard') == 'PF-PID-V1', 'Standardattribut'),
            (parsed_meta.get('id') == template_id, 'META-ID'),
            (parsed_meta.get('ports') == ports, 'Portmetadaten'),
            (parsed_meta['capabilities']['auto_create_hmi_widgets'] is False,
             'HMI-Autoerzeugung'),
            (parsed_meta['hmi_policy']['default_control'] is None, 'HMI-Default'),
            ('vector-effect:non-scaling-stroke' in text, 'Linienbreite'),
            ('data-pf-role="body"' in text, 'Body-Rolle'),
            (len(ports) >= 2, 'Portanzahl'),
            (all(0 <= port.get('rx', -1) <= 1 and 0 <= port.get('ry', -1) <= 1
                 for port in ports), 'Portkoordinaten'),
            (not any(token.lower() in text.lower()
                     for token in ('<script', '<foreignObject', '<!DOCTYPE', '<!ENTITY')),
             'aktive SVG-Inhalte'),
        ]
        for condition, label in checks:
            if not condition:
                template_failures.append('%s: %s' % (path.name, label))
    check(not template_failures, 'alle Templates erfüllen SVG- und Metadatenvertrag',
          '; '.join(template_failures[:12]))
    check(total_ports >= 70, 'Bibliothek enthält ausreichend semantische Ports', str(total_ports))
    check(required_families.issubset(actual_families), 'zentrale P&ID-Familien vollständig')

    demo = json.loads(DEMO_PATH.read_text(encoding='utf-8'))
    check(demo['object_standard']['id'] == 'PF-PID-V1', 'Demo nutzt PF-PID-V1')
    check(len(demo.get('elements', [])) == 6, 'Demo enthält sechs normalisierte Entities')
    check(len(demo.get('connections', [])) == 5, 'Demo enthält fünf semantische Verbindungen')
    check(all(item.get('object_standard', {}).get('normalized') is True
              for item in demo.get('elements', [])), 'Demo-Entities sind normalisiert')
    check(all(item.get('fromPort') and item.get('toPort')
              for item in demo.get('connections', [])), 'Demo-Verbindungen verwenden Ports')
    widgets = demo.get('hmi', {}).get('widgets', [])
    check(len(widgets) == 2, 'Demo enthält zwei optionale HMI-Widgets')
    check(all(item.get('origin') == 'explicit' and item.get('auto_created') is False
              for item in widgets), 'Demo-HMI wurde ausschließlich explizit angelegt')
    check(any(item.get('type') == 'button' for item in widgets),
          'optionaler Button bleibt verfügbar')
    ElementTree.parse(ROOT / 'projekte' / 'designziel_v1_v61_1.svg')
    print('PF-PID-V1 standard verification passed.')


if __name__ == '__main__':
    main()
