#!/usr/bin/env python3
"""Browser and visual verification for the Plant Factory V64_r3 plug-together drawing layer."""

import os
import pathlib
import sys

from playwright.sync_api import sync_playwright


TEST_DIR = pathlib.Path(__file__).resolve().parent
if str(TEST_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_DIR))

import smoke_ui as shared  # noqa: E402


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"
SCREENSHOT_DIR = pathlib.Path(os.environ.get("SMOKE_EVIDENCE_DIR", str(TEST_DIR / "screenshots")))
PASSED = 0
FAILED = 0
FAILURES = []


def check(name, condition, detail=""):
    """Record one deterministic assertion."""
    global PASSED, FAILED
    if condition:
        PASSED += 1
        return
    FAILED += 1
    FAILURES.append(name + (" — " + detail if detail else ""))


def progress(message):
    """Print one unbuffered checkpoint."""
    print("[v64-r3-smoke] " + message, flush=True)


def open_drawing(context):
    """Open one fresh application page at the drawing workspace."""
    page, status, embedded = shared.open_application(context, BASE_URL)
    page.set_default_timeout(15000)
    page.wait_for_timeout(700)
    check("HTTP 200", status == 200, str(status))
    page.locator("#workspace-plant-drawing-button").click()
    page.wait_for_selector("#plant-drawing-workspace:not([hidden])")
    page.wait_for_timeout(300)
    return page


def model(page):
    """Return the committed drawing model."""
    return page.evaluate("function () { return window.PlantFactoryV64Drawing.getModel(); }")


def ui_state(page):
    """Return the published drawing UI state."""
    return page.evaluate("function () { return window.PlantFactoryV64Drawing.getUiState(); }")


def world_to_client(page, x, y):
    """Map sheet coordinates to client pixels."""
    return page.evaluate(
        "function (p) { var svg=document.getElementById('plant-drawing-canvas'); var pt=svg.createSVGPoint(); "
        "pt.x=p[0]; pt.y=p[1]; var m=pt.matrixTransform(svg.getScreenCTM()); return [m.x, m.y]; }",
        [x, y],
    )


def entity_by_tag(sheet, tag):
    """Return one entity of the sheet by tag."""
    return next(entity for entity in sheet["entities"] if entity["tag"] == tag)


def drag(page, start, end, alt=False, steps=8):
    """Drag with the mouse between two client points."""
    if alt:
        page.keyboard.down("Alt")
    page.mouse.move(start[0], start[1])
    page.mouse.down()
    page.mouse.move(start[0] + 12, start[1] + 12, steps=3)
    page.mouse.move(end[0], end[1], steps=steps)
    page.mouse.up()
    if alt:
        page.keyboard.up("Alt")
    page.wait_for_timeout(160)


def verify_release_and_inventories(page):
    """Release API, separated inventories and drawing palette content."""
    release = page.evaluate("function () { return window.__plantFactoryV64R3 || null; }")
    check("R3 Release-API", bool(release) and release.get("version") == "64_r3" and release.get("portSnapping") is True, str(release))
    check("R1/R2-Verträge bleiben publiziert", page.evaluate(
        "function () { return Boolean(window.__plantFactoryV64R1) && Boolean(window.__plantFactoryV64R2); }"))
    check("R3 Titel oder additive Folgerevision", any(label in page.title() for label in ("V64_r3", "V64_r4", "V64_r5", "V64_r6")), page.title())
    styles = shared.loaded_styles(page)
    check("v64_r3.css geladen", "v64_r3.css" in styles, ", ".join(styles))
    cards = page.locator("#plant-drawing-template-palette .plant-drawing-template-card").count()
    check("Mindestens 35 Elementarteile im Zeichen-Inventar", cards >= 35, str(cards))
    inventory = page.evaluate("function () { return window.PlantFactoryV64Drawing.getDrawingInventory(); }")
    check("Zeichen-Inventar kennt Elemente, Baugruppen und Importe",
          len(inventory["elements"]) >= 35 and isinstance(inventory["assemblies"], list)
          and isinstance(inventory["plant_only"], list), str({k: len(v) for k, v in inventory.items()}))
    check("Inventar-Tabs vorhanden", page.locator("[data-inventory-tab='elements']").count() == 1
          and page.locator("[data-inventory-tab='assemblies']").count() == 1)
    page.locator("[data-inventory-tab='assemblies']").click()
    check("Baugruppen-Tab aktiv", ui_state(page)["inventoryTab"] == "assemblies"
          and page.locator("#plant-drawing-assembly-palette").is_visible())
    check("Elemente-Palette im Baugruppen-Tab verborgen", not page.locator("#plant-drawing-template-palette").is_visible())
    page.locator("[data-inventory-tab='elements']").click()
    check("Import-Sektion zum Anlagen-Inventar vorhanden", page.locator("#plant-drawing-import-section").is_visible()
          and page.locator("#plant-drawing-import-select").count() == 1)
    for button_id in ("plant-drawing-save-assembly", "plant-drawing-place-in-plant-parts",
                      "plant-drawing-save-inventory", "plant-drawing-use-in-plant",
                      "plant-drawing-linked-toggle", "plant-drawing-rotate", "plant-drawing-group",
                      "plant-drawing-assembly-demo"):
        check("Bedienelement vorhanden: " + button_id, page.locator("#" + button_id).count() == 1)


