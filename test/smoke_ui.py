#!/usr/bin/env python3
"""Browser smoke test for the Plant Factory V63.4 workspace."""

import base64
from functools import partial
import os
import pathlib
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST_DIR = PROJECT_ROOT / "test"
EVIDENCE_DIR = PROJECT_ROOT / "release_evidence"
SMOKE_OUTPUT_DIR = pathlib.Path(os.environ.get("SMOKE_OUTPUT_DIR", str(TEST_DIR)))
SMOKE_EVIDENCE_DIR = pathlib.Path(os.environ.get("SMOKE_EVIDENCE_DIR", str(EVIDENCE_DIR)))
ADMIN_BLOCK_MARKER = "ERR_BLOCKED_BY_ADMINISTRATOR"
GLOBAL_TABS = (
    "v9-automation",
    "processes",
    "rules",
    "v9-states",
    "v9-rules",
    "v9-topology",
    "v9-cross",
    "v9-validate",
    "export",
)
CANVAS_TABS = ("elements", "device", "hmi", "connections")

passed = 0
failed = 0
failures = []
console_errors = []
page_errors = []
request_failures = []


def progress(message):
    """Print one unbuffered browser-smoke checkpoint."""
    print('[browser-smoke] ' + message, flush=True)

HARNESS_SHIM = r"""
(function () {
  'use strict';

  function createStorage() {
    var data = Object.create(null);
    var storage = {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) {
        data[key] = String(value);
      },
      removeItem: function (key) {
        delete data[key];
      },
      clear: function () {
        Object.keys(data).forEach(function (key) { delete data[key]; });
      },
      key: function (index) {
        return Object.keys(data)[index] || null;
      }
    };
    Object.defineProperty(storage, 'length', {
      configurable: false,
      enumerable: true,
      get: function () { return Object.keys(data).length; }
    });
    return storage;
  }

  function encodeBytes(bytes) {
    var binary = '';
    var index = 0;
    for (index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }

  function decodeBytes(encoded) {
    var binary = atob(encoded || '');
    var output = new Uint8Array(binary.length);
    var index = 0;
    for (index = 0; index < binary.length; index += 1) {
      output[index] = binary.charCodeAt(index);
    }
    return output;
  }

  async function encodeBody(body) {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string') return encodeBytes(new TextEncoder().encode(body));
    if (body instanceof URLSearchParams) {
      return encodeBytes(new TextEncoder().encode(body.toString()));
    }
    return encodeBytes(new Uint8Array(await new Response(body).arrayBuffer()));
  }

  Object.defineProperty(window, 'localStorage', {
    value: createStorage(),
    configurable: true
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: createStorage(),
    configurable: true
  });

  window.fetch = async function (input, init) {
    var requestInit = init || {};
    var url = typeof input === 'string' ? input : input.url;
    var method = requestInit.method
      || (typeof input === 'string' ? 'GET' : input.method)
      || 'GET';
    var sourceHeaders = requestInit.headers
      || (typeof input === 'string' ? {} : input.headers)
      || {};
    var headers = {};
    new Headers(sourceHeaders).forEach(function (value, key) {
      headers[key] = value;
    });
    var result = await window.__v61HostFetch({
      url: url,
      method: method,
      headers: headers,
      body: await encodeBody(requestInit.body)
    });
    return new Response(decodeBytes(result.body), {
      status: result.status,
      headers: result.headers || {}
    });
  };
})();
"""


def check(name, condition, detail=""):
    """Record one deterministic assertion."""
    global passed, failed
    if condition:
        passed += 1
        return
    failed += 1
    suffix = " — " + detail if detail else ""
    failures.append(name + suffix)


def on_console(message):
    """Collect browser errors while allowing ordinary diagnostics."""
    if message.type == "error":
        console_errors.append(message.text)


def on_page_error(error):
    """Collect uncaught page exceptions."""
    page_errors.append(str(error))


def on_request_failed(request):
    """Collect failed network requests."""
    request_failures.append(request.url + " :: " + (request.failure or "unknown"))


