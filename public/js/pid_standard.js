/**
 * pid_standard.js - Functional PF-PID-V1 normalization contract.
 *
 * Known process symbols are upgraded to the canonical geometry and semantic
 * port model. Unknown project fields, bindings, animations, connections and
 * explicitly configured HMI widgets are preserved unchanged.
 */

export const PID_STANDARD_ID = 'PF-PID-V1';
export const PID_STANDARD_VERSION = '1.0';
export const PID_STANDARD_RELEASE = '61.1';
export const TEMPLATE_SCOPE_STANDARD = '__standard__';
export const TEMPLATE_SCOPE_ALL = '__all__';
export const TEMPLATE_SCOPE_LEGACY = '__legacy__';
export const TEMPLATE_SCOPE_HMI = '__hmi__';
export const TEMPLATE_SCOPE_CUSTOM = '__custom__';

export const EXPLICIT_HMI_POLICY = Object.freeze({
    auto_create_widgets: false,
    default_control: null,
    allowed_controls: Object.freeze(['text', 'indicator', 'toggle', 'button', 'slider']),
    button_policy: 'optional_explicit_only',
    process_symbol_drop_policy: 'never_create_control'
});

const DEFAULT_CAPABILITIES = Object.freeze({
    selectable: true,
    movable: true,
    resizable: true,
    rotatable: true,
    connectable: true,
    bindable: true,
    animatable: true,
    configurable: true,
    auto_create_hmi_widgets: false
});

const CONNECTION_KINDS = Object.freeze({
    pipe: Object.freeze(['process', 'utility']),
    signal: Object.freeze(['signal', 'io']),
    data: Object.freeze(['data', 'io']),
    power: Object.freeze(['power'])
});

const RUNTIME_STATES = Object.freeze([
    'ready',
    'running',
    'warning',
    'alarm',
    'disabled',
    'maintenance'
]);

const TAG_PATTERN = /^[A-Z][A-Z0-9]{0,5}-[0-9]{3}[A-Z]?$/;

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
    if (value === null || value === undefined)
        return value;
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        }
        catch (error) {
            // JSON cloning is deterministic for the persisted project model.
        }
    }
    return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value, fallback) {
    const parsed = finiteNumber(value, fallback);
    return parsed > 0 ? parsed : fallback;
}

function textValue(value, fallback) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    return text || String(fallback || '');
}

function clamp01(value) {
    return Math.min(1, Math.max(0, finiteNumber(value, 0)));
}

function normalizeViewBox(value, width, height) {
    let parts = [];
    if (Array.isArray(value)) {
        parts = value.slice(0, 4).map(function (item) {
            return Number(item);
        });
    }
    else if (typeof value === 'string') {
        parts = value.trim().split(/[\s,]+/).slice(0, 4).map(function (item) {
            return Number(item);
        });
    }
    if (parts.length === 4 && parts.every(Number.isFinite)
            && parts[2] > 0 && parts[3] > 0)
        return parts;
    return [0, 0, positiveNumber(width, 100), positiveNumber(height, 100)];
}

function normalizedDirection(value) {
    const direction = textValue(value, 'bidirectional').toLowerCase();
    if (direction === 'in' || direction === 'out' || direction === 'bidirectional')
        return direction;
    return 'bidirectional';
}

function normalizedKind(value) {
    const kind = textValue(value, 'process').toLowerCase();
    if (['process', 'utility', 'signal', 'data', 'power', 'io', 'structure'].includes(kind))
        return kind;
    return 'process';
}

function normalizedRuntimeState(value) {
    const state = textValue(value, 'ready').toLowerCase();
    return RUNTIME_STATES.includes(state) ? state : 'ready';
}

function normalizePort(portValue, index, viewBox) {
    const source = isPlainObject(portValue) ? cloneValue(portValue) : {};
    const fallbackIds = ['left', 'right', 'top', 'bottom'];
    const fallbackId = fallbackIds[index] || ('port_' + String(index + 1));
    const x0 = viewBox[0];
    const y0 = viewBox[1];
    const width = viewBox[2];
    const height = viewBox[3];
    const hasRelative = Number.isFinite(Number(source.rx)) && Number.isFinite(Number(source.ry));
    let x = finiteNumber(source.x, x0 + width / 2);
    let y = finiteNumber(source.y, y0 + height / 2);
    let rx = hasRelative ? clamp01(source.rx) : clamp01((x - x0) / width);
    let ry = hasRelative ? clamp01(source.ry) : clamp01((y - y0) / height);
    if (hasRelative) {
        x = x0 + rx * width;
        y = y0 + ry * height;
    }
    return Object.assign({}, source, {
        id: textValue(source.id, fallbackId),
        name: textValue(source.name, source.id || fallbackId),
        x: x,
        y: y,
        rx: rx,
        ry: ry,
        kind: normalizedKind(source.kind),
        direction: normalizedDirection(source.direction),
        role: textValue(source.role, 'main')
    });
}

