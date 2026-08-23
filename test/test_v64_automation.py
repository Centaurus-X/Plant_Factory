#!/usr/bin/env python3
"""Verify the PF-AUTOMATION-STUDIO-V1 integration contract (Automation Studio V9)."""

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PASSED = 0


def read(relative):
    """Read one UTF-8 release file."""
    return (ROOT / relative).read_text(encoding='utf-8')


def check(condition, label, detail=''):
    """Record one deterministic release assertion."""
    global PASSED
    if not condition:
        suffix = ': ' + detail if detail else ''
        raise AssertionError(label + suffix)
    PASSED += 1
    print('   ok  ' + label)


def css_selectors(css_text):
    """Return every selector list of a flat stylesheet (comments and at-rule bodies stripped)."""
    text = re.sub(r'/\*.*?\*/', '', css_text, flags=re.S)
    text = re.sub(r'@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}', '', text)
    text = re.sub(r'@media[^{]*\{', '', text)
    return [m.group(1).strip() for m in re.finditer(r'([^{}]+)\{[^{}]*\}', text)]


def main():
    """Run the static contract checks."""
    index = read('public/index.html')
    workspace = read('public/js/v56_workspace.js')
    bootstrap = read('public/js/v9_bootstrap.js')
    store = read('public/js/v9_store.js')
    chrome = read('public/js/v9_ui_chrome.js')
    module = read('public/js/v9_ui_automation.js')
    css = read('public/css/v64_r2.css')

    # index.html wiring
    check('/public/css/v64_r2.css' in index, 'v64_r2.css ist additiv eingebunden')
    check(index.index('/public/css/v64_r1.css') < index.index('/public/css/v64_r2.css'),
          'v64_r2.css folgt auf den bestehenden V64/R1-Schichten')
    check('data-target-tab="v9-automation" data-workspace="automation"' in index,
          'Rail "Automation" öffnet das Studio')
    check('id="tab-btn-v9-automation" data-tab="v9-automation" data-group="automation" data-v9="1"' in index,
          'Kompatibilitätsroute v9-automation vorhanden')
    check('id="tab-v9-automation"' in index and 'id="v9-automation-panel" class="v9-panel"' in index,
          'Panel-Host v9-automation-panel vorhanden')
    for legacy in ('processes', 'rules', 'v9-states', 'v9-rules'):
        check('data-target-tab="' + legacy + '" data-legacy-route="true"' in index,
              'Legacy-Route ' + legacy + ' bleibt als Kompatibilitätsroute erhalten')
    check(index.count('<script type="module" src="/public/js/v9_ui_automation.js">') == 0,
          'Modul wird ausschließlich über v9_bootstrap importiert (kein zweiter Script-Tag)')

    # routing
    check("'v9-automation',\n  'processes'," in workspace, 'GLOBAL_TABS beginnt mit v9-automation')
    check("automation: ['v9-automation', 'processes', 'rules', 'v9-states', 'v9-rules']" in workspace,
          'WORKSPACE_TABS.automation enthält Studio + Legacy-Routen')
    check("const LEGACY_HIDDEN_TABS = ['processes', 'rules', 'v9-states', 'v9-rules'];" in workspace,
          'Legacy-Routen sind im Subnav ausgeblendet, aber erreichbar')
    check("'v9-automation': {" in workspace and "title: 'Automation Studio'" in workspace,
          'TAB_META für v9-automation vorhanden')
    check("'v9-automation': 'Automation Studio'" in chrome, 'Chrome-Label für v9-automation vorhanden')

    # bootstrap + store
    check("import { initAutomationPanel, automationDebugApi } from './v9_ui_automation.js';" in bootstrap,
          'Bootstrap importiert das Studio')
    check("{ id: 'v9-automation-panel', init: initAutomationPanel }," in bootstrap,
          'Studio ist in PANELS registriert')
    check('export function replaceSections(patch)' in store, 'Store bietet replaceSections()')
    check('SECTION_ORDER.includes(sectionName)' in store, 'replaceSections akzeptiert nur Vertragssektionen')
    check("import { orderSections, SECTION_ORDER } from './v9_schema.js';" in store,
          'Store importiert SECTION_ORDER')

    # module contract
    check('export function initAutomationPanel(container)' in module, 'initAutomationPanel exportiert')
    check("import * as store from './v9_store.js';" in module, 'Modul nutzt den V9-Store')
    check("import { ownerIndex, scopeForControllers } from './v9_shard.js';" in module,
          'Scope-Klassifikation kommt aus v9_shard')
    check("import { modal as v9Modal, toast as v9Toast } from './v9_dom.js';" in module,
          'Dialoge laufen über PF-MODAL-V1 (v9_dom)')
    check('store.replaceSections(patch)' in module, 'Schreibpfad ist replaceSections (ein Commit)')
    check('state.deviceConfig' not in module and 'applyProjection' not in module,
          'Modul berührt die Legacy-Projektion nicht')
    check('window.confirm' not in module and 'localStorage' not in module,
          'Kein window.confirm, kein localStorage im Modul')
    check('innerHTML' not in re.sub(r'/\*.*?\*/|//[^\n]*', '', module, flags=re.S),
          'Kein innerHTML im Modul (DOM nur über createElement)')
    for section in ('process_states', 'rules', 'filters', 'timers', 'rule_engine', 'processes',
                    'parameter_generic_templates', 'schema_mappings', 'pid_configs',
                    'control_methods', 'control_method_templates', 'process_modes', 'process_values'):
        check("'" + section + "'" in module, 'Sektion ' + section + ' wird vom Studio behandelt')

    # css scoping
    selectors = css_selectors(css)
    leaking = [s for s in selectors if not all(
        part.strip().startswith(('.as-root', '#tab-v9-automation')) for part in s.split(','))]
    check(not leaking, 'Alle v64_r2.css-Selektoren sind auf das Studio begrenzt', ', '.join(leaking[:5]))
    check('--s0: var(--v9-surface-0)' in css and '--accent: var(--v9-accent)' in css,
          'Token-Brücke nutzt bestehende --v9-Variablen')
    check(not re.search(r'^\s*:root\s*\{', css, flags=re.M), 'v64_r2.css definiert keine globalen Tokens')

    # functional style gate (shared tool)
    result = subprocess.run(['node', str(ROOT / '_tools' / 'check_js_functional_style.cjs')],
                            capture_output=True, text=True, cwd=str(ROOT))
    check(result.returncode == 0, 'JavaScript-Code bleibt rein funktional', result.stdout + result.stderr)

    print('Automation Studio V9 integration contract: ' + str(PASSED) + ' checks passed.')


if __name__ == '__main__':
    main()
