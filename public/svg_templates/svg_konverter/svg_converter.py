#!/usr/bin/env python3
"""
SVG Konverter und Standardisierer - Hochrobuste optimierte Version
Bereitet SVG-Dateien für Animationen vor, passt Größen an und optimiert Farben
"""
import xml.etree.ElementTree as ET
from xml.dom import minidom
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union
from functools import partial
import re

def normalisiere_tag_leerzeichen(match):
    return '<' + re.sub('\\s+', ' ', match.group(1)).strip() + '>'

def entferne_svg_praefix(match):
    return match.group(0).replace('svg:', '')

def erstelle_svg_kontext():
    kontext = {}
    kontext['namespaces'] = {'svg': 'http://www.w3.org/2000/svg', 'xlink': 'http://www.w3.org/1999/xlink'}
    kontext['farbschemas'] = {'dunkel': {'stroke': '#ffffff', 'fill': '#ffffff', 'fill_opacity': '0.1', 'stroke_opacity': '1.0', 'background': '#1a1a1a', 'css_variablen': {'--hauptfarbe': '#ffffff', '--akzentfarbe': '#00aaff', '--fuellfarbe': 'rgba(255, 255, 255, 0.15)', '--strichbreite': '1'}}, 'hell': {'stroke': '#000000', 'fill': '#333333', 'fill_opacity': '0.1', 'stroke_opacity': '1.0', 'background': '#ffffff', 'css_variablen': {'--hauptfarbe': '#000000', '--akzentfarbe': '#0066cc', '--fuellfarbe': 'rgba(0, 0, 0, 0.1)', '--strichbreite': '1'}}, 'universal': {'stroke': 'currentColor', 'fill': 'currentColor', 'fill_opacity': '0.15', 'stroke_opacity': '1.0', 'background': 'transparent', 'css_variablen': {'--hauptfarbe': 'currentColor', '--akzentfarbe': 'currentColor', '--fuellfarbe': 'currentColor', '--strichbreite': '1'}}, 'farbe_universal': {'stroke': '#2196F3', 'fill': '#4CAF50', 'fill_opacity': '0.2', 'stroke_opacity': '0.9', 'background': 'transparent', 'css_variablen': {'--hauptfarbe': '#2196F3', '--akzentfarbe': '#FF9800', '--fuellfarbe': 'rgba(76, 175, 80, 0.2)', '--strichbreite': '1.5'}}}
    kontext['standardgroessen'] = {'klein': (100, 100), 'mittel': (200, 200), 'gross': (400, 400), 'icon': (64, 64), 'thumbnail': (150, 150)}
    kontext['element_counter'] = {}
    return kontext

def bereinige_namespace(kontext, tag: str) -> str:
    """Entfernt Namespace-Präfixe aus Tags"""
    if '}' in tag:
        return tag.split('}')[1]
    return tag.replace('svg:', '')

def extrahiere_attribute_robust(kontext, tag_string: str) -> Dict[str, str]:
    """
        Extrahiert Attribute aus einem Tag-String auf sehr robuste Weise.
        Behandelt mehrere Edge-Cases und doppelte Attribute.
        """
    attribute = {}
    patterns = ['(\\w+(?::\\w+)?)\\s*=\\s*"([^"]*)"', "(\\w+(?::\\w+)?)\\s*=\\s*'([^']*)'", '(\\w+(?::\\w+)?)\\s*=\\s*([^\\s>]+)']
    for pattern in patterns:
        for match in re.finditer(pattern, tag_string):
            attr_name = match.group(1)
            attr_value = match.group(2) if len(match.groups()) > 1 else match.group(1)
            if attr_name not in attribute:
                attribute[attr_name] = attr_value
    return attribute

def rekonstruiere_tag(kontext, tag_name: str, attribute: Dict[str, str], self_closing: bool=False, inhalt: str='') -> str:
    """Rekonstruiert einen Tag aus Namen und Attributen"""
    if not attribute:
        if self_closing:
            return f'<{tag_name} />'
        elif inhalt:
            return f'<{tag_name}>{inhalt}'
        else:
            return f'<{tag_name}>'
    attr_string = ' '.join([f'{k}="{v}"' for k, v in attribute.items()])
    if self_closing:
        return f'<{tag_name} {attr_string} />'
    elif inhalt:
        return f'<{tag_name} {attr_string}>{inhalt}'
    else:
        return f'<{tag_name} {attr_string}>'

def repariere_doppelte_attribute_v2(kontext, inhalt: str) -> str:
    """
        Verbesserte Version der Attribut-Reparatur mit mehrschichtigem Ansatz
        """
    zeilen = inhalt.split('\n')
    reparierte_zeilen = []
    for zeile in zeilen:
        zeile_stripped = zeile.strip()
        if zeile_stripped.startswith('<!--') or zeile_stripped.startswith('<?') or zeile_stripped.startswith('<!'):
            reparierte_zeilen.append(zeile)
            continue
        if '<' not in zeile or '>' not in zeile:
            reparierte_zeilen.append(zeile)
            continue
        einrueckung = zeile[:len(zeile) - len(zeile.lstrip())]
        resultat = zeile
        geaendert = False
        tag_pattern = '<(\\w+(?::\\w+)?)((?:\\s+[^>]*)?)(/?>)'

        def repariere_einzelnes_tag(match):
            nonlocal geaendert
            tag_name = match.group(1)
            attribute_string = match.group(2)
            tag_abschluss = match.group(3)
            attribute = extrahiere_attribute_robust(kontext, attribute_string)
            original_attr_count = len(re.findall('\\w+\\s*=\\s*["\\\'][^"\\\']*["\\\']', attribute_string))
            if original_attr_count > len(attribute):
                geaendert = True
            is_self_closing = tag_abschluss == '/>'
            return rekonstruiere_tag(kontext, tag_name, attribute, is_self_closing)
        try:
            resultat_neu = re.sub(tag_pattern, repariere_einzelnes_tag, resultat)
            if geaendert:
                resultat = resultat_neu
        except Exception:
            pass
        reparierte_zeilen.append(resultat)
    return '\n'.join(reparierte_zeilen)

