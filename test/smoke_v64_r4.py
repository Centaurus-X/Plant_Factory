#!/usr/bin/env python3
"""Browser and visual verification for the Plant Factory V64_r4 drawing layer.

Covers the r4 contract: stretchable linear parts, mirroring and flow inversion,
the growing sheet, inspector tabs, the context menu, Ctrl navigation, the new
elementary parts and a complete from-scratch construction of the tube furnace
rig through real pointer gestures (place near port, rotate, drag to snap).
"""

import math
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright


TEST_DIR = pathlib.Path(__file__).resolve().parent
PROJECT_ROOT = TEST_DIR.parent
if str(TEST_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_DIR))

import smoke_ui as shared  # noqa: E402


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"
SCREENSHOT_DIR = pathlib.Path(os.environ.get("SMOKE_EVIDENCE_DIR", str(TEST_DIR / "screenshots")))
CUSTOM_DIR = PROJECT_ROOT / "public" / "svg_templates" / "custom"
SMOKE_ENTITY_NAME = "V64 r4 Smoke Entity"
SMOKE_ENTITY_ID = "V64_r4_Smoke_Entity"
SMOKE_ASSEMBLY_NAME = "Rohrofen-Strang R4"
NEW_PARTS = ("Swagelok_union", "Swagelok_tee", "Swagelok_elbow", "Capillary_line",
             "Pipe_cap", "Boundary_connector", "Gas_mixer")
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
    print("[v64-r4-smoke] " + message, flush=True)


def open_drawing(context):
    """Open one fresh application page at the drawing workspace."""
    page, status, embedded = shared.open_application(context, BASE_URL)
    page.set_default_timeout(15000)
    page.wait_for_timeout(700)
    check("HTTP 200", status == 200, str(status))
    page.locator("#workspace-plant-drawing-button").click()
    page.wait_for_selector("#plant-drawing-workspace:not([hidden])")
    page.wait_for_timeout(350)
    return page


def model(page):
    """Return the committed drawing model."""
    return page.evaluate("function () { return window.PlantFactoryV64Drawing.getModel(); }")


def sheet_of(page):
    """Return the active sheet."""
    return page.evaluate("function () { return window.PlantFactoryV64Drawing.getSheet(); }")


def ui_state(page):
    """Return the published drawing UI state."""
    return page.evaluate("function () { return window.PlantFactoryV64Drawing.getUiState(); }")


def validate(page):
    """Return the validation report."""
    return page.evaluate("function () { return window.PlantFactoryV64Drawing.validate(); }")


def world_to_client(page, x, y):
    """Map sheet coordinates to client pixels."""
    return page.evaluate(
        "function (p) { var svg=document.getElementById('plant-drawing-canvas'); var pt=svg.createSVGPoint(); "
        "pt.x=p[0]; pt.y=p[1]; var m=pt.matrixTransform(svg.getScreenCTM()); return [m.x, m.y]; }",
        [x, y],
    )


def port_world(entity, port_id):
    """Replicate plantPortWorldPoint for one stored entity port."""
    port = next(p for p in entity["ports"] if p["id"] == port_id)
    cx = entity["width"] / 2
    cy = entity["height"] / 2
    radians = entity["rotation"] * math.pi / 180
    dx = port["x"] - cx
    dy = port["y"] - cy
    return (entity["x"] + cx + dx * math.cos(radians) - dy * math.sin(radians),
            entity["y"] + cy + dx * math.sin(radians) + dy * math.cos(radians))


def entity_by_template(sheet, template_id, index=-1):
    """Return the n-th entity of a template (default: last placed)."""
    items = [e for e in sheet["entities"] if e["template_id"] == template_id]
    return items[index]


def click_world(page, x, y, **kwargs):
    """Click at one sheet coordinate."""
    point = world_to_client(page, x, y)
    page.mouse.click(point[0], point[1], **kwargs)
    page.wait_for_timeout(140)


def drag_world(page, start, end, alt=False, steps=10):
    """Drag between two sheet coordinates with the mouse."""
    a = world_to_client(page, start[0], start[1])
    b = world_to_client(page, end[0], end[1])
    if alt:
        page.keyboard.down("Alt")
    page.mouse.move(a[0], a[1])
    page.mouse.down()
    page.mouse.move(a[0] + 10, a[1] + 10, steps=3)
    page.mouse.move(b[0], b[1], steps=steps)
    page.mouse.up()
    if alt:
        page.keyboard.up("Alt")
    page.wait_for_timeout(170)


def place(page, template_id, x, y):
    """Place one inventory part centred at a sheet coordinate (click workflow)."""
    page.locator(".plant-drawing-template-card[data-template-id='%s']" % template_id).click()
    click_world(page, x, y)
    return entity_by_template(sheet_of(page), template_id)


