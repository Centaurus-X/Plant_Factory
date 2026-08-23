/**
 * test_v9_core.mjs — Regressionstests für Schema, UUID, Factory und Validator.
 *
 * Ausführen:  node test/test_v9_core.mjs
 * Erwartung :  Exit-Code 0, "ALLE TESTS BESTANDEN".
 *
 * Ohne externe Abhängigkeiten (kein Test-Runner nötig).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SECTION_ORDER, ENUMS, routeKeyFor, orderSections } from '../public/js/v9_schema.js';
import {
  uuid5, NS_AUTOMATION, controllerUuidFor, isUuid, deviceNameFor,
  PINNED_CONTROLLER_UUIDS, MINT_SITE_ID, MINT_NODE_ID,
  legacyControllerUuidFor, isLegacyControllerUuid
} from '../public/js/v9_uuid.js';
import {
  createEmptyV9Config, createContext, addEntity, removeEntity, updateEntity,
  createRule, createCondition, createAction, createProcessState, createTimer,
  createControlStrategy, defaultsFor, nextIdFor, reconcile
} from '../public/js/v9_factory.js';
import {
  validateConfig, validateCrossShard, summarize, isCriticalRule, mutatedStateIds
} from '../public/js/v9_validate.js';
import { migrateLegacyConfig, toEditorProjection, fromEditorProjection }
  from '../public/js/v9_migrate.js';
import {
  projectNodeShard, classifyScopes, projectCrossShard, splitShards,
  crossEligibility, crossRuleIds, listCrossOwners, validateSplit
} from '../public/js/v9_shard.js';
import {
  CROSS_PROFILE, CROSS_VERSION, isCrossConfig, fieldsFor
} from '../public/js/v9_schema.js';
import {
  createCrossMeta, createCrossController, createCrossSensor, createCrossActuator,
  createCrossRule, createCrossRoute, stripPhysicalFields, makeFor
} from '../public/js/v9_factory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function checkValid(name, config) {
  const report = validateConfig(config);
  check(name, report.status === 'OK',
    JSON.stringify(summarize(report)) + ' :: '
    + report.errors.slice(0, 4).map(function (e) { return e.path + ' ' + e.code; }).join(' | '));
  return report;
}

/* ---------------------------------------------------------------- Schema */

check('SECTION_ORDER hat 26 Sektionen', SECTION_ORDER.length === 26, String(SECTION_ORDER.length));
check('rule_op-Enum vollständig',
  ENUMS.rule_op.join(',') === '==,!=,>,>=,<,<=,elapsed,fired', ENUMS.rule_op.join(','));
check('rule_src-Enum vollständig', ENUMS.rule_src.join(',') === 'state,sensor,timer');
check('routeKeyFor mit site', routeKeyFor('site-main', 'fn-01', 2) === 'site-main.fn-01.ctrl_2');
check('routeKeyFor ohne site', routeKeyFor('', 'fn-01', 2) === 'fn-01.ctrl_2');
check('orderSections liefert kanonische Reihenfolge',
  Object.keys(orderSections({ rules: [], meta: [] })).slice(0, 3).join(',') === 'meta,local_node,sites');

/* ------------------------------------------------------------------ UUID */

check('NS_AUTOMATION stabil', NS_AUTOMATION === '6f6eda22-a4ad-5e79-b435-0573ad7fbfbd', NS_AUTOMATION);
check('uuid5 RFC-Vektor', uuid5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')
  === '2ed6657d-e927-568b-95e1-2665a8aea6a2');
// Die Runtime-Konvention lautet uuid5(NAMESPACE_DNS, "<site>.<mint_node>.<device_name>").
// Alle fuenf Bestands-UUIDs muessen sich damit reproduzieren lassen — sonst
// findet die Runtime einen im Editor angelegten Controller nicht wieder.
Object.keys(PINNED_CONTROLLER_UUIDS).forEach(function (deviceName) {
  const expected = PINNED_CONTROLLER_UUIDS[deviceName];
  check('controller_uuid reproduziert Runtime-Baseline: ' + deviceName,
    controllerUuidFor(MINT_SITE_ID, MINT_NODE_ID, deviceName) === expected,
    controllerUuidFor(MINT_SITE_ID, MINT_NODE_ID, deviceName));
  check('controller_key und device_name fuehren zur selben UUID: ' + deviceName,
    controllerUuidFor(MINT_SITE_ID, MINT_NODE_ID, 'ctrl_' + deviceName) === expected);
});
check('mintNodeId haelt die Identitaet beim Node-Wechsel stabil',
  controllerUuidFor(MINT_SITE_ID, 'fn-02', 'wago_5', { mintNodeId: MINT_NODE_ID })
  === PINNED_CONTROLLER_UUIDS.wago_5);
