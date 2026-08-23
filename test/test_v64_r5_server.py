#!/usr/bin/env python3
"""Exercise the V64_r5 server additions: classic symbol metadata in the template
API (style, visual states, layer) and layers, visual states, routed lines,
regions and dimensions in the drawing assembly library."""

import asyncio
import sys
import tempfile
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from svg_editor_tool import (  # noqa: E402
    ASSEMBLY_LAYERS,
    ASSEMBLY_LINE_STYLES,
    MAX_PRIMITIVE_POINTS,
    baugruppe_normalisieren,
    erstelle_app,
    template_manager_erstellen,
)

PASSED = 0
CLASSIC_TEMPLATES = (
    'Classic_tube', 'Classic_tube_flanged', 'Classic_tube_tap', 'Classic_flange', 'Classic_flange_bolted',
    'Classic_tube_elbow', 'Classic_tube_ubend', 'Classic_tube_head', 'Classic_capillary', 'Classic_capillary_elbow',
    'Classic_swagelok', 'Classic_line', 'Classic_valve', 'Classic_control_valve', 'Classic_check_valve',
    'Classic_flag', 'Classic_flag_back', 'Classic_instrument', 'Classic_furnace', 'Classic_cooler',
    'Classic_column', 'Classic_coil_circle', 'Classic_mixer_box', 'Classic_cylinder',
)
FRAME_TEMPLATES = ('Frame_post', 'Frame_beam', 'Frame_foot', 'Frame_clamp', 'Frame_floor')


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
    """Return one classic assembly with every r5 field, including hostile values."""
    return {
        'assembly_template_id': 'r5 klassik strang',
        'name': 'R5-Klassik-Strang',
        'width': 600,
        'height': 400,
        'entities': [
            {
                'entity_id': 'tube', 'template_id': 'Classic_tube', 'name': 'Rohr', 'x': 0, 'y': 0,
                'width': 160, 'height': 48, 'rotation': 0, 'visual_state': 'hot', 'layer': 'process',
                'ports': [
                    {'id': 'inlet', 'kind': 'process', 'direction': 'in', 'x': 0, 'y': 24},
                    {'id': 'outlet', 'kind': 'process', 'direction': 'out', 'x': 160, 'y': 24},
                ],
            },
            {
                'entity_id': 'post', 'template_id': 'Frame_post', 'name': 'Pfosten', 'x': 200, 'y': 0,
                'width': 24, 'height': 400, 'rotation': 0, 'visual_state': 'x' * 80, 'layer': 'structure',
                'ports': [
                    {'id': 'top', 'kind': 'structure', 'direction': 'bidirectional', 'x': 12, 'y': 0},
                    {'id': 'bottom', 'kind': 'structure', 'direction': 'bidirectional', 'x': 12, 'y': 400},
                ],
            },
            {
                'entity_id': 'beam', 'template_id': 'Frame_beam', 'name': 'Träger', 'x': 212, 'y': 0,
                'width': 400, 'height': 24, 'layer': 'sky', 'visual_state': None,
                'ports': [{'id': 'left', 'kind': 'structure', 'x': 0, 'y': 12}],
            },
        ],
        'connections': [
            {'connection_id': 'j1', 'from_entity_id': 'post', 'from_port_id': 'top',
             'to_entity_id': 'beam', 'to_port_id': 'left', 'kind': 'structure', 'joint': True},
            {'connection_id': 'j2', 'from_entity_id': 'tube', 'from_port_id': 'outlet',
             'to_entity_id': 'post', 'to_port_id': 'top', 'kind': 'gravity', 'joint': True},
        ],
        'primitives': [
            {'type': 'polyline', 'points': [[64, 318], {'x': 255, 'y': 318}, [255, 110], 'junk', [1]],
             'line_style': 'hot', 'animated': True, 'layer': 'process', 'font_family': 'Arial, Helvetica, sans-serif'},
            {'type': 'polyline', 'points': [[index, index] for index in range(MAX_PRIMITIVE_POINTS + 40)],
             'line_style': 'plasma', 'animated': 'yes', 'layer': 'nowhere'},
            {'type': 'region', 'x1': 60, 'y1': 260, 'x2': 230, 'y2': 520, 'label': 'Ventilpanel',
             'label_position': 'above', 'layer': 'annotation'},
            {'type': 'dimension', 'x1': 300, 'y1': 38, 'x2': 890, 'y2': 38, 'text': '1800 mm',
             'label_position': 'sideways', 'layer': 'annotation'},
            {'type': 'text', 'x1': 10, 'y1': 10, 'text': 'Swagelok', 'font_size': 11,
             'font_family': 'url(https://evil.example/font.css)'},
            {'type': 'svg_fragment', 'markup': '<g></g>'},
        ],
        'exposed_ports': [],
    }


