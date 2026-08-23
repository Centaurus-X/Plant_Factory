/**
 * hmi_animation.js — macht das exportierte SVG tatsächlich animierbar.
 *
 * Der Befund, der zu diesem Modul führte
 * --------------------------------------
 * Bis V54.0 konnte der Editor Animationen MODELLIEREN, das Export-Bundle sie
 * aber nicht ABSPIELEN. Die Kette brach an drei Stellen gleichzeitig:
 *
 *   1. Die Zustands-CSS (`hmi-anim-blink`, `ok-green`, `warn-yellow`,
 *      `alarm-red`, die `[data-hmi-fill]`-Regeln) lag ausschließlich in
 *      `public/css/style.css` und `layout.css`. Beide Dateien wurden dem
 *      Export weder beigelegt noch verlinkt. Die Laufzeit setzte also Klassen,
 *      zu denen es keine einzige Regel gab.
 *   2. Das SVG trug kein `viewBox`. Mit `width:100%; height:100%` im
 *      Export-HTML wurde der Inhalt beschnitten statt skaliert.
 *   3. Es gab keine Datenquelle. `hmi_runtime.setSignal()` existierte, wurde
 *      aber von keiner Zeile im Projekt aufgerufen — kein Polling, kein
 *      WebSocket. Ohne Werte ändert sich nie eine Klasse.
 *
 * Dieses Modul schließt alle drei Lücken an EINER Stelle:
 *
 *   * `ANIMATION_CSS`      — die Zustandsregeln als Text, eine Quelle für
 *                            Editor, SVG und HTML-Layer.
 *   * `makeSvgAnimatable()` — bettet `<style>` ein und ergänzt `viewBox`.
 *                            Danach ist die SVG-Datei ALLEIN animierbar:
 *                            im Browser geöffnet, in eine Seite eingebettet,
 *                            von einem SCADA-Client per `classList` gesteuert.
 *   * `buildSignalBridge()` — der Anbindungscode für den HTML-Layer: Polling
 *                            gegen eine Signalquelle, mit klar benanntem
 *                            Demo-Modus, wenn keine erreichbar ist.
 *
 * Warum Klassen und nicht SMIL: die Laufzeit (`hmi_runtime.js`) arbeitet
 * ausschließlich über `classList`. SMIL wäre ein zweiter, konkurrierender
 * Mechanismus. Eine Animation, die per CSS an einer Klasse hängt, lässt sich
 * von jedem Client steuern, der eine Klasse setzen kann — auch ohne unsere
 * Laufzeit.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import {
  SVG_EVENT_ANIMATION_CSS,
  normalizeSvgEventAnimations
} from './svg_event_runtime.js';

/**
 * Zustands- und Animationsregeln des HMI.
 *
 * Bewusst ohne Abhängigkeit zu style.css: was hier steht, muss in einer
 * Datei funktionieren, die nichts anderes mitbekommt.
 */
