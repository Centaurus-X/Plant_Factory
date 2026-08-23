#!/usr/bin/env python3
"""Browser and visual verification for the Plant Factory V64_r5 classic drawing variant.

Covers: the classic symbol family in the drawing inventory, the structure tab
and layer switches, visual states and the animation switch, routed lines,
regions and dimensions drawn with the mouse, plug-together of filled tubes with
flanges, the two 1:1 reference examples and their exports.
"""

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
CLASSIC_PARTS = ("Classic_tube", "Classic_tube_flanged", "Classic_flange", "Classic_flange_bolted", "Classic_tube_elbow",
                 "Classic_tube_ubend", "Classic_tube_head", "Classic_capillary", "Classic_swagelok", "Classic_valve",
                 "Classic_control_valve", "Classic_check_valve", "Classic_flag", "Classic_flag_back", "Classic_instrument",
                 "Classic_furnace", "Classic_cooler", "Classic_column", "Classic_coil_circle", "Classic_mixer_box",
                 "Classic_cylinder", "Classic_line", "Classic_capillary_elbow", "Classic_tube_tap")
STRUCTURE_PARTS = ("Frame_post", "Frame_beam", "Frame_foot", "Frame_clamp", "Frame_floor")
SMOKE_ASSEMBLY_NAME = "Klassik-Strang R5"
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
    print("[v64-r5-smoke] " + message, flush=True)


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


def click_world(page, x, y, **kwargs):
    """Click at one sheet coordinate."""
    point = world_to_client(page, x, y)
    page.mouse.click(point[0], point[1], **kwargs)
    page.wait_for_timeout(140)


def drag_world(page, start, end, steps=10):
    """Drag between two sheet coordinates."""
    a = world_to_client(page, start[0], start[1])
    b = world_to_client(page, end[0], end[1])
    page.mouse.move(a[0], a[1])
    page.mouse.down()
    page.mouse.move(a[0] + 10, a[1] + 10, steps=3)
    page.mouse.move(b[0], b[1], steps=steps)
    page.mouse.up()
    page.wait_for_timeout(170)


def entity_by_template(sheet, template_id, index=-1):
    """Return the n-th entity of a template (default: last placed)."""
    items = [e for e in sheet["entities"] if e["template_id"] == template_id]
    return items[index]


def place(page, template_id, x, y):
    """Place one inventory part centred at a sheet coordinate (click workflow)."""
    page.locator(".plant-drawing-template-card[data-template-id='%s']" % template_id).click()
    click_world(page, x, y)
    return entity_by_template(sheet_of(page), template_id)


def joints(sheet):
    """Return the plugged joints."""
    return [c for c in sheet["connections"] if c["joint"]]


def primitives_of(sheet, kind):
    """Return primitives of one type."""
    return [p for p in sheet["primitives"] if p["type"] == kind]


# ---------------------------------------------------------------------------