function fallbackPorts(viewBox) {
    return [
        normalizePort({ id: 'left', name: 'Links', rx: 0, ry: 0.5, direction: 'in' }, 0, viewBox),
        normalizePort({ id: 'right', name: 'Rechts', rx: 1, ry: 0.5, direction: 'out' }, 1, viewBox),
        normalizePort({ id: 'top', name: 'Oben', rx: 0.5, ry: 0, kind: 'utility' }, 2, viewBox),
        normalizePort({ id: 'bottom', name: 'Unten', rx: 0.5, ry: 1, kind: 'utility' }, 3, viewBox)
    ];
}

function normalizePorts(value, viewBox) {
    const source = Array.isArray(value) ? value : [];
    if (source.length === 0)
        return fallbackPorts(viewBox);
    return source.map(function (portValue, index) {
        return normalizePort(portValue, index, viewBox);
    });
}

function normalizedCapabilities(value) {
    const source = isPlainObject(value) ? value : {};
    const result = {};
    Object.keys(DEFAULT_CAPABILITIES).forEach(function (key) {
        result[key] = Object.prototype.hasOwnProperty.call(source, key)
            ? Boolean(source[key]) : DEFAULT_CAPABILITIES[key];
    });
    result.auto_create_hmi_widgets = false;
    return result;
}

function normalizedHmiPolicy(value) {
    const source = isPlainObject(value) ? value : {};
    return Object.assign({}, EXPLICIT_HMI_POLICY, cloneValue(source), {
        auto_create_widgets: false,
        default_control: null,
        button_policy: 'optional_explicit_only',
        process_symbol_drop_policy: 'never_create_control'
    });
}

function standardFromTemplate(source) {
    const objectStandard = isPlainObject(source.object_standard) ? source.object_standard : {};
    return textValue(source.standard || source.standard_id || objectStandard.id, 'LEGACY');
}

function normalizedRole(source, standard) {
    const role = textValue(source.library_role, '').toLowerCase();
    if (role)
        return role;
    if (standard === PID_STANDARD_ID)
        return 'process';
    if (textValue(source.kategorie, '').toLowerCase() === 'custom')
        return 'custom';
    return 'legacy';
}

export function normalizeTemplate(templateValue) {
    const source = isPlainObject(templateValue) ? cloneValue(templateValue) : {};
    const width = positiveNumber(source.breite ?? source.width, 100);
    const height = positiveNumber(source.hoehe ?? source['höhe'] ?? source.height, 100);
    const viewBox = normalizeViewBox(source.view_box ?? source.viewBox, width, height);
    const standard = standardFromTemplate(source);
    const role = normalizedRole(source, standard);
    const family = textValue(source.family || source.symbol_type, source.id || 'symbol');
    const profile = textValue(source.profile || source.geometry_profile, standard === PID_STANDARD_ID ? 'compact' : 'legacy');
    const capabilities = normalizedCapabilities(source.capabilities || source.interaction);
    const objectStandard = Object.assign({}, isPlainObject(source.object_standard)
        ? source.object_standard : {}, {
        id: standard === PID_STANDARD_ID ? PID_STANDARD_ID : textValue(source.standard_id, standard),
        version: textValue(source.standard_version, standard === PID_STANDARD_ID ? PID_STANDARD_VERSION : ''),
        release: textValue((source.object_standard || {}).release,
            standard === PID_STANDARD_ID ? PID_STANDARD_RELEASE : '')
    });
    return Object.assign({}, source, {
        id: textValue(source.id, 'custom-symbol'),
        name: textValue(source.name, textValue(source.id, 'Symbol').replaceAll('_', ' ')),
        kategorie: textValue(source.kategorie, standard === PID_STANDARD_ID ? 'P&ID V1' : 'Legacy'),
        breite: width,
        hoehe: height,
        view_box: viewBox,
        standard: standard,
        standard_id: textValue(source.standard_id, standard),
        standard_version: textValue(source.standard_version, standard === PID_STANDARD_ID ? PID_STANDARD_VERSION : ''),
        symbol_type: textValue(source.symbol_type || family, source.id || 'symbol'),
        family: family,
        library_role: role,
        default_visible: source.default_visible === true || standard === PID_STANDARD_ID,
        favorite: source.favorite === true,
        sort_order: finiteNumber(source.sort_order, 1000),
        geometry_profile: profile,
        profile: profile,
        tag_prefix: textValue(source.tag_prefix, 'X').toUpperCase(),
        ports: normalizePorts(source.ports, viewBox),
        aliases: Array.isArray(source.aliases) ? cloneValue(source.aliases) : [],
        bindings: Array.isArray(source.bindings) ? cloneValue(source.bindings) : [],
        animierbare_bereiche: Array.isArray(source.animierbare_bereiche)
            ? cloneValue(source.animierbare_bereiche) : [],
        runtime_states: Array.isArray(source.runtime_states) ? cloneValue(source.runtime_states) : [],
        interaction: normalizedCapabilities(source.interaction || source.capabilities),
        capabilities: capabilities,
        object_standard: objectStandard,
        hmi_policy: normalizedHmiPolicy(source.hmi_policy),
        hmi_widget_default: null
    });
}

