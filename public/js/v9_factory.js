/**
 * v9_factory.js — vollständig überarbeitete Config-Factories (V9).
 *
 * Ablösung der 64 verstreuten Ad-hoc-Objektliterale aus V50 (registry.js,
 * device.js, hmi.js, processes.js, rules_generator.js, automation_tabs.js,
 * model_adapter.js). Statt handgeschriebener Literale erzeugt jede Factory ihr
 * Ergebnis generisch aus `v9_schema.SECTIONS` — ein neues Vertragsfeld wirkt
 * automatisch in Defaults, Formularen und Validierung.
 *
 * Drei Ebenen:
 *   1. generisch   — createEntity(section, patch, ctx)
 *   2. spezialisiert — createController/createSensor/... (Identität + Routing)
 *   3. transaktional — addEntity/removeEntity/updateEntity (Kaskaden + Derivate)
 *
 * Invariante: jede Factory liefert ein Objekt, das `v9_validate` besteht,
 * sobald seine Referenzen existieren.
 *
 * Stil: rein funktional, kein OOP, keine Klassen.
 */

'use strict';

import {
  SECTIONS, SUB_SPECS, ENUMS, SECTION_ORDER, CANONICAL_SCHEMA, CANONICAL_VERSION,
  CROSS_VERSION, CROSS_PROFILE, DEFAULT_SITE_ID, DEFAULT_NODE_ID, UNCONFIGURED_HOST,
  routeKeyFor, executionScopeFor, executionScopeForStatus, crossDomainFor,
  functionTypesFor, primaryKey, emptyConfig, orderSections
} from './v9_schema.js';
import { controllerUuidFor, controllerKeyFor } from './v9_uuid.js';
import {
  deepClone, ensureArray, isPlainObject, indexBy, nextNumericId,
  toIntOrNull, toNumberOrNull, toText, toBool, uniqInts
} from './shared_utils.js';

/* -------------------------------------------------------------------------
 * Kontext — alle Ableitungen an einem Ort
 * ---------------------------------------------------------------------- */

/**
 * Erzeugt den Ableitungskontext einer Config.
 * Alle Factories lesen Identität, Topologie und freie IDs ausschließlich hieraus.
 */
export function createContext(config) {
  const cfg = isPlainObject(config) ? config : {};
  const meta = ensureArray(cfg.meta)[0] || {};
  const sites = ensureArray(cfg.sites);
  const nodes = ensureArray(cfg.nodes);
  const routes = ensureArray(cfg.site_controller_map);
  const controllers = ensureArray(cfg.controllers);

  const siteId = toText(meta.site_id) || toText((sites[0] || {}).site_id) || DEFAULT_SITE_ID;
  const nodeId = toText(meta.node_id) || toText(meta.owner_node_id)
    || toText((nodes[0] || {}).node_id) || DEFAULT_NODE_ID;

  const routeByUuid = indexBy(routes, 'controller_uuid');
  const controllerByUuid = indexBy(controllers, 'controller_uuid');
  const controllerByGlobalId = indexBy(controllers, 'controller_id');

  // `local_controller_id` ist NUR je Node eindeutig. Sobald zwei Worker in
  // derselben Config stehen, gibt es auf fn-01 und fn-02 jeweils eine
  // "local_controller_id 1" — ein node-blinder Index würde I/O-Zeilen dem
  // falschen Controller zuordnen. Deshalb ist der Schlüssel "<node>#<lokal>".
  const routeByNodeLocal = new Map();
  routes.forEach(function (route) {
    if (!isPlainObject(route)) return;
    routeByNodeLocal.set(toText(route.node_id) + '#'
      + toIntOrNull(route.local_controller_id), route);
  });

  return {
    config: cfg,
    scope: toText(meta.scope) || 'node_local',
    siteId,
    nodeId,
    routeByUuid,
    routeByNodeLocal,
    controllerByUuid,
    controllerByGlobalId,
    // Rückwärtskompatibler Alias — Bestandscode las controllerByLocalId.
    controllerByLocalId: controllerByGlobalId,
    sensorsByUuid: groupIo(cfg.sensors, 'sensor_id'),
    actuatorsByUuid: groupIo(cfg.actuators, 'actuator_id')
  };
}

function groupIo(rows, idField) {
  const out = new Map();
  ensureArray(rows).forEach(function (row) {
    if (!isPlainObject(row)) return;
    const uuid = toText(row.controller_uuid);
    if (!out.has(uuid)) out.set(uuid, new Map());
    out.get(uuid).set(toIntOrNull(row[idField]), row);
  });
  return out;
}

/**
 * Identitätsblock zu einer controller_uuid.
 *
 * Die UUID IST die Identität — `local_controller_id` ist daraus abgeleitet und
 * kommt aus der Route, nicht aus der globalen `controller_id`. Genau diese
 * Verwechslung führte im Zwei-Node-Betrieb dazu, dass eine I/O-Zeile von fn-02
 * mit lokaler Controller-ID 2 dem fn-01-Controller mit globaler ID 2
 * zugeschlagen wurde.
 */
export function identityForUuid(ctx, controllerUuid) {
  const uuid = toText(controllerUuid);
  if (!uuid) return null;
  const controller = ctx.controllerByUuid ? ctx.controllerByUuid.get(uuid) : null;
  const route = ctx.routeByUuid ? ctx.routeByUuid.get(uuid) : null;
  if (!controller && !route) return null;
  const anchor = route || controller;
  return {
    local_controller_id: route
      ? toIntOrNull(route.local_controller_id)
      : (toIntOrNull(controller.local_controller_id)
        || toIntOrNull(controller.controller_id)),
    controller_uuid: uuid,
    controller_key: toText(anchor.controller_key)
      || toText((controller || {}).controller_key),
    node_id: toText(anchor.node_id) || ctx.nodeId,
    site_id: toText(anchor.site_id) || ctx.siteId
  };
}

/** Identitätsblock über die Route: (node_id, local_controller_id). */
export function identityForRoute(ctx, nodeId, localControllerId) {
  if (!ctx.routeByNodeLocal) return null;
  const route = ctx.routeByNodeLocal.get(toText(nodeId) + '#'
    + toIntOrNull(localControllerId));
  return route ? identityForUuid(ctx, route.controller_uuid) : null;
}

/**
 * Identitätsblock eines Controllers.
 *
 * Auflösungsreihenfolge, absichtlich von stark nach schwach:
 *   1. Route auf dem angegebenen Node — der Vertragsweg.
 *   2. Route auf dem Default-Node — für Configs ohne node_id an der Zeile.
 *   3. globale `controller_id` — Notnagel für Altbestände ohne Route.
 */
export function identityFor(ctx, localControllerId, nodeId) {
  const wanted = toText(nodeId);
  const viaRoute = (wanted ? identityForRoute(ctx, wanted, localControllerId) : null)
    || identityForRoute(ctx, ctx.nodeId, localControllerId);
  if (viaRoute) return viaRoute;
  const controller = ctx.controllerByGlobalId
    ? ctx.controllerByGlobalId.get(toIntOrNull(localControllerId)) : null;
  return controller ? identityForUuid(ctx, controller.controller_uuid) : null;
}