def verify_normalization():
    """Pure normalization contract for the r5 assembly fields."""
    check(ASSEMBLY_LAYERS == ('process', 'structure', 'annotation'), 'Server kennt die drei Zeichenebenen')
    check(len(ASSEMBLY_LINE_STYLES) == 9 and 'capillary' in ASSEMBLY_LINE_STYLES, 'Server kennt die neun Leitungsstile')
    normalized = baugruppe_normalisieren(sample_assembly())
    tube, post, beam = normalized['entities']
    check(tube['visual_state'] == 'hot' and tube['layer'] == 'process', 'Darstellungszustand und Ebene werden gespeichert')
    check(len(post['visual_state']) == 40 and post['layer'] == 'structure', 'Zustand wird begrenzt, Gestellebene bleibt erhalten')
    check(beam['layer'] == 'process' and beam['visual_state'] == '', 'Unbekannte Ebene fällt auf Prozess, leerer Zustand bleibt leer')
    check(post['ports'][0]['kind'] == 'structure', 'Gestell-Ports behalten ihre Art')
    kinds = [connection['kind'] for connection in normalized['connections']]
    check(kinds == ['structure', 'process'], 'Gestell-Joints bleiben, unbekannte Arten werden zu Prozess', str(kinds))
    primitives = normalized['primitives']
    check(len(primitives) == 4 and all(primitive['type'] != 'text' for primitive in primitives),
          'SVG-Fragmente und Texte mit externen Schrift-URLs werden nie gespeichert', str(len(primitives)))
    routed = primitives[0]
    check(routed['type'] == 'polyline' and routed['points'] == [[64.0, 318.0], [255.0, 318.0], [255.0, 110.0]]
          and routed['line_style'] == 'hot' and routed['animated'] is True and routed['font_family'] == 'Arial, Helvetica, sans-serif',
          'Leitung behält gültige Punkte, Stil, Animation und Schrift', str(routed))
    overflow = primitives[1]
    check(len(overflow['points']) == MAX_PRIMITIVE_POINTS and overflow['line_style'] == 'plain'
          and overflow['animated'] is True and overflow['layer'] == 'process',
          'Punktlisten werden begrenzt, unbekannter Stil und Ebene neutralisiert')
    region = primitives[2]
    check(region['label'] == 'Ventilpanel' and region['label_position'] == 'above' and region['layer'] == 'annotation',
          'Bereich mit Beschriftung über dem Rahmen auf der Beschriftungsebene')
    dimension = primitives[3]
    check(dimension['text'] == '1800 mm' and dimension['label_position'] == 'inside', 'Bemaßung mit bereinigter Beschriftungslage')
    benign = baugruppe_normalisieren({'name': 'Text', 'entities': sample_assembly()['entities'][:1], 'connections': [], 'primitives': [
        {'type': 'text', 'x1': 10, 'y1': 10, 'text': 'Swagelok', 'font_size': 11, 'font_family': 'Arial, Helvetica, sans-serif',
         'text_anchor': 'middle'}]})['primitives'][0]
    check(benign['font_family'] == 'Arial, Helvetica, sans-serif' and benign['font_size'] == 11.0,
          'Texte behalten Schriftfamilie und Schriftgröße')
    check(normalized['assembly_template_id'] == 'r5_klassik_strang', 'Baugruppen-ID bleibt traversal-sicher')