def joint_count(sheet):
    """Return the number of plugged joints."""
    return len([c for c in sheet["connections"] if c["joint"]])


# ---------------------------------------------------------------------------
# Contract sections
# ---------------------------------------------------------------------------

def verify_release(page):
    """Release markers, stylesheets and the extended inventory."""
    release = page.evaluate("function () { return window.__plantFactoryV64R4 || null; }")
    check("R4 Release-API", bool(release) and release.get("version") == "64_r4"
          and release.get("stretchProfiles") is True and release.get("mirroring") is True, str(release))
    check("R1/R2/R3-Verträge bleiben publiziert", page.evaluate(
        "function () { return Boolean(window.__plantFactoryV64R1) && Boolean(window.__plantFactoryV64R2) && Boolean(window.__plantFactoryV64R3); }"))
    check("R4 Titel oder additive Folgerevision", any(label in page.title() for label in ("V64_r4", "V64_r5", "V64_r6")), page.title())
    check("App-Version 64_r4 oder additive Folgerevision", page.evaluate("function () { return window.__appVersion; }") in ("64_r4", "64_r5", "64_r6"))
    styles = shared.loaded_styles(page)
    check("v64_r4.css geladen", "v64_r4.css" in styles and "v64_r3.css" in styles, ", ".join(styles))
    cards = page.locator("#plant-drawing-template-palette .plant-drawing-template-card").count()
    check("Mindestens 42 Elementarteile im Zeichen-Inventar", cards >= 42, str(cards))
    for template_id in NEW_PARTS:
        check("Neues Bauteil im Inventar: " + template_id,
              page.locator(".plant-drawing-template-card[data-template-id='%s']" % template_id).count() == 1)
    stretch = page.evaluate(
        "async function () { var payload = await (await fetch('/api/templates')).json(); "
        "return ['Pipe_straight', 'Pipe_tee', 'Capillary_line', 'Jacked_pipeline'].filter(function (id) { "
        "return payload.templates[id] && payload.templates[id].stretch && payload.templates[id].stretch.axis === 'x'; }); }")
    check("Streckbare Rohrteile tragen ein Streckprofil", len(stretch) == 4, str(stretch))
    view = ui_state(page)
    check("Ansicht ist auf das Blatt eingepasst", view["zoom"] == 1 and view["viewScale"] > 0.3, str(view["viewScale"]))
    grid = page.evaluate(
        "function () { var svg=document.getElementById('plant-drawing-canvas'); var vb=svg.viewBox.baseVal; "
        "var g=document.getElementById('plant-drawing-grid-background'); return Number(g.getAttribute('x'))<=vb.x "
        "&& Number(g.getAttribute('y'))<=vb.y && Number(g.getAttribute('x'))+Number(g.getAttribute('width'))>=vb.x+vb.width; }")
    check("Raster deckt die gesamte Ansicht", grid)
    check("Blattrahmen vorhanden", page.locator("#plant-drawing-sheet-frame").count() == 1)


