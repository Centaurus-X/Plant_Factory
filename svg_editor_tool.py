#!/usr/bin/env python3
"""Functional local server for the Plant Factory HMI/P&ID workspace V64.

The module intentionally uses plain functions, immutable route composition and
explicit dictionaries for state. It keeps the established HTTP contracts while
restoring the V57.3 security hardening and adding deterministic filesystem
behavior for production-style local deployments.
"""

import argparse
import json
import os
import re
import tempfile
from functools import partial
from pathlib import Path
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree

from aiohttp import web

from _server_v9 import register_v9_routes, server_settings


BASE_DIR = Path(__file__).resolve().parent
SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
MAX_SVG_BYTES = 10 * 1024 * 1024
ASSEMBLY_SCHEMA = 'plant-factory.plant-drawing-assembly'
ASSEMBLY_VERSION = 1
MAX_ASSEMBLY_BYTES = 2 * 1024 * 1024
MAX_ASSEMBLY_PARTS = 500
ASSEMBLY_ID_PATTERN = re.compile(r'[^A-Za-z0-9_-]+')
ASSEMBLY_CONNECTION_KINDS = ('process', 'utility', 'signal', 'power', 'structure')
ASSEMBLY_PRIMITIVE_TYPES = ('line', 'rect', 'ellipse', 'text', 'polyline', 'region', 'dimension')
ASSEMBLY_SCALE_MODES = ('uniform', 'stretch', 'free')
ASSEMBLY_LAYERS = ('process', 'structure', 'annotation')
ASSEMBLY_LINE_STYLES = ('plain', 'pipe', 'capillary', 'hot', 'cold', 'coolant', 'purge', 'feed', 'signal')
ASSEMBLY_LABEL_POSITIONS = ('inside', 'above')
MAX_PRIMITIVE_POINTS = 256
SECURITY_HEADERS = {
    'Content-Security-Policy': (
        "default-src 'self'; img-src 'self' data: blob:; "
        "style-src 'self' 'unsafe-inline'; script-src 'self'; "
        "connect-src 'self'; font-src 'self'; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    ),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
}

ElementTree.register_namespace('', SVG_NAMESPACE)
ElementTree.register_namespace('xlink', XLINK_NAMESPACE)


def lokaler_xml_name(name: str) -> str:
    """Return the local part of a namespaced XML name."""
    return str(name or '').rsplit('}', 1)[-1].lower()


def hat_externe_css_url(value: str) -> bool:
    """Return whether a CSS url() reference points outside the SVG document."""
    for match in re.finditer(r'url\s*\(([^)]*)\)', str(value or ''), re.IGNORECASE):
        target = match.group(1).strip().strip('"\'')
        if target and not target.startswith('#'):
            return True
    return False


def _normalisiere_pfad(path_value: Any, base_dir: Path = BASE_DIR) -> Path:
    """Resolve a configured path relative to the application root."""
    target = Path(path_value)
    if not target.is_absolute():
        target = base_dir / target
    return target.resolve()


def atomar_text_schreiben(ziel: Path, inhalt: str) -> None:
    """Write UTF-8 text through a same-directory temporary file and replace it."""
    target = Path(ziel)
    target.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix='.%s.' % target.name,
        suffix='.tmp',
        dir=str(target.parent),
        text=True,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, 'w', encoding='utf-8', newline='') as handle:
            handle.write(str(inhalt))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, target)
    except Exception:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def svg_bereinigen(svg_inhalt: str) -> str:
    """Validate SVG XML and remove active or externally loaded content."""
    text = str(svg_inhalt or '')
    if not text.strip():
        raise ValueError('SVG-Inhalt fehlt')
    if len(text.encode('utf-8')) > MAX_SVG_BYTES:
        raise ValueError('SVG-Datei überschreitet 10 MB')
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)', text, re.IGNORECASE):
        raise ValueError('DOCTYPE und ENTITY sind in SVG-Dateien nicht erlaubt')

    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError as exc:
        raise ValueError('Ungültiges SVG/XML: %s' % exc) from exc
    if lokaler_xml_name(root.tag) != 'svg':
        raise ValueError('Wurzelelement muss <svg> sein')

    blocked_tags = {
        'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video'
    }
    unsafe_value = re.compile(
        r'(?:javascript|vbscript|data|file|https?):|@import|expression\s*\(',
        re.IGNORECASE,
    )

    parents = {
        child: parent
        for parent in root.iter()
        for child in parent
    }
    for node in list(root.iter()):
        local_tag = lokaler_xml_name(node.tag)
        if local_tag in blocked_tags:
            parent = parents.get(node)
            if parent is not None:
                parent.remove(node)
            continue

        if local_tag == 'style' and (
                unsafe_value.search(node.text or '')
                or hat_externe_css_url(node.text or '')):
            parent = parents.get(node)
            if parent is not None:
                parent.remove(node)
            continue

        for attribute, value in list(node.attrib.items()):
            local_attribute = lokaler_xml_name(attribute)
            content = str(value or '').strip()
            if local_attribute.startswith('on'):
                del node.attrib[attribute]
                continue
            if local_attribute in {'href', 'src'} and content and not content.startswith('#'):
                del node.attrib[attribute]
                continue
            if unsafe_value.search(content) or hat_externe_css_url(content):
                del node.attrib[attribute]

    return ElementTree.tostring(root, encoding='unicode')


def sicherer_meta_kommentar(metadaten: Dict[str, Any]) -> str:
    """Encode metadata as a valid XML comment without a closing injection."""
    payload = json.dumps(metadaten or {}, ensure_ascii=False)
    payload = payload.replace('--', '\\u002d\\u002d')
    return '<!-- META: %s -->\n' % payload


async def sicherheits_header_middleware(request: web.Request, handler):
    """Attach local-tool security headers to normal and HTTP error responses."""
    try:
        response = await handler(request)
    except web.HTTPException as exc:
        response = exc
    for name, value in SECURITY_HEADERS.items():
        response.headers[name] = value
    return response


sicherheits_header_middleware = web.middleware(sicherheits_header_middleware)


def sicherer_projektname(name: str) -> str:
    """Restrict project names to portable, traversal-safe characters."""
    return ''.join(
        character
        for character in str(name or '')
        if character.isalnum() or character in (' ', '-', '_')
    ).strip()


def sicherer_dateiname(name: str, fallback: str, suffix: str) -> str:
    """Return a portable filename with a required suffix."""
    cleaned = ''.join(
        character
        for character in str(name or '')
        if character.isalnum() or character in (' ', '-', '_', '.')
    ).strip(' .')
    if not cleaned:
        cleaned = fallback
    if not cleaned.lower().endswith(suffix.lower()):
        cleaned += suffix
    return cleaned