function routeNodeId(ctx, uuid) {
  const route = ctx.routeByUuid.get(toText(uuid));
  return route ? toText(route.node_id) : ctx.nodeId;
}

function routeSiteId(ctx, uuid) {
  const route = ctx.routeByUuid.get(toText(uuid));
  return route ? toText(route.site_id) || ctx.siteId : ctx.siteId;
}

/* -------------------------------------------------------------------------
 * Generische Ebene
 * ---------------------------------------------------------------------- */

const TYPE_DEFAULTS = {
  str: '', int: 0, num: 0, bool: false, list: [], map: {}, obj: {}, any: null
};

/** Default eines einzelnen Feldes aus der Schemadefinition. */
export function defaultForField(field) {
  if (field.default !== undefined) return deepClone(field.default);
  if (field.enumKey && ENUMS[field.enumKey] && ENUMS[field.enumKey].length) {
    return ENUMS[field.enumKey][0];
  }
  if (field.nullable) return null;
  return deepClone(TYPE_DEFAULTS[field.type] !== undefined ? TYPE_DEFAULTS[field.type] : null);
}

/** Kontraktkonformes Default-Objekt einer Sektion (nur Pflichtfelder). */
export function defaultsFor(section) {
  const spec = SECTIONS[section];
  if (!spec) throw new Error('Unbekannte Sektion: ' + section);
  const out = {};
  spec.fields.forEach(function (field) {
    if (field.required) out[field.name] = defaultForField(field);
  });
  return out;
}

/** Default-Objekt einer Subspezifikation (condition, action, filter_step, …). */
export function defaultsForSub(name, variant) {
  const spec = SUB_SPECS[name];
  if (!spec) throw new Error('Unbekannte Subspezifikation: ' + name);
  const fields = spec.variants ? spec.variants[variant || Object.keys(spec.variants)[0]] : spec.fields;
  const out = {};
  ensureArray(fields).forEach(function (field) {
    if (field.required) out[field.name] = defaultForField(field);
  });
  return out;
}

/** Wert auf den im Schema deklarierten Typ zwingen. */
export function coerceField(field, value) {
  if (value === undefined) return undefined;
  if (value === null) return field.nullable || !field.required ? null : defaultForField(field);
  switch (field.type) {
    case 'int': {
      const parsed = toIntOrNull(value);
      return parsed === null ? defaultForField(field) : parsed;
    }
    case 'num': {
      const parsed = toNumberOrNull(value);
      return parsed === null ? defaultForField(field) : parsed;
    }
    case 'bool':
      return toBool(value, defaultForField(field));
    case 'str':
      return toText(value);
    case 'list':
      return ensureArray(value).slice();
    case 'map':
      return isPlainObject(value) ? deepClone(value) : {};
    case 'obj':
      return isPlainObject(value) ? deepClone(value) : (field.nullable ? null : {});
    default:
      return deepClone(value);
  }
}

/**
 * Generische Entity-Factory.
 * Erzeugt eine Zeile in kanonischer Feldreihenfolge; unbekannte Patch-Keys
 * werden verworfen (V9 lehnt Fremdfelder ab).
 */
export function createEntity(section, patch, options) {
  const spec = SECTIONS[section];
  if (!spec) throw new Error('Unbekannte Sektion: ' + section);
  const source = isPlainObject(patch) ? patch : {};
  const keepOptional = Boolean(options && options.keepOptional);
  const out = {};

  spec.fields.forEach(function (field) {
    const provided = source[field.name];
    if (provided === undefined) {
      if (field.required) out[field.name] = defaultForField(field);
      else if (keepOptional) out[field.name] = defaultForField(field);
      return;
    }
    const coerced = coerceField(field, provided);
    if (coerced === undefined) return;
    out[field.name] = coerced;
  });
  return out;
}

/** Nächste freie ID einer Sektion. */
export function nextIdFor(config, section) {
  const key = primaryKey(section);
  if (!key) return 1;
  return nextNumericId(ensureArray((config || {})[section]), key, 1);
}

/* -------------------------------------------------------------------------
 * Topologie-Factories
 * ---------------------------------------------------------------------- */

export function createSite(patch) {
  return createEntity('sites', Object.assign({
    site_id: DEFAULT_SITE_ID,
    site_name: 'Main Site',
    enabled: true,
    description: ''
  }, patch));
}

export function createNode(patch, ctx) {
  const context = ctx || {};
  return createEntity('nodes', Object.assign({
    node_id: DEFAULT_NODE_ID,
    site_id: context.siteId || DEFAULT_SITE_ID,
    node_role: 'worker',
    enabled: true,
    description: ''
  }, patch));
}

/** Route-Zeile aus Controller-Identität ableiten (route_key ist berechnet). */
export function createRoute(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  const siteId = toText(source.site_id) || context.siteId || DEFAULT_SITE_ID;
  const nodeId = toText(source.node_id) || context.nodeId || DEFAULT_NODE_ID;
  const localId = toIntOrNull(source.local_controller_id) || 1;
  return createEntity('site_controller_map', {
    local_controller_id: localId,
    node_id: nodeId,
    site_id: siteId,
    controller_uuid: toText(source.controller_uuid),
    controller_key: toText(source.controller_key),
    route_key: toText(source.route_key) || routeKeyFor(siteId, nodeId, localId),
    routing_role: toText(source.routing_role) || 'owner',
    enabled: source.enabled === undefined ? true : toBool(source.enabled, true)
  });
}

/** local_node-Singleton aus den Routen eines Nodes ableiten. */
export function createLocalNode(config, nodeId, siteId) {
  const routes = ensureArray((config || {}).site_controller_map).filter(function (route) {
    return toText(route.node_id) === toText(nodeId)
      && toBool(route.enabled, true)
      && toText(route.routing_role) === 'owner';
  }).slice().sort(function (a, b) {
    return (toIntOrNull(a.local_controller_id) || 0) - (toIntOrNull(b.local_controller_id) || 0);
  });

  return createEntity('local_node', {
    node_id: toText(nodeId),
    site_id: toText(siteId),
    active_controller_uuids: routes.map(function (route) { return toText(route.controller_uuid); }),
    active_controller_routes: routes.map(function (route) {
      return {
        local_controller_id: toIntOrNull(route.local_controller_id),
        controller_uuid: toText(route.controller_uuid),
        controller_key: toText(route.controller_key)
      };
    })
  });
}

/**
 * `local_node` für ALLE Nodes der Config.
 *
 * Der V9-Vertrag führt `local_node` als Liste mit `min_len=1` — nicht als
 * Singleton. In einem `master_global`-Contract, der zwei Worker beschreibt,
 * gehören folglich zwei Zeilen hinein. Bis V54.0 leitete `reconcile()` immer
 * nur EINE Zeile ab und warf die zweite beim Laden weg: fn-02 verschwand
 * unbemerkt aus der Topologie, sobald der Editor die Config anfasste.
 */
