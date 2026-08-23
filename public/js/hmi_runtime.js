/**
 * hmi_runtime.js (Client-Runtime)
 *
 * Aufgabe:
 *  - Rendert aus cfg.hmi_ui + SVG ein externes HTML-Overlay (Widgets)
 *  - Stellt Interaktions-Hooks bereit: onInteraction(info)
 *  - Stellt SCADA API bereit: runtime.setSignal(ref,value) -> Values + Styles + Alarms
 *
 * createHmiRuntime({ svgRoot, hmiUi, viewId, onInteraction })
 *
 * SCADA API:
 *  runtime.setSignal({ kind:'sensor', sensor_id:1, field:'value' }, 123.4)
 *  runtime.setSignal({ kind:'actuator', actuator_id:5, field:'value' }, 1)
 *  runtime.getAlarms() / runtime.ackAlarm(alarm_id)
 *
 * Styles/Alarms:
 *  - styles: when(sensor_cmp) -> classes_add/remove (am Overlay UND am SVG Ziel-Element)
 *  - alarms: severity -> hmi-alarm-sev-<severity> Klassen (am Overlay UND am SVG)
 */

import { createSvgEventRuntime } from './svg_event_runtime.js';


function deepClone(obj) {
  if (obj === null || obj === undefined) return obj;
  try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
}

function ensureArray(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    var t = v.trim();
    if (t === '') return null;
    var n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  var n2 = Number(v);
  return Number.isFinite(n2) ? n2 : null;
}

function normalizeHmiUi(raw) {
  var base = raw && typeof raw === 'object' ? deepClone(raw) : {};
  if (!base || typeof base !== 'object') base = {};

  if (!base.version) base.version = 1;
  if (!base.active_view_id) base.active_view_id = 'main';

  if (!Array.isArray(base.views) || base.views.length === 0) {
    base.views = [{ view_id: 'main', name: 'Main', svg_ref: 'main', tags: ['default'] }];
  }
  if (!Array.isArray(base.widgets)) base.widgets = [];
  if (!Array.isArray(base.bindings)) {
    // alte Struktur (bindings als Objekt) abfangen
    if (base.bindings && typeof base.bindings === 'object') {
      var arr = [];
      Object.keys(base.bindings).forEach(function (k) {
        var b = base.bindings[k];
        if (b && typeof b === 'object') arr.push(b);
      });
      base.bindings = arr;
    } else {
      base.bindings = [];
    }
  }
  if (!Array.isArray(base.styles)) base.styles = [];
  if (!Array.isArray(base.alarms)) base.alarms = [];
  if (!Array.isArray(base.event_animations)) base.event_animations = [];

  return base;
}

function computeAnchorPoint(rect, anchor) {
  var cx = rect.left + rect.width / 2;
  var cy = rect.top + rect.height / 2;

  if (anchor === 'top') return { x: cx, y: rect.top };
  if (anchor === 'bottom') return { x: cx, y: rect.bottom };
  if (anchor === 'left') return { x: rect.left, y: cy };
  if (anchor === 'right') return { x: rect.right, y: cy };
  return { x: cx, y: cy };
}


// ============================================================================
// Zoom / Scale Mapping (SVG <-> HTML Overlay)
//
// Ziel:
//  - Editor-Zoom (elements-layer transform: scale(z)) UND
//  - Client-Resize (SVG via CSS skaliert)
// sollen die HTML-Widgets genauso skalieren wie das SVG.
//
// Dafür benutzen wir die Screen-CTM (Current Transformation Matrix) des
// elements-layer. Das enthält:
//   • CSS/Viewport-Scaling des SVG
//   • Canvas Zoom/Pan (transform am Layer)
// aber NICHT die individuellen Element-Transforms.
// ============================================================================

function scaleFromScreenCTM(m) {
  if (!m) return 1;

  var a = Number(m.a);
  var b = Number(m.b);
  var c = Number(m.c);
  var d = Number(m.d);

  var sx = Math.sqrt((a * a) + (b * b));
  var sy = Math.sqrt((c * c) + (d * d));

  if (!Number.isFinite(sx) || sx <= 0) sx = 1;
  if (!Number.isFinite(sy) || sy <= 0) sy = sx;

  // Uniform-Scale: Mittelwert ist robust gegen Mini-Rundungsfehler
  var s = (sx + sy) / 2;
  if (!Number.isFinite(s) || s <= 0) return 1;
  return s;
}