check('deviceNameFor akzeptiert beide Schreibweisen',
  deviceNameFor('ctrl_wago_1') === 'wago_1' && deviceNameFor('wago_1') === 'wago_1'
  && deviceNameFor('  Wago 9 ') === 'Wago_9' && deviceNameFor('') === 'controller');
check('controller_uuid deterministisch',
  controllerUuidFor('site_main', 'fn-01', 'ctrl_x') === controllerUuidFor('site_main', 'fn-01', 'ctrl_x'));
check('controller_uuid site-abhängig',
  controllerUuidFor('site-a', 'fn-01', 'ctrl_x') !== controllerUuidFor('site-b', 'fn-01', 'ctrl_x'));
check('controller_uuid node-abhängig',
  controllerUuidFor('site_main', 'fn-01', 'ctrl_x') !== controllerUuidFor('site_main', 'fn-02', 'ctrl_x'));
check('Alte Editor-Konvention wird als solche erkannt',
  isLegacyControllerUuid(legacyControllerUuidFor('site-main', 'fn-01', 'ctrl_wago_9'),
    'site-main', 'fn-01', 'wago_9'));
check('isUuid erkennt Müll', !isUuid('nope') && isUuid(NS_AUTOMATION));

/* --------------------------------------------------------------- Factory */

const empty = createEmptyV9Config({ node_id: 'fn-01', site_id: 'site-main' });
checkValid('createEmptyV9Config ist kontraktkonform', empty);
check('createEmptyV9Config enthält alle Sektionen',
  SECTION_ORDER.every(function (s) { return Array.isArray(empty[s]); }));
check('defaultsFor(rules) hat Execution-Metadaten',
  ['execution_owner', 'execution_scope', 'execution_epoch', 'deployment_status', 'activation_state']
    .every(function (k) { return k in defaultsFor('rules'); }));

const added = addEntity(empty, 'controllers', { device_name: 'wago_9', host: '10.0.0.9' });
check('addEntity vergibt nächste controller_id', added.row.controller_id === 2, String(added.row.controller_id));
check('addEntity leitet controller_uuid ab', isUuid(added.row.controller_uuid));
check('addEntity legt keine Route automatisch an (bewusst explizit)',
  added.config.site_controller_map.length === 1);

const withRoute = addEntity(added.config, 'site_controller_map', {
  local_controller_id: added.row.controller_id,
  controller_uuid: added.row.controller_uuid,
  controller_key: added.row.controller_key,
  node_id: 'fn-01', site_id: 'site-main'
});
check('reconcile berechnet route_key',
  withRoute.row.route_key === 'site-main.fn-01.ctrl_2', withRoute.row.route_key);
check('reconcile aktualisiert local_node',
  withRoute.config.local_node[0].active_controller_uuids.length === 2,
  String(withRoute.config.local_node[0].active_controller_uuids.length));
checkValid('Config nach Controller+Route gültig', withRoute.config);

const withSensor = addEntity(withRoute.config, 'sensors', {
  local_controller_id: 2, sensor_id: 1, address: 7, sensor_group: 'S1'
});
check('Sensor erbt Routing-Metadaten',
  withSensor.row.controller_uuid === added.row.controller_uuid
  && withSensor.row.node_id === 'fn-01' && withSensor.row.site_id === 'site-main');
checkValid('Config mit Sensor gültig', withSensor.config);

const removedController = removeEntity(withSensor.config, 'controllers', added.row.controller_uuid);
check('removeEntity kaskadiert auf Routen',
  removedController.config.site_controller_map.length === 1);
check('removeEntity kaskadiert auf Sensoren',
  removedController.config.sensors.length === 0);
