/**
 * v64_plant_drawing_model.js
 *
 * Pure data functions for the additive V64 plant drawing workspace.
 * The construction model intentionally references the existing template
 * registry and semantic ports instead of introducing a second symbol truth.
 *
 * V64_r3 adds the assembly layer on top of the unchanged r1/r2 contract:
 * port snapping candidates, zero-length joints (plugged ports), connected
 * components, assembly templates for the drawing inventory, rotation and
 * handle based resizing. Every addition is optional in stored data; older
 * drawings normalize without change.
 *
 * V64_r4 adds linear stretch profiles (pipes keep their caps and arrows while
 * the body stretches), mirroring (flip_x / flip_y), flow inversion, explicit
 * scale modes and a content-driven sheet that grows with the construction.
 *
 * V64_r5 adds the classic optical variant: visual states per entity, layers
 * (process / structure / annotation), routed polylines with line styles,
 * region frames and dimension lines as drawing primitives, and the
 * 'structure' connection kind for frame parts.
 */

export const PLANT_DRAWING_SCHEMA = 'plant-factory.plant-drawing';
export const PLANT_DRAWING_VERSION = 1;
export const ASSEMBLY_TEMPLATE_SCHEMA = 'plant-factory.plant-drawing-assembly';
export const ASSEMBLY_TEMPLATE_VERSION = 1;
export const DEFAULT_SNAP_TOLERANCE = 18;

const CONNECTION_KINDS = ['process', 'utility', 'signal', 'power', 'structure'];
const PRIMITIVE_TYPES = ['line', 'rect', 'ellipse', 'text', 'svg_fragment', 'polyline', 'region', 'dimension'];
const ASSEMBLY_SCOPES = ['library', 'project'];
export const SCALE_MODES = ['uniform', 'stretch', 'free'];
export const DEFAULT_SHEET_MARGIN = 80;
export const DRAWING_LAYERS = ['process', 'structure', 'annotation'];
export const LINE_STYLES = ['plain', 'pipe', 'capillary', 'hot', 'cold', 'coolant', 'purge', 'feed', 'signal'];
export const LABEL_POSITIONS = ['inside', 'above'];
export const LINE_STYLE_PRESETS = Object.freeze({
    plain: Object.freeze({ label: 'Frei (Linienfarbe/-breite)', stroke: '', width: 0, dash: '', dashes: false }),
    pipe: Object.freeze({ label: 'Rohrleitung (schwarz, Laufstriche)', stroke: '#333333', width: 3.5, dash: '', dashes: true }),
    capillary: Object.freeze({ label: 'Kapillare (schwarz, Laufstriche)', stroke: '#333333', width: 3, dash: '', dashes: true }),
    hot: Object.freeze({ label: 'Heiß (rot, Laufstriche)', stroke: '#b33a3a', width: 3.5, dash: '', dashes: true }),
    cold: Object.freeze({ label: 'Kalt (blau, Laufstriche)', stroke: '#2f7fb8', width: 3.5, dash: '', dashes: true }),
    coolant: Object.freeze({ label: 'Kühlwasser (blau, Laufstriche)', stroke: '#2f7fb8', width: 3.5, dash: '', dashes: true }),
    purge: Object.freeze({ label: 'Spülgas (grün, dünn)', stroke: '#2db34a', width: 2, dash: '', dashes: false }),
    feed: Object.freeze({ label: 'Gasleitung (grau, dünn)', stroke: '#888888', width: 2, dash: '', dashes: false }),
    signal: Object.freeze({ label: 'Signal (grau, gestrichelt)', stroke: '#555555', width: 1.2, dash: '4 3', dashes: false })
});

function plainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value, fallback) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function positiveNumber(value, fallback) {
    const numberValue = finiteNumber(value, fallback);
    return numberValue > 0 ? numberValue : fallback;
}

function textValue(value, fallback) {
    const normalized = String(value === undefined || value === null ? '' : value).trim();
    return normalized || fallback;
}

function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizedArray(value) {
    if (Array.isArray(value))
        return value;
    if (plainObject(value))
        return [value];
    return [];
}

function normalizeViewBox(value, width, height) {
    const parts = Array.isArray(value)
        ? value.map(Number)
        : String(value || '').trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite))
        return parts;
    return [0, 0, width, height];
}

function compareIntervals(left, right) {
    return left[0] - right[0];
}

/**
 * A stretch profile describes a linear part: `fixed` viewBox intervals along
 * `axis` keep their native scale (caps, arrows, fittings) while the gaps between
 * them absorb every length change.
 */
export function normalizeStretchProfile(value) {
    if (!plainObject(value))
        return null;
    const axis = value.axis === 'y' ? 'y' : 'x';
    const fixed = normalizedArray(value.fixed).map(function (item) {
        if (!Array.isArray(item) || item.length !== 2)
            return null;
        const start = finiteNumber(item[0], NaN);
        const end = finiteNumber(item[1], NaN);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
            return null;
        return [start, end];
    }).filter(Boolean).sort(compareIntervals);
    return { axis: axis, fixed: fixed };
}

function uniqueId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

function roundValue(value, digits) {
    const factor = Math.pow(10, finiteNumber(digits, 3));
    return Math.round(finiteNumber(value, 0) * factor) / factor;
}

function normalizeAngle(value) {
    const angle = finiteNumber(value, 0) % 360;
    return angle < 0 ? angle + 360 : angle;
}

function pointDistance(left, right) {
    const dx = finiteNumber(left && left.x, 0) - finiteNumber(right && right.x, 0);
    const dy = finiteNumber(left && left.y, 0) - finiteNumber(right && right.y, 0);
    return Math.sqrt(dx * dx + dy * dy);
}

function rotatePoint(point, center, degrees) {
    const radians = finiteNumber(degrees, 0) * Math.PI / 180;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
        x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
        y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians)
    };
}