def verify_snapping(page):
    """Drag-to-snap, linked drag, detach, handles and rotation."""
    canvas = page.locator("#plant-drawing-canvas")
    page.locator(".plant-drawing-template-card[data-template-id='Pipe_straight']").click()
    canvas.click(position={"x": 300, "y": 300})
    page.locator(".plant-drawing-template-card[data-template-id='Flange_pair']").click()
    canvas.click(position={"x": 760, "y": 520})
    sheet = model(page)["sheets"][0]
    check("Zwei Teile platziert", len(sheet["entities"]) == 2 and not sheet["connections"])
    pipe, flange = sheet["entities"][0], sheet["entities"][1]
    hints = page.locator(".plant-drawing-port-hint").count()
    check("Freie Ports werden im Auswahlmodus angedeutet", hints == 4, str(hints))

    start = world_to_client(page, flange["x"] + 30, flange["y"] + 30)
    target = world_to_client(page, pipe["x"] + pipe["width"] + 7 + 30, pipe["y"] + 4 + 30)
    page.mouse.move(start[0], start[1])
    page.mouse.down()
    page.mouse.move(start[0] + 20, start[1] + 20, steps=3)
    page.mouse.move(target[0], target[1], steps=10)
    state = ui_state(page)
    candidate = state.get("snapCandidate")
    check("Snap-Kandidat während des Ziehens", bool(candidate) and candidate["moving_port_id"] == "inlet"
          and candidate["target_port_id"] == "outlet", str(candidate))
    check("Snap-Ziel wird visuell hervorgehoben", page.locator(".plant-drawing-port-hint.is-snap-target").count() == 1
          and page.locator(".plant-drawing-snap-label").count() == 1)
    page.mouse.up()
    page.wait_for_timeout(160)
    sheet = model(page)["sheets"][0]
    joints = [c for c in sheet["connections"] if c["joint"]]
    check("Loslassen erzeugt eine Steckverbindung", len(joints) == 1 and joints[0]["routing"] == "direct", str(sheet["connections"]))
    flange = sheet["entities"][1]
    check("Flansch sitzt exakt am Rohrende", abs(flange["x"] - (pipe["x"] + pipe["width"])) < 0.01
          and abs(flange["y"] - pipe["y"]) < 0.01, "%s/%s" % (flange["x"], flange["y"]))
    check("Joint wird als Markierung gezeichnet", page.locator(".plant-drawing-joint[data-pf-joint-state='closed']").count() == 1)
    report = page.evaluate("function () { return window.PlantFactoryV64Drawing.validate(); }")
    check("Modell nach Einrasten valide", report["valid"] and report["counts"]["joints"] == 1, str(report["counts"]))

    pipe_center = world_to_client(page, pipe["x"] + 70, pipe["y"] + 30)
    drag(page, pipe_center, (pipe_center[0] + 40, pipe_center[1] + 110))
    sheet = model(page)["sheets"][0]
    moved_pipe, moved_flange = sheet["entities"][0], sheet["entities"][1]
    check("Verbund zieht gesteckte Teile mit", moved_pipe["y"] != pipe["y"]
          and abs(moved_flange["x"] - (moved_pipe["x"] + moved_pipe["width"])) < 0.01
          and abs(moved_flange["y"] - moved_pipe["y"]) < 0.01, str((moved_pipe, moved_flange)))

    flange_center = world_to_client(page, moved_flange["x"] + 30, moved_flange["y"] + 30)
    drag(page, flange_center, (flange_center[0] + 160, flange_center[1] + 140), alt=True)
    sheet = model(page)["sheets"][0]
    check("Alt + Ziehen löst das Teil und entfernt den Joint", not sheet["connections"]
          and sheet["entities"][1]["x"] != moved_flange["x"], str(sheet["connections"]))

    pipe = sheet["entities"][0]
    page.mouse.click(*world_to_client(page, pipe["x"] + 70, pipe["y"] + 30))
    page.wait_for_timeout(120)
    check("Griffe für Einzelauswahl", page.locator(".plant-drawing-handle").count() == 9
          and page.locator(".plant-drawing-handle--rotate").count() == 1)
    handle = page.locator(".plant-drawing-handle[data-handle='e']").bounding_box()
    hx, hy = handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2
    drag(page, (hx, hy), (hx + 90, hy))
    pipe = model(page)["sheets"][0]["entities"][0]
    outlet = next(port for port in pipe["ports"] if port["id"] == "outlet")
    check("Griff streckt das Rohr und führt den Port mit", pipe["width"] > 200 and abs(outlet["x"] - pipe["width"]) < 0.01,
          "%s/%s" % (pipe["width"], outlet["x"]))
    page.keyboard.press("r")
    page.wait_for_timeout(120)
    check("R dreht um 90°", model(page)["sheets"][0]["entities"][0]["rotation"] == 90)
    page.locator("#plant-drawing-rotate").click()
    page.wait_for_timeout(120)
    check("Toolbar dreht weiter", model(page)["sheets"][0]["entities"][0]["rotation"] == 180)
    page.keyboard.press("Shift+R")
    page.wait_for_timeout(120)
    check("Shift+R dreht zurück", model(page)["sheets"][0]["entities"][0]["rotation"] == 90)


