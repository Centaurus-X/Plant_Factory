/**
 * device.js - Device/IO-Bindings (Controller/Bus/Adresse/Funktion + Device/Sensor/Actuator)
 *
 * - Datenquelle: /api/device-config
 * - Persistenz: state.devices.assignments[elementId] = {...}
 * - Events: 'devices:updated', 'devices:loaded'
 * - Export-Hook: wird von model_adapter / ui.js genutzt (state.devices)
 */
import { api, state, showStatus, handleError } from './core.js';
import { elementManager } from './elements.js';
// ---- Helpers ----
function uniq(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }
function byId(id) { return document.getElementById(id); }
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function escapeAttr(v) {
    // für Attribute reicht HTML-escaping in der Regel aus
    return escapeHtml(v);
}
function toNumberOrNull(v) {
    if (v === null || v === undefined)
        return null;
    const t = String(v).trim();
    if (t === '')
        return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}
// ---- State Access (kein OOP) ----
function ensureDevicesState() {
    const s = state.get('devices');
    // Migration: alte Projekte hatten device-bindings unter state.hmi.assignments
    if ((!s || typeof s !== 'object') && state.get('hmi') && state.get('hmi').assignments) {
        state.set('devices', { version: 1, assignments: JSON.parse(JSON.stringify(state.get('hmi').assignments)) });
        return;
    }
    if (!s || typeof s !== 'object') {
        state.set('devices', { version: 1, assignments: {} });
    }
    else if (!s.assignments || typeof s.assignments !== 'object') {
        state.set('devices', { version: s.version || 1, assignments: {} });
    }
}
function getDevicesAssignments() {
    const s = state.get('devices') || {};
    return s.assignments || {};
}
// Exporte für andere Module
export function listAssignedSensors() {
    return Object.values(getDevicesAssignments()).filter(function (a) {
        return a && a.role === 'sensor';
    });
}
export function listAssignedActuators() {
    return Object.values(getDevicesAssignments()).filter(function (a) {
        return a && a.role === 'actuator';
    });
}
export function getDeviceAssignmentFor(elementId) {
    return getDevicesAssignments()[elementId] || null;
}
// ---- UI Controller (funktional) ----
const ctx = {
    container: null,
    config: null,
    assignments: {},
    assignmentsExpanded: false,
    watchersBound: false
};
async function loadConfig() {
    try {
        const cfg = await api.getDeviceConfig();
        ctx.config = cfg || { controllers: [], actuators: [], sensors: [], devices: [], sensor_types: [], modbus_functions: [] };
        // globaler Snapshot für andere Tabs (Processes/Rules)
        state.set('deviceConfig', ctx.config);
    }
    catch (e) {
        ctx.config = { controllers: [], actuators: [], sensors: [], devices: [], sensor_types: [], modbus_functions: [] };
        handleError(e, 'Device-Konfiguration konnte nicht geladen werden');
    }
}
function buildUI() {
    if (!ctx.container)
        return;
    ctx.container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'hmi-root'; // Styling weiterverwenden
    const form = document.createElement('div');
    form.className = 'hmi-form';
    form.innerHTML = `
    <div class="form-row device-assignment-target-row">
      <div class="form-group">
        <label for="device-element-select">Element</label>
        <select id="device-element-select" class="select-input"></select>
      </div>
      <div class="form-group">
        <label for="device-role">Rolle</label>
        <select id="device-role" class="select-input">
          <option value="device">Device</option>
          <option value="actuator">Actuator</option>
          <option value="sensor">Sensor</option>
        </select>
      </div>
    </div>

    <div id="device-dynamic-fields" class="dynamic-grid"></div>

    <div class="form-row device-assignment-actions">
      <button id="device-assign-btn" class="btn btn-primary">Zuweisung speichern</button>
      <button id="device-remove-btn" class="btn btn-danger">Zuweisung entfernen</button>
      <span class="hint-text">Zuweisungen werden projektweit im Register gespeichert.</span>
    </div>

    <hr class="sep" />

    <section class="device-assignment-register" aria-labelledby="device-assignments-title">
      <button id="device-assignments-toggle" class="device-assignment-register__toggle" type="button" aria-expanded="false" aria-controls="device-assignments-panel">
        <span id="device-assignments-title">Aktuelle Zuordnungen</span>
        <span id="device-assignments-count" class="device-assignment-register__count">0</span>
        <span class="device-assignment-register__chevron" aria-hidden="true">⌄</span>
      </button>
      <div id="device-assignments-panel" class="device-assignment-register__panel" hidden>
        <div id="device-assignments-table"></div>
      </div>
    </section>
  `;
    root.appendChild(form);
    ctx.container.appendChild(root);
    byId('device-assign-btn').addEventListener('click', handleAssign);
    byId('device-remove-btn').addEventListener('click', handleRemoveAssignment);
    byId('device-assignments-toggle').addEventListener('click', toggleAssignmentsRegister);
    byId('device-role').addEventListener('change', function () { renderDynamicFields(); });
    byId('device-element-select').addEventListener('change', populateFromExisting);
}