function getOverlayZoom(svgRoot) {
  try {
    if (!svgRoot) return 1;

    // Prefer: elements-layer (enthält Canvas-Zoom/Pan)
    var layer = null;
    if (svgRoot.querySelector) {
      layer = svgRoot.querySelector('#elements-layer') || svgRoot.querySelector('#connections-layer');
    }

    var m = null;
    if (layer && typeof layer.getScreenCTM === 'function') m = layer.getScreenCTM();
    if (!m && typeof svgRoot.getScreenCTM === 'function') m = svgRoot.getScreenCTM();

    return scaleFromScreenCTM(m);
  } catch (e) {
    return 1;
  }
}



function widgetPreviewLabel(widget, binding) {
  var w = widget || {};
  var cfg = w.config || {};
  var type = w.type || 'text';

  if (type === 'button') return String(cfg.label || w.name || 'Button');
  if (type === 'toggle') return String((cfg.label_on || 'ON') + '/' + (cfg.label_off || 'OFF'));
  if (type === 'slider') return String(cfg.label || w.name || 'Setpoint');
  if (type === 'indicator') return String(w.name || cfg.label || 'Indicator');

  // Fallback: Text-Widget
  var prefix = '';
  var suffix = '';
  if (cfg.prefix != null) prefix = String(cfg.prefix);
  if (cfg.suffix != null) suffix = String(cfg.suffix);
  var core = w.name || cfg.fallback || '--';
  return prefix + core + suffix;
}

function createOverlayHost(rootEl, options) {
  if (!rootEl) return null;

  var host = rootEl.parentElement || rootEl;
  var cs = window.getComputedStyle(host);
  if (!cs.position || cs.position === 'static') {
    host.style.position = 'relative';
  }

  var overlay = host.querySelector('.hmi-runtime-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'hmi-runtime-overlay';
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.right = '0';
    overlay.style.bottom = '0';
    overlay.style.zIndex = (options && options.zIndex) ? String(options.zIndex) : '20';

    // Overlay bleibt bewusst "durchklickbar"
    overlay.style.pointerEvents = 'none';

    host.appendChild(overlay);
  } else {
    overlay.style.pointerEvents = 'none';
  }

  // Host merken: Widgets werden NICHT als Child von overlay gerendert
  overlay.__hmi_host = host;

  return overlay;
}



function createWidgetElement(widget, binding, options) {
  var type = (widget && widget.type) ? widget.type : 'text';
  var cfg = widget && widget.config ? widget.config : {};
  var label = widgetPreviewLabel(widget, binding);

  var el;
  if (type === 'button' || type === 'toggle') el = document.createElement('button');
  else el = document.createElement('div');

  el.textContent = label;
  el.className = 'hmi-runtime-widget hmi-runtime-widget--' + type;
  el.style.position = 'absolute';
  el.style.pointerEvents = 'auto';
  el.style.whiteSpace = 'nowrap';

  // ✅ gleiche Anchor-Semantik wie Editor (left/top = Anchor-Punkt)
  // ✅ gleiche Drift-Korrektur: scale(...) translate(...)
  el.style.transformOrigin = '0 0';
  el.style.transform = 'scale(var(--hmi-zoom, 1)) translate(-50%, -50%)';

  // ---- Appearance (Export-Standard) ----
  var variant = String(cfg.variant || 'default');
  var size = String(cfg.size || 'md');
  var shape = String(cfg.shape || 'pill');

  // defaults
  var bg = 'rgba(15, 23, 42, 0.92)';
  var fg = '#e5e7eb';
  var border = 'rgba(59, 130, 246, 0.65)';

  if (variant === 'primary') {
    bg = 'rgba(37, 99, 235, 0.92)';
    fg = '#ffffff';
    border = 'rgba(96, 165, 250, 0.95)';
  } else if (variant === 'outline') {
    bg = 'transparent';
    fg = '#e5e7eb';
    border = 'rgba(59, 130, 246, 0.85)';
  } else if (variant === 'ghost') {
    bg = 'transparent';
    fg = '#e5e7eb';
    border = 'transparent';
  }

  // size -> padding + font
  var pad = (type === 'button' || type === 'toggle') ? '6px 10px' : '4px 8px';
  var fontPx = 12;

  if (size === 'sm') { pad = (type === 'button' || type === 'toggle') ? '4px 8px' : '3px 6px'; fontPx = 11; }
  if (size === 'lg') { pad = (type === 'button' || type === 'toggle') ? '8px 12px' : '6px 10px'; fontPx = 14; }

  // custom overrides (optional)
  if (cfg.bg_color) bg = String(cfg.bg_color);
  if (cfg.text_color) fg = String(cfg.text_color);
  if (cfg.border_color) border = String(cfg.border_color);

  var bw = toNumberOrNull(cfg.border_width);
  if (bw === null) bw = 1;

  var fz = toNumberOrNull(cfg.font_size);
  if (fz !== null) fontPx = fz;

  // shape
  var radius = '999px';
  if (shape === 'rounded') radius = '10px';
  if (shape === 'square') radius = '0px';

  el.style.padding = pad;
  el.style.fontSize = String(fontPx) + 'px';
  el.style.lineHeight = '1.2';
  el.style.borderRadius = radius;

  // incomplete?
  var incomplete = !(binding && (binding.source || binding.interaction));
  if (incomplete) {
    el.style.border = String(bw) + 'px dashed rgba(148, 163, 184, 0.8)';
    el.style.background = bg;
    el.style.color = fg;
    el.style.opacity = '0.75';
  } else {
    el.style.border = String(bw) + 'px solid ' + border;
    el.style.background = bg;
    el.style.color = fg;
    el.style.opacity = '1.0';
  }

  // classes
  var classes = [];
  if (Array.isArray(cfg.classes)) classes = cfg.classes.slice();
  else if (typeof cfg.classes === 'string') classes = cfg.classes.split(/\s+/).filter(Boolean);

  classes.forEach(function (cls) {
    try { el.classList.add(cls); } catch (_) {}
  });

  // Interaktion nach außen reichen
  if (options && typeof options.onInteraction === 'function') {
    if (type === 'button' || type === 'toggle') {
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        options.onInteraction({
          event: ev,
          widget: widget,
          binding: binding,
          source: binding && binding.source ? binding.source : null,
          type: type,
          action: (type === 'toggle') ? 'toggle' : 'click'
        });
      });
    }
  }

  return el;
}




