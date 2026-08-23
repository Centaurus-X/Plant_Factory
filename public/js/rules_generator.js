/**
 * rules_generator.js – Rule-Konfigurator (dynamic_rule_engine + "freie" Automation-Tabellen)
 *
 * Patch-Ziele (fokus: SCADA/HMI/R&ID Tool stabil & ergonomisch):
 * - set_id + priority als Dropdown (Feed aus Template-JSON / fixed range 1..5)
 * - Sensor-Auswahl: immer sensor_id (aus Devices/Config), kein "Sensor Number" Chaos
 * - sensor_type als Dropdown (aus cfg.sensor_types)
 * - Rule-Objekte ohne horizontales Scrollen: kompakt anzeigen + "Details" Modal
 * - Wizard Preview + Projekt-Regeln in separaten Frames
 * - Templates/Projekt Ansicht ebenfalls ohne horizontales Scrollen
 *
 * Datenhaltung:
 * - Projektregeln: state.dynamic_rule_engine = { rule_sets: [...] }
 * - Globale Templates: state.ruleLibrary = { rule_sets: [...] }  (persistiert via /api/rule-library)
 * - Freie Tabellen (optional): state.free_rules = { timers:[], triggers:[], actions:[], transitions:[], events:[] }
 */

import { api, state, showStatus, handleError } from './core.js';
import { elementManager } from './elements.js';
import { listAssignedSensors, listAssignedActuators } from './device.js';

function byId(id) { return document.getElementById(id); }

function deepClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
}

function uniq(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }

function escapeHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  var t = String(v).trim();
  if (!t) return null;
  var n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrValue(v) {
  // erlaubt Zahl oder Formel-String (z.B. "target_temp*0.98")
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  var t = String(v).trim();
  if (!t) return null;
  var n = Number(t);
  if (Number.isFinite(n) && String(n) === t.replace(/\.0+$/, '')) return n;
  // nicht sauber numerisch => String beibehalten
  return t;
}

function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

function pretty(obj) {
  try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
}

function compactJson(obj) {
  try { return JSON.stringify(obj); } catch (_) { return String(obj); }
}