export function createLocalNodes(config, siteId) {
  const seen = [];
  ensureArray((config || {}).site_controller_map).forEach(function (route) {
    const nodeId = toText(route.node_id);
    if (nodeId && seen.indexOf(nodeId) < 0) seen.push(nodeId);
  });
  seen.sort();
  return seen.map(function (nodeId) {
    return createLocalNode(config, nodeId, siteId);
  });
}

export function createMeta(patch) {
  const source = isPlainObject(patch) ? patch : {};
  const scope = toText(source.scope) || 'node_local';
  const meta = {
    schema: CANONICAL_SCHEMA,
    version: CANONICAL_VERSION,
    scope,
    description: toText(source.description)
      || 'V9-Config, erzeugt mit Automated_SVG_Integration_52.'
  };
  if (scope === 'node_local') meta.node_id = toText(source.node_id) || DEFAULT_NODE_ID;
  if (scope !== 'node_local' && scope !== 'master_global') {
    meta.owner_node_id = toText(source.owner_node_id) || DEFAULT_NODE_ID;
    meta.domain_id = toText(source.domain_id) || 'domain-main';
  }
  return meta;
}

/* -------------------------------------------------------------------------
 * Hardware-Factories
 * ---------------------------------------------------------------------- */

/**
 * Controller mit vollständiger V9-Identität.
 * `controller_key` und `controller_uuid` werden deterministisch abgeleitet,
 * sofern nicht explizit vorgegeben.
 */
export function createController(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  const localId = toIntOrNull(source.controller_id) || 1;
  const deviceName = toText(source.device_name) || 'controller_' + localId;
  const controllerKey = toText(source.controller_key) || controllerKeyFor(deviceName);
  const siteId = context.siteId || DEFAULT_SITE_ID;
  const nodeId = context.nodeId || DEFAULT_NODE_ID;

  return createEntity('controllers', {
    controller_id: localId,
    controller_uuid: toText(source.controller_uuid)
      || controllerUuidFor(siteId, nodeId, controllerKey),
    controller_key: controllerKey,
    device_name: deviceName,
    bus_type: toText(source.bus_type) || 'modbus',
    host: toText(source.host) || UNCONFIGURED_HOST,
    port: toIntOrNull(source.port) || 502,
    unit: toText(source.unit) || '0x1',
    tags: ensureArray(source.tags).map(toText)
  });
}

export function createVirtualController(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  let uuid = toText(source.controller_uuid);
  if (!uuid && context.controllerByLocalId) {
    const controller = context.controllerByLocalId.get(toIntOrNull(source.controller_id));
    uuid = controller ? toText(controller.controller_uuid) : '';
  }
  const virtId = toIntOrNull(source.virt_controller_id) || 1;
  return createEntity('virtual_controllers', {
    virt_controller_id: virtId,
    controller_uuid: uuid,
    device_name: toText(source.device_name) || 'virtual_controller_' + virtId,
    virt_active: toBool(source.virt_active, false),
    host: toText(source.host) || UNCONFIGURED_HOST,
    port: toIntOrNull(source.port) || 5020
  });
}

/** Generische I/O-Factory für sensors und actuators. */
export function createIoRow(section, patch, ctx) {
  const spec = SECTIONS[section];
  if (!spec || spec.kind !== 'io') throw new Error('Keine I/O-Sektion: ' + section);
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};

  // Reihenfolge ist Absicht: die controller_uuid ist die Identität, alles
  // andere sind Hilfsschlüssel, die nur je Node eindeutig sind.
  let identity = identityForUuid(context, source.controller_uuid);
  if (!identity && source.local_controller_id !== undefined) {
    identity = identityFor(context, source.local_controller_id, source.node_id);
  }
  if (!identity && source.controller_id !== undefined) {
    identity = identityFor(context, source.controller_id, source.node_id);
  }
  if (!identity) {
    identity = {
      local_controller_id: toIntOrNull(source.local_controller_id) || 1,
      controller_uuid: toText(source.controller_uuid),
      controller_key: toText(source.controller_key),
      node_id: context.nodeId || DEFAULT_NODE_ID,
      site_id: context.siteId || DEFAULT_SITE_ID
    };
  }

  const busType = toText(source.bus_type) || 'modbus';
  const allowed = functionTypesFor(section, busType);
  let functionType = toText(source.function_type);
  if (allowed.length && allowed.indexOf(functionType) < 0) functionType = allowed[0];

  const row = {
    local_controller_id: identity.local_controller_id,
    node_id: identity.node_id,
    site_id: identity.site_id,
    controller_uuid: identity.controller_uuid,
    controller_key: identity.controller_key,
    enabled: source.enabled === undefined ? true : toBool(source.enabled, true),
    address: source.address === undefined ? 0 : source.address,
    bus_type: busType,
    function_type: functionType
  };
  row[spec.idField] = toIntOrNull(source[spec.idField]) || 1;
  row[spec.groupField] = toText(source[spec.groupField])
    || (section === 'sensors' ? 'S1' : 'A');

  const profileId = toIntOrNull(source.profile_id);
  if (profileId !== null && profileId >= 1) row.profile_id = profileId;

  return createEntity(section, row);
}

export function createSensor(patch, ctx) { return createIoRow('sensors', patch, ctx); }
export function createActuator(patch, ctx) { return createIoRow('actuators', patch, ctx); }

/* -------------------------------------------------------------------------
 * Prozess-Factories
 * ---------------------------------------------------------------------- */

export function createProcess(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  const pId = toIntOrNull(source.p_id) || 1;
  return createEntity('processes', {
    p_id: pId,
    owner_node_id: toText(source.owner_node_id) || context.nodeId || DEFAULT_NODE_ID,
    process_name: toText(source.process_name) || 'process_' + pId,
    process_location: toText(source.process_location)
  });
}

/** io_refs aus lokalen I/O-IDs auflösen (controller_uuid wird ergänzt). */
export function createIoRefs(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  const plan = [
    ['sensors', 'sensor_id', context.sensorsByUuid],
    ['actuators', 'actuator_id', context.actuatorsByUuid]
  ];
  const out = { sensors: [], actuators: [] };

  plan.forEach(function (entry) {
    const bucket = entry[0];
    const idField = entry[1];
    const lookup = entry[2] || new Map();
    const seen = new Set();

    ensureArray(source[bucket]).forEach(function (ref) {
      let ioId = null;
      let uuid = '';
      if (isPlainObject(ref)) {
        ioId = toIntOrNull(ref[idField]);
        uuid = toText(ref.controller_uuid);
      } else {
        ioId = toIntOrNull(ref);
      }
      if (ioId === null) return;
      if (!uuid) uuid = findOwnerUuid(lookup, ioId);
      const token = uuid + ':' + ioId;
      if (!uuid || seen.has(token)) return;
      seen.add(token);
      const item = {};
      item[idField] = ioId;
      item.controller_uuid = uuid;
      out[bucket].push(item);
    });
  });
  return out;
}