export function isCanonicalProcessTemplate(templateValue) {
    const template = normalizeTemplate(templateValue);
    return template.standard === PID_STANDARD_ID && template.library_role === 'process';
}

export function templateScope(templateValue) {
    const template = normalizeTemplate(templateValue);
    if (isCanonicalProcessTemplate(template))
        return TEMPLATE_SCOPE_STANDARD;
    if (template.library_role === 'hmi')
        return TEMPLATE_SCOPE_HMI;
    if (template.library_role === 'custom' || template.kategorie.toLowerCase() === 'custom')
        return TEMPLATE_SCOPE_CUSTOM;
    return TEMPLATE_SCOPE_LEGACY;
}

export function matchesTemplateScope(templateValue, scopeValue) {
    const scope = textValue(scopeValue, TEMPLATE_SCOPE_STANDARD);
    if (scope === TEMPLATE_SCOPE_ALL)
        return true;
    if (scope === TEMPLATE_SCOPE_STANDARD)
        return isCanonicalProcessTemplate(templateValue);
    if (scope === TEMPLATE_SCOPE_LEGACY)
        return templateScope(templateValue) === TEMPLATE_SCOPE_LEGACY;
    if (scope === TEMPLATE_SCOPE_HMI)
        return templateScope(templateValue) === TEMPLATE_SCOPE_HMI;
    if (scope === TEMPLATE_SCOPE_CUSTOM)
        return templateScope(templateValue) === TEMPLATE_SCOPE_CUSTOM;
    return normalizeTemplate(templateValue).kategorie === scope;
}

export function compareTemplates(leftValue, rightValue) {
    const left = normalizeTemplate(leftValue);
    const right = normalizeTemplate(rightValue);
    if (left.sort_order !== right.sort_order)
        return left.sort_order - right.sort_order;
    const categoryOrder = left.kategorie.localeCompare(right.kategorie, 'de');
    if (categoryOrder !== 0)
        return categoryOrder;
    return left.name.localeCompare(right.name, 'de');
}

function existingTags(elementsValue) {
    const tags = new Set();
    const elements = Array.isArray(elementsValue) ? elementsValue : [];
    elements.forEach(function (elementValue) {
        const element = isPlainObject(elementValue) ? elementValue : {};
        const properties = isPlainObject(element.properties) ? element.properties : {};
        const tag = textValue(element.tag || properties.tag, '').toUpperCase();
        if (tag)
            tags.add(tag);
    });
    return tags;
}

export function generateEntityTag(prefixValue, elementsValue) {
    const prefix = textValue(prefixValue, 'X').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'X';
    const used = existingTags(elementsValue);
    let sequence = 101;
    let candidate = prefix + '-' + String(sequence).padStart(3, '0');
    while (used.has(candidate)) {
        sequence += 1;
        candidate = prefix + '-' + String(sequence).padStart(3, '0');
    }
    return candidate;
}

function mergePorts(canonicalPortsValue, existingPortsValue, allowCustom) {
    const canonicalPorts = Array.isArray(canonicalPortsValue) ? cloneValue(canonicalPortsValue) : [];
    const existingPorts = Array.isArray(existingPortsValue) ? existingPortsValue : [];
    if (!allowCustom || existingPorts.length === 0)
        return canonicalPorts;
    const byId = new Map();
    canonicalPorts.forEach(function (portValue) {
        byId.set(String(portValue.id), cloneValue(portValue));
    });
    existingPorts.forEach(function (portValue) {
        if (!isPlainObject(portValue))
            return;
        const id = textValue(portValue.id, '');
        if (!id)
            return;
        byId.set(id, Object.assign({}, byId.get(id) || {}, cloneValue(portValue)));
    });
    return Array.from(byId.values());
}