def metadaten_extrahieren(svg_inhalt: str) -> Dict[str, Any]:
    """Extract optional JSON metadata from the established SVG comment format."""
    match = re.search(r'<!--\s*META:\s*({.*?})\s*-->', str(svg_inhalt or ''), re.DOTALL)
    if not match:
        return {}
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _positive_number(value: Any, fallback: float) -> float:
    """Return a finite positive number without changing valid integer values."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if not parsed > 0 or parsed == float('inf'):
        return fallback
    return int(parsed) if parsed.is_integer() else parsed


def _svg_geometrie(svg_inhalt: str) -> Dict[str, Any]:
    """Read the root viewBox and intrinsic dimensions from sanitized SVG XML."""
    root = ElementTree.fromstring(svg_inhalt)
    view_box_text = str(root.attrib.get('viewBox', '') or '').replace(',', ' ')
    view_box_values = []
    for token in view_box_text.split():
        try:
            view_box_values.append(float(token))
        except ValueError:
            view_box_values = []
            break
    if len(view_box_values) != 4 or view_box_values[2] <= 0 or view_box_values[3] <= 0:
        width = _positive_number(re.sub(r'[^0-9.+-]', '', root.attrib.get('width', '')), 100)
        height = _positive_number(re.sub(r'[^0-9.+-]', '', root.attrib.get('height', '')), 100)
        view_box_values = [0, 0, width, height]
    return {
        'view_box': [
            int(value) if float(value).is_integer() else value
            for value in view_box_values
        ],
        'intrinsic_width': _positive_number(root.attrib.get('width'), view_box_values[2]),
        'intrinsic_height': _positive_number(root.attrib.get('height'), view_box_values[3]),
    }


def _template_capabilities(metadata: Dict[str, Any]) -> Dict[str, bool]:
    """Merge explicit template capabilities with the safe PF-PID-V1 defaults."""
    defaults = {
        'selectable': True,
        'movable': True,
        'resizable': True,
        'rotatable': True,
        'connectable': True,
        'bindable': True,
        'animatable': True,
        'configurable': True,
        'auto_create_hmi_widgets': False,
    }
    configured = metadata.get('capabilities', metadata.get('interaction', {}))
    if isinstance(configured, dict):
        for key in defaults:
            if key in configured:
                defaults[key] = bool(configured[key])
    defaults['auto_create_hmi_widgets'] = False
    return defaults


def _integer_value(value: Any, fallback: int) -> int:
    """Return a deterministic integer for optional metadata fields."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _normalisierte_view_box(value: Any, fallback: list) -> list:
    """Return a valid four-number viewBox list."""
    source = value if isinstance(value, list) else []
    if len(source) != 4:
        return list(fallback)
    result = []
    try:
        result = [float(item) for item in source]
    except (TypeError, ValueError):
        return list(fallback)
    if result[2] <= 0 or result[3] <= 0:
        return list(fallback)
    return [
        int(item) if float(item).is_integer() else item
        for item in result
    ]


def _standard_kennung(metadata: Dict[str, Any]) -> str:
    """Resolve the canonical standard identifier across historical metadata."""
    direct = str(metadata.get('standard', metadata.get('standard_id', '')) or '').strip()
    if direct:
        return direct
    object_standard = metadata.get('object_standard', {})
    if isinstance(object_standard, dict):
        return str(object_standard.get('id', '') or '').strip()
    return ''


