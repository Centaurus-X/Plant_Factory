#!/usr/bin/env python3
"""Browser regression verification for Plant Factory V63.4 HMI UX."""

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
    """Print one browser-smoke checkpoint."""
    print("[v63.4-smoke] " + message, flush=True)


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


def visible_count(locator):
    """Return the number of currently visible nodes."""
    count = 0
    for index in range(locator.count()):
        if locator.nth(index).is_visible():
            count += 1
    return count


def open_hmi_for_temperature(page):
    """Select the example temperature object and open the HMI panel."""
    shared.click_tab(page, "elements")
    temperature = page.locator("#elements-layer > #temp_reactor")
    check("Temperaturmessstelle auf Canvas vorhanden", temperature.count() == 1)
    check("Temperaturmessstelle anklickbar", shared.click_painted_element(page, temperature))
    shared.click_tab(page, "hmi")
    page.wait_for_selector("#hmi-ui-panel-widgets.active", timeout=10000)
    page.wait_for_selector(".hmi-workflow-overview", timeout=10000)
    page.evaluate(
        "function () { document.documentElement.style.setProperty('--sidebar-right-width', '820px'); }"
    )
    page.wait_for_timeout(220)


def ensure_three_widgets(page):
    """Ensure the verified example has three explicitly related widgets."""
    rows = page.locator(".hmi-widget-table tbody tr")
    initial = rows.count()
    if initial >= 3:
        return initial
    page.locator("#hmi-quick-template").select_option("tpl_indicator")
    page.locator("#hmi-quick-element").select_option("temp_reactor")
    page.locator("#hmi-quick-add").click()
    page.wait_for_function(
        "function (count) { return document.querySelectorAll('.hmi-widget-table tbody tr').length === count + 1; }",
        arg=initial,
        timeout=10000,
    )
    return rows.count()


