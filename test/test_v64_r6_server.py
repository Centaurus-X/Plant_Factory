#!/usr/bin/env python3
"""Exercise the V64_r6 structured custom-template server contract in isolation."""

import asyncio
import json
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from svg_editor_tool import (  # noqa: E402
    alle_templates_abrufen,
    baugruppe_normalisieren,
    template_hochladen,
    templates_laden,
)

PASSED = 0


def check(condition, label, detail=''):
    """Record one deterministic assertion."""
    global PASSED
    if not condition:
        suffix = ': %s' % detail if detail else ''
        raise AssertionError(label + suffix)
    PASSED += 1
    print('   ok  %s' % label)


def sample_assembly():
    """Return one small structured assembly with hostile surplus fields."""
    return {
        'assembly_template_id': '../r6 structured probe',
        'name': 'R6 Strukturprobe',
        'category': 'Baugruppen',
        'width': 220,
        'height': 80,
        'entities': [
            {
                'entity_id': 'pipe',
                'template_id': 'Pipe_straight',
                'name': 'Rohr',
                'x': 0,
                'y': 10,
                'width': 140,
                'height': 60,
                'ports': [
                    {'id': 'inlet', 'kind': 'process', 'direction': 'in', 'x': 0, 'y': 30},
                    {'id': 'outlet', 'kind': 'process', 'direction': 'out', 'x': 140, 'y': 30},
                ],
                'properties': {'note': 'kept', 'nested': {'drop': 'value'}},
            },
            {
                'entity_id': 'flange',
                'template_id': 'Flange_pair',
                'name': 'Flansch',
                'x': 140,
                'y': 10,
                'width': 60,
                'height': 60,
                'ports': [
                    {'id': 'inlet', 'kind': 'process', 'direction': 'in', 'x': 0, 'y': 30},
                    {'id': 'outlet', 'kind': 'process', 'direction': 'out', 'x': 60, 'y': 30},
                ],
            },
        ],
        'connections': [
            {
                'connection_id': 'joint',
                'from_entity_id': 'pipe',
                'from_port_id': 'outlet',
                'to_entity_id': 'flange',
                'to_port_id': 'inlet',
                'kind': 'process',
                'joint': True,
            },
            {
                'connection_id': 'dangling',
                'from_entity_id': 'pipe',
                'from_port_id': 'inlet',
                'to_entity_id': 'missing',
                'to_port_id': 'none',
                'kind': 'process',
            },
        ],
        'primitives': [
            {'primitive_id': 'label', 'type': 'text', 'x1': 10, 'y1': 5, 'text': 'R6'},
        ],
        'exposed_ports': [],
    }


def sample_svg():
    """Return one passive drawing carrier with identifiable embedded groups."""
    metadata = {
        'schema': 'plant-factory.plant-drawing-selection',
        'version': 1,
        'entities': [
            {'entity_id': 'pipe', 'template_id': 'Pipe_straight'},
            {'entity_id': 'flange', 'template_id': 'Flange_pair'},
        ],
        'connections': [{'connection_id': 'joint'}],
        'primitives': [{'primitive_id': 'label', 'type': 'text'}],
    }
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 120" width="260" height="120">'
        '<metadata id="pf-plant-drawing-metadata">%s</metadata>'
        '<g data-pf-connection-id="joint"><path d="M140 40H160"/></g>'
        '<g data-pf-entity-id="pipe"><rect x="20" y="30" width="140" height="60"/></g>'
        '<g data-pf-entity-id="flange"><rect x="160" y="30" width="60" height="60"/></g>'
        '<text x="30" y="20">R6</text>'
        '</svg>'
    ) % json.dumps(metadata, ensure_ascii=False, separators=(',', ':'))


def isolated_manager(temporary):
    """Build manager state whose mutable paths are exclusively temporary."""
    custom = Path(temporary) / 'custom'
    assemblies = Path(temporary) / 'assemblies'
    custom.mkdir(parents=True)
    assemblies.mkdir(parents=True)
    manager = {
        'templates_pfad': ROOT / 'public' / 'svg_templates',
        'custom_pfad': custom,
        'assembly_pfad': assemblies,
        'templates': {},
        'kategorien': {},
        'manifest': {},
    }
    templates_laden(manager)
    return manager, custom