function findOwnerUuid(lookup, ioId) {
  let found = '';
  lookup.forEach(function (rows, uuid) {
    if (!found && rows.has(ioId)) found = uuid;
  });
  return found;
}

/** control_strategy auf die zwei V9-legalen Varianten normieren. */
export function createControlStrategy(patch) {
  if (patch === null || patch === undefined) return null;
  const source = isPlainObject(patch) ? patch : {};
  const type = toText(source.type).trim();

  if (type === 'control_method') {
    const methodId = toIntOrNull(source.method_id);
    if (methodId === null || methodId < 1) return null;
    return { type: 'control_method', method_id: methodId };
  }
  if (type.toUpperCase() === 'PID') {
    const pidConfigId = toIntOrNull(source.pid_config_id);
    if (pidConfigId === null || pidConfigId < 1) return null;
    const out = { type: 'PID', pid_config_id: pidConfigId };
    [['anti_windup', toBool], ['out_min', toNumberOrNull], ['out_max', toNumberOrNull],
      ['sample_time', toNumberOrNull], ['error_scale', toNumberOrNull],
      ['dt_max_s', toNumberOrNull]].forEach(function (entry) {
      const key = entry[0];
      if (source[key] === undefined || source[key] === null) return;
      const value = entry[1](source[key]);
      if (value !== null) out[key] = value;
    });
    return out;
  }
  return null;
}

export function createProcessState(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  const config = context.config || {};
  const defaultMapping = toIntOrNull((ensureArray(config.schema_mappings)[0] || {}).mapping_id) || 1;

  const parameters = {};
  const rawParameters = isPlainObject(source.parameters) ? source.parameters : {};
  Object.keys(rawParameters).forEach(function (key) {
    const value = rawParameters[key];
    if (typeof value === 'boolean' || typeof value === 'number') parameters[key] = value;
    else parameters[key] = toText(value);
  });

  return createEntity('process_states', {
    state_id: toIntOrNull(source.state_id) || 1,
    p_id: toIntOrNull(source.p_id) || 1,
    value_id: toIntOrNull(source.value_id) || 1,
    mode_id: toIntOrNull(source.mode_id) || 2,
    mapping_id: toIntOrNull(source.mapping_id) || defaultMapping,
    io_refs: createIoRefs(source.io_refs || {
      sensors: source.sensor_ids || source.sensor_id,
      actuators: source.actuator_ids || source.actuator_id
    }, context),
    control_strategy: createControlStrategy(source.control_strategy),
    setpoint_source: source.setpoint_source === undefined ? null : source.setpoint_source,
    parameters
  });
}

/* -------------------------------------------------------------------------
 * Rule-Factories
 * ---------------------------------------------------------------------- */

export function createRuleEngine(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  const config = context.config || {};
  const modes = ensureArray(config.process_modes);
  let requiredModeId = toIntOrNull(source.required_mode_id);
  if (requiredModeId === null) {
    const automatic = modes.filter(function (mode) {
      return toText(mode.mode).toLowerCase() === 'automatic';
    })[0];
    requiredModeId = automatic ? toIntOrNull(automatic.mode_id) : 2;
  }

  return createEntity('rule_engine', {
    engine_id: toIntOrNull(source.engine_id) || 1,
    required_mode_id: requiredModeId || 2,
    enabled: source.enabled === undefined ? true : toBool(source.enabled, true),
    writable_fields: ensureArray(source.writable_fields).length
      ? ensureArray(source.writable_fields).map(toText)
      : ['value_id', 'parameters'],
    sp_tolerance: toNumberOrNull(source.sp_tolerance) === null
      ? 0.5 : toNumberOrNull(source.sp_tolerance),
    defaults: Object.assign(
      { eval: 'on_event', exec: 'parallel', priority: 100 },
      isPlainObject(source.defaults) ? source.defaults : {}),
    runtime: Object.assign({
      threading: 'per_controller',
      tick_ms: 100,
      snapshot_isolation: true,
      identity_model: 'controller_uuid_plus_local_io_id',
      routing_model: 'site_id_node_id_local_controller_id',
      remote_signal_refs: 'allowed_by_controller_uuid',
      max_signal_age_s: 2.0,
      cross_scope_exec: 'coordinator',
      cross_worker_exec: 'site_coordinator_optional',
      coordinator_min_priority: 1000
    }, isPlainObject(source.runtime) ? source.runtime : {}),
    safety: Object.assign({
      max_output_delta_per_step: 2.0,
      on_missing_sensor: { value_id: 2 },
      on_invalid_pid: { value_id: 2 }
    }, isPlainObject(source.safety) ? source.safety : {}),
    debug: Object.assign({
      control: false,
      pid: false,
      pid_state_ids: [],
      pid_interval_s: 1.0,
      pid_saturation_interval_s: 10.0,
      log: []
    }, isPlainObject(source.debug) ? source.debug : {})
  });
}

/** Bedingung auf den V9-Vertrag normieren (src/op/value + quellenspezifische Felder). */
export function createCondition(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  const src = ENUMS.rule_src.indexOf(toText(source.src)) >= 0 ? toText(source.src) : 'sensor';
  let op = toText(source.op);
  if (ENUMS.rule_op.indexOf(op) < 0) op = src === 'timer' ? 'elapsed' : '>=';

  const out = { src, op, value: normalizeConditionValue(source.value) };

  if (src === 'state') {
    out.state_id = toIntOrNull(source.state_id) || 1;
    out.field = toText(source.field) || 'value_id';
  } else if (src === 'sensor') {
    const sensorId = toIntOrNull(source.sensor_id) || 1;
    out.sensor_id = sensorId;
    out.controller_uuid = toText(source.controller_uuid)
      || findOwnerUuid(context.sensorsByUuid || new Map(), sensorId);
    const filterId = toIntOrNull(source.filter_id);
    if (filterId !== null && filterId >= 1) out.filter_id = filterId;
  } else {
    out.timer_id = toIntOrNull(source.timer_id) || 1;
    if (op !== 'elapsed' && op !== 'fired') out.op = 'elapsed';
  }

  const cooldown = toNumberOrNull(source.cooldown_s);
  if (cooldown !== null && cooldown >= 0) out.cooldown_s = cooldown;
  return out;
}

/** V9 erlaubt als Vergleichswert nur number | bool | {param_of_state,key,scale}. */
export function normalizeConditionValue(value) {
  if (typeof value === 'boolean') return value;
  if (isPlainObject(value)) {
    const stateId = toIntOrNull(value.param_of_state);
    const key = toText(value.key);
    if (stateId !== null && stateId >= 1 && key) {
      const out = { param_of_state: stateId, key };
      const scale = toNumberOrNull(value.scale);
      if (scale !== null) out.scale = scale;
      return out;
    }
    return 0;
  }
  const numeric = toNumberOrNull(value);
  return numeric === null ? 0 : numeric;
}

