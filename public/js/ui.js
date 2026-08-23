/**
 * ui.js - UI-Koordination und Event-Handler
 *
 * Zuständigkeiten:
 * - UI-Komponenten koordinieren
 * - Projekt-Management (Speichern/Laden/Export)
 * - Properties-Panel
 * - Layers-Panel
 * - Modal-Dialoge
 * - Globale UI-Updates
 */
/* import { elementManager } from './elements.js'; */
import { api, state, showStatus, handleError, utils } from './core.js';
import { elementManager, canvasController } from './elements.js';
import { templateRegistry } from './registry.js';
import {
    PID_STANDARD_ID,
    PID_STANDARD_RELEASE,
    PID_STANDARD_VERSION,
    normalizeProjectModel
} from './pid_standard.js';
import { connectionManager } from './connection_mapper.js';
import { showNotice } from './dialog_service.js';
import { buildExportConfig, validateExportConfig } from './model_adapter.js';
import { formatJsonInput } from './json_formator.js';
import { ANIMATION_CSS, makeSvgAnimatable, buildSignalBridge, animationStyleTag } from './hmi_animation.js';
import { describeConfig, buildSnapshot, embedSnapshot, extractSnapshot, verifySnapshot, compareWithHead, pickConfig } from './hmi_snapshot.js';
import {
    applyLogicCrossRulesToV8,
    buildLogicSignalCatalog,
    compileLogicArtifacts,
    normalizeLogicModel
} from './logic_core.js';
import {
    normalizeAutomationConfig,
    normalizeProjectAutomationModels
} from './automation_contract.js';
// ============================================================================
// Helper
// ============================================================================
/**
 * V52-Fix (B-1): findNodeById war im gesamten Projekt NICHT definiert.
 * applyHmiDataAttributes() warf daher beim ersten Assignment einen
 * ReferenceError, den die beiden Aufrufstellen still per try/catch
 * schluckten — exportierte und gespeicherte SVGs enthielten deshalb
 * NIEMALS data-hmi-* / data-hmi-ui-*-Attribute.
 *
 * Sucht das SVG-Element zu einer Element-Instanz-ID. Der aktive SVG-Baum
 * wird ueber die zuletzt an applyHmiDataAttributes uebergebene Wurzel
 * gefuehrt, mit Rueckfall auf das Live-Canvas.
 */
