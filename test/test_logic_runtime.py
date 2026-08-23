#!/usr/bin/env python3
"""Verify the functional universal runtime and Automation_System adapter."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from runtime_compat.automation_system_adapter import canonical_signal_facts
from runtime_compat.automation_system_adapter import execute_cycle
from runtime_compat.automation_system_adapter import is_cross_safe_command
from runtime_compat.automation_system_adapter import logical_cross_command
from runtime_compat.plant_logic_runtime import evaluate_model
from runtime_compat.plant_logic_runtime import topological_order


CONFIG = json.loads((ROOT / 'config/device_state_data_v9.json').read_text(encoding='utf-8'))
RUNTIME_REFERENCE = json.loads((ROOT / 'test/fixtures/device_state_data_v9_node_fn01_runtime_reference.json').read_text(encoding='utf-8'))
PASSED = 0


def check(condition, label, detail=''):
    global PASSED
    if not condition:
        suffix = ': %s' % detail if detail else ''
        raise AssertionError(label + suffix)
    PASSED += 1
    print('   ok  %s' % label)


def edge(edge_id, source_node, source_port, target_node, target_port, data_type):
    return {
        'edge_id': edge_id,
        'from': {'node_id': source_node, 'port_id': source_port},
        'to': {'node_id': target_node, 'port_id': target_port},
        'data_type': data_type,
        'enabled': True,
    }


def timer_counter_model():
    nodes = [
        {
            'node_id': 'tick', 'block_type': 'signal_in', 'label': 'Tick',
            'enabled': True, 'config': {'data_type': 'BOOL', 'default_value': False},
            'binding': {'signal_ref': 'demo.tick', 'data_type': 'BOOL'},
        },
        {
            'node_id': 'time', 'block_type': 'constant_time', 'label': 'T#500ms',
            'enabled': True, 'config': {'value_ms': 500}, 'binding': None,
        },
        {
            'node_id': 'ton', 'block_type': 'ton', 'label': 'TON0',
            'enabled': True, 'config': {'pt_ms': 500}, 'binding': None,
        },
        {
            'node_id': 'counter_tick', 'block_type': 'signal_in', 'label': 'Counter Tick',
            'enabled': True, 'config': {'data_type': 'BOOL', 'default_value': False},
            'binding': {'signal_ref': 'demo.counter_tick', 'data_type': 'BOOL'},
        },
        {
            'node_id': 'reset', 'block_type': 'signal_in', 'label': 'Reset',
            'enabled': True, 'config': {'data_type': 'BOOL', 'default_value': False},
            'binding': {'signal_ref': 'demo.reset', 'data_type': 'BOOL'},
        },
        {
            'node_id': 'pv', 'block_type': 'constant_int', 'label': '2',
            'enabled': True, 'config': {'value': 2}, 'binding': None,
        },
        {
            'node_id': 'ctu', 'block_type': 'ctu', 'label': 'CTU0',
            'enabled': True, 'config': {'pv': 2}, 'binding': None,
        },
        {
            'node_id': 'state', 'block_type': 'state_write', 'label': 'State',
            'enabled': True,
            'config': {
                'state_id': 1, 'value_id_true': 1, 'value_id_false': 2,
                'write_false': True, 'ownership_mode': 'hybrid', 'priority': 600,
            },
            'binding': {'signal_ref': 'v9.state.1.value_id', 'state_id': 1, 'data_type': 'INT'},
        },
        {
            'node_id': 'count_out', 'block_type': 'signal_out', 'label': 'Count',
            'enabled': True, 'config': {'data_type': 'INT', 'ownership_mode': 'logic'},
            'binding': {'signal_ref': 'demo.count', 'data_type': 'INT'},
        },
    ]
    edges = [
        edge('e1', 'tick', 'Q', 'ton', 'IN', 'BOOL'),
        edge('e2', 'time', 'Q', 'ton', 'PT', 'TIME'),
        edge('e3', 'ton', 'Q', 'state', 'EN', 'BOOL'),
        edge('e4', 'counter_tick', 'Q', 'ctu', 'CU', 'BOOL'),
        edge('e5', 'reset', 'Q', 'ctu', 'R', 'BOOL'),
        edge('e6', 'pv', 'Q', 'ctu', 'PV', 'INT'),
        edge('e7', 'ctu', 'CV', 'count_out', 'VALUE', 'INT'),
    ]
    return {
        'version': 1,
        'standard': {'id': 'PF-LOGIC-V1', 'version': 1},
        'active_diagram_id': 'demo',
        'diagrams': [{
            'diagram_id': 'demo', 'name': 'Runtime Demo', 'enabled': True,
            'execution': {'scope_kind': 'node_local', 'owner_node_id': 'fn-01'},
            'nodes': nodes, 'edges': edges,
        }],
    }


def actuator_model(config_value=None):
    config = config_value if isinstance(config_value, dict) else CONFIG
    actuator = config['actuators'][0]
    return {
        'version': 1,
        'standard': {'id': 'PF-LOGIC-V1', 'version': 1},
        'diagrams': [{
            'diagram_id': 'actuator', 'name': 'Actuator', 'enabled': True,
            'nodes': [
                {
                    'node_id': 'enable', 'block_type': 'constant_bool', 'label': 'True',
                    'enabled': True, 'config': {'value': True}, 'binding': None,
                },
                {
                    'node_id': 'value', 'block_type': 'constant_bool', 'label': 'On',
                    'enabled': True, 'config': {'value': True}, 'binding': None,
                },
                {
                    'node_id': 'output', 'block_type': 'actuator_write', 'label': 'Actuator',
                    'enabled': True,
                    'config': {'ownership_mode': 'logic', 'priority': 900},
                    'binding': {
                        'signal_ref': 'v9.actuator.%s.%s.command' % (
                            actuator['controller_uuid'], actuator['actuator_id']
                        ),
                        'controller_uuid': actuator['controller_uuid'],
                        'actuator_id': actuator['actuator_id'],
                        'data_type': 'BOOL',
                    },
                },
            ],
            'edges': [
                edge('a1', 'enable', 'Q', 'output', 'EN', 'BOOL'),
                edge('a2', 'value', 'Q', 'output', 'VALUE', 'BOOL'),
            ],
        }],
    }


def cycle_model():
    return {
        'version': 1,
        'diagrams': [{
            'diagram_id': 'cycle', 'enabled': True,
            'nodes': [
                {'node_id': 'a', 'block_type': 'not', 'enabled': True, 'config': {}, 'binding': None},
                {'node_id': 'b', 'block_type': 'not', 'enabled': True, 'config': {}, 'binding': None},
            ],
            'edges': [
                edge('c1', 'a', 'Q', 'b', 'IN', 'BOOL'),
                edge('c2', 'b', 'Q', 'a', 'IN', 'BOOL'),
            ],
        }],
    }


def run():
    model = timer_counter_model()
    topology = topological_order(model['diagrams'][0])
    check(not topology['cyclic'], 'Runtime erzeugt eine topologische Reihenfolge')
    check(len(topology['order']) == 9, 'Alle Runtime-Knoten werden eingeplant')

    state = None
    result = evaluate_model(model, {
        'demo.tick': True,
        'demo.counter_tick': False,
        'demo.reset': False,
    }, state, 0)
    state = result['runtime_state']
    check(result['status'] == 'OK', 'Erster Runtime-Zyklus ist erfolgreich')
    check(result['diagrams'][0]['outputs']['ton:Q'] is False, 'TON ist vor PT noch aus')
    check(result['actions'][0]['kind'] == 'state_write', 'State-Ausgang erzeugt eine kanonische Aktion')
    check(result['actions'][0]['value_id'] == 2, 'TON-False-Zweig schreibt den deaktivierten Wert')

    result = evaluate_model(model, {
        'demo.tick': True,
        'demo.counter_tick': True,
        'demo.reset': False,
    }, state, 500)
    state = result['runtime_state']
    check(result['diagrams'][0]['outputs']['ton:Q'] is True, 'TON schaltet nach PT ein')
    check(result['actions'][0]['value_id'] == 1, 'TON-True-Zweig schreibt den aktiven Wert')
    check(result['diagrams'][0]['outputs']['ctu:CV'] == 1, 'CTU zählt eine steigende Flanke')
    check(any(action['kind'] == 'signal_out' and action['value'] == 1 for action in result['actions']),
          'Signal-Out transportiert den Zählerwert')

    result = evaluate_model(model, {
        'demo.tick': True,
        'demo.counter_tick': True,
        'demo.reset': False,
    }, state, 600)
    state = result['runtime_state']
    check(result['diagrams'][0]['outputs']['ctu:CV'] == 1, 'CTU zählt dauerhaftes High nicht doppelt')

    result = evaluate_model(model, {
        'demo.tick': False,
        'demo.counter_tick': False,
        'demo.reset': True,
    }, state, 700)
    check(result['diagrams'][0]['outputs']['ctu:CV'] == 0, 'CTU-Reset funktioniert')
    check(result['diagrams'][0]['outputs']['ton:ET'] == 0, 'TON setzt die abgelaufene Zeit zurück')

    facts = canonical_signal_facts(
        CONFIG,
        sensor_values={'%s:%s' % (CONFIG['sensors'][0]['controller_uuid'], CONFIG['sensors'][0]['sensor_id']): 42.5},
        state_values={1: {'value_id': 1, 'parameters': {'target_temp_c': 555.0}}},
        timer_values={100: {'elapsed': True, 'remaining_s': 12.0}},
        hmi_values={'manual_start': True},
    )
    sensor_ref = 'v9.sensor.%s.%s.value' % (
        CONFIG['sensors'][0]['controller_uuid'], CONFIG['sensors'][0]['sensor_id']
    )
    check(facts[sensor_ref] == 42.5, 'Sensorwerte werden auf stabile V9-Referenzen abgebildet')
    check(facts['v9.state.1.value_id'] == 1, 'Process-State-Wert wird abgebildet')
    check(facts['v9.state.1.parameters.target_temp_c'] == 555.0,
          'Process-State-Parameter wird abgebildet')
    check(facts['v9.timer.100.elapsed'] is True, 'V9-Timer-Fakt wird abgebildet')
    check(facts['hmi.widget.manual_start.value'] is True, 'HMI-Wert wird abgebildet')

    cycle_result = evaluate_model(cycle_model(), {}, None, 0)
    check(cycle_result['status'] == 'FAILED', 'Runtime lehnt zyklische Graphen fail-closed ab')
    check(cycle_result['diagnostics'][0]['code'] == 'logic_cycle', 'Zyklusdiagnose ist eindeutig')

    actuator_result = execute_cycle(
        actuator_model(),
        CONFIG,
        runtime_state=None,
        now_ms=0,
    )
    check(actuator_result['status'] == 'OK', 'Automation_System-Adapter führt Aktorgraph aus')
    check(len(actuator_result['fieldbus_commands']) == 1, 'Aktoraktion wird als Feldbusbefehl ausgegeben')
    command = actuator_result['fieldbus_commands'][0]
    check(command['endpoint']['identity']['controller_uuid'] == CONFIG['actuators'][0]['controller_uuid'],
          'Feldbusbefehl behält die stabile Controller-UUID')
    check(command['endpoint']['identity']['actuator_id'] == CONFIG['actuators'][0]['actuator_id'],
          'Feldbusbefehl behält die lokale Aktor-ID')
    check(command['endpoint']['fieldbus']['address'] == CONFIG['actuators'][0]['address'],
          'Lokaler Owner löst die Feldbusadresse auf')
    check(not is_cross_safe_command(command), 'Lokaler Feldbusbefehl ist nicht für Cross-Transport freigegeben')
    cross_command = logical_cross_command(command)
    check(is_cross_safe_command(cross_command), 'Cross-Befehl entfernt alle physischen Koordinaten')
    check(cross_command['endpoint']['identity'] == command['endpoint']['identity'],
          'Cross-Befehl behält die logische Geräteidentität')

    reference_actuator_result = execute_cycle(
        actuator_model(RUNTIME_REFERENCE),
        RUNTIME_REFERENCE,
        runtime_state=None,
        now_ms=0,
    )
    check(reference_actuator_result['status'] == 'OK',
          'Bereitgestellte Runtime-V9-Referenz wird vom universellen Adapter ausgeführt')
    reference_command = reference_actuator_result['fieldbus_commands'][0]
    check(reference_command['endpoint']['fieldbus']['bus_type'] == 'modbus',
          'Runtime-Referenz löst den Modbus-Feldbus korrekt auf')
    check(reference_command['endpoint']['fieldbus']['function_type'] in ('write_coil', 'write_register'),
          'Runtime-Referenz bewahrt die Aktor-Funktionsart')
    check(reference_command['endpoint']['identity']['controller_uuid']
          == RUNTIME_REFERENCE['actuators'][0]['controller_uuid'],
          'Runtime-Referenz behält controller_uuid plus lokale Aktor-ID')

    bridge_result = execute_cycle(
        model,
        CONFIG,
        extra_signals={
            'demo.tick': True,
            'demo.counter_tick': False,
            'demo.reset': False,
        },
        runtime_state=None,
        now_ms=0,
    )
    check(len(bridge_result['native_rule_actions']) == 1,
          'State-Write wird auf eine native Rule-Engine-Aktion abgebildet')
    check(bridge_result['native_rule_actions'][0] == {'state_ids': [1], 'value_id': 2},
          'Native State-Aktion entspricht dem V9-Aktionsvertrag')
    check(len(bridge_result['signal_updates']) == 1,
          'Interne Signal-Ausgänge bleiben zusätzlich verfügbar')

    print('PF-LOGIC-V1 Python runtime contract: %s checks passed.' % PASSED)


if __name__ == '__main__':
    run()