function canonicalGeometry(template) {
    return {
        profile: template.geometry_profile,
        base_width: template.breite,
        base_height: template.hoehe,
        view_box: cloneValue(template.view_box),
        preserve_aspect_ratio: 'xMidYMid meet',
        pivot: 'center'
    };
}

function sourceTag(instance) {
    const properties = isPlainObject(instance.properties) ? instance.properties : {};
    return textValue(instance.tag || properties.tag, '').toUpperCase();
}

export function normalizeInstance(instanceValue, templateValue, existingElementsValue) {
    const source = isPlainObject(instanceValue) ? cloneValue(instanceValue) : {};
    const fallbackTemplate = {
        id: textValue(source.templateId, 'custom-symbol'),
        name: textValue(source.name, 'Custom Symbol'),
        kategorie: 'Custom',
        library_role: 'custom',
        standard: textValue(source.standard, 'CUSTOM'),
        breite: positiveNumber(source.width, 100),
        hoehe: positiveNumber(source.height, 100),
        view_box: source.viewBox,
        ports: source.ports,
        svg: source.svgContent
    };
    const template = normalizeTemplate(isPlainObject(templateValue) ? templateValue : fallbackTemplate);
    const canonical = isCanonicalProcessTemplate(template);
    const sourceStandard = textValue(source.standard || (source.object_standard || {}).id, '');
    const alreadyCanonical = sourceStandard === PID_STANDARD_ID
        || (isPlainObject(source.object_standard) && source.object_standard.canonical === true);
    const customGeometry = source.geometry_custom === true;
    const canonicalGeometryValue = canonicalGeometry(template);
    const sourceGeometry = isPlainObject(source.geometry) ? cloneValue(source.geometry) : {};
    const width = canonical && !alreadyCanonical && !customGeometry
        ? template.breite : positiveNumber(source.width, template.breite);
    const height = canonical && !alreadyCanonical && !customGeometry
        ? template.hoehe : positiveNumber(source.height, template.hoehe);
    const sourceViewBox = source.viewBox || source.view_box || sourceGeometry.view_box;
    const effectiveViewBox = customGeometry || !canonical
        ? normalizeViewBox(sourceViewBox, width, height)
        : cloneValue(template.view_box);
    const geometry = Object.assign({}, canonicalGeometryValue, sourceGeometry, {
        base_width: customGeometry ? positiveNumber(sourceGeometry.base_width, width)
            : canonicalGeometryValue.base_width,
        base_height: customGeometry ? positiveNumber(sourceGeometry.base_height, height)
            : canonicalGeometryValue.base_height,
        view_box: cloneValue(effectiveViewBox),
        preserve_aspect_ratio: textValue(
            sourceGeometry.preserve_aspect_ratio,
            canonicalGeometryValue.preserve_aspect_ratio
        ),
        pivot: textValue(sourceGeometry.pivot, canonicalGeometryValue.pivot)
    });
    const properties = isPlainObject(source.properties) ? cloneValue(source.properties) : {};
    const tag = sourceTag(source) || generateEntityTag(template.tag_prefix, existingElementsValue);
    const description = textValue(source.description || properties.description,
        textValue(source.name, template.name));
    const result = Object.assign({}, source, {
        id: textValue(source.id, 'inst_' + Date.now().toString(36)),
        templateId: textValue(source.templateId, template.id),
        name: textValue(source.name, template.name),
        description: description,
        family: textValue(source.family, template.family),
        tag_prefix: textValue(source.tag_prefix, template.tag_prefix).toUpperCase(),
        tag: tag,
        x: finiteNumber(source.x, 0),
        y: finiteNumber(source.y, 0),
        width: width,
        height: height,
        rotation: finiteNumber(source.rotation, 0),
        scale: positiveNumber(source.scale, 1),
        pivotMode: textValue(source.pivotMode, 'center'),
        pivotX: finiteNumber(source.pivotX, width / 2),
        pivotY: finiteNumber(source.pivotY, height / 2),
        properties: properties,
        bindings: Array.isArray(source.bindings) ? cloneValue(source.bindings) : cloneValue(template.bindings),
        ports: mergePorts(template.ports, source.ports, source.ports_custom === true),
        svgContent: canonical && template.svg && !customGeometry
            ? template.svg : textValue(source.svgContent, template.svg || ''),
        runtimeState: normalizedRuntimeState(
            source.runtimeState || source.runtime_state || properties.runtime_state
        ),
        standard: canonical ? PID_STANDARD_ID : textValue(source.standard, template.standard),
        standardVersion: canonical ? PID_STANDARD_VERSION
            : textValue(source.standardVersion, template.standard_version),
        symbolType: textValue(source.symbolType || source.family, template.symbol_type),
        geometryProfile: textValue(source.geometryProfile, template.geometry_profile),
        viewBox: cloneValue(effectiveViewBox),
        capabilities: normalizedCapabilities(source.capabilities || template.capabilities),
        interaction: normalizedCapabilities(source.interaction || template.interaction),
        geometry: geometry,
        object_standard: Object.assign({}, isPlainObject(source.object_standard)
            ? source.object_standard : {}, {
            id: canonical ? PID_STANDARD_ID : textValue(template.object_standard.id, template.standard),
            version: canonical ? PID_STANDARD_VERSION : textValue(template.object_standard.version, ''),
            release: canonical ? PID_STANDARD_RELEASE : textValue(template.object_standard.release, ''),
            canonical: canonical,
            normalized: true,
            source_template_id: textValue(source.templateId, template.id)
        }),
        hmi_policy: normalizedHmiPolicy(source.hmi_policy || template.hmi_policy),
        hmiWidgetDefault: null,
        animation_targets: Array.isArray(source.animation_targets)
            ? cloneValue(source.animation_targets) : cloneValue(template.animierbare_bereiche)
    });
    result.properties.tag = tag;
    result.properties.description = description;
    result.properties.runtime_state = result.runtimeState;
    const requestedRuntimeState = textValue(
        source.runtimeState || source.runtime_state || properties.runtime_state,
        'ready'
    ).toLowerCase();
    if (requestedRuntimeState !== result.runtimeState)
        result.properties.runtime_state_source = requestedRuntimeState;
    else
        delete result.properties.runtime_state_source;
    result.capabilities.auto_create_hmi_widgets = false;
    result.interaction.auto_create_hmi_widgets = false;
    return result;
}