var __hmiAttrRoot = null;
function findNodeById(elementId) {
    if (elementId === null || elementId === undefined)
        return null;
    var id = String(elementId);
    var roots = [__hmiAttrRoot, document.getElementById('elements-layer'),
        document.getElementById('main-canvas'), document];
    for (var i = 0; i < roots.length; i += 1) {
        var root = roots[i];
        if (!root || typeof root.querySelector !== 'function')
            continue;
        var node = null;
        try {
            node = root.querySelector('[data-element-id="' + CSS.escape(id) + '"]')
                || root.querySelector('#' + CSS.escape(id));
        }
        catch (error) {
            node = null;
        }
        if (node)
            return node;
    }
    return null;
}
function deepClone(obj) {
    if (!obj || typeof obj !== 'object')
        return obj;
    return JSON.parse(JSON.stringify(obj));
}
function extractDeviceConfigOverridesForProjectSave() {
    var edited = Boolean(state.get('deviceConfigUserEdited'));
    if (!edited)
        return null;
    var cfg = state.get('deviceConfig') || {};
    var keys = [
        'node_registrar',
        'nodes',
        'controller_node_bindings',
        'controllers',
        'virtual_controllers',
        'sensors',
        'actuators',
        // ✅ Schema/Parameter-Definitionen (Parameter Schemas Tab)
        'state_type_parameter_schema_mappings',
        'parameter_schemas'
    ];
    var out = {};
    keys.forEach(function (k) {
        if (Array.isArray(cfg[k]) && cfg[k].length > 0)
            out[k] = deepClone(cfg[k]);
    });
    return Object.keys(out).length ? out : null;
}
// ============================================================================
// Projekt-Manager
// ============================================================================
function createProjektManager() {
    const self = {};
    self.init = function () {
        const speichernBtn = document.getElementById('btn-speichern');
        if (speichernBtn)
            speichernBtn.addEventListener('click', function () {
                return self.speichern();
            });
        const ladenBtn = document.getElementById('btn-laden');
        if (ladenBtn)
            ladenBtn.addEventListener('click', function () {
                return self.showLadenDialog();
            });
        const exportBtn = document.getElementById('btn-exportieren');
        if (exportBtn)
            exportBtn.addEventListener('click', function () {
                return self.exportieren();
            });
        const projektNameInput = document.getElementById('projekt-name');
        if (projektNameInput) {
            const initial = String(projektNameInput.value || state.get('projektName') || 'Unbenannt').trim();
            projektNameInput.value = initial;
            state.set('projektName', initial);
            self.currentProject = initial;
            projektNameInput.addEventListener('change', function (e) {
                const name = String(e.target.value || '').trim();
                state.set('projektName', name || 'Unbenannt');
                self.currentProject = name || 'Unbenannt';
                self.updateProjektAnzeige();
            });
        }
        console.log('✓ Projekt-Manager initialisiert');
    };
    self.updateProjektAnzeige = function () {
        const input = document.getElementById('projekt-name');
        const name = String(self.currentProject || state.get('projektName') || '').trim();
        if (input && name && input.value !== name)
            input.value = name;
        if (name)
            state.set('projektName', name);
    };
    self.speichern = async function () {
        try {
            const input = document.getElementById('projekt-name');
            const name = String((input && input.value) || state.get('projektName') || '').trim();
            if (!name) {
                showStatus('Projektname fehlt', 'error');
                return;
            }
            self.currentProject = name;
            self.updateProjektAnzeige();
            const svg = self.generateSVG();
            state.set('svgContent', svg);
            const hmiModel = state.get('hmi') || {
                version: 1,
                active_view_id: 'main',
                views: [],
                widgets: [],
                bindings: [],
                styles: [],
                alarms: [],
                event_animations: []
            };
            const projectSource = {
                name: name,
                timestamp: new Date().toISOString(),
                // Editor State
                svgContent: svg,
                elements: state.get('elements') || [],
                connections: state.get('connections') || [],
                // Device/IO + HMI + Automation
                devices: state.get('devices') || { version: 1, assignments: {} },
                // Projekt-Model (Editor)
                hmi: hmiModel,
                // ✅ Alias für standardisierte Client-Schnittstelle:
                //    Damit kann ein Client immer cfg.hmi_ui verwenden.
                hmi_ui: deepClone(hmiModel),
                processes: state.get('processes') || { process_states: [] },
                dynamic_rule_engine: state.get('dynamic_rule_engine') || { rule_sets: [] },
                rule_library: state.get('ruleLibrary') || { rule_sets: [] },
                free_rules: state.get('free_rules') || { version: 1, timers: [], triggers: [], actions: [], transitions: [], events: [] },
                plant_drawing: state.get('plant_drawing') || null,
                // PF-LOGIC-V1 canonical diagrams. Runtime/PLC artifacts are
                // derived during export and are never stored as a second truth.
                logic: normalizeLogicModel(state.get('logic')),
                // ✅ NEU: Automation Konfiguration (projektseitig)
                automation_cfg: normalizeAutomationConfig(state.get('automation_cfg'))
            };
            const metadaten = normalizeProjectAutomationModels(
                normalizeProjectModel(projectSource, templateRegistry)
            );
            metadaten.object_standard = Object.assign({}, metadaten.object_standard || {}, {
                id: PID_STANDARD_ID,
                version: PID_STANDARD_VERSION,
                release: PID_STANDARD_RELEASE,
                geometry_normalized: true,
                semantic_ports: true,
                auto_create_hmi_widgets: false,
                hmi_controls: 'optional_explicit_only'
            });
            const overrides = extractDeviceConfigOverridesForProjectSave();
            if (overrides)
                metadaten.device_config_overrides = overrides;
            if (api && typeof api.saveProject === 'function') {
                await api.saveProject(name, metadaten);
            }
            else if (api && typeof api.saveProjekt === 'function') {
                await api.saveProjekt(name, svg, metadaten);
            }
            else {
                throw new Error('API-Methode saveProject/saveProjekt fehlt');
            }
            showStatus('Projekt gespeichert: ' + name, 'success');
        }
        catch (e) {
            handleError(e, 'Fehler beim Speichern');
        }
    };
    self.showLadenDialog = async function () {
        try {
            const response = await api.listProjekte();
            // robust gegen leicht unterschiedliche Response-Formate
            const ok = (response && typeof response === 'object') ? (response.erfolg !== false) : false;
            const projekte = (response && response.projekte) ? response.projekte : [];
            if (!ok || !Array.isArray(projekte)) {
                throw new Error('Projekte konnten nicht geladen werden');
            }
            const modal = document.getElementById('modal-projekte-laden');
            if (!modal)
                return;
            const projektListe = document.getElementById('projekt-liste');
            if (!projektListe)
                return;
            if (projekte.length === 0) {
                projektListe.innerHTML = `
          <div class="no-selection">
            Keine gespeicherten Projekte vorhanden
          </div>
        `;
            }
            else {
                projektListe.innerHTML = '';
                projekte.forEach(function (projekt) {
                    const item = document.createElement('div');
                    item.className = 'projekt-item';
                    item.innerHTML = `
            <h4>${projekt.name}</h4>
            <div class="projekt-info">
              ${utils.formatFileSize(projekt.groesse)} •
              ${utils.formatDate(projekt.geaendert)}
            </div>
          `;
                    item.addEventListener('click', function () {
                        self.laden(projekt.name);
                        modal.classList.add('hidden');
                    });
                    projektListe.appendChild(item);
                });
            }
            modal.classList.remove('hidden');
            const closeBtn = modal.querySelector('.modal-close');
            const cancelBtn = modal.querySelector('.modal-cancel');
            const closeModal = function () {
                return modal.classList.add('hidden');
            };
            if (closeBtn)
                closeBtn.onclick = closeModal;
            if (cancelBtn)
                cancelBtn.onclick = closeModal;
        }
        catch (error) {
            handleError(error, 'Fehler beim Laden der Projekt-Liste');
        }
    };
    self.laden = async function (projektName) {
        try {
            let projekt = null;
            if (api && typeof api.loadProject === 'function') {
                projekt = await api.loadProject(projektName);
            }
            else if (api && typeof api.loadProjekt === 'function') {
                const res = await api.loadProjekt(projektName);
                projekt = (res && res.metadaten) ? res.metadaten
                    : (res && res.projekt) ? res.projekt
                        : res;
            }
            else {
                throw new Error('API-Methode loadProject/loadProjekt fehlt');
            }
            if (!projekt || typeof projekt !== 'object')
                throw new Error('Projekt nicht gefunden');
            projekt = normalizeProjectAutomationModels(
                normalizeProjectModel(projekt, templateRegistry)
            );
            self.currentProject = projektName;
            self.updateProjektAnzeige();
            // --- DeviceConfig Overrides (wenn im Projekt gespeichert) ---
            const overrides = projekt.device_config_overrides;
            if (overrides && typeof overrides === 'object') {
                const base = deepClone(state.get('deviceConfig') || {});
                Object.keys(overrides).forEach(function (k) {
                    base[k] = deepClone(overrides[k]);
                });
                state.set('deviceConfig', base);
                state.set('deviceConfigUserEdited', true);
            }
            // --- Projekt-State ---
            state.set('devices', projekt.devices || { version: 1, assignments: {} });
            state.set('hmi', projekt.hmi || projekt.hmi_ui || state.get('hmi'));
            state.set('svgContent', projekt.svgContent || '');
            state.set('elements', projekt.elements || []);
            state.set('connections', projekt.connections || []);
            // ✅ View reset: verhindert "leer" wenn du vorher weggepannt/gezooomt hast
            state.set('zoom', 1.0);
            state.set('pan', { x: 0, y: 0 });
            if (canvasController && typeof canvasController.applyViewTransform === 'function') {
                canvasController.applyViewTransform();
            }
            state.set('processes', projekt.processes || { process_states: [] });
            state.set('dynamic_rule_engine', projekt.dynamic_rule_engine || { rule_sets: [] });
            state.set('ruleLibrary', projekt.rule_library || state.get('ruleLibrary') || { rule_sets: [] });
            state.set('free_rules', projekt.free_rules || state.get('free_rules') || { version: 1, timers: [], triggers: [], actions: [], transitions: [], events: [] });
            state.set('plant_drawing', projekt.plant_drawing || state.get('plant_drawing'));
            state.set('logic', normalizeLogicModel(projekt.logic || null));
            // ✅ NEU: Automation Konfiguration laden
            state.set('automation_cfg', normalizeAutomationConfig(projekt.automation_cfg));
            // --- Events (wichtig: damit Panels + Canvas sich neu aufbauen) ---
            state.emit('devices:loaded', state.get('devices'));
            state.emit('devices:updated', { reason: 'project_load' });
            state.emit('elements:loaded', state.get('elements'));
            state.emit('connections:loaded', state.get('connections'));
            state.emit('processes:loaded', state.get('processes'));
            state.emit('rules:loaded', state.get('dynamic_rule_engine'));
            state.emit('automation_cfg:loaded', state.get('automation_cfg'));
            state.emit('logic:loaded', state.get('logic'));
            state.emit('plant_drawing:loaded', state.get('plant_drawing'));
            state.emit('hmi_ui:updated', { reason: 'project_load' });
            showStatus('Projekt geladen: ' + projektName, 'success');
        }
        catch (e) {
            handleError(e, 'Projekt laden fehlgeschlagen');
        }
    };
    self.exportieren = async function () {
        try {
            exportiereScadaBundle().catch(function (e) { handleError(e, 'Export fehlgeschlagen'); });
        }
        catch (e) {
            handleError(e, 'Fehler beim Exportieren');
        }
    };
    self.generateSVG = function () {
        const canvas = document.getElementById('main-canvas');
        if (!canvas) {
            console.warn('generateSVG: main-canvas nicht gefunden');
            return '';
        }
        const clonedCanvas = canvas.cloneNode(true);
        const gridBg = clonedCanvas.querySelector('#grid-background');
        if (gridBg)
            gridBg.remove();
        clonedCanvas.querySelectorAll('.selected').forEach(function (el) {
            el.classList.remove('selected');
        });
        try {
            applyHmiDataAttributes(clonedCanvas);
        }
        catch (e) {
            console.warn('generateSVG: applyHmiDataAttributes fehlgeschlagen', e);
        }
        const serializer = new XMLSerializer();
        return serializer.serializeToString(clonedCanvas);
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.currentProject = null;
    self.init();
    return self;
}
// ============================================================================
// Properties-Panel
// ============================================================================
function createPropertiesPanel() {
    const self = {};
    self.init = function () {
        state.on('selection:changed', function (selectedIds) {
            self.update(selectedIds);
        });
        state.on('element:updated', function () {
            const active = document.activeElement;
            if (active && self.panel && self.panel.contains(active))
                return;
            const selectedIds = state.get('selectedElements');
            if (selectedIds.length > 0)
                self.update(selectedIds);
        });
        console.log('✓ Properties-Panel initialisiert');
    };
    self.escapeHtml = function (value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };
    self.numeric = function (value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    self.captureSectionState = function () {
        if (!self.panel)
            return;
        self.panel.querySelectorAll('details[data-section]').forEach(function (details) {
            self.sectionState[details.dataset.section] = details.open;
        });
    };
    self.openAttribute = function (name) {
        return self.sectionState[name] ? ' open' : '';
    };
    self.findAssignment = function (elementId) {
        const devices = state.get('devices') || {};
        const assignments = devices.assignments || {};
        const values = Object.keys(assignments).map(function (key) {
            return assignments[key];
        });
        return values.filter(function (entry) {
            return entry && String(entry.element_id || '') === String(elementId || '');
        })[0] || null;
    };
    self.bindingModel = function (data) {
        const assignment = self.findAssignment(data.id);
        const embedded = Array.isArray(data.bindings) ? data.bindings.filter(Boolean) : [];
        const bound = Boolean(assignment || embedded.length > 0);
        const role = assignment ? String(assignment.role || 'signal') : 'signal';
        const signalId = assignment
            ? (assignment.actuator_id ?? assignment.sensor_id ?? assignment.signal_id ?? '—')
            : '—';
        const controllerId = assignment ? (assignment.controller_id ?? '—') : '—';
        const channel = assignment
            ? (assignment.channel ?? assignment.address ?? assignment.function_type ?? '—')
            : '—';
        return {
            bound: bound,
            headline: bound ? (role === 'sensor' ? 'Sensor gebunden' : 'Aktor gebunden') : 'Nicht gebunden',
            tone: bound ? 'ok' : 'muted',
            code: bound ? role + ':' + signalId + ':value' : 'Keine Signalzuordnung',
            controller: bound ? 'Controller ' + controllerId : 'Noch nicht zugeordnet',
            channel: bound ? 'Kanal ' + channel : 'I/O-Kanal offen'
        };
    };
    self.update = function (selectedIds) {
        if (!self.panel)
            return;
        self.captureSectionState();
        if (!Array.isArray(selectedIds))
            selectedIds = state.get('selectedElements') || [];
        if (selectedIds.length === 0) {
            self.panel.innerHTML = '<div class="no-selection">Kein Element ausgewählt</div>';
            return;
        }
        const elementId = selectedIds[0];
        const item = elementManager.getElement(elementId);
        if (!item || !item.data) {
            self.panel.innerHTML = '<div class="no-selection">Eigenschaften nicht verfügbar</div>';
            return;
        }
        const data = item.data;
        const pivotMode = data.pivotMode || 'center';
        const pivotX = self.numeric(data.pivotX, 0);
        const pivotY = self.numeric(data.pivotY, 0);
        const fillEnabled = data.paint_fill_enabled === true;
        const fillColor = String(data.paint_fill_color || '#4CAF50');
        const fillOpacity = self.numeric(data.paint_fill_opacity, 0.2);
        const fillSelector = String(data.paint_fill_selector || '').trim();
        const binding = self.bindingModel(data);
        const escape = self.escapeHtml;
        const displayName = escape(data.name || data.templateId || data.id);
        const templateName = escape(data.templateId || 'Prozesssymbol');
        const entityTag = escape(data.tag || (data.properties || {}).tag || 'X-000');
        const standardName = escape(data.standard || 'LEGACY');
        const symbolType = escape(data.symbolType || data.symbol_type || data.templateId || 'symbol');
        const geometryProfile = escape(data.geometryProfile || data.geometry_profile || 'legacy');
        const portCount = Array.isArray(data.ports) ? data.ports.length : 0;
        const idText = escape(data.id);
        const bindingTone = escape(binding.tone);
        self.panel.innerHTML = `
      <div class="properties-form v1-properties">
        <section class="v1-selection-card" aria-label="Ausgewähltes Element">
          <span class="v1-selection-icon" aria-hidden="true">
            <svg class="ico"><use href="#ico-workspace"></use></svg>
          </span>
          <span class="v1-selection-copy">
            <strong>${entityTag}</strong>
            <span>${displayName} · ${templateName}</span>
          </span>
          <span class="v61-standard-badge" data-standard="${standardName}">${standardName === 'PF-PID-V1' ? 'P&ID V1' : standardName}</span>
          <span class="v1-run-badge" data-tone="${bindingTone}">${binding.bound ? 'RUN' : 'READY'}</span>
          <code class="v1-element-id" title="${idText}">${idText}</code>
        </section>

        <details class="v1-inspector-section" data-section="general"${self.openAttribute('general')}>
          <summary><span>Allgemein</span><svg class="ico ico--sm" aria-hidden="true"><use href="#ico-chevron-down"></use></svg></summary>
          <div class="v1-section-body">
            <div class="v1-field-group">
              <label class="v1-field"><span>TAG</span><input type="text" class="property-value v61-tag-input" id="prop-tag" value="${entityTag}" spellcheck="false" autocomplete="off"></label>
              <label class="v1-field"><span>Anzeigename</span><input type="text" class="property-value" id="prop-name" value="${escape(data.name || '')}"></label>
            </div>
            <label class="v1-field v1-field--full"><span>Funktionsbeschreibung</span><input type="text" class="property-value" id="prop-description" value="${escape(data.description || data.name || '')}"></label>
            <div class="v61-standard-summary" aria-label="Objektstandard">
              <span><strong>${standardName}</strong><small>Objektstandard</small></span>
              <span><strong>${symbolType}</strong><small>Symboltyp</small></span>
              <span><strong>${geometryProfile}</strong><small>Geometrieprofil</small></span>
              <span><strong>${portCount}</strong><small>semantische Ports</small></span>
            </div>
            <div class="v1-field-group">
              <span class="v1-field-group-label">Position</span>
              <label class="v1-field"><span>Position X</span><span class="v1-input-unit"><input type="number" class="property-value" id="prop-x" value="${Math.round(self.numeric(data.x, 0))}"><em>px</em></span></label>
              <label class="v1-field"><span>Position Y</span><span class="v1-input-unit"><input type="number" class="property-value" id="prop-y" value="${Math.round(self.numeric(data.y, 0))}"><em>px</em></span></label>
            </div>
            <div class="v1-field-group">
              <span class="v1-field-group-label">Größe</span>
              <label class="v1-field"><span>Breite</span><span class="v1-input-unit"><input type="number" class="property-value" id="prop-width" value="${Math.round(self.numeric(data.width, 100))}"><em>px</em></span></label>
              <label class="v1-field"><span>Höhe</span><span class="v1-input-unit"><input type="number" class="property-value" id="prop-height" value="${Math.round(self.numeric(data.height, 100))}"><em>px</em></span></label>
            </div>
          </div>
        </details>

        <details class="v1-inspector-section v1-binding-section" data-section="binding"${self.openAttribute('binding')}>
          <summary><span>V9-Binding</span><svg class="ico ico--sm" aria-hidden="true"><use href="#ico-chevron-down"></use></svg></summary>
          <div class="v1-section-body">
            <div class="v1-binding-card" data-tone="${bindingTone}">
              <div class="v1-binding-title">
                <span class="v1-binding-icon"><svg class="ico ico--sm" aria-hidden="true"><use href="#ico-link"></use></svg></span>
                <span><strong>${escape(binding.headline)}</strong><small>${binding.bound ? 'actual · value' : 'Bindung im I/O-Inspektor wählen'}</small></span>
                <span class="v1-valid-badge">${binding.bound ? 'gültig' : 'offen'}</span>
              </div>
              <code>${escape(binding.code)}</code>
              <div class="v1-binding-meta"><span>${escape(binding.controller)}</span><span>${escape(binding.channel)}</span></div>
              <button id="prop-open-bindings" class="v1-inline-action" type="button">Binding bearbeiten</button>
            </div>
            <label class="v1-field v1-field--full">
              <span>Darstellungszustand</span>
              <select class="property-value" id="prop-binding-display" disabled>
                <option>${binding.bound ? 'Automatisch aus Signal ableiten' : 'Nach Bindung automatisch ableiten'}</option>
              </select>
            </label>
          </div>
        </details>

        <details class="v1-inspector-section" data-section="appearance"${self.openAttribute('appearance')}>
          <summary><span>Darstellung</span><svg class="ico ico--sm" aria-hidden="true"><use href="#ico-chevron-down"></use></svg></summary>
          <div class="v1-section-body">
            <div class="v1-field-group">
              <label class="v1-field"><span>Rotation (°)</span><input type="number" class="property-value" id="prop-rotation" value="${self.numeric(data.rotation, 0)}" min="0" max="360"></label>
              <label class="v1-field"><span>Skalierung</span><input type="number" class="property-value" id="prop-scale" value="${self.numeric(data.scale, 1)}" min="0.1" max="5" step="0.1"></label>
            </div>
            <label class="v1-field v1-field--full"><span>Drehpunkt</span>
              <select class="property-value" id="prop-pivot-mode">
                <option value="center" ${pivotMode === 'center' ? 'selected' : ''}>Mitte</option>
                <option value="topleft" ${pivotMode === 'topleft' ? 'selected' : ''}>Oben links</option>
                <option value="top" ${pivotMode === 'top' ? 'selected' : ''}>Oben Mitte</option>
                <option value="right" ${pivotMode === 'right' ? 'selected' : ''}>Rechts Mitte</option>
                <option value="bottom" ${pivotMode === 'bottom' ? 'selected' : ''}>Unten Mitte</option>
                <option value="custom" ${pivotMode === 'custom' ? 'selected' : ''}>Benutzerdefiniert</option>
              </select>
            </label>
            <div class="v1-field-group" id="prop-pivot-custom"${pivotMode === 'custom' ? '' : ' hidden'}>
              <label class="v1-field"><span>Pivot X</span><input type="number" class="property-value" id="prop-pivot-x" value="${pivotX}"></label>
              <label class="v1-field"><span>Pivot Y</span><input type="number" class="property-value" id="prop-pivot-y" value="${pivotY}"></label>
            </div>
            <label class="v1-check-field"><input type="checkbox" id="prop-fill-enabled" ${fillEnabled ? 'checked' : ''}><span>Innenfläche ausmalen</span></label>
            <div class="v1-field-group">
              <label class="v1-field"><span>Farbe</span><input type="color" class="property-value" id="prop-fill-color" value="${escape(fillColor)}"></label>
              <label class="v1-field"><span>Deckkraft</span><input type="number" class="property-value" id="prop-fill-opacity" min="0" max="1" step="0.05" value="${fillOpacity}"></label>
            </div>
            <label class="v1-field v1-field--full"><span>Fill-Selector (optional)</span><input type="text" class="property-value" id="prop-fill-selector" value="${escape(fillSelector)}" placeholder="#zylinder-koerper"></label>
          </div>
        </details>

        <details class="v1-inspector-section" data-section="hmi"${self.openAttribute('hmi')}>
          <summary><span>Interaktion &amp; HMI</span><svg class="ico ico--sm" aria-hidden="true"><use href="#ico-chevron-down"></use></svg></summary>
          <div class="v1-section-body v1-section-actions">
            <div class="v61-hmi-policy" role="note">
              <svg class="ico ico--sm" aria-hidden="true"><use href="#ico-shield"></use></svg>
              <span><strong>HMI explizit und optional</strong><small>Das Platzieren eines Prozesssymbols erzeugt keinen Button und kein Bedien-Widget. Bedienelemente werden ausschließlich hier im HMI-Designer angelegt.</small></span>
            </div>
            <button id="prop-open-hmi" class="btn btn-secondary" type="button">HMI-Bedienelement hinzufügen</button>
            <button id="prop-open-connections" class="btn btn-secondary" type="button">Semantische Ports prüfen</button>
          </div>
        </details>
      </div>`;
        self.attachPropertyListeners(elementId);
        self.attachSectionListeners();
    };
    self.attachPropertyListeners = function (elementId) {
        const map = {
            'prop-tag': 'tag',
            'prop-name': 'name',
            'prop-description': 'description',
            'prop-x': 'x',
            'prop-y': 'y',
            'prop-width': 'width',
            'prop-height': 'height',
            'prop-rotation': 'rotation',
            'prop-scale': 'scale',
            'prop-pivot-mode': 'pivotMode',
            'prop-pivot-x': 'pivotX',
            'prop-pivot-y': 'pivotY'
        };
        const numericProperties = ['x', 'y', 'width', 'height', 'rotation', 'scale', 'pivotX', 'pivotY'];
        Object.keys(map).forEach(function (inputId) {
            const property = map[inputId];
            const element = document.getElementById(inputId);
            if (!element)
                return;
            function applyValue() {
                let value = element.value;
                if (numericProperties.indexOf(property) !== -1) {
                    value = Number(value);
                    if (!Number.isFinite(value))
                        value = 0;
                }
                if (property === 'tag')
                    value = String(value || '').trim().toUpperCase();
                elementManager.updateElement(elementId, { [property]: value });
            }
            element.addEventListener('change', applyValue);
            element.addEventListener('blur', applyValue);
            if (element.tagName === 'INPUT' && element.type === 'number') {
                element.addEventListener('input', applyValue);
            }
        });
        const pivotModeElement = document.getElementById('prop-pivot-mode');
        const pivotCustomGroup = document.getElementById('prop-pivot-custom');
        if (pivotModeElement && pivotCustomGroup) {
            pivotModeElement.addEventListener('change', function () {
                pivotCustomGroup.hidden = pivotModeElement.value !== 'custom';
            });
        }
        const fillEnabledElement = document.getElementById('prop-fill-enabled');
        const fillColorElement = document.getElementById('prop-fill-color');
        const fillOpacityElement = document.getElementById('prop-fill-opacity');
        const fillSelectorElement = document.getElementById('prop-fill-selector');
        if (fillEnabledElement) {
            fillEnabledElement.addEventListener('change', function () {
                elementManager.updateElement(elementId, { paint_fill_enabled: Boolean(fillEnabledElement.checked) });
            });
        }
        function applyFillColor() {
            elementManager.updateElement(elementId, {
                paint_fill_color: String(fillColorElement.value || '#4CAF50')
            });
        }
        if (fillColorElement) {
            fillColorElement.addEventListener('input', applyFillColor);
            fillColorElement.addEventListener('change', applyFillColor);
        }
        function applyFillOpacity() {
            let value = Number(fillOpacityElement.value);
            if (!Number.isFinite(value))
                value = 0.2;
            value = Math.min(1, Math.max(0, value));
            elementManager.updateElement(elementId, { paint_fill_opacity: value });
        }
        if (fillOpacityElement) {
            fillOpacityElement.addEventListener('input', applyFillOpacity);
            fillOpacityElement.addEventListener('change', applyFillOpacity);
        }
        function applyFillSelector() {
            elementManager.updateElement(elementId, {
                paint_fill_selector: String(fillSelectorElement.value || '').trim()
            });
        }
        if (fillSelectorElement) {
            fillSelectorElement.addEventListener('change', applyFillSelector);
            fillSelectorElement.addEventListener('blur', applyFillSelector);
        }
        self.bindRouteButton('prop-open-bindings', 'tab-btn-device');
        self.bindRouteButton('prop-open-hmi', 'tab-btn-hmi');
        self.bindRouteButton('prop-open-connections', 'tab-btn-connections');
    };
    self.bindRouteButton = function (buttonId, targetId) {
        const button = document.getElementById(buttonId);
        const target = document.getElementById(targetId);
        if (!button || !target)
            return;
        button.addEventListener('click', function () {
            target.click();
        });
    };
    self.attachSectionListeners = function () {
        if (!self.panel)
            return;
        self.panel.querySelectorAll('details[data-section]').forEach(function (details) {
            details.addEventListener('toggle', function () {
                self.sectionState[details.dataset.section] = details.open;
            });
        });
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.panel = document.getElementById('properties-panel');
    self.sectionState = {
        general: true,
        binding: true,
        appearance: false,
        hmi: false
    };
    self.init();
    return self;
}
// ============================================================================
// Layers-Panel
// ============================================================================
function createLayersPanel() {
    const self = {};
    self.escapeHtml = function (value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };
    self.init = function () {
        state.on('element:added', function () {
            return self.update();
        });
        state.on('element:removed', function () {
            return self.update();
        });
        state.on('elements:rebuilt', function () {
            return self.update();
        });
        state.on('selection:changed', function () {
            return self.update();
        });
        console.log('✓ Layers-Panel initialisiert');
    };
    self.update = function () {
        if (!self.panel)
            return;
        const elements = elementManager.getAllElements();
        const selectedIds = state.get('selectedElements');
        if (elements.length === 0) {
            self.panel.innerHTML = `
            <div class="no-selection" style="padding: 1rem; font-size: 12px;">
                Keine Elemente vorhanden
            </div>
        `;
            return;
        }
        let html = '';
        elements.forEach(function (item) {
            const isSelected = selectedIds.includes(item.data.id);
            const layerTag = self.escapeHtml(item.data.tag || '');
            const layerName = self.escapeHtml(item.data.description || item.data.name || '');
            html += `
            <div class="layer-item ${isSelected ? 'selected' : ''}" 
                 data-element-id="${item.data.id}">
                <span class="v61-layer-tag">${layerTag || '—'}</span>
                <span class="v61-layer-name">${layerName}</span>
            </div>
        `;
        });
        self.panel.innerHTML = html;
        // Click-Handler
        self.panel.querySelectorAll('.layer-item').forEach(function (layerItem) {
            layerItem.addEventListener('click', function () {
                const elementId = layerItem.dataset.elementId;
                elementManager.selectElement(elementId);
            });
        });
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.panel = document.getElementById('layers-panel');
    self.init();
    return self;
}
// ============================================================================
// Stats-Updater
// ============================================================================
function createStatsUpdater() {
    const self = {};
    self.init = function () {
        state.on('element:added', function () {
            return self.updateElementCount();
        });
        state.on('element:removed', function () {
            return self.updateElementCount();
        });
        state.on('elements:rebuilt', function () {
            return self.updateElementCount();
        });
        self.updateElementCount();
        console.log('✓ Stats-Updater initialisiert');
    };
    self.updateElementCount = function () {
        const countDisplay = document.getElementById('element-count');
        if (countDisplay) {
            const count = elementManager.getAllElements().length;
            countDisplay.textContent = `${count} Element${count !== 1 ? 'e' : ''}`;
        }
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.init();
    return self;
}
// ============================================================================
// Application-Controller (Hauptkoordinator)
// ============================================================================
function createApplicationController() {
    const self = {};
    self.init = function () {
        console.log('='.repeat(70));
        console.log('HMI/P&ID SVG Editor - Initialisierung abgeschlossen');
        console.log('='.repeat(70));
        console.log('Module:');
        console.log('  ✓ Core (API, State, Utils)');
        console.log('  ✓ Registry (Templates)');
        console.log('  ✓ Elements (SVG-Management)');
        console.log('  ✓ Connections (Verbindungen)');
        console.log('  ✓ UI (Interface-Kontrolle)');
        console.log('='.repeat(70));
        showStatus('Editor bereit', 'success', 2000);
        // Keyboard-Shortcuts-Hilfe
        self.setupKeyboardHelp();
    };
    self.setupKeyboardHelp = function () {
        document.addEventListener('keydown', function (e) {
            // F1 für Hilfe
            if (e.key === 'F1') {
                e.preventDefault();
                self.showKeyboardHelp();
            }
        });
    };
    self.showKeyboardHelp = function () {
        const helpText = `
    Tastatur-Shortcuts:

    Navigation:
      V - Auswahl-Werkzeug
      H - Verschiebe-Werkzeug
      G - Raster umschalten
      S - Einrasten umschalten

    Zoom:
      + - Vergrößern
      - - Verkleinern
      0 - Zoom zurücksetzen
      Mausrad - Zoom

    Bearbeiten:
      Strg+Z - Rückgängig
      Strg+Y / Strg+Shift+Z - Wiederholen
      Entf / Backspace - Löschen

    Sonstiges:
      F1 - Diese Hilfe
            `.trim();
        showNotice(helpText, {
            title: 'Tastatur-Shortcuts',
            confirmLabel: 'Schließen'
        });
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.projektManager = createProjektManager();
    self.propertiesPanel = createPropertiesPanel();
    self.layersPanel = createLayersPanel();
    self.statsUpdater = createStatsUpdater();
    self.init();
    return self;
}
// ============================================================================
// Config-Export (JSON + HMI-Daten + SVG-Hooks)
// ============================================================================
function applyHmiDataAttributes(svgRoot) {
    // V52: Suchwurzel fuer findNodeById setzen (siehe B-1 oben).
    __hmiAttrRoot = svgRoot || null;
    // ------------------------------------------------------------
    // 1) Device/IO Assignments -> data-hmi-*
    // ------------------------------------------------------------
    var devices = state.get('devices') || {};
    var assignments = devices.assignments || {};
    // Legacy-Fallback (sehr alte Projekte)
    if ((!assignments || Object.keys(assignments).length === 0)) {
        var legacy = state.get('hmi') || {};
        if (legacy && legacy.assignments)
            assignments = legacy.assignments;
    }
    Object.keys(assignments || {}).forEach(function (elementId) {
        var a = assignments[elementId];
        var node = findNodeById(elementId);
        if (!node || !a)
            return;
        node.setAttribute('data-hmi-role', a.role || 'device');
        if (a.sensor_id != null && String(a.sensor_id).trim() !== '') {
            node.setAttribute('data-sensor-id', String(a.sensor_id).trim());
        }
        if (a.actuator_id != null && String(a.actuator_id).trim() !== '') {
            node.setAttribute('data-actuator-id', String(a.actuator_id).trim());
        }
        if (a.device_id != null && String(a.device_id).trim() !== '') {
            node.setAttribute('data-device-id', String(a.device_id).trim());
        }
        // Optional: nützliche Runtime-Metadaten
        if (a.controller_id != null && String(a.controller_id).trim() !== '') {
            node.setAttribute('data-controller-id', String(a.controller_id).trim());
        }
        if (a.bus_type)
            node.setAttribute('data-bus-type', String(a.bus_type));
        if (a.address != null && String(a.address).trim() !== '')
            node.setAttribute('data-address', String(a.address).trim());
        if (a.function_type)
            node.setAttribute('data-function-type', String(a.function_type));
        if (a.module_type)
            node.setAttribute('data-module-type', String(a.module_type));
        if (a.alias)
            node.setAttribute('data-alias', String(a.alias));
        if (a.binding_id)
            node.setAttribute('data-hmi-binding-id', String(a.binding_id));
        if (a.view_id)
            node.setAttribute('data-hmi-view-id', String(a.view_id));
    });
    // ------------------------------------------------------------
    // 2) HMI/SCADA Designer Bindings -> data-hmi-ui-*
    // ------------------------------------------------------------
    var hmiUi = state.get('hmi') || {};
    var uiBindings = Array.isArray(hmiUi.bindings) ? hmiUi.bindings : [];
    var uiWidgets = Array.isArray(hmiUi.widgets) ? hmiUi.widgets : [];
    var widgetById = {};
    uiWidgets.forEach(function (w) {
        if (w && w.widget_id)
            widgetById[w.widget_id] = w;
    });
    uiBindings.forEach(function (b) {
        if (!b || !b.element_id)
            return;
        var node = findNodeById(b.element_id);
        if (!node)
            return;
        if (b.binding_id)
            node.setAttribute('data-hmi-ui-binding-id', String(b.binding_id));
        if (b.widget_id)
            node.setAttribute('data-hmi-ui-widget-id', String(b.widget_id));
        if (b.view_id)
            node.setAttribute('data-hmi-ui-view-id', String(b.view_id));
        // Placement
        var plc = b.placement || null;
        if (plc && typeof plc === 'object') {
            if (plc.anchor)
                node.setAttribute('data-hmi-ui-anchor', String(plc.anchor));
            if (plc.dx != null && String(plc.dx).trim() !== '')
                node.setAttribute('data-hmi-ui-dx', String(plc.dx));
            if (plc.dy != null && String(plc.dy).trim() !== '')
                node.setAttribute('data-hmi-ui-dy', String(plc.dy));
        }
        // Source
        var src = b.source || null;
        if (src && typeof src === 'object') {
            if (src.kind)
                node.setAttribute('data-hmi-ui-source-kind', String(src.kind));
            if (src.field)
                node.setAttribute('data-hmi-ui-source-field', String(src.field));
            if (src.sensor_id != null)
                node.setAttribute('data-hmi-ui-sensor-id', String(src.sensor_id));
            if (src.actuator_id != null)
                node.setAttribute('data-hmi-ui-actuator-id', String(src.actuator_id));
            if (src.state_id != null)
                node.setAttribute('data-hmi-ui-state-id', String(src.state_id));
        }
        // Widget-Metadaten (minimal)
        var w = b.widget_id ? widgetById[b.widget_id] : null;
        if (w) {
            if (w.type)
                node.setAttribute('data-hmi-ui-widget-type', String(w.type));
            var lbl = null;
            if (w.config && typeof w.config === 'object') {
                if (w.config.label != null && String(w.config.label).trim() !== '')
                    lbl = String(w.config.label);
            }
            if (!lbl && w.name)
                lbl = String(w.name);
            if (lbl)
                node.setAttribute('data-hmi-ui-widget-label', lbl);
        }
    });
}
function sanitizeExportBaseName(rawName) {
    var base = String(rawName || 'export').trim();
    base = base.replace(/[^\w.\-]+/g, '_');
    if (!base)
        base = 'export';
    return base;
}
function generateSvgStringForExport() {
    var canvas = document.getElementById('main-canvas');
    if (!canvas) {
        console.warn('generateSvgStringForExport: main-canvas nicht gefunden');
        return '';
    }
    var clonedCanvas = canvas.cloneNode(true);
    var gridBg = clonedCanvas.querySelector('#grid-background');
    if (gridBg)
        gridBg.remove();
    clonedCanvas.querySelectorAll('.selected').forEach(function (el) {
        el.classList.remove('selected');
    });
    try {
        applyHmiDataAttributes(clonedCanvas);
    }
    catch (e) {
        console.warn('generateSvgStringForExport: applyHmiDataAttributes fehlgeschlagen', e);
    }
    // Der Klon traegt noch die Zoom-/Pan-Transformation der Arbeitsflaeche. Fuer
    // eine Exportdatei ist das falsch: sie soll die Anlage zeigen, nicht den
    // Bildausschnitt, in dem gerade gearbeitet wurde.
    var layer = clonedCanvas.querySelector('#elements-layer');
    if (layer)
        layer.removeAttribute('transform');
    // Zustands-CSS einbetten und viewBox setzen. Erst dadurch ist die SVG-Datei
    // fuer sich genommen animierbar — vorher setzte die Laufzeit Klassen, zu
    // denen es in der Datei keine einzige Regel gab.
    try {
        var live = document.getElementById('main-canvas');
        var box = null;
        if (live) {
            var liveLayer = live.querySelector('#elements-layer');
            try {
                var bbox = (liveLayer || live).getBBox();
                if (bbox && bbox.width > 1 && bbox.height > 1) {
                    var pad = Math.max(24, Math.min(bbox.width, bbox.height) * 0.05);
                    box = { x: Math.round(bbox.x - pad), y: Math.round(bbox.y - pad),
                        width: Math.round(bbox.width + pad * 2),
                        height: Math.round(bbox.height + pad * 2) };
                }
            }
            catch (inner) {
                box = null;
            }
        }
        makeSvgAnimatable(clonedCanvas, {
            viewBox: box,
            title: 'HMI ' + (state.get('projektName') || 'Anlage'),
            eventAnimations: ((state.get('hmi') || {}).event_animations || [])
        });
    }
    catch (e) {
        console.warn('generateSvgStringForExport: Animationsschicht fehlgeschlagen', e);
    }
    // Die V9-Konfiguration reist im SVG mit. Damit ist das Anlagenbild
    // selbsttragend: geht die Worker-Config verloren, genügt diese eine Datei
    // zum Wiederanlauf — byte-genau und mit unverändertem Fingerprint.
    try {
        var snapshot = collectConfigSnapshot();
        if (snapshot)
            embedSnapshot(clonedCanvas, snapshot);
    }
    catch (e) {
        console.warn('generateSvgStringForExport: Snapshot konnte nicht eingebettet werden', e);
    }
    var serializer = new XMLSerializer();
    return serializer.serializeToString(clonedCanvas);
}
/**
 * Sammelt die Konfigurationsstände, die mit ins SVG sollen.
 *
 * Primärquelle ist der Rohtext, den der V9-Store beim Laden behalten hat:
 * nur er trägt die Gleitkomma-Literale, an denen der Runtime-Fingerprint
 * hängt. Fehlt er, wird aus dem Objekt serialisiert — dann steht im Snapshot,
 * dass der Fingerprint lokal gebildet wurde.
 */
// Die vom Server geholten Shard-Dateien. Wird von `exportiereScadaBundle()`
// vor dem SVG-Aufbau gefüllt, damit `generateSvgStringForExport()` synchron
// bleiben kann.
var shardSnapshotCache = null;
/**
 * Holt die Shard-Dateien vom Server — byte-genau, wie sie auf dem Worker
 * liegen. Schlägt das fehl, bleibt der Cache leer und der Snapshot greift auf
 * die lokale Projektion zurück (dann steht das auch so in `source`).
 */
async function loadShardFiles() {
    var api = window.__v9;
    shardSnapshotCache = [];
    if (!api || typeof api.getConfig !== 'function')
        return;
    var config = api.getConfig();
    if (!config)
        return;
    var targets = [];
    try {
        var split = api.splitShards(config);
        split.local.forEach(function (shard, nodeId) {
            targets.push({ url: '/api/v9/shard/' + encodeURIComponent(nodeId) + '?format=text',
                source: 'GET /api/v9/shard/' + nodeId });
        });
        split.cross.forEach(function (shard, owner) {
            targets.push({ url: '/api/v9/cross/' + encodeURIComponent(owner) + '?format=text',
                source: 'GET /api/v9/cross/' + owner });
        });
    }
    catch (error) {
        console.warn('[snapshot] Shard-Liste konnte nicht bestimmt werden:', error);
        return;
    }
    for (var i = 0; i < targets.length; i += 1) {
        try {
            var response = await fetch(targets[i].url, { cache: 'no-store' });
            if (!response.ok)
                throw new Error('HTTP ' + response.status);
            shardSnapshotCache.push({
                text: await response.text(),
                source: targets[i].source,
                fingerprint: response.headers.get('X-Config-Fingerprint') || ''
            });
        }
        catch (error) {
            console.warn('[snapshot] Shard nicht abrufbar:', targets[i].url, error);
        }
    }
}
function collectConfigSnapshot() {
    var api = window.__v9;
    if (!api || typeof api.getConfig !== 'function')
        return null;
    var config = api.getConfig();
    if (!config)
        return null;
    var entries = [];
    var sourceText = typeof api.getSourceText === 'function' ? api.getSourceText() : '';
    var text = sourceText || (typeof api.formatConfig === 'function'
        ? api.formatConfig(config) : JSON.stringify(config, null, 2) + '\n');
    entries.push(describeConfig(text, {
        source: sourceText ? 'v9_store (Originaltext)' : 'v9_store (neu serialisiert)',
        fingerprint: typeof api.getFingerprint === 'function' ? api.getFingerprint() : ''
    }));
    // Die Shards mitnehmen: nach einem Ausfall braucht man genau das, was auf
    // dem Worker LAG — nicht eine Neuberechnung davon.
    //
    // Deshalb kommen sie bevorzugt aus dem Shard-Cache, den `exportiereScadaBundle`
    // vorher vom Server geholt hat. Eine lokale Projektion wäre inhaltlich
    // richtig, aber nicht byte-gleich zur Datei auf dem Worker: der Server
    // kanonisiert beim Schreiben die Zahlentypen, und `1000` gegen `1000.0`
    // ändert den Fingerprint. Ein Snapshot mit abweichendem Fingerprint ist
    // genau dann wertlos, wenn man ihn braucht.
    var cached = shardSnapshotCache || [];
    if (cached.length) {
        cached.forEach(function (item) {
            try {
                entries.push(describeConfig(item.text, {
                    source: item.source, fingerprint: item.fingerprint || ''
                }));
            }
            catch (error) {
                console.warn('[snapshot] Shard übersprungen:', item.source, error);
            }
        });
    }
    else {
        try {
            if (api.splitShards && typeof api.formatConfig === 'function') {
                var split = api.splitShards(config);
                split.local.forEach(function (shard) {
                    entries.push(describeConfig(api.formatConfig(shard), { source: 'splitShards (lokal projiziert)' }));
                });
                split.cross.forEach(function (shard) {
                    entries.push(describeConfig(api.formatConfig(shard), { source: 'splitShards (lokal projiziert)' }));
                });
            }
        }
        catch (error) {
            console.warn('[snapshot] Shards konnten nicht projiziert werden:', error);
        }
    }
    return buildSnapshot(entries, {
        project: state.get('projektName') || '',
        producer: 'Automated_SVG_Integration ' + (window.__appVersion || '54.3'),
        notes: 'Konfigurationssicherung im Anlagenbild. Wiederherstellung: '
            + 'python3 _tools/config_snapshot.py restore <datei>.svg'
    });
}
/**
 * Liest einen Snapshot aus einem SVG und ordnet ihn gegenüber dem laufenden
 * Stand ein. Rückgabe für die Oberfläche aufbereitet.
 */
export function inspectSvgSnapshot(svgText, head) {
    var snapshot = extractSnapshot(svgText);
    if (!snapshot)
        return { found: false };
    var report = verifySnapshot(snapshot);
    var entry = pickConfig(snapshot);
    return {
        found: true,
        snapshot: snapshot,
        report: report,
        entry: entry,
        comparison: entry ? compareWithHead(entry, head || null) : null
    };
}
function buildScadaHtmlLayer(baseName) {
    var svgFile = './' + baseName + '.svg';
    var jsonFile = './' + baseName + '.json';
    // ✅ Pfad ggf. in deiner HMI/SCADA Web-App anpassen:
    var runtimeModule = './hmi_runtime.js';
    return [
        '<!doctype html>',
        '<html lang="de">',
        '<head>',
        '  <meta charset="utf-8"/>',
        '  <meta name="viewport" content="width=device-width, initial-scale=1"/>',
        '  <title>HMI Layer - ' + baseName + '</title>',
        '  <style>',
        '    html, body { height: 100%; margin: 0; }',
        '    body { background: #0b1220; color: #e5e7eb; font-family: system-ui, sans-serif; }',
        '    #hmi-stage { position: relative; width: 100%; height: 100%; overflow: hidden; }',
        '    #hmi-svg-host { position: relative; width: 100%; height: 100%; }',
        '    #hmi-svg-host svg { width: 100%; height: 100%; display: block; }',
        '    .hmi-runtime-widget { position: absolute; box-sizing: border-box;',
        '      padding: 2px 6px; border: 1px solid rgba(148,163,184,.5); border-radius: 4px;',
        '      background: rgba(15,23,42,.72); font-size: 12px; line-height: 1.2;',
        '      white-space: nowrap; pointer-events: auto; }',
        '    .hmi-runtime-widget--incomplete { border-style: dashed; opacity: .8; }',
        '  </style>',
        '  ' + animationStyleTag(),
        '</head>',
        '<body>',
        '  <div id="hmi-stage">',
        '    <div id="hmi-svg-host"></div>',
        '  </div>',
        '  <script type="module">',
        '    const SVG_FILE = ' + JSON.stringify(svgFile) + ';',
        '    const JSON_FILE = ' + JSON.stringify(jsonFile) + ';',
        '    const RUNTIME_MODULE = ' + JSON.stringify(runtimeModule) + ';',
        '',
        '    async function fetchText(url) {',
        '      const r = await fetch(url, { cache: "no-store" });',
        '      if (!r.ok) throw new Error("Fetch failed: " + url + " (" + r.status + ")");',
        '      return await r.text();',
        '    }',
        '',
        '    async function fetchJson(url) {',
        '      const r = await fetch(url, { cache: "no-store" });',
        '      if (!r.ok) throw new Error("Fetch failed: " + url + " (" + r.status + ")");',
        '      return await r.json();',
        '    }',
        '',
        '    async function boot() {',
        '      const host = document.getElementById("hmi-svg-host");',
        '      const svgText = await fetchText(SVG_FILE);',
        '      host.innerHTML = svgText;',
        '',
        '      // SVG Root finden',
        '      const svgRoot = host.querySelector("svg#main-canvas") || host.querySelector("svg");',
        '      if (!svgRoot) throw new Error("SVG root nicht gefunden");',
        '',
        '      const cfg = await fetchJson(JSON_FILE);',
        '      const hmiUi = (cfg && cfg.hmi_ui) ? cfg.hmi_ui : {};',
        '      const viewId = (hmiUi && hmiUi.active_view_id) ? hmiUi.active_view_id : "main";',
        '',
        '      const mod = await import(RUNTIME_MODULE);',
        '      if (!mod || typeof mod.createHmiRuntime !== "function") {',
        '        throw new Error("createHmiRuntime fehlt in " + RUNTIME_MODULE);',
        '      }',
        '',
        '      const runtime = mod.createHmiRuntime({',
        '        svgRoot: svgRoot,',
        '        hmiUi: hmiUi,',
        '        viewId: viewId,',
        '        onInteraction: function(info) {',
        '          // ✅ Hier HMI/SCADA-IO ankoppeln (Actuator Write, etc.)',
        '          console.log("HMI interaction:", info);',
        '        }',
        '      });',
        '',
        '      window.hmiRuntime = runtime;',
        '      window.hmiSignalTimer = startSignalBridge(runtime, hmiUi);',
        '    }',
        '',
        buildSignalBridge({ sourceUrl: './signals.json', intervalMs: 1000 })
            .split('\n').map(function (line) { return '    ' + line; }).join('\n'),
        '',
        '    boot().catch(err => {',
        '      console.error(err);',
        '      document.body.insertAdjacentHTML("beforeend", "<pre style=\\"padding:12px;white-space:pre-wrap;\\">" + String(err && err.stack || err) + "</pre>");',
        '    });',
        '  </script>',
        '</body>',
        '</html>'
    ].join('\n');
}
/**
 * Startvorlage der Signalquelle.
 *
 * Die Schluessel entstehen nach derselben Regel wie in
 * `hmi_runtime.toKeyFromRef()`: `<kind>:<id>:<field>`. Wer eine eigene Quelle
 * anbindet, muss nur dieselben Schluessel bedienen — die Datei sagt ihm, wie
 * sie heissen.
 */
function buildSignalTemplate(cfg) {
    var signals = {};
    var hmiUi = (cfg && cfg.hmi_ui) ? cfg.hmi_ui : {};
    (hmiUi.bindings || []).forEach(function (binding) {
        var source = (binding && binding.source) || {};
        var kind = source.kind;
        var id = source.sensor_id;
        if (id === undefined || id === null)
            id = source.actuator_id;
        if (id === undefined || id === null)
            id = source.state_id;
        if (!kind || id === undefined || id === null)
            return;
        signals[kind + ':' + id + ':' + (source.field || 'value')] = 0;
    });
    // Ohne HMI-Bindungen wenigstens die I/O-Tabellen anbieten, damit die Datei
    // nicht leer ist und der Aufbau erkennbar bleibt.
    if (!Object.keys(signals).length) {
        (cfg.sensors || []).forEach(function (row) {
            if (row && row.sensor_id != null)
                signals['sensor:' + row.sensor_id + ':value'] = 0;
        });
        (cfg.actuators || []).forEach(function (row) {
            if (row && row.actuator_id != null)
                signals['actuator:' + row.actuator_id + ':value'] = 0;
        });
    }
    return JSON.stringify({
        _hinweis: 'Signalquelle fuer den HMI-Layer. Schluessel: <kind>:<id>:<field>. '
            + 'Eigene Quelle: HTML mit ?signals=<url> aufrufen.',
        signals: signals
    }, null, 2) + '\n';
}

function buildLogicExportContext() {
    var v9 = window.__v9;
    var canonical = v9 && typeof v9.getConfig === 'function'
        ? v9.getConfig() : (state.get('deviceConfig') || {});
    var split = null;
    var crossConfig = {};
    if (v9 && typeof v9.splitShards === 'function' && canonical) {
        try {
            split = v9.splitShards(canonical);
            if (split.cross && typeof split.cross.values === 'function') {
                var iterator = split.cross.values();
                var first = iterator.next();
                if (!first.done)
                    crossConfig = first.value;
            }
        }
        catch (error) {
            console.warn('[logic-export] Cross-Shards konnten nicht vorbereitet werden:', error);
        }
    }
    var signalCatalog = buildLogicSignalCatalog({
        deviceConfig: canonical || {},
        elements: state.get('elements') || [],
        connections: state.get('connections') || [],
        devices: state.get('devices') || { version: 1, assignments: {} },
        hmi: state.get('hmi') || {},
        processes: state.get('processes') || {},
        freeRules: state.get('free_rules') || {}
    });
    return {
        deviceConfig: canonical || {},
        crossConfig: crossConfig,
        split: split,
        signalCatalog: signalCatalog
    };
}

function downloadLogicArtifacts(base) {
    var context = buildLogicExportContext();
    var artifacts = compileLogicArtifacts(
        normalizeLogicModel(state.get('logic')),
        context
    );
    utils.downloadFile(new Blob([
        JSON.stringify(artifacts.model, null, 2) + '\n'
    ], { type: 'application/json' }), base + '.logic.json');
    utils.downloadFile(new Blob([
        JSON.stringify(artifacts.universal, null, 2) + '\n'
    ], { type: 'application/json' }), base + '.logic.runtime.json');
    utils.downloadFile(new Blob([
        JSON.stringify(artifacts.automation_v9.config, null, 2) + '\n'
    ], { type: 'application/json' }), base + '.runtime.v9.json');
    utils.downloadFile(new Blob([
        artifacts.siemens.scl + '\n'
    ], { type: 'text/plain;charset=utf-8' }), base + '.logic.scl');
    utils.downloadFile(new Blob([
        artifacts.siemens.tags_csv
    ], { type: 'text/csv;charset=utf-8' }), base + '.logic.tags.csv');
    utils.downloadFile(new Blob([
        JSON.stringify(artifacts.report, null, 2) + '\n'
    ], { type: 'application/json' }), base + '.logic.report.json');

    var crossRules = artifacts.automation_v9.cross_rules || [];
    if (crossRules.length && context.split && context.split.cross) {
        var grouped = new Map();
        crossRules.forEach(function (rule) {
            var owner = String(rule.owner_node_id || 'fn-01');
            if (!grouped.has(owner))
                grouped.set(owner, []);
            grouped.get(owner).push(rule);
        });
        grouped.forEach(function (rules, owner) {
            var crossBase = context.split.cross.get(owner) || {};
            var compiled = applyLogicCrossRulesToV8(crossBase, rules);
            var safeOwner = owner.replace(/[^A-Za-z0-9_.-]+/g, '_');
            utils.downloadFile(new Blob([
                JSON.stringify(compiled.config, null, 2) + '\n'
            ], { type: 'application/json' }), base + '.runtime.v8_cross_' + safeOwner + '.json');
        });
    }
    return artifacts;
}

async function exportiereScadaBundle() {
    try {
        var base = sanitizeExportBaseName(state.get('projektName') || 'export');
        // Die Shard-Dateien vom Server holen, BEVOR das SVG gebaut wird — nur so
        // enthält der Snapshot exakt die Bytes, die auf den Workern liegen.
        await loadShardFiles();
        // 1) SVG
        var svg = generateSvgStringForExport();
        if (!svg) {
            showStatus('Export abgebrochen: SVG konnte nicht erzeugt werden', 'error');
            return;
        }
        // 2) JSON (Runtime-Config)
        var cfg = buildExportConfig(state);
        var report = validateExportConfig(cfg);
        if (report.errors && report.errors.length) {
            console.error('Export-Validierung (Errors):', report.errors);
            if (report.warnings && report.warnings.length)
                console.warn('Export-Validierung (Warnings):', report.warnings);
            showStatus('Export abgebrochen: ' + report.errors[0], 'error');
            return;
        }
        if (report.warnings && report.warnings.length) {
            console.warn('Export-Validierung (Warnings):', report.warnings);
            showStatus('Export-Hinweis: ' + report.warnings[0], 'warning');
        }
        var json = formatJsonInput(cfg, 2);
        // 3) HTML Layer
        var html = buildScadaHtmlLayer(base);
        // Startvorlage fuer die Signalquelle. Ohne sie faellt das Bundle beim
        // ersten Oeffnen in den Demo-Modus; mit ihr laeuft es sofort gegen echte
        // Schluessel und der Anwender muss nur noch die Werte liefern lassen.
        var signals = buildSignalTemplate(cfg);
        // Downloads (6 core files plus derived PF-LOGIC artifacts)
        utils.downloadFile(utils.svgToBlob(svg), base + '.svg');
        utils.downloadFile(new Blob([json], { type: 'application/json' }), base + '.json');
        utils.downloadFile(new Blob([html], { type: 'text/html' }), base + '.html');
        utils.downloadFile(new Blob([signals], { type: 'application/json' }), 'signals.json');
        var logicArtifacts = downloadLogicArtifacts(base);
        // V52-Fix (B-15): Der erzeugte HTML-Layer importiert './hmi_runtime.js'
        // V64: hmi_runtime.js imports the event runtime explicitly; both module
        // files therefore travel together and remain locally executable.
        Promise.all([
            fetch('/public/js/hmi_runtime.js'),
            fetch('/public/js/svg_event_runtime.js')
        ])
            .then(function (responses) {
            responses.forEach(function (response) {
                if (!response.ok)
                    throw new Error('HTTP ' + response.status);
            });
            return Promise.all(responses.map(function (response) {
                return response.text();
            }));
        })
            .then(function (sources) {
            utils.downloadFile(new Blob([sources[0]], { type: 'text/javascript' }), 'hmi_runtime.js');
            utils.downloadFile(new Blob([sources[1]], { type: 'text/javascript' }), 'svg_event_runtime.js');
            var logicStatus = logicArtifacts.report.status === 'FAILED'
                ? ' (Logikbericht enthält Fehler)' : '';
            showStatus('Export: Plant/HMI-Bundle und PF-LOGIC-V1-Zielartefakte erstellt' + logicStatus, logicArtifacts.report.status === 'FAILED' ? 'warning' : 'success');
        })
            .catch(function (error) {
            console.warn('[export] HMI-Laufzeitmodule konnten nicht beigelegt werden:', error);
            showStatus('Export: SVG + JSON + HTML erstellt — HMI-Laufzeitmodule bitte manuell '
                + 'aus public/js/ danebenlegen.', 'warning', 6000);
        });
    }
    catch (e) {
        handleError(e, 'Export fehlgeschlagen');
    }
}
// ✅ Button im Export-Tab nutzt denselben Bundle-Export
function exportiereConfigAlsJson() {
    exportiereScadaBundle().catch(function (e) { handleError(e, 'Export fehlgeschlagen'); });
}
/* function exportiereConfigAlsJson() {
  try {
    const cfg = buildExportConfig(state);

    const report = validateExportConfig(cfg);
    if (report.errors && report.errors.length) {
      console.error('Export-Validierung (Errors):', report.errors);
      if (report.warnings && report.warnings.length) console.warn('Export-Validierung (Warnings):', report.warnings);
      showStatus('Export abgebrochen: ' + report.errors[0], 'error');
      return;
    }
    if (report.warnings && report.warnings.length) {
      console.warn('Export-Validierung (Warnings):', report.warnings);
      showStatus('Export-Hinweis: ' + report.warnings[0], 'warning');
    }

    // ✅ Formatter wirklich verwenden (wie Template-Stil)
    const json = formatJsonInput(cfg, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const base = String(state.get('projektName') || 'device_config_export')
      .trim()
      .replace(/[^\w.\-]+/g, '_');

    const a = document.createElement('a');
    a.href = url;
    a.download = base + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
    showStatus('Config exportiert', 'success');
  } catch (e) {
    handleError(e, 'Export fehlgeschlagen');
  }
} */
// Button im Export-Tab anbinden (Konfig-Export)
(function initConfigExportButton() {
    var btn = document.getElementById('btn-exportieren-alt');
    if (!btn) {
        console.warn('Config-Export-Button (btn-exportieren-alt) nicht gefunden');
        return;
    }
    btn.addEventListener('click', exportiereConfigAlsJson);
})();
// ============================================================================
// Application-Start
// ============================================================================
// Warten bis DOM geladen ist
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        createApplicationController();
    });
}
else {
    createApplicationController();
}
console.log('✓ UI-Modul geladen');
// === Right Sidebar: Tabs, Collapse, Resize ===
function initRightSidebar() {
    var doc = document;
    var root = doc.documentElement;
    var sidebar = doc.getElementById('sidebar-right');
    var splitter = doc.getElementById('right-splitter');
    var collapseBtn = doc.getElementById('btn-right-collapse');
    var tabsRoot = doc.getElementById('right-tabs');
    if (!sidebar || !splitter || !collapseBtn || !tabsRoot) {
        console.warn('Right sidebar: DOM-Elemente nicht gefunden, Initialisierung übersprungen');
        return;
    }
    // --- Persistente Einstellungen (Breite, Collapsed) aus CSS + localStorage ---
    (function restoreSidebarState() {
        try {
            var cs = getComputedStyle(root);
            var remember = parseInt(cs.getPropertyValue('--sidebar-right-remember')) || 0; // 0 => CSS dominiert
            var minW = parseInt(cs.getPropertyValue('--sidebar-right-min')) || 240;
            var maxW = parseInt(cs.getPropertyValue('--sidebar-right-max')) || 560;
            // collapsed
            var savedCollapsed = localStorage.getItem('sidebarRightCollapsed');
            if (savedCollapsed === '1') {
                sidebar.classList.add('collapsed');
                splitter.classList.add('hidden');
                collapseBtn.setAttribute('aria-expanded', 'false');
            }
            else {
                collapseBtn.setAttribute('aria-expanded', 'true');
            }
            // width
            var savedWidth = localStorage.getItem('sidebarRightWidth');
            if (remember === 1 && savedWidth && /^\d+$/.test(savedWidth)) {
                var w = Math.max(minW, Math.min(maxW, parseInt(savedWidth, 10)));
                root.style.setProperty('--sidebar-right-width', String(w) + 'px');
            }
        }
        catch (e) {
            // bewusst still: bei Problemen mit localStorage oder CSS geht nur Persistenz verloren
            console.warn('Right sidebar: Persistenz konnte nicht vollständig wiederhergestellt werden', e);
        }
    })();
    // --- Tabs ----
    function createTabController(rootEl) {
        var buttons = Array.from(rootEl.querySelectorAll('.tab-list .tab'));
        var panels = Array.from(rootEl.querySelectorAll('.tab-panels .tab-panel'));
        function setActive(name) {
            buttons.forEach(function (btn) {
                var on = btn.dataset.tab === name;
                btn.classList.toggle('active', on);
                btn.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            panels.forEach(function (panel) {
                var on = panel.id === 'tab-' + name;
                panel.classList.toggle('active', on);
            });
        }
        function handleClick(ev) {
            var name = ev.currentTarget && ev.currentTarget.dataset ? ev.currentTarget.dataset.tab : null;
            if (name) {
                setActive(name);
            }
        }
        buttons.forEach(function (btn) {
            btn.addEventListener('click', handleClick);
        });
        // Falls kein Tab aktiv markiert ist, Elements als Default setzen
        var anyActive = buttons.some(function (b) { return b.classList.contains('active'); });
        if (!anyActive) {
            setActive('elements');
        }
        return {
            setActive: setActive
        };
    }
    var tabs = createTabController(tabsRoot);
    // --- Collapse-Button ---
    collapseBtn.addEventListener('click', function () {
        var collapsed = sidebar.classList.toggle('collapsed');
        splitter.classList.toggle('hidden', collapsed);
        collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        try {
            localStorage.setItem('sidebarRightCollapsed', collapsed ? '1' : '0');
        }
        catch (e) {
            // kein Drama
        }
    });
    // --- Resize (Splitter-Drag) ---
    var isResizing = false;
    var startX = 0;
    var startWidth = 0;
    function pxToInt(v) {
        return parseInt(String(v).replace('px', '').trim(), 10) || 0;
    }
    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }
    splitter.addEventListener('mousedown', function (ev) {
        isResizing = true;
        startX = ev.clientX;
        var cs = getComputedStyle(root);
        startWidth = pxToInt(cs.getPropertyValue('--sidebar-right-width')) || sidebar.offsetWidth;
        document.body.classList.add('resizing-right');
        ev.preventDefault();
    });
    /*   document.addEventListener('mousemove', function (ev) {
        if (!isResizing) return;
        var dx = ev.clientX - startX;
        var cs = getComputedStyle(root);
        var minW = pxToInt(cs.getPropertyValue('--sidebar-right-min')) || 240;
        var maxW = pxToInt(cs.getPropertyValue('--sidebar-right-max')) || 560;
        var newW = clamp(startWidth + dx, minW, maxW);
        root.style.setProperty('--sidebar-right-width', String(newW) + 'px');
      }); */
    document.addEventListener('mousemove', function (ev) {
        if (!isResizing)
            return;
        // Rechts angedockte Sidebar:
        // Maus nach rechts -> Sidebar wird kleiner
        // Maus nach links  -> Sidebar wird größer
        var dx = ev.clientX - startX;
        var cs = getComputedStyle(root);
        var minW = pxToInt(cs.getPropertyValue('--sidebar-right-min')) || 240;
        var maxW = pxToInt(cs.getPropertyValue('--sidebar-right-max')) || 560;
        // WICHTIG: invertieren!
        var newW = clamp(startWidth - dx, minW, maxW);
        root.style.setProperty('--sidebar-right-width', String(newW) + 'px');
    });
    document.addEventListener('mouseup', function () {
        if (!isResizing)
            return;
        isResizing = false;
        document.body.classList.remove('resizing-right');
        var w = sidebar.getBoundingClientRect().width;
        try {
            localStorage.setItem('sidebarRightWidth', String(Math.round(w)));
        }
        catch (e) {
            // egal
        }
    });
    console.log('✓ Right Sidebar initialisiert', { tabs: !!tabs });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRightSidebar);
}
else {
    initRightSidebar();
}
