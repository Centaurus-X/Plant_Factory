/**
 * v9_validate.js — Portierung der V9-Invarianten in den Browser.
 *
 * Spiegelt die Prüfkette aus `verify_config_data()`
 * (automation_system_v0101/src/library/_generic_type_library.py:2831-2894):
 *
 *   meta -> scope -> Registry-Layout -> Sektionen -> Eindeutigkeit ->
 *   Routing/Ownership -> Execution-Ownership -> Referenzen -> Regelbedingungen
 *
 * Ziel: der Editor lehnt genau das ab, was der Worker ablehnen würde — kein
 * Export, der erst in der Runtime auffliegt.
 *
 * Rückgabe: { status: 'OK'|'FAILED', errors: [], warnings: [], stats: {} }
 * Jeder Eintrag: { path, code, message }
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import {
  SECTIONS, SECTION_ORDER, ENUMS, CANONICAL_SCHEMA, CANONICAL_VERSION,
  CROSS_VERSION, CROSS_PROFILE, CRITICAL_GROUPS, RUNTIME_ONLY_OPERATORS,
  routeKeyFor, executionScopeFor, crossExecutionScopeFor, functionTypesFor, primaryKey,
  isCrossConfig, fieldsFor
} from './v9_schema.js';
import { isUuid } from './v9_uuid.js';
import {
  ensureArray, isPlainObject, toText, toIntOrNull, toNumberOrNull, indexBy
} from './shared_utils.js';

const REQUIRED_EXECUTION_FIELDS = [
  'activation_state', 'deployment_status', 'execution_epoch',
  'execution_owner', 'execution_scope'
];

function makeReport() {
  return { status: 'OK', errors: [], warnings: [], stats: {} };
}

function fail(report, path, code, message) {
  report.errors.push({ path, code, message });
  report.status = 'FAILED';
}

function warn(report, path, code, message) {
  report.warnings.push({ path, code, message });
}

/* -------------------------------------------------------------------------
 * Einzelprüfungen
 * ---------------------------------------------------------------------- */

/**
 * Wie viele `local_node`-Zeilen der Scope verlangt.
 *
 * Der Vertrag führt `local_node` als `t_list(..., min_len=1)` — kein Singleton.
 * Die Arität hängt am Scope, nicht am Schema:
 *
 *   node_local    genau 1  — ein Shard beschreibt einen Worker
 *   cross         genau 0  — der V8-Vertrag verlangt die Sektion leer
 *   master_global 1..N     — ein Master beschreibt die ganze Anlage
 */
function localNodeArity(scope, profile) {
  if (profile === 'cross') return { min: 0, max: 0 };
  if (scope === 'master_global') return { min: 1, max: Infinity };
  return { min: 1, max: 1 };
}

function verifyStructure(config, report, profile) {
  const scope = toText((ensureArray((config || {}).meta)[0] || {}).scope);
  const present = Object.keys(config || {});
  SECTION_ORDER.forEach(function (section) {
    if (!Array.isArray((config || {})[section])) {
      fail(report, section, 'missing_section',
        'Sektion fehlt oder ist keine Liste (decompose() verlangt alle 26 Sektionen).');
    }
  });
  present.forEach(function (section) {
    if (SECTION_ORDER.indexOf(section) < 0) {
      fail(report, section, 'unsupported_section',
        'Sektion gehört nicht zum V9-Vertrag — decompose() wirft '
        + '"unsupported config sections".');
    }
  });
  Object.keys(SECTIONS).forEach(function (section) {
    const spec = SECTIONS[section];
    const rows = ensureArray((config || {})[section]);
    if (spec.kind !== 'singleton') return;

    if (section === 'local_node') {
      const arity = localNodeArity(scope, profile);
      if (rows.length < arity.min || rows.length > arity.max) {
        fail(report, section, 'local_node_arity',
          'Scope "' + (scope || 'unbekannt') + '" verlangt '
          + (arity.max === Infinity ? 'mindestens ' + arity.min
            : (arity.min === arity.max ? 'genau ' + arity.min : arity.min + '–' + arity.max))
          + ' local_node-Zeile(n), vorhanden: ' + rows.length + '.');
      }
      const seen = new Set();
      rows.forEach(function (row, index) {
        const nodeId = toText(row.node_id);
        if (seen.has(nodeId)) {
          fail(report, section + '[' + index + '].node_id', 'local_node_duplicate',
            'node_id "' + nodeId + '" kommt mehrfach vor.');
        }
        seen.add(nodeId);
      });
      return;
    }

    // Im Cross-Profil MUSS die Sektion leer sein (fail-closed im Worker).
    if (profile === 'cross' && CROSS_PROFILE.mustBeEmpty.indexOf(section) >= 0) {
      if (rows.length) {
        fail(report, section, 'cross_must_be_empty',
          'Sektion muss im Cross-Shard leer sein, hat ' + rows.length + ' Zeile(n).');
      }
      return;
    }
    if (rows.length !== 1) {
      fail(report, section, 'singleton_arity',
        'Singleton-Sektion muss genau 1 Zeile haben, hat ' + rows.length + '.');
    }
  });
}

function verifyMeta(config, report) {
  const meta = ensureArray(config.meta)[0];
  if (!isPlainObject(meta)) {
    fail(report, 'meta', 'meta_missing', 'meta-Sektion fehlt.');
    return null;
  }
  if (toText(meta.schema) !== CANONICAL_SCHEMA) {
    fail(report, 'meta.schema', 'meta_schema',
      'meta.schema muss "' + CANONICAL_SCHEMA + '" sein.');
  }
  const version = toIntOrNull(meta.version);
  if ([5, 8, 9].indexOf(version) < 0) {
    fail(report, 'meta.version', 'meta_version',
      'meta.version muss 5, 8 oder 9 sein (V52 schreibt ' + CANONICAL_VERSION + ').');
  }
  const scope = toText(meta.scope);
  if (version === 8 || version === 9) {
    if (!scope) {
      fail(report, 'meta.scope', 'scope_missing', 'Version 8/9 verlangt meta.scope.');
    } else if (ENUMS.meta_scope.indexOf(scope) < 0) {
      fail(report, 'meta.scope', 'scope_enum', 'Unbekannter scope "' + scope + '".');
    }
  }
  if (scope === 'node_local' && !toText(meta.node_id)) {
    fail(report, 'meta.node_id', 'node_id_missing',
      'scope=node_local verlangt meta.node_id.');
  }
  if (scope.indexOf('cross') === 0) {
    if (!toText(meta.owner_node_id)) {
      fail(report, 'meta.owner_node_id', 'owner_missing',
        'Cross-Scope verlangt meta.owner_node_id.');
    }
    if (!toText(meta.domain_id) && !toText(meta.cross_domain_id)) {
      fail(report, 'meta.domain_id', 'domain_missing',
        'Cross-Scope verlangt meta.domain_id oder meta.cross_domain_id.');
    }
  }
  return meta;
}

