/**
 * v9_shard.js — Scope-Klassifikation und Node-Shard-Projektion.
 *
 * Bildet die Logik aus
 * `config_sharding_contracts._shard__scope_for_controllers()` (:955-974) und
 * `shard_materializer` des Master-Nodes nach:
 *
 *   1 controller_uuid                 -> local_controller
 *   n uuids, 1 owner-node             -> cross_controller
 *   n uuids, m owner-nodes            -> cross_worker
 *   keine uuid                        -> unbound
 *   uuid ohne eindeutigen Owner       -> invalid
 *
 * Damit zeigt der Editor bereits vor dem Rollout, welche States und Regeln
 * node-lokal ausführbar sind und welche einen Coordinator brauchen — und
 * warnt, wenn eine kritische Regelgruppe cross laufen würde (im Worker ein
 * fail-closed-Abbruch).
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

import {
  CRITICAL_GROUPS, CROSS_PROFILE, executionScopeFor, orderSections
} from './v9_schema.js';
import {
  createCrossMeta, createCrossController, createCrossRoute, createCrossRule,
  stripPhysicalFields
} from './v9_factory.js';
import { isCriticalRule, mutatedStateIds } from './v9_validate.js';
import {
  deepClone, ensureArray, isPlainObject, toText, toIntOrNull, indexBy
} from './shared_utils.js';

/** Owner-Node je controller_uuid (aus den aktivierten owner-Routen). */
export function ownerIndex(config) {
  const owners = new Map();
  ensureArray((config || {}).site_controller_map).forEach(function (route) {
    if (toText(route.routing_role) !== 'owner' || route.enabled === false) return;
    const uuid = toText(route.controller_uuid);
    if (!owners.has(uuid)) owners.set(uuid, new Set());
    owners.get(uuid).add(toText(route.node_id));
  });
  return owners;
}

/** Klassifiziert eine Menge von controller_uuids. */
export function scopeForControllers(uuids, owners) {
  const list = Array.from(new Set(ensureArray(uuids).map(toText).filter(Boolean)));
  if (!list.length) return 'unbound';
  const nodes = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const set = owners.get(list[i]);
    if (!set || set.size !== 1) return 'invalid';
    nodes.add(Array.from(set)[0]);
  }
  if (list.length === 1) return 'local_controller';
  return nodes.size === 1 ? 'cross_controller' : 'cross_worker';
}

/** Alle controller_uuids, die ein Prozess-State berührt. */
export function stateControllerUuids(state) {
  const refs = isPlainObject(state) && isPlainObject(state.io_refs) ? state.io_refs : {};
  const out = [];
  ['sensors', 'actuators'].forEach(function (bucket) {
    ensureArray(refs[bucket]).forEach(function (ref) {
      const uuid = toText(ref.controller_uuid);
      if (uuid) out.push(uuid);
    });
  });
  if (isPlainObject(state.setpoint_source)) {
    collectUuids(state.setpoint_source, out);
  }
  return out;
}

function collectUuids(node, sink) {
  if (Array.isArray(node)) {
    node.forEach(function (item) { collectUuids(item, sink); });
    return;
  }
  if (!isPlainObject(node)) return;
  Object.keys(node).forEach(function (key) {
    if (key === 'controller_uuid' && toText(node[key])) sink.push(toText(node[key]));
    else collectUuids(node[key], sink);
  });
}

/** Alle controller_uuids, die eine Regel transitiv berührt. */
export function ruleControllerUuids(rule, statesById) {
  const out = [];
  ['when', 'until'].forEach(function (bucket) {
    ensureArray((rule || {})[bucket]).forEach(function (cond) {
      const uuid = toText(cond.controller_uuid);
      if (uuid) out.push(uuid);
      if (isPlainObject(cond.value) && toIntOrNull(cond.value.param_of_state) !== null) {
        pushStateUuids(statesById, cond.value.param_of_state, out);
      }
      if (toText(cond.src) === 'state') pushStateUuids(statesById, cond.state_id, out);
    });
  });
  ['do', 'else_do'].forEach(function (bucket) {
    ensureArray((rule || {})[bucket]).forEach(function (action) {
      ensureArray(action.state_ids).forEach(function (stateId) {
        pushStateUuids(statesById, stateId, out);
      });
    });
  });
  return out;
}

