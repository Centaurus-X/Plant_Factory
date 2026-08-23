#!/usr/bin/env python3
"""Chrome interaction and visual verification for Plant Factory V64_r2."""

import os
import pathlib
import sys

from playwright.sync_api import sync_playwright


TEST_DIR = pathlib.Path(__file__).resolve().parent
if str(TEST_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_DIR))

import smoke_ui as shared


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"
EVIDENCE_DIR = pathlib.Path(os.environ.get("SMOKE_EVIDENCE_DIR", str(TEST_DIR / "screenshots")))
VIEWS = (
    ("cockpit", "Übersicht"),
    ("states", "Prozesse & States"),
    ("rules", "Regeln"),
    ("signals", "Filter & Timer"),
    ("library", "Bibliothek"),
    ("engine", "Engine"),
    ("map", "Geräte-Karte"),
)
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


def collect_console(errors, message):
    """Collect console errors only."""
    if message.type == "error":
        errors.append(message.text)


def collect_page_error(errors, error):
    """Collect uncaught page exceptions."""
    errors.append(str(error))


def collect_request_failure(errors, request):
    """Collect unexpected request failures."""
    failure = request.failure
    errors.append(request.url + " — " + str(failure))


def capture(page, filename):
    """Capture one deterministic Automation Studio viewport."""
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(EVIDENCE_DIR / filename), full_page=False, animations="disabled")


def active_view(page):
    """Return the public Automation Studio view state."""
    return page.evaluate("function () { return window.__v9.automation.state.view; }")


def verify_view(page, view, label):
    """Open and verify one real subnavigation view."""
    button = page.locator("#tab-v9-automation .as-root .subnav button", has_text=label)
    check("Navigation vorhanden: " + label, button.count() == 1, str(button.count()))
    button.click()
    page.wait_for_function(
        "function (expected) { return window.__v9 && window.__v9.automation && window.__v9.automation.state.view === expected; }",
        arg=view,
    )
    check("View aktiv: " + label, active_view(page) == view, active_view(page))
    check(
        "Editorinhalt sichtbar: " + label,
        page.locator("#tab-v9-automation .pane--editor").is_visible()
        and len(page.locator("#tab-v9-automation .pane--editor").inner_text().strip()) > 5,
    )
    capture(page, "V64_r2_Automation_%s.png" % view)


def run():
    """Run the complete R2 browser and visual contract."""
    console_errors = []
    page_errors = []
    request_failures = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=os.environ.get("CHROMIUM_PATH"))
        context = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page, status, embedded = shared.open_application(context, BASE_URL)
        del embedded
        page.set_default_timeout(18000)
        def on_console(message):
            collect_console(console_errors, message)

        def on_page_error(error):
            collect_page_error(page_errors, error)

        def on_request_failed(request):
            collect_request_failure(request_failures, request)

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.on("requestfailed", on_request_failed)
        try:
            check("HTTP 200", status == 200, str(status))
            page.wait_for_function("function () { return !!(window.__v9 && window.__v9.automation && window.__plantFactoryV64R2); }")
            check("R2 Release-API", page.evaluate("function () { return window.__plantFactoryV64R2.version; }") == "64_r2")
            check("R1 Vertrag geerbt", page.evaluate("function () { return window.__plantFactoryV64R1.version; }") == "64_r1")
            check("R2 Titel", any(label in page.title() for label in ("V64_r2", "V64_r3", "V64_r4", "V64_r5", "V64_r6")), page.title())

            page.locator("[data-workspace='automation']").click()
            page.wait_for_selector("#tab-v9-automation.active .as-root")
            check("Automation-Rail öffnet Studio", page.locator("#tab-v9-automation").get_attribute("class").find("active") >= 0)
            labels = page.locator("#tab-v9-automation .as-root .subnav button").evaluate_all(
                "function (nodes) { return nodes.map(function (node) { var label=node.querySelector('span'); return label ? label.textContent.trim() : ''; }); }"
            )
            check("Sieben Studio-Bereiche", labels == [item[1] for item in VIEWS], " | ".join(labels))
            check("Drei Arbeitsbereiche", page.locator("#tab-v9-automation .stage > .pane").count() == 3)

            capture(page, "V64_r2_Automation_cockpit_light.png")
            for view, label in VIEWS:
                verify_view(page, view, label)

            page.evaluate("function () { window.__v9.automation.setView('cockpit'); }")
            page.locator("#theme-toggle").click()
            page.wait_for_timeout(200)
            check("Dark Mode konsistent", page.locator("html").get_attribute("data-theme") == "dark")
            capture(page, "V64_r2_Automation_cockpit_dark.png")
            palette_before = page.locator("html").get_attribute("data-dark-palette")
            page.locator("#palette-toggle").click()
            page.wait_for_timeout(200)
            palette_after = page.locator("html").get_attribute("data-dark-palette")
            check("Dark-Brown umschaltbar", palette_before != palette_after, "%s -> %s" % (palette_before, palette_after))
            capture(page, "V64_r2_Automation_cockpit_brown.png")

            atomic = page.evaluate(
                "function () { var before=window.__v9.store.getState(); var count=window.__v9.getConfig().filters.length; "
                "window.__v9.store.replaceSections({filters:window.__v9.getConfig().filters,not_a_v9_section:[1]}); "
                "var after=window.__v9.store.getState(); return {delta:after.revision-before.revision,count:window.__v9.getConfig().filters.length,foreign:Object.prototype.hasOwnProperty.call(window.__v9.getConfig(),'not_a_v9_section')}; }"
            )
            check("Atomarer Commit genau einmal", atomic["delta"] == 1, str(atomic))
            check("Sektion verlustfrei", atomic["count"] >= 0 and not atomic["foreign"], str(atomic))

            page.set_viewport_size({"width": 1180, "height": 780})
            page.evaluate("function () { window.__v9.automation.setView('states'); }")
            page.wait_for_timeout(220)
            layout = page.evaluate(
                "function () { var root=document.querySelector('#tab-v9-automation .as-root'); var panes=Array.from(root.querySelectorAll('.stage > .pane')); "
                "return {root:root.getBoundingClientRect().width,scroll:root.scrollWidth,visible:panes.filter(function (node) { return getComputedStyle(node).display !== 'none'; }).length}; }"
            )
            check("Responsive ohne Seitenüberlauf", layout["scroll"] <= layout["root"] + 2, str(layout))
            check("Responsive Arbeitsbereiche erreichbar", layout["visible"] >= 1, str(layout))
            capture(page, "V64_r2_Automation_states_responsive.png")

            check("Keine Konsolenfehler", not console_errors, " | ".join(console_errors[:3]))
            check("Keine Seitenfehler", not page_errors, " | ".join(page_errors[:3]))
            check("Keine Requestfehler", not request_failures, " | ".join(request_failures[:3]))
        except Exception as error:
            check("Ausnahme", False, repr(error))
        finally:
            context.close()
            browser.close()

    if FAILED:
        raise AssertionError("V64_r2 browser failures: " + " | ".join(FAILURES))
    print("Plant Factory V64_r2 browser and visual contract passed: %d checks." % PASSED)


if __name__ == "__main__":
    run()
