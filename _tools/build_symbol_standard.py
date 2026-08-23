#!/usr/bin/env python3
"""Build and verify the deterministic PF-PID-V1 symbol library."""

import argparse
import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = ROOT / 'public' / 'svg_templates'
STANDARD_PATH = ROOT / 'config' / 'symbol_standard_v1.json'
MANIFEST_PATH = TEMPLATE_DIR / 'library_manifest_v1.json'


STYLE_BLOCK = """<style>
.pf-pid-v1 .pid-outline{fill:var(--pid-surface,#ffffff);stroke:var(--pid-outline,#334155);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.pf-pid-v1 .pid-detail{fill:none;stroke:var(--pid-detail,#64748b);stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.pf-pid-v1 .pid-primary{fill:none;stroke:var(--pid-primary,#2563eb);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.pf-pid-v1 .pid-flow{fill:none;stroke:var(--pid-flow,#0891b2);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.pf-pid-v1 .pid-state-fill{fill:var(--pid-state-soft,#d1fae5);stroke:var(--pid-state,#10b981);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.pf-pid-v1 .pid-warning{fill:none;stroke:var(--pid-warning,#f59e0b);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.pf-pid-v1 .pid-muted-fill{fill:var(--pid-muted-fill,#e2e8f0);stroke:var(--pid-detail,#64748b);stroke-width:1.4;vector-effect:non-scaling-stroke}
.pf-pid-v1 .pid-terminal{fill:var(--pid-surface,#ffffff);stroke:var(--pid-outline,#334155);stroke-width:1.4;vector-effect:non-scaling-stroke}
.pf-pid-v1 .pid-no-fill{fill:none}
.pf-pid-v1 text{font-family:Public Sans,Arial,sans-serif;fill:var(--pid-outline,#334155)}
</style>"""


CATEGORY_ORDER = [
    'Behälter',
    'Pumpen',
    'Wärmetauscher',
    'Ventile',
    'Reaktoren',
    'Messstellen',
    'Kolonnen',
    'Rohrbauteile',
    'Rohrleitungen',
    'Antriebe',
    'I/O-Hardware',
    'Filter',
    'Legacy',
    'Custom',
]


PROFILES = {
    'compact': {'width': 80, 'height': 80},
    'machine': {'width': 90, 'height': 80},
    'vessel': {'width': 80, 'height': 110},
    'horizontal_vessel': {'width': 120, 'height': 80},
    'reactor': {'width': 100, 'height': 130},
    'instrument': {'width': 70, 'height': 90},
    'column': {'width': 90, 'height': 140},
    'pipeline': {'width': 120, 'height': 60},
    'hardware': {'width': 120, 'height': 90},
    'pipe': {'width': 140, 'height': 60},
    'pipe_elbow': {'width': 100, 'height': 100},
    'flange': {'width': 60, 'height': 60},
    'bottle': {'width': 70, 'height': 150},
    'vertical_reactor': {'width': 100, 'height': 240},
    'furnace': {'width': 160, 'height': 220},
    'cooler_vertical': {'width': 100, 'height': 220},
    'fitting': {'width': 60, 'height': 60},
    'fitting_tee': {'width': 80, 'height': 60},
    'mixer': {'width': 120, 'height': 80},
    'cap': {'width': 40, 'height': 60},
    'flag': {'width': 100, 'height': 60},
    'classic_tube': {'width': 160, 'height': 48},
    'classic_flange': {'width': 16, 'height': 48},
    'classic_flange_bolted': {'width': 40, 'height': 48},
    'classic_elbow': {'width': 88, 'height': 88},
    'classic_ubend': {'width': 232, 'height': 160},
    'classic_head': {'width': 48, 'height': 10},
    'classic_tap': {'width': 48, 'height': 48},
    'classic_line': {'width': 160, 'height': 40},
    'classic_fitting': {'width': 40, 'height': 40},
    'classic_valve': {'width': 60, 'height': 40},
    'classic_flag': {'width': 56, 'height': 40},
    'classic_instrument': {'width': 60, 'height': 72},
    'classic_furnace': {'width': 200, 'height': 206},
    'classic_cooler': {'width': 150, 'height': 160},
    'classic_column': {'width': 160, 'height': 420},
    'classic_circle': {'width': 110, 'height': 150},
    'classic_mixer': {'width': 130, 'height': 48},
    'classic_cylinder': {'width': 60, 'height': 110},
    'frame_post': {'width': 24, 'height': 400},
    'frame_beam': {'width': 400, 'height': 24},
    'frame_foot': {'width': 60, 'height': 20},
    'frame_clamp': {'width': 40, 'height': 30},
    'frame_floor': {'width': 300, 'height': 24},
}


def port(port_id, name, x, y, kind='process', direction='bidirectional', role='main'):
    return {
        'id': port_id,
        'name': name,
        'x': x,
        'y': y,
        'kind': kind,
        'direction': direction,
        'role': role,
    }


def standard_ports(width, height, kind='process'):
    return [
        port('left', 'Links', 0, height / 2, kind, 'in'),
        port('right', 'Rechts', width, height / 2, kind, 'out'),
        port('top', 'Oben', width / 2, 0, kind),
        port('bottom', 'Unten', width / 2, height, kind),
    ]


def stretch_profile(axis, fixed_segments):
    """Describe a linear part: fixed viewBox intervals keep their scale, gaps stretch."""
    return {
        'axis': axis,
        'fixed': [[int(start), int(end)] for start, end in fixed_segments],
    }


def symbol_definition(template_id, name, category, family, tag_prefix, profile,
                      body, aliases=None, ports=None, favorite=False, order=100,
                      animation_targets=None, bindings=None, interaction=None,
                      stretch=None):
    geometry = PROFILES[profile]
    width = geometry['width']
    height = geometry['height']
    definition = {
        'id': template_id,
        'name': name,
        'kategorie': category,
        'family': family,
        'tag_prefix': tag_prefix,
        'profile': profile,
        'breite': width,
        'hoehe': height,
        'view_box': [0, 0, width, height],
        'ports': ports if ports is not None else standard_ports(width, height),
        'favorite': bool(favorite),
        'sort_order': int(order),
        'aliases': list(aliases or []),
        'bindings': list(bindings or []),
        'animierbare_bereiche': list(animation_targets or [
            '.pid-state-fill',
            '.pid-primary',
            '.pid-flow',
        ]),
        'interaction': dict(interaction or {}),
        'body': body.strip(),
    }
    if stretch is not None:
        definition['stretch'] = dict(stretch)
    return definition