checkValid('Config nach Kaskade gültig', removedController.config);

const renamed = updateEntity(withSensor.config, 'controllers', added.row.controller_uuid,
  { device_name: 'wago_umbenannt' });
check('updateEntity behält uuid stabil',
  renamed.row.controller_uuid === added.row.controller_uuid);

/* ------------------------------------------------- Bedingungen / Aktionen */

const cond = createCondition({ src: 'sensor', op: 'ge', value: '42,5', sensor_id: 1 },
  createContext(withSensor.config));
check('createCondition repariert Operator-Alias', cond.op === '>=', cond.op);
check('createCondition parst Dezimalkomma', cond.value === 42.5, String(cond.value));
check('createCondition löst controller_uuid auf', isUuid(cond.controller_uuid));

const dynCond = createCondition({ src: 'state', op: '==', state_id: 1,
  value: { param_of_state: 1, key: 'target_temp_c', scale: 2 } });
check('createCondition erhält dynamische Referenz',
  dynCond.value.param_of_state === 1 && dynCond.value.key === 'target_temp_c'
  && dynCond.value.scale === 2);

const badCond = createCondition({ src: 'fact', op: 'in', value: 'text' });
check('createCondition fällt auf V9-legale Werte zurück',
  badCond.src === 'sensor' && badCond.op === '>=' && badCond.value === 0);

check('createAction: notify', createAction({ notify: 'hallo' }).notify === 'hallo');
check('createAction: state_ids dedupliziert+sortiert',
  createAction({ state_ids: [3, 1, 3] }).state_ids.join(',') === '1,3');
check('createAction: p_ids-Zweig', Array.isArray(createAction({ p_ids: [2] }).p_ids));

check('createControlStrategy verwirft ONOFF',
  createControlStrategy({ type: 'ONOFF' }) === null);
check('createControlStrategy verwirft PID ohne pid_config_id',
  createControlStrategy({ type: 'PID' }) === null);
check('createControlStrategy akzeptiert PID',
  createControlStrategy({ type: 'PID', pid_config_id: 1 }).pid_config_id === 1);
check('createControlStrategy akzeptiert control_method',
  createControlStrategy({ type: 'control_method', method_id: 3 }).method_id === 3);

check('createTimer: duration -> duration_s',
  createTimer({ timer_id: 1, duration: 4000 }).duration_s === 4000);
check('createTimer: frequency -> interval_s',
  Math.abs(createTimer({ timer_id: 2, frequency: 14 }).interval_s - 4.2857) < 1e-4);
check('createTimer ohne Zeitbasis bekommt duration_s',
  createTimer({ timer_id: 3 }).duration_s === 0);

const rule = createRule({ rule_id: 5, name: 'test', enabled: false,
  when: [{ src: 'state', state_id: 1, op: '==', value: 1 }],
  do: [{ state_ids: [1], value_id: 2 }] }, createContext(empty));
check('createRule setzt Execution-Metadaten für deaktivierte Regel',
  rule.execution_epoch === 0 && rule.deployment_status === 'disabled_with_reason'
  && rule.activation_state === 'inactive' && Boolean(rule.disabled_reason));
check('createRule setzt execution_scope', rule.execution_scope === 'node:fn-01');

/* ------------------------------------------------------------- Validator */

const broken = JSON.parse(JSON.stringify(empty));
broken.rules = [Object.assign({}, rule, { execution_scope: 'node:fremd' })];
check('Validator erkennt execution_scope-Bruch',
  validateConfig(broken).errors.some(function (e) { return e.code === 'execution_scope_mismatch'; }));

const brokenOp = JSON.parse(JSON.stringify(empty));
brokenOp.rules = [Object.assign({}, rule, { enabled: true, deployment_status: 'active_node',
  activation_state: 'active', execution_epoch: 1,
  when: [{ src: 'sensor', op: 'in', value: 1, sensor_id: 1, controller_uuid: 'x' }] })];
const opReport = validateConfig(brokenOp);
check('Validator erkennt Runtime-only-Operator',
  opReport.errors.some(function (e) { return e.code === 'condition_op'; }));

