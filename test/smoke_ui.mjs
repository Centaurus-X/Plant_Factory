/**
 * smoke_ui.mjs — Headless smoke test for the V63.4 workspace.
 *
 * Voraussetzung: der Server läuft (python3 svg_editor_tool.py).
 * Ausführen   : node test/smoke_ui.mjs [http://localhost:8090]
 *
 * Prüft:
 *   * Seite lädt ohne Konsolen- oder Netzwerkfehler
 *   * alle 12 Tabs schalten um und zeigen ihr Panel
 *   * der Cross-V8-Editor projiziert, prüft und exportiert einen Shard
 *   * die V9-Panels rendern Inhalte aus der geladenen Config
 *   * der Store ist gefüllt und die Validierung meldet keine Fehler
 *   * Editor-Projektion erreicht die Altmodule (state.deviceConfig)
 *   * Dialoge öffnen und schließen sich
 *   * Rollout-Split erzeugt gültige V9-Local- und V8-Cross-Shards
 *   * Dark-Mode-Umschaltung funktioniert
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8090';
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
const IGNORED_CONSOLE = [
    /favicon/i,
    /Failed to load resource/i
];
// In Umgebungen mit vorinstalliertem Chromium (PLAYWRIGHT_BROWSERS_PATH) kann
// der Pfad über CHROMIUM_PATH gesetzt werden, falls die Versionsnummer der
// Playwright-Distribution abweicht.
const launchOptions = { args: ['--no-sandbox'] };
if (process.env.CHROMIUM_PATH)
    launchOptions.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', function (message) {
    if (message.type() !== 'error')
        return;
    const text = message.text();
    if (IGNORED_CONSOLE.some(function (pattern) {
        return pattern.test(text);
    }))
        return;
    consoleErrors.push(text);
});
page.on('pageerror', function (error) { pageErrors.push(String(error)); });
page.on('requestfailed', function (request) {
    failedRequests.push(request.url() + ' :: ' + (request.failure() || {}).errorText);
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
check('Kompatible Version sichtbar', /V(63[.]4|64)/.test(await page.title()), await page.title());
const standardRuntime = await page.evaluate(function () {
    return window.__pfV61 ? window.__pfV61.getReport() : null;
});
check('PF-PID-V1 Runtime vorhanden', standardRuntime !== null);
if (standardRuntime) {
    check('Mindestens 26 Standardsymbole registriert', standardRuntime.canonical_templates >= 26,
        String(standardRuntime.canonical_templates));
    check('Keine automatischen HMI-Widgets',
        standardRuntime.violations.automatic_widgets.length === 0,
        JSON.stringify(standardRuntime.violations.automatic_widgets));
}
check('Seite lädt ohne pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
check('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('Keine fehlgeschlagenen Requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));
/* ------------------------------------------------------------- Stylesheets */
const cssLoaded = await page.evaluate(function () {
    return Array.from(document.styleSheets)
        .map(function (sheet) {
        return (sheet.href || '').split('/').pop();
    }).filter(Boolean);
});
['tokens.css', 'style.css', 'layout.css', 'components.css', 'bridge.css', 'workspace.css', 'v60.css', 'v61.css', 'v62.css', 'v63.css'].forEach(function (name) {
    check('Stylesheet geladen: ' + name, cssLoaded.indexOf(name) >= 0, cssLoaded.join(','));
});
/* ------------------------------------------------------------------- Store */
const storeState = await page.evaluate(function () {
    if (!window.__v9)
        return null;
    const config = window.__v9.getConfig();
    const report = window.__v9.getReport();
    return {
        sections: config ? Object.keys(config).length : 0,
        controllers: config ? config.controllers.length : 0,
        sensors: config ? config.sensors.length : 0,
        actuators: config ? config.actuators.length : 0,
        states: config ? config.process_states.length : 0,
        rules: config ? config.rules.length : 0,
        status: report ? report.status : 'none',
        errors: report ? report.errors.length : -1,
        warnings: report ? report.warnings.length : -1
    };
});
check('V9-Store ist verfügbar', storeState !== null);
if (storeState) {
    check('Config hat 26 Sektionen', storeState.sections === 26, String(storeState.sections));
    check('Controller geladen', storeState.controllers > 0, String(storeState.controllers));
    check('Sensoren geladen', storeState.sensors > 0, String(storeState.sensors));
    check('Aktoren geladen', storeState.actuators > 0, String(storeState.actuators));
    check('Prozess-States geladen', storeState.states > 0, String(storeState.states));
    check('Regeln geladen', storeState.rules > 0, String(storeState.rules));
    check('Validierung ohne Fehler', storeState.status === 'OK', storeState.status + ' / ' + storeState.errors + ' Fehler');
}
/* ------------------------------------------------ Brücke zu den Altmodulen */
const legacyBridge = await page.evaluate(function () {
    const projection = window.__v9 ? window.__v9.getProjection() : null;
    return projection ? {
        hasParameterSchemas: Array.isArray(projection.parameter_schemas),
        hasRuleSets: Array.isArray(projection.automation_rule_sets),
        sensorsHaveControllerId: projection.sensors.every(function (row) {
            return typeof row.controller_id === 'number';
        }),
        statesHaveType: projection.process_states.every(function (row) {
            return typeof row.p__type === 'string';
        })
    } : null;
});
check('Editor-Projektion vorhanden', legacyBridge !== null);
if (legacyBridge) {
    check('Projektion: parameter_schemas', legacyBridge.hasParameterSchemas);
    check('Projektion: automation_rule_sets', legacyBridge.hasRuleSets);
    check('Projektion: sensors.controller_id', legacyBridge.sensorsHaveControllerId);
    check('Projektion: process_states.p__type', legacyBridge.statesHaveType);
}
/* -------------------------------------------------------------------- Tabs */
// Wichtig: nur die Haupt-Tabs. hmi.js erzeugt in #tab-hmi eigene Sub-Tabs mit
// derselben Klasse, aber ohne IDs — die dürfen hier nicht mitgezählt werden.
const tabs = await page.$$eval('#right-tabs > .tab-list > .tab', function (nodes) {
    return nodes.map(function (node) {
        return ({
            id: node.id, tab: node.dataset.tab, label: node.textContent.trim()
        });
    });
});
check('14 Tabs vorhanden', tabs.length === 14, String(tabs.length));
/* V64_r2 keeps fourteen compatibility routes as the controller contract.
   They are intentionally hidden; the visible workspace rail and inspector
   project those routes into the new product shell. */