function shrinkText(text, maxLen) {
  var s = String(text === null || text === undefined ? '' : text);
  var n = Number(maxLen);
  if (!Number.isFinite(n) || n <= 0) return s;
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

function ruleSetIdentity(rs) {
  if (!rs || typeof rs !== 'object') return '';
  var sid = String(rs.set_id || '').trim();
  var pr = (rs.priority === null || rs.priority === undefined) ? '' : String(rs.priority);
  var ev = String(rs.evaluation || '').trim();
  return sid + '|' + pr + '|' + ev;
}

function ensureRuleDetailModal() {
  if (window.__ruleDetailModal && window.__ruleDetailModal.modal) return window.__ruleDetailModal;

  var modal = document.createElement('div');
  modal.className = 'modal hidden';
  modal.id = 'modal-rule-detail';

  modal.innerHTML = `
    <div class="modal-content large">
      <div class="modal-header">
        <h2 id="rule-detail-title">Rule-Details</h2>
        <button class="modal-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <pre id="rule-detail-pre" class="code code-wrap" style="white-space:pre-wrap;overflow-x:hidden;overflow-wrap:anywhere;word-break:break-word;"></pre>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary modal-cancel" type="button">Schließen</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  var close = function () { modal.classList.add('hidden'); };
  var closeBtn = modal.querySelector('.modal-close');
  var cancelBtn = modal.querySelector('.modal-cancel');
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  // Klick auf Overlay schließt
  modal.addEventListener('click', function (ev) {
    if (ev && ev.target === modal) close();
  });

  window.__ruleDetailModal = {
    modal: modal,
    title: modal.querySelector('#rule-detail-title'),
    pre: modal.querySelector('#rule-detail-pre'),
    close: close
  };

  return window.__ruleDetailModal;
}

function openRuleDetailModal(title, ruleObj) {
  var m = ensureRuleDetailModal();
  if (m.title) m.title.textContent = String(title || 'Rule-Details');
  if (m.pre) m.pre.textContent = pretty(ruleObj);
  m.modal.classList.remove('hidden');
}

function ensureStateBasics() {
  if (!state.get('dynamic_rule_engine')) state.set('dynamic_rule_engine', { rule_sets: [] });
  if (!state.get('ruleLibrary')) state.set('ruleLibrary', { rule_sets: [] });

  // optionaler Bereich für zusätzliche "freie" Tabellen (Timer/Trigger/Transition/…)
  if (!state.get('free_rules')) {
    state.set('free_rules', { version: 1, timers: [], triggers: [], actions: [], transitions: [], events: [] });
  }
}

function getDeviceConfigSnapshot(localCfg) {
  // bevorzugt: localCfg (frisch geladen), sonst state.deviceConfig
  return localCfg || state.get('deviceConfig') || {};
}

function collectTypeSuggestions(cfg, key, defaults) {
  var arr = (cfg && cfg[key]) || [];
  if (!Array.isArray(arr) || !arr.length) return defaults || [];
  // akzeptiert ["temperature", ...] ODER [{sensor_type:"temperature"}, ...]
  if (typeof arr[0] === 'string') return uniq(arr);

  var out = [];
  arr.forEach(function (x) {
    if (!x) return;
    if (x.sensor_type) out.push(x.sensor_type);
    if (x.type) out.push(x.type);
    if (x.name) out.push(x.name);
    if (x.id) out.push(x.id);
  });
  return uniq(out.concat(defaults || []));
}

function defaultSensorTypeSuggestions(cfg) {
  return collectTypeSuggestions(cfg, 'sensor_types', ['temperature', 'pressure', 'flow', 'level', 'reflux']);
}

function defaultStateTypeSuggestions(cfg) {
  var ps = (cfg && cfg.process_states) || [];
  var fromStates = ps.map(function (s) { return s && s.state_type; }).filter(Boolean);
  return uniq(fromStates.concat(['heating', 'cooling', 'pressure', 'flow', 'pump', 'valve', 'reaction']));
}

function listTemplateRuleSetIds(cfg) {
  // Feed aus template json: cfg.dynamic_rule_engine.rule_sets[*].set_id
  var dre = (cfg && cfg.dynamic_rule_engine) ? cfg.dynamic_rule_engine : {};
  var sets = (dre && dre.rule_sets) || [];
  if (!Array.isArray(sets)) sets = [];
  var ids = sets.map(function (s) { return s && s.set_id; }).filter(Boolean);
  if (!ids.length) ids = ['process_rules'];
  return uniq(ids);
}

function sensorTypeOptionsHtml(cfg, includeEmpty) {
  var types = defaultSensorTypeSuggestions(cfg);
  var opts = [];
  if (includeEmpty) opts.push('<option value="">–</option>');
  types.forEach(function (t) { opts.push('<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>'); });
  return opts.join('');
}

function listSensorsForUi(cfg) {
  // Priorität: zugewiesene Sensoren (Devices), sonst aus Device-Config
  var assigned = listAssignedSensors() || [];
  if (assigned.length) {
    return assigned.map(function (s) {
      var id = s.sensor_id;
      var a = String(s.alias || '').trim();
      var label = a ? (a + ' (sensor_id ' + id + ')') : ('sensor_id ' + id);
      return { id: id, label: label, _src: 'assigned' };
    });
  }

  var src = (cfg && cfg.sensors) || [];
  return (src || []).map(function (s) {
    var id = s.sensor_id;
    var label = 'sensor_id ' + id + (s.sensor_group ? (' – ' + s.sensor_group) : '');
    return { id: id, label: label, _src: 'config' };
  });
}

function listActuatorsForUi(cfg) {
  var assigned = listAssignedActuators() || [];
  if (assigned.length) {
    return assigned.map(function (a) {
      return {
        id: a.actuator_id,
        label: a.alias ? (a.alias + ' (actuator_id ' + a.actuator_id + ')') : ('actuator_id ' + a.actuator_id),
        _src: 'assigned'
      };
    });
  }

  var src = (cfg && cfg.actuators) || [];
  return (src || []).map(function (a) {
    return {
      id: a.actuator_id,
      label: ('actuator_id ' + a.actuator_id) + (a.actuator_group ? (' – ' + a.actuator_group) : ''),
      _src: 'config'
    };
  });
}

function listProcessIdsForUi(cfg) {
  var procs = (cfg && cfg.processes) || [];
  return (procs || []).map(function (p) {
    return { id: p.p_id, label: (p.process_name ? p.process_name : ('process_id ' + p.p_id)) };
  });
}

function listProcessValueIdsForUi(cfg) {
  var vals = (cfg && cfg.process_values) || [];
  return (vals || []).map(function (v) {
    return { id: v.value_id, label: (v.state_value ? v.state_value : ('value_id ' + v.value_id)) };
  });
}

function listProcessStateIdsForUi() {
  var ps = (state.get('processes') && state.get('processes').process_states) || [];
  return (ps || []).map(function (s) {
    return { id: s.state_id, label: (s.state_type ? (s.state_type + ' (state_id ' + s.state_id + ')') : ('state_id ' + s.state_id)) };
  });
}

function listRuleSetsFor(store) {
  var s = store || { rule_sets: [] };
  var arr = s.rule_sets || [];
  return Array.isArray(arr) ? arr : [];
}

// ==========================================

function createRulesGeneratorController() {
  const self = {};

  self.init = async function () {
    ensureStateBasics();

    try {
      self.cfg = await api.getDeviceConfig();
      state.set('deviceConfig', self.cfg || {});
    } catch (e) {
      self.cfg = {};
      handleError(e, 'Device-Konfiguration konnte nicht geladen werden');
    }

    // Rule-Library projektübergreifend laden
    await self.loadRuleLibrary();

    self.buildUI();
    self.bindWatchers();
    self.renderAll();
  };

  self.loadRuleLibrary = async function () {
    try {
      var lib = await api.getRuleLibrary();
      if (lib && typeof lib === 'object') {
        state.set('ruleLibrary', lib);
      }
    } catch (e) {
      // nicht fatal – offline/keine Datei
      state.set('ruleLibrary', state.get('ruleLibrary') || { rule_sets: [] });
    }
  };

  self.bindWatchers = function () {
    if (self._bound) return;
    self._bound = true;

    state.on('devices:updated', function () { self.refreshDropDowns(); });
    state.on('rules:loaded', function () { self.renderAll(); });
    state.on('processes:loaded', function () { self.refreshDropDowns(); self.renderAll(); });
  };

  self.buildUI = function () {
    var root = document.createElement('div');
    root.className = 'rules-root';

    root.innerHTML = `
      <div class="subtabs">
        <button class="subtab active" data-view="wizard">Erstellen</button>
        <button class="subtab" data-view="templates">Templates</button>
        <button class="subtab" data-view="project">Projekt</button>
        <button class="subtab" data-view="free">Free Rules</button>
      </div>

      <div id="rule-view-wizard" class="subview">
        <div class="wizard">
          <div class="wizard-meta">
            <div class="grid-2">
              <div class="form-group">
                <label class="required">rule_id</label>
                <input id="rule-id" class="text-input" placeholder="z.B. high_pressure_shutdown" />
              </div>
              <div class="form-group">
                <label>Rule-Set</label>
                <select id="rule-target-set" class="select-input"></select>
              </div>
            </div>

            <div class="newset">
              <button id="btn-toggle-newset" class="btn btn-secondary btn-small">+ Rule-Set anlegen</button>
              <div id="newset-fields" class="newset-fields hidden">
                <div class="grid-3">
                  <div class="form-group">
                    <label>*set_id</label>
                    <select id="newset-id" class="select-input"></select>
                  </div>
                  <div class="form-group">
                    <label>priority</label>
                    <select id="newset-priority" class="select-input"></select>
                  </div>
                  <div class="form-group">
                    <label>evaluation</label>
                    <select id="newset-evaluation" class="select-input">
                      <option value="on_event">on_event</option>
                      <option value="periodic">periodic</option>
                      <option value="manual">manual</option>
                    </select>
                  </div>
                </div>
                <button id="btn-create-set" class="btn btn-primary btn-small">Rule-Set erstellen</button>
              </div>
            </div>
          </div>

          <div class="wizard-row">
            <div class="wizard-col">
              <h4>1) Condition</h4>
              <div class="form-group">
                <label>*condition (Typ)</label>
                <select id="cond-type" class="select-input">
                  <option value="sensor">Sensor-Vergleich</option>
                  <option value="state_type">State-Type (Attribute)</option>
                  <option value="compound">Compound (AND/OR)</option>
                  <option value="expression">Freier Ausdruck</option>
                </select>
              </div>
              <div id="cond-fields"></div>
            </div>

            <div class="wizard-col">
              <h4>2) Action</h4>
              <div class="form-group">
                <label>*action (Typ)</label>
                <select id="action-type" class="select-input">
                  <option value="notify">Benachrichtigung</option>
                  <option value="process_set_value">Process (alle States): set value</option>
                  <option value="process_set_active">Process (alle States): set active</option>
                  <option value="process_state_set_value">Process-State: set value</option>
                  <option value="process_state_set_active">Process-State: set active</option>
                  <option value="state_override">State override</option>
                  <option value="emergency_shutdown">Emergency shutdown</option>
                  <option value="config_update">Config update</option>
                  <option value="custom">Custom (JSON)</option>
                </select>
              </div>
              <div id="action-fields"></div>

              <details class="adv" id="rule-adv">
                <summary>Optional: payload / undo_action</summary>
                <div class="grid-1">
                  <div class="form-group">
                    <label>payload (JSON)</label>
                    <textarea id="rule-payload" class="text-area" placeholder='{"key":"value"}'></textarea>
                  </div>
                  <div class="form-group">
                    <label>undo_action (JSON, optional)</label>
                    <textarea id="rule-undo" class="text-area" placeholder='{"type":"process_state_set_active","state_ids":[15],"active":false}'></textarea>
                  </div>
                  <div class="form-group">
                    <label><input type="checkbox" id="rule-always-rev" /> always_reversibel</label>
                  </div>
                </div>
              </details>

              <div class="wizard-actions">
                <button id="btn-rule-save" class="btn btn-primary">Rule hinzufügen</button>
                <button id="btn-rule-reset" class="btn btn-secondary">Zurücksetzen</button>
                <button id="btn-rule-cancel-edit" class="btn btn-secondary hidden">Bearbeiten abbrechen</button>
                <button id="btn-save-lib" class="btn btn-success">Bibliothek speichern</button>
              </div>
            </div>
          </div>

          <hr class="sep" />

          <div class="rule-columns">
            <div class="column">
              <h4>Preview</h4>
              <div class="rule-frame">
                <pre id="rule-preview" class="code code-wrap" style="white-space:pre-wrap;overflow-x:hidden;overflow-wrap:anywhere;word-break:break-word;">(noch keine Rule)</pre>
              </div>
            </div>
            <div class="column">
              <h4>Projekt-Regeln (aktuelles Rule-Set)</h4>
              <div class="rule-frame">
                <div id="wizard-project-rules"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="rule-view-templates" class="subview hidden">
        <div class="rule-columns">
          <div class="column">
            <h4>Templates aus Device-Config</h4>
            <div id="tpl-device"></div>
          </div>
          <div class="column">
            <h4>Globale Rule-Bibliothek (editierbar)</h4>
            <div class="btn-row">
              <button id="btn-reload-lib" class="btn btn-secondary btn-small">Neu laden</button>
              <button id="btn-import-device-to-lib" class="btn btn-secondary btn-small">Device-Templates → Bibliothek</button>
            </div>
            <div id="tpl-library"></div>
          </div>
        </div>
      </div>

      <div id="rule-view-project" class="subview hidden">
        <div class="rule-columns">
          <div class="column">
            <h4>Projekt – Rule-Sets</h4>
            <div id="project-sets"></div>
          </div>
          <div class="column">
            <h4>Hinweise</h4>
            <div class="hint-text">
              <div><span class="pill">Tipp</span> Rules lassen sich direkt im Tab <b>Erstellen</b> bearbeiten (kein Popup nötig).</div>
              <div style="margin-top:8px;"><span class="pill">Templates</span> Nutze Templates aus Device-Config oder Bibliothek als Startpunkt.</div>
            </div>
          </div>
        </div>
      </div>

      <div id="rule-view-free" class="subview hidden">
        <div class="rule-columns">
          <div class="column">
            <h4>Free Rules – Tabellen</h4>
            <div class="hint-text">Diese Tabellen sind optional. Du kannst sie projektbezogen pflegen und beim Export in die Config übernehmen.</div>
            <div id="free-editor"></div>
          </div>
          <div class="column">
            <h4>Templates (Device-Config)</h4>
            <div id="free-templates"></div>
          </div>
        </div>
      </div>
    `;

    self.container.innerHTML = '';
    self.container.appendChild(root);

    // Subtabs
    root.querySelectorAll('.subtab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var view = btn.getAttribute('data-view');
        self.showSubView(view);
      });
    });

    // Wizard events
    byId('btn-toggle-newset').addEventListener('click', function () {
      byId('newset-fields').classList.toggle('hidden');
    });
    byId('btn-create-set').addEventListener('click', function () { self.handleCreateRuleSet(); });

    byId('cond-type').addEventListener('change', function () { self.renderConditionFields(); self.updatePreview(); });
    byId('action-type').addEventListener('change', function () { self.renderActionFields(); self.updatePreview(); });

    byId('rule-target-set').addEventListener('change', function () { self.renderWizardProjectRules(); });

    // live preview on key inputs (delegiert)
    root.addEventListener('input', function (ev) {
      var id = (ev.target && ev.target.id) || '';
      if (id.indexOf('cond-') === 0 || id.indexOf('action-') === 0 || id.indexOf('rule-') === 0 || id.indexOf('newset-') === 0) {
        self.updatePreview();
      }
    });
    root.addEventListener('change', function (ev) {
      var id = (ev.target && ev.target.id) || '';
      if (id.indexOf('cond-') === 0 || id.indexOf('action-') === 0 || id.indexOf('rule-') === 0 || id.indexOf('newset-') === 0) {
        self.updatePreview();
      }
    });

    byId('btn-rule-save').addEventListener('click', function () { self.handleSaveRule(); });
    byId('btn-rule-reset').addEventListener('click', function () { self.resetWizard(); });
    byId('btn-rule-cancel-edit').addEventListener('click', function () { self.cancelEdit(); });
    byId('btn-save-lib').addEventListener('click', function () { self.persistRuleLibrary(); });

    // Templates events
    byId('btn-reload-lib').addEventListener('click', function () {
      self.loadRuleLibrary().then(function () {
        self.renderTemplatesTab();
        showStatus('Rule-Bibliothek neu geladen', 'success');
      });
    });
    byId('btn-import-device-to-lib').addEventListener('click', function () { self.importDeviceTemplatesToLibrary(); });

    // Initial render of dynamic fields
    self.renderConditionFields();
    self.renderActionFields();
  };

  self.showSubView = function (view) {
    var map = {
      wizard: 'rule-view-wizard',
      templates: 'rule-view-templates',
      project: 'rule-view-project',
      free: 'rule-view-free'
    };

    Object.keys(map).forEach(function (k) {
      var el = byId(map[k]);
      if (!el) return;
      if (k === view) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });

    // active button
    self.container.querySelectorAll('.subtab').forEach(function (b) { b.classList.remove('active'); });
    var activeBtn = self.container.querySelector('.subtab[data-view="' + view + '"]');
    if (activeBtn) activeBtn.classList.add('active');

    // render target view
    if (view === 'wizard') self.renderWizardProjectRules();
    if (view === 'templates') self.renderTemplatesTab();
    if (view === 'project') self.renderProjectTab();
    if (view === 'free') self.renderFreeTab();
  };

  self.renderAll = function () {
    self.refreshDropDowns();
    self.renderWizardProjectRules();
    self.renderTemplatesTab();
    self.renderProjectTab();
    self.renderFreeTab();
    self.updatePreview();
  };

  self.refreshDropDowns = function () {
    var cfg = getDeviceConfigSnapshot(self.cfg);

    // Wizard: Rule-Set dropdown (Index-based, damit set_id mehrfach möglich ist)
    var select = byId('rule-target-set');
    if (select) {
      var dre = state.get('dynamic_rule_engine') || { rule_sets: [] };
      var sets = listRuleSetsFor(dre);

      var prev = toNumberOrNull(select.value);
      var options = sets.map(function (s, idx) {
        var sid = String((s && s.set_id) ? s.set_id : ('set#' + idx));
        var label = sid;
        if (s && s.priority != null) label += ' (prio ' + s.priority + ')';
        if (s && s.evaluation) label += ' • ' + s.evaluation;
        return '<option value="' + idx + '">' + escapeHtml(label) + '</option>';
      });

      if (!options.length) options.push('<option value="">– (noch kein Rule-Set)</option>');

      select.innerHTML = options.join('');

      if (prev != null && prev >= 0 && prev < sets.length) select.value = String(prev);
      else if (sets.length) select.value = '0';
    }

    // New-Set: set_id aus Template-Config
    var setSel = byId('newset-id');
    if (setSel) {
      var ids = listTemplateRuleSetIds(cfg);
      var prevId = String(setSel.value || '').trim();
      setSel.innerHTML = ids.map(function (id) {
        return '<option value="' + escapeHtml(id) + '">' + escapeHtml(id) + '</option>';
      }).join('');
      if (prevId && ids.indexOf(prevId) !== -1) setSel.value = prevId;
      else setSel.value = ids[0];
    }

    // New-Set: priority 1..5
    var prSel = byId('newset-priority');
    if (prSel) {
      var prios = [1, 2, 3, 4, 5];
      var prevPr = String(prSel.value || '').trim();
      prSel.innerHTML = prios.map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join('');
      if (prevPr && prios.map(String).indexOf(prevPr) !== -1) prSel.value = prevPr;
      else prSel.value = '5';
    }
  };

  self.renderConditionFields = function () {
    var cfg = getDeviceConfigSnapshot(self.cfg);
    var type = byId('cond-type').value;
    var holder = byId('cond-fields');

    var sensors = listSensorsForUi(cfg);
    var sensorOptions = sensors.map(function (s) {
      return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.label) + '</option>';
    }).join('');

    var stateTypeOptions = defaultStateTypeSuggestions(cfg).map(function (t) {
      return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>';
    }).join('');

    var sensorTypeOptions = sensorTypeOptionsHtml(cfg, true);

    if (type === 'sensor') {
      holder.innerHTML = `
        <div class="grid-2">
          <div class="form-group">
            <label>sensor_id</label>
            <select id="cond-sensor-id" class="select-input">
              <option value="">–</option>
              ${sensorOptions}
            </select>
          </div>
          <div class="form-group">
            <label>sensor_type (optional)</label>
            <select id="cond-sensor-type" class="select-input">
              ${sensorTypeOptions}
            </select>
          </div>
        </div>
        <div class="grid-3">
          <div class="form-group">
            <label>operator</label>
            <select id="cond-operator" class="select-input">
              <option value=">=">&ge;</option>
              <option value=">">&gt;</option>
              <option value="<=">&le;</option>
              <option value="<">&lt;</option>
              <option value="==">=</option>
              <option value="!=">!=</option>
            </select>
          </div>
          <div class="form-group">
            <label>*value</label>
            <input id="cond-value" class="text-input" placeholder="z.B. 80 oder target_temp*0.98" />
          </div>
          <div class="form-group">
            <label>unit (optional)</label>
            <input id="cond-unit" class="text-input" placeholder="z.B. °C" />
          </div>
        </div>
        <div class="hint-text">Mindestens <b>sensor_id</b> oder <b>sensor_type</b> angeben. sensor_id kommt aus <b>Devices</b>. value darf Zahl oder Formel-String sein.</div>
      `;
      return;
    }

    if (type === 'state_type') {
      holder.innerHTML = `
        <div class="grid-3">
          <div class="form-group">
            <label>state_type</label>
            <input id="cond-state-type" class="text-input" list="dl-state-types" placeholder="z.B. heating" />
            <datalist id="dl-state-types">${stateTypeOptions}</datalist>
          </div>
          <div class="form-group">
            <label>attribute</label>
            <select id="cond-state-attr" class="select-input">
              <option value="active">active</option>
              <option value="value_id">value_id</option>
              <option value="mode_id">mode_id</option>
            </select>
          </div>
          <div class="form-group">
            <label>equals</label>
            <select id="cond-state-equals" class="select-input">
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
        </div>
        <div class="hint-text">Für value_id/mode_id bitte lieber <b>expression</b> nutzen (oder später erweitern).</div>
      `;
      return;
    }

    if (type === 'compound') {
      holder.innerHTML = `
        <div class="grid-2">
          <div class="form-group">
            <label>operator</label>
            <select id="cond-comp-operator" class="select-input">
              <option value="AND">AND</option>
              <option value="OR">OR</option>
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:end;gap:8px;">
            <button id="btn-add-subcond" class="btn btn-secondary btn-small">+ Unterbedingung</button>
          </div>
        </div>
        <div id="cond-comp-list" class="table"></div>
        <div class="hint-text">Unterbedingungen sind aktuell Sensor-Vergleiche (sensor_id/sensor_type + operator + value).</div>
      `;

      var btn = byId('btn-add-subcond');
      if (btn) btn.addEventListener('click', function () { self.addCompoundRow(); self.updatePreview(); });

      self.ensureAtLeastOneCompoundRow();
      return;
    }

    if (type === 'expression') {
      holder.innerHTML = `
        <div class="form-group">
          <label>*expression</label>
          <input id="cond-expr" class="text-input" placeholder='z.B. level >= target_level' />
        </div>
        <div class="hint-text">Expression wird als String in <b>condition</b> gespeichert (Backend-Auswertung später als Patch).</div>
      `;
      return;
    }

    holder.innerHTML = `<div class="hint-text">Unbekannter condition-Typ.</div>`;
  };

  self.ensureAtLeastOneCompoundRow = function () {
    var list = byId('cond-comp-list');
    if (!list) return;
    if (list.children.length === 0) self.addCompoundRow();
  };

  self.addCompoundRow = function (prefill) {
    var cfg = getDeviceConfigSnapshot(self.cfg);
    var list = byId('cond-comp-list');
    if (!list) return null;

    var sensors = listSensorsForUi(cfg);
    var sensorOptions = sensors.map(function (s) {
      return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.label) + '</option>';
    }).join('');

    var sensorTypeOptions = sensorTypeOptionsHtml(cfg, true);

    var row = document.createElement('div');
    row.className = 'tr';
    row.innerHTML = `
      <div>
        <select class="select-input cond-sub-sensor-id">
          <option value="">– sensor_id</option>
          ${sensorOptions}
        </select>
      </div>
      <div>
        <select class="select-input cond-sub-sensor-type">
          ${sensorTypeOptions}
        </select>
      </div>
      <div>
        <select class="select-input cond-sub-operator">
          <option value=">=">&ge;</option>
          <option value=">">&gt;</option>
          <option value="<=">&le;</option>
          <option value="<">&lt;</option>
          <option value="==">=</option>
          <option value="!=">!=</option>
        </select>
      </div>
      <div><input class="text-input cond-sub-value" placeholder="value"/></div>
      <div><button class="btn btn-danger btn-small cond-sub-del" type="button">×</button></div>
    `;
    list.appendChild(row);

    var del = row.querySelector('.cond-sub-del');
    if (del) del.addEventListener('click', function () {
      row.remove();
      self.ensureAtLeastOneCompoundRow();
      self.updatePreview();
    });

    // prefill
    try {
      if (prefill && typeof prefill === 'object') {
        var sidEl = row.querySelector('.cond-sub-sensor-id');
        var stEl = row.querySelector('.cond-sub-sensor-type');
        var opEl = row.querySelector('.cond-sub-operator');
        var vEl = row.querySelector('.cond-sub-value');

        if (sidEl && prefill.sensor_id != null) sidEl.value = String(prefill.sensor_id);
        if (stEl && prefill.sensor_type != null) stEl.value = String(prefill.sensor_type);
        if (opEl && prefill.operator) opEl.value = String(prefill.operator);
        if (vEl && prefill.value != null) vEl.value = String(prefill.value);
      }
    } catch (_) {}

    return row;
  };

  self.renderActionFields = function () {
    var cfg = getDeviceConfigSnapshot(self.cfg);
    var type = byId('action-type').value;
    var holder = byId('action-fields');

    var procOptions = listProcessIdsForUi(cfg).map(function (p) {
      return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + '</option>';
    }).join('');

    var valueOptions = listProcessValueIdsForUi(cfg).map(function (v) {
      return '<option value="' + escapeHtml(v.id) + '">' + escapeHtml(v.label) + '</option>';
    }).join('');

    var stateOptions = listProcessStateIdsForUi().map(function (s) {
      return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.label) + '</option>';
    }).join('');

    if (type === 'notify') {
      holder.innerHTML = `
        <div class="form-group">
          <label>*message</label>
          <input id="action-message" class="text-input" placeholder="Text..." />
        </div>
      `;
      return;
    }

    if (type === 'process_set_value') {
      holder.innerHTML = `
        <div class="grid-2">
          <div class="form-group">
            <label>*p_id (Process)</label>
            <select id="action-p-id" class="select-input"><option value="">–</option>${procOptions}</select>
          </div>
          <div class="form-group">
            <label>*value_id</label>
            <select id="action-value-id" class="select-input"><option value="">–</option>${valueOptions}</select>
          </div>
        </div>
        <div class="hint-text">Hinweis: process_set_value wirkt pro <b>Process</b> (setzt alle States laut Runtime-Logik). Für einzelne States nutze <b>process_state_…</b>.</div>
      `;
      return;
    }

    if (type === 'process_set_active') {
      holder.innerHTML = `
        <div class="grid-2">
          <div class="form-group">
            <label>*p_ids (Mehrfach)</label>
            <select id="action-p-ids" class="select-input" multiple size="6">${procOptions}</select>
          </div>
          <div class="form-group">
            <label>active</label>
            <select id="action-active" class="select-input">
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
        </div>
        <div class="hint-text">Hinweis: process_set_active wirkt pro <b>Process</b>. Für State-spezifisch nutze <b>process_state_set_active</b>.</div>
      `;
      return;
    }

    if (type === 'process_state_set_value') {
      holder.innerHTML = `
        <div class="grid-2">
          <div class="form-group">
            <label>*state_id</label>
            <select id="action-state-id" class="select-input"><option value="">–</option>${stateOptions}</select>
          </div>
          <div class="form-group">
            <label>*value_id</label>
            <select id="action-value-id2" class="select-input"><option value="">–</option>${valueOptions}</select>
          </div>
        </div>
      `;
      return;
    }

    if (type === 'process_state_set_active') {
      holder.innerHTML = `
        <div class="grid-2">
          <div class="form-group">
            <label>*state_ids (Mehrfach)</label>
            <select id="action-state-ids" class="select-input" multiple size="8">${stateOptions}</select>
          </div>
          <div class="form-group">
            <label>active</label>
            <select id="action-active2" class="select-input">
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
        </div>
      `;
      return;
    }

    if (type === 'state_override') {
      holder.innerHTML = `
        <div class="grid-2">
          <div class="form-group">
            <label>*target_meta_state</label>
            <input id="action-meta" class="text-input" placeholder="z.B. ERROR / IDLE" />
          </div>
          <div class="form-group">
            <label>reason</label>
            <input id="action-reason" class="text-input" placeholder="Warum?" />
          </div>
        </div>
      `;
      return;
    }

    if (type === 'emergency_shutdown') {
      holder.innerHTML = `
        <div class="form-group">
          <label>target</label>
          <input id="action-target" class="text-input" placeholder="z.B. all" value="all" />
        </div>
      `;
      return;
    }

    if (type === 'config_update') {
      holder.innerHTML = `
        <div class="form-group">
          <label>*payload (JSON)</label>
          <textarea id="action-payload" class="text-area" placeholder='{"state_id":1,"updates":{"parameters":{"target_temp_c":555}}}'></textarea>
        </div>
        <div class="hint-text">Für config_update ist payload Pflicht.</div>
      `;
      return;
    }

    if (type === 'custom') {
      holder.innerHTML = `
        <div class="form-group">
          <label>*action JSON</label>
          <textarea id="action-custom" class="text-area" placeholder='{"type":"notify","message":"..."}'></textarea>
        </div>
        <div class="hint-text">Nur erlaubte Actions werden beim Export übernommen (notify, emergency_shutdown, process_*, state_override, config_update).</div>
      `;
      return;
    }

    holder.innerHTML = `<div class="hint-text">Unbekannter action-Typ.</div>`;
  };

  self.buildRuleFromWizard = function () {
    var ruleId = String(byId('rule-id').value || '').trim();
    if (!ruleId) return { error: 'rule_id ist Pflicht' };

    // condition
    var condType = byId('cond-type').value;
    var condition = null;

    if (condType === 'sensor') {
      var sid = byId('cond-sensor-id') ? byId('cond-sensor-id').value : '';
      var stype = byId('cond-sensor-type') ? byId('cond-sensor-type').value : '';
      var op = byId('cond-operator') ? byId('cond-operator').value : '>=';
      var val = byId('cond-value') ? byId('cond-value').value : '';
      var unit = byId('cond-unit') ? String(byId('cond-unit').value || '').trim() : '';

      var nSid = toNumberOrNull(sid);
      var tSt = String(stype || '').trim();

      if (nSid === null && !tSt) return { error: 'condition: sensor_id oder sensor_type ist Pflicht' };

      var v = toNumberOrValue(val);
      if (v === null) return { error: 'condition: value ist Pflicht' };

      condition = { type: 'sensor', operator: op, value: v };
      if (Number.isFinite(nSid)) condition.sensor_id = nSid;
      if (tSt) condition.sensor_type = tSt;
      if (unit) condition.unit = unit;
    }

    if (condType === 'state_type') {
      var st = String(byId('cond-state-type') ? byId('cond-state-type').value : '').trim();
      if (!st) return { error: 'condition: state_type ist Pflicht' };
      var attr = String(byId('cond-state-attr') ? byId('cond-state-attr').value : 'active');
      var eq = String(byId('cond-state-equals') ? byId('cond-state-equals').value : 'true') === 'true';
      condition = { type: 'state_type', state_type: st, attribute: attr, equals: eq };
    }

    if (condType === 'compound') {
      var cop = String(byId('cond-comp-operator') ? byId('cond-comp-operator').value : 'AND') || 'AND';
      var list = byId('cond-comp-list');
      var rows = list ? Array.from(list.querySelectorAll('.tr')) : [];
      var children = [];

      rows.forEach(function (row) {
        var sidEl = row.querySelector('.cond-sub-sensor-id');
        var stEl = row.querySelector('.cond-sub-sensor-type');
        var opEl = row.querySelector('.cond-sub-operator');
        var vEl = row.querySelector('.cond-sub-value');

        var sid = sidEl ? sidEl.value : '';
        var stype = stEl ? stEl.value : '';
        var op = opEl ? opEl.value : '>=';
        var val = vEl ? vEl.value : '';

        var nSid = toNumberOrNull(sid);
        var tSt = String(stype || '').trim();
        var v = toNumberOrValue(val);

        if (nSid === null && !tSt) return;
        if (v === null) return;

        var c = { type: 'sensor', operator: op, value: v };
        if (Number.isFinite(nSid)) c.sensor_id = nSid;
        if (tSt) c.sensor_type = tSt;
        children.push(c);
      });

      if (!children.length) return { error: 'compound: Mindestens eine gültige Unterbedingung ist nötig' };
      condition = { type: 'compound', operator: cop, conditions: children };
    }

    if (condType === 'expression') {
      var expr = String(byId('cond-expr') ? byId('cond-expr').value : '').trim();
      if (!expr) return { error: 'expression: Ausdruck ist Pflicht' };
      condition = expr;
    }

    if (condition === null) return { error: 'condition konnte nicht gebaut werden' };

    // action
    var actionType = byId('action-type').value;
    var action = null;

    if (actionType === 'notify') {
      var msg = String(byId('action-message') ? byId('action-message').value : '').trim();
      if (!msg) return { error: 'action: message ist Pflicht' };
      action = { type: 'notify', message: msg };
    }

    if (actionType === 'process_set_value') {
      var p = toNumberOrNull(byId('action-p-id') ? byId('action-p-id').value : null);
      var v = toNumberOrNull(byId('action-value-id') ? byId('action-value-id').value : null);
      if (!Number.isFinite(p) || !Number.isFinite(v)) return { error: 'action: p_id und value_id sind Pflicht' };
      action = { type: 'process_set_value', p_id: p, value_id: v };
    }

    if (actionType === 'process_set_active') {
      var sel = byId('action-p-ids');
      var pids = sel ? Array.from(sel.selectedOptions || []).map(function (o) { return toNumberOrNull(o.value); }).filter(Number.isFinite) : [];
      if (!pids.length) return { error: 'action: mindestens ein p_id nötig' };
      var active = String(byId('action-active') ? byId('action-active').value : 'true') === 'true';
      action = { type: 'process_set_active', p_ids: pids, active: active };
    }

    if (actionType === 'process_state_set_value') {
      var sid2 = toNumberOrNull(byId('action-state-id') ? byId('action-state-id').value : null);
      var vid2 = toNumberOrNull(byId('action-value-id2') ? byId('action-value-id2').value : null);
      if (!Number.isFinite(sid2) || !Number.isFinite(vid2)) return { error: 'action: state_id und value_id sind Pflicht' };
      action = { type: 'process_state_set_value', state_id: sid2, value_id: vid2 };
    }

    if (actionType === 'process_state_set_active') {
      var sel2 = byId('action-state-ids');
      var sids = sel2 ? Array.from(sel2.selectedOptions || []).map(function (o) { return toNumberOrNull(o.value); }).filter(Number.isFinite) : [];
      if (!sids.length) return { error: 'action: mindestens ein state_id nötig' };
      var active2 = String(byId('action-active2') ? byId('action-active2').value : 'true') === 'true';
      action = { type: 'process_state_set_active', state_ids: sids, active: active2 };
    }

    if (actionType === 'state_override') {
      var meta = String(byId('action-meta') ? byId('action-meta').value : '').trim();
      if (!meta) return { error: 'action: target_meta_state ist Pflicht' };
      var reason = String(byId('action-reason') ? byId('action-reason').value : '').trim();
      action = { type: 'state_override', target_meta_state: meta };
      if (reason) action.reason = reason;
    }

    if (actionType === 'emergency_shutdown') {
      var tgt = String(byId('action-target') ? byId('action-target').value : 'all').trim() || 'all';
      action = { type: 'emergency_shutdown', target: tgt };
    }

    if (actionType === 'config_update') {
      var txt = String(byId('action-payload') ? byId('action-payload').value : '').trim();
      var payload = txt ? safeJsonParse(txt, null) : null;
      if (!payload) return { error: 'config_update: payload (JSON) ist Pflicht' };
      action = { type: 'config_update', payload: payload };
    }

    if (actionType === 'custom') {
      var raw = String(byId('action-custom') ? byId('action-custom').value : '').trim();
      var obj = raw ? safeJsonParse(raw, null) : null;
      if (!obj || typeof obj !== 'object') return { error: 'custom: gültiges JSON ist Pflicht' };
      if (!obj.type) return { error: 'custom: action.type fehlt' };
      action = obj;
    }

    if (!action) return { error: 'action konnte nicht gebaut werden' };

    // optionals
    var payloadTxt = String(byId('rule-payload') ? byId('rule-payload').value : '').trim();
    var undoTxt = String(byId('rule-undo') ? byId('rule-undo').value : '').trim();
    var alwaysRev = Boolean(byId('rule-always-rev') && byId('rule-always-rev').checked);

    var rule = { rule_id: ruleId, condition: condition, action: action };

    if (payloadTxt) {
      var payload2 = safeJsonParse(payloadTxt, null);
      if (!payload2 || typeof payload2 !== 'object') return { error: 'payload: ungültiges JSON' };
      rule.payload = payload2;
    }

    if (undoTxt) {
      var undo = safeJsonParse(undoTxt, null);
      if (!undo || typeof undo !== 'object') return { error: 'undo_action: ungültiges JSON' };
      rule.undo_action = undo;
    }

    if (alwaysRev) rule.always_reversibel = true;

    return { rule: rule };
  };

  self.updatePreview = function () {
    var el = byId('rule-preview');
    if (!el) return;

    var built = self.buildRuleFromWizard();
    if (built && built.rule) el.textContent = pretty(built.rule);
    else el.textContent = '(unvollständig) ' + (built && built.error ? built.error : '');
  };

  self.resetWizard = function () {
    byId('rule-id').value = '';
    self.cancelEdit();

    // cond/action defaults
    byId('cond-type').value = 'sensor';
    byId('action-type').value = 'notify';

    self.renderConditionFields();
    self.renderActionFields();

    // optional fields
    if (byId('rule-payload')) byId('rule-payload').value = '';
    if (byId('rule-undo')) byId('rule-undo').value = '';
    if (byId('rule-always-rev')) byId('rule-always-rev').checked = false;

    self.updatePreview();
  };

  self.cancelEdit = function () {
    self._edit = null;
    var btn = byId('btn-rule-save');
    if (btn) btn.textContent = 'Rule hinzufügen';
    var cancel = byId('btn-rule-cancel-edit');
    if (cancel) cancel.classList.add('hidden');
  };

  self.handleCreateRuleSet = function () {
    var setId = String(byId('newset-id') ? byId('newset-id').value : '').trim();
    if (!setId) { showStatus('set_id ist Pflicht', 'error'); return; }

    var prio = toNumberOrNull(byId('newset-priority') ? byId('newset-priority').value : 5);
    if (prio === null) prio = 5;

    var evalMode = String(byId('newset-evaluation') ? byId('newset-evaluation').value : 'on_event') || 'on_event';

    var dre = state.get('dynamic_rule_engine') || { rule_sets: [] };
    var sets = listRuleSetsFor(dre);

    var ident = ruleSetIdentity({ set_id: setId, priority: prio, evaluation: evalMode });
    if (sets.some(function (s) { return ruleSetIdentity(s) === ident; })) {
      showStatus('Rule-Set existiert bereits: ' + ident, 'error');
      return;
    }

    sets.push({ set_id: setId, priority: prio, evaluation: evalMode, rules: [] });
    state.set('dynamic_rule_engine', { rule_sets: sets });
    state.emit('rules:loaded', state.get('dynamic_rule_engine'));

    // select newly created
    self.refreshDropDowns();
    if (byId('rule-target-set')) byId('rule-target-set').value = String(sets.length - 1);

    // collapse
    byId('newset-fields').classList.add('hidden');

    showStatus('Rule-Set erstellt: ' + setId + ' (prio ' + prio + ')', 'success');
    self.renderWizardProjectRules();
  };

  self.handleSaveRule = function () {
    var built = self.buildRuleFromWizard();
    if (!built || !built.rule) {
      showStatus(built && built.error ? built.error : 'Rule ist unvollständig', 'error');
      return;
    }

    var rule = built.rule;

    // target set index
    var setIdx = toNumberOrNull(byId('rule-target-set') ? byId('rule-target-set').value : null);
    if (setIdx === null) {
      showStatus('Bitte erst ein Rule-Set auswählen/erstellen', 'error');
      return;
    }

    // Scope (aktuell: Wizard = Projekt; Library wird über Templates verwaltet)
    var storeKey = (self._edit && self._edit.scope === 'library') ? 'ruleLibrary' : 'dynamic_rule_engine';
    var store = state.get(storeKey) || { rule_sets: [] };
    var sets = listRuleSetsFor(store);

    // Ziel-Set bestimmen
    var targetIdx = setIdx;
    if (storeKey === 'ruleLibrary') {
      if (!self._edit || typeof self._edit.set_index !== 'number') {
        showStatus('Library-Edit ohne Ziel-Set ist nicht unterstützt (nutze Templates Tab)', 'error');
        return;
      }
      targetIdx = self._edit.set_index;
    }

    if (targetIdx < 0 || targetIdx >= sets.length) {
      showStatus('Rule-Set Index ungültig', 'error');
      return;
    }

    var rs = sets[targetIdx];
    rs.rules = Array.isArray(rs.rules) ? rs.rules : [];

    var existingIdx = rs.rules.findIndex(function (r) { return r && r.rule_id === rule.rule_id; });

    var editingSame = self._edit &&
      self._edit.scope === (storeKey === 'ruleLibrary' ? 'library' : 'project') &&
      self._edit.set_index === targetIdx &&
      typeof self._edit.rule_index === 'number';

    if (!editingSame && existingIdx !== -1) {
      showStatus('rule_id existiert bereits im Rule-Set: ' + rule.rule_id, 'error');
      return;
    }

    if (editingSame) {
      var idx = self._edit.rule_index;
      if (idx < 0 || idx >= rs.rules.length) idx = existingIdx;
      if (idx < 0) idx = rs.rules.length;
      rs.rules[idx] = rule;
    } else {
      rs.rules.push(rule);
    }

    sets[targetIdx] = rs;
    state.set(storeKey, { rule_sets: sets });

    if (storeKey === 'ruleLibrary') {
      self.persistRuleLibrary().then(function () { self.renderTemplatesTab(); });
      showStatus('Template-Rule aktualisiert', 'success');
    } else {
      state.emit('rules:loaded', state.get('dynamic_rule_engine'));
      showStatus(editingSame ? 'Rule aktualisiert' : 'Rule hinzugefügt', 'success');
    }

    self.cancelEdit();
    self.renderWizardProjectRules();
    self.updatePreview();
  };

  self.applyRuleToWizard = function (rule) {
    if (!rule || typeof rule !== 'object') return;

    // rule_id
    byId('rule-id').value = rule.rule_id || '';

    // condition
    var cond = rule.condition;
    if (typeof cond === 'string') {
      byId('cond-type').value = 'expression';
      self.renderConditionFields();
      if (byId('cond-expr')) byId('cond-expr').value = cond;
    } else if (cond && typeof cond === 'object') {
      if (cond.type === 'sensor') {
        byId('cond-type').value = 'sensor';
        self.renderConditionFields();
        if (byId('cond-sensor-id')) byId('cond-sensor-id').value = (cond.sensor_id != null ? String(cond.sensor_id) : '');
        if (byId('cond-sensor-type')) byId('cond-sensor-type').value = (cond.sensor_type != null ? String(cond.sensor_type) : '');
        if (byId('cond-operator')) byId('cond-operator').value = cond.operator || '>=';
        if (byId('cond-value')) byId('cond-value').value = (cond.value != null ? String(cond.value) : '');
        if (byId('cond-unit')) byId('cond-unit').value = (cond.unit != null ? String(cond.unit) : '');
      } else if (cond.type === 'state_type') {
        byId('cond-type').value = 'state_type';
        self.renderConditionFields();
        if (byId('cond-state-type')) byId('cond-state-type').value = (cond.state_type != null ? String(cond.state_type) : '');
        if (byId('cond-state-attr')) byId('cond-state-attr').value = (cond.attribute != null ? String(cond.attribute) : 'active');
        if (byId('cond-state-equals')) byId('cond-state-equals').value = (cond.equals ? 'true' : 'false');
      } else if (cond.type === 'compound') {
        byId('cond-type').value = 'compound';
        self.renderConditionFields();
        if (byId('cond-comp-operator')) byId('cond-comp-operator').value = cond.operator || 'AND';

        var list = byId('cond-comp-list');
        if (list) list.innerHTML = '';

        var arr = Array.isArray(cond.conditions) ? cond.conditions : [];
        if (!arr.length) self.ensureAtLeastOneCompoundRow();
        else {
          arr.forEach(function (c) { self.addCompoundRow(c); });
        }
      } else {
        // fallback
        byId('cond-type').value = 'expression';
        self.renderConditionFields();
        if (byId('cond-expr')) byId('cond-expr').value = compactJson(cond);
      }
    } else {
      byId('cond-type').value = 'sensor';
      self.renderConditionFields();
    }

    // action
    var act = rule.action;
    if (act && typeof act === 'object') {
      var t = act.type;

      if (t === 'notify') {
        byId('action-type').value = 'notify';
        self.renderActionFields();
        if (byId('action-message')) byId('action-message').value = act.message || '';
      } else if (t === 'process_set_value') {
        byId('action-type').value = 'process_set_value';
        self.renderActionFields();
        if (byId('action-p-id')) byId('action-p-id').value = (act.p_id != null ? String(act.p_id) : '');
        if (byId('action-value-id')) byId('action-value-id').value = (act.value_id != null ? String(act.value_id) : '');
      } else if (t === 'process_set_active') {
        byId('action-type').value = 'process_set_active';
        self.renderActionFields();
        var sel = byId('action-p-ids');
        var ids = Array.isArray(act.p_ids) ? act.p_ids.map(String) : [];
        if (sel) Array.from(sel.options || []).forEach(function (o) { o.selected = ids.indexOf(String(o.value)) !== -1; });
        if (byId('action-active')) byId('action-active').value = (act.active ? 'true' : 'false');
      } else if (t === 'process_state_set_value') {
        byId('action-type').value = 'process_state_set_value';
        self.renderActionFields();
        if (byId('action-state-id')) byId('action-state-id').value = (act.state_id != null ? String(act.state_id) : '');
        if (byId('action-value-id2')) byId('action-value-id2').value = (act.value_id != null ? String(act.value_id) : '');
      } else if (t === 'process_state_set_active') {
        byId('action-type').value = 'process_state_set_active';
        self.renderActionFields();
        var sel2 = byId('action-state-ids');
        var sids = Array.isArray(act.state_ids) ? act.state_ids.map(String) : [];
        if (sel2) Array.from(sel2.options || []).forEach(function (o) { o.selected = sids.indexOf(String(o.value)) !== -1; });
        if (byId('action-active2')) byId('action-active2').value = (act.active ? 'true' : 'false');
      } else if (t === 'state_override') {
        byId('action-type').value = 'state_override';
        self.renderActionFields();
        if (byId('action-meta')) byId('action-meta').value = act.target_meta_state || '';
        if (byId('action-reason')) byId('action-reason').value = act.reason || '';
      } else if (t === 'emergency_shutdown') {
        byId('action-type').value = 'emergency_shutdown';
        self.renderActionFields();
        if (byId('action-target')) byId('action-target').value = act.target || 'all';
      } else if (t === 'config_update') {
        byId('action-type').value = 'config_update';
        self.renderActionFields();
        if (byId('action-payload')) byId('action-payload').value = pretty(act.payload || {});
      } else {
        byId('action-type').value = 'custom';
        self.renderActionFields();
        if (byId('action-custom')) byId('action-custom').value = pretty(act);
      }
    } else {
      byId('action-type').value = 'notify';
      self.renderActionFields();
    }

    // optionals
    if (byId('rule-payload')) byId('rule-payload').value = rule.payload ? pretty(rule.payload) : '';
    if (byId('rule-undo')) byId('rule-undo').value = rule.undo_action ? pretty(rule.undo_action) : '';
    if (byId('rule-always-rev')) byId('rule-always-rev').checked = Boolean(rule.always_reversibel);

    self.updatePreview();
  };

  self.renderWizardProjectRules = function () {
    var container = byId('wizard-project-rules');
    if (!container) return;

    var setIdx = toNumberOrNull(byId('rule-target-set') ? byId('rule-target-set').value : null);
    var dre = state.get('dynamic_rule_engine') || { rule_sets: [] };
    var sets = listRuleSetsFor(dre);

    if (setIdx === null || setIdx < 0 || setIdx >= sets.length) {
      container.innerHTML = `<div class="hint-text">Noch kein Rule-Set ausgewählt.</div>`;
      return;
    }

    var rs = sets[setIdx];
    if (!rs) {
      container.innerHTML = `<div class="hint-text">Rule-Set nicht gefunden.</div>`;
      return;
    }


    var items = (rs.rules || []).map(function (r, idx) {
      var condTxt = (typeof r.condition === 'string') ? r.condition : compactJson(r.condition);
      var actTxt = compactJson(r.action);

      var condShort = shrinkText(condTxt, 180);
      var actShort = shrinkText(actTxt, 180);

      return `
        <div class="rule-item">
          <div class="rule-id">${escapeHtml(r.rule_id || '(ohne id)')}</div>
          <div class="rule-row"><span class="rule-label">if</span><span>${escapeHtml(condShort)}</span></div>
          <div class="rule-row"><span class="rule-label">do</span><span>${escapeHtml(actShort)}</span></div>
          <div class="btn-row">
            <button class="btn btn-secondary btn-small" type="button" data-detail="${idx}">Details</button>
            <button class="btn btn-secondary btn-small" type="button" data-edit="${idx}">Bearbeiten</button>
            <button class="btn btn-danger btn-small" type="button" data-del="${idx}">Löschen</button>
            <button class="btn btn-secondary btn-small" type="button" data-save-template="${idx}">Als Template</button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="rule-list">${items || '<div class="hint-text">Keine Rules im Set.</div>'}</div>`;

    container.querySelectorAll('[data-detail]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = Number(btn.getAttribute('data-detail'));
        var rule = (rs.rules || [])[idx];
        if (!rule) return;
        openRuleDetailModal(rule.rule_id || 'Rule', rule);
      });
    });

    container.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = Number(btn.getAttribute('data-edit'));
        var rule = (rs.rules || [])[idx];
        if (!rule) return;

        self._edit = { scope: 'project', set_index: setIdx, rule_index: idx };
        byId('btn-rule-save').textContent = 'Rule aktualisieren';
        byId('btn-rule-cancel-edit').classList.remove('hidden');

        self.applyRuleToWizard(rule);
      });
    });

    container.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = Number(btn.getAttribute('data-del'));
        rs.rules = rs.rules || [];
        rs.rules.splice(idx, 1);

        sets[setIdx] = rs;
        state.set('dynamic_rule_engine', { rule_sets: sets });
        state.emit('rules:loaded', state.get('dynamic_rule_engine'));

        self.renderWizardProjectRules();
        self.updatePreview();
        showStatus('Rule gelöscht', 'success');
      });
    });

    container.querySelectorAll('[data-save-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = Number(btn.getAttribute('data-save-template'));
        var rule = (rs.rules || [])[idx];
        if (!rule) return;
        self.saveRuleAsTemplate(rs, rule);
      });
    });
  };

  self.renderTemplatesTab = function () {
    var cfg = getDeviceConfigSnapshot(self.cfg);

    var dev = byId('tpl-device');
    var lib = byId('tpl-library');
    if (!dev || !lib) return;

    dev.innerHTML = self.renderRuleSetCards(listRuleSetsFor(cfg.dynamic_rule_engine || {}), 'device');
    lib.innerHTML = self.renderRuleSetCards(listRuleSetsFor(state.get('ruleLibrary') || {}), 'library');

    self.bindTemplateCardActions(dev, 'device');
    self.bindTemplateCardActions(lib, 'library');
  };

  self.renderRuleSetCards = function (ruleSets, scope) {
    var sets = ruleSets || [];
    if (!sets.length) return `<div class="hint-text">Keine Rule-Sets.</div>`;

    return sets.map(function (rs, setIndex) {
      var rules = rs.rules || [];

      var title = escapeHtml(rs.set_id || ('set#' + setIndex));
      var prio = (rs.priority != null) ? ('prio ' + rs.priority) : null;
      var evalMode = rs.evaluation ? String(rs.evaluation) : null;

      var head = `
        <div class="card">
          <div class="card-title">
            <span>${title}</span>
            <span class="pill">${rules.length} rules</span>
            ${prio ? '<span class="pill">' + escapeHtml(prio) + '</span>' : ''}
            ${evalMode ? '<span class="pill">' + escapeHtml(evalMode) + '</span>' : ''}
          </div>
          <div class="card-body" style="overflow-x:hidden;">
            ${scope === 'device' ? '<div class="btn-row"><button class="btn btn-secondary btn-small" type="button" data-tpl-copy-set="' + setIndex + '">→ Bibliothek</button></div>' : ''}
            ${scope === 'library' ? '<div class="btn-row"><button class="btn btn-secondary btn-small" type="button" data-tpl-use-set="' + setIndex + '">→ Projekt</button></div>' : ''}
      `;

      var list = rules.map(function (r, idx) {
        var condTxt = (typeof r.condition === 'string') ? r.condition : compactJson(r.condition);
        var actTxt = compactJson(r.action);

        var condShort = shrinkText(condTxt, 160);
        var actShort = shrinkText(actTxt, 160);

        return `
          <div class="rule-item">
            <div class="rule-id">${escapeHtml(r.rule_id || '(ohne id)')}</div>
            <div class="rule-row"><span class="rule-label">if</span><span>${escapeHtml(condShort)}</span></div>
            <div class="rule-row"><span class="rule-label">do</span><span>${escapeHtml(actShort)}</span></div>
            <div class="btn-row">
              <button class="btn btn-secondary btn-small" type="button" data-tpl-load="${setIndex}::${idx}">In Wizard</button>
              <button class="btn btn-secondary btn-small" type="button" data-tpl-detail="${setIndex}::${idx}">Details</button>
              ${scope === 'library' ? '<button class="btn btn-danger btn-small" type="button" data-tpl-del="'+setIndex+'::'+idx+'">Löschen</button>' : ''}
            </div>
          </div>
        `;
      }).join('');

      var foot = `
          </div>
        </div>
      `;

      return head + (list || '<div class="hint-text">Keine Rules.</div>') + foot;
    }).join('');
  };

  self.bindTemplateCardActions = function (rootEl, scope) {
    if (!rootEl) return;

    var getSourceSets = function () {
      if (scope === 'device') {
        var cfg = getDeviceConfigSnapshot(self.cfg);
        return listRuleSetsFor(cfg.dynamic_rule_engine || {});
      }
      return listRuleSetsFor(state.get('ruleLibrary') || {});
    };

    rootEl.querySelectorAll('[data-tpl-load]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var token = btn.getAttribute('data-tpl-load') || '';
        var parts = token.split('::');
        var sidx = toNumberOrNull(parts[0]);
        var ridx = toNumberOrNull(parts[1]);

        var sets = getSourceSets();
        if (sidx === null || ridx === null || sidx < 0 || sidx >= sets.length) return;

        var rs = sets[sidx];
        var rule = rs && rs.rules ? rs.rules[ridx] : null;
        if (!rule) return;

        // Template nur als Startpunkt (kein Edit-Context setzen)
        self.cancelEdit();
        self.applyRuleToWizard(rule);
        self.showSubView('wizard');
        showStatus('Template in Wizard geladen', 'success');
      });
    });

    rootEl.querySelectorAll('[data-tpl-detail]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var token = btn.getAttribute('data-tpl-detail') || '';
        var parts = token.split('::');
        var sidx = toNumberOrNull(parts[0]);
        var ridx = toNumberOrNull(parts[1]);

        var sets = getSourceSets();
        if (sidx === null || ridx === null || sidx < 0 || sidx >= sets.length) return;

        var rs = sets[sidx];
        var rule = rs && rs.rules ? rs.rules[ridx] : null;
        if (!rule) return;

        openRuleDetailModal(rule.rule_id || 'Rule', rule);
      });
    });

    rootEl.querySelectorAll('[data-tpl-copy-set]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sidx = toNumberOrNull(btn.getAttribute('data-tpl-copy-set'));
        var cfg = getDeviceConfigSnapshot(self.cfg);
        var sets = listRuleSetsFor(cfg.dynamic_rule_engine || {});
        if (sidx === null || sidx < 0 || sidx >= sets.length) return;
        self.copyRuleSetToLibrary(sets[sidx]);
      });
    });

    rootEl.querySelectorAll('[data-tpl-use-set]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sidx = toNumberOrNull(btn.getAttribute('data-tpl-use-set'));
        var sets = listRuleSetsFor(state.get('ruleLibrary') || {});
        if (sidx === null || sidx < 0 || sidx >= sets.length) return;
        self.copyRuleSetToProject(sets[sidx]);
      });
    });

    rootEl.querySelectorAll('[data-tpl-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var token = btn.getAttribute('data-tpl-del') || '';
        var parts = token.split('::');
        var sidx = toNumberOrNull(parts[0]);
        var ridx = toNumberOrNull(parts[1]);

        var lib = state.get('ruleLibrary') || { rule_sets: [] };
        var sets = listRuleSetsFor(lib);

        if (sidx === null || ridx === null || sidx < 0 || sidx >= sets.length) return;

        var rs = sets[sidx];
        rs.rules = rs.rules || [];
        rs.rules.splice(ridx, 1);

        sets[sidx] = rs;
        state.set('ruleLibrary', { rule_sets: sets });
        self.persistRuleLibrary().then(function () { self.renderTemplatesTab(); });

        showStatus('Template-Rule gelöscht', 'success');
      });
    });
  };

  self.importDeviceTemplatesToLibrary = function () {
    var cfg = getDeviceConfigSnapshot(self.cfg);
    var devSets = listRuleSetsFor(cfg.dynamic_rule_engine || {});
    if (!devSets.length) { showStatus('Keine Device-Templates gefunden', 'error'); return; }

    var lib = state.get('ruleLibrary') || { rule_sets: [] };
    var libSets = listRuleSetsFor(lib);

    var added = 0;
    devSets.forEach(function (rs) {
      if (!rs) return;
      var ident = ruleSetIdentity(rs);
      if (!ident) return;
      if (libSets.some(function (x) { return ruleSetIdentity(x) === ident; })) return;
      libSets.push(deepClone(rs));
      added += 1;
    });

    state.set('ruleLibrary', { rule_sets: libSets });

    self.persistRuleLibrary().then(function () {
      self.renderTemplatesTab();
      showStatus('Device-Templates in Bibliothek übernommen: ' + added, 'success');
    });
  };

  self.copyRuleSetToLibrary = function (ruleSet) {
    var lib = state.get('ruleLibrary') || { rule_sets: [] };
    var sets = listRuleSetsFor(lib);

    var ident = ruleSetIdentity(ruleSet);
    var exists = sets.some(function (s) { return ruleSetIdentity(s) === ident; });
    if (exists) { showStatus('Rule-Set existiert bereits in Bibliothek: ' + ident, 'error'); return; }

    sets.push(deepClone(ruleSet));
    state.set('ruleLibrary', { rule_sets: sets });

    self.persistRuleLibrary().then(function () { self.renderTemplatesTab(); });
    showStatus('Rule-Set in Bibliothek kopiert', 'success');
  };

  self.copyRuleSetToProject = function (ruleSet) {
    var dre = state.get('dynamic_rule_engine') || { rule_sets: [] };
    var sets = listRuleSetsFor(dre);

    var ident = ruleSetIdentity(ruleSet);
    var exists = sets.some(function (s) { return ruleSetIdentity(s) === ident; });
    if (exists) { showStatus('Rule-Set existiert bereits im Projekt: ' + ident, 'error'); return; }

    sets.push(deepClone(ruleSet));
    state.set('dynamic_rule_engine', { rule_sets: sets });
    state.emit('rules:loaded', state.get('dynamic_rule_engine'));

    self.refreshDropDowns();
    if (byId('rule-target-set')) byId('rule-target-set').value = String(sets.length - 1);
    self.renderWizardProjectRules();
    showStatus('Rule-Set ins Projekt übernommen', 'success');
  };

  self.saveRuleAsTemplate = function (ruleSet, rule) {
    var setId = String(ruleSet.set_id || 'templates') + '_templates';
    var lib = state.get('ruleLibrary') || { rule_sets: [] };
    var sets = listRuleSetsFor(lib);

    var idx = sets.findIndex(function (s) { return s && s.set_id === setId; });
    if (idx === -1) {
      sets.push({ set_id: setId, priority: 5, evaluation: 'on_event', rules: [] });
      idx = sets.length - 1;
    }

    var rs = sets[idx];
    rs.rules = rs.rules || [];

    var rid = String(rule.rule_id || 'rule').trim() || 'rule';
    var base = rid;
    var n = 1;
    while (rs.rules.some(function (r) { return r && r.rule_id === rid; })) {
      n += 1;
      rid = base + '_' + n;
    }

    var copy = deepClone(rule);
    copy.rule_id = rid;

    rs.rules.push(copy);
    sets[idx] = rs;

    state.set('ruleLibrary', { rule_sets: sets });

    self.persistRuleLibrary().then(function () { self.renderTemplatesTab(); });
    showStatus('Rule als Template gespeichert: ' + rid, 'success');
  };

  self.persistRuleLibrary = async function () {
    try {
      var lib = state.get('ruleLibrary') || { rule_sets: [] };
      await api.saveRuleLibrary(lib);
      await self.loadRuleLibrary();
      state.emit('rules:loaded', state.get('dynamic_rule_engine'));
      return true;
    } catch (e) {
      handleError(e, 'Fehler beim Speichern der Rule-Bibliothek');
      return false;
    }
  };

  self.renderProjectTab = function () {
    var container = byId('project-sets');
    if (!container) return;

    var dre = state.get('dynamic_rule_engine') || { rule_sets: [] };
    var sets = listRuleSetsFor(dre);

    if (!sets.length) {
      container.innerHTML = `<div class="hint-text">Noch keine Rule-Sets im Projekt. Erstelle sie im Tab <b>Erstellen</b>.</div>`;
      return;
    }

    var html = sets.map(function (rs, setIndex) {
      var rules = rs.rules || [];

      var title = escapeHtml(rs.set_id || ('set#' + setIndex));
      var prio = (rs.priority != null) ? ('prio ' + rs.priority) : null;
      var evalMode = rs.evaluation ? String(rs.evaluation) : null;

      var list = rules.map(function (r, ridx) {
        var condTxt = (typeof r.condition === 'string') ? r.condition : compactJson(r.condition);
        var actTxt = compactJson(r.action);

        var condShort = shrinkText(condTxt, 170);
        var actShort = shrinkText(actTxt, 170);

        return `
          <div class="rule-item">
            <div class="rule-id">${escapeHtml(r.rule_id || '(ohne id)')}</div>
            <div class="rule-row"><span class="rule-label">if</span><span>${escapeHtml(condShort)}</span></div>
            <div class="rule-row"><span class="rule-label">do</span><span>${escapeHtml(actShort)}</span></div>
            <div class="btn-row">
              <button class="btn btn-secondary btn-small" type="button" data-proj-detail="${setIndex}::${ridx}">Details</button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="card">
          <div class="card-title">
            <span>${title}</span>
            <span class="pill">${rules.length} rules</span>
            ${prio ? '<span class="pill">' + escapeHtml(prio) + '</span>' : ''}
            ${evalMode ? '<span class="pill">' + escapeHtml(evalMode) + '</span>' : ''}
          </div>
          <div class="card-body" style="overflow-x:hidden;">
            ${list || '<div class="hint-text">Keine Rules.</div>'}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    // bind detail buttons
    container.querySelectorAll('[data-proj-detail]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var token = btn.getAttribute('data-proj-detail') || '';
        var parts = token.split('::');
        var sidx = toNumberOrNull(parts[0]);
        var ridx = toNumberOrNull(parts[1]);

        var dre2 = state.get('dynamic_rule_engine') || { rule_sets: [] };
        var sets2 = listRuleSetsFor(dre2);
        if (sidx === null || ridx === null || sidx < 0 || sidx >= sets2.length) return;

        var rs = sets2[sidx];
        var rule = rs && rs.rules ? rs.rules[ridx] : null;
        if (!rule) return;
        openRuleDetailModal(rule.rule_id || 'Rule', rule);
      });
    });
  };

  self.renderFreeTab = function () {
    var cfg = getDeviceConfigSnapshot(self.cfg);
    var editor = byId('free-editor');
    var tpl = byId('free-templates');
    if (!editor || !tpl) return;

    var fr = state.get('free_rules') || { timers: [], triggers: [], actions: [], transitions: [], events: [] };

    editor.innerHTML = `
      ${self.renderFreeSection('timers', fr.timers)}
      ${self.renderFreeSection('triggers', fr.triggers)}
      ${self.renderFreeSection('actions', fr.actions)}
      ${self.renderFreeSection('transitions', fr.transitions)}
      ${self.renderFreeSection('events', fr.events)}
    `;

    tpl.innerHTML = `
      ${self.renderFreeTemplateSection('timers', (cfg.timers || []))}
      ${self.renderFreeTemplateSection('triggers', (cfg.triggers || []))}
      ${self.renderFreeTemplateSection('actions', (cfg.actions || []))}
      ${self.renderFreeTemplateSection('transitions', (cfg.transitions || []))}
      ${self.renderFreeTemplateSection('events', (cfg.events || []))}
    `;

    self.bindFreeRulesActions();
  };

  self.renderFreeSection = function (key, arr) {
    return `
      <div class="card">
        <div class="card-title">
          <span>${escapeHtml(key)}</span>
          <span class="pill">${Array.isArray(arr) ? arr.length : 0}</span>
        </div>
        <div class="card-body" style="overflow-x:hidden;">
          <textarea id="free-${escapeHtml(key)}" class="text-area" placeholder="[]">${escapeHtml(pretty(arr || []))}</textarea>
          <div class="btn-row">
            <button class="btn btn-primary btn-small" type="button" data-free-apply="${escapeHtml(key)}">Übernehmen</button>
            <button class="btn btn-secondary btn-small" type="button" data-free-clear="${escapeHtml(key)}">Leeren</button>
          </div>
        </div>
      </div>
    `;
  };

  self.renderFreeTemplateSection = function (key, arr) {
    return `
      <div class="card">
        <div class="card-title">
          <span>${escapeHtml(key)} (Template)</span>
          <span class="pill">${Array.isArray(arr) ? arr.length : 0}</span>
        </div>
        <div class="card-body" style="overflow-x:hidden;">
          <pre class="code code-wrap" style="max-height:220px;white-space:pre-wrap;overflow-x:hidden;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(pretty(arr || []))}</pre>
          <div class="btn-row">
            <button class="btn btn-secondary btn-small" type="button" data-free-load-template="${escapeHtml(key)}">Template → Projekt</button>
          </div>
        </div>
      </div>
    `;
  };

  self.bindFreeRulesActions = function () {
    var root = byId('rule-view-free');
    if (!root) return;

    root.querySelectorAll('[data-free-apply]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-free-apply');
        var ta = byId('free-' + key);
        var parsed = safeJsonParse(String(ta ? ta.value : ''), null);
        if (!Array.isArray(parsed)) {
          showStatus('Ungültiges JSON für ' + key + ' (Array erwartet)', 'error');
          return;
        }

        var fr = state.get('free_rules') || { version: 1 };
        fr[key] = parsed;
        state.set('free_rules', fr);

        showStatus('Übernommen: ' + key, 'success');
      });
    });

    root.querySelectorAll('[data-free-clear]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-free-clear');
        var fr = state.get('free_rules') || { version: 1 };
        fr[key] = [];
        state.set('free_rules', fr);
        if (byId('free-' + key)) byId('free-' + key).value = '[]';
        showStatus('Geleert: ' + key, 'success');
      });
    });

    root.querySelectorAll('[data-free-load-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-free-load-template');
        var cfg = getDeviceConfigSnapshot(self.cfg);
        var templ = cfg[key] || [];

        if (!Array.isArray(templ)) templ = [];
        var fr = state.get('free_rules') || { version: 1 };
        fr[key] = deepClone(templ);
        state.set('free_rules', fr);

        if (byId('free-' + key)) byId('free-' + key).value = pretty(fr[key]);
        showStatus('Template geladen: ' + key, 'success');
      });
    });
  };

  // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
  self.container = document.getElementById('rules-panel');
  self.cfg = null;
  self._bound = false;

  // Edit-Context: { scope: 'project'|'library', set_index: number, rule_index: number }
  self._edit = null;

  if (self.container) {
    self.init().catch(function (e) {
      handleError(e, 'Rules-Panel init fehlgeschlagen');
    });
  }

  return self;
}

export const rulesGenerator = createRulesGeneratorController();