def verify_inventory(page):
    """Release markers, classic family, structure tab."""
    release = page.evaluate("function () { return window.__plantFactoryV64R5 || null; }")
    check("R5 Release-API", bool(release) and release.get("version") == "64_r5" and release.get("classicSymbolFamily") is True, str(release))
    check("R1–R4-Verträge bleiben publiziert", page.evaluate(
        "function () { return ['R1', 'R2', 'R3', 'R4'].every(function (r) { return Boolean(window['__plantFactoryV64' + r]); }); }"))
    check("R5 Titel oder additive Folgerevision", "V64_r5" in page.title() or "V64_r6" in page.title(), page.title())
    styles = shared.loaded_styles(page)
    check("v64_r5.css geladen", "v64_r5.css" in styles and "v64_r4.css" in styles, ", ".join(styles))
    cards = page.locator("#plant-drawing-template-palette .plant-drawing-template-card").count()
    check("Elemente-Register zeigt 66 Teile (42 Standard + 24 Klassik)", cards == 66, str(cards))
    for template_id in CLASSIC_PARTS:
        check("Klassik-Teil im Inventar: " + template_id,
              page.locator(".plant-drawing-template-card[data-template-id='%s'][data-style='classic']" % template_id).count() == 1)
    check("Gestell-Register vorhanden", page.locator("[data-inventory-tab='structure']").count() == 1
          and page.locator("#plant-drawing-structure-count").inner_text().strip() == "5")
    page.locator("[data-inventory-tab='structure']").click()
    page.wait_for_timeout(150)
    structure_cards = page.locator("#plant-drawing-template-palette .plant-drawing-template-card").count()
    check("Gestell-Register listet genau die fünf Gestellteile", structure_cards == 5, str(structure_cards))
    for template_id in STRUCTURE_PARTS:
        check("Gestellteil: " + template_id,
              page.locator(".plant-drawing-template-card[data-template-id='%s'][data-layer='structure']" % template_id).count() == 1)
    page.locator("[data-inventory-tab='elements']").click()
    page.wait_for_timeout(150)
    check("Zeichenwerkzeuge Leitung, Bereich, Bemaßung vorhanden", all(
        page.locator("[data-drawing-tool='%s']" % tool).count() == 1 for tool in ("polyline", "region", "dimension")))
    check("Ebenen-Schalter und Animationsschalter vorhanden", page.locator("[data-drawing-layer]").count() == 3
          and page.locator("#plant-drawing-animation-toggle").count() == 1)
    templates = page.evaluate(
        "async function () { var payload = await (await fetch('/api/templates')).json(); var t = payload.templates; "
        "return {count: Object.keys(t).length, tube: t.Classic_tube.visual_states, frame: t.Frame_post.layer, kind: t.Frame_post.ports[0].kind, "
        "valve: t.Classic_valve.default_visual_state, style: t.Classic_furnace.style, "
        "taps: t.Classic_tube_tap.ports.map(function (p) { return p.id + '@' + p.x + ',' + p.y; })}; }")
    check("Template-API liefert Stil, Zustände, Ebene und Gestell-Portart", templates["count"] == 71 and templates["tube"] == ["neutral", "flow", "heat", "hot", "cold"]
          and templates["frame"] == "structure" and templates["kind"] == "structure" and templates["valve"] == "open" and templates["style"] == "classic", str(templates))
    check("Rohrstück mit Seitenanschluss trägt Ports an beiden Wänden (links/rechts, oben/unten)",
          templates["taps"] == ["inlet@0,24", "outlet@48,24", "tap_a@24,13", "tap_b@24,35"], str(templates["taps"]))