const brokenSection = JSON.parse(JSON.stringify(empty));
brokenSection.dynamic_rule_engine = [];
check('Validator erkennt Fremdsektion',
  validateConfig(brokenSection).errors.some(function (e) { return e.code === 'unsupported_section'; }));

const brokenIo = JSON.parse(JSON.stringify(withSensor.config));
brokenIo.sensors[0].function_type = 'write_coil';
check('Validator erkennt falschen function_type',
  validateConfig(brokenIo).errors.some(function (e) { return e.code === 'io_function_type'; }));

/* ------------------------------------------------------------- Migration */

const legacyPath = path.join(ROOT, 'config', '_legacy', '___device_state_data.json');
if (fs.existsSync(legacyPath)) {
  const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  const migrated = migrateLegacyConfig(legacy, { node_id: 'fn-01', site_id: 'site_main',
    scope: 'master_global' });
  checkValid('Browser-Migration liefert gültige V9-Config', migrated.config);
  check('Migration meldet Breaking Changes',
    migrated.report.some(function (e) { return e.kind === 'breaking'; }));
  check('Migration entfernt Legacy-Sektionen',
    !('dynamic_rule_engine' in migrated.config) && !('automation_rule_sets' in migrated.config));
  check('Migration erhält alle Prozess-States',
    migrated.config.process_states.length === legacy.process_states.length,
    migrated.config.process_states.length + ' vs ' + legacy.process_states.length);

  // Referenz ist die Ausgabe von _tools/migrate_config_to_v9.py auf derselben
  // Legacy-Basis — NICHT die ausgelieferte Config: die entsteht seit V54 aus
  // den Feld-Shards (build_config.sh) und ist inhaltlich reicher.
  const pyPath = path.join(ROOT, 'test', 'fixtures', 'migrated_v9_reference.json');
  if (fs.existsSync(pyPath)) {
    const fromPython = JSON.parse(fs.readFileSync(pyPath, 'utf8'));
    check('JS- und Python-Migration erzeugen identische Sektionsgrößen',
      SECTION_ORDER.every(function (s) {
        return (migrated.config[s] || []).length === (fromPython[s] || []).length;
      }),
      SECTION_ORDER.filter(function (s) {
        return (migrated.config[s] || []).length !== (fromPython[s] || []).length;
      }).join(','));
    check('JS- und Python-Migration erzeugen identische controller_uuids',
      (migrated.config.controllers || []).map(function (row) { return row.controller_uuid; })
        .join(',') === (fromPython.controllers || []).map(function (row) {
        return row.controller_uuid; }).join(','));
  }
}

/* ------------------------------------------------ local_node je Scope */

// Der Vertrag fuehrt local_node als t_list(min_len=1) — kein Singleton. Wie
// viele Zeilen richtig sind, entscheidet der Scope. Bis V54.0 warf reconcile()
// im master_global-Fall die zweite Node-Zeile weg (fn-02 verschwand).
const masterCfg = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'config', 'device_state_data_v9.json'), 'utf8'));
check('master_global fuehrt eine local_node-Zeile je Node',
  masterCfg.local_node.length === new Set(
    masterCfg.site_controller_map.map(function (r) { return r.node_id; })).size,
  masterCfg.local_node.length + ' Zeilen');
check('master_global validiert mit mehreren local_node-Zeilen',
  validateConfig(masterCfg).status === 'OK',
  JSON.stringify(validateConfig(masterCfg).errors.slice(0, 3)));

const reconciled = reconcile(JSON.parse(JSON.stringify(masterCfg)));
check('reconcile() erhaelt alle Nodes im Master',
  reconciled.local_node.length === masterCfg.local_node.length,
  reconciled.local_node.map(function (r) { return r.node_id; }).join(','));
check('reconcile() fuellt active_controller_uuids je Node',
  reconciled.local_node.every(function (row) {
    return Array.isArray(row.active_controller_uuids) && row.active_controller_uuids.length;
  }));

const tooMany = JSON.parse(JSON.stringify(masterCfg));
tooMany.meta[0].scope = 'node_local';
tooMany.meta[0].node_id = 'fn-01';
check('node_local mit zwei local_node-Zeilen wird abgewiesen',
  validateConfig(tooMany).errors.some(function (e) { return e.code === 'local_node_arity'; }));

