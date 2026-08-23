// model_adapter.js
// Adapter-Funktionen: Editor-State -> Runtime-Config
// Keine externen Abhängigkeiten.
import { normalizeSvgEventAnimations, validateSvgEventAnimations } from './svg_event_runtime.js';
import { normalizePlantDrawing, validatePlantDrawing } from './v64_plant_drawing_model.js';

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
function exportElements(appState) {
    // kompatibel: akzeptiert state als Parameter ODER nutzt global 'state'
    var s = appState || (typeof state !== 'undefined' ? state : null);
    try {
        if (s && typeof s.get === 'function') {
            return deepClone(s.get('elements') || []);
        }
    }
    catch (_e) { }
    return [];
}
function exportConnections(appState) {
    var s = appState || (typeof state !== 'undefined' ? state : null);
    try {
        if (s && typeof s.get === 'function') {
            return deepClone(s.get('connections') || []);
        }
    }
    catch (_e) { }
    return [];
}
// ===================== PATCH: Export pruning + HMI sanity report =====================
function toNumber(value, fallback) {
    if (value === null || value === undefined)
        return fallback;
    if (typeof value === 'string') {
        var t = value.trim();
        if (t === '')
            return fallback;
        var n = Number(t);
        return Number.isFinite(n) ? n : fallback;
    }
    var n2 = Number(value);
    return Number.isFinite(n2) ? n2 : fallback;
}
function pruneHardwareConfigForExport(cfg) {
    if (!cfg || typeof cfg !== 'object')
        return cfg;
    var keys = [
        'controllers',
        'virtual_controllers',
        'controller_node_bindings',
        'nodes',
        'node_registrar',
        'sensors',
        'actuators',
        'devices'
    ];
    keys.forEach(function (k) {
        cfg[k] = [];
    });
    return cfg;
}
/*
function sanitizeAutomationProcessStateMappingsForExport(mappings) {
  if (!Array.isArray(mappings)) return [];

  return mappings.map(function (m) {
    var gs = {};
    if (m && typeof m === 'object' && m.general_settings && typeof m.general_settings === 'object') {
      gs = JSON.parse(JSON.stringify(m.general_settings));
    }
    return { general_settings: gs };
  });
} */
function ensureArrayKey(obj, key) {
    if (!obj || typeof obj !== 'object')
        return;
    if (!Array.isArray(obj[key]))
        obj[key] = [];
}
function ensureObjectKey(obj, key, fallback) {
    if (!obj || typeof obj !== 'object')
        return;
    if (!obj[key] || typeof obj[key] !== 'object')
        obj[key] = fallback;
}
function sanitizeHmiUiForExport(hmiUi, context) {
    var ui = deepClone(hmiUi || {});
    if (!ui || typeof ui !== 'object')
        ui = {};
    if (!Array.isArray(ui.widgets))
        ui.widgets = [];
    if (!Array.isArray(ui.bindings))
        ui.bindings = [];
    if (!Array.isArray(ui.views))
        ui.views = [];
    if (!Array.isArray(ui.styles))
        ui.styles = [];
    if (!Array.isArray(ui.alarms))
        ui.alarms = [];
    if (!Array.isArray(ui.event_animations))
        ui.event_animations = [];
    ui.event_animations = normalizeSvgEventAnimations(ui.event_animations);
    var widgetIds = {};
    ui.widgets.forEach(function (w) {
        if (w && w.widget_id)
            widgetIds[w.widget_id] = true;
    });
    var outBindings = [];
    var report = { dropped_bindings: [], kept_bindings: 0, event_animations: null };
    ui.bindings.forEach(function (b) {
        if (!b || typeof b !== 'object')
            return;
        var reasons = [];
        if (!b.binding_id)
            reasons.push('binding_id fehlt');
        if (!b.widget_id)
            reasons.push('widget_id fehlt');
        else if (!widgetIds[b.widget_id])
            reasons.push('widget_id unbekannt');
        if (!b.element_id)
            reasons.push('element_id fehlt');
        var hasSource = b.source && typeof b.source === 'object';
        var hasInteraction = b.interaction && typeof b.interaction === 'object';
        if (!hasSource && !hasInteraction)
            reasons.push('source/interaction fehlt');
        if (hasSource) {
            var k = b.source.kind;
            if (k === 'sensor' && toNumber(b.source.sensor_id, null) === null)
                reasons.push('source.sensor_id fehlt/ungültig');
            if (k === 'actuator' && toNumber(b.source.actuator_id, null) === null)
                reasons.push('source.actuator_id fehlt/ungültig');
            if (k === 'state' && toNumber(b.source.state_id, null) === null)
                reasons.push('source.state_id fehlt/ungültig');
        }
        if (reasons.length) {
            report.dropped_bindings.push({
                binding_id: b.binding_id || '(ohne id)',
                reasons: reasons
            });
            return;
        }
        outBindings.push(b);
    });
    ui.bindings = outBindings;
    report.kept_bindings = outBindings.length;
    var contextElements = context && Array.isArray(context.element_ids)
        ? context.element_ids : [];
    var bindingElements = outBindings.map(function (binding) {
        return String(binding.element_id || '');
    }).filter(Boolean);
    report.event_animations = validateSvgEventAnimations(ui.event_animations, {
        element_ids: Array.from(new Set(contextElements.concat(bindingElements).map(String)))
    });
    return { hmi_ui: ui, report: report };
}
// ------------ Process States ----------------------------------------
function mapEditorStateToRuntimeState(editorState, templateCfg) {
    var stateId = toNumber(editorState.state_id, null);
    var pId = toNumber(editorState.p_id, null);
    if (!Number.isFinite(stateId) || !Number.isFinite(pId)) {
        throw new Error('Ungültiger state_id oder p_id in editorState: ' + JSON.stringify(editorState));
    }
    var stateType = editorState.state_type || editorState.p__type || 'generic';
    var actuatorIdsRaw = editorState.actuator_ids || editorState.actuator_id || [];
    var sensorIdsRaw = editorState.sensor_ids || editorState.sensor_id || [];
    var actuatorIds = ensureArray(actuatorIdsRaw)
        .map(function (id) { return toNumber(id, null); })
        .filter(function (id) { return Number.isFinite(id); });
    var sensorIds = ensureArray(sensorIdsRaw)
        .map(function (id) { return toNumber(id, null); })
        .filter(function (id) { return Number.isFinite(id); });
    var valueId = toNumber(editorState.value_id != null ? editorState.value_id : editorState.initial_value_id, 2);
    var modeId = toNumber(editorState.mode_id != null ? editorState.mode_id : 2, 2);
    // ✅ Parameter-Merge: automation_parameters sollen Overrides sein
    var parameters = {};
    var p1 = editorState.parameters || {};
    var p2 = editorState.automation_parameters || {};
    Object.keys(p2).forEach(function (k) { parameters[k] = p2[k]; });
    Object.keys(p1).forEach(function (k) {
        if (!(k in parameters))
            parameters[k] = p1[k];
    });
    var controlStrategy = editorState.control_strategy || null;
    var ap = editorState.automation_parameters || {};
    if (!controlStrategy && ap && ap.control_method) {
        var cm = String(ap.control_method || '').trim();
        if (cm === 'PID') {
            controlStrategy = {
                type: 'PID',
                pid_config_id: ap.pid_config_id != null ? toNumber(ap.pid_config_id, null) : null
            };
            if (ap.pid_parameters && typeof ap.pid_parameters === 'object') {
                var pp = ap.pid_parameters;
                if (pp.kp != null)
                    controlStrategy.kp = toNumber(pp.kp, controlStrategy.kp);
                if (pp.ki != null)
                    controlStrategy.ki = toNumber(pp.ki, controlStrategy.ki);
                if (pp.kd != null)
                    controlStrategy.kd = toNumber(pp.kd, controlStrategy.kd);
            }
        }
        else if (cm === 'two_point' || cm === 'ONOFF' || cm === 'on_off' || cm === 'on-off') {
            // Zweipunktregelung ist KEIN eigener control_strategy-Typ. Der V9-Union
            // kennt nur PID und control_method. Die Runtime waehlt den Zweipunktregler
            // selbst, sobald keine Strategie hinterlegt ist und am State entweder ein
            // write_coil-Aktor haengt oder ein Hysterese-Parameter gesetzt ist
            // (_automation_engine.ensure_controller_for_state).
            controlStrategy = null;
        }
        else if (typeof cm === 'string' && cm.indexOf('method:') === 0) {
            var parts = cm.split(':');
            var mid = parts.length > 1 ? toNumber(parts[1], null) : null;
            controlStrategy = { type: 'control_method', method_id: mid };
        }
    }
    // ✅ parameter_schema_id beibehalten oder aus Mapping ableiten
    var parameterSchemaId = editorState.parameter_schema_id || null;
    if (!parameterSchemaId) {
        parameterSchemaId = inferParameterSchemaId(templateCfg, stateType, controlStrategy);
    }
    if (parameterSchemaId !== null && parameterSchemaId !== undefined) {
        parameterSchemaId = String(parameterSchemaId).trim();
        if (!parameterSchemaId)
            parameterSchemaId = null;
    }
    var initialValueId = toNumber(editorState.initial_value_id != null ? editorState.initial_value_id : valueId, valueId);
    var out = {
        state_id: stateId,
        p_id: pId,
        state_type: stateType,
        value_id: valueId,
        mode_id: modeId,
        actuator_ids: actuatorIds,
        sensor_ids: sensorIds,
        parameters: parameters,
        control_strategy: controlStrategy,
        setpoint_source: editorState.setpoint_source || null,
        initial_value_id: initialValueId
    };
    if (parameterSchemaId)
        out.parameter_schema_id = parameterSchemaId;
    return out;
}
/*
function normalizeProcessStatesForRuntime(editorProcesses) {
  var srcStates = (editorProcesses && editorProcesses.process_states) || [];
  return srcStates.map(mapEditorStateToRuntimeState);
} */
function inferParameterSchemaId(templateCfg, stateType, controlStrategy) {
    const cfg = templateCfg || {};
    const mappings = ensureArray(cfg.state_type_parameter_schema_mappings);
    const st = String(stateType || '').trim();
    if (!st)
        return null;
    const normCsType = function (v) {
        const s = String(v || '').trim();
        if (!s)
            return '';
        const sl = s.toLowerCase();
        if (sl === 'pid')
            return 'PID';
        if (sl === 'control_method' || sl === 'controlmethod' || sl === 'control-method')
            return 'control_method';
        // Zweipunktregelung hat im V9-Vertrag keinen Typ — sie entsteht aus
        // control_strategy: null. Alte Schreibweisen werden daher zu '' normiert.
        if (sl === 'onoff' || sl === 'on_off' || sl === 'on-off' || sl === 'two_point')
            return '';
        return s;
    };
    const csTypeRaw = (controlStrategy && typeof controlStrategy === 'object') ? controlStrategy.type : '';
    const csType = normCsType(csTypeRaw);
    const candidates = mappings
        .filter(function (m) {
        return m && String(m.state_type || '').trim() === st;
    })
        .map(function (m) {
        return ({
            parameter_schema_id: String(m.parameter_schema_id || '').trim(),
            priority: toNumber(m.priority, 0),
            is_default: Boolean(m.is_default),
            match: (m.match && typeof m.match === 'object') ? m.match : {}
        });
    })
        .filter(function (m) {
        return m.parameter_schema_id;
    });
    const matches = function (m) {
        const mm = m.match || {};
        if (Array.isArray(mm.control_strategy_types_any) && mm.control_strategy_types_any.length) {
            if (!csType)
                return false;
            const allowed = mm.control_strategy_types_any
                .map(function (x) {
                return normCsType(x);
            })
                .filter(Boolean);
            return allowed.indexOf(csType) >= 0;
        }
        return true;
    };
    let pool = candidates.filter(matches);
    if (!pool.length)
        pool = candidates.filter(function (m) {
            return m.is_default;
        });
    if (!pool.length)
        return null;
    pool.sort(function (a, b) {
        return (b.priority - a.priority);
    });
    return pool[0].parameter_schema_id || null;
}
function normalizeProcessStatesForRuntime(editorProcesses, templateCfg) {
    var srcStates = (editorProcesses && editorProcesses.process_states) || [];
    return srcStates.map(function (s) { return mapEditorStateToRuntimeState(s, templateCfg); });
}
// ------------ Dynamic Rule Engine (projektseitig) -------------------
function sanitizeCondition(cond) {
    if (cond === null || cond === undefined)
        return null;
    // ✅ condition darf auch ein freier Ausdruck (String) sein
    if (typeof cond === 'string') {
        const s = cond.trim();
        return s ? s : null;
    }
    if (typeof cond !== 'object')
        return null;
    const type = String(cond.type || '').trim();
    // Sensor-Condition (Zahl ODER Formel-String)
    if (type === 'sensor' || type === 'sensor_cmp') {
        const out = deepClone(cond);
        // operator normalisieren
        if (!out.operator && out.op)
            out.operator = out.op;
        out.operator = String(out.operator || '').trim();
        if (!out.operator)
            return null;
        // sensor_id / sensor_type optional – aber mind. eins sollte vorhanden sein
        if (out.sensor_id !== undefined && out.sensor_id !== null) {
            const sid = toNumber(out.sensor_id, null);
            if (Number.isFinite(sid))
                out.sensor_id = sid;
            else
                delete out.sensor_id;
        }
        if (out.sensor_type !== undefined && out.sensor_type !== null) {
            const st = String(out.sensor_type).trim();
            if (st)
                out.sensor_type = st;
            else
                delete out.sensor_type;
        }
        if (out.sensor_id === undefined && out.sensor_type === undefined)
            return null;
        // value: number | numeric-string -> number, sonst string (Formel)
        if (out.value === undefined || out.value === null)
            return null;
        if (typeof out.value === 'number') {
            if (!Number.isFinite(out.value))
                return null;
        }
        else if (typeof out.value === 'string') {
            const t = out.value.trim();
            if (!t)
                return null;
            const num = Number(t);
            out.value = Number.isFinite(num) ? num : t; // ✅ Formel-Strings bleiben Strings
        }
        else {
            return null;
        }
        // unit optional
        if (out.unit !== undefined && out.unit !== null) {
            const u = String(out.unit).trim();
            if (u)
                out.unit = u;
            else
                delete out.unit;
        }
        return out;
    }
    // Compound-Condition (rekursiv)
    if (type === 'compound') {
        const op = String(cond.operator || 'AND').trim().toUpperCase();
        const children = Array.isArray(cond.conditions) ? cond.conditions : [];
        const normChildren = children
            .map(sanitizeCondition)
            .filter(Boolean);
        if (!normChildren.length)
            return null;
        return { type: 'compound', operator: (op === 'OR' ? 'OR' : 'AND'), conditions: normChildren };
    }
    // State-Type Condition (minimal)
    if (type === 'state_type') {
        const st = String(cond.state_type || '').trim();
        const attr = String(cond.attribute || 'active').trim();
        if (!st || !attr)
            return null;
        let eq = cond.equals;
        if (typeof eq !== 'boolean')
            eq = (String(eq).trim() === 'true');
        return { type: 'state_type', state_type: st, attribute: attr, equals: eq };
    }
    // Unbekannt => als Objekt erhalten (besser als still droppen)
    return deepClone(cond);
}
function sanitizeAction(action) {
    if (!action || typeof action !== 'object')
        return null;
    var t = action.type;
    // erlaubte Runtime-Actions (PSM)
    var allowed = [
        'notify',
        'emergency_shutdown',
        'process_set_value',
        'process_set_active',
        'process_state_set_value',
        'process_state_set_active',
        'state_override',
        'config_update'
    ];
    if (allowed.indexOf(t) === -1)
        return null;
    return deepClone(action);
}
function normalizeDynamicRuleSetForRuntime(ruleSet) {
    var rs = deepClone(ruleSet);
    rs.rules = (rs.rules || []).map(function (rule) {
        var r = deepClone(rule);
        r.condition = sanitizeCondition(r.condition);
        r.action = sanitizeAction(r.action);
        r.undo_action = sanitizeAction(r.undo_action);
        if (!r.condition || !r.action)
            return null;
        return r;
    }).filter(function (r) { return r != null; });
    return rs;
}
function normalizeDynamicRuleEngineForRuntime(dre) {
    var src = dre || {};
    var sets = src.rule_sets || [];
    return { rule_sets: sets.map(normalizeDynamicRuleSetForRuntime) };
}
// ------------ HMI-Bindings -----------------------------------------
function buildHmiBindings(state) {
    var devices = state.get('devices') || {};
    var assignments = devices.assignments || {};
    var bindings = [];
    Object.keys(assignments || {}).forEach(function (elementId) {
        var a = assignments[elementId] || {};
        var sid = toNumber(a.sensor_id, null);
        var aid = toNumber(a.actuator_id, null);
        var did = toNumber(a.device_id, null);
        var source = null;
        if (sid != null)
            source = { type: 'sensor', sensor_id: sid };
        else if (aid != null)
            source = { type: 'actuator', actuator_id: aid };
        else if (did != null)
            source = { type: 'device', device_id: did };
        // ✅ leere Assignments nicht exportieren
        if (!source)
            return;
        bindings.push({
            binding_id: a.binding_id || elementId,
            view_id: a.view_id || 'main',
            element_id: elementId,
            role: a.role || 'device',
            source: source,
            widget: a.widget || null
        });
    });
    return bindings;
}
// ------------ Helper -----------------------------------
function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function ensureArray(v) {
    return Array.isArray(v) ? v : [];
}
function toIntOrNull(v) {
    if (v === null || v === undefined)
        return null;
    const n = Number(v);
    if (!Number.isFinite(n))
        return null;
    return Math.trunc(n);
}
function sortedUniqueIntsFromSet(setObj) {
    return Array.from(setObj)
        .filter(function (x) {
        return Number.isFinite(x);
    })
        .map(function (x) {
        return Math.trunc(x);
    })
        .sort(function (a, b) {
        return a - b;
    });
}
function sanitizeAutomationProcessStateMappingsForExport(mappings) {
    const src = ensureArray(mappings);
    if (src.length === 0)
        return [];
    return src.map(function (m) {
        const gs = (m && isPlainObject(m.general_settings)) ? deepClone(m.general_settings) : {};
        return { general_settings: gs };
    });
}
function buildStandardExportSkeleton(templateCfg) {
    const tpl = templateCfg || {};
    // Diese Keys gelten als "allgemeine Meta/Globals" -> werden aus Template übernommen.
    // ✅ Zusätzlich: Schema-Definitionen der neuen Config beibehalten
    const COPY_FROM_TEMPLATE = new Set([
        'node_registrar',
        'event_types',
        'scaling_profiles',
        'processes',
        'process_values',
        'process_modes',
        'pid_configs',
        'control_method_templates',
        'control_methods',
        // ✅ neue Config: Typ-/Schema-Tabellen
        'modbus_functions',
        'sensor_types',
        'actuator_types',
        'state_type_parameter_schema_mappings',
        'parameter_schemas'
    ]);
    const out = {};
    Object.keys(tpl).forEach(function (key) {
        if (COPY_FROM_TEMPLATE.has(key)) {
            out[key] = deepClone(tpl[key]);
            return;
        }
        if (key === 'automation_process_state_mappings') {
            out[key] = sanitizeAutomationProcessStateMappingsForExport(tpl[key]);
            return;
        }
        if (key === 'dynamic_rule_engine') {
            out[key] = { rule_sets: [] };
            return;
        }
        // default: Tabellen/Objekte vorhanden, aber ohne Template-Beispielfdaten
        const val = tpl[key];
        if (Array.isArray(val))
            out[key] = [];
        else if (isPlainObject(val))
            out[key] = {};
        else
            out[key] = deepClone(val);
    });
    // harte Schema-Keys (auch wenn Template die Keys irgendwann nicht mehr enthält)
    if (!Object.prototype.hasOwnProperty.call(out, 'nodes'))
        out.nodes = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'controller_node_bindings'))
        out.controller_node_bindings = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'controllers'))
        out.controllers = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'virtual_controllers'))
        out.virtual_controllers = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'sensors'))
        out.sensors = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'actuators'))
        out.actuators = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'process_states'))
        out.process_states = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'timers'))
        out.timers = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'triggers'))
        out.triggers = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'actions'))
        out.actions = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'transitions'))
        out.transitions = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'events'))
        out.events = [];
    if (!Object.prototype.hasOwnProperty.call(out, 'dynamic_rule_engine'))
        out.dynamic_rule_engine = { rule_sets: [] };
    if (!Object.prototype.hasOwnProperty.call(out, 'automation_process_state_mappings'))
        out.automation_process_state_mappings = [];
    // HMI exportiert immer als separate Sektion
    out.hmi_bindings = [];
    out.hmi_ui = null;
    return out;
}
function collectUsedIoIds(appState) {
    const sensorIds = new Set();
    const actuatorIds = new Set();
    const controllerIds = new Set();
    const sensorPairs = new Set();
    const actuatorPairs = new Set();
    const addId = function (setObj, v) {
        const n = toIntOrNull(v);
        if (n !== null)
            setObj.add(n);
    };
    const addIdList = function (setObj, v) {
        if (Array.isArray(v)) {
            v.forEach(function (x) { addId(setObj, x); });
            return;
        }
        if (v !== null && v !== undefined)
            addId(setObj, v);
    };
    // 1) Aus Device-Assignments
    const dev = appState.get('devices') || {};
    const assigns = dev.assignments || {};
    Object.values(assigns).forEach(function (a) {
        if (!a)
            return;
        addId(controllerIds, a.controller_id);
        // Die Zuweisung ist die einzige Stelle, an der Controller UND I/O-ID
        // zusammen vorliegen. Nur dieses Paar identifiziert eine I/O-Zeile
        // eindeutig — eine sensor_id allein kommt in einer Anlage mit zwei
        // Workern mehrfach vor.
        const cid = toIntOrNull(a.controller_id);
        const pairKey = function (ioId) {
            return (cid === null ? 'x' : cid) + ':' + ioId;
        };
        if (a.role === 'sensor') {
            addId(sensorIds, a.sensor_id);
            const sid = toIntOrNull(a.sensor_id);
            if (sid !== null)
                sensorPairs.add(pairKey(sid));
        }
        if (a.role === 'actuator') {
            addId(actuatorIds, a.actuator_id);
            const aid = toIntOrNull(a.actuator_id);
            if (aid !== null)
                actuatorPairs.add(pairKey(aid));
        }
    });
    // 2) Aus Process States (Projekt) – ✅ akzeptiert sensor_id + sensor_ids usw.
    const proc = appState.get('processes') || { process_states: [] };
    ensureArray(proc.process_states).forEach(function (ps) {
        if (!ps)
            return;
        addIdList(sensorIds, ps.sensor_id);
        addIdList(sensorIds, ps.sensor_ids);
        addIdList(actuatorIds, ps.actuator_id);
        addIdList(actuatorIds, ps.actuator_ids);
    });
    // 3) Aus dynamic_rule_engine (Projekt)
    //
    // V52-Fix (B-11): Der Sammler kannte nur flache Bedingungen vom Typ
    // 'sensor'. Bedingungen vom Typ 'compound' (siehe config/rule_library.json)
    // tragen ihre Sensoren in conditions[] — deren sensor_id fehlte damit in
    // cfg.sensors, obwohl die Regel selbst exportiert wurde.
    const collectConditionSensorIds = function (cond, depth) {
        if (!cond || typeof cond !== 'object' || depth > 8)
            return;
        if (cond.type === 'sensor')
            addId(sensorIds, cond.sensor_id);
        ensureArray(cond.conditions).forEach(function (child) {
            collectConditionSensorIds(child, depth + 1);
        });
    };
    const dre = appState.get('dynamic_rule_engine') || { rule_sets: [] };
    ensureArray(dre.rule_sets).forEach(function (set) {
        ensureArray(set.rules).forEach(function (r) {
            collectConditionSensorIds(r && r.condition, 0);
            const a = r && r.action ? r.action : null;
            if (a && (a.type === 'control_task' || a.type === 'control_actuator'))
                addId(actuatorIds, a.actuator_id);
        });
    });
    return {
        sensor_ids: sortedUniqueIntsFromSet(sensorIds),
        actuator_ids: sortedUniqueIntsFromSet(actuatorIds),
        controller_ids: sortedUniqueIntsFromSet(controllerIds),
        sensor_pairs: Array.from(sensorPairs).sort(),
        actuator_pairs: Array.from(actuatorPairs).sort()
    };
}
/*
function collectUsedIoIds(appState) {
  const sensorIds = new Set();
  const actuatorIds = new Set();
  const controllerIds = new Set();
  const sensorPairs = new Set();
  const actuatorPairs = new Set();

  // 1) Aus Device-Assignments (HMI/IO Zuordnung im Designer)
  const dev = appState.get('devices') || {};
  const assigns = dev.assignments || {};
  Object.values(assigns).forEach(a => {
    if (!a) return;
    const cid = toIntOrNull(a.controller_id);
    if (cid !== null) controllerIds.add(cid);

    if (a.role === 'sensor') {
      const sid = toIntOrNull(a.sensor_id);
      if (sid !== null) {
        sensorIds.add(sid);
        sensorPairs.add((cid === null ? 'x' : cid) + ':' + sid);
      }
    }
    if (a.role === 'actuator') {
      const aid = toIntOrNull(a.actuator_id);
      if (aid !== null) {
        actuatorIds.add(aid);
        actuatorPairs.add((cid === null ? 'x' : cid) + ':' + aid);
      }
    }
  });

  // 2) Aus Process States (Projekt)
  const proc = appState.get('processes') || { process_states: [] };
  ensureArray(proc.process_states).forEach(ps => {
    ensureArray(ps.sensor_id).forEach(x => {
      const sid = toIntOrNull(x);
      if (sid !== null) sensorIds.add(sid);
    });
    ensureArray(ps.actuator_id).forEach(x => {
      const aid = toIntOrNull(x);
      if (aid !== null) actuatorIds.add(aid);
    });
  });

  // 3) Aus dynamic_rule_engine (Projekt)
  const dre = appState.get('dynamic_rule_engine') || { rule_sets: [] };
  ensureArray(dre.rule_sets).forEach(set => {
    ensureArray(set.rules).forEach(r => {
      const c = r && r.condition ? r.condition : null;
      if (c && c.type === 'sensor') {
        const sid = toIntOrNull(c.sensor_id);
        if (sid !== null) sensorIds.add(sid);
      }
      const a = r && r.action ? r.action : null;
      if (a && (a.type === 'control_task' || a.type === 'control_actuator')) {
        const aid = toIntOrNull(a.actuator_id);
        if (aid !== null) actuatorIds.add(aid);
      }
    });
  });

  return {
    sensor_ids: sortedUniqueIntsFromSet(sensorIds),
    actuator_ids: sortedUniqueIntsFromSet(actuatorIds),
    controller_ids: sortedUniqueIntsFromSet(controllerIds),
    // Paare (controller_id, io_id) aus den Zuweisungen. Sie sind die einzige
    // Stelle, an der die Zuordnung eindeutig ist — eine sensor_id allein kann
    // in einer Anlage mit zwei Workern mehrfach vorkommen.
    sensor_pairs: Array.from(sensorPairs).sort(),
    actuator_pairs: Array.from(actuatorPairs).sort()
  };
} */
/**
 * Identitaetsschluessel einer I/O-Zeile.
 *
 * `sensor_id` allein ist NICHT eindeutig: die V9-Identitaet ist
 * (controller_uuid, sensor_id), in der Editor-Projektion also
 * (controller_id, sensor_id). In einer Anlage mit zwei Workern gibt es
 * "Sensor 1" auf jedem Controller genau einmal — bis V54.0 gewann hier der
 * erste Treffer und die uebrigen verschwanden lautlos aus dem Export.
 */