def verify_assembly_workflow(page):
    """Assembly example, component selection, saving, placing and plant transfer."""
    page.evaluate("function () { window.PlantFactoryV64Drawing.loadRohrofenAssemblyExample(); }")
    page.wait_for_timeout(350)
    report = page.evaluate("function () { return window.PlantFactoryV64Drawing.validate(); }")
    check("Zusammengesteckte Rohrofen-Anlage geladen", report["valid"] and report["counts"]["entities"] == 21
          and report["counts"]["joints"] == 17 and report["counts"]["open_joints"] == 0, str(report["counts"]))
    check("Keine offenen Joints gezeichnet", page.locator(".plant-drawing-joint[data-pf-joint-state='open']").count() == 0
          and page.locator(".plant-drawing-joint[data-pf-joint-state='closed']").count() == 17)
    sheet = model(page)["sheets"][0]
    tee = entity_by_tag(sheet, "M-101")
    center = world_to_client(page, tee["x"] + 70, tee["y"] + 30)
    page.mouse.dblclick(center[0], center[1])
    page.wait_for_timeout(200)
    selection = ui_state(page)["selection"]
    check("Doppelklick wählt den gesamten Verbund", len(selection["entity_ids"]) == 18, str(len(selection["entity_ids"])))
    check("Inspektor zeigt Mehrfachauswahl mit Baugruppenaktionen",
          "18 Komponenten" in page.locator("#plant-drawing-properties").inner_text())

    page.locator("#plant-drawing-inventory-name").fill("Rohrofen-Strang R3")
    page.locator("#plant-drawing-save-assembly").click()
    page.wait_for_function(
        "function () { return window.PlantFactoryV64Drawing.getAssemblyTemplates().some(function (t) { return t.name === 'Rohrofen-Strang R3'; }); }",
        timeout=10000,
    )
    templates = page.evaluate("function () { return window.PlantFactoryV64Drawing.getAssemblyTemplates(); }")
    saved = next(t for t in templates if t["name"] == "Rohrofen-Strang R3")
    check("Baugruppe bewahrt Teile, Joints und freie Ports", len(saved["entities"]) == 18
          and len(saved["connections"]) == 17 and len(saved["exposed_ports"]) >= 8, str((len(saved["entities"]), len(saved["connections"]), len(saved["exposed_ports"]))))
    check("Baugruppe in der Bibliothek gespeichert", saved["scope"] == "library")
    check("Baugruppen-Tab zeigt die Baugruppe", ui_state(page)["inventoryTab"] == "assemblies"
          and page.locator("#plant-drawing-assembly-palette .plant-drawing-assembly-card").count() >= 1)
    card = page.locator("#plant-drawing-assembly-palette .plant-drawing-assembly-card[data-assembly-template-id='%s']" % saved["assembly_template_id"])
    check("Baugruppenkarte mit Vorschau", card.count() == 1 and card.locator("svg g[data-pf-entity-id]").count() == 18)
    preview_fit = page.evaluate(
        "function (id) { var card=document.querySelector(\".plant-drawing-assembly-card[data-assembly-template-id='\" + id + \"']\"); "
        "var box=card.querySelector('.plant-drawing-template-card__preview'); var svg=box.querySelector('svg'); "
        "var a=box.getBoundingClientRect(); var b=svg.getBoundingClientRect(); "
        "return b.left>=a.left-1 && b.top>=a.top-1 && b.right<=a.right+1 && b.bottom<=a.bottom+1; }",
        saved["assembly_template_id"],
    )
    check("Baugruppenvorschau passt in ihre Karte", preview_fit)

    page.evaluate("function () { window.PlantFactoryV64Drawing.setSelection({}); }")
    before = len(model(page)["sheets"][0]["entities"])
    canvas = page.locator("#plant-drawing-canvas")
    card.drag_to(canvas, target_position={"x": 520, "y": 700})
    page.wait_for_timeout(300)
    sheet = model(page)["sheets"][0]
    placed = [e for e in sheet["entities"] if e["assembly_template_id"] == saved["assembly_template_id"]]
    check("Drag & Drop platziert die Baugruppe als Einzelteile", len(sheet["entities"]) == before + 18 and len(placed) == 18,
          "%s -> %s" % (before, len(sheet["entities"])))
    check("Platzierte Teile teilen eine Baugruppen-ID und bleiben eigene Entities",
          len({e["assembly_id"] for e in placed}) == 1 and len({e["entity_id"] for e in placed}) == 18)
    report = page.evaluate("function () { return window.PlantFactoryV64Drawing.validate(); }")
    check("Modell nach Platzierung valide", report["valid"] and report["counts"]["joints"] == 34, str(report["counts"]))
    part = placed[0]
    page.evaluate("function (id) { window.PlantFactoryV64Drawing.setSelection({entity_ids: [id]}); }", part["entity_id"])
    page.wait_for_timeout(120)
    inspector = page.locator("#plant-drawing-properties").inner_text()
    check("Einzelteil einer Baugruppe bleibt konfigurierbar", page.locator("#drawing-name").is_visible()
          and "Baugruppe" in inspector and "Aus Baugruppe lösen" in inspector)
    page.locator("#drawing-tag").fill("XX-999")
    page.get_by_role("button", name="Eigenschaften übernehmen").click()
    page.wait_for_timeout(150)
    updated = next(e for e in model(page)["sheets"][0]["entities"] if e["entity_id"] == part["entity_id"])
    check("Tag eines Baugruppenteils wird einzeln gespeichert", updated["tag"] == "XX-999")

    page.evaluate("function (id) { window.PlantFactoryV64Drawing.selectComponent(id); }", tee["entity_id"])
    result = page.evaluate("function () { return window.PlantFactoryV64Drawing.placeSelectionInPlant(); }")
    page.wait_for_timeout(500)
    plant_elements = page.locator("#elements-layer g.svg-element").count()
    plant_connections = page.locator("#connections-layer .connection-line").count()
    check("Verbund als Einzelobjekte ins Anlagenbild übernommen", bool(result) and len(result["elements"]) == 18
          and plant_elements >= 18, "%s / %s" % (result, plant_elements))
    check("Gesteckte Verbindungen werden zu Anlagenverbindungen", bool(result) and result["connections"] == 17
          and plant_connections >= 17, "%s / %s" % (result, plant_connections))
    check("Anlagenbild ist nach der Übernahme aktiv", page.locator("#plant-drawing-workspace").is_hidden())
    tags = page.evaluate(
        "function () { return Array.from(document.querySelectorAll('#elements-layer g.svg-element')).map(function (n) { return n.getAttribute('data-entity-tag'); }); }"
    )
    check("Tags der Einzelteile bleiben im Anlagenbild erhalten", "M-101" in tags and "H-101" in tags, ", ".join(tags))

    removed = page.evaluate(
        "async function (id) { var response = await fetch('/api/drawing-assemblies/loeschen', {method: 'POST', "
        "headers: {'Content-Type': 'application/json'}, body: JSON.stringify({assembly_template_id: id})}); "
        "var payload = await response.json(); var listing = await (await fetch('/api/drawing-assemblies')).json(); "
        "return {entfernt: payload.entfernt, remaining: listing.assemblies.filter(function (a) { return a.assembly_template_id === id; }).length}; }",
        saved["assembly_template_id"],
    )
    check("Testbaugruppe wird wieder aus der Bibliothek entfernt", removed.get("entfernt") is True and removed.get("remaining") == 0, str(removed))


