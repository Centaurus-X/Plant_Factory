#!/usr/bin/env python3
"""Exercise the V64_r3 drawing assembly library API with isolated persistence."""

import asyncio
import json
import sys
import tempfile
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from svg_editor_tool import (  # noqa: E402
    baugruppe_normalisieren,
    erstelle_app,
    sichere_baugruppen_id,
    template_manager_erstellen,
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


def create_isolated_server(temporary):
    """Create one server state whose custom and assembly stores live in a temp dir."""
    manager = template_manager_erstellen(str(ROOT / 'public' / 'svg_templates'))
    custom = Path(temporary) / 'custom_templates'
    assemblies = Path(temporary) / 'assemblies'
    custom.mkdir(parents=True)
    assemblies.mkdir(parents=True)
    manager['custom_pfad'] = custom
    manager['assembly_pfad'] = assemblies
    projects = Path(temporary) / 'projects'
    projects.mkdir(parents=True)
    return {
        'port': 0,
        'host': '127.0.0.1',
        'static_dir': ROOT / 'public',
        'projekte_verzeichnis': projects,
        'template_manager': manager,
    }, assemblies


def sample_assembly():
    """Return one representative assembly payload as produced by the browser."""
    return {
        'assembly_template_id': '../../etc/Rohr strecke',
        'name': 'Rohrstrecke',
        'category': 'Baugruppen',
        'width': 340,
        'height': 60,
        'entities': [
            {
                'entity_id': 'e1', 'template_id': 'Pipe_straight', 'name': 'Rohr', 'x': 0, 'y': 0,
                'width': 140, 'height': 60, 'rotation': 0,
                'ports': [
                    {'id': 'inlet', 'kind': 'process', 'direction': 'in', 'x': 0, 'y': 30, 'rx': 0, 'ry': 0.5},
                    {'id': 'outlet', 'kind': 'process', 'direction': 'out', 'x': 140, 'y': 30, 'rx': 1, 'ry': 0.5},
                ],
                'properties': {'note': 'ok', 'nested': {'drop': 'me'}},
            },
            {
                'entity_id': 'e2', 'template_id': 'Flange_pair', 'name': 'Flansch', 'x': 140, 'y': 0,
                'width': 60, 'height': 60, 'rotation': 0,
                'ports': [
                    {'id': 'inlet', 'kind': 'process', 'direction': 'in', 'x': 0, 'y': 30},
                    {'id': 'outlet', 'kind': 'process', 'direction': 'out', 'x': 60, 'y': 30},
                ],
            },
            {'entity_id': 'ghost', 'name': 'ohne Template'},
        ],
        'connections': [
            {'connection_id': 'c1', 'from_entity_id': 'e1', 'from_port_id': 'outlet',
             'to_entity_id': 'e2', 'to_port_id': 'inlet', 'kind': 'process', 'joint': True},
            {'connection_id': 'c2', 'from_entity_id': 'e2', 'from_port_id': 'outlet',
             'to_entity_id': 'missing', 'to_port_id': 'inlet', 'kind': 'process'},
        ],
        'primitives': [
            {'type': 'text', 'x1': 10, 'y1': 20, 'text': 'Label'},
            {'type': 'svg_fragment', 'markup': '<script>alert(1)</script>'},
            {'type': 'rect', 'x1': 0, 'y1': 0, 'x2': 10, 'y2': 10, 'fill': 'url(http://evil/x)'},
        ],
        'exposed_ports': [
            {'id': 'e1__inlet', 'entity_id': 'e1', 'port_id': 'inlet', 'kind': 'process', 'direction': 'in', 'x': 0, 'y': 30},
            {'id': 'e2__outlet', 'entity_id': 'e2', 'port_id': 'outlet', 'kind': 'process', 'direction': 'out', 'x': 200, 'y': 30},
        ],
    }


def verify_normalization():
    """Pure normalization contract without HTTP."""
    normalized = baugruppe_normalisieren(sample_assembly())
    check(normalized['assembly_template_id'] == 'etc_Rohr_strecke',
          'Baugruppen-ID wird traversal-sicher bereinigt', normalized['assembly_template_id'])
    check(len(normalized['entities']) == 2, 'Teile ohne Template werden verworfen')
    check(len(normalized['connections']) == 1 and normalized['connections'][0]['joint'] is True,
          'Hängende Verbindungen werden verworfen, Joints bleiben erhalten')
    check(len(normalized['primitives']) == 1 and normalized['primitives'][0]['type'] == 'text',
          'SVG-Fragmente und externe CSS-URLs werden nie gespeichert')
    check(normalized['entities'][0]['properties'] == {'note': 'ok'},
          'Nur skalare Eigenschaften werden übernommen')
    check(normalized['template_ids'] == ['Flange_pair', 'Pipe_straight'],
          'Template-IDs werden deterministisch abgeleitet')
    check(normalized['scope'] == 'library' and normalized['schema'] == 'plant-factory.plant-drawing-assembly',
          'Bibliotheks-Baugruppen tragen Schema und Scope')
    check(sichere_baugruppen_id('') == '' and sichere_baugruppen_id('a/b\\c..d') == 'a_b_c_d',
          'ID-Bereinigung ist vorhersagbar')
    failed = False
    try:
        baugruppe_normalisieren({'name': 'leer', 'entities': []})
    except ValueError:
        failed = True
    check(failed, 'Leere Baugruppen werden abgewiesen')


async def exercise_api():
    """HTTP contract for the assembly library."""
    with tempfile.TemporaryDirectory(prefix='plant-factory-v64r3-') as temporary:
        server, assembly_dir = create_isolated_server(temporary)
        app = erstelle_app(server)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            response = await client.get('/api/drawing-assemblies')
            payload = await response.json()
            check(response.status == 200 and payload.get('erfolg') is True and payload.get('assemblies') == [],
                  'Leere Baugruppen-Bibliothek ist erreichbar')

            response = await client.post('/api/drawing-assemblies', json={'assembly': sample_assembly()})
            payload = await response.json()
            check(response.status == 200 and payload.get('erfolg') is True,
                  'Baugruppe wird gespeichert', json.dumps(payload)[:200])
            stored = payload['assembly']
            check(stored['assembly_template_id'] == 'etc_Rohr_strecke'
                  and (assembly_dir / 'etc_Rohr_strecke.json').is_file(),
                  'Baugruppe liegt als JSON im isolierten Bibliotheksordner')
            check(not (Path(temporary) / 'etc').exists(), 'Kein Pfad außerhalb des Bibliotheksordners')
            text = (assembly_dir / 'etc_Rohr_strecke.json').read_text(encoding='utf-8')
            check('<script>' not in text and 'evil' not in text, 'Gespeicherte Datei enthält keine aktiven Inhalte')

            response = await client.get('/api/drawing-assemblies')
            payload = await response.json()
            check(len(payload['assemblies']) == 1 and payload['assemblies'][0]['name'] == 'Rohrstrecke',
                  'Bibliothek listet die gespeicherte Baugruppe')

            response = await client.post('/api/drawing-assemblies', json={'assembly': {'name': 'leer', 'entities': []}})
            check(response.status == 400, 'Ungültige Baugruppe wird mit 400 abgewiesen', str(response.status))
            response = await client.post('/api/drawing-assemblies', data='not json',
                                         headers={'Content-Type': 'application/json'})
            check(response.status == 400, 'Ungültiges JSON wird mit 400 abgewiesen', str(response.status))

            response = await client.post('/api/drawing-assemblies/loeschen',
                                         json={'assembly_template_id': '../etc_Rohr_strecke'})
            payload = await response.json()
            check(response.status == 200 and payload.get('entfernt') is True
                  and not (assembly_dir / 'etc_Rohr_strecke.json').exists(),
                  'Löschen entfernt die Datei nur innerhalb des Bibliotheksordners')
            response = await client.post('/api/drawing-assemblies/loeschen', json={'assembly_template_id': 'fehlt'})
            payload = await response.json()
            check(payload.get('entfernt') is False, 'Löschen einer unbekannten Baugruppe ist idempotent')

            response = await client.get('/api/templates')
            templates = await response.json()
            check('etc_Rohr_strecke' not in templates.get('templates', {}),
                  'Baugruppen erscheinen nicht im SVG-Template-Inventar (getrennte Inventare)')
        finally:
            await client.close()


def main():
    """Execute the complete V64_r3 server contract."""
    verify_normalization()
    asyncio.run(exercise_api())
    print('V64_r3 server contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()
