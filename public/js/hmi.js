/**
/**
 * HMI/SCADA Export-Standard (Kurz)
 *
 * Dateien (Bundle):
 *  - <name>.svg   : Anlage (SVG-Geometry) + IDs + optionale data-* Meta (Debug/Interop)
 *  - <name>.json  : Runtime-Config inkl. cfg.hmi_ui (widgets/bindings/styles/alarms)
 *  - <name>.html  : Loader (lädt svg+json, startet hmi_runtime.js)
 *
 * cfg.hmi_ui:
 *  - widgets[]  : Widget-Definition (toggle/indicator/button/text/slider + appearance config)
 *  - bindings[] : Verknüpft widget_id ↔ element_id ↔ source/interaction + placement(anchor,dx,dy)
 *  - styles[]   : Condition -> apply classes (Overlay + SVG)
 *  - alarms[]   : Condition -> Severity/Latching/Ack (Overlay + SVG)
 *  - event_animations[] : Runtime-Ereignis -> elementarer SVG-Effekt
 *
 * Wichtig:
 *  - Mehrere Widgets pro SVG-Element: über mehrere bindings[] (nicht ein binding überschreiben)
 *  - “Quelle aus Device-Zuweisung übernehmen” koppelt Widget-Sources sauber an Assignments.
 */
import { state, showStatus, handleError } from './core.js';
import { elementManager } from './elements.js';
import { listAssignedSensors, listAssignedActuators } from './device.js';
import { showConfirmation } from './dialog_service.js';
import { renderHmiEventAnimationDesigner } from './v64_hmi_animation_ui.js';
// ------------------------- Helpers -------------------------
function byId(id) { return document.getElementById(id); }
function deepClone(obj) {
    if (obj === null || obj === undefined)
        return obj;
    try {
        return JSON.parse(JSON.stringify(obj));
    }
    catch (e) {
        return obj;
    }
}
function uniq(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }
function nowId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}
function toNumberOrNull(v) {
    if (v === null || v === undefined)
        return null;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t === '')
            return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function toIntOrNull(v) {
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
}
function ensureHmiModel() {
    const current = state.get('hmi');
    // Wenn alte Struktur (assignments) drin ist -> ignorieren und neu initialisieren
    const looksOld = current && typeof current === 'object' && current.assignments && !current.views;
    if (!current || typeof current !== 'object' || looksOld) {
        const fresh = {
            version: 1,
            active_view_id: 'main',
            views: [
                { view_id: 'main', name: 'Main', svg_ref: 'main', tags: ['default'] }
            ],
            widgets: [],
            bindings: [],
            styles: [],
            alarms: [],
            event_animations: []
        };
        state.set('hmi', fresh);
        return fresh;
    }
    // sanfte Ergänzung fehlender Felder
    const m = deepClone(current);
    if (!m.version)
        m.version = 1;
    if (!m.active_view_id)
        m.active_view_id = 'main';
    if (!Array.isArray(m.views) || m.views.length === 0) {
        m.views = [{ view_id: 'main', name: 'Main', svg_ref: 'main', tags: ['default'] }];
    }
    if (!Array.isArray(m.widgets))
        m.widgets = [];
    if (!Array.isArray(m.bindings))
        m.bindings = [];
    if (!Array.isArray(m.styles))
        m.styles = [];
    if (!Array.isArray(m.alarms))
        m.alarms = [];
    if (!Array.isArray(m.event_animations))
        m.event_animations = [];
    state.set('hmi', m);
    return m;
}
function commitHmiModel(next, reason) {
    state.set('hmi', next);
    state.saveHistory();
    state.emit('hmi_ui:updated', { reason: reason || 'update' });
}
function getDeviceConfig() {
    const cfg = state.get('deviceConfig');
    if (cfg && typeof cfg === 'object')
        return cfg;
    // Fallback – verhindert Crashes wenn deviceConfig noch nicht geladen ist
    return {
        controllers: [],
        actuators: [],
        sensors: [],
        devices: [],
        sensor_types: [],
        modbus_functions: []
    };
}
function getSvgElementsList() {
    // 1) Prefer: elementManager (schnell & zuverlässig)
    try {
        if (elementManager && typeof elementManager.getAllElements === 'function') {
            const items = elementManager.getAllElements() || [];
            return items
                .map(function (it) {
                const d = (it && it.data) ? it.data : {};
                const id = d.id || (it && it.element && it.element.id) || '';
                if (!id)
                    return null;
                const name = d.name || d.templateId || id;
                return { element_id: id, label: `${name} (${id})` };
            })
                .filter(Boolean);
        }
    }
    catch (e) {
        // ignore – fallback below
    }
    // 2) Fallback: DOM Query (falls elementManager aus irgendeinem Grund nicht bereit ist)
    try {
        const layer = document.getElementById('elements-layer');
        if (!layer)
            return [];
        const nodes = Array.from(layer.querySelectorAll('g.svg-element[id]'));
        return nodes.map(function (n) {
            const id = n.getAttribute('id') || '';
            const tpl = n.getAttribute('data-template-id') || '';
            const name = tpl || id;
            return { element_id: id, label: `${name} (${id})` };
        });
    }
    catch (e2) {
        return [];
    }
}

function selectedCanvasElementId() {
    const selected = state.get('selectedElements') || [];
    if (!Array.isArray(selected) || selected.length !== 1)
        return '';
    return String(selected[0] || '');
}

function svgElementLabel(elementId) {
    const id = String(elementId || '');
    if (!id)
        return '';
    const item = getSvgElementsList().find(function (entry) {
        return entry.element_id === id;
    });
    return item ? item.label : id;
}

function primaryWidgetBinding(model, widgetId, viewId) {
    const activeViewId = viewId || model.active_view_id || 'main';
    return (model.bindings || []).find(function (binding) {
        return binding.widget_id === widgetId
            && (binding.view_id || 'main') === activeViewId;
    }) || null;
}

function inferSourceFromDeviceAssignment(elementId, widgetType) {
    const devices = state.get('devices') || { assignments: {} };
    const assignment = (devices.assignments || {})[elementId] || null;
    if (!assignment)
        return null;
    const sensorId = toIntOrNull(assignment.sensor_id);
    const actuatorId = toIntOrNull(assignment.actuator_id);
    const role = assignment.role ? String(assignment.role) : '';
    let preferredRole = '';
    if (widgetType === 'toggle' || widgetType === 'button' || widgetType === 'slider')
        preferredRole = 'actuator';
    if (widgetType === 'indicator' || widgetType === 'text')
        preferredRole = 'sensor';
    if (preferredRole === 'actuator' && actuatorId != null)
        return { kind: 'actuator', actuator_id: actuatorId, field: 'value' };
    if (preferredRole === 'sensor' && sensorId != null)
        return { kind: 'sensor', sensor_id: sensorId, field: 'value' };
    if (role === 'actuator' && actuatorId != null)
        return { kind: 'actuator', actuator_id: actuatorId, field: 'value' };
    if (role === 'sensor' && sensorId != null)
        return { kind: 'sensor', sensor_id: sensorId, field: 'value' };
    if (actuatorId != null)
        return { kind: 'actuator', actuator_id: actuatorId, field: 'value' };
    if (sensorId != null)
        return { kind: 'sensor', sensor_id: sensorId, field: 'value' };
    return null;
}

function hmiSourceSummary(source, interaction) {
    if (source && source.kind === 'sensor')
        return 'Sensor ' + String(source.sensor_id ?? '–') + ' · ' + String(source.field || 'value');
    if (source && source.kind === 'actuator')
        return 'Aktor ' + String(source.actuator_id ?? '–') + ' · ' + String(source.field || 'value');
    if (source && source.kind === 'state')
        return 'Process State ' + String(source.state_id ?? '–') + ' · ' + String(source.field || 'value');
    if (interaction && interaction.action && interaction.action !== 'none')
        return 'Interaktion · ' + String(interaction.action);
    return 'Quelle / Interaktion noch offen';
}

