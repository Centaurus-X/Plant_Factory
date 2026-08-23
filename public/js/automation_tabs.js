/**
 * automation_tabs.js – Vollständiger Automation Config Editor
 *
 * Ziele:
 * - Projektseitige Automation-Konfiguration: state key 'automation_cfg'
 * - Relationale Dropdowns (States/Sensors/Actuators/Engines/Filter/RuleSets)
 * - Objektlisten mit Edit/Delete/Duplicate + Template-Import
 * - Wizard für Rules (Scope + Conditions + Actions + Advanced)
 * - Parameter Schemas + Mappings Editor (arbeitet auf state.deviceConfig + Overrides)
 *
 * WICHTIG (Design):
 * - Template (deviceConfig) ist nur "Beispiel/Quelle" für Import
 * - Export nutzt NUR automation_cfg (siehe model_adapter Patch)
 */

import { state, showStatus } from './core.js';
import { showConfirmation, showNotice } from './dialog_service.js';
import {
  automationContractSummary,
  emptyAutomationConfig,
  normalizeAutomationConfig
} from './automation_contract.js';

// ============================================================================
// Utils
// ============================================================================

function showEditorNotice(message, title){
  showNotice(String(message || ''), {
    title: title || 'Eingabe prüfen',
    confirmLabel: 'Schließen'
  });
}

function confirmEditorAction(message, title, action){
  showConfirmation(String(message || ''), {
    title: title || 'Aktion bestätigen',
    confirmLabel: 'Löschen',
    cancelLabel: 'Abbrechen',
    destructive: true
  }, action);
}


function isPlainObject(v){
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepClone(obj){
  if(obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj));
}

function ensureArray(v){
  return Array.isArray(v) ? v : [];
}

function toStr(v){
  return (v === null || v === undefined) ? '' : String(v);
}