def _hmi_richtlinie(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize the explicit-only HMI policy for process symbols."""
    configured = metadata.get('hmi_policy', {})
    policy = dict(configured) if isinstance(configured, dict) else {}
    controls = policy.get('allowed_controls', ['text', 'indicator', 'toggle', 'button', 'slider'])
    if not isinstance(controls, list):
        controls = ['text', 'indicator', 'toggle', 'button', 'slider']
    policy.update({
        'auto_create_widgets': False,
        'default_control': None,
        'allowed_controls': controls,
        'button_policy': 'optional_explicit_only',
        'process_symbol_drop_policy': 'never_create_control',
    })
    return policy


def _template_projection(
        metadata: Dict[str, Any],
        template_id: str,
        template_name: str,
        template_category: str,
        sanitized: str,
        datei_pfad: Path) -> Dict[str, Any]:
    """Build the stable API projection for canonical, legacy and custom SVGs."""
    geometry = _svg_geometrie(sanitized)
    standard = _standard_kennung(metadata)
    is_canonical = standard == 'PF-PID-V1'
    is_custom = template_category == 'Custom'
    library_role = str(metadata.get('library_role', '') or '').strip()
    if not library_role:
        library_role = 'process' if is_canonical else ('custom' if is_custom else 'legacy')
    width = _positive_number(
        metadata.get('breite', metadata.get('width')),
        geometry['intrinsic_width'],
    )
    height = _positive_number(
        metadata.get('höhe', metadata.get('hoehe', metadata.get('height'))),
        geometry['intrinsic_height'],
    )
    ports = metadata.get('ports', [])
    if not isinstance(ports, list):
        ports = []
    bindings = metadata.get('bindings', [])
    if not isinstance(bindings, list):
        bindings = []
    animated_areas = metadata.get('animierbare_bereiche', [])
    if not isinstance(animated_areas, list):
        animated_areas = []
    aliases = metadata.get('aliases', [])
    if not isinstance(aliases, list):
        aliases = []
    runtime_states = metadata.get('runtime_states', [])
    if not isinstance(runtime_states, list):
        runtime_states = []
    interaction = metadata.get('interaction', {})
    if not isinstance(interaction, dict):
        interaction = {}
    object_standard = metadata.get('object_standard', {})
    if not isinstance(object_standard, dict):
        object_standard = {}
    stretch = metadata.get('stretch')
    if not isinstance(stretch, dict):
        stretch = None
    visual_states = metadata.get('visual_states')
    if not isinstance(visual_states, list):
        visual_states = []
    template_layer = str(metadata.get('layer', 'process') or 'process')
    composition_mode = str(metadata.get('composition_mode', 'flat') or 'flat')
    if composition_mode != 'structured-assembly':
        composition_mode = 'flat'
    embedded_assembly = None
    if composition_mode == 'structured-assembly' and isinstance(metadata.get('assembly_template'), dict):
        try:
            embedded_assembly = baugruppe_normalisieren(metadata['assembly_template'])
        except (TypeError, ValueError):
            composition_mode = 'flat'
    raw_export_bounds = metadata.get('assembly_export_bounds', {})
    export_bounds = raw_export_bounds if isinstance(raw_export_bounds, dict) else {}
    assembly_export_bounds = {
        'x': _zahl_feld(export_bounds.get('x'), 0.0),
        'y': _zahl_feld(export_bounds.get('y'), 0.0),
        'width': max(1.0, _zahl_feld(export_bounds.get('width'), width)),
        'height': max(1.0, _zahl_feld(export_bounds.get('height'), height)),
    }
    assembly_template_id = (
        embedded_assembly.get('assembly_template_id', '')
        if embedded_assembly
        else sichere_baugruppen_id(metadata.get('assembly_template_id'))
    )
    assembly_part_count = len(embedded_assembly.get('entities', [])) if embedded_assembly else 0
    assembly_connection_count = len(embedded_assembly.get('connections', [])) if embedded_assembly else 0

    return {
        'id': template_id,
        'name': str(template_name),
        'stretch': stretch,
        'style': str(metadata.get('style', 'standard') or 'standard'),
        'visual_states': [str(state) for state in visual_states[:16]],
        'default_visual_state': str(metadata.get('default_visual_state', '') or ''),
        'layer': template_layer if template_layer in ASSEMBLY_LAYERS else 'process',
        'kategorie': template_category,
        'svg': sanitized,
        'datei': str(Path(datei_pfad)),
        'breite': width,
        'hoehe': height,
        'view_box': _normalisierte_view_box(
            metadata.get('view_box'),
            geometry['view_box'],
        ),
        'intrinsic_width': geometry['intrinsic_width'],
        'intrinsic_height': geometry['intrinsic_height'],
        'standard': standard or 'LEGACY',
        'standard_id': standard or 'LEGACY',
        'standard_version': str(
            metadata.get('standard_version')
            or object_standard.get('version')
            or ''
        ),
        'symbol_type': str(
            metadata.get('symbol_type', metadata.get('family', template_id))
            or template_id
        ),
        'family': str(metadata.get('family', template_id) or template_id),
        'library_role': library_role,
        'default_visible': bool(metadata.get('default_visible', is_canonical)),
        'favorite': bool(metadata.get('favorite', False)),
        'sort_order': _integer_value(metadata.get('sort_order'), 1000),
        'geometry_profile': str(
            metadata.get('geometry_profile', metadata.get('profile', 'legacy'))
            or 'legacy'
        ),
        'profile': str(
            metadata.get('profile', metadata.get('geometry_profile', 'legacy'))
            or 'legacy'
        ),
        'tag_prefix': str(metadata.get('tag_prefix', 'X') or 'X').upper(),
        'ports': ports,
        'bindings': bindings,
        'capabilities': _template_capabilities(metadata),
        'interaction': _template_capabilities({
            'capabilities': interaction or metadata.get('capabilities', {}),
        }),
        'object_standard': object_standard,
        'hmi_policy': _hmi_richtlinie(metadata),
        'runtime_states': runtime_states,
        'animierbare_bereiche': animated_areas,
        'hmi_widget_default': None,
        'aliases': aliases,
        'composition_mode': composition_mode,
        'assembly_template_id': assembly_template_id,
        'assembly_template': embedded_assembly,
        'assembly_export_bounds': assembly_export_bounds,
        'assembly_part_count': assembly_part_count,
        'assembly_connection_count': assembly_connection_count,
    }


def template_manager_erstellen(
        templates_verzeichnis: str = 'public/svg_templates') -> Dict[str, Any]:
    """Create the mutable template registry used by the request handlers."""
    templates_path = _normalisiere_pfad(templates_verzeichnis)
    custom_path = templates_path / 'custom'
    assembly_path = templates_path / 'assemblies'
    templates_path.mkdir(parents=True, exist_ok=True)
    custom_path.mkdir(parents=True, exist_ok=True)
    assembly_path.mkdir(parents=True, exist_ok=True)
    manager = {
        'templates_pfad': templates_path,
        'custom_pfad': custom_path,
        'assembly_pfad': assembly_path,
        'templates': {},
        'kategorien': {},
        'manifest': {},
    }
    templates_laden(manager)
    return manager


def template_laden(
        manager: Dict[str, Any],
        datei_pfad: Path,
        kategorie: str) -> None:
    """Load, sanitize and normalize one template into the in-memory registry."""
    try:
        source = Path(datei_pfad).read_text(encoding='utf-8')
        metadata = metadaten_extrahieren(source)
        sanitized = svg_bereinigen(source)
        template_id = Path(datei_pfad).stem
        template_name = metadata.get(
            'name',
            template_id.replace('_', ' ').title(),
        )
        template_category = str(metadata.get('kategorie', kategorie) or kategorie)
        projection = _template_projection(
            metadata,
            template_id,
            str(template_name),
            template_category,
            sanitized,
            Path(datei_pfad),
        )
        manager['templates'][template_id] = projection
        manager['kategorien'].setdefault(template_category, []).append(template_id)
    except Exception as exc:
        print('Fehler beim Laden von %s: %s' % (datei_pfad, exc))


def _ist_bibliotheks_template(root: Path, path: Path) -> bool:
    """Accept root and pid_v1 templates while excluding converter sources."""
    relative = path.relative_to(root)
    blocked = {'custom', 'assemblies', 'svg_konverter', '__pycache__'}
    if blocked.intersection(relative.parts):
        return False
    return not any(part.startswith('.') for part in relative.parts)


def _template_pfad_sortierschluessel(root: Path, path: Path) -> str:
    """Return a deterministic case-insensitive relative path key."""
    return str(path.relative_to(root)).casefold()


def _template_id_sortierschluessel(manager: Dict[str, Any], template_id: str):
    """Return the canonical template order key for one category."""
    template = manager['templates'][template_id]
    return (
        template.get('sort_order', 1000),
        template.get('name', '').casefold(),
        template_id.casefold(),
    )


def _bibliotheks_manifest_laden(templates_path: Path) -> Dict[str, Any]:
    """Load the optional machine-readable PF-PID-V1 library manifest."""
    manifest_path = templates_path / 'library_manifest_v1.json'
    if not manifest_path.is_file():
        return {}
    try:
        payload = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def templates_laden(manager: Dict[str, Any]) -> None:
    """Reload canonical, legacy and custom SVG templates deterministically."""
    manager['templates'].clear()
    manager['kategorien'].clear()
    root = manager['templates_pfad']
    manager['manifest'] = _bibliotheks_manifest_laden(root)
    library_files = [
        path
        for path in root.rglob('*.svg')
        if _ist_bibliotheks_template(root, path)
    ]
    path_key = partial(_template_pfad_sortierschluessel, root)
    for svg_file in sorted(library_files, key=path_key):
        template_laden(manager, svg_file, 'Legacy')
    for svg_file in sorted(manager['custom_pfad'].glob('*.svg')):
        template_laden(manager, svg_file, 'Custom')
    template_key = partial(_template_id_sortierschluessel, manager)
    for category in manager['kategorien']:
        manager['kategorien'][category] = sorted(
            manager['kategorien'][category],
            key=template_key,
        )
    print('[OK] %s Templates geladen' % len(manager['templates']))


async def template_hochladen(
        manager: Dict[str, Any],
        dateiname: str,
        svg_inhalt: str,
        metadaten: Dict[str, Any]) -> Dict[str, Any]:
    """Sanitize and persist a custom template."""
    try:
        filename = sicherer_dateiname(dateiname, 'custom_template.svg', '.svg')
        metadata = dict(metadaten) if isinstance(metadaten, dict) else {}
        metadata.update({
            'standard': 'CUSTOM',
            'standard_id': 'CUSTOM',
            'library_role': 'custom',
            'default_visible': False,
            'hmi_widget_default': None,
            'hmi_policy': {
                'auto_create_widgets': False,
                'default_control': None,
                'allowed_controls': ['text', 'indicator', 'toggle', 'button', 'slider'],
                'button_policy': 'optional_explicit_only',
                'process_symbol_drop_policy': 'never_create_control',
            },
        })
        sanitized = svg_bereinigen(svg_inhalt)
        declaration = '<?xml version="1.0" encoding="UTF-8"?>\n'
        comment = sicherer_meta_kommentar(metadata)
        if sanitized.strip().startswith('<?xml'):
            lines = sanitized.split('\n')
            sanitized = lines[0] + '\n' + comment + '\n'.join(lines[1:])
        else:
            sanitized = declaration + comment + sanitized
        target = manager['custom_pfad'] / filename
        atomar_text_schreiben(target, sanitized)
        template_laden(manager, target, 'Custom')
        return {
            'erfolg': True,
            'nachricht': 'Template "%s" hochgeladen' % filename,
            'template_id': target.stem,
        }
    except Exception as exc:
        return {'erfolg': False, 'fehler': str(exc)}


def _baugruppen_pfad(manager: Dict[str, Any]) -> Path:
    """Return the drawing assembly library directory of one template manager."""
    configured = manager.get('assembly_pfad')
    path = Path(configured) if configured else Path(manager['templates_pfad']) / 'assemblies'
    path.mkdir(parents=True, exist_ok=True)
    return path


def sichere_baugruppen_id(value: Any, fallback: str = '') -> str:
    """Restrict assembly identifiers to portable, traversal-safe characters."""
    cleaned = ASSEMBLY_ID_PATTERN.sub('_', str(value or '')).strip('_')
    return cleaned[:80] or fallback


def _text_feld(value: Any, fallback: str, limit: int = 200) -> str:
    """Return a bounded plain-text field."""
    text = str(value if value is not None else '').strip()
    return (text or fallback)[:limit]


def _zahl_feld(value: Any, fallback: float) -> float:
    """Return a finite number or the fallback."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if parsed != parsed or parsed in (float('inf'), float('-inf')):
        return fallback
    return parsed


def _baugruppen_stretch(value: Any) -> Optional[Dict[str, Any]]:
    """Normalize one linear stretch profile: axis plus sorted fixed intervals."""
    source = value if isinstance(value, dict) else None
    if source is None:
        return None
    axis = 'y' if source.get('axis') == 'y' else 'x'
    fixed = []
    for item in (source.get('fixed') if isinstance(source.get('fixed'), list) else [])[:32]:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        start = _zahl_feld(item[0], 0.0)
        end = _zahl_feld(item[1], 0.0)
        if end > start:
            fixed.append([start, end])
    fixed.sort()
    return {'axis': axis, 'fixed': fixed}


def _baugruppen_view_box(value: Any, source: Dict[str, Any]) -> list:
    """Return the template viewBox of one part, defaulting to its stored size."""
    fallback = [0, 0, max(1.0, _zahl_feld(source.get('width'), 100.0)),
                max(1.0, _zahl_feld(source.get('height'), 100.0))]
    return _normalisierte_view_box(value, fallback)


def _baugruppen_port(port: Any, index: int) -> Dict[str, Any]:
    """Normalize one semantic port of an assembly part or of the exposed port list."""
    source = port if isinstance(port, dict) else {}
    kind = source.get('kind')
    direction = source.get('direction')
    return {
        'id': _text_feld(source.get('id'), 'port_%s' % (index + 1), 80),
        'name': _text_feld(source.get('name'), 'Port %s' % (index + 1), 120),
        'entity_id': _text_feld(source.get('entity_id'), '', 120),
        'port_id': _text_feld(source.get('port_id'), '', 80),
        'x': _zahl_feld(source.get('x'), 0.0),
        'y': _zahl_feld(source.get('y'), 0.0),
        'rx': _zahl_feld(source.get('rx'), 0.0),
        'ry': _zahl_feld(source.get('ry'), 0.0),
        'kind': kind if kind in ASSEMBLY_CONNECTION_KINDS else 'process',
        'direction': direction if direction in ('in', 'out', 'bidirectional') else 'bidirectional',
        'role': _text_feld(source.get('role'), 'main', 40),
    }


def _baugruppen_entity(entity: Any, index: int) -> Optional[Dict[str, Any]]:
    """Normalize one elementary part; parts without template are dropped."""
    source = entity if isinstance(entity, dict) else {}
    template_id = _text_feld(source.get('template_id'), '', 120)
    if not template_id:
        return None
    ports = source.get('ports') if isinstance(source.get('ports'), list) else []
    properties = source.get('properties') if isinstance(source.get('properties'), dict) else {}
    scale_mode = source.get('scale_mode')
    return {
        'entity_id': _text_feld(source.get('entity_id'), 'entity_%s' % (index + 1), 120),
        'template_id': template_id,
        'name': _text_feld(source.get('name'), template_id, 160),
        'tag': _text_feld(source.get('tag'), '', 60),
        'x': _zahl_feld(source.get('x'), 0.0),
        'y': _zahl_feld(source.get('y'), 0.0),
        'width': max(1.0, _zahl_feld(source.get('width'), 100.0)),
        'height': max(1.0, _zahl_feld(source.get('height'), 100.0)),
        'rotation': _zahl_feld(source.get('rotation'), 0.0),
        # V64_r4: geometry flags of the plug-together editor (mirroring, flow inversion,
        # scale mode and the linear stretch profile) travel with every part.
        'flip_x': bool(source.get('flip_x')),
        'flip_y': bool(source.get('flip_y')),
        'inverted': bool(source.get('inverted')),
        'scale_mode': scale_mode if scale_mode in ASSEMBLY_SCALE_MODES else 'uniform',
        'stretch': _baugruppen_stretch(source.get('stretch')),
        'view_box': _baugruppen_view_box(source.get('view_box'), source),
        'visual_state': _text_feld(source.get('visual_state'), '', 40),
        'layer': source.get('layer') if source.get('layer') in ASSEMBLY_LAYERS else 'process',
        'ports': [_baugruppen_port(port, port_index) for port_index, port in enumerate(ports[:64])],
        'properties': {
            str(key)[:80]: value
            for key, value in list(properties.items())[:64]
            if isinstance(value, (str, int, float, bool)) or value is None
        },
    }


def _baugruppen_connection(connection: Any, entity_ids: set) -> Optional[Dict[str, Any]]:
    """Normalize one internal connection; dangling references are dropped."""
    source = connection if isinstance(connection, dict) else {}
    from_entity = _text_feld(source.get('from_entity_id'), '', 120)
    to_entity = _text_feld(source.get('to_entity_id'), '', 120)
    if from_entity not in entity_ids or to_entity not in entity_ids:
        return None
    kind = source.get('kind')
    joint = bool(source.get('joint')) or source.get('routing') == 'direct'
    return {
        'connection_id': _text_feld(source.get('connection_id'), 'connection', 120),
        'from_entity_id': from_entity,
        'from_port_id': _text_feld(source.get('from_port_id'), '', 80),
        'to_entity_id': to_entity,
        'to_port_id': _text_feld(source.get('to_port_id'), '', 80),
        'kind': kind if kind in ASSEMBLY_CONNECTION_KINDS else 'process',
        'name': _text_feld(source.get('name'), '', 160),
        'routing': 'direct' if joint else 'orthogonal',
        'joint': joint,
        'properties': {},
    }


def _baugruppen_primitive(primitive: Any, index: int) -> Optional[Dict[str, Any]]:
    """Normalize one free drawing primitive; SVG fragments are never stored."""
    source = primitive if isinstance(primitive, dict) else {}
    primitive_type = source.get('type')
    if primitive_type not in ASSEMBLY_PRIMITIVE_TYPES:
        return None
    stroke = _text_feld(source.get('stroke'), '#0f172a', 40)
    fill = _text_feld(source.get('fill'), 'none', 40)
    font_family = _text_feld(source.get('font_family'), '', 80)
    if hat_externe_css_url(stroke) or hat_externe_css_url(fill) or hat_externe_css_url(font_family):
        return None
    layer = source.get('layer')
    line_style = source.get('line_style')
    label_position = source.get('label_position')
    return {
        'primitive_id': _text_feld(source.get('primitive_id'), 'primitive_%s' % (index + 1), 120),
        'type': primitive_type,
        'x1': _zahl_feld(source.get('x1'), 0.0),
        'y1': _zahl_feld(source.get('y1'), 0.0),
        'x2': _zahl_feld(source.get('x2'), 0.0),
        'y2': _zahl_feld(source.get('y2'), 0.0),
        'text': _text_feld(source.get('text'), 'Beschriftung', 200),
        'stroke': stroke,
        'fill': fill,
        'stroke_width': max(0.2, _zahl_feld(source.get('stroke_width'), 2.2)),
        'font_size': max(4.0, _zahl_feld(source.get('font_size'), 16.0)),
        # V64_r5: routed lines, regions, dimensions, layers and typography.
        'points': _baugruppen_punkte(source.get('points')),
        'line_style': line_style if line_style in ASSEMBLY_LINE_STYLES else 'plain',
        'animated': bool(source.get('animated')),
        'layer': layer if layer in ASSEMBLY_LAYERS else 'process',
        'label': _text_feld(source.get('label'), '', 120),
        'label_position': label_position if label_position in ASSEMBLY_LABEL_POSITIONS else 'inside',
        'font_family': font_family,
    }


def _baugruppen_punkte(value: Any) -> list:
    """Return a bounded list of finite [x, y] points for routed lines."""
    source = value if isinstance(value, list) else []
    points = []
    for item in source[:MAX_PRIMITIVE_POINTS]:
        if isinstance(item, dict):
            candidate = [item.get('x'), item.get('y')]
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            candidate = [item[0], item[1]]
        else:
            continue
        points.append([_zahl_feld(candidate[0], 0.0), _zahl_feld(candidate[1], 0.0)])
    return points


def baugruppe_normalisieren(payload: Any) -> Dict[str, Any]:
    """Validate and normalize one drawing assembly template for persistence."""
    source = payload if isinstance(payload, dict) else {}
    raw_id = source.get('assembly_template_id') or source.get('id')
    assembly_id = sichere_baugruppen_id(raw_id, sichere_baugruppen_id(source.get('name'), 'baugruppe'))
    raw_entities = source.get('entities') if isinstance(source.get('entities'), list) else []
    if len(raw_entities) > MAX_ASSEMBLY_PARTS:
        raise ValueError('Eine Baugruppe darf höchstens %s Teile enthalten.' % MAX_ASSEMBLY_PARTS)
    entities = [
        normalized
        for normalized in (
            _baugruppen_entity(entity, index) for index, entity in enumerate(raw_entities)
        )
        if normalized is not None
    ]
    if not entities:
        raise ValueError('Eine Baugruppe benötigt mindestens ein Teil mit Template.')
    entity_ids = {entity['entity_id'] for entity in entities}
    raw_connections = source.get('connections') if isinstance(source.get('connections'), list) else []
    connections = [
        normalized
        for normalized in (
            _baugruppen_connection(connection, entity_ids) for connection in raw_connections[:2000]
        )
        if normalized is not None
    ]
    raw_primitives = source.get('primitives') if isinstance(source.get('primitives'), list) else []
    primitives = [
        normalized
        for normalized in (
            _baugruppen_primitive(primitive, index) for index, primitive in enumerate(raw_primitives[:500])
        )
        if normalized is not None
    ]
    raw_ports = source.get('exposed_ports') if isinstance(source.get('exposed_ports'), list) else []
    exposed_ports = [_baugruppen_port(port, index) for index, port in enumerate(raw_ports[:256])]
    template_ids = sorted({entity['template_id'] for entity in entities})
    return {
        'schema': ASSEMBLY_SCHEMA,
        'version': ASSEMBLY_VERSION,
        'assembly_template_id': assembly_id,
        'name': _text_feld(source.get('name'), assembly_id, 160),
        'category': _text_feld(source.get('category') or source.get('kategorie'), 'Baugruppen', 80),
        'description': _text_feld(source.get('description'), '', 400),
        'scope': 'library',
        'created_at': _text_feld(source.get('created_at'), '', 40),
        'width': max(1.0, _zahl_feld(source.get('width'), 100.0)),
        'height': max(1.0, _zahl_feld(source.get('height'), 100.0)),
        'entities': entities,
        'connections': connections,
        'primitives': primitives,
        'exposed_ports': exposed_ports,
        'template_ids': template_ids,
    }


def baugruppen_laden(manager: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Load all persisted drawing assemblies deterministically."""
    assemblies = []
    for path in sorted(_baugruppen_pfad(manager).glob('*.json')):
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
            assemblies.append(baugruppe_normalisieren(payload))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print('Baugruppe übersprungen %s: %s' % (path.name, exc))
    return assemblies


def baugruppe_speichern(manager: Dict[str, Any], payload: Any) -> Dict[str, Any]:
    """Validate and persist one drawing assembly atomically."""
    assembly = baugruppe_normalisieren(payload)
    serialized = json.dumps(assembly, ensure_ascii=False, indent=2, sort_keys=True)
    if len(serialized.encode('utf-8')) > MAX_ASSEMBLY_BYTES:
        raise ValueError('Die Baugruppe überschreitet die maximale Größe.')
    target = _baugruppen_pfad(manager) / (assembly['assembly_template_id'] + '.json')
    atomar_text_schreiben(target, serialized + '\n')
    return assembly


def baugruppe_loeschen(manager: Dict[str, Any], assembly_id: Any) -> bool:
    """Delete one persisted drawing assembly; returns whether a file was removed."""
    safe_id = sichere_baugruppen_id(assembly_id)
    if not safe_id:
        raise ValueError('Ungültige Baugruppen-ID.')
    target = _baugruppen_pfad(manager) / (safe_id + '.json')
    if not target.is_file():
        return False
    target.unlink()
    return True


def template_abrufen(
        manager: Dict[str, Any],
        template_id: str) -> Optional[Dict[str, Any]]:
    """Return one template by identifier."""
    return manager['templates'].get(template_id)


def alle_templates_abrufen(manager: Dict[str, Any]) -> Dict[str, Any]:
    """Return the complete template and category projection."""
    return {
        'templates': manager['templates'],
        'kategorien': dict(manager['kategorien']),
        'object_standard': {
            'id': 'PF-PID-V1',
            'version': '1.0',
            'release': '61.1',
            'auto_create_hmi_widgets': False,
            'button_policy': 'optional_explicit_only',
        },
        'manifest': manager.get('manifest', {}),
    }


def _json_error(exc: Exception, status: int = 500) -> web.Response:
    """Build a stable JSON error response."""
    return web.json_response({'erfolg': False, 'fehler': str(exc)}, status=status)


def _library_path(path_value: str) -> Path:
    """Resolve a library path below the application root."""
    return _normalisiere_pfad(path_value)


def server_erstellen(
        port: int = 8090,
        static_dir: str = 'public',
        host: str = '127.0.0.1',
        projects_dir: str = 'projekte',
        templates_dir: Optional[str] = None) -> Dict[str, Any]:
    """Create all explicit server state without constructing an object graph."""
    static_path = _normalisiere_pfad(static_dir)
    projects_path = _normalisiere_pfad(projects_dir)
    template_path = _normalisiere_pfad(
        templates_dir if templates_dir else static_path / 'svg_templates'
    )
    static_path.mkdir(parents=True, exist_ok=True)
    projects_path.mkdir(parents=True, exist_ok=True)
    template_path.mkdir(parents=True, exist_ok=True)
    return {
        'port': int(port),
        'host': str(host),
        'static_dir': static_path,
        'projekte_verzeichnis': projects_path,
        'template_manager': template_manager_erstellen(str(template_path)),
    }


async def index_handler(server: Dict[str, Any], request: web.Request) -> web.Response:
    """Serve the editor entry page."""
    html_path = server['static_dir'] / 'index.html'
    if not html_path.is_file():
        return web.Response(text='index.html nicht gefunden!', status=404)
    return web.Response(
        text=html_path.read_text(encoding='utf-8'),
        content_type='text/html',
        charset='utf-8',
    )


async def favicon_handler(server: Dict[str, Any], request: web.Request) -> web.StreamResponse:
    """Serve the local favicon."""
    path = server['static_dir'] / 'favicon.ico'
    if path.is_file():
        return web.FileResponse(path=str(path))
    return web.Response(status=404)


async def templates_handler(server: Dict[str, Any], request: web.Request) -> web.Response:
    """Return the template library."""
    return web.json_response(alle_templates_abrufen(server['template_manager']))


async def template_hochladen_handler(
        server: Dict[str, Any],
        request: web.Request) -> web.Response:
    """Accept a custom SVG template upload."""
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError('Ungültige JSON-Daten')
        result = await template_hochladen(
            server['template_manager'],
            data.get('dateiname', 'custom_template.svg'),
            data.get('svg', ''),
            data.get('metadaten', {}),
        )
        return web.json_response(result, status=200 if result.get('erfolg') else 400)
    except (ValueError, json.JSONDecodeError) as exc:
        return _json_error(exc, status=400)
    except Exception as exc:
        return _json_error(exc)


async def templates_neu_laden_handler(
        server: Dict[str, Any],
        request: web.Request) -> web.Response:
    """Reload all template files."""
    try:
        manager = server['template_manager']
        templates_laden(manager)
        return web.json_response({
            'erfolg': True,
            'nachricht': '%s Templates geladen' % len(manager['templates']),
        })
    except Exception as exc:
        return _json_error(exc)


async def drawing_assemblies_handler(
        server: Dict[str, Any],
        request: web.Request) -> web.Response:
    """Return the persisted drawing assembly library."""
    try:
        assemblies = baugruppen_laden(server['template_manager'])
        return web.json_response({
            'erfolg': True,
            'schema': ASSEMBLY_SCHEMA,
            'version': ASSEMBLY_VERSION,
            'assemblies': assemblies,
        })
    except Exception as exc:
        return _json_error(exc)


async def drawing_assembly_save_handler(
        server: Dict[str, Any],
        request: web.Request) -> web.Response:
    """Validate and persist one drawing assembly template."""
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError('Ungültige JSON-Daten')
        assembly = baugruppe_speichern(
            server['template_manager'],
            data.get('assembly', data),
        )
        return web.json_response({
            'erfolg': True,
            'nachricht': 'Baugruppe "%s" gespeichert' % assembly['name'],
            'assembly': assembly,
        })
    except (ValueError, json.JSONDecodeError) as exc:
        return _json_error(exc, status=400)
    except Exception as exc:
        return _json_error(exc)


async def drawing_assembly_delete_handler(
        server: Dict[str, Any],
        request: web.Request) -> web.Response:
    """Delete one drawing assembly template from the library."""
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError('Ungültige JSON-Daten')
        removed = baugruppe_loeschen(
            server['template_manager'],
            data.get('assembly_template_id', ''),
        )
        return web.json_response({'erfolg': True, 'entfernt': removed})
    except (ValueError, json.JSONDecodeError) as exc:
        return _json_error(exc, status=400)
    except Exception as exc:
        return _json_error(exc)


async def svg_speichern_handler(
        server: Dict[str, Any],
        request: web.Request) -> web.Response:
    """Persist a sanitized SVG project and metadata atomically."""
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError('Ungültige JSON-Daten')
        project_name = data.get('name', 'unbenannt')
        safe_name = sicherer_projektname(project_name)
        if not safe_name:
            return web.json_response(
                {'erfolg': False, 'fehler': 'Ungültiger Projektname'},
                status=400,
            )
        metadata = data.get('metadaten', {})
        if not isinstance(metadata, dict):
            return web.json_response(
                {'erfolg': False, 'fehler': 'Metadaten müssen ein Objekt sein'},
                status=400,
            )
        sanitized = svg_bereinigen(data.get('svg', ''))
        svg_path = server['projekte_verzeichnis'] / ('%s.svg' % safe_name)
        metadata_path = server['projekte_verzeichnis'] / ('%s.json' % safe_name)
        atomar_text_schreiben(svg_path, sanitized)
        atomar_text_schreiben(
            metadata_path,
            json.dumps(metadata, indent=2, ensure_ascii=False) + '\n',
        )
        return web.json_response({
            'erfolg': True,
            'nachricht': 'Projekt "%s" gespeichert' % project_name,
            'datei': str(svg_path),
        })
    except (ValueError, json.JSONDecodeError) as exc:
        return _json_error(exc, status=400)
    except Exception as exc:
        return _json_error(exc)


async def svg_laden_handler(
        server: Dict[str, Any],
        request: web.Request) -> web.Response:
    """Load one project from the dedicated project directory."""
    try:
        project_name = sicherer_projektname(request.query.get('name'))
        if not project_name:
            return web.json_response(
                {'erfolg': False, 'fehler': 'Projekt-Name erforderlich'},
                status=400,
            )
        svg_path = server['projekte_verzeichnis'] / ('%s.svg' % project_name)
        metadata_path = server['projekte_verzeichnis'] / ('%s.json' % project_name)
        if not svg_path.is_file():
            return web.json_response(
                {'erfolg': False, 'fehler': 'Projekt nicht gefunden'},
                status=404,
            )
        metadata = {}
        if metadata_path.is_file():
            metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
        return web.json_response({
            'erfolg': True,
            'svg': svg_path.read_text(encoding='utf-8'),
            'metadaten': metadata,
        })
    except Exception as exc:
        return _json_error(exc)


async def projekte_listen_handler(
        server: Dict[str, Any],
        request: web.Request) -> web.Response:
    """Return project metadata sorted by project name."""
    try:
        projects: List[Dict[str, Any]] = []
        for svg_path in sorted(server['projekte_verzeichnis'].glob('*.svg')):
            project_name = svg_path.stem
            metadata_path = server['projekte_verzeichnis'] / ('%s.json' % project_name)
            metadata = {}
            if metadata_path.is_file():
                metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
            stat = svg_path.stat()
            projects.append({
                'name': project_name,
                'datei': svg_path.name,
                'groesse': stat.st_size,
                'geaendert': stat.st_mtime,
                'metadaten': metadata,
            })
        return web.json_response({'erfolg': True, 'projekte': projects})
    except Exception as exc:
        return _json_error(exc)


async def svg_exportieren_handler(
        server: Dict[str, Any],
        request: web.Request) -> web.Response:
    """Return a sanitized SVG as a download."""
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError('Ungültige JSON-Daten')
        sanitized = svg_bereinigen(data.get('svg', ''))
        filename = sicherer_dateiname(data.get('dateiname'), 'anlage.svg', '.svg')
        return web.Response(
            text=sanitized,
            content_type='image/svg+xml',
            charset='utf-8',
            headers={'Content-Disposition': 'attachment; filename="%s"' % filename},
        )
    except (ValueError, json.JSONDecodeError) as exc:
        return _json_error(exc, status=400)
    except Exception as exc:
        return _json_error(exc)


async def static_json_get_handler(
        server: Dict[str, Any],
        request: web.Request,
        *,
        file_path: str,
        key: str) -> web.Response:
    """Return a static V9 library while preserving its response envelope."""
    target = _library_path(file_path)
    if not target.is_file():
        return web.json_response({
            'erfolg': True,
            key: {'version': 9, 'templates': []},
            'hinweis': 'Datei nicht vorhanden: %s' % file_path,
        })
    try:
        payload = json.loads(target.read_text(encoding='utf-8'))
    except Exception as exc:
        return _json_error(exc)
    return web.json_response({'erfolg': True, key: payload})


async def library_get_handler(
        server: Dict[str, Any],
        request: web.Request,
        *,
        library_path: str,
        empty_payload: Dict[str, Any]) -> web.Response:
    """Load a writable JSON library and provision an empty one when absent."""
    try:
        target = _library_path(library_path)
        if not target.is_file():
            atomar_text_schreiben(
                target,
                json.dumps(empty_payload, ensure_ascii=False, indent=2) + '\n',
            )
            return web.json_response(empty_payload)
        return web.json_response(json.loads(target.read_text(encoding='utf-8')))
    except Exception as exc:
        return _json_error(exc)


async def library_save_handler(
        server: Dict[str, Any],
        request: web.Request,
        *,
        library_path: str,
        payload_key: str,
        required_key: str,
        success_message: str) -> web.Response:
    """Validate and atomically persist one writable JSON library."""
    try:
        payload = await request.json()
        library = payload.get(payload_key, {}) if isinstance(payload, dict) else {}
        if not isinstance(library, dict) or required_key not in library:
            return web.json_response(
                {'erfolg': False, 'fehler': 'Ungültige Daten'},
                status=400,
            )
        target = _library_path(library_path)
        atomar_text_schreiben(
            target,
            json.dumps(library, ensure_ascii=False, indent=2) + '\n',
        )
        return web.json_response({'erfolg': True, 'nachricht': success_message})
    except (ValueError, json.JSONDecodeError) as exc:
        return _json_error(exc, status=400)
    except Exception as exc:
        return _json_error(exc)


async def rule_library_get_handler(
        server: Dict[str, Any],
        request: web.Request,
        *,
        library_path: str) -> web.Response:
    """Load the legacy rule library."""
    return await library_get_handler(
        server,
        request,
        library_path=library_path,
        empty_payload={'rule_sets': []},
    )


async def rule_library_save_handler(
        server: Dict[str, Any],
        request: web.Request,
        *,
        library_path: str) -> web.Response:
    """Save the legacy rule library."""
    return await library_save_handler(
        server,
        request,
        library_path=library_path,
        payload_key='rule_library',
        required_key='rule_sets',
        success_message='Rule-Bibliothek gespeichert',
    )


async def process_library_get_handler(
        server: Dict[str, Any],
        request: web.Request,
        *,
        library_path: str) -> web.Response:
    """Load the legacy process library."""
    return await library_get_handler(
        server,
        request,
        library_path=library_path,
        empty_payload={'process_states': []},
    )


async def process_library_save_handler(
        server: Dict[str, Any],
        request: web.Request,
        *,
        library_path: str) -> web.Response:
    """Save the legacy process library."""
    return await library_save_handler(
        server,
        request,
        library_path=library_path,
        payload_key='process_library',
        required_key='process_states',
        success_message='Process-Bibliothek gespeichert',
    )


def erstelle_app(server: Dict[str, Any]) -> web.Application:
    """Compose the complete HTTP application from explicit function routes."""
    app = web.Application(
        middlewares=[sicherheits_header_middleware],
        client_max_size=MAX_SVG_BYTES,
    )

    app.router.add_get('/favicon.ico', partial(favicon_handler, server))
    app.router.add_get('/', partial(index_handler, server))
    app.router.add_get('/api/templates', partial(templates_handler, server))
    app.router.add_post(
        '/api/template/hochladen',
        partial(template_hochladen_handler, server),
    )
    app.router.add_post(
        '/api/templates/neu-laden',
        partial(templates_neu_laden_handler, server),
    )
    app.router.add_get('/api/drawing-assemblies', partial(drawing_assemblies_handler, server))
    app.router.add_post('/api/drawing-assemblies', partial(drawing_assembly_save_handler, server))
    app.router.add_post(
        '/api/drawing-assemblies/loeschen',
        partial(drawing_assembly_delete_handler, server),
    )
    app.router.add_post('/api/speichern', partial(svg_speichern_handler, server))
    app.router.add_get('/api/laden', partial(svg_laden_handler, server))
    app.router.add_get('/api/projekte', partial(projekte_listen_handler, server))
    app.router.add_post('/api/exportieren', partial(svg_exportieren_handler, server))

    register_v9_routes(app, BASE_DIR)

    app.router.add_get(
        '/api/rule-library-v9',
        partial(
            static_json_get_handler,
            server,
            file_path='config/rule_library_v9.json',
            key='rule_library_v9',
        ),
    )
    app.router.add_get(
        '/api/process-library-v9',
        partial(
            static_json_get_handler,
            server,
            file_path='config/process_library_v9.json',
            key='process_library_v9',
        ),
    )
    app.router.add_get(
        '/api/rule-library',
        partial(
            rule_library_get_handler,
            server,
            library_path='config/rule_library.json',
        ),
    )
    app.router.add_post(
        '/api/rule-library',
        partial(
            rule_library_save_handler,
            server,
            library_path='config/rule_library.json',
        ),
    )
    app.router.add_get(
        '/api/process-library',
        partial(
            process_library_get_handler,
            server,
            library_path='config/process_library.json',
        ),
    )
    app.router.add_post(
        '/api/process-library',
        partial(
            process_library_save_handler,
            server,
            library_path='config/process_library.json',
        ),
    )

    app.router.add_static('/public', server['static_dir'], show_index=False)
    fixtures = BASE_DIR / 'test' / 'fixtures'
    if fixtures.is_dir():
        app.router.add_static('/test/fixtures', fixtures, show_index=False)
    return app


def server_starten(server: Dict[str, Any]) -> None:
    """Start the local aiohttp application."""
    app = erstelle_app(server)
    manager = server['template_manager']
    print('=' * 70)
    print('Plant Factory V64 - SVG Events + Plant Drawing + Config V9/Cross V8')
    print('=' * 70)
    print('URL: http://%s:%s' % (server['host'], server['port']))
    print('\nStatic-Verzeichnis: %s' % server['static_dir'])
    print('Template-Verzeichnis: %s' % manager['templates_pfad'])
    print('Geladene Templates: %s' % len(manager['templates']))
    print('\nFunktionen:')
    print('  [OK] Professionelle R&I-Symbole und V1-Inspector')
    print('  [OK] Sanitized Template- und Projektverwaltung')
    print('  [OK] Atomare Schreibvorgänge')
    print('  [OK] Ereignisgesteuerte, signalgebundene SVG-Animationen')
    print('  [OK] Elementarer Anlagen-Zeicheneditor und Inventarübernahme')
    print('  [OK] V9-Config-Vertrag (/api/v9/config, /api/v9/shard/{node})')
    print('  [OK] Editor-Projektion unter /api/device-config')
    print('  [OK] PF-AUTOMATION-V9-BRIDGE ohne doppelte Regelquelle')
    print('  [OK] Localhost-Bindung als sichere Vorgabe')
    print('=' * 70)
    web.run_app(app, host=server['host'], port=server['port'])


def parse_server_arguments(arguments=None):
    """Parse local preview overrides without changing secure defaults."""
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument('--host', default=None)
    parser.add_argument('--port', type=int, default=None)
    parser.add_argument('--strictPort', action='store_true')
    parsed, _unknown = parser.parse_known_args(arguments)
    return parsed


def main(arguments=None) -> None:
    """Load configuration, apply explicit CLI overrides and start the server."""
    settings = server_settings(BASE_DIR)
    parsed = parse_server_arguments(arguments)
    host = parsed.host or settings['host']
    port = parsed.port if parsed.port is not None else settings['port']
    raw_paths = settings.get('raw', {}).get('paths', {})
    paths = raw_paths if isinstance(raw_paths, dict) else {}
    server_starten(server_erstellen(
        port=port,
        host=host,
        static_dir=str(paths.get('static_dir', 'public')),
        projects_dir=str(paths.get('projekte_dir', 'projekte')),
        templates_dir=str(paths.get('templates_dir', 'public/svg_templates')),
    ))


if __name__ == '__main__':
    main()