def reset_browser_diagnostics():
    """Discard diagnostics from an administratively blocked navigation."""
    console_errors.clear()
    page_errors.clear()
    request_failures.clear()


def launch_browser(playwright):
    """Use an explicit browser when supplied and a system fallback otherwise."""
    explicit = os.environ.get("CHROMIUM_PATH", "").strip()
    options = {
        "headless": True,
        "args": ["--no-sandbox", "--disable-dev-shm-usage"],
    }
    trusted_origin = os.environ.get("SMOKE_TRUSTED_INSECURE_ORIGIN", "").strip()
    if trusted_origin:
        options["args"].append("--unsafely-treat-insecure-origin-as-secure=" + trusted_origin)
    if explicit:
        options["executable_path"] = explicit
        return playwright.chromium.launch(**options)

    try:
        return playwright.chromium.launch(**options)
    except PlaywrightError:
        system_path = pathlib.Path("/usr/bin/chromium")
        if not system_path.is_file():
            raise
        options["executable_path"] = str(system_path)
        return playwright.chromium.launch(**options)


def create_page(context):
    """Create one instrumented browser page."""
    page = context.new_page()
    page.on("console", on_console)
    page.on("pageerror", on_page_error)
    page.on("requestfailed", on_request_failed)
    return page


def normalize_base_url(value):
    """Return a normalized HTTP base URL without a trailing slash."""
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Invalid smoke-test base URL: " + value)
    return value.rstrip("/")