def build_definitions():
    items = []
    items.append(symbol_definition(
        'Tank_vessel', 'Tank / Behälter', 'Behälter', 'tank', 'T', 'vessel',
        """
<g data-pf-role="body">
  <path class="pid-outline" d="M18 18 C18 11 62 11 62 18 L62 91 C62 100 18 100 18 91 Z"/>
  <path class="pid-detail" d="M18 18 C18 25 62 25 62 18 M18 91 C18 84 62 84 62 91"/>
  <path class="pid-state-fill" data-pf-state-target="level" d="M20 72 C20 68 60 68 60 72 L60 91 C60 96 20 96 20 91 Z"/>
  <path class="pid-flow" d="M0 62 H18 M62 62 H80"/>
  <circle class="pid-terminal" cx="0" cy="62" r="2.5"/><circle class="pid-terminal" cx="80" cy="62" r="2.5"/>
</g>
""",
        aliases=['tank', 'vessel', 'feed vessel', 'speicher'],
        ports=[port('inlet', 'Zulauf', 0, 62, 'process', 'in'),
               port('outlet', 'Ablauf', 80, 62, 'process', 'out'),
               port('vent', 'Entlüftung', 40, 0, 'utility', 'out'),
               port('drain', 'Entleerung', 40, 110, 'utility', 'out')],
        favorite=True, order=10,
        animation_targets=['[data-pf-state-target="level"]', '.pid-flow', '.pid-outline'],
    ))
    items.append(symbol_definition(
        'Tank_vessel_(wde)', 'Tank mit Füllstand', 'Behälter', 'tank-level', 'T', 'vessel',
        """
<g data-pf-role="body">
  <path class="pid-outline" d="M16 17 C16 10 64 10 64 17 L64 92 C64 101 16 101 16 92 Z"/>
  <path class="pid-detail" d="M16 17 C16 24 64 24 64 17 M16 92 C16 85 64 85 64 92"/>
  <path class="pid-state-fill" data-pf-state-target="level" d="M18 60 C18 56 62 56 62 60 L62 92 C62 97 18 97 18 92 Z"/>
  <path class="pid-primary" d="M66 28 H73 V88 H66 M70 34 V82"/>
  <path class="pid-flow" d="M0 70 H16 M64 70 H80"/>
</g>
""",
        aliases=['tank level', 'füllstand', 'storage'],
        ports=[port('inlet', 'Zulauf', 0, 70, 'process', 'in'),
               port('outlet', 'Ablauf', 80, 70, 'process', 'out'),
               port('level_signal', 'Füllstandssignal', 80, 34, 'signal', 'out'),
               port('drain', 'Entleerung', 40, 110, 'utility', 'out')],
        order=20,
        animation_targets=['[data-pf-state-target="level"]', '.pid-primary'],
    ))
    items.append(symbol_definition(
        'Vessel_(wdeahoc)', 'Horizontalbehälter', 'Behälter', 'horizontal-vessel', 'V', 'horizontal_vessel',
        """
<g data-pf-role="body">
  <path class="pid-outline" d="M23 18 H97 C109 18 116 28 116 40 C116 52 109 62 97 62 H23 C11 62 4 52 4 40 C4 28 11 18 23 18 Z"/>
  <path class="pid-detail" d="M23 18 C15 25 15 55 23 62 M97 18 C105 25 105 55 97 62 M34 62 V72 M86 62 V72 M28 72 H40 M80 72 H92"/>
  <path class="pid-state-fill" data-pf-state-target="level" d="M8 44 C24 40 96 40 112 44 C110 54 104 59 96 59 H24 C16 59 10 54 8 44 Z"/>
  <path class="pid-flow" d="M0 40 H4 M116 40 H120"/>
</g>
""",
        aliases=['horizontal vessel', 'separator', 'drum'],
        ports=[port('inlet', 'Zulauf', 0, 40, 'process', 'in'),
               port('outlet', 'Ablauf', 120, 40, 'process', 'out'),
               port('gas', 'Gasraum', 60, 0, 'process', 'out'),
               port('drain', 'Entleerung', 60, 80, 'utility', 'out')],
        order=30,
    ))
    items.append(symbol_definition(
        'Pump_liquid_type', 'Flüssigkeitspumpe', 'Pumpen', 'centrifugal-pump', 'P', 'machine',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 40 H17 M73 40 H90"/>
  <circle class="pid-state-fill" data-pf-state-target="body" cx="45" cy="40" r="27"/>
  <path class="pid-primary" data-pf-state-target="rotor" d="M34 23 L62 40 L34 57 Z"/>
  <circle class="pid-terminal" cx="0" cy="40" r="2.5"/><circle class="pid-terminal" cx="90" cy="40" r="2.5"/>
</g>
""",
        aliases=['pump', 'feed pump', 'centrifugal pump', 'pumpe'],
        ports=[port('suction', 'Saugseite', 0, 40, 'process', 'in'),
               port('discharge', 'Druckseite', 90, 40, 'process', 'out'),
               port('drive', 'Antrieb', 45, 80, 'power', 'in'),
               port('status', 'Status', 45, 0, 'signal', 'out')],
        favorite=True, order=10,
        animation_targets=['[data-pf-state-target="rotor"]', '[data-pf-state-target="body"]'],
    ))
    items.append(symbol_definition(
        'Compressor_vacuum_pump_(general)', 'Kompressor / Vakuumpumpe', 'Pumpen', 'compressor', 'C', 'machine',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 40 H17 M73 40 H90"/>
  <circle class="pid-outline" cx="45" cy="40" r="27"/>
  <path class="pid-primary" data-pf-state-target="rotor" d="M28 55 L64 40 L28 25 Z"/>
  <path class="pid-detail" d="M20 68 H70"/>
</g>
""",
        aliases=['compressor', 'vacuum pump', 'verdichter'],
        ports=[port('suction', 'Saugseite', 0, 40, 'process', 'in'),
               port('discharge', 'Druckseite', 90, 40, 'process', 'out'),
               port('drive', 'Antrieb', 45, 80, 'power', 'in'),
               port('status', 'Status', 45, 0, 'signal', 'out')],
        favorite=True, order=20,
        animation_targets=['[data-pf-state-target="rotor"]', '.pid-outline'],
    ))
    items.append(symbol_definition(
        'Heat_exchanger_(general)', 'Wärmetauscher', 'Wärmetauscher', 'heat-exchanger', 'E', 'machine',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 40 H17 M73 40 H90"/>
  <circle class="pid-outline" cx="45" cy="40" r="27"/>
  <path class="pid-primary" data-pf-state-target="heat" d="M27 42 C32 20 39 60 45 38 C51 16 58 56 63 35"/>
</g>
""",
        aliases=['heat exchanger', 'wärmetauscher', 'cooler', 'heater'],
        ports=[port('process_in', 'Prozess Eingang', 0, 40, 'process', 'in'),
               port('process_out', 'Prozess Ausgang', 90, 40, 'process', 'out'),
               port('utility_in', 'Medium Eingang', 45, 0, 'utility', 'in'),
               port('utility_out', 'Medium Ausgang', 45, 80, 'utility', 'out')],
        favorite=True, order=10,
        animation_targets=['[data-pf-state-target="heat"]', '.pid-outline'],
    ))
    items.append(symbol_definition(
        'Heat_exchanger_(M-shape)', 'Wärmetauscher M-Rohr', 'Wärmetauscher', 'heat-exchanger-m', 'E', 'machine',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 40 H12 M78 40 H90"/>
  <rect class="pid-outline" x="12" y="15" width="66" height="50" rx="6"/>
  <path class="pid-primary" data-pf-state-target="heat" d="M22 53 V27 L34 46 L45 27 L56 46 L68 27 V53"/>
  <path class="pid-detail" d="M45 0 V15 M45 65 V80"/>
</g>
""",
        aliases=['m coil', 'coil exchanger'],
        ports=[port('process_in', 'Prozess Eingang', 0, 40, 'process', 'in'),
               port('process_out', 'Prozess Ausgang', 90, 40, 'process', 'out'),
               port('utility_in', 'Medium Eingang', 45, 0, 'utility', 'in'),
               port('utility_out', 'Medium Ausgang', 45, 80, 'utility', 'out')],
        order=20,
    ))
    items.append(symbol_definition(
        'Heat_exchanger_(wst)', 'Rohrbündelwärmetauscher', 'Wärmetauscher', 'shell-tube-exchanger', 'E', 'horizontal_vessel',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 40 H10 M110 40 H120"/>
  <path class="pid-outline" d="M20 16 H100 C107 16 112 27 112 40 C112 53 107 64 100 64 H20 C13 64 8 53 8 40 C8 27 13 16 20 16 Z"/>
  <path class="pid-primary" data-pf-state-target="heat" d="M20 30 H100 M20 40 H100 M20 50 H100"/>
  <path class="pid-detail" d="M28 16 V64 M92 16 V64 M60 0 V16 M60 64 V80"/>
</g>
""",
        aliases=['shell tube', 'rohrbündel', 'wst'],
        ports=[port('shell_in', 'Mantel Eingang', 0, 40, 'process', 'in'),
               port('shell_out', 'Mantel Ausgang', 120, 40, 'process', 'out'),
               port('tube_in', 'Rohr Eingang', 60, 0, 'utility', 'in'),
               port('tube_out', 'Rohr Ausgang', 60, 80, 'utility', 'out')],
        order=30,
    ))
    items.append(symbol_definition(
        'Heat_exchanger_of_floating_head_type', 'Wärmetauscher Floating Head', 'Wärmetauscher', 'floating-head-exchanger', 'E', 'horizontal_vessel',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 40 H8 M112 40 H120"/>
  <path class="pid-outline" d="M18 14 H96 C107 14 114 25 114 40 C114 55 107 66 96 66 H18 C11 66 6 55 6 40 C6 25 11 14 18 14 Z"/>
  <path class="pid-detail" d="M24 14 V66 M91 14 V66 M100 20 C106 27 106 53 100 60"/>
  <path class="pid-primary" data-pf-state-target="heat" d="M18 30 H93 M18 40 H98 M18 50 H93"/>
  <path class="pid-detail" d="M58 0 V14 M58 66 V80"/>
</g>
""",
        aliases=['floating head', 'schwimmkopf'],
        ports=[port('shell_in', 'Mantel Eingang', 0, 40, 'process', 'in'),
               port('shell_out', 'Mantel Ausgang', 120, 40, 'process', 'out'),
               port('tube_in', 'Rohr Eingang', 58, 0, 'utility', 'in'),
               port('tube_out', 'Rohr Ausgang', 58, 80, 'utility', 'out')],
        order=40,
    ))
    items.append(symbol_definition(
        'Valve_(general)', 'Regelventil', 'Ventile', 'valve', 'V', 'compact',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 40 H20 M60 40 H80"/>
  <path class="pid-outline" data-pf-state-target="valve" d="M20 24 L40 40 L20 56 Z M60 24 L40 40 L60 56 Z"/>
  <path class="pid-primary" d="M40 40 V16 M30 16 H50"/>
</g>
""",
        aliases=['valve', 'ventil', 'shutoff valve'],
        ports=[port('inlet', 'Eingang', 0, 40, 'process', 'in'),
               port('outlet', 'Ausgang', 80, 40, 'process', 'out'),
               port('actuator', 'Stellantrieb', 40, 0, 'signal', 'in')],
        favorite=True, order=10,
        animation_targets=['[data-pf-state-target="valve"]', '.pid-primary'],
    ))
    items.append(symbol_definition(
        'Control_valve', 'Stellventil mit Antrieb', 'Ventile', 'control-valve', 'CV', 'compact',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 46 H20 M60 46 H80"/>
  <path class="pid-outline" data-pf-state-target="valve" d="M20 30 L40 46 L20 62 Z M60 30 L40 46 L60 62 Z"/>
  <path class="pid-primary" d="M40 46 V29"/>
  <path class="pid-state-fill" data-pf-state-target="actuator" d="M25 8 H55 V28 H25 Z"/>
  <path class="pid-detail" d="M40 8 V0"/>
</g>
""",
        aliases=['control valve', 'stellventil', 'actuated valve'],
        ports=[port('inlet', 'Eingang', 0, 46, 'process', 'in'),
               port('outlet', 'Ausgang', 80, 46, 'process', 'out'),
               port('control', 'Stellsignal', 40, 0, 'signal', 'in')],
        favorite=True, order=20,
        animation_targets=['[data-pf-state-target="valve"]', '[data-pf-state-target="actuator"]'],
    ))
    items.append(symbol_definition(
        'Valve_globe_type', 'Globe-Ventil', 'Ventile', 'globe-valve', 'V', 'compact',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 42 H18 M62 42 H80"/>
  <path class="pid-outline" d="M18 26 L40 42 L18 58 Z M62 26 L40 42 L62 58 Z"/>
  <circle class="pid-state-fill" data-pf-state-target="plug" cx="40" cy="42" r="5"/>
  <path class="pid-primary" d="M40 37 V14 M30 14 H50"/>
</g>
""",
        aliases=['globe valve', 'sitzventil'],
        ports=[port('inlet', 'Eingang', 0, 42, 'process', 'in'),
               port('outlet', 'Ausgang', 80, 42, 'process', 'out'),
               port('actuator', 'Stellantrieb', 40, 0, 'signal', 'in')],
        order=30,
    ))
    items.append(symbol_definition(
        'Valve_needle_type', 'Nadelventil', 'Ventile', 'needle-valve', 'V', 'compact',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 42 H18 M62 42 H80"/>
  <path class="pid-outline" d="M18 26 L40 42 L18 58 Z M62 26 L40 42 L62 58 Z"/>
  <path class="pid-primary" data-pf-state-target="needle" d="M40 10 V47 M34 14 H46"/>
</g>
""",
        aliases=['needle valve', 'nadelventil'],
        ports=[port('inlet', 'Eingang', 0, 42, 'process', 'in'),
               port('outlet', 'Ausgang', 80, 42, 'process', 'out')],
        order=40,
    ))
    items.append(symbol_definition(
        'Self-operating_release_valve_(steam_trap)', 'Kondensatableiter', 'Ventile', 'steam-trap', 'ST', 'compact',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 40 H18 M62 40 H80"/>
  <path class="pid-outline" d="M18 24 L40 40 L18 56 Z M62 24 L40 40 L62 56 Z"/>
  <path class="pid-warning" data-pf-state-target="trap" d="M26 18 C32 4 48 4 54 18 M32 18 V28 M48 18 V28"/>
  <path class="pid-detail" d="M32 62 H48"/>
</g>
""",
        aliases=['steam trap', 'kondensatableiter'],
        ports=[port('inlet', 'Dampf/Kondensat', 0, 40, 'utility', 'in'),
               port('outlet', 'Kondensat', 80, 40, 'utility', 'out')],
        order=50,
    ))
    items.append(symbol_definition(
        'Jacketed_vessel_(wdeaadbem)', 'Doppelmantelreaktor', 'Reaktoren', 'jacketed-reactor', 'R', 'reactor',
        """
<g data-pf-role="body">
  <path class="pid-warning" d="M22 18 C22 10 78 10 78 18 L78 105 C78 116 22 116 22 105 Z"/>
  <path class="pid-outline" d="M29 23 C29 17 71 17 71 23 L71 100 C71 108 29 108 29 100 Z"/>
  <path class="pid-detail" d="M29 23 C29 29 71 29 71 23 M29 100 C29 94 71 94 71 100"/>
  <path class="pid-primary" data-pf-state-target="agitator" d="M50 0 V69 M38 42 H62 M38 69 L50 58 L62 69"/>
  <path class="pid-state-fill" data-pf-state-target="level" d="M31 77 C31 73 69 73 69 77 L69 100 C69 104 31 104 31 100 Z"/>
  <path class="pid-flow" d="M0 62 H22 M78 62 H100"/>
  <path class="pid-warning" d="M12 34 H22 M78 34 H88 M12 96 H22 M78 96 H88"/>
</g>
""",
        aliases=['reactor', 'jacketed vessel', 'rührbehälter'],
        ports=[port('feed', 'Produktzulauf', 0, 62, 'process', 'in'),
               port('product', 'Produktauslauf', 100, 62, 'process', 'out'),
               port('utility_in', 'Mantel Vorlauf', 0, 34, 'utility', 'in'),
               port('utility_out', 'Mantel Rücklauf', 100, 34, 'utility', 'out'),
               port('vent', 'Entlüftung', 78, 0, 'process', 'out'),
               port('drive', 'Rührerantrieb', 50, 0, 'power', 'in'),
               port('temperature', 'Temperatursignal', 100, 96, 'signal', 'in')],
        favorite=True, order=10,
        animation_targets=['[data-pf-state-target="agitator"]', '[data-pf-state-target="level"]', '.pid-warning'],
    ))
    items.append(symbol_definition(
        'Temperature_transmitter', 'Temperaturmessstelle', 'Messstellen', 'temperature-transmitter', 'TT', 'instrument',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M35 0 V20 M35 70 V90"/>
  <circle class="pid-outline" cx="35" cy="45" r="25"/>
  <text x="35" y="42" text-anchor="middle" font-size="13" font-weight="700">TT</text>
  <text x="35" y="55" text-anchor="middle" font-size="8">TEMP</text>
  <circle class="pid-state-fill" data-pf-state-target="signal" cx="35" cy="45" r="3"/>
</g>
""",
        aliases=['temperature', 'tt', 'temperatur'],
        ports=[port('process', 'Messstelle', 35, 90, 'process', 'in'),
               port('signal', 'Messsignal', 70, 45, 'signal', 'out')],
        favorite=True, order=10,
        animation_targets=['[data-pf-state-target="signal"]', '.pid-outline'],
    ))
    items.append(symbol_definition(
        'Pressure_indicator', 'Druckanzeige', 'Messstellen', 'pressure-indicator', 'PI', 'instrument',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M35 0 V20 M35 70 V90"/>
  <circle class="pid-outline" cx="35" cy="45" r="25"/>
  <text x="35" y="42" text-anchor="middle" font-size="13" font-weight="700">PI</text>
  <text x="35" y="55" text-anchor="middle" font-size="8">PRESS</text>
  <path class="pid-primary" data-pf-state-target="needle" d="M35 45 L49 34"/>
</g>
""",
        aliases=['pressure', 'pi', 'druck'],
        ports=[port('process', 'Messstelle', 35, 90, 'process', 'in'),
               port('signal', 'Messsignal', 70, 45, 'signal', 'out')],
        order=20,
    ))
    items.append(symbol_definition(
        'Flow_transmitter', 'Durchflussmessstelle', 'Messstellen', 'flow-transmitter', 'FT', 'instrument',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M35 0 V20 M35 70 V90"/>
  <circle class="pid-outline" cx="35" cy="45" r="25"/>
  <text x="35" y="42" text-anchor="middle" font-size="13" font-weight="700">FT</text>
  <text x="35" y="55" text-anchor="middle" font-size="8">FLOW</text>
  <path class="pid-flow" data-pf-state-target="flow" d="M22 62 H48"/>
</g>
""",
        aliases=['flow', 'ft', 'durchfluss'],
        ports=[port('process', 'Messstelle', 35, 90, 'process', 'in'),
               port('signal', 'Messsignal', 70, 45, 'signal', 'out')],
        order=30,
    ))
    items.append(symbol_definition(
        'Level_transmitter', 'Füllstandmessstelle', 'Messstellen', 'level-transmitter', 'LT', 'instrument',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M35 0 V20 M35 70 V90"/>
  <circle class="pid-outline" cx="35" cy="45" r="25"/>
  <text x="35" y="42" text-anchor="middle" font-size="13" font-weight="700">LT</text>
  <text x="35" y="55" text-anchor="middle" font-size="8">LEVEL</text>
  <path class="pid-state-fill" data-pf-state-target="level" d="M22 56 H48 V64 H22 Z"/>
</g>
""",
        aliases=['level', 'lt', 'füllstand'],
        ports=[port('process', 'Messstelle', 35, 90, 'process', 'in'),
               port('signal', 'Messsignal', 70, 45, 'signal', 'out')],
        order=40,
    ))
    items.append(symbol_definition(
        'Generic_Sensor_Entity', 'Generische Sensor-Entität', 'Messstellen',
        'generic-sensor-entity', 'SE', 'instrument',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M35 0 V20 M35 70 V90"/>
  <circle class="pid-outline" cx="35" cy="45" r="25"/>
  <text x="35" y="42" text-anchor="middle" font-size="13" font-weight="700">SE</text>
  <text x="35" y="55" text-anchor="middle" font-size="8">GEN</text>
  <circle class="pid-state-fill" data-pf-state-target="signal" cx="35" cy="45" r="4"/>
  <path class="pid-primary" data-pf-state-target="activity" d="M20 62 H50"/>
</g>
""",
        aliases=[
            'generic sensor', 'sensor entity', 'generic_sensor_entity',
            'universelle messstelle', 'sensor', 'messstelle',
        ],
        ports=[
            port('process', 'Messstelle', 35, 90, 'process', 'in'),
            port('signal', 'Messsignal', 70, 45, 'signal', 'out'),
            port('data', 'Datenwert', 0, 45, 'data', 'out'),
        ],
        order=50,
        animation_targets=[
            '[data-pf-state-target="signal"]',
            '[data-pf-state-target="activity"]',
            '.pid-outline',
        ],
        bindings=[{
            'role': 'sensor',
            'mode': 'generic',
            'sensor_type': None,
        }],
    ))
    items.append(symbol_definition(
        'Column', 'Prozesskolonne', 'Kolonnen', 'process-column', 'C', 'column',
        """
<g data-pf-role="body">
  <path class="pid-outline" d="M22 15 C22 7 68 7 68 15 L68 121 C68 131 22 131 22 121 Z"/>
  <path class="pid-detail" d="M22 15 C22 23 68 23 68 15 M22 121 C22 113 68 113 68 121 M28 39 H62 M28 61 H62 M28 83 H62 M28 105 H62"/>
  <path class="pid-flow" d="M0 70 H22 M68 70 H90 M45 0 V9 M45 131 V140"/>
  <path class="pid-state-fill" data-pf-state-target="level" d="M24 104 H66 V121 C66 126 24 126 24 121 Z"/>
</g>
""",
        aliases=['column', 'kolonne', 'distillation'],
        ports=[port('feed', 'Feed', 0, 70, 'process', 'in'),
               port('side_draw', 'Seitenabzug', 90, 70, 'process', 'out'),
               port('overhead', 'Kopfprodukt', 45, 0, 'process', 'out'),
               port('bottoms', 'Sumpfprodukt', 45, 140, 'process', 'out')],
        order=10,
    ))
    items.append(symbol_definition(
        'Jacked_pipeline', 'Doppelmantel-Rohrleitung', 'Rohrleitungen', 'jacketed-pipeline', 'PL', 'pipeline',
        """
<g data-pf-role="body">
  <path class="pid-warning" d="M0 18 H120 M0 42 H120"/>
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H120"/>
  <path class="pid-detail" d="M20 18 V42 M100 18 V42"/>
  <path class="pid-primary" data-pf-role="flow-arrow" data-pf-arrow-center="60.5 30" d="M55 24 L66 30 L55 36 Z"/>
</g>
""",
        aliases=['jacketed pipeline', 'doppelmantel', 'pipe'],
        ports=[port('process_in', 'Prozess Eingang', 0, 30, 'process', 'in'),
               port('process_out', 'Prozess Ausgang', 120, 30, 'process', 'out'),
               port('utility_in', 'Mantel Eingang', 20, 0, 'utility', 'in'),
               port('utility_out', 'Mantel Ausgang', 100, 60, 'utility', 'out')],
        order=10,
        stretch=stretch_profile('x', [(0, 26), (50, 72), (94, 120)]),
    ))
    items.append(symbol_definition(
        'Electric_motor', 'Elektromotor', 'Antriebe', 'electric-motor', 'M', 'machine',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M0 40 H16 M74 40 H90"/>
  <circle class="pid-state-fill" data-pf-state-target="motor" cx="45" cy="40" r="27"/>
  <text x="45" y="46" text-anchor="middle" font-size="20" font-weight="700">M</text>
</g>
""",
        aliases=['motor', 'drive', 'antrieb'],
        ports=[port('shaft', 'Welle', 90, 40, 'power', 'out'),
               port('power', 'Energie', 0, 40, 'power', 'in'),
               port('control', 'Steuersignal', 45, 0, 'signal', 'in'),
               port('status', 'Status', 45, 80, 'signal', 'out')],
        order=10,
        animation_targets=['[data-pf-state-target="motor"]'],
    ))
    items.append(symbol_definition(
        'wago_750_352_system', 'WAGO 750-352 System', 'I/O-Hardware', 'remote-io', 'RIO', 'hardware',
        """
<g data-pf-role="body">
  <rect class="pid-outline" x="4" y="10" width="112" height="70" rx="4"/>
  <rect class="pid-state-fill" data-pf-state-target="controller" x="10" y="17" width="28" height="56" rx="3"/>
  <rect class="pid-muted-fill" x="42" y="17" width="12" height="56"/><rect class="pid-muted-fill" x="57" y="17" width="12" height="56"/>
  <rect class="pid-muted-fill" x="72" y="17" width="12" height="56"/><rect class="pid-muted-fill" x="87" y="17" width="12" height="56"/>
  <rect class="pid-muted-fill" x="102" y="17" width="8" height="56"/>
  <circle class="pid-primary" cx="18" cy="27" r="3"/><circle class="pid-state-fill" cx="29" cy="27" r="3"/>
  <path class="pid-detail" d="M16 42 H32 M16 50 H32 M16 58 H32"/>
</g>
""",
        aliases=['wago', '750-352', 'remote io', 'feldbus'],
        ports=[port('fieldbus_in', 'Feldbus Eingang', 0, 30, 'data', 'in'),
               port('fieldbus_out', 'Feldbus Ausgang', 120, 30, 'data', 'out'),
               port('power', 'Versorgung', 18, 90, 'power', 'in'),
               port('io', 'Prozess-I/O', 90, 90, 'signal', 'bidirectional')],
        order=10,
        animation_targets=['[data-pf-state-target="controller"]', '.pid-primary'],
    ))
    items.append(symbol_definition(
        'wago_detailed', 'WAGO I/O Station detailliert', 'I/O-Hardware', 'remote-io-detailed', 'RIO', 'hardware',
        """
<g data-pf-role="body">
  <rect class="pid-outline" x="2" y="8" width="116" height="74" rx="4"/>
  <rect class="pid-state-fill" data-pf-state-target="controller" x="7" y="14" width="27" height="62" rx="3"/>
  <g class="pid-detail"><path d="M13 25 H28 M13 33 H28 M13 41 H28 M13 49 H28 M13 57 H28"/></g>
  <g class="pid-muted-fill"><rect x="38" y="14" width="13" height="62"/><rect x="54" y="14" width="13" height="62"/><rect x="70" y="14" width="13" height="62"/><rect x="86" y="14" width="13" height="62"/><rect x="102" y="14" width="10" height="62"/></g>
  <g class="pid-primary"><circle cx="44.5" cy="24" r="2"/><circle cx="60.5" cy="24" r="2"/><circle cx="76.5" cy="24" r="2"/><circle cx="92.5" cy="24" r="2"/></g>
  <g class="pid-detail"><path d="M44 32 V67 M60 32 V67 M76 32 V67 M92 32 V67"/></g>
</g>
""",
        aliases=['wago detailed', 'io station', 'feldstation'],
        ports=[port('fieldbus_in', 'Feldbus Eingang', 0, 28, 'data', 'in'),
               port('fieldbus_out', 'Feldbus Ausgang', 120, 28, 'data', 'out'),
               port('power', 'Versorgung', 18, 90, 'power', 'in'),
               port('io', 'Prozess-I/O', 90, 90, 'signal', 'bidirectional')],
        order=20,
        animation_targets=['[data-pf-state-target="controller"]', '.pid-primary'],
    ))
    items.append(symbol_definition(
        'graphic(53)', 'Inline-Prozessfilter', 'Filter', 'inline-filter', 'F', 'machine',
        """
<g data-pf-role="body">
  <path class="pid-flow" d="M0 40 H16 M74 40 H90"/>
  <path class="pid-outline" d="M16 20 H74 L62 60 H28 Z"/>
  <path class="pid-detail" d="M28 28 L62 52 M38 24 L68 46 M22 38 L50 60"/>
  <path class="pid-state-fill" data-pf-state-target="filter" d="M30 48 H60 L57 57 H33 Z"/>
</g>
""",
        aliases=['filter', 'inline filter', 'graphic 53'],
        ports=[port('inlet', 'Eingang', 0, 40, 'process', 'in'),
               port('outlet', 'Ausgang', 90, 40, 'process', 'out'),
               port('drain', 'Entleerung', 45, 80, 'utility', 'out')],
        order=10,
    ))
    items.extend(build_v64_definitions())
    return items


def build_v64_definitions():
    """Return elemental V64 construction symbols with semantic connection ports."""
    items = []
    items.append(symbol_definition(
        'Pipe_straight', 'Gerades Prozessrohr', 'Rohrbauteile', 'pipe-straight', 'PL', 'pipe',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M0 23 H140 M0 37 H140"/>
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H140"/>
  <path class="pid-primary" data-pf-role="flow-arrow" data-pf-arrow-center="67 30" d="M61 24 L73 30 L61 36 Z"/>
  <circle class="pid-terminal" cx="0" cy="30" r="3"/><circle class="pid-terminal" cx="140" cy="30" r="3"/>
</g>
""",
        aliases=['pipe', 'rohr', 'pipeline', 'straight pipe'],
        ports=[port('inlet', 'Rohr Eingang', 0, 30, 'process', 'in'),
               port('outlet', 'Rohr Ausgang', 140, 30, 'process', 'out')],
        favorite=True, order=10,
        animation_targets=['[data-pf-state-target="flow"]', '.pid-detail'],
        stretch=stretch_profile('x', [(0, 12), (56, 78), (128, 140)]),
    ))
    items.append(symbol_definition(
        'Pipe_elbow_90', 'Rohrbogen 90°', 'Rohrbauteile', 'pipe-elbow-90', 'PL', 'pipe_elbow',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M0 23 H55 C67 23 77 33 77 45 V100 M0 37 H55 C59 37 63 41 63 45 V100"/>
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H55 C63 30 70 37 70 45 V100"/>
  <path class="pid-primary" data-pf-role="flow-arrow" data-pf-arrow-center="70 67" d="M64 61 L70 73 L76 61 Z"/>
  <circle class="pid-terminal" cx="0" cy="30" r="3"/><circle class="pid-terminal" cx="70" cy="100" r="3"/>
</g>
""",
        aliases=['pipe elbow', 'rohrbogen', '90 degree'],
        ports=[port('inlet', 'Rohr Eingang', 0, 30, 'process', 'in'),
               port('outlet', 'Rohr Ausgang', 70, 100, 'process', 'out')],
        order=20,
        animation_targets=['[data-pf-state-target="flow"]', '.pid-detail'],
    ))
    items.append(symbol_definition(
        'Pipe_tee', 'Rohr-T-Stück', 'Rohrbauteile', 'pipe-tee', 'PL', 'pipe',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M0 23 H140 M0 37 H63 M77 37 H140 M63 37 V60 M77 37 V60"/>
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H140 M70 30 V60"/>
  <path class="pid-primary" data-pf-role="flow-arrow" data-pf-arrow-center="35 30" d="M29 24 L41 30 L29 36 Z"/>
  <circle class="pid-terminal" cx="0" cy="30" r="3"/><circle class="pid-terminal" cx="140" cy="30" r="3"/><circle class="pid-terminal" cx="70" cy="60" r="3"/>
</g>
""",
        aliases=['tee', 't piece', 't-stück', 'pipe branch'],
        ports=[port('inlet', 'Rohr Eingang', 0, 30, 'process', 'in'),
               port('outlet', 'Rohr Ausgang', 140, 30, 'process', 'out'),
               port('branch', 'Abzweig', 70, 60, 'process', 'bidirectional')],
        order=30,
        animation_targets=['[data-pf-state-target="flow"]', '.pid-detail'],
        stretch=stretch_profile('x', [(0, 12), (26, 44), (58, 82), (128, 140)]),
    ))
    items.append(symbol_definition(
        'Flange_pair', 'Flanschpaar', 'Rohrbauteile', 'flange-pair', 'FL', 'flange',
        """
<g data-pf-role="body">
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H60"/>
  <path class="pid-outline" data-pf-state-target="flange" d="M23 11 V49 M28 11 V49 M32 11 V49 M37 11 V49"/>
  <path class="pid-detail" d="M18 17 H42 M18 43 H42"/>
  <circle class="pid-terminal" cx="0" cy="30" r="3"/><circle class="pid-terminal" cx="60" cy="30" r="3"/>
</g>
""",
        aliases=['flange', 'flansch', 'flange pair', 'swagelok'],
        ports=[port('inlet', 'Flansch Eingang', 0, 30, 'process', 'in'),
               port('outlet', 'Flansch Ausgang', 60, 30, 'process', 'out')],
        favorite=True, order=40,
        animation_targets=['[data-pf-state-target="flow"]', '[data-pf-state-target="flange"]'],
    ))
    items.append(symbol_definition(
        'Gas_bottle', 'Gasflasche', 'Behälter', 'gas-bottle', 'B', 'bottle',
        """
<g data-pf-role="body">
  <path class="pid-outline" d="M17 31 C17 20 25 14 35 14 C45 14 53 20 53 31 V132 C53 141 17 141 17 132 Z"/>
  <path class="pid-detail" d="M17 31 C23 37 47 37 53 31 M17 132 C23 126 47 126 53 132 M29 14 V8 H41 V14"/>
  <rect class="pid-state-fill" data-pf-state-target="valve" x="26" y="2" width="18" height="7" rx="1"/>
  <path class="pid-state-fill" data-pf-state-target="level" d="M20 91 H50 V131 C50 135 20 135 20 131 Z"/>
  <path class="pid-flow" d="M35 0 V2 M35 139 V150"/>
</g>
""",
        aliases=['gas bottle', 'gasflasche', 'cylinder', 'versorgung'],
        ports=[port('gas_out', 'Gas Ausgang', 35, 0, 'process', 'out'),
               port('service_in', 'Befüllung / Service', 35, 150, 'process', 'in')],
        order=40,
        animation_targets=['[data-pf-state-target="valve"]', '[data-pf-state-target="level"]'],
    ))
    items.append(symbol_definition(
        'Tubular_reactor', 'Vertikaler Rohrreaktor', 'Reaktoren', 'tubular-reactor', 'R', 'vertical_reactor',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M38 14 H62 V205 C62 224 72 232 90 232 H100 M38 14 V205 C38 229 54 240 78 240 H100"/>
  <path class="pid-state-fill" data-pf-state-target="process" d="M44 20 H56 V204 C56 216 67 220 92 220 V232 C61 232 44 223 44 204 Z"/>
  <path class="pid-flow" data-pf-state-target="flow" d="M50 0 V218 C50 230 66 232 92 232 H100"/>
  <path class="pid-detail" d="M30 45 H70 M30 51 H70 M30 105 H70 M30 111 H70 M30 166 H70 M30 172 H70"/>
  <path class="pid-primary" d="M44 82 L50 94 L56 82 Z M44 144 L50 156 L56 144 Z"/>
</g>
""",
        aliases=['tubular reactor', 'rohrreaktor', 'r-101', 'vertical tube'],
        ports=[port('feed', 'Edukt Eingang', 50, 0, 'process', 'in'),
               port('product', 'Produkt Ausgang', 100, 232, 'process', 'out')],
        favorite=True, order=20,
        animation_targets=['[data-pf-state-target="process"]', '[data-pf-state-target="flow"]'],
    ))
    items.append(symbol_definition(
        'Tube_furnace', 'Rohrofen', 'Reaktoren', 'tube-furnace', 'H', 'furnace',
        """
<g data-pf-role="body">
  <rect class="pid-outline" x="22" y="18" width="116" height="184" rx="3"/>
  <rect class="pid-state-fill" data-pf-state-target="temperature" x="28" y="24" width="104" height="172" rx="2"/>
  <path class="pid-warning" data-pf-state-target="heater_left" d="M45 38 L59 60 L45 82 L59 104 L45 126 L59 148 L45 170 L59 190"/>
  <path class="pid-warning" data-pf-state-target="heater_right" d="M101 38 L115 60 L101 82 L115 104 L101 126 L115 148 L101 170 L115 190"/>
  <path class="pid-flow" data-pf-state-target="process" d="M80 0 V220"/>
  <path class="pid-detail" d="M73 0 V220 M87 0 V220 M65 20 H95 M65 200 H95"/>
  <path class="pid-primary" d="M74 92 L80 104 L86 92 Z M74 142 L80 154 L86 142 Z"/>
</g>
""",
        aliases=['tube furnace', 'rohrofen', 'heater', 'h-101'],
        ports=[port('process_in', 'Prozess Eingang', 80, 0, 'process', 'in'),
               port('process_out', 'Prozess Ausgang', 80, 220, 'process', 'out'),
               port('energy', 'Heizleistung', 160, 110, 'power', 'in'),
               port('temperature', 'Temperatursignal', 0, 110, 'signal', 'out')],
        favorite=True, order=30,
        animation_targets=['[data-pf-state-target="temperature"]', '[data-pf-state-target="heater_left"]', '[data-pf-state-target="heater_right"]', '[data-pf-state-target="process"]'],
    ))
    items.append(symbol_definition(
        'Double_pipe_cooler', 'Doppelrohr-Kühler', 'Wärmetauscher', 'double-pipe-cooler', 'W', 'cooler_vertical',
        """
<g data-pf-role="body">
  <rect class="pid-outline" x="22" y="16" width="56" height="188" rx="2"/>
  <rect class="pid-state-fill" data-pf-state-target="coolant" x="29" y="23" width="42" height="174" rx="1"/>
  <path class="pid-flow" data-pf-state-target="process" d="M50 0 V220"/>
  <path class="pid-detail" d="M44 0 V220 M56 0 V220 M78 58 H100 M78 162 H100"/>
  <path class="pid-primary" d="M44 85 L50 97 L56 85 Z M44 133 L50 145 L56 133 Z"/>
  <path class="pid-warning" d="M91 52 L99 58 L91 64 M87 156 L79 162 L87 168"/>
</g>
""",
        aliases=['double pipe cooler', 'doppelrohr kühler', 'cooler', 'w-101'],
        ports=[port('process_in', 'Prozess Eingang', 50, 0, 'process', 'in'),
               port('process_out', 'Prozess Ausgang', 50, 220, 'process', 'out'),
               port('coolant_out', 'Kühlwasser Ausgang', 100, 58, 'utility', 'out'),
               port('coolant_in', 'Kühlwasser Eingang', 100, 162, 'utility', 'in')],
        favorite=True, order=50,
        animation_targets=['[data-pf-state-target="coolant"]', '[data-pf-state-target="process"]'],
    ))
    items.append(symbol_definition(
        'Plate_heat_exchanger', 'Plattenwärmetauscher', 'Wärmetauscher', 'plate-heat-exchanger', 'E', 'horizontal_vessel',
        """
<g data-pf-role="body">
  <rect class="pid-outline" x="18" y="10" width="84" height="60" rx="4"/>
  <path class="pid-state-fill" data-pf-state-target="heat" d="M28 17 L42 63 M42 17 L56 63 M56 17 L70 63 M70 17 L84 63 M84 17 L94 51"/>
  <path class="pid-flow" data-pf-state-target="hot" d="M0 24 H18 M102 24 H120"/>
  <path class="pid-primary" data-pf-state-target="cold" d="M0 56 H18 M102 56 H120"/>
  <circle class="pid-terminal" cx="0" cy="24" r="3"/><circle class="pid-terminal" cx="120" cy="24" r="3"/>
  <circle class="pid-terminal" cx="0" cy="56" r="3"/><circle class="pid-terminal" cx="120" cy="56" r="3"/>
</g>
""",
        aliases=['plate exchanger', 'plattenwärmetauscher', 'heat transfer'],
        ports=[port('hot_in', 'Warmseite Eingang', 0, 24, 'process', 'in'),
               port('hot_out', 'Warmseite Ausgang', 120, 24, 'process', 'out'),
               port('cold_in', 'Kaltseite Eingang', 120, 56, 'utility', 'in'),
               port('cold_out', 'Kaltseite Ausgang', 0, 56, 'utility', 'out')],
        order=60,
        animation_targets=['[data-pf-state-target="heat"]', '[data-pf-state-target="hot"]', '[data-pf-state-target="cold"]'],
    ))
    items.extend(build_v64_r4_definitions())
    items.extend(build_v64_r5_definitions())
    return items


def build_v64_r4_definitions():
    """Return the V64_r4 fitting, capillary, mixer, termination and boundary parts."""
    items = []
    items.append(symbol_definition(
        'Swagelok_union', 'Swagelok-Verschraubung', 'Rohrbauteile', 'swagelok-union', 'SW', 'fitting',
        """
<g data-pf-role="body">
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H60"/>
  <path class="pid-outline" data-pf-state-target="fitting" d="M11 22 L15 19 H23 L27 22 V38 L23 41 H15 L11 38 Z M33 22 L37 19 H45 L49 22 V38 L45 41 H37 L33 38 Z"/>
  <path class="pid-muted-fill" d="M27 24 H33 V36 H27 Z"/>
  <path class="pid-detail" d="M15 19 V41 M23 19 V41 M37 19 V41 M45 19 V41"/>
  <circle class="pid-terminal" cx="0" cy="30" r="3"/><circle class="pid-terminal" cx="60" cy="30" r="3"/>
</g>
""",
        aliases=['swagelok', 'verschraubung', 'union', 'tube fitting', 'klemmring'],
        ports=[port('inlet', 'Verschraubung Eingang', 0, 30, 'process', 'in'),
               port('outlet', 'Verschraubung Ausgang', 60, 30, 'process', 'out')],
        favorite=True, order=41,
        animation_targets=['[data-pf-state-target="flow"]', '[data-pf-state-target="fitting"]'],
    ))
    items.append(symbol_definition(
        'Swagelok_tee', 'Swagelok-T-Verschraubung', 'Rohrbauteile', 'swagelok-tee', 'SW', 'fitting_tee',
        """
<g data-pf-role="body">
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H80 M40 30 V60"/>
  <rect class="pid-muted-fill" x="29" y="19" width="22" height="22" rx="2"/>
  <path class="pid-outline" data-pf-state-target="fitting" d="M9 22 L13 19 H21 L25 22 V38 L21 41 H13 L9 38 Z M55 22 L59 19 H67 L71 22 V38 L67 41 H59 L55 38 Z M32 45 L35 41 H45 L48 45 V53 L45 57 H35 L32 53 Z"/>
  <path class="pid-detail" d="M13 19 V41 M21 19 V41 M59 19 V41 M67 19 V41 M35 41 V57 M45 41 V57"/>
  <circle class="pid-terminal" cx="0" cy="30" r="3"/><circle class="pid-terminal" cx="80" cy="30" r="3"/><circle class="pid-terminal" cx="40" cy="60" r="3"/>
</g>
""",
        aliases=['swagelok tee', 't-verschraubung', 'tee fitting', 'abzweig'],
        ports=[port('inlet', 'Verschraubung Eingang', 0, 30, 'process', 'in'),
               port('outlet', 'Verschraubung Ausgang', 80, 30, 'process', 'out'),
               port('branch', 'Abzweig', 40, 60, 'process', 'bidirectional')],
        order=42,
        animation_targets=['[data-pf-state-target="flow"]', '[data-pf-state-target="fitting"]'],
    ))
    items.append(symbol_definition(
        'Swagelok_elbow', 'Swagelok-Winkelverschraubung', 'Rohrbauteile', 'swagelok-elbow', 'SW', 'fitting',
        """
<g data-pf-role="body">
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H30 V60"/>
  <rect class="pid-muted-fill" x="19" y="19" width="22" height="22" rx="2"/>
  <path class="pid-outline" data-pf-state-target="fitting" d="M5 22 L9 19 H15 L19 22 V38 L15 41 H9 L5 38 Z M22 45 L25 41 H35 L38 45 V53 L35 57 H25 L22 53 Z"/>
  <path class="pid-detail" d="M9 19 V41 M15 19 V41 M25 41 V57 M35 41 V57"/>
  <circle class="pid-terminal" cx="0" cy="30" r="3"/><circle class="pid-terminal" cx="30" cy="60" r="3"/>
</g>
""",
        aliases=['swagelok elbow', 'winkelverschraubung', 'elbow fitting', '90 grad'],
        ports=[port('inlet', 'Verschraubung Eingang', 0, 30, 'process', 'in'),
               port('outlet', 'Verschraubung Ausgang', 30, 60, 'process', 'out')],
        order=43,
        animation_targets=['[data-pf-state-target="flow"]', '[data-pf-state-target="fitting"]'],
    ))
    items.append(symbol_definition(
        'Capillary_line', 'Titan-Kapillare', 'Rohrbauteile', 'capillary-line', 'CL', 'pipe',
        """
<g data-pf-role="body">
  <path class="pid-detail" data-pf-state-target="flow" d="M0 30 H140"/>
  <path class="pid-detail" d="M8 25 V35 M12 25 V35 M128 25 V35 M132 25 V35"/>
  <path class="pid-primary" data-pf-role="flow-arrow" data-pf-arrow-center="67 30" d="M62 25 L72 30 L62 35 Z"/>
  <circle class="pid-terminal" cx="0" cy="30" r="2.4"/><circle class="pid-terminal" cx="140" cy="30" r="2.4"/>
</g>
""",
        aliases=['capillary', 'kapillare', 'titan', 'titanium', 'dünnes rohr'],
        ports=[port('inlet', 'Kapillare Eingang', 0, 30, 'process', 'in'),
               port('outlet', 'Kapillare Ausgang', 140, 30, 'process', 'out')],
        order=44,
        animation_targets=['[data-pf-state-target="flow"]', '.pid-detail'],
        stretch=stretch_profile('x', [(0, 16), (58, 76), (124, 140)]),
    ))
    items.append(symbol_definition(
        'Pipe_cap', 'Rohrtermination', 'Rohrbauteile', 'pipe-cap', 'PL', 'cap',
        """
<g data-pf-role="body">
  <path class="pid-detail" d="M0 23 H26 M0 37 H26"/>
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H26"/>
  <path class="pid-outline" data-pf-state-target="cap" d="M26 18 H31 C36 18 38 24 38 30 C38 36 36 42 31 42 H26 Z"/>
  <path class="pid-detail" d="M24 14 V46"/>
  <circle class="pid-terminal" cx="0" cy="30" r="3"/>
</g>
""",
        aliases=['cap', 'endkappe', 'termination', 'blind', 'rohrende'],
        ports=[port('inlet', 'Rohr Eingang', 0, 30, 'process', 'in'),
               port('tap', 'Messanschluss', 24, 14, 'process', 'bidirectional')],
        order=45,
        animation_targets=['[data-pf-state-target="flow"]', '[data-pf-state-target="cap"]'],
    ))
    items.append(symbol_definition(
        'Boundary_connector', 'Anschluss / Grenzstelle', 'Rohrbauteile', 'boundary-connector', 'X', 'flag',
        """
<g data-pf-role="body">
  <path class="pid-flow" data-pf-state-target="flow" d="M0 30 H26"/>
  <path class="pid-outline" data-pf-state-target="flag" d="M26 16 H78 L96 30 L78 44 H26 Z"/>
  <text data-pf-role="entity-label" x="57" y="34" text-anchor="middle" font-size="10" font-weight="600">Anschluss</text>
  <circle class="pid-terminal" cx="0" cy="30" r="3"/>
</g>
""",
        aliases=['connector', 'anschluss', 'grenzstelle', 'off-page', 'vent', 'n2', 'edukt', 'kühlwasser'],
        ports=[port('line', 'Leitung', 0, 30, 'process', 'bidirectional'),
               port('signal', 'Signalreferenz', 57, 16, 'signal', 'bidirectional')],
        favorite=True, order=46,
        animation_targets=['[data-pf-state-target="flow"]', '[data-pf-state-target="flag"]'],
    ))
    items.append(symbol_definition(
        'Gas_mixer', 'Gasphasen-Mischer', 'Behälter', 'gas-mixer', 'M', 'mixer',
        """
<g data-pf-role="body">
  <path class="pid-flow" data-pf-state-target="inlet_a" d="M0 24 H20"/>
  <path class="pid-flow" data-pf-state-target="inlet_b" d="M0 56 H20"/>
  <path class="pid-flow" data-pf-state-target="flow" d="M60 68 V80"/>
  <path class="pid-detail" d="M60 0 V12"/>
  <rect class="pid-outline" x="20" y="12" width="80" height="56" rx="12"/>
  <rect class="pid-state-fill" data-pf-state-target="mixing" x="27" y="19" width="66" height="42" rx="8"/>
  <path class="pid-detail" d="M36 26 L84 54 M36 54 L84 26 M60 19 V61"/>
  <path class="pid-primary" data-pf-role="flow-arrow" data-pf-arrow-center="60 74" d="M55 69 L60 79 L65 69 Z"/>
  <circle class="pid-terminal" cx="0" cy="24" r="3"/><circle class="pid-terminal" cx="0" cy="56" r="3"/><circle class="pid-terminal" cx="60" cy="80" r="3"/><circle class="pid-terminal" cx="60" cy="0" r="3"/>
</g>
""",
        aliases=['gas mixer', 'gasmischer', 'mischer', 'm-101', 'static mixer'],
        ports=[port('inlet_a', 'Eingang A', 0, 24, 'process', 'in'),
               port('inlet_b', 'Eingang B', 0, 56, 'process', 'in'),
               port('outlet', 'Mischgas Ausgang', 60, 80, 'process', 'out'),
               port('instrument', 'Instrumentenanschluss', 60, 0, 'process', 'bidirectional')],
        favorite=True, order=45,
        animation_targets=['[data-pf-state-target="mixing"]', '[data-pf-state-target="flow"]', '[data-pf-state-target="inlet_a"]', '[data-pf-state-target="inlet_b"]'],
    ))
    return items


CLASSIC_STYLE = """<style>
.pf-pid-v1 .pc-stroke{fill:none;stroke:#000;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.pf-pid-v1 .pc-wall{fill:#000}
.pf-pid-v1 .pc-bore{fill:#fff}
.pf-pid-v1 .pc-bore-line{fill:none;stroke:#fff;stroke-width:16}
.pf-pid-v1 .pc-tube-line{fill:none;stroke:#000;stroke-width:22}
.pf-pid-v1 .pc-white{fill:#fff;stroke:#000;stroke-width:2}
.pf-pid-v1 .pc-nut{fill:#fff;stroke:#000;stroke-width:1.5}
.pf-pid-v1 .pc-bubble{fill:#fff;stroke:#000;stroke-width:1.5}
.pf-pid-v1 .pc-bar{fill:none;stroke:#000;stroke-width:4}
.pf-pid-v1 .pc-pipe{fill:none;stroke:#333;stroke-width:3.5;stroke-linejoin:round}
.pf-pid-v1 .pc-thin{fill:none;stroke:#888;stroke-width:2}
.pf-pid-v1 .pc-dash{fill:none;stroke:#fff;stroke-width:2;stroke-dasharray:9 11;stroke-opacity:0}
.pf-pid-v1 .pc-state{fill:#cfd4da;stroke:#000;stroke-width:2.5}
.pf-pid-v1 .pc-valve{fill:#fff;stroke:#000;stroke-width:2}
.pf-pid-v1 .pc-text{font-family:Arial,Helvetica,sans-serif;fill:#000}
.pf-pid-v1 .pc-muted{font-family:Arial,Helvetica,sans-serif;fill:#444}
.pf-pid-v1 .pc-frame{fill:#e9ecef;stroke:#555;stroke-width:1.5}
.pf-pid-v1 .pc-ground{fill:none;stroke:#555;stroke-width:1.2}
[data-pf-visual-state="flow"] .pf-pid-v1 .pc-dash,[data-pf-visual-state="hot"] .pf-pid-v1 .pc-dash,[data-pf-visual-state="cold"] .pf-pid-v1 .pc-dash,[data-pf-visual-state="purge"] .pf-pid-v1 .pc-dash{stroke-opacity:.95}
[data-pf-visual-state="hot"] .pf-pid-v1 .pc-pipe{stroke:#b33a3a}
[data-pf-visual-state="cold"] .pf-pid-v1 .pc-pipe{stroke:#2f7fb8}
[data-pf-visual-state="purge"] .pf-pid-v1 .pc-pipe{stroke:#2db34a}
[data-pf-visual-state="purge"] .pf-pid-v1 .pc-thin,[data-pf-visual-state="flow"] .pf-pid-v1 .pc-thin,[data-pf-visual-state="open"] .pf-pid-v1 .pc-thin{stroke:#2db34a}
[data-pf-visual-state="heat"] .pf-pid-v1 .pc-bore,[data-pf-visual-state="heat"] .pf-pid-v1 .pc-bore-line{fill:#ffd1a8;stroke:#ffd1a8}
[data-pf-visual-state="hot"] .pf-pid-v1 .pc-bore,[data-pf-visual-state="hot"] .pf-pid-v1 .pc-bore-line{fill:#ff9a9a;stroke:#ff9a9a}
[data-pf-visual-state="cold"] .pf-pid-v1 .pc-bore,[data-pf-visual-state="cold"] .pf-pid-v1 .pc-bore-line{fill:#cfe6f7;stroke:#cfe6f7}
[data-pf-visual-state="heat"] .pf-pid-v1 .pc-bore{fill:#ffd1a8}
[data-pf-visual-state="hot"] .pf-pid-v1 .pc-bore{fill:#ff9a9a}
[data-pf-visual-state="cold"] .pf-pid-v1 .pc-bore{fill:#cfe6f7}
[data-pf-visual-state="heat"] .pf-pid-v1 .pc-state{fill:#f7931e}
[data-pf-visual-state="hot"] .pf-pid-v1 .pc-state{fill:#ee1c24}
[data-pf-visual-state="cold"] .pf-pid-v1 .pc-state{fill:#1e9be8}
[data-pf-visual-state="cool"] .pf-pid-v1 .pc-state{fill:#6fb7e8}
[data-pf-visual-state="open"] .pf-pid-v1 .pc-valve{fill:#2db34a}
[data-pf-visual-state="closed"] .pf-pid-v1 .pc-valve{fill:#ee1c24}
</style>"""

DASH_ANIMATION = '<animate attributeName="stroke-dashoffset" values="0;-20" dur="0.5s" repeatCount="indefinite"/>'
FLOW_STATES = ['neutral', 'flow', 'heat', 'hot', 'cold']
LINE_STATES = ['neutral', 'flow', 'hot', 'cold', 'purge']
THERMAL_STATES = ['neutral', 'heat', 'hot', 'cold', 'cool']
VALVE_STATES = ['neutral', 'open', 'closed']


def classic_body(markup):
    """Prefix one classic symbol body with the shared classic stylesheet."""
    return CLASSIC_STYLE + '\n<g data-pf-role="body">' + markup + '</g>'


def dash(path_data, target='flow'):
    """Running white dashes that become visible in flow/hot/cold/purge states."""
    return ('<path class="pc-dash" data-pf-state-target="%s" d="%s">%s</path>'
            % (target, path_data, DASH_ANIMATION))


def classic_definition(template_id, name, category, family, tag_prefix, profile, markup,
                       aliases=None, ports=None, favorite=False, order=100, stretch=None,
                       visual_states=None, default_visual_state='neutral', layer='process',
                       animation_targets=None):
    """Build one classic-style symbol with visual states and an optional layer hint."""
    definition = symbol_definition(
        template_id, name, category, family, tag_prefix, profile, classic_body(markup),
        aliases=aliases, ports=ports, favorite=favorite, order=order,
        animation_targets=animation_targets or ['[data-pf-state-target="flow"]', '.pc-state', '.pc-valve'],
        stretch=stretch,
    )
    definition['style'] = 'classic'
    definition['visual_states'] = list(visual_states or [])
    definition['default_visual_state'] = default_visual_state if default_visual_state in (visual_states or ['neutral']) else 'neutral'
    definition['layer'] = layer
    return definition


def build_v64_r5_definitions():
    """Return the classic optical variant: filled tubes, flanges, fittings, apparatus and frame parts."""
    items = []
    tube_ports = [port('inlet', 'Rohr Eingang', 0, 24, 'process', 'in'),
                  port('outlet', 'Rohr Ausgang', 160, 24, 'process', 'out')]
    line_ports = [port('inlet', 'Leitung Eingang', 0, 20, 'process', 'in'),
                  port('outlet', 'Leitung Ausgang', 160, 20, 'process', 'out')]

    # ------------------------------------------------------------------ tubes
    items.append(classic_definition(
        'Classic_tube', 'Rohr (Klassik, gefüllt)', 'Klassik · Rohrleitung', 'classic-tube', 'PL', 'classic_tube',
        '<rect class="pc-wall" x="0" y="13" width="160" height="22"/>'
        '<rect class="pc-bore" data-pf-state-target="temperature" x="0" y="16" width="160" height="16"/>'
        + dash('M0 24 H160'),
        aliases=['rohr', 'tube', 'doppellinie', 'classic pipe', 'ausgefuellt'],
        ports=tube_ports, favorite=True, order=200,
        stretch=stretch_profile('x', [(0, 2), (158, 160)]),
        visual_states=FLOW_STATES, default_visual_state='flow',
    ))
    items.append(classic_definition(
        'Classic_tube_flanged', 'Rohr mit Flansch (Klassik)', 'Klassik · Rohrleitung', 'classic-tube-flanged', 'PL', 'classic_tube',
        '<rect class="pc-wall" x="0" y="13" width="160" height="22"/>'
        '<rect class="pc-bore" data-pf-state-target="temperature" x="0" y="16" width="160" height="16"/>'
        + dash('M0 24 H160') +
        '<path class="pc-bar" data-pf-state-target="flange" d="M8 2 V46 M16 2 V46"/>',
        aliases=['rohr mit flansch', 'flanged tube', 'flansch'],
        ports=tube_ports, favorite=True, order=201,
        stretch=stretch_profile('x', [(0, 22), (158, 160)]),
        visual_states=FLOW_STATES, default_visual_state='flow',
    ))
    items.append(classic_definition(
        'Classic_flange', 'Flanschpaar (Klassik)', 'Klassik · Rohrleitung', 'classic-flange', 'FL', 'classic_flange',
        '<rect class="pc-wall" x="0" y="13" width="16" height="22"/>'
        '<rect class="pc-bore" data-pf-state-target="temperature" x="0" y="16" width="16" height="16"/>'
        + dash('M0 24 H16') +
        '<path class="pc-bar" data-pf-state-target="flange" d="M4 2 V46 M12 2 V46"/>',
        aliases=['flansch', 'flange', 'flanschpaar', 'balken'],
        ports=[port('inlet', 'Flansch Eingang', 0, 24, 'process', 'in'),
               port('outlet', 'Flansch Ausgang', 16, 24, 'process', 'out')],
        favorite=True, order=202,
        visual_states=FLOW_STATES, default_visual_state='flow',
    ))
    items.append(classic_definition(
        'Classic_flange_bolted', 'Flansch mit Verschraubung (Klassik)', 'Klassik · Rohrleitung', 'classic-flange-bolted', 'FL', 'classic_flange_bolted',
        '<rect class="pc-wall" x="0" y="13" width="40" height="22"/>'
        '<rect class="pc-bore" data-pf-state-target="temperature" x="0" y="16" width="40" height="16"/>'
        + dash('M0 24 H40') +
        '<rect class="pc-white" data-pf-state-target="flange" x="13" y="3" width="6" height="42"/>'
        '<rect class="pc-white" data-pf-state-target="flange" x="21" y="3" width="6" height="42"/>'
        '<rect class="pc-nut" x="8" y="5" width="24" height="5"/><rect class="pc-nut" x="8" y="38" width="24" height="5"/>'
        '<rect class="pc-nut" x="6" y="3" width="5" height="9"/><rect class="pc-nut" x="29" y="3" width="5" height="9"/>'
        '<rect class="pc-nut" x="6" y="36" width="5" height="9"/><rect class="pc-nut" x="29" y="36" width="5" height="9"/>',
        aliases=['flansch verschraubt', 'bolted flange', 'schrauben', 'muttern'],
        ports=[port('inlet', 'Flansch Eingang', 0, 24, 'process', 'in'),
               port('outlet', 'Flansch Ausgang', 40, 24, 'process', 'out')],
        order=203,
        visual_states=FLOW_STATES, default_visual_state='flow',
    ))
    items.append(classic_definition(
        'Classic_tube_elbow', 'Rohrbogen (Klassik, gefüllt)', 'Klassik · Rohrleitung', 'classic-tube-elbow', 'PL', 'classic_elbow',
        '<path class="pc-tube-line" d="M0 24 H24 A40 40 0 0 1 64 64 V88"/>'
        '<path class="pc-bore-line" data-pf-state-target="temperature" d="M0 24 H24 A40 40 0 0 1 64 64 V88"/>'
        + dash('M0 24 H24 A40 40 0 0 1 64 64 V88'),
        aliases=['rohrbogen', 'elbow', 'bogen'],
        ports=[port('inlet', 'Rohr Eingang', 0, 24, 'process', 'in'),
               port('outlet', 'Rohr Ausgang', 64, 88, 'process', 'out')],
        order=204,
        visual_states=FLOW_STATES, default_visual_state='flow',
    ))
    items.append(classic_definition(
        'Classic_tube_ubend', 'U-Bogen (Klassik, gefüllt)', 'Klassik · Rohrleitung', 'classic-tube-ubend', 'PL', 'classic_ubend',
        '<path class="pc-tube-line" d="M11 0 V109 A40 40 0 0 0 51 149 H181 A40 40 0 0 0 221 109 V0"/>'
        '<path class="pc-bore-line" data-pf-state-target="temperature" d="M11 0 V109 A40 40 0 0 0 51 149 H181 A40 40 0 0 0 221 109 V0"/>'
        + dash('M11 0 V109 A40 40 0 0 0 51 149 H181 A40 40 0 0 0 221 109 V0'),
        aliases=['u-bogen', 'u bend', 'rohrschleife', 'austritt'],
        ports=[port('inlet', 'Rohr Eingang', 11, 0, 'process', 'in'),
               port('outlet', 'Rohr Ausgang', 221, 0, 'process', 'out')],
        order=205,
        stretch=stretch_profile('y', [(109, 160)]),
        visual_states=FLOW_STATES, default_visual_state='flow',
    ))
    items.append(classic_definition(
        'Classic_tube_head', 'Rohrkopf mit Abschlussbalken (Klassik)', 'Klassik · Rohrleitung', 'classic-tube-head', 'PL', 'classic_head',
        '<rect class="pc-wall" x="13" y="0" width="22" height="10"/>'
        '<rect class="pc-bore" data-pf-state-target="temperature" x="16" y="0" width="16" height="10"/>'
        '<path class="pc-stroke" style="stroke-width:3;stroke-linecap:butt" d="M13 1.5 H35"/>'
        + dash('M24 0 V10'),
        aliases=['rohrkopf', 'abschluss', 'tube head', 'axialer eintritt'],
        ports=[port('capillary', 'Kapillare Eingang', 24, 0, 'process', 'in'),
               port('tube', 'Rohr Ausgang', 24, 10, 'process', 'out')],
        order=206,
        visual_states=FLOW_STATES, default_visual_state='flow',
    ))
    # Tube piece with two lateral taps: looks exactly like the plain tube, but a
    # capillary or Swagelok fitting plugs into either wall (left/right or
    # top/bottom depending on the rotation), so side attachments become joints.
    items.append(classic_definition(
        'Classic_tube_tap', 'Rohrstück mit Seitenanschluss (Klassik)', 'Klassik · Rohrleitung', 'classic-tube-tap', 'PL', 'classic_tap',
        '<rect class="pc-wall" x="0" y="13" width="48" height="22"/>'
        '<rect class="pc-bore" data-pf-state-target="temperature" x="0" y="16" width="48" height="16"/>'
        + dash('M0 24 H48'),
        aliases=['seitenanschluss', 'anbohrung', 'tap', 'seitlich', 'swagelok seitlich', 'messstutzen'],
        ports=[port('inlet', 'Rohr Eingang', 0, 24, 'process', 'in'),
               port('outlet', 'Rohr Ausgang', 48, 24, 'process', 'out'),
               port('tap_a', 'Seitenanschluss A (oben / rechts)', 24, 13, 'process', 'bidirectional', 'tap'),
               port('tap_b', 'Seitenanschluss B (unten / links)', 24, 35, 'process', 'bidirectional', 'tap')],
        order=207,
        stretch=stretch_profile('x', [(0, 2), (46, 48)]),
        visual_states=FLOW_STATES, default_visual_state='flow',
    ))

    # ------------------------------------------------------------------ thin lines, capillaries, fittings
    items.append(classic_definition(
        'Classic_capillary', 'Titan-Kapillare (Klassik)', 'Klassik · Rohrleitung', 'classic-capillary', 'CL', 'classic_line',
        '<path class="pc-pipe" data-pf-state-target="pipe" d="M0 20 H160"/>' + dash('M0 20 H160'),
        aliases=['kapillare', 'capillary', 'leitung', 'titan'],
        ports=line_ports, favorite=True, order=210,
        stretch=stretch_profile('x', [(0, 2), (158, 160)]),
        visual_states=LINE_STATES, default_visual_state='flow',
    ))
    items.append(classic_definition(
        'Classic_capillary_elbow', 'Kapillar-Bogen (Klassik)', 'Klassik · Rohrleitung', 'classic-capillary-elbow', 'CL', 'classic_fitting',
        '<path class="pc-pipe" data-pf-state-target="pipe" d="M0 20 H20 V40"/>' + dash('M0 20 H20 V40'),
        aliases=['kapillare bogen', 'line elbow', 'knick'],
        ports=[port('inlet', 'Leitung Eingang', 0, 20, 'process', 'in'),
               port('outlet', 'Leitung Ausgang', 20, 40, 'process', 'out')],
        order=211,
        visual_states=LINE_STATES, default_visual_state='flow',
    ))
    items.append(classic_definition(
        'Classic_swagelok', 'Swagelok-Verschraubung (Klassik)', 'Klassik · Rohrleitung', 'classic-swagelok', 'SW', 'classic_fitting',
        '<path class="pc-pipe" data-pf-state-target="pipe" d="M0 20 H40"/>' + dash('M0 20 H40') +
        '<rect class="pc-nut" data-pf-state-target="fitting" x="8" y="13" width="9" height="14"/>'
        '<rect class="pc-nut" data-pf-state-target="fitting" x="23" y="13" width="9" height="14"/>',
        aliases=['swagelok', 'verschraubung', 'fitting', 'klemmring'],
        ports=[port('inlet', 'Verschraubung Eingang', 0, 20, 'process', 'in'),
               port('outlet', 'Verschraubung Ausgang', 40, 20, 'process', 'out')],
        favorite=True, order=212,
        visual_states=LINE_STATES, default_visual_state='flow',
    ))
    items.append(classic_definition(
        'Classic_line', 'Dünne Leitung (Klassik)', 'Klassik · Rohrleitung', 'classic-line', 'LN', 'classic_line',
        '<path class="pc-thin" data-pf-state-target="pipe" d="M0 20 H160"/>',
        aliases=['leitung', 'line', 'gasleitung', 'grau', 'gruen'],
        ports=line_ports, order=213,
        stretch=stretch_profile('x', [(0, 2), (158, 160)]),
        visual_states=['neutral', 'flow', 'purge'], default_visual_state='neutral',
    ))

    # ------------------------------------------------------------------ valves and flags
    valve_ports = [port('inlet', 'Ventil Eingang', 0, 20, 'process', 'in'),
                   port('outlet', 'Ventil Ausgang', 60, 20, 'process', 'out'),
                   port('actuator', 'Stellsignal', 30, 4, 'signal', 'in')]
    items.append(classic_definition(
        'Classic_valve', 'Handventil (Klassik)', 'Klassik · Armaturen', 'classic-valve', 'V', 'classic_valve',
        '<path class="pc-pipe" data-pf-state-target="pipe" d="M0 20 H60"/>' + dash('M0 20 H60') +
        '<polygon class="pc-valve" data-pf-state-target="valve" points="16,12 44,28 44,12 16,28"/>'
        '<path class="pc-stroke" d="M30 20 V4"/><path class="pc-stroke" style="stroke-width:2.5" d="M22 4 H38"/>',
        aliases=['ventil', 'handventil', 'valve', 'absperrventil'],
        ports=valve_ports, favorite=True, order=220,
        visual_states=VALVE_STATES, default_visual_state='open',
    ))
    items.append(classic_definition(
        'Classic_control_valve', 'Regelventil mit Membranantrieb (Klassik)', 'Klassik · Armaturen', 'classic-control-valve', 'V', 'classic_valve',
        '<path class="pc-thin" data-pf-state-target="pipe" d="M0 20 H60"/>' +
        '<polygon class="pc-valve" data-pf-state-target="valve" points="16,13 44,27 44,13 16,27"/>'
        '<path class="pc-stroke" d="M30 20 V8"/><ellipse class="pc-white" cx="30" cy="6" rx="6" ry="3"/>',
        aliases=['regelventil', 'control valve', 'membranantrieb', 'stellventil'],
        ports=valve_ports, order=221,
        visual_states=VALVE_STATES, default_visual_state='open',
    ))
    items.append(classic_definition(
        'Classic_check_valve', 'Rückschlagventil (Klassik)', 'Klassik · Armaturen', 'classic-check-valve', 'RV', 'classic_fitting',
        '<path class="pc-thin" data-pf-state-target="pipe" d="M0 20 H40"/>' +
        '<polygon class="pc-valve" data-pf-state-target="valve" points="9,12 28,20 9,28"/>'
        '<path class="pc-stroke" style="stroke-width:2.5" d="M28 10 V30"/>',
        aliases=['rueckschlagventil', 'check valve', 'rv'],
        ports=[port('inlet', 'Ventil Eingang', 0, 20, 'process', 'in'),
               port('outlet', 'Ventil Ausgang', 40, 20, 'process', 'out')],
        order=222,
        visual_states=VALVE_STATES, default_visual_state='open',
    ))
    flag_ports = [port('line', 'Leitung', 56, 20, 'process', 'bidirectional'),
                  port('signal', 'Signalreferenz', 23, 4, 'signal', 'bidirectional')]
    items.append(classic_definition(
        'Classic_flag', 'Grenzstelle Eintritt (Klassik)', 'Klassik · Armaturen', 'classic-flag', 'X', 'classic_flag',
        '<path class="pc-pipe" data-pf-state-target="pipe" d="M46 20 H56"/>'
        '<polygon class="pc-white" data-pf-state-target="flag" points="0,8 36,8 46,20 36,32 0,32"/>'
        '<text class="pc-text" data-pf-role="entity-label" x="18" y="24" font-size="11" text-anchor="middle">N\u2082</text>',
        aliases=['grenzstelle', 'eintritt', 'flag', 'n2', 'educts', 'kw ein'],
        ports=flag_ports, favorite=True, order=223,
        visual_states=['neutral', 'flow', 'hot', 'cold', 'purge'], default_visual_state='neutral',
    ))
    items.append(classic_definition(
        'Classic_flag_back', 'Grenzstelle Austritt (Klassik)', 'Klassik · Armaturen', 'classic-flag-back', 'X', 'classic_flag',
        '<path class="pc-pipe" data-pf-state-target="pipe" d="M46 20 H56"/>'
        '<polygon class="pc-white" data-pf-state-target="flag" points="10,8 46,8 46,32 10,32 0,20"/>'
        '<text class="pc-text" data-pf-role="entity-label" x="27" y="24" font-size="11" text-anchor="middle">Vent</text>',
        aliases=['grenzstelle', 'austritt', 'flag', 'vent', 'kw aus'],
        ports=flag_ports, order=224,
        visual_states=['neutral', 'flow', 'hot', 'cold', 'purge'], default_visual_state='neutral',
    ))
    items.append(classic_definition(
        'Classic_instrument', 'Instrumenten-Kreis (Klassik)', 'Klassik · Armaturen', 'classic-instrument', 'I', 'classic_instrument',
        '<circle class="pc-bubble" data-pf-state-target="ring" cx="30" cy="28" r="26"/>'
        '<text class="pc-text" data-pf-role="entity-function" x="30" y="26" font-size="16" text-anchor="middle">PI</text>'
        '<text class="pc-text" data-pf-role="entity-number" x="30" y="42" font-size="11" text-anchor="middle">101</text>'
        '<text class="pc-muted" data-pf-role="entity-value" x="30" y="69" font-size="12" text-anchor="middle"></text>',
        aliases=['instrument', 'bubble', 'pi', 'tic', 'ti', 'fic', 'messstelle'],
        ports=[port('top', 'Anschluss oben', 30, 2, 'signal', 'bidirectional'),
               port('left', 'Anschluss links', 4, 28, 'signal', 'bidirectional'),
               port('right', 'Anschluss rechts', 56, 28, 'signal', 'bidirectional'),
               port('process', 'Prozessanschluss', 30, 54, 'process', 'bidirectional')],
        favorite=True, order=225,
        visual_states=['neutral'], default_visual_state='neutral',
    ))

    # ------------------------------------------------------------------ apparatus
    items.append(classic_definition(
        'Classic_furnace', 'Rohrofen mit Rohr (Klassik)', 'Klassik · Apparate', 'classic-furnace', 'H', 'classic_furnace',
        '<rect class="pc-state" data-pf-state-target="temperature" x="17" y="1" width="86" height="204"/>'
        '<polyline class="pc-stroke" style="stroke-width:2.5" points="32,12 40,30 24,55 40,80 24,105 40,130 24,155 40,180 32,194"/>'
        '<polyline class="pc-stroke" style="stroke-width:2.5" points="88,12 96,30 80,55 96,80 80,105 96,130 80,155 96,180 88,194"/>'
        '<rect class="pc-bore" x="52" y="0" width="16" height="206"/>'
        '<path class="pc-stroke" style="stroke-width:3;stroke-linecap:butt" d="M52 0 V206 M68 0 V206"/>'
        + dash('M60 0 V206') +
        '<text class="pc-text" data-pf-role="entity-caption" x="117" y="97" font-size="13">Rohrofen</text>'
        '<text class="pc-text" data-pf-role="entity-tag" x="117" y="113" font-size="13">H-101</text>',
        aliases=['rohrofen', 'furnace', 'heizung', 'h-101'],
        ports=[port('process_in', 'Prozess Eingang', 60, 0, 'process', 'in'),
               port('process_out', 'Prozess Ausgang', 60, 206, 'process', 'out'),
               port('temperature', 'Temperatursignal', 103, 103, 'signal', 'out'),
               port('energy', 'Heizleistung', 17, 103, 'power', 'in')],
        favorite=True, order=230,
        stretch=stretch_profile('y', [(0, 14), (192, 206)]),
        visual_states=THERMAL_STATES, default_visual_state='hot',
        animation_targets=['[data-pf-state-target="temperature"]', '[data-pf-state-target="flow"]'],
    ))
    items.append(classic_definition(
        'Classic_cooler', 'Doppelrohr-Kühler (Klassik)', 'Klassik · Apparate', 'classic-cooler', 'W', 'classic_cooler',
        '<rect class="pc-state" data-pf-state-target="coolant" x="12" y="1" width="36" height="158"/>'
        '<path class="pc-pipe" data-pf-state-target="pipe" d="M30 0 V160"/>'
        '<path class="pc-stroke" style="stroke-width:1.5;stroke-linecap:butt" d="M25 1 V159 M35 1 V159"/>'
        + dash('M30 0 V160') +
        '<text class="pc-text" data-pf-role="entity-tag" x="60" y="77" font-size="13">W-101</text>'
        '<text class="pc-muted" data-pf-role="entity-caption" x="60" y="93" font-size="11">Doppelrohr-Kühler</text>',
        aliases=['kuehler', 'cooler', 'doppelrohr', 'w-101'],
        ports=[port('process_in', 'Prozess Eingang', 30, 0, 'process', 'in'),
               port('process_out', 'Prozess Ausgang', 30, 160, 'process', 'out'),
               port('coolant_out', 'Kühlwasser Ausgang', 48, 20, 'utility', 'out'),
               port('coolant_in', 'Kühlwasser Eingang', 48, 140, 'utility', 'in')],
        favorite=True, order=231,
        stretch=stretch_profile('y', [(0, 4), (64, 112), (156, 160)]),
        visual_states=['neutral', 'cold'], default_visual_state='cold',
        animation_targets=['[data-pf-state-target="coolant"]', '[data-pf-state-target="flow"]'],
    ))
    items.append(classic_definition(
        'Classic_column', 'Rohrreaktor-Kolonne (Klassik)', 'Klassik · Apparate', 'classic-column', 'R', 'classic_column',
        '<rect class="pc-state" data-pf-state-target="temperature" style="stroke-width:3" x="21.5" y="1.5" width="57" height="417" rx="28"/>'
        '<text class="pc-text" data-pf-role="entity-tag" x="93" y="212" font-size="14">R-101</text>'
        '<text class="pc-muted" data-pf-role="entity-caption" x="93" y="228" font-size="11">Rohrreaktor</text>',
        aliases=['kolonne', 'column', 'rohrreaktor', 'r-101', 'reaktor'],
        ports=[port('feed', 'Edukt Eingang', 50, 0, 'process', 'in'),
               port('product', 'Produkt Ausgang', 50, 420, 'process', 'out'),
               port('left', 'Anschluss links', 21.5, 210, 'signal', 'bidirectional'),
               port('right', 'Anschluss rechts', 78.5, 210, 'signal', 'bidirectional')],
        favorite=True, order=232,
        stretch=stretch_profile('y', [(0, 40), (190, 240), (380, 420)]),
        visual_states=THERMAL_STATES, default_visual_state='hot',
        animation_targets=['[data-pf-state-target="temperature"]'],
    ))
    items.append(classic_definition(
        'Classic_coil_circle', 'Kreis mit Heizwendel (Klassik)', 'Klassik · Apparate', 'classic-coil-circle', 'H', 'classic_circle',
        '<circle class="pc-state" data-pf-state-target="temperature" style="stroke-width:3" cx="55" cy="55" r="48"/>'
        '<polyline class="pc-stroke" style="stroke-width:4" points="25,42 69,42 42,55 69,68 25,68"/>'
        '<text class="pc-text" data-pf-role="entity-tag" x="55" y="121" font-size="14" text-anchor="middle">H-101</text>'
        '<text class="pc-muted" data-pf-role="entity-caption" x="55" y="136" font-size="11" text-anchor="middle">Rohrofen</text>',
        aliases=['kreis', 'heizwendel', 'ofen', 'kuehler', 'm-kreis', 'coil'],
        ports=[port('left', 'Anschluss links', 7, 55, 'process', 'in'),
               port('right', 'Anschluss rechts', 103, 55, 'process', 'out'),
               port('top', 'Anschluss oben', 55, 7, 'process', 'bidirectional'),
               port('bottom', 'Anschluss unten', 55, 103, 'process', 'bidirectional')],
        order=233,
        visual_states=THERMAL_STATES, default_visual_state='hot',
        animation_targets=['[data-pf-state-target="temperature"]'],
    ))
    items.append(classic_definition(
        'Classic_mixer_box', 'Gasmischer-Kasten (Klassik)', 'Klassik · Apparate', 'classic-mixer-box', 'M', 'classic_mixer',
        '<path class="pc-pipe" style="stroke-width:4" d="M32 43 V48"/>'
        '<path class="pc-white" style="stroke-width:3;stroke-linejoin:round" d="M8 5 H56 Q62 24 56 43 H8 Q2 24 8 5 Z"/>'
        '<path class="pc-stroke" style="stroke-width:3" d="M5 5 H59 M5 43 H59"/>'
        '<text class="pc-text" data-pf-role="entity-tag" x="68" y="12" font-size="12">M-101</text>'
        '<text class="pc-muted" data-pf-role="entity-caption" x="68" y="26" font-size="10">Gasmischer</text>',
        aliases=['gasmischer', 'mixer', 'm-101', 'kasten', 'barrel'],
        ports=[port('inlet_a', 'Eingang A', 8, 16, 'process', 'in'),
               port('inlet_b', 'Eingang B', 8, 32, 'process', 'in'),
               port('outlet', 'Mischgas Ausgang', 32, 48, 'process', 'out')],
        order=234,
        visual_states=['neutral'], default_visual_state='neutral',
        animation_targets=['.pc-white'],
    ))
    items.append(classic_definition(
        'Classic_cylinder', 'Gasflasche (Klassik)', 'Klassik · Apparate', 'classic-cylinder', 'GF', 'classic_cylinder',
        '<path class="pc-white" style="stroke-width:3" d="M20 8 V0 A10 10 0 0 1 40 0 V8 A26 26 0 0 1 56 32 V86 H4 V32 A26 26 0 0 1 20 8 Z"/>'
        '<text class="pc-text" data-pf-role="entity-label" x="30" y="58" font-size="12" text-anchor="middle">N\u2082</text>'
        '<text class="pc-text" data-pf-role="entity-tag" x="30" y="106" font-size="12" text-anchor="middle">GF-101</text>',
        aliases=['gasflasche', 'cylinder', 'flasche', 'gf-101'],
        ports=[port('gas_out', 'Gas Ausgang', 30, 0, 'process', 'out'),
               port('service', 'Befüllung / Service', 30, 86, 'process', 'in')],
        order=235,
        visual_states=['neutral'], default_visual_state='neutral',
        animation_targets=['.pc-white'],
    ))

    # ------------------------------------------------------------------ frame / suspension (structure layer)
    items.append(classic_definition(
        'Frame_post', 'Gestellpfosten', 'Klassik · Gestell', 'frame-post', 'GS', 'frame_post',
        '<rect class="pc-frame" data-pf-state-target="frame" x="8" y="0" width="8" height="400"/>',
        aliases=['pfosten', 'post', 'gestell', 'aufhaengung', 'staender'],
        ports=[port('top', 'Oben', 12, 0, 'structure', 'bidirectional'),
               port('bottom', 'Unten', 12, 400, 'structure', 'bidirectional')],
        favorite=False, order=240,
        stretch=stretch_profile('y', [(0, 6), (394, 400)]),
        visual_states=['neutral'], default_visual_state='neutral', layer='structure',
        animation_targets=['[data-pf-state-target="frame"]'],
    ))
    items.append(classic_definition(
        'Frame_beam', 'Gestellträger', 'Klassik · Gestell', 'frame-beam', 'GS', 'frame_beam',
        '<rect class="pc-frame" data-pf-state-target="frame" x="0" y="8" width="400" height="8"/>',
        aliases=['traeger', 'beam', 'gestell', 'querbalken'],
        ports=[port('left', 'Links', 0, 12, 'structure', 'bidirectional'),
               port('right', 'Rechts', 400, 12, 'structure', 'bidirectional')],
        order=241,
        stretch=stretch_profile('x', [(0, 6), (394, 400)]),
        visual_states=['neutral'], default_visual_state='neutral', layer='structure',
        animation_targets=['[data-pf-state-target="frame"]'],
    ))
    items.append(classic_definition(
        'Frame_foot', 'Gestellfuß', 'Klassik · Gestell', 'frame-foot', 'GS', 'frame_foot',
        '<rect class="pc-frame" data-pf-state-target="frame" x="5" y="0" width="50" height="6"/>'
        '<path class="pc-ground" d="M5 6 H55 M8 6 L2 16 M20 6 L14 16 M32 6 L26 16 M44 6 L38 16 M56 6 L50 16"/>',
        aliases=['fuss', 'foot', 'bodenplatte', 'gestell'],
        ports=[port('top', 'Oben', 30, 0, 'structure', 'bidirectional'),
               port('ground', 'Boden', 30, 20, 'structure', 'bidirectional')],
        order=242,
        visual_states=['neutral'], default_visual_state='neutral', layer='structure',
        animation_targets=['[data-pf-state-target="frame"]'],
    ))
    items.append(classic_definition(
        'Frame_clamp', 'Rohrschelle / Halterung', 'Klassik · Gestell', 'frame-clamp', 'GS', 'frame_clamp',
        '<path class="pc-ground" style="stroke-width:2" d="M0 15 H14"/>'
        '<rect class="pc-frame" data-pf-state-target="frame" x="14" y="9" width="8" height="12"/>'
        '<path class="pc-frame" d="M22 4 H40 V26 H22 Z" style="fill:none"/>'
        '<path class="pc-ground" d="M26 4 V26 M36 4 V26"/>',
        aliases=['schelle', 'halterung', 'clamp', 'hanger', 'aufhaengung'],
        ports=[port('mount', 'Befestigung', 0, 15, 'structure', 'bidirectional'),
               port('pipe', 'Rohrseite', 40, 15, 'structure', 'bidirectional')],
        order=243,
        visual_states=['neutral'], default_visual_state='neutral', layer='structure',
        animation_targets=['[data-pf-state-target="frame"]'],
    ))
    items.append(classic_definition(
        'Frame_floor', 'Boden mit Schraffur', 'Klassik · Gestell', 'frame-floor', 'GS', 'frame_floor',
        '<path class="pc-ground" style="stroke-width:2" d="M0 4 H300"/>'
        '<path class="pc-ground" d="M12 4 L4 16 M36 4 L28 16 M60 4 L52 16 M84 4 L76 16 M108 4 L100 16 M132 4 L124 16 M156 4 L148 16 M180 4 L172 16 M204 4 L196 16 M228 4 L220 16 M252 4 L244 16 M276 4 L268 16 M300 4 L292 16"/>',
        aliases=['boden', 'floor', 'schraffur', 'ground'],
        ports=[port('left', 'Links', 0, 4, 'structure', 'bidirectional'),
               port('right', 'Rechts', 300, 4, 'structure', 'bidirectional')],
        order=244,
        stretch=stretch_profile('x', [(0, 6), (294, 300)]),
        visual_states=['neutral'], default_visual_state='neutral', layer='structure',
        animation_targets=['.pc-ground'],
    ))
    return items


def base_standard_payload():
    return {
        'standard_id': 'PF-PID-V1',
        'standard_version': '1.0',
        'release': '61.1',
        'title': 'Plant Factory P&ID Object and Symbol Standard V1',
        'purpose': 'Canonical non-destructive normalization for geometry, ports, labels, connections, runtime states and explicitly optional HMI controls.',
        'coordinate_system': {
            'unit': 'engineering_px',
            'base_grid': 10,
            'connection_grid': 5,
            'minimum_hit_size': 24,
            'preserve_aspect_ratio': 'xMidYMid meet',
            'pivot': 'center',
        },
        'geometry': {
            'primary_stroke_width': 2.2,
            'secondary_stroke_width': 1.4,
            'process_line_width': 2.4,
            'signal_line_width': 1.6,
            'port_radius': 3.2,
            'selection_port_radius': 4.2,
            'label_gap': 12,
            'tag_font_size': 11,
            'description_font_size': 8.5,
            'vector_effect': 'non-scaling-stroke',
        },
        'profiles': PROFILES,
        'semantic_roles': [
            'symbol', 'body', 'outline', 'detail', 'state', 'flow', 'port', 'label',
        ],
        'runtime_states': [
            'ready', 'running', 'warning', 'alarm', 'disabled', 'maintenance',
        ],
        'port_kinds': ['process', 'utility', 'signal', 'data', 'power', 'io'],
        'connection_types': {
            'pipe': {
                'accepted_port_kinds': ['process', 'utility'],
                'default_width': 2.4,
                'routing': 'orthogonal',
                'marker': 'flow',
            },
            'signal': {
                'accepted_port_kinds': ['signal', 'io'],
                'default_width': 1.6,
                'routing': 'orthogonal',
                'marker': 'open',
            },
            'data': {
                'accepted_port_kinds': ['data', 'io'],
                'default_width': 1.6,
                'routing': 'orthogonal',
                'marker': 'open',
            },
            'power': {
                'accepted_port_kinds': ['power'],
                'default_width': 1.8,
                'routing': 'orthogonal',
                'marker': 'open',
            },
        },
        'interaction_defaults': {
            'selectable': True,
            'movable': True,
            'resizable': True,
            'rotatable': True,
            'connectable': True,
            'bindable': True,
            'animatable': True,
            'configurable': True,
            'auto_create_hmi_widgets': False,
            'show_hmi_overlay_in_engineering': False,
        },
        'label_contract': {
            'line_1': 'tag',
            'line_2': 'display_name',
            'tag_pattern': '^[A-Z][A-Z0-9]{0,5}-[0-9]{3}[A-Z]?$',
            'fallback_tag_start': 101,
            'upright_after_rotation': True,
        },
        'hmi_controls': {
            'available': ['text', 'indicator', 'toggle', 'button', 'slider'],
            'default': None,
            'button_policy': 'optional_explicit_only',
            'auto_binding': False,
            'process_symbol_drop_policy': 'never_create_control',
        },
        'library': {
            'default_scope': 'standard',
            'standard_label': 'P&ID V1',
            'legacy_label': 'Legacy-kompatibel',
            'hmi_label': 'HMI optional',
            'category_order': CATEGORY_ORDER,
        },
        'compatibility': {
            'legacy_template_ids_preserved': True,
            'unknown_fields_preserved': True,
            'custom_svg_content_preserved': True,
            'existing_hmi_widgets_preserved': True,
            'existing_bindings_preserved': True,
            'existing_connections_preserved': True,
            'automatic_normalization': 'non_destructive',
        },
    }


def normalized_port_metadata(port_value, width, height):
    """Add stable relative coordinates while retaining engineering coordinates."""
    port_data = dict(port_value)
    x_value = float(port_data.get('x', 0))
    y_value = float(port_data.get('y', 0))
    port_data['rx'] = max(0.0, min(1.0, x_value / float(width)))
    port_data['ry'] = max(0.0, min(1.0, y_value / float(height)))
    return port_data


def public_metadata(definition):
    metadata = {
        key: value
        for key, value in definition.items()
        if key not in {'body', 'ports'}
    }
    interaction = {
        'selectable': True,
        'movable': True,
        'resizable': True,
        'rotatable': True,
        'connectable': True,
        'bindable': True,
        'animatable': True,
        'configurable': True,
        **definition.get('interaction', {}),
    }
    capabilities = dict(interaction)
    capabilities['auto_create_hmi_widgets'] = False
    metadata.update({
        'standard': 'PF-PID-V1',
        'standard_id': 'PF-PID-V1',
        'standard_version': '1.0',
        'symbol_type': definition['family'],
        'library_role': 'process',
        'default_visible': True,
        'geometry_profile': definition['profile'],
        'ports': [
            normalized_port_metadata(
                port_value,
                definition['breite'],
                definition['hoehe'],
            )
            for port_value in definition['ports']
        ],
        'runtime_states': [
            'ready', 'running', 'warning', 'alarm', 'disabled', 'maintenance',
        ],
        'capabilities': capabilities,
        'hmi_widget_default': None,
        'object_standard': {
            'id': 'PF-PID-V1',
            'version': '1.0',
            'release': '61.1',
        },
        'hmi_policy': {
            'auto_create_widgets': False,
            'default_control': None,
            'allowed_controls': ['text', 'indicator', 'toggle', 'button', 'slider'],
            'button_policy': 'optional_explicit_only',
        },
        'interaction': interaction,
    })
    return metadata


def render_svg(definition):
    metadata = public_metadata(definition)
    meta_json = json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    width = definition['breite']
    height = definition['hoehe']
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!-- META: %s -->\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" '
        'width="%s" height="%s" role="img" class="pf-pid-v1" '
        'data-pf-standard="PF-PID-V1" data-pf-family="%s" '
        'preserveAspectRatio="xMidYMid meet">\n%s\n%s\n</svg>\n'
    ) % (
        meta_json,
        width,
        height,
        width,
        height,
        definition['family'],
        STYLE_BLOCK,
        definition['body'],
    )


def manifest_payload(definitions):
    templates = {}
    for definition in definitions:
        metadata = public_metadata(definition)
        metadata['file'] = definition['id'] + '.svg'
        templates[definition['id']] = metadata
    serialized_templates = json.dumps(templates, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return {
        'schema': 'plant-factory.symbol-library-manifest',
        'schema_version': 1,
        'standard_id': 'PF-PID-V1',
        'standard_version': '1.0',
        'release': '61.1',
        'template_count': len(templates),
        'category_order': CATEGORY_ORDER,
        'hmi_policy': {
            'auto_create_widgets': False,
            'button_policy': 'optional_explicit_only',
        },
        'templates_sha256': hashlib.sha256(serialized_templates.encode('utf-8')).hexdigest(),
        'templates': templates,
    }


def expected_outputs():
    definitions = build_definitions()
    outputs = {}
    outputs[STANDARD_PATH] = json.dumps(
        base_standard_payload(), ensure_ascii=False, indent=2, sort_keys=True,
    ) + '\n'
    outputs[MANIFEST_PATH] = json.dumps(
        manifest_payload(definitions), ensure_ascii=False, indent=2, sort_keys=True,
    ) + '\n'
    for definition in definitions:
        outputs[TEMPLATE_DIR / (definition['id'] + '.svg')] = render_svg(definition)
    return outputs


def stale_template_paths(expected):
    expected_paths = set(expected)
    return sorted(
        path for path in TEMPLATE_DIR.glob('*.svg')
        if path not in expected_paths
    )


def write_outputs(outputs):
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    STANDARD_PATH.parent.mkdir(parents=True, exist_ok=True)
    for path in stale_template_paths(outputs):
        path.unlink()
    for path, content in sorted(outputs.items(), key=output_sort_key):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8', newline='')


def output_sort_key(item):
    return str(item[0])


def verify_outputs(outputs):
    failures = []
    for path in stale_template_paths(outputs):
        failures.append('Unerwartetes Standard-SVG: %s' % path.relative_to(ROOT))
    for path, expected in sorted(outputs.items(), key=output_sort_key):
        if not path.is_file():
            failures.append('Fehlt: %s' % path.relative_to(ROOT))
            continue
        actual = path.read_text(encoding='utf-8')
        if actual != expected:
            failures.append('Abweichend: %s' % path.relative_to(ROOT))
    return failures


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify without writing files.')
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    outputs = expected_outputs()
    if args.check:
        failures = verify_outputs(outputs)
        if failures:
            for failure in failures:
                print(failure, file=sys.stderr)
            return 1
        print('PF-PID-V1 symbol library is deterministic and current (%d templates).' % (len(outputs) - 2))
        return 0
    write_outputs(outputs)
    print('PF-PID-V1 symbol library built (%d templates).' % (len(outputs) - 2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