def verify_bundled_assembly():
    """Verify the exact user-created assembly bundled with R6."""
    path = ROOT / 'public' / 'svg_templates' / 'assemblies' / 'assembly_template_mt4tvvee_tuvofeq.json'
    raw = json.loads(path.read_text(encoding='utf-8'))
    assembly = baugruppe_normalisieren(raw)
    check(assembly['name'] == 'Anlagen Entwurf' and assembly['category'] == 'Baugruppen',
          'Anlagen Entwurf ist als Baugruppen-Template gebündelt')
    check(len(assembly['entities']) == 31 and len(assembly['connections']) == 14
          and len(assembly['primitives']) == 45,
          'Gebündelte Vorlage enthält 31 Teile, 14 Verbindungen und 45 Details')


async def verify_structured_upload():
    """Round-trip structured metadata through the real custom upload path."""
    with tempfile.TemporaryDirectory(prefix='plant-factory-v64r6-') as temporary:
        manager, custom = isolated_manager(temporary)
        assembly = sample_assembly()
        metadata = {
            'name': 'R6 Strukturprobe',
            'kategorie': 'Custom',
            'family': 'custom-composition',
            'symbol_type': 'custom-composition',
            'library_role': 'custom',
            'breite': 260,
            'hoehe': 120,
            'view_box': [0, 0, 260, 120],
            'composition_mode': 'structured-assembly',
            'assembly_template_id': '../../ignored',
            'assembly_template': assembly,
            'assembly_export_bounds': {'x': -20, 'y': -20, 'width': 260, 'height': 120},
            'assembly_part_count': 999,
            'assembly_connection_count': 999,
        }
        result = await template_hochladen(
            manager,
            'r6_structured_probe.svg',
            sample_svg(),
            metadata,
        )
        check(result.get('erfolg') is True and result.get('template_id') == 'r6_structured_probe',
              'Strukturierte Custom-Vorlage wird isoliert gespeichert', str(result))
        check((custom / 'r6_structured_probe.svg').is_file(),
              'Custom-Datei liegt ausschließlich im temporären Testpfad')

        projection = alle_templates_abrufen(manager)['templates']['r6_structured_probe']
        check(projection['composition_mode'] == 'structured-assembly',
              'Template-Projektion erhält den strukturierten Modus')
        check(projection['assembly_template_id'] == 'r6_structured_probe',
              'Eingebettete, bereinigte Baugruppen-ID ist maßgeblich')
        check(projection['assembly_part_count'] == 2 and projection['assembly_connection_count'] == 1,
              'Teil- und Verbindungszahlen werden serverseitig berechnet')
        check(len(projection['assembly_template']['entities']) == 2
              and len(projection['assembly_template']['connections']) == 1,
              'Ungültige hängende Verbindungen werden aus eingebetteten Daten entfernt')
        check(projection['assembly_template']['entities'][0]['properties'] == {'note': 'kept'},
              'Nur skalare Entity-Eigenschaften passieren die Servervalidierung')
        check(projection['assembly_export_bounds']
              == {'x': -20.0, 'y': -20.0, 'width': 260.0, 'height': 120.0},
              'Exportgrenzen bleiben exakt und endlich')
        check('data-pf-entity-id="pipe"' in projection['svg']
              and '<script' not in projection['svg'].lower(),
              'Passive SVG-Gruppen bleiben adressierbar und aktive Inhalte fehlen')

        templates_laden(manager)
        restored = alle_templates_abrufen(manager)['templates']['r6_structured_probe']
        check(restored['composition_mode'] == 'structured-assembly'
              and restored['assembly_part_count'] == 2
              and restored['assembly_template']['entities'][1]['template_id'] == 'Flange_pair',
              'Strukturierte Metadaten überstehen das vollständige Neuladen')

        invalid = dict(metadata)
        invalid['composition_mode'] = 'unknown-mode'
        result = await template_hochladen(manager, 'r6_flat_probe.svg', sample_svg(), invalid)
        flat = alle_templates_abrufen(manager)['templates'][result['template_id']]
        check(flat['composition_mode'] == 'flat' and flat['assembly_template'] is None
              and flat['assembly_part_count'] == 0,
              'Unbekannte Kompositionsmodi fallen sicher auf flach zurück')


def main():
    """Execute the complete V64_r6 server contract."""
    verify_bundled_assembly()
    asyncio.run(verify_structured_upload())
    print('V64_r6 server contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()

