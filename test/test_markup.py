#!/usr/bin/env python3
"""Static integrity checks for HTML references and local UI assets."""

import re
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HTML_PATH = ROOT / 'public' / 'index.html'


def check(condition, label, detail=''):
    if not condition:
        raise AssertionError('%s%s' % (label, ': %s' % detail if detail else ''))
    print('   ok  %s' % label)


def parse_markup(text):
    result = {
        'ids': [],
        'labels': [],
        'references': [],
        'assets': [],
        'uses': [],
    }

    def handle_starttag(tag, attrs):
        values = dict(attrs)
        if values.get('id'):
            result['ids'].append(values['id'])
        if tag == 'label' and values.get('for'):
            result['labels'].append(values['for'])
        for name in ('aria-labelledby', 'aria-describedby', 'aria-controls'):
            if values.get(name):
                result['references'].extend(values[name].split())
        if tag == 'link' and values.get('href', '').startswith('/public/'):
            result['assets'].append(values['href'])
        if tag == 'script' and values.get('src', '').startswith('/public/'):
            result['assets'].append(values['src'])
        if tag == 'use' and values.get('href', '').startswith('#'):
            result['uses'].append(values['href'][1:])

    parser = HTMLParser(convert_charrefs=True)
    parser.handle_starttag = handle_starttag
    parser.handle_startendtag = handle_starttag
    parser.feed(text)
    return result


def main():
    html = HTML_PATH.read_text(encoding='utf-8')
    parsed = parse_markup(html)
    ids = parsed['ids']
    id_set = set(ids)
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    check(not duplicates, 'HTML IDs eindeutig', ', '.join(duplicates))

    missing_labels = sorted(set(parsed['labels']) - id_set)
    check(not missing_labels, 'Label-Ziele vorhanden', ', '.join(missing_labels))
    missing_references = sorted(set(parsed['references']) - id_set)
    check(not missing_references, 'ARIA-Referenzen vorhanden', ', '.join(missing_references))

    missing_assets = []
    for url in parsed['assets']:
        target = ROOT / url.removeprefix('/')
        if not target.is_file():
            missing_assets.append(url)
    check(not missing_assets, 'lokale CSS-/JS-Assets vorhanden', ', '.join(missing_assets))

    missing_symbols = sorted(set(parsed['uses']) - id_set)
    check(not missing_symbols, 'Icon-Verweise auf vorhandene Symbole', ', '.join(missing_symbols))

    css_text = '\n'.join(
        path.read_text(encoding='utf-8')
        for path in sorted((ROOT / 'public' / 'css').glob('*.css'))
    )
    font_urls = re.findall(r"url\(['\"]?\.\./fonts/([^)'\"]+)", css_text)
    missing_fonts = [name for name in font_urls if not (ROOT / 'public' / 'fonts' / name).is_file()]
    check(not missing_fonts, 'Font-Verweise auf vorhandene Dateien', ', '.join(missing_fonts))


    required_v60_assets = {
        '/public/css/v60.css',
        '/public/js/v60_ui.js',
    }
    check(required_v60_assets.issubset(set(parsed['assets'])),
          'V60.1 Basisschichten eingebunden')

    required_v61_assets = {
        '/public/css/v61.css',
        '/public/js/v61_ui.js',
    }
    check(required_v61_assets.issubset(set(parsed['assets'])),
          'V61.1 Standard- und Integrationsschichten eingebunden')

    required_v62_assets = {
        '/public/css/v62.css',
        '/public/js/v62_ui.js',
    }
    check(required_v62_assets.issubset(set(parsed['assets'])),
          'V62.1 Modal-, Kontext- und HMI-Integrationsschichten eingebunden')

    required_v63_assets = {
        '/public/css/v63.css',
        '/public/js/v63_logic_ui.js',
    }
    check(required_v63_assets.issubset(set(parsed['assets'])),
          'V63 Logic-/FBD-Integrationsschichten eingebunden')

    check('/public/css/v63_4.css' in set(parsed['assets']),
          'V63.4 HMI-UX-Schicht eingebunden')
    check(('V64' in html and ('64 · V9' in html or '64_r1 · V9' in html or '64_r2 · V9' in html))
          or ('V63.4' in html and '63.4 · V9' in html),
          'V63.4/V64 Browserkennung vollständig')

    required_v60_ids = {
        'btn-header-more',
        'header-more-menu',
        'btn-inspector-more',
        'inspector-more-menu',
        'inspector-apply',
        'canvas-minimap-svg',
        'modal-shortcuts',
    }
    missing_v60_ids = sorted(required_v60_ids - id_set)
    check(not missing_v60_ids, 'V60.1 UI-Basisvertrag vollständig', ', '.join(missing_v60_ids))

    required_v61_ids = {
        'symbol-standard-badge',
        'btn-hmi-overlay',
        'connections-layer',
        'elements-layer',
    }
    missing_v61_ids = sorted(required_v61_ids - id_set)
    check(not missing_v61_ids, 'V61.1 Objektstandard-UI vollständig', ', '.join(missing_v61_ids))
    check(html.index('id="connections-layer"') < html.index('id="elements-layer"'),
          'Verbindungen werden hinter Objekten gerendert')
    check('aria-pressed="false"' in html and 'HMI optional' in html,
          'optionales HMI-Overlay startet ausgeschaltet')
    hmi_source = (ROOT / 'public' / 'js' / 'hmi.js').read_text(encoding='utf-8')
    check("rootId: 'hmi-canvas-overlay'" in hmi_source,
          'dynamischer HMI-Overlay-Host ist definiert')

    check(html.count('role="dialog"') == 7, 'sieben Dialoge ausgezeichnet')
    required_v62_ids = {
        'modal-verbindung-bearbeiten',
        'edit-von-select',
        'edit-von-port',
        'edit-nach-port',
        'edit-connection-validation',
    }
    missing_v62_ids = sorted(required_v62_ids - id_set)
    check(not missing_v62_ids, 'V62.1 Verbindungseditor vollständig', ', '.join(missing_v62_ids))

    required_v63_ids = {
        'workspace-logic-button',
        'logic-workspace',
        'logic-canvas',
        'logic-nodes-layer',
        'logic-edges-layer',
        'logic-context-menu',
        'modal-logic-diagram',
        'modal-logic-compile',
    }
    missing_v63_ids = sorted(required_v63_ids - id_set)
    check(not missing_v63_ids, 'V63 Logic-Workspace vollständig', ', '.join(missing_v63_ids))

    check('role="status"' in html and 'aria-live="polite"' in html and 'aria-atomic="true"' in html,
          'Statusmeldungen assistiv angekündigt')


if __name__ == '__main__':
    main()
