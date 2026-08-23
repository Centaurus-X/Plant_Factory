#!/usr/bin/env python3
"""Browser and visual regression verification for Plant Factory V64_r1."""

import hashlib
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright


TEST_DIR = pathlib.Path(__file__).resolve().parent
if str(TEST_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_DIR))

import smoke_ui as shared


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"
SCREENSHOT_DIR = pathlib.Path(os.environ.get("SMOKE_EVIDENCE_DIR", str(TEST_DIR / "screenshots")))
PASSED = 0
FAILED = 0
FAILURES = []
REFERENCE_EXPECTATIONS = {
    "reactor": {"children": 118, "animations": 48},
    "furnace": {"children": 85, "animations": 46},
    "plant": {"children": 94, "animations": 66},
}


def check(name, condition, detail=""):
    """Record one deterministic assertion."""
    global PASSED, FAILED
    if condition:
        PASSED += 1
        return
    FAILED += 1
    FAILURES.append(name + (" — " + detail if detail else ""))


def open_drawing(context):
    """Open one fresh application page at the drawing workspace."""
    page, status, embedded = shared.open_application(context, BASE_URL)
    page.set_default_timeout(15000)
    page.wait_for_timeout(700)
    check("HTTP 200", status == 200, str(status))
    page.locator("#workspace-plant-drawing-button").click()
    page.wait_for_selector("#plant-drawing-workspace:not([hidden])")
    return page


def screenshot_hash(page, selector, path):
    """Capture one deterministic element screenshot and return its hash."""
    data = page.locator(selector).screenshot(path=str(path), animations="disabled")
    return hashlib.sha256(data).hexdigest()


