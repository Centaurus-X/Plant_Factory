/**
 * core.js - Kern-Funktionalität und API-Kommunikation
 *
 * Zuständigkeiten:
 * - API-Kommunikation mit Backend
 * - Event-System
 * - Utilities und Helper-Funktionen
 * - Zustandsverwaltung
 */
import { emptyAutomationConfig } from './automation_contract.js';
import { createEmptyLogicModel } from './logic_core.js';
// ============================================================================
// API-Client
// ============================================================================
// ============================================================================
// API-Client
// ============================================================================
function createAPIClient(baseURL = '') {
    const self = {};
    self.request = async function (url, options = {}) {
        const response = await fetch(self.baseURL + url, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`);
        }
        const ct = response.headers.get('content-type') || '';
        return ct.includes('application/json') ? response.json() : response.text();
    };
    self.get = async function (url) {
        return self.request(url, { method: 'GET' });
    };
    self.post = async function (url, data) {
        return self.request(url, { method: 'POST', body: JSON.stringify(data || {}) });
    };
    self.getTemplates = async function () {
        return self.get('/api/templates');
    };
    self.uploadTemplate = async function (dateiname, svg, metadaten) {
        return self.post('/api/template/hochladen', { dateiname, svg, metadaten });
    };
    self.reloadTemplates = async function () {
        return self.post('/api/templates/neu-laden', {});
    };
    self.saveProjekt = async function (name, svg, metadaten) {
        return self.post('/api/speichern', { name, svg, metadaten });
    };
    self.loadProjekt = async function (name) {
        return self.get(`/api/laden?name=${encodeURIComponent(name)}`);
    };
    self.listProjekte = async function () {
        return self.get('/api/projekte');
    };
    self.exportSVG = async function (svg, dateiname = 'anlage.svg') {
        return self.post('/api/exportieren', { svg, dateiname });
    };
    self.saveProject = async function (name, metadaten) {
        const md = (metadaten && typeof metadaten === 'object') ? metadaten : {};
        // ui.js legt svgContent in metadaten ab → wir nutzen das als svg payload
        const svg = (typeof md.svg === 'string' && md.svg.trim() !== '') ? md.svg
            : (typeof md.svgContent === 'string' ? md.svgContent : '');
        return self.saveProjekt(name, svg, md);
    };
    self.loadProject = async function (name) {
        const res = await self.loadProjekt(name);
        // robust gegen verschiedene Backend-Wrapper
        if (!res || typeof res !== 'object')
            return res;
        if (res.metadaten && typeof res.metadaten === 'object')
            return res.metadaten;
        if (res.projekt && typeof res.projekt === 'object')
            return res.projekt;
        if (res.project && typeof res.project === 'object')
            return res.project;
        if (res.data && typeof res.data === 'object')
            return res.data;
        return res;
    };
    self.getDeviceConfig = async function () {
        return self.get('/api/device-config');
    };
    self.getRuleLibrary = async function () {
        return self.get('/api/rule-library');
    };
    self.saveRuleLibrary = async function (ruleLibrary) {
        return self.post('/api/rule-library', { rule_library: ruleLibrary });
    };
    self.getProcessLibrary = async function () {
        return self.get('/api/process-library');
    };
    self.saveProcessLibrary = async function (processLibrary) {
        return self.post('/api/process-library', { process_library: processLibrary });
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.baseURL = baseURL;
    return self;
}
// ============================================================================
// Event-Bus für lose gekoppelte Kommunikation
// ============================================================================
function createEventBus() {
    const self = {};
    self.on = function (event, callback) {
        if (!self.listeners[event]) {
            self.listeners[event] = [];
        }
        self.listeners[event].push(callback);
    };
    self.off = function (event, callback) {
        if (!self.listeners[event])
            return;
        self.listeners[event] = self.listeners[event].filter(function (cb) {
            return cb !== callback;
        });
    };
    self.emit = function (event, data) {
        if (!self.listeners[event])
            return;
        self.listeners[event].forEach(function (callback) {
            try {
                callback(data);
            }
            catch (error) {
                console.error(`Fehler in Event-Handler für '${event}':`, error);
            }
        });
    };
    self.once = function (event, callback) {
        const wrappedCallback = function (data) {
            callback(data);
            self.off(event, wrappedCallback);
        };
        self.on(event, wrappedCallback);
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.listeners = {};
    return self;
}
function defaultAutomationModel() {
    return emptyAutomationConfig();
}
function defaultLogicModel() {
    return createEmptyLogicModel();
}

function defaultPlantDrawingModel() {
    return {
        schema: 'plant-factory.plant-drawing',
        version: 1,
        active_sheet_id: 'sheet_main',
        sheets: [{
                sheet_id: 'sheet_main',
                name: 'Anlagenskizze',
                width: 1600,
                height: 1000,
                grid: 10,
                entities: [],
                connections: [],
                primitives: []
            }],
        custom_templates: []
    };
}
// ============================================================================
// Zustandsverwaltung
// ============================================================================
function createAppState() {
    const self = {};
    self.get = function (key) {
        return self.state[key];
    };
    self.set = function (key, value) {
        const oldValue = self.state[key];
        self.state[key] = value;
        self.eventBus.emit('state:changed', { key, oldValue, newValue: value });
        self.eventBus.emit(`state:${key}`, value);
    };
    self.setSilent = function (key, value) {
        const oldValue = self.state[key];
        self.state[key] = value;
        self.eventBus.emit(`state:${key}`, value);
        return oldValue;
    };
    self.update = function (updates) {
        Object.keys(updates).forEach(function (key) { self.set(key, updates[key]); });
    };
    self.subscribe = function (key, callback) {
        self.eventBus.on(`state:${key}`, callback);
    };
    self.on = function (event, callback) {
        self.eventBus.on(event, callback);
    };
    self.emit = function (event, data) {
        self.eventBus.emit(event, data);
    };
    self.saveHistory = function () {
        const snapshot = {
            elements: JSON.parse(JSON.stringify(self.state.elements)),
            connections: JSON.parse(JSON.stringify(self.state.connections)),
            devices: JSON.parse(JSON.stringify(self.state.devices)),
            hmi: JSON.parse(JSON.stringify(self.state.hmi)),
            dynamic_rule_engine: JSON.parse(JSON.stringify(self.state.dynamic_rule_engine)),
            ruleLibrary: JSON.parse(JSON.stringify(self.state.ruleLibrary)),
            processes: JSON.parse(JSON.stringify(self.state.processes)),
            processLibrary: JSON.parse(JSON.stringify(self.state.processLibrary)),
            automation_cfg: JSON.parse(JSON.stringify(self.state.automation_cfg || defaultAutomationModel())),
            logic: JSON.parse(JSON.stringify(self.state.logic || defaultLogicModel())),
            plant_drawing: JSON.parse(JSON.stringify(self.state.plant_drawing || defaultPlantDrawingModel())),
            // ✅ NEU
            free_rules: JSON.parse(JSON.stringify(self.state.free_rules)),
        };
        self.state.history = self.state.history.slice(0, self.state.historyIndex + 1);
        self.state.history.push(snapshot);
        self.state.historyIndex++;
        if (self.state.history.length > 50) {
            self.state.history.shift();
            self.state.historyIndex--;
        }
        /* this.set('isDirty', true); */
        if (!self.state.isDirty)
            self.setSilent('isDirty', true);
        // ✅ optional, aber empfohlen:
        self.eventBus.emit('state:historyIndex', self.state.historyIndex);
    };
    self.undo = function () {
        if (self.state.historyIndex > 0) {
            self.state.historyIndex--;
            const s = self.state.history[self.state.historyIndex];
            self.state.elements = JSON.parse(JSON.stringify(s.elements));
            self.state.connections = JSON.parse(JSON.stringify(s.connections));
            self.state.devices = JSON.parse(JSON.stringify(s.devices));
            self.state.hmi = JSON.parse(JSON.stringify(s.hmi));
            self.state.dynamic_rule_engine = JSON.parse(JSON.stringify(s.dynamic_rule_engine));
            self.state.ruleLibrary = JSON.parse(JSON.stringify(s.ruleLibrary));
            self.state.processes = JSON.parse(JSON.stringify(s.processes));
            self.state.processLibrary = JSON.parse(JSON.stringify(s.processLibrary));
            self.state.automation_cfg = JSON.parse(JSON.stringify(s.automation_cfg || defaultAutomationModel()));
            self.state.logic = JSON.parse(JSON.stringify(s.logic || defaultLogicModel()));
            self.state.plant_drawing = JSON.parse(JSON.stringify(s.plant_drawing || defaultPlantDrawingModel()));
            // ✅ NEU mit Fallback für alte Snapshots
            self.state.free_rules = JSON.parse(JSON.stringify(s.free_rules || { version: 1, timers: [], triggers: [], actions: [], transitions: [], events: [] }));
            self.eventBus.emit('history:restored');
            // ✅ empfohlen:
            self.eventBus.emit('state:elements', self.state.elements);
            self.eventBus.emit('state:connections', self.state.connections);
            self.eventBus.emit('state:devices', self.state.devices);
            self.eventBus.emit('state:hmi', self.state.hmi);
            self.eventBus.emit('state:dynamic_rule_engine', self.state.dynamic_rule_engine);
            self.eventBus.emit('state:ruleLibrary', self.state.ruleLibrary);
            self.eventBus.emit('state:processes', self.state.processes);
            self.eventBus.emit('state:processLibrary', self.state.processLibrary);
            self.eventBus.emit('state:automation_cfg', self.state.automation_cfg);
            self.eventBus.emit('state:logic', self.state.logic);
            self.eventBus.emit('state:plant_drawing', self.state.plant_drawing);
            self.eventBus.emit('state:free_rules', self.state.free_rules);
            self.eventBus.emit('state:historyIndex', self.state.historyIndex);
        }
    };
    self.redo = function () {
        if (self.state.historyIndex < self.state.history.length - 1) {
            self.state.historyIndex++;
            const s = self.state.history[self.state.historyIndex];
            self.state.elements = JSON.parse(JSON.stringify(s.elements));
            self.state.connections = JSON.parse(JSON.stringify(s.connections));
            self.state.devices = JSON.parse(JSON.stringify(s.devices));
            self.state.hmi = JSON.parse(JSON.stringify(s.hmi));
            self.state.dynamic_rule_engine = JSON.parse(JSON.stringify(s.dynamic_rule_engine));
            self.state.ruleLibrary = JSON.parse(JSON.stringify(s.ruleLibrary));
            self.state.processes = JSON.parse(JSON.stringify(s.processes));
            self.state.processLibrary = JSON.parse(JSON.stringify(s.processLibrary));
            self.state.automation_cfg = JSON.parse(JSON.stringify(s.automation_cfg || defaultAutomationModel()));
            self.state.logic = JSON.parse(JSON.stringify(s.logic || defaultLogicModel()));
            self.state.plant_drawing = JSON.parse(JSON.stringify(s.plant_drawing || defaultPlantDrawingModel()));
            // ✅ NEU mit Fallback für alte Snapshots
            self.state.free_rules = JSON.parse(JSON.stringify(s.free_rules || { version: 1, timers: [], triggers: [], actions: [], transitions: [], events: [] }));
            self.eventBus.emit('history:restored');
            // ✅ empfohlen:
            self.eventBus.emit('state:elements', self.state.elements);
            self.eventBus.emit('state:connections', self.state.connections);
            self.eventBus.emit('state:devices', self.state.devices);
            self.eventBus.emit('state:hmi', self.state.hmi);
            self.eventBus.emit('state:dynamic_rule_engine', self.state.dynamic_rule_engine);
            self.eventBus.emit('state:ruleLibrary', self.state.ruleLibrary);
            self.eventBus.emit('state:processes', self.state.processes);
            self.eventBus.emit('state:processLibrary', self.state.processLibrary);
            self.eventBus.emit('state:automation_cfg', self.state.automation_cfg);
            self.eventBus.emit('state:logic', self.state.logic);
            self.eventBus.emit('state:plant_drawing', self.state.plant_drawing);
            self.eventBus.emit('state:free_rules', self.state.free_rules);
            self.eventBus.emit('state:historyIndex', self.state.historyIndex);
        }
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.state = {
        projektName: 'Unbenannt',
        currentTool: 'select',
        zoom: 1.0,
        pan: { x: 0, y: 0 },
        // V55.1: Raster und Einrasten sind beim Start an. Eine leere weisse
        // Flaeche ohne Bezug ist fuer ein Zeichenwerkzeug kein sinnvoller
        // Ausgangszustand; das Markup traegt die Schalter passend als aktiv.
        gridEnabled: true,
        snapEnabled: true,
        selectedElements: [],
        elements: [],
        connections: [],
        // Device/IO-Bindings (neu)
        devices: { version: 1, assignments: {} },
        // HMI-UI including the additive V64 event-animation contract.
        hmi: {
            version: 2,
            active_view_id: 'main',
            views: [{ view_id: 'main', name: 'Main', svg_ref: 'main', tags: ['default'] }],
            widgets: [],
            bindings: [],
            styles: [],
            alarms: [],
            event_animations: []
        },
        // Additive construction workspace; runtime truth remains elements/connections.
        plant_drawing: defaultPlantDrawingModel(),
        // Free Rules (Timer/Trigger/Action/Transition/Event)
        free_rules: { version: 1, timers: [], triggers: [], actions: [], transitions: [], events: [] },
        // Rules
        dynamic_rule_engine: { rule_sets: [] },
        ruleLibrary: { rule_sets: [] },
        // Processes
        processes: { process_states: [] },
        processLibrary: { process_states: [] },
        // Automation (Projekt-Konfiguration)
        automation_cfg: defaultAutomationModel(),
        // PF-LOGIC-V1 (additive canonical logic diagrams)
        logic: defaultLogicModel(),
        // Config-Snapshot
        deviceConfig: null,
        history: [],
        historyIndex: -1,
        isDirty: false
    };
    self.eventBus = createEventBus();
    return self;
}
// ============================================================================
// Utility-Funktionen
// ============================================================================
const Utils = {
    // Eindeutige ID generieren
    generateId: function () {
        return 'el_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },
    // SVG-Koordinaten aus Maus-Event
    getSVGCoordinates: function (svg, event) {
        const pt = svg.createSVGPoint();
        pt.x = event.clientX;
        pt.y = event.clientY;
        const ctm = svg.getScreenCTM();
        if (ctm) {
            const transformed = pt.matrixTransform(ctm.inverse());
            return { x: transformed.x, y: transformed.y };
        }
        return { x: event.clientX, y: event.clientY };
    },
    // Punkt auf Raster einrasten
    snapToGrid: function (value, gridSize = 20) {
        return Math.round(value / gridSize) * gridSize;
    },
    // Distanz zwischen zwei Punkten
    distance: function (p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    },
    // Rechteck-Kollision
    rectIntersects: function (r1, r2) {
        return !(r1.x + r1.width < r2.x ||
            r2.x + r2.width < r1.x ||
            r1.y + r1.height < r2.y ||
            r2.y + r2.height < r1.y);
    },
    // Element-Bounds berechnen
    getElementBounds: function (element) {
        try {
            const bbox = element.getBBox();
            return {
                x: bbox.x,
                y: bbox.y,
                width: bbox.width,
                height: bbox.height
            };
        }
        catch (e) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
    },
    // Formatierung
    formatFileSize: function (bytes) {
        if (bytes === 0)
            return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    formatDate: function (timestamp) {
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },
    // Debounce-Funktion
    debounce: function (func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = function () {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    // Throttle-Funktion
    throttle: function (func, limit) {
        let inThrottle;
        return function (...args) {
            if (!inThrottle) {
                func.apply(self, args);
                inThrottle = true;
                setTimeout(function () {
                    return inThrottle = false;
                }, limit);
            }
        };
    },
    // SVG zu Blob
    svgToBlob: function (svgString) {
        return new Blob([svgString], { type: 'image/svg+xml' });
    },
    // Download-Trigger
    downloadFile: function (blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
// ============================================================================
// Globale Instanzen exportieren
// ============================================================================
export const api = createAPIClient();
export const state = createAppState();
export const utils = Utils;
// Keep delayed resets from overwriting newer status messages.
let statusMessageRevision = 0;

export function showStatus(message, type = 'info', duration = 3000) {
    const revision = statusMessageRevision + 1;
    statusMessageRevision = revision;
    const statusEl = document.getElementById('status-message');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `status-${type}`;
        if (duration > 0) {
            setTimeout(function () {
                if (revision !== statusMessageRevision) return;
                statusEl.textContent = 'Bereit';
                statusEl.className = '';
            }, duration);
        }
    }
}
// Fehlerbehandlung
export function handleError(error, userMessage = 'Ein Fehler ist aufgetreten') {
    console.error(error);
    showStatus(userMessage, 'error', 5000);
}
console.log('✓ Core-Modul geladen');
// ============================================================================
// --- STABILER VIEWPORT-PATCH (Zoom zum Cursor + Ctrl-Pan; mit State-Spiegelung) ---
// ============================================================================
(function installViewportFixV2() {
    if (window.__viewportFixV2Installed)
        return;
    window.__viewportFixV2Installed = true;
    const svg = document.getElementById('main-canvas');
    const elementsLayer = document.getElementById('elements-layer');
    const connectionsLayer = document.getElementById('connections-layer');
    if (!svg || !elementsLayer || !connectionsLayer)
        return;
    // alte Wheel-Handler deaktivieren (wir übernehmen vollständig)
    svg.onwheel = null;
    // ------------------------------------------------------------------------
    // Initiale View aus AppState ziehen (KEIN window.state-Gate!)
    // ------------------------------------------------------------------------
    function readStateView() {
        try {
            if (!(state && typeof state.get === 'function')) {
                return { zoom: 1, panX: 0, panY: 0 };
            }
            const v = state.get('view') || {};
            const zView = Number(v.zoom);
            const pxView = Number(v.panX);
            const pyView = Number(v.panY);
            const zState = Number(state.get('zoom'));
            const p = state.get('pan') || {};
            const pxState = Number(p.x);
            const pyState = Number(p.y);
            return {
                zoom: Number.isFinite(zView) && zView > 0 ? zView : (Number.isFinite(zState) && zState > 0 ? zState : 1),
                panX: Number.isFinite(pxView) ? pxView : (Number.isFinite(pxState) ? pxState : 0),
                panY: Number.isFinite(pyView) ? pyView : (Number.isFinite(pyState) ? pyState : 0),
            };
        }
        catch (_) {
            return { zoom: 1, panX: 0, panY: 0 };
        }
    }
    const init = readStateView();
    const view = {
        zoom: init.zoom,
        panX: init.panX,
        panY: init.panY,
        min: 0.1,
        max: 5.0
    };
    // ------------------------------------------------------------------------
    // State Sync / Loop Guards
    // ------------------------------------------------------------------------
    let isSyncingToState = false;
    let syncRAF = 0;
    let pullRAF = 0;
    function syncStateImmediate() {
        if (!(state && typeof state.set === 'function' && typeof state.get === 'function'))
            return;
        isSyncingToState = true;
        try {
            // Spiegelwerte für Alt-Code (Drag/Overlay/Koordinatenanzeige)
            state.set('zoom', view.zoom);
            state.set('pan', { x: view.panX, y: view.panY });
            // Neue Struktur (optional)
            const old = state.get('view') || {};
            state.set('view', { ...old, zoom: view.zoom, panX: view.panX, panY: view.panY });
        }
        finally {
            isSyncingToState = false;
        }
    }
    function syncStateDebounced() {
        if (!(state && typeof state.set === 'function'))
            return;
        cancelAnimationFrame(syncRAF);
        syncRAF = requestAnimationFrame(syncStateImmediate);
    }
    function applyViewNoState() {
        const tf = `translate(${view.panX} ${view.panY}) scale(${view.zoom})`;
        elementsLayer.setAttribute('transform', tf);
        connectionsLayer.setAttribute('transform', tf);
    }
    function applyView() {
        applyViewNoState();
        syncStateImmediate();
        syncStateDebounced();
    }
    function clampZoom(z) {
        if (!Number.isFinite(z) || z <= 0)
            return view.zoom;
        return Math.min(view.max, Math.max(view.min, z));
    }
    function pullFromState() {
        const s = readStateView();
        view.zoom = clampZoom(s.zoom);
        view.panX = Number.isFinite(s.panX) ? s.panX : view.panX;
        view.panY = Number.isFinite(s.panY) ? s.panY : view.panY;
    }
    function schedulePullFromState() {
        if (isSyncingToState)
            return;
        cancelAnimationFrame(pullRAF);
        pullRAF = requestAnimationFrame(function () {
            if (isSyncingToState)
                return;
            pullFromState();
            applyViewNoState();
        });
    }
    if (state && typeof state.subscribe === 'function') {
        state.subscribe('zoom', schedulePullFromState);
        state.subscribe('pan', schedulePullFromState);
        state.subscribe('view', schedulePullFromState);
    }
    // ------------------------------------------------------------------------
    // Hilfen: Screen → Local (SVG-Koords)
    // ------------------------------------------------------------------------
    function screenToLocal(node, sx, sy) {
        const m = node && node.getScreenCTM && node.getScreenCTM();
        if (!m || !svg.createSVGPoint)
            return { x: sx, y: sy };
        const pt = svg.createSVGPoint();
        pt.x = sx;
        pt.y = sy;
        const p = pt.matrixTransform(m.inverse());
        return { x: p.x, y: p.y };
    }
    // ------------------------------------------------------------------------
    // Zoom am Screen-Punkt (Matrix-korrekt, cursor-stabil)
    // factor > 1 => zoom in, factor < 1 => zoom out
    // ------------------------------------------------------------------------
    function zoomAtScreenPoint(sx, sy, factor) {
        const f = Number(factor);
        if (!Number.isFinite(f) || f <= 0)
            return;
        const next = clampZoom(view.zoom * f);
        if (next === view.zoom)
            return;
        const parentAnchor = screenToLocal(svg, sx, sy);
        const localAnchor = screenToLocal(elementsLayer, sx, sy);
        view.panX = parentAnchor.x - (localAnchor.x * next);
        view.panY = parentAnchor.y - (localAnchor.y * next);
        view.zoom = next;
        applyView();
    }
    function zoomAtSvgCenter(factor) {
        const rect = svg.getBoundingClientRect();
        const cx = rect.left + (rect.width / 2);
        const cy = rect.top + (rect.height / 2);
        zoomAtScreenPoint(cx, cy, factor);
    }
    function resetView() {
        view.zoom = 1;
        view.panX = 0;
        view.panY = 0;
        applyView();
    }
    function unionBounds(first, second) {
        if (!first)
            return second;
        if (!second)
            return first;
        const left = Math.min(first.x, second.x);
        const top = Math.min(first.y, second.y);
        const right = Math.max(first.x + first.width, second.x + second.width);
        const bottom = Math.max(first.y + first.height, second.y + second.height);
        return { x: left, y: top, width: right - left, height: bottom - top };
    }
    function measurableBounds(node) {
        try {
            const box = node && node.getBBox ? node.getBBox() : null;
            if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)
                || !Number.isFinite(box.width) || !Number.isFinite(box.height)
                || box.width <= 0 || box.height <= 0)
                return null;
            return { x: box.x, y: box.y, width: box.width, height: box.height };
        }
        catch (error) {
            return null;
        }
    }
    function fitContent(padding) {
        const container = document.getElementById('canvas-container');
        const bounds = unionBounds(measurableBounds(elementsLayer), measurableBounds(connectionsLayer));
        if (!container || !bounds) {
            resetView();
            return false;
        }
        const requestedPadding = Number(padding);
        const inset = Number.isFinite(requestedPadding)
            ? Math.max(24, requestedPadding)
            : 72;
        const availableWidth = Math.max(1, container.clientWidth - (inset * 2));
        const availableHeight = Math.max(1, container.clientHeight - (inset * 2));
        const fittedZoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height, 1.35);
        view.zoom = clampZoom(fittedZoom);
        view.panX = ((container.clientWidth - (bounds.width * view.zoom)) / 2)
            - (bounds.x * view.zoom);
        view.panY = ((container.clientHeight - (bounds.height * view.zoom)) / 2)
            - (bounds.y * view.zoom);
        applyView();
        return true;
    }
    // ------------------------------------------------------------------------
    // Public API für andere Module (Buttons, etc.)
    // ------------------------------------------------------------------------
    window.__viewportFixV2 = {
        getView: function () {
            return { zoom: view.zoom, panX: view.panX, panY: view.panY, min: view.min, max: view.max };
        },
        // nimmt Werte aus AppState (zoom/pan/view) und wendet sie an
        applyFromState: function () {
            // falls ein Pull bereits geplant ist: nicht doppelt rendern
            cancelAnimationFrame(pullRAF);
            pullRAF = 0;
            pullFromState();
            applyViewNoState();
        },
        // direkt setzen (z.B. wenn du später programatisch willst)
        setView: function (next) {
            if (!next || typeof next !== 'object')
                return;
            const z = clampZoom(Number(next.zoom));
            const px = Number(next.panX);
            const py = Number(next.panY);
            view.zoom = z;
            if (Number.isFinite(px))
                view.panX = px;
            if (Number.isFinite(py))
                view.panY = py;
            applyView();
        },
        zoomInCenter: function (stepFactor) {
            const f = Number(stepFactor);
            zoomAtSvgCenter(Number.isFinite(f) && f > 1 ? f : 1.1);
        },
        zoomOutCenter: function (stepFactor) {
            const f = Number(stepFactor);
            const s = (Number.isFinite(f) && f > 1) ? f : 1.1;
            zoomAtSvgCenter(1 / s);
        },
        zoomAtScreen: function (sx, sy, factor) {
            zoomAtScreenPoint(sx, sy, factor);
        },
        reset: function () {
            resetView();
        },
        fitContent: function (padding) {
            return fitContent(padding);
        }
    };
    // ------------------------------------------------------------------------
    // Wheel (Capture) – blockiert alte Handler vollständig
    // ------------------------------------------------------------------------
    function wheelHandler(e) {
        if (!(svg === e.target || svg.contains(e.target)))
            return;
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation)
            e.stopImmediatePropagation();
        const dy = ('deltaY' in e)
            ? (e.deltaMode === 1 ? e.deltaY * 15 : e.deltaY)
            : (-e.wheelDelta || 0);
        const step = 1.1;
        const factor = (dy < 0) ? step : (1 / step);
        zoomAtScreenPoint(e.clientX, e.clientY, factor);
    }
    document.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
    // ------------------------------------------------------------------------
    // Panning (Handmodus oder STRG-Hotkey)
    // ------------------------------------------------------------------------
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let mouseStartParent = { x: 0, y: 0 };
    const handBtn = document.querySelector('[data-tool="pan"], #tool-hand, #btn-tool-hand');
    function setHandHotkeyVisual(on) { if (handBtn)
        handBtn.classList.toggle('hotkey-active', !!on); }
    document.addEventListener('keydown', function (e) { if (e.key === 'Control')
        setHandHotkeyVisual(true); });
    document.addEventListener('keyup', function (e) { if (e.key === 'Control')
        setHandHotkeyVisual(false); });
    function getParentCoords(evt) {
        return screenToLocal(svg, evt.clientX, evt.clientY);
    }
    svg.addEventListener('mousedown', function (e) {
        if (e.button !== 0)
            return;
        const handModeActive = document.body.classList.contains('tool-pan-active') ||
            (state && typeof state.get === 'function' && state.get('currentTool') === 'pan');
        if (handModeActive || e.ctrlKey) {
            isPanning = true;
            panStart = { x: view.panX, y: view.panY };
            mouseStartParent = getParentCoords(e);
            svg.style.cursor = 'grabbing';
            e.preventDefault();
        }
    }, { capture: true });
    window.addEventListener('mousemove', function (e) {
        if (!isPanning)
            return;
        const p = getParentCoords(e);
        view.panX = panStart.x + (p.x - mouseStartParent.x);
        view.panY = panStart.y + (p.y - mouseStartParent.y);
        applyView();
    }, { capture: true });
    window.addEventListener('mouseup', function () {
        if (!isPanning)
            return;
        isPanning = false;
        svg.style.cursor = '';
    }, { capture: true });
    // Initial anwenden & spiegeln
    applyView();
})();
// ============================================================================
// Theme-Management
// ============================================================================
function createThemeManager() {
    const self = {};
    self.init = function () {
        // Theme initial setzen
        self.applyTheme(self.currentTheme);
        // Button-Handler
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', function () {
                self.toggleTheme();
            });
        }
        console.log('✓ Theme-Manager initialisiert');
    };
    self.loadTheme = function () {
        // Aus localStorage laden oder System-Präferenz verwenden
        const savedTheme = localStorage.getItem('hmi-editor-theme');
        if (savedTheme) {
            return savedTheme;
        }
        // System-Präferenz prüfen
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    };
    self.saveTheme = function (theme) {
        localStorage.setItem('hmi-editor-theme', theme);
    };
    self.applyTheme = function (theme) {
        document.documentElement.setAttribute('data-theme', theme);
        self.currentTheme = theme;
        self.updateThemeIcon(theme);
        self.saveTheme(theme);
    };
    self.toggleTheme = function () {
        const newTheme = self.currentTheme === 'light' ? 'dark' : 'light';
        self.applyTheme(newTheme);
    };
    self.updateThemeIcon = function (theme) {
        // V55.1: Der Schalter traegt ein Strichsymbol aus public/icons.svg statt
        // eines Emoji. Getauscht wird die Referenz, nicht der Textinhalt —
        // Groesse und Farbe kommen aus CSS (currentColor).
        const use = document.querySelector('#theme-toggle .theme-icon use');
        if (use) {
            const name = theme === 'light' ? 'moon' : 'sun';
            use.setAttribute('href', '#ico-' + name);
            return;
        }
        // Rueckfall fuer Einbettungen ohne Sprite (z. B. Testfixtures).
        const icon = document.querySelector('#theme-toggle .theme-icon');
        if (icon && !icon.querySelector('use')) {
            icon.textContent = theme === 'light' ? '\u25D1' : '\u25CB';
        }
    };
    self.getTheme = function () {
        return self.currentTheme;
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.currentTheme = self.loadTheme();
    self.init();
    return self;
}
export const themeManager = createThemeManager();
