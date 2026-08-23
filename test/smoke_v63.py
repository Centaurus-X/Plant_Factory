#!/usr/bin/env python3
"""Browser verification for Plant Factory V63.4 inherited PF-LOGIC-V1 contracts."""

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
    """Record one deterministic browser assertion."""
    global passed, failed
    if condition:
        passed += 1
        return
    failed += 1
    suffix = " — " + detail if detail else ""
    failures.append(name + suffix)


def progress(message):
    """Print one unbuffered smoke-test checkpoint."""
    print("[v63-smoke] " + message, flush=True)


def context_menu_on(page, selector, x_value, y_value):
    """Open a context menu on one SVG or HTML target."""
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
    page.wait_for_selector("#logic-context-menu:not([hidden])", timeout=5000)


def modal_position(locator):
    """Return the managed modal content position."""
    box = locator.locator(".modal-content").bounding_box()
    if not box:
        return None
    return {"x": round(box["x"], 1), "y": round(box["y"], 1)}


def run():
    """Execute the complete V63.4 browser interaction contract."""
    shared.reset_browser_diagnostics()
    playwright = sync_playwright().start()
    browser = None
    try:
        browser = shared.launch_browser(playwright)
        context = browser.new_context(
            viewport={"width": 1760, "height": 1020},
            device_scale_factor=1,
        )
        progress("Anwendung öffnen")
        page, response_status, embedded_mode = shared.open_application(context, BASE_URL)
        page.set_default_timeout(9000)
        page.wait_for_timeout(900)

        check("HTTP 200", response_status == 200, str(response_status))
        check("Kompatible Nachfolgeversion sichtbar", "V64" in page.title() or "V63.4" in page.title(), page.title())
        release = page.evaluate("function () { return window.__plantFactoryV63 || null; }")
        check("V63 Release-API bereit", bool(release) and release.get("version") == "63.4", str(release))
        check("PF-LOGIC-V1 publiziert", bool(release) and release.get("logicStandard") == "PF-LOGIC-V1", str(release))
        check("Single Source of Truth publiziert", bool(release) and release.get("singleSourceOfTruth") is True, str(release))
        check("Schaltpläne als Inventarkategorie publiziert", bool(release) and release.get("inventoryCategory") == "Schaltpläne", str(release))
        check("33 Logikbausteine publiziert", bool(release) and release.get("blockCount") == 33, str(release))
        check("V62-Verträge geerbt", bool(release) and release.get("inheritedContracts", {}).get("version") == "62.1", str(release))
        styles = shared.loaded_styles(page)
        check("v63.css geladen", "v63.css" in styles, ", ".join(styles))

        progress("Logic-Workspace öffnen")
        page.locator("#workspace-logic-button").click()
        page.wait_for_selector("#logic-workspace:not([hidden])", timeout=7000)
        page.wait_for_timeout(250)
        check("Logic-Workspace aktiv", page.locator("#logic-workspace").is_visible())
        check("Workspace-Kind logic", page.locator("body").get_attribute("data-workspace-kind") == "logic")
        check("Drei Inventarbereiche", page.locator(".logic-inventory-tab").count() == 3)
        inventory_labels = page.locator(".logic-inventory-tab").all_inner_texts()
        check("Inventar sauber kategorisiert", inventory_labels == ["Schaltpläne", "Bausteine", "Signale"], str(inventory_labels))
        check("Vier Inspektorbereiche", page.locator(".logic-inspector-tab").count() == 4)
        check("Leeres additives Modell erlaubt", page.evaluate("function () { return window.__logic.getModel().diagrams.length; }") == 0)

        progress("Timer-/Counter-Demo laden")
        page.locator("#logic-load-demo").click()
        page.wait_for_function(
            "function () { return document.querySelectorAll('#logic-nodes-layer .logic-node').length === 12 "
            "&& document.querySelectorAll('#logic-edges-layer .logic-edge').length === 11; }",
            timeout=10000,
        )
        page.wait_for_timeout(350)
        check("Demo enthält 12 Bausteine", page.locator("#logic-nodes-layer .logic-node").count() == 12)
        check("Demo enthält 11 typisierte Verbindungen", page.locator("#logic-edges-layer .logic-edge").count() == 11)
        check("Demo heißt Timer & Counter Demo", page.locator("#logic-active-title").inner_text().strip() == "Timer & Counter Demo")
        validation = page.evaluate("function () { return window.__logic.validate(); }")
        check("Demo ohne Strukturfehler", len(validation.get("errors", [])) == 0, str(validation.get("errors", [])))
        check("Demograph nicht zyklisch", not any(item.get("code") == "cycle" for item in validation.get("errors", [])), str(validation.get("errors", [])))

        progress("Inventar und Signalkatalog prüfen")
        page.locator(".logic-inventory-tab[data-logic-inventory='blocks']").click()
        page.wait_for_timeout(120)
        check("Bausteinbibliothek vollständig", page.locator(".logic-block-item").count() == 33, str(page.locator(".logic-block-item").count()))
        page.locator(".logic-inventory-tab[data-logic-inventory='signals']").click()
        page.wait_for_timeout(180)
        signal_count = page.locator(".logic-signal-item").count()
        check("Kanonisches Signalinventar gefüllt", signal_count >= 70, str(signal_count))
        signal_text = " ".join(page.locator(".logic-signal-item").all_inner_texts())
        check("V9 Process-State-Signale verfügbar", "v9.state." in signal_text, signal_text[:240])
        check("V9 Sensor-Signale verfügbar", "v9.sensor." in signal_text, signal_text[:240])

        progress("Node-Inspektor und Rechtsklick prüfen")
        first_node = page.locator("#logic-nodes-layer .logic-node").first
        first_node.click(position={"x": 45, "y": 22})
        page.wait_for_timeout(120)
        selected_id = first_node.get_attribute("data-node-id") or ""
        check("Baustein auswählbar", bool(selected_id) and "selected" in (first_node.get_attribute("class") or ""), selected_id)
        check("Inspektor zeigt Bausteinkontext", page.locator("#logic-inspector-title").inner_text().strip() == "Tick" and bool(page.locator("#logic-inspector-context").inner_text().strip()), page.locator("#logic-inspector-context").inner_text())
        context_menu_on(page, "#logic-nodes-layer .logic-node", 920, 430)
        menu_actions = page.locator("#logic-context-menu [data-action]").evaluate_all(
            "function (nodes) { return nodes.map(function (node) { return node.dataset.action; }); }"
        )
        expected_actions = ("node-details", "node-binding", "node-target", "node-connect", "node-duplicate", "node-delete")
        check("Node-Kontextmenü vollständig", all(action in menu_actions for action in expected_actions), str(menu_actions))
        page.keyboard.press("Escape")
        check("Logik-Kontextmenü schließt per Escape", page.locator("#logic-context-menu").get_attribute("hidden") is not None)

        progress("Baustein verschieben")
        before_model = page.evaluate(
            "function (nodeId) { var d = window.__logic.getActiveDiagram(); var n = d.nodes.find(function (item) { return item.node_id === nodeId; }); return { x: n.x, y: n.y }; }",
            selected_id,
        )
        box = first_node.bounding_box()
        if box:
            page.mouse.move(box["x"] + 48, box["y"] + 24)
            page.mouse.down()
            page.mouse.move(box["x"] + 98, box["y"] + 64, steps=5)
            page.mouse.up()
        page.wait_for_timeout(200)
        after_model = page.evaluate(
            "function (nodeId) { var d = window.__logic.getActiveDiagram(); var n = d.nodes.find(function (item) { return item.node_id === nodeId; }); return { x: n.x, y: n.y }; }",
            selected_id,
        )
        moved = before_model != after_model
        check("Baustein interaktiv verschiebbar", moved, "%s -> %s" % (before_model, after_model))
        page.locator("#logic-undo").click()
        page.wait_for_timeout(150)
        restored_model = page.evaluate(
            "function (nodeId) { var d = window.__logic.getActiveDiagram(); var n = d.nodes.find(function (item) { return item.node_id === nodeId; }); return { x: n.x, y: n.y }; }",
            selected_id,
        )
        check("Logik-Undo stellt Position wieder her", restored_model == before_model, "%s != %s" % (restored_model, before_model))

        progress("Compiler und Zielartefakte prüfen")
        artifacts = page.evaluate("function () { return window.__logic.compile(); }")
        check("Universal Runtime erzeugt", artifacts.get("universal", {}).get("schema") == "plant_factory.logic_runtime.v1", str(artifacts.get("universal", {}).get("schema")))
        check("Automation-System-V9 erzeugt", "automation_v9" in artifacts)
        check("V8-Cross-Ausgabe erzeugt", "automation_v8_cross" in artifacts and "report" in artifacts.get("automation_v8_cross", {}))
        check("Siemens SCL erzeugt", "FUNCTION_BLOCK" in artifacts.get("siemens", {}).get("scl", ""))
        check("Bridge statt stiller Fehlübersetzung", len(artifacts.get("automation_v9", {}).get("report", {}).get("bridge_nodes", [])) > 0)
        check("Gesamtcompiler nicht fehlgeschlagen", artifacts.get("report", {}).get("status") != "FAILED", str(artifacts.get("report", {})))

        page.locator("#logic-compile").click()
        page.wait_for_selector("#modal-logic-compile:not(.hidden)", timeout=7000)
        page.wait_for_timeout(160)
        compile_modal = page.locator("#modal-logic-compile")
        check("Compiler öffnet als Modal", compile_modal.is_visible())
        check("Compiler-Modal wird verwaltet", "pf-managed-modal" in (compile_modal.get_attribute("class") or ""))
        check("Compiler-Modal verschiebbar", compile_modal.locator(".pf-window-header").count() == 1)
        check("Compiler-Modal skalierbar", compile_modal.locator(".pf-window-resize-handle").count() == 1)
        summary_text = page.locator("#logic-compile-summary").inner_text()
        check("Compilerzusammenfassung vollständig", all(label in summary_text for label in ("1 Schaltpläne", "12 Bausteine", "11 Verbindungen")), summary_text)
        target_status = " ".join(page.locator(".logic-target-status").all_inner_texts())
        check("Drei Zielprofile ausgewertet", page.locator(".logic-target-status").count() == 3, target_status)
        check("Kein Zielprofil still fehlgeschlagen", "Prüfung fehlgeschlagen" not in target_status, target_status)
        report_preview = page.locator("#logic-compile-preview").inner_text()
        check("Compilerbericht sichtbar", "automation_system_v9" in report_preview and "siemens_scl" in report_preview, report_preview[:200])

        before_position = modal_position(compile_modal)
        header_box = compile_modal.locator(".modal-header").bounding_box()
        if header_box:
            page.mouse.move(header_box["x"] + 120, header_box["y"] + 22)
            page.mouse.down()
            page.mouse.move(header_box["x"] + 170, header_box["y"] + 62, steps=5)
            page.mouse.up()
        page.wait_for_timeout(120)
        after_position = modal_position(compile_modal)
        check("Compiler-Modal interaktiv verschiebbar", before_position != after_position, "%s -> %s" % (before_position, after_position))
        page.locator("#logic-compile-close").click()
        page.wait_for_timeout(100)
        check("Compiler-Modal schließt", "hidden" in (compile_modal.get_attribute("class") or ""))

        progress("Legacy-Workspace-Rückkehr prüfen")
        page.locator("#workspace-rail [data-target-tab='elements']").click()
        page.wait_for_timeout(200)
        check("Plant-Workspace bleibt erreichbar", page.locator("#logic-workspace").get_attribute("hidden") is not None)
        check("Bestehende Canvas-Funktionen bleiben sichtbar", page.locator("#main-canvas").is_visible())

        progress("Browserdiagnostik prüfen")
        check("Keine Page-Fehler", len(shared.page_errors) == 0, " | ".join(shared.page_errors[:3]))
        check("Keine Request-Fehler", len(shared.request_failures) == 0, " | ".join(shared.request_failures[:3]))
        check("Keine Konsolenfehler", len(shared.console_errors) == 0, " | ".join(shared.console_errors[:3]))
        print("V63 Browser-Modus: " + ("hermetisch" if embedded_mode else "direkt"))
    finally:
        if browser is not None:
            browser.close()
        playwright.stop()

    print("V63 Browser-Smoke: %d bestanden, %d fehlgeschlagen" % (passed, failed))
    for failure in failures:
        print("  FEHLER " + failure)
    return failed


if __name__ == "__main__":
    raise SystemExit(1 if run() else 0)