function boundsOfPoints(points) {
    const xs = points.map(function (point) { return point.x; });
    const ys = points.map(function (point) { return point.y; });
    const minX = Math.min.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxX = Math.max.apply(null, xs);
    const maxY = Math.max.apply(null, ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function createEmptyPlantDrawing() {
    return {
        schema: PLANT_DRAWING_SCHEMA,
        version: PLANT_DRAWING_VERSION,
        active_sheet_id: 'sheet_main',
        sheets: [{
            sheet_id: 'sheet_main',
            name: 'Anlagenskizze',
            width: 1600,
            height: 1000,
            grid: 10,
            margin: DEFAULT_SHEET_MARGIN,
            entities: [],
            connections: [],
            primitives: []
        }],
        custom_templates: [],
        assembly_templates: [],
        inventory: { imported_template_ids: [] }
    };
}

export function normalizeTemplatePorts(templateValue) {
    const template = plainObject(templateValue) ? templateValue : {};
    const width = positiveNumber(template.breite || template.width, 100);
    const height = positiveNumber(template.hoehe || template.height, 100);
    return normalizedArray(template.ports).map(function (port, index) {
        const source = plainObject(port) ? port : {};
        const x = finiteNumber(source.x, finiteNumber(source.rx, 0.5) * width);
        const y = finiteNumber(source.y, finiteNumber(source.ry, 0.5) * height);
        return {
            id: textValue(source.id, 'port_' + (index + 1)),
            name: textValue(source.name, 'Port ' + (index + 1)),
            x: x,
            y: y,
            rx: finiteNumber(source.rx, width ? x / width : 0),
            ry: finiteNumber(source.ry, height ? y / height : 0),
            kind: CONNECTION_KINDS.includes(source.kind) ? source.kind : 'process',
            direction: ['in', 'out', 'bidirectional'].includes(source.direction)
                ? source.direction : 'bidirectional',
            role: textValue(source.role, 'main')
        };
    });
}

export function normalizePlantEntity(value) {
    const source = plainObject(value) ? value : {};
    const width = positiveNumber(source.width, 100);
    const height = positiveNumber(source.height, 100);
    const stretch = normalizeStretchProfile(source.stretch);
    const scaleMode = SCALE_MODES.includes(source.scale_mode)
        ? source.scale_mode : (stretch ? 'stretch' : 'uniform');
    return {
        entity_id: textValue(source.entity_id || source.id, uniqueId('entity')),
        template_id: textValue(source.template_id || source.templateId, ''),
        name: textValue(source.name, textValue(source.template_name, 'Komponente')),
        tag: textValue(source.tag, ''),
        x: finiteNumber(source.x, 0),
        y: finiteNumber(source.y, 0),
        width: width,
        height: height,
        rotation: finiteNumber(source.rotation, 0),
        flip_x: source.flip_x === true,
        flip_y: source.flip_y === true,
        inverted: source.inverted === true,
        scale_mode: scaleMode,
        stretch: stretch,
        view_box: normalizeViewBox(source.view_box, width, height),
        visual_state: textValue(source.visual_state, ''),
        layer: DRAWING_LAYERS.includes(source.layer) ? source.layer : 'process',
        assembly_id: textValue(source.assembly_id, ''),
        assembly_template_id: textValue(source.assembly_template_id, ''),
        assembly_name: textValue(source.assembly_name, ''),
        ports: normalizedArray(source.ports).map(function (port, index) {
            const normalized = plainObject(port) ? cloneValue(port) : {};
            normalized.id = textValue(normalized.id, 'port_' + (index + 1));
            normalized.x = finiteNumber(normalized.x, finiteNumber(normalized.rx, 0.5) * width);
            normalized.y = finiteNumber(normalized.y, finiteNumber(normalized.ry, 0.5) * height);
            normalized.rx = finiteNumber(normalized.rx, width ? normalized.x / width : 0);
            normalized.ry = finiteNumber(normalized.ry, height ? normalized.y / height : 0);
            normalized.kind = CONNECTION_KINDS.includes(normalized.kind) ? normalized.kind : 'process';
            normalized.direction = ['in', 'out', 'bidirectional'].includes(normalized.direction)
                ? normalized.direction : 'bidirectional';
            normalized.name = textValue(normalized.name, normalized.id);
            normalized.role = textValue(normalized.role, 'main');
            return normalized;
        }),
        properties: plainObject(source.properties) ? cloneValue(source.properties) : {}
    };
}

export function normalizePlantConnection(value) {
    const source = plainObject(value) ? value : {};
    const joint = source.joint === true || source.routing === 'direct';
    return {
        connection_id: textValue(source.connection_id || source.id, uniqueId('connection')),
        from_entity_id: textValue(source.from_entity_id, ''),
        from_port_id: textValue(source.from_port_id, ''),
        to_entity_id: textValue(source.to_entity_id, ''),
        to_port_id: textValue(source.to_port_id, ''),
        kind: CONNECTION_KINDS.includes(source.kind) ? source.kind : 'process',
        name: textValue(source.name, ''),
        routing: joint ? 'direct' : textValue(source.routing, 'orthogonal'),
        joint: joint,
        properties: plainObject(source.properties) ? cloneValue(source.properties) : {}
    };
}

export function normalizePlantPoints(value) {
    return normalizedArray(value).map(function (point) {
        if (Array.isArray(point) && point.length >= 2)
            return { x: finiteNumber(point[0], 0), y: finiteNumber(point[1], 0) };
        if (plainObject(point))
            return { x: finiteNumber(point.x, 0), y: finiteNumber(point.y, 0) };
        return null;
    }).filter(Boolean);
}

export function normalizePlantPrimitive(value) {
    const source = plainObject(value) ? value : {};
    const type = PRIMITIVE_TYPES.includes(source.type) ? source.type : 'line';
    const points = type === 'polyline' ? normalizePlantPoints(source.points) : [];
    const first = points.length ? points[0] : null;
    const last = points.length ? points[points.length - 1] : null;
    const annotation = type === 'region' || type === 'dimension';
    return {
        primitive_id: textValue(source.primitive_id || source.id, uniqueId('primitive')),
        type: type,
        x1: finiteNumber(source.x1, first ? first.x : 0),
        y1: finiteNumber(source.y1, first ? first.y : 0),
        x2: finiteNumber(source.x2, last ? last.x : 100),
        y2: finiteNumber(source.y2, last ? last.y : 100),
        points: points,
        line_style: LINE_STYLES.includes(source.line_style) ? source.line_style : 'plain',
        animated: source.animated === true,
        layer: DRAWING_LAYERS.includes(source.layer) ? source.layer : (annotation ? 'annotation' : 'process'),
        label_position: LABEL_POSITIONS.includes(source.label_position) ? source.label_position : 'inside',
        font_family: textValue(source.font_family, ''),
        text_anchor: ['start', 'middle', 'end'].includes(source.text_anchor) ? source.text_anchor : 'start',
        text: textValue(source.text, type === 'dimension' ? '1000 mm' : 'Beschriftung'),
        stroke: textValue(source.stroke, type === 'region' ? '#777777' : (type === 'dimension' ? '#555555' : '#0f172a')),
        fill: textValue(source.fill, type === 'line' || type === 'text' || type === 'polyline' || annotation ? 'none' : '#e2e8f0'),
        stroke_width: positiveNumber(source.stroke_width, type === 'region' ? 1.5 : (type === 'dimension' ? 1 : 2.2)),
        font_size: positiveNumber(source.font_size, type === 'region' ? 12 : (type === 'dimension' ? 13 : 16)),
        markup: type === 'svg_fragment' ? textValue(source.markup, '<g></g>') : '',
        source_x: finiteNumber(source.source_x, finiteNumber(source.x1, 0)),
        source_y: finiteNumber(source.source_y, finiteNumber(source.y1, 0)),
        element_name: type === 'svg_fragment' ? textValue(source.element_name, 'g') : '',
        label: type === 'svg_fragment' ? textValue(source.label, 'SVG-Fragment') : textValue(source.label, ''),
        event_target: type === 'svg_fragment' ? textValue(source.event_target, '') : '',
        selectable: type !== 'svg_fragment' || source.selectable !== false,
        original_index: Math.max(0, Math.round(finiteNumber(source.original_index, 0))),
        assembly_id: textValue(source.assembly_id, '')
    };
}

export function normalizeAssemblyTemplate(value) {
    const source = plainObject(value) ? cloneValue(value) : {};
    const width = positiveNumber(source.width, 100);
    const height = positiveNumber(source.height, 100);
    const entities = normalizedArray(source.entities).map(normalizePlantEntity);
    const entityIds = new Set(entities.map(function (entity) { return entity.entity_id; }));
    return {
        schema: ASSEMBLY_TEMPLATE_SCHEMA,
        version: ASSEMBLY_TEMPLATE_VERSION,
        assembly_template_id: textValue(source.assembly_template_id || source.id, uniqueId('assembly_template')),
        name: textValue(source.name, 'Baugruppe'),
        category: textValue(source.category || source.kategorie, 'Baugruppen'),
        description: textValue(source.description, ''),
        scope: ASSEMBLY_SCOPES.includes(source.scope) ? source.scope : 'project',
        created_at: textValue(source.created_at, ''),
        width: width,
        height: height,
        entities: entities,
        connections: normalizedArray(source.connections).map(normalizePlantConnection).filter(function (connection) {
            return entityIds.has(connection.from_entity_id) && entityIds.has(connection.to_entity_id);
        }),
        primitives: normalizedArray(source.primitives).map(normalizePlantPrimitive),
        exposed_ports: normalizedArray(source.exposed_ports).map(function (port, index) {
            const item = plainObject(port) ? cloneValue(port) : {};
            item.id = textValue(item.id, 'port_' + (index + 1));
            item.name = textValue(item.name, item.id);
            item.entity_id = textValue(item.entity_id, '');
            item.port_id = textValue(item.port_id, '');
            item.x = finiteNumber(item.x, 0);
            item.y = finiteNumber(item.y, 0);
            item.rx = finiteNumber(item.rx, width ? item.x / width : 0);
            item.ry = finiteNumber(item.ry, height ? item.y / height : 0);
            item.kind = CONNECTION_KINDS.includes(item.kind) ? item.kind : 'process';
            item.direction = ['in', 'out', 'bidirectional'].includes(item.direction)
                ? item.direction : 'bidirectional';
            item.role = textValue(item.role, 'main');
            return item;
        }),
        template_ids: Array.from(new Set(entities.map(function (entity) { return entity.template_id; }).filter(Boolean)))
    };
}

export function normalizePlantDrawing(value) {
    const source = plainObject(value) ? cloneValue(value) : createEmptyPlantDrawing();
    const sourceSheets = Array.isArray(source.sheets) && source.sheets.length
        ? source.sheets : createEmptyPlantDrawing().sheets;
    const sheets = sourceSheets.map(function (sheet, index) {
        const item = plainObject(sheet) ? sheet : {};
        return {
            sheet_id: textValue(item.sheet_id, 'sheet_' + (index + 1)),
            name: textValue(item.name, 'Anlagenskizze ' + (index + 1)),
            width: positiveNumber(item.width, 1600),
            height: positiveNumber(item.height, 1000),
            grid: positiveNumber(item.grid, 10),
            // r5: per-sheet auto-grow margin; reference reproductions use a
            // small margin so the sheet keeps the exact reference size.
            margin: Math.max(0, finiteNumber(item.margin, DEFAULT_SHEET_MARGIN)),
            entities: normalizedArray(item.entities).map(normalizePlantEntity),
            connections: normalizedArray(item.connections).map(normalizePlantConnection),
            primitives: normalizedArray(item.primitives).map(normalizePlantPrimitive),
            reference: plainObject(item.reference) ? cloneValue(item.reference) : null
        };
    });
    const activeId = sheets.some(function (sheet) {
        return sheet.sheet_id === source.active_sheet_id;
    }) ? source.active_sheet_id : sheets[0].sheet_id;
    const inventory = plainObject(source.inventory) ? source.inventory : {};
    return {
        schema: PLANT_DRAWING_SCHEMA,
        version: PLANT_DRAWING_VERSION,
        active_sheet_id: activeId,
        sheets: sheets,
        custom_templates: normalizedArray(source.custom_templates),
        assembly_templates: normalizedArray(source.assembly_templates).map(normalizeAssemblyTemplate),
        inventory: {
            imported_template_ids: Array.from(new Set(normalizedArray(inventory.imported_template_ids)
                .map(function (id) { return textValue(id, ''); }).filter(Boolean)))
        }
    };
}

export function getActivePlantSheet(modelValue) {
    const model = normalizePlantDrawing(modelValue);
    return model.sheets.find(function (sheet) {
        return sheet.sheet_id === model.active_sheet_id;
    }) || model.sheets[0];
}

export function updateActivePlantSheet(modelValue, updater) {
    const model = normalizePlantDrawing(modelValue);
    model.sheets = model.sheets.map(function (sheet) {
        if (sheet.sheet_id !== model.active_sheet_id)
            return sheet;
        const updated = updater(cloneValue(sheet));
        return updated || sheet;
    });
    return model;
}

export function snapPlantValue(value, sheet, enabled) {
    const numeric = finiteNumber(value, 0);
    if (!enabled)
        return numeric;
    const grid = positiveNumber(sheet && sheet.grid, 10);
    return Math.round(numeric / grid) * grid;
}

export function createPlantEntity(templateValue, x, y, optionsValue) {
    const template = plainObject(templateValue) ? templateValue : {};
    const options = plainObject(optionsValue) ? optionsValue : {};
    const width = positiveNumber(options.width, positiveNumber(template.breite || template.width, 100));
    const height = positiveNumber(options.height, positiveNumber(template.hoehe || template.height, 100));
    const stretch = normalizeStretchProfile(template.stretch);
    const entity = normalizePlantEntity({
        entity_id: uniqueId('entity'),
        template_id: textValue(template.id, ''),
        name: textValue(options.name, textValue(template.name, textValue(template.id, 'Komponente'))),
        tag: textValue(options.tag, ''),
        x: finiteNumber(x, 0),
        y: finiteNumber(y, 0),
        width: width,
        height: height,
        rotation: finiteNumber(options.rotation, 0),
        flip_x: options.flip_x === true,
        flip_y: options.flip_y === true,
        inverted: false,
        scale_mode: SCALE_MODES.includes(options.scale_mode) ? options.scale_mode : (stretch ? 'stretch' : 'uniform'),
        stretch: stretch,
        view_box: templateViewBox(template),
        visual_state: textValue(options.visual_state, textValue(template.default_visual_state, '')),
        layer: DRAWING_LAYERS.includes(options.layer) ? options.layer
            : (DRAWING_LAYERS.includes(template.layer) ? template.layer : 'process'),
        assembly_id: textValue(options.assembly_id, ''),
        ports: normalizeTemplatePorts(template),
        properties: plainObject(options.properties) ? options.properties : {}
    });
    const refreshed = refreshPlantEntityPorts(entity);
    return options.inverted === true ? invertPlantEntity(refreshed) : refreshed;
}

// ---------------------------------------------------------------------------
// V64_r4 · stretch mapping, mirroring, inversion and port placement
// ---------------------------------------------------------------------------

/**
 * Map template coordinates along the stretch axis to entity coordinates.
 * Fixed intervals keep the cross-axis scale, flexible gaps share the rest.
 */
export function plantStretchMap(stretchValue, viewBoxValue, widthValue, heightValue) {
    const stretch = normalizeStretchProfile(stretchValue);
    const viewBox = normalizeViewBox(viewBoxValue, widthValue, heightValue);
    const width = positiveNumber(widthValue, viewBox[2]);
    const height = positiveNumber(heightValue, viewBox[3]);
    const axis = stretch ? stretch.axis : 'x';
    const nativeStart = axis === 'x' ? viewBox[0] : viewBox[1];
    const nativeLength = Math.max(1, axis === 'x' ? viewBox[2] : viewBox[3]);
    const targetLength = axis === 'x' ? width : height;
    const crossScale = axis === 'x'
        ? height / Math.max(1, viewBox[3]) : width / Math.max(1, viewBox[2]);
    const segments = [];
    let cursor = nativeStart;
    const fixed = stretch ? stretch.fixed : [];
    fixed.forEach(function (interval) {
        const start = Math.max(cursor, Math.min(nativeStart + nativeLength, interval[0]));
        const end = Math.max(start, Math.min(nativeStart + nativeLength, interval[1]));
        if (start > cursor)
            segments.push({ start: cursor, end: start, fixed: false });
        if (end > start)
            segments.push({ start: start, end: end, fixed: true });
        cursor = Math.max(cursor, end);
    });
    if (cursor < nativeStart + nativeLength)
        segments.push({ start: cursor, end: nativeStart + nativeLength, fixed: false });
    if (!segments.length)
        segments.push({ start: nativeStart, end: nativeStart + nativeLength, fixed: false });
    const fixedNative = segments.reduce(function (sum, segment) {
        return sum + (segment.fixed ? segment.end - segment.start : 0);
    }, 0);
    const flexNative = Math.max(0, nativeLength - fixedNative);
    const fixedTarget = fixedNative * crossScale;
    let flexScale = flexNative > 0 ? Math.max(0, targetLength - fixedTarget) / flexNative : 0;
    let fixedScale = crossScale;
    if (targetLength < fixedTarget || flexNative === 0) {
        // Too short for the caps: compress everything uniformly along the axis.
        fixedScale = targetLength / nativeLength;
        flexScale = fixedScale;
    }
    let offset = 0;
    segments.forEach(function (segment) {
        const scale = segment.fixed ? fixedScale : flexScale;
        segment.offset = offset;
        segment.scale = scale;
        segment.length = (segment.end - segment.start) * scale;
        offset += segment.length;
    });
    function map(nativeValue) {
        const value = finiteNumber(nativeValue, nativeStart);
        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index];
            const last = index === segments.length - 1;
            if (value <= segment.end || last)
                return segment.offset + (value - segment.start) * segment.scale;
        }
        return 0;
    }
    return {
        axis: axis,
        segments: segments,
        cross_scale: crossScale,
        view_box: viewBox,
        width: width,
        height: height,
        map: map
    };
}

/**
 * Local port position of an entity derived from the relative template
 * coordinates, the stretch profile and the mirror flags.
 */
export function plantEntityPortLocalPoint(entityValue, portValue) {
    const entity = normalizePlantEntity(entityValue);
    const port = plainObject(portValue) ? portValue : {};
    const viewBox = entity.view_box;
    const rx = finiteNumber(port.rx, 0.5);
    const ry = finiteNumber(port.ry, 0.5);
    let x = rx * entity.width;
    let y = ry * entity.height;
    if (entity.stretch && entity.scale_mode === 'stretch') {
        const mapping = plantStretchMap(entity.stretch, viewBox, entity.width, entity.height);
        if (mapping.axis === 'x')
            x = mapping.map(viewBox[0] + rx * viewBox[2]);
        else
            y = mapping.map(viewBox[1] + ry * viewBox[3]);
    }
    if (entity.flip_x)
        x = entity.width - x;
    if (entity.flip_y)
        y = entity.height - y;
    return { x: roundValue(x, 3), y: roundValue(y, 3) };
}

/** Recompute the stored port coordinates from relative coordinates and flags. */
export function refreshPlantEntityPorts(entityValue) {
    const entity = normalizePlantEntity(entityValue);
    entity.ports = entity.ports.map(function (port) {
        const point = plantEntityPortLocalPoint(entity, port);
        port.x = point.x;
        port.y = point.y;
        return port;
    });
    return entity;
}

export function flipPlantEntity(entityValue, axisValue) {
    const entity = normalizePlantEntity(entityValue);
    if (axisValue === 'y')
        entity.flip_y = !entity.flip_y;
    else
        entity.flip_x = !entity.flip_x;
    return refreshPlantEntityPorts(entity);
}

/**
 * Invert the flow direction: inlets become outlets and vice versa; the
 * renderer reverses the flow arrows of the template accordingly.
 */
export function invertPlantEntity(entityValue, forceValue) {
    const entity = normalizePlantEntity(entityValue);
    const targetState = typeof forceValue === 'boolean' ? forceValue : !entity.inverted;
    if (targetState === entity.inverted)
        return entity;
    entity.inverted = targetState;
    entity.ports = entity.ports.map(function (port) {
        if (port.direction === 'in')
            port.direction = 'out';
        else if (port.direction === 'out')
            port.direction = 'in';
        return port;
    });
    return entity;
}

export function setPlantEntityScaleMode(entityValue, modeValue) {
    const entity = normalizePlantEntity(entityValue);
    entity.scale_mode = SCALE_MODES.includes(modeValue) ? modeValue : entity.scale_mode;
    if (entity.scale_mode === 'stretch' && !entity.stretch)
        entity.scale_mode = 'free';
    return refreshPlantEntityPorts(entity);
}

export function setPlantEntityVisualState(entityValue, stateValue) {
    const entity = normalizePlantEntity(entityValue);
    entity.visual_state = textValue(stateValue, '');
    return entity;
}