def verify_inventory_and_navigation(browser):
    """Verify corrected palette, placement, preview, theme and two-axis pan."""
    context = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    page = open_drawing(context)
    try:
        release = page.evaluate("function () { return window.__plantFactoryV64R1 || null; }")
        check("r1 Release-API", bool(release) and release.get("version") == "64_r1", str(release))
        check("R1-Funktion in kompatibler Revision sichtbar", any(label in page.title() for label in ("V64_r1", "V64_r2", "V64_r3", "V64_r4", "V64_r5", "V64_r6")), page.title())
        cards = page.locator("#plant-drawing-template-palette .plant-drawing-template-card")
        check("Mindestens 35 Inventarobjekte", cards.count() >= 35, str(cards.count()))
        check("Inventarobjekte sind draggable", page.evaluate(
            "function () { return Array.from(document.querySelectorAll('.plant-drawing-template-card')).every(function (node) { return node.draggable; }); }"
        ))
        overflow = page.evaluate(
            "function () { return Array.from(document.querySelectorAll('.plant-drawing-template-card__preview')).map(function (box) { "
            "var svg=box.querySelector('svg'); var a=box.getBoundingClientRect(); var b=svg.getBoundingClientRect(); "
            "return {inside:b.left>=a.left-1 && b.top>=a.top-1 && b.right<=a.right+1 && b.bottom<=a.bottom+1, overflow:getComputedStyle(box).overflow}; }); }"
        )
        check("Alle Inventar-SVGs passen in ihre Vorschau", all(item["inside"] for item in overflow), str(overflow))
        check("Alle Inventarvorschauen clippen", all(item["overflow"] == "hidden" for item in overflow), str(overflow))

        reactor = page.locator(".plant-drawing-template-card[data-template-id='Tubular_reactor']")
        reactor.click()
        check("Inventarauswahl aktualisiert Inspektortitel", page.locator("#plant-drawing-inspector-title").inner_text().strip() == "Vertikaler Rohrreaktor")
        check("Inventarauswahl aktualisiert Preview", page.locator("#plant-drawing-preview").get_attribute("data-preview-source") == "inventory")
        reactor_path = reactor.locator("[data-pf-state-target='process']").get_attribute("d") or ""
        check("Rohrreaktor besitzt geschlossene Prozessfläche", reactor_path.strip().endswith("Z"), reactor_path)

        canvas = page.locator("#plant-drawing-canvas")
        before_click = page.locator(".plant-drawing-entity").count()
        canvas.click(position={"x": 500, "y": 350})
        after_click = page.locator(".plant-drawing-entity").count()
        check("Klick platziert genau eine Instanz", after_click == before_click + 1, "%s -> %s" % (before_click, after_click))
        canvas.click(position={"x": 720, "y": 430})
        check("Einmal-Platzierung beendet sich", page.locator(".plant-drawing-entity").count() == after_click)
        ui_state = page.evaluate("function () { return window.PlantFactoryV64Drawing.getUiState(); }")
        check("Werkzeug kehrt zu Auswahl zurück", ui_state.get("tool") == "select", str(ui_state))

        pump = page.locator(".plant-drawing-template-card[data-template-id='Pump_liquid_type']")
        before_drop = page.locator(".plant-drawing-entity").count()
        pump.drag_to(canvas, target_position={"x": 860, "y": 510})
        page.wait_for_timeout(250)
        after_drop = page.locator(".plant-drawing-entity").count()
        check("Drag & Drop fügt genau eine Instanz ein", after_drop == before_drop + 1, "%s -> %s" % (before_drop, after_drop))
        check("Drop endet im Auswahlwerkzeug", page.evaluate("function () { return window.PlantFactoryV64Drawing.getUiState().tool; }") == "select")

        selection_fit = page.evaluate(
            "function () { var entity=document.querySelector('.plant-drawing-entity.is-selected'); var box=document.querySelector('.plant-drawing-selection-box'); "
            "if(!entity||!box)return null; var eb=entity.getBBox(); return {boxWidth:Number(box.getAttribute('width')), boxHeight:Number(box.getAttribute('height')), entityWidth:eb.width, entityHeight:eb.height}; }"
        )
        check("Auswahlrahmen folgt sichtbarem Objekt", bool(selection_fit)
              and selection_fit["boxWidth"] <= selection_fit["entityWidth"] + 12
              and selection_fit["boxHeight"] <= selection_fit["entityHeight"] + 12, str(selection_fit))

        page.locator("#plant-drawing-zoom-in").click()
        page.locator("#plant-drawing-zoom-in").click()
        before_view = canvas.get_attribute("viewBox")
        page.locator("[data-drawing-tool='pan']").click()
        canvas_box = canvas.bounding_box()
        page.mouse.move(canvas_box["x"] + 700, canvas_box["y"] + 420)
        page.mouse.down()
        page.mouse.move(canvas_box["x"] + 790, canvas_box["y"] + 500, steps=6)
        page.mouse.up()
        after_view = canvas.get_attribute("viewBox")
        check("Pan verändert horizontal und vertikal", before_view != after_view, "%s -> %s" % (before_view, after_view))
        before_values = [float(value) for value in before_view.split()]
        after_values = [float(value) for value in after_view.split()]
        check("Pan verändert beide Achsen", before_values[0] != after_values[0] and before_values[1] != after_values[1], after_view)

        theme_colors = page.evaluate(
            "function () { var root=document.documentElement; var canvas=document.getElementById('plant-drawing-canvas'); "
            "root.dataset.theme='light'; var light=getComputedStyle(canvas).backgroundColor; "
            "root.dataset.theme='dark'; root.dataset.darkPalette='blue'; var dark=getComputedStyle(canvas).backgroundColor; "
            "root.dataset.darkPalette='brown'; var brown=getComputedStyle(canvas).backgroundColor; "
            "return {light:light,dark:dark,brown:brown}; }"
        )
        check("Canvas folgt Hell/Dunkel", theme_colors["light"] != theme_colors["dark"], str(theme_colors))
        check("Canvas folgt Dunkel-Braun", theme_colors["dark"] != theme_colors["brown"], str(theme_colors))
        page.evaluate("function () { document.documentElement.dataset.theme='dark'; document.documentElement.dataset.darkPalette='brown'; }")
        SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
        screenshot_hash(page, "#plant-drawing-workspace", SCREENSHOT_DIR / "V64_r1_01_Drawing_Brown.png")
        page.evaluate("function () { document.documentElement.dataset.theme='light'; }")
        screenshot_hash(page, "#plant-drawing-workspace", SCREENSHOT_DIR / "V64_r1_02_Drawing_Light.png")
    finally:
        context.close()