const duplicate = JSON.parse(JSON.stringify(masterCfg));
duplicate.local_node = [duplicate.local_node[0], duplicate.local_node[0]];
check('Doppelte node_id in local_node wird abgewiesen',
  validateConfig(duplicate).errors.some(function (e) { return e.code === 'local_node_duplicate'; }));

/* --------------------------------------------------- Editor-Projektion */

const canonical = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'config', 'device_state_data_v9.json'), 'utf8'));
const projection = toEditorProjection(canonical);
check('Editor-Projektion liefert Legacy-Schlüssel',
  Array.isArray(projection.sensors) && Array.isArray(projection.process_states)
  && Array.isArray(projection.parameter_schemas)
  && Array.isArray(projection.automation_rule_sets));
check('Editor-Projektion setzt controller_id an Sensoren',
  projection.sensors.every(function (row) { return typeof row.controller_id === 'number'; }));
check('Editor-Projektion setzt sensor_ids/actuator_ids an States',
  projection.process_states.every(function (row) {
    return Array.isArray(row.sensor_ids) && Array.isArray(row.actuator_ids);
  }));
const roundTripped = fromEditorProjection(projection, canonical);
checkValid('Editor-Projektion ist verlustfrei rückführbar', roundTripped);
check('Rückprojektion erhält Sensoranzahl',
  roundTripped.sensors.length === canonical.sensors.length);
check('Rückprojektion erhält Regelanzahl',
  roundTripped.rules.length === canonical.rules.length);

/* ------------------------------------------------------------- Sharding */

const shard = projectNodeShard(canonical, 'fn-01');
checkValid('Node-Shard ist kontraktkonform', shard);
check('Node-Shard hat scope node_local', shard.meta[0].scope === 'node_local');
check('Node-Shard hat node_id', shard.meta[0].node_id === 'fn-01');

const scopes = classifyScopes(canonical);
check('Scope-Klassifikation liefert States und Regeln',
  scopes.states.size > 0 && scopes.rules.size > 0);
check('Scope-Klassifikation kennt nur gültige Klassen',
  Array.from(scopes.states.values()).every(function (value) {
    return ['local_controller', 'cross_controller', 'cross_worker', 'unbound', 'invalid']
      .indexOf(value) >= 0;
  }));

/* ================================================================ V8-Cross */

function checkCrossValid(name, shard, scopes) {
  const report = validateCrossShard(shard, { scopes });
  check(name, report.status === 'OK',
    JSON.stringify(summarize(report)) + ' :: '
    + report.errors.slice(0, 4).map(function (e) { return e.path + ' ' + e.code; }).join(' | '));
  return report;
}

check('CROSS_VERSION ist 8', CROSS_VERSION === 8);
check('Cross-Scopes vollständig',
  CROSS_PROFILE.scopes.join(',') === 'cross,cross_controller,cross_worker');
check('Verbotene Controller-Physikfelder',
  CROSS_PROFILE.forbiddenControllerFields.join(',') === 'bus_type,host,port,unit');
check('Verbotene I/O-Physikfelder',
  CROSS_PROFILE.forbiddenIoFields.join(',') === 'address,bus_type,function_type,unit');
check('local_node muss im Cross-Shard leer sein',
  CROSS_PROFILE.mustBeEmpty.indexOf('local_node') >= 0);

check('createCrossMeta setzt Version 8 und Domain',
  createCrossMeta({ owner_node_id: 'fn-07' }).version === 8
  && createCrossMeta({ owner_node_id: 'fn-07' }).domain_id === 'cross-fn-07-default'
  && createCrossMeta({ owner_node_id: 'fn-07' }).owner_node_id === 'fn-07');
check('createCrossController trägt kein Physikfeld',
  Object.keys(createCrossController({ controller_id: 1, controller_uuid: 'u', controller_key: 'k',
    bus_type: 'modbus', host: '1.2.3.4', port: 502, unit: '0x1' }, { nodeId: 'fn-01' }))
    .sort().join(',') === 'controller_id,controller_key,controller_uuid,owner_node_id');