function defaultBindingForWidget(widget, elementId) {
    const source = inferSourceFromDeviceAssignment(elementId, widget.type);
    return {
        binding_id: nowId('b'),
        view_id: widget.view_id || 'main',
        widget_id: widget.widget_id,
        element_id: elementId,
        source: source,
        format: { unit: '', decimals: 0 },
        transform: { scale: 1.0, offset: 0.0, clamp: [null, null] },
        placement: { anchor: 'top', dx: 0, dy: -24 },
        interaction: null
    };
}
// ------------------------- HMI Runtime Preview -------------------------
let hmiPreviewRuntime = null;
function initHmiPreviewRuntime() {
    const svgRoot = document.getElementById('main-canvas');
    if (!svgRoot) {
        console.warn('HMI Preview: main-canvas nicht gefunden');
        return;
    }
    if (hmiPreviewRuntime) {
        hmiPreviewRuntime.destroy();
        hmiPreviewRuntime = null;
    }
    hmiPreviewRuntime = createHmiRuntime({
        svgRoot: svgRoot,
        hmiUi: state.hmi && state.hmi.hmi_ui ? state.hmi.hmi_ui : {},
        viewId: state.hmi && state.hmi.hmi_ui && state.hmi.hmi_ui.active_view_id
            ? state.hmi.hmi_ui.active_view_id
            : 'main',
        onInteraction: function (info) {
            // Im Editor keine echte IO – optional z.B. nur Logging:
            console.log('HMI Preview Interaction (Editor)', {
                widget_id: info.widget && info.widget.widget_id,
                binding_id: info.binding && info.binding.binding_id,
                source: info.source,
                action: info.action
            });
        }
    });
}
function updateHmiPreviewRuntime() {
    if (!hmiPreviewRuntime)
        return;
    const hmiUi = state.hmi && state.hmi.hmi_ui ? state.hmi.hmi_ui : {};
    hmiPreviewRuntime.updateHmi(hmiUi);
}
// ------------------------- Data Sources (frei wählbare IDs) -------------------------
function getAvailableSensors() {
    const cfg = getDeviceConfig();
    const sensorsCfg = cfg.sensors || [];
    const assigned = listAssignedSensors() || [];
    const aliasById = {};
    assigned.forEach(function (a) {
        const id = toIntOrNull(a && a.sensor_id);
        if (id != null)
            aliasById[String(id)] = a.alias || '';
    });
    const ids = new Set();
    sensorsCfg.forEach(function (s) {
        const id = toIntOrNull(s && s.sensor_id);
        if (id != null)
            ids.add(id);
    });
    assigned.forEach(function (a) {
        const id = toIntOrNull(a && a.sensor_id);
        if (id != null)
            ids.add(id);
    });
    return Array.from(ids)
        .sort(function (a, b) {
        return a - b;
    })
        .map(function (id) {
        const alias = aliasById[String(id)] || '';
        const label = alias ? `${alias} (S${id})` : `Sensor ${id}`;
        return { sensor_id: id, label: label };
    });
}
function getAvailableActuators() {
    const cfg = getDeviceConfig();
    const actsCfg = cfg.actuators || [];
    const assigned = listAssignedActuators() || [];
    const aliasById = {};
    assigned.forEach(function (a) {
        const id = toIntOrNull(a && a.actuator_id);
        if (id != null)
            aliasById[String(id)] = a.alias || '';
    });
    const ids = new Set();
    actsCfg.forEach(function (a) {
        const id = toIntOrNull(a && a.actuator_id);
        if (id != null)
            ids.add(id);
    });
    // ✅ auch “projekt-only” IDs
    assigned.forEach(function (a) {
        const id = toIntOrNull(a && a.actuator_id);
        if (id != null)
            ids.add(id);
    });
    return Array.from(ids)
        .sort(function (a, b) {
        return a - b;
    })
        .map(function (id) {
        const alias = aliasById[String(id)] || '';
        const label = alias ? `${alias} (A${id})` : `Actuator ${id}`;
        return { actuator_id: id, label: label };
    });
}
function getAvailableProcessStates() {
    // Quellen:
    // - Projekt-States (Wizard/Processes Modul): state.get('processes').process_states
    // - Config-States (deviceConfig): deviceConfig.process_states
    const proj = state.get('processes') || {};
    const projStates = Array.isArray(proj.process_states) ? proj.process_states : [];
    const cfg = (typeof getDeviceConfig === 'function')
        ? getDeviceConfig()
        : (state.get('deviceConfig') || {});
    const cfgStates = Array.isArray(cfg.process_states) ? cfg.process_states : [];
    // Prozessnamen aus Config (falls vorhanden)
    const procNameById = {};
    const cfgProcs = Array.isArray(cfg.processes) ? cfg.processes : [];
    cfgProcs.forEach(function (p) {
        const pid = toIntOrNull(p && p.p_id);
        if (pid === null)
            return;
        const name = (p.process_name || p.process_location || ('P' + pid));
        procNameById[String(pid)] = String(name);
    });
    // Merge + Unique
    const map = new Map();
    function add(ps) {
        if (!ps || typeof ps !== 'object')
            return;
        const sid = toIntOrNull(ps.state_id != null ? ps.state_id : ps.id);
        if (sid === null)
            return;
        const pid = toIntOrNull(ps.p_id);
        const st = ps.state_type || ps.name || '';
        const pName = (pid !== null && procNameById[String(pid)]) ? procNameById[String(pid)] : (pid !== null ? ('P' + pid) : '');
        let label = '';
        if (pName && st)
            label = `${pName} / ${st} (State ${sid})`;
        else if (st)
            label = `${st} (State ${sid})`;
        else if (pName)
            label = `${pName} (State ${sid})`;
        else
            label = `State ${sid}`;
        // Bevorzugt: falls schon vorhanden, nicht überschreiben (stable)
        if (!map.has(sid))
            map.set(sid, { state_id: sid, label: label });
    }
    cfgStates.forEach(add);
    projStates.forEach(add);
    return Array.from(map.values()).sort(function (a, b) {
        return a.state_id - b.state_id;
    });
}
// ------------------------- UI State -------------------------
const ui = {
    container: null,
    subtab: 'widgets',
    selectedWidgetId: null,
    selectedBindingId: null,
    selectedStyleId: null,
    selectedAlarmId: null,
    disclosures: {
        stylesPreview: true,
        stylesManual: false,
        thresholdAdvanced: false,
        appearanceAdvanced: false
    }
};
// ------------------------- Canvas Overlay (HMI Preview) -------------------------
const hmiOverlay = {
    enabled: false,
    rootId: 'hmi-canvas-overlay',
    rootEl: null,
    rafId: 0,
    installed: false,
    observer: null,
    stackOffsetPx: 18
};
function ensureHmiOverlayRoot() {
    const host = document.getElementById('canvas-container');
    if (!host)
        return null;
    const cs = window.getComputedStyle(host);
    if (!cs.position || cs.position === 'static') {
        host.style.position = 'relative';
    }
    let root = document.getElementById(hmiOverlay.rootId);
    if (!root) {
        root = document.createElement('div');
        root.id = hmiOverlay.rootId;
        root.style.position = 'absolute';
        root.style.left = '0';
        root.style.top = '0';
        root.style.right = '0';
        root.style.bottom = '0';
        root.style.pointerEvents = 'none';
        root.style.zIndex = '20';
        host.appendChild(root);
    }
    hmiOverlay.rootEl = root;
    return root;
}
function computeAnchorPoint(rect, anchor) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (anchor === 'top')
        return { x: cx, y: rect.top };
    if (anchor === 'bottom')
        return { x: cx, y: rect.bottom };
    if (anchor === 'left')
        return { x: rect.left, y: cy };
    if (anchor === 'right')
        return { x: rect.right, y: cy };
    return { x: cx, y: cy };
}
function formatSourceShort(src) {
    if (!src || typeof src !== 'object')
        return '';
    if (src.kind === 'sensor')
        return `S${src.sensor_id}.${src.field || 'value'}`;
    if (src.kind === 'actuator')
        return `A${src.actuator_id}.${src.field || 'value'}`;
    if (src.kind === 'state')
        return `State${src.state_id}.${src.field || 'active'}`;
    return '';
}
function widgetPreviewLabel(widget, binding) {
    const w = widget || {};
    const cfg = w.config || {};
    const type = w.type || 'text';
    if (type === 'button')
        return String(cfg.label || w.name || 'Button');
    if (type === 'toggle')
        return `${cfg.label_on || 'ON'}/${cfg.label_off || 'OFF'}`;
    if (type === 'slider')
        return String(cfg.label || w.name || 'Setpoint');
    if (type === 'indicator')
        return String(w.name || 'Indicator');
    const prefix = String(cfg.prefix || '');
    const suffix = String(cfg.suffix || '');
    const fallback = String(cfg.fallback || '--');
    const unit = (binding && binding.format && binding.format.unit)
        ? String(binding.format.unit)
        : '';
    const src = (binding && binding.source) ? formatSourceShort(binding.source) : '';
    const core = src || fallback;
    const out = `${prefix}${core}${suffix}${unit ? ' ' + unit : ''}`.trim();
    return out || 'Text';
}
function createOverlayNode(widget, binding) {
    const w = widget || {};
    const cfg = (w && w.config && typeof w.config === 'object') ? w.config : {};
    const type = w.type || 'text';
    const label = widgetPreviewLabel(w, binding);
    const isIncomplete = !(binding && (binding.source || binding.interaction));
    let el;
    if (type === 'button' || type === 'toggle')
        el = document.createElement('button');
    else
        el = document.createElement('div');
    el.textContent = label;
    // Live-Preview / Debug Zuordnung
    el.setAttribute('data-hmi-binding-id', String(binding && binding.binding_id ? binding.binding_id : ''));
    el.setAttribute('data-hmi-element-id', String(binding && binding.element_id ? binding.element_id : ''));
    el.setAttribute('data-hmi-widget-id', String(w && w.widget_id ? w.widget_id : ''));
    el.setAttribute('data-hmi-default-text', String(label || ''));
    // Appearance defaults
    const variant = String(cfg.variant || 'default');
    const size = String(cfg.size || 'md');
    const shape = String(cfg.shape || 'pill');
    let bg = 'rgba(15, 23, 42, 0.92)';
    let fg = '#f8fafc';
    let border = 'rgba(59, 130, 246, 0.65)';
    if (variant === 'primary') {
        bg = 'var(--v9-accent, #2563eb)';
        fg = '#ffffff';
        border = 'color-mix(in srgb, var(--v9-accent, #2563eb) 72%, white)';
    }
    else if (variant === 'outline') {
        bg = 'var(--v9-surface-0, #ffffff)';
        fg = 'var(--v9-ink, #0f172a)';
        border = 'var(--v9-accent, #2563eb)';
    }
    else if (variant === 'ghost') {
        bg = 'color-mix(in srgb, var(--v9-surface-0, #ffffff) 88%, transparent)';
        fg = 'var(--v9-ink, #0f172a)';
        border = 'transparent';
    }
    // size defaults
    let pad = (type === 'button' || type === 'toggle') ? '6px 10px' : '4px 8px';
    let fontPx = 12;
    if (size === 'sm') {
        pad = (type === 'button' || type === 'toggle') ? '4px 8px' : '3px 6px';
        fontPx = 11;
    }
    if (size === 'lg') {
        pad = (type === 'button' || type === 'toggle') ? '8px 12px' : '6px 10px';
        fontPx = 14;
    }
    // overrides
    if (cfg.bg_color)
        bg = String(cfg.bg_color);
    if (cfg.text_color)
        fg = String(cfg.text_color);
    if (cfg.border_color)
        border = String(cfg.border_color);
    const bw = (toNumberOrNull(cfg.border_width) ?? 1);
    const fz = toNumberOrNull(cfg.font_size);
    if (fz != null)
        fontPx = fz;
    let radius = '999px';
    if (shape === 'rounded')
        radius = '10px';
    if (shape === 'square')
        radius = '0px';
    el.className = `hmi-ov hmi-ov-${type}`;
    el.style.position = 'absolute';
    // ✅ Fix #2: Transform-Reihenfolge korrigieren (sonst driftet Center bei scale != 1)
    // "scale(...) translate(-50%,-50%)" => translate wird mit skaliert => stabiler Anchor
    el.style.transformOrigin = '0 0';
    el.style.transform = 'scale(var(--hmi-zoom, 1)) translate(-50%, -50%)';
    el.style.pointerEvents = 'auto';
    el.style.whiteSpace = 'nowrap';
    el.style.borderRadius = radius;
    el.style.fontSize = `${fontPx}px`;
    el.style.lineHeight = '1.2';
    el.style.padding = pad;
    el.style.background = bg;
    el.style.color = fg;
    el.style.border = isIncomplete
        ? `${bw}px dashed rgba(148, 163, 184, 0.8)`
        : `${bw}px solid ${border}`;
    el.style.opacity = isIncomplete ? '0.75' : '1.0';
    // Extra CSS Klassen
    let extra = [];
    if (Array.isArray(cfg.classes))
        extra = cfg.classes;
    else if (typeof cfg.classes === 'string')
        extra = cfg.classes.split(/\s+/);
    extra.filter(Boolean).forEach(function (cls) {
        try {
            el.classList.add(cls);
        }
        catch (_) { }
    });
    // Klick -> Binding fokussieren
    el.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const tabBtn = document.getElementById('tab-btn-hmi');
        if (tabBtn)
            tabBtn.click();
        ui.subtab = 'bindings';
        ui.selectedBindingId = binding.binding_id;
        renderAll();
    });
    return el;
}
/*
function createOverlayNode(widget, binding) {
  const w = widget || {};
  const cfg = (w && w.config && typeof w.config === 'object') ? w.config : {};
  const type = w.type || 'text';
  const label = widgetPreviewLabel(w, binding);

  const isIncomplete = !(binding && (binding.source || binding.interaction));

  let el;
  if (type === 'button' || type === 'toggle') el = document.createElement('button');
  else el = document.createElement('div');

  el.textContent = label;

  // ✅ Damit Live-Preview sicher zuordnen kann:
  el.setAttribute('data-hmi-binding-id', String(binding && binding.binding_id ? binding.binding_id : ''));
  el.setAttribute('data-hmi-element-id', String(binding && binding.element_id ? binding.element_id : ''));
  el.setAttribute('data-hmi-widget-id', String(w && w.widget_id ? w.widget_id : ''));
  el.setAttribute('data-hmi-default-text', String(label || ''));

  // --- appearance defaults ---
  const variant = String(cfg.variant || 'default');
  const size = String(cfg.size || 'md');
  const shape = String(cfg.shape || 'pill');

  let bg = 'rgba(15, 23, 42, 0.92)';
  let fg = '#e5e7eb';
  let border = 'rgba(59, 130, 246, 0.65)';

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

  // size defaults
  let pad = (type === 'button' || type === 'toggle') ? '6px 10px' : '4px 8px';
  let fontPx = 12;
  if (size === 'sm') { pad = (type === 'button' || type === 'toggle') ? '4px 8px' : '3px 6px'; fontPx = 11; }
  if (size === 'lg') { pad = (type === 'button' || type === 'toggle') ? '8px 12px' : '6px 10px'; fontPx = 14; }

  // overrides
  if (cfg.bg_color) bg = String(cfg.bg_color);
  if (cfg.text_color) fg = String(cfg.text_color);
  if (cfg.border_color) border = String(cfg.border_color);

  const bw = (toNumberOrNull(cfg.border_width) ?? 1);
  const fz = toNumberOrNull(cfg.font_size);
  if (fz != null) fontPx = fz;

  let radius = '999px';
  if (shape === 'rounded') radius = '10px';
  if (shape === 'square') radius = '0px';

  el.className = `hmi-ov hmi-ov-${type}`;
  el.style.position = 'absolute';
  el.style.transform = 'translate(-50%, -50%)';
  el.style.pointerEvents = 'auto';
  el.style.whiteSpace = 'nowrap';
  el.style.borderRadius = radius;
  el.style.fontSize = `${fontPx}px`;
  el.style.lineHeight = '1.2';
  el.style.padding = pad;

  el.style.background = bg;
  el.style.color = fg;

  el.style.border = isIncomplete
    ? `${bw}px dashed rgba(148, 163, 184, 0.8)`
    : `${bw}px solid ${border}`;

  el.style.opacity = isIncomplete ? '0.75' : '1.0';

  // extra CSS classes
  let extra = [];
  if (Array.isArray(cfg.classes)) extra = cfg.classes;
  else if (typeof cfg.classes === 'string') extra = cfg.classes.split(/\s+/);

  extra.filter(Boolean).forEach(cls => {
    try { el.classList.add(cls); } catch (_) {}
  });

  // Klick -> Binding fokussieren
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const tabBtn = document.getElementById('tab-btn-hmi');
    if (tabBtn) tabBtn.click();

    ui.subtab = 'bindings';
    ui.selectedBindingId = binding.binding_id;
    renderAll();
  });

  return el;
} */
function renderHmiOverlayNow() {
    const root = ensureHmiOverlayRoot();
    if (!root)
        return;
    root.innerHTML = '';
    root.hidden = !hmiOverlay.enabled;
    root.setAttribute('aria-hidden', hmiOverlay.enabled ? 'false' : 'true');
    if (!hmiOverlay.enabled)
        return;
    // Maps für Live-Preview / Debug
    hmiOverlay.nodesByBindingId = {};
    hmiOverlay.svgByBindingId = {};
    const model = ensureHmiModel();
    const viewId = model.active_view_id || 'main';
    const widgetById = new Map((model.widgets || []).map(function (w) {
        return [w.widget_id, w];
    }));
    const bindings = (model.bindings || []).filter(function (b) {
        return (b && (b.view_id || 'main') === viewId);
    });
    if (!bindings.length)
        return;
    const rootRect = root.getBoundingClientRect();
    // Szene-Zoom (Canvas)
    const z = Number(state.get('zoom'));
    const sceneZoom = (Number.isFinite(z) && z > 0) ? z : 1;
    // ✅ UI-Zoom-Limiter: Widgets wachsen ab Zoom>=1 nicht weiter
    const uiZoom = Math.min(sceneZoom, 1);
    // zentrale Zoom-Variable
    root.style.setProperty('--hmi-zoom', String(uiZoom));
    const svgRoot = document.getElementById('main-canvas');
    function anchorPointToScreen(target, anchorName) {
        // Stabil: BBox + ScreenCTM
        try {
            if (svgRoot && target && typeof target.getBBox === 'function' && typeof target.getScreenCTM === 'function') {
                const bbox = target.getBBox();
                const ctm = target.getScreenCTM();
                if (!ctm)
                    throw new Error('no ctm');
                let x = bbox.x + bbox.width / 2;
                let y = bbox.y + bbox.height / 2;
                if (anchorName === 'top')
                    y = bbox.y;
                else if (anchorName === 'bottom')
                    y = bbox.y + bbox.height;
                else if (anchorName === 'left')
                    x = bbox.x;
                else if (anchorName === 'right')
                    x = bbox.x + bbox.width;
                if (typeof DOMPoint !== 'undefined') {
                    const p = new DOMPoint(x, y).matrixTransform(ctm);
                    return { x: p.x, y: p.y };
                }
                if (typeof svgRoot.createSVGPoint === 'function') {
                    const pt = svgRoot.createSVGPoint();
                    pt.x = x;
                    pt.y = y;
                    const sp = pt.matrixTransform(ctm);
                    return { x: sp.x, y: sp.y };
                }
            }
        }
        catch (_) { }
        // Fallback: ClientRect
        try {
            const r = target.getBoundingClientRect();
            return computeAnchorPoint(r, anchorName);
        }
        catch (_) {
            return null;
        }
    }
    // dynamisches Stacking pro Placement-Gruppe (Screen-PX)
    const stackByGroup = new Map();
    const gapPx = Math.max(2, 6 * uiZoom);
    bindings.forEach(function (b) {
        if (!b || !b.element_id || !b.widget_id || !b.binding_id)
            return;
        const target = document.getElementById(b.element_id);
        if (!target)
            return;
        const plc = (b.placement && typeof b.placement === 'object') ? b.placement : {};
        const anchorName = plc.anchor || 'center';
        // ✅ WICHTIG: dx/dy “mit shrinken” beim Zoom-Out, aber nicht weiter wachsen beim Zoom-In
        const dxRaw = toNumberOrNull(plc.dx) ?? 0;
        const dyRaw = toNumberOrNull(plc.dy) ?? 0;
        const dx = dxRaw * uiZoom;
        const dyBase = dyRaw * uiZoom;
        const anchor = anchorPointToScreen(target, anchorName);
        if (!anchor)
            return;
        const baseX = (anchor.x - rootRect.left) + dx;
        const baseY = (anchor.y - rootRect.top) + dyBase;
        // Grouping stabil nach RAW-Werten (nicht nach skalierten)
        const groupKey = `${b.element_id}|${anchorName}|${dxRaw}|${dyRaw}`;
        const stack = stackByGroup.get(groupKey) || 0;
        const w = widgetById.get(b.widget_id) || {
            widget_id: b.widget_id,
            type: 'text',
            name: 'Widget',
            config: { fallback: '?' }
        };
        const el = createOverlayNode(w, b);
        el.style.left = `${baseX}px`;
        el.style.top = `${baseY + stack}px`;
        root.appendChild(el);
        hmiOverlay.nodesByBindingId[String(b.binding_id)] = el;
        hmiOverlay.svgByBindingId[String(b.binding_id)] = target;
        const h = Math.max(20 * uiZoom, el.getBoundingClientRect().height || 0);
        stackByGroup.set(groupKey, stack + h + gapPx);
    });
    if (typeof hmiLiveApply === 'function') {
        hmiLiveApply(model);
    }
}
/* function renderHmiOverlayNow() {
  const root = ensureHmiOverlayRoot();
  if (!root) return;

  root.innerHTML = '';
  if (!hmiOverlay.enabled) return;

  // Maps für Live-Preview / Debug
  hmiOverlay.nodesByBindingId = {};
  hmiOverlay.svgByBindingId = {};

  const model = ensureHmiModel();
  const viewId = model.active_view_id || 'main';

  const svgRoot = document.getElementById('main-canvas');
  const widgetById = new Map((model.widgets || []).map(w => [w.widget_id, w]));
  const bindings = (model.bindings || []).filter(
    b => (b && (b.view_id || 'main') === viewId)
  );

  const rootRect = root.getBoundingClientRect();

  function findSvgElementById(id) {
    if (!id) return null;
    if (svgRoot) {
      // robust: suche innerhalb der SVG (nicht im ganzen Dokument)
      try {
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
          const el = svgRoot.querySelector('#' + CSS.escape(id));
          if (el) return el;
        }
      } catch (e) { // ignore }

      try {
        const safe = String(id).replace(/"/g, '\\"');
        const el2 = svgRoot.querySelector('[id="' + safe + '"]');
        if (el2) return el2;
      } catch (e) { // ignore }
    }

    // Fallback (sollte selten nötig sein)
    return document.getElementById(id);
  }

  function anchorPointToScreen(target, anchorName) {
    // 1) bevorzugt: SVG BBox + Screen CTM (stabil bei Zoom/Pan)
    try {
      if (svgRoot && target && typeof target.getBBox === 'function' && typeof target.getScreenCTM === 'function') {
        const bbox = target.getBBox();
        const ctm = target.getScreenCTM();
        if (!ctm) throw new Error('no ctm');

        let x = bbox.x + bbox.width / 2;
        let y = bbox.y + bbox.height / 2;

        if (anchorName === 'top') y = bbox.y;
        else if (anchorName === 'bottom') y = bbox.y + bbox.height;
        else if (anchorName === 'left') x = bbox.x;
        else if (anchorName === 'right') x = bbox.x + bbox.width;

        // DOMPoint bevorzugt, SVGPoint fallback
        let p;
        if (typeof DOMPoint !== 'undefined') {
          p = new DOMPoint(x, y).matrixTransform(ctm);
          return { x: p.x, y: p.y };
        }

        if (typeof svgRoot.createSVGPoint === 'function') {
          const pt = svgRoot.createSVGPoint();
          pt.x = x;
          pt.y = y;
          const sp = pt.matrixTransform(ctm);
          return { x: sp.x, y: sp.y };
        }
      }
    } catch (e) {
      // fallback unten
    }

    // 2) Fallback: ClientRect (kann bei Zoom leicht driften)
    try {
      const r = target.getBoundingClientRect();
      return computeAnchorPoint(r, anchorName);
    } catch (e) {
      return null;
    }
  }

  // ✅ dynamisches Stacking pro Placement-Gruppe
  const stackByGroup = new Map();
  const gapPx = 6;

  bindings.forEach((b) => {
    if (!b || !b.element_id || !b.widget_id || !b.binding_id) return;

    const target = findSvgElementById(b.element_id);
    if (!target) return;

    const plc = (b.placement && typeof b.placement === 'object') ? b.placement : {};
    const anchorName = plc.anchor || 'center';

    // dx/dy sind laut UI "px" -> Screen-Pixel (konstant beim Zoom)
    const dx = toNumberOrNull(plc.dx) ?? 0;
    const dyBase = toNumberOrNull(plc.dy) ?? 0;

    const anchor = anchorPointToScreen(target, anchorName);
    if (!anchor) return;

    const baseX = (anchor.x - rootRect.left) + dx;
    const baseY = (anchor.y - rootRect.top) + dyBase;

    const groupKey = `${b.element_id}|${anchorName}|${dx}|${dyBase}`;
    const stack = stackByGroup.get(groupKey) || 0;

    const w = widgetById.get(b.widget_id) || {
      widget_id: b.widget_id,
      type: 'text',
      name: 'Widget',
      config: { fallback: '?' }
    };

    const el = createOverlayNode(w, b);
    el.style.left = `${baseX}px`;
    el.style.top = `${baseY + stack}px`;

    root.appendChild(el);

    // maps
    hmiOverlay.nodesByBindingId[String(b.binding_id)] = el;
    hmiOverlay.svgByBindingId[String(b.binding_id)] = target;

    // Stackhöhe dynamisch (Widgets bleiben lesbar, nicht skaliert)
    const h = Math.max(20, el.getBoundingClientRect().height || 0);
    stackByGroup.set(groupKey, stack + h + gapPx);
  });

  // Live Preview anwenden (Werte + Styles/Alarms), falls vorhanden
  if (typeof hmiLiveApply === 'function') {
    hmiLiveApply(model);
  }
} */
function scheduleHmiOverlayRender() {
    if (hmiOverlay.rafId)
        return;
    hmiOverlay.rafId = window.requestAnimationFrame(function () {
        hmiOverlay.rafId = 0;
        try {
            renderHmiOverlayNow();
        }
        catch (e) {
            console.error('HMI Overlay Render Fehler:', e);
        }
    });
}
export function setEngineeringHmiOverlayEnabled(enabled) {
    hmiOverlay.enabled = enabled === true;
    scheduleHmiOverlayRender();
    state.emit('hmi-overlay:changed', hmiOverlay.enabled);
    return hmiOverlay.enabled;
}
export function getEngineeringHmiOverlayEnabled() {
    return hmiOverlay.enabled === true;
}
export function refreshEngineeringHmiOverlay() {
    scheduleHmiOverlayRender();
}
function installHmiOverlayHooks() {
    if (hmiOverlay.installed)
        return;
    hmiOverlay.installed = true;
    // Canvas-/Model-Events, die das Overlay beeinflussen
    state.on('hmi_ui:updated', scheduleHmiOverlayRender);
    state.on('element:added', scheduleHmiOverlayRender);
    state.on('element:updated', scheduleHmiOverlayRender);
    state.on('element:removed', scheduleHmiOverlayRender);
    state.on('elements:rebuilt', scheduleHmiOverlayRender);
    state.on('history:restored', scheduleHmiOverlayRender);
    state.on('devices:updated', scheduleHmiOverlayRender);
    state.on('state:zoom', scheduleHmiOverlayRender);
    state.on('state:pan', scheduleHmiOverlayRender);
    window.addEventListener('resize', scheduleHmiOverlayRender);
    // falls irgendwo direkt am transform geschraubt wird
    const layer = document.getElementById('elements-layer');
    if (layer && !hmiOverlay.observer) {
        hmiOverlay.observer = new MutationObserver(function () {
            return scheduleHmiOverlayRender();
        });
        hmiOverlay.observer.observe(layer, {
            attributes: true,
            attributeFilter: ['transform']
        });
    }
    scheduleHmiOverlayRender();
}
// ------------------------- Live Preview (SCADA Simulation) -------------------------
//
// Ziel: Styles/Alarms + Indicator/Toggle im Editor simulieren, ohne echte IO.
// Bedienung: Slider/Number im Styles&Alarms-Tab -> setzt "Signals" -> wendet Klassen
// auf Overlay UND SVG an + aktualisiert Indicator/Toggle Text.
//
// Achtung: Diese Preview ist rein lokal (Editor), sie ändert KEINE Projekt-Daten.
const hmiLivePreview = {
    enabled: true,
    // UI state
    selectedKey: '',
    min: 0,
    max: 200,
    step: 1,
    // signals: key -> value
    signals: {},
    // managed classes (damit wir sauber entfernen können)
    managedOverlayByBinding: {}, // binding_id -> Set
    managedSvgByElement: {}, // element_id -> Set
    managedBaseSvgByElement: {} // element_id -> Set (aus widget.config.svg_target_classes)
};
function hmiLiveKeyFromSource(src) {
    if (!src || typeof src !== 'object')
        return '';
    const kind = String(src.kind || '').toLowerCase();
    const field = String(src.field || 'value');
    let id = null;
    if (kind === 'sensor')
        id = (src.sensor_id != null) ? src.sensor_id : src.id;
    if (kind === 'actuator')
        id = (src.actuator_id != null) ? src.actuator_id : src.id;
    if (kind === 'state')
        id = (src.state_id != null) ? src.state_id : src.id;
    if (id == null)
        return '';
    return `${kind}:${String(id)}:${field}`;
}
function hmiLiveGetSignalByKey(key) {
    if (!key)
        return null;
    if (!Object.prototype.hasOwnProperty.call(hmiLivePreview.signals, key))
        return null;
    return hmiLivePreview.signals[key];
}
function hmiLiveSetSignalByKey(key, value) {
    if (!key)
        return;
    hmiLivePreview.signals[key] = value;
    // Direkt anwenden (ohne Re-Render)
    const model = ensureHmiModel();
    hmiLiveApply(model);
}
function hmiLiveCollectSources(model) {
    const viewId = model.active_view_id || 'main';
    const sensorLabel = {};
    getAvailableSensors().forEach(function (s) { sensorLabel[String(s.sensor_id)] = s.label; });
    const actLabel = {};
    getAvailableActuators().forEach(function (a) { actLabel[String(a.actuator_id)] = a.label; });
    const seen = new Set();
    const out = [];
    // 1) aus Bindings (am sinnvollsten)
    (model.bindings || [])
        .filter(function (b) {
        return b && (b.view_id || 'main') === viewId && b.source;
    })
        .forEach(function (b) {
        const key = hmiLiveKeyFromSource(b.source);
        if (!key || seen.has(key))
            return;
        seen.add(key);
        const k = String(b.source.kind || '').toLowerCase();
        let label = key;
        if (k === 'sensor') {
            const sid = (b.source.sensor_id != null) ? b.source.sensor_id : b.source.id;
            label = (sensorLabel[String(sid)] || `Sensor ${sid}`) + ` • ${String(b.source.field || 'value')}`;
        }
        else if (k === 'actuator') {
            const aid = (b.source.actuator_id != null) ? b.source.actuator_id : b.source.id;
            label = (actLabel[String(aid)] || `Actuator ${aid}`) + ` • ${String(b.source.field || 'value')}`;
        }
        else {
            label = key;
        }
        out.push({ key, label });
    });
    // 2) aus Alarms (falls noch kein Binding dafür existiert)
    (model.alarms || [])
        .filter(function (a) {
        return a && (a.view_id || 'main') === viewId && a.source;
    })
        .forEach(function (a) {
        const key = hmiLiveKeyFromSource(a.source);
        if (!key || seen.has(key))
            return;
        seen.add(key);
        out.push({ key, label: `Alarm Source • ${key}` });
    });
    return out;
}
function hmiLiveCmp(op, a, b) {
    if (op === '>=')
        return a >= b;
    if (op === '>')
        return a > b;
    if (op === '<=')
        return a <= b;
    if (op === '<')
        return a < b;
    if (op === '==')
        return a === b;
    if (op === '!=')
        return a !== b;
    return false;
}
function hmiLiveEvalCondition(cond) {
    if (!cond || typeof cond !== 'object')
        return false;
    const type = String(cond.type || '');
    if (type === 'sensor_cmp') {
        const sid = toIntOrNull(cond.sensor_id);
        if (sid == null)
            return false;
        const field = String(cond.field || 'value');
        const key = `sensor:${sid}:${field}`;
        const v = hmiLiveGetSignalByKey(key);
        if (v == null)
            return false;
        const n = Number(v);
        const thr = Number(cond.value);
        if (!Number.isFinite(n) || !Number.isFinite(thr))
            return false;
        return hmiLiveCmp(String(cond.op || '>='), n, thr);
    }
    if (type === 'actuator_cmp') {
        const aid = toIntOrNull(cond.actuator_id);
        if (aid == null)
            return false;
        const field = String(cond.field || 'value');
        const key = `actuator:${aid}:${field}`;
        const v = hmiLiveGetSignalByKey(key);
        if (v == null)
            return false;
        const n = Number(v);
        const thr = Number(cond.value);
        if (!Number.isFinite(n) || !Number.isFinite(thr))
            return false;
        return hmiLiveCmp(String(cond.op || '>='), n, thr);
    }
    // optional: signal_cmp (generisch)
    if (type === 'signal_cmp') {
        const ref = cond.ref || null;
        const key = hmiLiveKeyFromSource(ref);
        if (!key)
            return false;
        const v = hmiLiveGetSignalByKey(key);
        if (v == null)
            return false;
        const n = Number(v);
        const thr = Number(cond.value);
        if (!Number.isFinite(n) || !Number.isFinite(thr))
            return false;
        return hmiLiveCmp(String(cond.op || '>='), n, thr);
    }
    return false;
}
function hmiLiveFormatValue(binding, rawVal) {
    const n0 = Number(rawVal);
    if (!Number.isFinite(n0))
        return null;
    const tr = (binding && binding.transform && typeof binding.transform === 'object') ? binding.transform : {};
    const fmt = (binding && binding.format && typeof binding.format === 'object') ? binding.format : {};
    let n = n0;
    const scale = toNumberOrNull(tr.scale);
    const offset = toNumberOrNull(tr.offset);
    n = n * ((scale == null) ? 1 : scale);
    n = n + ((offset == null) ? 0 : offset);
    const clamp = tr.clamp;
    if (Array.isArray(clamp) && clamp.length === 2) {
        const cmin = toNumberOrNull(clamp[0]);
        const cmax = toNumberOrNull(clamp[1]);
        if (cmin != null)
            n = Math.max(cmin, n);
        if (cmax != null)
            n = Math.min(cmax, n);
    }
    let dec = (fmt.decimals != null) ? Number(fmt.decimals) : 0;
    if (!Number.isFinite(dec) || dec < 0)
        dec = 0;
    if (dec > 6)
        dec = 6;
    const unit = String(fmt.unit || '').trim();
    let txt = n.toFixed(dec);
    if (unit)
        txt = `${txt} ${unit}`;
    return txt;
}
function hmiLiveApplyManagedClasses(el, key, desiredSet, store) {
    if (!el || !el.classList)
        return;
    const prev = store[key] || new Set();
    prev.forEach(function (c) {
        if (!desiredSet.has(c)) {
            try {
                el.classList.remove(c);
            }
            catch (_) { }
        }
    });
    desiredSet.forEach(function (c) {
        try {
            el.classList.add(c);
        }
        catch (_) { }
    });
    store[key] = desiredSet;
}
function hmiLiveApplyBaseSvgTargetClasses(model, bindings, widgetById) {
    // union pro element_id, damit mehrere Widgets nicht gegeneinander arbeiten
    const byElement = {};
    bindings.forEach(function (b) {
        if (!b || !b.element_id || !b.widget_id)
            return;
        const w = widgetById[b.widget_id];
        const cfg = (w && w.config && typeof w.config === 'object') ? w.config : {};
        const raw = cfg.svg_target_classes;
        let arr = [];
        if (Array.isArray(raw))
            arr = raw.slice();
        else if (typeof raw === 'string')
            arr = raw.split(/\s+/).filter(Boolean);
        if (!arr.length)
            return;
        if (!byElement[b.element_id])
            byElement[b.element_id] = new Set();
        arr.forEach(function (c) { if (c)
            byElement[b.element_id].add(String(c)); });
    });
    Object.keys(byElement).forEach(function (elementId) {
        const target = document.getElementById(elementId);
        if (!target || !target.classList)
            return;
        const desired = byElement[elementId];
        // remove prev base (editor)
        const prev = (target.getAttribute('data-hmi-svg-target-classes-base') || '')
            .split(/\s+/).filter(Boolean);
        prev.forEach(function (c) { try {
            target.classList.remove(c);
        }
        catch (_) { } });
        desired.forEach(function (c) { try {
            target.classList.add(c);
        }
        catch (_) { } });
        target.setAttribute('data-hmi-svg-target-classes-base', Array.from(desired).join(' '));
        hmiLivePreview.managedBaseSvgByElement[elementId] = desired;
    });
}
function hmiLiveApply(model) {
    if (!hmiLivePreview.enabled)
        return;
    const viewId = model.active_view_id || 'main';
    const bindings = (model.bindings || []).filter(function (b) {
        return b && (b.view_id || 'main') === viewId;
    });
    const widgets = (model.widgets || []);
    const widgetById = {};
    widgets.forEach(function (w) { if (w && w.widget_id)
        widgetById[w.widget_id] = w; });
    // 1) base SVG target classes aus widget.config.svg_target_classes
    hmiLiveApplyBaseSvgTargetClasses(model, bindings, widgetById);
    // 2) Indicator/Toggle/Text Werte updaten (wenn Signal existiert)
    bindings.forEach(function (b) {
        if (!b || !b.binding_id || !b.widget_id)
            return;
        const node = (hmiOverlay && hmiOverlay.nodesByBindingId) ? hmiOverlay.nodesByBindingId[String(b.binding_id)] : null;
        if (!node)
            return;
        const w = widgetById[b.widget_id];
        if (!w)
            return;
        const type = String(w.type || 'text');
        const cfg = (w.config && typeof w.config === 'object') ? w.config : {};
        const key = hmiLiveKeyFromSource(b.source);
        const v = hmiLiveGetSignalByKey(key);
        const def = node.getAttribute('data-hmi-default-text') || node.textContent || '';
        if (v == null) {
            // kein Signal -> default Text
            node.textContent = def;
            return;
        }
        if (type === 'toggle') {
            const on = !!Number(v);
            const onLabel = String(cfg.label_on || 'ON');
            const offLabel = String(cfg.label_off || 'OFF');
            node.textContent = on ? onLabel : offLabel;
            try {
                node.classList.toggle('is-on', on);
            }
            catch (_) { }
            return;
        }
        if (type === 'indicator' || type === 'text') {
            const txt = hmiLiveFormatValue(b, v);
            if (txt == null)
                return;
            if (type === 'text') {
                const prefix = (cfg.prefix != null) ? String(cfg.prefix) : '';
                const suffix = (cfg.suffix != null) ? String(cfg.suffix) : '';
                node.textContent = prefix + txt + suffix;
            }
            else {
                node.textContent = txt;
            }
            return;
        }
    });
    // 3) Styles & Alarms -> Klassen auf Overlay UND SVG
    // Overlay desired per binding
    const desiredOverlay = {};
    // SVG desired per element
    const desiredSvg = {};
    // remove lists
    const removeOverlay = {};
    const removeSvg = {};
    function ensureSet(map, k) {
        if (!map[k])
            map[k] = new Set();
        return map[k];
    }
    // Helper: apply struct old+new
    function applyAddRemove(targetBid, addW, remW, addS, remS) {
        if (!targetBid)
            return;
        const b = bindings.find(function (x) {
            return x && String(x.binding_id) === String(targetBid);
        });
        if (!b)
            return;
        const elId = String(b.element_id || '');
        addW.forEach(function (c) { if (c)
            ensureSet(desiredOverlay, targetBid).add(String(c)); });
        remW.forEach(function (c) { if (c)
            ensureSet(removeOverlay, targetBid).add(String(c)); });
        if (elId) {
            addS.forEach(function (c) { if (c)
                ensureSet(desiredSvg, elId).add(String(c)); });
            remS.forEach(function (c) { if (c)
                ensureSet(removeSvg, elId).add(String(c)); });
        }
    }
    // Styles
    (model.styles || []).filter(function (s) {
        return s && (s.view_id || 'main') === viewId;
    }).forEach(function (s) {
        if (!hmiLiveEvalCondition(s.when))
            return;
        const bid = s.target && s.target.binding_id ? String(s.target.binding_id) : '';
        if (!bid)
            return;
        const ap = (s.apply && typeof s.apply === 'object') ? s.apply : {};
        const addW = Array.isArray(ap.classes_add_widget) ? ap.classes_add_widget : (Array.isArray(ap.classes_add) ? ap.classes_add : []);
        const remW = Array.isArray(ap.classes_remove_widget) ? ap.classes_remove_widget : (Array.isArray(ap.classes_remove) ? ap.classes_remove : []);
        const addS = Array.isArray(ap.classes_add_svg) ? ap.classes_add_svg : (Array.isArray(ap.classes_add) ? ap.classes_add : []);
        const remS = Array.isArray(ap.classes_remove_svg) ? ap.classes_remove_svg : (Array.isArray(ap.classes_remove) ? ap.classes_remove : []);
        applyAddRemove(bid, addW, remW, addS, remS);
    });
    // Alarms
    (model.alarms || []).filter(function (a) {
        return a && (a.view_id || 'main') === viewId;
    }).forEach(function (a) {
        const isActive = hmiLiveEvalCondition(a.condition);
        if (!isActive)
            return;
        const sev = String(a.severity || 'INFO').toLowerCase();
        // Ziel: entweder target.binding_id oder Source-Match
        const tBid = (a.target && a.target.binding_id) ? String(a.target.binding_id) : '';
        const baseOverlay = ['hmi-alarm', 'hmi-alarm-active', 'hmi-alarm-sev-' + sev];
        const baseSvg = ['hmi-alarm', 'hmi-alarm-active', 'hmi-alarm-sev-' + sev];
        // Blink?
        let blinkClass = 'hmi-anim-blink';
        const vis = (a.visual && typeof a.visual === 'object') ? a.visual : null;
        const blink = vis ? !!vis.blink : (sev === 'warn' || sev === 'warning' || sev === 'critical');
        if (vis && vis.blink_class)
            blinkClass = String(vis.blink_class);
        if (blink) {
            baseOverlay.push(blinkClass);
            baseSvg.push(blinkClass);
        }
        const ap = (a.apply && typeof a.apply === 'object') ? a.apply : {};
        const addW = Array.isArray(ap.classes_add_widget) ? ap.classes_add_widget : (Array.isArray(ap.classes_add) ? ap.classes_add : []);
        const remW = Array.isArray(ap.classes_remove_widget) ? ap.classes_remove_widget : (Array.isArray(ap.classes_remove) ? ap.classes_remove : []);
        const addS = Array.isArray(ap.classes_add_svg) ? ap.classes_add_svg : (Array.isArray(ap.classes_add) ? ap.classes_add : []);
        const remS = Array.isArray(ap.classes_remove_svg) ? ap.classes_remove_svg : (Array.isArray(ap.classes_remove) ? ap.classes_remove : []);
        if (tBid) {
            applyAddRemove(tBid, baseOverlay.concat(addW), remW, baseSvg.concat(addS), remS);
            return;
        }
        // Source-Match: alle Bindings mit gleicher Source
        const aKey = hmiLiveKeyFromSource(a.source);
        if (!aKey)
            return;
        bindings.forEach(function (b) {
            const bKey = hmiLiveKeyFromSource(b.source);
            if (bKey && bKey === aKey) {
                applyAddRemove(String(b.binding_id), baseOverlay.concat(addW), remW, baseSvg.concat(addS), remS);
            }
        });
    });
    // Apply to Overlay nodes
    bindings.forEach(function (b) {
        const bid = String(b.binding_id || '');
        if (!bid)
            return;
        const node = (hmiOverlay && hmiOverlay.nodesByBindingId) ? hmiOverlay.nodesByBindingId[bid] : null;
        if (!node)
            return;
        const dSet = desiredOverlay[bid] ? desiredOverlay[bid] : new Set();
        hmiLiveApplyManagedClasses(node, bid, dSet, hmiLivePreview.managedOverlayByBinding);
        // remove list
        const rSet = removeOverlay[bid] ? Array.from(removeOverlay[bid]) : [];
        rSet.forEach(function (c) { try {
            node.classList.remove(c);
        }
        catch (_) { } });
    });
    // Apply to SVG elements (union)
    Object.keys(desiredSvg).forEach(function (elementId) {
        const el = document.getElementById(elementId);
        if (!el || !el.classList)
            return;
        const dSet = desiredSvg[elementId] ? desiredSvg[elementId] : new Set();
        hmiLiveApplyManagedClasses(el, elementId, dSet, hmiLivePreview.managedSvgByElement);
        const rSet = removeSvg[elementId] ? Array.from(removeSvg[elementId]) : [];
        rSet.forEach(function (c) { try {
            el.classList.remove(c);
        }
        catch (_) { } });
    });
}
function renderHmiLivePreviewPanel(model) {
    const host = byId('hmi-live-preview');
    if (!host)
        return;
    const sources = hmiLiveCollectSources(model);
    if (!sources.length) {
        host.innerHTML = `<div class="hmi-empty-state">Keine Runtime-Quelle verfügbar. Lege zuerst eine Datenbindung mit Sensor- oder Aktorquelle an.</div>`;
        return;
    }
    if (!hmiLivePreview.selectedKey || !sources.some(function (source) {
        return source.key === hmiLivePreview.selectedKey;
    })) {
        hmiLivePreview.selectedKey = sources[0].key;
    }
    let cur = hmiLiveGetSignalByKey(hmiLivePreview.selectedKey);
    if (cur == null)
        cur = 0;
    const opts = sources.map(function (source) {
        return `<option value="${escapeAttr(source.key)}" ${source.key === hmiLivePreview.selectedKey ? 'selected' : ''}>${escapeHtml(source.label)}</option>`;
    }).join('');
    host.innerHTML = `
    <div class="hmi-preview-control">
      <div class="grid-2 hmi-preview-signal-row">
        <div class="form-group">
          <label>Zielsignal</label>
          <select id="hmi-prev-sel" class="select-input">${opts}</select>
        </div>
        <div class="form-group">
          <label>Simulationswert</label>
          <input id="hmi-prev-val" class="text-input" type="number" value="${escapeAttr(cur)}"/>
        </div>
      </div>
      <div class="hmi-preview-slider-row">
        <input id="hmi-prev-slider" type="range"
               min="${escapeAttr(hmiLivePreview.min)}" max="${escapeAttr(hmiLivePreview.max)}"
               step="${escapeAttr(hmiLivePreview.step)}" value="${escapeAttr(cur)}"
               aria-label="Simulationswert"/>
      </div>
      <div class="hmi-preview-presets" aria-label="Schnellwerte">
        <span>Schnellwerte</span>
        <button id="hmi-prev-zero" class="btn btn-secondary" type="button">0</button>
        <button id="hmi-prev-mid" class="btn btn-secondary" type="button">50</button>
        <button id="hmi-prev-hi" class="btn btn-secondary" type="button">100</button>
        <button id="hmi-prev-rand" class="btn btn-secondary" type="button">Zufall</button>
        <button id="hmi-prev-clear" class="btn btn-secondary" type="button">Zurücksetzen</button>
      </div>
      <details class="hmi-disclosure hmi-disclosure--inline">
        <summary><span><strong>Simulationsbereich</strong><small>Minimalwert, Maximalwert und Schrittweite.</small></span></summary>
        <div class="hmi-disclosure__body grid-3">
          <div class="form-group"><label>Min</label><input id="hmi-prev-min" class="text-input" type="number" value="${escapeAttr(hmiLivePreview.min)}"/></div>
          <div class="form-group"><label>Max</label><input id="hmi-prev-max" class="text-input" type="number" value="${escapeAttr(hmiLivePreview.max)}"/></div>
          <div class="form-group"><label>Schritt</label><input id="hmi-prev-step" class="text-input" type="number" value="${escapeAttr(hmiLivePreview.step)}"/></div>
        </div>
      </details>
    </div>
  `;
    const sel = byId('hmi-prev-sel');
    const val = byId('hmi-prev-val');
    const slider = byId('hmi-prev-slider');
    function syncRange() {
        const mn = Number(byId('hmi-prev-min')?.value);
        const mx = Number(byId('hmi-prev-max')?.value);
        const st = Number(byId('hmi-prev-step')?.value);
        if (Number.isFinite(mn))
            hmiLivePreview.min = mn;
        if (Number.isFinite(mx))
            hmiLivePreview.max = mx;
        if (Number.isFinite(st) && st > 0)
            hmiLivePreview.step = st;
        if (slider) {
            slider.min = String(hmiLivePreview.min);
            slider.max = String(hmiLivePreview.max);
            slider.step = String(hmiLivePreview.step);
        }
    }
    function setValue(n) {
        const key = hmiLivePreview.selectedKey;
        if (!key)
            return;
        if (val)
            val.value = String(n);
        if (slider)
            slider.value = String(n);
        hmiLiveSetSignalByKey(key, n);
    }
    if (sel) {
        sel.addEventListener('change', function () {
            hmiLivePreview.selectedKey = sel.value || '';
            let cur2 = hmiLiveGetSignalByKey(hmiLivePreview.selectedKey);
            if (cur2 == null)
                cur2 = 0;
            setValue(Number(cur2));
        });
    }
    if (val) {
        val.addEventListener('input', function () {
            const n = Number(val.value);
            if (Number.isFinite(n))
                setValue(n);
        });
    }
    if (slider) {
        slider.addEventListener('input', function () {
            const n = Number(slider.value);
            if (Number.isFinite(n))
                setValue(n);
        });
    }
    ['hmi-prev-min', 'hmi-prev-max', 'hmi-prev-step'].forEach(function (id) {
        const element = byId(id);
        if (!element)
            return;
        element.addEventListener('change', syncRange);
        element.addEventListener('input', syncRange);
    });
    byId('hmi-prev-zero')?.addEventListener('click', function () { setValue(0); });
    byId('hmi-prev-mid')?.addEventListener('click', function () { setValue(50); });
    byId('hmi-prev-hi')?.addEventListener('click', function () { setValue(100); });
    byId('hmi-prev-rand')?.addEventListener('click', function () {
        const mn = Number(hmiLivePreview.min);
        const mx = Number(hmiLivePreview.max);
        setValue(Math.round(mn + Math.random() * (mx - mn)));
    });
    byId('hmi-prev-clear')?.addEventListener('click', function () {
        hmiLivePreview.signals = {};
        hmiLiveApply(ensureHmiModel());
    });
    syncRange();
}
// ------------------------- Render Root -------------------------
const HMI_WORKFLOW_STEPS = [
    {
        key: 'widgets',
        number: 1,
        label: 'Widgets',
        summary: 'Anzeige oder Bedienung anlegen',
        title: 'Schritt 1 · HMI-Widget auswählen',
        description: 'Lege nur die Anzeige- oder Bedienelemente an, die diese View wirklich benötigt. Buttons, Toggle und Slider bleiben bewusst optional.'
    },
    {
        key: 'bindings',
        number: 2,
        label: 'Datenbindung',
        summary: 'Widget, Objekt und Runtime koppeln',
        title: 'Schritt 2 · Datenfluss eindeutig verbinden',
        description: 'Ordne jedem Widget ein P&ID-/SVG-Objekt sowie eine Runtime-Quelle oder Interaktion zu. Der Editor führt durch Widget, Zielobjekt und Quelle.'
    },
    {
        key: 'styles',
        number: 3,
        label: 'Zustände & Alarme',
        summary: 'Reaktionen und Meldungen definieren',
        title: 'Schritt 3 · Zustände und Alarme festlegen',
        description: 'Definiere visuelle Zustände, Grenzwerte, Alarmklassen, Quittierung und Latching getrennt von Geometrie und Datenquelle.'
    },
    {
        key: 'appearance',
        number: 4,
        label: 'Darstellung',
        summary: 'View und Widget-Design finalisieren',
        title: 'Schritt 4 · Darstellung kontrolliert finalisieren',
        description: 'Passe Hintergrund und Widget-Erscheinungsbild an, nachdem Widget, Datenbindung und Zustandslogik vollständig definiert sind.'
    }
];
function findHmiWorkflowStep(key) {
    return HMI_WORKFLOW_STEPS.find(function (step) {
        return step.key === key;
    }) || HMI_WORKFLOW_STEPS[0];
}
function hmiStepStatus(model, key) {
    const viewId = model.active_view_id || 'main';
    if (key === 'widgets') {
        const count = (model.widgets || []).filter(function (item) {
            return (item.view_id || 'main') === viewId;
        }).length;
        return String(count) + (count === 1 ? ' Widget' : ' Widgets');
    }
    if (key === 'bindings') {
        const count = (model.bindings || []).filter(function (item) {
            return (item.view_id || 'main') === viewId;
        }).length;
        return String(count) + (count === 1 ? ' Binding' : ' Bindings');
    }
    if (key === 'styles') {
        const styles = (model.styles || []).filter(function (item) {
            return (item.view_id || 'main') === viewId;
        }).length;
        const alarms = (model.alarms || []).filter(function (item) {
            return (item.view_id || 'main') === viewId;
        }).length;
        return String(styles) + ' Zustände · ' + String(alarms) + ' Alarme';
    }
    const views = (model.views || []).length;
    return String(views) + (views === 1 ? ' View' : ' Views');
}
function renderHmiWorkflowOverview(model) {
    const steps = HMI_WORKFLOW_STEPS.map(function (step) {
        const active = ui.subtab === step.key ? ' active' : '';
        const selected = ui.subtab === step.key ? 'true' : 'false';
        const tabIndex = ui.subtab === step.key ? '0' : '-1';
        return `
        <button type="button" class="hmi-workflow-step${active}" id="hmi-workflow-tab-${step.key}"
                data-subtab="${step.key}" role="tab" aria-selected="${selected}"
                aria-pressed="${selected}" aria-controls="hmi-ui-panel-${step.key}" tabindex="${tabIndex}">
          <span class="hmi-workflow-step__number">${step.number}</span>
          <span class="hmi-workflow-step__copy">
            <strong>${step.label}</strong>
            <small>${step.summary}</small>
          </span>
        </button>`;
    }).join('');
    return `<nav class="hmi-workflow-overview" role="tablist" aria-label="Geführtes HMI-Setup" data-hmi-primary-tabs="true">${steps}</nav>`;
}
function switchHmiWorkflowStep(key) {
    const valid = HMI_WORKFLOW_STEPS.some(function (step) {
        return step.key === key;
    });
    if (!valid)
        return;
    ui.subtab = key;
    renderAll();
}
function hmiDisclosureOpen(key, defaultValue) {
    if (!ui.disclosures || typeof ui.disclosures !== 'object')
        ui.disclosures = {};
    if (!Object.prototype.hasOwnProperty.call(ui.disclosures, key))
        ui.disclosures[key] = !!defaultValue;
    return ui.disclosures[key] ? ' open' : '';
}
function bindHmiDisclosure(selector, key) {
    const details = document.querySelector(selector);
    if (!details)
        return;
    details.addEventListener('toggle', function () {
        if (!ui.disclosures || typeof ui.disclosures !== 'object')
            ui.disclosures = {};
        ui.disclosures[key] = details.open;
    });
}
function decorateHmiPanel(panel, key, model) {
    if (!panel)
        return;
    const step = findHmiWorkflowStep(key);
    const index = HMI_WORKFLOW_STEPS.indexOf(step);
    const previous = index > 0 ? HMI_WORKFLOW_STEPS[index - 1] : null;
    const next = index < HMI_WORKFLOW_STEPS.length - 1 ? HMI_WORKFLOW_STEPS[index + 1] : null;
    const pipeline = key === 'bindings' ? `
      <div class="hmi-binding-pipeline" aria-label="Datenfluss eines HMI-Bindings">
        <strong>1 · Widget</strong><span aria-hidden="true">→</span>
        <strong>2 · P&amp;ID-/SVG-Objekt</strong><span aria-hidden="true">→</span>
        <strong>3 · Runtime-Quelle / Interaktion</strong>
      </div>` : '';
    panel.insertAdjacentHTML('afterbegin', `
      <section class="hmi-step-intro" aria-labelledby="hmi-step-title-${key}">
        <div>
          <h3 id="hmi-step-title-${key}">${step.title}</h3>
          <p>${step.description}</p>
        </div>
        <span class="hmi-step-intro__status">${hmiStepStatus(model, key)}</span>
      </section>
      ${pipeline}`);
    const previousButton = previous
        ? `<button type="button" class="btn btn-secondary" data-hmi-step-nav="${previous.key}">← ${previous.label}</button>`
        : '<span></span>';
    const nextButton = next
        ? `<button type="button" class="btn btn-primary" data-hmi-step-nav="${next.key}">${next.label} →</button>`
        : '<span class="hmi-step-intro__status">Setup vollständig</span>';
    panel.insertAdjacentHTML('beforeend', `
      <nav class="hmi-step-navigation" aria-label="HMI-Setup Navigation">
        ${previousButton}
        ${nextButton}
      </nav>`);
    panel.querySelectorAll('[data-hmi-step-nav]').forEach(function (button) {
        button.addEventListener('click', function () {
            switchHmiWorkflowStep(button.dataset.hmiStepNav || 'widgets');
        });
    });
}
function renderRoot(model) {
    if (!ui.container)
        return;
    const activeModel = model || ensureHmiModel();
    ui.container.innerHTML = `
    <div class="hmi-root">
      ${renderHmiWorkflowOverview(activeModel)}
      <div class="tabs hmi-workflow-panels" id="hmi-ui-tabs">
        <!-- V63.4 compatibility mirror: the former secondary tab row stays in the DOM for inherited integrations, but is intentionally hidden to avoid duplicate navigation. -->
        <div class="tab-list hmi-legacy-tab-list" role="tablist" aria-label="Legacy HMI Setup-Schritte" aria-hidden="true" hidden data-hmi-compatibility-tabs="PF-HMI-SETUP-V2">
          <button class="tab ${ui.subtab === 'widgets' ? 'active' : ''}" data-subtab="widgets" data-hmi-legacy-tab="true" role="tab" aria-selected="${ui.subtab === 'widgets' ? 'true' : 'false'}" tabindex="-1">Widgets</button>
          <button class="tab ${ui.subtab === 'bindings' ? 'active' : ''}" data-subtab="bindings" data-hmi-legacy-tab="true" role="tab" aria-selected="${ui.subtab === 'bindings' ? 'true' : 'false'}" tabindex="-1">Datenbindung</button>
          <button class="tab ${ui.subtab === 'styles' ? 'active' : ''}" data-subtab="styles" data-hmi-legacy-tab="true" role="tab" aria-selected="${ui.subtab === 'styles' ? 'true' : 'false'}" tabindex="-1">Zustände &amp; Alarme</button>
          <button class="tab ${ui.subtab === 'appearance' ? 'active' : ''}" data-subtab="appearance" data-hmi-legacy-tab="true" role="tab" aria-selected="${ui.subtab === 'appearance' ? 'true' : 'false'}" tabindex="-1">Darstellung</button>
        </div>

        <div class="tab-panels">
          <section class="tab-panel ${ui.subtab === 'widgets' ? 'active' : ''}" id="hmi-ui-panel-widgets" role="tabpanel" aria-labelledby="hmi-workflow-tab-widgets"></section>
          <section class="tab-panel ${ui.subtab === 'bindings' ? 'active' : ''}" id="hmi-ui-panel-bindings" role="tabpanel" aria-labelledby="hmi-workflow-tab-bindings"></section>
          <section class="tab-panel ${ui.subtab === 'styles' ? 'active' : ''}" id="hmi-ui-panel-styles" role="tabpanel" aria-labelledby="hmi-workflow-tab-styles"></section>
          <section class="tab-panel ${ui.subtab === 'appearance' ? 'active' : ''}" id="hmi-ui-panel-appearance" role="tabpanel" aria-labelledby="hmi-workflow-tab-appearance"></section>
        </div>
      </div>
    </div>
  `;
    const tabs = ui.container.querySelectorAll('#hmi-ui-tabs [data-subtab], .hmi-workflow-overview [data-subtab]');
    tabs.forEach(function (button) {
        button.addEventListener('click', function () {
            switchHmiWorkflowStep(button.dataset.subtab || 'widgets');
        });
    });
    const primaryTabs = ui.container.querySelectorAll('.hmi-workflow-overview [role="tab"]');
    primaryTabs.forEach(function (button) {
        button.addEventListener('keydown', function (event) {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                return;
            event.preventDefault();
            const items = Array.from(primaryTabs);
            const current = items.indexOf(button);
            let nextIndex = current;
            if (event.key === 'ArrowLeft')
                nextIndex = current <= 0 ? items.length - 1 : current - 1;
            if (event.key === 'ArrowRight')
                nextIndex = current >= items.length - 1 ? 0 : current + 1;
            if (event.key === 'Home')
                nextIndex = 0;
            if (event.key === 'End')
                nextIndex = items.length - 1;
            const target = items[nextIndex];
            if (!target)
                return;
            switchHmiWorkflowStep(target.dataset.subtab || 'widgets');
            window.setTimeout(function () {
                const active = document.getElementById('hmi-workflow-tab-' + String(target.dataset.subtab || 'widgets'));
                if (active)
                    active.focus({ preventScroll: true });
            }, 0);
        });
    });
}
function applyActiveViewBackground(model) {
    try {
        const canvas = document.getElementById('main-canvas');
        if (!canvas)
            return;
        const views = model.views || [];
        const viewId = model.active_view_id || 'main';
        const view = views.find(function (v) {
            return (v.view_id || 'main') === viewId;
        }) || views[0];
        const cfg = (view && view.config && typeof view.config === 'object') ? view.config : {};
        const bg = (cfg.background && typeof cfg.background === 'object') ? cfg.background : {};
        const mode = bg.mode || 'auto';
        const color = bg.color || '';
        if (!mode || mode === 'auto') {
            canvas.style.background = '';
            return;
        }
        if (mode === 'transparent') {
            canvas.style.background = 'transparent';
            return;
        }
        if (mode === 'dark') {
            canvas.style.background = '#020617';
            return;
        }
        if (mode === 'light') {
            canvas.style.background = '#f9fafb';
            return;
        }
        if (mode === 'color') {
            canvas.style.background = color || '#111827';
            return;
        }
        // Fallback
        canvas.style.background = '';
    }
    catch (e) {
        console.error('applyActiveViewBackground failed', e);
    }
}
function renderAll() {
    try {
        const model = ensureHmiModel();
        renderRoot(model);
        applyActiveViewBackground(model);
        if (ui.subtab === 'widgets')
            renderWidgetsPanel(model);
        if (ui.subtab === 'bindings')
            renderBindingsPanel(model);
        if (ui.subtab === 'styles')
            renderStylesPanel(model);
        if (ui.subtab === 'appearance')
            renderAppearancePanel(model);
    }
    catch (e) {
        handleError(e, 'HMI Designer Render fehlgeschlagen');
    }
    // Overlay-Preview synchron halten
    scheduleHmiOverlayRender();
}
/**
 * Neuer Appearance-Tab: View-Hintergrund + Widget-Styles
 */