function ioKey(row, idField) {
    const controllerId = toIntOrNull(row && row.controller_id);
    const ioId = toIntOrNull(row && row[idField]);
    return (controllerId === null ? 'x' : controllerId) + ':' + (ioId === null ? 'x' : ioId);
}
function buildSensorsForExport(currentCfg, appState, usedSensorIds, usedSensorPairs) {
    const cfgSensors = ensureArray(currentCfg && currentCfg.sensors);
    const byId = new Map();
    cfgSensors.forEach(function (s) {
        const id = toIntOrNull(s && s.sensor_id);
        if (id === null)
            return;
        const key = ioKey(s, 'sensor_id');
        if (!byId.has(key))
            byId.set(key, s);
    });
    const assigns = ((appState.get('devices') || {}).assignments) || {};
    const derived = new Map();
    const derivedById = new Map();
    Object.values(assigns).forEach(function (a) {
        if (!a || a.role !== 'sensor')
            return;
        const sid = toIntOrNull(a.sensor_id);
        if (sid === null)
            return;
        const cid = toIntOrNull(a.controller_id);
        const row = {
            sensor_id: sid,
            sensor_number: sid,
            sensor_type: a.sensor_type ? String(a.sensor_type) : null,
            controller_id: toIntOrNull(a.controller_id),
            bus_type: a.bus_type || 'modbus',
            function_type: a.function_type || '',
            address: toIntOrNull(a.address),
            sensor_group: a.module_type || a.sensor_type || 'S',
            profile_id: null,
            alias: a.alias || ''
        };
        derived.set((cid === null ? 'x' : cid) + ':' + sid, row);
        if (!derivedById.has(sid))
            derivedById.set(sid, row);
    });
    // Zuerst die eindeutigen Paare (controller_id, sensor_id) aufloesen, danach
    // reine IDs, zu denen es kein Paar gibt. So bleiben in einer Anlage mit zwei
    // Workern beide "Sensor 1" erhalten, statt dass der erste den zweiten
    // verdraengt.
    const pairs = ensureArray(usedSensorPairs);
    const pairIds = new Set(pairs.map(function (key) {
        return toIntOrNull(String(key).split(':')[1]);
    }));
    const fromPairs = pairs.map(function (key) {
        if (byId.has(key))
            return deepClone(byId.get(key));
        const parts = String(key).split(':');
        const controllerId = toIntOrNull(parts[0]);
        const sensorId = toIntOrNull(parts[1]);
        const match = derived.get(key);
        if (match)
            return deepClone(match);
        return { sensor_id: sensorId, sensor_number: sensorId, sensor_type: null,
            controller_id: controllerId, bus_type: 'modbus', function_type: '',
            address: null, sensor_group: 'S', profile_id: null };
    });
    const byPlainId = new Map();
    cfgSensors.forEach(function (row) {
        const id = toIntOrNull(row && row.sensor_id);
        if (id !== null && !byPlainId.has(id))
            byPlainId.set(id, row);
    });
    return fromPairs.concat(ensureArray(usedSensorIds).filter(function (id) {
        return !pairIds.has(id);
    }).map(function (id) {
        if (byPlainId.has(id)) {
            const out = deepClone(byPlainId.get(id));
            const d = derivedById.get(id);
            if (d) {
                if (out.sensor_type == null && d.sensor_type)
                    out.sensor_type = d.sensor_type;
                if (out.controller_id == null && d.controller_id != null)
                    out.controller_id = d.controller_id;
                if (!out.bus_type && d.bus_type)
                    out.bus_type = d.bus_type;
                if (!out.function_type && d.function_type)
                    out.function_type = d.function_type;
                if (out.address == null && d.address != null)
                    out.address = d.address;
                if (out.alias == null && d.alias)
                    out.alias = d.alias;
            }
            return out;
        }
        if (derivedById.has(id))
            return deepClone(derivedById.get(id));
        return {
            sensor_id: id,
            sensor_number: id,
            sensor_type: null,
            controller_id: null,
            bus_type: 'modbus',
            function_type: '',
            address: null,
            sensor_group: 'S',
            profile_id: null
        };
    }));
}
function buildActuatorsForExport(currentCfg, appState, usedActuatorIds, usedActuatorPairs) {
    const cfgActs = ensureArray(currentCfg && currentCfg.actuators);
    const byId = new Map();
    const byPlainId = new Map();
    cfgActs.forEach(function (a) {
        const id = toIntOrNull(a && a.actuator_id);
        if (id === null)
            return;
        const key = ioKey(a, 'actuator_id');
        if (!byId.has(key))
            byId.set(key, a);
        if (!byPlainId.has(id))
            byPlainId.set(id, a);
    });
    const assigns = ((appState.get('devices') || {}).assignments) || {};
    const derived = new Map();
    const derivedById = new Map();
    Object.values(assigns).forEach(function (a) {
        if (!a || a.role !== 'actuator')
            return;
        const aid = toIntOrNull(a.actuator_id);
        if (aid === null)
            return;
        const cid = toIntOrNull(a.controller_id);
        const row = {
            actuator_id: aid,
            actuator_number: aid,
            actuator_type: a.actuator_type ? String(a.actuator_type) : null,
            controller_id: toIntOrNull(a.controller_id),
            bus_type: a.bus_type || 'modbus',
            function_type: a.function_type || '',
            address: toIntOrNull(a.address),
            actuator_group: a.module_type || a.actuator_type || 'A',
            profile_id: null,
            alias: a.alias || ''
        };
        derived.set((cid === null ? 'x' : cid) + ':' + aid, row);
        if (!derivedById.has(aid))
            derivedById.set(aid, row);
    });
    // Identitaet ist (controller_id, actuator_id) — siehe ioKey().
    const pairs = ensureArray(usedActuatorPairs);
    const pairIds = new Set(pairs.map(function (key) {
        return toIntOrNull(String(key).split(':')[1]);
    }));
    const fromPairs = pairs.map(function (key) {
        if (byId.has(key))
            return deepClone(byId.get(key));
        if (derived.has(key))
            return deepClone(derived.get(key));
        const parts = String(key).split(':');
        return { actuator_id: toIntOrNull(parts[1]), actuator_number: toIntOrNull(parts[1]),
            actuator_type: null, controller_id: toIntOrNull(parts[0]), bus_type: 'modbus',
            function_type: '', address: null, actuator_group: 'A', profile_id: null };
    });
    return fromPairs.concat(ensureArray(usedActuatorIds).filter(function (id) {
        return !pairIds.has(id);
    }).map(function (id) {
        if (byPlainId.has(id)) {
            const out = deepClone(byPlainId.get(id));
            const d = derivedById.get(id);
            if (d) {
                if (out.actuator_type == null && d.actuator_type)
                    out.actuator_type = d.actuator_type;
                if (out.controller_id == null && d.controller_id != null)
                    out.controller_id = d.controller_id;
                if (!out.bus_type && d.bus_type)
                    out.bus_type = d.bus_type;
                if (!out.function_type && d.function_type)
                    out.function_type = d.function_type;
                if (out.address == null && d.address != null)
                    out.address = d.address;
                if (out.alias == null && d.alias)
                    out.alias = d.alias;
            }
            return out;
        }
        if (derivedById.has(id))
            return deepClone(derivedById.get(id));
        return {
            actuator_id: id,
            actuator_number: id,
            actuator_type: null,
            controller_id: null,
            bus_type: 'modbus',
            function_type: '',
            address: null,
            actuator_group: 'A',
            profile_id: null
        };
    }));
}
function collectControllerIdsFromIoTables(sensors, actuators, extraControllerIds) {
    const ids = new Set();
    ensureArray(extraControllerIds).forEach(function (x) {
        const n = toIntOrNull(x);
        if (n !== null)
            ids.add(n);
    });
    ensureArray(sensors).forEach(function (s) {
        const cid = toIntOrNull(s && s.controller_id);
        if (cid !== null)
            ids.add(cid);
    });
    ensureArray(actuators).forEach(function (a) {
        const cid = toIntOrNull(a && a.controller_id);
        if (cid !== null)
            ids.add(cid);
    });
    return sortedUniqueIntsFromSet(ids);
}
function buildControllersForExport(currentCfg, usedControllerIds) {
    const cfgControllers = ensureArray(currentCfg && currentCfg.controllers);
    const byId = new Map();
    cfgControllers.forEach(function (c) {
        const id = toIntOrNull(c && c.controller_id);
        if (id !== null && !byId.has(id))
            byId.set(id, c);
    });
    return ensureArray(usedControllerIds).map(function (id) {
        if (byId.has(id))
            return deepClone(byId.get(id));
        return {
            controller_id: id,
            device_name: 'controller_' + String(id),
            bus_type: 'modbus',
            host: '',
            port: 502,
            unit: '0x1',
            tags: []
        };
    });
}
function filterVirtualControllersForExport(currentCfg, usedControllerIds) {
    const vc = ensureArray(currentCfg && currentCfg.virtual_controllers);
    const allowed = new Set(ensureArray(usedControllerIds).map(function (x) {
        return toIntOrNull(x);
    }).filter(function (x) {
        return x !== null;
    }));
    return vc
        .filter(function (v) {
        return allowed.has(toIntOrNull(v && v.controller_id));
    })
        .map(function (v) {
        return deepClone(v);
    });
}
// ------------ Export-Build (FIX!) -----------------------------------
function buildHmiUiConfig(appState) {
    var elements = exportElements(appState);
    return sanitizeHmiUiForExport(appState.get('hmi') || {}, {
        element_ids: elements.map(function (element) {
            return String((element && element.id) || '');
        }).filter(Boolean)
    });
}
function validateExportConfig(cfg) {
    const errors = [];
    const warnings = [];
    if (!cfg || typeof cfg !== 'object') {
        errors.push('Config ist kein Objekt');
        return { errors, warnings };
    }
    if (cfg.schema_version === undefined || cfg.schema_version === null)
        warnings.push('schema_version fehlt');
    if (!Array.isArray(cfg.elements))
        warnings.push('elements ist kein Array');
    if (!Array.isArray(cfg.connections))
        warnings.push('connections ist kein Array');
    if (cfg.plant_drawing !== undefined) {
        try {
            const drawingReport = validatePlantDrawing(cfg.plant_drawing);
            drawingReport.errors.forEach(function (message) {
                errors.push('plant_drawing: ' + message);
            });
            drawingReport.warnings.forEach(function (message) {
                warnings.push('plant_drawing: ' + message);
            });
        }
        catch (error) {
            errors.push('plant_drawing ist ungültig: ' + error.message);
        }
    }
    if (!Array.isArray(cfg.process_states))
        errors.push('process_states fehlt oder ist kein Array');
    if (!cfg.dynamic_rule_engine || typeof cfg.dynamic_rule_engine !== 'object') {
        errors.push('dynamic_rule_engine fehlt');
    }
    else {
        const rs = cfg.dynamic_rule_engine.rule_sets;
        if (!Array.isArray(rs))
            errors.push('dynamic_rule_engine.rule_sets fehlt oder ist kein Array');
        else {
            rs.forEach(function (setObj, i) {
                if (!setObj || typeof setObj !== 'object') {
                    errors.push('rule_sets[' + i + '] ist kein Objekt');
                    return;
                }
                if (!setObj.set_id || typeof setObj.set_id !== 'string')
                    errors.push('rule_sets[' + i + '].set_id fehlt/ungültig');
                if (!Array.isArray(setObj.rules))
                    warnings.push('rule_sets[' + i + '].rules ist kein Array (wird als leer interpretiert)');
                const seen = new Set();
                (setObj.rules || []).forEach(function (r, j) {
                    if (!r || typeof r !== 'object') {
                        errors.push('rules[' + i + '][' + j + '] ist kein Objekt');
                        return;
                    }
                    if (!r.rule_id || typeof r.rule_id !== 'string')
                        errors.push('rules[' + i + '][' + j + '].rule_id fehlt/ungültig');
                    if (r.rule_id) {
                        if (seen.has(r.rule_id))
                            warnings.push('Duplikat rule_id in set ' + setObj.set_id + ': ' + r.rule_id);
                        seen.add(r.rule_id);
                    }
                    if (r.condition === undefined || r.condition === null)
                        errors.push('rules[' + i + '][' + j + '].condition fehlt');
                    if (r.action === undefined || r.action === null)
                        errors.push('rules[' + i + '][' + j + '].action fehlt');
                });
            });
        }
    }
    ['timers', 'triggers', 'actions', 'transitions', 'events'].forEach(function (k) {
        if (cfg[k] !== undefined && !Array.isArray(cfg[k]))
            warnings.push(k + ' ist kein Array');
    });
    return { errors, warnings };
}
function buildExportConfig(appState) {
    const templateCfg = deepClone(appState.get('deviceConfig') || {});
    const cfg = buildStandardExportSkeleton(templateCfg);
    cfg.schema_version = templateCfg.schema_version || 1;
    cfg.elements = exportElements(appState);
    cfg.connections = exportConnections(appState);
    cfg.plant_drawing = normalizePlantDrawing(appState.get('plant_drawing'));
    const drawingReport = validatePlantDrawing(cfg.plant_drawing);
    cfg.plant_drawing_report = {
        valid: drawingReport.valid,
        errors: drawingReport.errors,
        warnings: drawingReport.warnings,
        counts: drawingReport.counts
    };
    const proc = appState.get('processes') || { process_states: [] };
    // cfg.process_states = normalizeProcessStatesForRuntime(proc);
    cfg.process_states = normalizeProcessStatesForRuntime(proc, templateCfg);
    const dre = appState.get('dynamic_rule_engine') || { rule_sets: [] };
    cfg.dynamic_rule_engine = normalizeDynamicRuleEngineForRuntime(dre);
    const free = appState.get('free_rules') || {};
    cfg.timers = Array.isArray(free.timers) ? deepClone(free.timers) : [];
    cfg.triggers = Array.isArray(free.triggers) ? deepClone(free.triggers) : [];
    cfg.actions = Array.isArray(free.actions) ? deepClone(free.actions) : [];
    cfg.transitions = Array.isArray(free.transitions) ? deepClone(free.transitions) : [];
    cfg.events = Array.isArray(free.events) ? deepClone(free.events) : [];
    cfg.hmi_bindings = buildHmiBindings(appState);
    const uiPack = sanitizeHmiUiForExport(appState.get('hmi') || {}, {
        element_ids: cfg.elements.map(function (element) {
            return String((element && element.id) || '');
        }).filter(Boolean)
    });
    cfg.hmi_ui = uiPack.hmi_ui || {
        version: 1,
        active_view_id: 'main',
        views: [{ view_id: 'main', name: 'Main', svg_ref: 'main', tags: ['default'] }],
        widgets: [],
        bindings: [],
        styles: [],
        alarms: [],
        event_animations: []
    };
    cfg.hmi_ui.plant_drawing_ref = { section: 'plant_drawing', schema: cfg.plant_drawing.schema, version: cfg.plant_drawing.version };
    cfg.hmi_ui_report = uiPack.report || null;
    cfg.hmi_ui_report.plant_drawing = cfg.plant_drawing_report;
    // ✅ Alias: alte Clients können cfg.hmi lesen, neue standardisieren auf cfg.hmi_ui
    cfg.hmi = cfg.hmi_ui;
    // ✅ Hardware Tabellen nur aus tatsächlich genutzten IDs (Editor + Template)
    const used = collectUsedIoIds(appState);
    const sensors = buildSensorsForExport(templateCfg, appState, used.sensor_ids, used.sensor_pairs);
    const actuators = buildActuatorsForExport(templateCfg, appState, used.actuator_ids, used.actuator_pairs);
    const controllerIds = collectControllerIdsFromIoTables(sensors, actuators, used.controller_ids);
    const controllersAll = buildControllersForExport(templateCfg, controllerIds);
    const virtualFromTemplate = filterVirtualControllersForExport(templateCfg, controllerIds);
    const virtualIdSet = new Set();
    virtualFromTemplate.forEach(function (v) {
        const id = toIntOrNull(v && v.controller_id);
        if (id !== null)
            virtualIdSet.add(id);
    });
    controllersAll.forEach(function (c) {
        const id = toIntOrNull(c && c.controller_id);
        const bt = String((c && c.bus_type) || '').toLowerCase();
        if (id !== null && bt === 'virtual')
            virtualIdSet.add(id);
    });
    const assigns = ((appState.get('devices') || {}).assignments) || {};
    Object.values(assigns).forEach(function (a) {
        if (!a)
            return;
        const id = toIntOrNull(a.controller_id);
        const bt = String(a.bus_type || '').toLowerCase();
        if (id !== null && bt === 'virtual')
            virtualIdSet.add(id);
        if (id !== null && a.controller_is_virtual === true)
            virtualIdSet.add(id);
    });
    // Ein virtueller Controller TEILT SICH die controller_id mit dem realen,
    // dessen UUID er spiegelt (die Editor-Projektion vergibt genau so). Bis V54.0
    // filterte diese Stelle deshalb den REALEN Controller aus dem Export, sobald
    // ein virtueller mit derselben ID existierte — bei der ausgelieferten Config
    // verschwand damit wago_2 (192.168.0.33) samt Endpunkt, obwohl alle
    // Zuweisungen darauf zeigten.
    //
    // Richtig ist: aussortiert wird nur, was SELBST virtuell ist.
    cfg.controllers = controllersAll
        .filter(function (c) {
        const busType = String((c && c.bus_type) || '').toLowerCase();
        if (busType === 'virtual')
            return false;
        return !(c && c.controller_is_virtual === true);
    })
        .map(function (c) {
        return deepClone(c);
    });
    const virtualOut = [];
    virtualFromTemplate.forEach(function (v) {
        return virtualOut.push(deepClone(v));
    });
    Array.from(virtualIdSet).forEach(function (id) {
        if (virtualOut.some(function (v) {
            return toIntOrNull(v && v.controller_id) === id;
        }))
            return;
        const fromAll = controllersAll.find(function (c) {
            return toIntOrNull(c && c.controller_id) === id;
        });
        if (fromAll) {
            const vc = deepClone(fromAll);
            vc.bus_type = 'virtual';
            virtualOut.push(vc);
            return;
        }
        virtualOut.push({
            controller_id: id,
            device_name: 'virtual_controller_' + String(id),
            bus_type: 'virtual',
            tags: []
        });
    });
    cfg.virtual_controllers = virtualOut;
    cfg.sensors = sensors;
    cfg.actuators = actuators;
    // ✅ Automation: nur aus Projekt (automation_cfg)
    const aCfg = appState.get('automation_cfg') || {};
    cfg.automation = Array.isArray(aCfg.automation) ? deepClone(aCfg.automation) : [];
    cfg.automation_engines = Array.isArray(aCfg.automation_engines) ? deepClone(aCfg.automation_engines) : [];
    cfg.automation_filters = Array.isArray(aCfg.automation_filters) ? deepClone(aCfg.automation_filters) : [];
    cfg.automation_rule_sets = [];
    return cfg;
}
export { 
// ...deine anderen exports...
buildHmiBindings, validateExportConfig, buildHmiUiConfig, buildExportConfig, };