/** Aktion auf genau einen V9-Handler normieren (state_ids | p_ids | notify). */
export function createAction(patch) {
  const source = isPlainObject(patch) ? patch : {};

  const notify = toText(source.notify);
  if (notify && !source.state_ids && !source.p_ids) return { notify };

  const stateIds = uniqInts(source.state_ids);
  if (stateIds.length) {
    const out = { state_ids: stateIds };
    applyActionPayload(out, source);
    return out;
  }
  const processIds = uniqInts(source.p_ids);
  if (processIds.length) {
    const out = { p_ids: processIds };
    applyActionPayload(out, source);
    return out;
  }
  if (notify) return { notify };
  return { state_ids: [1], value_id: 1 };
}

function applyActionPayload(target, source) {
  const valueId = toIntOrNull(source.value_id);
  if (valueId !== null && valueId >= 1) target.value_id = valueId;
  if (isPlainObject(source.parameters) && Object.keys(source.parameters).length) {
    const parameters = {};
    Object.keys(source.parameters).forEach(function (key) {
      const value = source.parameters[key];
      if (typeof value === 'boolean' || typeof value === 'number') parameters[key] = value;
      else parameters[key] = toText(value);
    });
    target.parameters = parameters;
  }
}

/** Regel inkl. vollständiger V9-Execution-Metadaten. */
export function createRule(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  const nodeId = toText(source.owner_node_id) || context.nodeId || DEFAULT_NODE_ID;
  const ruleId = toIntOrNull(source.rule_id) || 1;
  const enabled = source.enabled === undefined ? true : toBool(source.enabled, true);

  const when = ensureArray(source.when).map(function (item) {
    return createCondition(item, context);
  });
  const actions = ensureArray(source.do).map(createAction);

  const out = createEntity('rules', {
    rule_id: ruleId,
    engine_id: toIntOrNull(source.engine_id) || 1,
    owner_node_id: nodeId,
    execution_owner: toText(source.execution_owner) || nodeId,
    execution_scope: toText(source.execution_scope)
      || executionScopeForStatus(toText(source.deployment_status), nodeId),
    execution_epoch: toIntOrNull(source.execution_epoch) === null
      ? (enabled ? 1 : 0) : toIntOrNull(source.execution_epoch),
    deployment_status: ENUMS.deployment_status.indexOf(toText(source.deployment_status)) >= 0
      ? toText(source.deployment_status)
      : (enabled ? 'active_node' : 'disabled_with_reason'),
    activation_state: ENUMS.activation_state.indexOf(toText(source.activation_state)) >= 0
      ? toText(source.activation_state)
      : (enabled ? 'active' : 'inactive'),
    group: ENUMS.rule_group.indexOf(toText(source.group)) >= 0 ? toText(source.group) : 'process',
    priority: toIntOrNull(source.priority) === null ? 100 : toIntOrNull(source.priority),
    name: toText(source.name) || 'rule_' + ruleId,
    enabled,
    when: when.length ? when : [createCondition({}, context)],
    do: actions.length ? actions : [createAction({})]
  });

  const until = ensureArray(source.until).map(function (item) {
    return createCondition(item, context);
  });
  if (until.length) out.until = until;

  const elseActions = ensureArray(source.else_do).map(createAction);
  if (elseActions.length) out.else_do = elseActions;

  if (ENUMS.latch.indexOf(toText(source.latch)) >= 0) out.latch = toText(source.latch);
  if (out.deployment_status === 'disabled_with_reason') {
    out.disabled_reason = toText(source.disabled_reason) || 'Im Editor deaktiviert';
  }
  if (toText(source.description)) out.description = toText(source.description);
  return out;
}

/* -------------------------------------------------------------------------
 * Weitere Factories
 * ---------------------------------------------------------------------- */

export function createFilterStep(patch) {
  const source = isPlainObject(patch) ? patch : {};
  const type = toText(source.type) || 'median';
  const out = { type };
  const numericFields = { window: toIntOrNull, alpha: toNumberOrNull, period_s: toNumberOrNull };
  Object.keys(numericFields).forEach(function (key) {
    if (source[key] === undefined || source[key] === null) return;
    const value = numericFields[key](source[key]);
    if (value !== null) out[key] = value;
  });
  if (out.window === undefined && (type === 'median' || type === 'moving_average')) out.window = 5;
  if (out.alpha === undefined && type === 'lowpass') out.alpha = 0.2;
  if (out.alpha === undefined && type === 'highpass') out.alpha = 0.05;
  if (out.period_s === undefined && type === 'sampler') out.period_s = 1.0;
  return out;
}

export function createFilter(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  const refs = createIoRefs({ sensors: source.sensor_refs || source.sensor_ids }, context).sensors;
  const chain = ensureArray(source.chain).map(createFilterStep);
  return createEntity('filters', {
    filter_id: toIntOrNull(source.filter_id) || 1,
    sensor_refs: refs,
    chain: chain.length ? chain : [createFilterStep({ type: 'median', window: 5 })]
  });
}

export function createTimer(patch) {
  const source = isPlainObject(patch) ? patch : {};
  const out = { timer_id: toIntOrNull(source.timer_id) || 1 };
  const duration = toNumberOrNull(source.duration_s !== undefined ? source.duration_s : source.duration);
  if (duration !== null && duration >= 0) out.duration_s = duration;
  let interval = toNumberOrNull(source.interval_s);
  if (interval === null) {
    const frequency = toNumberOrNull(source.frequency);
    if (frequency !== null && frequency > 0) interval = Math.round((60 / frequency) * 1e4) / 1e4;
  }
  if (interval !== null && interval >= 0) out.interval_s = interval;
  if (toText(source.at)) out.at = toText(source.at);
  if (toText(source.cron)) out.cron = toText(source.cron);
  out.description = toText(source.description);
  if (out.duration_s === undefined && out.interval_s === undefined
      && out.at === undefined && out.cron === undefined) {
    out.duration_s = 0;
  }
  return out;
}

export function createParameterTemplate(patch) {
  const source = isPlainObject(patch) ? patch : {};
  const stateType = toText(source.state_type) || 'generic';
  const row = createEntity('parameter_generic_templates', {
    schema_id: toIntOrNull(source.schema_id) || 1,
    state_type: stateType,
    description: toText(source.description) || stateType
  });
  // Additiv aus dem V50-Vertrag übernommen — nur wenn wirklich belegt, damit
  // eine Runtime-Config nicht mit zwei leeren Listen je Zeile aufgebläht wird.
  const fields = ensureArray(source.fields);
  const constraints = ensureArray(source.constraints);
  if (fields.length) row.fields = deepClone(fields);
  if (constraints.length) row.constraints = deepClone(constraints);
  return row;
}

export function createSchemaMapping(patch) {
  const source = isPlainObject(patch) ? patch : {};
  return createEntity('schema_mappings', {
    mapping_id: toIntOrNull(source.mapping_id) || 100,
    schema_id: toIntOrNull(source.schema_id) || 1
  });
}