def entferne_doppelte_attribute_aggressiv(kontext, inhalt: str) -> str:
    """
        Sehr aggressive Methode zum Entfernen doppelter Attribute.
        Parst jede Zeile komplett neu und behält nur eindeutige Attribute.
        """
    zeilen = inhalt.split('\n')
    resultat_zeilen = []
    for zeile in zeilen:
        zeile_stripped = zeile.strip()
        if not zeile_stripped or zeile_stripped.startswith('<!--') or zeile_stripped.startswith('<?') or zeile_stripped.startswith('<!') or ('<' not in zeile_stripped):
            resultat_zeilen.append(zeile)
            continue
        einrueckung = zeile[:len(zeile) - len(zeile.lstrip())]
        neue_zeile = zeile
        tag_starts = list(re.finditer('<(\\w+)(\\s+[^>]*?)?(/?}>)', zeile_stripped))
        if tag_starts:
            offset = 0
            for tag_match in tag_starts:
                tag_name = tag_match.group(1)
                attribute_teil = tag_match.group(2) or ''
                tag_ende = tag_match.group(3)
                attribute = extrahiere_attribute_robust(kontext, attribute_teil)
                if attribute:
                    attr_str = ' '.join([f'{k}="{v}"' for k, v in attribute.items()])
                    neuer_tag = f'<{tag_name} {attr_str}{tag_ende}'
                else:
                    neuer_tag = f'<{tag_name}{tag_ende}'
                start_pos = tag_match.start() + offset
                end_pos = tag_match.end() + offset
                neue_zeile = neue_zeile[:start_pos] + neuer_tag + neue_zeile[end_pos:]
                offset += len(neuer_tag) - (end_pos - start_pos)
        resultat_zeilen.append(einrueckung + neue_zeile.lstrip())
    return '\n'.join(resultat_zeilen)

def bereinige_attribute_in_tags(kontext, inhalt: str) -> str:
    """
        Bereinigt alle Attribute in allen Tags durch komplette Neuformatierung.
        Dies ist die robusteste Methode für stark beschädigte SVGs.
        """
    zeilen = []
    for zeile in inhalt.split('\n'):
        if not zeile.strip() or zeile.strip().startswith('<!--'):
            zeilen.append(zeile)
            continue

        def bereinige_tag(match):
            vollstaendiger_tag = match.group(0)
            tag_name_match = re.match('<(\\w+(?::\\w+)?)', vollstaendiger_tag)
            if not tag_name_match:
                return vollstaendiger_tag
            tag_name = tag_name_match.group(1)
            attribute = extrahiere_attribute_robust(kontext, vollstaendiger_tag)
            is_self_closing = vollstaendiger_tag.rstrip().endswith('/>')
            is_closing = vollstaendiger_tag.startswith('</')
            if is_closing:
                return f'</{tag_name}>'
            else:
                return rekonstruiere_tag(kontext, tag_name, attribute, is_self_closing)
        neue_zeile = re.sub('<[^>]+>', bereinige_tag, zeile)
        zeilen.append(neue_zeile)
    return '\n'.join(zeilen)

def normalisiere_leerzeichen(kontext, inhalt: str) -> str:
    """Normalisiert Leerzeichen in Attributen"""
    inhalt = re.sub('<([^>]+)>', normalisiere_tag_leerzeichen, inhalt)
    return inhalt

def repariere_xml_struktur_erweitert(kontext, inhalt: str) -> str:
    """Erweiterte XML-Strukturreparatur"""
    inhalt = re.sub('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', '', inhalt)
    inhalt = inhalt.replace('<>', '')
    inhalt = inhalt.replace('</>', '')
    inhalt = normalisiere_leerzeichen(kontext, inhalt)
    inhalt = re.sub('\\s+\\w+=""', '', inhalt)
    inhalt = re.sub('xmlns:\\s*=', 'xmlns=', inhalt)
    return inhalt