async def exercise_api():
    """HTTP contract: template API carries classic metadata, library round-trips r5 fields."""
    with tempfile.TemporaryDirectory(prefix='plant-factory-v64r5-') as temporary:
        server = create_isolated_server(temporary)
        app = erstelle_app(server)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            response = await client.get('/api/templates')
            payload = await response.json()
            templates = payload.get('templates', {})
            check(len(templates) >= 71, 'Template-API liefert mindestens 71 Templates', str(len(templates)))
            for template_id in CLASSIC_TEMPLATES:
                metadata = templates.get(template_id, {})
                check(metadata.get('style') == 'classic' and metadata.get('layer') == 'process' and bool(metadata.get('visual_states')),
                      'Klassik-Bauteil über die API: ' + template_id)
            for template_id in FRAME_TEMPLATES:
                metadata = templates.get(template_id, {})
                check(metadata.get('layer') == 'structure' and all(port.get('kind') == 'structure' for port in metadata.get('ports', [])),
                      'Gestellteil auf der Gestellebene mit Gestell-Ports: ' + template_id)
            check(templates['Classic_tube'].get('visual_states') == ['neutral', 'flow', 'heat', 'hot', 'cold']
                  and templates['Classic_tube'].get('default_visual_state') == 'flow',
                  'Gefülltes Rohr kennt neutral/flow/heat/hot/cold und startet mit flow')
            check(templates['Classic_valve'].get('visual_states') == ['neutral', 'open', 'closed']
                  and templates['Classic_valve'].get('default_visual_state') == 'open', 'Handventil kennt open/closed')
            check(templates['Classic_tube_flanged'].get('stretch') == {'axis': 'x', 'fixed': [[0, 22], [158, 160]]},
                  'Rohr mit Flansch hält den Flanschbalken beim Strecken fest')
            check(templates['Classic_tube_ubend'].get('stretch') == {'axis': 'y', 'fixed': [[109, 160]]},
                  'U-Bogen streckt sich nur in der Höhe')
            tap_ports = [(port['id'], port['x'], port['y']) for port in templates['Classic_tube_tap']['ports']]
            check(tap_ports == [('inlet', 0, 24), ('outlet', 48, 24), ('tap_a', 24, 13), ('tap_b', 24, 35)],
                  'Rohrstück mit Seitenanschluss trägt Wandanschlüsse an beiden Seiten', str(tap_ports))
            check(templates['Pipe_straight'].get('style') == 'standard' and templates['Pipe_straight'].get('visual_states') == [],
                  'Standard-Symbole bleiben unverändert (Stil standard, keine Zustände)')
            svg = templates['Classic_tube']['svg']
            check('<animate attributeName="stroke-dashoffset"' in svg and 'class="pc-dash"' in svg
                  and '[data-pf-visual-state="hot"] .pf-pid-v1 .pc-bore' in svg,
                  'Klassik-SVG trägt Laufstriche und zustandsabhängige Farben')

            response = await client.post('/api/drawing-assemblies', json={'assembly': sample_assembly()})
            payload = await response.json()
            check(response.status == 200 and payload.get('erfolg') is True, 'Klassik-Baugruppe wird gespeichert')
            response = await client.get('/api/drawing-assemblies')
            listing = await response.json()
            stored = listing['assemblies'][0]
            check(stored['entities'][0]['visual_state'] == 'hot' and stored['entities'][1]['layer'] == 'structure',
                  'Bibliothek liefert Zustand und Ebene zurück')
            check([connection['kind'] for connection in stored['connections']] == ['structure', 'process'],
                  'Bibliothek liefert Gestell-Joints zurück')
            check(stored['primitives'][0]['points'][1] == [255.0, 318.0] and stored['primitives'][2]['type'] == 'region'
                  and stored['primitives'][3]['type'] == 'dimension', 'Bibliothek liefert Leitungen, Bereiche und Bemaßungen zurück')
            response = await client.post('/api/drawing-assemblies/loeschen', json={'assembly_template_id': 'r5_klassik_strang'})
            payload = await response.json()
            check(payload.get('entfernt') is True, 'Testbaugruppe wird wieder entfernt')
        finally:
            await client.close()


def main():
    """Execute the complete V64_r5 server contract."""
    verify_normalization()
    asyncio.run(exercise_api())
    print('V64_r5 server contract passed: %d checks.' % PASSED)


if __name__ == '__main__':
    main()
