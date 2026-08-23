#!/usr/bin/env python3
"""Browser regression verification for Plant Factory V63.2."""

import pathlib
import sys

from playwright.sync_api import sync_playwright


TEST_DIR = pathlib.Path(__file__).resolve().parent
if str(TEST_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_DIR))

import smoke_ui as shared


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"
passed = 0
failed = 0
failures = []


def check(name, condition, detail=""):
    """Record one deterministic assertion."""
    global passed, failed
    if condition:
        passed += 1
        return
    failed += 1
    suffix = " — " + detail if detail else ""
    failures.append(name + suffix)


def progress(message):
    """Print one browser-smoke checkpoint."""
    print("[v63.2-smoke] " + message, flush=True)


def project_index(page, project_name):
    """Return the list index of one project."""
    items = page.locator("#projekt-liste .projekt-item")
    for index in range(items.count()):
        title = items.nth(index).locator("h4").inner_text().strip()
        if title == project_name:
            return index
    return -1


def open_project(page, project_name):
    """Open one project through the public project dialog."""
    page.locator("#btn-header-more").click()
    page.locator("#btn-laden").click()
    page.wait_for_selector("#modal-projekte-laden:not(.hidden)", timeout=10000)
    index = project_index(page, project_name)
    check("V63.2 Beispielprojekt in Projektliste", index >= 0, project_name)
    if index < 0:
        return False
    page.locator("#projekt-liste .projekt-item").nth(index).click()
    page.wait_for_function(
        "function () { return document.querySelectorAll('#elements-layer > .svg-element').length === 6 "
        "&& document.querySelectorAll('#connections-layer > .connection-line').length === 5; }",
        timeout=15000,
    )
    page.wait_for_function(
        "function () { var lines = Array.from(document.querySelectorAll('#connections-layer > .connection-line')); "
        "return lines.length === 5 && lines.every(function (line) { "
        "var d = line.getAttribute('d') || ''; "
        "return line.dataset.renderState === 'ready' && d.length > 4 "
        "&& !/NaN|Infinity|undefined/.test(d); }); }",
        timeout=15000,
    )
    return True


def painted_point(locator):
    """Return a painted screen point inside one SVG entity."""
    return locator.evaluate(
        "function (root) { "
        "var selectors = 'rect,circle,ellipse,path,polygon,polyline,line,use,image,text'; "
        "var nodes = Array.from(root.querySelectorAll(selectors)); "
        "var factors = [[0.5,0.5],[0.25,0.25],[0.75,0.25],[0.25,0.75],[0.75,0.75]]; "
        "for (var i = 0; i < nodes.length; i += 1) { "
        "var box = nodes[i].getBoundingClientRect(); "
        "if (box.width <= 0 || box.height <= 0) continue; "
        "for (var j = 0; j < factors.length; j += 1) { "
        "var x = box.x + box.width * factors[j][0]; "
        "var y = box.y + box.height * factors[j][1]; "
        "var hit = document.elementFromPoint(x, y); "
        "if (hit && hit.closest && hit.closest('.svg-element') === root) return {x:x,y:y}; "
        "} } return null; }"
    )


def open_object_context(page, element_id):
    """Open the canvas context menu for one object."""
    selector = "#elements-layer > #" + element_id
    point = painted_point(page.locator(selector))
    if not point:
        return False
    page.evaluate(
        "function (args) { var target = document.elementFromPoint(args.x, args.y); "
        "target.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,"
        "composed:true,button:2,buttons:2,clientX:args.x,clientY:args.y})); }",
        point,
    )
    page.wait_for_selector("#canvas-context-menu:not([hidden])", timeout=5000)
    return True


def modal_box(page):
    """Return the connection modal panel dimensions."""
    box = page.locator("#modal-verbindung-erstellen .modal-content").bounding_box()
    return box or {}