def fallback_text_bereinigung(kontext, inhalt: str) -> str:
    """
        Letzte Fallback-Methode: Komplette Text-basierte Bereinigung.
        Entfernt alle problematischen Konstrukte sehr aggressiv.
        """
    zeilen = []
    for zeile in inhalt.split('\n'):
        if not zeile.strip():
            zeilen.append(zeile)
            continue
        if '<' in zeile and '>' in zeile:
            teile = re.split('(<[^>]+>)', zeile)
            neue_teile = []
            for teil in teile:
                if teil.startswith('<') and teil.endswith('>'):
                    teil = re.sub('\\s+', ' ', teil)
                    tag_match = re.match('<(/?)(\\w+)', teil)
                    if tag_match:
                        ist_closing = tag_match.group(1) == '/'
                        tag_name = tag_match.group(2)
                        if ist_closing:
                            neue_teile.append(f'</{tag_name}>')
                        else:
                            attr = {}
                            for attr_match in re.finditer('(\\w+)="([^"]*)"', teil):
                                attr_name = attr_match.group(1)
                                attr_val = attr_match.group(2)
                                if attr_name not in attr:
                                    attr[attr_name] = attr_val
                            if '/>' in teil:
                                neue_teile.append(rekonstruiere_tag(kontext, tag_name, attr, True))
                            else:
                                neue_teile.append(rekonstruiere_tag(kontext, tag_name, attr, False))
                    else:
                        neue_teile.append(teil)
                else:
                    neue_teile.append(teil)
            zeilen.append(''.join(neue_teile))
        else:
            zeilen.append(zeile)
    return '\n'.join(zeilen)

def lade_svg(kontext, dateipfad: Union[str, Path]) -> ET.Element:
    """
        Lädt eine SVG-Datei mit maximaler Robustheit und mehreren Reparaturstrategien
        """
    dateipfad = Path(dateipfad)
    if not dateipfad.exists():
        raise FileNotFoundError(f'SVG-Datei nicht gefunden: {dateipfad}')
    if dateipfad.stat().st_size == 0:
        raise ValueError('SVG-Datei ist leer')
    encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252', 'iso-8859-1']
    inhalt = None
    for encoding in encodings:
        try:
            with open(dateipfad, 'r', encoding=encoding) as f:
                inhalt = f.read()
            break
        except (UnicodeDecodeError, LookupError):
            continue
    if inhalt is None:
        raise ValueError('Konnte Datei nicht mit unterstützten Encodings laden')
    inhalt = re.sub('<svg:[^>]+>', entferne_svg_praefix, inhalt)
    inhalt = re.sub('</svg:', '</', inhalt)
    inhalt = re.sub('xmlns:svg=', 'xmlns=', inhalt)
    strategien = [('Direktes Parsing', ET.fromstring), ('Normalisierung', partial(normalisiere_leerzeichen, kontext)), ('XML-Struktur-Reparatur', partial(repariere_xml_struktur_erweitert, kontext)), ('Attribut-Reparatur V2', partial(repariere_doppelte_attribute_v2, kontext)), ('Aggressive Attribut-Bereinigung', partial(entferne_doppelte_attribute_aggressiv, kontext)), ('Tag-Bereinigung', partial(bereinige_attribute_in_tags, kontext)), ('Fallback Text-Bereinigung', partial(fallback_text_bereinigung, kontext))]
    letzter_fehler = None
    debug_info = []
    try:
        return ET.fromstring(inhalt)
    except ET.ParseError as e:
        letzter_fehler = str(e)
        debug_info.append(f'Direktes Parsing fehlgeschlagen: {e}')
    aktueller_inhalt = inhalt
    for strategie_name, strategie_func in strategien[1:]:
        try:
            print(f'    ⚠ {strategie_name}...')
            if strategie_name != 'Direktes Parsing':
                gereinigter_inhalt = strategie_func(aktueller_inhalt)
                aktueller_inhalt = gereinigter_inhalt
            return ET.fromstring(aktueller_inhalt)
        except ET.ParseError as e:
            letzter_fehler = str(e)
            debug_info.append(f'{strategie_name} fehlgeschlagen: {e}')
            continue
        except Exception as e:
            letzter_fehler = str(e)
            debug_info.append(f'{strategie_name} Exception: {e}')
            continue
    fehler_msg = f'Alle Parsing-Strategien fehlgeschlagen.\n'
    fehler_msg += f'Letzter Fehler: {letzter_fehler}\n'
    fehler_msg += 'Debug-Informationen:\n' + '\n'.join(debug_info[:3])
    raise Exception(fehler_msg)

def erstelle_id(kontext, element_typ: str) -> str:
    """Erstellt eine eindeutige, aussagekräftige ID für ein Element"""
    if element_typ not in kontext['element_counter']:
        kontext['element_counter'][element_typ] = 0
    kontext['element_counter'][element_typ] += 1
    nummer = kontext['element_counter'][element_typ]
    id_mapping = {'path': 'pfad', 'rect': 'rechteck', 'circle': 'kreis', 'ellipse': 'ellipse', 'line': 'linie', 'polyline': 'polylinie', 'polygon': 'polygon', 'g': 'gruppe', 'text': 'text', 'image': 'bild'}
    basis_name = id_mapping.get(element_typ, element_typ)
    return f'{basis_name}-{nummer}'