check('createCrossSensor trägt kein Physikfeld',
  Object.keys(createCrossSensor({ sensor_id: 1, controller_uuid: 'u', controller_key: 'k',
    node_id: 'fn-01', address: 7, bus_type: 'modbus', function_type: 'read_coil',
    site_id: 'site-main' })).sort().join(',')
  === 'controller_key,controller_uuid,enabled,local_controller_id,node_id,sensor_group,sensor_id');
check('createCrossActuator trägt kein Physikfeld',
  Object.keys(createCrossActuator({ actuator_id: 1, controller_uuid: 'u', controller_key: 'k',
    node_id: 'fn-01', address: 512, bus_type: 'modbus', function_type: 'write_coil' }))
    .indexOf('address') < 0);
check('createCrossRoute ohne site_id erzeugt kurzen route_key',
  createCrossRoute({ node_id: 'fn-01', local_controller_id: 3 }).route_key === 'fn-01.ctrl_3');
check('createCrossRule lässt Execution-Metadaten weg',
  CROSS_PROFILE.optionalRuleFields.every(function (name) {
    return createCrossRule({ rule_id: 1, name: 'x',
      when: [{ src: 'state', state_id: 1, op: '==', value: 1 }],
      do: [{ state_ids: [1], value_id: 1 }] }, { nodeId: 'fn-01' })[name] === undefined;
  }));
check('makeFor("cross", …) nutzt die Cross-Factory',
  makeFor('cross', 'controllers', { controller_id: 1, controller_uuid: 'u',
    controller_key: 'k', host: '1.2.3.4' }, { nodeId: 'fn-01' }).host === undefined);
check('makeFor("node", …) nutzt die V9-Factory',
  makeFor('node', 'controllers', { controller_id: 1, device_name: 'x', host: '1.2.3.4' },
    createContext(empty)).host === '1.2.3.4');

const strippedDemo = stripPhysicalFields(canonical);
check('stripPhysicalFields entfernt alle Controller-Physikfelder',
  strippedDemo.controllers.every(function (row) {
    return CROSS_PROFILE.forbiddenControllerFields.every(function (name) {
      return row[name] === undefined;
    });
  }));
check('stripPhysicalFields entfernt alle I/O-Physikfelder',
  strippedDemo.sensors.concat(strippedDemo.actuators).every(function (row) {
    return CROSS_PROFILE.forbiddenIoFields.every(function (name) {
      return row[name] === undefined;
    });
  }));
check('stripPhysicalFields leert local_node', strippedDemo.local_node.length === 0);
check('stripPhysicalFields ist idempotent',
  JSON.stringify(stripPhysicalFields(strippedDemo)) === JSON.stringify(strippedDemo));

check('fieldsFor(controllers, cross) blendet Physikfelder aus',
  fieldsFor('controllers', 'cross').every(function (field) {
    return CROSS_PROFILE.forbiddenControllerFields.indexOf(field.name) < 0;
  }));
check('fieldsFor(rules, cross) macht Execution-Felder optional',
  fieldsFor('rules', 'cross').filter(function (field) {
    return CROSS_PROFILE.optionalRuleFields.indexOf(field.name) >= 0;
  }).every(function (field) { return field.required === false; }));

/* --- Split auf der realen Demo-Config: keine cross-fähige Regel --- */

const demoSplit = splitShards(canonical);
check('Demo-Split ist gültig', demoSplit.ok,
  demoSplit.errors.map(function (e) { return e.code; }).join(','));
check('Demo-Split ohne Überlappung', demoSplit.stats.overlap_count === 0);
check('Demo-Split ohne fehlende Regeln', demoSplit.stats.missing_rule_count === 0);
check('Regel 1 ist cross-scoped, aber nicht cross-fähig',
  crossEligibility(canonical, canonical.rules[0]).ok === false);

/* --- Split auf der Cross-Fixture: ein echter V8-Shard entsteht --- */

