#!/usr/bin/env python3
"""Browser regression verification for Plant Factory V64."""

import pathlib
import sys

import traceback
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
    print("[v64-smoke] " + message, flush=True)


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
    check("V63.2-Kompatibilitätsprojekt in Projektliste", index >= 0, project_name)
    if index < 0:
        return False
    page.locator("#projekt-liste .projekt-item").nth(index).click()
    page.wait_for_function(
        "function () { return document.querySelectorAll('#elements-layer > .svg-element').length === 6 "
        "&& document.querySelectorAll('#connections-layer > .connection-line').length === 5; }",
        timeout=15000,
    )
    return True


def open_hmi_styles(page):
    """Open the guided HMI state and animation step for one SVG object."""
    shared.click_tab(page, "elements")
    temperature = page.locator("#elements-layer > #temp_reactor")
    check("Temperaturmessstelle auf Canvas vorhanden", temperature.count() == 1)
    check("Temperaturmessstelle anklickbar", shared.click_painted_element(page, temperature))
    shared.click_tab(page, "hmi")
    page.wait_for_selector("#hmi-ui-panel-widgets.active", timeout=10000)
    page.evaluate(
        "function () { document.documentElement.style.setProperty('--sidebar-right-width', '900px'); }"
    )
    page.locator(".hmi-workflow-step[data-subtab='styles']").click()
    page.wait_for_selector("#hmi-ui-panel-styles.active", timeout=10000)
    page.wait_for_selector(".hmi-event-animation-designer", timeout=10000)


def read_hmi_animations(page):
    """Read the persisted event-animation model through the application module."""
    return page.evaluate(
        "async function () { "
        "var core = await import('/public/js/core.js'); "
        "var model = core.state.get('hmi') || {}; "
        "return model.event_animations || []; "
        "}"
    )


def verify_event_runtime(page):
    """Dispatch one general SVG event and return its observable runtime state."""
    return page.evaluate(
        "async function () { "
        "var core = await import('/public/js/core.js'); "
        "var runtimeModule = await import('/public/js/svg_event_runtime.js'); "
        "var model = core.state.get('hmi') || {}; "
        "var root = document.getElementById('main-canvas'); "
        "var runtime = runtimeModule.createSvgEventRuntime({svgRoot: root, hmiUi: model}); "
        "var matched = runtime.dispatch('heating_started', "
        "{element_id: 'temp_reactor', active: true}); "
        "var active = root.querySelectorAll('[data-pf-event-animation-active]').length; "
        "runtime.dispatch('heating_started', "
        "{element_id: 'temp_reactor', active: false}); "
        "var cleared = root.querySelectorAll('[data-pf-event-animation-active]').length; "
        "var validation = runtime.validate(); "
        "runtime.destroy(); "
        "return {matched: matched, active: active, cleared: cleared, validation: validation}; "
        "}"
    )