export function createPidConfig(patch) {
  const source = isPlainObject(patch) ? patch : {};
  const raw = isPlainObject(source.pid_parameters) ? source.pid_parameters : {};
  const parameters = {};
  ['kp', 'ki', 'kd'].forEach(function (key) {
    const value = toNumberOrNull(raw[key]);
    parameters[key] = value === null ? (key === 'kp' ? 1.0 : 0.0) : value;
  });
  return createEntity('pid_configs', {
    pid_config_id: toIntOrNull(source.pid_config_id) || 1,
    pid_parameters: parameters
  });
}

export function createControlMethod(patch) {
  const source = isPlainObject(patch) ? patch : {};
  const args = {};
  const raw = isPlainObject(source.args) ? source.args : {};
  Object.keys(raw).forEach(function (key) {
    const value = toNumberOrNull(raw[key]);
    if (value !== null) args[key] = value;
  });
  return createEntity('control_methods', {
    method_id: toIntOrNull(source.method_id) || 1,
    template_id: toIntOrNull(source.template_id) || 1,
    args
  });
}

export function createScalingProfile(patch) {
  const source = isPlainObject(patch) ? patch : {};
  const profileId = toIntOrNull(source.profile_id) || 1;
  return createEntity('scaling_profiles', Object.assign({
    profile_id: profileId,
    name: 'profile_' + profileId,
    raw_min: 0, raw_max: 65535, eng_min: 0, eng_max: 100, unit: ''
  }, source));
}

/** Zentrale Dispatch-Tabelle: Sektion -> spezialisierte Factory. */
export const FACTORY_BY_SECTION = Object.freeze({
  meta: createMeta,
  sites: createSite,
  nodes: createNode,
  site_controller_map: createRoute,
  controllers: createController,
  virtual_controllers: createVirtualController,
  sensors: createSensor,
  actuators: createActuator,
  scaling_profiles: createScalingProfile,
  parameter_generic_templates: createParameterTemplate,
  schema_mappings: createSchemaMapping,
  processes: createProcess,
  process_states: createProcessState,
  pid_configs: createPidConfig,
  control_methods: createControlMethod,
  rule_engine: createRuleEngine,
  filters: createFilter,
  timers: createTimer,
  rules: createRule
});

/** Einheitlicher Einstieg: erzeugt die Zeile mit der passenden Factory. */
export function make(section, patch, ctx) {
  const factory = FACTORY_BY_SECTION[section];
  if (factory) return factory(patch, ctx);
  return createEntity(section, patch);
}

/* -------------------------------------------------------------------------
 * Transaktionale Ebene
 * ---------------------------------------------------------------------- */

/**
 * Fügt eine Entity ein und pflegt alle Derivate.
 * Liefert { config, row } — die Eingabe-Config bleibt unverändert.
 */
export function addEntity(config, section, patch) {
  const next = orderSections(deepClone(config || emptyConfig()));
  const ctx = createContext(next);
  const source = isPlainObject(patch) ? patch : {};
  const key = primaryKey(section);

  if (key && source[key] === undefined && SECTIONS[section].fields.some(function (field) {
    return field.name === key && field.type === 'int';
  })) {
    source[key] = nextIdFor(next, section);
  }
  if (section === 'controllers' && source.controller_id === undefined) {
    source.controller_id = nextNumericId(next.controllers, 'controller_id', 1);
  }

  const row = make(section, source, ctx);
  if (SECTIONS[section].kind === 'singleton') next[section] = [row];
  else next[section] = ensureArray(next[section]).concat([row]);

  reconcile(next, section);
  return { config: next, row };
}

/** Aendert eine Entity anhand ihres Primärschlüssels. */
export function updateEntity(config, section, keyValue, patch) {
  const next = orderSections(deepClone(config || emptyConfig()));
  const key = primaryKey(section);
  const ctx = createContext(next);
  let updated = null;

  next[section] = ensureArray(next[section]).map(function (row) {
    if (!key || String(row[key]) !== String(keyValue)) return row;
    updated = make(section, Object.assign({}, row, patch), ctx);
    return updated;
  });
  reconcile(next, section);
  return { config: next, row: updated };
}

/** Entfernt eine Entity und bereinigt abhängige Referenzen. */
export function removeEntity(config, section, keyValue) {
  const next = orderSections(deepClone(config || emptyConfig()));
  const key = primaryKey(section);
  if (!key) return { config: next, removed: null };

  let removed = null;
  next[section] = ensureArray(next[section]).filter(function (row) {
    if (String(row[key]) !== String(keyValue)) return true;
    removed = row;
    return false;
  });
  if (removed) cascadeRemoval(next, section, removed);
  reconcile(next, section);
  return { config: next, removed };
}

function cascadeRemoval(config, section, removed) {
  if (section === 'controllers') {
    const uuid = toText(removed.controller_uuid);
    config.site_controller_map = ensureArray(config.site_controller_map).filter(function (route) {
      return toText(route.controller_uuid) !== uuid;
    });
    config.virtual_controllers = ensureArray(config.virtual_controllers).filter(function (row) {
      return toText(row.controller_uuid) !== uuid;
    });
    ['sensors', 'actuators'].forEach(function (io) {
      config[io] = ensureArray(config[io]).filter(function (row) {
        return toText(row.controller_uuid) !== uuid;
      });
    });
  }
  if (section === 'sensors' || section === 'actuators') {
    const idField = SECTIONS[section].idField;
    const bucket = section;
    const uuid = toText(removed.controller_uuid);
    const ioId = toIntOrNull(removed[idField]);
    config.process_states = ensureArray(config.process_states).map(function (state) {
      const refs = isPlainObject(state.io_refs) ? state.io_refs : { sensors: [], actuators: [] };
      const nextRefs = Object.assign({}, refs);
      nextRefs[bucket] = ensureArray(refs[bucket]).filter(function (ref) {
        return !(toText(ref.controller_uuid) === uuid && toIntOrNull(ref[idField]) === ioId);
      });
      return Object.assign({}, state, { io_refs: nextRefs });
    });
    if (section === 'sensors') {
      config.filters = ensureArray(config.filters).map(function (filter) {
        return Object.assign({}, filter, {
          sensor_refs: ensureArray(filter.sensor_refs).filter(function (ref) {
            return !(toText(ref.controller_uuid) === uuid && toIntOrNull(ref.sensor_id) === ioId);
          })
        });
      }).filter(function (filter) { return ensureArray(filter.sensor_refs).length > 0; });
      config.rules = ensureArray(config.rules).map(function (rule) {
        return Object.assign({}, rule, {
          when: ensureArray(rule.when).filter(function (cond) {
            return !(toText(cond.src) === 'sensor'
              && toText(cond.controller_uuid) === uuid
              && toIntOrNull(cond.sensor_id) === ioId);
          })
        });
      }).filter(function (rule) { return ensureArray(rule.when).length > 0; });
    }
  }
  if (section === 'process_states') {
    const stateId = toIntOrNull(removed.state_id);
    config.rules = ensureArray(config.rules).map(function (rule) {
      return Object.assign({}, rule, {
        when: ensureArray(rule.when).filter(function (cond) {
          return !(toText(cond.src) === 'state' && toIntOrNull(cond.state_id) === stateId);
        }),
        do: stripStateId(rule.do, stateId),
        else_do: stripStateId(rule.else_do, stateId)
      });
    }).filter(function (rule) {
      return ensureArray(rule.when).length > 0 && ensureArray(rule.do).length > 0;
    });
  }
  if (section === 'processes') {
    const pId = toIntOrNull(removed.p_id);
    config.process_states = ensureArray(config.process_states).filter(function (state) {
      return toIntOrNull(state.p_id) !== pId;
    });
  }
  if (section === 'filters') {
    const filterId = toIntOrNull(removed.filter_id);
    config.rules = ensureArray(config.rules).map(function (rule) {
      return Object.assign({}, rule, {
        when: ensureArray(rule.when).map(function (cond) {
          if (toIntOrNull(cond.filter_id) !== filterId) return cond;
          const copy = Object.assign({}, cond);
          delete copy.filter_id;
          return copy;
        })
      });
    });
  }
  if (section === 'timers') {
    const timerId = toIntOrNull(removed.timer_id);
    config.rules = ensureArray(config.rules).map(function (rule) {
      return Object.assign({}, rule, {
        when: ensureArray(rule.when).filter(function (cond) {
          return !(toText(cond.src) === 'timer' && toIntOrNull(cond.timer_id) === timerId);
        })
      });
    }).filter(function (rule) { return ensureArray(rule.when).length > 0; });
  }
}