def verify_geometry(page):
    """Stretch, mirror, inversion, scale modes and the growing sheet."""
    pipe = place(page, "Pipe_straight", 600, 500)
    check("Rohr wird im Streckmodus platziert", pipe["scale_mode"] == "stretch" and bool(pipe["stretch"]), str(pipe["scale_mode"]))
    handle = page.locator(".plant-drawing-handle[data-handle='e']").bounding_box()
    hx, hy = handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2
    page.mouse.move(hx, hy)
    page.mouse.down()
    page.mouse.move(hx + 10, hy, steps=2)
    page.mouse.move(hx + 180, hy, steps=8)
    page.mouse.up()
    page.wait_for_timeout(170)
    pipe = entity_by_template(sheet_of(page), "Pipe_straight")
    outlet = next(p for p in pipe["ports"] if p["id"] == "outlet")
    check("Griff verlängert das Rohr", pipe["width"] > 300 and pipe["height"] == 60, str((pipe["width"], pipe["height"])))
    segments = page.locator("#plant-drawing-entities-layer [data-entity-id='%s'] svg[data-pf-stretch-segment]" % pipe["entity_id"]).count()
    check("Gestrecktes Rohr wird aus festen und flexiblen Segmenten gezeichnet", segments == 5, str(segments))
    check("Port folgt dem gestreckten Ende", abs(outlet["x"] - pipe["width"]) < 0.01, str(outlet))
    graphic = page.evaluate(
        "function (id) { var node=document.querySelector(\"#plant-drawing-entities-layer [data-entity-id='\" + id + \"']\"); "
        "var segs=Array.from(node.querySelectorAll('svg[data-pf-stretch-segment]')); var last=segs[segs.length-1]; "
        "return {caps: segs.filter(function (s) { return s.getAttribute('data-pf-stretch-segment')==='fixed'; }).map(function (s) { return Number(s.getAttribute('width')); }), "
        "end: Number(last.getAttribute('x')) + Number(last.getAttribute('width'))}; }", pipe["entity_id"])
    check("Endkappen und Pfeil behalten ihre Größe", graphic["caps"] == [12, 22, 12], str(graphic["caps"]))
    check("Grafik füllt die gesamte Länge", abs(graphic["end"] - pipe["width"]) < 0.01, str(graphic))

    page.keyboard.press("i")
    page.wait_for_timeout(150)
    inverted = entity_by_template(sheet_of(page), "Pipe_straight")
    directions = {p["id"]: p["direction"] for p in inverted["ports"]}
    check("I invertiert die Flussrichtung", inverted["inverted"] is True and directions == {"inlet": "out", "outlet": "in"}, str(directions))
    arrows = page.evaluate(
        "function () { return Array.from(document.querySelectorAll(\"#plant-drawing-entities-layer [data-pf-role='flow-arrow']\")).map(function (n) { return n.getAttribute('transform') || ''; }); }")
    check("Pfeile werden um 180° gedreht", bool(arrows) and all("rotate(180" in a for a in arrows), str(arrows))
    page.keyboard.press("f")
    page.wait_for_timeout(150)
    flipped = entity_by_template(sheet_of(page), "Pipe_straight")
    ports = {p["id"]: p["x"] for p in flipped["ports"]}
    check("F spiegelt horizontal und führt die Ports mit", flipped["flip_x"] is True and ports["inlet"] == flipped["width"] and ports["outlet"] == 0, str(ports))
    check("Spiegelung wird als Transformation gezeichnet", page.locator(
        "#plant-drawing-entities-layer [data-entity-id='%s'] .plant-drawing-entity-graphic[transform*='scale(-1 1)']" % flipped["entity_id"]).count() == 1)
    page.keyboard.press("Shift+F")
    page.wait_for_timeout(150)
    flipped = entity_by_template(sheet_of(page), "Pipe_straight")
    check("Umschalt+F spiegelt vertikal", flipped["flip_y"] is True)
    page.keyboard.press("f")
    page.keyboard.press("Shift+F")
    page.keyboard.press("i")
    page.wait_for_timeout(150)
    restored = entity_by_template(sheet_of(page), "Pipe_straight")
    check("Spiegelung und Inversion sind reversibel", not restored["flip_x"] and not restored["flip_y"] and not restored["inverted"]
          and {p["id"]: p["direction"] for p in restored["ports"]} == {"inlet": "in", "outlet": "out"})

    furnace = place(page, "Tube_furnace", 900, 500)
    check("Gerät wird proportional skaliert", furnace["scale_mode"] == "uniform")
    handle = page.locator(".plant-drawing-handle[data-handle='e']").bounding_box()
    hx, hy = handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2
    page.mouse.move(hx, hy)
    page.mouse.down()
    page.mouse.move(hx + 10, hy, steps=2)
    page.mouse.move(hx + 80, hy, steps=6)
    page.mouse.up()
    page.wait_for_timeout(170)
    furnace = entity_by_template(sheet_of(page), "Tube_furnace")
    ratio = furnace["width"] / furnace["height"]
    check("Proportionale Skalierung hält das Seitenverhältnis", abs(ratio - 160 / 220) < 0.01 and furnace["width"] > 160, str((furnace["width"], furnace["height"])))
    inlet = next(p for p in furnace["ports"] if p["id"] == "process_in")
    check("Ports bleiben auf dem skalierten Symbol", abs(inlet["x"] - furnace["width"] / 2) < 0.01 and inlet["y"] == 0, str(inlet))

    sheet = sheet_of(page)
    before = (sheet["width"], sheet["height"])
    page.locator(".plant-drawing-template-card[data-template-id='Gas_bottle']").click()
    page.mouse.click(*world_to_client(page, 30, 40))
    page.wait_for_timeout(220)
    sheet = sheet_of(page)
    bottle = entity_by_template(sheet, "Gas_bottle")
    check("Teil am Blattrand verschiebt den Inhalt in den Blattrand", bottle["x"] >= 80 and bottle["y"] >= 80, str((bottle["x"], bottle["y"])))
    moved = entity_by_template(sheet, "Tube_furnace")
    check("Relative Lage aller Teile bleibt erhalten", abs((moved["x"] - bottle["x"]) - (furnace["x"] - (30 - 35))) < 12, str((moved["x"], bottle["x"])))
    check("Blatt bleibt mindestens so groß wie zuvor", sheet["width"] >= before[0] and sheet["height"] >= before[1])
    page.locator(".plant-drawing-template-card[data-template-id='Pressure_indicator']").click()
    page.mouse.click(*world_to_client(page, sheet["width"] - 12, sheet["height"] - 12))
    page.wait_for_timeout(220)
    grown = sheet_of(page)
    check("Blatt wächst dynamisch mit der Konstruktion", grown["width"] > sheet["width"] and grown["height"] > sheet["height"],
          str((sheet["width"], sheet["height"], grown["width"], grown["height"])))
    frame = page.evaluate("function () { var f=document.getElementById('plant-drawing-sheet-frame'); return [Number(f.getAttribute('width')), Number(f.getAttribute('height'))]; }")
    check("Blattrahmen folgt der Blattgröße", frame == [grown["width"], grown["height"]], str(frame))