export function resolveInstancePorts(instanceValue) {
    const instance = isPlainObject(instanceValue) ? instanceValue : {};
    const width = positiveNumber(instance.width, 100);
    const height = positiveNumber(instance.height, 100);
    const viewBox = normalizeViewBox(instance.viewBox || (instance.geometry || {}).view_box, width, height);
    const ports = normalizePorts(instance.ports, viewBox);
    return ports.map(function (portValue) {
        const port = cloneValue(portValue);
        port.x = clamp01(port.rx) * width;
        port.y = clamp01(port.ry) * height;
        return port;
    });
}

export function portAcceptsConnection(portValue, connectionTypeValue, endpointValue) {
    if (!isPlainObject(portValue))
        return false;
    const connectionType = textValue(connectionTypeValue, 'pipe');
    const acceptedKinds = CONNECTION_KINDS[connectionType] || CONNECTION_KINDS.pipe;
    if (!acceptedKinds.includes(normalizedKind(portValue.kind)))
        return false;
    const direction = normalizedDirection(portValue.direction);
    const endpoint = textValue(endpointValue, 'either');
    if (endpoint === 'from')
        return direction !== 'in';
    if (endpoint === 'to')
        return direction !== 'out';
    return true;
}

export function portDirectionAccepts(portValue, endpointValue) {
    if (!isPlainObject(portValue))
        return false;
    const direction = normalizedDirection(portValue.direction);
    const endpoint = textValue(endpointValue, 'either');
    if (endpoint === 'from')
        return direction !== 'in';
    if (endpoint === 'to')
        return direction !== 'out';
    return true;
}

function portKindsCompatible(fromPortValue, toPortValue) {
    const fromKind = normalizedKind((fromPortValue || {}).kind);
    const toKind = normalizedKind((toPortValue || {}).kind);
    return fromKind === toKind || fromKind === 'io' || toKind === 'io';
}

export function portsCompatible(fromPortValue, toPortValue, connectionTypeValue) {
    return portAcceptsConnection(fromPortValue, connectionTypeValue, 'from')
        && portAcceptsConnection(toPortValue, connectionTypeValue, 'to')
        && portKindsCompatible(fromPortValue, toPortValue);
}

function elementCenter(elementValue) {
    const element = isPlainObject(elementValue) ? elementValue : {};
    return {
        x: finiteNumber(element.x, 0) + positiveNumber(element.width, 100) * positiveNumber(element.scale, 1) / 2,
        y: finiteNumber(element.y, 0) + positiveNumber(element.height, 100) * positiveNumber(element.scale, 1) / 2
    };
}