function stripStateId(actions, stateId) {
  return ensureArray(actions).map(function (action) {
    if (!Array.isArray(action.state_ids)) return action;
    const remaining = action.state_ids.filter(function (id) { return toIntOrNull(id) !== stateId; });
    return Object.assign({}, action, { state_ids: remaining });
  }).filter(function (action) {
    if (Array.isArray(action.state_ids)) return action.state_ids.length > 0;
    return true;
  });
}

/**
 * Stellt alle abgeleiteten Werte wieder her:
 * route_key, local_node, I/O-Routingmetadaten, execution_scope.
 * Idempotent — kann nach jeder Mutation aufgerufen werden.
 */
export function reconcile(config, changedSection) {
  const ctx = createContext(config);

  config.site_controller_map = ensureArray(config.site_controller_map).map(function (route) {
    const siteId = toText(route.site_id) || ctx.siteId;
    const nodeId = toText(route.node_id) || ctx.nodeId;
    const localId = toIntOrNull(route.local_controller_id) || 1;
    const controller = ctx.controllerByUuid.get(toText(route.controller_uuid));
    return Object.assign({}, route, {
      site_id: siteId,
      node_id: nodeId,
      route_key: routeKeyFor(siteId, nodeId, localId),
      controller_key: controller ? toText(controller.controller_key) : toText(route.controller_key)
    });
  });

  const refreshed = createContext(config);
  ['sensors', 'actuators'].forEach(function (section) {
    config[section] = ensureArray(config[section]).map(function (row) {
      const identity = identityForUuid(refreshed, row.controller_uuid)
        || identityFor(refreshed, row.local_controller_id, row.node_id);
      if (!identity) return row;
      return Object.assign({}, row, {
        local_controller_id: identity.local_controller_id,
        controller_uuid: identity.controller_uuid,
        controller_key: identity.controller_key,
        node_id: identity.node_id,
        site_id: identity.site_id
      });
    });
  });

  const meta = ensureArray(config.meta)[0];
  const scope = toText((meta || {}).scope);
  if (scope === 'node_local') {
    // Ein Node-Shard beschreibt genau einen Worker.
    config.local_node = [createLocalNode(config, toText(meta.node_id) || refreshed.nodeId,
      refreshed.siteId)];
  } else if (CROSS_PROFILE.scopes.indexOf(scope) >= 0) {
    // Der V8-Cross-Vertrag verlangt local_node ausdrücklich LEER.
    config.local_node = [];
  } else if (scope === 'master_global') {
    // Ein Master beschreibt ALLE Worker — je Node eine Zeile.
    config.local_node = createLocalNodes(config, refreshed.siteId);
  } else if (ensureArray(config.local_node).length) {
    const current = ensureArray(config.local_node)[0];
    config.local_node = [createLocalNode(config, toText(current.node_id) || refreshed.nodeId,
      toText(current.site_id) || refreshed.siteId)];
  }

  config.rules = ensureArray(config.rules).map(function (rule) {
    const owner = toText(rule.owner_node_id) || refreshed.nodeId;
    return Object.assign({}, rule, {
      owner_node_id: owner,
      execution_owner: toText(rule.execution_owner) || owner,
      execution_scope: toText(rule.execution_scope)
        || executionScopeForStatus(toText(rule.deployment_status), owner)
    });
  });

  return config;
}

/* =========================================================================
 * Cross-V8-Factories
 * =========================================================================
 * Der Cross-Shard trägt nur logische Identitäten. Physikfelder (bus_type,
 * host, port, unit, address, function_type) sind dort fail-closed verboten —
 * validate_cross_execution_shard() lehnt sie ab. Die folgenden Factories
 * erzeugen daher gezielt reduzierte Datensätze, statt V9-Zeilen zu kopieren
 * und hinterher zu putzen.
 * ====================================================================== */

/** Cross-Meta (version 8, scope cross, owner_node_id + domain_id Pflicht). */
export function createCrossMeta(patch) {
  const source = isPlainObject(patch) ? patch : {};
  const owner = toText(source.owner_node_id) || DEFAULT_NODE_ID;
  const scope = CROSS_PROFILE.scopes.indexOf(toText(source.scope)) >= 0
    ? toText(source.scope) : CROSS_PROFILE.defaultScope;
  return {
    version: CROSS_VERSION,
    schema: CANONICAL_SCHEMA,
    scope,
    owner_node_id: owner,
    domain_id: toText(source.domain_id) || ('cross-' + owner + '-default'),
    description: toText(source.description)
      || ('V8 Cross-Execution-Shard für ' + owner + '. Kanonisch flach, ausschließlich '
        + 'logische Identitäten (controller_uuid plus lokale I/O-ID), keine physischen '
        + 'Endpunkte oder Feldbus-Koordinaten.')
  };
}

/** Controller-Stub ohne jedes Physikfeld. */
export function createCrossController(patch, ctx) {
  const context = ctx || {};
  const source = isPlainObject(patch) ? patch : {};
  return {
    controller_id: toIntOrNull(source.controller_id) || 1,
    owner_node_id: toText(source.owner_node_id) || context.nodeId || DEFAULT_NODE_ID,
    controller_uuid: toText(source.controller_uuid),
    controller_key: toText(source.controller_key)
  };
}

/** Logische I/O-Zeile ohne Adresse, Bus und Funktion. */
export function createCrossIoRow(section, patch) {
  const spec = SECTIONS[section];
  if (!spec || spec.kind !== 'io') throw new Error('Keine I/O-Sektion: ' + section);
  const source = isPlainObject(patch) ? patch : {};
  const row = {
    local_controller_id: toIntOrNull(source.local_controller_id) || 1,
    node_id: toText(source.node_id),
    controller_uuid: toText(source.controller_uuid),
    controller_key: toText(source.controller_key),
    enabled: source.enabled === undefined ? true : toBool(source.enabled, true)
  };
  row[spec.idField] = toIntOrNull(source[spec.idField]) || 1;
  row[spec.groupField] = toText(source[spec.groupField])
    || (section === 'sensors' ? 'S1' : 'A');
  return row;
}

