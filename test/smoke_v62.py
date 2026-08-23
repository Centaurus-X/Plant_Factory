#!/usr/bin/env python3
"""Browser verification for Plant Factory V62.1 interaction contracts."""

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
    global passed, failed
    if condition:
        passed += 1
        return
    failed += 1
    suffix = " — " + detail if detail else ""
    failures.append(name + suffix)


def progress(message):
    print("[v62-smoke] " + message, flush=True)


def load_reference_project(page):
    shared.click_tab(page, "elements")
    page.locator("#btn-header-more").click()
    page.locator("#btn-laden").click()
    page.wait_for_selector("#modal-projekte-laden:not(.hidden)", timeout=10000)
    items = page.locator("#projekt-liste .projekt-item")
    target = None
    for index in range(items.count()):
        title = items.nth(index).locator("h4").inner_text().strip()
        if title == "designziel_v1_v61_1":
            target = items.nth(index)
            break
    if target is None:
        return False
    target.click()
    page.wait_for_function(
        "function () { return document.querySelectorAll('#elements-layer > .svg-element').length === 6 "
        "&& document.querySelectorAll('#connections-layer > .connection-line').length === 5; }",
        timeout=15000,
    )
    page.wait_for_timeout(500)
    return True


def box_inside(inner, outer):
    if not inner or not outer:
        return False
    return (
        inner["x"] >= outer["x"] - 1
        and inner["y"] >= outer["y"] - 1
        and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + 1
        and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + 1
    )


def context_menu_on(page, selector, x_value, y_value):
    page.evaluate(
        """function (args) {
            var node = document.querySelector(args.selector);
            if (!node) throw new Error('Context target missing: ' + args.selector);
            node.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                composed: true,
                button: 2,
                buttons: 2,
                clientX: args.x,
                clientY: args.y
            }));
        }""",
        {"selector": selector, "x": x_value, "y": y_value},
    )
    page.wait_for_selector("#canvas-context-menu:not([hidden])", timeout=5000)