def erstelle_css_variablen(kontext, schema: str='universal') -> str:
    """Erstellt CSS-Variablen und Animationsklassen für das gewählte Farbschema"""
    if schema not in kontext['farbschemas']:
        schema = 'universal'
    css_vars = kontext['farbschemas'][schema].get('css_variablen', {})
    var_string = '\n'.join([f'          {key}: {value};' for key, value in css_vars.items()])
    css = f'    <style type="text/css">\n      <![CDATA[\n        :root {{\n{var_string}\n        }}\n        \n        /* Animationsklassen zur einfachen Verwendung */\n        .animierbar {{\n          transition: all 0.3s ease-in-out;\n        }}\n        \n        .pulsieren {{\n          animation: pulsieren 2s ease-in-out infinite;\n        }}\n        \n        .pulsieren-langsam {{\n          animation: pulsieren 4s ease-in-out infinite;\n        }}\n        \n        .drehen {{\n          transform-origin: center;\n          animation: drehen 3s linear infinite;\n        }}\n        \n        .drehen-langsam {{\n          transform-origin: center;\n          animation: drehen 6s linear infinite;\n        }}\n        \n        .einblenden {{\n          animation: einblenden 1s ease-in forwards;\n        }}\n        \n        .schweben {{\n          animation: schweben 2s ease-in-out infinite;\n        }}\n        \n        .zoomen {{\n          animation: zoomen 2s ease-in-out infinite;\n        }}\n        \n        /* Animationsdefinitionen */\n        @keyframes pulsieren {{\n          0%, 100% {{ opacity: 0.4; }}\n          50% {{ opacity: 1; }}\n        }}\n        \n        @keyframes drehen {{\n          from {{ transform: rotate(0deg); }}\n          to {{ transform: rotate(360deg); }}\n        }}\n        \n        @keyframes einblenden {{\n          from {{ opacity: 0; }}\n          to {{ opacity: 1; }}\n        }}\n        \n        @keyframes schweben {{\n          0%, 100% {{ transform: translateY(0); }}\n          50% {{ transform: translateY(-10px); }}\n        }}\n        \n        @keyframes zoomen {{\n          0%, 100% {{ transform: scale(1); }}\n          50% {{ transform: scale(1.1); }}\n        }}\n        \n        /* Hover-Effekte */\n        .hover-vergroessern:hover {{\n          transform: scale(1.1);\n          transition: transform 0.3s ease;\n        }}\n        \n        .hover-farbe:hover {{\n          filter: brightness(1.2);\n          transition: filter 0.3s ease;\n        }}\n      ]]>\n    </style>'
    return css

def fuege_defs_hinzu(kontext, root: ET.Element, schema: str='universal'):
    """Insert or update one namespace-independent defs container."""
    defs = next(
        (node for node in root.iter() if bereinige_namespace(kontext, node.tag) == 'defs'),
        None,
    )
    if defs is None:
        defs = ET.Element('defs')
        root.insert(0, defs)
    if not defs.get('id'):
        defs.set('id', 'defs-styles')
    for style_element in list(defs):
        if bereinige_namespace(kontext, style_element.tag) == 'style':
            defs.remove(style_element)
    css_string = erstelle_css_variablen(kontext, schema)
    try:
        style_element = ET.fromstring(css_string)
        defs.append(style_element)
    except Exception:
        style_element = ET.SubElement(defs, 'style')
        style_element.set('type', 'text/css')
        style_element.text = css_string

def passe_element_farben_an(kontext, element: ET.Element, schema: Dict[str, str]):
    """Passt die Farben eines einzelnen Elements an"""
    tag = bereinige_namespace(kontext, element.tag)
    stroke = element.get('stroke')
    if stroke and stroke not in ['none', 'transparent']:
        element.set('stroke', schema['stroke'])
        if 'stroke-opacity' not in element.attrib:
            element.set('stroke-opacity', schema['stroke_opacity'])
    fill = element.get('fill')
    if fill and fill not in ['none', 'transparent']:
        if tag in ['circle', 'rect', 'ellipse', 'polygon', 'path']:
            element.set('fill', schema['fill'])
            element.set('fill-opacity', schema['fill_opacity'])
    elif fill is None and tag in ['circle', 'rect', 'ellipse', 'polygon']:
        element.set('fill', schema['fill'])
        element.set('fill-opacity', schema['fill_opacity'])
    style = element.get('style', '')
    if style:
        style_dict = {}
        for teil in style.split(';'):
            if ':' in teil:
                key, value = teil.split(':', 1)
                key = key.strip()
                value = value.strip()
                style_dict[key] = value
        if 'stroke' in style_dict and style_dict['stroke'] not in ['none', 'transparent']:
            style_dict['stroke'] = schema['stroke']
        if 'fill' in style_dict and style_dict['fill'] not in ['none', 'transparent']:
            style_dict['fill'] = schema['fill']
            if 'fill-opacity' not in style_dict:
                style_dict['fill-opacity'] = schema['fill_opacity']
        neuer_style = ';'.join([f'{k}:{v}' for k, v in style_dict.items()])
        element.set('style', neuer_style)

def vergebe_ids(kontext, root: ET.Element):
    """Assign stable, document-wide unique IDs to relevant elements."""
    kontext['element_counter'] = {}
    used_ids = set()
    relevant_tags = {
        'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
        'polygon', 'g', 'text', 'image', 'defs', 'style',
    }
    for element in root.iter():
        tag = bereinige_namespace(kontext, element.tag)
        current_id = str(element.get('id') or '').strip()
        if current_id and current_id not in used_ids:
            used_ids.add(current_id)
            continue
        if not current_id and tag not in relevant_tags:
            continue

        base_id = current_id or erstelle_id(kontext, tag)
        candidate = base_id
        suffix = 2
        while candidate in used_ids:
            candidate = '%s-%s' % (base_id, suffix)
            suffix += 1
        element.set('id', candidate)
        used_ids.add(candidate)