function pushStateUuids(statesById, stateId, sink) {
  const state = statesById.get(toIntOrNull(stateId));
  if (!state) return;
  stateControllerUuids(state).forEach(function (uuid) { sink.push(uuid); });
}

/**
 * Klassifiziert alle States und Regeln.
 * Rückgabe: { states: Map<state_id, scope>, rules: Map<rule_id, scope>, issues: [] }
 */
export function classifyScopes(config) {
  const cfg = isPlainObject(config) ? config : {};
  const owners = ownerIndex(cfg);
  const statesById = indexBy(cfg.process_states, 'state_id');
  const states = new Map();
  const rules = new Map();
  const ruleNodes = new Map();
  const issues = [];

  ensureArray(cfg.process_states).forEach(function (state) {
    const scope = scopeForControllers(stateControllerUuids(state), owners);
    states.set(toIntOrNull(state.state_id), scope);
    if (scope === 'invalid') {
      issues.push({
        kind: 'error',
        path: 'process_states.state_id=' + toIntOrNull(state.state_id),
        message: 'State berührt einen controller_uuid ohne eindeutige owner-Route.'
      });
    }
  });

  ensureArray(cfg.rules).forEach(function (rule) {
    const uuids = ruleControllerUuids(rule, statesById);
    const scope = scopeForControllers(uuids, owners);
    const ruleId = toIntOrNull(rule.rule_id);
    rules.set(ruleId, scope);
    // Owner-Nodes der berührten Controller — Basis der Cross-Owner-Ableitung.
    const nodes = [];
    Array.from(new Set(uuids.map(toText).filter(Boolean))).forEach(function (uuid) {
      const set = owners.get(uuid);
      if (!set || set.size !== 1) return;
      const nodeId = Array.from(set)[0];
      if (nodes.indexOf(nodeId) < 0) nodes.push(nodeId);
    });
    ruleNodes.set(ruleId, nodes.sort());
    if (scope === 'invalid') {
      issues.push({
        kind: 'error', path: 'rules.rule_id=' + ruleId,
        message: 'Regel berührt einen controller_uuid ohne eindeutige owner-Route.'
      });
    }
    if (scope === 'unbound') {
      issues.push({
        kind: 'warning', path: 'rules.rule_id=' + ruleId,
        message: 'Regel ist an keinen Controller gebunden (unbound) und damit nicht ausführbar.'
      });
    }
    if (CRITICAL_GROUPS.indexOf(toText(rule.group)) >= 0
        && (scope === 'cross_controller' || scope === 'cross_worker')) {
      issues.push({
        kind: 'error', path: 'rules.rule_id=' + ruleId,
        message: 'Kritische Regelgruppe "' + toText(rule.group) + '" darf nicht cross ausgeführt '
          + 'werden (validate_scope_partition lehnt das fail-closed ab).'
      });
    }
    if (scope === 'cross_worker' && toText(rule.deployment_status) === 'active_node') {
      issues.push({
        kind: 'warning', path: 'rules.rule_id=' + ruleId,
        message: 'Regel ist cross_worker, trägt aber deployment_status "active_node" — '
          + 'erwartet wird "active_cross".'
      });
    }
  });

  return { states, rules, ruleNodes, issues, owners };
}

/** Nodes, die in der Config eine aktivierte owner-Route besitzen. */
export function listNodes(config) {
  const out = [];
  ensureArray((config || {}).nodes).forEach(function (node) {
    out.push(toText(node.node_id));
  });
  ensureArray((config || {}).site_controller_map).forEach(function (route) {
    const nodeId = toText(route.node_id);
    if (nodeId && out.indexOf(nodeId) < 0) out.push(nodeId);
  });
  return out.filter(Boolean);
}

/**
 * Projiziert eine (master_global-)Config auf den node_local-Shard eines Nodes.
 * Alles, was nicht zu diesem Node gehört, wird entfernt; Stammdaten bleiben.
 */