export const ANIMATION_CSS = [
  '/* --- HMI-Zustandsdarstellung (hmi_animation.js) --- */',
  '@keyframes hmi-blink { 0%, 100% { opacity: 1 } 50% { opacity: .38 } }',
  '@keyframes hmi-pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.06) } }',
  '@keyframes hmi-flow  { to { stroke-dashoffset: -24 } }',
  '',
  '.hmi-anim-blink { animation: hmi-blink 1s steps(1, end) infinite }',
  '.hmi-anim-pulse { animation: hmi-pulse 1.6s ease-in-out infinite;',
  '                  transform-box: fill-box; transform-origin: 50% 50% }',
  '.hmi-anim-flow  { stroke-dasharray: 8 4; animation: hmi-flow .9s linear infinite }',
  '',
  '/* Zustandsfarben — wirken auf Rahmen (Overlay) und Fuellflaeche (SVG). */',
  '.ok-green     { --hmi-tint: 34,197,94 }',
  '.warn-yellow  { --hmi-tint: 245,158,11 }',
  '.alarm-red    { --hmi-tint: 239,68,68 }',
  '.info-blue    { --hmi-tint: 59,130,246 }',
  '.idle-grey    { --hmi-tint: 148,163,184 }',
  '',
  '.ok-green, .warn-yellow, .alarm-red, .info-blue, .idle-grey {',
  '  border-color: rgba(var(--hmi-tint), .95) !important;',
  '  box-shadow: 0 0 0 2px rgba(var(--hmi-tint), .20);',
  '}',
  '',
  '/* Innenflaechen, die im Elements-Tab als Fuellflaeche markiert wurden. */',
  'svg .ok-green    [data-hmi-fill="1"],',
  'svg .warn-yellow [data-hmi-fill="1"],',
  'svg .info-blue   [data-hmi-fill="1"],',
  'svg .idle-grey   [data-hmi-fill="1"] { fill: rgb(var(--hmi-tint)); fill-opacity: .35 }',
  'svg .alarm-red   [data-hmi-fill="1"] { fill: rgb(var(--hmi-tint)); fill-opacity: .45 }',
  '',
  '/* Auch ohne markierte Fuellflaeche bleibt der Zustand sichtbar. */',
  'svg .ok-green, svg .warn-yellow, svg .alarm-red,',
  'svg .info-blue, svg .idle-grey { stroke: rgb(var(--hmi-tint)) }',
  '',
  '/* Alarmschweregrade. */',
  '.hmi-alarm-sev-warn, .hmi-alarm-sev-warning {',
  '  filter: drop-shadow(0 0 6px rgba(245,158,11,.35)) }',
  '.hmi-alarm-sev-critical { filter: drop-shadow(0 0 8px rgba(239,68,68,.45)) }',
  '.hmi-alarm-active { outline: 2px solid rgba(239,68,68,.55); outline-offset: 2px }',
  '',
  '/* Wer Animationen abgeschaltet hat, bekommt Farbe statt Bewegung. */',
  '@media (prefers-reduced-motion: reduce) {',
  '  .hmi-anim-blink, .hmi-anim-pulse, .hmi-anim-flow { animation: none }',
  '}'
].join('\n') + '\n' + SVG_EVENT_ANIMATION_CSS;

/** Alle Klassen, die die Laufzeit setzen darf — Grundlage der Editor-Auswahl. */
export const STATE_CLASSES = Object.freeze([
  { value: 'ok-green', label: 'OK (gruen)' },
  { value: 'warn-yellow', label: 'Warnung (gelb)' },
  { value: 'alarm-red', label: 'Alarm (rot)' },
  { value: 'info-blue', label: 'Information (blau)' },
  { value: 'idle-grey', label: 'Ruhe (grau)' }
]);

export const ANIMATION_CLASSES = Object.freeze([
  { value: 'hmi-anim-blink', label: 'Blinken' },
  { value: 'hmi-anim-pulse', label: 'Pulsieren' },
  { value: 'hmi-anim-flow', label: 'Fliessende Linie' }
]);

/* -------------------------------------------------------------------------
 * SVG animierbar machen
 * ---------------------------------------------------------------------- */

/**
 * Ermittelt die tatsächlich belegte Fläche eines SVG-Knotens.
 *
 * `getBBox()` liefert die Zeichnungsgrenzen im lokalen Koordinatensystem —
 * genau das, was ein `viewBox` braucht. Schlägt es fehl (Knoten nicht im
 * Dokument, leeres SVG), wird auf die deklarierten Maße zurückgefallen.
 */
export function measureContent(svgNode, fallbackWidth, fallbackHeight) {
  const width = Number(fallbackWidth) || 2000;
  const height = Number(fallbackHeight) || 2000;
  try {
    const layer = svgNode.querySelector('#elements-layer') || svgNode;
    const box = layer.getBBox();
    if (box && box.width > 1 && box.height > 1) {
      const pad = Math.max(24, Math.min(box.width, box.height) * 0.05);
      return {
        x: Math.round(box.x - pad),
        y: Math.round(box.y - pad),
        width: Math.round(box.width + pad * 2),
        height: Math.round(box.height + pad * 2)
      };
    }
  } catch (error) {
    // getBBox wirft bei nicht gerenderten Knoten — Rueckfall ist beabsichtigt.
  }
  return { x: 0, y: 0, width, height };
}