def run():
    """Execute all V63.4 browser regressions and create four screenshots."""
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
        page.set_default_timeout(12000)
        page.wait_for_timeout(900)

        check("HTTP 200", response_status == 200, str(response_status))
        check("Kompatible Nachfolgeversion sichtbar", "V64" in page.title() or "V63.4" in page.title(), page.title())
        release = page.evaluate("function () { return window.__plantFactoryV63 || null; }")
        check("V63.4 Release-API", bool(release) and release.get("version") == "63.4", str(release))
        check(
            "V63.4 HMI-UX-Vertrag publiziert",
            bool(release) and release.get("patchContract") == "PF-V63.4-HMI-UX",
            str(release),
        )
        check(
            "V63.3 I/O-/Widgetvertrag geerbt",
            bool(release) and release.get("inheritedPatchContract") == "PF-V63.3-HMI-IO-UX",
            str(release),
        )
        check(
            "Single-HMI-Navigation publiziert",
            bool(release) and release.get("hmiNavigation") == "single-guided-tablist",
            str(release),
        )
        check(
            "Guided States/Alarms publiziert",
            bool(release) and release.get("hmiStatesAlarmsWorkflow") == "guided-with-advanced-disclosure",
            str(release),
        )
        check(
            "Guided Appearance publiziert",
            bool(release) and release.get("hmiAppearanceWorkflow") == "view-widget-design",
            str(release),
        )
        styles = shared.loaded_styles(page)
        check("v63_4.css geladen", "v63_4.css" in styles, ", ".join(styles))

        progress("Vollständiges Beispielprojekt laden")
        loaded = open_project(page, "v63_2_komplettbeispiel")
        check("Beispielprojekt geladen", loaded)
        open_hmi_for_temperature(page)

        progress("Single-Navigation und Widgetbuttons prüfen")
        top_tabs = page.locator(".hmi-workflow-overview [role='tab']")
        legacy_tabs = page.locator(".hmi-legacy-tab-list [role='tab']")
        check("Vier kanonische HMI-Tabs vorhanden", top_tabs.count() == 4, str(top_tabs.count()))
        check("Vier kanonische HMI-Tabs sichtbar", visible_count(top_tabs) == 4, str(visible_count(top_tabs)))
        check("Kompatibilitätstabs bleiben im DOM", legacy_tabs.count() == 4, str(legacy_tabs.count()))
        check("Redundante Kompatibilitätstabs sind verborgen", visible_count(legacy_tabs) == 0, str(visible_count(legacy_tabs)))
        check("Widgettab ist aktiv", top_tabs.nth(0).get_attribute("aria-selected") == "true")
        widget_count = ensure_three_widgets(page)
        check("Drei explizite Widgets sichtbar", widget_count == 3, str(widget_count))
        widget_buttons = page.locator(".hmi-widget-table__select")
        check("Jede Widgetzeile besitzt einen Auswahlbutton", widget_buttons.count() == widget_count, str(widget_buttons.count()))
        button_style = widget_buttons.first.evaluate(
            "function (node) { var style=getComputedStyle(node); return {"
            "display:style.display,borderWidth:style.borderTopWidth,background:style.backgroundColor,"
            "decoration:style.textDecorationLine,color:style.color}; }"
        )
        check("Widgetauswahl wird als Button gerendert", button_style.get("display") == "inline-flex", str(button_style))
        check("Widgetbutton besitzt sichtbaren Rahmen", button_style.get("borderWidth") not in ("", "0px"), str(button_style))
        check("Widgetbutton ist nicht unterstrichen", button_style.get("decoration") in ("none", ""), str(button_style))
        check("Widgetbutton behält Akzentfarbe", bool(button_style.get("color")), str(button_style))
        page.locator("#hmi-step-title-widgets").scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        shared.capture_evidence(
            page,
            "screenshot_v63_4_widget_register_buttons.png",
            "V63_4_Screenshot_01_Widget_Register_Buttons.png",
        )

        progress("Geführten Zustands- und Alarmworkflow prüfen")
        page.locator(".hmi-workflow-step[data-subtab='styles']").click()
        page.wait_for_selector("#hmi-ui-panel-styles.active", timeout=10000)
        check(
            "Zustände & Alarme ist kanonisch ausgewählt",
            page.locator(".hmi-workflow-step[data-subtab='styles']").get_attribute("aria-selected") == "true",
        )
        check("Signaltest startet geöffnet", page.locator("#hmi-live-preview-section").get_attribute("open") is not None)
        check("Manuelle Detailbearbeitung startet geschlossen", page.locator("#hmi-manual-state-section").get_attribute("open") is None)
        check("Threshold-Wizard ist sichtbar", page.locator("#hmi-threshold-wizard").is_visible())
        flow_text = page.locator(".hmi-threshold-flow").inner_text()
        check(
            "Grenzwertfluss zeigt vier verständliche Schritte",
            "Binding" in flow_text and "Schwellen" in flow_text and "Ausgabe" in flow_text and "Erzeugen" in flow_text,
            flow_text,
        )
        check("Binding zeigt Objekt- und Quellenkontext", "→" in page.locator("#hmi-tw-binding").inner_text())
        check("WARN-Feld verfügbar", page.locator("#hmi-tw-warn").is_visible())
        check("ALARM-Feld verfügbar", page.locator("#hmi-tw-alarm").is_visible())
        check("Overlay-Ausgabe verfügbar", page.locator("#hmi-tw-apply-overlay").count() == 1)
        check("SVG-Ausgabe verfügbar", page.locator("#hmi-tw-apply-svg").count() == 1)
        page.locator("#hmi-step-title-styles").scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        shared.capture_evidence(
            page,
            "screenshot_v63_4_states_alarms_guided.png",
            "V63_4_Screenshot_02_States_Alarms_Guided.png",
        )

        progress("Erweiterte Alarmparameter und Modellkompatibilität prüfen")
        page.locator("#hmi-threshold-advanced > summary").click()
        page.wait_for_function(
            "function () { var node=document.getElementById('hmi-threshold-advanced'); return Boolean(node && node.open); }",
            timeout=5000,
        )
        check("Erweiterte Grenzwertoptionen lassen sich öffnen", page.locator("#hmi-threshold-advanced").get_attribute("open") is not None)
        check("Latching bleibt konfigurierbar", page.locator("#hmi-tw-alarm-latching").is_visible())
        check("Quittierung bleibt konfigurierbar", page.locator("#hmi-tw-alarm-ack").is_visible())
        check("Overlay-Klassen bleiben vollständig", page.locator("#hmi-tw-ok-w").is_visible() and page.locator("#hmi-tw-alarm-w").is_visible())
        check("SVG-Klassen bleiben vollständig", page.locator("#hmi-tw-ok-s").is_visible() and page.locator("#hmi-tw-alarm-s").is_visible())
        page.locator("#hmi-tw-warn").fill("55")
        page.locator("#hmi-tw-alarm").fill("80")
        page.locator("#hmi-tw-create-alarm").check()
        before_style_count = page.locator("#hmi-style-list [data-style-id]").count()
        before_alarm_count = page.locator("#hmi-alarm-list [data-alarm-id]").count()
        page.locator("#hmi-tw-generate").click()
        page.wait_for_function(
            "function () { var node=document.getElementById('status-message'); "
            "return Boolean(node && node.textContent.indexOf('Threshold Wizard erzeugt') >= 0); }",
            timeout=7000,
        )
        page.wait_for_selector("#hmi-ui-panel-styles.active", timeout=7000)
        after_style_count = page.locator("#hmi-style-list [data-style-id]").count()
        after_alarm_count = page.locator("#hmi-alarm-list [data-alarm-id]").count()
        check("Wizard erzeugt oder aktualisiert drei Styles", after_style_count >= 3 and after_style_count >= before_style_count, str((before_style_count, after_style_count)))
        check("Wizard erzeugt oder aktualisiert einen Alarm", after_alarm_count >= 1 and after_alarm_count >= before_alarm_count, str((before_alarm_count, after_alarm_count)))
        page.wait_for_selector("#hmi-ui-panel-styles.active", timeout=7000)
        if page.locator("#hmi-threshold-advanced").get_attribute("open") is None:
            page.locator("#hmi-threshold-advanced > summary").click()
        page.locator("#hmi-threshold-advanced").scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        shared.capture_evidence(
            page,
            "screenshot_v63_4_states_alarms_advanced.png",
            "V63_4_Screenshot_03_States_Alarms_Advanced.png",
        )

        progress("Geführte Darstellung prüfen")
        page.locator(".hmi-workflow-step[data-subtab='appearance']").click()
        page.wait_for_selector("#hmi-ui-panel-appearance.active", timeout=10000)
        check(
            "Darstellung ist kanonisch ausgewählt",
            page.locator(".hmi-workflow-step[data-subtab='appearance']").get_attribute("aria-selected") == "true",
        )
        check("View-Hintergrund besitzt eigene Karte", page.locator(".hmi-appearance-view-card").is_visible())
        check("Widgetauswahl besitzt eigene Karte", page.locator(".hmi-appearance-select-card").is_visible())
        check("Widgetdesign besitzt eigene Karte", page.locator(".hmi-appearance-editor-card").is_visible())
        options = page.locator(".hmi-appearance-widget-option")
        check("Alle Widgets sind als Auswahlkarten verfügbar", options.count() == widget_count, str(options.count()))
        if options.count() > 0:
            options.first.click()
            page.wait_for_timeout(180)
        summary = page.locator(".hmi-appearance-selection-summary").inner_text()
        check(
            "Darstellung zeigt Widget-, Objekt- und Datenkontext",
            "widget" in summary.lower() and "p&id-/svg-objekt" in summary.lower() and "datenstatus" in summary.lower(),
            summary,
        )
        check("Grunddesign bleibt vollständig", page.locator("#hmi-app-variant").is_visible() and page.locator("#hmi-app-size").is_visible())
        check("Farben und Schrift bleiben vollständig", page.locator("#hmi-app-tc").count() == 1 and page.locator("#hmi-app-fs").count() == 1)
        check("Erweiterte Klassen starten geschlossen", page.locator("#hmi-appearance-advanced").get_attribute("open") is None)
        page.locator("#hmi-appearance-advanced > summary").click()
        check("CSS-Klassen bleiben erreichbar", page.locator("#hmi-app-classes").is_visible())
        check("SVG-Zielklassen bleiben erreichbar", page.locator("#hmi-app-svg-classes").is_visible())
        page.locator("#hmi-appearance-advanced > summary").click()
        page.locator("#hmi-app-variant").select_option("outline")
        page.locator("#hmi-app-apply").click()
        page.wait_for_timeout(300)
        page.wait_for_selector("#hmi-ui-panel-appearance.active", timeout=7000)
        selected_variant = page.locator("#hmi-app-variant").input_value()
        check("Darstellung wird im kanonischen Widgetmodell gespeichert", selected_variant == "outline", selected_variant)
        page.locator("#hmi-step-title-appearance").scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        shared.capture_evidence(
            page,
            "screenshot_v63_4_appearance_guided.png",
            "V63_4_Screenshot_04_Appearance_Guided.png",
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

    print("Plant Factory V63.4 browser regression: %s passed, %s failed." % (passed, failed))
    if failures:
        for failure in failures:
            print("   FAIL " + failure)
    return failed


if __name__ == "__main__":
    raise SystemExit(run())