function verifyFields(config, report) {
  Object.keys(SECTIONS).forEach(function (section) {
    const spec = SECTIONS[section];
    ensureArray(config[section]).forEach(function (row, index) {
      const base = section + '[' + index + ']';
      if (!isPlainObject(row)) {
        fail(report, base, 'row_type', 'Zeile ist kein Objekt.');
        return;
      }
      spec.fields.forEach(function (field) {
        const path = base + '.' + field.name;
        const value = row[field.name];
        if (value === undefined) {
          if (field.required) {
            fail(report, path, 'field_missing', 'Pflichtfeld fehlt.');
          }
          return;
        }
        verifyValue(report, path, field, value);
      });
      Object.keys(row).forEach(function (name) {
        const known = spec.fields.some(function (field) { return field.name === name; });
        if (!known) {
          warn(report, base + '.' + name, 'unknown_field',
            'Feld gehört nicht zum V9-Vertrag (Type Authority meldet nur eine Warnung, '
            + 'die Entity-Registry kann es aber verwerfen).');
        }
      });
      verifyIoFunctionType(report, section, base, row);
    });
  });
}

function verifyValue(report, path, field, value) {
  if (value === null) {
    if (!field.nullable && field.required && field.type !== 'any') {
      fail(report, path, 'null_value', 'Feld darf nicht null sein.');
    }
    return;
  }
  switch (field.type) {
    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        fail(report, path, 'type_int', 'Erwartet Ganzzahl, erhalten ' + typeof value + '.');
        return;
      }
      break;
    }
    case 'num':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(report, path, 'type_num', 'Erwartet Zahl.');
        return;
      }
      break;
    case 'bool':
      if (typeof value !== 'boolean') {
        fail(report, path, 'type_bool', 'Erwartet Boolean.');
        return;
      }
      break;
    case 'str':
      if (typeof value !== 'string') {
        fail(report, path, 'type_str', 'Erwartet String.');
        return;
      }
      if (field.minLen !== 0 && value.length === 0) {
        fail(report, path, 'str_empty', 'String darf nicht leer sein (min_len 1).');
        return;
      }
      break;
    case 'list':
      if (!Array.isArray(value)) {
        fail(report, path, 'type_list', 'Erwartet Liste.');
        return;
      }
      if (field.minLen && value.length < field.minLen) {
        fail(report, path, 'list_min_len',
          'Liste braucht mindestens ' + field.minLen + ' Eintrag/Einträge.');
      }
      break;
    case 'map':
    case 'obj':
      if (!isPlainObject(value)) {
        fail(report, path, 'type_map', 'Erwartet Objekt.');
        return;
      }
      break;
    default:
      break;
  }
  if (typeof value === 'number') {
    if (field.min !== undefined && value < field.min) {
      fail(report, path, 'range_min', 'Wert < Minimum ' + field.min + '.');
    }
    if (field.max !== undefined && value > field.max) {
      fail(report, path, 'range_max', 'Wert > Maximum ' + field.max + '.');
    }
  }
  if (field.enumKey && !field.enumOpen) {
    const allowed = ENUMS[field.enumKey] || [];
    if (allowed.indexOf(value) < 0) {
      fail(report, path, 'enum', 'Wert "' + value + '" nicht in [' + allowed.join(', ') + '].');
    }
  }
}

function verifyIoFunctionType(report, section, base, row) {
  const spec = SECTIONS[section];
  if (!spec || spec.kind !== 'io') return;
  const busType = toText(row.bus_type);
  const allowed = functionTypesFor(section, busType);
  const value = toText(row.function_type);
  if (allowed.length && allowed.indexOf(value) < 0) {
    fail(report, base + '.function_type', 'io_function_type',
      'function_type "' + value + '" ist für bus_type "' + busType
      + '" nicht zulässig. Erlaubt: ' + allowed.join(', ') + '.');
  }
  if (busType === 'modbus') {
    const address = toIntOrNull(row.address);
    if (address === null || address < 0) {
      fail(report, base + '.address', 'io_address',
        'Modbus-Adresse muss eine Ganzzahl >= 0 sein.');
    }
  } else if (busType === 'plc_s7' && !toText(row.address)) {
    fail(report, base + '.address', 'io_address', 'S7-Adresse muss ein nicht-leerer String sein.');
  }
  if (!isUuid(toText(row.controller_uuid))) {
    fail(report, base + '.controller_uuid', 'uuid_format',
      'controller_uuid ist keine gültige UUID.');
  }
}

