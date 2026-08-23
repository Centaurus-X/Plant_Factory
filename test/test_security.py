#!/usr/bin/env python3
"""Security regression checks for SVG ingestion and atomic writes."""

import os
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from _server_v9 import server_settings
from svg_editor_tool import (
    atomar_text_schreiben,
    sicherer_meta_kommentar,
    sicherer_projektname,
    svg_bereinigen,
)


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    print("   ok  %s" % label)


def main():
    hostile = """<svg xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
      <script>alert(1)</script>
      <foreignObject><div>unsafe</div></foreignObject>
      <image xlink:href="https://example.invalid/tracker.png"/>
      <use xlink:href="#safe-shape"/>
      <path id="safe-shape" d="M0 0h10" style="stroke:#111;filter:url(//example.invalid/f)"/>
    </svg>"""
    cleaned = svg_bereinigen(hostile)
    lowered = cleaned.lower()
    check("<script" not in lowered, "script elements removed")
    check("foreignobject" not in lowered, "foreignObject elements removed")
    check("onload" not in lowered, "event attributes removed")
    check("https://" not in lowered, "external resources removed")
    check("example.invalid" not in lowered, "external CSS URLs removed")
    check("#safe-shape" in cleaned, "local fragment references retained")
    ElementTree.fromstring(cleaned)
    check(True, "sanitized SVG remains valid XML")

    snapshot_svg = """<svg xmlns="http://www.w3.org/2000/svg"
      xmlns:plantfactory="urn:plantfactory:snapshot:1">
      <metadata><plantfactory:snapshot>{"kind":"plant_factory_config_snapshot"}</plantfactory:snapshot></metadata>
    </svg>"""
    snapshot_cleaned = svg_bereinigen(snapshot_svg)
    check('plant_factory_config_snapshot' in snapshot_cleaned,
          "embedded config snapshots retained")

    rejected = False
    try:
        svg_bereinigen('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>')
    except ValueError:
        rejected = True
    check(rejected, "DOCTYPE input rejected")
    metadata_comment = sicherer_meta_kommentar({'name': '--><script>alert(1)</script>'})
    check(metadata_comment.count('-->') == 1, "metadata cannot terminate its XML comment")
    check(sicherer_projektname('../../plant-01') == 'plant-01',
          "project traversal characters removed")

    temporary_parent = os.environ.get('TEST_TMP') or None
    with tempfile.TemporaryDirectory(prefix='v60-security-', dir=temporary_parent) as temporary:
        target = Path(temporary) / 'atomic-probe.txt'
        atomar_text_schreiben(target, 'verified\n')
        check(target.read_text(encoding='utf-8') == 'verified\n',
              "atomic text write verified")
        check(not list(target.parent.glob('.atomic-probe.txt.*.tmp')),
              "atomic sibling removed after replace")


    settings = server_settings(ROOT)
    check(settings['host'] == '127.0.0.1', "server defaults to local binding")
    check(settings['raw']['upload']['allowed_extensions'] == ['.svg'],
          "simple YAML parser retains scalar lists")
    check(settings['raw']['security']['allowed_origins'] == [],
          "simple YAML parser retains inline empty lists")


if __name__ == '__main__':
    main()