function portWorldApproximation(elementValue, portValue) {
    const element = isPlainObject(elementValue) ? elementValue : {};
    const port = isPlainObject(portValue) ? portValue : {};
    const width = positiveNumber(element.width, 100);
    const height = positiveNumber(element.height, 100);
    const scale = positiveNumber(element.scale, 1);
    const centerX = width / 2;
    const centerY = height / 2;
    const localX = finiteNumber(port.x, centerX);
    const localY = finiteNumber(port.y, centerY);
    const dx = (localX - centerX) * scale;
    const dy = (localY - centerY) * scale;
    const radians = finiteNumber(element.rotation, 0) * Math.PI / 180;
    return {
        x: finiteNumber(element.x, 0) + centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
        y: finiteNumber(element.y, 0) + centerY + dx * Math.sin(radians) + dy * Math.cos(radians)
    };
}

function portPairDistance(fromElementValue, fromPortValue, toElementValue, toPortValue) {
    const fromPoint = portWorldApproximation(fromElementValue, fromPortValue);
    const toPoint = portWorldApproximation(toElementValue, toPortValue);
    const dx = fromPoint.x - toPoint.x;
    const dy = fromPoint.y - toPoint.y;
    return dx * dx + dy * dy;
}

export function choosePortPair(fromElementValue, toElementValue, connectionTypeValue) {
    const fromElement = isPlainObject(fromElementValue) ? fromElementValue : {};
    const toElement = isPlainObject(toElementValue) ? toElementValue : {};
    const fromPorts = resolveInstancePorts(fromElement).filter(function (portValue) {
        return portAcceptsConnection(portValue, connectionTypeValue, 'from');
    });
    const toPorts = resolveInstancePorts(toElement).filter(function (portValue) {
        return portAcceptsConnection(portValue, connectionTypeValue, 'to');
    });
    let selected = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    fromPorts.forEach(function (fromPort) {
        toPorts.forEach(function (toPort) {
            if (!portsCompatible(fromPort, toPort, connectionTypeValue))
                return;
            const distance = portPairDistance(fromElement, fromPort, toElement, toPort);
            if (distance < bestDistance) {
                selected = { fromPort: fromPort, toPort: toPort };
                bestDistance = distance;
            }
        });
    });
    if (!selected)
        return null;
    return {
        fromPort: selected.fromPort.id,
        toPort: selected.toPort.id,
        fromAnchor: { mode: 'port', portId: selected.fromPort.id },
        toAnchor: { mode: 'port', portId: selected.toPort.id }
    };
}

function normalizeAnchor(anchorValue, portIdValue) {
    const anchor = isPlainObject(anchorValue) ? cloneValue(anchorValue) : {};
    const portId = textValue(portIdValue || anchor.portId, '');
    const mode = textValue(anchor.mode, portId ? 'port' : 'auto');
    if (mode === 'fixed') {
        return {
            mode: 'fixed',
            x: finiteNumber(anchor.x, 0),
            y: finiteNumber(anchor.y, 0)
        };
    }
    if (portId)
        return { mode: 'port', portId: portId };
    return { mode: 'auto' };
}

export function normalizeConnection(connectionValue, elementByIdValue) {
    const connection = isPlainObject(connectionValue) ? cloneValue(connectionValue) : {};
    const elementById = typeof elementByIdValue === 'function'
        ? elementByIdValue : function () { return null; };
    connection.type = textValue(connection.type, 'pipe');
    connection.fromAnchor = normalizeAnchor(connection.fromAnchor, connection.fromPort);
    connection.toAnchor = normalizeAnchor(connection.toAnchor, connection.toPort);
    connection.fromPort = connection.fromAnchor.mode === 'port'
        ? connection.fromAnchor.portId : null;
    connection.toPort = connection.toAnchor.mode === 'port'
        ? connection.toAnchor.portId : null;

    const fromElement = elementById(connection.from);
    const toElement = elementById(connection.to);
    const fromPort = connection.fromPort ? portById(fromElement, connection.fromPort) : null;
    const toPort = connection.toPort ? portById(toElement, connection.toPort) : null;
    const fixedOverride = connection.fromAnchor.mode === 'fixed'
        || connection.toAnchor.mode === 'fixed';
    const explicitPairValid = fromPort && toPort
        && portsCompatible(fromPort, toPort, connection.type);

    if (!fixedOverride && !explicitPairValid) {
        const pair = choosePortPair(fromElement, toElement, connection.type);
        if (pair) {
            connection.fromPort = pair.fromPort;
            connection.toPort = pair.toPort;
            connection.fromAnchor = pair.fromAnchor;
            connection.toAnchor = pair.toAnchor;
        }
        else {
            connection.fromPort = null;
            connection.toPort = null;
            connection.fromAnchor = { mode: 'auto' };
            connection.toAnchor = { mode: 'auto' };
        }
    }
    if (connection.fromAnchor.mode === 'fixed')
        connection.fromPort = null;
    if (connection.toAnchor.mode === 'fixed')
        connection.toPort = null;

    connection.routing = textValue(connection.routing, 'orthogonal');
    connection.object_standard = Object.assign({}, isPlainObject(connection.object_standard)
        ? connection.object_standard : {}, {
        id: PID_STANDARD_ID,
        version: PID_STANDARD_VERSION,
        release: PID_STANDARD_RELEASE,
        routing: connection.routing,
        semantic_ports: Boolean(connection.fromPort && connection.toPort),
        manual_anchor_override: fixedOverride
    });
    return connection;
}