function verifyUniqueness(config, report) {
  Object.keys(SECTIONS).forEach(function (section) {
    const key = primaryKey(section);
    if (!key || SECTIONS[section].kind === 'io') return;
    const seen = new Set();
    ensureArray(config[section]).forEach(function (row, index) {
      const value = isPlainObject(row) ? row[key] : undefined;
      if (value === undefined || value === null) return;
      const token = String(value);
      if (seen.has(token)) {
        fail(report, section + '[' + index + '].' + key, 'duplicate_key',
          'Doppelter Primärschlüssel "' + token + '".');
      }
      seen.add(token);
    });
  });

  // Controller: uuid, key und controller_id müssen jeweils eindeutig sein.
  ['controller_uuid', 'controller_key', 'controller_id'].forEach(function (key) {
    const seen = new Set();
    ensureArray(config.controllers).forEach(function (row, index) {
      const token = String(row[key]);
      if (seen.has(token)) {
        fail(report, 'controllers[' + index + '].' + key, 'duplicate_key',
          'Doppelter Wert "' + token + '".');
      }
      seen.add(token);
    });
  });

  // Routen: (site,node,local_controller_id) und route_key eindeutig.
  const routeTuples = new Set();
  ensureArray(config.site_controller_map).forEach(function (route, index) {
    const tuple = [toText(route.site_id), toText(route.node_id),
      toIntOrNull(route.local_controller_id)].join('|');
    if (routeTuples.has(tuple)) {
      fail(report, 'site_controller_map[' + index + ']', 'duplicate_route',
        'Route-Tupel (site_id, node_id, local_controller_id) ist nicht eindeutig.');
    }
    routeTuples.add(tuple);
  });

  // I/O: (controller_uuid, id) eindeutig, eine Gruppe je controller_uuid.
  ['sensors', 'actuators'].forEach(function (section) {
    const idField = SECTIONS[section].idField;
    const seen = new Set();
    ensureArray(config[section]).forEach(function (row, index) {
      const token = toText(row.controller_uuid) + ':' + toIntOrNull(row[idField]);
      if (seen.has(token)) {
        fail(report, section + '[' + index + ']', 'duplicate_io',
          'Identitätspaar (controller_uuid, ' + idField + ') ist nicht eindeutig.');
      }
      seen.add(token);
    });
  });
}

function verifyRoutingOwnership(config, report, meta) {
  const controllersByUuid = indexBy(config.controllers, 'controller_uuid');
  const scope = toText((meta || {}).scope);
  const nodeScope = scope === 'node_local';
  const ownerCount = new Map();

  ensureArray(config.site_controller_map).forEach(function (route, index) {
    const base = 'site_controller_map[' + index + ']';
    const uuid = toText(route.controller_uuid);
    const controller = controllersByUuid.get(uuid);
    if (!controller) {
      fail(report, base + '.controller_uuid', 'ref_controller',
        'controller_uuid "' + uuid + '" existiert nicht in controllers.');
      return;
    }
    if (toText(controller.controller_key) !== toText(route.controller_key)) {
      fail(report, base + '.controller_key', 'route_key_mismatch',
        'route controller_key weicht vom Controller-Datensatz ab.');
    }
    const expected = routeKeyFor(toText(route.site_id), toText(route.node_id),
      toIntOrNull(route.local_controller_id));
    const expectedNoSite = routeKeyFor('', toText(route.node_id),
      toIntOrNull(route.local_controller_id));
    if ([expected, expectedNoSite].indexOf(toText(route.route_key)) < 0) {
      fail(report, base + '.route_key', 'route_key_inconsistent',
        'route_key "' + toText(route.route_key) + '" passt nicht zu node/local_controller. '
        + 'Erwartet: "' + expected + '".');
    }
    if (toText(route.routing_role) === 'owner' && route.enabled !== false) {
      ownerCount.set(uuid, (ownerCount.get(uuid) || 0) + 1);
    }
  });

  if (nodeScope) {
    controllersByUuid.forEach(function (controller, uuid) {
      const count = ownerCount.get(uuid) || 0;
      if (count !== 1) {
        fail(report, 'site_controller_map', 'owner_route_arity',
          'Controller ' + uuid + ' braucht genau eine aktivierte owner-Route, hat ' + count + '.');
      }
    });
  }

  const localNode = ensureArray(config.local_node)[0];
  if (isPlainObject(localNode)) {
    const fromRoutes = ensureArray(localNode.active_controller_routes)
      .map(function (route) { return toText(route.controller_uuid); }).sort();
    const declared = ensureArray(localNode.active_controller_uuids).map(toText).sort();
    if (declared.join('|') !== fromRoutes.join('|')) {
      fail(report, 'local_node[0]', 'local_node_mismatch',
        'active_controller_uuids und active_controller_routes sind nicht mengengleich.');
    }
    const routeIndex = new Set(ensureArray(config.site_controller_map).map(function (route) {
      return toText(route.controller_uuid) + '|' + toIntOrNull(route.local_controller_id);
    }));
    ensureArray(localNode.active_controller_routes).forEach(function (route, index) {
      const token = toText(route.controller_uuid) + '|' + toIntOrNull(route.local_controller_id);
      if (!routeIndex.has(token)) {
        fail(report, 'local_node[0].active_controller_routes[' + index + ']',
          'local_route_unknown', 'Aktive Route hat keine passende site_controller_map-Zeile.');
      }
    });
  }

  if (nodeScope) {
    const nodeId = toText((meta || {}).node_id);
    [['nodes', 'node_id'], ['site_controller_map', 'node_id'],
      ['sensors', 'node_id'], ['actuators', 'node_id']].forEach(function (entry) {
      ensureArray(config[entry[0]]).forEach(function (row, index) {
        if (toText(row[entry[1]]) && toText(row[entry[1]]) !== nodeId) {
          fail(report, entry[0] + '[' + index + '].' + entry[1], 'foreign_node',
            'node_local-Shard enthält fremden Node "' + toText(row[entry[1]]) + '".');
        }
      });
    });
  }
}

