#!/usr/bin/env python3
"""Browser and visual verification for Plant Factory V64_r6.

The test exercises the visible category scrollbar, keyboard tab navigation,
the bundled Anlagen Entwurf, structured placement, individual part editing and
the explicit upgrade path for a legacy flat SVG composition.
"""

import os
import pathlib
import sys
import tempfile

from playwright.sync_api import sync_playwright


TEST_DIR = pathlib.Path(__file__).resolve().parent
if str(TEST_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_DIR))

import smoke_ui as shared  # noqa: E402


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8090'
DEFAULT_EVIDENCE = pathlib.Path(tempfile.gettempdir()) / 'plant_factory_v64_r6_evidence'
EVIDENCE_DIR = pathlib.Path(os.environ.get('SMOKE_EVIDENCE_DIR', str(DEFAULT_EVIDENCE)))
ASSEMBLY_ID = 'assembly_template_mt4tvvee_tuvofeq'
PASSED = 0
FAILED = 0
FAILURES = []


def check(name, condition, detail=''):
    """Record one deterministic browser assertion."""
    global PASSED, FAILED
    if condition:
        PASSED += 1
        return
    FAILED += 1
    FAILURES.append(name + (' — ' + detail if detail else ''))


def progress(message):
    """Print one unbuffered browser checkpoint."""
    print('[v64-r6-smoke] ' + message, flush=True)


def open_application(context):
    """Open one instrumented application page."""
    shared.reset_browser_diagnostics()
    page, status, embedded = shared.open_application(context, BASE_URL)
    page.set_default_timeout(20000)
    page.wait_for_function(
        "function () { return Boolean(window.__plantFactoryV64R6) "
        "&& document.querySelectorAll('#category-chips .category-chip').length > 2; }",
        timeout=60000,
    )
    check('HTTP 200', status == 200, str(status))
    check('Direkte Browserinstanz', embedded is False, 'embedded=' + str(embedded))
    return page


def capture(page, filename, selector):
    """Capture one current-run visual artifact."""
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    page.locator(selector).screenshot(
        path=str(EVIDENCE_DIR / filename),
        animations='disabled',
    )


def verify_category_scrollbar(page):
    """Verify visible native scrolling and complete keyboard navigation."""
    release = page.evaluate("function () { return window.__plantFactoryV64R6 || null; }")
    check('R6 Releasevertrag', bool(release)
          and release.get('version') == '64_r6'
          and release.get('visibleInventoryScrollbar') is True
          and release.get('editableAssemblyParts') is True, str(release))
    check('R6 Titel und Badge', 'V64_r6' in page.title()
          and page.locator('.version').inner_text().strip().lower() == '64_r6 · v9',
          page.title())

    page.set_viewport_size({'width': 900, 'height': 780})
    page.wait_for_timeout(300)
    metrics = page.evaluate(
        "function () { var host=document.getElementById('category-chips'); "
        "var css=getComputedStyle(host); var bar=getComputedStyle(host,'::-webkit-scrollbar'); "
        "var buttons=Array.from(host.querySelectorAll('.category-chip')); "
        "return {clientWidth:host.clientWidth,scrollWidth:host.scrollWidth,scrollLeft:host.scrollLeft,"
        "overflowX:css.overflowX,scrollbarWidth:css.scrollbarWidth,barDisplay:bar.display,barHeight:bar.height,"
        "roles:buttons.map(function (b) { return b.getAttribute('role'); }),"
        "selected:buttons.filter(function (b) { return b.getAttribute('aria-selected')==='true'; }).length,"
        "tabStops:buttons.filter(function (b) { return b.tabIndex===0; }).length}; }"
    )
    check('Kategorien sind horizontal erweitert',
          metrics['scrollWidth'] > metrics['clientWidth'], str(metrics))
    check('Nativer Scrollbalken ist sichtbar',
          metrics['overflowX'] == 'auto'
          and metrics['scrollbarWidth'] != 'none'
          and metrics['barDisplay'] != 'none'
          and metrics['barHeight'] not in ('0px', 'auto'), str(metrics))
    check('Tablisten-Semantik ist vollständig',
          all(role == 'tab' for role in metrics['roles'])
          and metrics['selected'] == 1 and metrics['tabStops'] == 1, str(metrics))

    first = page.locator('#category-chips .category-chip').first
    first.focus()
    page.keyboard.press('End')
    page.wait_for_timeout(300)
    end_state = page.evaluate(
        "function () { var h=document.getElementById('category-chips'); var b=Array.from(h.children); "
        "return {scrollLeft:h.scrollLeft,lastSelected:b[b.length-1].getAttribute('aria-selected'),"
        "focused:document.activeElement===b[b.length-1]}; }"
    )
    check('Ende-Taste fokussiert, aktiviert und enthüllt die letzte Kategorie',
          end_state['focused'] is True and end_state['lastSelected'] == 'true'
          and end_state['scrollLeft'] > 0, str(end_state))
    page.keyboard.press('Home')
    page.wait_for_timeout(220)
    home_state = page.evaluate(
        "function () { var h=document.getElementById('category-chips'); var b=Array.from(h.children); "
        "return {firstSelected:b[0].getAttribute('aria-selected'),focused:document.activeElement===b[0]}; }"
    )
    check('Pos1 kehrt zur ersten Kategorie zurück',
          home_state['focused'] is True and home_state['firstSelected'] == 'true',
          str(home_state))
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(180)
    check('Pfeiltaste wechselt genau eine Kategorie',
          page.locator('#category-chips .category-chip').nth(1).get_attribute('aria-selected') == 'true')
    capture(page, 'V64_r6_01_Accessible_Inventory_Scrollbar.png', '#sidebar-left')