export function projectNodeShard(config, nodeId, options) {
  const cfg = isPlainObject(config) ? config : {};
  const opts = isPlainObject(options) ? options : {};
  const target = toText(nodeId);
  const shard = orderSections(deepClone(cfg));
  // Beim Rollout-Split müssen Local- und Cross-Regelmengen disjunkt sein
  // (validate_split_shards). Cross-scoped Regeln gehören dann ausschließlich
  // in den V8-Cross-Shard.
  const excluded = opts.excludeRuleIds instanceof Set ? opts.excludeRuleIds : null;

  const meta = ensureArray(shard.meta)[0] || {};
  shard.meta = [Object.assign({}, meta, {
    scope: 'node_local',
    node_id: target,
    description: toText(meta.description) || ('Node-Shard ' + target)
  })];
  delete shard.meta[0].owner_node_id;
  delete shard.meta[0].domain_id;
  delete shard.meta[0].cross_domain_id;

  shard.nodes = ensureArray(cfg.nodes).filter(function (node) {
    return toText(node.node_id) === target;
  });
  shard.site_controller_map = ensureArray(cfg.site_controller_map).filter(function (route) {
    return toText(route.node_id) === target;
  });

  const ownUuids = new Set(shard.site_controller_map
    .map(function (route) { return toText(route.controller_uuid); }));

  shard.controllers = ensureArray(cfg.controllers).filter(function (row) {
    return ownUuids.has(toText(row.controller_uuid));
  });
  shard.virtual_controllers = ensureArray(cfg.virtual_controllers).filter(function (row) {
    return ownUuids.has(toText(row.controller_uuid));
  });
  ['sensors', 'actuators'].forEach(function (section) {
    shard[section] = ensureArray(cfg[section]).filter(function (row) {
      return ownUuids.has(toText(row.controller_uuid));
    });
  });

  const siteIds = new Set(shard.site_controller_map
    .map(function (route) { return toText(route.site_id); }));
  shard.sites = ensureArray(cfg.sites).filter(function (site) {
    return !siteIds.size || siteIds.has(toText(site.site_id));
  });
  if (!shard.sites.length) shard.sites = ensureArray(cfg.sites).slice(0, 1);

  shard.processes = ensureArray(cfg.processes).filter(function (row) {
    return toText(row.owner_node_id) === target;
  });
  const processIds = new Set(shard.processes.map(function (row) { return toIntOrNull(row.p_id); }));

  shard.process_states = ensureArray(cfg.process_states).filter(function (state) {
    if (!processIds.has(toIntOrNull(state.p_id))) return false;
    const uuids = stateControllerUuids(state);
    return uuids.length === 0 || uuids.every(function (uuid) { return ownUuids.has(uuid); });
  });
  const stateIds = new Set(shard.process_states
    .map(function (row) { return toIntOrNull(row.state_id); }));

  shard.filters = ensureArray(cfg.filters).map(function (filter) {
    return Object.assign({}, filter, {
      sensor_refs: ensureArray(filter.sensor_refs).filter(function (ref) {
        return ownUuids.has(toText(ref.controller_uuid));
      })
    });
  }).filter(function (filter) { return filter.sensor_refs.length > 0; });
  const filterIds = new Set(shard.filters.map(function (row) { return toIntOrNull(row.filter_id); }));

  shard.rules = ensureArray(cfg.rules).filter(function (rule) {
    if (toText(rule.owner_node_id) !== target) return false;
    if (excluded && excluded.has(toIntOrNull(rule.rule_id))) return false;
    const conditionsOk = ['when', 'until'].every(function (bucket) {
      return ensureArray(rule[bucket]).every(function (cond) {
        if (toText(cond.src) === 'sensor' && !ownUuids.has(toText(cond.controller_uuid))) return false;
        if (toText(cond.src) === 'state' && !stateIds.has(toIntOrNull(cond.state_id))) return false;
        if (cond.filter_id !== undefined && !filterIds.has(toIntOrNull(cond.filter_id))) return false;
        return true;
      });
    });
    if (!conditionsOk) return false;
    return ['do', 'else_do'].every(function (bucket) {
      return ensureArray(rule[bucket]).every(function (action) {
        return ensureArray(action.state_ids).every(function (id) {
          return stateIds.has(toIntOrNull(id));
        }) && ensureArray(action.p_ids).every(function (id) {
          return processIds.has(toIntOrNull(id));
        });
      });
    });
  }).map(function (rule) {
    return Object.assign({}, rule, {
      owner_node_id: target,
      execution_owner: target,
      execution_scope: executionScopeFor(target)
    });
  });

  const routes = shard.site_controller_map.filter(function (route) {
    return toText(route.routing_role) === 'owner' && route.enabled !== false;
  }).slice().sort(function (a, b) {
    return (toIntOrNull(a.local_controller_id) || 0) - (toIntOrNull(b.local_controller_id) || 0);
  });
  shard.local_node = [{
    node_id: target,
    site_id: toText((routes[0] || {}).site_id) || toText((shard.sites[0] || {}).site_id),
    active_controller_uuids: routes.map(function (r) { return toText(r.controller_uuid); }),
    active_controller_routes: routes.map(function (r) {
      return {
        local_controller_id: toIntOrNull(r.local_controller_id),
        controller_uuid: toText(r.controller_uuid),
        controller_key: toText(r.controller_key)
      };
    })
  }];

  return shard;
}