function verifyExecutionOwnership(config, report, meta) {
  const version = toIntOrNull((meta || {}).version);
  if (version !== 9) return;
  const scope = toText((meta || {}).scope);
  const scoped = scope === 'node_local' || scope.indexOf('cross') === 0;
  const shardOwner = scope === 'node_local'
    ? toText(meta.node_id) : toText(meta.owner_node_id);

  ensureArray(config.processes).forEach(function (row, index) {
    if (!toText(row.owner_node_id)) {
      fail(report, 'processes[' + index + '].owner_node_id', 'owner_required',
        'V9-Execution-Entity verlangt owner_node_id.');
    } else if (scoped && shardOwner && toText(row.owner_node_id) !== shardOwner) {
      fail(report, 'processes[' + index + '].owner_node_id', 'owner_mismatch',
        'owner_node_id weicht vom Shard-Owner "' + shardOwner + '" ab.');
    }
  });

  ensureArray(config.rules).forEach(function (rule, index) {
    const base = 'rules[' + index + ']';
    REQUIRED_EXECUTION_FIELDS.forEach(function (name) {
      if (rule[name] === undefined || rule[name] === null) {
        fail(report, base + '.' + name, 'execution_field_required',
          'V9-Regel verlangt Feld "' + name + '".');
      }
    });
    if (!toText(rule.owner_node_id)) {
      fail(report, base + '.owner_node_id', 'owner_required',
        'V9-Execution-Entity verlangt owner_node_id.');
    }
    if (scoped) {
      if (!toText(rule.execution_owner)) {
        fail(report, base + '.execution_owner', 'execution_owner_empty',
          'Gescopede V9-Regel verlangt nicht-leeren execution_owner.');
      } else if (shardOwner && toText(rule.execution_owner) !== shardOwner) {
        fail(report, base + '.execution_owner', 'execution_owner_mismatch',
          'execution_owner weicht vom Shard-Owner "' + shardOwner + '" ab.');
      }
      if (!toText(rule.execution_scope)) {
        fail(report, base + '.execution_scope', 'execution_scope_empty',
          'Gescopede V9-Regel verlangt nicht-leeren execution_scope.');
      } else if (scope === 'node_local'
          && toText(rule.execution_scope) !== executionScopeFor(shardOwner)) {
        fail(report, base + '.execution_scope', 'execution_scope_mismatch',
          'execution_scope muss "' + executionScopeFor(shardOwner) + '" sein.');
      } else if (toText(rule.deployment_status) === 'active_cross'
          && toText(rule.execution_scope) !== crossExecutionScopeFor(
            toText(rule.execution_owner) || shardOwner)) {
        // Schreibweise laut config_sharding_contracts.py: "cross:<owner>.default".
        // Weicht sie ab, weist der Coordinator die Regel als
        // `stale_execution_scope` zurueck — im Feld ein stiller Ausfall.
        fail(report, base + '.execution_scope', 'cross_execution_scope_mismatch',
          'Cross-Regel verlangt execution_scope "'
          + crossExecutionScopeFor(toText(rule.execution_owner) || shardOwner) + '".');
      }
    }
    if (toText(rule.deployment_status) === 'disabled_with_reason'
        && !toText(rule.disabled_reason)) {
      fail(report, base + '.disabled_reason', 'disabled_reason_required',
        'deployment_status=disabled_with_reason verlangt einen disabled_reason.');
    }
    verifyRuntimeEffectiveness(rule, base, report);
    if (CRITICAL_GROUPS.indexOf(toText(rule.group)) >= 0
        && toText(rule.deployment_status) === 'active_cross') {
      fail(report, base + '.group', 'critical_cross',
        'Kritische Regelgruppe "' + toText(rule.group)
        + '" darf niemals cross ausgeführt werden.');
    }
  });
}

function buildReferenceIndex(config) {
  return {
    'sites.site_id': new Set(ensureArray(config.sites).map(function (r) { return toText(r.site_id); })),
    'nodes.node_id': new Set(ensureArray(config.nodes).map(function (r) { return toText(r.node_id); })),
    'controllers.controller_uuid': new Set(ensureArray(config.controllers)
      .map(function (r) { return toText(r.controller_uuid); })),
    'scaling_profiles.profile_id': new Set(ensureArray(config.scaling_profiles)
      .map(function (r) { return toIntOrNull(r.profile_id); })),
    'parameter_generic_templates.schema_id': new Set(ensureArray(config.parameter_generic_templates)
      .map(function (r) { return toIntOrNull(r.schema_id); })),
    'schema_mappings.mapping_id': new Set(ensureArray(config.schema_mappings)
      .map(function (r) { return toIntOrNull(r.mapping_id); })),
    'processes.p_id': new Set(ensureArray(config.processes)
      .map(function (r) { return toIntOrNull(r.p_id); })),
    'process_values.value_id': new Set(ensureArray(config.process_values)
      .map(function (r) { return toIntOrNull(r.value_id); })),
    'process_modes.mode_id': new Set(ensureArray(config.process_modes)
      .map(function (r) { return toIntOrNull(r.mode_id); })),
    'process_states.state_id': new Set(ensureArray(config.process_states)
      .map(function (r) { return toIntOrNull(r.state_id); })),
    'pid_configs.pid_config_id': new Set(ensureArray(config.pid_configs)
      .map(function (r) { return toIntOrNull(r.pid_config_id); })),
    'control_method_templates.template_id': new Set(ensureArray(config.control_method_templates)
      .map(function (r) { return toIntOrNull(r.template_id); })),
    'control_methods.method_id': new Set(ensureArray(config.control_methods)
      .map(function (r) { return toIntOrNull(r.method_id); })),
    'rule_engine.engine_id': new Set(ensureArray(config.rule_engine)
      .map(function (r) { return toIntOrNull(r.engine_id); })),
    'filters.filter_id': new Set(ensureArray(config.filters)
      .map(function (r) { return toIntOrNull(r.filter_id); })),
    'timers.timer_id': new Set(ensureArray(config.timers)
      .map(function (r) { return toIntOrNull(r.timer_id); }))
  };
}

/** Identitätspaare (controller_uuid, lokale I/O-ID). */
export function buildIoIndex(config) {
  const out = { sensors: new Set(), actuators: new Set() };
  ['sensors', 'actuators'].forEach(function (section) {
    const idField = SECTIONS[section].idField;
    ensureArray(config[section]).forEach(function (row) {
      out[section].add(toText(row.controller_uuid) + ':' + toIntOrNull(row[idField]));
    });
  });
  return out;
}