def create_custom_logic_diagram(page):
    """Create one user diagram with one block through the public UI."""
    page.locator("#workspace-logic-button").click()
    page.wait_for_selector("#logic-workspace:not([hidden])", timeout=8000)
    page.locator("#logic-new-diagram").click()
    page.wait_for_selector("#modal-logic-diagram:not(.hidden)", timeout=5000)
    page.locator("#logic-diagram-name").fill("Eigener V63.2 Testplan")
    page.locator("#logic-diagram-description").fill("Regression für additive Demo")
    page.locator("#logic-diagram-save").click()
    page.wait_for_function(
        "function () { return window.__logic.getModel().diagrams.some(function (diagram) { "
        "return diagram.name === 'Eigener V63.2 Testplan'; }); }",
        timeout=6000,
    )
    page.evaluate(
        "function () { window.__logic.addBlock('constant_bool', {x:180,y:160}); }"
    )
    page.wait_for_function(
        "function () { var diagram = window.__logic.getActiveDiagram(); "
        "return diagram && diagram.name === 'Eigener V63.2 Testplan' && diagram.nodes.length === 1; }",
        timeout=6000,
    )


def run():
    """Execute all V63.2 browser regressions."""
    global failed
    shared.reset_browser_diagnostics()
    playwright = sync_playwright().start()
    browser = None
    try:
        browser = shared.launch_browser(playwright)
        context = browser.new_context(
            viewport={"width": 1680, "height": 1000},
            device_scale_factor=1,
        )
        page, response_status, embedded_mode = shared.open_application(context, BASE_URL)
        page.set_default_timeout(10000)
        page.wait_for_timeout(900)

        check("HTTP 200", response_status == 200, str(response_status))
        check("Kompatible Nachfolgeversion sichtbar", "V64" in page.title() or "V63.4" in page.title(), page.title())
        release = page.evaluate("function () { return window.__plantFactoryV63 || null; }")
        check("V63.4 Release-API", bool(release) and release.get("version") == "63.4", str(release))
        check("V63.2 Stabilitätsvertrag geerbt", bool(release) and release.get("stabilityContract") == "PF-V63.2-STABILITY", str(release))
        check("Automation-Bridge publiziert", bool(release) and release.get("automationContract") == "PF-AUTOMATION-V9-BRIDGE", str(release))
        check("Verbindungslayout publiziert", bool(release) and release.get("connectionLayout") == "deferred-bounded-retry", str(release))
        check("I/O-Auswahlsync publiziert", bool(release) and release.get("ioSelectionSync") is True, str(release))
        check("Additive Demo publiziert", bool(release) and release.get("logicDemoAdditive") is True, str(release))
        styles = shared.loaded_styles(page)
        check("v63_2.css geladen", "v63_2.css" in styles, ", ".join(styles))

        progress("Additive Logik-Demo prüfen")
        create_custom_logic_diagram(page)
        before = page.evaluate(
            "function () { var model = window.__logic.getModel(); "
            "var custom = model.diagrams.find(function (diagram) { return diagram.name === 'Eigener V63.2 Testplan'; }); "
            "return {count:model.diagrams.length,nodes:custom ? custom.nodes.length : -1,id:custom ? custom.diagram_id : ''}; }"
        )
        page.locator("#logic-load-demo").click()
        page.wait_for_function(
            "function () { var model = window.__logic.getModel(); "
            "return model.active_diagram_id === 'logic_timer_counter_demo' "
            "&& model.diagrams.some(function (diagram) { return diagram.name === 'Eigener V63.2 Testplan'; }); }",
            timeout=10000,
        )
        after = page.evaluate(
            "function () { var model = window.__logic.getModel(); "
            "var custom = model.diagrams.find(function (diagram) { return diagram.name === 'Eigener V63.2 Testplan'; }); "
            "return {count:model.diagrams.length,nodes:custom ? custom.nodes.length : -1,id:custom ? custom.diagram_id : '',"
            "demo:model.diagrams.filter(function (diagram) { return diagram.diagram_id === 'logic_timer_counter_demo'; }).length}; }"
        )
        check("Eigener Schaltplan bleibt erhalten", after.get("id") == before.get("id"), str(after))
        check("Eigene Bausteine bleiben erhalten", after.get("nodes") == 1, str(after))
        check("Demo wird einmalig ergänzt", after.get("count") == before.get("count") + 1 and after.get("demo") == 1, str(after))
        page.locator("#logic-load-demo").click()
        page.wait_for_timeout(250)
        duplicate_check = page.evaluate(
            "function () { var model = window.__logic.getModel(); return {count:model.diagrams.length,"
            "demo:model.diagrams.filter(function (diagram) { return diagram.diagram_id === 'logic_timer_counter_demo'; }).length}; }"
        )
        check("Erneutes Öffnen dupliziert die Demo nicht", duplicate_check.get("count") == after.get("count") and duplicate_check.get("demo") == 1, str(duplicate_check))
        shared.capture_evidence(
            page,
            "screenshot_v63_2_logic_additive.png",
            "V63_2_Screenshot_03_Additive_Logic_Diagrams.png",
        )

        progress("Vollständiges Beispielprojekt laden")
        page.locator("[data-workspace='engineering']").click()
        page.wait_for_timeout(150)
        loaded = open_project(page, "v63_2_komplettbeispiel")
        check("Beispielprojekt geladen", loaded)
        page.wait_for_timeout(350)
        line_report = page.evaluate(
            "function () { return Array.from(document.querySelectorAll('#connections-layer > .connection-line')).map(function (line) { "
            "return {id:line.id,state:line.dataset.renderState,d:line.getAttribute('d') || ''}; }); }"
        )
        check("Fünf Linien sofort ready", len(line_report) == 5 and all(item.get("state") == "ready" for item in line_report), str(line_report))
        check("Alle Linien besitzen endliche Pfade", all(item.get("d") and not any(token in item.get("d") for token in ("NaN", "Infinity", "undefined")) for item in line_report), str(line_report))
        first_paths = {item.get("id"): item.get("d") for item in line_report}

        progress("Objekt verschieben und Verbindungslayout prüfen")
        pump = page.locator("#elements-layer > #pump_feed")
        point = painted_point(pump)
        check("Painted Point für Pumpe gefunden", bool(point))
        if point:
            page.mouse.move(point["x"], point["y"])
            page.mouse.down()
            page.mouse.move(point["x"] + 70, point["y"] + 35, steps=8)
            page.mouse.up()
        page.wait_for_function(
            "function () { var lines = Array.from(document.querySelectorAll('#connections-layer > .connection-line')); "
            "return lines.length === 5 && lines.every(function (line) { return line.dataset.renderState === 'ready'; }); }",
            timeout=8000,
        )
        second_report = page.evaluate(
            "function () { return Array.from(document.querySelectorAll('#connections-layer > .connection-line')).map(function (line) { "
            "return {id:line.id,state:line.dataset.renderState,d:line.getAttribute('d') || ''}; }); }"
        )
        second_paths = {item.get("id"): item.get("d") for item in second_report}
        check("Objektbewegung erzeugt keine neue Verbindung", len(second_report) == 5, str(second_report))
        check("Mindestens ein verbundener Pfad aktualisiert", any(first_paths.get(key) != value for key, value in second_paths.items()), str(second_report))
        check("Nach Bewegung bleiben alle Pfade gültig", all(item.get("state") == "ready" and item.get("d") for item in second_report), str(second_report))

        progress("I/O-Auswahl synchronisieren")
        shared.click_painted_element(page, pump)
        shared.click_tab(page, "device")
        page.wait_for_function(
            "function () { var select = document.getElementById('device-element-select'); "
            "var role = document.getElementById('device-role'); "
            "var id = document.getElementById('device-actuator-id'); "
            "return select && role && id && select.value === 'pump_feed' && role.value === 'actuator' && id.value === '4'; }",
            timeout=7000,
        )
        check("Canvas-Auswahl im I/O-Dropdown", page.locator("#device-element-select").input_value() == "pump_feed")
        check("I/O-Rolle automatisch geladen", page.locator("#device-role").input_value() == "actuator")
        check("Aktor-ID automatisch geladen", page.locator("#device-actuator-id").input_value() == "4")
        check("Controller automatisch geladen", page.locator("#device-controller").input_value() == "2")
        check("Adresse automatisch geladen", page.locator("#device-address").input_value() == "516")
        check("Funktion automatisch geladen", page.locator("#device-function-type").input_value() == "write_coil")
        shared.capture_evidence(
            page,
            "screenshot_v63_2_io_connections.png",
            "V63_2_Screenshot_02_IO_Selection_And_Connections.png",
        )

        progress("Kompakten Verbindungsdialog prüfen")
        shared.click_tab(page, "elements")
        opened = open_object_context(page, "reactor_main")
        check("Objekt-Kontextmenü geöffnet", opened)
        if opened:
            page.locator("#canvas-context-menu [data-context-action='object-connect']").click()
        page.wait_for_selector("#modal-verbindung-erstellen:not(.hidden)", timeout=5000)
        page.wait_for_timeout(120)
        box = modal_box(page)
        check("Verbindungsdialog ungefähr 620 px breit", 600 <= box.get("width", 0) <= 625, str(box))
        check("Verbindungsdialog nicht fullscreen-hoch", 250 <= box.get("height", 0) < 700, str(box))
        check("Verbindungsdialog im Viewport", box.get("x", -1) >= 0 and box.get("y", -1) >= 0, str(box))
        page.locator("#modal-verbindung-erstellen .pf-window-maximize").click()
        page.wait_for_timeout(100)
        check("Dialog lässt sich maximieren", page.locator("#modal-verbindung-erstellen .modal-content").get_attribute("class").find("pf-window-maximized") >= 0)
        page.locator("#modal-verbindung-erstellen .modal-close").click()
        page.wait_for_timeout(100)
        opened_again = open_object_context(page, "reactor_main")
        check("Kontextmenü für erneutes Öffnen", opened_again)
        if opened_again:
            page.locator("#canvas-context-menu [data-context-action='object-connect']").click()
        page.wait_for_selector("#modal-verbindung-erstellen:not(.hidden)", timeout=5000)
        page.wait_for_timeout(120)
        reopened_box = modal_box(page)
        reopened_class = page.locator("#modal-verbindung-erstellen .modal-content").get_attribute("class") or ""
        check("Dialog startet nach Maximierung wieder kompakt", 600 <= reopened_box.get("width", 0) <= 625, str(reopened_box))
        check("Maximierungsstatus wird zurückgesetzt", "pf-window-maximized" not in reopened_class, reopened_class)
        shared.capture_evidence(
            page,
            "screenshot_v63_2_connection_modal.png",
            "V63_2_Screenshot_01_Compact_Connection_Modal.png",
        )
        page.locator("#modal-verbindung-erstellen .modal-close").click()

        progress("Automation-V9-Bridge UI prüfen")
        # The rail opens Automation Studio; legacy bridge routes remain directly addressable.
        page.locator("[data-workspace='automation']").click()
        page.wait_for_selector("#tab-v9-automation.active", timeout=8000)
        shared.click_tab(page, "processes")
        page.wait_for_selector("#tab-processes.active", timeout=8000)
        labels = page.locator(".proc-root .subtabs [data-proc-subtab]").all_inner_texts()
        check("Automation-Untertabs konsolidiert", labels == ["Erstellen", "Vorlagen", "Projekt-States", "Parameter-Schemas", "Runtime-Hilfen"], str(labels))
        check("Aktiver Automation-Rules-Tab entfernt", "Automation Rules" not in labels, str(labels))
        page.locator("[data-proc-subtab='automation_config']").click()
        page.wait_for_selector("#proc-automation-config .pf-automation-bridge-grid", timeout=7000)
        bridge_text = page.locator("#proc-automation-config").inner_text()
        check("Bridge-Vertrag sichtbar", "PF-AUTOMATION-V9-BRIDGE" in bridge_text, bridge_text[:300])
        check("Fünf Runtime-Sektionen sichtbar", all(section in bridge_text for section in ("process_states", "filters", "timers", "rule_engine", "rules")), bridge_text[:500])
        check("Keine aktive doppelte Regelquelle", "Aktive doppelte Regelquellen: 0" in bridge_text, bridge_text[:500])
        check("Projektregel-Autorität erklärt", "Projektregeln" in bridge_text and "Runtime-Regeln V9" in bridge_text, bridge_text[:500])
        shared.capture_evidence(
            page,
            "screenshot_v63_2_automation_bridge.png",
            "V63_2_Screenshot_04_Automation_V9_Bridge.png",
        )

        check("Keine Page-Fehler", len(shared.page_errors) == 0, " | ".join(shared.page_errors[:5]))
        check("Keine Request-Fehler", len(shared.request_failures) == 0, " | ".join(shared.request_failures[:5]))
        check("Keine Konsolenfehler", len(shared.console_errors) == 0, " | ".join(shared.console_errors[:5]))
        check("Hermetischer Modus zulässig", embedded_mode in (True, False), str(embedded_mode))

    except Exception as error:
        failures.append("Ausnahme — " + repr(error))
        failed += 1
    finally:
        if browser is not None:
            browser.close()
        playwright.stop()

    print("Plant Factory V63.2 browser regression: %s passed, %s failed." % (passed, failed))
    if failures:
        for failure in failures:
            print("   FAIL " + failure)
    return failed


if __name__ == "__main__":
    raise SystemExit(run())
