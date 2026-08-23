/**
 * v61_ui.js - PF-PID-V1 release integration.
 *
 * Keeps optional HMI controls explicit, publishes a machine-readable release
 * report and provides a controlled normalization entry point for migrations.
 */
import { state, showStatus } from './core.js';
import { templateRegistry } from './registry.js';
import {
    PID_STANDARD_ID,
    PID_STANDARD_RELEASE,
    buildStandardReport,
    normalizeProjectModel
} from './pid_standard.js';
import {
    getEngineeringHmiOverlayEnabled,
    refreshEngineeringHmiOverlay,
    setEngineeringHmiOverlayEnabled
} from './hmi.js';

const OVERLAY_STORAGE_KEY = 'pf-v61-engineering-hmi-overlay';

function byId(id) {
    return document.getElementById(id);
}

function readStoredOverlayPreference() {
    try {
        return localStorage.getItem(OVERLAY_STORAGE_KEY) === 'true';
    }
    catch (error) {
        return false;
    }
}

function storeOverlayPreference(enabled) {
    try {
        localStorage.setItem(OVERLAY_STORAGE_KEY, enabled ? 'true' : 'false');
    }
    catch (error) {
        // Persistence is optional; the active setting remains valid.
    }
}

function updateOverlayButton(enabled) {
    const button = byId('btn-hmi-overlay');
    if (!button)
        return;
    const active = enabled === true;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.classList.toggle('is-active', active);
    button.setAttribute(
        'aria-label',
        active
            ? 'Optionale HMI-Bedienelemente ausblenden'
            : 'Optionale HMI-Bedienelemente einblenden'
    );
    button.setAttribute(
        'title',
        active
            ? 'Optionale HMI-Bedienelemente ausblenden'
            : 'Optionale HMI-Bedienelemente einblenden'
    );
    const label = button.querySelector('.hmi-overlay-label');
    if (label)
        label.textContent = active ? 'HMI sichtbar' : 'HMI optional';
}

function setOverlay(enabled, persist) {
    const active = setEngineeringHmiOverlayEnabled(enabled === true);
    updateOverlayButton(active);
    document.body.classList.toggle('engineering-hmi-overlay-enabled', active);
    if (persist !== false)
        storeOverlayPreference(active);
    refreshEngineeringHmiOverlay();
    return active;
}

function templateMap() {
    const result = {};
    templateRegistry.getAllTemplates().forEach(function (template) {
        if (template && template.id)
            result[template.id] = template;
    });
    return result;
}

function collectReport() {
    return buildStandardReport(
        templateRegistry.getAllTemplates(),
        state.get('elements') || [],
        state.get('connections') || [],
        state.get('hmi') || {}
    );
}

function updateStandardBadge(report) {
    const badge = byId('symbol-standard-badge');
    if (!badge)
        return;
    badge.dataset.valid = report.valid ? 'true' : 'false';
    badge.textContent = PID_STANDARD_ID + ' · ' + String(report.canonical_templates);
    badge.title = report.valid
        ? String(report.canonical_templates) + ' normalisierte Prozesssymbole · HMI-Controls nur explizit'
        : 'Objektstandard enthält Abweichungen';
}

function publishReport() {
    const report = collectReport();
    document.documentElement.setAttribute('data-pf-symbol-standard', PID_STANDARD_ID);
    document.documentElement.setAttribute(
        'data-pf-symbol-standard-valid',
        report.valid ? 'true' : 'false'
    );
    updateStandardBadge(report);
    if (window.__pfV61)
        window.__pfV61.report = report;
    state.emit('symbol-standard:report', report);
    return report;
}

function normalizeCurrentProject() {
    const normalized = normalizeProjectModel({
        elements: state.get('elements') || [],
        connections: state.get('connections') || [],
        hmi: state.get('hmi') || {}
    }, templateMap());
    state.set('elements', normalized.elements || []);
    state.set('connections', normalized.connections || []);
    state.set('hmi', normalized.hmi || state.get('hmi') || {});
    state.emit('elements:loaded', state.get('elements'));
    state.emit('connections:loaded', state.get('connections'));
    state.emit('hmi_ui:updated', { reason: 'pf_pid_v1_normalization' });
    state.saveHistory();
    const report = publishReport();
    showStatus(
        String(report.standardized_elements) + ' Objekte nach ' + PID_STANDARD_ID + ' normalisiert',
        report.valid ? 'success' : 'warning'
    );
    return report;
}

function bindOverlayButton() {
    const button = byId('btn-hmi-overlay');
    if (!button)
        return;
    button.addEventListener('click', function () {
        const active = !getEngineeringHmiOverlayEnabled();
        setOverlay(active, true);
        showStatus(
            active
                ? 'Optionale HMI-Bedienelemente eingeblendet'
                : 'Optionale HMI-Bedienelemente ausgeblendet',
            'success',
            1800
        );
    });
}

function installReportHooks() {
    const events = [
        'templates:loaded',
        'templates:reloaded',
        'elements:loaded',
        'elements:rebuilt',
        'element:added',
        'element:updated',
        'element:removed',
        'connection:created',
        'connection:updated',
        'connection:removed',
        'connections:loaded',
        'hmi_ui:updated',
        'history:restored'
    ];
    events.forEach(function (eventName) {
        state.on(eventName, publishReport);
    });
    state.on('hmi-overlay:changed', updateOverlayButton);
}

function init() {
    window.__pfV61 = {
        standard: PID_STANDARD_ID,
        release: PID_STANDARD_RELEASE,
        report: null,
        getReport: collectReport,
        normalize: normalizeCurrentProject,
        setOverlay: function (enabled) {
            return setOverlay(enabled, true);
        },
        getOverlay: getEngineeringHmiOverlayEnabled
    };
    bindOverlayButton();
    installReportHooks();
    setOverlay(readStoredOverlayPreference(), false);
    publishReport();
    window.requestAnimationFrame(publishReport);
    console.log('✓ V61.1 PF-PID-V1 Integration geladen');
}

init();