function verifyReferences(config, report) {
  const refIndex = buildReferenceIndex(config);
  const io = buildIoIndex(config);

  Object.keys(SECTIONS).forEach(function (section) {
    SECTIONS[section].fields.forEach(function (field) {
      if (!field.ref) return;
      const known = refIndex[field.ref];
      if (!known) return;
      ensureArray(config[section]).forEach(function (row, rowIndex) {
        const raw = row[field.name];
        if (raw === undefined || raw === null || raw === '') return;
        const value = typeof raw === 'string' ? toText(raw) : toIntOrNull(raw);
        if (!known.has(value)) {
          fail(report, section + '[' + rowIndex + '].' + field.name, 'ref_missing',
            field.name + ' "' + raw + '" existiert nicht in ' + field.ref + '.');
        }
      });
    });
  });

  ensureArray(config.process_states).forEach(function (state, index) {
    const base = 'process_states[' + index + ']';
    const ioRefs = isPlainObject(state.io_refs) ? state.io_refs : {};
    [['sensors', 'sensor_id'], ['actuators', 'actuator_id']].forEach(function (entry) {
      ensureArray(ioRefs[entry[0]]).forEach(function (ref, refIndex) {
        const token = toText(ref.controller_uuid) + ':' + toIntOrNull(ref[entry[1]]);
        if (!io[entry[0]].has(token)) {
          fail(report, base + '.io_refs.' + entry[0] + '[' + refIndex + ']', 'io_ref_missing',
            'Identitätspaar (' + token + ') existiert nicht in ' + entry[0] + '.');
        }
      });
    });
    const strategy = state.control_strategy;
    if (isPlainObject(strategy)) {
      if (toText(strategy.type) === 'PID'
          && !refIndex['pid_configs.pid_config_id'].has(toIntOrNull(strategy.pid_config_id))) {
        fail(report, base + '.control_strategy.pid_config_id', 'ref_missing',
          'pid_config_id existiert nicht.');
      }
      if (toText(strategy.type) === 'control_method'
          && !refIndex['control_methods.method_id'].has(toIntOrNull(strategy.method_id))) {
        fail(report, base + '.control_strategy.method_id', 'ref_missing',
          'method_id existiert nicht.');
      }
      if (['PID', 'control_method'].indexOf(toText(strategy.type)) < 0) {
        fail(report, base + '.control_strategy.type', 'strategy_union',
          'control_strategy kennt nur "PID" und "control_method" (oder null). '
          + 'Erhalten: "' + toText(strategy.type) + '".');
      }
    } else if (strategy !== null && strategy !== undefined) {
      fail(report, base + '.control_strategy', 'strategy_type',
        'control_strategy muss Objekt oder null sein.');
    }
  });

  ensureArray(config.filters).forEach(function (filter, index) {
    ensureArray(filter.sensor_refs).forEach(function (ref, refIndex) {
      const token = toText(ref.controller_uuid) + ':' + toIntOrNull(ref.sensor_id);
      if (!io.sensors.has(token)) {
        fail(report, 'filters[' + index + '].sensor_refIndex[' + refIndex + ']', 'io_ref_missing',
          'Identitätspaar (' + token + ') existiert nicht in sensors.');
      }
    });
  });

  const statesById = indexBy(config.process_states, 'state_id');
  ensureArray(config.rules).forEach(function (rule, index) {
    const base = 'rules[' + index + ']';
    ['when', 'until'].forEach(function (bucket) {
      ensureArray(rule[bucket]).forEach(function (cond, condIndex) {
        verifyCondition(report, base + '.' + bucket + '[' + condIndex + ']', cond,
          index, io, statesById);
      });
    });
    ['do', 'else_do'].forEach(function (bucket) {
      ensureArray(rule[bucket]).forEach(function (action, actionIndex) {
        verifyAction(report, base + '.' + bucket + '[' + actionIndex + ']', action, index);
      });
    });
  });

  function verifyCondition(rep, path, cond, ruleIndex, ioIndex, states) {
    if (!isPlainObject(cond)) {
      fail(rep, path, 'condition_type', 'Bedingung ist kein Objekt.');
      return;
    }
    const src = toText(cond.src);
    const op = toText(cond.op);
    if (ENUMS.rule_src.indexOf(src) < 0) {
      fail(rep, path + '.src', 'condition_src',
        'src "' + src + '" ist nicht V9-legal (erlaubt: ' + ENUMS.rule_src.join(', ') + ').');
    }
    if (ENUMS.rule_op.indexOf(op) < 0) {
      const hint = RUNTIME_ONLY_OPERATORS.indexOf(op) >= 0
        ? ' Die Runtime-Engine kennt ihn zwar, der Config-Vertrag aber nicht.' : '';
      fail(rep, path + '.op', 'condition_op',
        'Operator "' + op + '" ist nicht V9-legal.' + hint);
    }
    const value = cond.value;
    const validValue = typeof value === 'number' || typeof value === 'boolean'
      || (isPlainObject(value) && toIntOrNull(value.param_of_state) !== null && toText(value.key));
    if (!validValue) {
      fail(rep, path + '.value', 'condition_value',
        'value muss number, bool oder {param_of_state, key[, scale]} sein '
        + '(Strings sind nicht zulässig).');
    }
    if (isPlainObject(value)) {
      const target = states.get(toIntOrNull(value.param_of_state));
      if (!target) {
        fail(rep, path + '.value.param_of_state', 'ref_missing',
          'Referenzierter State existiert nicht.');
      } else {
        const parameters = isPlainObject(target.parameters) ? target.parameters : {};
        if (!(toText(value.key) in parameters)) {
          fail(rep, path + '.value.key', 'param_key_missing',
            'Parameter "' + toText(value.key) + '" existiert nicht in state '
            + toIntOrNull(value.param_of_state) + '.');
        }
      }
    }
    if (src === 'sensor') {
      const token = toText(cond.controller_uuid) + ':' + toIntOrNull(cond.sensor_id);
      if (!ioIndex.sensors.has(token)) {
        fail(rep, path, 'io_ref_missing',
          'Sensorpaar (' + token + ') existiert nicht. V9 referenziert Sensoren immer als '
          + 'controller_uuid + lokale sensor_id.');
      }
    }
    if (src === 'state' && !states.has(toIntOrNull(cond.state_id))) {
      fail(rep, path + '.state_id', 'ref_missing', 'state_id existiert nicht.');
    }
  }

  function verifyAction(rep, path, action, ruleIndex) {
    if (!isPlainObject(action)) {
      fail(rep, path, 'action_type', 'Aktion ist kein Objekt.');
      return;
    }
    const markers = ['state_ids', 'p_ids', 'notify'].filter(function (name) {
      return action[name] !== undefined && action[name] !== null;
    });
    if (!markers.length) {
      fail(rep, path, 'action_marker',
        'Aktion braucht genau einen Handler-Marker: state_ids, p_ids oder notify.');
      return;
    }
    ensureArray(action.state_ids).forEach(function (id, i) {
      if (!refIndex['process_states.state_id'].has(toIntOrNull(id))) {
        fail(rep, path + '.state_ids[' + i + ']', 'ref_missing',
          'state_id ' + id + ' existiert nicht.');
      }
    });
    ensureArray(action.p_ids).forEach(function (id, i) {
      if (!refIndex['processes.p_id'].has(toIntOrNull(id))) {
        fail(rep, path + '.p_ids[' + i + ']', 'ref_missing', 'p_id ' + id + ' existiert nicht.');
      }
    });
    if (action.value_id !== undefined
        && !refIndex['process_values.value_id'].has(toIntOrNull(action.value_id))) {
      fail(rep, path + '.value_id', 'ref_missing', 'value_id existiert nicht.');
    }
  }
}