async function openTab(tabId) {
    await page.evaluate(function (id) {
        const button = document.getElementById(id);
        if (button)
            button.click();
    }, tabId);
    await page.waitForTimeout(180);
}
const workspaceShell = await page.evaluate(function () {
    return ({
        rail: Array.from(document.querySelectorAll('#workspace-rail .workspace-nav-button[data-workspace]')).map(function (node) {
            return ({
                workspace: node.dataset.workspace,
                target: node.dataset.targetTab
            });
        }),
        inspector: Array.from(document.querySelectorAll('.inspector-nav > .inspector-nav-button[data-inspector-view]')).map(function (node) {
            return node.dataset.inspectorView;
        }),
        globalPanels: Array.from(document.querySelectorAll('#global-tab-panels > .tab-panel')).map(function (node) {
            return node.id;
        }),
        initialKind: document.body.dataset.workspaceKind,
        initialWorkspace: document.body.dataset.workspace
    });
});
check('Sechs Hauptarbeitsbereiche', workspaceShell.rail.length === 6, JSON.stringify(workspaceShell.rail));
check('Alle Workspace-Arten vorhanden', ['engineering', 'automation', 'topology', 'runtime', 'validation']
    .every(function (name) {
    return workspaceShell.rail.some(function (entry) {
        return entry.workspace === name;
    });
}), JSON.stringify(workspaceShell.rail));
check('Fuenf Inspektorbereiche', workspaceShell.inspector.length === 5, workspaceShell.inspector.join(', '));
check('Neun Panels in Vollbreite', workspaceShell.globalPanels.length === 9, workspaceShell.globalPanels.join(', '));
check('Start im Engineering-Canvas', workspaceShell.initialKind === 'canvas' && workspaceShell.initialWorkspace === 'engineering', workspaceShell.initialKind + ' / ' + workspaceShell.initialWorkspace);
for (const tab of tabs) {
    await openTab(tab.id);
    await page.waitForTimeout(180);
    const active = await page.evaluate(function (name) {
        const panel = document.getElementById('tab-' + name);
        return panel ? panel.classList.contains('active') : false;
    }, tab.tab);
    check('Tab schaltet um: ' + tab.tab, active);
}
await openTab('tab-btn-processes');
const automationMode = await page.evaluate(function () {
    return ({
        kind: document.body.dataset.workspaceKind,
        workspace: document.body.dataset.workspace,
        visible: Boolean(document.getElementById('workspace-global')?.offsetWidth)
    });
});
check('Automatisierung nutzt Vollbreite', automationMode.kind === 'global'
    && automationMode.workspace === 'automation' && automationMode.visible, JSON.stringify(automationMode));
await openTab('tab-btn-hmi');
const runtimeMode = await page.evaluate(function () {
    return ({
        kind: document.body.dataset.workspaceKind,
        workspace: document.body.dataset.workspace,
        canvasVisible: Boolean(document.getElementById('canvas-area')?.offsetWidth)
    });
});
check('HMI bleibt am Anlagenbild', runtimeMode.kind === 'canvas'
    && runtimeMode.workspace === 'runtime' && runtimeMode.canvasVisible, JSON.stringify(runtimeMode));