def verify_inspector_and_menu(page):
    """Inspector tabs, context menu and Ctrl navigation."""
    page.evaluate("function () { window.PlantFactoryV64Drawing.setSelection({}); }")
    page.wait_for_timeout(100)
    tabs = page.locator(".plant-drawing-inspector-tab").all_inner_texts()
    check("Inspektor ohne Auswahl zeigt Objekt und Blatt", tabs == ["Objekt", "Blatt"], str(tabs))
    page.locator(".plant-drawing-inspector-tab[data-inspector-tab='sheet']").click()
    page.wait_for_timeout(100)
    check("Blatt-Tab mit Breite, Höhe, Raster und Auto-Wachstum", page.locator("#drawing-sheet-width").count() == 1
          and page.locator("#drawing-sheet-grid").count() == 1 and page.locator("#drawing-sheet-autogrow").is_checked())
    page.locator("#drawing-sheet-width").fill("2400")
    page.get_by_role("button", name="Blatt übernehmen").click()
    page.wait_for_timeout(150)
    check("Blattbreite aus dem Inspektor übernommen", sheet_of(page)["width"] == 2400, str(sheet_of(page)["width"]))

    sheet = sheet_of(page)
    pipe = entity_by_template(sheet, "Pipe_straight")
    click_world(page, pipe["x"] + pipe["width"] / 2, pipe["y"] + 30)
    tabs = page.locator(".plant-drawing-inspector-tab").all_inner_texts()
    check("Inspektor mit Teil zeigt vier Register", tabs == ["Objekt", "Ports", "Eigenschaften", "Blatt"], str(tabs))
    page.locator(".plant-drawing-inspector-tab[data-inspector-tab='part']").click()
    page.wait_for_timeout(100)
    labels = page.locator("#plant-drawing-properties .form-group span").all_inner_texts()
    check("Rohr zeigt Länge statt Breite", "Länge" in labels and "Höhe" in labels, ", ".join(labels))
    check("Spiegel- und Invertier-Optionen vorhanden", page.locator("#drawing-flip-x").count() == 1
          and page.locator("#drawing-flip-y").count() == 1 and page.locator("#drawing-inverted").count() == 1
          and page.locator("#drawing-scale-mode").count() == 1)
    page.locator("#drawing-width").fill("300")
    page.locator("#drawing-inverted").check()
    page.locator("#drawing-flip-y").check()
    page.get_by_role("button", name="Eigenschaften übernehmen").click()
    page.wait_for_timeout(170)
    pipe = entity_by_template(sheet_of(page), "Pipe_straight")
    check("Länge, Invertierung und Spiegelung aus dem Inspektor übernommen",
          pipe["width"] == 300 and pipe["inverted"] is True and pipe["flip_y"] is True, str((pipe["width"], pipe["inverted"], pipe["flip_y"])))
    page.locator("#drawing-inverted").uncheck()
    page.locator("#drawing-flip-y").uncheck()
    page.get_by_role("button", name="Eigenschaften übernehmen").click()
    page.wait_for_timeout(150)

    page.locator(".plant-drawing-inspector-tab[data-inspector-tab='ports']").click()
    page.wait_for_timeout(100)
    rows = page.locator(".plant-drawing-port-table tr").count()
    check("Ports-Register listet alle semantischen Ports", rows == 3, str(rows))
    check("Portstatus frei/gesteckt sichtbar", page.locator(".plant-drawing-port-status.is-free").count() == 2)
    page.locator(".plant-drawing-inspector-tab[data-inspector-tab='properties']").click()
    page.wait_for_timeout(100)
    page.get_by_role("button", name="Eigenschaft hinzufügen").click()
    row = page.locator(".plant-drawing-property-row").last
    row.locator("input").nth(0).fill("dn")
    row.locator("input").nth(1).fill("6")
    page.get_by_role("button", name="Eigenschaften übernehmen").click()
    page.wait_for_timeout(150)
    pipe = entity_by_template(sheet_of(page), "Pipe_straight")
    check("Eigenschaften-Register speichert Schlüssel/Wert-Paare", pipe["properties"].get("dn") == 6, str(pipe["properties"]))

    page.locator(".plant-drawing-inspector-tab[data-inspector-tab='part']").click()
    point = world_to_client(page, pipe["x"] + pipe["width"] / 2, pipe["y"] + 30)
    page.mouse.click(point[0], point[1], button="right")
    page.wait_for_timeout(160)
    menu = page.locator("#plant-drawing-context-menu")
    items = menu.locator("button").all_inner_texts()
    check("Rechtsklick öffnet das Kontextmenü", menu.is_visible() and ui_state(page)["contextMenuOpen"] is True)
    check("Kontextmenü bietet Drehen, Spiegeln, Invertieren, Duplizieren und Löschen",
          any("Drehen 90°" in i for i in items) and any("Spiegeln horizontal" in i for i in items)
          and any("Flussrichtung invertieren" in i for i in items) and any("Duplizieren" in i for i in items)
          and any("Löschen" in i for i in items), " | ".join(items))
    rotation_before = pipe["rotation"]
    menu.get_by_role("menuitem", name="Drehen 90°").click()
    page.wait_for_timeout(170)
    pipe = entity_by_template(sheet_of(page), "Pipe_straight")
    check("Kontextmenü-Aktion wird ausgeführt und Menü geschlossen", pipe["rotation"] == (rotation_before + 90) % 360
          and menu.is_hidden(), str(pipe["rotation"]))
    empty = world_to_client(page, 1500, 120)
    page.mouse.click(empty[0], empty[1], button="right")
    page.wait_for_timeout(160)
    items = menu.locator("button").all_inner_texts()
    check("Kontextmenü der Zeichenfläche", any("Alles auswählen" in i for i in items) and any("Blatt an Inhalt anpassen" in i for i in items), " | ".join(items))
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    check("Escape schließt das Kontextmenü", menu.is_hidden())

    before = ui_state(page)["pan"]
    start = world_to_client(page, 1400, 300)
    page.keyboard.down("Control")
    page.mouse.move(start[0], start[1])
    page.mouse.down()
    page.mouse.move(start[0] + 30, start[1] + 30, steps=3)
    page.mouse.move(start[0] + 220, start[1] + 160, steps=8)
    page.mouse.up()
    page.keyboard.up("Control")
    page.wait_for_timeout(120)
    after = ui_state(page)["pan"]
    check("Strg + Ziehen verschiebt die Ansicht horizontal und vertikal", after["x"] < before["x"] - 50 and after["y"] < before["y"] - 50, str((before, after)))
    pipe = entity_by_template(sheet_of(page), "Pipe_straight")
    center = world_to_client(page, pipe["x"] + pipe["width"] / 2, pipe["y"] + pipe["height"] / 2)
    page.evaluate("function () { window.PlantFactoryV64Drawing.setSelection({}); }")
    page.keyboard.down("Control")
    page.mouse.click(center[0], center[1])
    page.keyboard.up("Control")
    page.wait_for_timeout(120)
    check("Strg + Klick ohne Bewegung schaltet die Auswahl um", ui_state(page)["selection"]["entity_ids"] == [pipe["entity_id"]],
          str(ui_state(page)["selection"]))
    page.keyboard.press("Control+ArrowRight")
    page.wait_for_timeout(80)
    check("Strg + Pfeil verschiebt die Ansicht", ui_state(page)["pan"]["x"] > after["x"], str(ui_state(page)["pan"]))
    page.evaluate("function () { window.PlantFactoryV64Drawing.resetView(); }")
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_timeout(150)
    check("Zeichenfläche für den Neubau geleert", not sheet_of(page)["entities"])