function verifyWritability(config, report) {
  const engine = ensureArray(config.rule_engine)[0];
  if (!isPlainObject(engine)) return;
  const writable = new Set(ensureArray(engine.writable_fields).map(toText));
  const requiredModeId = toIntOrNull(engine.required_mode_id);
  const statesById = indexBy(config.process_states, 'state_id');

  ensureArray(config.rules).forEach(function (rule, index) {
    ['do', 'else_do'].forEach(function (bucket) {
      ensureArray(rule[bucket]).forEach(function (action, actionIndex) {
        const path = 'rules[' + index + '].' + bucket + '[' + actionIndex + ']';
        Object.keys(isPlainObject(action) ? action : {}).forEach(function (name) {
          if (['state_ids', 'p_ids', 'notify'].indexOf(name) >= 0) return;
          if (!writable.has(name)) {
            fail(report, path + '.' + name, 'not_writable',
              'Feld "' + name + '" steht nicht in rule_engine.writable_fields '
              + '[' + Array.from(writable).join(', ') + '] — der Worker verwirft die Aktion.');
          }
        });
        ensureArray(action.state_ids).forEach(function (id) {
          const state = statesById.get(toIntOrNull(id));
          if (state && toIntOrNull(state.mode_id) !== requiredModeId) {
            warn(report, path, 'mode_gate',
              'State ' + id + ' hat mode_id ' + toIntOrNull(state.mode_id)
              + ', die Engine schreibt nur bei mode_id ' + requiredModeId
              + ' (status "skipped_mode").');
          }
        });
      });
    });
  });
}

function collectStats(config, report) {
  SECTION_ORDER.forEach(function (section) {
    report.stats[section] = ensureArray(config[section]).length;
  });
  report.stats.__errors = report.errors.length;
  report.stats.__warnings = report.warnings.length;
}

/* -------------------------------------------------------------------------
 * Oeffentliche API
 * ---------------------------------------------------------------------- */

/** Vollständige Prüfkette. */
export function validateConfig(config) {
  const report = makeReport();
  if (!isPlainObject(config)) {
    fail(report, '', 'config_type', 'Config ist kein Objekt.');
    return report;
  }
  verifyStructure(config, report, 'node');
  const meta = verifyMeta(config, report);
  verifyFields(config, report);
  verifyUniqueness(config, report);
  verifyRoutingOwnership(config, report, meta);
  verifyExecutionOwnership(config, report, meta);
  verifyReferences(config, report);
  verifyWritability(config, report);
  collectStats(config, report);
  return report;
}

/* =========================================================================
 * Cross-V8-Validierung
 * =========================================================================
 * Spiegelt `config_sharding_contracts.validate_cross_execution_shard()`
 * vollständig — inklusive der Reihenfolge der Prüfungen:
 *
 *   1  inspect_cross_v8_contract   Struktur + version 8 + cross-Scope
 *   2  owner_node_id gesetzt
 *   3  meta-Scope == cross, Owner konsistent
 *   4  version == 8
 *   5  domain_id | cross_domain_id gesetzt
 *   6  local_node LEER
 *   7  Owner ist ein aktivierter Node
 *   8  controllers ohne bus_type/host/port/unit
 *   9  sensors/actuators ohne address/bus_type/function_type/unit
 *  10  kein virtueller Controller mit virt_active
 *  11  validate_controller_ownership (genau ein Owner je UUID, Routen eindeutig)
 *  12  jede Regel cross_controller oder cross_worker
 *  13  Regel-Owner == Shard-Owner
 *  14  keine kritische Regelgruppe
 *  15  cross_rule_eligibility (nur cross-eigene States mutieren)
 * ====================================================================== */