def open_drawing_inventory(page):
    """Open the drawing assembly inventory and return the bundled card."""
    page.set_viewport_size({'width': 1920, 'height': 1080})
    page.locator('#workspace-plant-drawing-button').click()
    page.wait_for_selector('#plant-drawing-workspace:not([hidden])')
    page.locator("[data-inventory-tab='assemblies']").click()
    card = page.locator(
        ".plant-drawing-assembly-card[data-assembly-template-id='%s']" % ASSEMBLY_ID
    )
    card.wait_for(state='visible')
    return card


def verify_bundled_assembly(page):
    """Verify the exact user-created drawing assembly and transfer affordance."""
    card = open_drawing_inventory(page)
    text = card.inner_text()
    check('Anlagen Entwurf steht direkt unter Baugruppen',
          'Anlagen Entwurf' in text and 'Baugruppe · 31 Teile · Bibliothek' in text,
          text)
    check('Baugruppenkarte dokumentiert 49 freie Ports',
          '49 freie Ports · Baugruppen' in text, text)
    payload = page.evaluate(
        "async function (id) { var r=await fetch('/api/drawing-assemblies'); var p=await r.json(); "
        "var a=p.assemblies.find(function (x) { return x.assembly_template_id===id; }); "
        "return a ? {entities:a.entities.length,connections:a.connections.length,"
        "primitives:a.primitives.length,width:a.width,height:a.height} : null; }",
        ASSEMBLY_ID,
    )
    check('Baugruppen-API ist vollständig',
          bool(payload) and payload['entities'] == 31 and payload['connections'] == 14
          and payload['primitives'] == 45 and payload['width'] == 1152
          and payload['height'] == 1068, str(payload))
    card.click()
    action = page.get_by_role('button', name='Als editierbare Baugruppe ins Anlagen-Inventar')
    action.wait_for(state='visible')
    check('Transfer erklärt editierbare Einzelteile',
          'weiterhin konfigurierbare Entities' in page.locator('.plant-drawing-inspector').inner_text())
    capture(page, 'V64_r6_02_Drawing_Assembly_Inventory.png', '#plant-drawing-workspace')
    return action


def switch_to_custom_library(page):
    """Open the main plant editor and its custom inventory scope."""
    page.evaluate(
        "function () { document.querySelector("
        "\"[data-workspace='engineering'][data-target-tab='elements']\").click(); }"
    )
    page.wait_for_function(
        "function () { return document.body.dataset.workspaceKind==='canvas'; }"
    )
    page.locator('#kategorie-filter').select_option('__custom__', force=True)
    page.wait_for_timeout(220)


def plant_counts(page):
    """Return main plant editor entity and connection counts."""
    return page.evaluate(
        "function () { return {"
        "elements:document.querySelectorAll('#elements-layer > .svg-element').length,"
        "layouts:document.querySelectorAll('#elements-layer > .svg-element--assembly-layout').length,"
        "connections:document.querySelectorAll('#connections-layer .connection-line').length,"
        "selected:document.querySelectorAll('#elements-layer > .svg-element.selected').length}; }"
    )