/** Alle Node-Shards auf einmal. */
export function projectAllShards(config) {
  const out = new Map();
  listNodes(config).forEach(function (nodeId) {
    out.set(nodeId, projectNodeShard(config, nodeId));
  });
  return out;
}

/* =========================================================================
 * Cross-V8-Shards
 * ====================================================================== */

/**
 * Projiziert die Cross-Regeln eines Owners in einen V8-Cross-Shard.
 *
 * Enthalten sind ausschließlich Regeln mit Scope cross_controller oder
 * cross_worker, deren Owner `ownerNodeId` ist. Alle Physikfelder werden
 * entfernt (stripPhysicalFields), `local_node` bleibt leer — beides ist
 * fail-closed-Bedingung von validate_cross_execution_shard().
 *
 * `sites` wird bewusst mitgeführt: die Entity-Registry (decompose) verlangt
 * die vollständige Sektionsmenge, die ausgelieferte Runtime-Baseline lässt
 * sie nur weg. Mit `options.omitSites` lässt sich das Baseline-Verhalten
 * exakt nachbilden.
 */
export function projectCrossShard(config, ownerNodeId, options) {
  const cfg = isPlainObject(config) ? config : {};
  const opts = isPlainObject(options) ? options : {};
  const owner = toText(ownerNodeId);
  const scopes = opts.scopes || classifyScopes(cfg);
  const statesById = indexBy(cfg.process_states, 'state_id');

  const rules = ensureArray(cfg.rules).filter(function (rule) {
    if (!crossEligibility(cfg, rule, scopes).ok) return false;
    return ruleOwnerFor(rule, toIntOrNull(rule.rule_id), scopes) === owner;
  });

  const shard = orderSections(deepClone(cfg));

  shard.meta = [createCrossMeta({
    owner_node_id: owner,
    scope: opts.scope || CROSS_PROFILE.defaultScope,
    domain_id: opts.domain_id
  })];
  shard.local_node = [];

  // States: alles, was die Cross-Regeln berühren, plus alle cross-scoped States
  const referenced = new Set();
  rules.forEach(function (rule) {
    ruleStateIds(rule, statesById).forEach(function (stateId) { referenced.add(stateId); });
  });
  ensureArray(cfg.process_states).forEach(function (state) {
    const stateId = toIntOrNull(state.state_id);
    if (CROSS_PROFILE.ruleScopes.indexOf(scopes.states.get(stateId)) >= 0) {
      referenced.add(stateId);
    }
  });
  shard.process_states = ensureArray(cfg.process_states).filter(function (state) {
    return referenced.has(toIntOrNull(state.state_id));
  });

  const processIds = new Set(shard.process_states
    .map(function (state) { return toIntOrNull(state.p_id); }));
  shard.processes = ensureArray(cfg.processes)
    .filter(function (row) { return processIds.has(toIntOrNull(row.p_id)); })
    .map(function (row) { return Object.assign({}, row, { owner_node_id: owner }); });

  // I/O: nur die von den States und Regeln berührten Identitätspaare
  const usedSensors = new Set();
  const usedActuators = new Set();
  shard.process_states.forEach(function (state) {
    const refs = isPlainObject(state.io_refs) ? state.io_refs : {};
    ensureArray(refs.sensors).forEach(function (ref) {
      usedSensors.add(toText(ref.controller_uuid) + ':' + toIntOrNull(ref.sensor_id));
    });
    ensureArray(refs.actuators).forEach(function (ref) {
      usedActuators.add(toText(ref.controller_uuid) + ':' + toIntOrNull(ref.actuator_id));
    });
  });
  rules.forEach(function (rule) {
    ['when', 'until'].forEach(function (bucket) {
      ensureArray(rule[bucket]).forEach(function (cond) {
        if (toText(cond.src) === 'sensor') {
          usedSensors.add(toText(cond.controller_uuid) + ':' + toIntOrNull(cond.sensor_id));
        }
      });
    });
  });

  shard.sensors = ensureArray(cfg.sensors).filter(function (row) {
    return usedSensors.has(toText(row.controller_uuid) + ':' + toIntOrNull(row.sensor_id));
  });
  shard.actuators = ensureArray(cfg.actuators).filter(function (row) {
    return usedActuators.has(toText(row.controller_uuid) + ':' + toIntOrNull(row.actuator_id));
  });

  // Controller-Stubs: alle berührten UUIDs
  const usedUuids = new Set();
  shard.sensors.concat(shard.actuators).forEach(function (row) {
    usedUuids.add(toText(row.controller_uuid));
  });
  shard.controllers = ensureArray(cfg.controllers)
    .filter(function (row) { return usedUuids.has(toText(row.controller_uuid)); })
    .map(function (row) {
      return createCrossController({
        controller_id: row.controller_id,
        controller_uuid: row.controller_uuid,
        controller_key: row.controller_key,
        owner_node_id: ownerOfUuid(cfg, row.controller_uuid) || owner
      });
    });
  shard.virtual_controllers = [];

  // Im Cross-Shard entfällt site_id — und damit auch im route_key. Nodes und
  // Routen müssen dieselbe Identitätsachse nutzen, sonst schlägt die
  // Referenzprüfung (site_id, node_id) -> nodes fehl.
  shard.site_controller_map = ensureArray(cfg.site_controller_map)
    .filter(function (route) { return usedUuids.has(toText(route.controller_uuid)); })
    .map(function (route) {
      const stripped = Object.assign({}, route);
      delete stripped.site_id;
      delete stripped.route_key;
      return createCrossRoute(stripped);
    });

  const nodeIds = new Set(shard.site_controller_map
    .map(function (route) { return toText(route.node_id); }));
  nodeIds.add(owner);
  shard.nodes = ensureArray(cfg.nodes)
    .filter(function (row) { return nodeIds.has(toText(row.node_id)); })
    .map(function (row) {
      const out = Object.assign({}, row);
      delete out.site_id;
      return out;
    });

  // Filter: nur solche, deren Sensoren im Shard liegen
  shard.filters = ensureArray(cfg.filters).map(function (filter) {
    return Object.assign({}, filter, {
      sensor_refs: ensureArray(filter.sensor_refs).filter(function (ref) {
        return usedSensors.has(toText(ref.controller_uuid) + ':' + toIntOrNull(ref.sensor_id));
      })
    });
  }).filter(function (filter) { return filter.sensor_refs.length > 0; });
  const filterIds = new Set(shard.filters
    .map(function (row) { return toIntOrNull(row.filter_id); }));

  shard.rules = rules.map(function (rule) {
    const copy = createCrossRule(Object.assign({}, rule, { owner_node_id: owner }),
      { nodeId: owner });
    copy.when = ensureArray(copy.when).map(function (cond) {
      if (cond.filter_id === undefined || filterIds.has(toIntOrNull(cond.filter_id))) return cond;
      const trimmed = Object.assign({}, cond);
      delete trimmed.filter_id;
      return trimmed;
    });
    return copy;
  });

  const timerIds = new Set();
  shard.rules.forEach(function (rule) {
    ['when', 'until'].forEach(function (bucket) {
      ensureArray(rule[bucket]).forEach(function (cond) {
        if (toText(cond.src) === 'timer') timerIds.add(toIntOrNull(cond.timer_id));
      });
    });
  });
  shard.timers = ensureArray(cfg.timers).filter(function (row) {
    return timerIds.has(toIntOrNull(row.timer_id));
  });

  if (opts.omitSites) delete shard.sites;

  return orderSections(stripPhysicalFields(shard));
}