def run():
    shared.reset_browser_diagnostics()
    playwright = sync_playwright().start()
    browser = None
    try:
        browser = shared.launch_browser(playwright)
        context = browser.new_context(
            viewport={"width": 1680, "height": 1000},
            device_scale_factor=1,
        )
        progress("Anwendung öffnen")
        page, response_status, embedded_mode = shared.open_application(context, BASE_URL)
        page.set_default_timeout(7000)
        page.wait_for_timeout(800)
        progress("Anwendung bereit")

        check("HTTP 200", response_status == 200, str(response_status))
        check("V62-Verträge in Nachfolgeversion erhalten", "V64" in page.title() or "V63.4" in page.title(), page.title())
        report = page.evaluate("function () { return window.__plantFactoryV62 || null; }")
        check("V62 Release-API bereit", bool(report) and report.get("version") == "62.1", str(report))
        check("PF-MODAL-V1 publiziert", bool(report) and report.get("modalContract") == "PF-MODAL-V1", str(report))
        check("PF-CANVAS-CONTEXT-V1 publiziert", bool(report) and report.get("contextMenuContract") == "PF-CANVAS-CONTEXT-V1", str(report))
        check("PF-HMI-SETUP-V2 publiziert", bool(report) and report.get("hmiWorkflowContract") == "PF-HMI-SETUP-V2", str(report))
        styles = shared.loaded_styles(page)
        check("v62.css geladen", "v62.css" in styles, ", ".join(styles))

        static_modals = page.locator(".modal.pf-managed-modal")
        check("Statische Dialoge werden verwaltet", static_modals.count() >= 5, str(static_modals.count()))
        check(
            "Statische Dialoge besitzen Fensterschalter",
            page.locator(".modal.pf-managed-modal .pf-window-controls").count() == static_modals.count(),
            "%s/%s" % (
                page.locator(".modal.pf-managed-modal .pf-window-controls").count(),
                static_modals.count(),
            ),
        )
        check(
            "Statische Dialoge besitzen Resize-Griffe",
            page.locator(".modal.pf-managed-modal .pf-window-resize-handle").count() == static_modals.count(),
        )

        progress("Dynamischen Dialog prüfen")
        page.evaluate(
            "function () { window.plantFactoryDialogs.showNotice('Dynamischer V62-Test', "
            "{ title: 'Dialogvertrag', confirmLabel: 'Schließen' }); }"
        )
        page.wait_for_selector(".pf-application-dialog", timeout=5000)
        page.wait_for_timeout(100)
        dynamic_modal = page.locator(".pf-application-dialog")
        check("Dynamischer Dialog sichtbar", dynamic_modal.is_visible())
        check("Dynamischer Dialog wird nachträglich verwaltet", "pf-managed-modal" in (dynamic_modal.get_attribute("class") or ""))
        check("Dynamischer Dialog ist verschiebbar", dynamic_modal.locator(".pf-window-header").count() == 1)
        dynamic_modal.locator("[data-dialog-primary='true']").click()
        page.wait_for_timeout(100)
        check("Dynamischer Dialog schließt", dynamic_modal.count() == 0)

        progress("Referenzprojekt laden")
        loaded = load_reference_project(page)
        progress("Referenzprojekt geladen")
        check("Referenzprojekt geladen", loaded)
        if not loaded:
            raise RuntimeError("V61 reference project unavailable")

        progress("Verbindungseditor prüfen")
        pump = page.locator("#elements-layer > #pump_feed")
        painted = shared.click_painted_element(page, pump)
        check("Referenzpumpe auswählbar", painted)
        page.wait_for_timeout(250)
        shared.click_tab(page, "connections")
        edit_buttons = page.locator("[data-connection-action='edit']")
        check("Bearbeiten-Buttons gerendert", edit_buttons.count() > 0, str(edit_buttons.count()))

        connection_id = edit_buttons.first.get_attribute("data-connection-id") or ""
        connection_line = page.locator("#" + connection_id)
        original_width = float(connection_line.get_attribute("stroke-width") or "2")
        edit_buttons.first.click()
        page.wait_for_selector("#modal-verbindung-bearbeiten:not(.hidden)", timeout=5000)
        editor_modal = page.locator("#modal-verbindung-bearbeiten")
        check("Verbindungseditor öffnet als Modal", editor_modal.is_visible())
        check("Verbindungseditor wird verwaltet", "pf-managed-modal" in (editor_modal.get_attribute("class") or ""))
        check("Endpunktfelder vorhanden", page.locator("#edit-von-select").count() == 1 and page.locator("#edit-nach").count() == 1)
        check("Semantische Portfelder vorhanden", page.locator("#edit-von-port").count() == 1 and page.locator("#edit-nach-port").count() == 1)

        changed_width = min(original_width + 1.0, 12.0)
        page.locator("#edit-breite").fill(str(changed_width))
        page.locator("#btn-edit-conn-cancel").click()
        page.wait_for_timeout(120)
        cancelled_width = float(connection_line.get_attribute("stroke-width") or "0")
        check("Abbrechen verändert Verbindung nicht", abs(cancelled_width - original_width) < 0.001, "%s -> %s" % (original_width, cancelled_width))

        page.locator("[data-connection-action='edit'][data-connection-id='%s']" % connection_id).click()
        page.wait_for_selector("#modal-verbindung-bearbeiten:not(.hidden)", timeout=5000)
        page.locator("#edit-breite").fill(str(changed_width))
        page.locator("#btn-edit-conn-save").click()
        page.wait_for_timeout(180)
        saved_width = float(connection_line.get_attribute("stroke-width") or "0")
        check("Speichern aktualisiert Verbindung atomar", abs(saved_width - changed_width) < 0.001, "%s != %s" % (saved_width, changed_width))

        page.locator("[data-connection-action='edit'][data-connection-id='%s']" % connection_id).click()
        page.wait_for_selector("#modal-verbindung-bearbeiten:not(.hidden)", timeout=5000)
        panel = editor_modal.locator(".modal-content")
        header = editor_modal.locator(".modal-header")
        before_drag = panel.bounding_box()
        header_box = header.bounding_box()
        if header_box:
            page.mouse.move(header_box["x"] + 80, header_box["y"] + 20)
            page.mouse.down()
            page.mouse.move(header_box["x"] + 120, header_box["y"] + 48, steps=4)
            page.mouse.up()
        page.wait_for_timeout(100)
        after_drag = panel.bounding_box()
        moved = bool(before_drag and after_drag and abs(after_drag["x"] - before_drag["x"]) >= 20)
        check("Modal lässt sich verschieben", moved, "%s -> %s" % (before_drag, after_drag))

        editor_modal.locator(".pf-window-center").click()
        page.wait_for_timeout(80)
        centered_transform = panel.evaluate("function (node) { return getComputedStyle(node).transform; }")
        check("Modal lässt sich zentrieren", centered_transform in ("none", "matrix(1, 0, 0, 1, 0, 0)"), centered_transform)
        editor_modal.locator(".pf-window-maximize").click()
        page.wait_for_timeout(80)
        check("Modal lässt sich maximieren", "pf-window-maximized" in (panel.get_attribute("class") or ""))
        editor_modal.locator(".pf-window-maximize").click()
        page.wait_for_timeout(80)
        check("Modal lässt sich wiederherstellen", "pf-window-maximized" not in (panel.get_attribute("class") or ""))
        page.locator("#btn-edit-conn-cancel").click()

        progress("Inspector-Rail prüfen")
        shared.click_tab(page, "elements")
        sidebar = page.locator("#sidebar-right")
        rail_button = page.locator("#btn-right-collapse")
        rail_button.click()
        page.wait_for_timeout(20)
        samples = []
        for wait_time in (0, 35, 120, 260):
            if wait_time:
                page.wait_for_timeout(wait_time)
            samples.append((rail_button.bounding_box(), sidebar.bounding_box(), rail_button.is_visible()))
        rail_ok = all(visible and box_inside(button_box, sidebar_box) for button_box, sidebar_box, visible in samples)
        check("Inspector-Pfeil bleibt während Collapse sichtbar", rail_ok, str(samples))
        check("Inspector-Rail ist 44 px breit", abs((sidebar.bounding_box() or {}).get("width", 0) - 44) <= 1.5, str(sidebar.bounding_box()))
        rail_button.click()
        page.wait_for_timeout(100)
        check("Inspector lässt sich wieder einblenden", "collapsed" not in (sidebar.get_attribute("class") or ""))

        progress("Kontextmenüs und HMI-Workflow prüfen")
        progress("Canvas-Kontextmenü öffnen")
        context_menu_on(page, "#main-canvas", 760, 500)
        canvas_actions = page.locator("#canvas-context-menu [data-context-action]")
        canvas_names = canvas_actions.evaluate_all("function (nodes) { return nodes.map(function (node) { return node.dataset.contextAction; }); }")
        check("Canvas-Kontextmenü vollständig", all(name in canvas_names for name in ("canvas-fit", "canvas-grid", "canvas-snap", "canvas-hmi", "canvas-undo", "canvas-redo")), str(canvas_names))
        page.keyboard.press("Escape")
        check("Kontextmenü schließt per Escape", page.locator("#canvas-context-menu").get_attribute("hidden") is not None)

        progress("Objekt-Kontextmenü öffnen")
        context_menu_on(page, "#elements-layer > #pump_feed", 780, 480)
        object_names = page.locator("#canvas-context-menu [data-context-action]").evaluate_all(
            "function (nodes) { return nodes.map(function (node) { return node.dataset.contextAction; }); }"
        )
        check("Objekt-Kontextmenü vollständig", all(name in object_names for name in ("object-properties", "object-io", "object-hmi-widget", "object-hmi-binding", "object-connect", "object-connections")), str(object_names))
        progress("Objektaktion HMI-Binding ausführen")
        page.locator("#canvas-context-menu [data-context-action='object-hmi-binding']").click(timeout=5000)
        page.wait_for_timeout(250)
        check("Objektaktion öffnet HMI", shared.active_route(page) == "hmi", shared.active_route(page) or "")
        check("Objektaktion öffnet Datenbindung", page.locator(".hmi-workflow-step[data-subtab='bindings']").get_attribute("aria-pressed") == "true")

        progress("HMI-Workflow prüfen")
        workflow_steps = page.locator(".hmi-workflow-step")
        check("Vier HMI-Setup-Schritte sichtbar", workflow_steps.count() == 4, str(workflow_steps.count()))
        workflow_text = " ".join(workflow_steps.all_inner_texts())
        check("HMI-Schritte verständlich benannt", all(label in workflow_text for label in ("Widgets", "Datenbindung", "Zustände & Alarme", "Darstellung")), workflow_text)
        check("Binding-Pipeline sichtbar", page.locator(".hmi-binding-pipeline").is_visible())
        pipeline_text = page.locator(".hmi-binding-pipeline").inner_text()
        check("Binding-Pipeline erklärt Datenfluss", all(label in pipeline_text for label in ("Widget", "P&ID-/SVG-Objekt", "Runtime-Quelle")), pipeline_text)
        page.locator(".hmi-workflow-step[data-subtab='widgets']").click()
        page.wait_for_timeout(100)
        widget_options = page.locator("#hmi-quick-template option").all_inner_texts()
        check("Optionale HMI-Controls erhalten", "Button (optional)" in widget_options and "Toggle (optional)" in widget_options, str(widget_options))
        check("Geführte Navigation vorhanden", page.locator(".hmi-step-navigation").count() == 1)

        progress("Verbindungs-Kontextmenü öffnen")
        shared.click_tab(page, "elements")
        context_menu_on(page, "#connections-layer > .connection-line", 820, 520)
        connection_names = page.locator("#canvas-context-menu [data-context-action]").evaluate_all(
            "function (nodes) { return nodes.map(function (node) { return node.dataset.contextAction; }); }"
        )
        check("Verbindungs-Kontextmenü vollständig", all(name in connection_names for name in ("connection-edit", "connection-from", "connection-to", "connection-delete")), str(connection_names))
        page.keyboard.press("Escape")

        progress("Browserdiagnostik prüfen")
        check("Keine Page-Fehler", len(shared.page_errors) == 0, " | ".join(shared.page_errors[:3]))
        check("Keine Request-Fehler", len(shared.request_failures) == 0, " | ".join(shared.request_failures[:3]))
        check("Keine Konsolenfehler", len(shared.console_errors) == 0, " | ".join(shared.console_errors[:3]))
        print("V62 Browser-Modus: " + ("hermetisch" if embedded_mode else "direkt"))
    finally:
        if browser is not None:
            browser.close()
        playwright.stop()

    print("V62 Browser-Smoke: %d bestanden, %d fehlgeschlagen" % (passed, failed))
    for failure in failures:
        print("  FEHLER " + failure)
    return failed


if __name__ == "__main__":
    raise SystemExit(1 if run() else 0)