/** Prüft einen Cross-V8-Shard fail-closed. */
export function validateCrossShard(config, options) {
  const opts = isPlainObject(options) ? options : {};
  const report = makeReport();
  if (!isPlainObject(config)) {
    fail(report, '', 'config_type', 'Cross-Shard ist kein Objekt.');
    return report;
  }
  const meta = ensureArray(config.meta)[0] || {};
  const owner = toText(opts.owner_node_id) || toText(meta.owner_node_id);

  // 1 + 4: Struktur und Version
  verifyStructure(config, report, 'cross');
  if (toText(meta.schema) !== CANONICAL_SCHEMA) {
    fail(report, 'meta.schema', 'meta_schema',
      'meta.schema muss "' + CANONICAL_SCHEMA + '" sein.');
  }
  if (toIntOrNull(meta.version) !== CROSS_VERSION) {
    fail(report, 'meta.version', 'cross_version',
      'Cross-Shard verlangt meta.version 8, gefunden ' + toText(meta.version) + '.');
  }

  // 3: Scope
  if (CROSS_PROFILE.scopes.indexOf(toText(meta.scope)) < 0) {
    fail(report, 'meta.scope', 'cross_scope',
      'Cross-Shard verlangt einen expliziten Cross-Scope ('
      + CROSS_PROFILE.scopes.join(' | ') + ').');
  }

  // 2: Owner
  if (!owner) {
    fail(report, 'meta.owner_node_id', 'cross_owner_missing',
      'Cross-Shard verlangt owner_node_id.');
  }

  // 5: Domain
  if (!toText(meta.domain_id) && !toText(meta.cross_domain_id)) {
    fail(report, 'meta.domain_id', 'cross_domain_missing',
      'Cross-Shard verlangt eine Domain-Identität (domain_id oder cross_domain_id).');
  }

  // 7: Owner muss aktivierter Node sein
  const enabledNodes = ensureArray(config.nodes)
    .filter(function (row) { return row.enabled !== false; })
    .map(function (row) { return toText(row.node_id); });
  if (enabledNodes.length && enabledNodes.indexOf(owner) < 0) {
    fail(report, 'nodes', 'cross_owner_not_enabled',
      'Cross-Shard-Owner "' + owner + '" ist kein aktivierter Node.');
  }

  // 8: Controller ohne Physikfelder
  ensureArray(config.controllers).forEach(function (row, index) {
    const leaked = CROSS_PROFILE.forbiddenControllerFields.filter(function (name) {
      return row[name] !== undefined;
    });
    if (leaked.length) {
      fail(report, 'controllers[' + index + ']', 'cross_physical_controller',
        'Cross-Controller-Stub trägt Physikfelder: ' + leaked.join(', ') + '.');
    }
    if (!toText(row.owner_node_id)) {
      fail(report, 'controllers[' + index + '].owner_node_id', 'cross_controller_owner',
        'Cross-Controller verlangt owner_node_id.');
    }
  });

  // 9: I/O ohne Physikfelder
  ['sensors', 'actuators'].forEach(function (section) {
    ensureArray(config[section]).forEach(function (row, index) {
      const leaked = CROSS_PROFILE.forbiddenIoFields.filter(function (name) {
        return row[name] !== undefined;
      });
      if (leaked.length) {
        fail(report, section + '[' + index + ']', 'cross_physical_io',
          'Cross-' + section + ' trägt Physikfelder: ' + leaked.join(', ') + '.');
      }
    });
  });

  // 10: keine aktiven virtuellen Controller
  ensureArray(config.virtual_controllers).forEach(function (row, index) {
    if (row.virt_active === true) {
      fail(report, 'virtual_controllers[' + index + '].virt_active', 'cross_virt_active',
        'Cross-Shard darf keinen virtuellen Hardware-Controller aktivieren.');
    }
  });

  // 11: Routing-Ownership
  verifyCrossOwnership(config, report, enabledNodes);

  // Felder, Eindeutigkeit, Referenzen — wie im Node-Profil
  verifyFieldsForProfile(config, report, 'cross');
  verifyUniqueness(config, report);
  verifyReferences(config, report);

  // 12–15: Regeln
  verifyCrossRules(config, report, owner, opts.scopes);

  collectStats(config, report);
  report.stats.__profile = 'cross';
  report.stats.__owner_node_id = owner;
  return report;
}

function verifyCrossOwnership(config, report, enabledNodes) {
  const owners = new Map();
  const routeKeys = new Set();
  const localRoutes = new Set();

  ensureArray(config.site_controller_map).forEach(function (route, index) {
    if (route.enabled === false) return;
    const uuid = toText(route.controller_uuid);
    if (toText(route.routing_role) === 'owner') {
      if (owners.has(uuid) && owners.get(uuid) !== toText(route.node_id)) {
        fail(report, 'site_controller_map[' + index + ']', 'cross_owner_conflict',
          'Controller ' + uuid + ' hat mehr als einen Owner-Node.');
      }
      owners.set(uuid, toText(route.node_id));
    }
    const routeKey = toText(route.route_key);
    if (routeKey) {
      if (routeKeys.has(routeKey)) {
        fail(report, 'site_controller_map[' + index + '].route_key', 'duplicate_route_key',
          'Doppelter aktivierter route_key "' + routeKey + '".');
      }
      routeKeys.add(routeKey);
    }
    const localKey = toText(route.node_id) + ':' + toIntOrNull(route.local_controller_id);
    if (localRoutes.has(localKey)) {
      fail(report, 'site_controller_map[' + index + ']', 'duplicate_local_route',
        'Doppelte aktivierte lokale Controller-Route ' + localKey + '.');
    }
    localRoutes.add(localKey);
  });

  owners.forEach(function (nodeId, uuid) {
    if (enabledNodes.length && enabledNodes.indexOf(nodeId) < 0) {
      fail(report, 'site_controller_map', 'cross_owner_node_disabled',
        'Controller ' + uuid + ': Owner-Node "' + nodeId + '" ist in nodes nicht aktiviert.');
    }
  });
}

function verifyCrossRules(config, report, owner, precomputedScopes) {
  const scopes = precomputedScopes || null;
  const statesById = indexBy(config.process_states, 'state_id');

  ensureArray(config.rules).forEach(function (rule, index) {
    const base = 'rules[' + index + ']';
    const ruleId = toIntOrNull(rule.rule_id);

    // 13: Owner
    if (toText(rule.owner_node_id) && toText(rule.owner_node_id) !== owner) {
      fail(report, base + '.owner_node_id', 'cross_rule_owner',
        'Cross-Regel ' + ruleId + ' hat einen anderen Owner als der Shard ("' + owner + '").');
    }

    // 14: keine kritischen Gruppen
    if (isCriticalRule(rule)) {
      fail(report, base + '.group', 'cross_critical_rule',
        'Kritische Regel ' + ruleId + ' darf nicht im Cross-Shard existieren '
        + '(Gruppe "' + toText(rule.group) + '").');
    }

    // 12 + 15: Scope und Writer-Sicherheit
    if (scopes) {
      const scope = scopes.rules.get(ruleId);
      if (CROSS_PROFILE.ruleScopes.indexOf(scope) < 0) {
        fail(report, base, 'cross_rule_scope',
          'Cross-Shard-Regel ' + ruleId + ' ist "' + scope + '" — erlaubt sind nur '
          + CROSS_PROFILE.ruleScopes.join(' und ') + '.');
      }
      const mutated = mutatedStateIds(rule);
      const invalid = mutated.filter(function (stateId) {
        return CROSS_PROFILE.ruleScopes.indexOf(scopes.states.get(stateId)) < 0;
      });
      if (invalid.length) {
        fail(report, base, 'cross_rule_targets',
          'Cross-Regel ' + ruleId + ' schreibt States, die nicht cross-eigen sind: '
          + invalid.join(', ') + '.');
      }
      const notifyOnly = !mutated.length && hasNotifyAction(rule);
      if (!mutated.length && !notifyOnly) {
        fail(report, base, 'cross_rule_no_target',
          'Cross-Regel ' + ruleId + ' hat kein cross-eigenes State-Ziel.');
      }
    }

    // Referenzen der Aktionen
    ['do', 'else_do'].forEach(function (bucket) {
      ensureArray(rule[bucket]).forEach(function (action) {
        ensureArray(action.state_ids).forEach(function (stateId) {
          if (!statesById.has(toIntOrNull(stateId))) {
            fail(report, base + '.' + bucket, 'ref_missing',
              'state_id ' + stateId + ' existiert im Cross-Shard nicht.');
          }
        });
      });
    });
  });
}