def verify_classic_construction(page):
    """Filled tubes and flanges plug together; visual states; animation switch."""
    tube = place(page, "Classic_tube", 500, 400)
    check("Klassik-Rohr startet im Zustand Durchfluss und Streckmodus", tube["visual_state"] == "flow" and tube["scale_mode"] == "stretch", str(tube["visual_state"]))
    flange = place(page, "Classic_flange", tube["x"] + tube["width"] + 8 + 3, tube["y"] + 24 + 2)
    sheet = sheet_of(page)
    check("Flansch rastet am gefüllten Rohr ein", len(joints(sheet)) == 1 and abs(flange["x"] - (tube["x"] + tube["width"])) < 0.01, str((flange["x"], tube["x"] + tube["width"])))
    flanged = place(page, "Classic_tube_flanged", flange["x"] + 16 + 80 + 3, flange["y"] + 24 + 2)
    sheet = sheet_of(page)
    check("Rohr mit Flansch rastet am Flansch ein", len(joints(sheet)) == 2 and abs(flanged["x"] - (flange["x"] + 16)) < 0.01, str(len(joints(sheet))))
    page.evaluate("function (id) { window.PlantFactoryV64Drawing.setSelection({entity_ids: [id]}); }", flanged["entity_id"])
    page.wait_for_timeout(120)
    handle = page.locator(".plant-drawing-handle[data-handle='e']").bounding_box()
    hx, hy = handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2
    page.mouse.move(hx, hy)
    page.mouse.down()
    page.mouse.move(hx + 10, hy, steps=2)
    page.mouse.move(hx + 120, hy, steps=6)
    page.mouse.up()
    page.wait_for_timeout(170)
    flanged = entity_by_template(sheet_of(page), "Classic_tube_flanged")
    caps = page.evaluate(
        "function (id) { return Array.from(document.querySelectorAll(\"#plant-drawing-entities-layer [data-entity-id='\" + id + \"'] svg[data-pf-stretch-segment='fixed']\")).map(function (n) { return Number(n.getAttribute('width')); }); }",
        flanged["entity_id"])
    check("Gefülltes Rohr streckt nur den Körper, Flanschbalken bleiben im Maß", flanged["width"] > 240 and caps == [22, 2], str((flanged["width"], caps)))
    check("Joint zum Flansch bleibt geschlossen", validate(page)["counts"]["open_joints"] == 0)

    valve = place(page, "Classic_valve", 500, 600)
    check("Klassik-Ventil startet offen (grün)", valve["visual_state"] == "open")
    options = page.locator("#drawing-visual-state option").all_inner_texts()
    check("Inspektor bietet die Zustände des Ventils an", options == ["Neutral", "Offen", "Geschlossen"], str(options))
    page.locator("#drawing-visual-state").select_option("closed")
    page.get_by_role("button", name="Eigenschaften übernehmen").click()
    page.wait_for_timeout(160)
    valve = entity_by_template(sheet_of(page), "Classic_valve")
    attribute = page.evaluate("function (id) { return document.querySelector(\"#plant-drawing-entities-layer [data-entity-id='\" + id + \"']\").getAttribute('data-pf-visual-state'); }", valve["entity_id"])
    check("Zustand Geschlossen wird gespeichert und gezeichnet", valve["visual_state"] == "closed" and attribute == "closed", str((valve["visual_state"], attribute)))
    fill = page.evaluate("function (id) { var n=document.querySelector(\"#plant-drawing-entities-layer [data-entity-id='\" + id + \"'] .pc-valve\"); return getComputedStyle(n).fill; }", valve["entity_id"])
    check("Geschlossenes Ventil ist rot gefüllt", fill == "rgb(238, 28, 36)", fill)
    page.keyboard.press("z")
    page.wait_for_timeout(150)
    valve = entity_by_template(sheet_of(page), "Classic_valve")
    check("Z wechselt zum nächsten Zustand", valve["visual_state"] == "neutral", valve["visual_state"])
    page.keyboard.press("z")
    page.wait_for_timeout(120)
    fill = page.evaluate("function (id) { var n=document.querySelector(\"#plant-drawing-entities-layer [data-entity-id='\" + id + \"'] .pc-valve\"); return getComputedStyle(n).fill; }", valve["entity_id"])
    check("Offenes Ventil ist grün gefüllt", fill == "rgb(45, 179, 74)", fill)

    paused = page.evaluate("function () { return document.getElementById('plant-drawing-canvas').animationsPaused(); }")
    check("Animation ist zunächst angehalten", paused is True and ui_state(page)["animationEnabled"] is False)
    page.locator("#plant-drawing-animation-toggle").click()
    page.wait_for_timeout(120)
    paused = page.evaluate("function () { return document.getElementById('plant-drawing-canvas').animationsPaused(); }")
    check("Animationsschalter startet die Laufstriche", paused is False and ui_state(page)["animationEnabled"] is True)
    animate_nodes = page.locator("#plant-drawing-entities-layer animate").count()
    check("Klassik-Teile tragen SMIL-Laufstriche", animate_nodes >= 3, str(animate_nodes))
    page.locator("#plant-drawing-animation-toggle").click()
    page.wait_for_timeout(100)
    check("Animationsschalter hält wieder an", page.evaluate("function () { return document.getElementById('plant-drawing-canvas').animationsPaused(); }") is True)


