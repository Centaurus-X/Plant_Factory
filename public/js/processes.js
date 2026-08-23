/**
 * processes.js – Prozess-Konfigurator (Process States)
 *
 * - Erstellt/editiert process_states auf Basis der Device-Config (___device_state_data.json)
 * - Feste Keys: state_id, p_id, p_groups[], actuator_id[], sensor_id[], p__type, value_id, mode_id, automation_parameters{}
 * - automation_parameters dynamisch nach p__type (+ allgemeines control_method, PID-Auswahl/Override)
 * - Multi-Select für Aktuatoren/Sensoren, Gruppen-Tagging
 * - Process-Library laden/speichern (projektübergreifend)
 */
import { api, state, showStatus, handleError } from './core.js';
import { elementManager } from './elements.js';
import { listAssignedActuators, listAssignedSensors } from './device.js';
function byId(id) { return document.getElementById(id); }
function uniq(a) { return Array.from(new Set(a.filter(Boolean))); }
function numOr(v, d = null) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function nextId(existing, key = 'state_id') { const ids = (existing || []).map(function (x) {
    return Number(x[key]) || 0;
}); return (Math.max(0, ...ids) + 1); }
function getSelected(el) { return Array.from(el?.selectedOptions || []).map(function (o) {
    return o.value;
}); }
function narray(arr) { return (arr || []).map(function (x) {
    return (/^\d+$/.test(String(x)) ? Number(x) : x);
}); }
function createProcessesPanelController() {
    const self = {};
    self.init = async function () {
        try {
            self.cfg = await api.getDeviceConfig();
            state.set('deviceConfig', self.cfg);
            const lib = await api.getProcessLibrary().catch(function () {
                return ({ process_states: [] });
            });
            state.set('processLibrary', lib || { process_states: [] });
        }
        catch (e) {
            handleError(e, 'Konfiguration konnte nicht geladen werden');
        }
        if (!state.get('processes'))
            state.set('processes', { process_states: [] });
        self.buildUI();
        self.bindWatchers();
        self.renderWizard();
        self.renderLibrary();
        self.renderProjectStates();
        // ✅ Automation Tabs nachladen (ohne harte Import-Abhängigkeit)
        self.initAutomationTabs();
    };
    self.bindWatchers = function () {
        if (self._bound)
            return;
        self._bound = true;
        state.on('devices:updated', function () {
            return self.refreshDynamic();
        });
        state.on('processes:loaded', function () { self.renderWizard(); self.renderProjectStates(); });
    };
    self.refreshDynamic = function () {
        self.renderWizard(); // Rebuild, damit HMI-Listen (IDs) aktuell sind
    };
    self.buildUI = function () {
        self.container.innerHTML = `
            <div class="proc-root">
                <div class="subtabs">
                    <button class="subtab active" data-proc-subtab="wizard">Erstellen</button>
                    <button class="subtab" data-proc-subtab="library">Vorlagen</button>
                    <button class="subtab" data-proc-subtab="project">Projekt-States</button>
                    <button class="subtab" data-proc-subtab="parameter_schemas">Parameter-Schemas</button>
                    <button class="subtab" data-proc-subtab="automation_config">Runtime-Hilfen</button>
                </div>

                <div class="pf-automation-authority">
                    <div class="pf-automation-authority__copy">
                        <strong>Ein gemeinsames Automationsmodell</strong>
                        <span>Process States definieren Zustände und I/O. Bedingungen und Aktionen werden unter Projektregeln erstellt; die kanonische V9-Runtime-Projektion liegt unter Runtime-Regeln V9.</span>
                    </div>
                    <div class="pf-automation-authority__actions">
                        <button type="button" class="btn btn-secondary btn-small" data-open-automation-workspace="rules">Projektregeln öffnen</button>
                        <button type="button" class="btn btn-primary btn-small" data-open-automation-workspace="v9-rules">Runtime-Regeln V9 öffnen</button>
                    </div>
                </div>

                <div id="proc-view-wizard" class="subview">
                    <div class="wizard">
                        <div class="wizard-row">
                            <div class="wizard-col">
                                <h4>1) State und Prozess</h4>
                                <div id="proc-fixed"></div>
                            </div>
                            <div class="wizard-col">
                                <h4>2) Regelungsparameter</h4>
                                <div id="proc-auto"></div>
                            </div>
                        </div>
                        <div class="wizard-row">
                            <div class="wizard-col">
                                <h4>3) I/O und Gruppen</h4>
                                <div id="proc-groups"></div>
                            </div>
                            <div class="wizard-col">
                                <h4>4) Runtime-Zuordnung</h4>
                                <div class="hint-text">Der State bleibt die einzige Zustandsdefinition. Rules referenzieren ihn über state_id; Filter und Timer werden in der kanonischen V9-Konfiguration verwaltet.</div>
                            </div>
                        </div>
                        <div class="wizard-row">
                            <button id="proc-add" class="btn btn-primary">Process State hinzufügen</button>
                            <button id="proc-save-lib" class="btn btn-success">Process-Bibliothek speichern</button>
                        </div>
                    </div>
                </div>

                <div id="proc-view-library" class="subview hidden">
                    <h4>Process-Bibliothek</h4>
                    <div id="proc-lib"></div>
                    <div class="hint-text">Vorlagen werden nicht automatisch ins Projekt übernommen.</div>
                </div>

                <div id="proc-view-project" class="subview hidden">
                    <h4>Projekt-States</h4>
                    <div id="proc-project"></div>
                </div>

                <div id="proc-view-parameter-schemas" class="subview hidden">
                    <h4>Parameter-Schemas und Mappings</h4>
                    <div id="proc-parameter-schemas"><div class="hint-text">Schema-Hilfen werden geladen…</div></div>
                </div>

                <div id="proc-view-automation-config" class="subview hidden">
                    <h4>Automation-Modell und V9-Runtime-Projektion</h4>
                    <div id="proc-automation-config"><div class="hint-text">Runtime-Hilfen werden geladen…</div></div>
                </div>

                <div id="proc-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="proc-modal-title">
                    <div class="modal-content large">
                        <div class="modal-header">
                            <h3 id="proc-modal-title">Process State bearbeiten</h3>
                            <button class="btn-icon modal-close" id="proc-modal-close">×</button>
                        </div>
                        <div class="modal-body" id="proc-modal-body"></div>
                        <div class="modal-footer">
                            <button id="proc-modal-cancel" class="btn btn-secondary">Abbrechen</button>
                            <button id="proc-modal-save" class="btn btn-primary">Speichern</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        byId('proc-add').addEventListener('click', function () { return self.handleAdd(); });
        byId('proc-save-lib').addEventListener('click', function () { return self.saveLibrary(); });
        const buttons = Array.from(self.container.querySelectorAll('.subtab[data-proc-subtab]'));
        const views = {
            wizard: byId('proc-view-wizard'),
            library: byId('proc-view-library'),
            project: byId('proc-view-project'),
            parameter_schemas: byId('proc-view-parameter-schemas'),
            automation_config: byId('proc-view-automation-config')
        };
        const show = function (name) {
            buttons.forEach(function (button) {
                button.classList.toggle('active', button.dataset.procSubtab === name);
            });
            Object.keys(views).forEach(function (key) {
                if (views[key]) views[key].classList.toggle('hidden', key !== name);
            });
        };
        buttons.forEach(function (button) {
            button.addEventListener('click', function () { show(button.dataset.procSubtab); });
        });
        Array.from(self.container.querySelectorAll('[data-open-automation-workspace]')).forEach(function (button) {
            button.addEventListener('click', function () {
                const target = String(button.dataset.openAutomationWorkspace || '');
                const tab = document.querySelector('.tab[data-tab="' + target + '"]');
                if (tab) tab.click();
            });
        });
    };
    self.initAutomationTabs = async function () {
        const schemasEl = byId('proc-parameter-schemas');
        const configEl = byId('proc-automation-config');
        if (!schemasEl || !configEl) {
            console.warn('[processes] Automation-Container nicht gefunden – Hilfen werden übersprungen');
            return;
        }
        try {
            const mod = await import('./automation_tabs.js');
            if (!mod || typeof mod.initAutomationTabs !== 'function')
                throw new Error('automation_tabs.js: export initAutomationTabs() fehlt');
            mod.initAutomationTabs({
                deviceConfig: self.cfg || state.get('deviceConfig') || {},
                mounts: { schemasEl: schemasEl, configEl: configEl }
            });
            console.log('[processes] ✓ Automation-Modell und Schema-Hilfen initialisiert');
        }
        catch (error) {
            console.warn('[processes] Automation-Hilfen konnten nicht geladen werden:', error);
            const message = 'Automation-Hilfen konnten nicht geladen werden. Prüfe public/js/automation_tabs.js und die Browser-Konsole.';
            [schemasEl, configEl].forEach(function (element) {
                element.innerHTML = '<div class="hint-text">' + message + '</div>';
            });
        }
    };
    self.renderWizard = function () {
        self.renderFixedFields();
        self.renderAutoFields();
    };
    self.getAllActuatorIds = function () {
        const fromDevices = (listAssignedActuators() || []).map(function (a) {
            return String(a.actuator_id);
        });
        const fromCfg = (self.cfg?.actuators || []).map(function (a) {
            return String(a.actuator_id);
        });
        return uniq(fromDevices.concat(fromCfg));
    };
    self.getAllSensorIds = function () {
        const fromDevices = (listAssignedSensors() || []).map(function (s) {
            return String(s.sensor_id);
        });
        const fromCfg = (self.cfg?.sensors || []).map(function (s) {
            return String(s.sensor_id);
        });
        return uniq(fromDevices.concat(fromCfg));
    };
    self.getAllTypes = function () {
        const ps = (self.cfg && self.cfg.process_states) ? self.cfg.process_states : [];
        // ✅ akzeptiert beide Schemata: p__type (Editor) und state_type (Runtime)
        const tFromCfg = uniq(ps.map(function (s) {
            return (s && (s.p__type || s.state_type)) ? (s.p__type || s.state_type) : null;
        }));
        return uniq(tFromCfg.concat([
            'heating', 'pressure', 'cooling', 'flow', 'reflux', 'pump', 'valve', 'stirring'
        ]));
    };
    self.renderFixedFields = function () {
        const el = byId('proc-fixed');
        const processes = (self.cfg?.processes || []).map(function (p) {
            return `<option value="${p.p_id}">${p.process_name || ('P' + p.p_id)} (p_id=${p.p_id})</option>`;
        }).join('');
        const modes = (self.cfg?.process_modes || []).map(function (m) {
            return `<option value="${m.mode_id}">${m.mode} (id=${m.mode_id})</option>`;
        }).join('');
        const values = (self.cfg?.process_values || []).map(function (v) {
            return `<option value="${v.value_id}">${v.state_value} (id=${v.value_id})</option>`;
        }).join('');
        const types = self.getAllTypes().map(function (t) {
            return `<option value="${t}">${t}</option>`;
        }).join('');
        const nextState = nextId((state.get('processes') || { process_states: [] }).process_states || [], 'state_id');
        const nextStateCfg = nextId((self.cfg?.process_states) || [], 'state_id');
        const suggestion = Math.max(nextState, nextStateCfg);
        const sensors = self.getAllSensorIds().map(function (id) {
            return `<option value="${id}">${id}</option>`;
        }).join('');
        const actuators = self.getAllActuatorIds().map(function (id) {
            return `<option value="${id}">${id}</option>`;
        }).join('');
        el.innerHTML = `
      <div class="grid-2">
        <div class="form-group">
          <label>state_id</label>
          <div class="inline">
            <input id="pf-state-id" class="text-input" type="number" min="1" value="${suggestion}"/>
            <button id="pf-state-next" class="btn btn-secondary">Auto</button>
          </div>
        </div>
        <div class="form-group">
          <label>p_id</label>
          <select id="pf-pid" class="select-input"><option value="">–</option>${processes}</select>
        </div>

        <div class="form-group">
          <label>p_groups</label>
          <div class="tag-input">
            <input id="pf-pgroup-in" class="text-input" placeholder="Gruppe-ID eingeben und + drücken"/>
            <button id="pf-pgroup-add" class="btn">+</button>
          </div>
          <div id="pf-pgroups" class="tags"></div>
        </div>

        <div class="form-group">
          <label>p__type</label>
          <select id="pf-ptype" class="select-input">${types}</select>
        </div>

        <div class="form-group">
          <label>mode_id</label>
          <select id="pf-mode" class="select-input"><option value="">–</option>${modes}</select>
        </div>

        <div class="form-group">
          <label>value_id</label>
          <select id="pf-value" class="select-input"><option value="">–</option>${values}</select>
        </div>

        <div class="form-group">
          <label>sensor_id (Mehrfach)</label>
          <select id="pf-sensors" class="select-input" multiple size="6">${sensors}</select>
        </div>
        <div class="form-group">
          <label>actuator_id (Mehrfach)</label>
          <select id="pf-actuators" class="select-input" multiple size="6">${actuators}</select>
        </div>
      </div>
    `;
        // V52-Fix (B-34): `suggestion` war beim Rendern eingefroren, mehrfaches
        // Klicken lieferte immer denselben Wert. Jetzt wird bei jedem Klick neu
        // aus Projekt UND Template-Config die naechste freie ID bestimmt.
        byId('pf-state-next').onclick = function () {
            const projectStates = ((state.get('processes') || {}).process_states) || [];
            const configStates = (self.cfg && self.cfg.process_states) || [];
            const used = projectStates.concat(configStates)
                .map(function (s) {
                return Number(s && s.state_id);
            })
                .filter(function (n) {
                return Number.isFinite(n);
            });
            byId('pf-state-id').value = (used.length ? Math.max(...used) : 0) + 1;
        };
        byId('pf-pgroup-add').onclick = function () {
            return self.addGroupTag();
        };
        // V52-Fix (B-3): Ohne diesen Listener blieben die typspezifischen
        // Parameterfelder beim Wechsel von p__type auf dem alten Typ stehen
        // (renderAutoFields lief nur einmal beim Rendern des Wizards).
        const typeSelect = byId('pf-ptype');
        if (typeSelect) {
            typeSelect.addEventListener('change', function () {
                try {
                    self.renderAutoFields();
                }
                catch (error) {
                    console.warn('[processes] renderAutoFields fehlgeschlagen:', error);
                }
            });
        }
    };
    self.addGroupTag = function () {
        const val = numOr(byId('pf-pgroup-in').value);
        if (val == null)
            return;
        const holder = byId('pf-pgroups');
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = String(val);
        tag.dataset.value = String(val);
        const x = document.createElement('button');
        x.className = 'tag-x';
        x.textContent = '×';
        x.onclick = function () {
            return tag.remove();
        };
        tag.appendChild(x);
        holder.appendChild(tag);
        byId('pf-pgroup-in').value = '';
    };
    self.collectGroups = function () {
        return Array.from(byId('pf-pgroups').querySelectorAll('.tag')).map(function (t) {
            return numOr(t.dataset.value);
        }).filter(function (v) {
            return v != null;
        });
    };
    self.renderAutoFields = function () {
        const el = byId('proc-auto');
        const ptype = byId('pf-ptype')?.value || 'heating';
        const pidConfigs = (self.cfg?.pid_configs || [])
            .map(function (p) {
            return `<option value="${p.pid_config_id}">PID #${p.pid_config_id}</option>`;
        })
            .join('');
        const tplById = new Map((self.cfg?.control_method_templates || [])
            .map(function (t) {
            return [String(t.template_id), t];
        }));
        const methods = (self.cfg?.control_methods || []);
        const methodOptions = methods.map(function (m) {
            const tid = String(m.template_id);
            const tpl = tplById.get(tid);
            const name = tpl ? (tpl.template_name || tpl.template_id || ('tpl_' + tid)) : ('tpl_' + tid);
            return `<option value="method:${m.method_id}">${name} (method_id ${m.method_id})</option>`;
        }).join('');
        const controlMethodOptions = `
    			<option value="">Zweipunkt (Runtime waehlt automatisch)</option>
    			<option value="PID">PID</option>
    			${methodOptions ? `<option value="" disabled>— Control Methods —</option>${methodOptions}` : ''}
    		`;
        function fieldHTML(id, label, placeholder = '') {
            return `<div class="form-group"><label for="${id}">${label}</label><input id="${id}" class="text-input" placeholder="${placeholder}"/></div>`;
        }
        function selectHTML(id, label, options) {
            return `<div class="form-group"><label for="${id}">${label}</label><select id="${id}" class="select-input">${options}</select></div>`;
        }
        // Vorschlagsfelder nach Typ
        let specific = '';
        if (ptype === 'heating')
            specific = fieldHTML('pa-heating_temp', 'heating_temp (°C)', 'z.B. 177');
        else if (ptype === 'cooling')
            specific = fieldHTML('pa-cooling_temp', 'cooling_temp (°C)', 'z.B. -10');
        else if (ptype === 'pressure')
            specific = fieldHTML('pa-pressure', 'pressure (bar)', '1.5');
        else if (ptype === 'flow')
            specific = fieldHTML('pa-flow_rate', 'flow_rate', '1000');
        else if (ptype === 'reflux')
            specific = fieldHTML('pa-reflux_rate', 'reflux_rate', '0.7');
        else if (ptype === 'pump')
            specific = fieldHTML('pa-rate', 'rate', '4') + fieldHTML('pa-power', 'power', '0');
        else if (ptype === 'valve')
            specific = fieldHTML('pa-flow_rate', 'flow_rate', '4');
        el.innerHTML = `
    			<div class="grid-2">
    				${specific}
    				${selectHTML('pa-control-method', 'control_method', controlMethodOptions)}

    				<div id="pid-box" class="form-group hidden">
    					<label>pid_config_id</label>
    					<div class="inline">
    						<select id="pa-pid-config" class="select-input"><option value="">–</option>${pidConfigs}</select>
    						<button id="pa-pid-edit" class="btn">PID bearbeiten</button>
    					</div>
    				</div>

    				<div class="form-group">
    					<label>Zusätzliche Parameter</label>
    					<div class="kv-grid" id="pa-kv"></div>
    					<div class="inline">
    						<input id="pa-k" class="text-input" placeholder="key"/><input id="pa-v" class="text-input" placeholder="value"/>
    						<button id="pa-add" class="btn">+</button>
    					</div>
    				</div>
    			</div>
    		`;
        // Events
        const cm = byId('pa-control-method');
        const pidBox = byId('pid-box');
        cm.onchange = function () { pidBox.classList.toggle('hidden', cm.value !== 'PID'); };
        byId('pa-add').onclick = function () {
            return self.addKV();
        };
        byId('pa-pid-edit').onclick = function () {
            return self.openPidModal();
        };
    };
    self.addKV = function () {
        const k = byId('pa-k').value.trim();
        const v = byId('pa-v').value.trim();
        if (!k)
            return;
        const holder = byId('pa-kv');
        const row = document.createElement('div');
        row.className = 'kv-row';
        row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span><button class="tag-x">×</button>`;
        row.querySelector('.tag-x').onclick = function () {
            return row.remove();
        };
        holder.appendChild(row);
        byId('pa-k').value = '';
        byId('pa-v').value = '';
    };
    self.openPidModal = function () {
        const modal = byId('proc-modal');
        const body = byId('proc-modal-body');
        body.innerHTML = `
      <div class="grid-3">
        <div class="form-group"><label>kp</label><input id="pid-kp" class="text-input" type="number" step="0.001" value="1.0"/></div>
        <div class="form-group"><label>ki</label><input id="pid-ki" class="text-input" type="number" step="0.001" value="0.1"/></div>
        <div class="form-group"><label>kd</label><input id="pid-kd" class="text-input" type="number" step="0.001" value="0.01"/></div>
      </div>
      <div class="hint-text">Wenn gesetzt, werden die hier eingegebenen PID-Parameter als override in <code>automation_parameters.pid_parameters</code> gespeichert.</div>
    `;
        modal.classList.remove('hidden');
        byId('proc-modal-close').onclick = function () {
            return modal.classList.add('hidden');
        };
        byId('proc-modal-cancel').onclick = function () {
            return modal.classList.add('hidden');
        };
        byId('proc-modal-save').onclick = function () {
            modal.classList.add('hidden');
        };
    };
    self.handleAdd = function () {
        const state_id = numOr(byId('pf-state-id').value);
        const p_id = numOr(byId('pf-pid').value);
        const p_groups = self.collectGroups();
        const p__type = byId('pf-ptype').value;
        const value_id = numOr(byId('pf-value').value);
        const mode_id = numOr(byId('pf-mode').value);
        const sensors = getSelected(byId('pf-sensors'));
        const actuators = getSelected(byId('pf-actuators'));
        if (!state_id || !p_id || !p__type) {
            showStatus('Bitte state_id, p_id und p__type setzen', 'error');
            return;
        }
        const ap = {};
        // spezifische Felder aus UI einsammeln
        // V52-Fix (B-2): renderAutoFields() vergibt die IDs mit Unterstrich
        // (z. B. "pa-heating_temp"), hier wurde bisher mit Bindestrich gesucht
        // ("pa-heating-temp"). Dadurch wurden heating_temp, cooling_temp,
        // flow_rate und reflux_rate NIE uebernommen — nur die einwortigen Keys.
        ['heating_temp', 'cooling_temp', 'pressure', 'flow_rate', 'reflux_rate', 'rate', 'power'].forEach(function (k) {
            const el = byId('pa-' + k);
            if (el && el.value.trim() !== '')
                ap[k] = el.value.trim();
        });
        const ctrl = byId('pa-control-method').value;
        if (ctrl)
            ap['control_method'] = ctrl;
        const pidc = byId('pa-pid-config')?.value;
        if (ctrl === 'PID' && pidc)
            ap['pid_config_id'] = numOr(pidc);
        // ggf. PID-Override aus Modal (falls Nutzer Werte eingab)
        // V52-Fix (B-4): numOr() liefert bei leerem Feld null, und
        // Number.isNaN(null) ist false — die Bedingung war IMMER wahr. Sobald das
        // PID-Modal einmal geoeffnet war, wurde pid_parameters daher stets
        // geschrieben, notfalls als {kp:null, ki:null, kd:null}.
        const kp = numOr(byId('pid-kp')?.value);
        const ki = numOr(byId('pid-ki')?.value);
        const kd = numOr(byId('pid-kd')?.value);
        if (Number.isFinite(kp) && Number.isFinite(ki) && Number.isFinite(kd)) {
            ap['pid_parameters'] = { kp, ki, kd };
        }
        // zusätzliche KV
        Array.from(byId('pa-kv').querySelectorAll('.kv-row')).forEach(function (row) {
            const k = row.querySelector('.k').textContent;
            const v = row.querySelector('.v').textContent;
            ap[k] = v;
        });
        // Kompatibilität: falls heating -> zusätzlich altes Feld abbilden
        if (p__type === 'heating' && ap['control_method'] && !ap['heating_control_method']) {
            ap['heating_control_method'] = ap['control_method'];
        }
        const obj = {
            state_id,
            p_id,
            p_groups: narray(p_groups),
            actuator_id: narray(actuators),
            sensor_id: narray(sensors),
            p__type,
            value_id,
            mode_id,
            automation_parameters: ap
        };
        const proc = state.get('processes') || { process_states: [] };
        // ✅ state_id muss im Projekt eindeutig sein
        const exists = (proc.process_states || []).some(function (x) {
            return Number(x && x.state_id) === Number(state_id);
        });
        if (exists) {
            showStatus('state_id #' + state_id + ' existiert bereits (Duplizieren oder neue ID wählen)', 'error');
            return;
        }
        proc.process_states.push(obj);
        state.set('processes', proc);
        state.saveHistory();
        self.renderProjectStates();
        showStatus('Process State hinzugefügt', 'success');
    };
    self.saveLibrary = async function () {
        try {
            const lib = state.get('processLibrary') || { process_states: [] };
            const proj = (state.get('processes') || { process_states: [] }).process_states || [];
            const merged = [...(lib.process_states || [])];
            // Merge nach state_id (einfaches Ersetzen)
            proj.forEach(function (s) {
                const ix = merged.findIndex(function (x) {
                    return Number(x.state_id) === Number(s.state_id);
                });
                if (ix >= 0)
                    merged[ix] = JSON.parse(JSON.stringify(s));
                else
                    merged.push(JSON.parse(JSON.stringify(s)));
            });
            const out = { process_states: merged };
            state.set('processLibrary', out);
            await api.saveProcessLibrary(out);
            showStatus('Process-Bibliothek gespeichert', 'success');
            self.renderLibrary();
        }
        catch (e) {
            handleError(e, 'Bibliothek speichern fehlgeschlagen');
        }
    };
    self.renderLibrary = function () {
        const el = byId('proc-lib');
        const fromCfgRaw = (self.cfg && self.cfg.process_states) ? self.cfg.process_states : [];
        const fromLibRaw = (state.get('processLibrary') && state.get('processLibrary').process_states)
            ? state.get('processLibrary').process_states
            : [];
        // ✅ Normalizer: Runtime-Schema -> Editor-Schema (nur für Anzeige/Übernahme)
        const normalize = function (s) {
            if (!s || typeof s !== 'object')
                return s;
            const out = JSON.parse(JSON.stringify(s));
            if (!out.p__type && out.state_type)
                out.p__type = out.state_type;
            if (!Array.isArray(out.sensor_id) && Array.isArray(out.sensor_ids))
                out.sensor_id = out.sensor_ids.slice();
            if (!Array.isArray(out.actuator_id) && Array.isArray(out.actuator_ids))
                out.actuator_id = out.actuator_ids.slice();
            if (!out.automation_parameters) {
                if (out.parameters && typeof out.parameters === 'object')
                    out.automation_parameters = JSON.parse(JSON.stringify(out.parameters));
                else
                    out.automation_parameters = {};
            }
            if (!Array.isArray(out.p_groups))
                out.p_groups = [];
            return out;
        };
        const fromCfg = fromCfgRaw.map(normalize);
        const fromLib = fromLibRaw.map(normalize);
        const combined = fromCfg.concat(fromLib);
        if (combined.length === 0) {
            el.innerHTML = '<div class="hint-text">Keine Einträge</div>';
            return;
        }
        el.innerHTML = combined.map(function (s) {
            return `
    			<div class="card">
    				<div class="card-title">State #${s.state_id} – ${s.p__type || 'generic'}</div>
    				<div class="card-body">
    					<div>p_id: ${s.p_id} | mode_id: ${s.mode_id ?? '–'} | value_id: ${s.value_id ?? '–'}</div>
    					<div class="btn-row">
    						<button class="btn btn-secondary" data-act="use" data-id="${s.state_id}">In Projekt übernehmen</button>
    						<button class="btn" data-act="view" data-id="${s.state_id}">Ansehen</button>
    					</div>
    				</div>
    			</div>
    		`;
        }).join('');
        el.querySelectorAll('[data-act="use"]').forEach(function (b) {
            b.onclick = function () {
                const id = Number(b.dataset.id);
                const s = combined.find(function (x) {
                    return Number(x.state_id) === id;
                });
                if (!s)
                    return;
                const proc = state.get('processes') || { process_states: [] };
                const ix = proc.process_states.findIndex(function (x) {
                    return Number(x.state_id) === id;
                });
                // ✅ Wichtig: normalized State in Projekt übernehmen
                const copy = JSON.parse(JSON.stringify(s));
                if (ix >= 0)
                    proc.process_states[ix] = copy;
                else
                    proc.process_states.push(copy);
                state.set('processes', proc);
                state.saveHistory();
                self.renderProjectStates();
                showStatus(`State ${id} übernommen`, 'success');
            };
        });
        el.querySelectorAll('[data-act="view"]').forEach(function (b) {
            b.onclick = function () {
                return self.openView(Number(b.dataset.id), combined);
            };
        });
    };
    self.openView = function (id, pool) {
        const s = pool.find(function (x) {
            return Number(x.state_id) === id;
        });
        const modal = byId('proc-modal');
        const body = byId('proc-modal-body');
        body.innerHTML = `<pre class="code">${JSON.stringify(s, null, 2)}</pre>`;
        modal.classList.remove('hidden');
        byId('proc-modal-close').onclick = function () {
            return modal.classList.add('hidden');
        };
        byId('proc-modal-cancel').onclick = function () {
            return modal.classList.add('hidden');
        };
        byId('proc-modal-save').onclick = function () {
            return modal.classList.add('hidden');
        };
    };
    self.renderProjectStates = function () {
        const el = byId('proc-project');
        const proc = state.get('processes') || { process_states: [] };
        const list = proc.process_states || [];
        if (!el)
            return;
        if (list.length === 0) {
            el.innerHTML = '<div class="hint-text">Noch keine process_states im Projekt vorhanden.</div>';
            return;
        }
        el.innerHTML = `
    			<div class="table table-proc">
    				<div class="tr th">
    					<div>state_id</div>
    					<div>p_id</div>
    					<div>p__type</div>
    					<div>sensor_id</div>
    					<div>actuator_id</div>
    					<div>mode_id</div>
    					<div>value_id</div>
    					<div>Aktion</div>
    				</div>
    				${list.map(function (s, idx) {
            return `
    					<div class="tr">
    						<div>#${s.state_id}</div>
    						<div>${s.p_id ?? '–'}</div>
    						<div>${s.p__type ?? '–'}</div>
    						<div>${(s.sensor_id || []).join(', ') || '–'}</div>
    						<div>${(s.actuator_id || []).join(', ') || '–'}</div>
    						<div>${s.mode_id ?? '–'}</div>
    						<div>${s.value_id ?? '–'}</div>
    						<div class="btn-row">
    							<button class="btn btn-secondary" data-action="edit" data-idx="${idx}">Bearbeiten</button>
    							<button class="btn btn-secondary" data-action="dup" data-idx="${idx}">Duplizieren</button>
    							<button class="btn btn-danger" data-action="del" data-idx="${idx}">Löschen</button>
    						</div>
    					</div>
    				`;
        }).join('')}
    			</div>
    		`;
        el.querySelectorAll('button[data-action="edit"]').forEach(function (b) {
            b.onclick = function () {
                return self.openEditModal(Number(b.dataset.idx));
            };
        });
        el.querySelectorAll('button[data-action="dup"]').forEach(function (b) {
            b.onclick = function () {
                return self.duplicateState(Number(b.dataset.idx));
            };
        });
        el.querySelectorAll('button[data-action="del"]').forEach(function (b) {
            b.onclick = function () {
                return self.deleteState(Number(b.dataset.idx));
            };
        });
    };
    self.openEditModal = function (idx) {
        self.editState(idx);
    };
    self.duplicateState = function (idx) {
        const proc = state.get('processes') || { process_states: [] };
        const list = proc.process_states || [];
        const src = list[idx];
        if (!src)
            return;
        const ids = list.map(function (s) {
            return Number(s && s.state_id);
        }).filter(function (n) {
            return Number.isFinite(n);
        });
        const max = ids.length ? Math.max.apply(null, ids) : 0;
        const nextId = max + 1;
        const copy = JSON.parse(JSON.stringify(src));
        copy.state_id = nextId;
        list.push(copy);
        proc.process_states = list;
        state.set('processes', proc);
        state.saveHistory();
        self.renderProjectStates();
        showStatus('Process State dupliziert (state_id ' + nextId + ')', 'success');
    };
    self.editState = function (idx) {
        const proc = state.get('processes');
        const s = proc.process_states[idx];
        const modal = byId('proc-modal');
        const body = byId('proc-modal-body');
        body.innerHTML = `
      <div class="grid-1">
        <div class="form-group"><label>state_id</label><input id="pe-id" class="text-input" type="number" value="${s.state_id}"/></div>
        <div class="form-group"><label>JSON</label><textarea id="pe-json" class="text-area" rows="16">${JSON.stringify(s, null, 2)}</textarea></div>
      </div>
    `;
        modal.classList.remove('hidden');
        byId('proc-modal-close').onclick = function () {
            return modal.classList.add('hidden');
        };
        byId('proc-modal-cancel').onclick = function () {
            return modal.classList.add('hidden');
        };
        byId('proc-modal-save').onclick = function () {
            try {
                const id = numOr(byId('pe-id').value);
                const json = JSON.parse(byId('pe-json').value);
                json.state_id = id;
                proc.process_states[idx] = json;
                state.set('processes', proc);
                state.saveHistory();
                self.renderProjectStates();
                modal.classList.add('hidden');
                showStatus('Process State gespeichert', 'success');
            }
            catch (e) {
                handleError(e, 'Ungültiges JSON');
            }
        };
    };
    self.deleteState = function (idx) {
        const proc = state.get('processes');
        proc.process_states.splice(idx, 1);
        state.set('processes', proc);
        state.saveHistory();
        self.renderProjectStates();
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.container = document.getElementById('processes-panel');
    self.cfg = null;
    self._bound = false;
    if (self.container) {
        self.init().catch(function (e) {
            return handleError(e, 'Processes-Panel init fehlgeschlagen');
        });
    }
    return self;
}
export const processesController = createProcessesPanelController();
console.log('✓ Processes-Modul geladen');