function resolveTemplate(templateSource, templateId) {
    if (!templateSource)
        return null;
    if (typeof templateSource === 'function')
        return templateSource(templateId) || null;
    if (typeof templateSource.getTemplate === 'function')
        return templateSource.getTemplate(templateId) || null;
    if (typeof templateSource.get === 'function')
        return templateSource.get(templateId) || null;
    if (isPlainObject(templateSource))
        return templateSource[templateId] || null;
    return null;
}

export function normalizeProjectModel(projectValue, templateSource) {
    const project = isPlainObject(projectValue) ? cloneValue(projectValue) : {};
    const sourceElements = Array.isArray(project.elements) ? project.elements : [];
    const normalizedElements = [];
    sourceElements.forEach(function (elementValue) {
        const template = resolveTemplate(templateSource, elementValue && elementValue.templateId);
        normalizedElements.push(normalizeInstance(elementValue, template, normalizedElements));
    });
    const byId = new Map();
    normalizedElements.forEach(function (elementValue) {
        byId.set(elementValue.id, elementValue);
    });
    const findElement = function (id) {
        return byId.get(id) || null;
    };
    const sourceConnections = Array.isArray(project.connections) ? project.connections : [];
    project.elements = normalizedElements;
    project.connections = sourceConnections.map(function (connectionValue) {
        return normalizeConnection(connectionValue, findElement);
    });
    project.object_standard = Object.assign({}, isPlainObject(project.object_standard)
        ? project.object_standard : {}, {
        id: PID_STANDARD_ID,
        version: PID_STANDARD_VERSION,
        release: PID_STANDARD_RELEASE,
        geometry_normalized: true,
        semantic_ports: true,
        two_line_labels: true,
        hmi_controls: 'optional_explicit_only',
        auto_create_hmi_widgets: false
    });
    return project;
}

export function templateBadge(templateValue) {
    const scope = templateScope(templateValue);
    if (scope === TEMPLATE_SCOPE_STANDARD)
        return 'P&ID V1';
    if (scope === TEMPLATE_SCOPE_HMI)
        return 'HMI optional';
    if (scope === TEMPLATE_SCOPE_CUSTOM)
        return 'Custom';
    return 'Legacy';
}

export function displayLabel(instanceValue) {
    const instance = isPlainObject(instanceValue) ? instanceValue : {};
    const properties = isPlainObject(instance.properties) ? instance.properties : {};
    return {
        tag: textValue(instance.tag || properties.tag, 'X-000'),
        description: textValue(instance.description || properties.description,
            instance.name || instance.templateId || '')
    };
}

export function hmiAutoCreationDisabled(instanceValue) {
    const instance = isPlainObject(instanceValue) ? instanceValue : {};
    const policy = normalizedHmiPolicy(instance.hmi_policy);
    return policy.auto_create_widgets === false && policy.default_control === null;
}

export function portById(instanceValue, portIdValue) {
    const portId = textValue(portIdValue, '');
    return resolveInstancePorts(instanceValue).find(function (portValue) {
        return String(portValue.id) === portId;
    }) || null;
}