/* ------------------------------------------------- V56.1: Engineering Workspace */
const chrome = await page.evaluate(function () {
    const text = function (id) {
        const node = document.getElementById(id);
        return node ? node.textContent.trim() : '';
    };
    const styles = getComputedStyle(document.documentElement);
    return {
        primary: styles.getPropertyValue('--primary-color').trim(),
        accent: styles.getPropertyValue('--v9-accent').trim(),
        fontSans: styles.getPropertyValue('--v9-font-sans').trim(),
        contract: text('status-contract-text'),
        fingerprint: text('status-fingerprint'),
        node: text('status-node'),
        breadcrumb: text('right-breadcrumb'),
        symbols: document.querySelectorAll('symbol[id^="ico-"]').length,
        useRefs: document.querySelectorAll('svg.ico > use').length,
        emoji: (document.body.innerHTML.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length
    };
});
check('Ein Akzent statt zwei', chrome.primary === chrome.accent, chrome.primary + ' / ' + chrome.accent);
check('Public Sans ist gesetzt', chrome.fontSans.indexOf('Public Sans') === 0, chrome.fontSans);
check('Symbolsatz eingebettet', chrome.symbols >= 30, String(chrome.symbols));
check('Schalter nutzen den Symbolsatz', chrome.useRefs >= 15, String(chrome.useRefs));
check('Keine Emoji mehr im Markup', chrome.emoji === 0, String(chrome.emoji));
check('Statusleiste nennt den Vertragszustand', chrome.contract.length > 0, chrome.contract);
check('Statusleiste nennt den Fingerprint', chrome.fingerprint.indexOf('fp') === 0, chrome.fingerprint);
check('Statusleiste nennt den Node', chrome.node.length > 0, chrome.node);
check('Inspektor besitzt einen Kontexttitel', chrome.breadcrumb.length > 0, chrome.breadcrumb);
const canvasChrome = await page.evaluate(function () {
    return ({
        rulerH: Boolean(document.getElementById('ruler-h')),
        rulerV: Boolean(document.getElementById('ruler-v')),
        zoomFloat: Boolean(document.querySelector('.canvas-float--zoom #zoom-level')),
        gridVisible: !document.getElementById('grid-background').classList.contains('hidden'),
        selectionChip: Boolean(document.getElementById('canvas-selection-chip'))
    });
});
check('Lineale vorhanden', canvasChrome.rulerH && canvasChrome.rulerV);
check('Zoom liegt an der Zeichenflaeche', canvasChrome.zoomFloat);
check('Raster ist beim Start sichtbar', canvasChrome.gridVisible);
check('Auswahl-Chip vorhanden', canvasChrome.selectionChip);
/* -------------------------------------------------------------- V9-Panels */
const panelStats = {};
for (const id of ['v9-topology-panel', 'v9-states-panel', 'v9-rules-panel', 'v9-cross-panel', 'v9-validate-panel']) {
    const tabName = id.replace('-panel', '').replace('v9-', 'v9-');
    await openTab('tab-btn-' + tabName);
    await page.waitForTimeout(260);
    panelStats[id] = await page.evaluate(function (panelId) {
        const node = document.getElementById(panelId);
        if (!node)
            return null;
        return {
            cards: node.querySelectorAll('.v9-card').length,
            tables: node.querySelectorAll('.v9-table').length,
            rows: node.querySelectorAll('.v9-table tbody tr').length,
            buttons: node.querySelectorAll('.v9-btn').length
        };
    }, id);
    const stats = panelStats[id];
    check('Panel gerendert: ' + id, Boolean(stats) && stats.cards > 0, stats ? JSON.stringify(stats) : 'null');
    check('Panel hat Datenzeilen: ' + id, Boolean(stats) && stats.rows > 0, stats ? JSON.stringify(stats) : 'null');
}
/* ------------------------------------------------------------------ Dialog */
await openTab('tab-btn-v9-topology');
await page.waitForTimeout(260);
await page.click('text=Controller anlegen');
await page.waitForTimeout(260);
check('Dialog geöffnet', await page.isVisible('.v9-modal__panel'));
const dialogFields = await page.$$eval('.v9-modal .v9-field', function (nodes) {
    return nodes.length;
});
check('Dialog hat Formularfelder', dialogFields >= 5, String(dialogFields));
await page.keyboard.press('Escape');
await page.waitForTimeout(220);
check('Dialog per Escape geschlossen', !(await page.isVisible('.v9-modal__panel')));
/* ------------------------------------------------------- Regel-Dialog (V9) */
await openTab('tab-btn-v9-rules');
await page.waitForTimeout(260);
await page.click('#tab-v9-rules >> text=Regel anlegen');
await page.waitForTimeout(320);
const ruleDialog = await page.evaluate(function () {
    const modal = document.querySelector('.v9-modal');
    if (!modal)
        return null;
    const options = Array.from(modal.querySelectorAll('select'))
        .map(function (node) {
        return Array.from(node.options).map(function (option) {
            return option.value;
        });
    });
    return {
        conditionRows: modal.querySelectorAll('.v9-list__row').length,
        hasOpEnum: options.some(function (list) {
            return list.join(',') === '==,!=,>,>=,<,<=,elapsed,fired';
        }),
        hasSrcEnum: options.some(function (list) {
            return list.join(',') === 'state,sensor,timer';
        }),
        hasGroupEnum: options.some(function (list) {
            return list.join(',') === 'process,safety,notify';
        })
    };
});
check('Regel-Dialog geöffnet', ruleDialog !== null);
if (ruleDialog) {
    check('Regel-Dialog erzwingt op-Enum', ruleDialog.hasOpEnum);
    check('Regel-Dialog erzwingt src-Enum', ruleDialog.hasSrcEnum);
    check('Regel-Dialog erzwingt group-Enum', ruleDialog.hasGroupEnum);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
/* ---------------------------------------------------------------- Dark Mode */
await page.click('#theme-toggle');
await page.waitForTimeout(280);
const darkTheme = await page.evaluate(function () {
    return ({
        attr: document.documentElement.getAttribute('data-theme'),
        surface: getComputedStyle(document.documentElement).getPropertyValue('--v9-surface-0').trim(),
        ink: getComputedStyle(document.documentElement).getPropertyValue('--v9-ink').trim()
    });
});
check('Dark Mode aktiv', darkTheme.attr === 'dark', JSON.stringify(darkTheme));
check('Dark-Tokens greifen', darkTheme.surface === '#0b1220', darkTheme.surface);
await page.screenshot({ path: 'test/screenshot_dark.png', fullPage: false });
await page.click('#theme-toggle');
await page.waitForTimeout(280);
await openTab('tab-btn-v9-validate');
await page.waitForTimeout(280);
await page.screenshot({ path: 'test/screenshot_light.png', fullPage: false });
/* ----------------------------------------------------- Rollout-Split (V8) */
await openTab('tab-btn-v9-validate');
await page.waitForTimeout(400);
const splitPanel = await page.evaluate(function () {
    const node = document.getElementById('v9-validate-panel');
    if (!node)
        return null;
    const cards = Array.from(node.querySelectorAll('.v9-card__title'))
        .map(function (el) {
        return el.textContent.trim();
    });
    return { cards, hasSplit: cards.some(function (t) {
            return t.indexOf('Rollout-Split') >= 0;
        }) };
});
check('Validierungs-Panel zeigt den Rollout-Split', Boolean(splitPanel) && splitPanel.hasSplit, splitPanel ? splitPanel.cards.join(' | ') : 'null');
const splitApi = await page.evaluate(function () {
    if (!window.__v9 || !window.__v9.splitShards)
        return null;
    const config = window.__v9.getConfig();
    const split = window.__v9.splitShards(config);
    const eligibility = config.rules.map(function (rule) {
        return window.__v9.crossEligibility(config, rule);
    });
    return {
        ok: split.ok,
        stats: split.stats,
        localShards: split.local.size,
        crossShards: split.cross.size,
        eligible: eligibility.filter(function (e) {
            return e.ok;
        }).length,
        reasons: eligibility.filter(function (e) {
            return !e.ok;
        }).map(function (e) {
            return e.reasons[0];
        })
    };
});
check('splitShards im Browser verfügbar', splitApi !== null);
if (splitApi) {
    check('Split ist disjunkt und vollständig', splitApi.ok, JSON.stringify(splitApi.stats));
    check('Split hat keine Überlappung', splitApi.stats.overlap_count === 0);
    check('Split lässt keine Regel liegen', splitApi.stats.missing_rule_count === 0);
    check('Cross-Eignung wird begründet', splitApi.eligible > 0 || splitApi.reasons.every(function (r) {
        return typeof r === 'string' && r.length > 0;
    }), JSON.stringify(splitApi.reasons));
}
const crossRoundtrip = await page.evaluate(async function () {
    const response = await fetch('/test/fixtures/cross_demo_v9.json');
    if (!response.ok)
        return { skipped: true };
    const source = await response.json();
    const split = window.__v9.splitShards(source);
    const shard = split.cross.get('fn-01');
    if (!shard)
        return { skipped: false, found: false };
    const report = window.__v9.validateCrossShard(shard, { scopes: window.__v9.shard.classifyScopes(source) });
    return {
        skipped: false,
        found: true,
        ok: split.ok,
        status: report.status,
        errors: report.errors.length,
        version: shard.meta[0].version,
        scope: shard.meta[0].scope,
        sections: Object.keys(shard).length,
        localNodeEmpty: shard.local_node.length === 0,
        noPhysicalController: shard.controllers.every(function (row) {
            return row.bus_type === undefined && row.host === undefined;
        }),
        noPhysicalIo: shard.sensors.concat(shard.actuators).every(function (row) {
            return row.address === undefined && row.function_type === undefined;
        })
    };
});
if (crossRoundtrip && !crossRoundtrip.skipped) {
    check('Cross-Shard aus der Fixture erzeugt', crossRoundtrip.found);
    if (crossRoundtrip.found) {
        check('Cross-Shard ist vertragskonform', crossRoundtrip.status === 'OK', JSON.stringify(crossRoundtrip));
        check('Cross-Shard trägt Version 8', crossRoundtrip.version === 8);
        check('Cross-Shard trägt Scope cross', crossRoundtrip.scope === 'cross');
        check('Cross-Shard hat 26 Sektionen', crossRoundtrip.sections === 26);
        check('Cross-Shard hat leeres local_node', crossRoundtrip.localNodeEmpty);
        check('Cross-Controller ohne Physikfelder', crossRoundtrip.noPhysicalController);
        check('Cross-I/O ohne Physikfelder', crossRoundtrip.noPhysicalIo);
    }
}
/* ------------------------------------------------------ Cross-V8-Editor */
await openTab('tab-btn-v9-cross');
await page.waitForTimeout(300);
// Bei genau einem cross-faehigen Owner projiziert das Panel automatisch —
// der Anwender sieht den Shard sofort, ohne einen Dialog zu bestaetigen,
// dessen Ergebnis feststeht.
const crossAuto = await page.evaluate(function () {
    const node = document.getElementById('v9-cross-panel');
    if (!node)
        return null;
    return {
        cards: node.querySelectorAll('.v9-card').length,
        rows: node.querySelectorAll('.v9-table tbody tr').length
    };
});
check('Cross-Panel projiziert automatisch', crossAuto !== null && crossAuto.rows > 0, JSON.stringify(crossAuto));
// Zurueck auf den Startbildschirm: alle vier Ladewege muessen dort stehen.
await page.click('#v9-cross-panel .v9-btn:has-text("Anderen Shard laden")');
await page.waitForTimeout(250);
const crossIntro = await page.evaluate(function () {
    const node = document.getElementById('v9-cross-panel');
    if (!node)
        return null;
    const buttons = Array.from(node.querySelectorAll('.v9-btn')).map(function (el) {
        return el.textContent.trim();
    });
    return { buttons, cards: node.querySelectorAll('.v9-card').length };
});
check('Cross-Panel gerendert', crossIntro !== null && crossIntro.cards > 0, JSON.stringify(crossIntro));
check('Cross-Panel bietet alle vier Ladewege', crossIntro !== null
    && crossIntro.buttons.some(function (t) {
        return t.indexOf('projizieren') >= 0;
    })
    && crossIntro.buttons.some(function (t) {
        return t.indexOf('Server') >= 0;
    })
    && crossIntro.buttons.some(function (t) {
        return t.indexOf('Datei') >= 0;
    })
    && crossIntro.buttons.some(function (t) {
        return t.indexOf('Leeren') >= 0;
    }), crossIntro ? crossIntro.buttons.join(' | ') : 'null');
// Und wieder hinein — diesmal ueber den Dialog, damit auch dieser Weg belegt ist.
const projectButton = await page.$('#v9-cross-panel .v9-btn:has-text("projizieren")');
check('Projektionsschaltflaeche vorhanden', Boolean(projectButton));
if (projectButton) {
    await projectButton.click();
    await page.waitForTimeout(220);
    const dialogOpen = await page.isVisible('.v9-modal__panel');
    check('Projektionsdialog oeffnet', dialogOpen);
    if (dialogOpen) {
        await page.click('.v9-modal .v9-btn--primary');
        await page.waitForTimeout(450);
    }
}
const crossLoaded = await page.evaluate(function () {
    const node = document.getElementById('v9-cross-panel');
    const titles = Array.from(node.querySelectorAll('.v9-card__title')).map(function (el) {
        return el.textContent.trim();
    });
    return { titles, rows: node.querySelectorAll('.v9-table tbody tr').length };
});
check('Cross-Editor zeigt alle Vertragsbereiche', ['Cross-Gate', 'Identität des Shards', 'Controller-Stubs', 'Routen',
    'Logische Sensoren', 'Logische Aktoren', 'Cross-Regeln']
    .every(function (title) {
    return crossLoaded.titles.some(function (item) {
        return item.indexOf(title) >= 0;
    });
}), crossLoaded.titles.join(' | '));
check('Cross-Editor zeigt Zeilen aus dem Shard', crossLoaded.rows > 0, String(crossLoaded.rows));
const crossSession = await page.evaluate(function () {
    if (!window.__v9 || !window.__v9.cross)
        return null;
    const session = window.__v9.cross.getSession();
    if (!session.config)
        return { loaded: false };
    const meta = session.config.meta[0];
    const io = (session.config.sensors || []).concat(session.config.actuators || []);
    return {
        loaded: true,
        version: meta.version,
        scope: meta.scope,
        owner: meta.owner_node_id,
        hasDomain: Boolean(meta.domain_id),
        sections: Object.keys(session.config).length,
        localNodeEmpty: Array.isArray(session.config.local_node) && session.config.local_node.length === 0,
        physicsFree: ['bus_type', 'host', 'port', 'unit'].every(function (field) {
            return (session.config.controllers || []).every(function (row) {
                return !(field in row);
            });
        })
            && ['address', 'bus_type', 'function_type'].every(function (field) {
                return io.every(function (row) {
                    return !(field in row);
                });
            }),
        executionFree: (session.config.rules || []).every(function (rule) {
            return ['activation_state', 'deployment_status', 'execution_epoch', 'execution_owner',
                'execution_scope'].every(function (field) {
                return !(field in rule);
            });
        }),
        status: session.report ? session.report.status : ''
    };
});
check('Cross-Sitzung ueber window.__v9.cross erreichbar', crossSession !== null);
if (crossSession && crossSession.loaded) {
    check('Cross-Editor: Version 8', crossSession.version === 8, String(crossSession.version));
    check('Cross-Editor: Scope cross', crossSession.scope === 'cross', crossSession.scope);
    check('Cross-Editor: Owner und Domain gesetzt', Boolean(crossSession.owner) && crossSession.hasDomain);
    check('Cross-Editor: alle 26 Sektionen', crossSession.sections === 26, String(crossSession.sections));
    check('Cross-Editor: local_node leer', crossSession.localNodeEmpty);
    check('Cross-Editor: keine Physikfelder', crossSession.physicsFree);
    check('Cross-Editor: keine V9-Execution-Felder', crossSession.executionFree);
    check('Cross-Editor: Cross-Gate meldet OK', crossSession.status === 'OK', crossSession.status);
}
const crossFormat = await page.evaluate(function () {
    if (!window.__v9 || !window.__v9.cross)
        return null;
    const session = window.__v9.cross.getSession();
    if (!session.config)
        return null;
    const once = window.__v9.formatConfig(session.config);
    const twice = window.__v9.formatConfig(JSON.parse(once));
    return {
        idempotent: once === twice,
        startsWithMeta: once.indexOf('{\n  "meta"') === 0,
        hasBlankLineGrouping: once.indexOf('\n\n  "rules"') > 0,
        oneObjectPerLine: (once.match(/^ {4}\{".*\},?$/gm) || []).length > 0
    };
});
check('Cross-Export ist idempotent', crossFormat !== null && crossFormat.idempotent);
check('Cross-Export beginnt mit meta', crossFormat !== null && crossFormat.startsWithMeta);
check('Cross-Export gliedert mit Leerzeilen', crossFormat !== null && crossFormat.hasBlankLineGrouping);
check('Cross-Export schreibt ein Objekt je Zeile', crossFormat !== null && crossFormat.oneObjectPerLine);
/* ------------------------------------------- Plant Factory: Export + SVG */
// Der eigentliche Zweck der Anwendung: aus einer Zeichnung wird ein Bundle,
// dessen SVG sich animieren laesst. Bis V54.0 war genau diese Kette
// ungetestet — und an drei Stellen gebrochen.
const exportChain = await page.evaluate(async function () {
    const mod = await import('/public/js/hmi_animation.js');
    const canvas = document.getElementById('main-canvas');
    if (!canvas)
        return { error: 'main-canvas fehlt' };
    // Ein Element auf die Flaeche legen, damit getBBox etwas misst.
    const ns = 'http://www.w3.org/2000/svg';
    const layer = canvas.querySelector('#elements-layer') || canvas;
    const group = document.createElementNS(ns, 'g');
    group.setAttribute('class', 'svg-element');
    group.setAttribute('id', 'inst_smoke_1');
    group.setAttribute('transform', 'translate(120,80)');
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('width', '160');
    rect.setAttribute('height', '90');
    rect.setAttribute('data-hmi-fill', '1');
    group.appendChild(rect);
    layer.appendChild(group);
    // Genau das tun, was generateSvgStringForExport tut.
    const clone = canvas.cloneNode(true);
    const grid = clone.querySelector('#grid-background');
    if (grid)
        grid.remove();
    const cloneLayer = clone.querySelector('#elements-layer');
    if (cloneLayer)
        cloneLayer.removeAttribute('transform');
    mod.makeSvgAnimatable(clone, { title: 'Smoke' });
    const svgText = new XMLSerializer().serializeToString(clone);
    // Das erzeugte SVG in ein Dokument parsen und die Animation nachweisen.
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = parsed.documentElement;
    const styleNode = root.querySelector('style[data-hmi-animation]');
    // Live pruefen, ob die eingebettete CSS wirklich greift: dasselbe SVG in
    // einen Container haengen, Klasse setzen, Computed Style lesen.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;height:300px';
    probe.innerHTML = svgText;
    document.body.appendChild(probe);
    const probeSvg = probe.querySelector('svg');
    const probeRect = probe.querySelector('rect[data-hmi-fill="1"]');
    const probeGroup = probe.querySelector('#inst_smoke_1');
    const before = {
        opacity: getComputedStyle(probeRect).fillOpacity,
        fill: getComputedStyle(probeRect).fill
    };
    probeGroup.classList.add('alarm-red');
    const afterAlarm = {
        opacity: getComputedStyle(probeRect).fillOpacity,
        fill: getComputedStyle(probeRect).fill
    };
    probeGroup.classList.add('hmi-anim-blink');
    const animation = getComputedStyle(probeGroup).animationName;
    const duration = getComputedStyle(probeGroup).animationDuration;
    const result = {
        hasViewBox: Boolean(root.getAttribute('viewBox')),
        viewBox: root.getAttribute('viewBox'),
        preserveAspectRatio: root.getAttribute('preserveAspectRatio'),
        noFixedSize: !root.getAttribute('width') && !root.getAttribute('height'),
        hasStyle: Boolean(styleNode),
        styleHasKeyframes: Boolean(styleNode && styleNode.textContent.includes('@keyframes hmi-blink')),
        styleHasStates: Boolean(styleNode && styleNode.textContent.includes('.alarm-red')),
        hasTitle: Boolean(root.querySelector('title')),
        parseError: Boolean(parsed.querySelector('parsererror')),
        fillBefore: before,
        fillAfterAlarm: afterAlarm,
        fillChanged: before.fill !== afterAlarm.fill || before.opacity !== afterAlarm.opacity,
        animationName: animation,
        animationDuration: duration,
        probeSvgFound: Boolean(probeSvg)
    };
    probe.remove();
    group.remove();
    return result;
});
check('Export-SVG laesst sich fehlerfrei parsen', exportChain && !exportChain.parseError, JSON.stringify(exportChain));
check('Export-SVG traegt ein viewBox', exportChain.hasViewBox, String(exportChain.viewBox));
check('Export-SVG skaliert proportional', exportChain.preserveAspectRatio === 'xMidYMid meet');
check('Export-SVG hat keine feste Groesse mehr', exportChain.noFixedSize);
check('Export-SVG traegt die eingebettete Animationsschicht', exportChain.hasStyle);
check('Eingebettete CSS enthaelt die Keyframes', exportChain.styleHasKeyframes);
check('Eingebettete CSS enthaelt die Zustandsklassen', exportChain.styleHasStates);
check('Export-SVG traegt einen Titel', exportChain.hasTitle);
// Der eigentliche Beweis: die Klasse aendert die Darstellung wirklich.
// Der Nachweis ist die AENDERUNG, nicht ihre Richtung: die Regel setzt Farbe
// und Deckkraft der markierten Flaeche auf die Zustandsfarbe.
check('Zustandsklasse faerbt die markierte Fuellflaeche', exportChain.fillChanged
    && /rgb\(\s*239\s*,\s*68\s*,\s*68\s*\)/.test(exportChain.fillAfterAlarm.fill), JSON.stringify(exportChain.fillBefore) + ' -> ' + JSON.stringify(exportChain.fillAfterAlarm));
check('Animationsklasse startet eine echte CSS-Animation', exportChain.animationName === 'hmi-blink', exportChain.animationName + ' / ' + exportChain.animationDuration);
/* ------------------------------------------ Plant Factory: Export-Config */
const exportConfig = await page.evaluate(async function () {
    const adapter = await import('/public/js/model_adapter.js');
    const stateMod = await import('/public/js/core.js');
    const projection = window.__v9.getProjection();
    if (!projection)
        return { error: 'keine Projektion' };
    const sensors = projection.sensors.slice(0, 4);
    const assignments = {};
    sensors.forEach(function (row, index) {
        assignments['e' + index] = {
            element_id: 'e' + index, role: 'sensor',
            controller_id: row.controller_id, sensor_id: row.sensor_id,
            sensor_type: 'temperature', bus_type: row.bus_type || 'modbus',
            function_type: row.function_type || 'read_holding_registers',
            address: row.address, widget: { type: 'text', label: 'T' + index }
        };
    });
    const fake = {
        get: function (key) {
            return ({
                projektName: 'smoke', deviceConfig: projection, elements: [], connections: [],
                devices: { assignments }, processes: { process_states: [] },
                hmi: { bindings: [] },
                hmi_ui: { version: 1, active_view_id: 'main', views: [], widgets: [], bindings: [] },
                dynamic_rule_engine: { rule_sets: [] }
            })[key];
        }
    };
    const cfg = adapter.buildExportConfig(fake);
    return {
        sensorKeys: (cfg.sensors || []).map(function (r) {
            return r.controller_id + ':' + r.sensor_id;
        }),
        expected: sensors.map(function (r) {
            return r.controller_id + ':' + r.sensor_id;
        }),
        controllerIds: (cfg.controllers || []).map(function (r) {
            return r.controller_id;
        }),
        usedControllers: Array.from(new Set(sensors.map(function (r) {
            return r.controller_id;
        }))),
        controllersHaveHost: (cfg.controllers || []).every(function (r) {
            return typeof r.host === 'string' && r.host;
        }),
        noVirtualInReal: (cfg.controllers || []).every(function (r) {
            return String(r.bus_type || '').toLowerCase() !== 'virtual';
        })
    };
});
check('Export-Config erzeugt', exportConfig && !exportConfig.error, JSON.stringify(exportConfig));
if (exportConfig && !exportConfig.error) {
    check('Alle gebundenen Sensoren ueberleben den Export', exportConfig.expected.every(function (key) {
        return exportConfig.sensorKeys.includes(key);
    }), 'erwartet ' + JSON.stringify(exportConfig.expected)
        + ' erhalten ' + JSON.stringify(exportConfig.sensorKeys));
    check('Alle benutzten Controller liegen im Export', exportConfig.usedControllers.every(function (id) {
        return exportConfig.controllerIds.includes(id);
    }), 'benutzt ' + JSON.stringify(exportConfig.usedControllers)
        + ' exportiert ' + JSON.stringify(exportConfig.controllerIds));
    check('Exportierte Controller tragen einen Endpunkt', exportConfig.controllersHaveHost);
    check('Kein realer Controller wurde als virtuell aussortiert', exportConfig.noVirtualInReal);
}
/* ------------------------------- Plant Factory: Snapshot im Anlagenbild */
// Der Export muss die V9-Konfiguration WOERTLICH mitschreiben. Nur dann ist
// das Anlagenbild selbsttragend: geht die Worker-Config verloren, genuegt
// diese eine Datei zum Wiederanlauf.
const snapshotChain = await page.evaluate(async function () {
    const snap = await import('/public/js/hmi_snapshot.js');
    const fmt = await import('/public/js/v9_json_format.js');
    const api = window.__v9;
    if (!api)
        return { error: 'window.__v9 fehlt' };
    const sourceText = api.getSourceText ? api.getSourceText() : '';
    const config = api.getConfig();
    const text = sourceText || fmt.formatConfig(config);
    const entries = [snap.describeConfig(text, { source: 'smoke' })];
    const split = api.splitShards(config);
    split.local.forEach(function (shard) {
        return entries.push(snap.describeConfig(fmt.formatConfig(shard), { source: 'splitShards' }));
    });
    split.cross.forEach(function (shard) {
        return entries.push(snap.describeConfig(fmt.formatConfig(shard), { source: 'splitShards' }));
    });
    const snapshot = snap.buildSnapshot(entries, { project: 'smoke' });
    // In ein echtes SVG einbetten und ueber XMLSerializer zurueckholen — genau
    // den Weg, den der Export geht.
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    snap.embedSnapshot(svg, snapshot);
    const svgText = new XMLSerializer().serializeToString(svg);
    const readBack = snap.extractSnapshot(svgText);
    const report = readBack ? snap.verifySnapshot(readBack) : null;
    const master = readBack ? snap.pickConfig(readBack) : null;
    // Gegen den Stand vergleichen, den der Snapshot selbst beschreibt: so
    // prueft der Test die Vergleichslogik und nicht die Normalisierung des
    // Stores. Der Fall "Store weicht von der Datei ab" hat einen eigenen Test.
    const comparison = master
        ? snap.compareWithHead(master, JSON.parse(master.text), master.text) : null;
    const againstStore = master ? snap.compareWithHead(master, config, text) : null;
    return {
        entries: entries.length,
        svgBytes: svgText.length,
        hasMetadata: svgText.indexOf('<metadata') >= 0,
        hasCdata: svgText.indexOf('<![CDATA[') >= 0,
        readBackOk: Boolean(readBack),
        verified: report ? report.ok : false,
        verifyErrors: report ? report.errors : ['kein Bericht'],
        byteExact: Boolean(master) && master.text === text,
        fingerprint: master ? master.fingerprint : '',
        serverFingerprint: api.getFingerprint ? api.getFingerprint() : '',
        comparisonState: comparison ? comparison.state : '',
        againstStoreState: againstStore ? againstStore.state : '',
        roles: readBack ? readBack.configs.map(function (c) {
            return c.role;
        }) : []
    };
});
check('Snapshot-Kette im Browser lief durch', snapshotChain && !snapshotChain.error, JSON.stringify(snapshotChain));
if (snapshotChain && !snapshotChain.error) {
    check('Snapshot umfasst Master und Shards', snapshotChain.entries >= 3, String(snapshotChain.entries) + ' Eintraege: ' + snapshotChain.roles.join(','));
    check('Snapshot liegt in <metadata>', snapshotChain.hasMetadata);
    // In einer HTML-Seite gibt es kein CDATA — dann maskiert der Serializer,
    // und extractSnapshot() loest die Entities wieder auf. Beide Wege sind
    // richtig; entscheidend ist, dass der Snapshot zurueckkommt.
    check('Snapshot ist eingebettet (CDATA oder maskiert)', snapshotChain.hasCdata || snapshotChain.readBackOk, 'cdata=' + snapshotChain.hasCdata);
    check('Snapshot ist nach dem Serialisieren wieder lesbar', snapshotChain.readBackOk);
    check('Snapshot besteht die Integritaetspruefung', snapshotChain.verified, JSON.stringify(snapshotChain.verifyErrors));
    check('Wiederhergestellter Text ist BYTE-GENAU', snapshotChain.byteExact);
    check('Snapshot gegen den eigenen Stand: identisch', snapshotChain.comparisonState === 'identical', snapshotChain.comparisonState);
    check('Snapshot gegen den Store-Stand: eingeordnet, nicht abgelehnt', ['identical', 'stale', 'ahead'].indexOf(snapshotChain.againstStoreState) >= 0, snapshotChain.againstStoreState);
    check('Der Fingerprint ist ein vollstaendiger SHA-256', /^[0-9a-f]{64}$/.test(snapshotChain.fingerprint), snapshotChain.fingerprint);
    // Der entscheidende Beweis: der im Browser gebildete Fingerprint stimmt mit
    // dem des Servers ueberein. Ohne die Gleitkomma-Hinweise waere er ein anderer.
    if (snapshotChain.serverFingerprint) {
        check('Browser- und Server-Fingerprint stimmen ueberein', snapshotChain.fingerprint === snapshotChain.serverFingerprint, snapshotChain.fingerprint + ' gegen ' + snapshotChain.serverFingerprint);
    }
}
/* --------------------------------------------------------- Kein OOP im DOM */
const noOop = await page.evaluate(function () {
    const state = window.__v9 && window.__v9.store ? window.__v9.store.getState() : null;
    return { hasStore: Boolean(state), storeIsPlain: state ? state.constructor === Object : false };
});
check('Store liefert ein einfaches Objekt (kein Klasseninstanz-Wrapper)', noOop.hasStore && noOop.storeIsPlain, JSON.stringify(noOop));
/* -------------------------------------------------------------- API-Checks */
const api = await page.evaluate(async function () {
    const out = {};
    for (const url of ['/api/v9/config', '/api/device-config', '/api/v9/report',
        '/api/v9/shard/fn-01', '/api/v9/split', '/api/rule-library', '/api/process-library',
        '/api/templates']) {
        try {
            const response = await fetch(url);
            const body = await response.json();
            out[url] = { ok: response.ok, keys: Object.keys(body).length };
        }
        catch (error) {
            out[url] = { ok: false, error: String(error) };
        }
    }
    return out;
});
Object.keys(api).forEach(function (url) {
    check('API erreichbar: ' + url, api[url].ok, JSON.stringify(api[url]));
});
/* ------------------------------------------------------- Pfad-Traversal-Gate */
const traversal = await page.evaluate(async function () {
    const response = await fetch('/api/laden?name=' + encodeURIComponent('../../etc/passwd'));
    return { status: response.status };
});
check('Pfad-Traversal wird abgewiesen', traversal.status === 404 || traversal.status === 400, String(traversal.status));
/* ----------------------------------------------------------------- Ergebnis */
await browser.close();
console.log('bestanden: ' + passed + ' | fehlgeschlagen: ' + failed);
if (consoleErrors.length)
    console.log('Konsolenfehler:', consoleErrors.slice(0, 5));
if (pageErrors.length)
    console.log('Page-Errors:', pageErrors.slice(0, 5));
if (failed) {
    failures.forEach(function (item) {
        return console.log('  FEHLER: ' + item);
    });
    process.exit(1);
}
console.log('SMOKE-TEST BESTANDEN');