const crossFixturePath = path.join(ROOT, 'test', 'fixtures', 'cross_demo_v9.json');
if (fs.existsSync(crossFixturePath)) {
  const crossSource = JSON.parse(fs.readFileSync(crossFixturePath, 'utf8'));
  const crossScopes = classifyScopes(crossSource);
  checkValid('Cross-Fixture ist als V9-Config gültig', crossSource);

  const eligible = crossRuleIds(crossSource, crossScopes);
  check('Fixture hat genau eine cross-fähige Regel', eligible.size === 1,
    Array.from(eligible).join(','));
  check('Cross-Owner erkannt',
    listCrossOwners(crossSource, crossScopes).join(',') === 'fn-01');

  const split = splitShards(crossSource);
  check('Fixture-Split ist gültig', split.ok,
    split.errors.map(function (e) { return e.message; }).join(' | '));
  check('Fixture-Split ohne Überlappung', split.stats.overlap_count === 0);
  check('Fixture-Split deckt alle ausführbaren Regeln ab',
    split.stats.missing_rule_count === 0);
  check('Local- und Cross-Regelmengen ergänzen sich',
    split.stats.local_rule_count + split.stats.cross_rule_count
    === split.stats.executable_rule_count,
    JSON.stringify(split.stats));

  const crossShard = split.cross.get('fn-01');
  check('Cross-Shard erzeugt', Boolean(crossShard));
  if (crossShard) {
    checkCrossValid('Cross-Shard erfüllt den V8-Vertrag', crossShard, crossScopes);
    check('Cross-Shard trägt Version 8', crossShard.meta[0].version === 8);
    check('Cross-Shard trägt Scope cross', crossShard.meta[0].scope === 'cross');
    check('Cross-Shard hat owner_node_id + domain_id',
      Boolean(crossShard.meta[0].owner_node_id) && Boolean(crossShard.meta[0].domain_id));
    check('Cross-Shard hat leeres local_node', crossShard.local_node.length === 0);
    check('Cross-Shard hat alle 26 Sektionen',
      Object.keys(crossShard).length === 26, String(Object.keys(crossShard).length));
    check('Cross-Shard-Controller ohne Physikfelder',
      crossShard.controllers.every(function (row) {
        return CROSS_PROFILE.forbiddenControllerFields.every(function (name) {
          return row[name] === undefined;
        }) && Boolean(row.owner_node_id);
      }));
    check('Cross-Shard-I/O ohne Physikfelder',
      crossShard.sensors.concat(crossShard.actuators).every(function (row) {
        return CROSS_PROFILE.forbiddenIoFields.every(function (name) {
          return row[name] === undefined;
        });
      }));
    check('Cross-Shard-Routen ohne site_id',
      crossShard.site_controller_map.every(function (row) { return row.site_id === undefined; }));
    check('Cross-Shard-Regeln ohne Execution-Metadaten',
      crossShard.rules.every(function (rule) {
        return CROSS_PROFILE.optionalRuleFields.every(function (name) {
          return rule[name] === undefined;
        });
      }));
    check('Cross-Shard-Regeln schreiben nur cross-eigene States',
      crossShard.rules.every(function (rule) {
        return mutatedStateIds(rule).every(function (stateId) {
          return CROSS_PROFILE.ruleScopes.indexOf(crossScopes.states.get(stateId)) >= 0;
        });
      }));
    check('isCrossConfig erkennt den Shard', isCrossConfig(crossShard));

    // Negativproben: der Validator muss jeden Vertragsbruch fangen
    const withPhysical = JSON.parse(JSON.stringify(crossShard));
    withPhysical.controllers[0].bus_type = 'modbus';
    check('Validator fängt Physikfeld am Controller',
      validateCrossShard(withPhysical, { scopes: crossScopes }).errors
        .some(function (e) { return e.code === 'cross_physical_controller'; }));

    const withIoPhysical = JSON.parse(JSON.stringify(crossShard));
    withIoPhysical.sensors[0].address = 7;
    check('Validator fängt Physikfeld am Sensor',
      validateCrossShard(withIoPhysical, { scopes: crossScopes }).errors
        .some(function (e) { return e.code === 'cross_physical_io'; }));

    const withLocalNode = JSON.parse(JSON.stringify(crossShard));
    withLocalNode.local_node = [{ node_id: 'fn-01', active_controller_uuids: [],
      active_controller_routes: [] }];
    check('Validator fängt gefülltes local_node',
      validateCrossShard(withLocalNode, { scopes: crossScopes }).errors
        .some(function (e) { return e.code === 'local_node_arity'; }));

    const withVirtActive = JSON.parse(JSON.stringify(crossShard));
    withVirtActive.virtual_controllers = [{ virt_controller_id: 1,
      controller_uuid: crossShard.controllers[0].controller_uuid,
      device_name: 'v', virt_active: true, host: '0.0.0.0', port: 5020 }];
    check('Validator fängt aktiven virtuellen Controller',
      validateCrossShard(withVirtActive, { scopes: crossScopes }).errors
        .some(function (e) { return e.code === 'cross_virt_active'; }));

    const withCritical = JSON.parse(JSON.stringify(crossShard));
    withCritical.rules[0].group = 'safety';
    check('Validator fängt kritische Regel im Cross-Shard',
      validateCrossShard(withCritical, { scopes: crossScopes }).errors
        .some(function (e) { return e.code === 'cross_critical_rule'; }));

    const withV9 = JSON.parse(JSON.stringify(crossShard));
    withV9.meta[0].version = 9;
    check('Validator fängt falsche Version',
      validateCrossShard(withV9, { scopes: crossScopes }).errors
        .some(function (e) { return e.code === 'cross_version'; }));

    const withoutDomain = JSON.parse(JSON.stringify(crossShard));
    delete withoutDomain.meta[0].domain_id;
    check('Validator fängt fehlende Domain-Identität',
      validateCrossShard(withoutDomain, { scopes: crossScopes }).errors
        .some(function (e) { return e.code === 'cross_domain_missing'; }));

    // Split-Invariante negativ
    const badLocal = new Map(split.local);
    badLocal.set('fn-01', Object.assign({}, split.local.get('fn-01'),
      { rules: split.local.get('fn-01').rules.concat(crossShard.rules) }));
    check('validateSplit erkennt Überlappung',
      validateSplit(crossSource, badLocal, split.cross, crossScopes).errors
        .some(function (e) { return e.code === 'split_overlap'; }));
  }

  const localShard = split.local.get('fn-01');
  if (localShard) {
    checkValid('Local-Shard bleibt V9-konform', localShard);
    check('Local-Shard enthält keine cross-fähige Regel',
      localShard.rules.every(function (rule) {
        return !eligible.has(toIntOrNullSafe(rule.rule_id));
      }));
  }
}

