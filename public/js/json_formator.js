/**
 * json_formator.js
 *
 * Ein einziger JSON-Formatter für Browser + Node (ESM).
 *
 * Ziele:
 * - UI-Import bleibt stabil:  import { formatJsonInput } from './json_formator.js';
 * - Input: Objekt ODER JSON-String
 * - Output: menschenlesbares JSON (mit sinnvollen Einzeilern)
 * - Arrays von Objekten: standardmäßig "ein Objekt pro Zeile" (einzeilig), damit Configs kompakt bleiben
 * - Sonderfälle (werden rekursiv formatiert, nicht inline):
 *     - dynamic_rule_engine.rule_sets
 *     - automation_process_state_mappings
 * - Lenient Parsing (optional): trailing commas, einfache Quotes, unquoted keys, Kommentare (best effort)
 *
 * Exports:
 * - Named export: formatJsonInput
 * - Default export: formatJsonInput
 */

var DEFAULT_INDENT = 2;

/* ---------- Lenient JSON parsing (best effort) ---------- */

function repairJson(jsonText) {
  var s = String(jsonText);

  // Kommentare entfernen (//... und /*...* /)
  s = s.replace(/\/\/.*$/gm, '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');

  // Trailing commas
  s = s.replace(/,\s*}/g, '}');
  s = s.replace(/,\s*]/g, ']');

  // Single quotes -> double quotes (best effort, ohne volle JS-Parser-Ambitionen)
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, function (_m, inner) {
    var safe = String(inner)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    return '"' + safe + '"';
  });

  // Unquoted keys: { foo: 1 } -> { "foo": 1 }
  // (nur einfache \w+ Keys, best effort)
  s = s.replace(/([,{]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":');

  return s;
}

function parseJsonLenient(text) {
  var raw = String(text);
  try {
    return JSON.parse(raw);
  } catch (_e1) {
    try {
      var repaired = repairJson(raw);
      return JSON.parse(repaired);
    } catch (_e2) {
      return null;
    }
  }
}

/* ---------- Inline JSON punctuation spacing ---------- */

function addPunctuationSpaces(minifiedJson) {
  var s = String(minifiedJson);
  var out = '';
  var inString = false;
  var escape = false;

  for (var i = 0; i < s.length; i += 1) {
    var c = s[i];

    if (inString) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }

    out += c;

    // Space nach ':' und ',' (wenn danach nicht bereits whitespace folgt)
    if (c === ':' || c === ',') {
      var next = (i + 1) < s.length ? s[i + 1] : '';
      if (next && next !== ' ' && next !== '\n' && next !== '\t' && next !== '\r') {
        out += ' ';
      }
    }
  }

  return out;
}

function stringifyInline(value) {
  return addPunctuationSpaces(JSON.stringify(value));
}

/* ---------- Formatting rules ---------- */

function indentOf(indentUnit, level) {
  // String.repeat ist in allen modernen Browsern verfügbar.
  // Fallback: einfache Schleife, falls jemand sehr alte Engines nutzt.
  if (typeof indentUnit.repeat === 'function') return indentUnit.repeat(level);

  var s = '';
  for (var i = 0; i < level; i += 1) s += indentUnit;
  return s;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isDynamicRuleSetsPath(path) {
  if (!Array.isArray(path) || path.length < 2) return false;
  var n = path.length;
  return path[n - 2] === 'dynamic_rule_engine' && path[n - 1] === 'rule_sets';
}

function isAutomationProcessStateMappingsPath(path) {
  if (!Array.isArray(path) || path.length < 1) return false;
  return path[path.length - 1] === 'automation_process_state_mappings';
}

function shouldExpandArrayObjects(path) {
  // Diese Arrays enthalten meist stark verschachtelte Strukturen -> rekursiv formatieren
  return isDynamicRuleSetsPath(path) || isAutomationProcessStateMappingsPath(path);
}

// Optional: Top-Level Abschnitte optisch trennen (Leerzeile vor Key)
var TOP_LEVEL_GAPS_BEFORE = {
  controllers: 1,
  virtual_controllers: 1,
  sensors: 1,
  actuators: 1,
  scaling_profiles: 1,
  processes: 1,
  process_values: 1,
  process_modes: 1,
  pid_configs: 1,
  control_method_templates: 1,
  control_methods: 1,
  process_states: 1,
  automation_process_state_mappings: 1,
  timers: 1,
  triggers: 1,
  actions: 1,
  transitions: 1,
  events: 1,
  dynamic_rule_engine: 1
};

/* ---------- Core formatter ---------- */

function formatValue(value, level, isLast, path, indentUnit) {
  if (value === null) return 'null' + (isLast ? '' : ',');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value) + (isLast ? '' : ',');
  if (typeof value === 'string') return JSON.stringify(value) + (isLast ? '' : ',');

  if (Array.isArray(value)) return formatArray(value, level, isLast, path, indentUnit);
  if (isPlainObject(value)) return formatObject(value, level, isLast, path, indentUnit);

  // Fallback (sollte praktisch nicht vorkommen)
  return JSON.stringify(value) + (isLast ? '' : ',');
}

function formatObject(obj, level, isLast, path, indentUnit) {
  var keys = Object.keys(obj || {});
  if (keys.length === 0) return '{}' + (isLast ? '' : ',');

  var ind = indentOf(indentUnit, level);
  var indNext = indentOf(indentUnit, level + 1);

  var lines = [];
  lines.push('{');

  for (var i = 0; i < keys.length; i += 1) {
    var k = keys[i];
    var v = obj[k];
    var lastKey = (i === keys.length - 1);

    // Top-Level spacing: Leerzeilen vor bestimmten Keys
    if (level === 0 && i > 0) {
      var gap = TOP_LEVEL_GAPS_BEFORE[k] || 0;
      for (var g = 0; g < gap; g += 1) lines.push('');
    }

    var keyJson = JSON.stringify(k);

    // Value rekursiv formatieren (inkl. Komma-Handling)
    var formatted = formatValue(v, level + 1, lastKey, path.concat([k]), indentUnit);
    lines.push(indNext + keyJson + ': ' + formatted);
  }

  lines.push(ind + '}' + (isLast ? '' : ','));
  return lines.join('\n');
}

function formatArray(arr, level, isLast, path, indentUnit) {
  if (!Array.isArray(arr) || arr.length === 0) return '[]' + (isLast ? '' : ',');

  var ind = indentOf(indentUnit, level);
  var indNext = indentOf(indentUnit, level + 1);

  var lines = [];
  lines.push('[');

  // Prüfen: Array besteht vollständig aus Objects?
  var allObjects = true;
  for (var i = 0; i < arr.length; i += 1) {
    var el = arr[i];
    if (!isPlainObject(el)) {
      allObjects = false;
      break;
    }
  }

  // Standard: Objekt-Arrays -> "ein Objekt pro Zeile", einzeilig, sofern kein Sonderpfad
  if (allObjects && !shouldExpandArrayObjects(path)) {
    for (var j = 0; j < arr.length; j += 1) {
      var lastEl = (j === arr.length - 1);
      var one = stringifyInline(arr[j]);
      lines.push(indNext + one + (lastEl ? '' : ','));
    }
    lines.push(ind + ']' + (isLast ? '' : ','));
    return lines.join('\n');
  }

  // Rekursiv (für Sonderpfade oder gemischte Arrays)
  for (var k = 0; k < arr.length; k += 1) {
    var last = (k === arr.length - 1);
    var formattedEl = formatValue(arr[k], level + 1, last, path.concat([String(k)]), indentUnit);

    // Wichtig: Nur die erste Zeile einrücken; weitere Zeilen sind bereits korrekt eingerückt.
    lines.push(indNext + formattedEl);
  }

  lines.push(ind + ']' + (isLast ? '' : ','));
  return lines.join('\n');
}

function formatJsonInput(jsonDataOrText, indentSize) {
  var indent = Number(indentSize);
  if (!Number.isFinite(indent) || indent < 0) indent = DEFAULT_INDENT;

  var indentUnit = ' '.repeat(indent);
  var data = jsonDataOrText;

  if (typeof jsonDataOrText === 'string') {
    var parsed = parseJsonLenient(jsonDataOrText);
    if (parsed === null) return String(jsonDataOrText); // abwärts-kompatibel: bei Fehler unverändert zurück
    data = parsed;
  }

  try {
    var out = formatValue(data, 0, true, [], indentUnit);
    if (!out.endsWith('\n')) out += '\n';
    return out;
  } catch (_e) {
    // Fallback
    try {
      var out2 = JSON.stringify(data, null, indent);
      if (!out2.endsWith('\n')) out2 += '\n';
      return out2;
    } catch (_e2) {
      return String(jsonDataOrText);
    }
  }
}

/* ---------- Exports + optionale Kompatibilität ---------- */

// Named + default export (ESM)
export { formatJsonInput };
export default formatJsonInput;

// Optional: globale Funktion (falls jemand früher global genutzt hat)
try {
  if (typeof window !== 'undefined' && window) {
    window.formatJsonInput = formatJsonInput;
  }
} catch (_e3) {}

// Optional: CommonJS Export (best effort, falls jemand Node require nutzt)
try {
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = { formatJsonInput: formatJsonInput };
  }
} catch (_e4) {}