/**
 * Bettet die Zustands-CSS ein und ergänzt ein `viewBox`.
 *
 * @param {SVGElement} svgNode  Der (geklonte) SVG-Knoten. Wird mutiert.
 * @param {object} [options]    `viewBox` überschreibt die Messung,
 *                              `css` ersetzt ANIMATION_CSS,
 *                              `title` setzt <title> für Screenreader.
 */
export function makeSvgAnimatable(svgNode, options) {
  if (!svgNode) return svgNode;
  const opts = options && typeof options === 'object' ? options : {};
  const doc = svgNode.ownerDocument || document;
  const ns = 'http://www.w3.org/2000/svg';

  // 1. viewBox — ohne sie skaliert das SVG im HTML-Layer nicht, sondern
  //    wird beschnitten.
  if (!svgNode.getAttribute('viewBox')) {
    const box = opts.viewBox || measureContent(svgNode,
      svgNode.getAttribute('width'), svgNode.getAttribute('height'));
    svgNode.setAttribute('viewBox',
      box.x + ' ' + box.y + ' ' + box.width + ' ' + box.height);
  }
  svgNode.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgNode.removeAttribute('width');
  svgNode.removeAttribute('height');
  if (!svgNode.getAttribute('xmlns')) svgNode.setAttribute('xmlns', ns);

  // 2. Titel für Screenreader und Dateimanager-Vorschau.
  if (opts.title && !svgNode.querySelector('title')) {
    const title = doc.createElementNS(ns, 'title');
    title.textContent = String(opts.title);
    svgNode.insertBefore(title, svgNode.firstChild);
  }

  // 3. Zustands-CSS einbetten. Ohne sie setzt die Laufzeit Klassen, zu denen
  //    es keine Regel gibt — sichtbar passiert dann nichts.
  const existing = svgNode.querySelector('style[data-hmi-animation]');
  if (existing) existing.remove();
  const style = doc.createElementNS(ns, 'style');
  style.setAttribute('data-hmi-animation', '1');
  style.textContent = '\n' + (opts.css || ANIMATION_CSS) + '\n';
  svgNode.insertBefore(style, svgNode.firstChild);

  // Machine-readable event rules travel with the SVG without executable
  // script content. Runtime clients read the JSON text from metadata.
  const existingMetadata = svgNode.querySelector('#pf-svg-event-animations');
  if (existingMetadata) existingMetadata.remove();
  if (opts.eventAnimations !== undefined) {
    const metadata = doc.createElementNS(ns, 'metadata');
    metadata.setAttribute('id', 'pf-svg-event-animations');
    metadata.setAttribute('data-schema', 'plant-factory.svg-event-animation');
    metadata.setAttribute('data-schema-version', '1');
    metadata.textContent = JSON.stringify(
      normalizeSvgEventAnimations(opts.eventAnimations)
    );
    svgNode.insertBefore(metadata, style.nextSibling);
  }

  return svgNode;
}

/* -------------------------------------------------------------------------
 * Datenanbindung
 * ---------------------------------------------------------------------- */

/**
 * Erzeugt den Brückencode für den HTML-Layer.
 *
 * Die Brücke versucht der Reihe nach:
 *   1. die konfigurierte Signalquelle (`sourceUrl`) zu pollen,
 *   2. bei Misserfolg in einen klar gekennzeichneten Demo-Modus zu gehen.
 *
 * Der Demo-Modus ist Absicht: ein Bundle, das beim Doppelklick tot bleibt,
 * lässt den Anwender im Unklaren, ob er etwas falsch gemacht hat oder ob die
 * Anlage stillsteht. Ein sichtbares "Demo"-Banner beantwortet das sofort.
 *
 * Erwartetes Format der Signalquelle:
 *   { "signals": { "sensor:1:value": 542.5, "state:1:value_id": 1 } }
 * Genau die Schlüssel, die `hmi_runtime.toKeyFromRef()` bildet.
 */