def verify_drawing_tools(page):
    """Routed line, region and dimension drawn with the mouse."""
    page.locator("[data-drawing-tool='polyline']").click()
    click_world(page, 200, 800)
    click_world(page, 400, 800)
    click_world(page, 400, 900)
    check("Leitungsentwurf zählt Stützpunkte", ui_state(page)["draftPoints"] == 3, str(ui_state(page)["draftPoints"]))
    page.keyboard.press("Enter")
    page.wait_for_timeout(170)
    lines = primitives_of(sheet_of(page), "polyline")
    check("Enter beendet die Leitung mit drei Punkten", len(lines) == 1 and len(lines[0]["points"]) == 3 and lines[0]["line_style"] == "pipe" and lines[0]["animated"] is True,
          str(lines[0] if lines else None))
    check("Leitung ist ausgewählt und Inspektor zeigt Darstellung", page.locator("#drawing-line-style").count() == 1 and page.locator("#drawing-line-animated").is_checked())
    page.locator("#drawing-line-style").select_option("hot")
    page.get_by_role("button", name="Zeichenelement übernehmen").click()
    page.wait_for_timeout(160)
    lines = primitives_of(sheet_of(page), "polyline")
    stroke = page.evaluate("function (id) { var n=document.querySelector(\"#plant-drawing-canvas [data-primitive-id='\" + id + \"'] path:not(.plant-drawing-polyline-hit)\"); return n.getAttribute('stroke'); }", lines[0]["primitive_id"])
    check("Darstellung Heiß färbt die Leitung rot mit Laufstrichen", lines[0]["line_style"] == "hot" and stroke == "#b33a3a"
          and page.locator("#plant-drawing-canvas [data-primitive-id='%s'] animate" % lines[0]["primitive_id"]).count() == 1, str((lines[0]["line_style"], stroke)))
    page.locator("[data-drawing-tool='polyline']").click()
    click_world(page, 600, 800)
    click_world(page, 800, 850)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    check("Escape beendet die zweite Leitung", len(primitives_of(sheet_of(page), "polyline")) == 2)

    page.locator("[data-drawing-tool='region']").click()
    drag_world(page, (150, 300), (450, 700))
    regions = primitives_of(sheet_of(page), "region")
    check("Bereich wird aufgezogen (Beschriftungsebene)", len(regions) == 1 and regions[0]["layer"] == "annotation"
          and abs(regions[0]["x2"] - regions[0]["x1"]) >= 280, str(regions[0] if regions else None))
    page.locator("#drawing-region-label").fill("Ventilpanel")
    page.locator("#drawing-region-label-position").select_option("above")
    page.get_by_role("button", name="Zeichenelement übernehmen").click()
    page.wait_for_timeout(150)
    regions = primitives_of(sheet_of(page), "region")
    label = page.locator("#plant-drawing-canvas [data-primitive-id='%s'] text" % regions[0]["primitive_id"]).text_content()
    check("Bereichstitel oberhalb mittig", regions[0]["label"] == "Ventilpanel" and regions[0]["label_position"] == "above" and label == "Ventilpanel", str(label))

    page.locator("[data-drawing-tool='dimension']").click()
    drag_world(page, (150, 250), (450, 250))
    dimensions = primitives_of(sheet_of(page), "dimension")
    check("Bemaßung wird aufgezogen", len(dimensions) == 1 and dimensions[0]["text"] == "1000 mm", str(dimensions[0] if dimensions else None))
    page.locator("#drawing-dimension-text").fill("1800 mm")
    page.get_by_role("button", name="Zeichenelement übernehmen").click()
    page.wait_for_timeout(150)
    dimensions = primitives_of(sheet_of(page), "dimension")
    rendered = page.locator("#plant-drawing-canvas [data-primitive-id='%s'] text" % dimensions[0]["primitive_id"]).text_content()
    check("Maßtext wird übernommen und gezeichnet", dimensions[0]["text"] == "1800 mm" and rendered == "1800 mm", str(rendered))

    page.locator("[data-drawing-layer='annotation']").click()
    page.wait_for_timeout(150)
    check("Beschriftungsebene ausblenden verbirgt Bereich und Bemaßung", page.locator("[data-type='region']").count() == 0
          and page.locator("[data-type='dimension']").count() == 0 and ui_state(page)["layers"]["annotation"] is False)
    page.locator("[data-drawing-layer='annotation']").click()
    page.wait_for_timeout(150)
    check("Beschriftungsebene wieder sichtbar", page.locator("[data-type='region']").count() == 1)

    page.locator("[data-inventory-tab='structure']").click()
    page.wait_for_timeout(120)
    post = place(page, "Frame_post", 1200, 400)
    check("Gestellpfosten liegt auf der Gestell-Ebene", post["layer"] == "structure")
    top = (post["x"] + 12, post["y"])
    beam = place(page, "Frame_beam", top[0] + 200 + 3, top[1] + 12 + 2)
    sheet = sheet_of(page)
    structure_joints = [c for c in joints(sheet) if c["kind"] == "structure"]
    check("Träger rastet am Pfosten ein (Verbindungsart Gestell)", len(structure_joints) == 1 and beam["layer"] == "structure", str(len(structure_joints)))
    page.locator("[data-drawing-layer='structure']").click()
    page.wait_for_timeout(150)
    check("Gestell-Ebene ausblenden verbirgt Pfosten und Träger", page.locator("#plant-drawing-entities-layer [data-layer='structure']").count() == 0)
    page.locator("[data-drawing-layer='structure']").click()
    page.wait_for_timeout(150)
    check("Gestell-Ebene wieder sichtbar", page.locator("#plant-drawing-entities-layer [data-layer='structure']").count() == 2)
    page.locator("[data-inventory-tab='elements']").click()

    page.keyboard.press("Control+a")
    page.locator("#plant-drawing-inventory-name").fill(SMOKE_ASSEMBLY_NAME)
    page.locator("#plant-drawing-save-assembly").click()
    page.wait_for_function(
        "function (name) { return window.PlantFactoryV64Drawing.getAssemblyTemplates().some(function (t) { return t.name === name; }); }",
        arg=SMOKE_ASSEMBLY_NAME, timeout=10000)
    saved = next(t for t in page.evaluate("function () { return window.PlantFactoryV64Drawing.getAssemblyTemplates(); }")
                 if t["name"] == SMOKE_ASSEMBLY_NAME)
    stored = page.evaluate(
        "async function (id) { var listing = await (await fetch('/api/drawing-assemblies')).json(); "
        "var item = listing.assemblies.find(function (a) { return a.assembly_template_id === id; }); if (!item) return null; "
        "return {primitives: item.primitives.map(function (p) { return [p.type, (p.points || []).length, p.line_style, p.label, p.layer]; }), "
        "states: item.entities.map(function (e) { return [e.template_id, e.visual_state, e.layer]; }), kinds: item.connections.map(function (c) { return c.kind; })}; }",
        saved["assembly_template_id"])
    check("Bibliothek persistiert Leitungen, Bereiche, Bemaßung, Zustände, Ebenen und Gestell-Joints",
          bool(stored) and any(p[0] == "polyline" and p[1] == 3 and p[2] == "hot" for p in stored["primitives"])
          and any(p[0] == "region" and p[3] == "Ventilpanel" and p[4] == "annotation" for p in stored["primitives"])
          and any(p[0] == "dimension" for p in stored["primitives"])
          and any(s[0] == "Classic_valve" and s[1] == "open" for s in stored["states"])
          and any(s[2] == "structure" for s in stored["states"]) and "structure" in stored["kinds"], str(stored))
    removed = page.evaluate(
        "async function (id) { var response = await fetch('/api/drawing-assemblies/loeschen', {method: 'POST', "
        "headers: {'Content-Type': 'application/json'}, body: JSON.stringify({assembly_template_id: id})}); "
        "return (await response.json()).entfernt; }", saved["assembly_template_id"])
    check("Testbaugruppe wieder entfernt", removed is True)