export function setPlantEntityLayer(entityValue, layerValue) {
    const entity = normalizePlantEntity(entityValue);
    entity.layer = DRAWING_LAYERS.includes(layerValue) ? layerValue : entity.layer;
    return entity;
}

export function lineStylePreset(styleValue) {
    return LINE_STYLE_PRESETS[LINE_STYLES.includes(styleValue) ? styleValue : 'plain'];
}

export function plantEntityTransformSummary(entityValue) {
    const entity = normalizePlantEntity(entityValue);
    const parts = [];
    if (entity.rotation)
        parts.push(entity.rotation + '°');
    if (entity.flip_x)
        parts.push('gespiegelt X');
    if (entity.flip_y)
        parts.push('gespiegelt Y');
    if (entity.inverted)
        parts.push('invertiert');
    if (entity.scale_mode === 'stretch')
        parts.push('gestreckt');
    else if (entity.scale_mode === 'free')
        parts.push('frei skaliert');
    return parts.join(' · ');
}

export function resizePlantEntityPorts(entityValue, widthValue, heightValue) {
    const entity = normalizePlantEntity(entityValue);
    entity.width = positiveNumber(widthValue, entity.width);
    entity.height = positiveNumber(heightValue, entity.height);
    return refreshPlantEntityPorts(entity);
}

export function findPlantEntity(sheet, entityId) {
    return normalizedArray(sheet && sheet.entities).find(function (entity) {
        return entity.entity_id === entityId;
    }) || null;
}

export function findPlantPort(entityValue, portId) {
    const entity = entityValue ? normalizePlantEntity(entityValue) : null;
    if (!entity)
        return null;
    return entity.ports.find(function (port) {
        return port.id === portId;
    }) || null;
}

export function plantPortWorldPoint(entityValue, portValue) {
    const entity = normalizePlantEntity(entityValue);
    const port = plainObject(portValue) ? portValue : {};
    const localX = finiteNumber(port.x, finiteNumber(port.rx, 0.5) * entity.width);
    const localY = finiteNumber(port.y, finiteNumber(port.ry, 0.5) * entity.height);
    const centerX = entity.width / 2;
    const centerY = entity.height / 2;
    const radians = entity.rotation * Math.PI / 180;
    const dx = localX - centerX;
    const dy = localY - centerY;
    return {
        x: entity.x + centerX + (dx * Math.cos(radians)) - (dy * Math.sin(radians)),
        y: entity.y + centerY + (dx * Math.sin(radians)) + (dy * Math.cos(radians))
    };
}

export function plantConnectionPoints(sheet, connectionValue) {
    const connection = normalizePlantConnection(connectionValue);
    const fromEntity = findPlantEntity(sheet, connection.from_entity_id);
    const toEntity = findPlantEntity(sheet, connection.to_entity_id);
    const fromPort = findPlantPort(fromEntity, connection.from_port_id);
    const toPort = findPlantPort(toEntity, connection.to_port_id);
    if (!fromEntity || !toEntity || !fromPort || !toPort)
        return null;
    return {
        from: plantPortWorldPoint(fromEntity, fromPort),
        to: plantPortWorldPoint(toEntity, toPort)
    };
}

export function plantOrthogonalPath(fromPoint, toPoint) {
    const from = fromPoint || { x: 0, y: 0 };
    const to = toPoint || { x: 0, y: 0 };
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (dx >= dy) {
        const middleX = (from.x + to.x) / 2;
        return 'M' + from.x + ' ' + from.y + ' H' + middleX + ' V' + to.y + ' H' + to.x;
    }
    const middleY = (from.y + to.y) / 2;
    return 'M' + from.x + ' ' + from.y + ' V' + middleY + ' H' + to.x + ' V' + to.y;
}

export function validatePlantPortPair(fromPortValue, toPortValue, selectedKind) {
    const fromPort = plainObject(fromPortValue) ? fromPortValue : {};
    const toPort = plainObject(toPortValue) ? toPortValue : {};
    const errors = [];
    const warnings = [];
    if (!fromPort.id || !toPort.id)
        errors.push('Beide Endpunkte benötigen einen semantischen Port.');
    const kind = CONNECTION_KINDS.includes(selectedKind) ? selectedKind : 'process';
    if (fromPort.kind && fromPort.kind !== kind)
        warnings.push('Der Startport ist als ' + fromPort.kind + ' klassifiziert.');
    if (toPort.kind && toPort.kind !== kind)
        warnings.push('Der Zielport ist als ' + toPort.kind + ' klassifiziert.');
    if (fromPort.direction === 'in' && toPort.direction === 'out')
        warnings.push('Die Flussrichtung wurde automatisch vom Ausgang zum Eingang gedreht.');
    if (fromPort.direction === 'out' && toPort.direction === 'out')
        warnings.push('Zwei Ausgänge werden miteinander verbunden.');
    if (fromPort.direction === 'in' && toPort.direction === 'in')
        warnings.push('Zwei Eingänge werden miteinander verbunden.');
    return { valid: errors.length === 0, errors: errors, warnings: warnings };
}

export function createPlantConnection(sheet, fromRefValue, toRefValue, kindValue, optionsValue) {
    const fromRef = plainObject(fromRefValue) ? fromRefValue : {};
    const toRef = plainObject(toRefValue) ? toRefValue : {};
    const options = plainObject(optionsValue) ? optionsValue : {};
    let fromEntity = findPlantEntity(sheet, fromRef.entity_id);
    let toEntity = findPlantEntity(sheet, toRef.entity_id);
    let fromPort = findPlantPort(fromEntity, fromRef.port_id);
    let toPort = findPlantPort(toEntity, toRef.port_id);
    if (!fromEntity || !toEntity || !fromPort || !toPort)
        throw new Error('Die gewählten Ports sind nicht mehr verfügbar.');
    const result = validatePlantPortPair(fromPort, toPort, kindValue);
    if (!result.valid)
        throw new Error(result.errors.join(' '));
    if (fromPort.direction === 'in' && toPort.direction === 'out') {
        const oldEntity = fromEntity;
        const oldPort = fromPort;
        fromEntity = toEntity;
        fromPort = toPort;
        toEntity = oldEntity;
        toPort = oldPort;
    }
    return {
        connection: normalizePlantConnection({
            connection_id: uniqueId('connection'),
            from_entity_id: fromEntity.entity_id,
            from_port_id: fromPort.id,
            to_entity_id: toEntity.entity_id,
            to_port_id: toPort.id,
            kind: CONNECTION_KINDS.includes(kindValue) ? kindValue : 'process',
            routing: options.joint === true ? 'direct' : 'orthogonal',
            joint: options.joint === true
        }),
        warnings: result.warnings
    };
}

export function plantEntityBounds(entityValue) {
    const entity = normalizePlantEntity(entityValue);
    const radians = entity.rotation * Math.PI / 180;
    const rotatedWidth = Math.abs(entity.width * Math.cos(radians))
        + Math.abs(entity.height * Math.sin(radians));
    const rotatedHeight = Math.abs(entity.width * Math.sin(radians))
        + Math.abs(entity.height * Math.cos(radians));
    return {
        x: entity.x + entity.width / 2 - rotatedWidth / 2,
        y: entity.y + entity.height / 2 - rotatedHeight / 2,
        width: rotatedWidth,
        height: rotatedHeight
    };
}