/**
 * Haupt-Fabrik:
 *  - svgRoot: <svg> Wurzelelement (z.B. aus eingebettetem Export)
 *  - hmiUi:   {version, active_view_id, views, widgets, bindings, styles, alarms}
 *  - viewId:  View, die angezeigt werden soll ('main' default)
 */
function createHmiRuntime(params) {
  if (!params) throw new Error('createHmiRuntime: params fehlt');

  var svgRoot = params.svgRoot;
  var rawHmi = params.hmiUi || (params.config && params.config.hmi_ui) || {};

  // Kompatibel: onInteraction entweder top-level oder in options
  var options = params.options || {};
  if (typeof params.onInteraction === 'function' && typeof options.onInteraction !== 'function') {
    options.onInteraction = params.onInteraction;
  }
  if (typeof params.onAlarm === 'function' && typeof options.onAlarm !== 'function') {
    options.onAlarm = params.onAlarm;
  }

  var viewIdInitial = params.viewId || rawHmi.active_view_id || 'main';

  if (!svgRoot || !svgRoot.getBoundingClientRect) {
    throw new Error('createHmiRuntime: svgRoot ist kein SVG-Element');
  }

  var overlay = createOverlayHost(svgRoot, options);
  if (!overlay) throw new Error('createHmiRuntime: Overlay konnte nicht erzeugt werden');

  var host = overlay.__hmi_host || (svgRoot.parentElement || svgRoot);

  var state = {
    svgRoot: svgRoot,
    overlay: overlay,
    host: host,

    hmi: normalizeHmiUi(rawHmi),
    viewId: viewIdInitial,

    rafId: 0,
    destroyed: false,

    // DOM Mapping
    widgetNodes: [],
    nodeByBindingId: {},
    svgByBindingId: {},
    widgetById: {},
    bindingById: {},

    // Signals
    signals: {},

    // Managed classes (Styles/Alarms)
    styleManagedWidget: {},
    styleManagedSvg: {},
    alarmManagedWidget: {},
    alarmManagedSvg: {},

    // Alarm state
    alarmState: {},

    stackGapPx: (typeof params.stackGapPx === 'number') ? params.stackGapPx : 6
  };

  var eventRuntime = createSvgEventRuntime({
    svgRoot: svgRoot,
    hmiUi: state.hmi
  });
  var externalInteraction = typeof options.onInteraction === 'function'
    ? options.onInteraction : null;
  options.onInteraction = function (info) {
    var interaction = info && typeof info === 'object' ? info : {};
    var action = String(interaction.action || interaction.type || 'click');
    var binding = interaction.binding || {};
    var detail = {
      active: true,
      action: action,
      binding_id: binding.binding_id || '',
      element_id: binding.element_id || '',
      widget_id: binding.widget_id || ''
    };
    eventRuntime.dispatch('interaction', detail);
    eventRuntime.dispatch('interaction:' + action, detail);
    if (externalInteraction) externalInteraction(info);
  };

  function clearWidgetNodes() {
    var nodes = state.widgetNodes || [];
    for (var i = 0; i < nodes.length; i += 1) {
      var n = nodes[i];
      if (n && n.parentElement) {
        try { n.parentElement.removeChild(n); } catch (_) {}
      }
    }
    state.widgetNodes = [];
    state.nodeByBindingId = {};
    state.svgByBindingId = {};
    state.widgetById = {};
    state.bindingById = {};
  }

  function toKeyFromRef(ref) {
    if (!ref || typeof ref !== 'object') return '';
    var kind = String(ref.kind || '').toLowerCase();
    var field = String(ref.field || 'value');

    var id = null;
    if (kind === 'sensor') id = (ref.sensor_id != null) ? ref.sensor_id : ref.id;
    if (kind === 'actuator') id = (ref.actuator_id != null) ? ref.actuator_id : ref.id;
    if (kind === 'state') id = (ref.state_id != null) ? ref.state_id : ref.id;

    if (id == null) return '';
    return kind + ':' + String(id) + ':' + field;
  }

  function toKeyFromSource(src) {
    return toKeyFromRef(src);
  }

  function getSignalByKey(key) {
    if (!key) return null;
    if (!Object.prototype.hasOwnProperty.call(state.signals, key)) return null;
    return state.signals[key];
  }

  function setManagedClasses(el, key, desiredSet, storeObj) {
    if (!el || !el.classList) return;

    var prev = storeObj[key];
    if (!prev) prev = new Set();

    prev.forEach(function (c) {
      if (!desiredSet.has(c)) {
        try { el.classList.remove(c); } catch (_) {}
      }
    });

    desiredSet.forEach(function (c) {
      try { el.classList.add(c); } catch (_) {}
    });

    storeObj[key] = desiredSet;
  }

  function removeClasses(el, classes) {
    if (!el || !el.classList) return;
    for (var i = 0; i < classes.length; i += 1) {
      try { el.classList.remove(classes[i]); } catch (_) {}
    }
  }

  function evalCmp(kind, idField, cond) {
    if (!cond || typeof cond !== 'object') return false;

    var id = cond[idField];
    if (id == null) return false;

    var field = String(cond.field || 'value');
    var key = kind + ':' + String(id) + ':' + field;
    var v = getSignalByKey(key);
    if (v == null) return false;

    var n = Number(v);
    if (!Number.isFinite(n)) return false;

    var thr = Number(cond.value);
    if (!Number.isFinite(thr)) return false;

    var op = String(cond.op || '>=');

    if (op === '>=') return n >= thr;
    if (op === '>') return n > thr;
    if (op === '<=') return n <= thr;
    if (op === '<') return n < thr;
    if (op === '==') return n === thr;
    if (op === '!=') return n !== thr;
    return false;
  }

  function evalCondition(cond) {
    if (!cond || typeof cond !== 'object') return false;

    if (cond.type === 'sensor_cmp') return evalCmp('sensor', 'sensor_id', cond);
    if (cond.type === 'actuator_cmp') return evalCmp('actuator', 'actuator_id', cond);

    if (cond.type === 'signal_cmp') {
      var ref = cond.ref || null;
      if (!ref) return false;

      var key = toKeyFromRef(ref);
      if (!key) return false;

      var v = getSignalByKey(key);
      if (v == null) return false;

      var n = Number(v);
      if (!Number.isFinite(n)) return false;

      var thr = Number(cond.value);
      if (!Number.isFinite(thr)) return false;

      var op = String(cond.op || '>=');

      if (op === '>=') return n >= thr;
      if (op === '>') return n > thr;
      if (op === '<=') return n <= thr;
      if (op === '<') return n < thr;
      if (op === '==') return n === thr;
      if (op === '!=') return n !== thr;
      return false;
    }

    return false;
  }

  function formatNumeric(binding, rawVal) {
    var n = Number(rawVal);
    if (!Number.isFinite(n)) return null;

    var tr = (binding && binding.transform && typeof binding.transform === 'object') ? binding.transform : {};
    var fmt = (binding && binding.format && typeof binding.format === 'object') ? binding.format : {};

    var scale = toNumberOrNull(tr.scale);
    if (scale == null) scale = 1;

    var offset = toNumberOrNull(tr.offset);
    if (offset == null) offset = 0;

    n = (n * scale) + offset;

    var clamp = tr.clamp;
    if (Array.isArray(clamp) && clamp.length === 2) {
      var cmin = toNumberOrNull(clamp[0]);
      var cmax = toNumberOrNull(clamp[1]);
      if (cmin != null) n = Math.max(cmin, n);
      if (cmax != null) n = Math.min(cmax, n);
    }

    var dec = (fmt.decimals != null) ? Number(fmt.decimals) : 0;
    if (!Number.isFinite(dec) || dec < 0) dec = 0;
    if (dec > 6) dec = 6;

    var unit = String(fmt.unit || '');

    var txt = n.toFixed(dec);
    if (unit) txt = txt + ' ' + unit;

    return txt;
  }

  function applyIndicatorStateClass(node, widgetCfg, rawVal) {
    if (!node || !node.classList) return;

    var mode = (widgetCfg && widgetCfg.mode) ? String(widgetCfg.mode) : '';
    if (mode !== 'class') return;

    var states = (widgetCfg && Array.isArray(widgetCfg.states)) ? widgetCfg.states : [];
    var def = (widgetCfg && widgetCfg.default_state) ? String(widgetCfg.default_state) : '';

    var stateName = def;

    if (typeof rawVal === 'string') {
      stateName = rawVal;
    } else {
      // numeric -> bleibt default (kein threshold mapping im Modell)
      stateName = def;
    }

    var cls = '';
    for (var i = 0; i < states.length; i += 1) {
      var s = states[i];
      if (!s) continue;
      if (String(s.name) === String(stateName)) {
        cls = String(s.class || '');
        break;
      }
    }

    var prev = node.getAttribute('data-indicator-state-class') || '';
    if (prev) {
      prev.split(/\s+/).filter(Boolean).forEach(function (c) {
        try { node.classList.remove(c); } catch (_) {}
      });
    }

    if (cls) {
      cls.split(/\s+/).filter(Boolean).forEach(function (c) {
        try { node.classList.add(c); } catch (_) {}
      });
      node.setAttribute('data-indicator-state-class', cls);
    } else {
      node.setAttribute('data-indicator-state-class', '');
    }
  }

  function updateWidgetValues() {
    var model = state.hmi || {};
    var viewId = state.viewId || model.active_view_id || 'main';

    var bindings = ensureArray(model.bindings).filter(function (b) {
      return b && (b.view_id || 'main') === viewId;
    });

    for (var i = 0; i < bindings.length; i += 1) {
      var b = bindings[i];
      if (!b || !b.binding_id) continue;

      var node = state.nodeByBindingId[String(b.binding_id)];
      if (!node) continue;

      var widget = state.widgetById[b.widget_id] || null;
      if (!widget) continue;

      var type = String(widget.type || 'text');
      var cfg = (widget.config && typeof widget.config === 'object') ? widget.config : {};

      var key = toKeyFromSource(b.source);
      var v = getSignalByKey(key);

      if (type === 'toggle') {
        if (v == null) continue;
        var on = !!Number(v);
        var onLabel = String(cfg.label_on || 'ON');
        var offLabel = String(cfg.label_off || 'OFF');
        node.textContent = on ? onLabel : offLabel;
        try { node.classList.toggle('is-on', on); } catch (_) {}
        continue;
      }

      if (type === 'indicator') {
        // class-mode: immer default-state setzen, selbst ohne Signal
        applyIndicatorStateClass(node, cfg, v);

        if (v == null) continue;

        // wenn numeric -> value anzeigen
        var txtI = formatNumeric(b, v);
        if (txtI != null) node.textContent = txtI;
        continue;
      }

      if (type === 'text') {
        if (v == null) continue;
        var txt = formatNumeric(b, v);
        if (txt == null) continue;

        var prefix = (cfg.prefix != null) ? String(cfg.prefix) : '';
        var suffix = (cfg.suffix != null) ? String(cfg.suffix) : '';
        node.textContent = prefix + txt + suffix;
        continue;
      }
    }
  }

  function applyBaseSvgTargetClasses(bindings) {
    // union pro element_id (damit mehrere Widgets nicht gegenseitig SVG-Klassen "wegnehmen")
    var byElement = {};
    for (var i = 0; i < bindings.length; i += 1) {
      var b = bindings[i];
      if (!b || !b.element_id) continue;

      var widget = state.widgetById[b.widget_id];
      var cfg = (widget && widget.config && typeof widget.config === 'object') ? widget.config : {};
      var raw = cfg.svg_target_classes;

      var arr = [];
      if (Array.isArray(raw)) arr = raw.slice();
      else if (typeof raw === 'string') arr = raw.split(/\s+/).filter(Boolean);

      if (!arr.length) continue;

      if (!byElement[b.element_id]) byElement[b.element_id] = new Set();
      arr.forEach(function (c) { if (c) byElement[b.element_id].add(String(c)); });
    }

    Object.keys(byElement).forEach(function (elementId) {
      var target = document.getElementById(elementId);
      if (!target || !target.classList) return;

      var desired = byElement[elementId];
      var prevStr = target.getAttribute('data-hmi-svg-target-classes-base') || '';
      var prev = prevStr.split(/\s+/).filter(Boolean);

      prev.forEach(function (c) { try { target.classList.remove(c); } catch (_) {} });
      desired.forEach(function (c) { try { target.classList.add(c); } catch (_) {} });

      target.setAttribute('data-hmi-svg-target-classes-base', Array.from(desired).join(' '));
    });
  }

  function applyStylesAndAlarms() {
    var model = state.hmi || {};
    var viewId = state.viewId || model.active_view_id || 'main';

    var bindings = ensureArray(model.bindings).filter(function (b) {
      return b && (b.view_id || 'main') === viewId;
    });

    // -------- Styles --------
    var styles = ensureArray(model.styles).filter(function (s) {
      return s && (s.view_id || 'main') === viewId;
    });

    var desiredWidget = {};
    var desiredSvg = {};
    var removeWidgetMap = {};
    var removeSvgMap = {};

    for (var si = 0; si < styles.length; si += 1) {
      var s = styles[si];
      if (!s) continue;

      if (!evalCondition(s.when)) continue;

      var bid = s.target && s.target.binding_id ? String(s.target.binding_id) : '';
      if (!bid) continue;

      if (!desiredWidget[bid]) desiredWidget[bid] = new Set();
      if (!desiredSvg[bid]) desiredSvg[bid] = new Set();
      if (!removeWidgetMap[bid]) removeWidgetMap[bid] = new Set();
      if (!removeSvgMap[bid]) removeSvgMap[bid] = new Set();

      var add = (s.apply && Array.isArray(s.apply.classes_add)) ? s.apply.classes_add : [];
      var rem = (s.apply && Array.isArray(s.apply.classes_remove)) ? s.apply.classes_remove : [];

      add.forEach(function (c) {
        if (!c) return;
        desiredWidget[bid].add(String(c));
        desiredSvg[bid].add(String(c));
      });

      rem.forEach(function (c) {
        if (!c) return;
        removeWidgetMap[bid].add(String(c));
        removeSvgMap[bid].add(String(c));
      });
    }

    bindings.forEach(function (b) {
      var bid = String(b.binding_id || '');
      if (!bid) return;

      var node = state.nodeByBindingId[bid] || null;
      var svgEl = state.svgByBindingId[bid] || null;

      var addW = desiredWidget[bid] ? desiredWidget[bid] : new Set();
      var addS = desiredSvg[bid] ? desiredSvg[bid] : new Set();

      setManagedClasses(node, bid, addW, state.styleManagedWidget);
      setManagedClasses(svgEl, bid, addS, state.styleManagedSvg);

      var remW = removeWidgetMap[bid] ? Array.from(removeWidgetMap[bid]) : [];
      var remS = removeSvgMap[bid] ? Array.from(removeSvgMap[bid]) : [];

      removeClasses(node, remW);
      removeClasses(svgEl, remS);
    });

    // -------- Alarms --------
    var alarms = ensureArray(model.alarms).filter(function (a) {
      return a && (a.view_id || 'main') === viewId;
    });

    var alarmWidget = {};
    var alarmSvg = {};

    for (var ai = 0; ai < alarms.length; ai += 1) {
      var a = alarms[ai];
      if (!a || !a.alarm_id) continue;

      var aid = String(a.alarm_id);
      var sev = String(a.severity || 'info').toLowerCase();

      var isActive = evalCondition(a.condition);

      state.alarmState[aid] = { active: !!isActive, severity: sev };

      if (!isActive) continue;

      var targetBid = (a.target && a.target.binding_id) ? String(a.target.binding_id) : '';

      bindings.forEach(function (b) {
        if (!b || !b.binding_id) return;

        var bid = String(b.binding_id);
        var match = false;

        if (targetBid) {
          match = (bid === targetBid);
        } else {
          var aKey = toKeyFromSource(a.source);
          var bKey = toKeyFromSource(b.source);
          if (aKey && bKey && aKey === bKey) match = true;
        }

        if (!match) return;

        if (!alarmWidget[bid]) alarmWidget[bid] = new Set();
        if (!alarmSvg[bid]) alarmSvg[bid] = new Set();

        alarmWidget[bid].add('hmi-alarm');
        alarmWidget[bid].add('hmi-alarm-active');
        alarmWidget[bid].add('hmi-alarm-sev-' + sev);

        alarmSvg[bid].add('hmi-alarm');
        alarmSvg[bid].add('hmi-alarm-active');
        alarmSvg[bid].add('hmi-alarm-sev-' + sev);

        if (sev === 'critical' || sev === 'warn' || sev === 'warning') {
          alarmWidget[bid].add('hmi-anim-blink');
          alarmSvg[bid].add('hmi-anim-blink');
        }
      });
    }

    bindings.forEach(function (b) {
      var bid = String(b.binding_id || '');
      if (!bid) return;

      var node = state.nodeByBindingId[bid] || null;
      var svgEl = state.svgByBindingId[bid] || null;

      var aSetW = alarmWidget[bid] ? alarmWidget[bid] : new Set();
      var aSetS = alarmSvg[bid] ? alarmSvg[bid] : new Set();

      setManagedClasses(node, bid, aSetW, state.alarmManagedWidget);
      setManagedClasses(svgEl, bid, aSetS, state.alarmManagedSvg);
    });
    eventRuntime.setAlarmStates(state.alarmState);
  }

  function scheduleRender() {
    if (state.destroyed) return;
    if (state.rafId) return;
    state.rafId = window.requestAnimationFrame(function () {
      state.rafId = 0;
      try { renderNow(); } catch (e) { console.error('HMI Runtime: renderNow() Fehler', e); }
    });
  }

	function renderNow() {
		if (state.destroyed) return;

		clearWidgetNodes();

		var model = state.hmi || {};
		var viewId = state.viewId || model.active_view_id || 'main';

		var widgets = ensureArray(model.widgets);
		var bindings = ensureArray(model.bindings).filter(function (b) {
			return b && (b.view_id || 'main') === viewId;
		});

		for (var wi = 0; wi < widgets.length; wi += 1) {
			var w = widgets[wi];
			if (w && w.widget_id) state.widgetById[w.widget_id] = w;
		}

		for (var bi = 0; bi < bindings.length; bi += 1) {
			var bb = bindings[bi];
			if (bb && bb.binding_id) state.bindingById[String(bb.binding_id)] = bb;
		}

		if (!bindings.length) return;

		var hostRect = state.host.getBoundingClientRect();

		// Scene-Zoom aus ScreenCTM (CSS-Scaling + ggf. Layer-Transform)
		var zoomRaw = 1;
		try {
			var layer = (state.svgRoot && state.svgRoot.querySelector)
				? (state.svgRoot.querySelector('#elements-layer') || state.svgRoot)
				: state.svgRoot;

			var m = (layer && layer.getScreenCTM) ? layer.getScreenCTM() : null;
			if (m) {
				var sx = Math.sqrt((m.a * m.a) + (m.b * m.b));
				var sy = Math.sqrt((m.c * m.c) + (m.d * m.d));
				zoomRaw = ((sx + sy) / 2);
			}
		} catch (_) { zoomRaw = 1; }

		if (!Number.isFinite(zoomRaw) || zoomRaw <= 0) zoomRaw = 1;

		// ✅ UI-Zoom-Limiter
		var uiZoom = Math.min(zoomRaw, 1);
		try { state.host.style.setProperty('--hmi-zoom', String(uiZoom)); } catch (_) {}

		// Stacking
		var stackByGroup = {};
		var gap = Math.max(2, (state.stackGapPx || 6) * uiZoom);

		for (var j = 0; j < bindings.length; j += 1) {
			var b = bindings[j];
			if (!b || !b.element_id || !b.widget_id || !b.binding_id) continue;

			var target = document.getElementById(b.element_id);
			if (!target || !target.getBoundingClientRect) continue;

			var r = target.getBoundingClientRect();
			if (!r || (!r.width && !r.height)) continue;

			var plc = (b.placement && typeof b.placement === 'object') ? b.placement : {};
			var anchorName = plc.anchor || 'center';

			// ✅ dx/dy mit UI-Zoom “mit shrinken”, nicht wachsen beim Zoom-In
			var dxRaw = toNumberOrNull(plc.dx) || 0;
			var dyRaw = toNumberOrNull(plc.dy) || 0;

			var dx = dxRaw * uiZoom;
			var dyBase = dyRaw * uiZoom;

			var anchor = computeAnchorPoint(r, anchorName);
			var baseX = (anchor.x - hostRect.left) + dx;
			var baseY = (anchor.y - hostRect.top) + dyBase;

			var groupKey = String(b.element_id) + '|' + String(anchorName) + '|' + String(dxRaw) + '|' + String(dyRaw);
			var stack = stackByGroup[groupKey] || 0;

			var widget = state.widgetById[b.widget_id] || { type: 'text', name: 'Widget', config: {} };
			var node = createWidgetElement(widget, b, options);

			node.style.left = String(baseX) + 'px';
			node.style.top = String(baseY + stack) + 'px';
			node.style.zIndex = String((options && options.zIndexWidgets) ? options.zIndexWidgets : 21);

			state.host.appendChild(node);
			state.widgetNodes.push(node);

			state.nodeByBindingId[String(b.binding_id)] = node;
			state.svgByBindingId[String(b.binding_id)] = target;

			var h = Math.max(20 * uiZoom, node.getBoundingClientRect().height || 0);
			stackByGroup[groupKey] = stack + h + gap;
		}

		applyBaseSvgTargetClasses(bindings);
		updateWidgetValues();
		applyStylesAndAlarms();
		eventRuntime.refresh();
	}



  function setView(viewId) {
    if (!viewId) return;
    state.viewId = viewId;
    scheduleRender();
  }

  function updateHmi(hmiUi) {
    state.hmi = normalizeHmiUi(hmiUi || {});
    eventRuntime.updateModel(state.hmi);
    scheduleRender();
  }

  // ✅ SCADA: Client liefert Live-Daten an die Runtime
  function setSignal(ref, value) {
    var key = toKeyFromRef(ref);
    if (!key) return;
    state.signals[key] = value;

    // inkrementell (kein full render)
    eventRuntime.setSignal(ref, value);
    updateWidgetValues();
    applyStylesAndAlarms();
  }

  function setSignals(batch) {
    if (!batch) return;
    if (Array.isArray(batch)) {
      for (var i = 0; i < batch.length; i += 1) {
        var it = batch[i];
        if (!it) continue;
        setSignal(it.ref, it.value);
      }
      return;
    }

    // object map: key->value
    if (typeof batch === 'object') {
      Object.keys(batch).forEach(function (k) {
        state.signals[String(k)] = batch[k];
      });
      eventRuntime.setSignals(batch);
      updateWidgetValues();
      applyStylesAndAlarms();
    }
  }

  function getSignal(ref) {
    var key = toKeyFromRef(ref);
    if (!key) return null;
    return getSignalByKey(key);
  }

  function dispatchSvgEvent(eventName, detail) {
    return eventRuntime.dispatch(eventName, detail || {});
  }

  function getSvgEventState() {
    return eventRuntime.getState();
  }

  var onResize = function () { scheduleRender(); };
  window.addEventListener('resize', onResize);

  function destroy() {
    state.destroyed = true;
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }

    window.removeEventListener('resize', onResize);

    clearWidgetNodes();
    eventRuntime.destroy();

    if (state.overlay && state.overlay.parentElement) {
      try { state.overlay.parentElement.removeChild(state.overlay); } catch (_) {}
    }
    state.overlay = null;
  }

  scheduleRender();

  return {
    render: scheduleRender,
    renderNow: renderNow,
    setView: setView,
    updateHmi: updateHmi,

    // ✅ SCADA API
    setSignal: setSignal,
    setSignals: setSignals,
    getSignal: getSignal,

    // V64 generic event interface
    dispatchSvgEvent: dispatchSvgEvent,
    getSvgEventState: getSvgEventState,
    getSvgEventValidation: function () { return eventRuntime.validate(); },

    getAlarms: function () { return deepClone(state.alarmState); },
    getModel: function () { return deepClone(state.hmi); },
    destroy: destroy
  };
}



export { createHmiRuntime };