export function buildSignalBridge(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const sourceUrl = opts.sourceUrl || './signals.json';
  const intervalMs = Number(opts.intervalMs) || 1000;

  return [
    '/* --- Signalbruecke ------------------------------------------------',
    ' * Holt zyklisch Signalwerte und reicht sie an die Laufzeit weiter.',
    ' * Erwartetes Format: { "signals": { "<kind>:<id>:<field>": <wert> } }',
    ' * Die Schluessel entsprechen hmi_runtime.toKeyFromRef().',
    ' *',
    ' * Eigene Quelle anbinden: SIGNAL_SOURCE unten auf die eigene URL setzen',
    ' * oder die Seite mit ?signals=<url> aufrufen. Ohne erreichbare Quelle',
    ' * laeuft ein gekennzeichneter Demo-Modus.',
    ' * ---------------------------------------------------------------- */',
    'const SIGNAL_SOURCE = new URLSearchParams(location.search).get("signals")',
    '  || ' + JSON.stringify(sourceUrl) + ';',
    'const SIGNAL_INTERVAL_MS = ' + intervalMs + ';',
    '',
    'function showBanner(text, tone) {',
    '  let node = document.getElementById("hmi-banner");',
    '  if (!node) {',
    '    node = document.createElement("div");',
    '    node.id = "hmi-banner";',
    '    node.style.cssText = "position:absolute;left:12px;top:12px;z-index:50;"',
    '      + "padding:6px 12px;border-radius:6px;font:12px/1.4 system-ui,sans-serif;"',
    '      + "pointer-events:none";',
    '    document.getElementById("hmi-stage").appendChild(node);',
    '  }',
    '  node.textContent = text;',
    '  node.style.background = tone === "live"',
    '    ? "rgba(34,197,94,.18)" : "rgba(245,158,11,.18)";',
    '  node.style.color = tone === "live" ? "#86efac" : "#fcd34d";',
    '}',
    '',
    'function collectSignalKeys(model) {',
    '  const keys = [];',
    '  (model && model.bindings || []).forEach(function (binding) {',
    '    const source = binding.source || {};',
    '    const kind = source.kind;',
    '    const id = source.sensor_id ?? source.actuator_id ?? source.state_id;',
    '    if (!kind || id == null) return;',
    '    keys.push(kind + ":" + id + ":" + (source.field || "value"));',
    '  });',
    '  return keys;',
    '}',
    '',
    'function demoValue(key, tick) {',
    '  // Deterministisch aus dem Schluessel abgeleitet: derselbe Aufbau zeigt',
    '  // immer denselben Verlauf, damit Screenshots vergleichbar bleiben.',
    '  let seed = 0;',
    '  for (let i = 0; i < key.length; i += 1) seed = (seed * 31 + key.charCodeAt(i)) % 997;',
    '  if (key.endsWith(":value_id")) return (Math.floor(tick / 6) + seed) % 2 === 0 ? 1 : 2;',
    '  if (key.endsWith(":mode_id")) return 2;',
    '  const phase = (tick / 12) + (seed / 997) * Math.PI * 2;',
    '  return Math.round((50 + 45 * Math.sin(phase)) * 10) / 10;',
    '}',
    '',
    'function startSignalBridge(runtime, model) {',
    '  const keys = collectSignalKeys(model);',
    '  let tick = 0;',
    '  let live = null;',
    '',
    '  async function step() {',
    '    tick += 1;',
    '    try {',
    '      const response = await fetch(SIGNAL_SOURCE, { cache: "no-store" });',
    '      if (!response.ok) throw new Error("HTTP " + response.status);',
    '      const payload = await response.json();',
    '      const signals = payload && payload.signals ? payload.signals : payload;',
    '      runtime.setSignals(signals);',
    '      if (live !== true) { live = true; showBanner("Live: " + SIGNAL_SOURCE, "live"); }',
    '      return;',
    '    } catch (error) {',
    '      if (live !== false) {',
    '        live = false;',
    '        showBanner("Demo-Modus — keine Signalquelle unter " + SIGNAL_SOURCE, "demo");',
    '      }',
    '    }',
    '    const demo = {};',
    '    keys.forEach(function (key) { demo[key] = demoValue(key, tick); });',
    '    runtime.setSignals(demo);',
    '  }',
    '',
    '  step();',
    '  return setInterval(step, SIGNAL_INTERVAL_MS);',
    '}'
  ].join('\n');
}

/** Die Zustands-CSS als eigenständiges `<style>`-Element für den HTML-Layer. */
export function animationStyleTag() {
  return '<style data-hmi-animation="1">\n' + ANIMATION_CSS + '\n</style>';
}