export function createCrossSensor(patch) { return createCrossIoRow('sensors', patch); }
export function createCrossActuator(patch) { return createCrossIoRow('actuators', patch); }

/** Cross-Route: wie V9, aber site_id ist optional. */
export function createCrossRoute(patch) {
  const source = isPlainObject(patch) ? patch : {};
  const nodeId = toText(source.node_id) || DEFAULT_NODE_ID;
  const localId = toIntOrNull(source.local_controller_id) || 1;
  const siteId = toText(source.site_id);
  const out = {
    local_controller_id: localId,
    node_id: nodeId,
    controller_uuid: toText(source.controller_uuid),
    controller_key: toText(source.controller_key),
    route_key: toText(source.route_key) || routeKeyFor(siteId, nodeId, localId),
    routing_role: toText(source.routing_role) || 'owner',
    enabled: source.enabled === undefined ? true : toBool(source.enabled, true)
  };
  if (siteId) out.site_id = siteId;
  return out;
}

/**
 * Cross-Regel: identisch zu V9, aber ohne die fünf Execution-Metadatenfelder.
 * Der Cross-Vertrag verlangt sie nicht — und `validate_cross_execution_shard`
 * leitet den Owner aus `owner_node_id` bzw. dem UUID-Graphen ab.
 */
export function createCrossRule(patch, ctx) {
  const rule = createRule(patch, ctx);
  const out = {};
  ['rule_id', 'engine_id', 'owner_node_id', 'group', 'priority', 'name', 'enabled',
    'when', 'until', 'do', 'else_do', 'latch', 'description'].forEach(function (name) {
    if (rule[name] !== undefined) out[name] = rule[name];
  });
  return out;
}

/** Cross-Prozess: wie V9 (owner_node_id ist dort ohnehin Pflicht). */
export function createCrossProcess(patch, ctx) {
  return createProcess(patch, ctx);
}

/** Dispatch-Tabelle des Cross-Profils. */
export const CROSS_FACTORY_BY_SECTION = Object.freeze({
  meta: createCrossMeta,
  controllers: createCrossController,
  site_controller_map: createCrossRoute,
  sensors: createCrossSensor,
  actuators: createCrossActuator,
  processes: createCrossProcess,
  rules: createCrossRule
});

/**
 * Profilbewusster Einstieg: erzeugt die Zeile mit der Factory des Profils.
 * profile: 'node' (V9, Default) | 'cross' (V8)
 */
export function makeFor(profile, section, patch, ctx) {
  if (profile === 'cross') {
    const factory = CROSS_FACTORY_BY_SECTION[section];
    if (factory) return factory(patch, ctx);
  }
  return make(section, patch, ctx);
}

/**
 * Entfernt aus einer beliebigen Config alle im Cross-Shard verbotenen Felder.
 * Idempotent — der Kern der 100-%-Kompatibilität: eine V9-Zeile wird damit
 * garantiert zu einer vertragskonformen V8-Cross-Zeile.
 */
export function stripPhysicalFields(config) {
  const next = deepClone(config || {});

  next.controllers = ensureArray(next.controllers).map(function (row) {
    const out = {};
    CROSS_PROFILE.controllerFields.forEach(function (name) {
      if (row[name] !== undefined) out[name] = row[name];
    });
    return out;
  });

  [['sensors', CROSS_PROFILE.sensorFields], ['actuators', CROSS_PROFILE.actuatorFields]]
    .forEach(function (entry) {
      next[entry[0]] = ensureArray(next[entry[0]]).map(function (row) {
        const out = {};
        entry[1].forEach(function (name) {
          if (row[name] !== undefined) out[name] = row[name];
        });
        return out;
      });
    });

  next.virtual_controllers = ensureArray(next.virtual_controllers).map(function (row) {
    return Object.assign({}, row, { virt_active: false });
  });

  next.site_controller_map = ensureArray(next.site_controller_map).map(function (row) {
    return createCrossRoute(row);
  });

  next.local_node = [];
  return next;
}

/* -------------------------------------------------------------------------
 * Neuanlage einer vollständigen Config
 * ---------------------------------------------------------------------- */

/**
 * Erzeugt eine minimale, kontraktkonforme V9-Config von Null.
 * Ergebnis besteht verify_storage_config_data() ohne weitere Eingriffe.
 */
export function createEmptyV9Config(options) {
  const opts = isPlainObject(options) ? options : {};
  const siteId = toText(opts.site_id) || DEFAULT_SITE_ID;
  const nodeId = toText(opts.node_id) || DEFAULT_NODE_ID;
  const scope = toText(opts.scope) || 'node_local';
  const deviceName = toText(opts.device_name) || 'controller_1';

  const config = emptyConfig();
  config.meta = [createMeta({ scope, node_id: nodeId, description: opts.description })];
  config.sites = [createSite({ site_id: siteId })];
  config.nodes = [createNode({ node_id: nodeId, site_id: siteId }, { siteId })];

  const ctx = { siteId, nodeId, controllerByLocalId: new Map(), controllerByUuid: new Map() };
  const controller = createController({ controller_id: 1, device_name: deviceName,
    host: toText(opts.host) || UNCONFIGURED_HOST }, ctx);
  config.controllers = [controller];
  config.site_controller_map = [createRoute({
    local_controller_id: 1,
    node_id: nodeId,
    site_id: siteId,
    controller_uuid: controller.controller_uuid,
    controller_key: controller.controller_key
  }, ctx)];
  config.local_node = [createLocalNode(config, nodeId, siteId)];

  config.process_values = [
    { value_id: 1, state_value: 'activated' },
    { value_id: 2, state_value: 'deactivated' },
    { value_id: 3, state_value: 'error' },
    { value_id: 4, state_value: 'maintenance' }
  ];
  config.process_modes = [
    { mode_id: 1, mode: 'manual' },
    { mode_id: 2, mode: 'automatic' },
    { mode_id: 3, mode: 'AI' }
  ];
  config.parameter_generic_templates = [createParameterTemplate({
    schema_id: 1, state_type: 'generic', description: 'Generischer Zustand'
  })];
  config.schema_mappings = [createSchemaMapping({ mapping_id: 100, schema_id: 1 })];
  config.pid_configs = [createPidConfig({ pid_config_id: 1,
    pid_parameters: { kp: 1.0, ki: 0.0, kd: 0.0 } })];
  config.processes = [createProcess({ p_id: 1, process_name: 'process_1' }, { nodeId })];
  config.process_states = [createProcessState({
    state_id: 1, p_id: 1, value_id: 2, mode_id: 2, mapping_id: 100
  }, createContext(config))];
  config.rule_engine = [createRuleEngine({}, createContext(config))];

  return orderSections(config);
}