def passe_farben_an(kontext, root: ET.Element, schema: str='universal'):
    """Passt alle Farben im SVG an das gewählte Schema an"""
    if schema not in kontext['farbschemas']:
        schema = 'universal'
    farb_schema = kontext['farbschemas'][schema]
    for elem in root.iter():
        passe_element_farben_an(kontext, elem, farb_schema)

def berechne_viewbox(kontext, root: ET.Element) -> Tuple[float, float, float, float]:
    """Berechnet oder extrahiert die ViewBox-Werte"""
    viewbox = root.get('viewBox')
    if viewbox:
        werte = viewbox.split()
        if len(werte) == 4:
            return tuple(map(float, werte))
    width = root.get('width', '100')
    height = root.get('height', '100')
    width = konvertiere_zu_pixel(kontext, width)
    height = konvertiere_zu_pixel(kontext, height)
    return (0, 0, width, height)

def konvertiere_zu_pixel(kontext, wert: str) -> float:
    """Konvertiert verschiedene Einheiten zu Pixeln"""
    if not wert:
        return 100.0
    wert_str = str(wert).strip()
    if wert_str.endswith('mm'):
        return float(wert_str[:-2]) * 3.7795275591
    elif wert_str.endswith('cm'):
        return float(wert_str[:-2]) * 37.795275591
    elif wert_str.endswith('in'):
        return float(wert_str[:-2]) * 96.0
    elif wert_str.endswith('pt'):
        return float(wert_str[:-2]) * 1.333333
    elif wert_str.endswith('pc'):
        return float(wert_str[:-2]) * 16.0
    elif wert_str.endswith('px'):
        return float(wert_str[:-2])
    else:
        try:
            return float(re.sub('[^0-9.]', '', wert_str))
        except ValueError:
            return 100.0

def passe_groesse_an(kontext, root: ET.Element, zielgroesse: Union[str, Tuple[int, int]]='mittel', seitenverhaeltnis_beibehalten: bool=True):
    """Passt die Größe des SVG an"""
    viewbox = berechne_viewbox(kontext, root)
    original_breite = viewbox[2] - viewbox[0]
    original_hoehe = viewbox[3] - viewbox[1]
    if isinstance(zielgroesse, str):
        if zielgroesse.startswith('faktor_'):
            try:
                faktor = int(zielgroesse.split('_')[1])
                ziel_breite = original_breite * faktor
                ziel_hoehe = original_hoehe * faktor
            except (ValueError, IndexError):
                ziel_breite, ziel_hoehe = kontext['standardgroessen']['mittel']
        elif zielgroesse in kontext['standardgroessen']:
            ziel_breite, ziel_hoehe = kontext['standardgroessen'][zielgroesse]
        else:
            ziel_breite, ziel_hoehe = kontext['standardgroessen']['mittel']
    else:
        ziel_breite, ziel_hoehe = zielgroesse
    if seitenverhaeltnis_beibehalten and original_breite > 0 and (original_hoehe > 0):
        verhaeltnis = original_breite / original_hoehe
        ziel_verhaeltnis = ziel_breite / ziel_hoehe
        if verhaeltnis > ziel_verhaeltnis:
            ziel_hoehe = ziel_breite / verhaeltnis
        else:
            ziel_breite = ziel_hoehe * verhaeltnis
    root.set('width', f'{int(ziel_breite)}px')
    root.set('height', f'{int(ziel_hoehe)}px')
    root.set('viewBox', f'{viewbox[0]} {viewbox[1]} {viewbox[2]} {viewbox[3]}')

def bereinige_svg(kontext, root: ET.Element):
    """Entfernt unnötige Elemente und Attribute"""
    elemente_zum_entfernen = []
    for elem in root.iter():
        tag = bereinige_namespace(kontext, elem.tag)
        if tag in ['metadata', 'sodipodi:namedview', 'inkscape:perspective']:
            elemente_zum_entfernen.append(elem)
        unnoetige_attribute = ['xmlns:inkscape', 'xmlns:sodipodi', 'xmlns:dc', 'xmlns:cc', 'xmlns:rdf', 'inkscape:version', 'sodipodi:docname', 'inkscape:export-filename', 'inkscape:export-xdpi', 'inkscape:export-ydpi', 'pointer-events', 'xml:space']
        for attr in list(elem.attrib.keys()):
            attr_clean = bereinige_namespace(kontext, attr)
            if attr_clean in unnoetige_attribute or 'inkscape:' in attr or 'sodipodi:' in attr:
                elem.attrib.pop(attr, None)
    entferne_rekursiv_func = partial(entferne_element_von_parent, kontext, root)
    for elem in elemente_zum_entfernen:
        entferne_rekursiv_func(elem)

def entferne_element_von_parent(kontext, root: ET.Element, element: ET.Element):
    """Entfernt ein Element von seinem Parent"""
    for parent in root.iter():
        try:
            parent.remove(element)
        except ValueError:
            pass

