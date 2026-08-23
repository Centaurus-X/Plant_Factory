#!/usr/bin/env python3
"""Exercise the local HTTP API with isolated project persistence."""

import asyncio
import json
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree

from aiohttp.test_utils import TestClient, TestServer


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from svg_editor_tool import SECURITY_HEADERS, erstelle_app, template_manager_erstellen


def check(condition, label, detail=''):
    if not condition:
        suffix = ': %s' % detail if detail else ''
        raise AssertionError(label + suffix)
    print('   ok  %s' % label)


def create_isolated_server(projects_path, custom_templates_path):
    manager = template_manager_erstellen(str(ROOT / 'public' / 'svg_templates'))
    custom_templates_path.mkdir(parents=True)
    manager['custom_pfad'] = custom_templates_path
    return {
        'port': 0,
        'host': '127.0.0.1',
        'static_dir': ROOT / 'public',
        'projekte_verzeichnis': projects_path,
        'template_manager': manager,
    }


async def exercise_api():
    with tempfile.TemporaryDirectory(prefix='plant-factory-v61-') as temporary:
        projects = Path(temporary) / 'projects'
        projects.mkdir(parents=True)
        custom_templates = Path(temporary) / 'custom_templates'
        app = erstelle_app(create_isolated_server(projects, custom_templates))
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            response = await client.get('/')
            body = await response.text()
            check(response.status == 200 and ('64 · V9' in body or '63.4 · V9' in body),
                  'Editor-Einstieg mit kompatibler Version erreichbar')
            missing_headers = [name for name in SECURITY_HEADERS if name not in response.headers]
            check(not missing_headers, 'Security-Header vollständig', ', '.join(missing_headers))

            response = await client.get('/api/templates')
            templates = await response.json()
            check(response.status == 200 and len(templates.get('templates', {})) > 0,
                  'Template-API liefert Bibliothek')

            composition_svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"
              onload="alert(1)">
              <script>alert(1)</script>
              <g data-pf-state-target="flow"><path d="M0 30H120"/></g>
            </svg>'''
            response = await client.post('/api/template/hochladen', json={
                'dateiname': '../../Rohrofen_Baugruppe.svg',
                'svg': composition_svg,
                'metadaten': {
                    'name': 'Rohrofen-Baugruppe',
                    'kategorie': 'Custom',
                    'family': 'custom-composition',
                    'ports': [
                        {
                            'id': 'feed',
                            'name': 'Edukt',
                            'kind': 'process',
                            'direction': 'in',
                            'x': 0,
                            'y': 30,
                            'rx': 0,
                            'ry': 0.5,
                        },
                    ],
                    'animierbare_bereiche': ['[data-pf-state-target="flow"]'],
                },
            })
            uploaded = await response.json()
            template_id = uploaded.get('template_id', '')
            check(response.status == 200 and uploaded.get('erfolg') is True,
                  'V64-Baugruppe wird über die Inventar-API gespeichert', str(uploaded))
            custom_file = custom_templates / (template_id + '.svg')
            check(custom_file.is_file(), 'Custom-Template bleibt im isolierten Inventarpfad')
            custom_text = custom_file.read_text(encoding='utf-8')
            check('<script' not in custom_text.lower() and 'onload=' not in custom_text.lower(),
                  'Inventarübernahme sanitisiert aktive SVG-Inhalte')
            check('data-pf-state-target="flow"' in custom_text and '<!-- META:' in custom_text,
                  'Semantische Animationsziele und Metadaten bleiben erhalten')

            response = await client.get('/api/templates')
            reloaded_templates = await response.json()
            uploaded_template = reloaded_templates.get('templates', {}).get(template_id, {})
            check(uploaded_template.get('standard') == 'CUSTOM'
                  and uploaded_template.get('ports', [{}])[0].get('id') == 'feed',
                  'Gespeicherte Baugruppe ist sofort mit semantischem Port im Inventar verfügbar')

            response = await client.get('/api/v9/config')
            config = await response.json()
            config_version = (config.get('meta') or [{}])[0].get('version')
            check(response.status == 200 and config_version == 9,
                  'V9-Konfigurationsvertrag erreichbar', json.dumps(config)[:200])

            hostile_svg = '''<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
              <script>alert(1)</script><path id="safe" d="M0 0h10"/>
            </svg>'''
            response = await client.post('/api/exportieren', json={
                'dateiname': '../../anlage',
                'svg': hostile_svg,
            })
            exported = await response.text()
            check(response.status == 200 and '<script' not in exported.lower() and 'onload' not in exported.lower(),
                  'Export sanitisiert aktive SVG-Inhalte')
            check('filename="anlage.svg"' in response.headers.get('Content-Disposition', ''),
                  'Export-Dateiname ist traversal-sicher')
            ElementTree.fromstring(exported)

            response = await client.post('/api/speichern', json={
                'name': '../../Plant 01',
                'svg': hostile_svg,
                'metadaten': {'revision': 'V61.1'},
            })
            saved = await response.json()
            check(response.status == 200 and saved.get('erfolg') is True,
                  'Projekt wird atomar gespeichert')
            check((projects / 'Plant 01.svg').is_file() and (projects / 'Plant 01.json').is_file(),
                  'Projektpfad bleibt im isolierten Verzeichnis')
            check(not (Path(temporary).parent / 'Plant 01.svg').exists(),
                  'kein Pfadtraversal beim Speichern')

            response = await client.get('/api/laden', params={'name': '../../Plant 01'})
            loaded = await response.json()
            check(response.status == 200 and loaded.get('metadaten', {}).get('revision') == 'V61.1',
                  'gespeichertes Projekt vollständig ladbar')
        finally:
            await client.close()


def main():
    asyncio.run(exercise_api())


if __name__ == '__main__':
    main()