def run():
    """Execute V64 drawing, animation and compatibility regressions."""
    global failed
    shared.reset_browser_diagnostics()
    playwright = sync_playwright().start()
    browser = None
    try:
        browser = shared.launch_browser(playwright)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            device_scale_factor=1,
            accept_downloads=True,
        )
        page, response_status, embedded_mode = shared.open_application(context, BASE_URL)
        page.set_default_timeout(12000)
        page.wait_for_timeout(900)

        check("HTTP 200", response_status == 200, str(response_status))
        check("Version V64 sichtbar", "V64" in page.title(), page.title())
        release = page.evaluate("function () { return window.__plantFactoryV64 || null; }")
        check("V64 Release-API", bool(release) and release.get("version") == "64", str(release))
        check(
            "V64 Event-/Zeichenvertrag publiziert",
            bool(release) and release.get("patchContract") == "PF-V64-SVG-EVENT-DRAWING",
            str(release),
        )
        check(
            "V63.4 HMI-Vertrag geerbt",
            bool(release) and release.get("inheritedPatchContract") == "PF-V63.4-HMI-UX",
            str(release),
        )
        check(
            "Zehn Eventeffekte publiziert",
            bool(release) and len(release.get("eventEffects", [])) == 10,
            str(release),
        )
        styles = shared.loaded_styles(page)
        check("v64.css geladen", "v64.css" in styles, ", ".join(styles))

        progress("Elementaren Anlagen-Zeicheneditor prüfen")
        page.locator("#workspace-plant-drawing-button").click()
        page.wait_for_selector("#plant-drawing-workspace:not([hidden])", timeout=10000)
        check("Zeicheneditor sichtbar", page.locator("#plant-drawing-workspace").is_visible())
        check(
            "35 Inventar-Templates sichtbar",
            page.locator("#plant-drawing-template-palette .plant-drawing-template-card").count() >= 35,
            str(page.locator("#plant-drawing-template-palette .plant-drawing-template-card").count()),
        )
        palette_text = page.locator("#plant-drawing-template-palette").inner_text()
        check("Rohrleitung im Inventar", "Rohrleitung" in palette_text, palette_text[:300])
        check("Rohrreaktor im Inventar", "Rohrreaktor" in palette_text, palette_text[:300])
        check("Rohrofen im Inventar", "Rohrofen" in palette_text, palette_text[:300])
        check("Doppelrohr-Kühler im Inventar", "Doppelrohr-Kühler" in palette_text, palette_text[:300])

        page.locator("#plant-drawing-demo").click()
        page.wait_for_function(
            "function () { return document.querySelectorAll('.plant-drawing-entity').length === 7 "
            "&& document.querySelectorAll('.plant-drawing-connection').length === 4; }",
            timeout=10000,
        )
        drawing_report = page.evaluate(
            "function () { return window.PlantFactoryV64Drawing.validate(); }"
        )
        check("Rohrofen-Beispiel fehlerfrei", drawing_report.get("valid") is True, str(drawing_report))
        check(
            "Sieben elementare Geräte gezeichnet",
            drawing_report.get("counts", {}).get("entities") == 7,
            str(drawing_report),
        )

        first_entity = page.locator(".plant-drawing-entity").first
        first_entity.click(force=True)
        page.wait_for_selector(".plant-drawing-entity.is-selected", timeout=5000)
        check("Komponenteninspektor sichtbar", page.locator("#drawing-name").is_visible())
        page.locator("#drawing-name").fill("Eduktversorgung B-101")
        page.locator("#drawing-rotation").fill("15")
        page.get_by_role("button", name="Eigenschaften übernehmen").click()
        page.wait_for_function(
            "function () { var model=window.PlantFactoryV64Drawing.getModel(); "
            "return model.sheets[0].entities.some(function (item) { "
            "return item.name === 'Eduktversorgung B-101' && item.rotation === 15; }); }",
            timeout=5000,
        )
        preview_svg = page.evaluate(
            "function () { return window.PlantFactoryV64Drawing.exportSelectionSvg(); }"
        )
        check("Auswahlvorschau ist eigenständiges SVG", preview_svg.startswith("<svg"), preview_svg[:80])
        check("Vorschau enthält Zeichenmetadaten", "plant-factory.plant-drawing-selection" in preview_svg)
        check("Inventaraktionen vorhanden", page.locator("#plant-drawing-save-inventory").is_visible()
              and page.locator("#plant-drawing-use-in-plant").is_visible())

        page.locator("[data-drawing-tool='connect']").click()
        page.wait_for_selector(".plant-drawing-port[data-port-id='service_in']", timeout=5000)
        before_connections = page.locator(".plant-drawing-connection").count()
        page.locator(".plant-drawing-port[data-port-id='service_in']").click()
        page.locator(".plant-drawing-port[data-port-id='inlet']").click()
        page.wait_for_function(
            "function (count) { return document.querySelectorAll('.plant-drawing-connection').length "
            "=== count + 1; }",
            arg=before_connections,
            timeout=5000,
        )
        check(
            "Freie Flansch-/Geräteports per UI verbunden",
            page.locator(".plant-drawing-connection").count() == before_connections + 1,
        )
        check(
            "Verbindungsmodell bleibt valide",
            page.evaluate("function () { return window.PlantFactoryV64Drawing.validate().valid; }"),
        )

        with page.expect_download() as svg_download_info:
            page.locator("#plant-drawing-export-svg").click()
        svg_download = svg_download_info.value
        svg_text = pathlib.Path(svg_download.path()).read_text(encoding="utf-8")
        check("SVG-Export enthält sieben Entities", svg_text.count("data-entity-id=") >= 7)
        check("SVG-Export enthält semantische Metadaten", "plant-factory.plant-drawing-selection" in svg_text)
        with page.expect_download() as json_download_info:
            page.locator("#plant-drawing-export-json").click()
        json_text = pathlib.Path(json_download_info.value.path()).read_text(encoding="utf-8")
        check("JSON-Export enthält Zeichenvertrag", "plant-factory.plant-drawing" in json_text)

        shared.capture_evidence(
            page,
            "screenshot_v64_plant_drawing.png",
            "V64_Screenshot_01_Anlagen_Zeicheneditor.png",
        )

        progress("Allgemeine SVG-Eventanimation im HMI prüfen")
        loaded = open_project(page, "v63_2_komplettbeispiel")
        check("Kompatibilitätsprojekt geladen", loaded)
        open_hmi_styles(page)
        designer = page.locator(".hmi-event-animation-designer")
        check("Animationsdesigner sichtbar", designer.is_visible())
        check(
            "Zehn intuitive Presets sichtbar",
            page.locator(".hmi-event-preset-card").count() == 10,
            str(page.locator(".hmi-event-preset-card").count()),
        )
        page.locator(".hmi-event-preset-card[data-preset='color_fill']").click()
        page.wait_for_selector("#hmi-event-name", timeout=5000)
        check("Signal-/Ereignisauswahl verfügbar", page.locator("#hmi-event-trigger-type").is_visible())
        check("Semantisches SVG-Ziel verfügbar", page.locator("#hmi-event-part").is_visible())
        page.locator("#hmi-event-name").fill("Reaktortemperatur Farbe")
        page.locator("#hmi-event-trigger-type").select_option("event")
        page.locator("#hmi-event-event-name").fill("heating_started")
        page.locator("#hmi-event-target").select_option("temp_reactor")
        part_options = page.locator("#hmi-event-part option")
        if part_options.count() > 1:
            part_value = part_options.nth(1).get_attribute("value")
            page.locator("#hmi-event-part").select_option(part_value)
        page.locator("#hmi-event-color").fill("#ff5a36")
        page.locator(".hmi-event-editor-actions .btn-primary").click()
        page.wait_for_function(
            "async function () { var core=await import('/public/js/core.js'); "
            "var model=core.state.get('hmi') || {}; "
            "return (model.event_animations || []).some(function (rule) { "
            "return rule.name === 'Reaktortemperatur Farbe'; }); }",
            timeout=5000,
        )
        status_text = page.locator("#status-message").inner_text()
        check("Speicherbestätigung sichtbar",
              "SVG-Ereignisanimation gespeichert" in status_text, status_text)
        rules = read_hmi_animations(page)
        check("Animation im HMI-Modell gespeichert", len(rules) == 1, str(rules))
        check("Allgemeines Ereignis gekoppelt", rules[0]["trigger"]["event_name"] == "heating_started")
        check("Elementares SVG-Objekt gekoppelt", rules[0]["target"]["element_id"] == "temp_reactor")
        check("Farbanimation gespeichert", rules[0]["effect"]["preset"] == "color_fill")

        page.get_by_role("button", name="Am SVG testen").click()
        page.wait_for_function(
            "function () { var node=document.getElementById('status-message'); "
            "return Boolean(node && node.textContent.indexOf('Animation wird') >= 0); }",
            timeout=5000,
        )
        runtime_result = verify_event_runtime(page)
        check("dispatchSvgEvent trifft die gespeicherte Regel", runtime_result.get("matched") == 1,
              str(runtime_result))
        check("Event aktiviert ein reales SVG-Unterelement", runtime_result.get("active", 0) >= 1,
              str(runtime_result))
        check("Event-Deaktivierung räumt den Effekt sauber auf", runtime_result.get("cleared") == 0,
              str(runtime_result))
        check("Runtimevertrag validiert fehlerfrei",
              runtime_result.get("validation", {}).get("valid") is True, str(runtime_result))

        page.locator(".hmi-event-preset-card[data-preset='flow']").click()
        page.wait_for_function(
            "function () { return document.querySelectorAll('.hmi-event-rule-option').length === 2; }",
            timeout=5000,
        )
        check("Mehrere Animationen intuitiv kombinierbar",
              page.locator(".hmi-event-rule-option").count() == 2)
        page.locator(".hmi-event-animation-designer").scroll_into_view_if_needed()
        page.wait_for_timeout(250)
        shared.capture_evidence(
            page,
            "screenshot_v64_event_animation.png",
            "V64_Screenshot_02_SVG_Event_Animation.png",
        )

        check("Keine Page-Fehler", len(shared.page_errors) == 0,
              " | ".join(shared.page_errors[:5]))
        check("Keine Request-Fehler", len(shared.request_failures) == 0,
              " | ".join(shared.request_failures[:5]))
        check("Keine Konsolenfehler", len(shared.console_errors) == 0,
              " | ".join(shared.console_errors[:5]))
        check("Hermetischer Modus zulässig", embedded_mode in (True, False), str(embedded_mode))

    except Exception as error:
        failures.append("Ausnahme — " + repr(error) + "\n" + traceback.format_exc())
        failed += 1
    finally:
        if browser is not None:
            browser.close()
        playwright.stop()

    print("Plant Factory V64 browser regression: %s passed, %s failed." % (passed, failed))
    if failures:
        for failure in failures:
            print("   FAIL " + failure)
    return failed


if __name__ == "__main__":
    raise SystemExit(run())