function setAssignmentsRegisterExpanded(expanded) {
    ctx.assignmentsExpanded = Boolean(expanded);
    const toggle = byId('device-assignments-toggle');
    const panel = byId('device-assignments-panel');
    if (toggle)
        toggle.setAttribute('aria-expanded', ctx.assignmentsExpanded ? 'true' : 'false');
    if (panel)
        panel.hidden = !ctx.assignmentsExpanded;
}

function toggleAssignmentsRegister() {
    setAssignmentsRegisterExpanded(!ctx.assignmentsExpanded);
}
function refreshElementList() {
    const select = byId('device-element-select');
    if (!select)
        return;
    const elements = elementManager.getAllElements();
    const saved = select.value;
    select.innerHTML = '<option value="">Element wählen...</option>';
    elements.forEach(function (item) {
        const id = item.data?.id || item.id;
        const label = item.data?.name || item.data?.templateId || id;
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `${label} (${id})`;
        select.appendChild(option);
    });
    if (saved)
        select.value = saved;
    renderDynamicFields();
}
function selectCurrentCanvasElement(selectedIds) {
    const source = Array.isArray(selectedIds) ? selectedIds : [];
    if (source.length !== 1)
        return false;
    const elementId = String(source[0] || '');
    const select = byId('device-element-select');
    if (!elementId || !select)
        return false;
    const option = Array.from(select.options).find(function (candidate) {
        return candidate.value === elementId;
    });
    if (!option)
        return false;
    select.value = elementId;
    populateFromExisting();
    return true;
}

function preferredRoleForElement(elementId) {
    const item = elementManager.getElement(elementId);
    const data = item && item.data ? item.data : {};
    const bindings = Array.isArray(data.bindings) ? data.bindings : [];
    const binding = bindings.find(function (candidate) {
        return candidate && ['sensor', 'actuator', 'device'].includes(candidate.role);
    });
    if (binding)
        return binding.role;
    if (data.templateId === 'Generic_Sensor_Entity')
        return 'sensor';
    return '';
}