function toIntOrNullSafe(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

check('isCriticalRule erkennt safety-Gruppe', isCriticalRule({ group: 'safety' }));
check('isCriticalRule erkennt hard-realtime-Schreibweise',
  isCriticalRule({ group: 'hard-realtime' }));
check('isCriticalRule erkennt deadline_ms', isCriticalRule({ group: 'process', deadline_ms: 5 }));
check('isCriticalRule lässt normale Regel durch', !isCriticalRule({ group: 'process' }));
check('mutatedStateIds sammelt do und else_do',
  mutatedStateIds({ do: [{ state_ids: [3, 1] }], else_do: [{ state_ids: [2] }] })
    .join(',') === '1,2,3');

/* ------------------------------------------------------- Kein OOP mehr im JS */

const jsDir = path.join(ROOT, 'public', 'js');
const jsFiles = fs.readdirSync(jsDir).filter(function (name) { return name.endsWith('.js'); });
let classHits = 0;
let thisHits = 0;
jsFiles.forEach(function (name) {
  const source = fs.readFileSync(path.join(jsDir, name), 'utf8');
  source.split('\n').forEach(function (line) {
    const trimmed = line.trim();
    if (/^class\s+\w/.test(trimmed)) classHits += 1;
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (/\bthis\b/.test(line)) thisHits += 1;
  });
});
check('Keine ES-Klasse mehr im Frontend', classHits === 0, String(classHits));
check('Kein this mehr im Frontend-Code', thisHits === 0, String(thisHits));
check('Alle Frontend-Dateien vorhanden', jsFiles.length >= 27, String(jsFiles.length));

/* ----------------------------------------------------------------- Fazit */

console.log('bestanden: ' + passed + ' | fehlgeschlagen: ' + failed);
if (failed) {
  failures.forEach(function (item) { console.log('  FEHLER: ' + item); });
  process.exit(1);
}
console.log('ALLE TESTS BESTANDEN');
