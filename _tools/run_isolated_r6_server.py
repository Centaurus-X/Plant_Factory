#!/usr/bin/env python3
"""Run Plant Factory with isolated mutable stores for browser release tests."""

import argparse
import sys
from pathlib import Path

from aiohttp import web


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from svg_editor_tool import erstelle_app, template_manager_erstellen, templates_laden  # noqa: E402


def parse_arguments(arguments=None):
    """Parse explicit test-server paths and network binding."""
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=18090)
    parser.add_argument('--mutable-root', required=True)
    return parser.parse_args(arguments)


def isolated_server(arguments):
    """Create server state whose writes remain below one explicit test root."""
    mutable_root = Path(arguments.mutable_root).resolve()
    custom = mutable_root / 'custom'
    projects = mutable_root / 'projects'
    custom.mkdir(parents=True, exist_ok=True)
    projects.mkdir(parents=True, exist_ok=True)

    templates_root = ROOT / 'public' / 'svg_templates'
    manager = template_manager_erstellen(str(templates_root))
    manager['custom_pfad'] = custom
    manager['assembly_pfad'] = templates_root / 'assemblies'
    templates_laden(manager)
    return {
        'host': arguments.host,
        'port': arguments.port,
        'static_dir': ROOT / 'public',
        'projekte_verzeichnis': projects,
        'template_manager': manager,
    }


def main(arguments=None):
    """Start the isolated browser-test server."""
    parsed = parse_arguments(arguments)
    server = isolated_server(parsed)
    print('R6 isolated test server: http://%s:%s' % (server['host'], server['port']), flush=True)
    web.run_app(
        erstelle_app(server),
        host=server['host'],
        port=server['port'],
        print=None,
    )


if __name__ == '__main__':
    main()

