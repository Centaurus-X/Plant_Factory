#!/usr/bin/env python3
"""Exercise the V64_r4 server additions: stretch profiles in the template API and
geometry flags (mirroring, inversion, scale mode, viewBox) in the assembly library."""

import asyncio
import sys
import tempfile
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from svg_editor_tool import (  # noqa: E402
    baugruppe_normalisieren,
    erstelle_app,
    template_manager_erstellen,
)

PASSED = 0
R4_TEMPLATES = ('Swagelok_union', 'Swagelok_tee', 'Swagelok_elbow', 'Capillary_line',
                'Pipe_cap', 'Boundary_connector', 'Gas_mixer')


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
    }


def sample_assembly():
    """Return one assembly whose parts carry every r4 geometry flag."""
    return {
        'assembly_template_id': 'r4 geometrie',
        'name': 'R4-Geometrie',
        'width': 520,
        'height': 60,
        'entities': [
            {
                'entity_id': 'pipe', 'template_id': 'Pipe_straight', 'name': 'Rohr', 'x': 0, 'y': 0,
                'width': 410, 'height': 60, 'rotation': 0,
                'flip_x': True, 'flip_y': 'yes', 'inverted': True, 'scale_mode': 'stretch',
                'stretch': {'axis': 'x', 'fixed': [[56, 78], [0, 12], [128, 140], [5], ['a', 'b'], [90, 40]]},
                'view_box': [0, 0, 140, 60],
                'ports': [
                    {'id': 'inlet', 'kind': 'process', 'direction': 'out', 'x': 410, 'y': 30, 'rx': 0, 'ry': 0.5},
                    {'id': 'outlet', 'kind': 'process', 'direction': 'in', 'x': 0, 'y': 30, 'rx': 1, 'ry': 0.5},
                ],
            },
            {
                'entity_id': 'flag', 'template_id': 'Boundary_connector', 'name': 'Anschluss', 'x': 410, 'y': 0,
                'width': 100, 'height': 60, 'rotation': 0, 'scale_mode': 'weird', 'stretch': 'nonsense',
                'view_box': 'broken',
                'ports': [{'id': 'line', 'kind': 'process', 'direction': 'bidirectional', 'x': 0, 'y': 30}],
            },
        ],
        'connections': [
            {'connection_id': 'c1', 'from_entity_id': 'pipe', 'from_port_id': 'outlet',
             'to_entity_id': 'flag', 'to_port_id': 'line', 'kind': 'process', 'joint': True},
        ],
        'primitives': [],
        'exposed_ports': [],
    }


def verify_normalization():
    """Pure normalization contract for the r4 entity fields."""
    normalized = baugruppe_normalisieren(sample_assembly())
    pipe, flag = normalized['entities']
    check(pipe['flip_x'] is True and pipe['flip_y'] is True and pipe['inverted'] is True,
          'Spiegelung und Invertierung werden als Wahrheitswerte gespeichert')
    check(pipe['scale_mode'] == 'stretch' and flag['scale_mode'] == 'uniform',
          'Skalierungsmodus wird validiert, unbekannte Werte werden proportional')
    check(pipe['stretch'] == {'axis': 'x', 'fixed': [[0.0, 12.0], [56.0, 78.0], [128.0, 140.0]]},
          'Streckprofil wird bereinigt und sortiert', str(pipe['stretch']))
    check(flag['stretch'] is None, 'Ungültiges Streckprofil wird verworfen')
    check(pipe['view_box'] == [0, 0, 140, 60] and flag['view_box'] == [0, 0, 100, 60],
          'viewBox wird übernommen oder aus der Größe abgeleitet', str(flag['view_box']))
    check(pipe['ports'][0]['direction'] == 'out' and pipe['ports'][0]['x'] == 410,
          'Invertierte und gespiegelte Portdaten bleiben erhalten')
    check(normalized['assembly_template_id'] == 'r4_geometrie', 'Baugruppen-ID bleibt traversal-sicher')


async def exercise_api():
    """HTTP contract: template API carries stretch profiles, library round-trips geometry."""
    with tempfile.TemporaryDirectory(prefix='plant-factory-v64r4-') as temporary:
        server = create_isolated_server(temporary)
        app = erstelle_app(server)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            response = await client.get('/api/templates')
            payload = await response.json()
            templates = payload.get('templates', {})
            for template_id in R4_TEMPLATES:
                check(template_id in templates and templates[template_id].get('standard') == 'PF-PID-V1',
                      'Neues PF-PID-V1-Bauteil über die API: ' + template_id)
            check(templates['Pipe_straight'].get('stretch') == {'axis': 'x', 'fixed': [[0, 12], [56, 78], [128, 140]]},
                  'Template-API liefert das Streckprofil des Rohrs', str(templates['Pipe_straight'].get('stretch')))
            check(templates['Tube_furnace'].get('stretch') is None, 'Geräte tragen kein Streckprofil')
            check(templates['Gas_mixer']['ports'][0]['id'] == 'inlet_a' and len(templates['Gas_mixer']['ports']) == 4,
                  'Gasmischer besitzt zwei Eingänge, Ausgang und Instrumentenanschluss')
            check('data-pf-role="flow-arrow"' in templates['Pipe_elbow_90']['svg']
                  and 'data-pf-arrow-center=' in templates['Pipe_elbow_90']['svg'],
                  'Rohrbogen markiert seinen Flusspfeil für die Invertierung')
            check('data-pf-role="entity-label"' in templates['Boundary_connector']['svg'],
                  'Grenzstelle besitzt ein Beschriftungsziel')
            check('M77 23 V60' not in templates['Pipe_tee']['svg'], 'T-Stück ohne Streulinie durch die Oberwand')

            response = await client.post('/api/drawing-assemblies', json={'assembly': sample_assembly()})
            payload = await response.json()
            check(response.status == 200 and payload.get('erfolg') is True, 'Baugruppe mit Geometrieflags wird gespeichert')
            response = await client.get('/api/drawing-assemblies')
            listing = await response.json()
            stored = listing['assemblies'][0]['entities'][0]
            check(stored['flip_x'] is True and stored['inverted'] is True and stored['scale_mode'] == 'stretch'
                  and stored['stretch']['axis'] == 'x' and stored['view_box'] == [0, 0, 140, 60],
                  'Bibliothek liefert Spiegelung, Invertierung, Skalierungsmodus, Streckprofil und viewBox zurück')
            response = await client.post('/api/drawing-assemblies/loeschen', json={'assembly_template_id': 'r4_geometrie'})
            payload = await response.json()
            check(payload.get('entfernt') is True, 'Testbaugruppe wird wieder entfernt')
        finally:
            await client.close()


def main():
    """Execute the complete V64_r4 server contract."""
    verify_normalization()
    asyncio.run(exercise_api())
    print('V64_r4 server contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()