function ownerOfUuid(config, uuid) {
  const route = ensureArray(config.site_controller_map).filter(function (row) {
    return toText(row.controller_uuid) === toText(uuid)
      && toText(row.routing_role) === 'owner' && row.enabled !== false;
  })[0];
  return route ? toText(route.node_id) : '';
}

function ruleOwnerFor(rule, ruleId, scopes) {
  const explicit = toText(rule.owner_node_id);
  if (explicit) return explicit;
  // cross_controller mit genau einem Owner-Node: der Node ist der Owner
  const nodes = scopes.ruleNodes ? scopes.ruleNodes.get(ruleId) : null;
  return nodes && nodes.length === 1 ? nodes[0] : '';
}

function ruleStateIds(rule, statesById) {
  const out = new Set();
  ['do', 'else_do'].forEach(function (bucket) {
    ensureArray(rule[bucket]).forEach(function (action) {
      ensureArray(action.state_ids).forEach(function (id) {
        const parsed = toIntOrNull(id);
        if (parsed !== null) out.add(parsed);
      });
      ensureArray(action.p_ids).forEach(function (pid) {
        statesById.forEach(function (state, stateId) {
          if (toIntOrNull(state.p_id) === toIntOrNull(pid)) out.add(stateId);
        });
      });
    });
  });
  ['when', 'until'].forEach(function (bucket) {
    ensureArray(rule[bucket]).forEach(function (cond) {
      if (toText(cond.src) === 'state') {
        const parsed = toIntOrNull(cond.state_id);
        if (parsed !== null) out.add(parsed);
      }
      if (isPlainObject(cond.value) && cond.value.param_of_state !== undefined) {
        const parsed = toIntOrNull(cond.value.param_of_state);
        if (parsed !== null) out.add(parsed);
      }
    });
  });
  return Array.from(out);
}