def optimiere_pfade(kontext, root: ET.Element):
    """Optimiert SVG-Pfade durch Rundung von Werten"""
    runde_zahl_func = partial(runde_zahlenwert, kontext)
    for elem in root.iter():
        tag = bereinige_namespace(kontext, elem.tag)
        if tag == 'path':
            d = elem.get('d', '')
            if d:
                d_optimiert = re.sub('-?\\d+\\.\\d+', runde_zahl_func, d)
                elem.set('d', d_optimiert)
        transform = elem.get('transform', '')
        if transform and '(' in transform:
            runde_transform_func = partial(runde_transform_werte, kontext)
            transform_opt = re.sub('\\(([^)]+)\\)', runde_transform_func, transform)
            elem.set('transform', transform_opt)

def runde_zahlenwert(kontext, match) -> str:
    """Rundet einen Zahlenwert auf 3 Dezimalstellen"""
    zahl = float(match.group(0))
    return f'{zahl:.3f}'.rstrip('0').rstrip('.')

def runde_transform_werte(kontext, match) -> str:
    """Rundet Werte in Transform-Attributen"""
    zahlen = match.group(1)
    gerundete = []
    for zahl in zahlen.split():
        try:
            z = float(zahl.rstrip(','))
            gerundete.append(f'{z:.3f}'.rstrip('0').rstrip('.'))
        except ValueError:
            gerundete.append(zahl)
    return f"{match.group(0).split('(')[0]}({' '.join(gerundete)})"

