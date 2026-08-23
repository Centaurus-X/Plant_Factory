#!/usr/bin/env python3
"""Browser regression verification for Plant Factory V63.3."""

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
    print("[v63.3-smoke] " + message, flush=True)


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
        "return line.dataset.renderState === 'ready'; }); }",
        timeout=15000,
    )
    return True


def boxes_do_not_overlap(first, second):
    """Return whether two horizontal layout boxes do not overlap."""
    if not first or not second:
        return False
    first_right = first.get("x", 0) + first.get("width", 0)
    second_right = second.get("x", 0) + second.get("width", 0)
    horizontal_separated = first_right <= second.get("x", 0) or second_right <= first.get("x", 0)
    vertical_separated = (
        first.get("y", 0) + first.get("height", 0) <= second.get("y", 0)
        or second.get("y", 0) + second.get("height", 0) <= first.get("y", 0)
    )
    return horizontal_separated or vertical_separated


def run():
    """Execute all V63.3 browser regressions."""
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
        check(
            "V63.3 UX-Vertrag publiziert",
            bool(release) and release.get("inheritedPatchContract") == "PF-V63.3-HMI-IO-UX",
            str(release),
        )
        check(
            "V63.2 Stabilitätsvertrag geerbt",
            bool(release) and release.get("stabilityContract") == "PF-V63.2-STABILITY",
            str(release),
        )
        check("Generic Sensor publiziert", bool(release) and release.get("genericSensorEntity") is True, str(release))
        check(
            "Expliziter Widget-/Objekt-Workflow publiziert",
            bool(release) and release.get("hmiWidgetObjectWorkflow") == "explicit-one-step",
            str(release),
        )
        styles = shared.loaded_styles(page)
        check("v63_3.css geladen", "v63_3.css" in styles, ", ".join(styles))

        progress("Vollständiges Beispielprojekt laden")
        loaded = open_project(page, "v63_2_komplettbeispiel")
        check("Beispielprojekt geladen", loaded)

        progress("I/O-Aktionsführung und eingeklapptes Register prüfen")
        pump = page.locator("#elements-layer > #pump_feed")
        check("Pumpe auf Canvas vorhanden", pump.count() == 1)
        check("Pumpe anklickbar", shared.click_painted_element(page, pump))
        shared.click_tab(page, "device")
        page.wait_for_function(
            "function () { var select = document.getElementById('device-element-select'); "
            "return select && select.value === 'pump_feed'; }",
            timeout=7000,
        )
        assign_button = page.locator("#device-assign-btn")
        remove_button = page.locator("#device-remove-btn")
        action_row = page.locator(".device-assignment-actions")
        check("Gemeinsame I/O-Aktionszeile sichtbar", action_row.is_visible())
        check("Zuweisung speichern sichtbar", assign_button.is_visible())
        check("Zuweisung entfernen sichtbar", remove_button.is_visible())
        check(
            "Beide Aktionen besitzen denselben Container",
            page.evaluate(
                "function () { var a=document.getElementById('device-assign-btn'); "
                "var r=document.getElementById('device-remove-btn'); "
                "return Boolean(a && r && a.parentElement === r.parentElement "
                "&& a.parentElement.classList.contains('device-assignment-actions')); }"
            ),
        )
        assign_box = assign_button.bounding_box()
        remove_box = remove_button.bounding_box()
        check("I/O-Aktionen überlagern sich nicht", boxes_do_not_overlap(assign_box, remove_box), str((assign_box, remove_box)))
        check(
            "I/O-Aktionen stehen horizontal nebeneinander",
            bool(assign_box and remove_box) and abs(assign_box.get("y", 0) - remove_box.get("y", 0)) < 5,
            str((assign_box, remove_box)),
        )

        toggle = page.locator("#device-assignments-toggle")
        panel = page.locator("#device-assignments-panel")
        check("Zuordnungsregister startet eingeklappt", toggle.get_attribute("aria-expanded") == "false")
        check("Zuordnungstabelle startet verborgen", not panel.is_visible())
        check("Zuordnungszähler zeigt drei Einträge", page.locator("#device-assignments-count").inner_text().strip() == "3")
        shared.capture_evidence(
            page,
            "screenshot_v63_3_io_actions_collapsed.png",
            "V63_3_Screenshot_01_IO_Actions_Collapsed.png",
        )

        progress("Responsives Zuordnungsregister und Generic Sensor prüfen")
        toggle.click()
        page.wait_for_selector("#device-assignments-panel:not([hidden])", timeout=5000)
        check("Zuordnungsregister lässt sich öffnen", toggle.get_attribute("aria-expanded") == "true" and panel.is_visible())
        rows = page.locator(".device-assignment-table__row:not(.device-assignment-table__row--head)")
        check("Drei Zuordnungen sauber gerendert", rows.count() == 3, str(rows.count()))
        column_counts = rows.evaluate_all("function (items) { return items.map(function (row) { return row.children.length; }); }")
        check("Alle Zuordnungszeilen besitzen acht Spalten", all(count == 8 for count in column_counts), str(column_counts))
        head_count = page.locator(".device-assignment-table__row--head > div").count()
        check("Tabellenkopf besitzt acht Spalten", head_count == 8, str(head_count))
        truncate_style = page.locator(".device-assignment-table__truncate").first.evaluate(
            "function (node) { var style=getComputedStyle(node); return {overflow:style.overflow,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace}; }"
        )
        check(
            "Element/Alias verwenden Ellipsis",
            truncate_style.get("overflow") == "hidden"
            and truncate_style.get("textOverflow") == "ellipsis"
            and truncate_style.get("whiteSpace") == "nowrap",
            str(truncate_style),
        )
        title_values = page.locator(".device-assignment-table__truncate").evaluate_all(
            "function (items) { return items.map(function (item) { return item.getAttribute('title') || ''; }); }"
        )
        check("Gekürzte Werte behalten vollständige Tooltips", all(bool(value) for value in title_values), str(title_values))

        search = page.locator("#template-suche")
        search.fill("Generische Sensor-Entität")
        generic = page.locator(".template-item[data-template-id='Generic_Sensor_Entity']")
        page.wait_for_selector(".template-item[data-template-id='Generic_Sensor_Entity']", timeout=7000)
        check("Generic_Sensor_Entity in Bibliothek sichtbar", generic.is_visible())
        check("Bibliothek zeigt den erweiterten Standardbestand", any(count in page.locator("#symbol-standard-badge").inner_text() for count in ("35", "42", "71")))
        generic_category = generic.evaluate(
            "function (node) { var section=node.closest('.template-kategorie'); "
            "var title=section ? section.querySelector('.kategorie-titel span') : null; "
            "return title ? title.textContent.trim() : ''; }"
        )
        check("Generic Sensor ist Messstellen zugeordnet", generic_category == "Messstellen", generic_category)
        check("Generic Sensor trägt PF-PID-V1-Badge", "P&ID V1" in generic.inner_text())
        narrow_layout = page.locator(".device-assignment-table__row:not(.device-assignment-table__row--head)").first.evaluate(
            "function (row) { var head=document.querySelector('.device-assignment-table__row--head'); "
            "return {rowDisplay:getComputedStyle(row).display,headDisplay:head ? getComputedStyle(head).display : ''}; }"
        )
        check("Schmaler Inspector verwendet lesbare Zuordnungskarten", narrow_layout.get("rowDisplay") == "grid" and narrow_layout.get("headDisplay") == "none", str(narrow_layout))
        page.evaluate("function () { document.documentElement.style.setProperty('--sidebar-right-width', '720px'); }")
        page.wait_for_timeout(180)
        page.locator("#device-assignments-toggle").scroll_into_view_if_needed()
        page.wait_for_timeout(120)
        shared.capture_evidence(
            page,
            "screenshot_v63_3_io_register_generic_sensor.png",
            "V63_3_Screenshot_02_IO_Register_Generic_Sensor.png",
        )
        page.evaluate("function () { document.documentElement.style.setProperty('--sidebar-right-width', '360px'); }")
        page.wait_for_timeout(180)

        progress("Expliziten Widget-/Objekt-Workflow prüfen")
        search.fill("")
        shared.click_tab(page, "elements")
        temperature = page.locator("#elements-layer > #temp_reactor")
        check("Temperaturmessstelle auf Canvas vorhanden", temperature.count() == 1)
        check("Temperaturmessstelle anklickbar", shared.click_painted_element(page, temperature))
        shared.click_tab(page, "hmi")
        page.wait_for_selector("#hmi-ui-panel-widgets.active", timeout=7000)
        if page.locator(".hmi-workflow-step[data-subtab='widgets']").get_attribute("aria-selected") != "true":
            page.locator(".hmi-workflow-step[data-subtab='widgets']").click()
            page.wait_for_selector("#hmi-ui-panel-widgets.active", timeout=7000)
        page.wait_for_selector("#hmi-widget-list", timeout=7000)

        child_classes = page.locator("#hmi-ui-panel-widgets").evaluate(
            "function (panelNode) { return Array.from(panelNode.children).slice(0,3).map(function (child) { return child.className; }); }"
        )
        check("Schritt-1-Einleitung steht zuerst", bool(child_classes) and "hmi-step-intro" in child_classes[0], str(child_classes))
        check("Widgetregister steht direkt unter der Einleitung", len(child_classes) > 1 and "hmi-widget-register" in child_classes[1], str(child_classes))
        check("Widgetregister nutzt volle Panelbreite", page.locator(".hmi-widget-register").is_visible())
        headers = page.locator(".hmi-widget-table thead th").all_inner_texts()
        normalized_headers = [value.strip().lower() for value in headers]
        check(
            "Widgettabelle zeigt fünf verständliche Spalten",
            normalized_headers == ["widget", "typ", "p&id-/svg-objekt", "datenquelle / interaktion", "id"],
            str(headers),
        )
        initial_rows = page.locator(".hmi-widget-table tbody tr").count()
        check("Beispiel enthält zwei Widgets", initial_rows == 2, str(initial_rows))
        check("Objekt-Dropdown übernimmt Canvas-Auswahl", page.locator("#hmi-quick-element").input_value() == "temp_reactor")
        check("Objekt-Dropdown enthält alle sechs Canvas-Objekte", page.locator("#hmi-quick-element option").count() == 7)
        create_box = page.locator(".hmi-widget-create-card").bounding_box()
        editor_box = page.locator(".hmi-widget-editor-card").bounding_box()
        check("Widget-Erzeugung und Editor überlagern sich nicht", boxes_do_not_overlap(create_box, editor_box), str((create_box, editor_box)))

        page.locator("#hmi-quick-template").select_option("tpl_indicator")
        page.locator("#hmi-quick-add").click()
        page.wait_for_function(
            "function (count) { return document.querySelectorAll('.hmi-widget-table tbody tr').length === count + 1; }",
            arg=initial_rows,
            timeout=7000,
        )
        check("Explizites Anlegen ergänzt genau ein Widget", page.locator(".hmi-widget-table tbody tr").count() == initial_rows + 1)
        active_row = page.locator(".hmi-widget-table__row--active")
        check("Neu angelegtes Widget ist ausgewählt", active_row.count() == 1)
        active_text = active_row.inner_text()
        check("Widgettabelle zeigt Objektbezug", "temp_reactor" in active_text, active_text)
        check("Widgettabelle zeigt abgeleitete Sensorquelle", "Sensor 1" in active_text, active_text)
        relation = page.locator(".hmi-widget-relation-card")
        check("Widgeteditor zeigt Relationskarte", relation.is_visible())
        relation_text = relation.inner_text()
        check("Relationskarte zeigt P&ID-Objekt", "temp_reactor" in relation_text, relation_text)
        check("Relationskarte zeigt Runtime-Quelle", "Sensor 1" in relation_text, relation_text)
        check("Widget bleibt explizit optional", "Button (optional)" in page.locator("#hmi-quick-template").inner_text())
        page.evaluate("function () { document.documentElement.style.setProperty('--sidebar-right-width', '720px'); }")
        page.wait_for_timeout(180)
        page.locator("#hmi-step-title-widgets").scroll_into_view_if_needed()
        page.wait_for_timeout(120)
        shared.capture_evidence(
            page,
            "screenshot_v63_3_hmi_widget_object_create.png",
            "V63_3_Screenshot_03_HMI_Widget_Object_Create.png",
        )

        progress("Widgetrelation bis zum Bindingeditor verfolgen")
        page.locator("#hmi-w-open-binding").click()
        page.wait_for_selector("#hmi-ui-panel-bindings.active", timeout=7000)
        page.wait_for_selector("#hmi-b-element", timeout=7000)
        check("Relation navigiert zum Binding-Schritt", page.locator(".hmi-workflow-step[data-subtab='bindings']").get_attribute("aria-selected") == "true")
        check("Binding enthält ausgewähltes Objekt", page.locator("#hmi-b-element").input_value() == "temp_reactor")
        check("Binding enthält Sensorquelle", page.locator("#hmi-b-src-kind").input_value() == "sensor")
        check("Binding enthält Sensor-ID 1", page.locator("#hmi-b-src-id").input_value() == "1")
        check("Binding enthält Feld value", page.locator("#hmi-b-src-field").input_value() == "value")
        binding_pipeline = page.locator(".hmi-binding-pipeline").inner_text()
        check(
            "Datenfluss-Pipeline bleibt verständlich",
            "Widget" in binding_pipeline and "P&ID-/SVG-Objekt" in binding_pipeline and "Runtime-Quelle" in binding_pipeline,
            binding_pipeline,
        )
        page.locator("#hmi-step-title-bindings").scroll_into_view_if_needed()
        page.wait_for_timeout(120)
        shared.capture_evidence(
            page,
            "screenshot_v63_3_hmi_widget_relation.png",
            "V63_3_Screenshot_04_HMI_Widget_Relation.png",
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

    print("Plant Factory V63.3 browser regression: %s passed, %s failed." % (passed, failed))
    if failures:
        for failure in failures:
            print("   FAIL " + failure)
    return failed


if __name__ == "__main__":
    raise SystemExit(run())