def visible_plant_part_count(page):
    """Return how many elementary plant parts intersect the visible canvas."""
    return page.evaluate(
        "function () { var canvas=document.getElementById('main-canvas').getBoundingClientRect(); "
        "return Array.from(document.querySelectorAll("
        "'#elements-layer > .svg-element:not(.svg-element--assembly-layout)')).filter(function (node) { "
        "var box=node.getBoundingClientRect(); return box.width>0 && box.height>0 "
        "&& box.right>canvas.left && box.left<canvas.right "
        "&& box.bottom>canvas.top && box.top<canvas.bottom; }).length; }"
    )



def verify_structured_placement(page, action):
    """Transfer through the real UI and place the resulting structured template."""
    action.click()
    page.wait_for_function(
        "async function () { var r=await fetch('/api/templates'); var p=await r.json(); "
        "return Boolean(p.templates.Anlagen_Entwurf "
        "&& p.templates.Anlagen_Entwurf.composition_mode==='structured-assembly'); }",
        timeout=30000,
    )
    switch_to_custom_library(page)
    card = page.locator(
        "#template-palette .template-item[data-template-id='Anlagen_Entwurf']"
        "[data-composition-mode='structured-assembly']"
    )
    card.wait_for(state='visible')
    check('Anlagen-Inventar kennzeichnet die strukturierte Vorlage',
          'Baugruppe · 31 Teile' in card.inner_text()
          and '31 Einzelteilen' in (card.get_attribute('aria-label') or ''),
          card.inner_text())
    card.drag_to(page.locator('#main-canvas'),
                 target_position={'x': 230, 'y': 140})
    page.wait_for_function(
        "function () { return document.querySelectorAll('#elements-layer > .svg-element').length===32 "
        "&& document.querySelectorAll('#connections-layer .connection-line').length===14; }",
        timeout=30000,
    )
    counts = plant_counts(page)
    check('Strukturierte Platzierung erzeugt 31 Einzelteile plus passive Ebene',
          counts == {'elements': 32, 'layouts': 1, 'connections': 14, 'selected': 1},
          str(counts))
    visible_parts = visible_plant_part_count(page)
    check('Strukturierte Baugruppe liegt sichtbar auf der Zeichenfläche',
          visible_parts >= 25, str(visible_parts))
    hidden = page.evaluate(
        "function () { var layout=document.querySelector('.svg-element--assembly-layout'); "
        "return {pointer:getComputedStyle(layout).pointerEvents,"
        "entities:layout.querySelectorAll('[data-pf-entity-id][display=\"none\"]').length,"
        "connections:layout.querySelectorAll('[data-pf-connection-id][display=\"none\"]').length,"
        "label:getComputedStyle(layout.querySelector('.element-label')).display}; }"
    )
    check('Passive Ebene doppelt keine Geräte und blockiert keine Auswahl',
          hidden['pointer'] == 'none' and hidden['entities'] == 31
          and hidden['connections'] in (0, 14) and hidden['label'] == 'none',
          str(hidden))

    furnace = page.locator("#elements-layer > .svg-element[data-template-id='Classic_furnace']")
    furnace.click(force=True)
    page.wait_for_timeout(180)
    properties_text = page.locator('#properties-panel').inner_text()
    check('Rohrofen ist als eigenes Gerät auswählbar',
          'Rohrofen' in properties_text and 'Allgemein' in properties_text
          and 'V9-Binding' in properties_text, properties_text[:240])
    page.locator(".inspector-nav > .inspector-nav-button[data-inspector-view='device']").click()
    page.wait_for_function(
        "function () { return document.body.dataset.inspectorView==='device'; }"
    )
    page.wait_for_selector('#tab-device.active')
    check('Einzelgerät öffnet die Device-/I/O-Konfiguration',
          page.locator('#device-panel').inner_text().strip() != '')
    page.locator(".inspector-nav > .inspector-nav-button[data-inspector-view='hmi']").click()
    page.wait_for_function(
        "function () { return document.body.dataset.inspectorView==='hmi'; }"
    )
    page.wait_for_selector('#tab-hmi.active')
    check('Einzelgerät öffnet die HMI-Konfiguration',
          page.locator('#hmi-ui-panel').inner_text().strip() != '')
    page.locator(".inspector-nav > .inspector-nav-button[data-inspector-view='elements']").click()
    page.wait_for_selector('#tab-elements.active')
    capture(page, 'V64_r6_03_Structured_Assembly_Parts.png', '#main-content')