function populateFromExisting() {
    const elementId = byId('device-element-select')?.value || '';
    if (!elementId) {
        renderDynamicFields();
        return;
    }
    const a = getDeviceAssignmentFor(elementId);
    if (a) {
        byId('device-role').value = a.role || 'device';
        renderDynamicFields(a.role, a);
    }
    else {
        const preferredRole = preferredRoleForElement(elementId);
        if (preferredRole)
            byId('device-role').value = preferredRole;
        renderDynamicFields(byId('device-role').value || 'device', null);
    }
}
function renderDynamicFields(forceRole, existing) {
    const role = forceRole || byId('device-role')?.value || 'device';
    const holder = byId('device-dynamic-fields');
    if (!holder)
        return;
    const cfg = ctx.config || {};
    const controllersReal = cfg.controllers || [];
    const virtualControllers = cfg.virtual_controllers || [];
    // Für Auswahl/Anzeige: reale + virtuelle Controller zusammenführen (virtuelle bekommen bus_type='virtual')
    const controllers = controllersReal
        .map(function (c) {
        return Object.assign({ __virtual: false }, c);
    })
        .concat((virtualControllers || []).map(function (v) {
        const obj = Object.assign({ __virtual: true }, v);
        if (!obj.bus_type)
            obj.bus_type = 'virtual';
        if (!obj.device_name)
            obj.device_name = obj.name || ('virtual_controller_' + String(obj.controller_id));
        return obj;
    }));
    const sensorsCfg = cfg.sensors || [];
    const actuatorsCfg = cfg.actuators || [];
    const devicesCfg = cfg.devices || [];
    const assignments = getDevicesAssignments();
    const modbusFunctions = uniq((cfg.modbus_functions || []).map(function (m) {
        return m.modbus_function_type;
    }));
    function uniqNum(list) {
        const out = new Set();
        (list || []).forEach(function (x) {
            const n = toNumberOrNull(x);
            if (n != null)
                out.add(n);
        });
        return Array.from(out).sort(function (a, b) {
            return a - b;
        });
    }
    function nextFreeIdForRole(r) {
        const ids = [];
        if (r === 'actuator') {
            (actuatorsCfg || []).forEach(function (a) {
                return ids.push(a && a.actuator_id);
            });
            Object.values(assignments || {}).forEach(function (a) { if (a && a.role === 'actuator')
                ids.push(a.actuator_id); });
        }
        else if (r === 'sensor') {
            (sensorsCfg || []).forEach(function (s) {
                return ids.push(s && s.sensor_id);
            });
            Object.values(assignments || {}).forEach(function (a) { if (a && a.role === 'sensor')
                ids.push(a.sensor_id); });
        }
        else {
            (devicesCfg || []).forEach(function (d) {
                return ids.push(d && d.device_id);
            });
            Object.values(assignments || {}).forEach(function (a) { if (a && a.role === 'device')
                ids.push(a.device_id); });
        }
        const nums = uniqNum(ids);
        const max = nums.length ? Math.max.apply(null, nums) : 0;
        return max + 1;
    }
    function nextFreeControllerId() {
        const ids = (controllers || [])
            .map(function (c) {
            return toNumberOrNull(c && c.controller_id);
        })
            .filter(function (n) {
            return n != null;
        });
        const max = ids.length ? Math.max.apply(null, ids) : 0;
        return max + 1;
    }
    function mergeExistingIds(r) {
        const ids = new Set();
        if (r === 'actuator') {
            (actuatorsCfg || []).forEach(function (a) { const n = toNumberOrNull(a && a.actuator_id); if (n != null)
                ids.add(n); });
            Object.values(assignments || {}).forEach(function (a) { if (a && a.role === 'actuator') {
                const n = toNumberOrNull(a.actuator_id);
                if (n != null)
                    ids.add(n);
            } });
            return Array.from(ids).sort(function (a, b) {
                return a - b;
            }).map(function (n) {
                return ({ actuator_id: n });
            });
        }
        if (r === 'sensor') {
            (sensorsCfg || []).forEach(function (s) { const n = toNumberOrNull(s && s.sensor_id); if (n != null)
                ids.add(n); });
            Object.values(assignments || {}).forEach(function (a) { if (a && a.role === 'sensor') {
                const n = toNumberOrNull(a.sensor_id);
                if (n != null)
                    ids.add(n);
            } });
            return Array.from(ids).sort(function (a, b) {
                return a - b;
            }).map(function (n) {
                return ({ sensor_id: n });
            });
        }
        (devicesCfg || []).forEach(function (d) { const n = toNumberOrNull(d && d.device_id); if (n != null)
            ids.add(n); });
        Object.values(assignments || {}).forEach(function (a) { if (a && a.role === 'device') {
            const n = toNumberOrNull(a.device_id);
            if (n != null)
                ids.add(n);
        } });
        return Array.from(ids).sort(function (a, b) {
            return a - b;
        }).map(function (n) {
            return ({ device_id: n });
        });
    }
    function numberInput(id, label, val, attrs = '') {
        return `<div class="form-group"><label for="${id}">${escapeHtml(label)}</label><input id="${id}" class="text-input" type="number" value="${val ?? ''}" ${attrs}/></div>`;
    }
    function textInput(id, label, val, placeholder = '') {
        return `<div class="form-group"><label for="${id}">${escapeHtml(label)}</label><input id="${id}" class="text-input" type="text" value="${val ?? ''}" placeholder="${escapeHtml(placeholder)}"/></div>`;
    }
    function selectInput(id, label, list) {
        const opts = ['<option value="">–</option>'].concat((list || []).map(function (x) {
            return `<option value="${String(x)}">${escapeHtml(String(x))}</option>`;
        }));
        return `<div class="form-group"><label for="${id}">${escapeHtml(label)}</label><select id="${id}" class="select-input">${opts.join('')}</select></div>`;
    }
    function selectFromObjects(id, label, arr, valueKey, labelKey) {
        const opts = ['<option value="">–</option>'].concat((arr || []).map(function (o) {
            return `<option value="${String(o[valueKey])}">${escapeHtml(String(o[labelKey]))}</option>`;
        }));
        return `<div class="form-group"><label for="${id}">${escapeHtml(label)}</label><select id="${id}" class="select-input">${opts.join('')}</select></div>`;
    }
    // ✅ Controller-Select + Inline-Editor (ausklappbar)
    function controllerSelectWithAdd(currentVal) {
        const real = (controllers || []).filter(function (c) {
            return !c.__virtual;
        });
        const virt = (controllers || []).filter(function (c) {
            return c.__virtual;
        });
        const opts = ['<option value="">–</option>'];
        if (real.length) {
            opts.push('<optgroup label="Controller">');
            real.forEach(function (c) {
                opts.push(`<option value="${String(c.controller_id)}" data-virtual="0">${escapeHtml(c.device_name || String(c.controller_id))}</option>`);
            });
            opts.push('</optgroup>');
        }
        if (virt.length) {
            opts.push('<optgroup label="Virtual Controller">');
            virt.forEach(function (c) {
                const label = '[V] ' + String(c.device_name || c.controller_id);
                opts.push(`<option value="${String(c.controller_id)}" data-virtual="1">${escapeHtml(label)}</option>`);
            });
            opts.push('</optgroup>');
        }
        const busTypes = uniq((controllers || []).map(function (c) {
            return c.bus_type;
        }).concat(['modbus', 'virtual']).filter(Boolean));
        const busOpts = ['<option value="">–</option>'].concat(busTypes.map(function (b) {
            return `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`;
        })).join('');
        const selected = (controllers || []).find(function (c) {
            return String(c.controller_id) === String(currentVal);
        }) || null;
        const suggestedId = nextFreeControllerId();
        const preId = selected ? selected.controller_id : suggestedId;
        const preName = selected ? (selected.device_name || ('controller_' + preId)) : ('controller_' + preId);
        const selectedBus = selected ? (selected.bus_type || '') : '';
        const preBus = selectedBus ? selectedBus : (selected && selected.__virtual ? 'virtual' : 'modbus');
        const preHost = selected ? (selected.host || '') : '';
        const prePort = selected && selected.port != null ? selected.port : 502;
        const preUnit = selected ? (selected.unit || '') : '';
        return `
			<div class="form-group" style="grid-column: 1 / -1;">
				<label for="device-controller">Controller</label>

				<div style="display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center;">
					<select id="device-controller" class="select-input">${opts.join('')}</select>
					<button id="device-add-controller-btn" class="btn btn-secondary" type="button">+</button>
				</div>

				<div id="device-controller-editor"
						 data-open="0"
						 style="display:none; margin-top:10px; padding:10px;
										border:1px solid rgba(100,116,139,0.35);
										border-radius:8px;
										background:rgba(15,23,42,0.25);">

					<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px;">
						<div class="form-group">
							<label>Controller ID</label>
							<input id="device-controller-edit-id" class="text-input" type="number" value="${escapeHtml(String(preId))}" />
							<div class="hint-text">Vorschlag: ${escapeHtml(String(suggestedId))}</div>
						</div>

						<div class="form-group">
							<label>Device Name</label>
							<input id="device-controller-edit-name" class="text-input" type="text" value="${escapeHtml(String(preName))}" />
						</div>

						<div class="form-group">
							<label>Bus Type</label>
							<select id="device-controller-edit-bus" class="select-input">${busOpts}</select>
							<div class="hint-text">Tipp: <b>virtual</b> → Eintrag landet in <code>virtual_controllers</code>.</div>
						</div>

						<div class="form-group">
							<label>Host/IP</label>
							<input id="device-controller-edit-host" class="text-input" type="text" value="${escapeHtml(String(preHost))}" />
						</div>

						<div class="form-group">
							<label>Port</label>
							<input id="device-controller-edit-port" class="text-input" type="number" value="${escapeHtml(String(prePort))}" />
						</div>

						<div class="form-group">
							<label>Unit (optional)</label>
							<input id="device-controller-edit-unit" class="text-input" type="text" value="${escapeHtml(String(preUnit))}" />
						</div>
					</div>

					<div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
						<button id="device-controller-editor-save" class="btn btn-primary" type="button">Speichern</button>
						<button id="device-controller-editor-cancel" class="btn btn-secondary" type="button">Abbrechen</button>
					</div>
				</div>

				<div class="hint-text">“+” klappt die Maske aus (neu anlegen oder gewählten Controller bearbeiten).</div>
			</div>
		`;
    }
    function openControllerEditor() {
        const ed = byId('device-controller-editor');
        if (!ed)
            return;
        ed.style.display = 'block';
        ed.setAttribute('data-open', '1');
        // Prefill Bus Auswahl (falls noch nicht gesetzt)
        const busEl = byId('device-controller-edit-bus');
        if (busEl && (!busEl.value || busEl.value === ''))
            busEl.value = 'modbus';
    }
    function closeControllerEditor() {
        const ed = byId('device-controller-editor');
        if (!ed)
            return;
        ed.style.display = 'none';
        ed.setAttribute('data-open', '0');
    }
    function toggleControllerEditor() {
        const ed = byId('device-controller-editor');
        if (!ed)
            return;
        const open = ed.getAttribute('data-open') === '1';
        if (open)
            closeControllerEditor();
        else
            openControllerEditor();
    }
    function saveControllerFromEditor() {
        const idNum = toNumberOrNull(byId('device-controller-edit-id')?.value);
        if (idNum == null) {
            showStatus('Ungültige Controller ID', 'error');
            return;
        }
        const name = (byId('device-controller-edit-name')?.value || '').trim() || ('controller_' + idNum);
        const bus = (byId('device-controller-edit-bus')?.value || '').trim() || 'modbus';
        const busLower = String(bus).toLowerCase();
        const host = (byId('device-controller-edit-host')?.value || '').trim();
        const port = toNumberOrNull(byId('device-controller-edit-port')?.value) ?? 502;
        const unit = (byId('device-controller-edit-unit')?.value || '').trim();
        const cc = ctx.config || {};
        cc.controllers = cc.controllers || [];
        cc.virtual_controllers = cc.virtual_controllers || [];
        cc.controllers = cc.controllers.filter(function (c) {
            return Number(c.controller_id) !== Number(idNum);
        });
        cc.virtual_controllers = cc.virtual_controllers.filter(function (c) {
            return Number(c.controller_id) !== Number(idNum);
        });
        const payload = {
            controller_id: idNum,
            device_name: name,
            bus_type: busLower,
            host: host,
            port: port,
            unit: unit
        };
        if (busLower === 'virtual')
            cc.virtual_controllers.push(payload);
        else
            cc.controllers.push(payload);
        ctx.config = cc;
        state.set('deviceConfig', cc);
        state.set('deviceConfigUserEdited', true);
        ctx.lastControllerId = idNum;
        showStatus('Controller gespeichert', 'success');
        closeControllerEditor();
        renderDynamicFields(role, existing || null);
    }
    const ex = existing || {};
    const controllerId = ex.controller_id || ctx.lastControllerId || '';
    const busType = ex.bus_type || '';
    const address = ex.address ?? '';
    const functionType = ex.function_type || '';
    const moduleType = ex.module_type || '';
    const nameAlias = ex.alias || '';
    const widget = ex.widget || {};
    const widgetType = widget.type || '';
    const widgetLabel = widget.label || '';
    const suggestedId = nextFreeIdForRole(role);
    let html = '';
    if (role === 'actuator') {
        const actsAll = mergeExistingIds('actuator');
        html += textInput('device-actuator-id', 'Actuator ID', (ex.actuator_id != null && String(ex.actuator_id).trim() !== '') ? ex.actuator_id : String(suggestedId), 'Vorschlag: ' + String(suggestedId));
        html += selectFromObjects('device-actuator-existing', 'Vorhandener Actuator', actsAll, 'actuator_id', 'actuator_id');
        html += selectInput('device-actuator-type', 'Actuator-Typ', uniq((cfg.actuator_types || []).map(function (a) {
            return a.actuator_type;
        })));
    }
    else if (role === 'sensor') {
        const sensAll = mergeExistingIds('sensor');
        html += textInput('device-sensor-id', 'Sensor ID', (ex.sensor_id != null && String(ex.sensor_id).trim() !== '') ? ex.sensor_id : String(suggestedId), 'Vorschlag: ' + String(suggestedId));
        html += selectFromObjects('device-sensor-existing', 'Vorhandener Sensor', sensAll, 'sensor_id', 'sensor_id');
        html += selectInput('device-sensor-type', 'Sensor-Typ', (cfg.sensor_types || []).map(function (s) {
            return s.sensor_type;
        }));
    }
    else {
        const devAll = mergeExistingIds('device');
        html += textInput('device-device-id', 'Device ID', (ex.device_id != null && String(ex.device_id).trim() !== '') ? ex.device_id : String(suggestedId), 'Vorschlag: ' + String(suggestedId));
        html += selectFromObjects('device-device-existing', 'Vorhandenes Device', devAll, 'device_id', 'device_id');
        html += selectInput('device-device-type', 'Device-Typ', uniq((devicesCfg || []).map(function (d) {
            return d.device_type;
        })));
    }
    // ✅ Controller UI (mit Inline-Editor)
    html += controllerSelectWithAdd(controllerId);
    html += selectInput('device-bus-type', 'Bus-Typ', uniq((controllers || []).map(function (c) {
        return c.bus_type;
    }).concat([busType]).filter(Boolean)));
    html += numberInput('device-address', 'Adresse', address, 'step="1"');
    html += selectInput('device-function-type', 'Funktion', modbusFunctions);
    html += textInput('device-module-type', 'Modul-Typ', moduleType);
    html += textInput('device-alias', 'Alias/Name', nameAlias);
    // Widget-Config (temporär hier)
    html += `
    <div class="form-group">
      <label for="device-widget-type">Widget-Typ</label>
      <select id="device-widget-type" class="select-input">
        <option value="">–</option>
        <option value="text">Text</option>
        <option value="indicator">Indikator</option>
        <option value="button">Button</option>
        <option value="toggle">Toggle</option>
      </select>
    </div>
    <div class="form-group">
      <label for="device-widget-label">Widget-Label</label>
      <input id="device-widget-label" class="text-input" type="text" value="${escapeHtml(widgetLabel || '')}"/>
    </div>
  `;
    holder.innerHTML = `<div class="grid-2">${html}</div>`;
    function setVal(id, v) { const el = byId(id); if (el)
        el.value = v ?? ''; }
    if (role === 'actuator') {
        setVal('device-actuator-existing', ex.actuator_id || '');
        setVal('device-actuator-type', ex.actuator_type || '');
    }
    else if (role === 'sensor') {
        setVal('device-sensor-existing', ex.sensor_id || '');
        setVal('device-sensor-type', ex.sensor_type || '');
    }
    else {
        setVal('device-device-existing', ex.device_id || '');
        setVal('device-device-type', ex.device_type || '');
    }
    setVal('device-controller', controllerId);
    setVal('device-bus-type', busType);
    setVal('device-function-type', functionType);
    setVal('device-widget-type', widgetType);
    setVal('device-widget-label', widgetLabel);
    // Prefill bus select im Editor (wenn vorhanden)
    const busEdit = byId('device-controller-edit-bus');
    if (busEdit)
        busEdit.value = (controllers.find(function (c) {
            return String(c.controller_id) === String(controllerId);
        })?.bus_type) || 'modbus';
    // Bind Inline-Editor Buttons
    const addBtn = byId('device-add-controller-btn');
    if (addBtn)
        addBtn.addEventListener('click', toggleControllerEditor);
    const saveBtn = byId('device-controller-editor-save');
    if (saveBtn)
        saveBtn.addEventListener('click', saveControllerFromEditor);
    const cancelBtn = byId('device-controller-editor-cancel');
    if (cancelBtn)
        cancelBtn.addEventListener('click', closeControllerEditor);
}
function handleAssign() {
    const elementId = byId('device-element-select')?.value || '';
    if (!elementId) {
        showStatus('Bitte Element wählen', 'error');
        return;
    }
    const role = byId('device-role')?.value || 'device';
    const controllers = (ctx.config?.controllers) || [];
    const controllerId = toNumberOrNull(byId('device-controller')?.value);
    const controller = controllers.find(function (c) {
        return Number(c.controller_id) === Number(controllerId);
    });
    const common = {
        element_id: elementId,
        role: role,
        controller_id: controllerId,
        bus_type: byId('device-bus-type')?.value || controller?.bus_type || '',
        address: toNumberOrNull(byId('device-address')?.value),
        function_type: byId('device-function-type')?.value || '',
        module_type: byId('device-module-type')?.value || '',
        alias: byId('device-alias')?.value || ''
    };
    let payload;
    if (role === 'actuator') {
        payload = {
            ...common,
            actuator_id: (byId('device-actuator-id')?.value || byId('device-actuator-existing')?.value || '').trim(),
            actuator_type: byId('device-actuator-type')?.value || ''
        };
    }
    else if (role === 'sensor') {
        payload = {
            ...common,
            sensor_id: (byId('device-sensor-id')?.value || byId('device-sensor-existing')?.value || '').trim(),
            sensor_type: byId('device-sensor-type')?.value || ''
        };
    }
    else {
        payload = {
            ...common,
            device_id: (byId('device-device-id')?.value || byId('device-device-existing')?.value || '').trim(),
            device_type: byId('device-device-type')?.value || ''
        };
    }
    // Widget (optional)
    const widgetType = byId('device-widget-type')?.value || '';
    const widgetLabel = byId('device-widget-label')?.value || '';
    if (widgetType || widgetLabel) {
        payload.widget = { type: widgetType || null, label: widgetLabel || '' };
    }
    // Minimal-Validierung
    if (payload.address === null || payload.address === undefined) {
        showStatus('Adresse fehlt', 'error');
        return;
    }
    if (payload.controller_id === null || payload.controller_id === undefined) {
        showStatus('Controller fehlt', 'error');
        return;
    }
    const s = state.get('devices') || { version: 1, assignments: {} };
    s.assignments[elementId] = payload;
    state.set('devices', s);
    state.saveHistory();
    ctx.assignments = s.assignments;
    renderAssignmentsTable();
    state.emit('devices:updated', { elementId: elementId, payload: payload });
    showStatus('Device-Zuweisung gespeichert', 'success');
}
function handleRemoveAssignment() {
    const elementId = byId('device-element-select')?.value || '';
    if (!elementId) {
        showStatus('Bitte Element wählen', 'error');
        return;
    }
    const s = state.get('devices') || { version: 1, assignments: {} };
    if (s.assignments && s.assignments[elementId]) {
        delete s.assignments[elementId];
        state.set('devices', s);
        state.saveHistory();
        ctx.assignments = s.assignments;
        renderAssignmentsTable();
        state.emit('devices:updated', { elementId: elementId, removed: true });
        showStatus('Zuweisung entfernt', 'success');
    }
}
function renderAssignmentsTable() {
    const container = byId('device-assignments-table');
    if (!container)
        return;
    const s = state.get('devices') || { assignments: {} };
    ctx.assignments = s.assignments || {};
    const entries = Object.entries(ctx.assignments);
    const count = byId('device-assignments-count');
    if (count)
        count.textContent = String(entries.length);
    setAssignmentsRegisterExpanded(ctx.assignmentsExpanded);
    if (entries.length === 0) {
        container.innerHTML = '<div class="hint-text">Noch keine Zuordnungen vorhanden.</div>';
        return;
    }
    const head = `
    <div class="device-assignment-table-wrap" tabindex="0" aria-label="Aktuelle I/O-Zuordnungen">
      <div class="device-assignment-table" role="table">
        <div class="device-assignment-table__row device-assignment-table__row--head" role="row">
          <div role="columnheader">Element</div>
          <div role="columnheader">Rolle</div>
          <div role="columnheader">ID</div>
          <div role="columnheader">Controller</div>
          <div role="columnheader">Bus</div>
          <div role="columnheader">Adresse</div>
          <div role="columnheader">Funktion</div>
          <div role="columnheader">Alias</div>
        </div>
  `;
    const rows = entries.map(function ([elId, a]) {
        const idCol = a.role === 'actuator' ? a.actuator_id : a.role === 'sensor' ? a.sensor_id : a.device_id;
        const elementValue = String(elId || '');
        const aliasValue = String(a.alias || '');
        return `
      <div class="device-assignment-table__row" role="row">
        <div class="device-assignment-table__truncate" role="cell" data-label="Element" title="${escapeAttr(elementValue)}">${escapeHtml(elementValue)}</div>
        <div role="cell" data-label="Rolle">${escapeHtml(a.role || '')}</div>
        <div role="cell" data-label="ID">${escapeHtml(idCol ?? '')}</div>
        <div role="cell" data-label="Controller">${escapeHtml(a.controller_id ?? '')}</div>
        <div role="cell" data-label="Bus">${escapeHtml(a.bus_type || '')}</div>
        <div role="cell" data-label="Adresse">${escapeHtml(a.address ?? '')}</div>
        <div role="cell" data-label="Funktion">${escapeHtml(a.function_type || '')}</div>
        <div class="device-assignment-table__truncate" role="cell" data-label="Alias" title="${escapeAttr(aliasValue)}">${escapeHtml(aliasValue)}</div>
      </div>
    `;
    }).join('');
    container.innerHTML = head + rows + '</div></div>';
}
function bindWatchers() {
    if (ctx.watchersBound)
        return;
    ctx.watchersBound = true;
    state.on('state:changed', function (e) {
        if (e && e.key === 'elements') {
            refreshElementList();
        }
    });
    state.on('devices:loaded', function (payload) {
        const p = payload || {};
        const a = p.assignments || {};
        const s = state.get('devices') || { version: 1, assignments: {} };
        s.assignments = a;
        state.set('devices', s);
        refreshElementList();
        renderAssignmentsTable();
    });
    state.on('selection:changed', function (selectedIds) {
        selectCurrentCanvasElement(selectedIds);
    });
    state.on('elements:rebuilt', function () {
        refreshElementList();
        window.requestAnimationFrame(function () {
            selectCurrentCanvasElement(state.get('selectedElements') || []);
        });
    });
    state.on('history:restored', function () {
        refreshElementList();
        renderAssignmentsTable();
        window.requestAnimationFrame(function () {
            selectCurrentCanvasElement(state.get('selectedElements') || []);
        });
    });
}
async function init() {
    ensureDevicesState();
    await loadConfig();
    buildUI();
    bindWatchers();
    refreshElementList();
    renderAssignmentsTable();
    selectCurrentCanvasElement(state.get('selectedElements') || []);
    console.log('✓ Device-Modul geladen (device.js)');
}
// Container finden (Fallback falls HTML noch alte ID hat)
ctx.container = document.getElementById('device-panel') || document.getElementById('hmi-panel');
if (ctx.container) {
    init().catch(function (err) {
        return handleError(err, 'Device-Panel konnte nicht initialisiert werden');
    });
}