def verify_scratch_build(page):
    """Build the tube furnace feed and reactor string from scratch with pointer gestures."""
    page.evaluate("function () { window.PlantFactoryV64Drawing.resetView(); }")
    flag = place(page, "Boundary_connector", 260, 320)
    page.keyboard.press("f")
    page.wait_for_timeout(150)
    flag = entity_by_template(sheet_of(page), "Boundary_connector")
    port = port_world(flag, "line")
    check("Grenzstelle gespiegelt: Port liegt rechts", flag["flip_x"] is True and abs(port[0] - (flag["x"] + 100)) < 0.01, str(port))
    page.locator("#drawing-tag").fill("N₂")
    page.get_by_role("button", name="Eigenschaften übernehmen").click()
    page.wait_for_timeout(150)
    label = page.locator("#plant-drawing-entities-layer [data-entity-id='%s'] [data-pf-role='entity-label']" % flag["entity_id"]).text_content()
    check("Grenzstelle zeigt den Tag als Beschriftung", label == "N₂", label)

    capillary = place(page, "Capillary_line", port[0] + 70 + 4, port[1] + 3)
    sheet = sheet_of(page)
    check("Kapillare rastet beim Ablegen an der Grenzstelle ein", joint_count(sheet) == 1
          and abs(port_world(capillary, "inlet")[0] - port[0]) < 0.01, str(joint_count(sheet)))
    out = port_world(capillary, "outlet")
    valve = place(page, "Valve_(general)", out[0] + 40 + 4, out[1] + 2)
    out = port_world(valve, "outlet")
    union = place(page, "Swagelok_union", out[0] + 30 + 3, out[1] - 2)
    out = port_world(union, "outlet")
    mixer = place(page, "Gas_mixer", out[0] + 60 + 3, out[1] - 24 + 40 + 2)
    sheet = sheet_of(page)
    check("Ventil, Swagelok und Gasmischer sind nacheinander gesteckt", joint_count(sheet) == 4
          and abs(port_world(mixer, "inlet_a")[0] - out[0]) < 0.01 and abs(port_world(mixer, "inlet_a")[1] - out[1]) < 0.01,
          str((joint_count(sheet), port_world(mixer, "inlet_a"), out)))

    # Vertical reactor string: place free, rotate with R, drag onto the port (snap while dragging).
    outlet = port_world(mixer, "outlet")
    union2 = place(page, "Swagelok_union", 900, 700)
    page.keyboard.press("r")
    page.wait_for_timeout(150)
    union2 = entity_by_template(sheet_of(page), "Swagelok_union")
    drag_world(page, (union2["x"] + 30, union2["y"] + 30), (outlet[0], outlet[1] + 30 + 2))
    union2 = entity_by_template(sheet_of(page), "Swagelok_union")
    check("Gedrehte Swagelok-Verschraubung rastet am Mischerausgang ein", union2["rotation"] == 90
          and abs(port_world(union2, "inlet")[0] - outlet[0]) < 0.01 and abs(port_world(union2, "inlet")[1] - outlet[1]) < 0.01,
          str((union2["rotation"], port_world(union2, "inlet"), outlet)))
    outlet = port_world(union2, "outlet")
    pipe = place(page, "Pipe_straight", 1000, 700)
    page.keyboard.press("r")
    page.wait_for_timeout(150)
    pipe = entity_by_template(sheet_of(page), "Pipe_straight")
    drag_world(page, (pipe["x"] + 70, pipe["y"] + 30), (outlet[0] + 1, outlet[1] + 70 + 2))
    pipe = entity_by_template(sheet_of(page), "Pipe_straight")
    check("Senkrechtes Rohr rastet ein", abs(port_world(pipe, "inlet")[0] - outlet[0]) < 0.01 and abs(port_world(pipe, "inlet")[1] - outlet[1]) < 0.01,
          str((port_world(pipe, "inlet"), outlet)))
    outlet = port_world(pipe, "outlet")
    flange = place(page, "Flange_pair", 1100, 700)
    page.keyboard.press("r")
    page.wait_for_timeout(150)
    flange = entity_by_template(sheet_of(page), "Flange_pair")
    drag_world(page, (flange["x"] + 30, flange["y"] + 30), (outlet[0] - 1, outlet[1] + 30 + 3))
    flange = entity_by_template(sheet_of(page), "Flange_pair")
    outlet = port_world(flange, "outlet")
    furnace = place(page, "Tube_furnace", outlet[0] + 2, outlet[1] + 110 + 3)
    sheet = sheet_of(page)
    report = validate(page)
    check("Rohrofen-Strang von Grund auf gesteckt: 9 Teile, 8 Joints, keine offenen Joints",
          len(sheet["entities"]) == 9 and joint_count(sheet) == 8 and report["counts"]["open_joints"] == 0 and report["valid"],
          str((len(sheet["entities"]), joint_count(sheet), report["counts"])))
    check("Ofeneingang sitzt exakt auf dem Flansch", abs(port_world(furnace, "process_in")[0] - outlet[0]) < 0.01
          and abs(port_world(furnace, "process_in")[1] - outlet[1]) < 0.01, str((port_world(furnace, "process_in"), outlet)))

    center = world_to_client(page, mixer["x"] + 60, mixer["y"] + 40)
    page.mouse.dblclick(center[0], center[1])
    page.wait_for_timeout(200)
    check("Doppelklick wählt den kompletten Neubau", len(ui_state(page)["selection"]["entity_ids"]) == 9,
          str(len(ui_state(page)["selection"]["entity_ids"])))
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    page.evaluate("function () { document.documentElement.dataset.theme='light'; }")
    page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r4_01_Scratch_Build_Light.png"), animations="disabled")

    page.locator("#plant-drawing-inventory-name").fill(SMOKE_ASSEMBLY_NAME)
    page.locator("#plant-drawing-save-assembly").click()
    page.wait_for_function(
        "function (name) { return window.PlantFactoryV64Drawing.getAssemblyTemplates().some(function (t) { return t.name === name; }); }",
        arg=SMOKE_ASSEMBLY_NAME, timeout=10000)
    saved = next(t for t in page.evaluate("function () { return window.PlantFactoryV64Drawing.getAssemblyTemplates(); }")
                 if t["name"] == SMOKE_ASSEMBLY_NAME)
    check("Neubau als Baugruppe mit Geometrieflags gespeichert", len(saved["entities"]) == 9 and len(saved["connections"]) == 8
          and any(e["flip_x"] for e in saved["entities"]) and any(e["scale_mode"] == "stretch" for e in saved["entities"]),
          str((len(saved["entities"]), len(saved["connections"]))))
    stored = page.evaluate(
        "async function (id) { var listing = await (await fetch('/api/drawing-assemblies')).json(); "
        "var item = listing.assemblies.find(function (a) { return a.assembly_template_id === id; }); "
        "return item ? item.entities.map(function (e) { return [e.template_id, e.flip_x, e.scale_mode, Array.isArray(e.view_box)]; }) : null; }",
        saved["assembly_template_id"])
    check("Bibliothek persistiert Spiegelung, Skalierungsmodus und viewBox",
          bool(stored) and any(s[1] for s in stored) and all(s[3] for s in stored) and any(s[2] == "stretch" for s in stored), str(stored))
    removed = page.evaluate(
        "async function (id) { var response = await fetch('/api/drawing-assemblies/loeschen', {method: 'POST', "
        "headers: {'Content-Type': 'application/json'}, body: JSON.stringify({assembly_template_id: id})}); "
        "return (await response.json()).entfernt; }", saved["assembly_template_id"])
    check("Testbaugruppe wieder entfernt", removed is True)

    page.evaluate("function (id) { window.PlantFactoryV64Drawing.selectComponent(id); }", mixer["entity_id"])
    page.locator("#plant-drawing-inventory-name").fill(SMOKE_ENTITY_NAME)
    page.locator("#plant-drawing-save-inventory").click()
    page.wait_for_function(
        "function (id) { return Boolean(document.querySelector(\"#template-palette .template-item[data-template-id='\" + id + \"']\")); }",
        arg=SMOKE_ENTITY_ID, timeout=15000)
    scope = page.evaluate("function () { return document.getElementById('kategorie-filter').value; }")
    check("Anlagen-Inventar wechselt auf „Eigene Symbole“ und zeigt die Entity", scope == "__custom__"
          and page.locator("#template-palette .template-item[data-template-id='%s']" % SMOKE_ENTITY_ID).count() == 1, scope)
    svg_text = (CUSTOM_DIR / (SMOKE_ENTITY_ID + ".svg")).read_text(encoding="utf-8") if (CUSTOM_DIR / (SMOKE_ENTITY_ID + ".svg")).is_file() else ""
    check("Custom-Entity enthält Spiegelung und die Zeichenebenen-Kennung", "scale(-1 1)" in svg_text
          and ("plant-drawing-v64-r4" in svg_text or "plant-drawing-v64-r5" in svg_text or "plant-drawing-v64-r6" in svg_text), str(len(svg_text)))
    page.locator("#plant-drawing-use-in-plant").click()
    page.wait_for_timeout(900)
    inserted = page.evaluate(
        "function (id) { return Array.from(document.querySelectorAll('#elements-layer g.svg-element')).filter(function (n) { "
        "return (n.getAttribute('data-template-id') || '') === id || (n.dataset && n.dataset.templateId === id); }).length; }", SMOKE_ENTITY_ID)
    if not inserted:
        inserted = page.evaluate(
            "function (id) { var elements = window.PlantFactoryState && window.PlantFactoryState.get ? window.PlantFactoryState.get('elements') : null; "
            "return elements ? Object.values(elements).filter(function (e) { return e.templateId === id; }).length : -1; }", SMOKE_ENTITY_ID)
    check("Custom-Entity wird sichtbar im Anlagenbild eingesetzt", inserted != 0, str(inserted))
    check("Anlagenbild ist nach dem Einsetzen aktiv", page.locator("#plant-drawing-workspace").is_hidden())