function toIntOrNull(v){
  var n = Number(v);
  if(!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toNumOr(v, fallback){
  var n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function uniqStringId(existingSet, base){
  var b = String(base || 'id').trim().replace(/[^\w\-.:]/g, '_') || 'id';
  if(!existingSet.has(b)) return b;
  for(var i=2;i<100000;i++){
    var cand = b + '_' + String(i);
    if(!existingSet.has(cand)) return cand;
  }
  return b + '_' + String(Date.now());
}

function nextNumericId(items, key){
  var mx = 0;
  ensureArray(items).forEach(function(it){
    var n = Number(it && it[key]);
    if(Number.isFinite(n)) mx = Math.max(mx, n);
  });
  return mx + 1;
}

// ============================================================================
// DOM helpers
// ============================================================================

function clear(node){
  while(node && node.firstChild) node.removeChild(node.firstChild);
}

function el(tag, attrs){
  var node = document.createElement(tag);
  var a = attrs || {};
  Object.keys(a).forEach(function(k){
    var v = a[k];
    if(k === 'className') node.className = v;
    else if(k === 'text') node.textContent = v;
    else if(k === 'html') node.innerHTML = v;
    else if(k === 'value') node.value = v;
    else if(k === 'checked') node.checked = !!v;
    else if(k.startsWith('on') && typeof v === 'function') node.addEventListener(k.substring(2), v);
    else if(v !== null && v !== undefined) node.setAttribute(k, String(v));
  });
  for(var i=2;i<arguments.length;i++){
    var c = arguments[i];
    if(c === null || c === undefined) continue;
    if(Array.isArray(c)) c.forEach(function(x){ if(x) node.appendChild(x); });
    else if(c instanceof Node) node.appendChild(c);
    else node.appendChild(document.createTextNode(String(c)));
  }
  return node;
}

function hr(){
  return el('div', { style:'height:1px; background: var(--border-color); margin: 10px 0;' });
}

function btn(label, cls, onClick){
  var b = el('button', { className:'btn '+(cls||''), text: label });
  if(typeof onClick === 'function') b.addEventListener('click', onClick);
  return b;
}

function btnSmall(label, cls, onClick){
  var b = el('button', { className:'btn btn-small '+(cls||''), text: label });
  if(typeof onClick === 'function') b.addEventListener('click', onClick);
  return b;
}

function formGroup(labelText, controlEl, hintText){
  var wrap = el('div', { className:'form-group' });
  if(labelText) wrap.appendChild(el('label', { text: labelText }));
  if(controlEl) wrap.appendChild(controlEl);
  if(hintText) wrap.appendChild(el('div', { className:'hint-text', text: hintText }));
  return wrap;
}

function mkInput(value, placeholder){
  var i = el('input', { className:'text-input', value: toStr(value) });
  if(placeholder) i.setAttribute('placeholder', String(placeholder));
  return i;
}

function mkNumberInput(value, placeholder){
  var i = el('input', { className:'text-input', value: toStr(value) });
  i.setAttribute('inputmode', 'decimal');
  if(placeholder) i.setAttribute('placeholder', String(placeholder));
  return i;
}

function mkTextarea(value, minHeightPx){
  var t = el('textarea', { className:'text-area code' });
  t.value = toStr(value);
  if(minHeightPx) t.style.minHeight = String(minHeightPx) + 'px';
  return t;
}

function mkSelect(options, selected, isMulti, size){
  var s = el('select', { className:'select-input' });
  if(isMulti){ s.multiple = true; if(size) s.size = size; }
  ensureArray(options).forEach(function(opt){
    var o = el('option', { value: String(opt.value), text: String(opt.text) });
    if(isMulti){
      if(ensureArray(selected).map(String).indexOf(String(opt.value)) >= 0) o.selected = true;
    }else{
      if(String(selected) === String(opt.value)) o.selected = true;
    }
    s.appendChild(o);
  });
  return s;
}

function selectedValues(selectEl){
  return Array.from(selectEl.selectedOptions || []).map(function(o){ return o.value; });
}

// ============================================================================
// Modal
// ============================================================================

function openModal(opts){
  var title = (opts && opts.title) ? String(opts.title) : 'Editor';
  var bodyEl = (opts && opts.bodyEl) ? opts.bodyEl : el('div', {});
  var onSave = (opts && typeof opts.onSave === 'function') ? opts.onSave : null;
  var onClose = (opts && typeof opts.onClose === 'function') ? opts.onClose : null;
  var saveText = (opts && opts.saveText) ? String(opts.saveText) : 'Speichern';

  var modal = el('div', { className:'modal' });
  var content = el('div', { className:'modal-content large' });

  var header = el('div', { className:'modal-header' },
    el('h2', { text: title }),
    el('button', { className:'modal-close', text:'×' })
  );

  var body = el('div', { className:'modal-body' }, bodyEl);
  var footer = el('div', { className:'modal-footer' });

  var closeBtn = btn('Schließen', 'btn-secondary', function(){ close(); });
  footer.appendChild(closeBtn);

  if(onSave){
    footer.appendChild(btn(saveText, 'btn-primary', function(){ onSave({ close: close }); }));
  }

  content.appendChild(header);
  content.appendChild(body);
  content.appendChild(footer);
  modal.appendChild(content);
  document.body.appendChild(modal);

  function close(){
    if(onClose) onClose();
    document.body.removeChild(modal);
  }

  header.querySelector('.modal-close').addEventListener('click', close);
  modal.addEventListener('click', function(e){
    if(e.target === modal) close();
  });

  return { close: close };
}

// ============================================================================
// Wizard
// ============================================================================

function makeWizard(steps, ctx){
  var root = el('div', {});
  var header = el('div', { className:'inline', style:'justify-content:space-between; align-items:center; gap:10px; margin-bottom: 8px;' });
  var titleEl = el('div', { style:'font-weight:600;' });
  var hintEl = el('div', { className:'hint-text', style:'margin-left:auto; text-align:right;' });

  header.appendChild(titleEl);
  header.appendChild(hintEl);

  var content = el('div', {});
  var nav = el('div', { className:'btn-row', style:'justify-content:space-between; align-items:center;' });
  var left = el('div', { className:'inline', style:'gap:8px;' });
  var right = el('div', { className:'inline', style:'gap:8px;' });

  var curIdx = 0;

  var btnPrev = btn('← Zurück', 'btn-secondary', function(){
    if(curIdx > 0){ curIdx--; render(); }
  });
  var btnNext = btn('Weiter →', 'btn-secondary', function(){
    if(curIdx < steps.length - 1){ curIdx++; render(); }
  });

  left.appendChild(btnPrev);
  right.appendChild(btnNext);
  nav.appendChild(left);
  nav.appendChild(right);

  root.appendChild(header);
  root.appendChild(content);
  root.appendChild(hr());
  root.appendChild(nav);

  function render(){
    clear(content);
    var step = steps[curIdx];
    titleEl.textContent = String(curIdx+1) + ' / ' + String(steps.length) + ' – ' + String(step.title || step.id || '');
    hintEl.textContent = step.hint ? String(step.hint) : '';
    btnPrev.disabled = curIdx <= 0;
    btnNext.disabled = curIdx >= steps.length - 1;
    if(step && typeof step.render === 'function'){
      step.render(content, ctx);
    }
  }

  render();
  return { root: root, render: render };
}

// ============================================================================
// Data: automation_cfg (project)
// ============================================================================

var AUTOMATION_VERSION = 2;

function defaultAutomationCfg(){
  return emptyAutomationConfig();
}

function normalizeAutomationCfg(cfg){
  return normalizeAutomationConfig(cfg);
}

function readAutomationCfg(){
  return normalizeAutomationCfg(state.get('automation_cfg'));
}

function writeAutomationCfg(cfg, msg){
  state.set('automation_cfg', deepClone(normalizeAutomationCfg(cfg)));
  if(typeof state.saveHistory === 'function') state.saveHistory();
  if(msg) showStatus(msg, 'success');
}

function ensureAutomationCfg(){
  var normalized = normalizeAutomationCfg(state.get('automation_cfg'));
  state.set('automation_cfg', deepClone(normalized));
  return normalized;
}

function getTemplateAutomation(deviceConfig){
  var cfg = deviceConfig || state.get('deviceConfig') || {};
  return {
    automation: ensureArray(cfg.automation),
    automation_engines: ensureArray(cfg.automation_engines),
    automation_filters: ensureArray(cfg.automation_filters),
    automation_rule_sets: ensureArray(cfg.automation_rule_sets)
  };
}

// ============================================================================
// Data: deviceConfig overrides (schemas/mappings)
// ============================================================================

function readDeviceConfig(){
  return deepClone(state.get('deviceConfig') || {});
}

function writeDeviceConfig(cfg, msg){
  state.set('deviceConfig', deepClone(cfg || {}));
  state.set('deviceConfigUserEdited', true);
  if(msg) showStatus(msg, 'success');
}

// ============================================================================
// Lookups / Labels
// ============================================================================

function buildLookups(deviceConfig){
  var cfg = deviceConfig || state.get('deviceConfig') || {};
  var look = {};

  look.processes = ensureArray(cfg.processes);
  look.process_modes = ensureArray(cfg.process_modes);
  look.process_values = ensureArray(cfg.process_values);

  look.sensors = ensureArray(cfg.sensors);
  look.actuators = ensureArray(cfg.actuators);

  look.processById = new Map();
  look.processes.forEach(function(p){
    var id = toIntOrNull(p && p.p_id);
    if(id !== null) look.processById.set(id, p);
  });

  look.valueById = new Map();
  look.process_values.forEach(function(v){
    var id = toIntOrNull(v && v.value_id);
    if(id !== null) look.valueById.set(id, v);
  });

  return look;
}

function getProjectStates(look){
  var proc = state.get('processes') || { process_states: [] };
  var arr = ensureArray(proc.process_states).filter(Boolean).map(function(s){
    return {
      state_id: toIntOrNull(s.state_id),
      p_id: toIntOrNull(s.p_id),
      state_type: toStr(s.state_type || s.p__type || 'generic'),
      parameter_schema_id: s.parameter_schema_id ? String(s.parameter_schema_id) : null
    };
  }).filter(function(x){ return x.state_id !== null; });

  // sort: p_id then state_id
  arr.sort(function(a,b){
    if(a.p_id !== b.p_id) return (a.p_id||0) - (b.p_id||0);
    return a.state_id - b.state_id;
  });

  return arr;
}

function labelProcess(p){
  if(!p) return '–';
  var id = toIntOrNull(p.p_id);
  var name = toStr(p.process_name || p.name || '');
  return (id !== null ? String(id) : '–') + (name ? ' – ' + name : '');
}

function labelState(s, look){
  if(!s) return '–';
  var p = (look && look.processById) ? look.processById.get(s.p_id) : null;
  var pName = p ? toStr(p.process_name || p.name || '') : (s.p_id !== null ? ('p'+String(s.p_id)) : '');
  var schema = s.parameter_schema_id ? String(s.parameter_schema_id) : '';
  var tail = [pName, s.state_type, schema].filter(Boolean).join(' / ');
  return String(s.state_id) + (tail ? ' – ' + tail : '');
}

function labelValue(v){
  if(!v) return '–';
  return String(v.value_id) + ' – ' + toStr(v.state_value || v.value || '');
}

function labelSensor(s){
  if(!s) return '–';
  var id = toIntOrNull(s.sensor_id !== undefined ? s.sensor_id : s.id);
  var info = toStr(s.sensor_group || s.profile_id || '');
  return String(id !== null ? id : '–') + (info ? ' – ' + info : '');
}

function labelActuator(a){
  if(!a) return '–';
  var id = toIntOrNull(a.actuator_id !== undefined ? a.actuator_id : a.id);
  var info = toStr(a.actuator_group || a.profile_id || '');
  return String(id !== null ? id : '–') + (info ? ' – ' + info : '');
}

function modeOptions(look){
  return ensureArray(look.process_modes).map(function(m){
    return { value: String(m.mode), text: String(m.mode) };
  });
}

// ============================================================================
// Validation (lightweight but very useful)
// ============================================================================

function validateAutomationCfg(cfg, look, projectStates){
  var errors = [];
  var warnings = [];

  var engineIds = new Set(ensureArray(cfg.automation_engines).map(function(e){ return String(e.engine_id); }).filter(Boolean));
  var filterIds = new Set(ensureArray(cfg.automation_filters).map(function(f){ return String(f.filter_id); }).filter(Boolean));
  var ruleSetIds = new Set(ensureArray(cfg.automation_rule_sets).map(function(rs){ return String(rs.rule_set_id); }).filter(Boolean));

  var stateIdSet = new Set(ensureArray(projectStates).map(function(s){ return String(s.state_id); }));
  var sensorIdSet = new Set(ensureArray(look.sensors).map(function(s){ return String(toIntOrNull(s.sensor_id !== undefined ? s.sensor_id : s.id)); }));
  var actuatorIdSet = new Set(ensureArray(look.actuators).map(function(a){ return String(toIntOrNull(a.actuator_id !== undefined ? a.actuator_id : a.id)); }));

  ensureArray(cfg.automation).forEach(function(p){
    var pid = String(p.automation_id || '');
    ensureArray(p.engine_ids).forEach(function(eid){
      if(!engineIds.has(String(eid))) warnings.push('Profil '+pid+': engine_id fehlt: '+String(eid));
    });
    ensureArray(p.filter_ids).forEach(function(fid){
      if(!filterIds.has(String(fid))) warnings.push('Profil '+pid+': filter_id fehlt: '+String(fid));
    });
    ensureArray(p.automation_rule_set_ids).forEach(function(rid){
      if(!ruleSetIds.has(String(rid))) warnings.push('Profil '+pid+': rule_set_id fehlt: '+String(rid));
    });
  });

  ensureArray(cfg.automation_rule_sets).forEach(function(rs){
    if(rs.engine_id && !engineIds.has(String(rs.engine_id))) warnings.push('Rule-Set '+rs.rule_set_id+': engine_id fehlt: '+String(rs.engine_id));

    ensureArray(rs.rules).forEach(function(r){
      ensureArray(r.when_all).forEach(function(c){
        if(c && c.type === 'state_value' && c.state_id !== null && c.state_id !== undefined){
          if(!stateIdSet.has(String(c.state_id))) warnings.push('Rule '+rs.rule_set_id+'#'+r.rule_id+': state_id fehlt: '+String(c.state_id));
        }
        if(c && c.type === 'sensor_threshold' && c.sensor_id !== null && c.sensor_id !== undefined){
          if(!sensorIdSet.has(String(c.sensor_id))) warnings.push('Rule '+rs.rule_set_id+'#'+r.rule_id+': sensor_id fehlt: '+String(c.sensor_id));
        }
        if(c && c.type === 'sensor_threshold' && c.filter_id){
          if(!filterIds.has(String(c.filter_id))) warnings.push('Rule '+rs.rule_set_id+'#'+r.rule_id+': filter_id fehlt: '+String(c.filter_id));
        }
      });

      ensureArray(r.do).forEach(function(a){
        if(a && a.action === 'actuator_set' && a.actuator_id !== null && a.actuator_id !== undefined){
          if(!actuatorIdSet.has(String(a.actuator_id))) warnings.push('Rule '+rs.rule_set_id+'#'+r.rule_id+': actuator_id fehlt: '+String(a.actuator_id));
        }
      });
    });
  });

  // Minimal harte Fehler: doppelte IDs
  var seen = new Set();
  ensureArray(cfg.automation_engines).forEach(function(e){
    var id = String(e.engine_id||'');
    if(!id) return;
    if(seen.has('e:'+id)) errors.push('Doppelte engine_id: '+id);
    seen.add('e:'+id);
  });
  ensureArray(cfg.automation_filters).forEach(function(f){
    var id = String(f.filter_id||'');
    if(!id) return;
    if(seen.has('f:'+id)) errors.push('Doppelte filter_id: '+id);
    seen.add('f:'+id);
  });
  ensureArray(cfg.automation_rule_sets).forEach(function(rs){
    var id = String(rs.rule_set_id||'');
    if(!id) return;
    if(seen.has('rs:'+id)) errors.push('Doppelte rule_set_id: '+id);
    seen.add('rs:'+id);
  });
  ensureArray(cfg.automation).forEach(function(p){
    var id = String(p.automation_id||'');
    if(!id) return;
    if(seen.has('p:'+id)) errors.push('Doppelte automation_id: '+id);
    seen.add('p:'+id);
  });

  return { errors: errors, warnings: warnings };
}

function renderValidationBox(target, validation){
  var v = validation || { errors: [], warnings: [] };
  var eCount = ensureArray(v.errors).length;
  var wCount = ensureArray(v.warnings).length;

  var d = el('details', { style:'margin: 6px 0 10px 0;' });
  d.appendChild(el('summary', { text:'Validierung: '+String(eCount)+' Fehler, '+String(wCount)+' Warnungen' }));

  var inner = el('div', { style:'margin-top:8px;' });

  if(!eCount && !wCount){
    inner.appendChild(el('div', { className:'hint-text', text:'Alles sieht konsistent aus.' }));
  }else{
    if(eCount){
      inner.appendChild(el('div', { style:'font-weight:600; margin-bottom:4px;', text:'Fehler' }));
      ensureArray(v.errors).forEach(function(msg){
        inner.appendChild(el('div', { className:'hint-text', text:'❌ '+msg }));
      });
      inner.appendChild(hr());
    }
    if(wCount){
      inner.appendChild(el('div', { style:'font-weight:600; margin-bottom:4px;', text:'Warnungen' }));
      ensureArray(v.warnings).forEach(function(msg){
        inner.appendChild(el('div', { className:'hint-text', text:'⚠️ '+msg }));
      });
    }
  }

  d.appendChild(inner);
  clear(target);
  target.appendChild(d);
}

// ============================================================================
// Builders: Conditions / Actions
// ============================================================================

var CONDITION_TYPES = [
  { type:'state_value', label:'State-Wert (state_value)' },
  { type:'sensor_threshold', label:'Sensor-Schwelle (sensor_threshold)' }
];

function defaultCondition(type){
  if(type === 'state_value') return { type:'state_value', state_id: null, equals: 1 };
  if(type === 'sensor_threshold') return { type:'sensor_threshold', sensor_id: null, ge: 0.0, filter_id: null };
  return { type: String(type || 'unknown') };
}

function renderConditionList(listRef, ctx){
  // V52-Fix (B-9): ensureArray() liefert bei undefined ein NEUES, nicht
  // verlinktes Array. push()/splice() darauf aenderten die Regel nicht — aus
  // Templates importierte oder handeditierte Regeln ohne when_any/when_none
  // verloren alle hier eingegebenen Bedingungen stillschweigend.
  if (!Array.isArray(listRef)) {
    return el('div', { className:'hint-text',
      text:'Diese Bedingungsliste fehlt in der Regel und kann daher nicht bearbeitet werden. '
        + 'Regel einmal ueber den Wizard neu anlegen oder im RAW-JSON ein leeres Array ergaenzen.' });
  }
  var list = listRef;
  var look = ctx.look;
  var projectStates = ctx.projectStates;
  var cfg = ctx.cfg;

  var wrap = el('div', {});
  var listEl = el('div', { className:'rule-list' });

  function renderRow(cond, idx){
    var row = el('div', { className:'rule-item' });

    var typeSel = el('select', { className:'select-input', style:'width:260px;' });
    CONDITION_TYPES.forEach(function(t){
      var opt = el('option', { value:t.type, text:t.label });
      if(String(cond.type) === String(t.type)) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener('change', function(){
      list[idx] = defaultCondition(String(typeSel.value));
      render();
    });

    row.appendChild(el('div', { className:'inline', style:'justify-content:space-between; align-items:center; gap:8px;' },
      typeSel,
      btnSmall('Löschen', 'btn-danger', function(){ list.splice(idx,1); render(); })
    ));

    var body = el('div', { style:'margin-top:8px;' });

    if(String(cond.type) === 'state_value'){
      var stOpts = [{ value:'', text:'– State –' }].concat(projectStates.map(function(s){
        return { value:String(s.state_id), text: labelState(s, look) };
      }));
      var stSel = mkSelect(stOpts, cond.state_id === null ? '' : String(cond.state_id), false);
      stSel.addEventListener('change', function(){ cond.state_id = toIntOrNull(stSel.value); });

      var valOpts = [{ value:'', text:'– Value –' }].concat(ensureArray(look.process_values).map(function(v){
        return { value:String(v.value_id), text: labelValue(v) };
      }));
      var valSel = mkSelect(valOpts, cond.equals === null ? '' : String(cond.equals), false);
      valSel.addEventListener('change', function(){ cond.equals = toIntOrNull(valSel.value); });

      body.appendChild(el('div', { className:'inline', style:'gap:8px; flex-wrap:wrap;' },
        el('div', { style:'min-width:320px;' }, formGroup('state_id', stSel)),
        el('div', { style:'min-width:320px;' }, formGroup('equals', valSel))
      ));
    }

    if(String(cond.type) === 'sensor_threshold'){
      var senOpts = [{ value:'', text:'– Sensor –' }].concat(ensureArray(look.sensors).map(function(s){
        var sid = toIntOrNull(s.sensor_id !== undefined ? s.sensor_id : s.id);
        return { value: sid === null ? '' : String(sid), text: labelSensor(s) };
      }));
      var senSel = mkSelect(senOpts, cond.sensor_id === null ? '' : String(cond.sensor_id), false);
      senSel.addEventListener('change', function(){ cond.sensor_id = toIntOrNull(senSel.value); });

      var geIn = mkNumberInput(toStr(cond.ge), 'z.B. 80.0');
      geIn.addEventListener('input', function(){ cond.ge = toNumOr(geIn.value, 0); });

      var fOpts = [{ value:'', text:'(kein Filter)' }].concat(ensureArray(cfg.automation_filters).map(function(f){
        return { value:String(f.filter_id), text:String(f.filter_id) };
      }));
      var fSel = mkSelect(fOpts, cond.filter_id ? String(cond.filter_id) : '', false);
      fSel.addEventListener('change', function(){ cond.filter_id = fSel.value ? String(fSel.value) : null; });

      body.appendChild(el('div', { className:'inline', style:'gap:8px; flex-wrap:wrap;' },
        el('div', { style:'min-width:320px;' }, formGroup('sensor_id', senSel)),
        el('div', { style:'min-width:200px;' }, formGroup('ge', geIn)),
        el('div', { style:'min-width:240px;' }, formGroup('filter_id', fSel))
      ));
    }

    row.appendChild(body);
    return row;
  }

  function render(){
    clear(listEl);
    list.forEach(function(cond, idx){ listEl.appendChild(renderRow(cond, idx)); });
    if(!list.length) listEl.appendChild(el('div', { className:'hint-text', text:'Keine Conditions.' }));
  }

  var addSel = el('select', { className:'select-input', style:'width:260px;' });
  CONDITION_TYPES.forEach(function(t){ addSel.appendChild(el('option', { value:t.type, text:t.label })); });

  wrap.appendChild(el('div', { className:'btn-row' },
    addSel,
    btn('Condition hinzufügen', 'btn-primary', function(){
      list.push(defaultCondition(String(addSel.value)));
      render();
    })
  ));
  wrap.appendChild(listEl);

  render();
  return wrap;
}

var ACTION_TYPES = [
  { action:'actuator_set', label:'Actuator setzen (actuator_set)' }
];

function defaultAction(action){
  if(action === 'actuator_set') return { action:'actuator_set', actuator_id: null, value: 0 };
  return { action: String(action || 'unknown') };
}

function renderActionList(listRef, ctx){
  // V52-Fix (B-9), siehe renderConditionList.
  if (!Array.isArray(listRef)) {
    return el('div', { className:'hint-text',
      text:'Diese Aktionsliste fehlt in der Regel und kann daher nicht bearbeitet werden.' });
  }
  var list = listRef;
  var look = ctx.look;
  var wrap = el('div', {});
  var listEl = el('div', { className:'rule-list' });

  function renderRow(act, idx){
    var row = el('div', { className:'rule-item' });

    var typeSel = el('select', { className:'select-input', style:'width:260px;' });
    ACTION_TYPES.forEach(function(t){
      var opt = el('option', { value:t.action, text:t.label });
      if(String(act.action) === String(t.action)) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener('change', function(){
      list[idx] = defaultAction(String(typeSel.value));
      render();
    });

    row.appendChild(el('div', { className:'inline', style:'justify-content:space-between; align-items:center; gap:8px;' },
      typeSel,
      btnSmall('Löschen', 'btn-danger', function(){ list.splice(idx,1); render(); })
    ));

    var body = el('div', { style:'margin-top:8px;' });

    if(String(act.action) === 'actuator_set'){
      var aOpts = [{ value:'', text:'– Actuator –' }].concat(ensureArray(look.actuators).map(function(a){
        var aid = toIntOrNull(a.actuator_id !== undefined ? a.actuator_id : a.id);
        return { value: aid === null ? '' : String(aid), text: labelActuator(a) };
      }));
      var aSel = mkSelect(aOpts, act.actuator_id === null ? '' : String(act.actuator_id), false);
      aSel.addEventListener('change', function(){ act.actuator_id = toIntOrNull(aSel.value); });

      var vIn = mkInput(toStr(act.value), 'z.B. 1');
      vIn.addEventListener('input', function(){
        var t = String(vIn.value || '').trim();
        var n = Number(t);
        act.value = Number.isFinite(n) ? n : t;
      });

      body.appendChild(el('div', { className:'inline', style:'gap:8px; flex-wrap:wrap;' },
        el('div', { style:'min-width:320px;' }, formGroup('actuator_id', aSel)),
        el('div', { style:'min-width:200px;' }, formGroup('value', vIn))
      ));
    }

    row.appendChild(body);
    return row;
  }

  function render(){
    clear(listEl);
    list.forEach(function(act, idx){ listEl.appendChild(renderRow(act, idx)); });
    if(!list.length) listEl.appendChild(el('div', { className:'hint-text', text:'Keine Actions.' }));
  }

  var addSel = el('select', { className:'select-input', style:'width:260px;' });
  ACTION_TYPES.forEach(function(t){ addSel.appendChild(el('option', { value:t.action, text:t.label })); });

  wrap.appendChild(el('div', { className:'btn-row' },
    addSel,
    btn('Action hinzufügen', 'btn-primary', function(){
      list.push(defaultAction(String(addSel.value)));
      render();
    })
  ));
  wrap.appendChild(listEl);

  render();
  return wrap;
}

// ============================================================================
// Editors: Profiles / Engines / Filters
// ============================================================================

function editAutomationProfileModal(cfg, look, profile, onSave){
  var p = deepClone(profile);

  var idIn = mkInput(p.automation_id, 'default');
  var descIn = mkInput(p.description || '', 'Beschreibung');
  var enCb = el('input', { type:'checkbox', checked: !!p.enabled });

  function multiSelectFromIds(items, idKey, selected){
    var opts = ensureArray(items).map(function(it){
      return { value: String(it[idKey] || ''), text: String(it[idKey] || '') };
    }).filter(function(o){ return o.value; });
    return mkSelect(opts, ensureArray(selected).map(String), true, 6);
  }

  var engSel = multiSelectFromIds(cfg.automation_engines, 'engine_id', p.engine_ids);
  var filSel = multiSelectFromIds(cfg.automation_filters, 'filter_id', p.filter_ids);
  var rsSel  = multiSelectFromIds(cfg.automation_rule_sets, 'rule_set_id', p.automation_rule_set_ids);

  var body = el('div', {},
    formGroup('automation_id', idIn, 'Eindeutige ID des Profils'),
    formGroup('description', descIn),
    formGroup('enabled', enCb),
    formGroup('engine_ids', engSel, 'Mehrfachauswahl'),
    formGroup('filter_ids', filSel, 'Mehrfachauswahl'),
    formGroup('automation_rule_set_ids', rsSel, 'Welche Rule-Sets gehören zu diesem Profil?')
  );

  openModal({
    title: 'Automation-Profil bearbeiten',
    bodyEl: body,
    saveText: 'Übernehmen',
    onSave: function(modal){
      p.automation_id = String(idIn.value || '').trim() || p.automation_id;
      p.description = String(descIn.value || '').trim();
      p.enabled = !!enCb.checked;
      p.engine_ids = selectedValues(engSel).filter(Boolean);
      p.filter_ids = selectedValues(filSel).filter(Boolean);
      p.automation_rule_set_ids = selectedValues(rsSel).filter(Boolean);
      onSave(p);
      modal.close();
    }
  });
}

function editEngineModal(cfg, look, engine, onSave){
  var e = deepClone(engine);

  var idIn = mkInput(e.engine_id, 'engine');
  var spTol = mkNumberInput(toStr(e.sp_tolerance ?? 0.5), '0.5');

  var dbgCtrl = el('input', { type:'checkbox', checked: !!e.debug_control });
  var dbgPid  = el('input', { type:'checkbox', checked: !!e.debug_pid });

  var projectStates = getProjectStates(look);
  var stOpts = projectStates.map(function(s){ return { value:String(s.state_id), text: labelState(s, look) }; });
  var dbgPidStates = mkSelect(stOpts, ensureArray(e.debug_pid_state_ids).map(String), true, 6);

  var dbgInt = mkNumberInput(toStr(e.debug_pid_interval_s ?? 1.0), '1.0');

  var safety = isPlainObject(e.safety) ? e.safety : {};
  var defAct = mkSelect([
    { value:'shutdown', text:'shutdown' },
    { value:'hold', text:'hold' },
    { value:'ignore', text:'ignore' }
  ], toStr(safety.default_action || 'shutdown'), false);

  var valOpts = ensureArray(look.process_values).map(function(v){
    return { value:String(v.value_id), text: labelValue(v) };
  });
  var defVal = mkSelect(valOpts, safety.default_state_value_id ? String(safety.default_state_value_id) : '', false);

  var shutMiss = el('input', { type:'checkbox', checked: safety.shutdown_on_missing_sensor !== false });
  var shutPid  = el('input', { type:'checkbox', checked: safety.shutdown_on_invalid_pid !== false });

  var maxDelta = mkNumberInput(toStr(safety.max_output_delta_per_step ?? 2.0), '2.0');

  var defaults = isPlainObject(e.defaults) ? e.defaults : {};
  var evalMode = mkSelect([{value:'on_event',text:'on_event'},{value:'poll',text:'poll'}], toStr(defaults.evaluation_mode||'on_event'), false);
  var execMode = mkSelect([{value:'parallel',text:'parallel'},{value:'serial',text:'serial'}], toStr(defaults.exec_mode||'parallel'), false);
  var prio = mkNumberInput(toStr(defaults.priority ?? 100), '100');

  // Advanced JSON (optional)
  var advTa = mkTextarea(JSON.stringify(e, null, 2), 220);

  var body = el('div', {},
    el('div', { className:'hint-text', text:'Tipp: Basis-Felder oben, alles Weitere bei Bedarf im Advanced JSON.' }),
    formGroup('engine_id', idIn),
    formGroup('sp_tolerance', spTol),
    el('div', { className:'inline', style:'gap:12px; flex-wrap:wrap;' },
      formGroup('debug_control', dbgCtrl),
      formGroup('debug_pid', dbgPid)
    ),
    formGroup('debug_pid_state_ids', dbgPidStates),
    formGroup('debug_pid_interval_s', dbgInt),
    hr(),
    el('div', { style:'font-weight:600; margin-bottom:6px;', text:'safety' }),
    formGroup('default_action', defAct),
    formGroup('default_state_value_id', defVal),
    el('div', { className:'inline', style:'gap:12px; flex-wrap:wrap;' },
      formGroup('shutdown_on_missing_sensor', shutMiss),
      formGroup('shutdown_on_invalid_pid', shutPid)
    ),
    formGroup('max_output_delta_per_step', maxDelta),
    hr(),
    el('div', { style:'font-weight:600; margin-bottom:6px;', text:'defaults' }),
    formGroup('evaluation_mode', evalMode),
    formGroup('exec_mode', execMode),
    formGroup('priority', prio),
    hr(),
    el('details', {}, el('summary', { text:'Advanced JSON (überschreibt alles oben)' }),
      advTa
    )
  );

  openModal({
    title: 'Engine bearbeiten',
    bodyEl: body,
    saveText: 'Übernehmen',
    onSave: function(modal){
      // Apply UI fields first
      e.engine_id = String(idIn.value || '').trim() || e.engine_id;
      e.sp_tolerance = toNumOr(spTol.value, 0.5);
      e.debug_control = !!dbgCtrl.checked;
      e.debug_pid = !!dbgPid.checked;
      e.debug_pid_state_ids = selectedValues(dbgPidStates).map(function(x){ return toIntOrNull(x); }).filter(function(x){ return x !== null; });
      e.debug_pid_interval_s = toNumOr(dbgInt.value, 1.0);

      e.safety = isPlainObject(e.safety) ? e.safety : {};
      e.safety.default_action = String(defAct.value || 'shutdown');
      e.safety.default_state_value_id = toIntOrNull(defVal.value) || e.safety.default_state_value_id || 2;
      e.safety.shutdown_on_missing_sensor = !!shutMiss.checked;
      e.safety.shutdown_on_invalid_pid = !!shutPid.checked;
      e.safety.max_output_delta_per_step = toNumOr(maxDelta.value, 2.0);

      e.defaults = isPlainObject(e.defaults) ? e.defaults : {};
      e.defaults.evaluation_mode = String(evalMode.value || 'on_event');
      e.defaults.exec_mode = String(execMode.value || 'parallel');
      e.defaults.priority = toIntOrNull(prio.value) || 100;

      // Advanced JSON override if valid
      var adv = String(advTa.value || '').trim();
      if(adv){
        try{
          var parsed = JSON.parse(adv);
          if(isPlainObject(parsed)) e = parsed;
        }catch(_e){
          showEditorNotice('Advanced JSON ungültig – verwende UI-Felder.');
        }
      }

      onSave(e);
      modal.close();
    }
  });
}

var FILTER_STEP_TYPES = [
  { type:'median', label:'median', params:[{k:'window', t:'int'}] },
  { type:'moving_average', label:'moving_average', params:[{k:'window', t:'int'}] },
  { type:'lowpass', label:'lowpass', params:[{k:'alpha', t:'num'}] },
  { type:'highpass', label:'highpass', params:[{k:'alpha', t:'num'}] },
  { type:'sampler', label:'sampler', params:[{k:'period_s', t:'num'}] },
  { type:'scaler_sensor_profile', label:'scaler_sensor_profile', params:[] }
];

function filterStepDefault(type){
  if(type === 'median') return { type:'median', window: 5 };
  if(type === 'moving_average') return { type:'moving_average', window: 5 };
  if(type === 'lowpass') return { type:'lowpass', alpha: 0.2 };
  if(type === 'highpass') return { type:'highpass', alpha: 0.05 };
  if(type === 'sampler') return { type:'sampler', period_s: 0.2 };
  if(type === 'scaler_sensor_profile') return { type:'scaler_sensor_profile' };
  return { type: String(type||'unknown') };
}

function editFilterModal(cfg, look, filter, onSave){
  var f = deepClone(filter);

  var idIn = mkInput(f.filter_id, 'filter');
  var senOpts = ensureArray(look.sensors).map(function(s){
    var sid = toIntOrNull(s.sensor_id !== undefined ? s.sensor_id : s.id);
    return { value: sid === null ? '' : String(sid), text: labelSensor(s) };
  }).filter(function(o){ return o.value; });

  f.apply_to = isPlainObject(f.apply_to) ? f.apply_to : { sensor_ids: [] };
  var applySel = mkSelect(senOpts, ensureArray(f.apply_to.sensor_ids).map(String), true, 6);

  f.chain = ensureArray(f.chain);
  var chainList = el('div', { className:'rule-list' });

  function renderChain(){
    clear(chainList);
    f.chain.forEach(function(step, idx){
      var row = el('div', { className:'rule-item' });

      var typeSel = el('select', { className:'select-input', style:'width:220px;' });
      FILTER_STEP_TYPES.forEach(function(t){
        var opt = el('option', { value:t.type, text:t.label });
        if(String(step.type) === String(t.type)) opt.selected = true;
        typeSel.appendChild(opt);
      });
      typeSel.addEventListener('change', function(){
        f.chain[idx] = filterStepDefault(String(typeSel.value));
        renderChain();
      });

      var ctrl = el('div', { className:'inline', style:'justify-content:space-between; align-items:center; gap:8px;' },
        typeSel,
        el('div', { className:'inline', style:'gap:6px;' },
          btnSmall('▲', 'btn-secondary', function(){
            if(idx <= 0) return;
            var tmp = f.chain[idx-1]; f.chain[idx-1] = f.chain[idx]; f.chain[idx] = tmp;
            renderChain();
          }),
          btnSmall('▼', 'btn-secondary', function(){
            if(idx >= f.chain.length-1) return;
            var tmp2 = f.chain[idx+1]; f.chain[idx+1] = f.chain[idx]; f.chain[idx] = tmp2;
            renderChain();
          }),
          btnSmall('Dupl.', 'btn-secondary', function(){
            f.chain.splice(idx+1, 0, deepClone(step));
            renderChain();
          }),
          btnSmall('Löschen', 'btn-danger', function(){
            f.chain.splice(idx,1);
            renderChain();
          })
        )
      );

      row.appendChild(ctrl);

      // params
      var def = FILTER_STEP_TYPES.find(function(t){ return String(t.type) === String(step.type); });
      var params = (def && def.params) ? def.params : [];
      if(params.length){
        var paramWrap = el('div', { className:'inline', style:'gap:8px; flex-wrap:wrap; margin-top:8px;' });
        params.forEach(function(pdef){
          var inEl = mkNumberInput(toStr(step[pdef.k] ?? ''), pdef.k);
          inEl.addEventListener('input', function(){
            if(pdef.t === 'int') step[pdef.k] = toIntOrNull(inEl.value) || 0;
            else step[pdef.k] = toNumOr(inEl.value, 0);
          });
          paramWrap.appendChild(el('div', { style:'min-width:180px;' }, formGroup(pdef.k, inEl)));
        });
        row.appendChild(paramWrap);
      }

      chainList.appendChild(row);
    });

    if(!f.chain.length) chainList.appendChild(el('div', { className:'hint-text', text:'Keine Steps – Filter macht dann nichts.' }));
  }

  renderChain();

  var addSel = el('select', { className:'select-input', style:'width:220px;' });
  FILTER_STEP_TYPES.forEach(function(t){ addSel.appendChild(el('option', { value:t.type, text:t.label })); });

  var body = el('div', {},
    formGroup('filter_id', idIn),
    formGroup('apply_to.sensor_ids', applySel, 'Welche Sensoren werden gefiltert?'),
    hr(),
    el('div', { style:'font-weight:600; margin-bottom:6px;', text:'chain' }),
    el('div', { className:'btn-row' },
      addSel,
      btn('Step hinzufügen', 'btn-primary', function(){
        f.chain.push(filterStepDefault(String(addSel.value)));
        renderChain();
      })
    ),
    chainList,
    hr(),
    el('details', {}, el('summary', { text:'Advanced JSON' }),
      mkTextarea(JSON.stringify(f, null, 2), 220)
    )
  );

  openModal({
    title:'Filter bearbeiten',
    bodyEl: body,
    saveText:'Übernehmen',
    onSave:function(modal){
      f.filter_id = String(idIn.value || '').trim() || f.filter_id;
      f.apply_to.sensor_ids = selectedValues(applySel).map(function(x){ return toIntOrNull(x); }).filter(function(x){ return x !== null; });
      onSave(f);
      modal.close();
    }
  });
}

// ============================================================================
// Editors: Rule-Set / Rule
// ============================================================================

function defaultRule(ruleId){
  return {
    rule_id: ruleId,
    rule_name: 'rule_' + String(ruleId),
    process_scope: { p_ids: [], state_ids: [], modes: [], selectors: {} },
    execution: { evaluation_mode: 'on_event', exec_mode: 'parallel', priority: 100 },
    flags: { enabled: true, one_shot: false, one_shot_scope: 'global', reset_mode: 'never' },
    when_all: [],
    when_any: [],
    when_none: [],
    do: [],
    else_do: [],
    description: ''
  };
}

function ruleWizardModal(ctx, draftRule, onDone){
  var r = draftRule;

  // controls shared
  var look = ctx.look;
  var cfg = ctx.cfg;
  var projectStates = ctx.projectStates;

  var steps = [
    {
      id:'meta',
      title:'Meta',
      hint:'Name, Beschreibung, Flags',
      render:function(root){
        var rn = mkInput(r.rule_name, 'rule_name');
        rn.addEventListener('input', function(){ r.rule_name = String(rn.value||'').trim(); });

        var desc = mkInput(r.description || '', 'Beschreibung');
        desc.addEventListener('input', function(){ r.description = String(desc.value||'').trim(); });

        var en = el('input', { type:'checkbox', checked: r.flags ? (r.flags.enabled !== false) : true });
        en.addEventListener('change', function(){
          r.flags = isPlainObject(r.flags) ? r.flags : {};
          r.flags.enabled = !!en.checked;
        });

        root.appendChild(formGroup('rule_name', rn));
        root.appendChild(formGroup('description', desc));
        root.appendChild(formGroup('enabled', en));
      }
    },
    {
      id:'scope',
      title:'Scope',
      hint:'p_ids / state_ids / modes',
      render:function(root){
        r.process_scope = isPlainObject(r.process_scope) ? r.process_scope : { p_ids: [], state_ids: [], modes: [], selectors: {} };

        var pOpts = ensureArray(look.processes).map(function(p){
          return { value:String(p.p_id), text: labelProcess(p) };
        });
        var pSel = mkSelect(pOpts, ensureArray(r.process_scope.p_ids).map(String), true, 6);

        var sSel = el('select', { className:'select-input' });
        sSel.multiple = true;
        sSel.size = 8;

        function refreshStates(){
          clear(sSel);
          var allowedP = selectedValues(pSel).map(function(x){ return toIntOrNull(x); }).filter(function(x){ return x !== null; });
          projectStates.forEach(function(s){
            if(allowedP.length && allowedP.indexOf(s.p_id) < 0) return;
            var opt = el('option', { value:String(s.state_id), text: labelState(s, look) });
            if(ensureArray(r.process_scope.state_ids).map(String).indexOf(String(s.state_id)) >= 0) opt.selected = true;
            sSel.appendChild(opt);
          });
        }

        refreshStates();
        pSel.addEventListener('change', refreshStates);

        var mSel = mkSelect(modeOptions(look), ensureArray(r.process_scope.modes).map(String), true, 6);

        var apply = btn('Scope übernehmen', 'btn-primary', function(){
          r.process_scope.p_ids = selectedValues(pSel).map(function(x){ return toIntOrNull(x); }).filter(function(x){ return x !== null; });
          r.process_scope.state_ids = selectedValues(sSel).map(function(x){ return toIntOrNull(x); }).filter(function(x){ return x !== null; });
          r.process_scope.modes = selectedValues(mSel).filter(Boolean);
          showStatus('Scope aktualisiert', 'success');
        });

        root.appendChild(formGroup('p_ids', pSel));
        root.appendChild(formGroup('state_ids', sSel, 'Gefiltert nach p_ids'));
        root.appendChild(formGroup('modes', mSel));
        root.appendChild(apply);
      }
    },
    {
      id:'when',
      title:'Conditions',
      hint:'when_all / when_any / when_none',
      render:function(root){
        root.appendChild(el('div', { style:'font-weight:600; margin:8px 0 6px 0;', text:'when_all' }));
        root.appendChild(renderConditionList(r.when_all, ctx));
        root.appendChild(hr());

        root.appendChild(el('div', { style:'font-weight:600; margin:8px 0 6px 0;', text:'when_any' }));
        root.appendChild(renderConditionList(r.when_any, ctx));
        root.appendChild(hr());

        root.appendChild(el('div', { style:'font-weight:600; margin:8px 0 6px 0;', text:'when_none' }));
        root.appendChild(renderConditionList(r.when_none, ctx));
      }
    },
    {
      id:'do',
      title:'Actions',
      hint:'do / else_do',
      render:function(root){
        root.appendChild(el('div', { style:'font-weight:600; margin:8px 0 6px 0;', text:'do' }));
        root.appendChild(renderActionList(r.do, ctx));
        root.appendChild(hr());

        root.appendChild(el('div', { style:'font-weight:600; margin:8px 0 6px 0;', text:'else_do' }));
        root.appendChild(renderActionList(r.else_do, ctx));
      }
    },
    {
      id:'advanced',
      title:'Advanced',
      hint:'Execution/Flags/JSON',
      render:function(root){
        r.execution = isPlainObject(r.execution) ? r.execution : { evaluation_mode:'on_event', exec_mode:'parallel', priority:100 };
        r.flags = isPlainObject(r.flags) ? r.flags : { enabled:true, one_shot:false, one_shot_scope:'global', reset_mode:'never' };

        var evalMode = mkSelect([{value:'on_event',text:'on_event'},{value:'poll',text:'poll'}], toStr(r.execution.evaluation_mode||'on_event'), false);
        var execMode = mkSelect([{value:'parallel',text:'parallel'},{value:'serial',text:'serial'}], toStr(r.execution.exec_mode||'parallel'), false);
        var prio = mkNumberInput(toStr(r.execution.priority ?? 100), '100');

        var oneShot = el('input', { type:'checkbox', checked: !!r.flags.one_shot });
        var resetMode = mkSelect([{value:'never',text:'never'},{value:'on_change',text:'on_change'},{value:'time',text:'time'}], toStr(r.flags.reset_mode||'never'), false);

        var raw = mkTextarea(JSON.stringify(r, null, 2), 260);

        var apply = btn('Übernehmen', 'btn-primary', function(){
          r.execution.evaluation_mode = String(evalMode.value||'on_event');
          r.execution.exec_mode = String(execMode.value||'parallel');
          r.execution.priority = toIntOrNull(prio.value) || 100;

          r.flags.one_shot = !!oneShot.checked;
          r.flags.reset_mode = String(resetMode.value||'never');

          // raw override
          try{
            var p = JSON.parse(String(raw.value||'').trim());
            if(isPlainObject(p)) r = p;
          }catch(e){
            showEditorNotice('Advanced JSON ungültig: '+e.message);
          }
        });

        root.appendChild(el('div',{className:'hint-text',text:'Wenn du Advanced JSON änderst: Apply klicken. Sonst bleiben UI-Felder aktiv.'}));
        root.appendChild(formGroup('execution.evaluation_mode', evalMode));
        root.appendChild(formGroup('execution.exec_mode', execMode));
        root.appendChild(formGroup('execution.priority', prio));
        root.appendChild(formGroup('flags.one_shot', oneShot));
        root.appendChild(formGroup('flags.reset_mode', resetMode));
        root.appendChild(formGroup('RAW', raw));
        root.appendChild(apply);
      }
    }
  ];

  var wizard = makeWizard(steps, ctx);

  openModal({
    title:'Regel Wizard',
    bodyEl: wizard.root,
    saveText:'Speichern',
    onSave:function(modal){
      onDone(r);
      modal.close();
    }
  });
}

// ============================================================================
// Tab: Automation Rules
// ============================================================================

var UI_STATE = { selected_rule_set_id: null };

function renderAutomationRulesTab(container, deviceConfig){
  clear(container);

  var cfg = readAutomationCfg();
  var look = buildLookups(deviceConfig);
  var projectStates = getProjectStates(look);

  var validationBox = el('div', {});
  container.appendChild(validationBox);
  renderValidationBox(validationBox, validateAutomationCfg(cfg, look, projectStates));

  var layout = el('div', { className:'inline', style:'align-items:flex-start; gap:12px; margin-top: 10px;' });
  var left = el('div', { style:'min-width: 320px; max-width: 420px; flex: 0 0 auto;' });
  var right = el('div', { style:'flex: 1 1 auto; min-width: 0;' });
  layout.appendChild(left);
  layout.appendChild(right);
  container.appendChild(layout);

  // Rule-Sets card
  var rsCard = el('div', { className:'card' },
    el('div', { className:'card-title', text:'Rule-Sets' }),
    el('div', { className:'card-body' })
  );
  left.appendChild(rsCard);
  var rsBody = rsCard.querySelector('.card-body');

  // Ensure selected
  function pickSelected(){
    if(UI_STATE.selected_rule_set_id){
      var ok = cfg.automation_rule_sets.some(function(rs){ return String(rs.rule_set_id) === String(UI_STATE.selected_rule_set_id); });
      if(ok) return UI_STATE.selected_rule_set_id;
    }
    return cfg.automation_rule_sets[0] ? String(cfg.automation_rule_sets[0].rule_set_id) : null;
  }
  UI_STATE.selected_rule_set_id = pickSelected();

  // buttons
  rsBody.appendChild(el('div', { className:'btn-row' },
    btn('Neues Rule-Set', 'btn-primary', function(){
      var newCfg = readAutomationCfg();
      var ids = new Set(ensureArray(newCfg.automation_rule_sets).map(function(x){ return String(x.rule_set_id); }).filter(Boolean));
      var eng = newCfg.automation_engines[0] ? newCfg.automation_engines[0].engine_id : null;

      var rs = { rule_set_id: uniqStringId(ids, 'main'), rule_set_name: 'main', engine_id: eng || null, rules: [] };
      rs.rule_set_name = rs.rule_set_id;
      newCfg.automation_rule_sets.push(rs);
      writeAutomationCfg(newCfg, 'Rule-Set angelegt');
      UI_STATE.selected_rule_set_id = rs.rule_set_id;
      renderAutomationRulesTab(container, deviceConfig);
    }),
    btn('Aus Template…', 'btn-secondary', function(){
      openImportFromTemplate({
        kind:'rule_set',
        deviceConfig: deviceConfig,
        cfg: cfg,
        onDone:function(newCfg, newId){
          writeAutomationCfg(newCfg, 'Rule-Set aus Template übernommen');
          UI_STATE.selected_rule_set_id = newId;
          renderAutomationRulesTab(container, deviceConfig);
        }
      });
    })
  ));

  var rsList = el('div', { className:'rule-list', style:'margin-top:8px;' });

  function deleteRuleSet(rsId){
  confirmEditorAction('Rule-Set '+rsId+' löschen?', 'Rule-Set löschen', function(){

      var newCfg = readAutomationCfg();
      newCfg.automation_rule_sets = ensureArray(newCfg.automation_rule_sets).filter(function(rs){ return String(rs.rule_set_id) !== String(rsId); });

      // reference cleanup in profiles
      newCfg.automation = ensureArray(newCfg.automation).map(function(p){
        var pp = deepClone(p);
        pp.automation_rule_set_ids = ensureArray(pp.automation_rule_set_ids).filter(function(x){ return String(x) !== String(rsId); });
        return pp;
      });

      writeAutomationCfg(newCfg, 'Rule-Set gelöscht');
      UI_STATE.selected_rule_set_id = null;
      renderAutomationRulesTab(container, deviceConfig);
  });
}

  function duplicateRuleSet(rsId){
    var newCfg = readAutomationCfg();
    var src = ensureArray(newCfg.automation_rule_sets).find(function(rs){ return String(rs.rule_set_id) === String(rsId); });
    if(!src) return;
    var ids = new Set(ensureArray(newCfg.automation_rule_sets).map(function(x){ return String(x.rule_set_id); }).filter(Boolean));
    var copy = deepClone(src);
    copy.rule_set_id = uniqStringId(ids, String(src.rule_set_id) || 'main');
    copy.rule_set_name = copy.rule_set_name ? (String(copy.rule_set_name) + ' (copy)') : copy.rule_set_id;
    newCfg.automation_rule_sets.push(copy);
    writeAutomationCfg(newCfg, 'Rule-Set dupliziert');
    UI_STATE.selected_rule_set_id = copy.rule_set_id;
    renderAutomationRulesTab(container, deviceConfig);
  }

  function editRuleSetMeta(rsId){
    var newCfg = readAutomationCfg();
    var rs = ensureArray(newCfg.automation_rule_sets).find(function(x){ return String(x.rule_set_id) === String(rsId); });
    if(!rs) return;

    var idIn = mkInput(rs.rule_set_id, 'main');
    var nameIn = mkInput(rs.rule_set_name || '', 'Name');

    var engOpts = [{value:'',text:'(kein engine_id)'}].concat(ensureArray(newCfg.automation_engines).map(function(e){
      return { value: String(e.engine_id), text: String(e.engine_id) };
    }));
    var engSel = mkSelect(engOpts, rs.engine_id ? String(rs.engine_id) : '', false);

    var body = el('div', {},
      formGroup('rule_set_id', idIn),
      formGroup('rule_set_name', nameIn),
      formGroup('engine_id', engSel)
    );

    openModal({
      title:'Rule-Set Meta',
      bodyEl: body,
      saveText:'Übernehmen',
      onSave:function(modal){
        var oldId = String(rs.rule_set_id);
        rs.rule_set_id = String(idIn.value||'').trim() || rs.rule_set_id;
        rs.rule_set_name = String(nameIn.value||'').trim() || rs.rule_set_name;
        rs.engine_id = engSel.value ? String(engSel.value) : null;

        // if id changed -> update profile references
        if(oldId !== String(rs.rule_set_id)){
          newCfg.automation = ensureArray(newCfg.automation).map(function(p){
            var pp = deepClone(p);
            pp.automation_rule_set_ids = ensureArray(pp.automation_rule_set_ids).map(function(x){
              return (String(x) === oldId) ? String(rs.rule_set_id) : x;
            });
            return pp;
          });
        }

        writeAutomationCfg(newCfg, 'Rule-Set aktualisiert');
        UI_STATE.selected_rule_set_id = rs.rule_set_id;
        modal.close();
        renderAutomationRulesTab(container, deviceConfig);
      }
    });
  }

  ensureArray(cfg.automation_rule_sets).forEach(function(rs){
    var row = el('div', { className:'rule-item' });
    var isSel = String(rs.rule_set_id) === String(UI_STATE.selected_rule_set_id);

    row.appendChild(el('div', { className:'inline', style:'justify-content:space-between; align-items:center; gap:8px;' },
      el('div', { style:'font-weight:600;', text: rs.rule_set_id }),
      el('div', { className:'inline', style:'gap:6px; flex-wrap:wrap; justify-content:flex-end;' },
        btnSmall(isSel ? '✓' : 'Auswählen', isSel ? 'btn-primary' : 'btn-secondary', function(){
          UI_STATE.selected_rule_set_id = rs.rule_set_id;
          renderAutomationRulesTab(container, deviceConfig);
        }),
        btnSmall('Edit', 'btn-secondary', function(){ editRuleSetMeta(rs.rule_set_id); }),
        btnSmall('Dupl.', 'btn-secondary', function(){ duplicateRuleSet(rs.rule_set_id); }),
        btnSmall('Del', 'btn-danger', function(){ deleteRuleSet(rs.rule_set_id); })
      )
    ));

    rsList.appendChild(row);
  });

  if(!ensureArray(cfg.automation_rule_sets).length){
    rsList.appendChild(el('div', { className:'hint-text', text:'Noch keine Rule-Sets.' }));
  }
  rsBody.appendChild(rsList);

  // Rules card
  var rCard = el('div', { className:'card' },
    el('div', { className:'card-title', text:'Rules' }),
    el('div', { className:'card-body' })
  );
  right.appendChild(rCard);
  var rBody = rCard.querySelector('.card-body');

  var rsSel = UI_STATE.selected_rule_set_id
    ? cfg.automation_rule_sets.find(function(x){ return String(x.rule_set_id) === String(UI_STATE.selected_rule_set_id); })
    : null;

  if(!rsSel){
    rBody.appendChild(el('div', { className:'hint-text', text:'Wähle links ein Rule-Set.' }));
    return;
  }

  // Header actions
  rBody.appendChild(el('div', { className:'btn-row' },
    btn('Neue Regel (Wizard)', 'btn-primary', function(){
      var newCfg = readAutomationCfg();
      var rs2 = ensureArray(newCfg.automation_rule_sets).find(function(x){ return String(x.rule_set_id) === String(rsSel.rule_set_id); });
      if(!rs2){ showEditorNotice('Rule-Set nicht gefunden'); return; }
      rs2.rules = ensureArray(rs2.rules);

      var rid = nextNumericId(rs2.rules, 'rule_id');
      var draft = defaultRule(rid);

      var ctx = { cfg: newCfg, look: look, projectStates: projectStates };
      ruleWizardModal(ctx, draft, function(finalRule){
        rs2.rules.push(finalRule);
        writeAutomationCfg(newCfg, 'Regel gespeichert');
        renderAutomationRulesTab(container, deviceConfig);
      });
    }),
    btn('Regel aus Template…', 'btn-secondary', function(){
      openImportFromTemplate({
        kind:'rule',
        deviceConfig: deviceConfig,
        cfg: cfg,
        ruleSetId: rsSel.rule_set_id,
        onDone:function(newCfg){
          writeAutomationCfg(newCfg, 'Regel aus Template übernommen');
          renderAutomationRulesTab(container, deviceConfig);
        }
      });
    })
  ));

  rBody.appendChild(hr());

  var rules = ensureArray(rsSel.rules);

  function deleteRule(ruleId){
  confirmEditorAction('Regel #'+ruleId+' löschen?', 'Regel löschen', function(){

      var newCfg = readAutomationCfg();
      var rs2 = ensureArray(newCfg.automation_rule_sets).find(function(x){ return String(x.rule_set_id) === String(rsSel.rule_set_id); });
      if(!rs2) return;
      rs2.rules = ensureArray(rs2.rules).filter(function(r){ return String(r.rule_id) !== String(ruleId); });
      writeAutomationCfg(newCfg, 'Regel gelöscht');
      renderAutomationRulesTab(container, deviceConfig);
  });
}

  function duplicateRule(ruleId){
    var newCfg = readAutomationCfg();
    var rs2 = ensureArray(newCfg.automation_rule_sets).find(function(x){ return String(x.rule_set_id) === String(rsSel.rule_set_id); });
    if(!rs2) return;
    rs2.rules = ensureArray(rs2.rules);
    var src = rs2.rules.find(function(r){ return String(r.rule_id) === String(ruleId); });
    if(!src) return;
    var nid = nextNumericId(rs2.rules, 'rule_id');
    var copy = deepClone(src);
    copy.rule_id = nid;
    copy.rule_name = String(copy.rule_name || ('rule_'+nid)) + '_copy';
    rs2.rules.push(copy);
    writeAutomationCfg(newCfg, 'Regel dupliziert');
    renderAutomationRulesTab(container, deviceConfig);
  }

  function editRule(ruleId){
    var newCfg = readAutomationCfg();
    var rs2 = ensureArray(newCfg.automation_rule_sets).find(function(x){ return String(x.rule_set_id) === String(rsSel.rule_set_id); });
    if(!rs2) return;
    rs2.rules = ensureArray(rs2.rules);
    var idx = rs2.rules.findIndex(function(r){ return String(r.rule_id) === String(ruleId); });
    if(idx < 0) return;

    var draft = deepClone(rs2.rules[idx]);
    var ctx = { cfg: newCfg, look: look, projectStates: projectStates };

    ruleWizardModal(ctx, draft, function(finalRule){
      rs2.rules[idx] = finalRule;
      writeAutomationCfg(newCfg, 'Regel aktualisiert');
      renderAutomationRulesTab(container, deviceConfig);
    });
  }

  var list = el('div', { className:'rule-list' });
  rules.forEach(function(r){
    var head = el('div', { className:'rule-item' });

    head.appendChild(el('div', { style:'font-weight:600;', text:'#'+r.rule_id+' – '+toStr(r.rule_name) }));
    head.appendChild(el('div', { className:'hint-text', text:'when_all=' + ensureArray(r.when_all).length + ' | when_any=' + ensureArray(r.when_any).length + ' | do=' + ensureArray(r.do).length }));

    head.appendChild(el('div', { className:'btn-row' },
      btnSmall('Edit', 'btn-secondary', function(){ editRule(r.rule_id); }),
      btnSmall('Dupl.', 'btn-secondary', function(){ duplicateRule(r.rule_id); }),
      btnSmall('Del', 'btn-danger', function(){ deleteRule(r.rule_id); })
    ));

    list.appendChild(head);
  });

  if(!rules.length){
    list.appendChild(el('div', { className:'hint-text', text:'Noch keine Regeln.' }));
  }

  rBody.appendChild(list);
}

// ============================================================================
// Tab: Automation Config (profiles/engines/filters)
// ============================================================================

function renderAutomationConfigTab(container, deviceConfig){
  clear(container);
  var cfg = readAutomationCfg();
  var summary = automationContractSummary(cfg);
  var runtimeCfg = deviceConfig || state.get('deviceConfig') || {};
  var projectStates = ensureArray((state.get('processes') || {}).process_states);
  var projectRuleSets = ensureArray((state.get('dynamic_rule_engine') || {}).rule_sets);
  var freeTimers = ensureArray((state.get('free_rules') || {}).timers);

  var sections = el('div', { className:'pf-automation-runtime-sections' });
  ensureArray(summary.canonical_runtime_sections).forEach(function(sectionName){
    sections.appendChild(el('code', { text:sectionName }));
  });

  var grid = el('div', { className:'pf-automation-bridge-grid' },
    el('section', { className:'pf-automation-bridge-card' },
      el('h5', { text:'Projektmodell' }),
      el('div', { className:'hint-text', text:'Projekt-States: '+String(projectStates.length) }),
      el('div', { className:'hint-text', text:'Projektregelgruppen: '+String(projectRuleSets.length) }),
      el('div', { className:'hint-text', text:'Freie Timer: '+String(freeTimers.length) }),
      el('div', { className:'hint-text', text:'Schaltpläne: '+String(ensureArray((state.get('logic') || {}).diagrams).length) })
    ),
    el('section', { className:'pf-automation-bridge-card' },
      el('h5', { text:'Kanonische Runtime V9' }),
      el('div', { className:'hint-text', text:'Die Runtime-Projektion wird aus Projekt-States, Projektregeln und optionaler Schaltlogik erzeugt.' }),
      sections
    ),
    el('section', { className:'pf-automation-bridge-card' },
      el('h5', { text:'Runtime-Bestand' }),
      el('div', { className:'hint-text', text:'process_states: '+String(ensureArray(runtimeCfg.process_states).length) }),
      el('div', { className:'hint-text', text:'filters: '+String(ensureArray(runtimeCfg.filters).length) }),
      el('div', { className:'hint-text', text:'timers: '+String(ensureArray(runtimeCfg.timers).length) }),
      el('div', { className:'hint-text', text:'rule_engine: '+String(ensureArray(runtimeCfg.rule_engine).length) }),
      el('div', { className:'hint-text', text:'rules: '+String(ensureArray(runtimeCfg.rules).length) })
    ),
    el('section', { className:'pf-automation-bridge-card' },
      el('h5', { text:'Legacy-Migration' }),
      el('div', { className:'hint-text', text:'Archivierte automation_rule_sets: '+String(summary.legacy_rule_sets_preserved) }),
      el('div', { className:'hint-text', text:'Aktive doppelte Regelquellen: '+String(summary.duplicate_active_rule_sets) }),
      el('div', { className:'hint-text', text:'Historische Daten bleiben schreibgeschützt erhalten und werden nicht als aktive V9-Regeln exportiert.' })
    )
  );

  container.appendChild(el('div', { className:'card' },
    el('div', { className:'card-title', text:'PF-AUTOMATION-V9-BRIDGE' }),
    el('div', { className:'card-body' },
      el('div', { className:'hint-text', text:'Eine Autorität: Projektregeln werden unter „Projektregeln“ bearbeitet; Runtime-Regeln unter „Runtime-Regeln V9“ geprüft.' }),
      grid
    )
  ));

  if(summary.legacy_rule_sets_preserved > 0){
    container.appendChild(el('details', {},
      el('summary', { text:'Archivierte Legacy-Regeln anzeigen ('+String(summary.legacy_rule_sets_preserved)+')' }),
      el('pre', { text:JSON.stringify(cfg.legacy_automation_rule_sets, null, 2) })
    ));
  }
}

function renderParameterSchemasTab(container, deviceConfig){
  clear(container);

  var cfg = readDeviceConfig();
  var tpl = deviceConfig || state.get('deviceConfig') || {};
  var schemas = ensureArray(cfg.parameter_schemas);
  var mappings = ensureArray(cfg.state_type_parameter_schema_mappings);

  // Small helper for saving
  function commit(newCfg, msg){
    writeDeviceConfig(newCfg, msg);
    renderParameterSchemasTab(container, deviceConfig);
  }

  // Validation summary for schemas/mappings
  var sum = el('div', {});
  container.appendChild(sum);

  function validateSchemas(){
    var errs = [];
    var warns = [];

    var schemaIds = new Set(schemas.map(function(s){ return String(s.parameter_schema_id||''); }).filter(Boolean));
    var seen = new Set();

    schemas.forEach(function(s){
      var id = String(s.parameter_schema_id||'');
      if(!id) errs.push('Schema ohne parameter_schema_id');
      if(id){
        if(seen.has(id)) errs.push('Doppeltes parameter_schema_id: '+id);
        seen.add(id);
      }
    });

    mappings.forEach(function(m){
      var mid = toIntOrNull(m.mapping_id);
      if(mid === null) warns.push('Mapping ohne mapping_id');
      if(m.parameter_schema_id && !schemaIds.has(String(m.parameter_schema_id))){
        warns.push('Mapping '+String(m.mapping_id||'?')+': parameter_schema_id fehlt: '+String(m.parameter_schema_id));
      }
    });

    return { errors: errs, warnings: warns };
  }

  renderValidationBox(sum, validateSchemas());

  // --- Schemas Section ---
  var schemasCard = el('div', { className:'card' },
    el('div', { className:'card-title', text:'Parameter Schemas' }),
    el('div', { className:'card-body' })
  );
  container.appendChild(schemasCard);

  var scBody = schemasCard.querySelector('.card-body');

  scBody.appendChild(el('div', { className:'btn-row' },
    btn('Neu', 'btn-primary', function(){
      var newCfg = readDeviceConfig();
      var ids = new Set(ensureArray(newCfg.parameter_schemas).map(function(x){ return String(x.parameter_schema_id); }).filter(Boolean));
      var id = uniqStringId(ids, 'schema_new');
      newCfg.parameter_schemas = ensureArray(newCfg.parameter_schemas);
      newCfg.parameter_schemas.push({ parameter_schema_id:id, description:'', fields:[], constraints:[] });
      commit(newCfg, 'Schema angelegt');
    }),
    btn('Aus Template…', 'btn-secondary', function(){
      openImportFromTemplate({
        kind:'parameter_schema',
        deviceConfig: tpl,
        cfg: null,
        onDone:function(newCfg){
          // newCfg is deviceConfig in this case
          commit(newCfg, 'Schema aus Template übernommen');
        }
      });
    })
  ));

  function editSchema(id){
    var newCfg = readDeviceConfig();
    newCfg.parameter_schemas = ensureArray(newCfg.parameter_schemas);
    var s = newCfg.parameter_schemas.find(function(x){ return String(x.parameter_schema_id) === String(id); });
    if(!s) return;

    var draft = deepClone(s);

    var idIn = mkInput(draft.parameter_schema_id, 'schema_x');
    var descIn = mkInput(draft.description || '', 'Beschreibung');

    draft.fields = ensureArray(draft.fields);
    draft.constraints = ensureArray(draft.constraints);

    var fieldsList = el('div', { className:'rule-list' });
    function renderFields(){
      clear(fieldsList);
      draft.fields.forEach(function(f, idx){
        var row = el('div', { className:'rule-item' });
        var fid = mkNumberInput(toStr(f.field_id ?? ''), 'field_id');
        fid.addEventListener('input', function(){ f.field_id = toIntOrNull(fid.value) || 0; });

        var req = el('input', { type:'checkbox', checked: !!f.required });
        req.addEventListener('change', function(){ f.required = !!req.checked; });

        row.appendChild(el('div', { className:'inline', style:'gap:8px; flex-wrap:wrap; justify-content:space-between;' },
          el('div', { className:'inline', style:'gap:8px; flex-wrap:wrap;' },
            el('div', { style:'min-width:180px;' }, formGroup('field_id', fid)),
            formGroup('required', req)
          ),
          btnSmall('Löschen', 'btn-danger', function(){
            draft.fields.splice(idx,1);
            renderFields();
          })
        ));
        fieldsList.appendChild(row);
      });
      if(!draft.fields.length) fieldsList.appendChild(el('div',{className:'hint-text',text:'Keine Fields.'}));
    }
    renderFields();

    var addFieldBtn = btn('Field hinzufügen', 'btn-primary', function(){
      draft.fields.push({ field_id: 1, required: false });
      renderFields();
    });

    // Constraints builder (range, one_of_required, raw)
    var consList = el('div', { className:'rule-list' });

    function renderConstraintRow(c, idx){
      var row = el('div', { className:'rule-item' });

      var typeSel = mkSelect(
        [{value:'range',text:'range'},{value:'one_of_required',text:'one_of_required'},{value:'raw',text:'raw'}],
        String(c.type || 'raw'),
        false
      );
      typeSel.addEventListener('change', function(){
        var t = String(typeSel.value);
        if(t === 'range') draft.constraints[idx] = { type:'range', key:'', min:0, max:0 };
        else if(t === 'one_of_required') draft.constraints[idx] = { type:'one_of_required', keys:[], description:'' };
        else draft.constraints[idx] = { type:'raw', value:{} };
        renderConstraints();
      });

      var body = el('div', { style:'margin-top:8px;' });

      if(String(c.type) === 'range'){
        var keyIn = mkInput(c.key || '', 'target_temp_c');
        keyIn.addEventListener('input', function(){ c.key = String(keyIn.value||'').trim(); });
        var minIn = mkNumberInput(toStr(c.min ?? 0), '-50');
        minIn.addEventListener('input', function(){ c.min = toNumOr(minIn.value, 0); });
        var maxIn = mkNumberInput(toStr(c.max ?? 0), '2000');
        maxIn.addEventListener('input', function(){ c.max = toNumOr(maxIn.value, 0); });

        body.appendChild(el('div',{className:'inline',style:'gap:8px; flex-wrap:wrap;'},
          el('div',{style:'min-width:240px;'}, formGroup('key', keyIn)),
          el('div',{style:'min-width:160px;'}, formGroup('min', minIn)),
          el('div',{style:'min-width:160px;'}, formGroup('max', maxIn))
        ));
      }else if(String(c.type) === 'one_of_required'){
        var keysIn = mkInput(ensureArray(c.keys).join(', '), 'target_temp_c, power');
        keysIn.addEventListener('input', function(){
          c.keys = String(keysIn.value||'').split(',').map(function(x){ return x.trim(); }).filter(Boolean);
        });
        var dIn = mkInput(c.description || '', 'Beschreibung');
        dIn.addEventListener('input', function(){ c.description = String(dIn.value||'').trim(); });
        body.appendChild(formGroup('keys (csv)', keysIn));
        body.appendChild(formGroup('description', dIn));
      }else{
        var rawTa = mkTextarea(JSON.stringify(c.value !== undefined ? c.value : c, null, 2), 140);
        rawTa.addEventListener('input', function(){
          try{ c.value = JSON.parse(String(rawTa.value||'').trim()); }catch(_e){}
        });
        body.appendChild(formGroup('raw', rawTa));
      }

      row.appendChild(el('div', { className:'inline', style:'justify-content:space-between; align-items:center; gap:8px;' },
        typeSel,
        btnSmall('Löschen', 'btn-danger', function(){ draft.constraints.splice(idx,1); renderConstraints(); })
      ));
      row.appendChild(body);
      return row;
    }

    function renderConstraints(){
      clear(consList);
      draft.constraints.forEach(function(c, idx){
        consList.appendChild(renderConstraintRow(c, idx));
      });
      if(!draft.constraints.length) consList.appendChild(el('div',{className:'hint-text',text:'Keine Constraints.'}));
    }
    renderConstraints();

    var addConsSel = mkSelect(
      [{value:'range',text:'range'},{value:'one_of_required',text:'one_of_required'},{value:'raw',text:'raw'}],
      'range',
      false
    );
    var addConsBtn = btn('Constraint hinzufügen', 'btn-primary', function(){
      var t = String(addConsSel.value);
      if(t === 'range') draft.constraints.push({ type:'range', key:'', min:0, max:0 });
      else if(t === 'one_of_required') draft.constraints.push({ type:'one_of_required', keys:[], description:'' });
      else draft.constraints.push({ type:'raw', value:{} });
      renderConstraints();
    });

    var rawAll = mkTextarea(JSON.stringify(draft, null, 2), 240);

    var body = el('div', {},
      formGroup('parameter_schema_id', idIn),
      formGroup('description', descIn),
      hr(),
      el('div',{style:'font-weight:600; margin-bottom:6px;', text:'fields'}),
      addFieldBtn,
      fieldsList,
      hr(),
      el('div',{style:'font-weight:600; margin-bottom:6px;', text:'constraints'}),
      el('div',{className:'btn-row'}, addConsSel, addConsBtn),
      consList,
      hr(),
      el('details', {}, el('summary',{text:'RAW Schema JSON'}), rawAll)
    );

    openModal({
      title:'Schema bearbeiten',
      bodyEl: body,
      saveText:'Übernehmen',
      onSave:function(modal){
        // apply minimal fields
        draft.parameter_schema_id = String(idIn.value||'').trim() || draft.parameter_schema_id;
        draft.description = String(descIn.value||'').trim();

        // raw override if possible
        var raw = String(rawAll.value||'').trim();
        if(raw){
          try{
            var parsed = JSON.parse(raw);
            if(isPlainObject(parsed)) draft = parsed;
          }catch(_e){}
        }

        // ensure arrays
        draft.fields = ensureArray(draft.fields);
        draft.constraints = ensureArray(draft.constraints);

        // id uniqueness
        var ids = new Set(newCfg.parameter_schemas.map(function(x){ return String(x.parameter_schema_id); }).filter(Boolean));
        ids.delete(String(s.parameter_schema_id));
        if(String(draft.parameter_schema_id) !== String(s.parameter_schema_id)){
          draft.parameter_schema_id = uniqStringId(ids, draft.parameter_schema_id);
        }

        Object.keys(s).forEach(function(k){ delete s[k]; });
        Object.assign(s, draft);

        commit(newCfg, 'Schema aktualisiert');
        modal.close();
      }
    });
  }

  function duplicateSchema(id){
    var newCfg = readDeviceConfig();
    newCfg.parameter_schemas = ensureArray(newCfg.parameter_schemas);
    var src = newCfg.parameter_schemas.find(function(x){ return String(x.parameter_schema_id) === String(id); });
    if(!src) return;
    var ids = new Set(newCfg.parameter_schemas.map(function(x){ return String(x.parameter_schema_id); }).filter(Boolean));
    var copy = deepClone(src);
    copy.parameter_schema_id = uniqStringId(ids, String(src.parameter_schema_id) || 'schema');
    copy.description = (copy.description ? String(copy.description) : '') + ' (copy)';
    newCfg.parameter_schemas.push(copy);
    commit(newCfg, 'Schema dupliziert');
  }

  function deleteSchema(id){
  confirmEditorAction('Schema '+id+' löschen?', 'Schema löschen', function(){

      var newCfg = readDeviceConfig();
      newCfg.parameter_schemas = ensureArray(newCfg.parameter_schemas).filter(function(x){ return String(x.parameter_schema_id) !== String(id); });

      // cleanup mappings
      newCfg.state_type_parameter_schema_mappings = ensureArray(newCfg.state_type_parameter_schema_mappings).map(function(m){
        var mm = deepClone(m);
        if(String(mm.parameter_schema_id) === String(id)) mm.parameter_schema_id = null;
        return mm;
      });

      commit(newCfg, 'Schema gelöscht');
  });
}

  var schemaList = el('div', { className:'rule-list', style:'margin-top:8px;' });
  schemas.forEach(function(s){
    var id = String(s.parameter_schema_id||'');
    schemaList.appendChild(el('div',{className:'rule-item'},
      el('div',{className:'inline',style:'justify-content:space-between; align-items:center; gap:8px;'},
        el('div',{style:'font-weight:600;',text:id}),
        el('div',{className:'inline',style:'gap:6px; flex-wrap:wrap; justify-content:flex-end;'},
          btnSmall('Edit','btn-secondary',function(){ editSchema(id); }),
          btnSmall('Dupl.','btn-secondary',function(){ duplicateSchema(id); }),
          btnSmall('Del','btn-danger',function(){ deleteSchema(id); })
        )
      ),
      el('div',{className:'hint-text',text: toStr(s.description || '')})
    ));
  });
  if(!schemas.length) schemaList.appendChild(el('div',{className:'hint-text',text:'Noch keine Schemas.'}));
  scBody.appendChild(schemaList);

  // --- Mappings Section ---
  var mapCard = el('div', { className:'card' },
    el('div', { className:'card-title', text:'State-Type → Schema Mappings' }),
    el('div', { className:'card-body' })
  );
  container.appendChild(mapCard);

  var mpBody = mapCard.querySelector('.card-body');

  mpBody.appendChild(el('div',{className:'btn-row'},
    btn('Neu','btn-primary',function(){
      var newCfg = readDeviceConfig();
      newCfg.state_type_parameter_schema_mappings = ensureArray(newCfg.state_type_parameter_schema_mappings);
      var nid = nextNumericId(newCfg.state_type_parameter_schema_mappings, 'mapping_id');
      newCfg.state_type_parameter_schema_mappings.push({ mapping_id:nid, state_type:'', parameter_schema_id: schemas[0] ? schemas[0].parameter_schema_id : null, match:{}, priority:10, is_default:false });
      commit(newCfg, 'Mapping angelegt');
    }),
    btn('Aus Template…','btn-secondary',function(){
      openImportFromTemplate({
        kind:'mapping',
        deviceConfig: tpl,
        cfg: null,
        onDone:function(newCfg){
          commit(newCfg, 'Mapping aus Template übernommen');
        }
      });
    })
  ));

  function guessStateTypes(){
    var set = new Set();
    ensureArray(cfg.process_states).forEach(function(ps){
      if(ps && ps.state_type) set.add(String(ps.state_type));
    });
    mappings.forEach(function(m){
      if(m && m.state_type) set.add(String(m.state_type));
    });
    return Array.from(set).sort();
  }

  function editMapping(mappingId){
    var newCfg = readDeviceConfig();
    newCfg.state_type_parameter_schema_mappings = ensureArray(newCfg.state_type_parameter_schema_mappings);
    var m = newCfg.state_type_parameter_schema_mappings.find(function(x){ return String(x.mapping_id) === String(mappingId); });
    if(!m) return;
    var draft = deepClone(m);

    var midIn = mkNumberInput(toStr(draft.mapping_id ?? ''), '100');
    var stTypes = guessStateTypes();
    var stSel = mkSelect(stTypes.map(function(t){ return { value:t, text:t }; }), toStr(draft.state_type || ''), false);

    var schemaOpts = ensureArray(newCfg.parameter_schemas).map(function(s){
      return { value:String(s.parameter_schema_id), text:String(s.parameter_schema_id) };
    });
    var schemaSel = mkSelect(schemaOpts, draft.parameter_schema_id ? String(draft.parameter_schema_id) : '', false);

    var prioIn = mkNumberInput(toStr(draft.priority ?? 10), '10');
    var defCb = el('input', { type:'checkbox', checked: !!draft.is_default });

    draft.match = isPlainObject(draft.match) ? draft.match : {};
    var pidCb = el('input', { type:'checkbox', checked: ensureArray(draft.match.control_strategy_types_any).indexOf('PID') >= 0 });
    var cmCb  = el('input', { type:'checkbox', checked: ensureArray(draft.match.control_strategy_types_any).indexOf('control_method') >= 0 });

    var matchTa = mkTextarea(JSON.stringify(draft.match, null, 2), 160);

    function syncMatchFromCheckbox(){
      var arr = [];
      if(pidCb.checked) arr.push('PID');
      if(cmCb.checked) arr.push('control_method');
      if(arr.length) draft.match.control_strategy_types_any = arr;
      else delete draft.match.control_strategy_types_any;
      matchTa.value = JSON.stringify(draft.match, null, 2);
    }
    pidCb.addEventListener('change', syncMatchFromCheckbox);
    cmCb.addEventListener('change', syncMatchFromCheckbox);

    matchTa.addEventListener('input', function(){
      try{
        var p = JSON.parse(String(matchTa.value||'').trim() || '{}');
        if(isPlainObject(p)) draft.match = p;
      }catch(_e){}
    });

    var body = el('div', {},
      formGroup('mapping_id', midIn),
      formGroup('state_type', stSel),
      formGroup('parameter_schema_id', schemaSel),
      formGroup('priority', prioIn),
      formGroup('is_default', defCb),
      hr(),
      el('div',{style:'font-weight:600; margin-bottom:6px;', text:'match (Wizard + JSON)'}),
      el('div',{className:'inline',style:'gap:12px; flex-wrap:wrap;'},
        formGroup('control_strategy_types_any: PID', pidCb),
        formGroup('control_strategy_types_any: control_method', cmCb)
      ),
      formGroup('match JSON', matchTa)
    );

    openModal({
      title:'Mapping bearbeiten',
      bodyEl: body,
      saveText:'Übernehmen',
      onSave:function(modal){
        draft.mapping_id = toIntOrNull(midIn.value) || draft.mapping_id;
        draft.state_type = String(stSel.value||'').trim();
        draft.parameter_schema_id = schemaSel.value ? String(schemaSel.value) : null;
        draft.priority = toIntOrNull(prioIn.value) || 10;
        draft.is_default = !!defCb.checked;

        // id uniqueness for mapping_id (numeric)
        var ids = new Set(newCfg.state_type_parameter_schema_mappings.map(function(x){ return String(x.mapping_id); }));
        ids.delete(String(m.mapping_id));
        if(ids.has(String(draft.mapping_id))){
          showEditorNotice('mapping_id bereits vergeben: '+String(draft.mapping_id));
          return;
        }

        Object.keys(m).forEach(function(k){ delete m[k]; });
        Object.assign(m, draft);

        commit(newCfg, 'Mapping aktualisiert');
        modal.close();
      }
    });
  }

  function duplicateMapping(mappingId){
    var newCfg = readDeviceConfig();
    newCfg.state_type_parameter_schema_mappings = ensureArray(newCfg.state_type_parameter_schema_mappings);
    var src = newCfg.state_type_parameter_schema_mappings.find(function(x){ return String(x.mapping_id) === String(mappingId); });
    if(!src) return;
    var nid = nextNumericId(newCfg.state_type_parameter_schema_mappings, 'mapping_id');
    var copy = deepClone(src);
    copy.mapping_id = nid;
    copy.is_default = false;
    newCfg.state_type_parameter_schema_mappings.push(copy);
    commit(newCfg, 'Mapping dupliziert');
  }

  function deleteMapping(mappingId){
  confirmEditorAction('Mapping '+mappingId+' löschen?', 'Mapping löschen', function(){

      var newCfg = readDeviceConfig();
      newCfg.state_type_parameter_schema_mappings = ensureArray(newCfg.state_type_parameter_schema_mappings).filter(function(x){ return String(x.mapping_id) !== String(mappingId); });
      commit(newCfg, 'Mapping gelöscht');
  });
}

  var mapList = el('div', { className:'rule-list', style:'margin-top:8px;' });
  mappings.forEach(function(m){
    var mid = String(m.mapping_id||'');
    mapList.appendChild(el('div',{className:'rule-item'},
      el('div',{className:'inline',style:'justify-content:space-between; align-items:center; gap:8px;'},
        el('div',{style:'font-weight:600;',text:'#'+mid+' – '+toStr(m.state_type)}),
        el('div',{className:'inline',style:'gap:6px; flex-wrap:wrap; justify-content:flex-end;'},
          btnSmall('Edit','btn-secondary',function(){ editMapping(mid); }),
          btnSmall('Dupl.','btn-secondary',function(){ duplicateMapping(mid); }),
          btnSmall('Del','btn-danger',function(){ deleteMapping(mid); })
        )
      ),
      el('div',{className:'hint-text',text:'schema=' + toStr(m.parameter_schema_id) + ' | prio=' + toStr(m.priority) + (m.is_default ? ' | default' : '')})
    ));
  });
  if(!mappings.length) mapList.appendChild(el('div',{className:'hint-text',text:'Noch keine Mappings.'}));
  mpBody.appendChild(mapList);

  // Quick export hint
  container.appendChild(el('div',{className:'hint-text',text:'Hinweis: parameter_schemas + mappings werden beim Export aus deviceConfig übernommen. Änderungen werden als device_config_overrides im Projekt gespeichert.'}));
}

// ============================================================================
// Template import helpers (Automation + Schemas)
// ============================================================================

function openImportFromTemplate(opts){
  var kind = String(opts && opts.kind || '');
  var deviceConfig = opts && opts.deviceConfig ? opts.deviceConfig : (state.get('deviceConfig') || {});
  var cfg = opts && opts.cfg ? normalizeAutomationCfg(opts.cfg) : null;

  var template = getTemplateAutomation(deviceConfig);

  var tplItems = [];
  var idKey = null;
  var title = 'Aus Template übernehmen';

  if(kind === 'engine'){ tplItems = ensureArray(template.automation_engines); idKey = 'engine_id'; title = 'Engine aus Template übernehmen'; }
  else if(kind === 'filter'){ tplItems = ensureArray(template.automation_filters); idKey = 'filter_id'; title = 'Filter aus Template übernehmen'; }
  else if(kind === 'automation'){ tplItems = ensureArray(template.automation); idKey = 'automation_id'; title = 'Profil aus Template übernehmen'; }
  else if(kind === 'rule_set'){ tplItems = ensureArray(template.automation_rule_sets); idKey = 'rule_set_id'; title = 'Rule-Set aus Template übernehmen'; }
  else if(kind === 'rule'){
    var rsId = String(opts && opts.ruleSetId || '');
    var rs = ensureArray(template.automation_rule_sets).find(function(x){ return String(x.rule_set_id) === rsId; }) || null;
    tplItems = rs ? ensureArray(rs.rules) : [];
    idKey = 'rule_id';
    title = 'Regel aus Template übernehmen';
  }
  else if(kind === 'parameter_schema'){
    tplItems = ensureArray(deviceConfig.parameter_schemas);
    idKey = 'parameter_schema_id';
    title = 'Schema aus Template übernehmen';
  }
  else if(kind === 'mapping'){
    tplItems = ensureArray(deviceConfig.state_type_parameter_schema_mappings);
    idKey = 'mapping_id';
    title = 'Mapping aus Template übernehmen';
  }
  else{
    showStatus('Template-Import: unbekannter Typ: '+kind, 'error');
    return;
  }

  var body = el('div', {});
  body.appendChild(el('div', { className:'hint-text', text:'Template-Objekte sind nur Vorlagen. Übernehmen kopiert sie ins Projekt (oder in deviceConfig bei Schemas/Mappings).' }));

  var sel = el('select', { className:'select-input', style:'width:100%;' });
  sel.appendChild(el('option', { value:'', text:'– Auswahl –' }));
  tplItems.forEach(function(it, idx){
    var id = (it && it[idKey] !== undefined) ? it[idKey] : ('#'+idx);
    sel.appendChild(el('option', { value:String(idx), text:String(id) }));
  });
  body.appendChild(formGroup('Vorlage', sel));

  var preview = mkTextarea('', 260);
  body.appendChild(formGroup('Vorschau', preview));

  function refresh(){
    var idx = sel.value ? Number(sel.value) : null;
    preview.value = idx === null ? '' : JSON.stringify(tplItems[idx] || {}, null, 2);
  }
  sel.addEventListener('change', refresh);
  refresh();

  openModal({
    title: title,
    bodyEl: body,
    saveText: 'Übernehmen',
    onSave: function(modal){
      var idx = sel.value ? Number(sel.value) : null;
      if(idx === null || !Number.isFinite(idx)){ showEditorNotice('Bitte Vorlage auswählen'); return; }
      var obj = deepClone(tplItems[idx] || {});
      if(kind === 'parameter_schema' || kind === 'mapping'){
        // deviceConfig copy
        var dc = readDeviceConfig();

        if(kind === 'parameter_schema'){
          dc.parameter_schemas = ensureArray(dc.parameter_schemas);
          var ids = new Set(dc.parameter_schemas.map(function(x){ return String(x.parameter_schema_id); }).filter(Boolean));
          obj.parameter_schema_id = uniqStringId(ids, obj.parameter_schema_id || 'schema');
          dc.parameter_schemas.push(obj);
          if(opts && typeof opts.onDone === 'function') opts.onDone(dc, obj.parameter_schema_id);
        }else{
          dc.state_type_parameter_schema_mappings = ensureArray(dc.state_type_parameter_schema_mappings);
          obj.mapping_id = nextNumericId(dc.state_type_parameter_schema_mappings, 'mapping_id');
          dc.state_type_parameter_schema_mappings.push(obj);
          if(opts && typeof opts.onDone === 'function') opts.onDone(dc, obj.mapping_id);
        }

        modal.close();
        return;
      }

      var newCfg = readAutomationCfg();

      if(kind === 'engine'){
        newCfg.automation_engines = ensureArray(newCfg.automation_engines);
        var eids = new Set(newCfg.automation_engines.map(function(x){ return String(x.engine_id); }).filter(Boolean));
        obj.engine_id = uniqStringId(eids, obj.engine_id || 'engine');
        newCfg.automation_engines.push(obj);
        if(opts && typeof opts.onDone === 'function') opts.onDone(newCfg, obj.engine_id);
      }else if(kind === 'filter'){
        newCfg.automation_filters = ensureArray(newCfg.automation_filters);
        var fids = new Set(newCfg.automation_filters.map(function(x){ return String(x.filter_id); }).filter(Boolean));
        obj.filter_id = uniqStringId(fids, obj.filter_id || 'filter');
        newCfg.automation_filters.push(obj);
        if(opts && typeof opts.onDone === 'function') opts.onDone(newCfg, obj.filter_id);
      }else if(kind === 'automation'){
        newCfg.automation = ensureArray(newCfg.automation);
        var pids = new Set(newCfg.automation.map(function(x){ return String(x.automation_id); }).filter(Boolean));
        obj.automation_id = uniqStringId(pids, obj.automation_id || 'default');
        newCfg.automation.push(obj);
        if(opts && typeof opts.onDone === 'function') opts.onDone(newCfg, obj.automation_id);
      }else if(kind === 'rule_set'){
        newCfg.automation_rule_sets = ensureArray(newCfg.automation_rule_sets);
        var rsids = new Set(newCfg.automation_rule_sets.map(function(x){ return String(x.rule_set_id); }).filter(Boolean));
        obj.rule_set_id = uniqStringId(rsids, obj.rule_set_id || 'main');
        obj.rule_set_name = obj.rule_set_name || obj.rule_set_id;
        obj.rules = ensureArray(obj.rules);
        newCfg.automation_rule_sets.push(obj);
        if(opts && typeof opts.onDone === 'function') opts.onDone(newCfg, obj.rule_set_id);
      }else if(kind === 'rule'){
        var rsId = String(opts && opts.ruleSetId || '');
        var rs = ensureArray(newCfg.automation_rule_sets).find(function(x){ return String(x.rule_set_id) === rsId; });
        if(!rs){ showEditorNotice('Rule-Set fehlt: '+rsId); return; }
        rs.rules = ensureArray(rs.rules);
        obj.rule_id = nextNumericId(rs.rules, 'rule_id');
        rs.rules.push(obj);
        if(opts && typeof opts.onDone === 'function') opts.onDone(newCfg, obj.rule_id);
      }

      modal.close();
    }
  });
}

// ============================================================================
// init
// ============================================================================

export function initAutomationTabs(opts){
  var o = opts || {};
  var deviceConfig = o.deviceConfig || state.get('deviceConfig') || {};
  var mounts = o.mounts || {};
  var schemasEl = mounts.schemasEl;
  var configEl = mounts.configEl;

  if(!schemasEl || !configEl){
    console.warn('[automation_tabs] Mount-Elemente fehlen (schemasEl/configEl)');
    return;
  }

  ensureAutomationCfg();

  function rerender(){
    renderParameterSchemasTab(schemasEl, deviceConfig);
    renderAutomationConfigTab(configEl, deviceConfig);
  }

  rerender();

  if(typeof state.subscribe === 'function'){
    state.subscribe('automation_cfg', rerender);
    state.subscribe('processes', rerender);
    state.subscribe('dynamic_rule_engine', rerender);
    state.subscribe('logic', rerender);
    state.subscribe('free_rules', rerender);
    state.subscribe('deviceConfig', rerender);
  }

  showStatus('Automation- und Schema-Hilfen bereit', 'success');
}