/**
 * Cross-Writer-Eignung einer Regel — Portierung von
 * `config_sharding_contracts.cross_rule_eligibility()`.
 *
 * Eine Regel darf nur dann cross ausgeführt werden, wenn
 *   a) ihr Graph cross_controller oder cross_worker ist,
 *   b) sie keine kritische Gruppe trägt,
 *   c) sie ausschließlich cross-eigene States schreibt,
 *   d) sie überhaupt ein cross-eigenes Ziel hat (oder reine notify-Regel ist).
 *
 * Verletzt sie (c), ist sie NICHT fehlerhaft — sie gehört schlicht in den
 * node_local-Shard des Owners und liest die entfernten Signale über
 * `rule_engine.runtime.remote_signal_refs = "allowed_by_controller_uuid"`.
 */
export function crossEligibility(config, rule, precomputed) {
  const cfg = isPlainObject(config) ? config : {};
  const scopes = precomputed || classifyScopes(cfg);
  const ruleId = toIntOrNull((rule || {}).rule_id);
  const scope = scopes.rules.get(ruleId);
  const reasons = [];

  if (CROSS_PROFILE.ruleScopes.indexOf(scope) < 0) {
    reasons.push('Regelgraph ist nicht cross-scoped (' + scope + ')');
  }
  if (isCriticalRule(rule)) {
    reasons.push('sicherheits-/zeitkritische Regeln dürfen nicht cross laufen');
  }
  const mutated = mutatedStateIds(rule);
  const invalidTargets = mutated.filter(function (stateId) {
    return CROSS_PROFILE.ruleScopes.indexOf(scopes.states.get(stateId)) < 0;
  });
  if (invalidTargets.length) {
    reasons.push('geschriebene States sind nicht cross-eigen: ' + invalidTargets.join(','));
  }
  const notifyOnly = !mutated.length && hasNotifyAction(rule);
  if (!mutated.length && !notifyOnly) {
    reasons.push('Regel hat kein cross-eigenes State-Ziel');
  }
  return {
    ok: reasons.length === 0,
    rule_id: ruleId,
    scope: scope || 'invalid',
    mutated_state_ids: mutated,
    invalid_target_state_ids: invalidTargets,
    notify_only: notifyOnly,
    reasons
  };
}

function hasNotifyAction(rule) {
  return ['do', 'else_do'].some(function (bucket) {
    return ensureArray((rule || {})[bucket]).some(function (action) {
      return isPlainObject(action) && toText(action.notify) !== '';
    });
  });
}

/** IDs aller Regeln, die tatsächlich in einen Cross-Shard gehören. */
export function crossRuleIds(config, precomputed) {
  const cfg = isPlainObject(config) ? config : {};
  const scopes = precomputed || classifyScopes(cfg);
  const out = new Set();
  ensureArray(cfg.rules).forEach(function (rule) {
    if (crossEligibility(cfg, rule, scopes).ok) out.add(toIntOrNull(rule.rule_id));
  });
  return out;
}