def cleanup_custom_entity(page):
    """Remove the smoke custom entity from the plant inventory again."""
    target = CUSTOM_DIR / (SMOKE_ENTITY_ID + ".svg")
    if target.is_file():
        target.unlink()
    page.evaluate("async function () { await fetch('/api/templates/neu-laden', {method: 'POST'}); }")
    page.wait_for_timeout(300)
    check("Smoke-Entity wieder aus dem Anlagen-Inventar entfernt", not target.is_file())


def verify_example_and_visuals(browser):
    """The r4 reference plant plus light/dark evidence."""
    context = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    page = open_drawing(context)
    try:
        page.locator("#plant-drawing-r4-demo").click()
        page.wait_for_timeout(450)
        report = validate(page)
        check("Rohrofen-Anlage mit Fittings, Kapillaren und Gasmischer geladen", report["valid"]
              and report["counts"]["entities"] == 31 and report["counts"]["joints"] == 25 and report["counts"]["open_joints"] == 0,
              str(report["counts"]))
        sheet = sheet_of(page)
        templates = {e["template_id"] for e in sheet["entities"]}
        check("Beispiel nutzt alle neuen Bauteile außer Tee/Kappe", {"Swagelok_union", "Swagelok_elbow", "Capillary_line", "Boundary_connector", "Gas_mixer"} <= templates, str(templates))
        check("Beispiel nutzt gespiegelte Bögen und gestreckte Rohre",
              any(e["template_id"] == "Pipe_elbow_90" and (e["flip_x"] or e["flip_y"]) for e in sheet["entities"])
              and any(e["template_id"] == "Pipe_straight" and e["width"] > 140 for e in sheet["entities"]))
        check("Keine offenen Joints gezeichnet", page.locator(".plant-drawing-joint[data-pf-joint-state='open']").count() == 0
              and page.locator(".plant-drawing-joint[data-pf-joint-state='closed']").count() == 25)
        labels = page.locator("#plant-drawing-entities-layer [data-pf-role='entity-label']").all_text_contents()
        check("Grenzstellen tragen ihre Tags", {"N₂", "Educts", "Vent", "KW ein", "KW aus"} <= set(labels), ", ".join(labels))
        SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
        page.evaluate("function () { document.documentElement.dataset.theme='light'; }")
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r4_02_Example_Light.png"), animations="disabled")
        page.evaluate("function () { document.documentElement.dataset.theme='dark'; document.documentElement.dataset.darkPalette='blue'; }")
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r4_03_Example_Dark.png"), animations="disabled")
        page.evaluate("function () { document.documentElement.dataset.theme='light'; }")
        mixer = next(e for e in sheet["entities"] if e["template_id"] == "Gas_mixer")
        point = world_to_client(page, mixer["x"] + 60, mixer["y"] + 40)
        page.mouse.click(point[0], point[1], button="right")
        page.wait_for_timeout(200)
        page.screenshot(path=str(SCREENSHOT_DIR / "V64_r4_04_Inspector_ContextMenu.png"), animations="disabled")
        page.keyboard.press("Escape")
        check("Keine Konsolenfehler", not shared.console_errors, " | ".join(shared.console_errors[:3]))
        check("Keine Seitenfehler", not shared.page_errors, " | ".join(shared.page_errors[:3]))
    finally:
        context.close()


def run():
    """Run the complete r4 browser and visual contract."""
    playwright = sync_playwright().start()
    browser = None
    try:
        browser = shared.launch_browser(playwright)
        context = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page = open_drawing(context)
        try:
            progress("Release, Inventar und Ansicht prüfen")
            verify_release(page)
            progress("Strecken, Spiegeln, Invertieren und wachsendes Blatt prüfen")
            verify_geometry(page)
            progress("Inspektor-Register, Kontextmenü und Strg-Navigation prüfen")
            verify_inspector_and_menu(page)
            progress("Anlage von Grund auf zusammenstecken und übernehmen")
            verify_scratch_build(page)
        finally:
            cleanup_custom_entity(page)
            context.close()
        progress("Referenzanlage r4 und visuelle Nachweise")
        verify_example_and_visuals(browser)
    finally:
        if browser is not None:
            browser.close()
        playwright.stop()
    print("V64_r4 browser contract: %d passed, %d failed." % (PASSED, FAILED))
    for failure in FAILURES:
        print("   FAIL " + failure)
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(run())