def verify_examples(browser):
    """Both reference images rebuilt from classic parts, exports and evidence."""
    context = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    page = open_drawing(context)
    try:
        page.locator("#plant-drawing-classic-demo").click()
        page.wait_for_timeout(500)
        report = validate(page)
        check("Klassisches Reaktor-P&ID: 39 Teile, 23 Joints, 31 Zeichenelemente", report["valid"] and report["counts"]["entities"] == 39
              and report["counts"]["joints"] == 23 and report["counts"]["open_joints"] == 0 and report["counts"]["primitives"] == 31, str(report["counts"]))
        sheet = sheet_of(page)
        by_id = {e["entity_id"]: e for e in sheet["entities"]}
        tap_joints = [c for c in joints(sheet) if "tap" in (c["from_port_id"], c["to_port_id"]) or c["from_port_id"].startswith("tap_") or c["to_port_id"].startswith("tap_")]
        check("Seitlicher Swagelok steckt über Kapillare am Seitenanschluss des Rohrs, axialer Swagelok am Rohrkopf",
              len(tap_joints) == 1 and any(by_id[c["from_entity_id"]]["template_id"] == "Classic_capillary" and c["to_port_id"] == "capillary"
                                           for c in joints(sheet)), str(len(tap_joints)))
        check("Gestell-Joints sind bei ausgeblendeter Ebene nicht auf der Zeichenfläche", page.locator("#plant-drawing-connections-layer [data-connection-id]").count() == 18
              and page.locator("#plant-drawing-ports-layer circle").count() > 0, str(page.locator("#plant-drawing-connections-layer [data-connection-id]").count()))
        sheet = sheet_of(page)
        check("Blatt hat das Referenzmaß 1300 × 1110", sheet["width"] == 1300 and sheet["height"] == 1110, str((sheet["width"], sheet["height"])))
        page.locator(".plant-drawing-inspector-tab[data-inspector-tab='sheet']").click()
        page.wait_for_timeout(120)
        check("Blatt-Tab zeigt den Auto-Wachstumsrand", page.locator("#drawing-sheet-margin").input_value() == "4")
        kinds = {p["type"] for p in sheet["primitives"]}
        check("Beispiel nutzt Leitungen, Bereiche, Bemaßungen und Texte", {"polyline", "region", "dimension", "text"} <= kinds, str(kinds))
        check("Gestell-Ebene ist zunächst ausgeblendet", ui_state(page)["layers"]["structure"] is False
              and page.locator("#plant-drawing-entities-layer [data-layer='structure']").count() == 0)
        labels = page.locator("#plant-drawing-entities-layer [data-pf-role='entity-function']").all_text_contents()
        values = page.locator("#plant-drawing-entities-layer [data-pf-role='entity-value']").all_text_contents()
        check("Instrumentenkreise zeigen Funktion, Nummer und Messwert", {"TIC", "PI", "TI"} <= set(labels) and {"500 °C", "1,3 bar", "40 °C"} <= set(values), str(labels + values))
        flags = page.locator("#plant-drawing-entities-layer [data-pf-role='entity-label']").all_text_contents()
        check("Grenzstellen N₂, Educts, Vent, KW ein, KW aus", {"N₂", "Educts", "Vent", "KW ein", "KW aus"} <= set(flags), str(flags))
        furnace_fill = page.evaluate("function () { var n=document.querySelector(\"[data-pf-template-id='Classic_furnace'] .pc-state\"); return getComputedStyle(n).fill; }")
        cooler_fill = page.evaluate("function () { var n=document.querySelector(\"[data-pf-template-id='Classic_cooler'] .pc-state\"); return getComputedStyle(n).fill; }")
        check("Rohrofen rot und Kühler blau wie im Referenzbild", furnace_fill == "rgb(238, 28, 36)" and cooler_fill == "rgb(30, 155, 232)", str((furnace_fill, cooler_fill)))
        svg = page.evaluate("function () { return window.PlantFactoryV64Drawing.exportFullSvg(); }")
        check("Export enthält Laufstriche, Zustände und Leitungen", svg.count("<animate") >= 20 and 'data-pf-visual-state="hot"' in svg
              and 'data-type="polyline"' in svg and 'data-type="region"' in svg and 'data-type="dimension"' in svg, str(svg.count("<animate")))
        check("Ausgeblendete Gestell-Ebene ist nicht im Export", 'data-layer="structure"' not in svg)
        SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
        page.evaluate("function () { document.documentElement.dataset.theme='light'; }")
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r5_01_Classic_Reactor_Light.png"), animations="disabled")
        page.locator("[data-drawing-layer='structure']").click()
        page.wait_for_timeout(200)
        check("Gestell-Ebene zeigt Pfosten, Träger, Füße, Boden und Schelle", page.locator("#plant-drawing-entities-layer [data-layer='structure']").count() == 8)
        svg = page.evaluate("function () { return window.PlantFactoryV64Drawing.exportFullSvg(); }")
        check("Eingeblendete Gestell-Ebene ist im Export", 'data-layer="structure"' in svg)
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r5_02_Classic_Reactor_Frame.png"), animations="disabled")

        page.locator("#plant-drawing-classic-template-demo").click()
        dialog = page.locator(".pf-application-dialog[data-dialog-kind='confirmation'] [data-dialog-primary='true']")
        check("Sicherheitsabfrage vor dem Ersetzen der Skizze", dialog.count() == 1 and dialog.text_content() == "Beispiel laden")
        dialog.click()
        page.wait_for_timeout(500)
        report = validate(page)
        check("Klassische Symbolvariante: 19 Teile, 22 Zeichenelemente", report["valid"] and report["counts"]["entities"] == 19
              and report["counts"]["primitives"] == 22, str(report["counts"]))
        sheet = sheet_of(page)
        check("Blatt hat das Referenzmaß 1150 × 830 mit Referenzrand", sheet["width"] == 1150 and sheet["height"] == 830 and sheet["margin"] == 4,
              str((sheet["width"], sheet["height"], sheet["margin"])))
        templates = {e["template_id"] for e in sheet["entities"]}
        check("Symbolvariante nutzt Kolonne, Kreis-Apparate, Gasflaschen, Mischer, Regel- und Rückschlagventile",
              {"Classic_column", "Classic_coil_circle", "Classic_cylinder", "Classic_mixer_box", "Classic_control_valve", "Classic_check_valve"} <= templates, str(templates))
        valve = next(e for e in sheet["entities"] if e["tag"] == "V-103")
        check("Vent-Ventil steht senkrecht mit Handrad rechts und Fluss nach oben", valve["rotation"] == 90 and valve["inverted"] is True)
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r5_03_Classic_Template_Light.png"), animations="disabled")
        page.evaluate("function () { document.documentElement.dataset.theme='dark'; document.documentElement.dataset.darkPalette='blue'; }")
        page.locator("#plant-drawing-workspace").screenshot(path=str(SCREENSHOT_DIR / "V64_r5_04_Classic_Template_Dark.png"), animations="disabled")
        page.evaluate("function () { document.documentElement.dataset.theme='light'; }")
        check("Keine Konsolenfehler", not shared.console_errors, " | ".join(shared.console_errors[:3]))
        check("Keine Seitenfehler", not shared.page_errors, " | ".join(shared.page_errors[:3]))
    finally:
        context.close()


def run():
    """Run the complete r5 browser and visual contract."""
    playwright = sync_playwright().start()
    browser = None
    try:
        browser = shared.launch_browser(playwright)
        context = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page = open_drawing(context)
        try:
            progress("Inventar, Klassik-Familie und Gestell-Register prüfen")
            verify_inventory(page)
            progress("Gefüllte Rohre stecken, Zustände und Animation prüfen")
            verify_classic_construction(page)
            progress("Leitungen, Bereiche, Bemaßung, Ebenen und Bibliothek prüfen")
            verify_drawing_tools(page)
        finally:
            context.close()
        progress("Referenzbilder als Beispiele und Exporte prüfen")
        verify_examples(browser)
    finally:
        if browser is not None:
            browser.close()
        playwright.stop()
    print("V64_r5 browser contract: %d passed, %d failed." % (PASSED, FAILED))
    for failure in FAILURES:
        print("   FAIL " + failure)
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(run())