/* -------------------------------------------------------------------------
 * Wirksamkeit zur Laufzeit
 *
 * Die gefährlichste Sorte Fehler ist die, die VALIDIERT. Der V9-Vertrag
 * erlaubt drei Konstrukte, die die Runtime anschließend stillschweigend
 * ignoriert — die Regel wird angenommen, tut aber nicht, was dasteht:
 *
 *   1. `filter_id` in einer Sensorbedingung. Die Runtime baut die Fakten mit
 *      `filters: {}` (thread_management._build_rule_context), der Lookup
 *      schlägt fehl und die Bedingung rechnet mit dem ROHWERT weiter.
 *   2. `src: "timer"`. Die Fakten enthalten überhaupt keine `timers`;
 *      `timers_evaluate()` wird im Produktivcode nirgends aufgerufen. Die
 *      Bedingung ist damit dauerhaft falsch — die Regel feuert nie.
 *   3. `latch: "auto"`. `_apply_rule_state_machine` reagiert ausschließlich
 *      auf `latch === "manual"`; "auto" ist ein No-Op.
 *
 * Deshalb Hinweise, keine Fehler: die Config ist vertragskonform, nur die
 * Erwartung des Anwenders ist es nicht.
 * ---------------------------------------------------------------------- */

function verifyRuntimeEffectiveness(rule, base, report) {
  ['when', 'until'].forEach(function (bucket) {
    ensureArray(rule[bucket]).forEach(function (cond, index) {
      const where = base + '.' + bucket + '[' + index + ']';
      if (toIntOrNull(cond.filter_id) !== null) {
        warn(report, where + '.filter_id', 'filter_not_applied',
          'Die Runtime baut die Fakten mit filters={} — die Bedingung rechnet mit '
          + 'dem Rohwert des Sensors, nicht mit dem gefilterten Wert.');
      }
      if (toText(cond.src) === 'timer') {
        warn(report, where + '.src', 'timer_source_inactive',
          'Die Faktenbasis enthält keine timers — eine timer-Bedingung ist '
          + 'dauerhaft falsch und die Regel feuert nie.');
      }
    });
  });
  if (toText(rule.latch) === 'auto') {
    warn(report, base + '.latch', 'latch_auto_noop',
      'latch="auto" ist wirkungslos; nur "manual" hält eine Regel gesetzt. '
      + 'Für Hysterese ist "until" das richtige Mittel.');
  }
}

/** Kritische Regel im Sinne von is_critical_rule(). */
export function isCriticalRule(rule) {
  if (!isPlainObject(rule)) return false;
  const group = toText(rule.group).toLowerCase().replace(/-/g, '_');
  if (CRITICAL_GROUPS.indexOf(group) >= 0) return true;
  if (['critical', 'safety_critical', 'time_critical', 'hard_realtime'].some(function (key) {
    return rule[key] === true;
  })) return true;
  if (['deadline_ms', 'max_latency_ms'].some(function (key) {
    const value = rule[key];
    return typeof value === 'number' && !Number.isNaN(value) && value >= 0;
  })) return true;
  const latency = toText(rule.latency_class).toLowerCase().replace(/-/g, '_');
  return CRITICAL_GROUPS.indexOf(latency) >= 0;
}

/** State-IDs, die eine Regel schreibt (do + else_do). */
export function mutatedStateIds(rule) {
  const out = new Set();
  ['do', 'else_do'].forEach(function (bucket) {
    ensureArray((rule || {})[bucket]).forEach(function (action) {
      ensureArray(action.state_ids).forEach(function (stateId) {
        const parsed = toIntOrNull(stateId);
        if (parsed !== null) out.add(parsed);
      });
    });
  });
  return Array.from(out).sort(function (a, b) { return a - b; });
}

function hasNotifyAction(rule) {
  return ['do', 'else_do'].some(function (bucket) {
    return ensureArray((rule || {})[bucket]).some(function (action) {
      return isPlainObject(action) && toText(action.notify) !== '';
    });
  });
}

/** Felderprüfung im gewählten Profil (Cross blendet Physikfelder aus). */
function verifyFieldsForProfile(config, report, profile) {
  Object.keys(SECTIONS).forEach(function (section) {
    const fields = fieldsFor(section, profile);
    ensureArray(config[section]).forEach(function (row, index) {
      const base = section + '[' + index + ']';
      if (!isPlainObject(row)) {
        fail(report, base, 'row_type', 'Zeile ist kein Objekt.');
        return;
      }
      fields.forEach(function (field) {
        const value = row[field.name];
        if (value === undefined) {
          if (field.required) {
            fail(report, base + '.' + field.name, 'field_missing', 'Pflichtfeld fehlt.');
          }
          return;
        }
        verifyValue(report, base + '.' + field.name, field, value);
      });
    });
  });
}

/** Profilabhängiger Einstieg: wählt Node- oder Cross-Prüfung. */
export function validateProfile(config, options) {
  return isCrossConfig(config)
    ? validateCrossShard(config, options)
    : validateConfig(config);
}

/** Kurzform für UI-Badges. */
export function summarize(report) {
  if (!report) return { status: 'UNKNOWN', errors: 0, warnings: 0 };
  return {
    status: report.status,
    errors: report.errors.length,
    warnings: report.warnings.length
  };
}

/** Gruppiert Befunde nach Sektion (für die Validierungsansicht). */
export function groupFindings(report) {
  const out = new Map();
  ['errors', 'warnings'].forEach(function (bucket) {
    ensureArray((report || {})[bucket]).forEach(function (item) {
      const section = String(item.path || '').split(/[.[]/)[0] || '(global)';
      if (!out.has(section)) out.set(section, { errors: [], warnings: [] });
      out.get(section)[bucket].push(item);
    });
  });
  return out;
}