def verify_visuals(browser):
    """Light and dark screenshots of the assembled plant."""
    context = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    page = open_drawing(context)
    try:
        page.evaluate("function () { window.PlantFactoryV64Drawing.loadRohrofenAssemblyExample(); }")
        page.wait_for_timeout(350)
        SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
        page.evaluate("function () { document.documentElement.dataset.theme='light'; }")
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r3_01_Assembly_Light.png"), animations="disabled")
        page.evaluate("function () { document.documentElement.dataset.theme='dark'; document.documentElement.dataset.darkPalette='blue'; }")
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r3_02_Assembly_Dark.png"), animations="disabled")
        page.evaluate("function () { document.documentElement.dataset.darkPalette='brown'; }")
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r3_03_Assembly_Brown.png"), animations="disabled")
        page.locator("[data-inventory-tab='assemblies']").click()
        page.evaluate("function () { document.documentElement.dataset.theme='light'; }")
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r3_04_Assembly_Inventory.png"), animations="disabled")
        check("Keine Konsolenfehler", not shared.console_errors, " | ".join(shared.console_errors[:3]))
        check("Keine Seitenfehler", not shared.page_errors, " | ".join(shared.page_errors[:3]))
    finally:
        context.close()


def run():
    """Run the complete r3 browser and visual contract."""
    playwright = sync_playwright().start()
    browser = None
    try:
        browser = shared.launch_browser(playwright)
        context = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page = open_drawing(context)
        try:
            progress("Release und getrennte Inventare prüfen")
            verify_release_and_inventories(page)
            progress("Einrasten, Verbund, Griffe und Drehung prüfen")
            verify_snapping(page)
            progress("Baugruppen-Workflow und Übernahme ins Anlagenbild prüfen")
            verify_assembly_workflow(page)
        finally:
            context.close()
        progress("Visuelle Nachweise erzeugen")
        verify_visuals(browser)
    finally:
        if browser:
            browser.close()
        playwright.stop()
    if FAILED:
        raise AssertionError("V64_r3 browser failures: " + " | ".join(FAILURES))
    print("Plant Factory V64_r3 browser and visual contract passed: %d checks." % PASSED)


if __name__ == "__main__":
    run()