def verify_reference(browser, reference_id, expected):
    """Verify one reference diagram, event coupling and pixel-identical export."""
    context = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    page = open_drawing(context)
    compare = None
    try:
        model = page.evaluate(
            "async function (referenceId) { await window.PlantFactoryV64Drawing.loadReferenceDiagram(referenceId); return window.PlantFactoryV64Drawing.getModel(); }",
            reference_id,
        )
        sheet = model["sheets"][0]
        reference = sheet.get("reference") or {}
        check(reference_id + " Referenz-ID", reference.get("id") == reference_id, str(reference))
        check(reference_id + " Top-Level-Fragmente", len(sheet["primitives"]) == expected["children"], str(len(sheet["primitives"])))
        check(reference_id + " Animationszahl", reference.get("animation_count") == expected["animations"], str(reference))
        check(reference_id + " SVG-Fragmente sichtbar", page.locator(".plant-drawing-fragment").count() == expected["children"])
        check(reference_id + " Event-Ziele gekoppelt", page.locator("[data-pf-event-target^='reference_%s_']" % reference_id).count() > 0)
        exported = page.evaluate("function () { return window.PlantFactoryV64Drawing.exportFullSvg(); }")
        exported_animations = page.evaluate(
            "function (svgText) { var doc=new DOMParser().parseFromString(svgText,'image/svg+xml'); return doc.querySelectorAll('animate,animateTransform,animateMotion,set').length; }",
            exported,
        )
        check(reference_id + " Export behält Animationen", exported_animations == expected["animations"], str(exported_animations))
        asset = reference.get("asset")
        source = page.evaluate("async function (url) { return await (await fetch(url,{cache:'no-store'})).text(); }", asset)
        compare = context.new_page()
        compare.set_viewport_size({"width": int(sheet["width"]), "height": int(sheet["height"])})
        compare.set_content("<style>html,body{margin:0;background:white}svg{display:block}</style><div id='slot'></div>")
        compare.locator("#slot").evaluate(
            "function (node, svgText) { node.innerHTML=svgText; var svg=node.querySelector('svg'); if(svg.pauseAnimations){svg.pauseAnimations();svg.setCurrentTime(0);} }",
            source,
        )
        source_png = compare.locator("#slot svg").screenshot(animations="disabled")
        compare.locator("#slot").evaluate(
            "function (node, svgText) { node.innerHTML=svgText; var svg=node.querySelector('svg'); if(svg.pauseAnimations){svg.pauseAnimations();svg.setCurrentTime(0);} }",
            exported,
        )
        export_png = compare.locator("#slot svg").screenshot(animations="disabled")
        source_hash = hashlib.sha256(source_png).hexdigest()
        export_hash = hashlib.sha256(export_png).hexdigest()
        check(reference_id + " Export pixelidentisch bei t=0", source_hash == export_hash, source_hash + " / " + export_hash)
        if reference_id == "reactor":
            SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
            page.evaluate("function () { document.documentElement.dataset.theme='light'; }")
            screenshot_hash(page, "#plant-drawing-workspace", SCREENSHOT_DIR / "V64_r1_03_Reactor_Reference.png")
    finally:
        if compare:
            compare.close()
        context.close()


def run():
    """Run the complete r1 browser and visual contract."""
    playwright = sync_playwright().start()
    browser = None
    try:
        browser = shared.launch_browser(playwright)
        verify_inventory_and_navigation(browser)
        for reference_id, expected in REFERENCE_EXPECTATIONS.items():
            verify_reference(browser, reference_id, expected)
    finally:
        if browser:
            browser.close()
        playwright.stop()
    if FAILED:
        raise AssertionError("V64_r1 browser failures: " + " | ".join(FAILURES))
    print("Plant Factory V64_r1 browser and visual contract passed: %d checks." % PASSED)


if __name__ == "__main__":
    run()