function renderAppearancePanel(model) {
    const panel = byId('hmi-ui-panel-appearance');
    if (!panel)
        return;
    const viewId = model.active_view_id || 'main';
    const views = model.views || [];
    const view = views.find(function (v) {
        return (v.view_id || 'main') === viewId;
    }) || views[0] || null;
    const viewCfg = (view && view.config && typeof view.config === 'object') ? view.config : {};
    const bg = (viewCfg.background && typeof viewCfg.background === 'object') ? viewCfg.background : {};
    const bgMode = bg.mode || 'auto';
    const bgColor = bg.color || '#111827';
    const bgModeOptions = [
        { value: 'auto', label: 'Automatisch (Theme)' },
        { value: 'transparent', label: 'Transparent' },
        { value: 'dark', label: 'Dunkel' },
        { value: 'light', label: 'Hell' },
        { value: 'color', label: 'Farbe wählen' }
    ];
    const bgModeHtml = bgModeOptions.map(function (opt) {
        return `<option value="${opt.value}" ${bgMode === opt.value ? 'selected' : ''}>${opt.label}</option>`;
    }).join('');
    panel.innerHTML = `
    <div class="hmi-appearance-workflow">
      <section class="hmi-config-card hmi-appearance-view-card" aria-labelledby="hmi-appearance-view-title">
        <header class="hmi-config-card__header">
          <div>
            <span class="hmi-config-card__eyebrow">1 · View</span>
            <h4 id="hmi-appearance-view-title">Canvas-Hintergrund festlegen</h4>
            <p>Diese Einstellung gilt für Vorschau und Export der ausgewählten View.</p>
          </div>
        </header>
        <div class="hmi-config-card__body">
          <div class="grid-2 hmi-appearance-view-grid">
            <div class="form-group">
              <label>Aktive View</label>
              ${renderViewSelector(model)}
            </div>
            <div class="form-group">
              <label>Hintergrund</label>
              <div class="hmi-background-picker">
                <select id="hmi-view-bg-mode" class="select-input">${bgModeHtml}</select>
                <input id="hmi-view-bg-color" class="text-input" type="color" value="${escapeAttr(bgColor)}" aria-label="Hintergrundfarbe"/>
              </div>
              <div class="hint-text">Bei „Automatisch“ folgt der Canvas dem aktiven Theme.</div>
            </div>
          </div>
        </div>
      </section>

      <section class="hmi-config-card hmi-appearance-select-card" aria-labelledby="hmi-appearance-select-title">
        <header class="hmi-config-card__header">
          <div>
            <span class="hmi-config-card__eyebrow">2 · Widget</span>
            <h4 id="hmi-appearance-select-title">Widget für die Gestaltung auswählen</h4>
            <p>Die Auswahl verändert nur die Darstellung; Datenbindung und Objektbezug bleiben unverändert.</p>
          </div>
        </header>
        <div class="hmi-config-card__body">
          <div id="hmi-appearance-widget-list" class="hmi-appearance-widget-list"></div>
        </div>
      </section>

      <section class="hmi-config-card hmi-appearance-editor-card" aria-labelledby="hmi-appearance-editor-title">
        <header class="hmi-config-card__header">
          <div>
            <span class="hmi-config-card__eyebrow">3 · Design</span>
            <h4 id="hmi-appearance-editor-title">Widget-Darstellung bearbeiten</h4>
            <p>Grunddesign, Farben, Schrift und optionale CSS-/SVG-Klassen werden getrennt geführt.</p>
          </div>
        </header>
        <div class="hmi-config-card__body">
          <div id="hmi-appearance-widget-editor"></div>
        </div>
      </section>
    </div>
  `;
    bindViewSelector(model);
    const modeSel = byId('hmi-view-bg-mode');
    const colorInput = byId('hmi-view-bg-color');
    if (modeSel) {
        modeSel.addEventListener('change', function () {
            return saveViewBackground(model);
        });
    }
    if (colorInput) {
        colorInput.addEventListener('input', function () {
            if (modeSel && modeSel.value === 'color')
                saveViewBackground(model);
        });
        colorInput.addEventListener('change', function () {
            return saveViewBackground(model);
        });
    }
    renderAppearanceWidgetList(model, viewId);
    renderAppearanceWidgetEditor(model);
    decorateHmiPanel(panel, 'appearance', model);
}
function renderAppearanceWidgetList(model, viewId) {
    const list = byId('hmi-appearance-widget-list');
    if (!list)
        return;
    const widgets = (model.widgets || []).filter(function (w) {
        return (w.view_id || 'main') === viewId;
    });
    if (!widgets.length) {
        list.innerHTML = `<div class="hmi-empty-state">Keine Widgets in dieser View. Lege im Schritt „Widgets“ zuerst ein Anzeige- oder Bedienelement an.</div>`;
        return;
    }
    const rows = widgets.map(function (widget) {
        const active = widget.widget_id === ui.selectedWidgetId ? ' active' : '';
        const binding = primaryWidgetBinding(model, widget.widget_id, viewId);
        const objectLabel = binding && binding.element_id ? svgElementLabel(binding.element_id) : 'Kein Objekt gebunden';
        return `
        <button type="button" class="hmi-appearance-widget-option${active}" data-app-widget-id="${escapeAttr(widget.widget_id)}"
                aria-pressed="${widget.widget_id === ui.selectedWidgetId ? 'true' : 'false'}">
          <span class="hmi-appearance-widget-option__main">
            <strong>${escapeHtml(widget.name || widget.widget_id)}</strong>
            <small>${escapeHtml(objectLabel)}</small>
          </span>
          <span class="hmi-appearance-widget-option__type">${escapeHtml(widget.type || 'text')}</span>
        </button>`;
    }).join('');
    list.innerHTML = `<div class="hmi-appearance-widget-grid">${rows}</div>`;
    list.querySelectorAll('[data-app-widget-id]').forEach(function (button) {
        button.addEventListener('click', function () {
            ui.selectedWidgetId = button.dataset.appWidgetId;
            renderAll();
        });
    });
}
function renderAppearanceWidgetEditor(model) {
    const editor = byId('hmi-appearance-widget-editor');
    if (!editor)
        return;
    const wid = ui.selectedWidgetId;
    const viewId = model.active_view_id || 'main';
    const widget = (model.widgets || []).find(function (w) {
        return w.widget_id === wid && (w.view_id || 'main') === viewId;
    });
    if (!widget) {
        editor.innerHTML = `<div class="hint-text">Wähle oben ein Widget aus.</div>`;
        return;
    }
    const cfg = widget.config || {};
    const variant = cfg.variant || 'default';
    const size = cfg.size || 'md';
    const shape = cfg.shape || 'pill';
    const classes = Array.isArray(cfg.classes) ? cfg.classes.join(' ') : (cfg.classes || '');
    const bgc = cfg.bg_color || '';
    const tcc = cfg.text_color || '';
    const boc = cfg.border_color || '';
    const bw = (cfg.border_width != null) ? cfg.border_width : 1;
    const fs = (cfg.font_size != null) ? cfg.font_size : '';
    const svgClasses = Array.isArray(cfg.svg_target_classes) ? cfg.svg_target_classes.join(' ') : (cfg.svg_target_classes || '');
    const binding = primaryWidgetBinding(model, widget.widget_id, viewId);
    const objectLabel = binding && binding.element_id ? svgElementLabel(binding.element_id) : 'Kein Objekt gebunden';
    const sourceLabel = binding ? hmiSourceSummary(binding.source, binding.interaction) : 'Keine Datenbindung';
    editor.innerHTML = [
        '<div class="hmi-appearance-selection-summary">',
        '  <div><span>Widget</span><strong>' + escapeHtml(widget.name || widget.widget_id) + '</strong></div>',
        '  <div><span>P&amp;ID-/SVG-Objekt</span><strong>' + escapeHtml(objectLabel) + '</strong></div>',
        '  <div><span>Datenstatus</span><strong>' + escapeHtml(sourceLabel) + '</strong></div>',
        '</div>',
        '<section class="hmi-appearance-section" aria-labelledby="hmi-appearance-basic-title">',
        '  <header><h5 id="hmi-appearance-basic-title">Grunddesign</h5><p>Variante, Größe, Form und Rahmen.</p></header>',
        '  <div class="grid-2">',
        '    <div class="form-group">',
        '      <label>Variante</label>',
        '      <select id="hmi-app-variant" class="select-input">',
        '        <option value="default"' + (variant === 'default' ? ' selected' : '') + '>Standard</option>',
        '        <option value="primary"' + (variant === 'primary' ? ' selected' : '') + '>Hervorgehoben</option>',
        '        <option value="outline"' + (variant === 'outline' ? ' selected' : '') + '>Kontur</option>',
        '        <option value="ghost"' + (variant === 'ghost' ? ' selected' : '') + '>Dezent</option>',
        '      </select>',
        '    </div>',
        '    <div class="form-group">',
        '      <label>Größe</label>',
        '      <select id="hmi-app-size" class="select-input">',
        '        <option value="sm"' + (size === 'sm' ? ' selected' : '') + '>Klein</option>',
        '        <option value="md"' + (size === 'md' ? ' selected' : '') + '>Mittel</option>',
        '        <option value="lg"' + (size === 'lg' ? ' selected' : '') + '>Groß</option>',
        '      </select>',
        '    </div>',
        '  </div>',
        '  <div class="grid-2">',
        '    <div class="form-group">',
        '      <label>Form</label>',
        '      <select id="hmi-app-shape" class="select-input">',
        '        <option value="pill"' + (shape === 'pill' ? ' selected' : '') + '>Pill</option>',
        '        <option value="rounded"' + (shape === 'rounded' ? ' selected' : '') + '>Abgerundet</option>',
        '        <option value="square"' + (shape === 'square' ? ' selected' : '') + '>Eckig</option>',
        '      </select>',
        '    </div>',
        '    <div class="form-group">',
        '      <label>Rahmenbreite (px)</label>',
        '      <input id="hmi-app-bw" class="text-input" type="number" min="0" max="8" step="1" value="' + escapeAttr(bw) + '"/>',
        '    </div>',
        '  </div>',
        '</section>',
        '<section class="hmi-appearance-section" aria-labelledby="hmi-appearance-color-title">',
        '  <header><h5 id="hmi-appearance-color-title">Farben und Schrift</h5><p>Leere Farbfelder verwenden automatisch die gewählte Variante.</p></header>',
        '  <div class="grid-2">',
        '    <div class="form-group"><label>Hintergrundfarbe (optional)</label><input id="hmi-app-bg" class="text-input" placeholder="#0f172a oder rgba(...)" value="' + escapeAttr(bgc) + '"/></div>',
        '    <div class="form-group"><label>Textfarbe (optional)</label><input id="hmi-app-tc" class="text-input" placeholder="#e5e7eb" value="' + escapeAttr(tcc) + '"/></div>',
        '  </div>',
        '  <div class="grid-2">',
        '    <div class="form-group"><label>Rahmenfarbe (optional)</label><input id="hmi-app-bc" class="text-input" placeholder="#3b82f6" value="' + escapeAttr(boc) + '"/></div>',
        '    <div class="form-group"><label>Schriftgröße (px, optional)</label><input id="hmi-app-fs" class="text-input" type="number" min="8" max="24" step="1" value="' + escapeAttr(fs) + '"/></div>',
        '  </div>',
        '</section>',
        '<details id="hmi-appearance-advanced" class="hmi-disclosure hmi-disclosure--nested"' + hmiDisclosureOpen('appearanceAdvanced', false) + '>',
        '  <summary><span><strong>Erweiterte CSS-/SVG-Klassen</strong><small>Nur für benutzerdefinierte Animationen und projektspezifische Styles.</small></span></summary>',
        '  <div class="hmi-disclosure__body">',
        '    <div class="form-group"><label>CSS-Klassen auf dem Widget/Overlay</label><input id="hmi-app-classes" class="text-input" value="' + escapeAttr(classes) + '" placeholder="z.B. hmi-anim-blink my-custom-class"/><div class="hint-text">Mehrere Klassen mit Leerzeichen trennen.</div></div>',
        '    <div class="form-group"><label>CSS-Klassen auf dem P&amp;ID-/SVG-Ziel</label><input id="hmi-app-svg-classes" class="text-input" value="' + escapeAttr(svgClasses) + '" placeholder="z.B. pulsieren hover-farbe"/><div class="hint-text">Wird auf das gebundene SVG-Element angewendet.</div></div>',
        '  </div>',
        '</details>',
        '<section class="hmi-appearance-preview-card" aria-labelledby="hmi-appearance-preview-title">',
        '  <div><h5 id="hmi-appearance-preview-title">Vorschau</h5><p>Die Vorschau aktualisiert sich sofort; gespeichert wird erst mit „Darstellung übernehmen“.</p></div>',
        '  <div id="hmi-app-preview"><div id="hmi-app-preview-node"></div></div>',
        '</section>',
        '<div class="hmi-appearance-actions"><button id="hmi-app-apply" class="btn btn-primary">Darstellung übernehmen</button></div>'
    ].join('');
    function buildPreviewCfg() {
        return {
            variant: byId('hmi-app-variant') ? byId('hmi-app-variant').value : 'default',
            size: byId('hmi-app-size') ? byId('hmi-app-size').value : 'md',
            shape: byId('hmi-app-shape') ? byId('hmi-app-shape').value : 'pill',
            bg_color: byId('hmi-app-bg') ? (byId('hmi-app-bg').value || '') : '',
            text_color: byId('hmi-app-tc') ? (byId('hmi-app-tc').value || '') : '',
            border_color: byId('hmi-app-bc') ? (byId('hmi-app-bc').value || '') : '',
            border_width: toNumberOrNull(byId('hmi-app-bw') ? byId('hmi-app-bw').value : 1) ?? 1,
            font_size: toNumberOrNull(byId('hmi-app-fs') ? byId('hmi-app-fs').value : '') ?? null,
            classes: (byId('hmi-app-classes') ? (byId('hmi-app-classes').value || '') : '').split(/\s+/).filter(Boolean)
        };
    }
    function renderPreview() {
        const box = byId('hmi-app-preview-node');
        if (!box)
            return;
        box.innerHTML = '';
        const type = widget.type || 'text';
        const cfgDraft = buildPreviewCfg();
        let node;
        if (type === 'button' || type === 'toggle')
            node = document.createElement('button');
        else
            node = document.createElement('div');
        node.textContent = widgetPreviewLabel({ type: type, name: widget.name, config: Object.assign({}, widget.config || {}, cfgDraft) }, null);
        // reuse editor overlay styling by calling createOverlayNode on a fake binding? -> zu riskant
        // -> hier direkt Styling wie im Overlay:
        node.className = 'hmi-ov hmi-ov-' + type;
        node.style.position = 'relative';
        node.style.transform = '';
        node.style.pointerEvents = 'none';
        // quick apply (gleiches Regelwerk wie createOverlayNode)
        let bg = 'rgba(15, 23, 42, 0.92)';
        let fg = '#f8fafc';
        let border = 'rgba(59, 130, 246, 0.65)';
        if (cfgDraft.variant === 'primary') {
            bg = 'var(--v9-accent, #2563eb)';
            fg = '#ffffff';
            border = 'color-mix(in srgb, var(--v9-accent, #2563eb) 72%, white)';
        }
        else if (cfgDraft.variant === 'outline') {
            bg = 'var(--v9-surface-0, #ffffff)';
            fg = 'var(--v9-ink, #0f172a)';
            border = 'var(--v9-accent, #2563eb)';
        }
        else if (cfgDraft.variant === 'ghost') {
            bg = 'color-mix(in srgb, var(--v9-surface-0, #ffffff) 88%, transparent)';
            fg = 'var(--v9-ink, #0f172a)';
            border = 'transparent';
        }
        if (cfgDraft.bg_color)
            bg = cfgDraft.bg_color;
        if (cfgDraft.text_color)
            fg = cfgDraft.text_color;
        if (cfgDraft.border_color)
            border = cfgDraft.border_color;
        let pad = (type === 'button' || type === 'toggle') ? '6px 10px' : '4px 8px';
        let fontPx = 12;
        if (cfgDraft.size === 'sm') {
            pad = (type === 'button' || type === 'toggle') ? '4px 8px' : '3px 6px';
            fontPx = 11;
        }
        if (cfgDraft.size === 'lg') {
            pad = (type === 'button' || type === 'toggle') ? '8px 12px' : '6px 10px';
            fontPx = 14;
        }
        if (cfgDraft.font_size != null)
            fontPx = cfgDraft.font_size;
        let radius = '999px';
        if (cfgDraft.shape === 'rounded')
            radius = '10px';
        if (cfgDraft.shape === 'square')
            radius = '0px';
        node.style.padding = pad;
        node.style.fontSize = String(fontPx) + 'px';
        node.style.lineHeight = '1.2';
        node.style.borderRadius = radius;
        node.style.background = bg;
        node.style.color = fg;
        node.style.border = String(cfgDraft.border_width) + 'px solid ' + border;
        cfgDraft.classes.forEach(function (c) { try {
            node.classList.add(c);
        }
        catch (_) { } });
        box.appendChild(node);
    }
    bindHmiDisclosure('#hmi-appearance-advanced', 'appearanceAdvanced');
    ['hmi-app-variant', 'hmi-app-size', 'hmi-app-shape', 'hmi-app-bg', 'hmi-app-tc', 'hmi-app-bc', 'hmi-app-bw', 'hmi-app-fs', 'hmi-app-classes'].forEach(function (id) {
        const el = byId(id);
        if (!el)
            return;
        el.addEventListener('input', renderPreview);
        el.addEventListener('change', renderPreview);
    });
    renderPreview();
    const applyBtn = byId('hmi-app-apply');
    if (applyBtn) {
        applyBtn.addEventListener('click', function () {
            saveAppearanceEdits(model, widget.widget_id);
        });
    }
}
function saveAppearanceEdits(model, widgetId) {
    const next = deepClone(model);
    const w = (next.widgets || []).find(function (x) {
        return x.widget_id === widgetId;
    });
    if (!w)
        return;
    const variant = byId('hmi-app-variant') ? (byId('hmi-app-variant').value || 'default') : 'default';
    const size = byId('hmi-app-size') ? (byId('hmi-app-size').value || 'md') : 'md';
    const shape = byId('hmi-app-shape') ? (byId('hmi-app-shape').value || 'pill') : 'pill';
    const classesStr = byId('hmi-app-classes') ? (byId('hmi-app-classes').value || '') : '';
    const bgc = byId('hmi-app-bg') ? (byId('hmi-app-bg').value || '') : '';
    const tcc = byId('hmi-app-tc') ? (byId('hmi-app-tc').value || '') : '';
    const boc = byId('hmi-app-bc') ? (byId('hmi-app-bc').value || '') : '';
    const bw = toNumberOrNull(byId('hmi-app-bw') ? byId('hmi-app-bw').value : 1) ?? 1;
    const fs = toNumberOrNull(byId('hmi-app-fs') ? byId('hmi-app-fs').value : '');
    const svgClassesStr = byId('hmi-app-svg-classes') ? (byId('hmi-app-svg-classes').value || '') : '';
    w.config = w.config || {};
    w.config.variant = variant;
    w.config.size = size;
    w.config.shape = shape;
    w.config.classes = classesStr.split(/\s+/).filter(Boolean);
    // optional Farben (leere Strings bedeuten: Variant Defaults)
    w.config.bg_color = String(bgc || '').trim();
    w.config.text_color = String(tcc || '').trim();
    w.config.border_color = String(boc || '').trim();
    w.config.border_width = bw;
    if (fs == null)
        delete w.config.font_size;
    else
        w.config.font_size = fs;
    // SVG target classes (für Markierungen/Animation)
    w.config.svg_target_classes = svgClassesStr.split(/\s+/).filter(Boolean);
    commitHmiModel(next, 'appearance.widget');
    ui.selectedWidgetId = widgetId;
    renderAll();
}
function saveViewBackground(model) {
    const next = deepClone(model);
    const viewSel = byId('hmi-active-view');
    const viewId = (viewSel && viewSel.value) || next.active_view_id || 'main';
    const views = next.views || [];
    const view = views.find(function (v) {
        return (v.view_id || 'main') === viewId;
    });
    if (!view)
        return;
    const modeSel = byId('hmi-view-bg-mode');
    const colorInput = byId('hmi-view-bg-color');
    const mode = modeSel ? (modeSel.value || 'auto') : 'auto';
    const color = colorInput ? (colorInput.value || '') : '';
    const cfg = (view.config && typeof view.config === 'object') ? view.config : {};
    const bg = (cfg.background && typeof cfg.background === 'object') ? cfg.background : {};
    bg.mode = mode;
    bg.color = color;
    cfg.background = bg;
    view.config = cfg;
    next.active_view_id = viewId;
    commitHmiModel(next, 'appearance.view_background');
}
// ------------------------- Widgets Panel -------------------------
const WIDGET_TEMPLATES = [
    { template_id: 'tpl_text', name: 'Text', type: 'text', config: { mode: 'replace_text', prefix: '', suffix: '', fallback: '--' } },
    { template_id: 'tpl_indicator', name: 'Indicator', type: 'indicator', config: { mode: 'class', default_state: 'ok', states: [
                { name: 'ok', class: 'ok-green' },
                { name: 'warn', class: 'warn-yellow' },
                { name: 'alarm', class: 'alarm-red' }
            ] } },
    { template_id: 'tpl_button', name: 'Button (optional)', type: 'button', config: { label: 'Button', confirm: { enabled: false, text: '' }, debounce_ms: 200 } },
    { template_id: 'tpl_toggle', name: 'Toggle (optional)', type: 'toggle', config: { label_on: 'ON', label_off: 'OFF', sync_mode: 'follow_source' } },
    { template_id: 'tpl_slider', name: 'Slider', type: 'slider', config: { min: 0, max: 100, step: 1, label: 'Setpoint', unit: '' } }
];
function renderWidgetsPanel(model) {
    const panel = byId('hmi-ui-panel-widgets');
    if (!panel)
        return;
    const viewId = model.active_view_id || 'main';
    const widgets = model.widgets.filter(function (widget) {
        return (widget.view_id || 'main') === viewId;
    });
    const svgElements = getSvgElementsList();
    const selectedElement = selectedCanvasElementId();
    const selectedElementExists = svgElements.some(function (entry) {
        return entry.element_id === selectedElement;
    });
    const templateOptions = WIDGET_TEMPLATES.map(function (template) {
        return `<option value="${template.template_id}">${template.name}</option>`;
    }).join('');
    const elementOptions = svgElements.map(function (entry) {
        const selected = selectedElementExists && entry.element_id === selectedElement ? 'selected' : '';
        return `<option value="${escapeAttr(entry.element_id)}" ${selected}>${escapeHtml(entry.label)}</option>`;
    }).join('');
    panel.innerHTML = `
    <section class="hmi-widget-register" aria-labelledby="hmi-widget-register-title">
      <div class="hmi-widget-register__header">
        <div>
          <h4 id="hmi-widget-register-title">Widgets (${widgets.length})</h4>
          <p>Widget, Objektbezug und Datenstatus der aktiven View auf einen Blick.</p>
        </div>
      </div>
      <div id="hmi-widget-list" class="hmi-widget-table-wrap"></div>
    </section>

    <div class="hmi-widget-config-grid">
      <section class="hmi-widget-create-card" aria-labelledby="hmi-widget-create-title">
        <h4 id="hmi-widget-create-title">Neues Widget anlegen</h4>
        <div class="form-group">
          <label>Aktive View</label>
          ${renderViewSelector(model)}
        </div>
        <div class="form-group">
          <label for="hmi-quick-element">P&amp;ID-/SVG-Objekt</label>
          <div class="hmi-widget-object-picker">
            <select id="hmi-quick-element" class="select-input">
              <option value="">Ohne Objektverknüpfung anlegen</option>
              ${elementOptions}
            </select>
            <button id="hmi-quick-use-selection" type="button" class="btn btn-secondary">Canvas-Auswahl</button>
          </div>
          <div class="hint-text">Optional: Die Objektverknüpfung und eine passende I/O-Quelle werden direkt als Binding angelegt.</div>
        </div>
        <div class="form-group">
          <label for="hmi-quick-template">Widget-Typ</label>
          <select id="hmi-quick-template" class="select-input">${templateOptions}</select>
        </div>
        <button id="hmi-quick-add" class="btn btn-primary hmi-widget-create-card__action">Widget anlegen</button>
        <div class="hint-text">Buttons, Toggle und Slider bleiben bewusst optional und werden nur über diesen expliziten Schritt erzeugt.</div>
      </section>

      <section class="hmi-widget-editor-card" aria-labelledby="hmi-widget-editor-title">
        <h4 id="hmi-widget-editor-title">Widget bearbeiten</h4>
        <div id="hmi-widget-editor" class="sidebar-section"></div>
      </section>
    </div>
  `;
    bindViewSelector(model);
    const list = byId('hmi-widget-list');
    if (list) {
        if (widgets.length === 0) {
            list.innerHTML = `<div class="hmi-widget-table-empty">Noch keine Widgets vorhanden. Wähle unten optional ein Objekt und lege das erste Widget an.</div>`;
        }
        else {
            const rows = widgets.map(function (widget) {
                const binding = primaryWidgetBinding(model, widget.widget_id, viewId);
                const active = ui.selectedWidgetId === widget.widget_id ? ' hmi-widget-table__row--active' : '';
                const objectLabel = binding && binding.element_id
                    ? svgElementLabel(binding.element_id)
                    : 'Nicht verknüpft';
                const sourceLabel = binding
                    ? hmiSourceSummary(binding.source, binding.interaction)
                    : 'Noch kein Binding';
                return `
                <tr class="hmi-widget-table__row${active}">
                  <td data-label="Widget"><button type="button" class="hmi-widget-table__select" data-widget-id="${escapeAttr(widget.widget_id)}" title="${escapeAttr(widget.name || widget.widget_id)}" aria-label="Widget ${escapeAttr(widget.name || widget.widget_id)} bearbeiten"><span>${escapeHtml(widget.name || widget.widget_id)}</span></button></td>
                  <td data-label="Typ">${escapeHtml(widget.type || '')}</td>
                  <td data-label="P&ID-/SVG-Objekt">${escapeHtml(objectLabel)}</td>
                  <td data-label="Datenquelle / Interaktion">${escapeHtml(sourceLabel)}</td>
                  <td data-label="ID"><code>${escapeHtml(widget.widget_id)}</code></td>
                </tr>`;
            }).join('');
            list.innerHTML = `
              <table class="hmi-widget-table">
                <thead>
                  <tr><th>Widget</th><th>Typ</th><th>P&amp;ID-/SVG-Objekt</th><th>Datenquelle / Interaktion</th><th>ID</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>`;
            list.querySelectorAll('[data-widget-id]').forEach(function (button) {
                button.addEventListener('click', function () {
                    ui.selectedWidgetId = button.dataset.widgetId;
                    renderAll();
                });
            });
        }
    }
    const selectionButton = byId('hmi-quick-use-selection');
    if (selectionButton) {
        selectionButton.addEventListener('click', function () {
            const elementId = selectedCanvasElementId();
            const select = byId('hmi-quick-element');
            if (!elementId || !select) {
                showStatus('Bitte genau ein Canvas-Objekt auswählen', 'error');
                return;
            }
            const optionExists = Array.from(select.options).some(function (option) {
                return option.value === elementId;
            });
            if (!optionExists) {
                showStatus('Die aktuelle Auswahl ist kein verfügbares P&ID-/SVG-Objekt', 'error');
                return;
            }
            select.value = elementId;
            showStatus('Canvas-Auswahl für die Widget-Verknüpfung übernommen', 'success');
        });
    }
    const quickBtn = byId('hmi-quick-add');
    if (quickBtn) {
        quickBtn.addEventListener('click', function () {
            const templateId = byId('hmi-quick-template')?.value || 'tpl_text';
            const elementId = byId('hmi-quick-element')?.value || '';
            addWidgetFromTemplate(model, templateId, elementId);
        });
    }
    renderWidgetEditor(model);
    decorateHmiPanel(panel, 'widgets', model);
}
function renderViewSelector(model) {
    const views = model.views || [];
    const opts = views.map(function (v) {
        return `<option value="${v.view_id}" ${v.view_id === model.active_view_id ? 'selected' : ''}>${escapeHtml(v.name || v.view_id)}</option>`;
    }).join('');
    return `<select id="hmi-active-view" class="select-input">${opts}</select>`;
}
function bindViewSelector(model) {
    const sel = byId('hmi-active-view');
    if (!sel)
        return;
    sel.addEventListener('change', function () {
        const next = deepClone(model);
        next.active_view_id = sel.value || 'main';
        ui.selectedWidgetId = null;
        ui.selectedBindingId = null;
        ui.selectedStyleId = null;
        ui.selectedAlarmId = null;
        commitHmiModel(next, 'change_view');
        renderAll();
    });
}
function addWidgetFromTemplate(model, templateId, elementId) {
    const template = WIDGET_TEMPLATES.find(function (item) {
        return item.template_id === templateId;
    }) || WIDGET_TEMPLATES[0];
    const next = deepClone(model);
    const targetElementId = String(elementId || '');
    const targetLabel = targetElementId ? svgElementLabel(targetElementId) : '';
    const widget = {
        widget_id: nowId('w'),
        type: template.type,
        name: targetLabel ? targetLabel + ' · ' + template.name : template.name,
        view_id: next.active_view_id || 'main',
        origin: 'explicit',
        auto_created: false,
        config: deepClone(template.config)
    };
    next.widgets.push(widget);
    ui.selectedWidgetId = widget.widget_id;
    if (targetElementId) {
        const binding = defaultBindingForWidget(widget, targetElementId);
        next.bindings.push(binding);
        ui.selectedBindingId = binding.binding_id;
        commitHmiModel(next, 'add_widget_with_object_relation');
        if (binding.source) {
            showStatus('Widget, Objektverknüpfung und I/O-Quelle angelegt', 'success');
        }
        else {
            showStatus('Widget und Objektverknüpfung angelegt · Datenquelle noch offen', 'success');
        }
        renderAll();
        return;
    }
    commitHmiModel(next, 'add_widget');
    showStatus('Optionales Widget angelegt · Objektverknüpfung noch offen', 'success');
    renderAll();
}
function renderWidgetEditor(model) {
    const editor = byId('hmi-widget-editor');
    if (!editor)
        return;
    const widgetId = ui.selectedWidgetId;
    const widget = (model.widgets || []).find(function (item) {
        return item.widget_id === widgetId;
    });
    if (!widget) {
        editor.innerHTML = `<div class="hint-text">Wähle oben in der Widget-Tabelle einen Eintrag aus.</div>`;
        return;
    }
    const cfg = widget.config || {};
    const binding = primaryWidgetBinding(model, widget.widget_id, model.active_view_id || 'main');
    const relationObject = binding && binding.element_id
        ? svgElementLabel(binding.element_id)
        : 'Noch kein Objekt verknüpft';
    const relationSource = binding
        ? hmiSourceSummary(binding.source, binding.interaction)
        : 'Noch kein Binding vorhanden';
    const bindingActionLabel = binding ? 'Datenbindung bearbeiten' : 'Datenbindung anlegen';
    editor.innerHTML = `
    <div class="grid-1">
      <section class="hmi-widget-relation-card" aria-label="Widget-Objekt-Verknüpfung">
        <div><span>Objekt</span><strong>${escapeHtml(relationObject)}</strong></div>
        <div><span>Datenfluss</span><strong>${escapeHtml(relationSource)}</strong></div>
        <button id="hmi-w-open-binding" type="button" class="btn btn-secondary">${bindingActionLabel}</button>
      </section>

      <div class="form-group">
        <label>Name</label>
        <input id="hmi-w-name" class="text-input" value="${escapeAttr(widget.name || '')}"/>
      </div>
      <div class="form-group">
        <label>Typ</label>
        <input class="text-input" value="${escapeAttr(widget.type)}" disabled/>
      </div>

      ${renderWidgetTypeSpecificEditor(widget.type, cfg)}

      <div class="form-row hmi-widget-editor-actions">
        <button id="hmi-w-save" class="btn btn-primary">Speichern</button>
        <button id="hmi-w-delete" class="btn btn-danger">Löschen</button>
      </div>
    </div>
  `;
    const openBindingButton = byId('hmi-w-open-binding');
    if (openBindingButton) {
        openBindingButton.addEventListener('click', function () {
            if (binding) {
                ui.selectedBindingId = binding.binding_id;
                switchHmiWorkflowStep('bindings');
                return;
            }
            const next = deepClone(model);
            const selectedElement = selectedCanvasElementId();
            const newBinding = defaultBindingForWidget(widget, selectedElement);
            next.bindings.push(newBinding);
            ui.selectedBindingId = newBinding.binding_id;
            commitHmiModel(next, 'add_binding_from_widget_editor');
            switchHmiWorkflowStep('bindings');
        });
    }
    byId('hmi-w-save').addEventListener('click', function () {
        return saveWidgetEdits(model, widget.widget_id);
    });
    byId('hmi-w-delete').addEventListener('click', function () {
        return deleteWidget(model, widget.widget_id);
    });
}
function renderWidgetTypeSpecificEditor(type, cfg) {
    if (type === 'text') {
        return `
      <div class="grid-2">
        <div class="form-group"><label>Prefix</label><input id="hmi-w-prefix" class="text-input" value="${escapeAttr(cfg.prefix || '')}"/></div>
        <div class="form-group"><label>Suffix</label><input id="hmi-w-suffix" class="text-input" value="${escapeAttr(cfg.suffix || '')}"/></div>
      </div>
      <div class="form-group">
        <label>Fallback</label>
        <input id="hmi-w-fallback" class="text-input" value="${escapeAttr(cfg.fallback || '--')}"/>
      </div>
    `;
    }
    if (type === 'button') {
        const confirmEnabled = cfg.confirm && cfg.confirm.enabled ? 'checked' : '';
        const confirmText = (cfg.confirm && cfg.confirm.text) ? cfg.confirm.text : '';
        return `
      <div class="grid-2">
        <div class="form-group"><label>Label</label><input id="hmi-w-label" class="text-input" value="${escapeAttr(cfg.label || 'Button')}"/></div>
        <div class="form-group"><label>Debounce (ms)</label><input id="hmi-w-debounce" class="text-input" type="number" value="${escapeAttr(cfg.debounce_ms ?? 200)}"/></div>
      </div>
      <div class="form-group">
        <label><input id="hmi-w-confirm" type="checkbox" ${confirmEnabled}/> Bestätigung</label>
      </div>
      <div class="form-group">
        <label>Bestätigungstext</label>
        <input id="hmi-w-confirm-text" class="text-input" value="${escapeAttr(confirmText)}"/>
      </div>
    `;
    }
    if (type === 'toggle') {
        return `
      <div class="grid-2">
        <div class="form-group"><label>Label ON</label><input id="hmi-w-on" class="text-input" value="${escapeAttr(cfg.label_on || 'ON')}"/></div>
        <div class="form-group"><label>Label OFF</label><input id="hmi-w-off" class="text-input" value="${escapeAttr(cfg.label_off || 'OFF')}"/></div>
      </div>
      <div class="form-group">
        <label>Sync Mode</label>
        <select id="hmi-w-sync" class="select-input">
          <option value="follow_source" ${cfg.sync_mode === 'follow_source' ? 'selected' : ''}>follow_source</option>
          <option value="optimistic" ${cfg.sync_mode === 'optimistic' ? 'selected' : ''}>optimistic</option>
        </select>
      </div>
    `;
    }
    if (type === 'slider') {
        return `
      <div class="grid-2">
        <div class="form-group"><label>Min</label><input id="hmi-w-min" class="text-input" type="number" value="${escapeAttr(cfg.min ?? 0)}"/></div>
        <div class="form-group"><label>Max</label><input id="hmi-w-max" class="text-input" type="number" value="${escapeAttr(cfg.max ?? 100)}"/></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label>Step</label><input id="hmi-w-step" class="text-input" type="number" value="${escapeAttr(cfg.step ?? 1)}"/></div>
        <div class="form-group"><label>Unit</label><input id="hmi-w-unit" class="text-input" value="${escapeAttr(cfg.unit || '')}"/></div>
      </div>
      <div class="form-group"><label>Label</label><input id="hmi-w-label" class="text-input" value="${escapeAttr(cfg.label || 'Setpoint')}"/></div>
    `;
    }
    if (type === 'indicator') {
        return `
      <div class="hint-text">Indicator wird primär über Styles/Alarms eingefärbt (CSS Klassen).</div>
      <div class="form-group"><label>Default State</label>
        <input id="hmi-w-ind-default" class="text-input" value="${escapeAttr(cfg.default_state || 'ok')}"/>
      </div>
    `;
    }
    return `<div class="hint-text">Kein Editor für Typ: ${escapeHtml(type)}</div>`;
}
function saveWidgetEdits(model, widgetId) {
    const next = deepClone(model);
    const w = next.widgets.find(function (x) {
        return x.widget_id === widgetId;
    });
    if (!w)
        return;
    w.name = byId('hmi-w-name')?.value || w.name;
    // Typ-spezifisch
    if (w.type === 'text') {
        w.config = w.config || {};
        w.config.prefix = byId('hmi-w-prefix')?.value || '';
        w.config.suffix = byId('hmi-w-suffix')?.value || '';
        w.config.fallback = byId('hmi-w-fallback')?.value || '--';
    }
    if (w.type === 'button') {
        w.config = w.config || {};
        w.config.label = byId('hmi-w-label')?.value || 'Button';
        w.config.debounce_ms = toIntOrNull(byId('hmi-w-debounce')?.value) ?? 200;
        const en = byId('hmi-w-confirm')?.checked ? true : false;
        const txt = byId('hmi-w-confirm-text')?.value || '';
        w.config.confirm = { enabled: en, text: txt };
    }
    if (w.type === 'toggle') {
        w.config = w.config || {};
        w.config.label_on = byId('hmi-w-on')?.value || 'ON';
        w.config.label_off = byId('hmi-w-off')?.value || 'OFF';
        w.config.sync_mode = byId('hmi-w-sync')?.value || 'follow_source';
    }
    if (w.type === 'slider') {
        w.config = w.config || {};
        w.config.min = toNumberOrNull(byId('hmi-w-min')?.value) ?? 0;
        w.config.max = toNumberOrNull(byId('hmi-w-max')?.value) ?? 100;
        w.config.step = toNumberOrNull(byId('hmi-w-step')?.value) ?? 1;
        w.config.unit = byId('hmi-w-unit')?.value || '';
        w.config.label = byId('hmi-w-label')?.value || 'Setpoint';
    }
    if (w.type === 'indicator') {
        w.config = w.config || {};
        w.config.default_state = byId('hmi-w-ind-default')?.value || 'ok';
    }
    commitHmiModel(next, 'edit_widget');
    showStatus('Widget gespeichert', 'success');
    renderAll();
}
function deleteWidget(model, widgetId) {
    const dependentBindings = (model.bindings || []).filter(function (binding) {
        return binding.widget_id === widgetId;
    }).length;
    showConfirmation('Dieses Widget dauerhaft löschen?', {
        title: 'HMI-Widget löschen',
        confirmLabel: 'Widget löschen',
        destructive: true,
        detail: dependentBindings
            ? String(dependentBindings) + ' zugehörige Datenbindung(en) werden ebenfalls entfernt.'
            : 'Für dieses Widget existieren keine abhängigen Datenbindungen.'
    }, function () {
        const next = deepClone(model);
        next.widgets = next.widgets.filter(function (widget) {
            return widget.widget_id !== widgetId;
        });
        next.bindings = next.bindings.filter(function (binding) {
            return binding.widget_id !== widgetId;
        });
        ui.selectedWidgetId = null;
        commitHmiModel(next, 'delete_widget');
        showStatus('Widget gelöscht', 'success');
        renderAll();
    });
}
// ------------------------- Bindings Panel -------------------------
function renderBindingsPanel(model) {
    const panel = byId('hmi-ui-panel-bindings');
    if (!panel)
        return;
    const viewId = model.active_view_id || 'main';
    const bindings = model.bindings.filter(function (b) {
        return (b.view_id || 'main') === viewId;
    });
    const widgets = model.widgets.filter(function (w) {
        return (w.view_id || 'main') === viewId;
    });
    const report = computeHmiSanityReport(model, viewId);
    const banner = renderHmiSanityBanner(report);
    panel.innerHTML = `
    <div class="grid-2">
      <div>
        <div class="form-group">
          <label>Aktive View</label>
          ${renderViewSelector(model)}
        </div>

        <div class="form-group">
          <button id="hmi-b-add" class="btn btn-primary">+ Binding</button>
          <div class="hint-text">Binding koppelt Widget ↔ SVG ↔ Quelle (+ Interaktion).</div>
        </div>

        ${banner}

        <hr class="sep"/>

        <div class="form-group">
          <label>Bindings (${bindings.length})</label>
          <div id="hmi-binding-list" class="table"></div>
        </div>
      </div>

      <div>
        <div class="form-group">
          <label>Binding Editor</label>
          <div id="hmi-binding-editor"></div>
        </div>
      </div>
    </div>
  `;
    bindViewSelector(model);
    const list = byId('hmi-binding-list');
    if (list) {
        if (bindings.length === 0) {
            list.innerHTML = `<div class="hint-text">Noch keine Bindings. Klicke “+ Binding”.</div>`;
        }
        else {
            const rows = bindings.map(function (b) {
                const active = (ui.selectedBindingId === b.binding_id) ? 'active' : '';
                const meta = report.by_binding && report.by_binding[b.binding_id] ? report.by_binding[b.binding_id] : null;
                let badge = '';
                if (meta && ((meta.errors && meta.errors.length) || (meta.warnings && meta.warnings.length))) {
                    const txt = []
                        .concat((meta.errors || []).map(function (x) {
                        return 'ERROR: ' + x;
                    }))
                        .concat((meta.warnings || []).map(function (x) {
                        return 'WARN: ' + x;
                    }))
                        .join(' | ');
                    badge = `<span title="${escapeAttr(txt)}" style="margin-left:6px; color:#f59e0b;">⚠</span>`;
                }
                return `
          <div class="tr ${active}" style="grid-template-columns: 1.2fr 1fr;">
            <div>
              <button class="btn btn-small btn-secondary" data-binding-id="${b.binding_id}">
                ${escapeHtml(b.binding_id)}
              </button>${badge}
            </div>
            <div>${escapeHtml(b.widget_id || '')}</div>
          </div>
        `;
            }).join('');
            list.innerHTML = `<div class="tr th" style="grid-template-columns: 1.2fr 1fr;"><div>ID</div><div>Widget</div></div>${rows}`;
            list.querySelectorAll('[data-binding-id]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    ui.selectedBindingId = btn.dataset.bindingId;
                    renderAll();
                });
            });
        }
    }
    byId('hmi-b-add').addEventListener('click', function () {
        if (widgets.length === 0) {
            showStatus('Bitte zuerst ein Widget anlegen (Widgets Tab)', 'error');
            return;
        }
        const next = deepClone(model);
        const b = {
            binding_id: nowId('b'),
            view_id: viewId,
            widget_id: widgets[0].widget_id,
            element_id: '',
            source: null,
            format: { unit: '', decimals: 0 },
            transform: { scale: 1.0, offset: 0.0, clamp: [null, null] },
            placement: { anchor: 'center', dx: 0, dy: 0 },
            interaction: null
        };
        next.bindings.push(b);
        ui.selectedBindingId = b.binding_id;
        commitHmiModel(next, 'add_binding');
        renderAll();
    });
    renderBindingEditor(model);
    decorateHmiPanel(panel, 'bindings', model);
}
// ------------------------- Binding Editor (inkl. Interaction Fix + Source-from-Device + Placement) -------------------------
function renderBindingEditor(model) {
    const editor = byId('hmi-binding-editor');
    if (!editor)
        return;
    const bid = ui.selectedBindingId;
    const b = (model.bindings || []).find(function (x) {
        return x.binding_id === bid;
    });
    if (!b) {
        editor.innerHTML = `<div class="hint-text">Wähle links ein Binding aus oder erstelle ein neues.</div>`;
        return;
    }
    const viewId = model.active_view_id || 'main';
    const widgets = model.widgets.filter(function (w) {
        return (w.view_id || 'main') === viewId;
    });
    const svgEls = getSvgElementsList();
    const widgetOptions = widgets
        .map(function (w) {
        return `<option value="${w.widget_id}" ${w.widget_id === b.widget_id ? 'selected' : ''}>${escapeHtml(w.name || w.widget_id)} (${w.type})</option>`;
    })
        .join('');
    const elementOptions = svgEls
        .map(function (e) {
        return `<option value="${e.element_id}" ${e.element_id === b.element_id ? 'selected' : ''}>${escapeHtml(e.label)}</option>`;
    })
        .join('');
    const srcUi = renderSourceEditor('hmi-b-src', b.source);
    const fmt = b.format || { unit: '', decimals: 0 };
    const tr = b.transform || { scale: 1, offset: 0, clamp: [null, null] };
    const plc = b.placement || {};
    const plcAnchor = plc.anchor || 'center';
    const plcDx = (plc.dx != null) ? plc.dx : 0;
    const plcDy = (plc.dy != null) ? plc.dy : 0;
    editor.innerHTML = `
    <div class="grid-1">

      <div class="form-group">
        <label>ID</label>
        <input class="text-input" value="${escapeAttr(b.binding_id)}" disabled/>
      </div>

      <div class="form-group">
        <label>Widget</label>
        <select id="hmi-b-widget" class="select-input">${widgetOptions}</select>
      </div>

      <div class="form-group">
        <label>SVG Element</label>
        <div class="grid-2">
          <select id="hmi-b-element" class="select-input">${elementOptions}</select>
          <button id="hmi-b-use-selection" class="btn btn-secondary">Use Selection</button>
        </div>
        <div class="hint-text">Tipp: Element im Canvas auswählen, dann “Use Selection”.</div>
      </div>

      <div class="form-group">
        <label>Placement (Canvas Preview)</label>
        <div class="grid-3">
          <div class="form-group">
            <label>Anchor</label>
            <select id="hmi-b-anchor" class="select-input">
              <option value="center" ${plcAnchor === 'center' ? 'selected' : ''}>center</option>
              <option value="top" ${plcAnchor === 'top' ? 'selected' : ''}>top</option>
              <option value="bottom" ${plcAnchor === 'bottom' ? 'selected' : ''}>bottom</option>
              <option value="left" ${plcAnchor === 'left' ? 'selected' : ''}>left</option>
              <option value="right" ${plcAnchor === 'right' ? 'selected' : ''}>right</option>
            </select>
          </div>
          <div class="form-group"><label>dx (px)</label><input id="hmi-b-dx" class="text-input" type="number" value="${escapeAttr(plcDx)}"/></div>
          <div class="form-group"><label>dy (px)</label><input id="hmi-b-dy" class="text-input" type="number" value="${escapeAttr(plcDy)}"/></div>
        </div>
      </div>

      <hr class="sep"/>

      <div class="form-group">
        <label>Quelle (Source)</label>
        ${srcUi}
        <div style="margin-top:6px;">
          <button id="hmi-b-source-from-device" class="btn btn-secondary">Quelle aus Device-Zuweisung übernehmen</button>
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group"><label>Unit</label><input id="hmi-b-unit" class="text-input" value="${escapeAttr(fmt.unit || '')}"/></div>
        <div class="form-group"><label>Decimals</label><input id="hmi-b-dec" class="text-input" type="number" value="${escapeAttr(fmt.decimals ?? 0)}"/></div>
      </div>

      <div class="grid-2">
        <div class="form-group"><label>Scale</label><input id="hmi-b-scale" class="text-input" type="number" value="${escapeAttr(tr.scale ?? 1)}"/></div>
        <div class="form-group"><label>Offset</label><input id="hmi-b-offset" class="text-input" type="number" value="${escapeAttr(tr.offset ?? 0)}"/></div>
      </div>

      <div class="grid-2">
        <div class="form-group"><label>Clamp Min</label><input id="hmi-b-clamp-min" class="text-input" type="number" value="${escapeAttr(tr.clamp && tr.clamp[0] != null ? tr.clamp[0] : '')}"/></div>
        <div class="form-group"><label>Clamp Max</label><input id="hmi-b-clamp-max" class="text-input" type="number" value="${escapeAttr(tr.clamp && tr.clamp[1] != null ? tr.clamp[1] : '')}"/></div>
      </div>

      <hr class="sep"/>

      <div class="form-group">
        <label>Interaktion (optional)</label>
        ${renderInteractionEditor(model, b)}
      </div>

      <div class="form-row" style="display:flex; gap:8px; margin-top:8px;">
        <button id="hmi-b-save" class="btn btn-primary">Speichern</button>
        <button id="hmi-b-delete" class="btn btn-danger">Löschen</button>
      </div>
    </div>
  `;
    function widgetTypeById(widgetId) {
        const w = (model.widgets || []).find(function (x) {
            return x && x.widget_id === widgetId;
        });
        return w && w.type ? String(w.type) : '';
    }
    byId('hmi-b-use-selection').addEventListener('click', function () {
        const sel = state.get('selectedElements') || [];
        if (!sel.length) {
            showStatus('Kein Canvas-Element ausgewählt', 'error');
            return;
        }
        const elId = sel[0];
        byId('hmi-b-element').value = elId;
        // ✅ Optional: wenn Source leer ist, deterministisch aus Device-Zuweisung vorbefüllen
        if (!b.source) {
            const wType = widgetTypeById(byId('hmi-b-widget')?.value || b.widget_id);
            const src = inferSourceFromDeviceAssignment(elId, wType);
            if (src) {
                const next = deepClone(model);
                const bb = next.bindings.find(function (x) {
                    return x.binding_id === b.binding_id;
                });
                if (bb) {
                    bb.element_id = elId;
                    bb.source = src;
                    commitHmiModel(next, 'use_selection_autofill');
                    showStatus('Element + Quelle übernommen (' + src.kind + ')', 'success');
                    renderAll();
                    return;
                }
            }
        }
    });
    bindSourceEditorHandlers('hmi-b-src');
    // ✅ deterministisch: Quelle aus Device
    const btnFromDevice = byId('hmi-b-source-from-device');
    if (btnFromDevice) {
        btnFromDevice.addEventListener('click', function () {
            const elementId = byId('hmi-b-element')?.value || '';
            if (!elementId) {
                showStatus('Bitte zuerst SVG Element wählen', 'error');
                return;
            }
            const wType = widgetTypeById(byId('hmi-b-widget')?.value || b.widget_id);
            const src = inferSourceFromDeviceAssignment(elementId, wType);
            if (!src) {
                showStatus('Keine passende Sensor/Actuator-ID in Device-Zuweisung', 'error');
                return;
            }
            const next = deepClone(model);
            const bb = next.bindings.find(function (x) {
                return x.binding_id === b.binding_id;
            });
            if (!bb)
                return;
            bb.source = src;
            commitHmiModel(next, 'auto_source_from_device');
            showStatus('Quelle übernommen (' + src.kind + ')', 'success');
            renderAll();
        });
    }
    byId('hmi-b-save').addEventListener('click', function () {
        return saveBinding(model, b.binding_id);
    });
    byId('hmi-b-delete').addEventListener('click', function () {
        return deleteBinding(model, b.binding_id);
    });
}
function saveBinding(model, bindingId) {
    const next = deepClone(model);
    const b = next.bindings.find(function (x) {
        return x.binding_id === bindingId;
    });
    if (!b)
        return;
    b.widget_id = byId('hmi-b-widget')?.value || b.widget_id;
    b.element_id = byId('hmi-b-element')?.value || '';
    // Source
    b.source = readSourceEditor('hmi-b-src');
    // Format + transform
    b.format = b.format || {};
    b.format.unit = byId('hmi-b-unit')?.value || '';
    b.format.decimals = toIntOrNull(byId('hmi-b-dec')?.value) ?? 0;
    b.transform = b.transform || {};
    b.transform.scale = toNumberOrNull(byId('hmi-b-scale')?.value) ?? 1.0;
    b.transform.offset = toNumberOrNull(byId('hmi-b-offset')?.value) ?? 0.0;
    const cmin = toNumberOrNull(byId('hmi-b-clamp-min')?.value);
    const cmax = toNumberOrNull(byId('hmi-b-clamp-max')?.value);
    b.transform.clamp = [cmin, cmax];
    // Placement
    b.placement = b.placement || {};
    b.placement.anchor = byId('hmi-b-anchor')?.value || 'center';
    b.placement.dx = toNumberOrNull(byId('hmi-b-dx')?.value) ?? 0;
    b.placement.dy = toNumberOrNull(byId('hmi-b-dy')?.value) ?? 0;
    // Interaction
    b.interaction = readInteractionEditor(model);
    // Validierung
    if (!b.element_id) {
        showStatus('SVG Element fehlt', 'error');
        return;
    }
    if (!b.widget_id) {
        showStatus('Widget fehlt', 'error');
        return;
    }
    // ✅ Quelle optional, wenn Interaktion vorhanden (Buttons)
    if (!b.source && !b.interaction) {
        showStatus('Quelle (Source) oder Interaktion fehlt', 'error');
        return;
    }
    commitHmiModel(next, 'edit_binding');
    showStatus('Binding gespeichert', 'success');
    renderAll();
}
function deleteBinding(model, bindingId) {
    showConfirmation('Diese HMI-Datenbindung dauerhaft löschen?', {
        title: 'Datenbindung löschen',
        confirmLabel: 'Binding löschen',
        destructive: true,
        detail: 'Widget und P&ID-/SVG-Objekt bleiben erhalten; nur die Kopplung zur Runtime wird entfernt.'
    }, function () {
        const next = deepClone(model);
        next.bindings = next.bindings.filter(function (binding) {
            return binding.binding_id !== bindingId;
        });
        ui.selectedBindingId = null;
        commitHmiModel(next, 'delete_binding');
        showStatus('Binding gelöscht', 'success');
        renderAll();
    });
}
// ------------------------- Source Editor (freie ID via datalist) -------------------------
function renderSourceEditor(prefix, src) {
    const sensors = getAvailableSensors();
    const acts = getAvailableActuators();
    const states = getAvailableProcessStates();
    const kind = (src && src.kind) ? src.kind : 'sensor';
    const sensorId = (src && src.sensor_id != null) ? String(src.sensor_id) : '';
    const actuatorId = (src && src.actuator_id != null) ? String(src.actuator_id) : '';
    const stateId = (src && src.state_id != null) ? String(src.state_id) : '';
    const fieldDefault = kind === 'state' ? 'active' :
        'value';
    const field = (src && src.field) ? String(src.field) : fieldDefault;
    const kindOptions = [
        { v: 'sensor', n: 'Sensor' },
        { v: 'actuator', n: 'Actuator' },
        { v: 'state', n: 'Process State' }
    ].map(function (o) {
        return `<option value="${o.v}" ${o.v === kind ? 'selected' : ''}>${o.n}</option>`;
    }).join('');
    // datalist erlaubt freie Eingabe + Vorschläge
    const listId = `${prefix}-id-list`;
    let listOptions = '';
    let currentIdVal = '';
    if (kind === 'sensor') {
        listOptions = sensors.map(function (s) {
            return `<option value="${s.sensor_id}">${escapeHtml(s.label)}</option>`;
        }).join('');
        currentIdVal = sensorId;
    }
    else if (kind === 'actuator') {
        listOptions = acts.map(function (a) {
            return `<option value="${a.actuator_id}">${escapeHtml(a.label)}</option>`;
        }).join('');
        currentIdVal = actuatorId;
    }
    else {
        listOptions = states.map(function (s) {
            return `<option value="${s.state_id}">${escapeHtml(s.label)}</option>`;
        }).join('');
        currentIdVal = stateId;
    }
    function fieldOpt(v, label) {
        return `<option value="${v}" ${String(v) === String(field) ? 'selected' : ''}>${label}</option>`;
    }
    let fieldOptions = '';
    if (kind === 'sensor') {
        fieldOptions = fieldOpt('value', 'value');
    }
    else if (kind === 'actuator') {
        fieldOptions = fieldOpt('value', 'value') + fieldOpt('last_state', 'last_state');
    }
    else {
        fieldOptions = fieldOpt('active', 'active') + fieldOpt('value_id', 'value_id') + fieldOpt('mode_id', 'mode_id');
    }
    return `
    <div class="grid-3">
      <div class="form-group">
        <label>Kind</label>
        <select id="${prefix}-kind" class="select-input">${kindOptions}</select>
      </div>

      <div class="form-group">
        <label>ID</label>
        <input id="${prefix}-id" class="text-input" type="number" list="${listId}" value="${escapeAttr(currentIdVal)}" placeholder="frei eingeben…"/>
        <datalist id="${listId}">
          ${listOptions}
        </datalist>
      </div>

      <div class="form-group">
        <label>Field</label>
        <select id="${prefix}-field" class="select-input">
          ${fieldOptions}
        </select>
      </div>
    </div>
  `;
}
function bindSourceEditorHandlers(prefix) {
    const kindEl = byId(prefix + '-kind');
    if (!kindEl)
        return;
    // minimal: bei Kind-Wechsel komplette UI neu rendern
    kindEl.addEventListener('change', function () {
        renderAll();
    });
}
function readSourceEditor(prefix) {
    const kind = byId(prefix + '-kind')?.value || '';
    const idRaw = byId(prefix + '-id')?.value || '';
    const field = byId(prefix + '-field')?.value || 'value';
    const idNum = toIntOrNull(idRaw);
    if (!kind || idNum === null)
        return null;
    if (kind === 'sensor')
        return { kind: 'sensor', sensor_id: idNum, field: field };
    if (kind === 'actuator')
        return { kind: 'actuator', actuator_id: idNum, field: field };
    if (kind === 'state')
        return { kind: 'state', state_id: idNum, field: field };
    return null;
}
// ------------------------- Interaction Editor (Fix: Action live -> Details) -------------------------
function renderInteractionEditor(model, binding) {
    const viewId = model.active_view_id || 'main';
    const widget = model.widgets.find(function (w) {
        return w.widget_id === binding.widget_id && (w.view_id || 'main') === viewId;
    });
    const type = widget ? widget.type : '';
    const acts = getAvailableActuators();
    const states = getAvailableProcessStates();
    const i = binding.interaction || {};
    const action = i.action || 'none';
    const mode = i.mode || 'toggle';
    const actionOptions = [
        { v: 'none', n: 'none' },
        { v: 'actuator_set', n: 'actuator_set' },
        { v: 'setpoint_override', n: 'setpoint_override' },
        { v: 'process_set_active', n: 'process_set_active' }
    ].map(function (o) {
        return `<option value="${o.v}" ${o.v === action ? 'selected' : ''}>${o.n}</option>`;
    }).join('');
    const helper = type ? `<div class="hint-text">Widget-Typ: ${escapeHtml(type)} (Interaktion optional)</div>` : '';
    return `
    ${helper}
    <div class="grid-2">
      <div class="form-group">
        <label>Action</label>
        <select id="hmi-i-action" class="select-input">${actionOptions}</select>
      </div>
      <div class="form-group">
        <label>Mode</label>
        <select id="hmi-i-mode" class="select-input">
          <option value="toggle" ${mode === 'toggle' ? 'selected' : ''}>toggle</option>
          <option value="momentary" ${mode === 'momentary' ? 'selected' : ''}>momentary</option>
          <option value="set_value" ${mode === 'set_value' ? 'selected' : ''}>set_value</option>
        </select>
      </div>
    </div>

    <div id="hmi-i-details">
      ${renderInteractionDetails(action, i, acts, states)}
    </div>

    <div class="hint-text">Interaktion wird von der HMI-GUI ausgeführt (nicht von PSM/Automation direkt).</div>
  `;
}
function renderInteractionDetails(action, i, acts, states) {
    function opt(value, label, selected) {
        return `<option value="${escapeAttr(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }
    if (action === 'actuator_set') {
        const sel = i && i.target ? i.target.actuator_id : null;
        const actOpts = ['<option value="">–</option>'].concat((acts || []).map(function (a) {
            return opt(a.actuator_id, a.label, sel);
        })).join('');
        return `
      <div class="grid-2">
        <div class="form-group">
          <label>Actuator</label>
          <select id="hmi-i-actuator" class="select-input">${actOpts}</select>
        </div>
        <div class="form-group">
          <label>Value</label>
          <input id="hmi-i-value" class="text-input" value="${escapeAttr(i && i.value != null ? i.value : '')}" placeholder="0/1 oder numeric"/>
        </div>
      </div>
    `;
    }
    if (action === 'setpoint_override') {
        const sel = i && i.target ? i.target.state_id : null;
        const stOpts = ['<option value="">–</option>'].concat((states || []).map(function (s) {
            return opt(s.state_id, s.label, sel);
        })).join('');
        const field = (i && i.field) ? i.field : 'target_temp_c';
        return `
      <div class="grid-2">
        <div class="form-group">
          <label>State</label>
          <select id="hmi-i-state" class="select-input">${stOpts}</select>
        </div>
        <div class="form-group">
          <label>Field</label>
          <input id="hmi-i-field" class="text-input" value="${escapeAttr(field)}" placeholder="z.B. target_temp_c"/>
        </div>
      </div>
    `;
    }
    if (action === 'process_set_active') {
        const pid = (i && i.p_id != null) ? i.p_id : '';
        const st = (i && i.state_type) ? i.state_type : 'heating';
        const active = (i && typeof i.active === 'boolean') ? i.active : true;
        return `
      <div class="grid-2">
        <div class="form-group">
          <label>P-ID</label>
          <input id="hmi-i-pid" class="text-input" type="number" value="${escapeAttr(pid)}" placeholder="z.B. 1"/>
        </div>
        <div class="form-group">
          <label>State Type</label>
          <input id="hmi-i-state-type" class="text-input" value="${escapeAttr(st)}" placeholder="z.B. heating"/>
        </div>
      </div>
      <div class="form-group">
        <label>Active</label>
        <select id="hmi-i-active" class="select-input">
          <option value="true" ${active === true ? 'selected' : ''}>true</option>
          <option value="false" ${active === false ? 'selected' : ''}>false</option>
        </select>
      </div>
    `;
    }
    return `<div class="hint-text">Keine Details.</div>`;
}
function readInteractionEditor(model) {
    const action = byId('hmi-i-action')?.value || 'none';
    if (action === 'none')
        return null;
    const mode = byId('hmi-i-mode')?.value || 'toggle';
    if (action === 'actuator_set') {
        const aid = toIntOrNull(byId('hmi-i-actuator')?.value);
        const valueRaw = byId('hmi-i-value')?.value || '';
        if (aid === null)
            return null;
        const n = Number(String(valueRaw).trim());
        const value = Number.isFinite(n) ? n : valueRaw;
        return { action: 'actuator_set', mode: mode, target: { actuator_id: aid }, value: value };
    }
    if (action === 'setpoint_override') {
        const sid = toIntOrNull(byId('hmi-i-state')?.value);
        const field = byId('hmi-i-field')?.value || 'target_temp_c';
        if (sid === null)
            return null;
        return { action: 'setpoint_override', mode: mode, target: { state_id: sid }, field: field };
    }
    if (action === 'process_set_active') {
        const pid = toIntOrNull(byId('hmi-i-pid')?.value);
        const st = byId('hmi-i-state-type')?.value || 'heating';
        const active = (byId('hmi-i-active')?.value === 'true');
        if (pid === null)
            return null;
        return { action: 'process_set_active', mode: mode, p_id: pid, state_type: st, active: active };
    }
    return null;
}
// ------------------------- Sanity (UI) -------------------------
function computeHmiSanityReport(model, viewId) {
    const report = { by_binding: {}, errors: [], warnings: [] };
    const bindings = (model.bindings || []).filter(function (b) {
        return (b.view_id || 'main') === viewId;
    });
    const widgetIds = new Set((model.widgets || []).map(function (w) {
        return w && w.widget_id;
    }).filter(Boolean));
    const svgIds = new Set((getSvgElementsList() || []).map(function (e) {
        return e && e.element_id;
    }).filter(Boolean));
    bindings.forEach(function (b) {
        if (!b)
            return;
        const reasonsErr = [];
        const reasonsWarn = [];
        if (!b.widget_id)
            reasonsErr.push('widget_id fehlt');
        else if (!widgetIds.has(b.widget_id))
            reasonsErr.push('widget_id unbekannt');
        if (!b.element_id)
            reasonsErr.push('element_id fehlt');
        else if (!svgIds.has(b.element_id))
            reasonsErr.push('SVG Element existiert nicht (mehr)');
        const hasSource = b.source && typeof b.source === 'object';
        const hasInteraction = b.interaction && typeof b.interaction === 'object';
        if (!hasSource && !hasInteraction)
            reasonsWarn.push('keine Quelle und keine Interaktion');
        if (hasSource) {
            const k = b.source.kind;
            if (k === 'sensor' && toIntOrNull(b.source.sensor_id) === null)
                reasonsErr.push('source.sensor_id fehlt/ungültig');
            if (k === 'actuator' && toIntOrNull(b.source.actuator_id) === null)
                reasonsErr.push('source.actuator_id fehlt/ungültig');
            if (k === 'state' && toIntOrNull(b.source.state_id) === null)
                reasonsErr.push('source.state_id fehlt/ungültig');
        }
        const id = b.binding_id || '(ohne id)';
        if (reasonsErr.length || reasonsWarn.length) {
            report.by_binding[id] = { errors: reasonsErr, warnings: reasonsWarn };
            if (reasonsErr.length)
                report.errors.push({ binding_id: id, reasons: reasonsErr });
            if (reasonsWarn.length)
                report.warnings.push({ binding_id: id, reasons: reasonsWarn });
        }
    });
    return report;
}
function renderHmiSanityBanner(report) {
    if (!report)
        return '';
    const errN = report.errors ? report.errors.length : 0;
    const warnN = report.warnings ? report.warnings.length : 0;
    if (errN === 0 && warnN === 0)
        return '';
    const lines = []
        .concat((report.errors || []).slice(0, 4).map(function (x) {
        return `• ${x.binding_id}: ${x.reasons.join(', ')}`;
    }))
        .concat((report.warnings || []).slice(0, 4).map(function (x) {
        return `• ${x.binding_id}: ${x.reasons.join(', ')}`;
    }));
    const more = (errN + warnN) > 8 ? `<div class="hint-text">… und weitere (${(errN + warnN) - 8})</div>` : '';
    return `
    <div style="border:1px solid rgba(245,158,11,.5); background:rgba(245,158,11,.08); padding:10px; border-radius:8px; margin:10px 0;">
      <div style="font-weight:600; margin-bottom:6px;">
        ⚠️ Sanity Check: ${errN} Fehler, ${warnN} Warnungen
      </div>
      <div style="font-size:12px; color:#cbd5e1; white-space:pre-line;">
${escapeHtml(lines.join('\n'))}
      </div>
      ${more}
      <div class="hint-text">Unvollständige Bindings werden beim Export ignoriert (siehe Export-Report).</div>
    </div>
  `;
}
// ------------------------- Styles & Alarms Panel -------------------------
function renderStylesPanel(model) {
    const panel = byId('hmi-ui-panel-styles');
    if (!panel)
        return;
    const viewId = model.active_view_id || 'main';
    const styles = (model.styles || []).filter(function (style) {
        return (style.view_id || 'main') === viewId;
    });
    const alarms = (model.alarms || []).filter(function (alarm) {
        return (alarm.view_id || 'main') === viewId;
    });
    panel.innerHTML = `
    <div class="hmi-state-workflow">
      <section class="hmi-config-card hmi-state-view-card">
        <div class="hmi-config-card__body">
          <div class="form-group hmi-view-selector-row">
            <label>Aktive View</label>
            ${renderViewSelector(model)}
          </div>
        </div>
      </section>

      <details id="hmi-live-preview-section" class="hmi-disclosure hmi-config-card"${hmiDisclosureOpen('stylesPreview', true)}>
        <summary>
          <span><strong>1 · Signal testen</strong><small>Simuliere einen Runtime-Wert und prüfe Widget-, SVG- und Alarmreaktionen direkt im Editor.</small></span>
          <span class="hmi-config-badge">Simulation</span>
        </summary>
        <div class="hmi-disclosure__body"><div id="hmi-live-preview"></div></div>
      </details>

      <section class="hmi-config-card hmi-threshold-card" aria-labelledby="hmi-threshold-card-title">
        <header class="hmi-config-card__header">
          <div>
            <span class="hmi-config-card__eyebrow">2 · Empfohlener Workflow</span>
            <h4 id="hmi-threshold-card-title">Grenzwerte, Zustände und Alarm in einem Schritt</h4>
            <p>Der Assistent erzeugt konsistente OK-, WARN- und ALARM-Zustände für genau eine Datenbindung.</p>
          </div>
          <span class="hmi-config-badge hmi-config-badge--accent">Empfohlen</span>
        </header>
        <div class="hmi-config-card__body"><div id="hmi-threshold-wizard"></div></div>
      </section>

      <section id="hmi-event-animation-section" class="hmi-config-card hmi-event-animation-card" aria-labelledby="hmi-event-animation-title">
        <header class="hmi-config-card__header">
          <div>
            <span class="hmi-config-card__eyebrow">3 · Ereignisgesteuerte SVG-Animationen</span>
            <h4 id="hmi-event-animation-title">Bauteile und innere SVG-Bereiche animieren</h4>
            <p>Kopple Farbe, Fluss, Temperatur, Füllstand, Rotation oder Warnbewegung an dieselben Runtime-Signale und Ereignisse wie das HMI.</p>
          </div>
          <span class="hmi-config-badge hmi-config-badge--accent">V64 · Event API</span>
        </header>
        <div class="hmi-config-card__body"><div id="hmi-event-animation-designer"></div></div>
      </section>

      <details id="hmi-manual-state-section" class="hmi-disclosure hmi-config-card hmi-manual-state-section"${hmiDisclosureOpen('stylesManual', false)}>
        <summary>
          <span><strong>4 · Erweiterte manuelle Bearbeitung</strong><small>Einzelne Conditions, Klassen und Alarmobjekte gezielt verwalten.</small></span>
          <span class="hmi-config-badge">${styles.length} Zustände · ${alarms.length} Alarme</span>
        </summary>
        <div class="hmi-disclosure__body hmi-manual-state-body">
          <section class="hmi-manual-editor-section" aria-labelledby="hmi-manual-style-title">
            <header class="hmi-manual-editor-section__header">
              <div><h4 id="hmi-manual-style-title">Visuelle Zustände</h4><p>Condition → CSS-Klassen auf Widget und/oder SVG.</p></div>
              <button id="hmi-style-add" class="btn btn-primary" type="button">+ Zustand</button>
            </header>
            <div class="hmi-manual-editor-grid">
              <div id="hmi-style-list" class="table"></div>
              <div><label class="hmi-editor-label">Zustand bearbeiten</label><div id="hmi-style-editor"></div></div>
            </div>
          </section>

          <section class="hmi-manual-editor-section" aria-labelledby="hmi-manual-alarm-title">
            <header class="hmi-manual-editor-section__header">
              <div><h4 id="hmi-manual-alarm-title">Alarmregeln</h4><p>Severity, Meldung, Blink, Quittierung, Latching und Zielklassen.</p></div>
              <button id="hmi-alarm-add" class="btn btn-primary" type="button">+ Alarm</button>
            </header>
            <div class="hmi-manual-editor-grid">
              <div id="hmi-alarm-list" class="table"></div>
              <div><label class="hmi-editor-label">Alarm bearbeiten</label><div id="hmi-alarm-editor"></div></div>
            </div>
          </section>
        </div>
      </details>
    </div>
  `;
    bindViewSelector(model);
    bindHmiDisclosure('#hmi-live-preview-section', 'stylesPreview');
    bindHmiDisclosure('#hmi-manual-state-section', 'stylesManual');
    if (typeof renderHmiLivePreviewPanel === 'function')
        renderHmiLivePreviewPanel(model);
    renderThresholdWizardPanel(model);
    renderHmiEventAnimationDesigner(byId('hmi-event-animation-designer'), model);
    byId('hmi-style-add').addEventListener('click', function () {
        const next = deepClone(model);
        const target = ui.selectedBindingId ? ui.selectedBindingId : (next.bindings[0] ? next.bindings[0].binding_id : '');
        const firstSensor = getAvailableSensors()[0];
        const sensorId = firstSensor ? firstSensor.sensor_id : 1;
        const style = {
            style_id: nowId('s'),
            view_id: viewId,
            target: { binding_id: target },
            when: { type: 'sensor_cmp', sensor_id: sensorId, field: 'value', op: '>=', value: 80 },
            apply: {
                classes_add_widget: ['hmi-anim-blink'],
                classes_remove_widget: [],
                classes_add_svg: [],
                classes_remove_svg: []
            },
            priority: 100
        };
        style.apply.classes_add = uniq([].concat(style.apply.classes_add_widget, style.apply.classes_add_svg));
        style.apply.classes_remove = uniq([].concat(style.apply.classes_remove_widget, style.apply.classes_remove_svg));
        next.styles.push(style);
        ui.selectedStyleId = style.style_id;
        commitHmiModel(next, 'add_style');
        renderAll();
    });
    byId('hmi-alarm-add').addEventListener('click', function () {
        const next = deepClone(model);
        let source = null;
        let condition = null;
        let targetBindingId = '';
        const bindingWithSensor = (next.bindings || []).find(function (binding) {
            return binding && binding.source && binding.source.kind === 'sensor' && binding.source.sensor_id != null;
        });
        if (bindingWithSensor) {
            source = { kind: 'sensor', sensor_id: bindingWithSensor.source.sensor_id, field: bindingWithSensor.source.field || 'value' };
            condition = { type: 'sensor_cmp', sensor_id: bindingWithSensor.source.sensor_id, field: bindingWithSensor.source.field || 'value', op: '>=', value: 80 };
            targetBindingId = bindingWithSensor.binding_id || '';
        }
        else {
            const firstSensor = getAvailableSensors()[0];
            const sensorId = firstSensor ? firstSensor.sensor_id : 1;
            source = { kind: 'sensor', sensor_id: sensorId, field: 'value' };
            condition = { type: 'sensor_cmp', sensor_id: sensorId, field: 'value', op: '>=', value: 80 };
            targetBindingId = next.bindings[0] ? next.bindings[0].binding_id : '';
        }
        const alarm = {
            alarm_id: nowId('a'),
            view_id: viewId,
            source: source,
            condition: condition,
            severity: 'WARN',
            latching: false,
            ack_required: false,
            message: 'Alarm',
            target: { binding_id: targetBindingId },
            apply: {
                classes_add_widget: ['hmi-anim-blink'],
                classes_remove_widget: [],
                classes_add_svg: ['hmi-anim-blink'],
                classes_remove_svg: []
            },
            visual: { blink: true, blink_class: 'hmi-anim-blink' }
        };
        alarm.apply.classes_add = uniq([].concat(alarm.apply.classes_add_widget, alarm.apply.classes_add_svg));
        alarm.apply.classes_remove = uniq([].concat(alarm.apply.classes_remove_widget, alarm.apply.classes_remove_svg));
        next.alarms.push(alarm);
        ui.selectedAlarmId = alarm.alarm_id;
        commitHmiModel(next, 'add_alarm');
        renderAll();
    });
    renderStyleList(model, styles);
    renderStyleEditor(model);
    renderAlarmList(model, alarms);
    renderAlarmEditor(model);
    decorateHmiPanel(panel, 'styles', model);
}
// ------------------------- Threshold Wizard (OK/WARN/ALARM) -------------------------
function twParseClassList(raw) {
    return String(raw || '')
        .split(/[,\s]+/g)
        .map(function (s) {
        return String(s || '').trim();
    })
        .filter(Boolean);
}
function twClampNumber(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return fallback;
    return n;
}
function twSourceInfoFromBinding(binding) {
    if (!binding || !binding.source)
        return null;
    const src = binding.source;
    const kind = String(src.kind || '').toLowerCase();
    const field = String(src.field || 'value');
    if (kind === 'sensor') {
        const sid = (src.sensor_id != null) ? src.sensor_id : src.id;
        if (sid == null)
            return null;
        return { kind: 'sensor', id: Number(sid), field: field };
    }
    if (kind === 'actuator') {
        const aid = (src.actuator_id != null) ? src.actuator_id : src.id;
        if (aid == null)
            return null;
        return { kind: 'actuator', id: Number(aid), field: field };
    }
    return null;
}
function twCond(kind, id, field, op, value) {
    if (kind === 'sensor') {
        return { type: 'sensor_cmp', sensor_id: id, field: String(field || 'value'), op: String(op), value: Number(value) };
    }
    if (kind === 'actuator') {
        return { type: 'actuator_cmp', actuator_id: id, field: String(field || 'value'), op: String(op), value: Number(value) };
    }
    return null;
}
function twMakeApply(addW, remW, addS, remS) {
    const apply = {
        classes_add_widget: Array.isArray(addW) ? addW : [],
        classes_remove_widget: Array.isArray(remW) ? remW : [],
        classes_add_svg: Array.isArray(addS) ? addS : [],
        classes_remove_svg: Array.isArray(remS) ? remS : []
    };
    // Backward-Compat
    apply.classes_add = uniq([].concat(apply.classes_add_widget, apply.classes_add_svg));
    apply.classes_remove = uniq([].concat(apply.classes_remove_widget, apply.classes_remove_svg));
    return apply;
}
function renderThresholdWizardPanel(model) {
    const host = byId('hmi-threshold-wizard');
    if (!host)
        return;
    const viewId = model.active_view_id || 'main';
    const bindings = (model.bindings || []).filter(function (b) {
        return b && (b.view_id || 'main') === viewId;
    });
    if (!bindings.length) {
        host.innerHTML = `<div class="hint-text">Threshold Wizard: Keine Bindings in dieser View.</div>`;
        return;
    }
    // persistente Wizard-State in ui
    ui.thresholdWizard = ui.thresholdWizard || {};
    const tw = ui.thresholdWizard;
    // default binding
    if (!tw.binding_id || !bindings.some(function (b) {
        return b.binding_id === tw.binding_id;
    })) {
        if (ui.selectedBindingId && bindings.some(function (b) {
            return b.binding_id === ui.selectedBindingId;
        }))
            tw.binding_id = ui.selectedBindingId;
        else
            tw.binding_id = bindings[0].binding_id;
    }
    // defaults
    if (tw.warn == null)
        tw.warn = 50;
    if (tw.alarm == null)
        tw.alarm = 80;
    if (tw.apply_overlay == null)
        tw.apply_overlay = true;
    if (tw.apply_svg == null)
        tw.apply_svg = true;
    if (!tw.ok_w)
        tw.ok_w = 'ok-green';
    if (!tw.warn_w)
        tw.warn_w = 'warn-yellow';
    if (!tw.alarm_w)
        tw.alarm_w = 'alarm-red hmi-anim-blink';
    if (!tw.ok_s)
        tw.ok_s = 'ok-green';
    if (!tw.warn_s)
        tw.warn_s = 'warn-yellow';
    if (!tw.alarm_s)
        tw.alarm_s = 'alarm-red hmi-anim-blink';
    if (tw.create_alarm == null)
        tw.create_alarm = true;
    if (!tw.alarm_severity)
        tw.alarm_severity = 'CRITICAL';
    if (tw.alarm_latching == null)
        tw.alarm_latching = false;
    if (tw.alarm_ack == null)
        tw.alarm_ack = false;
    if (!tw.alarm_message)
        tw.alarm_message = 'Threshold Alarm';
    const opts = bindings.map(function (binding) {
        const source = twSourceInfoFromBinding(binding);
        const sourceText = source ? hmiSourceSummary(binding.source, binding.interaction) : 'Runtime-Quelle fehlt';
        const widget = (model.widgets || []).find(function (item) {
            return item.widget_id === binding.widget_id;
        });
        const widgetText = widget ? (widget.name || widget.widget_id) : (binding.widget_id || 'Widget');
        const objectText = binding.element_id ? svgElementLabel(binding.element_id) : 'Kein P&ID-/SVG-Objekt';
        const label = widgetText + ' → ' + objectText + ' → ' + sourceText;
        return `<option value="${escapeAttr(binding.binding_id)}" ${binding.binding_id === tw.binding_id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    const bSel = bindings.find(function (b) {
        return b.binding_id === tw.binding_id;
    }) || bindings[0];
    const srcInfo = twSourceInfoFromBinding(bSel);
    const srcNote = srcInfo
        ? `<span class="hint-text">Quelle: <code>${escapeHtml(srcInfo.kind)}:${escapeHtml(String(srcInfo.id))}:${escapeHtml(srcInfo.field)}</code></span>`
        : `<span class="hint-text" style="color:#fca5a5;">Quelle fehlt im Binding → bitte Source setzen.</span>`;
    host.innerHTML = `
    <div class="hmi-threshold-workflow">
      <div class="hmi-threshold-flow" aria-label="Grenzwert-Workflow">
        <strong>1 · Binding</strong><span aria-hidden="true">→</span>
        <strong>2 · Schwellen</strong><span aria-hidden="true">→</span>
        <strong>3 · Ausgabe</strong><span aria-hidden="true">→</span>
        <strong>4 · Erzeugen</strong>
      </div>

      <section class="hmi-threshold-section" aria-labelledby="hmi-threshold-source-title">
        <header><h5 id="hmi-threshold-source-title">1 · Datenbindung auswählen</h5><p>Widget, P&amp;ID-/SVG-Objekt und Runtime-Quelle werden gemeinsam angezeigt.</p></header>
        <div class="form-group">
          <label>Binding</label>
          <select id="hmi-tw-binding" class="select-input">${opts}</select>
          <div class="hmi-source-note">${srcNote}</div>
        </div>
      </section>

      <section class="hmi-threshold-section" aria-labelledby="hmi-threshold-values-title">
        <header><h5 id="hmi-threshold-values-title">2 · WARN- und ALARM-Schwelle festlegen</h5><p>WARN muss kleiner als ALARM sein; vertauschte Werte werden beim Erzeugen automatisch korrigiert.</p></header>
        <div class="grid-2">
          <div class="form-group"><label>WARN ab</label><input id="hmi-tw-warn" class="text-input" type="number" value="${escapeAttr(tw.warn)}"/></div>
          <div class="form-group"><label>ALARM ab</label><input id="hmi-tw-alarm" class="text-input" type="number" value="${escapeAttr(tw.alarm)}"/></div>
        </div>
        <div class="hmi-threshold-scale" aria-hidden="true">
          <span class="hmi-threshold-scale__ok">OK &lt; ${escapeHtml(String(tw.warn))}</span>
          <span class="hmi-threshold-scale__warn">WARN</span>
          <span class="hmi-threshold-scale__alarm">ALARM ≥ ${escapeHtml(String(tw.alarm))}</span>
        </div>
      </section>

      <section class="hmi-threshold-section" aria-labelledby="hmi-threshold-output-title">
        <header><h5 id="hmi-threshold-output-title">3 · Sichtbarkeit und Alarmverhalten wählen</h5><p>Bestimme, ob der Zustand am HMI-Widget, am Prozesssymbol oder an beiden Stellen sichtbar wird.</p></header>
        <div class="hmi-toggle-card-grid">
          <label class="hmi-toggle-card"><input id="hmi-tw-apply-overlay" type="checkbox" ${tw.apply_overlay ? 'checked' : ''}/><span><strong>Widget/Overlay färben</strong><small>Setzt Zustandsklassen auf dem HMI-Element.</small></span></label>
          <label class="hmi-toggle-card"><input id="hmi-tw-apply-svg" type="checkbox" ${tw.apply_svg ? 'checked' : ''}/><span><strong>P&amp;ID-/SVG-Objekt färben</strong><small>Setzt Zustandsklassen direkt auf dem gebundenen Symbol.</small></span></label>
          <label class="hmi-toggle-card"><input id="hmi-tw-create-alarm" type="checkbox" ${tw.create_alarm ? 'checked' : ''}/><span><strong>Alarmobjekt zusätzlich erzeugen</strong><small>Legt neben den drei Styles einen Eintrag in <code>hmi_ui.alarms</code> an.</small></span></label>
        </div>
        <div class="grid-2 hmi-alarm-basic-grid">
          <div class="form-group">
            <label>Severity</label>
            <select id="hmi-tw-alarm-sev" class="select-input">
              <option value="INFO" ${tw.alarm_severity === 'INFO' ? 'selected' : ''}>INFO</option>
              <option value="WARN" ${tw.alarm_severity === 'WARN' ? 'selected' : ''}>WARN</option>
              <option value="CRITICAL" ${tw.alarm_severity === 'CRITICAL' ? 'selected' : ''}>CRITICAL</option>
            </select>
          </div>
          <div class="form-group"><label>Alarmmeldung</label><input id="hmi-tw-alarm-msg" class="text-input" value="${escapeAttr(tw.alarm_message)}"/></div>
        </div>
      </section>

      <details id="hmi-threshold-advanced" class="hmi-disclosure hmi-disclosure--nested"${hmiDisclosureOpen('thresholdAdvanced', false)}>
        <summary><span><strong>Erweiterte Zustandsklassen und Quittierung</strong><small>Standardwerte sind sofort nutzbar; projektspezifische CSS-Klassen bleiben vollständig konfigurierbar.</small></span></summary>
        <div class="hmi-disclosure__body">
          <div class="hmi-toggle-card-grid hmi-toggle-card-grid--compact">
            <label class="hmi-toggle-card"><input id="hmi-tw-alarm-latching" type="checkbox" ${tw.alarm_latching ? 'checked' : ''}/><span><strong>Alarm bleibt aktiv</strong><small>Latching bis zum Rücksetzen.</small></span></label>
            <label class="hmi-toggle-card"><input id="hmi-tw-alarm-ack" type="checkbox" ${tw.alarm_ack ? 'checked' : ''}/><span><strong>Quittierung erforderlich</strong><small>Operator muss den Alarm bestätigen.</small></span></label>
          </div>
          <div class="hmi-class-matrix">
            <div class="hmi-class-matrix__head"><span>Zustand</span><span>Widget/Overlay</span><span>P&amp;ID-/SVG-Objekt</span></div>
            <div class="hmi-class-matrix__row"><strong>OK</strong><input id="hmi-tw-ok-w" class="text-input" value="${escapeAttr(tw.ok_w)}"/><input id="hmi-tw-ok-s" class="text-input" value="${escapeAttr(tw.ok_s)}"/></div>
            <div class="hmi-class-matrix__row"><strong>WARN</strong><input id="hmi-tw-warn-w" class="text-input" value="${escapeAttr(tw.warn_w)}"/><input id="hmi-tw-warn-s" class="text-input" value="${escapeAttr(tw.warn_s)}"/></div>
            <div class="hmi-class-matrix__row"><strong>ALARM</strong><input id="hmi-tw-alarm-w" class="text-input" value="${escapeAttr(tw.alarm_w)}"/><input id="hmi-tw-alarm-s" class="text-input" value="${escapeAttr(tw.alarm_s)}"/></div>
          </div>
        </div>
      </details>

      <div class="hmi-threshold-actions">
        <button id="hmi-tw-generate" class="btn btn-primary" type="button">OK/WARN/ALARM erzeugen</button>
        <button id="hmi-tw-preview-warn" class="btn btn-secondary" type="button">WARN testen</button>
        <button id="hmi-tw-preview-alarm" class="btn btn-secondary" type="button">ALARM testen</button>
      </div>
    </div>
  `;
    bindHmiDisclosure('#hmi-threshold-advanced', 'thresholdAdvanced');
    function syncTwFromForm() {
        tw.binding_id = byId('hmi-tw-binding')?.value || tw.binding_id;
        tw.warn = twClampNumber(byId('hmi-tw-warn')?.value, tw.warn);
        tw.alarm = twClampNumber(byId('hmi-tw-alarm')?.value, tw.alarm);
        tw.apply_overlay = byId('hmi-tw-apply-overlay')?.checked ? true : false;
        tw.apply_svg = byId('hmi-tw-apply-svg')?.checked ? true : false;
        tw.ok_w = byId('hmi-tw-ok-w')?.value || tw.ok_w;
        tw.warn_w = byId('hmi-tw-warn-w')?.value || tw.warn_w;
        tw.alarm_w = byId('hmi-tw-alarm-w')?.value || tw.alarm_w;
        tw.ok_s = byId('hmi-tw-ok-s')?.value || tw.ok_s;
        tw.warn_s = byId('hmi-tw-warn-s')?.value || tw.warn_s;
        tw.alarm_s = byId('hmi-tw-alarm-s')?.value || tw.alarm_s;
        tw.create_alarm = byId('hmi-tw-create-alarm')?.checked ? true : false;
        tw.alarm_severity = byId('hmi-tw-alarm-sev')?.value || tw.alarm_severity;
        tw.alarm_latching = byId('hmi-tw-alarm-latching')?.checked ? true : false;
        tw.alarm_ack = byId('hmi-tw-alarm-ack')?.checked ? true : false;
        tw.alarm_message = byId('hmi-tw-alarm-msg')?.value || tw.alarm_message;
    }
    // Re-render wizard if binding changes (source display update)
    byId('hmi-tw-binding')?.addEventListener('change', function () {
        syncTwFromForm();
        renderAll();
    });
    // keep state updated
    [
        'hmi-tw-warn', 'hmi-tw-alarm',
        'hmi-tw-apply-overlay', 'hmi-tw-apply-svg',
        'hmi-tw-ok-w', 'hmi-tw-warn-w', 'hmi-tw-alarm-w',
        'hmi-tw-ok-s', 'hmi-tw-warn-s', 'hmi-tw-alarm-s',
        'hmi-tw-create-alarm', 'hmi-tw-alarm-sev', 'hmi-tw-alarm-latching', 'hmi-tw-alarm-ack', 'hmi-tw-alarm-msg'
    ].forEach(function (id) {
        const el = byId(id);
        if (!el)
            return;
        el.addEventListener('input', function () {
            return syncTwFromForm();
        });
        el.addEventListener('change', function () {
            return syncTwFromForm();
        });
    });
    byId('hmi-tw-generate')?.addEventListener('click', function () {
        syncTwFromForm();
        const b = (model.bindings || []).find(function (x) {
            return x && x.binding_id === tw.binding_id;
        });
        if (!b) {
            showStatus('Wizard: Binding nicht gefunden', 'error');
            return;
        }
        const src = twSourceInfoFromBinding(b);
        if (!src) {
            showStatus('Wizard: Binding hat keine Source (Sensor/Actuator)', 'error');
            return;
        }
        let warnThr = Number(tw.warn);
        let alarmThr = Number(tw.alarm);
        if (!Number.isFinite(warnThr) || !Number.isFinite(alarmThr)) {
            showStatus('Wizard: Schwellen ungültig', 'error');
            return;
        }
        if (warnThr >= alarmThr) {
            // automatisch tauschen (robust)
            const tmp = warnThr;
            warnThr = alarmThr;
            alarmThr = tmp;
            tw.warn = warnThr;
            tw.alarm = alarmThr;
            showStatus('Wizard: WARN/ALARM Schwellen getauscht (WARN < ALARM)', 'warning');
        }
        const okW = tw.apply_overlay ? twParseClassList(tw.ok_w) : [];
        const warnW = tw.apply_overlay ? twParseClassList(tw.warn_w) : [];
        const alarmW = tw.apply_overlay ? twParseClassList(tw.alarm_w) : [];
        const okS = tw.apply_svg ? twParseClassList(tw.ok_s) : [];
        const warnS = tw.apply_svg ? twParseClassList(tw.warn_s) : [];
        const alarmS = tw.apply_svg ? twParseClassList(tw.alarm_s) : [];
        // Next model
        const next = deepClone(model);
        next.styles = Array.isArray(next.styles) ? next.styles : [];
        next.alarms = Array.isArray(next.alarms) ? next.alarms : [];
        // alte Wizard-Einträge für dieses Binding entfernen (sauber)
        next.styles = next.styles.filter(function (s) {
            return !(s && s.meta && s.meta.generator === 'threshold_wizard' && s.meta.binding_id === tw.binding_id);
        });
        next.alarms = next.alarms.filter(function (a) {
            return !(a && a.meta && a.meta.generator === 'threshold_wizard' && a.meta.binding_id === tw.binding_id);
        });
        // OK (value < warn)
        const stOk = {
            style_id: nowId('s'),
            view_id: viewId,
            target: { binding_id: tw.binding_id },
            when: twCond(src.kind, src.id, src.field, '<', warnThr),
            apply: twMakeApply(okW, [], okS, []),
            priority: 50,
            meta: { generator: 'threshold_wizard', binding_id: tw.binding_id, level: 'ok', warn: warnThr, alarm: alarmThr }
        };
        // WARN (value >= warn) – überlappt mit ALARM; ALARM entfernt WARN-Klassen
        const stWarn = {
            style_id: nowId('s'),
            view_id: viewId,
            target: { binding_id: tw.binding_id },
            when: twCond(src.kind, src.id, src.field, '>=', warnThr),
            apply: twMakeApply(warnW, [], warnS, []),
            priority: 100,
            meta: { generator: 'threshold_wizard', binding_id: tw.binding_id, level: 'warn', warn: warnThr, alarm: alarmThr }
        };
        // ALARM (value >= alarm) – entfernt WARN Klassen (damit rot gewinnt)
        const stAlarm = {
            style_id: nowId('s'),
            view_id: viewId,
            target: { binding_id: tw.binding_id },
            when: twCond(src.kind, src.id, src.field, '>=', alarmThr),
            apply: twMakeApply(alarmW, warnW, // remove overlay warn
            alarmS, warnS // remove svg warn
            ),
            priority: 200,
            meta: { generator: 'threshold_wizard', binding_id: tw.binding_id, level: 'alarm', warn: warnThr, alarm: alarmThr }
        };
        next.styles.push(stOk, stWarn, stAlarm);
        // optional Alarm-Objekt
        if (tw.create_alarm) {
            const al = {
                alarm_id: nowId('a'),
                view_id: viewId,
                source: (src.kind === 'sensor')
                    ? { kind: 'sensor', sensor_id: src.id, field: src.field }
                    : { kind: 'actuator', actuator_id: src.id, field: src.field },
                condition: twCond(src.kind, src.id, src.field, '>=', alarmThr),
                severity: tw.alarm_severity || 'CRITICAL',
                latching: !!tw.alarm_latching,
                ack_required: !!tw.alarm_ack,
                message: String(tw.alarm_message || 'Threshold Alarm'),
                // gezielt auf dieses Binding anwenden:
                target: { binding_id: tw.binding_id },
                // Klassen können ebenfalls gesetzt werden (optional)
                apply: twMakeApply(alarmW, [], alarmS, []),
                // Blink optional über Klassen (in alarmW/alarmS) oder visual
                visual: { blink: true, blink_class: 'hmi-anim-blink' },
                meta: { generator: 'threshold_wizard', binding_id: tw.binding_id, warn: warnThr, alarm: alarmThr }
            };
            next.alarms.push(al);
            ui.selectedAlarmId = al.alarm_id;
        }
        // Fokus: roter Style
        ui.selectedStyleId = stAlarm.style_id;
        commitHmiModel(next, 'threshold_wizard_generate');
        showStatus('Threshold Wizard erzeugt: OK/WARN/ALARM' + (tw.create_alarm ? ' + Alarm' : ''), 'success');
        renderAll();
    });
    // Preview-Buttons (nur wenn Live Preview existiert)
    byId('hmi-tw-preview-warn')?.addEventListener('click', function () {
        if (typeof hmiLiveSetSignalByKey !== 'function') {
            showStatus('Live Preview nicht aktiv', 'warning');
            return;
        }
        const b = (model.bindings || []).find(function (x) {
            return x && x.binding_id === (ui.thresholdWizard && ui.thresholdWizard.binding_id);
        });
        const src = b ? twSourceInfoFromBinding(b) : null;
        if (!src)
            return;
        const key = `${src.kind}:${src.id}:${src.field}`;
        const warnThr = twClampNumber(ui.thresholdWizard.warn, 50);
        hmiLiveSetSignalByKey(key, warnThr + 1);
    });
    byId('hmi-tw-preview-alarm')?.addEventListener('click', function () {
        if (typeof hmiLiveSetSignalByKey !== 'function') {
            showStatus('Live Preview nicht aktiv', 'warning');
            return;
        }
        const b = (model.bindings || []).find(function (x) {
            return x && x.binding_id === (ui.thresholdWizard && ui.thresholdWizard.binding_id);
        });
        const src = b ? twSourceInfoFromBinding(b) : null;
        if (!src)
            return;
        const key = `${src.kind}:${src.id}:${src.field}`;
        const alarmThr = twClampNumber(ui.thresholdWizard.alarm, 80);
        hmiLiveSetSignalByKey(key, alarmThr + 1);
    });
}
function renderStyleList(model, styles) {
    const list = byId('hmi-style-list');
    if (!list)
        return;
    if (!styles.length) {
        list.innerHTML = `<div class="hint-text">Noch keine Styles.</div>`;
        return;
    }
    const rows = styles.map(function (s) {
        const active = ui.selectedStyleId === s.style_id ? 'active' : '';
        return `
      <div class="tr ${active}" style="grid-template-columns: 1.2fr 1fr;">
        <div><button class="btn btn-small btn-secondary" data-style-id="${s.style_id}">${escapeHtml(s.style_id)}</button></div>
        <div>${escapeHtml((s.target && s.target.binding_id) ? s.target.binding_id : '')}</div>
      </div>
    `;
    }).join('');
    list.innerHTML = `<div class="tr th" style="grid-template-columns: 1.2fr 1fr;"><div>ID</div><div>Target</div></div>${rows}`;
    list.querySelectorAll('[data-style-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            ui.selectedStyleId = btn.dataset.styleId;
            renderAll();
        });
    });
}
function renderStyleEditor(model) {
    const ed = byId('hmi-style-editor');
    if (!ed)
        return;
    const sid = ui.selectedStyleId;
    const s = (model.styles || []).find(function (x) {
        return x.style_id === sid;
    });
    if (!s) {
        ed.innerHTML = `<div class="hint-text">Wähle links einen Style.</div>`;
        return;
    }
    const bindings = model.bindings || [];
    const bindOpts = bindings.map(function (b) {
        return `<option value="${b.binding_id}" ${s.target && s.target.binding_id === b.binding_id ? 'selected' : ''}>${escapeHtml(b.binding_id)}</option>`;
    }).join('');
    const ap = s.apply || {};
    const addW = (ap.classes_add_widget || ap.classes_add || []).join(',');
    const remW = (ap.classes_remove_widget || ap.classes_remove || []).join(',');
    const addS = (ap.classes_add_svg || ap.classes_add || []).join(',');
    const remS = (ap.classes_remove_svg || ap.classes_remove || []).join(',');
    ed.innerHTML = `
    <div class="grid-1">
      <div class="form-group">
        <label>ID</label>
        <input class="text-input" value="${escapeAttr(s.style_id)}" disabled/>
      </div>

      <div class="form-group">
        <label>Target Binding</label>
        <select id="hmi-style-target" class="select-input"><option value="">–</option>${bindOpts}</select>
        <div class="hint-text">Welches Widget/SVG soll markiert/animiert werden?</div>
      </div>

      ${renderSimpleConditionEditor('hmi-style-cond', s.when)}

      <div class="grid-2">
        <div class="form-group">
          <label>Overlay: classes_add (CSV)</label>
          <input id="hmi-style-addcls-w" class="text-input" value="${escapeAttr(addW)}"/>
        </div>
        <div class="form-group">
          <label>Overlay: classes_remove (CSV)</label>
          <input id="hmi-style-remcls-w" class="text-input" value="${escapeAttr(remW)}"/>
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>SVG: classes_add (CSV)</label>
          <input id="hmi-style-addcls-s" class="text-input" value="${escapeAttr(addS)}"/>
        </div>
        <div class="form-group">
          <label>SVG: classes_remove (CSV)</label>
          <input id="hmi-style-remcls-s" class="text-input" value="${escapeAttr(remS)}"/>
        </div>
      </div>

      <div class="form-group">
        <label>Priority</label>
        <input id="hmi-style-prio" class="text-input" type="number" value="${escapeAttr(s.priority ?? 100)}"/>
      </div>

      <div class="form-row" style="display:flex; gap:8px;">
        <button id="hmi-style-save" class="btn btn-primary">Speichern</button>
        <button id="hmi-style-del" class="btn btn-danger">Löschen</button>
      </div>
    </div>
  `;
    // Type-Wechsel → neu rendern (für Sensor/Actuator Dropdown)
    const typeEl = byId('hmi-style-cond-type');
    if (typeEl)
        typeEl.addEventListener('change', function () {
            return renderAll();
        });
    byId('hmi-style-save').addEventListener('click', function () {
        const next = deepClone(model);
        const st = next.styles.find(function (x) {
            return x.style_id === sid;
        });
        if (!st)
            return;
        const tgt = byId('hmi-style-target')?.value || '';
        st.target = { binding_id: tgt };
        st.when = readSimpleConditionEditor('hmi-style-cond');
        if (!st.when) {
            showStatus('Condition ungültig', 'error');
            return;
        }
        if (!st.target.binding_id) {
            showStatus('Target Binding fehlt', 'error');
            return;
        }
        const addWidget = csvToList(byId('hmi-style-addcls-w')?.value || '');
        const remWidget = csvToList(byId('hmi-style-remcls-w')?.value || '');
        const addSvg = csvToList(byId('hmi-style-addcls-s')?.value || '');
        const remSvg = csvToList(byId('hmi-style-remcls-s')?.value || '');
        st.apply = st.apply || {};
        st.apply.classes_add_widget = addWidget;
        st.apply.classes_remove_widget = remWidget;
        st.apply.classes_add_svg = addSvg;
        st.apply.classes_remove_svg = remSvg;
        // Backward-Compat
        st.apply.classes_add = uniq([].concat(addWidget, addSvg));
        st.apply.classes_remove = uniq([].concat(remWidget, remSvg));
        st.priority = toIntOrNull(byId('hmi-style-prio')?.value) ?? 100;
        commitHmiModel(next, 'edit_style');
        showStatus('Style gespeichert', 'success');
        renderAll();
    });
    byId('hmi-style-del').addEventListener('click', function () {
        showConfirmation('Diesen visuellen Zustand dauerhaft löschen?', {
            title: 'Zustand löschen',
            confirmLabel: 'Zustand löschen',
            destructive: true,
            detail: 'Widget, Binding und Runtime-Quelle bleiben unverändert erhalten.'
        }, function () {
            const next = deepClone(model);
            next.styles = next.styles.filter(function (style) {
                return style.style_id !== sid;
            });
            ui.selectedStyleId = null;
            commitHmiModel(next, 'delete_style');
            showStatus('Zustand gelöscht', 'success');
            renderAll();
        });
    });
}
function renderAlarmList(model, alarms) {
    const list = byId('hmi-alarm-list');
    if (!list)
        return;
    if (!alarms.length) {
        list.innerHTML = `<div class="hint-text">Noch keine Alarme.</div>`;
        return;
    }
    const rows = alarms.map(function (a) {
        const active = ui.selectedAlarmId === a.alarm_id ? 'active' : '';
        return `
      <div class="tr ${active}" style="grid-template-columns: 1.2fr 1fr;">
        <div><button class="btn btn-small btn-secondary" data-alarm-id="${a.alarm_id}">${escapeHtml(a.alarm_id)}</button></div>
        <div>${escapeHtml(a.severity || '')}</div>
      </div>
    `;
    }).join('');
    list.innerHTML = `<div class="tr th" style="grid-template-columns: 1.2fr 1fr;"><div>ID</div><div>Severity</div></div>${rows}`;
    list.querySelectorAll('[data-alarm-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            ui.selectedAlarmId = btn.dataset.alarmId;
            renderAll();
        });
    });
}
function renderAlarmEditor(model) {
    const ed = byId('hmi-alarm-editor');
    if (!ed)
        return;
    const aid = ui.selectedAlarmId;
    const a = (model.alarms || []).find(function (x) {
        return x.alarm_id === aid;
    });
    if (!a) {
        ed.innerHTML = `<div class="hint-text">Wähle links einen Alarm.</div>`;
        return;
    }
    const bindings = model.bindings || [];
    const bindOpts = bindings.map(function (b) {
        return `<option value="${b.binding_id}">${escapeHtml(b.binding_id)}</option>`;
    }).join('');
    const tgt = (a.target && a.target.binding_id) ? String(a.target.binding_id) : '';
    const vis = (a.visual && typeof a.visual === 'object') ? a.visual : {};
    const blink = !!vis.blink;
    const blinkClass = String(vis.blink_class || 'hmi-anim-blink');
    const ap = (a.apply && typeof a.apply === 'object') ? a.apply : {};
    const addW = (ap.classes_add_widget || ap.classes_add || []).join(',');
    const remW = (ap.classes_remove_widget || ap.classes_remove || []).join(',');
    const addS = (ap.classes_add_svg || ap.classes_add || []).join(',');
    const remS = (ap.classes_remove_svg || ap.classes_remove || []).join(',');
    ed.innerHTML = `
    <div class="grid-1">
      <div class="form-group">
        <label>ID</label>
        <input class="text-input" value="${escapeAttr(a.alarm_id)}" disabled/>
      </div>

      <div class="form-group">
        <label>Source</label>
        ${renderSourceEditor('hmi-alarm-src', a.source)}
      </div>

      ${renderSimpleConditionEditor('hmi-alarm-cond', a.condition)}

      <div class="grid-2">
        <div class="form-group">
          <label>Severity</label>
          <select id="hmi-alarm-sev" class="select-input">
            <option value="INFO" ${a.severity === 'INFO' ? 'selected' : ''}>INFO</option>
            <option value="WARN" ${a.severity === 'WARN' ? 'selected' : ''}>WARN</option>
            <option value="CRITICAL" ${a.severity === 'CRITICAL' ? 'selected' : ''}>CRITICAL</option>
          </select>
        </div>

        <div class="form-group">
          <label>Flags</label>
          <div style="display:flex; gap:12px; align-items:center;">
            <label><input id="hmi-alarm-latching" type="checkbox" ${a.latching ? 'checked' : ''}/> latching</label>
            <label><input id="hmi-alarm-ack" type="checkbox" ${a.ack_required ? 'checked' : ''}/> ack_required</label>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label>Target Binding (optional)</label>
        <select id="hmi-alarm-target" class="select-input">
          <option value="" ${tgt === '' ? 'selected' : ''}>Auto (Source-Match)</option>
          ${bindOpts}
        </select>
        <div class="hint-text">Leer = Alarm trifft Bindings mit gleicher Source. Oder gezielt ein Binding auswählen.</div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label><input id="hmi-alarm-blink" type="checkbox" ${blink ? 'checked' : ''}/> Blink</label>
          <input id="hmi-alarm-blink-class" class="text-input" value="${escapeAttr(blinkClass)}"/>
          <div class="hint-text">z.B. <code>hmi-anim-blink</code></div>
        </div>
        <div class="form-group">
          <label>Message</label>
          <input id="hmi-alarm-msg" class="text-input" value="${escapeAttr(a.message || '')}"/>
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>Overlay: classes_add (CSV)</label>
          <input id="hmi-alarm-addcls-w" class="text-input" value="${escapeAttr(addW)}"/>
        </div>
        <div class="form-group">
          <label>Overlay: classes_remove (CSV)</label>
          <input id="hmi-alarm-remcls-w" class="text-input" value="${escapeAttr(remW)}"/>
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label>SVG: classes_add (CSV)</label>
          <input id="hmi-alarm-addcls-s" class="text-input" value="${escapeAttr(addS)}"/>
        </div>
        <div class="form-group">
          <label>SVG: classes_remove (CSV)</label>
          <input id="hmi-alarm-remcls-s" class="text-input" value="${escapeAttr(remS)}"/>
        </div>
      </div>

      <div class="form-row" style="display:flex; gap:8px;">
        <button id="hmi-alarm-save" class="btn btn-primary">Speichern</button>
        <button id="hmi-alarm-del" class="btn btn-danger">Löschen</button>
      </div>
    </div>
  `;
    bindSourceEditorHandlers('hmi-alarm-src');
    const typeEl = byId('hmi-alarm-cond-type');
    if (typeEl)
        typeEl.addEventListener('change', function () {
            return renderAll();
        });
    byId('hmi-alarm-save').addEventListener('click', function () {
        const next = deepClone(model);
        const al = next.alarms.find(function (x) {
            return x.alarm_id === aid;
        });
        if (!al)
            return;
        al.source = readSourceEditor('hmi-alarm-src');
        al.condition = readSimpleConditionEditor('hmi-alarm-cond');
        al.severity = byId('hmi-alarm-sev')?.value || 'WARN';
        al.latching = byId('hmi-alarm-latching')?.checked ? true : false;
        al.ack_required = byId('hmi-alarm-ack')?.checked ? true : false;
        const t = byId('hmi-alarm-target')?.value || '';
        al.target = { binding_id: t };
        al.visual = al.visual || {};
        al.visual.blink = byId('hmi-alarm-blink')?.checked ? true : false;
        al.visual.blink_class = byId('hmi-alarm-blink-class')?.value || 'hmi-anim-blink';
        al.message = byId('hmi-alarm-msg')?.value || '';
        const addWidget = csvToList(byId('hmi-alarm-addcls-w')?.value || '');
        const remWidget = csvToList(byId('hmi-alarm-remcls-w')?.value || '');
        const addSvg = csvToList(byId('hmi-alarm-addcls-s')?.value || '');
        const remSvg = csvToList(byId('hmi-alarm-remcls-s')?.value || '');
        al.apply = al.apply || {};
        al.apply.classes_add_widget = addWidget;
        al.apply.classes_remove_widget = remWidget;
        al.apply.classes_add_svg = addSvg;
        al.apply.classes_remove_svg = remSvg;
        // Backward-Compat
        al.apply.classes_add = uniq([].concat(addWidget, addSvg));
        al.apply.classes_remove = uniq([].concat(remWidget, remSvg));
        if (!al.source || !al.condition) {
            showStatus('Source/Condition ungültig', 'error');
            return;
        }
        commitHmiModel(next, 'edit_alarm');
        showStatus('Alarm gespeichert', 'success');
        renderAll();
    });
    byId('hmi-alarm-del').addEventListener('click', function () {
        showConfirmation('Diesen Alarm dauerhaft löschen?', {
            title: 'Alarm löschen',
            confirmLabel: 'Alarm löschen',
            destructive: true,
            detail: 'Die zugrunde liegende Datenbindung und das Zielobjekt bleiben erhalten.'
        }, function () {
            const next = deepClone(model);
            next.alarms = next.alarms.filter(function (alarm) {
                return alarm.alarm_id !== aid;
            });
            ui.selectedAlarmId = null;
            commitHmiModel(next, 'delete_alarm');
            showStatus('Alarm gelöscht', 'success');
            renderAll();
        });
    });
}
// ------------------------- Simple Condition Editor -------------------------
//
// WICHTIG: Diese beiden Funktionen dürfen in hmi.js NUR EINMAL existieren.
// Wenn du "redeclaration ..." bekommst, hast du sie doppelt im File.
//
let __hmiCondDelegateInstalled = false;
function installConditionEditorDelegation() {
    if (__hmiCondDelegateInstalled)
        return;
    __hmiCondDelegateInstalled = true;
    document.addEventListener('change', function (ev) {
        const t = ev && ev.target ? ev.target : null;
        if (!t || !t.id)
            return;
        if (!t.id.endsWith('-type'))
            return;
        const prefix = t.id.slice(0, -('-type'.length));
        updateConditionEditorVisibility(prefix);
    });
}
function updateConditionEditorVisibility(prefix) {
    const typeEl = byId(prefix + '-type');
    const type = typeEl ? (typeEl.value || 'sensor_cmp') : 'sensor_cmp';
    const sWrap = byId(prefix + '-sensor-wrap');
    const aWrap = byId(prefix + '-actuator-wrap');
    if (sWrap)
        sWrap.style.display = (type === 'sensor_cmp') ? '' : 'none';
    if (aWrap)
        aWrap.style.display = (type === 'actuator_cmp') ? '' : 'none';
}
function renderSimpleConditionEditor(prefix, cond) {
    installConditionEditorDelegation();
    const c = cond || { type: 'sensor_cmp', sensor_id: 1, field: 'value', op: '>=', value: 100 };
    const type = String(c.type || 'sensor_cmp');
    const op = String(c.op || '>=');
    const val = (c.value ?? 100);
    const sensors = getAvailableSensors();
    const acts = getAvailableActuators();
    const sensorOpts = sensors.map(function (s) {
        return `<option value="${s.sensor_id}" ${(toIntOrNull(c.sensor_id) === s.sensor_id) ? 'selected' : ''}>${escapeHtml(s.label)}</option>`;
    }).join('');
    const actOpts = acts.map(function (a) {
        return `<option value="${a.actuator_id}" ${(toIntOrNull(c.actuator_id) === a.actuator_id) ? 'selected' : ''}>${escapeHtml(a.label)}</option>`;
    }).join('');
    const fieldA = String(c.field || 'value');
    const sensorWrapStyle = (type === 'sensor_cmp') ? '' : 'display:none';
    const actuatorWrapStyle = (type === 'actuator_cmp') ? '' : 'display:none';
    return `
    <div class="grid-3" id="${prefix}-root">
      <div class="form-group">
        <label>Type</label>
        <select id="${prefix}-type" class="select-input">
          <option value="sensor_cmp" ${type === 'sensor_cmp' ? 'selected' : ''}>sensor_cmp</option>
          <option value="actuator_cmp" ${type === 'actuator_cmp' ? 'selected' : ''}>actuator_cmp</option>
        </select>
      </div>

      <div class="form-group">
        <label>Quelle</label>

        <div id="${prefix}-sensor-wrap" style="${sensorWrapStyle}">
          <div class="grid-2">
            <select id="${prefix}-sensor-id" class="select-input"><option value="">–</option>${sensorOpts}</select>
            <select id="${prefix}-sensor-field" class="select-input" disabled>
              <option value="value" selected>value</option>
            </select>
          </div>
        </div>

        <div id="${prefix}-actuator-wrap" style="${actuatorWrapStyle}">
          <div class="grid-2">
            <select id="${prefix}-actuator-id" class="select-input"><option value="">–</option>${actOpts}</select>
            <select id="${prefix}-actuator-field" class="select-input">
              <option value="value" ${fieldA === 'value' ? 'selected' : ''}>value</option>
              <option value="last_state" ${fieldA === 'last_state' ? 'selected' : ''}>last_state</option>
            </select>
          </div>
        </div>

        <div class="hint-text">Type umschalten → passende ID-Auswahl erscheint.</div>
      </div>

      <div class="form-group">
        <label>Op / Value</label>
        <div class="grid-2">
          <select id="${prefix}-op" class="select-input">
            <option value=">=" ${op === '>=' ? 'selected' : ''}>&ge;</option>
            <option value=">"  ${op === '>' ? 'selected' : ''}>&gt;</option>
            <option value="<=" ${op === '<=' ? 'selected' : ''}>&le;</option>
            <option value="<"  ${op === '<' ? 'selected' : ''}>&lt;</option>
            <option value="==" ${op === '==' ? 'selected' : ''}>=</option>
            <option value="!=" ${op === '!=' ? 'selected' : ''}>≠</option>
          </select>
          <input id="${prefix}-value" class="text-input" value="${escapeAttr(val)}" />
        </div>
      </div>
    </div>
  `;
}
function readSimpleConditionEditor(prefix) {
    const type = byId(prefix + '-type')?.value || 'sensor_cmp';
    const op = byId(prefix + '-op')?.value || '>=';
    const vraw = byId(prefix + '-value')?.value || '';
    const n = Number(vraw);
    if (!Number.isFinite(n))
        return null;
    if (type === 'sensor_cmp') {
        const sid = toIntOrNull(byId(prefix + '-sensor-id')?.value);
        if (sid === null)
            return null;
        return { type: 'sensor_cmp', sensor_id: sid, field: 'value', op: op, value: n };
    }
    if (type === 'actuator_cmp') {
        const aid = toIntOrNull(byId(prefix + '-actuator-id')?.value);
        if (aid === null)
            return null;
        const field = byId(prefix + '-actuator-field')?.value || 'value';
        return { type: 'actuator_cmp', actuator_id: aid, field: field, op: op, value: n };
    }
    return null;
}
// ------------------------- Simple Condition Editor -------------------------
/* function renderSimpleConditionEditor(prefix, cond) {
  const c = cond || { type: 'sensor_cmp', sensor_id: 1, field: 'value', op: '>=', value: 80 };

  const sensors = getAvailableSensors();
  const acts = getAvailableActuators();

  const type = String(c.type || 'sensor_cmp');

  const sensorOpts = sensors.map(s =>
    `<option value="${s.sensor_id}" ${toIntOrNull(c.sensor_id) === s.sensor_id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`
  ).join('');

  const actOpts = acts.map(a =>
    `<option value="${a.actuator_id}" ${toIntOrNull(c.actuator_id) === a.actuator_id ? 'selected' : ''}>${escapeHtml(a.label)}</option>`
  ).join('');

  const op = String(c.op || '>=');
  const val = (c.value ?? 80);

  const field = String(c.field || 'value');

  const fieldSel = (type === 'actuator_cmp')
    ? `
      <select id="${prefix}-field" class="select-input">
        <option value="value" ${field === 'value' ? 'selected' : ''}>value</option>
        <option value="last_state" ${field === 'last_state' ? 'selected' : ''}>last_state</option>
      </select>
    `
    : `
      <select id="${prefix}-field" class="select-input">
        <option value="value" selected>value</option>
      </select>
    `;

  const idSel = (type === 'actuator_cmp')
    ? `<select id="${prefix}-id" class="select-input"><option value="">–</option>${actOpts}</select>`
    : `<select id="${prefix}-id" class="select-input"><option value="">–</option>${sensorOpts}</select>`;

  return `
    <div class="grid-3" id="${prefix}-root">
      <div class="form-group">
        <label>Type</label>
        <select id="${prefix}-type" class="select-input">
          <option value="sensor_cmp" ${type === 'sensor_cmp' ? 'selected' : ''}>sensor_cmp</option>
          <option value="actuator_cmp" ${type === 'actuator_cmp' ? 'selected' : ''}>actuator_cmp</option>
        </select>
      </div>

      <div class="form-group">
        <label>Quelle</label>
        <div class="grid-2">
          ${idSel}
          ${fieldSel}
        </div>
      </div>

      <div class="form-group">
        <label>Op / Value</label>
        <div class="grid-2">
          <select id="${prefix}-op" class="select-input">
            <option value=">=" ${op === '>=' ? 'selected' : ''}>&ge;</option>
            <option value=">" ${op === '>' ? 'selected' : ''}>&gt;</option>
            <option value="<=" ${op === '<=' ? 'selected' : ''}>&le;</option>
            <option value="<" ${op === '<' ? 'selected' : ''}>&lt;</option>
            <option value="==" ${op === '==' ? 'selected' : ''}>=</option>
            <option value="!=" ${op === '!=' ? 'selected' : ''}>≠</option>
          </select>
          <input id="${prefix}-value" class="text-input" value="${escapeAttr(val)}" />
        </div>
      </div>
    </div>
  `;
} */
/* function readSimpleConditionEditor(prefix) {
  const type = byId(prefix + '-type')?.value || 'sensor_cmp';
  const idRaw = byId(prefix + '-id')?.value || '';
  const field = byId(prefix + '-field')?.value || 'value';
  const op = byId(prefix + '-op')?.value || '>=';
  const vraw = byId(prefix + '-value')?.value || '';
  const n = Number(vraw);

  const idNum = toIntOrNull(idRaw);
  if (idNum === null) return null;
  if (!Number.isFinite(n)) return null;

  if (type === 'sensor_cmp') return { type: 'sensor_cmp', sensor_id: idNum, field: 'value', op: op, value: n };
  if (type === 'actuator_cmp') return { type: 'actuator_cmp', actuator_id: idNum, field: field, op: op, value: n };

  return null;
}


function readSimpleConditionEditor(prefix) {
  const type = byId(prefix + '-type')?.value || 'sensor_cmp';
  const sid = toIntOrNull(byId(prefix + '-sensor')?.value);
  const op = byId(prefix + '-op')?.value || '>=';
  const vraw = byId(prefix + '-value')?.value || '';
  const n = Number(vraw);

  if (type !== 'sensor_cmp') return null;
  if (sid === null) return null;
  if (!Number.isFinite(n)) return null;

  return { type: 'sensor_cmp', sensor_id: sid, op: op, value: n };
} */
function csvToList(s) {
    return String(s || '')
        .split(',')
        .map(function (x) {
        return x.trim();
    })
        .filter(Boolean);
}
// ------------------------- Escaping -------------------------
function escapeHtml(s) {
    // V52-Fix (B-8): `String(s || '')` machte aus der Zahl 0 einen Leerstring.
    // Betroffen waren u. a. dx/dy, decimals, offset, priority, Schwellenwerte
    // und Condition-Werte — alle wurden im Formular als leeres Feld gerendert
    // und beim Speichern auf den Default zurueckgesetzt.
    return String(s === null || s === undefined ? '' : s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
function escapeAttr(s) {
    return escapeHtml(s).replaceAll('\n', ' ');
}
// ------------------------- Init -------------------------
function init() {
    ui.container = byId('hmi-ui-panel');
    if (!ui.container) {
        console.warn('HMI Designer: #hmi-ui-panel nicht gefunden');
        return;
    }
    ensureHmiModel();
    // UI re-render
    state.on('history:restored', function () {
        return renderAll();
    });
    state.on('elements:rebuilt', function () {
        return renderAll();
    });
    state.on('devices:updated', function () {
        return renderAll();
    });
    state.on('selection:changed', function (selectedIds) {
        const select = byId('hmi-quick-element');
        const source = Array.isArray(selectedIds) ? selectedIds : [];
        if (!select || source.length !== 1)
            return;
        const elementId = String(source[0] || '');
        const optionExists = Array.from(select.options).some(function (option) {
            return option.value === elementId;
        });
        if (optionExists)
            select.value = elementId;
    });
    document.addEventListener('plant:hmi-open-subtab', function (event) {
        const detail = event && event.detail && typeof event.detail === 'object'
            ? event.detail
            : {};
        switchHmiWorkflowStep(detail.subtab || 'widgets');
    });
    // Overlay engine
    installHmiOverlayHooks();
    renderAll();
    console.log('✓ HMI/SCADA Designer geladen (hmi.js)');
}
init();