export function plantPrimitiveBounds(primitiveValue) {
    const primitive = normalizePlantPrimitive(primitiveValue);
    if (primitive.type === 'polyline' && primitive.points.length) {
        const bounds = boundsOfPoints(primitive.points);
        return { x: bounds.x, y: bounds.y, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
    }
    const x = Math.min(primitive.x1, primitive.x2);
    const y = Math.min(primitive.y1, primitive.y2);
    if (primitive.type === 'text') {
        const width = Math.max(50, primitive.text.length * primitive.font_size * 0.58);
        const shift = primitive.text_anchor === 'middle' ? width / 2 : (primitive.text_anchor === 'end' ? width : 0);
        return {
            x: primitive.x1 - shift,
            y: primitive.y1 - primitive.font_size,
            width: width,
            height: primitive.font_size * 1.4
        };
    }
    return {
        x: x,
        y: y,
        width: Math.max(1, Math.abs(primitive.x2 - primitive.x1)),
        height: Math.max(1, Math.abs(primitive.y2 - primitive.y1))
    };
}

export function plantEntityVisualBounds(entityValue, viewBoxValue) {
    const entity = normalizePlantEntity(entityValue);
    const viewBox = normalizeViewBox(viewBoxValue, entity.width, entity.height);
    const scale = Math.min(entity.width / Math.max(1, viewBox[2]), entity.height / Math.max(1, viewBox[3]));
    const contentWidth = Math.max(1, viewBox[2] * scale);
    const contentHeight = Math.max(1, viewBox[3] * scale);
    const localX = (entity.width - contentWidth) / 2;
    const localY = (entity.height - contentHeight) / 2;
    const centerX = entity.width / 2;
    const centerY = entity.height / 2;
    const radians = entity.rotation * Math.PI / 180;
    const corners = [
        [localX, localY],
        [localX + contentWidth, localY],
        [localX + contentWidth, localY + contentHeight],
        [localX, localY + contentHeight]
    ].map(function (point) {
        const dx = point[0] - centerX;
        const dy = point[1] - centerY;
        return {
            x: entity.x + centerX + (dx * Math.cos(radians)) - (dy * Math.sin(radians)),
            y: entity.y + centerY + (dx * Math.sin(radians)) + (dy * Math.cos(radians))
        };
    });
    return boundsOfPoints(corners);
}

export function plantSelectionBounds(sheet, selectionValue) {
    const selection = plainObject(selectionValue) ? selectionValue : {};
    const entityIds = new Set(normalizedArray(selection.entity_ids));
    const primitiveIds = new Set(normalizedArray(selection.primitive_ids));
    const bounds = [];
    normalizedArray(sheet && sheet.entities).forEach(function (entity) {
        if (entityIds.has(entity.entity_id))
            bounds.push(plantEntityBounds(entity));
    });
    normalizedArray(sheet && sheet.primitives).forEach(function (primitive) {
        if (primitiveIds.has(primitive.primitive_id))
            bounds.push(plantPrimitiveBounds(primitive));
    });
    if (!bounds.length)
        return null;
    const minX = Math.min.apply(null, bounds.map(function (bound) { return bound.x; }));
    const minY = Math.min.apply(null, bounds.map(function (bound) { return bound.y; }));
    const maxX = Math.max.apply(null, bounds.map(function (bound) { return bound.x + bound.width; }));
    const maxY = Math.max.apply(null, bounds.map(function (bound) { return bound.y + bound.height; }));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/** Move one primitive (including routed points) by a delta. */
export function translatePlantPrimitive(primitiveValue, dx, dy) {
    const primitive = normalizePlantPrimitive(primitiveValue);
    const deltaX = finiteNumber(dx, 0);
    const deltaY = finiteNumber(dy, 0);
    primitive.x1 = roundValue(primitive.x1 + deltaX, 3);
    primitive.y1 = roundValue(primitive.y1 + deltaY, 3);
    primitive.x2 = roundValue(primitive.x2 + deltaX, 3);
    primitive.y2 = roundValue(primitive.y2 + deltaY, 3);
    primitive.points = primitive.points.map(function (point) {
        return { x: roundValue(point.x + deltaX, 3), y: roundValue(point.y + deltaY, 3) };
    });
    return primitive;
}

export function plantContentBounds(sheet) {
    const bounds = [];
    normalizedArray(sheet && sheet.entities).forEach(function (entity) {
        bounds.push(plantEntityBounds(entity));
    });
    normalizedArray(sheet && sheet.primitives).forEach(function (primitive) {
        bounds.push(plantPrimitiveBounds(primitive));
    });
    if (!bounds.length)
        return null;
    const minX = Math.min.apply(null, bounds.map(function (bound) { return bound.x; }));
    const minY = Math.min.apply(null, bounds.map(function (bound) { return bound.y; }));
    const maxX = Math.max.apply(null, bounds.map(function (bound) { return bound.x + bound.width; }));
    const maxY = Math.max.apply(null, bounds.map(function (bound) { return bound.y + bound.height; }));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/**
 * Grow the active sheet so that every part lies inside it. Content above or
 * left of the origin is shifted into the sheet; the shift is reported so the
 * view can follow. With `shrink` the sheet is fitted tightly around the content.
 */
export function fitPlantSheetToContent(modelValue, optionsValue) {
    const options = plainObject(optionsValue) ? optionsValue : {};
    const minimumWidth = positiveNumber(options.minimum_width, 400);
    const minimumHeight = positiveNumber(options.minimum_height, 300);
    const model = normalizePlantDrawing(modelValue);
    const sheet = getActivePlantSheet(model);
    // An explicit option wins, otherwise the sheet carries its own margin (r5).
    const margin = Math.max(0, finiteNumber(options.margin, finiteNumber(sheet.margin, DEFAULT_SHEET_MARGIN)));
    const bounds = plantContentBounds(sheet);
    if (!bounds)
        return { model: model, dx: 0, dy: 0, changed: false, bounds: null };
    const grid = positiveNumber(sheet.grid, 10);
    const dx = bounds.x < margin ? Math.ceil((margin - bounds.x) / grid) * grid : 0;
    const dy = bounds.y < margin ? Math.ceil((margin - bounds.y) / grid) * grid : 0;
    const requiredWidth = Math.ceil((bounds.x + dx + bounds.width + margin) / grid) * grid;
    const requiredHeight = Math.ceil((bounds.y + dy + bounds.height + margin) / grid) * grid;
    const width = options.shrink === true
        ? Math.max(minimumWidth, requiredWidth) : Math.max(sheet.width, requiredWidth);
    const height = options.shrink === true
        ? Math.max(minimumHeight, requiredHeight) : Math.max(sheet.height, requiredHeight);
    const changed = dx !== 0 || dy !== 0 || width !== sheet.width || height !== sheet.height;
    if (!changed)
        return { model: model, dx: 0, dy: 0, changed: false, bounds: bounds };
    const updated = updateActivePlantSheet(model, function (draft) {
        draft.width = width;
        draft.height = height;
        if (dx || dy) {
            draft.entities = draft.entities.map(function (entity) {
                entity.x = roundValue(entity.x + dx, 3);
                entity.y = roundValue(entity.y + dy, 3);
                return entity;
            });
            draft.primitives = draft.primitives.map(function (primitive) {
                return translatePlantPrimitive(primitive, dx, dy);
            });
        }
        return draft;
    });
    return { model: updated, dx: dx, dy: dy, changed: true, bounds: bounds };
}

export function validatePlantDrawing(modelValue, templateLookup) {
    const model = normalizePlantDrawing(modelValue);
    const errors = [];
    const warnings = [];
    const ids = new Set();
    let openJoints = 0;
    model.sheets.forEach(function (sheet) {
        const entityIds = new Set();
        sheet.entities.forEach(function (entity) {
            if (ids.has(entity.entity_id))
                errors.push('Doppelte Entity-ID: ' + entity.entity_id);
            ids.add(entity.entity_id);
            entityIds.add(entity.entity_id);
            if (!entity.template_id)
                errors.push('Entity ' + entity.entity_id + ' hat kein Template.');
            else if (typeof templateLookup === 'function' && !templateLookup(entity.template_id))
                warnings.push('Template nicht geladen: ' + entity.template_id);
            if (!entity.ports.length)
                warnings.push(entity.name + ' besitzt keine semantischen Ports.');
        });
        const connectionIds = new Set();
        sheet.connections.forEach(function (connection) {
            if (connectionIds.has(connection.connection_id))
                errors.push('Doppelte Verbindungs-ID: ' + connection.connection_id);
            connectionIds.add(connection.connection_id);
            const fromEntity = findPlantEntity(sheet, connection.from_entity_id);
            const toEntity = findPlantEntity(sheet, connection.to_entity_id);
            if (!fromEntity || !toEntity) {
                errors.push('Verbindung ' + connection.connection_id + ' verweist auf eine fehlende Entity.');
                return;
            }
            if (!findPlantPort(fromEntity, connection.from_port_id)
                || !findPlantPort(toEntity, connection.to_port_id)) {
                errors.push('Verbindung ' + connection.connection_id + ' verweist auf einen fehlenden Port.');
                return;
            }
            if (connection.joint && plantJointGap(sheet, connection) > 0.5)
                openJoints += 1;
        });
    });
    if (openJoints)
        warnings.push(openJoints + ' gesteckte Verbindung(en) sind geöffnet · Teile wieder zusammenziehen.');
    return {
        valid: errors.length === 0,
        errors: errors,
        warnings: warnings,
        counts: {
            sheets: model.sheets.length,
            entities: model.sheets.reduce(function (sum, sheet) { return sum + sheet.entities.length; }, 0),
            connections: model.sheets.reduce(function (sum, sheet) { return sum + sheet.connections.length; }, 0),
            joints: model.sheets.reduce(function (sum, sheet) {
                return sum + sheet.connections.filter(function (connection) { return connection.joint; }).length;
            }, 0),
            open_joints: openJoints,
            primitives: model.sheets.reduce(function (sum, sheet) { return sum + sheet.primitives.length; }, 0),
            assembly_templates: model.assembly_templates.length
        }
    };
}

export function collectPlantSelection(sheet, selectionValue) {
    const selection = plainObject(selectionValue) ? selectionValue : {};
    const entityIds = new Set(normalizedArray(selection.entity_ids));
    const primitiveIds = new Set(normalizedArray(selection.primitive_ids));
    const connectionIds = new Set(normalizedArray(selection.connection_ids));
    const entities = normalizedArray(sheet && sheet.entities).filter(function (entity) {
        return entityIds.has(entity.entity_id);
    });
    const primitives = normalizedArray(sheet && sheet.primitives).filter(function (primitive) {
        return primitiveIds.has(primitive.primitive_id);
    });
    const connections = normalizedArray(sheet && sheet.connections).filter(function (connection) {
        return connectionIds.has(connection.connection_id)
            || (entityIds.has(connection.from_entity_id) && entityIds.has(connection.to_entity_id));
    });
    return { entities: entities, connections: connections, primitives: primitives };
}

export function collectExposedPlantPorts(sheet, selectionValue, boundsValue) {
    const collected = collectPlantSelection(sheet, selectionValue);
    const bounds = boundsValue || plantSelectionBounds(sheet, selectionValue) || { x: 0, y: 0 };
    const internal = new Set();
    collected.connections.forEach(function (connection) {
        internal.add(connection.from_entity_id + ':' + connection.from_port_id);
        internal.add(connection.to_entity_id + ':' + connection.to_port_id);
    });
    const ports = [];
    collected.entities.forEach(function (entity) {
        entity.ports.forEach(function (port) {
            const key = entity.entity_id + ':' + port.id;
            if (internal.has(key))
                return;
            const point = plantPortWorldPoint(entity, port);
            ports.push({
                id: entity.entity_id + '__' + port.id,
                name: entity.name + ' · ' + port.name,
                entity_id: entity.entity_id,
                port_id: port.id,
                x: point.x - bounds.x,
                y: point.y - bounds.y,
                rx: 0,
                ry: 0,
                kind: port.kind,
                direction: port.direction,
                role: port.role
            });
        });
    });
    const width = Math.max(1, bounds.width || 1);
    const height = Math.max(1, bounds.height || 1);
    ports.forEach(function (port) {
        port.rx = port.x / width;
        port.ry = port.y / height;
    });
    return ports;
}

export function duplicatePlantSelection(modelValue, selectionValue, offsetValue) {
    const model = normalizePlantDrawing(modelValue);
    const sheet = getActivePlantSheet(model);
    const collected = collectPlantSelection(sheet, selectionValue);
    const offset = finiteNumber(offsetValue, sheet.grid * 3);
    const idMap = new Map();
    const assemblyMap = new Map();
    function mappedAssembly(assemblyId) {
        if (!assemblyId)
            return '';
        if (!assemblyMap.has(assemblyId))
            assemblyMap.set(assemblyId, uniqueId('assembly'));
        return assemblyMap.get(assemblyId);
    }
    const newEntities = collected.entities.map(function (entity) {
        const copy = cloneValue(entity);
        copy.entity_id = uniqueId('entity');
        copy.x += offset;
        copy.y += offset;
        copy.name = entity.name + ' Kopie';
        copy.assembly_id = mappedAssembly(entity.assembly_id);
        idMap.set(entity.entity_id, copy.entity_id);
        return copy;
    });
    const newPrimitives = collected.primitives.map(function (primitive) {
        const copy = translatePlantPrimitive(primitive, offset, offset);
        copy.primitive_id = uniqueId('primitive');
        copy.assembly_id = mappedAssembly(primitive.assembly_id);
        return copy;
    });
    const newConnections = collected.connections.filter(function (connection) {
        return idMap.has(connection.from_entity_id) && idMap.has(connection.to_entity_id);
    }).map(function (connection) {
        const copy = cloneValue(connection);
        copy.connection_id = uniqueId('connection');
        copy.from_entity_id = idMap.get(connection.from_entity_id);
        copy.to_entity_id = idMap.get(connection.to_entity_id);
        return copy;
    });
    const updated = updateActivePlantSheet(model, function (draft) {
        draft.entities = draft.entities.concat(newEntities);
        draft.primitives = draft.primitives.concat(newPrimitives);
        draft.connections = draft.connections.concat(newConnections);
        return draft;
    });
    return {
        model: updated,
        selection: {
            entity_ids: newEntities.map(function (entity) { return entity.entity_id; }),
            primitive_ids: newPrimitives.map(function (primitive) { return primitive.primitive_id; }),
            connection_ids: newConnections.map(function (connection) { return connection.connection_id; })
        }
    };
}

export function deletePlantSelection(modelValue, selectionValue) {
    const selection = plainObject(selectionValue) ? selectionValue : {};
    const entityIds = new Set(normalizedArray(selection.entity_ids));
    const primitiveIds = new Set(normalizedArray(selection.primitive_ids));
    const connectionIds = new Set(normalizedArray(selection.connection_ids));
    return updateActivePlantSheet(modelValue, function (sheet) {
        sheet.entities = sheet.entities.filter(function (entity) {
            return !entityIds.has(entity.entity_id);
        });
        sheet.primitives = sheet.primitives.filter(function (primitive) {
            return !primitiveIds.has(primitive.primitive_id);
        });
        sheet.connections = sheet.connections.filter(function (connection) {
            return !connectionIds.has(connection.connection_id)
                && !entityIds.has(connection.from_entity_id)
                && !entityIds.has(connection.to_entity_id);
        });
        return sheet;
    });
}

export function templateViewBox(templateValue) {
    const template = plainObject(templateValue) ? templateValue : {};
    const width = positiveNumber(template.breite || template.width, 100);
    const height = positiveNumber(template.hoehe || template.height, 100);
    return normalizeViewBox(template.view_box || template.viewBox, width, height);
}

// ---------------------------------------------------------------------------
// V64_r3 · joints, snapping and connected components
// ---------------------------------------------------------------------------

export function plantJointGap(sheet, connectionValue) {
    const points = plantConnectionPoints(sheet, connectionValue);
    if (!points)
        return 0;
    return pointDistance(points.from, points.to);
}

export function plantPortUsage(sheet) {
    const usage = new Map();
    normalizedArray(sheet && sheet.connections).forEach(function (connection) {
        usage.set(connection.from_entity_id + ':' + connection.from_port_id, connection.connection_id);
        usage.set(connection.to_entity_id + ':' + connection.to_port_id, connection.connection_id);
    });
    return usage;
}

export function plantPortDirectionsAgree(fromPortValue, toPortValue) {
    const fromPort = plainObject(fromPortValue) ? fromPortValue : {};
    const toPort = plainObject(toPortValue) ? toPortValue : {};
    if (fromPort.direction === 'in' && toPort.direction === 'in')
        return false;
    if (fromPort.direction === 'out' && toPort.direction === 'out')
        return false;
    return true;
}

/**
 * Ports plug together when they carry the same medium kind. Flow direction is
 * a soft criterion (pipe fittings are used in every orientation); it only
 * ranks candidates and is reported as a warning by the classic validation.
 */
export function plantPortsCompatible(fromPortValue, toPortValue) {
    const fromPort = plainObject(fromPortValue) ? fromPortValue : {};
    const toPort = plainObject(toPortValue) ? toPortValue : {};
    if (!fromPort.id || !toPort.id)
        return false;
    return (fromPort.kind || 'process') === (toPort.kind || 'process');
}

export function findPlantSnapCandidate(sheet, movingEntityIdsValue, toleranceValue) {
    const movingIds = new Set(normalizedArray(movingEntityIdsValue));
    const tolerance = positiveNumber(toleranceValue, DEFAULT_SNAP_TOLERANCE);
    const usage = plantPortUsage(sheet);
    const entities = normalizedArray(sheet && sheet.entities);
    const moving = entities.filter(function (entity) { return movingIds.has(entity.entity_id); });
    const stationary = entities.filter(function (entity) { return !movingIds.has(entity.entity_id); });
    let best = null;
    moving.forEach(function (entity) {
        entity.ports.forEach(function (port) {
            if (usage.has(entity.entity_id + ':' + port.id))
                return;
            const origin = plantPortWorldPoint(entity, port);
            stationary.forEach(function (target) {
                target.ports.forEach(function (targetPort) {
                    if (usage.has(target.entity_id + ':' + targetPort.id))
                        return;
                    if (!plantPortsCompatible(port, targetPort))
                        return;
                    const targetPoint = plantPortWorldPoint(target, targetPort);
                    const distance = pointDistance(origin, targetPoint);
                    if (distance > tolerance)
                        return;
                    const score = distance + (plantPortDirectionsAgree(port, targetPort) ? 0 : tolerance / 3);
                    if (best && score >= best.score)
                        return;
                    best = {
                        score: score,
                        moving_entity_id: entity.entity_id,
                        moving_port_id: port.id,
                        moving_port_name: port.name,
                        target_entity_id: target.entity_id,
                        target_port_id: targetPort.id,
                        target_port_name: targetPort.name,
                        target_entity_name: target.name,
                        kind: port.kind,
                        distance: distance,
                        dx: targetPoint.x - origin.x,
                        dy: targetPoint.y - origin.y,
                        point: targetPoint
                    };
                });
            });
        });
    });
    return best;
}

export function translatePlantEntities(modelValue, entityIdsValue, dx, dy) {
    const ids = new Set(normalizedArray(entityIdsValue));
    const deltaX = finiteNumber(dx, 0);
    const deltaY = finiteNumber(dy, 0);
    return updateActivePlantSheet(modelValue, function (sheet) {
        sheet.entities = sheet.entities.map(function (entity) {
            if (!ids.has(entity.entity_id))
                return entity;
            entity.x = roundValue(entity.x + deltaX, 3);
            entity.y = roundValue(entity.y + deltaY, 3);
            return entity;
        });
        return sheet;
    });
}

export function findCoincidentPlantPorts(sheet, entityIdsValue, toleranceValue) {
    const ids = new Set(normalizedArray(entityIdsValue));
    const tolerance = positiveNumber(toleranceValue, 0.75);
    const usage = plantPortUsage(sheet);
    const entities = normalizedArray(sheet && sheet.entities);
    const selected = entities.filter(function (entity) { return ids.has(entity.entity_id); });
    const others = entities.filter(function (entity) { return !ids.has(entity.entity_id); });
    const pairs = [];
    const claimed = new Set();
    selected.forEach(function (entity) {
        entity.ports.forEach(function (port) {
            const key = entity.entity_id + ':' + port.id;
            if (usage.has(key) || claimed.has(key))
                return;
            const origin = plantPortWorldPoint(entity, port);
            let match = null;
            others.forEach(function (target) {
                target.ports.forEach(function (targetPort) {
                    const targetKey = target.entity_id + ':' + targetPort.id;
                    if (usage.has(targetKey) || claimed.has(targetKey))
                        return;
                    if (!plantPortsCompatible(port, targetPort))
                        return;
                    const distance = pointDistance(origin, plantPortWorldPoint(target, targetPort));
                    if (distance <= tolerance && (!match || distance < match.distance))
                        match = { entity_id: target.entity_id, port_id: targetPort.id, distance: distance };
                });
            });
            if (match) {
                claimed.add(key);
                claimed.add(match.entity_id + ':' + match.port_id);
                pairs.push({
                    from: { entity_id: entity.entity_id, port_id: port.id },
                    to: { entity_id: match.entity_id, port_id: match.port_id },
                    kind: port.kind
                });
            }
        });
    });
    return pairs;
}

export function createPlantJoints(modelValue, entityIdsValue, toleranceValue) {
    const model = normalizePlantDrawing(modelValue);
    const sheet = getActivePlantSheet(model);
    const pairs = findCoincidentPlantPorts(sheet, entityIdsValue, toleranceValue);
    const created = [];
    const warnings = [];
    pairs.forEach(function (pair) {
        try {
            const result = createPlantConnection(sheet, pair.from, pair.to, pair.kind, { joint: true });
            sheet.connections.push(result.connection);
            created.push(result.connection);
            warnings.push.apply(warnings, result.warnings);
        }
        catch (error) {
            warnings.push(error.message);
        }
    });
    const updated = updateActivePlantSheet(model, function (draft) {
        draft.connections = cloneValue(sheet.connections);
        return draft;
    });
    return { model: updated, connections: created, warnings: warnings };
}

export function snapPlantEntitiesToPorts(modelValue, entityIdsValue, toleranceValue) {
    const model = normalizePlantDrawing(modelValue);
    const sheet = getActivePlantSheet(model);
    const candidate = findPlantSnapCandidate(sheet, entityIdsValue, toleranceValue);
    if (!candidate)
        return { model: model, candidate: null, connections: [], warnings: [] };
    const moved = translatePlantEntities(model, entityIdsValue, candidate.dx, candidate.dy);
    const joined = createPlantJoints(moved, entityIdsValue, 0.75);
    return { model: joined.model, candidate: candidate, connections: joined.connections, warnings: joined.warnings };
}

export function closePlantJoint(modelValue, connectionId, preferEntityId) {
    const model = normalizePlantDrawing(modelValue);
    const sheet = getActivePlantSheet(model);
    const connection = sheet.connections.find(function (item) {
        return item.connection_id === connectionId;
    });
    const points = connection ? plantConnectionPoints(sheet, connection) : null;
    if (!connection || !points)
        return model;
    const moveTo = preferEntityId === connection.from_entity_id;
    const movingId = moveTo ? connection.from_entity_id : connection.to_entity_id;
    const component = plantConnectedComponent(sheet, movingId, [connection.connection_id]);
    const dx = moveTo ? points.to.x - points.from.x : points.from.x - points.to.x;
    const dy = moveTo ? points.to.y - points.from.y : points.from.y - points.to.y;
    return translatePlantEntities(model, Array.from(component), dx, dy);
}

export function plantConnectedComponent(sheet, entityId, ignoredConnectionIdsValue, includeClassic) {
    const ignored = new Set(normalizedArray(ignoredConnectionIdsValue));
    const connections = normalizedArray(sheet && sheet.connections).filter(function (connection) {
        if (ignored.has(connection.connection_id))
            return false;
        return includeClassic === true || connection.joint;
    });
    const assemblies = new Map();
    normalizedArray(sheet && sheet.entities).forEach(function (entity) {
        if (!entity.assembly_id)
            return;
        if (!assemblies.has(entity.assembly_id))
            assemblies.set(entity.assembly_id, []);
        assemblies.get(entity.assembly_id).push(entity.entity_id);
    });
    const visited = new Set();
    const queue = [entityId];
    while (queue.length) {
        const current = queue.shift();
        if (!current || visited.has(current))
            continue;
        visited.add(current);
        connections.forEach(function (connection) {
            if (connection.from_entity_id === current && !visited.has(connection.to_entity_id))
                queue.push(connection.to_entity_id);
            if (connection.to_entity_id === current && !visited.has(connection.from_entity_id))
                queue.push(connection.from_entity_id);
        });
        const entity = findPlantEntity(sheet, current);
        if (entity && entity.assembly_id && assemblies.has(entity.assembly_id)) {
            assemblies.get(entity.assembly_id).forEach(function (memberId) {
                if (!visited.has(memberId))
                    queue.push(memberId);
            });
        }
    }
    return visited;
}

export function expandPlantSelectionToComponent(sheet, selectionValue) {
    const selection = plainObject(selectionValue) ? cloneValue(selectionValue) : { entity_ids: [], connection_ids: [], primitive_ids: [] };
    const entityIds = new Set(normalizedArray(selection.entity_ids));
    normalizedArray(selection.entity_ids).forEach(function (entityId) {
        plantConnectedComponent(sheet, entityId).forEach(function (memberId) {
            entityIds.add(memberId);
        });
    });
    const assemblyIds = new Set();
    normalizedArray(sheet && sheet.entities).forEach(function (entity) {
        if (entityIds.has(entity.entity_id) && entity.assembly_id)
            assemblyIds.add(entity.assembly_id);
    });
    const primitiveIds = new Set(normalizedArray(selection.primitive_ids));
    normalizedArray(sheet && sheet.primitives).forEach(function (primitive) {
        if (primitive.assembly_id && assemblyIds.has(primitive.assembly_id))
            primitiveIds.add(primitive.primitive_id);
    });
    return {
        entity_ids: Array.from(entityIds),
        connection_ids: normalizedArray(selection.connection_ids).slice(),
        primitive_ids: Array.from(primitiveIds)
    };
}

// ---------------------------------------------------------------------------
// V64_r3 · transformations (rotation, handle resize)
// ---------------------------------------------------------------------------

export function rotatePlantSelection(modelValue, selectionValue, degreesValue, pivotValue) {
    const model = normalizePlantDrawing(modelValue);
    const sheet = getActivePlantSheet(model);
    const selection = plainObject(selectionValue) ? selectionValue : {};
    const entityIds = new Set(normalizedArray(selection.entity_ids));
    const primitiveIds = new Set(normalizedArray(selection.primitive_ids));
    const degrees = finiteNumber(degreesValue, 90);
    const bounds = plantSelectionBounds(sheet, selection);
    if (!bounds)
        return model;
    const pivot = plainObject(pivotValue)
        ? { x: finiteNumber(pivotValue.x, 0), y: finiteNumber(pivotValue.y, 0) }
        : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    return updateActivePlantSheet(model, function (draft) {
        draft.entities = draft.entities.map(function (entity) {
            if (!entityIds.has(entity.entity_id))
                return entity;
            const center = rotatePoint({ x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 }, pivot, degrees);
            entity.x = roundValue(center.x - entity.width / 2, 3);
            entity.y = roundValue(center.y - entity.height / 2, 3);
            entity.rotation = normalizeAngle(entity.rotation + degrees);
            return entity;
        });
        draft.primitives = draft.primitives.map(function (primitive) {
            if (!primitiveIds.has(primitive.primitive_id))
                return primitive;
            if (primitive.type === 'svg_fragment' || primitive.type === 'text') {
                const anchor = rotatePoint({ x: primitive.x1, y: primitive.y1 }, pivot, degrees);
                const dx = anchor.x - primitive.x1;
                const dy = anchor.y - primitive.y1;
                primitive.x1 = roundValue(primitive.x1 + dx, 3);
                primitive.y1 = roundValue(primitive.y1 + dy, 3);
                primitive.x2 = roundValue(primitive.x2 + dx, 3);
                primitive.y2 = roundValue(primitive.y2 + dy, 3);
                return primitive;
            }
            const first = rotatePoint({ x: primitive.x1, y: primitive.y1 }, pivot, degrees);
            const second = rotatePoint({ x: primitive.x2, y: primitive.y2 }, pivot, degrees);
            primitive.x1 = roundValue(first.x, 3);
            primitive.y1 = roundValue(first.y, 3);
            primitive.x2 = roundValue(second.x, 3);
            primitive.y2 = roundValue(second.y, 3);
            primitive.points = primitive.points.map(function (point) {
                const rotated = rotatePoint(point, pivot, degrees);
                return { x: roundValue(rotated.x, 3), y: roundValue(rotated.y, 3) };
            });
            return primitive;
        });
        return draft;
    });
}

export function resizePlantEntityByHandle(entityValue, handleValue, dxValue, dyValue, optionsValue) {
    const entity = normalizePlantEntity(entityValue);
    const options = plainObject(optionsValue) ? optionsValue : {};
    const handle = textValue(handleValue, 'se');
    const minimum = positiveNumber(options.minimum, 10);
    const dx = finiteNumber(dxValue, 0);
    const dy = finiteNumber(dyValue, 0);
    let x = entity.x;
    let y = entity.y;
    let width = entity.width;
    let height = entity.height;
    if (handle.includes('e'))
        width = Math.max(minimum, entity.width + dx);
    if (handle.includes('s'))
        height = Math.max(minimum, entity.height + dy);
    if (handle.includes('w')) {
        width = Math.max(minimum, entity.width - dx);
        x = entity.x + entity.width - width;
    }
    if (handle.includes('n')) {
        height = Math.max(minimum, entity.height - dy);
        y = entity.y + entity.height - height;
    }
    // Uniformly scaled equipment keeps its aspect ratio so the symbol and its
    // ports never drift apart; linear and free parts may be resized per axis.
    const keepAspect = options.keep_aspect === true || entity.scale_mode === 'uniform';
    if (keepAspect && entity.width > 0 && entity.height > 0) {
        const ratio = entity.width / entity.height;
        if (handle === 'n' || handle === 's')
            width = height * ratio;
        else
            height = width / ratio;
        if (handle.includes('w'))
            x = entity.x + entity.width - width;
        if (handle.includes('n'))
            y = entity.y + entity.height - height;
    }
    const resized = resizePlantEntityPorts(entity, roundValue(width, 3), roundValue(height, 3));
    resized.x = roundValue(x, 3);
    resized.y = roundValue(y, 3);
    return resized;
}

// ---------------------------------------------------------------------------
// V64_r3 · assembly templates (drawing inventory)
// ---------------------------------------------------------------------------

export function createAssemblyTemplate(sheet, selectionValue, optionsValue) {
    const options = plainObject(optionsValue) ? optionsValue : {};
    const collected = collectPlantSelection(sheet, selectionValue);
    if (!collected.entities.length && !collected.primitives.length)
        throw new Error('Eine Baugruppe benötigt mindestens eine Komponente.');
    const bounds = plantSelectionBounds(sheet, selectionValue) || { x: 0, y: 0, width: 100, height: 100 };
    const entities = collected.entities.map(function (entity) {
        const copy = cloneValue(entity);
        copy.x = roundValue(entity.x - bounds.x, 3);
        copy.y = roundValue(entity.y - bounds.y, 3);
        copy.assembly_id = '';
        copy.assembly_template_id = '';
        copy.assembly_name = '';
        return copy;
    });
    const primitives = collected.primitives.filter(function (primitive) {
        return primitive.type !== 'svg_fragment';
    }).map(function (primitive) {
        const copy = translatePlantPrimitive(primitive, -bounds.x, -bounds.y);
        copy.assembly_id = '';
        return copy;
    });
    const exposed = collectExposedPlantPorts(sheet, selectionValue, bounds).map(function (port) {
        return {
            id: port.id,
            name: port.name,
            entity_id: port.entity_id,
            port_id: port.port_id,
            x: roundValue(port.x, 3),
            y: roundValue(port.y, 3),
            rx: port.rx,
            ry: port.ry,
            kind: port.kind,
            direction: port.direction,
            role: port.role
        };
    });
    return normalizeAssemblyTemplate({
        assembly_template_id: textValue(options.assembly_template_id, uniqueId('assembly_template')),
        name: textValue(options.name, 'Baugruppe'),
        category: textValue(options.category, 'Baugruppen'),
        description: textValue(options.description, ''),
        scope: textValue(options.scope, 'project'),
        created_at: textValue(options.created_at, ''),
        width: Math.max(1, roundValue(bounds.width, 3)),
        height: Math.max(1, roundValue(bounds.height, 3)),
        entities: entities,
        connections: cloneValue(collected.connections),
        primitives: primitives,
        exposed_ports: exposed
    });
}

export function instantiateAssemblyTemplate(modelValue, templateValue, x, y, optionsValue) {
    const model = normalizePlantDrawing(modelValue);
    const template = normalizeAssemblyTemplate(templateValue);
    const options = plainObject(optionsValue) ? optionsValue : {};
    const originX = finiteNumber(x, 0);
    const originY = finiteNumber(y, 0);
    const assemblyId = textValue(options.assembly_id, uniqueId('assembly'));
    const idMap = new Map();
    const entities = template.entities.map(function (entity) {
        const copy = cloneValue(entity);
        copy.entity_id = uniqueId('entity');
        copy.x = roundValue(entity.x + originX, 3);
        copy.y = roundValue(entity.y + originY, 3);
        copy.assembly_id = assemblyId;
        copy.assembly_template_id = template.assembly_template_id;
        copy.assembly_name = template.name;
        idMap.set(entity.entity_id, copy.entity_id);
        return copy;
    });
    const connections = template.connections.filter(function (connection) {
        return idMap.has(connection.from_entity_id) && idMap.has(connection.to_entity_id);
    }).map(function (connection) {
        const copy = cloneValue(connection);
        copy.connection_id = uniqueId('connection');
        copy.from_entity_id = idMap.get(connection.from_entity_id);
        copy.to_entity_id = idMap.get(connection.to_entity_id);
        return copy;
    });
    const primitives = template.primitives.map(function (primitive) {
        const copy = translatePlantPrimitive(primitive, originX, originY);
        copy.primitive_id = uniqueId('primitive');
        copy.assembly_id = assemblyId;
        return copy;
    });
    const updated = updateActivePlantSheet(model, function (draft) {
        draft.entities = draft.entities.concat(entities);
        draft.connections = draft.connections.concat(connections);
        draft.primitives = draft.primitives.concat(primitives);
        return draft;
    });
    return {
        model: updated,
        assembly_id: assemblyId,
        selection: {
            entity_ids: entities.map(function (entity) { return entity.entity_id; }),
            connection_ids: connections.map(function (connection) { return connection.connection_id; }),
            primitive_ids: primitives.map(function (primitive) { return primitive.primitive_id; })
        }
    };
}

export function upsertAssemblyTemplate(modelValue, templateValue) {
    const model = normalizePlantDrawing(modelValue);
    const template = normalizeAssemblyTemplate(templateValue);
    model.assembly_templates = model.assembly_templates.filter(function (item) {
        return item.assembly_template_id !== template.assembly_template_id;
    }).concat([template]);
    return model;
}

export function removeAssemblyTemplate(modelValue, assemblyTemplateId) {
    const model = normalizePlantDrawing(modelValue);
    model.assembly_templates = model.assembly_templates.filter(function (item) {
        return item.assembly_template_id !== assemblyTemplateId;
    });
    return model;
}

export function detachPlantAssembly(modelValue, entityIdsValue) {
    const ids = new Set(normalizedArray(entityIdsValue));
    return updateActivePlantSheet(modelValue, function (sheet) {
        sheet.entities = sheet.entities.map(function (entity) {
            if (!ids.has(entity.entity_id))
                return entity;
            entity.assembly_id = '';
            entity.assembly_template_id = '';
            entity.assembly_name = '';
            return entity;
        });
        return sheet;
    });
}

export function groupPlantSelection(modelValue, selectionValue, nameValue) {
    const selection = plainObject(selectionValue) ? selectionValue : {};
    const entityIds = new Set(normalizedArray(selection.entity_ids));
    const primitiveIds = new Set(normalizedArray(selection.primitive_ids));
    const assemblyId = uniqueId('assembly');
    const name = textValue(nameValue, 'Baugruppe');
    const model = updateActivePlantSheet(modelValue, function (sheet) {
        sheet.entities = sheet.entities.map(function (entity) {
            if (!entityIds.has(entity.entity_id))
                return entity;
            entity.assembly_id = assemblyId;
            entity.assembly_name = name;
            return entity;
        });
        sheet.primitives = sheet.primitives.map(function (primitive) {
            if (primitiveIds.has(primitive.primitive_id))
                primitive.assembly_id = assemblyId;
            return primitive;
        });
        return sheet;
    });
    return { model: model, assembly_id: assemblyId };
}

export function plantAssemblySummary(sheet, assemblyId) {
    const members = normalizedArray(sheet && sheet.entities).filter(function (entity) {
        return entity.assembly_id === assemblyId;
    });
    const memberIds = new Set(members.map(function (entity) { return entity.entity_id; }));
    const joints = normalizedArray(sheet && sheet.connections).filter(function (connection) {
        return connection.joint && memberIds.has(connection.from_entity_id) && memberIds.has(connection.to_entity_id);
    });
    return {
        assembly_id: assemblyId,
        name: members.length ? textValue(members[0].assembly_name, 'Baugruppe') : '',
        template_id: members.length ? members[0].assembly_template_id : '',
        member_ids: Array.from(memberIds),
        member_count: members.length,
        joint_count: joints.length
    };
}

// ---------------------------------------------------------------------------
// V64_r3 · plug-together layout helper and examples
// ---------------------------------------------------------------------------

export function attachPlantEntityToPort(entityValue, portId, targetEntityValue, targetPortId) {
    const entity = normalizePlantEntity(entityValue);
    const port = findPlantPort(entity, portId);
    const target = normalizePlantEntity(targetEntityValue);
    const targetPort = findPlantPort(target, targetPortId);
    if (!port || !targetPort)
        throw new Error('Port für das Zusammenstecken nicht gefunden: ' + portId + ' / ' + targetPortId);
    const origin = plantPortWorldPoint(entity, port);
    const destination = plantPortWorldPoint(target, targetPort);
    entity.x = roundValue(entity.x + destination.x - origin.x, 3);
    entity.y = roundValue(entity.y + destination.y - origin.y, 3);
    return entity;
}

export function createRohrofenPlantExample(templateLookup) {
    const model = createEmptyPlantDrawing();
    const sheet = model.sheets[0];
    const specs = [
        ['Gas_bottle', 120, 690, { name: 'Edukt-Gasflasche B-101' }],
        ['Flange_pair', 245, 610, { name: 'Flansch F-101', rotation: 90 }],
        ['Tubular_reactor', 450, 150, { name: 'Rohrreaktor R-101', width: 120, height: 520 }],
        ['Tube_furnace', 415, 300, { name: 'Rohrofen H-101', width: 190, height: 300 }],
        ['Double_pipe_cooler', 760, 455, { name: 'Doppelrohr-Kühler W-101', width: 120, height: 270 }],
        ['Pressure_indicator', 245, 205, { name: 'Druckanzeige PI-101' }],
        ['Temperature_transmitter', 650, 305, { name: 'Temperatur TIC-101' }]
    ];
    specs.forEach(function (spec) {
        const template = typeof templateLookup === 'function' ? templateLookup(spec[0]) : null;
        if (template)
            sheet.entities.push(createPlantEntity(template, spec[1], spec[2], spec[3]));
    });
    function entityByTemplate(templateId) {
        return sheet.entities.find(function (entity) {
            return entity.template_id === templateId;
        });
    }
    function connect(fromTemplate, fromPort, toTemplate, toPort, kind) {
        const fromEntity = entityByTemplate(fromTemplate);
        const toEntity = entityByTemplate(toTemplate);
        if (!fromEntity || !toEntity)
            return;
        try {
            sheet.connections.push(createPlantConnection(sheet, {
                entity_id: fromEntity.entity_id,
                port_id: fromPort
            }, {
                entity_id: toEntity.entity_id,
                port_id: toPort
            }, kind).connection);
        }
        catch (error) {
            console.warn('Example connection skipped:', error.message);
        }
    }
    connect('Gas_bottle', 'gas_out', 'Tubular_reactor', 'feed', 'process');
    connect('Tubular_reactor', 'product', 'Double_pipe_cooler', 'process_in', 'process');
    connect('Pressure_indicator', 'process', 'Tubular_reactor', 'feed', 'process');
    connect('Temperature_transmitter', 'signal', 'Tube_furnace', 'temperature', 'signal');
    sheet.primitives.push(normalizePlantPrimitive({
        type: 'text',
        x1: 420,
        y1: 90,
        text: 'Rohrofen-Anlage · elementare Komponenten'
    }));
    return normalizePlantDrawing(model);
}

/**
 * Plug-together reference: the tube furnace rig of the Rohrofen template
 * P&ID built from elementary parts whose ports coincide exactly.
 */
export function createRohrofenAssemblyExample(templateLookup) {
    const model = createEmptyPlantDrawing();
    const sheet = model.sheets[0];
    sheet.name = 'Rohrofen-Anlage · zusammengesteckt';
    const lookup = typeof templateLookup === 'function' ? templateLookup : function () { return null; };
    const placed = {};

    function add(key, templateId, x, y, options) {
        const template = lookup(templateId);
        if (!template)
            return null;
        const entity = createPlantEntity(template, x, y, options);
        sheet.entities.push(entity);
        placed[key] = entity;
        return entity;
    }

    function plug(key, templateId, portId, targetKey, targetPortId, options) {
        const template = lookup(templateId);
        const target = placed[targetKey];
        if (!template || !target)
            return null;
        const draft = createPlantEntity(template, 0, 0, options);
        const entity = attachPlantEntityToPort(draft, portId, target, targetPortId);
        sheet.entities.push(entity);
        placed[key] = entity;
        try {
            sheet.connections.push(createPlantConnection(sheet, {
                entity_id: entity.entity_id, port_id: portId
            }, {
                entity_id: target.entity_id, port_id: targetPortId
            }, findPlantPort(entity, portId).kind, { joint: true }).connection);
        }
        catch (error) {
            console.warn('Example joint skipped:', error.message);
        }
        return entity;
    }

    function link(fromKey, fromPort, toKey, toPort, kind) {
        const fromEntity = placed[fromKey];
        const toEntity = placed[toKey];
        if (!fromEntity || !toEntity)
            return;
        try {
            sheet.connections.push(createPlantConnection(sheet, {
                entity_id: fromEntity.entity_id, port_id: fromPort
            }, {
                entity_id: toEntity.entity_id, port_id: toPort
            }, kind).connection);
        }
        catch (error) {
            console.warn('Example connection skipped:', error.message);
        }
    }

    // Feed side: the N2 string enters the tee inlet from the left, the educt
    // string enters the tee branch from below. The tee is the gas mixer M-101.
    add('n2', 'Gas_bottle', 60, 160, { name: 'N\u2082-Flasche GF-101', tag: 'GF-101', rotation: 90 });
    plug('v101', 'Valve_(general)', 'inlet', 'n2', 'gas_out', { name: 'Regelventil V-101', tag: 'V-101' });
    plug('p1', 'Pipe_straight', 'inlet', 'v101', 'outlet', { name: 'Rohrleitung PL-101', tag: 'PL-101' });
    plug('mixer', 'Pipe_tee', 'inlet', 'p1', 'outlet', { name: 'Gasmischer M-101', tag: 'M-101' });
    plug('p2', 'Pipe_straight', 'outlet', 'mixer', 'branch', { name: 'Rohrleitung PL-102', tag: 'PL-102', rotation: 270 });
    plug('v102', 'Valve_(general)', 'outlet', 'p2', 'inlet', { name: 'Regelventil V-102', tag: 'V-102', rotation: 270 });
    plug('ed', 'Gas_bottle', 'gas_out', 'v102', 'inlet', { name: 'Edukt-Flasche GF-102', tag: 'GF-102' });

    // Reactor string: tee outlet -> pipe -> elbow down -> flange -> furnace -> flange -> elbow -> cooler -> vent.
    plug('p3', 'Pipe_straight', 'inlet', 'mixer', 'outlet', { name: 'Rohrleitung PL-103', tag: 'PL-103' });
    plug('elbow1', 'Pipe_elbow_90', 'inlet', 'p3', 'outlet', { name: 'Rohrbogen PL-104', tag: 'PL-104' });
    plug('f1', 'Flange_pair', 'inlet', 'elbow1', 'outlet', { name: 'Flanschpaar FL-101', tag: 'FL-101', rotation: 90 });
    plug('furnace', 'Tube_furnace', 'process_in', 'f1', 'outlet', { name: 'Rohrofen H-101 \u00b7 Reaktor R-101', tag: 'H-101' });
    plug('f2', 'Flange_pair', 'inlet', 'furnace', 'process_out', { name: 'Flanschpaar FL-102', tag: 'FL-102', rotation: 90 });
    plug('elbow2', 'Pipe_elbow_90', 'outlet', 'f2', 'outlet', { name: 'Rohrbogen PL-105', tag: 'PL-105', rotation: 180 });
    plug('p4', 'Pipe_straight', 'inlet', 'elbow2', 'inlet', { name: 'Rohrleitung PL-106', tag: 'PL-106' });
    plug('cooler', 'Double_pipe_cooler', 'process_in', 'p4', 'outlet', { name: 'Doppelrohr-K\u00fchler W-101', tag: 'W-101', rotation: 270 });
    plug('p5', 'Pipe_straight', 'inlet', 'cooler', 'process_out', { name: 'Rohrleitung PL-107', tag: 'PL-107' });
    plug('v103', 'Valve_(general)', 'inlet', 'p5', 'outlet', { name: 'Vent-Ventil V-103', tag: 'V-103' });
    plug('vent', 'Pipe_straight', 'inlet', 'v103', 'outlet', { name: 'Abgasleitung zum Vent', tag: 'PL-108' });

    // Instruments stay classic (signal/process lines) so they remain individually bindable.
    const furnaceEntity = placed.furnace;
    const coolerEntity = placed.cooler;
    add('pi', 'Pressure_indicator', placed.p3 ? placed.p3.x + 20 : 560, placed.p3 ? placed.p3.y - 120 : 60,
        { name: 'Druckanzeige PI-101', tag: 'PI-101' });
    add('tic', 'Temperature_transmitter', furnaceEntity ? furnaceEntity.x - 140 : 330,
        furnaceEntity ? furnaceEntity.y + 70 : 430, { name: 'Temperaturregler TIC-101', tag: 'TIC-101' });
    add('ti', 'Temperature_transmitter', coolerEntity ? coolerEntity.x + 40 : 1000,
        coolerEntity ? coolerEntity.y + 250 : 640, { name: 'Temperatur TI-102', tag: 'TI-102' });
    link('pi', 'process', 'p3', 'outlet', 'process');
    link('tic', 'signal', 'furnace', 'temperature', 'signal');
    link('ti', 'process', 'p5', 'outlet', 'process');

    sheet.primitives.push(normalizePlantPrimitive({
        type: 'text',
        x1: 150,
        y1: 60,
        text: 'Rohrofen-Anlage · aus Elementarteilen zusammengesteckt (Ports gekoppelt)'
    }));
    return normalizePlantDrawing(model);
}

/**
 * V64_r4 plug-together reference with the new elementary parts: boundary
 * connectors, titanium capillaries, Swagelok fittings, the gas mixer M-101,
 * mirrored elbows for the U-bend and an inverted cooler run. Every joint is
 * a real port-on-port coupling with correct flow direction.
 */
export function createRohrofenR4Example(templateLookup) {
    const model = createEmptyPlantDrawing();
    const sheet = model.sheets[0];
    sheet.name = 'Rohrofen-Anlage · Fittings, Kapillaren und Gasmischer';
    const lookup = typeof templateLookup === 'function' ? templateLookup : function () { return null; };
    const placed = {};

    function add(key, templateId, x, y, options) {
        const template = lookup(templateId);
        if (!template)
            return null;
        const entity = createPlantEntity(template, x, y, options);
        sheet.entities.push(entity);
        placed[key] = entity;
        return entity;
    }

    function plug(key, templateId, portId, targetKey, targetPortId, options) {
        const template = lookup(templateId);
        const target = placed[targetKey];
        if (!template || !target)
            return null;
        const draft = createPlantEntity(template, 0, 0, options);
        const entity = attachPlantEntityToPort(draft, portId, target, targetPortId);
        sheet.entities.push(entity);
        placed[key] = entity;
        try {
            sheet.connections.push(createPlantConnection(sheet, {
                entity_id: entity.entity_id, port_id: portId
            }, {
                entity_id: target.entity_id, port_id: targetPortId
            }, findPlantPort(entity, portId).kind, { joint: true }).connection);
        }
        catch (error) {
            console.warn('Example joint skipped:', error.message);
        }
        return entity;
    }

    function link(fromKey, fromPort, toKey, toPort, kind) {
        const fromEntity = placed[fromKey];
        const toEntity = placed[toKey];
        if (!fromEntity || !toEntity)
            return;
        try {
            sheet.connections.push(createPlantConnection(sheet, {
                entity_id: fromEntity.entity_id, port_id: fromPort
            }, {
                entity_id: toEntity.entity_id, port_id: toPort
            }, kind).connection);
        }
        catch (error) {
            console.warn('Example connection skipped:', error.message);
        }
    }

    // N2 feed: boundary flag (mirrored, port on the right) -> capillary -> valve -> union -> mixer A.
    add('n2', 'Boundary_connector', 60, 150, { name: 'N₂-Anschluss', tag: 'N₂', flip_x: true });
    plug('cap1', 'Capillary_line', 'inlet', 'n2', 'line', { name: 'Titan-Kapillare CL-101', tag: 'CL-101', width: 180 });
    plug('v101', 'Valve_(general)', 'inlet', 'cap1', 'outlet', { name: 'Regelventil V-101', tag: 'V-101' });
    plug('sw1', 'Swagelok_union', 'inlet', 'v101', 'outlet', { name: 'Swagelok SW-101', tag: 'SW-101' });
    plug('mixer', 'Gas_mixer', 'inlet_a', 'sw1', 'outlet', { name: 'Gasmischer M-101', tag: 'M-101' });

    // Educt feed from the lower left: elbow up into mixer B, pipe, elbow, capillary, valve, flag.
    plug('el1', 'Swagelok_elbow', 'outlet', 'mixer', 'inlet_b', { name: 'Swagelok-Winkel SW-102', tag: 'SW-102', rotation: 270 });
    plug('p_ed', 'Pipe_straight', 'outlet', 'el1', 'inlet', { name: 'Rohrleitung PL-101', tag: 'PL-101', rotation: 270, width: 90 });
    plug('el2', 'Pipe_elbow_90', 'outlet', 'p_ed', 'inlet', { name: 'Rohrbogen PL-102', tag: 'PL-102', flip_y: true });
    plug('cap2', 'Capillary_line', 'outlet', 'el2', 'inlet', { name: 'Titan-Kapillare CL-102', tag: 'CL-102', width: 120 });
    plug('v102', 'Valve_(general)', 'outlet', 'cap2', 'inlet', { name: 'Regelventil V-102', tag: 'V-102' });
    plug('ed', 'Boundary_connector', 'line', 'v102', 'inlet', { name: 'Edukt-Anschluss', tag: 'Educts', flip_x: true });

    // Reactor string downwards: union, pipe, flange, furnace, flange, pipe, U-bend with mirrored elbows.
    plug('sw3', 'Swagelok_union', 'inlet', 'mixer', 'outlet', { name: 'Swagelok SW-103', tag: 'SW-103', rotation: 90 });
    plug('p1', 'Pipe_straight', 'inlet', 'sw3', 'outlet', { name: 'Rohrleitung PL-103', tag: 'PL-103', rotation: 90, width: 120 });
    plug('f1', 'Flange_pair', 'inlet', 'p1', 'outlet', { name: 'Flanschpaar FL-101', tag: 'FL-101', rotation: 90 });
    plug('furnace', 'Tube_furnace', 'process_in', 'f1', 'outlet', { name: 'Rohrofen H-101 · Reaktor R-101', tag: 'H-101' });
    plug('f2', 'Flange_pair', 'inlet', 'furnace', 'process_out', { name: 'Flanschpaar FL-102', tag: 'FL-102', rotation: 90 });
    plug('p2', 'Pipe_straight', 'inlet', 'f2', 'outlet', { name: 'Rohrleitung PL-104', tag: 'PL-104', rotation: 90, width: 120 });
    plug('el3', 'Pipe_elbow_90', 'inlet', 'p2', 'outlet', { name: 'Rohrbogen PL-105', tag: 'PL-105', rotation: 270, flip_x: true });
    plug('p3', 'Pipe_straight', 'inlet', 'el3', 'outlet', { name: 'Rohrleitung PL-106', tag: 'PL-106', width: 180 });
    plug('el4', 'Pipe_elbow_90', 'inlet', 'p3', 'outlet', { name: 'Rohrbogen PL-107', tag: 'PL-107', flip_y: true });
    plug('p4', 'Pipe_straight', 'inlet', 'el4', 'outlet', { name: 'Rohrleitung PL-108', tag: 'PL-108', rotation: 270, width: 220 });
    plug('f3', 'Flange_pair', 'inlet', 'p4', 'outlet', { name: 'Flanschpaar FL-103 · Austritt', tag: 'FL-103', rotation: 270 });

    // Cooler run upwards (cooler rotated 180 and mirrored: process inlet at the bottom, coolant ports on the right), valve and vent flag.
    plug('cooler', 'Double_pipe_cooler', 'process_in', 'f3', 'outlet', { name: 'Doppelrohr-Kühler W-101', tag: 'W-101', rotation: 180, flip_x: true });
    plug('p5', 'Pipe_straight', 'inlet', 'cooler', 'process_out', { name: 'Rohrleitung PL-109', tag: 'PL-109', rotation: 270, width: 100 });
    plug('v103', 'Valve_(general)', 'inlet', 'p5', 'outlet', { name: 'Vent-Ventil V-103', tag: 'V-103', rotation: 270 });
    plug('vent', 'Boundary_connector', 'line', 'v103', 'outlet', { name: 'Vent-Anschluss', tag: 'Vent', rotation: 270 });

    // Cooling water and instruments stay classic lines so they remain individually bindable.
    const cooler = placed.cooler;
    const furnace = placed.furnace;
    add('kw_in', 'Boundary_connector', cooler ? cooler.x + 150 : 1100, cooler ? cooler.y + 28 : 600,
        { name: 'Kühlwasser Eingang', tag: 'KW ein' });
    add('kw_out', 'Boundary_connector', cooler ? cooler.x + 150 : 1100, cooler ? cooler.y + 132 : 700,
        { name: 'Kühlwasser Ausgang', tag: 'KW aus' });
    add('pi', 'Pressure_indicator', placed.cap1 ? placed.cap1.x + 50 : 240, placed.cap1 ? placed.cap1.y - 110 : 40,
        { name: 'Druckanzeige PI-101', tag: 'PI-101' });
    add('tic', 'Temperature_transmitter', furnace ? furnace.x - 150 : 300, furnace ? furnace.y + 60 : 500,
        { name: 'Temperaturregler TIC-101', tag: 'TIC-101' });
    add('ti', 'Temperature_transmitter', placed.p5 ? placed.p5.x + 90 : 1100, placed.p5 ? placed.p5.y - 40 : 420,
        { name: 'Temperatur TI-102', tag: 'TI-102' });
    link('kw_in', 'line', 'cooler', 'coolant_in', 'utility');
    link('cooler', 'coolant_out', 'kw_out', 'line', 'utility');
    link('pi', 'process', 'cap1', 'outlet', 'process');
    link('tic', 'signal', 'furnace', 'temperature', 'signal');
    link('ti', 'process', 'p5', 'outlet', 'process');

    sheet.primitives.push(normalizePlantPrimitive({
        type: 'text',
        x1: 60,
        y1: 60,
        text: 'Rohrofen-Anlage · Grenzstellen, Kapillaren, Swagelok-Fittings und Gasmischer gesteckt'
    }));
    return normalizePlantDrawing(model);
}

// ---------------------------------------------------------------------------
// V64_r5 · classic reference examples (1:1 reproduction of the P&ID images)
// ---------------------------------------------------------------------------

function classicExampleHelpers(sheet, templateLookup) {
    const lookup = typeof templateLookup === 'function' ? templateLookup : function () { return null; };
    const placed = {};

    function add(key, templateId, x, y, options) {
        const template = lookup(templateId);
        if (!template)
            return null;
        const entity = createPlantEntity(template, x, y, options);
        sheet.entities.push(entity);
        placed[key] = entity;
        return entity;
    }

    function line(points, style, options) {
        const settings = plainObject(options) ? options : {};
        sheet.primitives.push(normalizePlantPrimitive(Object.assign({
            type: 'polyline',
            points: points,
            line_style: style,
            animated: lineStylePreset(style).dashes,
            font_family: 'Arial, Helvetica, sans-serif'
        }, settings)));
    }

    function text(x, y, content, size, colour, options) {
        sheet.primitives.push(normalizePlantPrimitive(Object.assign({
            type: 'text',
            x1: x,
            y1: y,
            x2: x + 120,
            y2: y + 20,
            text: content,
            font_size: size,
            stroke: colour,
            font_family: 'Arial, Helvetica, sans-serif',
            layer: 'annotation'
        }, plainObject(options) ? options : {})));
    }

    function region(x1, y1, x2, y2, label, position) {
        sheet.primitives.push(normalizePlantPrimitive({
            type: 'region', x1: x1, y1: y1, x2: x2, y2: y2, label: label,
            label_position: position, font_family: 'Arial, Helvetica, sans-serif'
        }));
    }

    function dimension(x1, y1, x2, y2, label, otherSide) {
        sheet.primitives.push(normalizePlantPrimitive({
            type: 'dimension', x1: x1, y1: y1, x2: x2, y2: y2, text: label,
            label_position: otherSide ? 'above' : 'inside', font_family: 'Arial, Helvetica, sans-serif'
        }));
    }

    return { add: add, line: line, text: text, region: region, dimension: dimension, placed: placed };
}

/** Plug every part of an example whose ports coincide (one part after the other). */
function joinCoincidentExampleParts(modelValue) {
    let model = normalizePlantDrawing(modelValue);
    getActivePlantSheet(model).entities.forEach(function (entity) {
        model = createPlantJoints(model, [entity.entity_id], 0.75).model;
    });
    return model;
}

/**
 * Screenshot 1: the tubular reactor P&ID (1300 x 1110) with filled double-line
 * tube, classic flanges, Swagelok fittings, capillaries, valve panel, cooler,
 * skid region, dimensions and an optional frame on the structure layer.
 */
export function createClassicReactorExample(templateLookup) {
    const model = createEmptyPlantDrawing();
    const sheet = model.sheets[0];
    sheet.name = 'Reaktor-P&ID · Klassik (gefüllte Rohre)';
    sheet.width = 1300;
    sheet.height = 1110;
    sheet.margin = 4;
    const helpers = classicExampleHelpers(sheet, templateLookup);
    const add = helpers.add;
    const line = helpers.line;
    const text = helpers.text;
    const RX = 505;
    const FLANGES = [270, 385, 620, 735];

    // Skid and valve panel regions plus dimensions (annotation layer).
    helpers.region(300, 55, 890, 950, 'Gestell / Skid', 'inside');
    helpers.region(60, 260, 230, 520, 'Ventilpanel', 'above');
    helpers.dimension(300, 38, 890, 38, '1800 mm', false);
    helpers.dimension(925, 55, 925, 950, '1800 mm', true);
    helpers.dimension(430, 270, 430, 385, '400 mm', false);
    helpers.dimension(430, 385, 430, 620, '1000 mm', false);
    helpers.dimension(430, 620, 430, 735, '400 mm', false);
    FLANGES.forEach(function (y) {
        line([[RX - 22, y], [424, y]], 'plain', { stroke: '#555555', stroke_width: 0.8, animated: false, layer: 'annotation' });
    });

    // Routed process lines (drawn beneath the parts). Both capillaries end at
    // the Swagelok fittings; from there plugged parts continue to the tube.
    line([[64, 318], [255, 318], [255, 110], [RX, 110], [RX, 120]], 'pipe');
    line([[64, 390], [275, 390], [275, 210], [425, 210]], 'pipe');
    line([[715, 690], [715, 640], [1040, 640], [1040, 700]], 'hot');
    line([[1040, 860], [1040, 1010], [235, 1010], [235, 463], [64, 463]], 'hot');
    line([[1058, 840], [1094, 840]], 'coolant');
    line([[1058, 720], [1094, 720]], 'coolant');
    line([[548, 470], [614, 470]], 'signal');
    line([[380, 110], [380, 134]], 'signal');
    line([[820, 1010], [820, 1036]], 'signal');

    // Reactor tube: head, tubes, flanges, furnace, U-bend and outlet stub (all plugged).
    // Vertical parts are rotated around their centre, so the footprint is computed
    // from the axis and the top edge of the segment.
    function vpart(key, templateId, axisX, topY, length, flowUp, options) {
        return add(key, templateId, axisX - length / 2, topY + length / 2 - 24,
            Object.assign({ rotation: flowUp ? 270 : 90, width: length }, options || {}));
    }
    function vtube(key, axisX, topY, length, flowUp, options) {
        return vpart(key, 'Classic_tube', axisX, topY, length, flowUp, options);
    }
    function vflange(key, axisX, centreY, flowUp, options) {
        return add(key, 'Classic_flange', axisX - 8, centreY - 24,
            Object.assign({ rotation: flowUp ? 270 : 90 }, options || {}));
    }
    add('head', 'Classic_tube_head', RX - 24, 173.5, { name: 'Rohrkopf R-101' });
    // Upper tube piece with lateral taps: the side Swagelok plugs into the
    // left wall (tap_b) through a short capillary, exactly at y = 210.
    vpart('t1', 'Classic_tube_tap', RX, 183.5, 53, false, { name: 'Rohr R-101 · oben (Seitenanschluss)' });
    vtube('t1b', RX, 236.5, 25.5, false, { name: 'Rohr R-101 · oben' });
    vflange('f1', RX, 270, false, { name: 'Flansch 1' });
    vtube('t2', RX, 278, 99, false, { name: 'Rohr R-101 · 400 mm' });
    vflange('f2', RX, 385, false, { name: 'Flansch 2' });
    vtube('t3', RX, 393, 6, false, { name: 'Rohr zum Ofen' });
    add('furnace', 'Classic_furnace', RX - 60, 399, { name: 'Rohrofen H-101', tag: 'H-101', visual_state: 'hot' });
    vtube('t4', RX, 605, 7, false, { name: 'Rohr vom Ofen' });
    vflange('f3', RX, 620, false, { name: 'Flansch 3' });
    vtube('t5', RX, 628, 99, false, { name: 'Rohr R-101 · unten' });
    vflange('f4', RX, 735, false, { name: 'Flansch 4' });
    add('ubend', 'Classic_tube_ubend', RX - 11, 743, { name: 'U-Bogen', height: 83 });
    vflange('f5', 715, 735, true, { name: 'Flansch Austritt' });
    vtube('t6', 715, 690, 37, true, { name: 'Austrittsstutzen' });

    // Fittings, apparatus, valves, flags and instruments.
    // Swagelok fittings: axial on top of the head and lateral at the tube wall.
    // Short capillaries bridge the gaps so that both fittings are real joints.
    add('sw1', 'Classic_swagelok', RX - 20, 120, { name: 'Swagelok axial', rotation: 90 });
    add('cap_top', 'Classic_capillary', RX - 6.75, 146.75, { name: 'Kapillare zum Rohrkopf', rotation: 90, width: 13.5 });
    add('sw2', 'Classic_swagelok', 425, 190, { name: 'Swagelok seitlich' });
    add('cap_side', 'Classic_capillary', 465, 190, { name: 'Kapillare zum Seitenanschluss', width: 29 });
    add('cooler', 'Classic_cooler', 1010, 700, { name: 'Doppelrohr-Kühler W-101', tag: 'W-101', visual_state: 'cold' });
    add('v101', 'Classic_valve', 120, 298, { name: 'Ventil V-101', tag: 'V-101', visual_state: 'open' });
    add('v102', 'Classic_valve', 120, 370, { name: 'Ventil V-102', tag: 'V-102', visual_state: 'open' });
    add('v103', 'Classic_valve', 120, 443, { name: 'Ventil V-103', tag: 'V-103', visual_state: 'open' });
    add('n2', 'Classic_flag', 8, 298, { name: 'N₂-Eintritt', tag: 'N₂' });
    add('ed', 'Classic_flag', 8, 370, { name: 'Edukt-Eintritt', tag: 'Educts' });
    add('vent', 'Classic_flag_back', 8, 443, { name: 'Vent', tag: 'Vent' });
    add('kwin', 'Classic_flag', 1094, 820, { name: 'Kühlwasser Eintritt', tag: 'KW ein', flip_x: true });
    add('kwout', 'Classic_flag_back', 1094, 700, { name: 'Kühlwasser Austritt', tag: 'KW aus', flip_x: true });
    add('tic', 'Classic_instrument', 610, 442, { name: 'TIC-101', tag: 'TIC-101', properties: { value: '500 °C' } });
    add('pi', 'Classic_instrument', 350, 132, { name: 'PI-101', tag: 'PI-101', properties: { value: '1,3 bar' } });
    add('ti', 'Classic_instrument', 790, 1034, { name: 'TI-102', tag: 'TI-102', properties: { value: '40 °C' } });

    // Free texts exactly as in the reference image.
    text(519, 144, 'Swagelok', 11, '#444444');
    text(421, 196, 'Swagelok', 11, '#444444');
    text(380, 100, 'Titan-Kapillare', 11, '#444444');
    text(330, 230, 'Titan-Kapillare', 11, '#444444');
    text(535, 235, 'R-101', 13, '#222222');
    text(535, 251, 'Rohrreaktor', 11, '#444444');
    text(132, 294, 'V-101', 11, '#222222');
    text(132, 366, 'V-102', 11, '#222222');
    text(132, 439, 'V-103', 11, '#222222');
    text(731, 775, 'Austritt', 11, '#444444');
    text(1070, 805, '(Nachrüstung)', 11, '#444444');

    // Optional frame (structure layer): posts, top beam, feet and floor.
    add('post_l', 'Frame_post', 288, 55, { name: 'Pfosten links', height: 895 });
    add('post_r', 'Frame_post', 878, 55, { name: 'Pfosten rechts', height: 895 });
    add('beam', 'Frame_beam', 300, 43, { name: 'Querträger oben', width: 590 });
    add('foot_l', 'Frame_foot', 270, 950, { name: 'Fuß links' });
    add('foot_r', 'Frame_foot', 860, 950, { name: 'Fuß rechts' });
    add('floor', 'Frame_floor', 240, 966, { name: 'Boden', width: 710 });
    add('clamp_beam', 'Frame_beam', 300, 758, { name: 'Halterungsträger', width: 154 });
    add('clamp', 'Frame_clamp', 454, 755, { name: 'Rohrschelle' });

    return joinCoincidentExampleParts(model);
}

/**
 * Screenshot 2: the same rig drawn with the template symbols (1150 x 830):
 * gas cylinders, control and check valves, mixer box, rounded column, coil
 * circles, bubble instruments and thin feed lines.
 */
export function createClassicTemplateExample(templateLookup) {
    const model = createEmptyPlantDrawing();
    const sheet = model.sheets[0];
    sheet.name = 'Rohrofen-Template · Klassik (Symbolvariante)';
    sheet.width = 1150;
    sheet.height = 830;
    sheet.margin = 4;
    const helpers = classicExampleHelpers(sheet, templateLookup);
    const add = helpers.add;
    const line = helpers.line;
    const text = helpers.text;
    const CX = 498.5;
    const BUBBLE = 30 / 26;

    // Thin feed lines (green in the reaction state) and process routes.
    line([[150, 620], [150, 70], [440.5, 70], [460.5, 87], [474.5, 87]], 'purge');
    line([[240, 620], [240, 130], [440.5, 130], [460.5, 103], [474.5, 103]], 'purge');
    line([[CX, 114], [CX, 150]], 'plain', { stroke: '#2e7d4f', stroke_width: 4, animated: false });
    line([[CX, 560], [CX, 640], [670, 640]], 'hot');
    line([[770, 640], [900, 640], [900, 250], [960, 250]], 'cold');
    line([[846, 720], [720, 720], [720, 690]], 'pipe');
    line([[720, 590], [720, 560], [800, 560]], 'pipe');
    line([[428, 455], [470, 455]], 'feed', { stroke_width: 1.5 });
    line([[470, 200], [420, 200]], 'feed', { stroke_width: 1.5 });
    line([[CX, 136], [580, 136]], 'feed', { stroke_width: 1.5 });
    line([[900, 560], [955, 560]], 'feed', { stroke_width: 1.5 });
    line([[125, 130], [150, 130]], 'feed', { stroke_width: 1.5 });
    line([[220, 210], [240, 210]], 'feed', { stroke_width: 1.5 });
    line([[95, 100], [95, 40], [300, 40], [300, 51]], 'signal');
    line([[190, 180], [190, 100], [330, 100], [330, 111]], 'signal');

    add('column', 'Classic_column', 448.5, 148.5, { name: 'Rohrreaktor R-101', tag: 'R-101', visual_state: 'hot' });
    add('mixer', 'Classic_mixer_box', 466.5, 71, { name: 'Gasmischer M-101', tag: 'M-101' });
    add('heater', 'Classic_coil_circle', 325, 400, { name: 'Rohrofen H-101', tag: 'H-101', visual_state: 'hot', properties: { caption: 'Rohrofen' } });
    add('cooler', 'Classic_coil_circle', 662.7, 582.7, { name: 'Doppelrohr-Kühler W-101', tag: 'W-101', visual_state: 'cold',
        width: 114.58, height: 156.25, properties: { caption: 'Doppelrohr-Kühler', hide_labels: 'true' } });
    text(720, 732, 'W-101', 14, '#222222', { text_anchor: 'middle' });
    text(720, 747, 'Doppelrohr-Kühler', 11, '#222222', { text_anchor: 'middle' });
    add('n2', 'Classic_cylinder', 120, 620, { name: 'N₂-Flasche GF-101', tag: 'GF-101', properties: { label: 'N₂' } });
    add('ed', 'Classic_cylinder', 210, 620, { name: 'Edukt-Flasche GF-102', tag: 'GF-102', properties: { label: 'Educts' } });
    add('v101', 'Classic_control_valve', 270, 50, { name: 'Regelventil V-101', tag: 'V-101', visual_state: 'open' });
    add('v102', 'Classic_control_valve', 300, 110, { name: 'Regelventil V-102', tag: 'V-102', visual_state: 'open' });
    add('v103', 'Classic_valve', 870, 400, { name: 'Vent-Ventil V-103', tag: 'V-103', rotation: 90, inverted: true, visual_state: 'open' });
    add('rv101', 'Classic_check_valve', 365, 50, { name: 'Rückschlagventil RV-101', tag: 'RV-101', visual_state: 'open' });
    add('rv102', 'Classic_check_valve', 375, 110, { name: 'Rückschlagventil RV-102', tag: 'RV-102', visual_state: 'open' });
    add('vent', 'Classic_flag_back', 950, 230, { name: 'Vent', tag: 'Vent', flip_x: true });
    add('kwin', 'Classic_flag', 836, 700, { name: 'Kühlwasser Eintritt', tag: 'KW ein', flip_x: true });
    add('kwout', 'Classic_flag_back', 790, 540, { name: 'Kühlwasser Austritt', tag: 'KW aus', flip_x: true });
    [['fic1', 95, 130, 'FIC-101', '500 sccm'], ['fic2', 190, 210, 'FIC-102', '150 sccm'],
        ['te1', 390, 200, 'TE-101', '500 °C'], ['pi', 610, 136, 'PI-101', '1,3 bar'],
        ['te2', 985, 560, 'TE-102', '40 °C']].forEach(function (spec) {
        add(spec[0], 'Classic_instrument', spec[1] - 30 * BUBBLE, spec[2] - 28 * BUBBLE, {
            name: spec[3], tag: spec[3], width: 60 * BUBBLE, height: 72 * BUBBLE, properties: { value: spec[4] }
        });
    });

    text(322, 52, 'V-101', 12, '#222222');
    text(352, 112, 'V-102', 12, '#222222');
    text(367, 54, 'RV-101', 11, '#222222');
    text(377, 152, 'RV-102', 11, '#222222');
    text(924, 425, 'V-103', 12, '#222222');

    return joinCoincidentExampleParts(model);
}