def fetch_http_status(base_url):
    """Verify server reachability outside the browser sandbox."""
    request = urllib.request.Request(base_url + "/", headers={"Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=10) as response:
        response.read(1)
        return int(response.status)


def forwarded_headers(headers):
    """Remove transport-specific request headers before host forwarding."""
    blocked = {
        "connection",
        "content-length",
        "host",
        "origin",
        "proxy-authorization",
        "proxy-connection",
        "transfer-encoding",
    }
    return {
        str(key): str(value)
        for key, value in dict(headers or {}).items()
        if str(key).lower() not in blocked
    }


def host_fetch(base_url, payload):
    """Forward one browser fetch through the host process to the local server."""
    normalized = normalize_base_url(base_url)
    target = urllib.parse.urljoin(normalized + "/", str(payload.get("url") or ""))
    expected = urllib.parse.urlsplit(normalized)
    actual = urllib.parse.urlsplit(target)
    expected_port = expected.port or (443 if expected.scheme == "https" else 80)
    actual_port = actual.port or (443 if actual.scheme == "https" else 80)
    if (
        actual.scheme != expected.scheme
        or actual.hostname != expected.hostname
        or actual_port != expected_port
    ):
        raise ValueError("Browser harness rejected external target: " + target)

    encoded_body = payload.get("body")
    body = base64.b64decode(encoded_body) if encoded_body else None
    request = urllib.request.Request(
        target,
        data=body,
        method=str(payload.get("method") or "GET").upper(),
    )
    for key, value in forwarded_headers(payload.get("headers")).items():
        request.add_header(key, value)

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response_body = response.read()
            return {
                "status": int(response.status),
                "headers": dict(response.headers.items()),
                "body": base64.b64encode(response_body).decode("ascii"),
            }
    except urllib.error.HTTPError as error:
        return {
            "status": int(error.code),
            "headers": dict(error.headers.items()),
            "body": base64.b64encode(error.read()).decode("ascii"),
        }


def build_browser_harness(target_directory):
    """Build the in-memory equivalent of the production HTML module graph."""
    command = [
        "node",
        str(TEST_DIR / "build_browser_harness.cjs"),
        str(target_directory),
    ]
    subprocess.run(command, cwd=PROJECT_ROOT, check=True)
    html_path = target_directory / "index.html"
    bundle_path = target_directory / "bundle.js"
    if not html_path.is_file() or not bundle_path.is_file():
        raise RuntimeError("Hermetic browser harness did not produce its outputs.")
    return html_path, bundle_path


def load_embedded_application(page, base_url):
    """Load the real UI without browser navigation or browser-side networking."""
    status = fetch_http_status(base_url)
    with tempfile.TemporaryDirectory(prefix="v61_browser_harness_") as temp_name:
        target = pathlib.Path(temp_name)
        html_path, bundle_path = build_browser_harness(target)
        html = html_path.read_text(encoding="utf-8")
        bundle = bundle_path.read_text(encoding="utf-8")

        page.expose_function("__v61HostFetch", partial(host_fetch, base_url))
        page.set_content(html, wait_until="domcontentloaded", timeout=60000)
        page.evaluate(HARNESS_SHIM)
        page.add_script_tag(content=bundle)
        page.wait_for_function(
            "function () { return Boolean(window.__v9) "
            "&& document.querySelectorAll('#template-palette .template-item').length > 0; }",
            timeout=60000,
        )
        page.wait_for_timeout(1000)
    return status


def open_application(context, base_url):
    """Open directly unless the environment requires the hermetic browser path."""
    force_hermetic = os.environ.get("SMOKE_FORCE_HERMETIC", "").strip() == "1"
    if force_hermetic:
        page = create_page(context)
        status = load_embedded_application(page, base_url)
        return page, status, True

    page = create_page(context)
    try:
        response = page.goto(base_url, wait_until="networkidle", timeout=60000)
        return page, int(response.status) if response is not None else 0, False
    except PlaywrightError as error:
        if ADMIN_BLOCK_MARKER not in str(error):
            raise
        page.close()
        reset_browser_diagnostics()
        page = create_page(context)
        status = load_embedded_application(page, base_url)
        return page, status, True


def click_tab(page, name):
    """Activate one compatibility route and wait for its atomic UI state."""
    page.evaluate(
        "function (route) { var button = document.getElementById('tab-btn-' + route); "
        "if (!button) throw new Error('Missing route button: ' + route); button.click(); }",
        name,
    )
    page.wait_for_function(
        "function (route) { var active = document.querySelector("
        "'#right-tabs > .tab-list > .tab.active'); "
        "var panel = document.getElementById('tab-' + route); "
        "return Boolean(active && active.dataset.tab === route && panel "
        "&& panel.classList.contains('active')); }",
        arg=name,
        timeout=10000,
    )
    page.wait_for_timeout(80)


def active_route(page):
    """Return the active compatibility route without locator auto-wait."""
    return page.evaluate(
        "function () { var active = document.querySelector("
        "'#right-tabs > .tab-list > .tab.active'); "
        "return active ? active.dataset.tab : ''; }"
    )


def panel_is_active(page, name):
    """Check the panel state without relying on visibility alone."""
    return page.evaluate(
        "function (route) { var panel = document.getElementById('tab-' + route); "
        "return Boolean(panel && panel.classList.contains('active')); }",
        name,
    )


def click_painted_element(page, locator):
    """Click a painted SVG point that resolves to the requested element group."""
    point = locator.evaluate(
        "function (root) { "
        "var selectors = 'rect,circle,ellipse,path,polygon,polyline,line,use,image,text'; "
        "var nodes = Array.from(root.querySelectorAll(selectors)); "
        "var factors = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], "
        "[0.25, 0.75], [0.75, 0.75]]; "
        "var nodeIndex = 0; var factorIndex = 0; "
        "for (nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) { "
        "var box = nodes[nodeIndex].getBoundingClientRect(); "
        "if (box.width <= 0 || box.height <= 0) continue; "
        "for (factorIndex = 0; factorIndex < factors.length; factorIndex += 1) { "
        "var x = box.x + box.width * factors[factorIndex][0]; "
        "var y = box.y + box.height * factors[factorIndex][1]; "
        "var hit = document.elementFromPoint(x, y); "
        "if (hit && hit.closest && hit.closest('.svg-element') === root) "
        "return { x: x, y: y }; "
        "} } return null; }"
    )
    if not point:
        return False
    page.mouse.click(point["x"], point["y"])
    return True


def capture_evidence(page, test_name, evidence_name):
    """Write test and release screenshots from the same verified frame."""
    SMOKE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    SMOKE_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SMOKE_OUTPUT_DIR / test_name), full_page=False)
    page.screenshot(path=str(SMOKE_EVIDENCE_DIR / evidence_name), full_page=False)