def upload_legacy_probe(page):
    """Create one temporary flat copy of the same SVG for migration testing."""
    return page.evaluate(
        "async function () { var r=await fetch('/api/templates'); var p=await r.json(); "
        "var t=p.templates.Anlagen_Entwurf; if(!t) return null; "
        "var metadata={name:'Eigene Baugruppe R6-Test',kategorie:'Custom',"
        "family:'custom-composition',symbol_type:'custom-composition',library_role:'custom',"
        "breite:t.breite,hoehe:t.hoehe,view_box:t.view_box,ports:t.ports,"
        "capabilities:t.capabilities,composition_mode:'flat'}; "
        "var u=await fetch('/api/template/hochladen',{method:'POST',headers:{'Content-Type':'application/json'},"
        "body:JSON.stringify({dateiname:'R6_Legacy_Probe.svg',svg:t.svg,metadaten:metadata})}); "
        "return await u.json(); }"
    )


def verify_legacy_upgrade(page):
    """Verify explicit migration of a pre-R6 flat SVG without automatic mutation."""
    result = upload_legacy_probe(page)
    check('Temporäre Legacy-Probe wurde angelegt',
          bool(result) and result.get('erfolg') is True, str(result))
    page.reload(wait_until='networkidle')
    page.wait_for_function(
        "function () { return Boolean(window.__plantFactoryV64R6) "
        "&& document.querySelectorAll('#category-chips .category-chip').length>2; }",
        timeout=60000,
    )
    switch_to_custom_library(page)
    card = page.locator("#template-palette .template-item[data-template-id='R6_Legacy_Probe']")
    card.wait_for(state='visible')
    check('Flache Altvorlage bleibt als kompatibler SVG-Pfad erhalten',
          card.get_attribute('data-composition-mode') == 'flat')
    card.drag_to(page.locator('#main-canvas'),
                 target_position={'x': 230, 'y': 140})
    page.wait_for_function(
        "function () { return document.querySelectorAll('#elements-layer > .svg-element').length===1; }"
    )
    page.locator('#elements-layer > .svg-element').click(force=True)
    upgrade = page.locator('#prop-expand-drawing-assembly')
    upgrade.wait_for(state='visible', timeout=30000)
    check('Alt-Baugruppe bietet eine explizite, nicht automatische Migration',
          'In einzeln editierbare Bauteile auflösen' in upgrade.inner_text())
    page.evaluate(
        "function () { document.getElementById('prop-expand-drawing-assembly').click(); }"
    )
    page.wait_for_function(
        "function () { return document.querySelectorAll('#elements-layer > .svg-element').length===32 "
        "&& document.querySelectorAll('#connections-layer .connection-line').length===14; }",
        timeout=30000,
    )
    counts = plant_counts(page)
    check('Legacy-Migration ist deckungsgleich strukturiert',
          counts['elements'] == 32 and counts['layouts'] == 1
          and counts['connections'] == 14 and counts['selected'] == 1,
          str(counts))
    visible_parts = visible_plant_part_count(page)
    check('Migrierte Einzelteile bleiben an der sichtbaren Ablageposition',
          visible_parts >= 25, str(visible_parts))
    capture(page, 'V64_r6_04_Legacy_Assembly_Upgrade.png', '#main-content')


def run():
    """Run the complete R6 browser and visual contract."""
    playwright = sync_playwright().start()
    browser = None
    try:
        browser = shared.launch_browser(playwright)
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            device_scale_factor=1,
        )
        page = open_application(context)
        try:
            progress('Sichtbare Kategorienavigation und Tastatur prüfen')
            verify_category_scrollbar(page)
            progress('Gebündelten Anlagenentwurf und Transfer prüfen')
            action = verify_bundled_assembly(page)
            progress('Strukturierte Platzierung und Einzelgeräte prüfen')
            verify_structured_placement(page, action)
            progress('Explizite Migration einer flachen Alt-Baugruppe prüfen')
            verify_legacy_upgrade(page)
            check('Keine Page-Fehler', len(shared.page_errors) == 0,
                  ' | '.join(shared.page_errors[:3]))
            check('Keine Request-Fehler', len(shared.request_failures) == 0,
                  ' | '.join(shared.request_failures[:3]))
            check('Keine Konsolenfehler', len(shared.console_errors) == 0,
                  ' | '.join(shared.console_errors[:3]))
        finally:
            context.close()
    finally:
        if browser is not None:
            browser.close()
        playwright.stop()

    print('V64_r6 browser contract: %d passed, %d failed.' % (PASSED, FAILED))
    for failure in FAILURES:
        print('  FEHLER ' + failure)
    return FAILED


if __name__ == '__main__':
    raise SystemExit(1 if run() else 0)