def erstelle_sauberes_svg(kontext, root: ET.Element) -> str:
    """Erstellt ein sauberes, gut formatiertes SVG"""
    for elem in root.iter():
        if isinstance(elem.tag, str):
            elem.tag = bereinige_namespace(kontext, elem.tag)
    svg_header = '<?xml version="1.0" encoding="UTF-8"?>\n'
    root.set('xmlns', 'http://www.w3.org/2000/svg')
    root.set('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    rough_string = ET.tostring(root, encoding='unicode', method='xml')
    try:
        reparsed = minidom.parseString(rough_string)
        formatiert = reparsed.toprettyxml(indent='  ', encoding=None)
        zeilen = formatiert.split('\n')
        filter_func = partial(ist_relevante_zeile, kontext)
        gefiltert = [zeile for zeile in zeilen if filter_func(zeile)]
        return svg_header + '\n'.join(gefiltert)
    except Exception:
        return svg_header + rough_string

def ist_relevante_zeile(kontext, zeile: str) -> bool:
    """Prüft ob eine Zeile relevant ist (nicht leer, nicht XML-Deklaration)"""
    return zeile.strip() and (not zeile.strip().startswith('<?xml'))

def konvertiere(kontext, eingabe_pfad: Union[str, Path], ausgabe_pfad: Union[str, Path], farbschema: str='universal', groesse: Union[str, Tuple[int, int]]='mittel', ids_vergeben: bool=True, bereinigen: bool=True, pfade_optimieren: bool=True, animationen_hinzufuegen: bool=True, verbose: bool=False) -> bool:
    """
        Hauptmethode zum Konvertieren und Standardisieren von SVG-Dateien
        
        Args:
            eingabe_pfad: Pfad zur Eingabe-SVG-Datei
            ausgabe_pfad: Pfad zur Ausgabe-SVG-Datei
            farbschema: 'dunkel', 'hell', 'universal' oder 'farbe_universal'
            groesse: 'klein', 'mittel', 'gross', 'icon', 'thumbnail', 'faktor_2-12' oder (breite, hoehe)
            ids_vergeben: Neue IDs für Elemente vergeben
            bereinigen: SVG von unnötigen Elementen bereinigen
            pfade_optimieren: Pfade und Transformationen optimieren
            animationen_hinzufuegen: CSS-Animationsklassen hinzufügen
            verbose: Detaillierte Ausgabe
        
        Returns:
            True bei Erfolg, False bei Fehler
        """
    try:
        if verbose:
            dateiname = eingabe_pfad.name if isinstance(eingabe_pfad, Path) else Path(eingabe_pfad).name
            print(f'    → Lade SVG: {dateiname}')
        root = lade_svg(kontext, eingabe_pfad)
        if verbose:
            print(f'    → Verarbeite SVG-Struktur...')
        if bereinigen:
            bereinige_svg(kontext, root)
        if pfade_optimieren:
            optimiere_pfade(kontext, root)
        if animationen_hinzufuegen:
            fuege_defs_hinzu(kontext, root, farbschema)
        if ids_vergeben:
            vergebe_ids(kontext, root)
        passe_farben_an(kontext, root, farbschema)
        passe_groesse_an(kontext, root, groesse)
        if verbose:
            print(f'    → Erstelle Ausgabe...')
        sauberes_svg = erstelle_sauberes_svg(kontext, root)
        ausgabe_pfad = Path(ausgabe_pfad)
        ausgabe_pfad.parent.mkdir(parents=True, exist_ok=True)
        with open(ausgabe_pfad, 'w', encoding='utf-8') as f:
            f.write(sauberes_svg)
        if verbose:
            print(f'    → Erfolgreich gespeichert')
        return True
    except Exception as e:
        fehler_typ = type(e).__name__
        if verbose:
            print(f'    ✗ {fehler_typ}: {e}')
            import traceback
            traceback.print_exc()
        else:
            print(f'    ✗ Fehler: {e}')
        return False

def batch_konvertierung(kontext, eingabe_verzeichnis: Union[str, Path], ausgabe_verzeichnis: Union[str, Path], farbschema: str='universal', groesse: Union[str, Tuple[int, int]]='mittel') -> Dict[str, bool]:
    """
        Konvertiert alle SVG-Dateien in einem Verzeichnis
        
        Returns:
            Dictionary mit Dateinamen und Erfolgsstatus
        """
    eingabe_verzeichnis = Path(eingabe_verzeichnis)
    ausgabe_verzeichnis = Path(ausgabe_verzeichnis)
    if not eingabe_verzeichnis.exists():
        raise FileNotFoundError(f'Verzeichnis nicht gefunden: {eingabe_verzeichnis}')
    ausgabe_verzeichnis.mkdir(parents=True, exist_ok=True)
    ergebnisse = {}
    svg_dateien = list(eingabe_verzeichnis.glob('*.svg'))
    for svg_datei in svg_dateien:
        ausgabe_datei = ausgabe_verzeichnis / svg_datei.name
        erfolg = konvertiere(kontext, svg_datei, ausgabe_datei, farbschema=farbschema, groesse=groesse)
        ergebnisse[svg_datei.name] = erfolg
    return ergebnisse

def auto_konvertierung(kontext, verzeichnis: Union[str, Path]='.', suffix: str='_converted', farbschema: str='universal', groesse: Union[str, Tuple[int, int]]='mittel', ueberspringe_konvertierte: bool=True) -> Dict[str, bool]:
    """
        Konvertiert automatisch alle SVG-Dateien im angegebenen Verzeichnis und
        speichert sie in das Unterverzeichnis 'converted_sfv_files'.
        Dateinamen werden generisch und robust gekürzt (ISO entfernt, Interpunktion
        entfernt, 'with_*' -> '(w..)' etc.).

        Hinweis:
          - Das alte 'suffix' wird NICHT mehr zur Zielbenennung verwendet.
            (Kompatibilität: Parameter bleibt bestehen, wird aber ignoriert.)
          - Überspringen findet statt, wenn die Zieldatei bereits existiert.
        """
    from pathlib import Path
    from functools import partial
    verzeichnis = Path(verzeichnis)
    if not verzeichnis.exists():
        raise FileNotFoundError(f'Verzeichnis nicht gefunden: {verzeichnis}')
    ziel_verzeichnis = verzeichnis / 'converted_sfv_files'
    ziel_verzeichnis.mkdir(parents=True, exist_ok=True)
    ergebnisse: Dict[str, bool] = {}
    svg_dateien = list(verzeichnis.glob('*.svg'))
    if not svg_dateien:
        print(f'Keine SVG-Dateien zum Konvertieren in {verzeichnis} gefunden.')
        return ergebnisse
    print(f"\n{'=' * 60}")
    print(f'SVG-Konverter - Automatische Verarbeitung')
    print(f"{'=' * 60}")
    print(f'Quellverzeichnis : {verzeichnis.absolute()}')
    print(f'Zielverzeichnis  : {ziel_verzeichnis.absolute()}')
    print(f'Farbschema       : {farbschema}')
    print(f'Größe            : {groesse}')
    print(f'Anzahl Dateien   : {len(svg_dateien)}')
    print(f"{'=' * 60}\n")
    for i, svg_datei in enumerate(svg_dateien, 1):
        kurzer_stem = normalisiere_dateiname(kontext, svg_datei.stem, suffix='')
        ausgabe_datei = ziel_verzeichnis / f'{kurzer_stem}{svg_datei.suffix}'
        print(f'[{i}/{len(svg_dateien)}] {svg_datei.name}')
        if ueberspringe_konvertierte and ausgabe_datei.exists():
            print(f'    ↷ Übersprungen (existiert bereits): {ausgabe_datei.name}\n')
            ergebnisse[svg_datei.name] = True
            continue
        erfolg = konvertiere(kontext, svg_datei, ausgabe_datei, farbschema=farbschema, groesse=groesse, verbose=True)
        ergebnisse[svg_datei.name] = erfolg
        if erfolg:
            original_size = svg_datei.stat().st_size
            neuer_size = ausgabe_datei.stat().st_size
            if neuer_size < original_size:
                prozent = (original_size - neuer_size) / original_size * 100
                print(f'    ✓ Optimiert: {original_size}B → {neuer_size}B (-{prozent:.1f}%)')
            elif neuer_size > original_size:
                prozent = (neuer_size - original_size) / original_size * 100
                print(f'    ✓ Konvertiert: {original_size}B → {neuer_size}B (+{prozent:.1f}%)')
            else:
                print(f'    ✓ Konvertiert: {neuer_size}B')
            print(f'    → {ausgabe_datei.name}\n')
        else:
            print(f'    ✗ Fehler bei der Konvertierung\n')
    print(f"{'=' * 60}")
    erfolgreiche = sum(ergebnisse.values())
    print(f'Ergebnis: {erfolgreiche} von {len(ergebnisse)} Datei(en) erfolgreich')
    print(f"{'=' * 60}\n")
    if erfolgreiche < len(ergebnisse):
        fehlerhafte = [name for name, ok in ergebnisse.items() if not ok]
        if fehlerhafte:
            print('\nFehler bei folgenden Dateien:')
            for datei in fehlerhafte:
                print(f'  - {datei}')
    return ergebnisse

def ist_nicht_konvertiert(kontext, suffix: str, datei: Path) -> bool:
    """Prüft ob eine Datei noch nicht konvertiert wurde"""
    return not datei.stem.endswith(suffix)

def normalisiere_dateiname(kontext, dateiname: str, suffix: str='') -> str:
    """
        Generische, robuste Dateinamen-Normalisierung für konvertierte Dateien.

        Regeln:
          - Alles ab "ISO" (inkl. optionaler Trennzeichen/() davor) wird entfernt.
          - Kommas und Punkte werden entfernt.
          - Mehrfache Unterstriche werden auf einen reduziert, führende/trailing "_", "-" werden entfernt.
          - Phrasen "with_*" werden zu einem Kürzel in Klammern zusammengezogen:
                with_dished_ends -> (wde)
          - Ein optionales 'suffix' kann angehängt werden (Standard: keins).
        """
    import re
    if suffix and dateiname.endswith(suffix):
        dateiname = dateiname[:-len(suffix)]
    name = dateiname
    name = re.sub('\\s+', '_', name)
    name = re.sub('[_\\-\\s]*\\(?ISO.*$', '', name, flags=re.IGNORECASE)
    name = name.replace(',', '').replace('.', '')

    def _build_acronym(match: 're.Match') -> str:
        seg = match.group(0)
        parts = seg.lower().split('_')
        initials = ''.join((p[0] for p in parts if p))
        return f'({initials})'
    name = re.sub('with(?:_[A-Za-z0-9]+)+', _build_acronym, name, flags=re.IGNORECASE)
    name = re.sub('_+', '_', name)
    name = name.strip('_- ')
    return f'{name}{suffix}'

def main():
    """Hauptfunktion - Automatische Konvertierung aller SVG-Dateien"""
    import sys
    konverter = erstelle_svg_kontext()
    verzeichnis = '.'
    farbschema = 'universal'
    groesse = 'mittel'
    suffix = '_converted'
    if len(sys.argv) > 1:
        if sys.argv[1] in ['-h', '--help', 'help']:
            print('=' * 60)
            print('SVG-Konverter - Automatische SVG-Optimierung')
            print('=' * 60)
            print('\nVerwendung:')
            print(f'  {sys.argv[0]} [verzeichnis] [farbschema] [groesse]')
            print(f'\nFarbschema:')
            print(f'  dunkel          - Für dunkle Hintergründe (weiße Linien)')
            print(f'  hell            - Für helle Hintergründe (schwarze Linien)')
            print(f'  universal       - Funktioniert auf beiden (Standard)')
            print(f'  farbe_universal - Buntes Schema (blau/grün/orange)')
            print(f'\nGröße:')
            print(f'  klein      - 100x100px')
            print(f'  mittel     - 200x200px (Standard)')
            print(f'  gross      - 400x400px')
            print(f'  icon       - 64x64px')
            print(f'  thumbnail  - 150x150px')
            print(f'  faktor_2   - 2x der Originalgröße')
            print(f'  faktor_3   - 3x der Originalgröße')
            print(f'  ...')
            print(f'  faktor_12  - 12x der Originalgröße')
            print(f'\nAnimations-Vorbereitung:')
            print(f'  Jedes Element erhält eine eindeutige ID')
            print(f'  CSS-Klassen werden automatisch hinzugefügt:')
            print(f'    .pulsieren, .drehen, .einblenden, .schweben, .zoomen')
            print(f'\nDateinamen-Normalisierung:')
            print(f'  ISO-Standards werden automatisch entfernt:')
            print(f"    'Tank_-_ISO_10628-2.svg' -> 'Tank_converted.svg'")
            print(f'  Kommas werden entfernt:')
            print(f"    'Compressor,_pump.svg' -> 'Compressor_pump_converted.svg'")
            print(f'\nBeispiele:')
            print(f'  {sys.argv[0]}')
            print(f'  {sys.argv[0]} dunkel')
            print(f'  {sys.argv[0]} farbe_universal faktor_12')
            print(f'  {sys.argv[0]} ./icons hell icon')
            print('=' * 60)
            return
        erster_param = sys.argv[1]
        if erster_param in ['dunkel', 'hell', 'universal', 'farbe_universal']:
            farbschema = erster_param
        elif Path(erster_param).exists():
            verzeichnis = erster_param
    if len(sys.argv) > 2:
        zweiter_param = sys.argv[2]
        if zweiter_param in ['dunkel', 'hell', 'universal', 'farbe_universal']:
            farbschema = zweiter_param
        elif zweiter_param in ['klein', 'mittel', 'gross', 'icon', 'thumbnail'] or zweiter_param.startswith('faktor_'):
            groesse = zweiter_param
    if len(sys.argv) > 3:
        dritter_param = sys.argv[3]
        if dritter_param in ['klein', 'mittel', 'gross', 'icon', 'thumbnail'] or dritter_param.startswith('faktor_'):
            groesse = dritter_param
    try:
        ergebnisse = auto_konvertierung(konverter, verzeichnis=verzeichnis, suffix=suffix, farbschema=farbschema, groesse=groesse)
        if ergebnisse and (not all(ergebnisse.values())):
            sys.exit(1)
    except Exception as e:
        print(f'\nFehler: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
if __name__ == '__main__':
    main()