def loaded_styles(page):
    """List direct and hermetically inlined stylesheet source names."""
    return page.evaluate(
        "Array.from(document.styleSheets).map(function (sheet) { "
        "return (sheet.href || '').split('/').pop(); }).filter(Boolean)"
        ".concat(Array.from(document.querySelectorAll('style[data-source]'))"
        ".map(function (node) { return node.getAttribute('data-source'); }))"
    )


def run():
    """Execute the browser flow and return the number of failed checks."""
    playwright = sync_playwright().start()
    browser = None
    try:
        progress('Browser starten')
        browser = launch_browser(playwright)
        context = browser.new_context(
            viewport={"width": 1680, "height": 1000},
            device_scale_factor=1,
        )
        progress('Anwendung öffnen')
        page, response_status, embedded_mode = open_application(context, BASE_URL)
        page.set_default_timeout(10000)
        page.wait_for_timeout(1000)
        progress('Anwendung bereit')

        check("HTTP 200", response_status == 200, str(response_status))
        check("Kompatible Version sichtbar", "V64" in page.title() or "V63.4" in page.title(), page.title())
        check("Keine Page-Fehler", len(page_errors) == 0, " | ".join(page_errors[:3]))
        check(
            "Keine Request-Fehler",
            len(request_failures) == 0,
            " | ".join(request_failures[:3]),
        )
        check(
            "Keine Konsolenfehler",
            len(console_errors) == 0,
            " | ".join(console_errors[:3]),
        )

        styles = loaded_styles(page)
        check("workspace.css geladen", "workspace.css" in styles, ", ".join(styles))
        check("v60.css geladen", "v60.css" in styles, ", ".join(styles))
        check("v61.css geladen", "v61.css" in styles, ", ".join(styles))
        template_count = page.locator("#template-palette .template-item").count()
        check("Mindestens 26 Standardsymbole sichtbar", template_count >= 26, str(template_count))
        badge_text = page.locator("#symbol-standard-badge").inner_text()
        check("Standardbadge aktiv und konsistent", "PF-PID-V1" in badge_text and str(template_count) in badge_text, badge_text)
        check(
            "V61 Runtime-API bereit",
            page.evaluate("function () { return Boolean(window.__pfV61); }")
        )
        initial_report = page.evaluate(
            "function () { return window.__pfV61 ? window.__pfV61.getReport() : null; }"
        )
        check(
            "Standardbericht kennt Bibliothek",
            bool(initial_report) and initial_report.get("canonical_templates") == template_count,
            str(initial_report),
        )
        check(
            "HMI-Overlay startet ausgeschaltet",
            page.locator("#btn-hmi-overlay").get_attribute("aria-pressed") == "false",
        )
        check(
            "Neun globale Panels verschoben",
            page.locator("#global-tab-panels > .tab-panel").count() == 9,
        )
        check(
            "Sieben Hauptarbeitsbereiche einschließlich Zeichnen",
            page.locator("#workspace-rail [data-workspace]").count() == 7,
        )
        check(
            "Fünf Inspektorbereiche",
            page.locator(
                ".inspector-nav > .inspector-nav-button[data-inspector-view]"
            ).count()
            == 5,
        )
        check(
            "Favoritenbibliothek gerendert",
            page.locator(".template-kategorie--favorites").count() == 1,
        )
        check("Minimap vorhanden", page.locator("#canvas-minimap-svg").count() == 1)
        check(
            "Inspector-Übernahme vorhanden",
            page.locator("#inspector-apply").is_visible(),
        )

        progress('Canvas-Routen prüfen')
        for name in CANVAS_TABS:
            progress('Canvas-Route ' + name)
            click_tab(page, name)
            expected_workspace = "runtime" if name == "hmi" else "engineering"
            check("Route " + name, active_route(page) == name, active_route(page) or "")
            check("Panel " + name, panel_is_active(page, name))
            check(
                "Canvas-Modus " + name,
                page.locator("body").get_attribute("data-workspace-kind") == "canvas",
            )
            check(
                "Workspace " + name,
                page.locator("body").get_attribute("data-workspace")
                == expected_workspace,
            )

        progress('Globale Routen prüfen')
        for name in GLOBAL_TABS:
            progress('Globale Route ' + name)
            click_tab(page, name)
            check("Route " + name, active_route(page) == name, active_route(page) or "")
            check("Panel " + name, panel_is_active(page, name))
            check(
                "Vollbreitenmodus " + name,
                page.locator("body").get_attribute("data-workspace-kind") == "global",
            )
            parent_id = page.locator("#tab-" + name).evaluate(
                "function (node) { return node.parentElement ? node.parentElement.id : ''; }"
            )
            check("Globaler Panel-Host " + name, parent_id == "global-tab-panels", parent_id)
            check(
                "Globaler Bereich sichtbar " + name,
                page.locator("#workspace-global").is_visible(),
            )

        progress('Vorschau und Projektliste prüfen')
        click_tab(page, "elements")
        page.locator("#btn-preview").click()
        page.wait_for_timeout(200)
        check("Vorschau öffnet HMI", active_route(page) == "hmi", active_route(page) or "")

        page.locator("#btn-header-more").click()
        page.locator("#btn-laden").click()
        page.wait_for_selector("#modal-projekte-laden:not(.hidden)", timeout=10000)
        project_items = page.locator("#projekt-liste .projekt-item")
        project_count = project_items.count()
        check("Projektliste geladen", project_count > 0, str(project_count))
        target_index = -1
        for index in range(project_count):
            title = project_items.nth(index).locator("h4").inner_text().strip()
            if title == "designziel_v1_v61_1":
                target_index = index
                break
        check("V61-Referenzprojekt vorhanden", target_index >= 0, str(project_count))
        if target_index >= 0:
            progress('Referenzprojekt laden')
            project_items.nth(target_index).click()
            page.wait_for_function(
                "function () { return document.querySelectorAll('#elements-layer > .svg-element').length === 6 "
                "&& document.querySelectorAll('#connections-layer > .connection-line').length === 5; }",
                timeout=15000,
            )
            page.wait_for_timeout(700)
            click_tab(page, "elements")

            progress('Objektstandard und Bindings prüfen')
            element_count = page.locator("#elements-layer > .svg-element").count()
            connection_count = page.locator("#connections-layer > .connection-line").count()
            check("Sechs normalisierte Entities gerendert", element_count == 6, str(element_count))
            check("Fünf semantische Verbindungen gerendert", connection_count == 5, str(connection_count))
            standard_count = page.locator(
                "#elements-layer > .svg-element[data-standard='PF-PID-V1']"
            ).count()
            check("Alle Entities nutzen PF-PID-V1", standard_count == 6, str(standard_count))
            tag_count = page.locator("#elements-layer > .svg-element[data-entity-tag]").count()
            check("Alle Entities besitzen TAGs", tag_count == 6, str(tag_count))
            port_count = page.locator("#elements-layer .element-port-handle").count()
            check("Semantische Ports gerendert", port_count >= 20, str(port_count))
            semantic_connection_count = page.locator(
                "#connections-layer > .connection-line:not([data-from-port='auto']):not([data-to-port='auto'])"
            ).count()
            check(
                "Alle Verbindungen verwenden Portanker",
                semantic_connection_count == 5,
                str(semantic_connection_count),
            )

            report = page.evaluate(
                "function () { return window.__pfV61 ? window.__pfV61.getReport() : null; }"
            )
            check("V61-Standardbericht ist gültig", bool(report) and report.get("valid") is True, str(report))
            check(
                "Standardbericht zählt sechs Entities",
                bool(report) and report.get("standardized_elements") == 6,
                str(report),
            )
            check(
                "Standardbericht zählt fünf Portverbindungen",
                bool(report) and report.get("semantic_connections") == 5,
                str(report),
            )
            check(
                "Zwei explizite HMI-Widgets erhalten",
                bool(report) and report.get("hmi_widgets") == 2,
                str(report),
            )
            check(
                "Optionaler Button bleibt explizit",
                bool(report) and report.get("explicit_buttons") == 1,
                str(report),
            )
            automatic_widgets = ((report or {}).get("violations") or {}).get("automatic_widgets") or []
            check("Keine automatisch erzeugten HMI-Widgets", len(automatic_widgets) == 0, str(automatic_widgets))

            pump_element = page.locator("#elements-layer > #pump_feed")
            painted_click = click_painted_element(page, pump_element)
            check("Pumpe besitzt klickbare Geometrie", painted_click)
            page.wait_for_timeout(300)
            check(
                "Elementauswahl aktiv",
                page.locator("#elements-layer .selected").count() == 1,
            )
            check("Inspector zeigt P-101", page.locator("#prop-tag").input_value() == "P-101")
            check(
                "Inspector zeigt P&ID V1",
                page.locator(".v61-standard-badge").inner_text().strip() == "P&ID V1",
            )
            binding_text = page.locator(".v1-binding-card").inner_text()
            check(
                "V9-Binding bleibt erhalten",
                "Aktor gebunden" in binding_text and "Controller 2" in binding_text,
                binding_text,
            )
            selection_meta = page.locator("#canvas-selection-meta").inner_text().strip()
            check(
                "Auswahl-Chip zeigt das reale Binding",
                "Aktor 4" in selection_meta and "nicht gebunden" not in selection_meta,
                selection_meta,
            )
            connection_status = page.locator("#connection-count").inner_text().strip()
            check(
                "Statusleiste zählt fünf Verbindungen",
                connection_status == "5 Verbindungen",
                connection_status,
            )
            check(
                "Auswahl-Chip sichtbar",
                page.locator("#canvas-selection-chip").is_visible(),
            )
            chip_box = page.locator("#canvas-selection-chip").bounding_box()
            canvas_box = page.locator("#canvas-container").bounding_box()
            inside = bool(
                chip_box
                and canvas_box
                and chip_box["x"] >= canvas_box["x"] - 1
                and chip_box["x"] + chip_box["width"]
                <= canvas_box["x"] + canvas_box["width"] + 1
            )
            check(
                "Auswahl-Chip bleibt im Canvas",
                inside,
                "chip=%s canvas=%s" % (chip_box, canvas_box),
            )

            overlay = page.locator("#hmi-canvas-overlay")
            check("HMI-Overlay-Host vorhanden", overlay.count() == 1)
            check(
                "HMI-Overlay im Engineering verborgen",
                overlay.get_attribute("hidden") is not None
                and overlay.get_attribute("aria-hidden") == "true",
            )
            progress('Light-Screenshot erzeugen')
            capture_evidence(
                page,
                "screenshot_v61_light.png",
                "v61_1_pid_light.png",
            )

            progress('Optionales HMI-Overlay prüfen')
            page.locator("#btn-hmi-overlay").click()
            page.wait_for_function(
                "function () { var root = document.getElementById('hmi-canvas-overlay'); "
                "return root && !root.hidden && root.querySelectorAll('.hmi-ov').length === 2; }",
                timeout=10000,
            )
            overlay_widget_count = page.locator("#hmi-canvas-overlay .hmi-ov").count()
            check("Zwei optionale HMI-Widgets eingeblendet", overlay_widget_count == 2, str(overlay_widget_count))
            indicator_style = page.locator("#hmi-canvas-overlay .hmi-ov-indicator").evaluate(
                "function (node) { var style = getComputedStyle(node); "
                "return { background: style.backgroundColor, color: style.color }; }"
            )
            check(
                "HMI-Indikator besitzt lesbaren Theme-Kontrast",
                indicator_style.get("background") not in ("transparent", "rgba(0, 0, 0, 0)")
                and indicator_style.get("background") != indicator_style.get("color"),
                str(indicator_style),
            )
            check(
                "HMI-Schalter zeigt aktiven Zustand",
                page.locator("#btn-hmi-overlay").get_attribute("aria-pressed") == "true",
            )
            capture_evidence(
                page,
                "screenshot_v61_hmi_optional.png",
                "v61_1_hmi_optional.png",
            )
            page.locator("#btn-hmi-overlay").click()
            page.wait_for_function(
                "function () { var root = document.getElementById('hmi-canvas-overlay'); "
                "return root && root.hidden; }",
                timeout=5000,
            )
            check(
                "HMI-Overlay wieder vollständig verborgen",
                page.locator("#btn-hmi-overlay").get_attribute("aria-pressed") == "false",
            )

        progress('Themes und Dark-Screenshot prüfen')
        page.locator("#theme-toggle").click()
        page.wait_for_timeout(250)
        check(
            "Dark Mode aktiv",
            page.locator("html").get_attribute("data-theme") == "dark",
        )
        palette_before = page.locator("html").get_attribute("data-dark-palette")
        page.locator("#palette-toggle").click()
        page.wait_for_timeout(180)
        palette_after = page.locator("html").get_attribute("data-dark-palette")
        check(
            "Dunkelpalette umschaltbar",
            palette_after != palette_before,
            "%s -> %s" % (palette_before, palette_after),
        )
        capture_evidence(
            page,
            "screenshot_v61_dark.png",
            "v61_1_pid_dark.png",
        )

        progress('Shortcut-Dialog prüfen')
        page.locator("#btn-shortcuts").click()
        page.wait_for_selector("#modal-shortcuts:not(.hidden)", timeout=5000)
        check("Shortcut-Hilfe öffnet", page.locator("#modal-shortcuts").is_visible())
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        shortcut_classes = page.locator("#modal-shortcuts").get_attribute("class") or ""
        check("Shortcut-Hilfe schließt per Escape", "hidden" in shortcut_classes)

        progress('Responsive Darstellung prüfen')
        page.set_viewport_size({"width": 1366, "height": 768})
        page.wait_for_timeout(250)
        check("Responsive Kopfzeile sichtbar", page.locator("#app-header").is_visible())
        check("Responsive Canvas sichtbar", page.locator("#canvas-area").is_visible())
        for selector in ("#btn-speichern", "#btn-preview", "#btn-header-more"):
            check("Bedienelement sichtbar " + selector, page.locator(selector).is_visible())
        page.locator("#btn-header-more").click()
        check("Laden im Header-Menü sichtbar", page.locator("#btn-laden").is_visible())
        check(
            "Export im Header-Menü sichtbar",
            page.locator("#btn-exportieren").is_visible(),
        )
        capture_evidence(
            page,
            "screenshot_v61_responsive.png",
            "v61_1_responsive.png",
        )

        check("Keine Page-Fehler nach Interaktion", len(page_errors) == 0, " | ".join(page_errors[:3]))
        check(
            "Keine Request-Fehler nach Interaktion",
            len(request_failures) == 0,
            " | ".join(request_failures[:3]),
        )
        check(
            "Keine Konsolenfehler nach Interaktion",
            len(console_errors) == 0,
            " | ".join(console_errors[:3]),
        )

        progress('Browserdiagnostik abgeschlossen')
        mode_label = "hermetisch" if embedded_mode else "direkt"
        print("Browser-Modus: " + mode_label)

    finally:
        if browser is not None:
            browser.close()
        playwright.stop()

    print("Browser-Smoke: %d bestanden, %d fehlgeschlagen" % (passed, failed))
    for failure in failures:
        print("  FEHLER " + failure)
    return failed


if __name__ == "__main__":
    raise SystemExit(1 if run() else 0)