export function buildStandardReport(templatesValue, elementsValue, connectionsValue, hmiValue) {
    const templates = Array.isArray(templatesValue) ? templatesValue : [];
    const elements = Array.isArray(elementsValue) ? elementsValue : [];
    const connections = Array.isArray(connectionsValue) ? connectionsValue : [];
    const hmi = isPlainObject(hmiValue) ? hmiValue : {};
    const widgets = Array.isArray(hmi.widgets) ? hmi.widgets : [];
    const canonicalTemplates = templates.filter(isCanonicalProcessTemplate);
    const canonicalElements = elements.filter(function (elementValue) {
        const element = isPlainObject(elementValue) ? elementValue : {};
        return textValue(element.standard || (element.object_standard || {}).id, '') === PID_STANDARD_ID;
    });
    const elementById = new Map();
    elements.forEach(function (elementValue) {
        if (isPlainObject(elementValue) && elementValue.id)
            elementById.set(String(elementValue.id), elementValue);
    });
    const elementViolations = canonicalElements.filter(function (elementValue) {
        const standard = isPlainObject(elementValue.object_standard)
            ? elementValue.object_standard : {};
        const policy = normalizedHmiPolicy(elementValue.hmi_policy);
        const ports = Array.isArray(elementValue.ports) ? elementValue.ports : [];
        const tag = textValue(elementValue.tag || (elementValue.properties || {}).tag, '');
        const runtimeState = normalizedRuntimeState(
            elementValue.runtimeState || (elementValue.properties || {}).runtime_state
        );
        return standard.normalized !== true
            || !TAG_PATTERN.test(tag)
            || ports.length === 0
            || runtimeState !== textValue(
                elementValue.runtimeState || (elementValue.properties || {}).runtime_state,
                'ready'
            ).toLowerCase()
            || policy.auto_create_widgets !== false
            || policy.default_control !== null
            || (elementValue.capabilities || {}).auto_create_hmi_widgets === true;
    });
    const semanticConnections = connections.filter(function (connectionValue) {
        const connection = isPlainObject(connectionValue) ? connectionValue : {};
        return Boolean(connection.fromPort && connection.toPort);
    });
    const connectionViolations = connections.filter(function (connectionValue) {
        const connection = isPlainObject(connectionValue) ? connectionValue : {};
        const fromElement = elementById.get(String(connection.from || ''));
        const toElement = elementById.get(String(connection.to || ''));
        const canonicalEndpoints = [fromElement, toElement].every(function (elementValue) {
            return isPlainObject(elementValue)
                && textValue(elementValue.standard || (elementValue.object_standard || {}).id, '') === PID_STANDARD_ID;
        });
        if (!canonicalEndpoints)
            return false;
        const fixedOverride = (connection.fromAnchor || {}).mode === 'fixed'
            || (connection.toAnchor || {}).mode === 'fixed';
        if (fixedOverride)
            return false;
        const fromPort = portById(fromElement, connection.fromPort);
        const toPort = portById(toElement, connection.toPort);
        return !(fromPort && toPort && portsCompatible(fromPort, toPort, connection.type));
    });
    const automaticWidgets = widgets.filter(function (widgetValue) {
        const widget = isPlainObject(widgetValue) ? widgetValue : {};
        const origin = textValue(widget.origin, '').toLowerCase();
        return widget.auto_created === true || origin === 'auto' || origin === 'automatic';
    });
    const buttons = widgets.filter(function (widgetValue) {
        return isPlainObject(widgetValue) && textValue(widgetValue.type, '').toLowerCase() === 'button';
    });
    const explicitButtons = buttons.filter(function (widgetValue) {
        const origin = textValue(widgetValue.origin, 'explicit').toLowerCase();
        return widgetValue.auto_created !== true && origin !== 'auto' && origin !== 'automatic';
    });
    const valid = canonicalTemplates.length > 0
        && elementViolations.length === 0
        && connectionViolations.length === 0
        && automaticWidgets.length === 0;
    return {
        standard_id: PID_STANDARD_ID,
        standard_version: PID_STANDARD_VERSION,
        release: PID_STANDARD_RELEASE,
        valid: valid,
        canonical_templates: canonicalTemplates.length,
        total_templates: templates.length,
        standardized_elements: canonicalElements.length,
        total_elements: elements.length,
        semantic_connections: semanticConnections.length,
        total_connections: connections.length,
        hmi_widgets: widgets.length,
        optional_buttons: buttons.length,
        explicit_buttons: explicitButtons.length,
        violations: {
            elements: elementViolations.map(function (elementValue) {
                return textValue(elementValue.id, 'unknown');
            }),
            connections: connectionViolations.map(function (connectionValue) {
                return textValue(connectionValue.id, 'unknown');
            }),
            automatic_widgets: automaticWidgets.map(function (widgetValue) {
                return textValue(widgetValue.widget_id || widgetValue.id, 'unknown');
            })
        }
    };
}

export function cloneProjectValue(value) {
    return cloneValue(value);
}