/** Owner der Cross-Regeln — je Owner entsteht genau ein Cross-Shard. */
export function listCrossOwners(config, precomputed) {
  const cfg = isPlainObject(config) ? config : {};
  const scopes = precomputed || classifyScopes(cfg);
  const owners = [];
  ensureArray(cfg.rules).forEach(function (rule) {
    if (!crossEligibility(cfg, rule, scopes).ok) return;
    const owner = ruleOwnerFor(rule, toIntOrNull(rule.rule_id), scopes);
    if (owner && owners.indexOf(owner) < 0) owners.push(owner);
  });
  return owners;
}

/**
 * Vollständiger Rollout-Split: node_local-Shards (V9) + cross-Shards (V8).
 *
 * Invariante aus `validate_split_shards()`: local- und cross-Regelmengen sind
 * disjunkt und decken zusammen alle ausführbaren Regeln ab.
 */
export function splitShards(config, options) {
  const cfg = isPlainObject(config) ? config : {};
  const opts = isPlainObject(options) ? options : {};
  const scopes = classifyScopes(cfg);

  const crossIds = crossRuleIds(cfg, scopes);

  const local = new Map();
  listNodes(cfg).forEach(function (nodeId) {
    local.set(nodeId, projectNodeShard(cfg, nodeId, { excludeRuleIds: crossIds }));
  });

  const cross = new Map();
  listCrossOwners(cfg, scopes).forEach(function (owner) {
    cross.set(owner, projectCrossShard(cfg, owner, Object.assign({ scopes }, opts)));
  });

  return Object.assign({ local, cross, scopes }, validateSplit(cfg, local, cross, scopes));
}

/** Prüft Disjunktheit und Vollständigkeit des Splits. */
export function validateSplit(config, local, cross, precomputed) {
  const cfg = isPlainObject(config) ? config : {};
  const scopes = precomputed || classifyScopes(cfg);
  const errors = [];
  const warnings = [];

  const localRules = new Set();
  local.forEach(function (shard) {
    ensureArray(shard.rules).forEach(function (rule) {
      localRules.add(toIntOrNull(rule.rule_id));
    });
  });
  const crossRules = new Set();
  cross.forEach(function (shard) {
    ensureArray(shard.rules).forEach(function (rule) {
      crossRules.add(toIntOrNull(rule.rule_id));
    });
  });

  const overlap = Array.from(localRules).filter(function (id) { return crossRules.has(id); });
  if (overlap.length) {
    errors.push({
      code: 'split_overlap',
      message: 'Regel(n) ' + overlap.join(', ') + ' liegen gleichzeitig im Local- und '
        + 'im Cross-Shard. validate_split_shards() lehnt das ab.'
    });
  }

  const executable = [];
  ensureArray(cfg.rules).forEach(function (rule) {
    const ruleId = toIntOrNull(rule.rule_id);
    const scope = scopes.rules.get(ruleId);
    if (['local_controller', 'cross_controller', 'cross_worker'].indexOf(scope) >= 0) {
      executable.push(ruleId);
    }
  });
  const missing = executable.filter(function (id) {
    return !localRules.has(id) && !crossRules.has(id);
  });
  if (missing.length) {
    errors.push({
      code: 'split_missing',
      message: 'Ausführbare Regel(n) ' + missing.join(', ') + ' fehlen in beiden Shard-Arten.'
    });
  }

  const unbound = ensureArray(cfg.rules)
    .map(function (rule) { return toIntOrNull(rule.rule_id); })
    .filter(function (id) {
      return ['unbound', 'invalid'].indexOf(scopes.rules.get(id)) >= 0;
    });
  if (unbound.length) {
    warnings.push({
      code: 'split_unbound',
      message: 'Regel(n) ' + unbound.join(', ') + ' sind an keinen eindeutigen Controller '
        + 'gebunden und landen in keinem Shard.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      local_shards: local.size,
      cross_shards: cross.size,
      local_rule_count: localRules.size,
      cross_rule_count: crossRules.size,
      executable_rule_count: executable.length,
      overlap_count: overlap.length,
      missing_rule_count: missing.length
    }
  };
}
