/**
 * v64_plant_drawing.js
 *
 * Additive component-oriented plant drawing workspace for V64.
 * Every placed object remains a registry template instance with semantic
 * ports. A composed entity is created only by an explicit inventory action.
 *
 * V64_r3 turns the workspace into a plug-together construction editor:
 * - dragging a part near a compatible port snaps it and creates a joint;
 * - jointed parts form a component that moves as one (Alt releases a part);
 * - single parts get resize and rotation handles, R rotates by 90 degrees;
 * - the drawing inventory (elements + assemblies) is separated from the plant
 *   inventory, both directions of transfer are explicit actions;
 * - an assembly placed from the drawing inventory keeps every part as an
 *   individually configurable entity.
 *
 * V64_r4 refines the construction editor:
 * - linear parts stretch (caps and arrows keep their scale), equipment scales
 *   uniformly, every part can be mirrored and its flow direction inverted;
 * - the sheet grows with the construction and the grid covers the whole view;
 * - the inspector has tabs (part, ports, properties, sheet), a context menu
 *   and Ctrl-drag navigation mirror the plant workspace;
 * - custom entities saved to the plant inventory are revealed there.
 *
 * V64_r5 adds the classic optical variant:
 * - visual states per part (flow, hot, cold, open, closed ...) rendered through
 *   data-pf-visual-state, a global animation switch for the SMIL flow dashes;
 * - layers (process, structure, annotation) with visibility switches and a
 *   separate "Gestell" inventory tab for the frame parts;
 * - routed lines with line styles, region frames and dimension lines as
 *   drawing primitives with their own tools and inspectors.
 */

import { api, state, utils, showStatus, handleError } from './core.js';
import { showConfirmation } from './dialog_service.js';
import { templateRegistry } from './registry.js';
import { elementManager } from './elements.js';
import { connectionManager } from './connection_mapper.js';
import {
    DEFAULT_SHEET_MARGIN,
    DEFAULT_SNAP_TOLERANCE,
    DRAWING_LAYERS,
    LABEL_POSITIONS,
    LINE_STYLES,
    LINE_STYLE_PRESETS,
    SCALE_MODES,
    closePlantJoint,
    collectExposedPlantPorts,
    collectPlantSelection,
    createAssemblyTemplate,
    createEmptyPlantDrawing,
    createPlantConnection,
    createPlantEntity,
    createPlantJoints,
    createRohrofenAssemblyExample,
    createRohrofenPlantExample,
    createRohrofenR4Example,
    createClassicReactorExample,
    createClassicTemplateExample,
    deletePlantSelection,
    detachPlantAssembly,
    duplicatePlantSelection,
    expandPlantSelectionToComponent,
    findPlantEntity,
    findPlantPort,
    findPlantSnapCandidate,
    fitPlantSheetToContent,
    flipPlantEntity,
    getActivePlantSheet,
    groupPlantSelection,
    instantiateAssemblyTemplate,
    invertPlantEntity,
    lineStylePreset,
    normalizeAssemblyTemplate,
    normalizePlantDrawing,
    normalizePlantPrimitive,
    plantAssemblySummary,
    plantConnectedComponent,
    plantConnectionPoints,
    plantContentBounds,
    plantEntityBounds,
    plantEntityTransformSummary,
    plantEntityVisualBounds,
    plantJointGap,
    plantOrthogonalPath,
    plantPortUsage,
    plantPortWorldPoint,
    plantPrimitiveBounds,
    plantSelectionBounds,
    plantStretchMap,
    removeAssemblyTemplate,
    resizePlantEntityByHandle,
    resizePlantEntityPorts,
    rotatePlantSelection,
    setPlantEntityLayer,
    setPlantEntityScaleMode,
    setPlantEntityVisualState,
    snapPlantValue,
    templateViewBox,
    translatePlantEntities,
    translatePlantPrimitive,
    updateActivePlantSheet,
    upsertAssemblyTemplate,
    validatePlantDrawing
} from './v64_plant_drawing_model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const DRAWING_TOOLS = ['select', 'pan', 'connect', 'line', 'rect', 'ellipse', 'text', 'place', 'polyline', 'region', 'dimension'];
const CONNECTION_KINDS = ['process', 'utility', 'signal', 'power', 'structure'];
const INVENTORY_TABS = ['elements', 'structure', 'assemblies'];
const LAYER_LABELS = Object.freeze({ process: 'Prozess', structure: 'Gestell', annotation: 'Beschriftung' });
const VISUAL_STATE_LABELS = Object.freeze({
    neutral: 'Neutral', flow: 'Durchfluss', heat: 'Aufheizen', hot: 'Heiß', cold: 'Kalt', cool: 'Abkühlen',
    purge: 'Spülen', open: 'Offen', closed: 'Geschlossen'
});
const DASH_ANIMATION_VALUES = '0;-20';
const DEFAULT_TEXT_COLOUR = '#0f172a';
// Label targets inside symbols: the r4 role data-pf-role="entity-label" plus the r5 roles.
const LABEL_ROLES = ['entity-label', 'entity-caption', 'entity-tag', 'entity-value', 'entity-function', 'entity-number'];
const LABEL_ROLE_SELECTOR = LABEL_ROLES.map(function (role) { return '[data-pf-role="' + role + '"]'; }).join(', ');
const INSPECTOR_TABS = ['part', 'ports', 'properties', 'sheet'];
const INSPECTOR_TAB_LABELS = Object.freeze({
    part: 'Objekt',
    ports: 'Ports',
    properties: 'Eigenschaften',
    sheet: 'Blatt'
});
const SCALE_MODE_LABELS = Object.freeze({
    uniform: 'Proportional (Symbol)',
    stretch: 'Strecken (Rohr / Linie)',
    free: 'Frei (verzerrt)'
});
const CTRL_DRAG_THRESHOLD = 4;
const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const ASSEMBLY_TRANSFER_TYPE = 'application/x-plant-factory-assembly';
const TEMPLATE_TRANSFER_TYPE = 'application/x-plant-factory-template';
const REFERENCE_DIAGRAMS = Object.freeze({
    reactor: Object.freeze({
        id: 'reactor',
        label: 'Reaktor-P&ID · animiert',
        asset: '/public/reference_diagrams/Reaktor_PID_animiert.svg'
    }),
    furnace: Object.freeze({
        id: 'furnace',
        label: 'Rohrofen-Template · animiert',
        asset: '/public/reference_diagrams/Rohrofen_Template_animiert.svg'
    }),
    plant: Object.freeze({
        id: 'plant',
        label: 'P&ID-Anlage · animiert',
        asset: '/public/reference_diagrams/PID_Anlage_animiert.svg'
    })
});
const PLANT_CONNECTION_TYPES = Object.freeze({
    process: 'pipe',
    utility: 'pipe',
    signal: 'signal',
    power: 'power'
});

function byId(id) {
    return document.getElementById(id);
}

function queryAll(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
}

function svgNode(name, attributes) {
    const node = document.createElementNS(SVG_NS, name);
    Object.keys(attributes || {}).forEach(function (key) {
        const value = attributes[key];
        if (value !== undefined && value !== null && value !== '')
            node.setAttribute(key, String(value));
    });
    return node;
}

function htmlNode(name, className, text) {
    const node = document.createElement(name);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}

function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function numberValue(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function textValue(value, fallback) {
    const text = String(value === undefined || value === null ? '' : value).trim();
    return text || fallback;
}

function emptySelection() {
    return { entity_ids: [], connection_ids: [], primitive_ids: [] };
}

function selectionCount(selection) {
    return selection.entity_ids.length
        + selection.connection_ids.length
        + selection.primitive_ids.length;
}

function hasSelection(selection, kind, id) {
    return selection[kind + '_ids'].includes(id);
}

function onlySelection(kind, id) {
    const selection = emptySelection();
    selection[kind + '_ids'] = [id];
    return selection;
}

function toggleSelection(selectionValue, kind, id, additive) {
    const selection = additive ? cloneValue(selectionValue) : emptySelection();
    const ids = selection[kind + '_ids'];
    const index = ids.indexOf(id);
    if (index >= 0)
        ids.splice(index, 1);
    else
        ids.push(id);
    return selection;
}

function templateById(templateId) {
    return templateRegistry.getTemplate(templateId) || null;
}

function currentModel() {
    return ui.previewModel || normalizePlantDrawing(state.get('plant_drawing'));
}

function committedModel() {
    return normalizePlantDrawing(state.get('plant_drawing'));
}

function currentSheet() {
    return getActivePlantSheet(currentModel());
}

function commitModel(modelValue, reason) {
    ui.previewModel = null;
    ui.snapCandidate = null;
    let model = normalizePlantDrawing(modelValue);
    if (ui.autoGrow && !getActivePlantSheet(model).reference) {
        // The sheet follows the construction: parts placed above or left of the
        // origin shift the content, the view follows so nothing jumps visually.
        // Reference imports keep their exact viewBox and are never shifted.
        const fitted = fitPlantSheetToContent(model, {});
        if (fitted.changed) {
            model = fitted.model;
            ui.pan.x += fitted.dx;
            ui.pan.y += fitted.dy;
        }
    }
    state.set('plant_drawing', model);
    state.saveHistory();
    state.emit('plant_drawing:changed', { model: model, reason: reason || 'Änderung' });
    renderAll();
}

function setTool(tool, templateId, assemblyTemplateId) {
    if (ui.draft && ui.draft.type === 'polyline' && tool !== 'polyline')
        finishPolyline();
    ui.tool = DRAWING_TOOLS.includes(tool) ? tool : 'select';
    ui.draftCursor = null;
    ui.selectedTemplateId = ui.tool === 'place' ? textValue(templateId, '') : '';
    ui.selectedAssemblyTemplateId = ui.tool === 'place' ? textValue(assemblyTemplateId, '') : '';
    ui.pendingPort = null;
    ui.draft = null;
    updateChrome();
    renderCanvas();
    updateStatus();
}

// ---------------------------------------------------------------------------
// SVG import helpers (unchanged contract from r1)
// ---------------------------------------------------------------------------

function sanitizeImportedSvg(root) {
    queryAll('script,foreignObject,iframe,object,embed,audio,video', root).forEach(function (node) {
        node.remove();
    });
    queryAll('*', root).concat([root]).forEach(function (node) {
        Array.from(node.attributes || []).forEach(function (attribute) {
            const name = attribute.name.toLowerCase();
            const value = String(attribute.value || '').trim();
            if (name.startsWith('on'))
                node.removeAttribute(attribute.name);
            if ((name === 'href' || name === 'xlink:href')
                && value && !value.startsWith('#') && !value.startsWith('data:'))
                node.removeAttribute(attribute.name);
        });
    });
    return root;
}

function prefixSvgIds(root, prefix) {
    const replacements = new Map();
    queryAll('[id]', root).forEach(function (node) {
        const oldId = node.id;
        const newId = prefix + '_' + oldId;
        replacements.set(oldId, newId);
        node.id = newId;
    });
    queryAll('*', root).concat([root]).forEach(function (node) {
        Array.from(node.attributes || []).forEach(function (attribute) {
            let value = attribute.value;
            replacements.forEach(function (newId, oldId) {
                value = value.split('url(#' + oldId + ')').join('url(#' + newId + ')');
                if (value === '#' + oldId)
                    value = '#' + newId;
            });
            if (value !== attribute.value) {
                if (attribute.namespaceURI === XLINK_NS)
                    node.setAttributeNS(XLINK_NS, attribute.name, value);
                else
                    node.setAttribute(attribute.name, value);
            }
        });
    });
}

function parseTemplateSvg(template, instanceId) {
    if (!template || typeof template.svg !== 'string')
        return null;
    const parsed = new DOMParser().parseFromString(template.svg, 'image/svg+xml');
    if (parsed.querySelector('parsererror'))
        return null;
    const sourceRoot = parsed.documentElement;
    if (!sourceRoot || sourceRoot.localName !== 'svg')
        return null;
    const imported = document.importNode(sourceRoot, true);
    sanitizeImportedSvg(imported);
    prefixSvgIds(imported, instanceId);
    imported.removeAttribute('x');
    imported.removeAttribute('y');
    imported.setAttribute('width', '100%');
    imported.setAttribute('height', '100%');
    imported.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    imported.setAttribute('aria-hidden', 'true');
    return imported;
}

function parseSvgFragment(primitive) {
    if (!primitive || primitive.type !== 'svg_fragment' || !primitive.markup)
        return null;
    const wrapper = '<svg xmlns="http://www.w3.org/2000/svg">' + primitive.markup + '</svg>';
    const parsed = new DOMParser().parseFromString(wrapper, 'image/svg+xml');
    if (parsed.querySelector('parsererror'))
        return null;
    const root = parsed.documentElement;
    sanitizeImportedSvg(root);
    const source = root.firstElementChild;
    return source ? document.importNode(source, true) : null;
}

function appendMissingTemplate(parent, entity) {
    parent.appendChild(svgNode('rect', {
        x: 0,
        y: 0,
        width: entity.width,
        height: entity.height,
        fill: '#fef2f2',
        stroke: '#ef4444',
        'stroke-dasharray': '7 4'
    }));
    const label = svgNode('text', {
        x: entity.width / 2,
        y: entity.height / 2,
        'text-anchor': 'middle',
        fill: '#991b1b',
        'font-size': 13
    });
    label.textContent = 'Template fehlt';
    parent.appendChild(label);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function entityGraphicTransform(entity) {
    const parts = [];
    if (entity.flip_x)
        parts.push('translate(' + entity.width + ' 0) scale(-1 1)');
    if (entity.flip_y)
        parts.push('translate(0 ' + entity.height + ') scale(1 -1)');
    return parts.join(' ');
}

function entityProperty(entity, key) {
    return entity.properties && typeof entity.properties === 'object'
        ? textValue(entity.properties[key], '') : '';
}

function entityLabelText(entity, fallback) {
    return textValue(entityProperty(entity, 'label'), textValue(entity.tag, fallback));
}

function tagParts(tag) {
    const match = /^([A-Za-z]+)[-\s]?([0-9A-Za-z]+)?$/.exec(String(tag || '').trim());
    if (!match)
        return null;
    return { letters: match[1].toUpperCase(), number: match[2] || '' };
}

function applyLabelRole(label, entity) {
    const role = label.getAttribute('data-pf-role');
    if (entityProperty(entity, 'hide_labels') === 'true' || entityProperty(entity, 'hide_labels') === '1') {
        label.textContent = '';
        return;
    }
    if (role === 'entity-label')
        label.textContent = entityLabelText(entity, label.textContent);
    else if (role === 'entity-caption')
        label.textContent = textValue(entityProperty(entity, 'caption'), label.textContent);
    else if (role === 'entity-tag')
        label.textContent = textValue(entity.tag, '');
    else if (role === 'entity-value')
        label.textContent = textValue(entityProperty(entity, 'value'), '');
    else if (role === 'entity-function' || role === 'entity-number') {
        const parts = tagParts(entity.tag);
        if (parts)
            label.textContent = role === 'entity-function' ? parts.letters : parts.number;
    }
}

function decorateTemplateClone(imported, entity) {
    // Inverted parts reverse every marked flow arrow around its own centre.
    if (entity.inverted) {
        queryAll('[data-pf-role="flow-arrow"]', imported).forEach(function (arrow) {
            const center = String(arrow.getAttribute('data-pf-arrow-center') || '')
                .trim().split(/[\s,]+/).map(Number);
            if (center.length === 2 && center.every(Number.isFinite))
                arrow.setAttribute('transform', 'rotate(180 ' + center[0] + ' ' + center[1] + ')');
        });
    }
    // Label roles show tag, caption, value or function letters and stay readable when mirrored.
    queryAll(LABEL_ROLE_SELECTOR, imported).forEach(function (label) {
        applyLabelRole(label, entity);
        const x = numberValue(label.getAttribute('x'), 0);
        const y = numberValue(label.getAttribute('y'), 0);
        const transforms = [];
        if (entity.flip_x)
            transforms.push('translate(' + (2 * x) + ' 0) scale(-1 1)');
        if (entity.flip_y)
            transforms.push('translate(0 ' + (2 * y) + ') scale(1 -1)');
        if (transforms.length)
            label.setAttribute('transform', transforms.join(' '));
    });
    return imported;
}

function inlineViewportSize(node, width, height) {
    // Inline sizing keeps nested viewports stable inside inventory previews whose
    // stylesheet sizes every descendant <svg> (r1 card contract).
    node.setAttribute('style', 'width:' + width + 'px;height:' + height + 'px;max-width:none;max-height:none');
}

function appendStretchedGraphic(graphic, entity, template, prefix) {
    const viewBox = templateViewBox(template);
    const mapping = plantStretchMap(entity.stretch, viewBox, entity.width, entity.height);
    const horizontal = mapping.axis === 'x';
    mapping.segments.forEach(function (segment, index) {
        if (segment.length <= 0.01)
            return;
        const imported = parseTemplateSvg(template, (prefix || 'drawing') + '_' + entity.entity_id + '_s' + index);
        if (!imported)
            return;
        const width = horizontal ? segment.length : entity.width;
        const height = horizontal ? entity.height : segment.length;
        imported.setAttribute('x', horizontal ? segment.offset : 0);
        imported.setAttribute('y', horizontal ? 0 : segment.offset);
        imported.setAttribute('width', width);
        imported.setAttribute('height', height);
        imported.setAttribute('viewBox', horizontal
            ? [segment.start, viewBox[1], segment.end - segment.start, viewBox[3]].join(' ')
            : [viewBox[0], segment.start, viewBox[2], segment.end - segment.start].join(' '));
        imported.setAttribute('preserveAspectRatio', 'none');
        imported.setAttribute('overflow', 'hidden');
        imported.setAttribute('data-pf-stretch-segment', segment.fixed ? 'fixed' : 'flex');
        inlineViewportSize(imported, width, height);
        graphic.appendChild(decorateTemplateClone(imported, entity));
    });
}

function appendEntityGraphic(group, entity, template, prefix) {
    const graphic = svgNode('g', {
        class: 'plant-drawing-entity-graphic',
        transform: entityGraphicTransform(entity),
        'data-scale-mode': entity.scale_mode
    });
    const viewBox = template ? templateViewBox(template) : entity.view_box;
    const identity = Math.abs(viewBox[2] - entity.width) < 0.01 && Math.abs(viewBox[3] - entity.height) < 0.01;
    if (template && entity.scale_mode === 'stretch' && entity.stretch && !identity) {
        appendStretchedGraphic(graphic, entity, template, prefix);
        group.appendChild(graphic);
        return graphic;
    }
    const viewport = svgNode('svg', {
        x: 0,
        y: 0,
        width: entity.width,
        height: entity.height,
        viewBox: template ? templateViewBox(template).join(' ') : '0 0 ' + entity.width + ' ' + entity.height,
        preserveAspectRatio: entity.scale_mode === 'free' ? 'none' : 'xMidYMid meet',
        overflow: 'hidden'
    });
    inlineViewportSize(viewport, entity.width, entity.height);
    const imported = parseTemplateSvg(template, (prefix || 'drawing') + '_' + entity.entity_id);
    if (imported) {
        imported.setAttribute('style', 'width:100%;height:100%;max-width:none;max-height:none');
        viewport.appendChild(decorateTemplateClone(imported, entity));
    }
    else
        appendMissingTemplate(viewport, entity);
    graphic.appendChild(viewport);
    group.appendChild(graphic);
    return graphic;
}

function renderEntity(parent, entity, interactive, prefix) {
    const template = templateById(entity.template_id);
    const selected = interactive && hasSelection(ui.selection, 'entity', entity.entity_id);
    const dragging = interactive && ui.drag && ui.drag.mode === 'move'
        && ui.drag.entityIds.includes(entity.entity_id);
    const group = svgNode('g', {
        class: interactive ? 'plant-drawing-entity' + (selected ? ' is-selected' : '')
            + (dragging ? ' is-dragging' : '') + (entity.assembly_id ? ' is-assembly-member' : '') : '',
        'data-entity-id': entity.entity_id,
        'data-pf-entity-id': entity.entity_id,
        'data-pf-template-id': entity.template_id,
        'data-assembly-id': entity.assembly_id,
        'data-pf-entity-tag': entity.tag,
        'data-pf-flip': (entity.flip_x ? 'x' : '') + (entity.flip_y ? 'y' : ''),
        'data-pf-inverted': entity.inverted ? 'true' : '',
        'data-pf-visual-state': entity.visual_state,
        'data-layer': entity.layer,
        transform: 'translate(' + entity.x + ' ' + entity.y + ') rotate('
            + entity.rotation + ' ' + entity.width / 2 + ' ' + entity.height / 2 + ')'
    });
    if (interactive) {
        // Transparent hit area: thin pipes stay easy to grab on their whole footprint.
        group.appendChild(svgNode('rect', {
            class: 'plant-drawing-entity-hit',
            x: 0,
            y: 0,
            width: entity.width,
            height: entity.height,
            fill: 'transparent',
            stroke: 'none'
        }));
    }
    appendEntityGraphic(group, entity, template, prefix);
    if (interactive) {
        const title = svgNode('title');
        title.textContent = entity.name + (entity.tag ? ' · ' + entity.tag : '')
            + (entity.assembly_name ? ' · Baugruppe ' + entity.assembly_name : '');
        group.appendChild(title);
    }
    parent.appendChild(group);
    return group;
}

function renderedEntityBounds(entity) {
    // Deterministic visual bounds: uniformly scaled symbols are letterboxed
    // inside their footprint, stretched and free parts fill it completely.
    if (entity.scale_mode !== 'uniform')
        return plantEntityBounds(entity);
    const template = templateById(entity.template_id);
    return template ? plantEntityVisualBounds(entity, templateViewBox(template)) : plantEntityBounds(entity);
}

function connectionAppearance(kind) {
    if (kind === 'structure')
        return { stroke: '#94a3b8', width: 2, dash: '' };
    if (kind === 'utility')
        return { stroke: '#0ea5e9', width: 3, dash: '9 4' };
    if (kind === 'signal')
        return { stroke: '#64748b', width: 1.7, dash: '5 4' };
    if (kind === 'power')
        return { stroke: '#f59e0b', width: 2.3, dash: '' };
    return { stroke: '#0f172a', width: 3, dash: '' };
}

function renderJoint(parent, sheet, connection, points, interactive) {
    const gap = Math.sqrt(Math.pow(points.to.x - points.from.x, 2) + Math.pow(points.to.y - points.from.y, 2));
    const open = gap > 0.5;
    const selected = interactive && hasSelection(ui.selection, 'connection', connection.connection_id);
    const group = svgNode('g', {
        class: interactive ? 'plant-drawing-joint' + (open ? ' is-open' : '') + (selected ? ' is-selected' : '') : '',
        'data-connection-id': connection.connection_id,
        'data-kind': connection.kind,
        'data-joint': 'true',
        'data-pf-connection-id': connection.connection_id,
        'data-pf-joint-state': open ? 'open' : 'closed'
    });
    if (open) {
        group.appendChild(svgNode('line', {
            class: 'plant-drawing-joint-gap',
            x1: points.from.x,
            y1: points.from.y,
            x2: points.to.x,
            y2: points.to.y,
            'vector-effect': 'non-scaling-stroke'
        }));
        group.appendChild(svgNode('circle', {
            class: 'plant-drawing-joint-end',
            cx: points.to.x,
            cy: points.to.y,
            r: 4,
            'vector-effect': 'non-scaling-stroke'
        }));
    }
    group.appendChild(svgNode('circle', {
        class: 'plant-drawing-joint-mark',
        cx: points.from.x,
        cy: points.from.y,
        r: open ? 4 : 5,
        'data-kind': connection.kind,
        'vector-effect': 'non-scaling-stroke'
    }));
    if (interactive) {
        const title = svgNode('title');
        title.textContent = (open ? 'Offene Steckverbindung · Abstand ' + Math.round(gap) + ' px' : 'Gesteckte Verbindung')
            + ' (' + connection.kind + ')';
        group.appendChild(title);
    }
    parent.appendChild(group);
}

function renderConnection(parent, sheet, connection, interactive) {
    const points = plantConnectionPoints(sheet, connection);
    if (!points)
        return;
    if (connection.joint) {
        renderJoint(parent, sheet, connection, points, interactive);
        return;
    }
    const appearance = connectionAppearance(connection.kind);
    const selected = interactive && hasSelection(ui.selection, 'connection', connection.connection_id);
    const pathData = plantOrthogonalPath(points.from, points.to);
    if (interactive) {
        parent.appendChild(svgNode('path', {
            d: pathData,
            class: 'plant-drawing-connection-hit',
            'data-connection-id': connection.connection_id,
            fill: 'none',
            stroke: 'transparent',
            'stroke-width': 14,
            'vector-effect': 'non-scaling-stroke'
        }));
    }
    const path = svgNode('path', {
        d: pathData,
        class: interactive ? 'plant-drawing-connection' + (selected ? ' is-selected' : '') : '',
        'data-connection-id': connection.connection_id,
        'data-kind': connection.kind,
        'data-pf-connection-id': connection.connection_id,
        fill: 'none',
        stroke: appearance.stroke,
        'stroke-width': appearance.width,
        'stroke-dasharray': appearance.dash,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'vector-effect': 'non-scaling-stroke',
        'marker-end': connection.kind === 'process' ? 'url(#plant-drawing-flow-arrow)' : ''
    });
    if (interactive) {
        const title = svgNode('title');
        title.textContent = connection.name || connection.kind + '-Verbindung';
        path.appendChild(title);
    }
    parent.appendChild(path);
}

function dashAnimationNode() {
    return svgNode('animate', {
        attributeName: 'stroke-dashoffset',
        values: DASH_ANIMATION_VALUES,
        dur: '0.5s',
        repeatCount: 'indefinite'
    });
}

function polylinePath(points) {
    return points.map(function (point, index) {
        return (index ? 'L' : 'M') + point.x + ' ' + point.y;
    }).join(' ');
}

function renderPolyline(parent, primitive, interactive) {
    const preset = lineStylePreset(primitive.line_style);
    const stroke = preset.stroke || primitive.stroke;
    const width = preset.width || primitive.stroke_width;
    const pathData = polylinePath(primitive.points);
    const group = svgNode('g', {
        class: interactive ? 'plant-drawing-polyline' + (hasSelection(ui.selection, 'primitive', primitive.primitive_id) ? ' is-selected' : '') : '',
        'data-primitive-id': primitive.primitive_id,
        'data-type': 'polyline',
        'data-line-style': primitive.line_style,
        'data-layer': primitive.layer
    });
    if (interactive) {
        group.appendChild(svgNode('path', {
            d: pathData,
            class: 'plant-drawing-polyline-hit',
            fill: 'none',
            stroke: 'transparent',
            'stroke-width': Math.max(14, width + 10),
            'vector-effect': 'non-scaling-stroke'
        }));
    }
    group.appendChild(svgNode('path', {
        d: pathData,
        fill: 'none',
        stroke: stroke,
        'stroke-width': width,
        'stroke-dasharray': preset.dash || '',
        'stroke-linejoin': 'round',
        'stroke-linecap': primitive.line_style === 'signal' ? 'butt' : 'round',
        'data-pf-state-target': 'pipe'
    }));
    if (primitive.animated && preset.dashes) {
        const dashes = svgNode('path', {
            d: pathData,
            fill: 'none',
            stroke: '#ffffff',
            'stroke-width': 2,
            'stroke-dasharray': '9 11',
            'stroke-opacity': 0.95,
            'data-pf-state-target': 'flow'
        });
        dashes.appendChild(dashAnimationNode());
        group.appendChild(dashes);
    }
    parent.appendChild(group);
}

function renderRegion(parent, primitive, interactive) {
    const x = Math.min(primitive.x1, primitive.x2);
    const y = Math.min(primitive.y1, primitive.y2);
    const width = Math.abs(primitive.x2 - primitive.x1);
    const height = Math.abs(primitive.y2 - primitive.y1);
    const group = svgNode('g', {
        class: interactive ? 'plant-drawing-region' + (hasSelection(ui.selection, 'primitive', primitive.primitive_id) ? ' is-selected' : '') : '',
        'data-primitive-id': primitive.primitive_id,
        'data-type': 'region',
        'data-layer': primitive.layer
    });
    group.appendChild(svgNode('rect', {
        x: x, y: y, width: width, height: height,
        fill: primitive.fill === 'none' ? 'none' : primitive.fill,
        stroke: primitive.stroke,
        'stroke-width': primitive.stroke_width,
        'stroke-dasharray': '10 6'
    }));
    if (primitive.label) {
        const above = primitive.label_position === 'above';
        const label = svgNode('text', {
            x: above ? x + width / 2 : x + 6,
            y: above ? y - 8 : y + primitive.font_size + 5,
            'font-size': primitive.font_size,
            'text-anchor': above ? 'middle' : 'start',
            fill: primitive.stroke,
            'font-family': primitive.font_family || ''
        });
        label.textContent = primitive.label;
        group.appendChild(label);
    }
    parent.appendChild(group);
}

function renderDimension(parent, primitive, interactive) {
    const horizontal = Math.abs(primitive.x2 - primitive.x1) >= Math.abs(primitive.y2 - primitive.y1);
    const group = svgNode('g', {
        class: interactive ? 'plant-drawing-dimension' + (hasSelection(ui.selection, 'primitive', primitive.primitive_id) ? ' is-selected' : '') : '',
        'data-primitive-id': primitive.primitive_id,
        'data-type': 'dimension',
        'data-layer': primitive.layer,
        stroke: primitive.stroke,
        'stroke-width': primitive.stroke_width,
        fill: 'none'
    });
    const x1 = primitive.x1;
    const y1 = primitive.y1;
    const x2 = primitive.x2;
    const y2 = primitive.y2;
    if (interactive) {
        group.appendChild(svgNode('line', {
            x1: x1, y1: y1, x2: x2, y2: y2, stroke: 'transparent', 'stroke-width': 14, 'vector-effect': 'non-scaling-stroke'
        }));
    }
    group.appendChild(svgNode('line', { x1: x1, y1: y1, x2: x2, y2: y2 }));
    if (horizontal) {
        const y = y1;
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        group.appendChild(svgNode('path', {
            d: 'M' + left + ' ' + (y - 6) + ' V' + (y + 6) + ' M' + right + ' ' + (y - 6) + ' V' + (y + 6)
        }));
        group.appendChild(svgNode('path', {
            d: 'M' + left + ' ' + y + ' l10 -4 v8 z M' + right + ' ' + y + ' l-10 -4 v8 z',
            fill: primitive.stroke,
            stroke: 'none'
        }));
        const label = svgNode('text', {
            x: (left + right) / 2,
            y: y - 6,
            'font-size': primitive.font_size,
            'text-anchor': 'middle',
            fill: primitive.stroke,
            stroke: 'none',
            'font-family': primitive.font_family || ''
        });
        label.textContent = primitive.text;
        group.appendChild(label);
    }
    else {
        const x = x1;
        const top = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);
        group.appendChild(svgNode('path', {
            d: 'M' + (x - 6) + ' ' + top + ' H' + (x + 6) + ' M' + (x - 6) + ' ' + bottom + ' H' + (x + 6)
        }));
        group.appendChild(svgNode('path', {
            d: 'M' + x + ' ' + top + ' l-4 10 h8 z M' + x + ' ' + bottom + ' l-4 -10 h8 z',
            fill: primitive.stroke,
            stroke: 'none'
        }));
        const textX = x - 6;
        const textY = (top + bottom) / 2;
        const label = svgNode('text', {
            x: textX,
            y: textY,
            'font-size': primitive.font_size,
            'text-anchor': 'middle',
            fill: primitive.stroke,
            stroke: 'none',
            'font-family': primitive.font_family || '',
            transform: 'rotate(-90 ' + textX + ' ' + textY + ')'
        });
        label.textContent = primitive.text;
        group.appendChild(label);
    }
    parent.appendChild(group);
}

function renderPrimitive(parent, primitive, interactive) {
    let node;
    if (primitive.type === 'polyline') {
        renderPolyline(parent, primitive, interactive);
        return;
    }
    if (primitive.type === 'region') {
        renderRegion(parent, primitive, interactive);
        return;
    }
    if (primitive.type === 'dimension') {
        renderDimension(parent, primitive, interactive);
        return;
    }
    if (primitive.type === 'svg_fragment') {
        const selected = interactive && primitive.selectable !== false
            && hasSelection(ui.selection, 'primitive', primitive.primitive_id);
        const translateX = primitive.x1 - primitive.source_x;
        const translateY = primitive.y1 - primitive.source_y;
        node = svgNode('g', {
            class: interactive ? 'plant-drawing-fragment' + (selected ? ' is-selected' : '') : '',
            'data-primitive-id': interactive && primitive.selectable !== false ? primitive.primitive_id : '',
            'data-type': 'svg_fragment',
            'data-pf-reference-fragment': primitive.primitive_id,
            'data-pf-event-target': primitive.event_target,
            'data-pf-state-target': primitive.event_target,
            'data-pf-animation-source': 'smil',
            transform: translateX || translateY ? 'translate(' + translateX + ' ' + translateY + ')' : ''
        });
        const imported = parseSvgFragment(primitive);
        if (imported) {
            if (primitive.event_target) {
                const eventNodes = [imported].concat(queryAll(
                    'path,rect,circle,ellipse,line,polyline,polygon,text,use', imported
                ));
                eventNodes.forEach(function (eventNode) {
                    eventNode.setAttribute('data-pf-event-target', primitive.event_target);
                });
            }
            node.appendChild(imported);
        }
        parent.appendChild(node);
        return;
    }
    if (primitive.type === 'line') {
        node = svgNode('line', {
            x1: primitive.x1,
            y1: primitive.y1,
            x2: primitive.x2,
            y2: primitive.y2
        });
    }
    else if (primitive.type === 'rect') {
        node = svgNode('rect', {
            x: Math.min(primitive.x1, primitive.x2),
            y: Math.min(primitive.y1, primitive.y2),
            width: Math.abs(primitive.x2 - primitive.x1),
            height: Math.abs(primitive.y2 - primitive.y1)
        });
    }
    else if (primitive.type === 'ellipse') {
        node = svgNode('ellipse', {
            cx: (primitive.x1 + primitive.x2) / 2,
            cy: (primitive.y1 + primitive.y2) / 2,
            rx: Math.abs(primitive.x2 - primitive.x1) / 2,
            ry: Math.abs(primitive.y2 - primitive.y1) / 2
        });
    }
    else {
        node = svgNode('text', {
            x: primitive.x1,
            y: primitive.y1,
            'font-size': primitive.font_size,
            'font-family': primitive.font_family || '',
            'text-anchor': primitive.text_anchor === 'start' ? '' : primitive.text_anchor,
            fill: primitive.stroke
        });
        node.textContent = primitive.text;
        if (interactive) {
            // r5: the canvas stylesheet forces 16px for labels; inline styles
            // let a text primitive keep its own size, family and colour so the
            // canvas shows exactly what the export contains. The default colour
            // stays with the stylesheet so the dark theme can lighten it.
            node.style.fontSize = primitive.font_size + 'px';
            if (primitive.stroke !== DEFAULT_TEXT_COLOUR)
                node.style.fill = primitive.stroke;
            if (primitive.font_family)
                node.style.fontFamily = primitive.font_family;
        }
    }
    node.dataset.primitiveId = primitive.primitive_id;
    node.dataset.type = primitive.type;
    node.dataset.layer = primitive.layer;
    if (primitive.type !== 'text') {
        node.setAttribute('stroke', primitive.stroke);
        node.setAttribute('stroke-width', primitive.stroke_width);
        node.setAttribute('fill', primitive.fill);
        node.setAttribute('vector-effect', 'non-scaling-stroke');
    }
    if (interactive) {
        const baseClass = primitive.type === 'text' ? 'plant-drawing-label' : 'plant-drawing-primitive';
        node.setAttribute('class', baseClass
            + (hasSelection(ui.selection, 'primitive', primitive.primitive_id) ? ' is-selected' : ''));
    }
    parent.appendChild(node);
}

function renderPorts(sheet) {
    const layer = byId('plant-drawing-ports-layer');
    layer.replaceChildren();
    if (ui.tool === 'connect') {
        sheet.entities.forEach(function (entity) {
            if (!layerVisible(entity.layer))
                return;
            entity.ports.forEach(function (port) {
                const point = plantPortWorldPoint(entity, port);
                const source = ui.pendingPort
                    && ui.pendingPort.entity_id === entity.entity_id
                    && ui.pendingPort.port_id === port.id;
                const circle = svgNode('circle', {
                    class: 'plant-drawing-port' + (source ? ' is-source' : ''),
                    cx: point.x,
                    cy: point.y,
                    r: source ? 7 : 5,
                    'data-entity-id': entity.entity_id,
                    'data-port-id': port.id,
                    'data-port-kind': port.kind,
                    tabindex: 0
                });
                const title = svgNode('title');
                title.textContent = entity.name + ' · ' + port.name + ' (' + port.kind + ')';
                circle.appendChild(title);
                layer.appendChild(circle);
            });
        });
        return;
    }
    if (!ui.portHintsEnabled)
        return;
    // Select mode: free ports are shown as subtle hints so parts can be plugged
    // together by dragging; occupied ports stay hidden.
    const usage = plantPortUsage(sheet);
    const candidate = ui.snapCandidate;
    sheet.entities.forEach(function (entity) {
        if (!layerVisible(entity.layer))
            return;
        entity.ports.forEach(function (port) {
            if (usage.has(entity.entity_id + ':' + port.id))
                return;
            const point = plantPortWorldPoint(entity, port);
            const isTarget = candidate && candidate.target_entity_id === entity.entity_id
                && candidate.target_port_id === port.id;
            const isSource = candidate && candidate.moving_entity_id === entity.entity_id
                && candidate.moving_port_id === port.id;
            layer.appendChild(svgNode('circle', {
                class: 'plant-drawing-port-hint' + (isTarget ? ' is-snap-target' : '') + (isSource ? ' is-snap-source' : ''),
                cx: point.x,
                cy: point.y,
                r: isTarget || isSource ? 8 : 3.5,
                'data-hint-entity-id': entity.entity_id,
                'data-hint-port-id': port.id,
                'data-port-kind': port.kind,
                'vector-effect': 'non-scaling-stroke'
            }));
        });
    });
    if (candidate) {
        const label = svgNode('text', {
            class: 'plant-drawing-snap-label',
            x: candidate.point.x + 12,
            y: candidate.point.y - 12
        });
        label.textContent = 'Koppeln: ' + candidate.moving_port_name + ' → ' + candidate.target_entity_name
            + ' · ' + candidate.target_port_name;
        layer.appendChild(label);
    }
}

function handlePosition(bounds, handle) {
    const x = bounds.x;
    const y = bounds.y;
    const w = bounds.width;
    const h = bounds.height;
    const positions = {
        nw: [x, y],
        n: [x + w / 2, y],
        ne: [x + w, y],
        e: [x + w, y + h / 2],
        se: [x + w, y + h],
        s: [x + w / 2, y + h],
        sw: [x, y + h],
        w: [x, y + h / 2]
    };
    return positions[handle] || [x, y];
}

function renderSelectionHandles(layer, entity, bounds) {
    const size = 9 / Math.max(0.35, ui.zoom);
    RESIZE_HANDLES.forEach(function (handle) {
        const position = handlePosition(bounds, handle);
        layer.appendChild(svgNode('rect', {
            class: 'plant-drawing-handle plant-drawing-handle--' + handle,
            x: position[0] - size / 2,
            y: position[1] - size / 2,
            width: size,
            height: size,
            'data-handle': handle,
            'data-handle-entity-id': entity.entity_id,
            'vector-effect': 'non-scaling-stroke'
        }));
    });
    const stem = 26 / Math.max(0.35, ui.zoom);
    const top = handlePosition(bounds, 'n');
    layer.appendChild(svgNode('line', {
        class: 'plant-drawing-handle-stem',
        x1: top[0],
        y1: top[1],
        x2: top[0],
        y2: top[1] - stem,
        'vector-effect': 'non-scaling-stroke'
    }));
    layer.appendChild(svgNode('circle', {
        class: 'plant-drawing-handle plant-drawing-handle--rotate',
        cx: top[0],
        cy: top[1] - stem,
        r: size / 1.6,
        'data-handle': 'rotate',
        'data-handle-entity-id': entity.entity_id,
        'vector-effect': 'non-scaling-stroke'
    }));
}

function renderCanvas() {
    const canvas = byId('plant-drawing-canvas');
    if (!canvas)
        return;
    const sheet = currentSheet();
    const connections = byId('plant-drawing-connections-layer');
    const primitives = byId('plant-drawing-primitives-layer');
    const entities = byId('plant-drawing-entities-layer');
    const selection = byId('plant-drawing-selection-layer');
    connections.replaceChildren();
    primitives.replaceChildren();
    entities.replaceChildren();
    selection.replaceChildren();
    const reference = sheet.reference && typeof sheet.reference === 'object' ? sheet.reference : null;
    canvas.dataset.referenceDiagram = reference ? textValue(reference.id, '') : '';
    if (reference && reference.font_family)
        primitives.setAttribute('font-family', reference.font_family);
    else
        primitives.removeAttribute('font-family');
    sheet.connections.forEach(function (connection) {
        if (!connectionVisible(sheet, connection))
            return;
        renderConnection(connections, sheet, connection, true);
    });
    sheet.primitives.forEach(function (primitive) {
        if (!layerVisible(primitive.layer))
            return;
        renderPrimitive(primitives, primitive, true);
        if (primitive.selectable !== false && hasSelection(ui.selection, 'primitive', primitive.primitive_id)) {
            const bounds = plantPrimitiveBounds(primitive);
            selection.appendChild(svgNode('rect', {
                class: 'plant-drawing-selection-box',
                x: bounds.x - 5,
                y: bounds.y - 5,
                width: bounds.width + 10,
                height: bounds.height + 10
            }));
        }
    });
    const singleEntity = ui.selection.entity_ids.length === 1 && selectionCount(ui.selection) === 1;
    layerOrderedEntities(sheet).forEach(function (entity) {
        if (!layerVisible(entity.layer))
            return;
        const rendered = renderEntity(entities, entity, true, 'canvas');
        if (hasSelection(ui.selection, 'entity', entity.entity_id)) {
            const bounds = renderedEntityBounds(entity, rendered);
            selection.appendChild(svgNode('rect', {
                class: 'plant-drawing-selection-box',
                x: bounds.x - 5,
                y: bounds.y - 5,
                width: bounds.width + 10,
                height: bounds.height + 10
            }));
            if (singleEntity && ui.tool === 'select' && !ui.drag) {
                const footprint = plantEntityBounds(entity);
                selection.appendChild(svgNode('rect', {
                    class: 'plant-drawing-selection-footprint',
                    x: footprint.x,
                    y: footprint.y,
                    width: footprint.width,
                    height: footprint.height
                }));
                renderSelectionHandles(selection, entity, footprint);
            }
        }
    });
    if (ui.selection.entity_ids.length > 1) {
        const bounds = plantSelectionBounds(sheet, ui.selection);
        if (bounds) {
            selection.appendChild(svgNode('rect', {
                class: 'plant-drawing-selection-box plant-drawing-selection-box--group',
                x: bounds.x - 9,
                y: bounds.y - 9,
                width: bounds.width + 18,
                height: bounds.height + 18
            }));
        }
    }
    if (ui.marquee) {
        selection.appendChild(svgNode('rect', {
            class: 'plant-drawing-marquee',
            x: Math.min(ui.marquee.x1, ui.marquee.x2),
            y: Math.min(ui.marquee.y1, ui.marquee.y2),
            width: Math.abs(ui.marquee.x2 - ui.marquee.x1),
            height: Math.abs(ui.marquee.y2 - ui.marquee.y1)
        }));
    }
    if (ui.draft) {
        const draftSource = Object.assign({ primitive_id: 'draft' }, ui.draft);
        if (draftSource.type === 'polyline' && ui.draftCursor)
            draftSource.points = draftSource.points.concat([ui.draftCursor]);
        const primitive = normalizePlantPrimitive(draftSource);
        const draftNode = svgNode('g', { opacity: .65, 'stroke-dasharray': primitive.type === 'polyline' ? '' : '7 4' });
        renderPrimitive(draftNode, primitive, false);
        if (primitive.type === 'polyline') {
            primitive.points.forEach(function (point) {
                draftNode.appendChild(svgNode('circle', {
                    class: 'plant-drawing-draft-point', cx: point.x, cy: point.y, r: 3.5, 'vector-effect': 'non-scaling-stroke'
                }));
            });
        }
        selection.appendChild(draftNode);
    }
    renderPorts(sheet);
    applyAnimationState();
    const pattern = byId('plant-drawing-grid-pattern');
    pattern.setAttribute('width', sheet.grid);
    pattern.setAttribute('height', sheet.grid);
    const path = pattern.querySelector('path');
    if (path)
        path.setAttribute('d', 'M' + sheet.grid + ' 0H0V' + sheet.grid);
    applyViewBox();
    byId('plant-drawing-empty').hidden = Boolean(
        sheet.entities.length || sheet.connections.length || sheet.primitives.length
    );
}

function canvasSize() {
    const canvas = byId('plant-drawing-canvas');
    const width = canvas ? canvas.clientWidth : 0;
    const height = canvas ? canvas.clientHeight : 0;
    return {
        width: width > 0 ? width : 1600,
        height: height > 0 ? height : 1000,
        measured: width > 0 && height > 0
    };
}

function fitScaleFor(sheet) {
    const size = canvasSize();
    return Math.max(0.01, Math.min(size.width / sheet.width, size.height / sheet.height));
}

function viewScale() {
    if (!ui.fitScale)
        ui.fitScale = fitScaleFor(currentSheet());
    return ui.fitScale * ui.zoom;
}

function resetView() {
    const sheet = currentSheet();
    const size = canvasSize();
    ui.fitScale = fitScaleFor(sheet);
    ui.viewMeasured = size.measured;
    ui.zoom = 1;
    ui.pan = {
        x: (sheet.width - size.width / ui.fitScale) / 2,
        y: (sheet.height - size.height / ui.fitScale) / 2
    };
    applyViewBox();
}

function sheetFrameNode() {
    let frame = byId('plant-drawing-sheet-frame');
    if (frame)
        return frame;
    const grid = byId('plant-drawing-grid-background');
    frame = svgNode('rect', {
        id: 'plant-drawing-sheet-frame',
        class: 'plant-drawing-sheet-frame',
        fill: 'none',
        'vector-effect': 'non-scaling-stroke'
    });
    grid.parentNode.insertBefore(frame, grid.nextSibling);
    return frame;
}

function applyViewBox() {
    const sheet = currentSheet();
    const size = canvasSize();
    const scale = viewScale();
    const width = size.width / scale;
    const height = size.height / scale;
    const x = ui.pan.x;
    const y = ui.pan.y;
    byId('plant-drawing-canvas').setAttribute('viewBox', x + ' ' + y + ' ' + width + ' ' + height);
    // The grid always covers the visible area: the construction is never
    // limited by the sheet, the sheet follows the construction instead.
    const grid = byId('plant-drawing-grid-background');
    const gridStep = sheet.grid;
    const gridX = Math.floor((x - width) / gridStep) * gridStep;
    const gridY = Math.floor((y - height) / gridStep) * gridStep;
    grid.setAttribute('x', gridX);
    grid.setAttribute('y', gridY);
    grid.setAttribute('width', width * 3);
    grid.setAttribute('height', height * 3);
    grid.classList.toggle('is-hidden', !ui.gridEnabled);
    const frame = sheetFrameNode();
    frame.setAttribute('x', 0);
    frame.setAttribute('y', 0);
    frame.setAttribute('width', sheet.width);
    frame.setAttribute('height', sheet.height);
    byId('plant-drawing-zoom-label').textContent = Math.round(ui.zoom * 100) + ' %';
}

function viewCenter() {
    const size = canvasSize();
    const scale = viewScale();
    return { x: ui.pan.x + size.width / (2 * scale), y: ui.pan.y + size.height / (2 * scale) };
}

function panViewBy(dx, dy) {
    ui.pan.x += dx;
    ui.pan.y += dy;
    applyViewBox();
}

function layerVisible(layer) {
    return ui.layers[DRAWING_LAYERS.includes(layer) ? layer : 'process'] !== false;
}

/** A connection (joint or classic line) is visible only with both of its parts. */
function connectionVisible(sheet, connection) {
    return [connection.from_entity_id, connection.to_entity_id].every(function (entityId) {
        const entity = findPlantEntity(sheet, entityId);
        return !entity || layerVisible(entity.layer);
    });
}

/** Structure parts render first (behind), process parts last (in front). */
function layerOrderedEntities(sheet) {
    const order = { structure: 0, annotation: 1, process: 2 };
    return sheet.entities.slice().sort(function (left, right) {
        return (order[left.layer] || 0) - (order[right.layer] || 0);
    });
}

function applyAnimationState() {
    const canvas = byId('plant-drawing-canvas');
    if (!canvas || typeof canvas.pauseAnimations !== 'function')
        return;
    try {
        if (ui.animationEnabled)
            canvas.unpauseAnimations();
        else
            canvas.pauseAnimations();
    }
    catch (error) {
        // Older engines without a SMIL timeline simply render static dashes.
    }
}

function wholeSheetSelection(sheet) {
    return {
        entity_ids: sheet.entities.map(function (entity) { return entity.entity_id; }),
        connection_ids: sheet.connections.map(function (connection) { return connection.connection_id; }),
        primitive_ids: sheet.primitives.map(function (primitive) { return primitive.primitive_id; })
    };
}

// ---------------------------------------------------------------------------
// SVG artifact (export / plant inventory transfer)
// ---------------------------------------------------------------------------

function buildSvgArtifact(selectionValue, wholeWhenEmpty) {
    const sheet = currentSheet();
    const explicitSelection = selectionCount(selectionValue) > 0;
    const selection = explicitSelection
        ? selectionValue : (wholeWhenEmpty ? wholeSheetSelection(sheet) : emptySelection());
    const reference = sheet.reference && typeof sheet.reference === 'object' ? sheet.reference : null;
    const exactReference = Boolean(reference && !explicitSelection && wholeWhenEmpty);
    const referenceViewBox = exactReference && Array.isArray(reference.view_box)
        ? reference.view_box.map(Number) : null;
    const bounds = exactReference && referenceViewBox && referenceViewBox.length === 4
        ? {
            x: referenceViewBox[0],
            y: referenceViewBox[1],
            width: referenceViewBox[2],
            height: referenceViewBox[3]
        }
        : plantSelectionBounds(sheet, selection);
    if (!bounds)
        return null;
    const padding = exactReference ? 0 : 20;
    const exportBounds = {
        x: bounds.x - padding,
        y: bounds.y - padding,
        width: bounds.width + padding * 2,
        height: bounds.height + padding * 2
    };
    const root = svgNode('svg', {
        xmlns: SVG_NS,
        viewBox: exactReference
            ? exportBounds.x + ' ' + exportBounds.y + ' ' + exportBounds.width + ' ' + exportBounds.height
            : '0 0 ' + exportBounds.width + ' ' + exportBounds.height,
        width: exportBounds.width,
        height: exportBounds.height,
        role: 'img',
        'data-pf-standard': 'PF-PID-V1',
        'data-pf-source': 'plant-drawing-v64-r6',
        'data-pf-reference-id': exactReference ? textValue(reference.id, '') : ''
    });
    if (reference && reference.font_family)
        root.setAttribute('font-family', reference.font_family);
    const title = svgNode('title');
    title.textContent = exactReference
        ? textValue(reference.label, sheet.name)
        : textValue(byId('plant-drawing-inventory-name').value, sheet.name);
    const collected = collectPlantSelection(sheet, selection);
    // Hidden layers are not part of the artifact (what you see is what you export).
    collected.entities = collected.entities.filter(function (entity) { return layerVisible(entity.layer); });
    collected.primitives = collected.primitives.filter(function (primitive) { return layerVisible(primitive.layer); });
    collected.connections = collected.connections.filter(function (connection) { return connectionVisible(sheet, connection); });
    const metadata = svgNode('metadata', {
        id: 'pf-plant-drawing-metadata',
        'data-schema': 'plant-factory.plant-drawing-selection'
    });
    metadata.textContent = JSON.stringify({
        schema: 'plant-factory.plant-drawing-selection',
        version: 1,
        reference: exactReference ? {
            id: reference.id,
            asset: reference.asset,
            fragment_count: reference.fragment_count
        } : null,
        entities: collected.entities.map(function (entity) {
            return {
                entity_id: entity.entity_id,
                template_id: entity.template_id,
                name: entity.name,
                tag: entity.tag,
                assembly_id: entity.assembly_id
            };
        }),
        connections: collected.connections,
        primitives: exactReference ? collected.primitives.map(function (primitive) {
            return {
                primitive_id: primitive.primitive_id,
                type: primitive.type,
                label: primitive.label,
                event_target: primitive.event_target,
                original_index: primitive.original_index
            };
        }) : collected.primitives
    });
    const defs = svgNode('defs');
    const marker = svgNode('marker', {
        id: 'plant-drawing-flow-arrow',
        viewBox: '0 0 10 10',
        refX: 8,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: 'auto-start-reverse'
    });
    marker.appendChild(svgNode('path', { d: 'M0 0L10 5L0 10Z', fill: 'context-stroke' }));
    defs.appendChild(marker);
    const group = svgNode('g', {
        transform: exactReference ? '' : 'translate(' + (-exportBounds.x) + ' ' + (-exportBounds.y) + ')',
        'font-family': reference ? textValue(reference.font_family, '') : ''
    });
    collected.connections.forEach(function (connection) {
        if (connection.joint && plantJointGap(sheet, connection) <= 0.5)
            return;
        renderConnection(group, sheet, connection, false);
    });
    collected.primitives.forEach(function (primitive) {
        renderPrimitive(group, primitive, false);
    });
    collected.entities.forEach(function (entity) {
        renderEntity(group, entity, false, 'export');
    });
    root.append(title, metadata, defs, group);
    const ports = collectExposedPlantPorts(sheet, selection, exportBounds);
    return {
        root: root,
        svg: new XMLSerializer().serializeToString(root),
        width: exportBounds.width,
        height: exportBounds.height,
        ports: ports,
        collected: collected,
        exactReference: exactReference,
        bounds: cloneValue(exportBounds)
    };
}

function assemblyPreviewSvg(template) {
    const normalized = normalizeAssemblyTemplate(template);
    const root = svgNode('svg', {
        xmlns: SVG_NS,
        viewBox: '-6 -6 ' + (normalized.width + 12) + ' ' + (normalized.height + 12),
        preserveAspectRatio: 'xMidYMid meet',
        overflow: 'hidden',
        focusable: 'false',
        'aria-hidden': 'true'
    });
    const sheet = {
        entities: normalized.entities,
        connections: normalized.connections,
        primitives: normalized.primitives
    };
    const group = svgNode('g');
    normalized.connections.forEach(function (connection) {
        if (connection.joint && plantJointGap(sheet, connection) <= 0.5)
            return;
        renderConnection(group, sheet, connection, false);
    });
    normalized.primitives.forEach(function (primitive) {
        renderPrimitive(group, primitive, false);
    });
    normalized.entities.forEach(function (entity) {
        renderEntity(group, entity, false, 'assembly_' + normalized.assembly_template_id);
    });
    root.appendChild(group);
    return root;
}

function renderPreview() {
    const target = byId('plant-drawing-preview');
    target.replaceChildren();
    target.dataset.previewSource = '';
    const artifact = buildSvgArtifact(ui.selection, false);
    if (artifact) {
        const preview = artifact.root.cloneNode(true);
        preview.removeAttribute('width');
        preview.removeAttribute('height');
        preview.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        preview.setAttribute('overflow', 'hidden');
        target.dataset.previewSource = 'selection';
        target.appendChild(preview);
        return;
    }
    const assembly = assemblyTemplateById(ui.palettePreviewAssemblyId);
    if (assembly) {
        target.dataset.previewSource = 'assembly';
        target.appendChild(assemblyPreviewSvg(assembly));
        return;
    }
    const template = templateById(ui.palettePreviewTemplateId);
    if (template) {
        const root = parseTemplateSvg(template, 'inspector_' + template.id);
        if (root) {
            root.removeAttribute('width');
            root.removeAttribute('height');
            root.setAttribute('viewBox', templateViewBox(template).join(' '));
            root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            root.setAttribute('overflow', 'hidden');
            target.dataset.previewSource = 'inventory';
            target.appendChild(root);
            return;
        }
    }
    target.appendChild(htmlNode(
        'span',
        'plant-drawing-preview-empty',
        'Komponente oder Baugruppe auswählen. Gesteckte und klassische Verbindungen werden automatisch übernommen.'
    ));
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function inputNode(id, value, type, step) {
    const input = htmlNode('input', 'text-input');
    input.id = id;
    input.type = type || 'text';
    input.value = value;
    if (step)
        input.step = step;
    return input;
}

function selectNode(id, options, value) {
    const select = htmlNode('select', 'select-input');
    select.id = id;
    options.forEach(function (item) {
        const option = htmlNode('option', '', item.label);
        option.value = item.value;
        option.selected = item.value === value;
        select.appendChild(option);
    });
    return select;
}

function appendField(parent, labelText, input, wide) {
    const label = htmlNode('label', 'form-group' + (wide ? ' form-group--wide' : ''));
    label.append(htmlNode('span', '', labelText), input);
    parent.appendChild(label);
    return input;
}

function actionButton(text, primary, handler, id) {
    const button = htmlNode('button', 'btn ' + (primary ? 'btn-primary' : 'btn-secondary'), text);
    button.type = 'button';
    if (id)
        button.id = id;
    button.addEventListener('click', handler);
    return button;
}

function actionRow(buttons) {
    const row = htmlNode('div', 'plant-drawing-action-row');
    buttons.forEach(function (button) {
        row.appendChild(button);
    });
    return row;
}

function entityJoints(sheet, entityId) {
    return sheet.connections.filter(function (connection) {
        return connection.joint && (connection.from_entity_id === entityId || connection.to_entity_id === entityId);
    });
}

function checkboxNode(id, checked, labelText) {
    const label = htmlNode('label', 'plant-drawing-checkbox');
    const input = htmlNode('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = Boolean(checked);
    label.append(input, htmlNode('span', '', labelText));
    return { label: label, input: input };
}

function entityPortStatus(sheet, entity, port) {
    const usage = plantPortUsage(sheet);
    const connectionId = usage.get(entity.entity_id + ':' + port.id);
    if (!connectionId)
        return 'frei';
    const connection = sheet.connections.find(function (item) { return item.connection_id === connectionId; });
    if (!connection)
        return 'frei';
    if (!connection.joint)
        return 'verbunden';
    return plantJointGap(sheet, connection) > 0.5 ? 'gesteckt · offen' : 'gesteckt';
}

function updateEntity(entityId, updater, reason) {
    const next = updateActivePlantSheet(currentModel(), function (draft) {
        draft.entities = draft.entities.map(function (item) {
            return item.entity_id === entityId ? (updater(item) || item) : item;
        });
        return draft;
    });
    const joined = createPlantJoints(next, [entityId], 0.75);
    commitModel(joined.model, reason);
}

function renderEntityPartTab(target, entity, sheet) {
    const linear = entity.scale_mode === 'stretch';
    const grid = htmlNode('div', 'plant-drawing-property-grid');
    const name = appendField(grid, 'Name', inputNode('drawing-name', entity.name), true);
    const tag = appendField(grid, 'Tag / Beschriftung', inputNode('drawing-tag', entity.tag), true);
    const x = appendField(grid, 'X', inputNode('drawing-x', entity.x, 'number', '1'));
    const y = appendField(grid, 'Y', inputNode('drawing-y', entity.y, 'number', '1'));
    const axisY = entity.stretch && entity.stretch.axis === 'y';
    const width = appendField(grid, linear && !axisY ? 'Länge' : 'Breite', inputNode('drawing-width', entity.width, 'number', '1'));
    const height = appendField(grid, linear && axisY ? 'Länge' : 'Höhe', inputNode('drawing-height', entity.height, 'number', '1'));
    const rotation = appendField(grid, 'Drehung °', inputNode('drawing-rotation', entity.rotation, 'number', '1'));
    const modes = SCALE_MODES.filter(function (mode) { return mode !== 'stretch' || entity.stretch; })
        .map(function (mode) { return { value: mode, label: SCALE_MODE_LABELS[mode] }; });
    const scaleMode = appendField(grid, 'Skalierung', selectNode('drawing-scale-mode', modes, entity.scale_mode));
    const template = templateById(entity.template_id);
    const states = template && Array.isArray(template.visual_states) && template.visual_states.length
        ? template.visual_states : [];
    const stateOptions = states.map(function (state) {
        return { value: state, label: VISUAL_STATE_LABELS[state] || state };
    });
    const visualState = appendField(grid, 'Darstellung / Zustand', selectNode('drawing-visual-state',
        stateOptions.length ? stateOptions : [{ value: '', label: 'Standard' }], entity.visual_state));
    visualState.disabled = !stateOptions.length;
    const layer = appendField(grid, 'Ebene', selectNode('drawing-layer', DRAWING_LAYERS.map(function (item) {
        return { value: item, label: LAYER_LABELS[item] };
    }), entity.layer));
    const flipX = checkboxNode('drawing-flip-x', entity.flip_x, 'Spiegeln horizontal');
    const flipY = checkboxNode('drawing-flip-y', entity.flip_y, 'Spiegeln vertikal');
    const inverted = checkboxNode('drawing-inverted', entity.inverted, 'Flussrichtung invertieren (Pfeile, Ein-/Ausgang)');
    const flags = htmlNode('div', 'plant-drawing-flag-row form-group--wide');
    flags.append(flipX.label, flipY.label, inverted.label);
    grid.appendChild(flags);
    const joints = entityJoints(sheet, entity.entity_id);
    const openJoints = joints.filter(function (connection) {
        return plantJointGap(sheet, connection) > 0.5;
    });
    const summary = plantEntityTransformSummary(entity);
    grid.appendChild(htmlNode(
        'p',
        'hint-text form-group--wide',
        entity.template_id + ' · ' + entity.ports.length + ' semantische Ports · '
            + joints.length + ' gesteckt' + (openJoints.length ? ' (' + openJoints.length + ' offen)' : '')
            + (summary ? ' · ' + summary : '')
    ));
    // Uniform symbols keep their aspect ratio: editing one size field follows with the other.
    function linkAspect(source, other, ratio) {
        source.addEventListener('input', function () {
            if (scaleMode.value !== 'uniform')
                return;
            const value = numberValue(source.value, NaN);
            if (Number.isFinite(value) && value > 0)
                other.value = String(Math.round(value * ratio * 10) / 10);
        });
    }
    linkAspect(width, height, entity.height / Math.max(1, entity.width));
    linkAspect(height, width, entity.width / Math.max(1, entity.height));
    const apply = actionButton('Eigenschaften übernehmen', true, function () {
        updateEntity(entity.entity_id, function (item) {
            let updated = setPlantEntityScaleMode(item, scaleMode.value);
            updated = resizePlantEntityPorts(
                updated,
                Math.max(10, numberValue(width.value, updated.width)),
                Math.max(10, numberValue(height.value, updated.height))
            );
            if (flipX.input.checked !== Boolean(updated.flip_x))
                updated = flipPlantEntity(updated, 'x');
            if (flipY.input.checked !== Boolean(updated.flip_y))
                updated = flipPlantEntity(updated, 'y');
            updated = invertPlantEntity(updated, inverted.input.checked);
            updated = setPlantEntityVisualState(updated, stateOptions.length ? visualState.value : updated.visual_state);
            updated = setPlantEntityLayer(updated, layer.value);
            updated.name = textValue(name.value, updated.name);
            updated.tag = textValue(tag.value, '');
            updated.x = numberValue(x.value, updated.x);
            updated.y = numberValue(y.value, updated.y);
            updated.rotation = numberValue(rotation.value, updated.rotation);
            return updated;
        }, 'Komponente geändert');
    });
    target.append(htmlNode('h3', '', 'Komponente'), grid, apply);
    const actions = [
        actionButton('Drehen 90°', false, function () { rotateSelectionBy(90); }),
        actionButton('Spiegeln', false, function () { flipSelection('x'); }),
        actionButton('Invertieren', false, invertSelection),
        actionButton('Verbund auswählen', false, selectComponentOfSelection)
    ];
    if (joints.length)
        actions.push(actionButton('Teil lösen', false, function () { releaseEntityJoints(entity.entity_id); }));
    if (openJoints.length)
        actions.push(actionButton('Zusammenziehen', true, function () { closeJointsOf(entity.entity_id); }));
    target.appendChild(actionRow(actions));
    if (entity.assembly_id) {
        const assembly = plantAssemblySummary(sheet, entity.assembly_id);
        const card = htmlNode('section', 'plant-drawing-assembly-info');
        card.append(
            htmlNode('h3', '', 'Baugruppe · ' + textValue(assembly.name, 'ohne Namen')),
            htmlNode('p', 'hint-text', assembly.member_count + ' Teile · ' + assembly.joint_count
                + ' gesteckte Verbindungen · jedes Teil bleibt einzeln konfigurierbar')
        );
        card.appendChild(actionRow([
            actionButton('Baugruppe auswählen', false, function () {
                ui.selection = { entity_ids: assembly.member_ids.slice(), connection_ids: [], primitive_ids: [] };
                renderAll();
            }),
            actionButton('Aus Baugruppe lösen', false, function () {
                commitModel(detachPlantAssembly(currentModel(), [entity.entity_id]), 'Teil aus Baugruppe gelöst');
            })
        ]));
        target.appendChild(card);
    }
}

function renderEntityPortsTab(target, entity, sheet) {
    const table = htmlNode('table', 'plant-drawing-port-table');
    const head = htmlNode('tr');
    ['Port', 'Medium', 'Richtung', 'Status'].forEach(function (label) {
        head.appendChild(htmlNode('th', '', label));
    });
    table.appendChild(head);
    const selects = [];
    entity.ports.forEach(function (port) {
        const row = htmlNode('tr');
        row.appendChild(htmlNode('td', '', port.name + ' (' + port.id + ')'));
        row.appendChild(htmlNode('td', '', port.kind));
        const direction = selectNode('drawing-port-direction-' + port.id, [
            { value: 'in', label: 'Eingang' },
            { value: 'out', label: 'Ausgang' },
            { value: 'bidirectional', label: 'Beidseitig' }
        ], port.direction);
        selects.push({ port_id: port.id, select: direction });
        const cell = htmlNode('td');
        cell.appendChild(direction);
        row.appendChild(cell);
        const status = entityPortStatus(sheet, entity, port);
        row.appendChild(htmlNode('td', 'plant-drawing-port-status' + (status === 'frei' ? ' is-free' : ''), status));
        table.appendChild(row);
    });
    const apply = actionButton('Portrichtungen übernehmen', true, function () {
        updateEntity(entity.entity_id, function (item) {
            item.ports = item.ports.map(function (port) {
                const entry = selects.find(function (candidate) { return candidate.port_id === port.id; });
                if (entry && ['in', 'out', 'bidirectional'].includes(entry.select.value))
                    port.direction = entry.select.value;
                return port;
            });
            return item;
        }, 'Portrichtungen geändert');
    });
    target.append(
        htmlNode('h3', '', 'Semantische Ports'),
        htmlNode('p', 'hint-text', 'Freie Ports rasten beim Ziehen ein. Richtungen steuern Pfeile, Einrast-Rang und die klassische Verbindungsprüfung.'),
        table,
        apply
    );
}

function renderEntityPropertiesTab(target, entity) {
    const list = htmlNode('div', 'plant-drawing-property-list');
    const rows = [];
    function appendRow(key, value) {
        const row = htmlNode('div', 'plant-drawing-property-row');
        const keyInput = inputNode('', key);
        keyInput.placeholder = 'Schlüssel';
        const valueInput = inputNode('', value === null || value === undefined ? '' : String(value));
        valueInput.placeholder = 'Wert';
        const entry = { key: keyInput, value: valueInput };
        const remove = actionButton('×', false, function () {
            row.remove();
            rows.splice(rows.indexOf(entry), 1);
        });
        remove.classList.add('plant-drawing-property-remove');
        remove.setAttribute('aria-label', 'Eigenschaft entfernen');
        row.append(keyInput, valueInput, remove);
        list.appendChild(row);
        rows.push(entry);
        return entry;
    }
    Object.keys(entity.properties || {}).forEach(function (key) {
        appendRow(key, entity.properties[key]);
    });
    const add = actionButton('Eigenschaft hinzufügen', false, function () {
        appendRow('', '');
    });
    const apply = actionButton('Eigenschaften übernehmen', true, function () {
        updateEntity(entity.entity_id, function (item) {
            const properties = {};
            rows.forEach(function (entry) {
                const key = textValue(entry.key.value, '');
                if (!key)
                    return;
                const raw = String(entry.value.value);
                const numeric = Number(raw);
                properties[key] = raw.trim() !== '' && Number.isFinite(numeric) ? numeric : raw;
            });
            item.properties = properties;
            return item;
        }, 'Eigenschaften geändert');
    });
    target.append(
        htmlNode('h3', '', 'Eigenschaften'),
        htmlNode('p', 'hint-text', 'Freie Schlüssel/Wert-Paare des Teils (z. B. DN, Werkstoff, Länge in mm, label). Sie wandern bei der Übernahme in das Anlagenbild mit.'),
        list,
        actionRow([add, apply])
    );
}

function renderSheetTab(target) {
    const sheet = currentSheet();
    const grid = htmlNode('div', 'plant-drawing-property-grid');
    const name = appendField(grid, 'Name', inputNode('drawing-sheet-name', sheet.name), true);
    const width = appendField(grid, 'Breite', inputNode('drawing-sheet-width', sheet.width, 'number', '10'));
    const height = appendField(grid, 'Höhe', inputNode('drawing-sheet-height', sheet.height, 'number', '10'));
    const gridSize = appendField(grid, 'Raster', inputNode('drawing-sheet-grid', sheet.grid, 'number', '1'));
    const margin = appendField(grid, 'Rand', inputNode('drawing-sheet-margin', sheet.margin, 'number', '10'));
    const autoGrow = checkboxNode('drawing-sheet-autogrow', ui.autoGrow, 'Blatt wächst automatisch mit der Konstruktion');
    const flags = htmlNode('div', 'plant-drawing-flag-row form-group--wide');
    flags.appendChild(autoGrow.label);
    grid.appendChild(flags);
    const bounds = plantContentBounds(sheet);
    grid.appendChild(htmlNode('p', 'hint-text form-group--wide', bounds
        ? 'Inhalt: ' + Math.round(bounds.width) + ' × ' + Math.round(bounds.height) + ' ab ('
            + Math.round(bounds.x) + ', ' + Math.round(bounds.y) + ') · Blatt ' + sheet.width + ' × ' + sheet.height
            + ' · Rand ' + sheet.margin + (sheet.margin === DEFAULT_SHEET_MARGIN ? ' (Standard)' : ' (Referenzmaß)')
        : 'Noch kein Inhalt · Blatt ' + sheet.width + ' × ' + sheet.height));
    const apply = actionButton('Blatt übernehmen', true, function () {
        ui.autoGrow = autoGrow.input.checked;
        const next = updateActivePlantSheet(currentModel(), function (draft) {
            draft.name = textValue(name.value, draft.name);
            draft.width = Math.max(200, numberValue(width.value, draft.width));
            draft.height = Math.max(200, numberValue(height.value, draft.height));
            draft.grid = Math.max(1, numberValue(gridSize.value, draft.grid));
            draft.margin = Math.max(0, numberValue(margin.value, draft.margin));
            return draft;
        });
        commitModel(next, 'Blatt geändert');
    });
    target.append(htmlNode('h3', '', 'Zeichenblatt'), grid, apply);
    target.appendChild(actionRow([
        actionButton('An Inhalt anpassen', false, function () { fitSheetNow(true); }),
        actionButton('Ansicht einpassen', false, function () { resetView(); renderCanvas(); })
    ]));
}

function renderInspectorTabs(target, available) {
    const bar = htmlNode('div', 'plant-drawing-inspector-tabs');
    bar.setAttribute('role', 'tablist');
    if (!available.includes(ui.inspectorTab))
        ui.inspectorTab = available[0];
    available.forEach(function (tab) {
        const button = htmlNode('button', 'plant-drawing-inspector-tab' + (tab === ui.inspectorTab ? ' active' : ''),
            INSPECTOR_TAB_LABELS[tab]);
        button.type = 'button';
        button.dataset.inspectorTab = tab;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', tab === ui.inspectorTab ? 'true' : 'false');
        button.addEventListener('click', function () {
            ui.inspectorTab = tab;
            renderInspector();
        });
        bar.appendChild(button);
    });
    target.appendChild(bar);
}

function renderEntityInspector(entity) {
    const sheet = currentSheet();
    const target = byId('plant-drawing-properties');
    renderInspectorTabs(target, INSPECTOR_TABS);
    if (ui.inspectorTab === 'ports')
        renderEntityPortsTab(target, entity, sheet);
    else if (ui.inspectorTab === 'properties')
        renderEntityPropertiesTab(target, entity);
    else if (ui.inspectorTab === 'sheet')
        renderSheetTab(target);
    else
        renderEntityPartTab(target, entity, sheet);
}

function renderConnectionInspector(connection) {
    const sheet = currentSheet();
    const target = byId('plant-drawing-properties');
    const grid = htmlNode('div', 'plant-drawing-property-grid');
    const name = appendField(grid, 'Bezeichnung', inputNode(
        'drawing-connection-name', connection.name
    ), true);
    const kind = appendField(grid, 'Typ', selectNode('drawing-connection-kind', [
        { value: 'process', label: 'Prozessrohr' },
        { value: 'utility', label: 'Versorgungsmedium' },
        { value: 'signal', label: 'Signal' },
        { value: 'power', label: 'Energie' }
    ], connection.kind), true);
    if (connection.joint) {
        const gap = plantJointGap(sheet, connection);
        grid.appendChild(htmlNode('p', 'hint-text form-group--wide', gap > 0.5
            ? 'Gesteckte Verbindung ist geöffnet · Abstand ' + Math.round(gap) + ' px'
            : 'Gesteckte Verbindung · Ports liegen exakt aufeinander'));
    }
    const apply = actionButton('Verbindung übernehmen', true, function () {
        const next = updateActivePlantSheet(currentModel(), function (draft) {
            draft.connections = draft.connections.map(function (item) {
                if (item.connection_id !== connection.connection_id)
                    return item;
                item.name = textValue(name.value, '');
                item.kind = CONNECTION_KINDS.includes(kind.value) ? kind.value : item.kind;
                return item;
            });
            return draft;
        });
        commitModel(next, 'Verbindung geändert');
    });
    target.append(htmlNode('h3', '', connection.joint ? 'Steckverbindung' : 'Verbindung'), grid, apply);
    const actions = [];
    if (connection.joint && plantJointGap(sheet, connection) > 0.5) {
        actions.push(actionButton('Teile zusammenziehen', true, function () {
            commitModel(closePlantJoint(currentModel(), connection.connection_id), 'Steckverbindung geschlossen');
        }));
    }
    actions.push(actionButton('Verbindung lösen', false, function () {
        ui.selection = emptySelection();
        commitModel(deletePlantSelection(currentModel(), onlySelection('connection', connection.connection_id)),
            'Verbindung gelöst');
    }));
    target.appendChild(actionRow(actions));
}

function renderReferenceFragmentInspector(primitive) {
    const target = byId('plant-drawing-properties');
    const grid = htmlNode('div', 'plant-drawing-property-grid');
    const label = appendField(grid, 'Bezeichnung', inputNode(
        'drawing-fragment-label', primitive.label
    ), true);
    const x = appendField(grid, 'X', inputNode('drawing-fragment-x', primitive.x1, 'number', '1'));
    const y = appendField(grid, 'Y', inputNode('drawing-fragment-y', primitive.y1, 'number', '1'));
    grid.appendChild(htmlNode(
        'p',
        'hint-text form-group--wide',
        primitive.element_name + ' · Event-Ziel: ' + textValue(primitive.event_target, 'nicht sichtbar')
    ));
    const apply = actionButton('Fragment übernehmen', true, function () {
        const next = updateActivePlantSheet(currentModel(), function (sheet) {
            sheet.primitives = sheet.primitives.map(function (item) {
                if (item.primitive_id !== primitive.primitive_id)
                    return item;
                const nextX = numberValue(x.value, item.x1);
                const nextY = numberValue(y.value, item.y1);
                const dx = nextX - item.x1;
                const dy = nextY - item.y1;
                item.x1 += dx;
                item.x2 += dx;
                item.y1 += dy;
                item.y2 += dy;
                item.label = textValue(label.value, item.label);
                return item;
            });
            return sheet;
        });
        commitModel(next, 'Referenzfragment geändert');
    });
    target.append(
        htmlNode('h3', '', 'SVG-Fragment'),
        htmlNode('p', 'hint-text', 'Originales Zeichenelement mit erhaltener SMIL-Sequenz und allgemeinem SVG-Event-Ziel.'),
        grid,
        apply
    );
}

function updatePrimitive(primitiveId, updater, reason) {
    const next = updateActivePlantSheet(currentModel(), function (sheet) {
        sheet.primitives = sheet.primitives.map(function (item) {
            return item.primitive_id === primitiveId ? (updater(item) || item) : item;
        });
        return sheet;
    });
    commitModel(next, reason);
}

function renderRoutedPrimitiveInspector(primitive) {
    const target = byId('plant-drawing-properties');
    const grid = htmlNode('div', 'plant-drawing-property-grid');
    const layer = appendField(grid, 'Ebene', selectNode('drawing-primitive-layer', DRAWING_LAYERS.map(function (item) {
        return { value: item, label: LAYER_LABELS[item] };
    }), primitive.layer));
    let style = null;
    let animated = null;
    let label = null;
    let labelPosition = null;
    let text = null;
    let fontFamily = null;
    if (primitive.type === 'polyline') {
        style = appendField(grid, 'Darstellung', selectNode('drawing-line-style', LINE_STYLES.map(function (item) {
            return { value: item, label: LINE_STYLE_PRESETS[item].label };
        }), primitive.line_style), true);
        animated = checkboxNode('drawing-line-animated', primitive.animated, 'Laufstriche animieren (Durchfluss)');
        const flags = htmlNode('div', 'plant-drawing-flag-row form-group--wide');
        flags.appendChild(animated.label);
        grid.appendChild(flags);
        grid.appendChild(htmlNode('p', 'hint-text form-group--wide', primitive.points.length + ' Stützpunkte · Linie mit L zeichnen, Klick setzt Punkte, Doppelklick oder Enter beendet, Umschalt zwingt orthogonal.'));
    }
    if (primitive.type === 'region') {
        label = appendField(grid, 'Titel', inputNode('drawing-region-label', primitive.label), true);
        labelPosition = appendField(grid, 'Titelposition', selectNode('drawing-region-label-position', [
            { value: 'inside', label: 'Innen oben links' },
            { value: 'above', label: 'Oberhalb mittig' }
        ], primitive.label_position));
    }
    if (primitive.type === 'dimension')
        text = appendField(grid, 'Maßtext', inputNode('drawing-dimension-text', primitive.text), true);
    const stroke = appendField(grid, 'Linienfarbe', inputNode('drawing-primitive-stroke', primitive.stroke, 'color'));
    const width = appendField(grid, 'Linienbreite', inputNode('drawing-primitive-width', primitive.stroke_width, 'number', '.1'));
    const fontSize = appendField(grid, 'Schriftgröße', inputNode('drawing-primitive-font', primitive.font_size, 'number', '1'));
    fontFamily = appendField(grid, 'Schriftart', inputNode('drawing-primitive-font-family', primitive.font_family), true);
    fontFamily.placeholder = 'z. B. Arial, Helvetica, sans-serif';
    const apply = actionButton('Zeichenelement übernehmen', true, function () {
        updatePrimitive(primitive.primitive_id, function (item) {
            item.layer = layer.value;
            if (style)
                item.line_style = style.value;
            if (animated)
                item.animated = animated.input.checked;
            if (label)
                item.label = textValue(label.value, '');
            if (labelPosition)
                item.label_position = labelPosition.value;
            if (text)
                item.text = textValue(text.value, item.text);
            item.stroke = stroke.value;
            item.stroke_width = Math.max(.2, numberValue(width.value, item.stroke_width));
            item.font_size = Math.max(4, numberValue(fontSize.value, item.font_size));
            item.font_family = textValue(fontFamily.value, '');
            return item;
        }, 'Zeichenelement geändert');
    });
    const titles = { polyline: 'Leitung (Routenlinie)', region: 'Bereich', dimension: 'Bemaßung' };
    target.append(htmlNode('h3', '', titles[primitive.type] || 'Zeichenelement'), grid, apply);
    target.appendChild(actionRow([
        actionButton('Drehen 90°', false, function () { rotateSelectionBy(90); }),
        actionButton('Duplizieren', false, duplicateSelection),
        actionButton('Löschen', false, deleteSelectionNow)
    ]));
}

function renderPrimitiveInspector(primitive) {
    if (primitive.type === 'svg_fragment') {
        renderReferenceFragmentInspector(primitive);
        return;
    }
    if (primitive.type === 'polyline' || primitive.type === 'region' || primitive.type === 'dimension') {
        renderRoutedPrimitiveInspector(primitive);
        return;
    }
    const target = byId('plant-drawing-properties');
    const grid = htmlNode('div', 'plant-drawing-property-grid');
    const text = appendField(grid, 'Text', inputNode('drawing-primitive-text', primitive.text), true);
    text.parentElement.hidden = primitive.type !== 'text';
    const stroke = appendField(grid, 'Linienfarbe', inputNode(
        'drawing-primitive-stroke', primitive.stroke, 'color'
    ));
    const fill = appendField(grid, 'Füllfarbe', inputNode(
        'drawing-primitive-fill', primitive.fill === 'none' ? '#ffffff' : primitive.fill, 'color'
    ));
    fill.parentElement.hidden = primitive.type === 'line' || primitive.type === 'text';
    const width = appendField(grid, 'Linienbreite', inputNode(
        'drawing-primitive-width', primitive.stroke_width, 'number', '.1'
    ));
    const fontSize = appendField(grid, 'Schriftgröße', inputNode('drawing-primitive-font', primitive.font_size, 'number', '1'));
    fontSize.parentElement.hidden = primitive.type !== 'text';
    const fontFamily = appendField(grid, 'Schriftart', inputNode('drawing-primitive-font-family', primitive.font_family), true);
    fontFamily.parentElement.hidden = primitive.type !== 'text';
    const layer = appendField(grid, 'Ebene', selectNode('drawing-primitive-layer', DRAWING_LAYERS.map(function (item) {
        return { value: item, label: LAYER_LABELS[item] };
    }), primitive.layer));
    const apply = actionButton('Zeichenelement übernehmen', true, function () {
        const next = updateActivePlantSheet(currentModel(), function (sheet) {
            sheet.primitives = sheet.primitives.map(function (item) {
                if (item.primitive_id !== primitive.primitive_id)
                    return item;
                item.text = textValue(text.value, item.text);
                item.stroke = stroke.value;
                item.fill = item.type === 'line' || item.type === 'text' ? 'none' : fill.value;
                item.stroke_width = Math.max(.2, numberValue(width.value, item.stroke_width));
                item.font_size = Math.max(4, numberValue(fontSize.value, item.font_size));
                item.font_family = textValue(fontFamily.value, '');
                item.layer = layer.value;
                return item;
            });
            return sheet;
        });
        commitModel(next, 'Zeichenelement geändert');
    });
    target.append(htmlNode('h3', '', 'Zeichenelement'), grid, apply);
}

function duplicateSelection() {
    if (!selectionCount(ui.selection))
        return;
    const result = duplicatePlantSelection(currentModel(), ui.selection, currentSheet().grid * 3);
    ui.selection = result.selection;
    commitModel(result.model, 'Auswahl dupliziert');
}

function renderMultiSelectionInspector(count) {
    const sheet = currentSheet();
    const target = byId('plant-drawing-properties');
    const entityIds = ui.selection.entity_ids;
    const assemblies = new Set();
    entityIds.forEach(function (entityId) {
        const entity = findPlantEntity(sheet, entityId);
        if (entity && entity.assembly_id)
            assemblies.add(entity.assembly_id);
    });
    const collected = collectPlantSelection(sheet, ui.selection);
    const jointCount = collected.connections.filter(function (connection) { return connection.joint; }).length;
    target.append(
        htmlNode('h3', '', count + ' Objekte'),
        htmlNode('p', 'hint-text', entityIds.length + ' Komponenten · ' + jointCount
            + ' interne Steckverbindungen · ' + assemblies.size + ' Baugruppe(n) beteiligt'),
        htmlNode('p', 'hint-text', 'Die Auswahl kann als Baugruppe in das Zeichen-Inventar oder als Custom-Entity bzw. Einzelobjekte in das Anlagenbild übernommen werden.')
    );
    target.appendChild(actionRow([
        actionButton('Drehen 90°', false, function () { rotateSelectionBy(90); }),
        actionButton('Spiegeln', false, function () { flipSelection('x'); }),
        actionButton('Invertieren', false, invertSelection),
        actionButton('Duplizieren', false, duplicateSelection),
        actionButton('Gruppieren', false, groupSelectionNow),
        actionButton('Verbund auswählen', false, selectComponentOfSelection)
    ]));
    target.appendChild(actionRow([
        actionButton('Teile lösen', false, releaseSelectionJoints),
        actionButton('Ports koppeln', false, joinSelectionNow)
    ]));
}

function renderInspector() {
    const sheet = currentSheet();
    const target = byId('plant-drawing-properties');
    target.replaceChildren();
    const title = byId('plant-drawing-inspector-title');
    const context = byId('plant-drawing-inspector-context');
    const count = selectionCount(ui.selection);
    const entityOnly = count === 1 && ui.selection.entity_ids.length === 1;
    if (!entityOnly) {
        renderInspectorTabs(target, ['part', 'sheet']);
        if (ui.inspectorTab === 'sheet') {
            title.textContent = sheet.name;
            context.textContent = sheet.width + ' × ' + sheet.height + ' · Raster ' + sheet.grid;
            renderSheetTab(target);
            renderPreview();
            return;
        }
    }
    if (!count) {
        const paletteTemplate = templateById(ui.palettePreviewTemplateId);
        const paletteAssembly = assemblyTemplateById(ui.palettePreviewAssemblyId);
        if (paletteAssembly) {
            title.textContent = paletteAssembly.name;
            context.textContent = paletteAssembly.entities.length + ' Teile · '
                + paletteAssembly.exposed_ports.length + ' freie Ports · ' + paletteAssembly.scope;
            target.append(
                htmlNode('h3', '', 'Baugruppe aus dem Zeichen-Inventar'),
                htmlNode('p', 'hint-text', 'Ziehen oder klicken platziert alle Teile als einzelne, weiterhin konfigurierbare Entities. Freie Ports koppeln sich beim Ablegen automatisch.'),
                htmlNode('p', 'hint-text', Math.round(paletteAssembly.width) + ' × ' + Math.round(paletteAssembly.height)
                    + ' · ' + paletteAssembly.category + ' · ' + paletteAssembly.template_ids.join(', '))
            );
            target.appendChild(actionRow([
                actionButton('Als editierbare Baugruppe ins Anlagen-Inventar', false, function () {
                    transferAssemblyToPlantInventory(paletteAssembly.assembly_template_id);
                }),
                actionButton('Baugruppe löschen', false, function () {
                    deleteAssemblyTemplate(paletteAssembly.assembly_template_id);
                })
            ]));
        }
        else if (paletteTemplate) {
            title.textContent = paletteTemplate.name;
            context.textContent = paletteTemplate.id + ' · ' + paletteTemplate.ports.length + ' Ports';
            target.append(
                htmlNode('h3', '', 'Inventarobjekt'),
                htmlNode('p', 'hint-text', 'Per Drag & Drop wird genau eine Instanz eingefügt. Ein Klick aktiviert die einmalige Platzierung auf der Zeichenfläche. Beim Ablegen rasten kompatible Ports aufeinander ein.'),
                htmlNode('p', 'hint-text', numberValue(paletteTemplate.breite, 100) + ' × '
                    + numberValue(paletteTemplate.hoehe, 100) + ' · ' + paletteTemplate.kategorie
                    + (paletteTemplate.stretch ? ' · streckbar' : ''))
            );
        }
        else {
            title.textContent = sheet.name;
            context.textContent = sheet.entities.length + ' Komponenten · '
                + sheet.connections.length + ' Verbindungen · '
                + sheet.primitives.length + ' Zeichenelemente';
            target.append(
                htmlNode('h3', '', 'Zusammenbau'),
                htmlNode('p', 'hint-text', 'Teile aus dem Zeichen-Inventar ziehen und an freie Ports heranführen: sie rasten ein und werden gesteckt. Ein Doppelklick wählt den ganzen Verbund, Alt + Ziehen löst ein Teil.'),
                htmlNode('p', 'hint-text', 'R dreht, F spiegelt, I invertiert die Flussrichtung, Entf löscht, Strg+A wählt alles, Strg+G gruppiert. Rechtsklick öffnet das Kontextmenü, Strg + Ziehen verschiebt die Ansicht.')
            );
        }
    }
    else if (entityOnly) {
        const entity = findPlantEntity(sheet, ui.selection.entity_ids[0]);
        title.textContent = entity ? entity.name : 'Komponente';
        context.textContent = entity ? entity.template_id + (entity.assembly_name ? ' · ' + entity.assembly_name : '') : '';
        if (entity)
            renderEntityInspector(entity);
    }
    else if (count === 1 && ui.selection.connection_ids.length) {
        const connection = sheet.connections.find(function (item) {
            return item.connection_id === ui.selection.connection_ids[0];
        });
        title.textContent = connection && connection.joint ? 'Steckverbindung' : 'Verbindung';
        context.textContent = connection ? connection.kind : '';
        if (connection)
            renderConnectionInspector(connection);
    }
    else if (count === 1 && ui.selection.primitive_ids.length) {
        const primitive = sheet.primitives.find(function (item) {
            return item.primitive_id === ui.selection.primitive_ids[0];
        });
        title.textContent = 'Zeichenelement';
        context.textContent = primitive ? primitive.type : '';
        if (primitive)
            renderPrimitiveInspector(primitive);
    }
    else {
        title.textContent = count + ' Objekte ausgewählt';
        context.textContent = 'Als Baugruppe prüf- und speicherbar';
        renderMultiSelectionInspector(count);
    }
    renderPreview();
}

function renderValidation() {
    const target = byId('plant-drawing-validation');
    target.replaceChildren();
    const result = validatePlantDrawing(currentModel(), templateById);
    target.appendChild(htmlNode(
        'span',
        result.valid ? 'plant-drawing-validation__ok' : 'plant-drawing-validation__warn',
        result.valid
            ? 'V Modell konsistent · ' + result.counts.entities + ' Entities · '
                + result.counts.connections + ' Verbindungen (' + result.counts.joints + ' gesteckt) · '
                + result.counts.primitives + ' Zeichenelemente'
            : result.errors.length + ' Fehler im Zeichenmodell'
    ));
    result.errors.slice(0, 4).forEach(function (message) {
        target.appendChild(htmlNode('span', 'plant-drawing-validation__warn', 'Fehler: ' + message));
    });
    result.warnings.slice(0, 4).forEach(function (message) {
        target.appendChild(htmlNode('span', '', 'Hinweis: ' + message));
    });
}

// ---------------------------------------------------------------------------
// Drawing inventory (elements + assemblies) and plant inventory transfer
// ---------------------------------------------------------------------------

function isDrawingElementTemplate(template, importedIds) {
    if (!template)
        return false;
    if (importedIds.has(template.id))
        return true;
    return template.standard === 'PF-PID-V1' && template.library_role !== 'custom';
}

function templateLayer(template) {
    return template && DRAWING_LAYERS.includes(template.layer) ? template.layer : 'process';
}

function drawingElementTemplates() {
    const imported = new Set(committedModel().inventory.imported_template_ids);
    return templateRegistry.getAllTemplates().filter(function (template) {
        return isDrawingElementTemplate(template, imported);
    });
}

function structureTemplates() {
    return drawingElementTemplates().filter(function (template) {
        return templateLayer(template) === 'structure';
    });
}

function plantOnlyTemplates() {
    const imported = new Set(committedModel().inventory.imported_template_ids);
    return templateRegistry.getAllTemplates().filter(function (template) {
        return !isDrawingElementTemplate(template, imported);
    });
}

function allAssemblyTemplates() {
    const merged = new Map();
    committedModel().assembly_templates.forEach(function (template) {
        merged.set(template.assembly_template_id, template);
    });
    ui.libraryAssemblies.forEach(function (template) {
        merged.set(template.assembly_template_id, template);
    });
    return Array.from(merged.values()).sort(function (left, right) {
        return String(left.name).localeCompare(String(right.name), 'de');
    });
}

function assemblyTemplateById(assemblyTemplateId) {
    if (!assemblyTemplateId)
        return null;
    return allAssemblyTemplates().find(function (template) {
        return template.assembly_template_id === assemblyTemplateId;
    }) || null;
}

async function loadLibraryAssemblies() {
    try {
        const response = await api.get('/api/drawing-assemblies');
        const assemblies = response && Array.isArray(response.assemblies) ? response.assemblies : [];
        ui.libraryAssemblies = assemblies.map(function (item) {
            const template = normalizeAssemblyTemplate(item);
            template.scope = 'library';
            return template;
        });
    }
    catch (error) {
        ui.libraryAssemblies = [];
        console.warn('Baugruppen-Bibliothek nicht erreichbar:', error.message);
    }
    renderAssemblyPalette();
    updateInventoryTabs();
    queueAssemblyUpgradePanel();
}

function templatePreview(template) {
    const box = htmlNode('span', 'plant-drawing-template-card__preview');
    const root = parseTemplateSvg(template, 'palette_' + template.id);
    if (root) {
        root.removeAttribute('width');
        root.removeAttribute('height');
        root.setAttribute('viewBox', templateViewBox(template).join(' '));
        root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        root.setAttribute('overflow', 'hidden');
        root.setAttribute('focusable', 'false');
        box.appendChild(root);
    }
    return box;
}

function renderPalette() {
    const target = byId('plant-drawing-template-palette');
    if (!target)
        return;
    target.replaceChildren();
    const query = textValue(byId('plant-drawing-search').value, '').toLowerCase();
    const category = byId('plant-drawing-category').value;
    const imported = new Set(committedModel().inventory.imported_template_ids);
    const structureTab = ui.inventoryTab === 'structure';
    const templates = drawingElementTemplates().filter(function (template) {
        if ((templateLayer(template) === 'structure') !== structureTab)
            return false;
        if (category && template.kategorie !== category)
            return false;
        return !query || [template.name, template.id, template.kategorie, template.family]
            .join(' ').toLowerCase().includes(query);
    });
    const groups = new Map();
    templates.forEach(function (template) {
        if (!groups.has(template.kategorie))
            groups.set(template.kategorie, []);
        groups.get(template.kategorie).push(template);
    });
    groups.forEach(function (items, categoryName) {
        const section = htmlNode('section', 'plant-drawing-template-category');
        const header = htmlNode('header');
        header.append(htmlNode('strong', '', categoryName), htmlNode('span', '', String(items.length)));
        const grid = htmlNode('div', 'plant-drawing-template-grid');
        items.forEach(function (template) {
            const active = ui.selectedTemplateId === template.id;
            const card = htmlNode('button', 'plant-drawing-template-card' + (active ? ' active' : ''));
            card.type = 'button';
            card.draggable = true;
            card.dataset.templateId = template.id;
            card.dataset.standard = template.standard || '';
            card.dataset.libraryRole = template.library_role || '';
            card.setAttribute('aria-label', template.name + ' auswählen oder ziehen');
            card.setAttribute('title', 'Ziehen fügt genau eine Instanz ein; Klick aktiviert einmalige Platzierung.');
            const mode = imported.has(template.id) ? 'Anlagen-Import · 1 Objekt'
                : (template.style === 'classic' ? (structureTab ? 'Gestell · 1 Objekt' : 'Klassik · 1 Objekt')
                    : (template.id === 'Flange_pair' ? 'Baugruppe · 1 Objekt' : 'Element · 1 Objekt'));
            card.dataset.style = template.style || 'standard';
            card.dataset.layer = templateLayer(template);
            card.append(
                templatePreview(template),
                htmlNode('span', 'plant-drawing-template-card__mode', mode),
                htmlNode('strong', '', template.name),
                htmlNode('small', '', template.ports.length + ' Ports · ' + template.id)
            );
            function activateTemplate(event) {
                if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ')
                    return;
                if (event.type === 'keydown')
                    event.preventDefault();
                ui.palettePreviewTemplateId = template.id;
                ui.palettePreviewAssemblyId = '';
                ui.selection = emptySelection();
                setTool('place', template.id);
                renderPalette();
                renderInspector();
                showStatus(template.name + ' gewählt · einmalig platzieren oder direkt ziehen', 'info', 2800);
            }
            function dragTemplate(event) {
                ui.palettePreviewTemplateId = template.id;
                ui.palettePreviewAssemblyId = '';
                ui.selection = emptySelection();
                event.dataTransfer.setData(TEMPLATE_TRANSFER_TYPE, template.id);
                event.dataTransfer.setData('templateId', template.id);
                event.dataTransfer.effectAllowed = 'copy';
                card.classList.add('is-dragging');
                renderInspector();
            }
            function finishTemplateDrag() {
                card.classList.remove('is-dragging');
            }
            card.addEventListener('click', activateTemplate);
            card.addEventListener('keydown', activateTemplate);
            card.addEventListener('dragstart', dragTemplate);
            card.addEventListener('dragend', finishTemplateDrag);
            grid.appendChild(card);
        });
        section.append(header, grid);
        target.appendChild(section);
    });
    if (!templates.length)
        target.appendChild(htmlNode('p', 'hint-text', 'Keine passende Komponente gefunden.'));
    renderImportControls();
}

function renderImportControls() {
    const select = byId('plant-drawing-import-select');
    const button = byId('plant-drawing-import-button');
    if (!select || !button)
        return;
    const previous = select.value;
    select.replaceChildren();
    const candidates = plantOnlyTemplates();
    const placeholder = htmlNode('option', '', candidates.length
        ? 'Anlagen-Symbol wählen …' : 'Keine weiteren Anlagen-Symbole');
    placeholder.value = '';
    select.appendChild(placeholder);
    candidates.forEach(function (template) {
        const option = htmlNode('option', '', template.name + ' · ' + (template.standard || 'CUSTOM'));
        option.value = template.id;
        select.appendChild(option);
    });
    select.value = Array.from(select.options).some(function (option) { return option.value === previous; })
        ? previous : '';
    select.disabled = !candidates.length;
    button.disabled = !candidates.length;
}

function importPlantTemplateIntoDrawing() {
    const select = byId('plant-drawing-import-select');
    const templateId = select ? textValue(select.value, '') : '';
    const template = templateById(templateId);
    if (!template) {
        showStatus('Bitte ein Anlagen-Symbol für die Übernahme wählen.', 'error');
        return;
    }
    const next = committedModel();
    if (!next.inventory.imported_template_ids.includes(templateId))
        next.inventory.imported_template_ids.push(templateId);
    state.set('plant_drawing', next);
    state.saveHistory();
    renderPalette();
    renderAssemblyPalette();
    showStatus('"' + template.name + '" steht jetzt im Zeichen-Inventar bereit.', 'success', 3200);
}

function renderAssemblyPalette() {
    const target = byId('plant-drawing-assembly-palette');
    if (!target)
        return;
    target.replaceChildren();
    const query = textValue(byId('plant-drawing-search').value, '').toLowerCase();
    const templates = allAssemblyTemplates().filter(function (template) {
        return !query || [template.name, template.category, template.template_ids.join(' ')]
            .join(' ').toLowerCase().includes(query);
    });
    const counter = byId('plant-drawing-assembly-count');
    if (counter)
        counter.textContent = String(allAssemblyTemplates().length);
    if (!templates.length) {
        target.append(
            htmlNode('p', 'hint-text', 'Noch keine Baugruppen. Mehrere Teile auswählen und rechts „Als Baugruppe speichern“ wählen.'),
            htmlNode('p', 'hint-text', 'Baugruppen bleiben aus Einzelteilen zusammengesetzt: beim Platzieren entstehen wieder einzelne, konfigurierbare Entities.')
        );
        return;
    }
    const grid = htmlNode('div', 'plant-drawing-template-grid plant-drawing-assembly-grid');
    templates.forEach(function (template) {
        const active = ui.selectedAssemblyTemplateId === template.assembly_template_id;
        const card = htmlNode('button', 'plant-drawing-template-card plant-drawing-assembly-card' + (active ? ' active' : ''));
        card.type = 'button';
        card.draggable = true;
        card.dataset.assemblyTemplateId = template.assembly_template_id;
        card.dataset.scope = template.scope;
        card.setAttribute('aria-label', template.name + ' platzieren oder ziehen');
        card.setAttribute('title', 'Ziehen oder klicken platziert alle Teile der Baugruppe als einzelne Entities.');
        const preview = htmlNode('span', 'plant-drawing-template-card__preview');
        preview.appendChild(assemblyPreviewSvg(template));
        card.append(
            preview,
            htmlNode('span', 'plant-drawing-template-card__mode', 'Baugruppe · ' + template.entities.length + ' Teile · '
                + (template.scope === 'library' ? 'Bibliothek' : 'Projekt')),
            htmlNode('strong', '', template.name),
            htmlNode('small', '', template.exposed_ports.length + ' freie Ports · ' + template.category)
        );
        function activateAssembly(event) {
            if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ')
                return;
            if (event.type === 'keydown')
                event.preventDefault();
            ui.palettePreviewAssemblyId = template.assembly_template_id;
            ui.palettePreviewTemplateId = '';
            ui.selection = emptySelection();
            setTool('place', '', template.assembly_template_id);
            renderAssemblyPalette();
            renderInspector();
            showStatus('Baugruppe "' + template.name + '" gewählt · einmalig platzieren oder direkt ziehen', 'info', 2800);
        }
        function dragAssembly(event) {
            ui.palettePreviewAssemblyId = template.assembly_template_id;
            ui.palettePreviewTemplateId = '';
            ui.selection = emptySelection();
            event.dataTransfer.setData(ASSEMBLY_TRANSFER_TYPE, template.assembly_template_id);
            event.dataTransfer.effectAllowed = 'copy';
            card.classList.add('is-dragging');
            renderInspector();
        }
        function finishAssemblyDrag() {
            card.classList.remove('is-dragging');
        }
        card.addEventListener('click', activateAssembly);
        card.addEventListener('keydown', activateAssembly);
        card.addEventListener('dragstart', dragAssembly);
        card.addEventListener('dragend', finishAssemblyDrag);
        grid.appendChild(card);
    });
    target.appendChild(grid);
}

function updateInventoryTabs() {
    queryAll('[data-inventory-tab]').forEach(function (button) {
        const active = button.dataset.inventoryTab === ui.inventoryTab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const elements = byId('plant-drawing-template-palette');
    const assemblies = byId('plant-drawing-assembly-palette');
    const importSection = byId('plant-drawing-import-section');
    const category = byId('plant-drawing-category');
    const elementsLike = ui.inventoryTab === 'elements' || ui.inventoryTab === 'structure';
    if (elements)
        elements.hidden = !elementsLike;
    if (assemblies)
        assemblies.hidden = ui.inventoryTab !== 'assemblies';
    if (importSection)
        importSection.hidden = ui.inventoryTab !== 'elements';
    if (category)
        category.hidden = ui.inventoryTab !== 'elements';
    const structureCount = byId('plant-drawing-structure-count');
    if (structureCount)
        structureCount.textContent = String(structureTemplates().length);
}

function setInventoryTab(tab) {
    const previous = ui.inventoryTab;
    ui.inventoryTab = INVENTORY_TABS.includes(tab) ? tab : 'elements';
    updateInventoryTabs();
    if (previous !== ui.inventoryTab && ui.inventoryTab !== 'assemblies')
        renderPalette();
}

function updateCategoryOptions() {
    const select = byId('plant-drawing-category');
    const previous = select.value;
    select.replaceChildren();
    const optionAll = htmlNode('option', '', 'Alle Kategorien');
    optionAll.value = '';
    select.appendChild(optionAll);
    const categories = new Set(drawingElementTemplates().filter(function (template) {
        return templateLayer(template) !== 'structure';
    }).map(function (template) { return template.kategorie; }));
    templateRegistry.getAllKategorien().forEach(function (category) {
        if (!categories.has(category))
            return;
        const option = htmlNode('option', '', category);
        option.value = category;
        select.appendChild(option);
    });
    select.value = Array.from(select.options).some(function (option) {
        return option.value === previous;
    }) ? previous : '';
}

async function saveSelectionAsAssembly() {
    const sheet = currentSheet();
    const selection = selectionCount(ui.selection) ? ui.selection : wholeSheetSelection(sheet);
    if (!selection.entity_ids.length) {
        showStatus('Bitte mindestens eine Komponente für die Baugruppe auswählen.', 'error');
        return null;
    }
    const name = textValue(byId('plant-drawing-inventory-name').value, 'Eigene Baugruppe');
    const category = textValue(byId('plant-drawing-inventory-category').value, 'Baugruppen');
    let template;
    try {
        template = createAssemblyTemplate(sheet, selection, {
            name: name,
            category: category,
            scope: 'library',
            created_at: new Date().toISOString()
        });
    }
    catch (error) {
        handleError(error, 'Die Baugruppe konnte nicht erstellt werden');
        return null;
    }
    let persisted = false;
    try {
        const response = await api.post('/api/drawing-assemblies', { assembly: template });
        if (!response || !response.erfolg)
            throw new Error(response && response.fehler ? response.fehler : 'Speichern fehlgeschlagen');
        template = normalizeAssemblyTemplate(response.assembly || template);
        template.scope = 'library';
        persisted = true;
    }
    catch (error) {
        console.warn('Baugruppe nur im Projekt gespeichert:', error.message);
        template.scope = 'project';
    }
    const next = upsertAssemblyTemplate(committedModel(), template);
    state.set('plant_drawing', next);
    state.saveHistory();
    if (persisted) {
        ui.libraryAssemblies = ui.libraryAssemblies.filter(function (item) {
            return item.assembly_template_id !== template.assembly_template_id;
        }).concat([template]);
    }
    setInventoryTab('assemblies');
    renderAssemblyPalette();
    renderAll();
    showStatus('Baugruppe "' + template.name + '" mit ' + template.entities.length
        + ' Teilen im Zeichen-Inventar gespeichert' + (persisted ? '' : ' (nur Projekt)') + '.', 'success', 3600);
    return template;
}

function deleteAssemblyTemplate(assemblyTemplateId) {
    const template = assemblyTemplateById(assemblyTemplateId);
    if (!template)
        return;
    showConfirmation(
        'Baugruppe „' + template.name + '“ aus dem Zeichen-Inventar entfernen?',
        {
            title: 'Baugruppe löschen',
            detail: 'Bereits platzierte Teile bleiben in der Skizze erhalten.',
            confirmLabel: 'Baugruppe löschen',
            destructive: true
        },
        async function () {
            try {
                await api.post('/api/drawing-assemblies/loeschen', { assembly_template_id: assemblyTemplateId });
            }
            catch (error) {
                console.warn('Bibliothekseintrag konnte nicht gelöscht werden:', error.message);
            }
            ui.libraryAssemblies = ui.libraryAssemblies.filter(function (item) {
                return item.assembly_template_id !== assemblyTemplateId;
            });
            const next = removeAssemblyTemplate(committedModel(), assemblyTemplateId);
            state.set('plant_drawing', next);
            state.saveHistory();
            if (ui.palettePreviewAssemblyId === assemblyTemplateId)
                ui.palettePreviewAssemblyId = '';
            renderAssemblyPalette();
            renderAll();
            showStatus('Baugruppe entfernt.', 'success');
        }
    );
}

function placeAssembly(point, assemblyTemplateId, sourceLabel) {
    const template = assemblyTemplateById(textValue(assemblyTemplateId, ui.selectedAssemblyTemplateId));
    if (!template) {
        showStatus('Bitte zuerst eine Baugruppe wählen.', 'error');
        return null;
    }
    const sheet = currentSheet();
    const originX = snapPlantValue(point.x - template.width / 2, sheet, ui.snapEnabled);
    const originY = snapPlantValue(point.y - template.height / 2, sheet, ui.snapEnabled);
    const result = instantiateAssemblyTemplate(currentModel(), template, originX, originY);
    let model = result.model;
    let message = 'Baugruppe "' + template.name + '" mit ' + result.selection.entity_ids.length + ' Teilen platziert';
    if (ui.snapEnabled) {
        const snapped = snapSelectionToPorts(model, result.selection.entity_ids);
        model = snapped.model;
        if (snapped.connections.length)
            message += ' · ' + snapped.connections.length + ' Port(s) gekoppelt';
    }
    ui.selection = result.selection;
    ui.palettePreviewAssemblyId = '';
    ui.selectedAssemblyTemplateId = '';
    ui.tool = 'select';
    commitModel(model, 'Baugruppe platziert');
    renderAssemblyPalette();
    showStatus(message + (sourceLabel ? ' · ' + sourceLabel : ''), 'success', 3200);
    return result;
}

function snapSelectionToPorts(modelValue, entityIds) {
    const sheet = getActivePlantSheet(modelValue);
    const candidate = findPlantSnapCandidate(sheet, entityIds, snapTolerance());
    if (!candidate)
        return createPlantJoints(modelValue, entityIds, 0.75);
    const moved = translatePlantEntities(modelValue, entityIds, candidate.dx, candidate.dy);
    return createPlantJoints(moved, entityIds, 0.75);
}

function safeFilename(value) {
    const normalized = textValue(value, 'Eigene_Komponente')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return (normalized || 'Eigene_Komponente').slice(0, 80) + '.svg';
}

function customEntityMetadata(name, category, artifact, compositionValue) {
    const metadata = {
        name: name,
        kategorie: category,
        family: 'custom-composition',
        symbol_type: 'custom-composition',
        library_role: 'custom',
        standard: 'CUSTOM',
        default_visible: false,
        breite: artifact.width,
        hoehe: artifact.height,
        view_box: [0, 0, artifact.width, artifact.height],
        ports: artifact.ports,
        aliases: ['plant drawing', 'baugruppe', 'custom'],
        animierbare_bereiche: [
            '[data-pf-state-target]',
            '.pid-state-fill',
            '.pid-flow',
            '.pid-warning'
        ],
        runtime_states: ['ready', 'running', 'warning', 'alarm', 'disabled', 'maintenance'],
        capabilities: {
            selectable: true,
            movable: true,
            resizable: true,
            rotatable: true,
            connectable: true,
            bindable: true,
            animatable: true,
            configurable: true,
            auto_create_hmi_widgets: false
        }
    };
    const composition = compositionValue && typeof compositionValue === 'object' ? compositionValue : {};
    return Object.assign(metadata, composition);
}

async function saveToInventory(activateAfterSave) {
    const artifact = buildSvgArtifact(ui.selection, false);
    if (!artifact) {
        showStatus('Bitte mindestens eine Komponente oder Zeichnung auswählen.', 'error');
        return;
    }
    const name = textValue(byId('plant-drawing-inventory-name').value, 'Eigene Komponente');
    const category = textValue(byId('plant-drawing-inventory-category').value, 'Custom');
    const metadata = customEntityMetadata(name, category, artifact);
    try {
        const response = await api.uploadTemplate(safeFilename(name), artifact.svg, metadata);
        if (!response || !response.erfolg)
            throw new Error(response && response.fehler ? response.fehler : 'Upload fehlgeschlagen');
        const next = normalizePlantDrawing(currentModel());
        next.custom_templates = next.custom_templates.filter(function (item) {
            return item.template_id !== response.template_id;
        });
        next.custom_templates.push({
            template_id: response.template_id,
            name: name,
            source_sheet_id: next.active_sheet_id,
            created_at: new Date().toISOString(),
            entity_ids: artifact.collected.entities.map(function (entity) {
                return entity.entity_id;
            })
        });
        state.set('plant_drawing', next);
        state.saveHistory();
        await templateRegistry.reloadTemplates();
        updateCategoryOptions();
        renderPalette();
        revealCustomTemplateInPlantLibrary(response.template_id);
        showStatus('Anlagen-Inventar: Entity "' + name + '" unter „Eigene Symbole“ gespeichert.', 'success', 3600);
        if (activateAfterSave)
            insertCustomTemplateInPlant(response.template_id, artifact);
    }
    catch (error) {
        handleError(error, 'Die Auswahl konnte nicht in das Anlagen-Inventar übernommen werden');
    }
}

function revealCustomTemplateInPlantLibrary(templateId) {
    // The plant library hides custom symbols behind the "Eigene Symbole" scope:
    // switch the scope so the saved entity is visible immediately.
    const filter = byId('kategorie-filter');
    if (filter && Array.from(filter.options).some(function (option) { return option.value === '__custom__'; })) {
        filter.value = '__custom__';
        filter.dispatchEvent(new Event('change', { bubbles: true }));
    }
    window.setTimeout(function () {
        const card = document.querySelector('#template-palette .template-item[data-template-id="' + templateId + '"]');
        if (!card)
            return;
        card.classList.add('is-drawing-highlight');
        if (typeof card.scrollIntoView === 'function')
            card.scrollIntoView({ block: 'nearest' });
        window.setTimeout(function () { card.classList.remove('is-drawing-highlight'); }, 2600);
    }, 80);
}

function insertCustomTemplateInPlant(templateId, artifact) {
    const button = document.querySelector('[data-target-tab="elements"][data-workspace="engineering"]');
    if (button)
        button.click();
    window.setTimeout(function () {
        if (!elementManager || typeof elementManager.addElement !== 'function') {
            state.emit('template:activate', { templateId: templateId });
            return;
        }
        const center = plantCanvasCenter();
        const width = numberValue(artifact && artifact.width, 200);
        const height = numberValue(artifact && artifact.height, 120);
        const elementId = elementManager.addElement(templateId,
            Math.max(40, Math.round(center.x - width / 2)), Math.max(40, Math.round(center.y - height / 2)));
        if (!elementId)
            state.emit('template:activate', { templateId: templateId });
    }, 120);
}

async function transferAssemblyToPlantInventory(assemblyTemplateId) {
    const template = assemblyTemplateById(assemblyTemplateId);
    if (!template)
        return;
    const artifactSheet = {
        sheet_id: 'assembly_transfer',
        name: template.name,
        width: template.width,
        height: template.height,
        grid: 10,
        entities: template.entities,
        connections: template.connections,
        primitives: template.primitives,
        reference: null
    };
    const previousPreview = ui.previewModel;
    const model = createEmptyPlantDrawing();
    model.sheets = [artifactSheet];
    model.active_sheet_id = 'assembly_transfer';
    ui.previewModel = normalizePlantDrawing(model);
    const previousSelection = ui.selection;
    ui.selection = wholeSheetSelection(getActivePlantSheet(ui.previewModel));
    const artifact = buildSvgArtifact(ui.selection, true);
    ui.previewModel = previousPreview;
    ui.selection = previousSelection;
    if (!artifact) {
        showStatus('Die Baugruppe enthält keine darstellbaren Teile.', 'error');
        return;
    }
    try {
        const response = await api.uploadTemplate(
            safeFilename(template.name),
            artifact.svg,
            customEntityMetadata(template.name, 'Custom', artifact, {
                composition_mode: 'structured-assembly',
                assembly_template_id: template.assembly_template_id,
                assembly_template: normalizeAssemblyTemplate(template),
                assembly_export_bounds: cloneValue(artifact.bounds),
                assembly_part_count: template.entities.length,
                assembly_connection_count: template.connections.length
            })
        );
        if (!response || !response.erfolg)
            throw new Error(response && response.fehler ? response.fehler : 'Upload fehlgeschlagen');
        await templateRegistry.reloadTemplates();
        updateCategoryOptions();
        renderPalette();
        revealCustomTemplateInPlantLibrary(response.template_id || '');
        showStatus('Baugruppe "' + template.name + '" strukturiert übernommen · beim Platzieren bleiben alle Teile einzeln editierbar.', 'success', 4200);
    }
    catch (error) {
        handleError(error, 'Die Baugruppe konnte nicht in das Anlagen-Inventar übernommen werden');
    }
}

function plantCanvasCenter() {
    const canvas = byId('main-canvas');
    if (!canvas)
        return { x: 200, y: 200 };
    try {
        const bounds = canvas.getBoundingClientRect();
        const point = canvas.createSVGPoint();
        point.x = bounds.left + bounds.width / 2;
        point.y = bounds.top + bounds.height / 2;
        const matrix = canvas.getScreenCTM();
        const mapped = matrix ? point.matrixTransform(matrix.inverse()) : point;
        const zoom = Number(state.get('zoom')) || 1;
        const pan = state.get('pan') || { x: 0, y: 0 };
        return {
            x: (mapped.x - Number(pan.x || 0)) / zoom,
            y: (mapped.y - Number(pan.y || 0)) / zoom
        };
    }
    catch (error) {
        return { x: 200, y: 200 };
    }
}

function createPlantConnectionWithFallback(fromId, fromPort, toId, toPort, type, optionsValue) {
    const options = optionsValue && typeof optionsValue === 'object' ? optionsValue : {};
    const attempts = [
        [fromId, toId, Object.assign({}, options, { fromPort: fromPort, toPort: toPort })],
        [toId, fromId, Object.assign({}, options, { fromPort: toPort, toPort: fromPort })],
        [fromId, toId, Object.assign({}, options)],
        [toId, fromId, Object.assign({}, options)]
    ];
    for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        const resolved = typeof connectionManager.resolvePortPair === 'function'
            ? connectionManager.resolvePortPair(attempt[0], attempt[1], type,
                attempt[2].fromPort || null, attempt[2].toPort || null)
            : { ok: true };
        if (!resolved || !resolved.ok)
            continue;
        const created = connectionManager.createConnection(attempt[0], attempt[1], type, attempt[2]);
        if (created)
            return created;
    }
    return null;
}

function roundDrawingValue(value) {
    return Math.round(Number(value || 0) * 1000) / 1000;
}

function structuredAssemblyTemplate(template) {
    return Boolean(template && template.composition_mode === 'structured-assembly');
}

function normalizedAssemblyName(value) {
    return textValue(value, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}

function drawingMetadataFromTemplate(template) {
    const svg = template && typeof template.svg === 'string' ? template.svg : '';
    if (!svg)
        return null;
    try {
        const documentValue = new DOMParser().parseFromString(svg, 'image/svg+xml');
        if (documentValue.querySelector('parsererror'))
            return null;
        const metadata = documentValue.querySelector('metadata#pf-plant-drawing-metadata');
        if (!metadata || !metadata.textContent)
            return null;
        const value = JSON.parse(metadata.textContent);
        return value && typeof value === 'object' ? value : null;
    }
    catch (error) {
        return null;
    }
}

function assemblyTemplateSignature(template) {
    const normalized = normalizeAssemblyTemplate(template);
    const ids = normalized.entities.map(function (entity) {
        return textValue(entity.template_id, '');
    }).filter(Boolean).sort();
    return ids.length + ':' + ids.join('|');
}

function plantTemplateSignature(template) {
    const metadata = drawingMetadataFromTemplate(template);
    if (!metadata || !Array.isArray(metadata.entities))
        return '';
    const ids = metadata.entities.map(function (entity) {
        return textValue(entity && entity.template_id, '');
    }).filter(Boolean).sort();
    return ids.length + ':' + ids.join('|');
}

function assemblyTemplateForPlantTemplate(template) {
    if (!template)
        return null;
    if (template.assembly_template && Array.isArray(template.assembly_template.entities)
        && template.assembly_template.entities.length) {
        return normalizeAssemblyTemplate(template.assembly_template);
    }
    const linked = assemblyTemplateById(textValue(template.assembly_template_id, ''));
    if (linked)
        return linked;
    const name = normalizedAssemblyName(template.name);
    if (name) {
        const named = allAssemblyTemplates().find(function (candidate) {
            return normalizedAssemblyName(candidate.name) === name;
        });
        if (named)
            return named;
    }
    const signature = plantTemplateSignature(template);
    if (!signature)
        return null;
    return allAssemblyTemplates().find(function (candidate) {
        return assemblyTemplateSignature(candidate) === signature;
    }) || null;
}

function assemblyExportBounds(template, assembly) {
    const source = template && template.assembly_export_bounds
        && typeof template.assembly_export_bounds === 'object'
        ? template.assembly_export_bounds : null;
    if (source && Number.isFinite(Number(source.x)) && Number.isFinite(Number(source.y))
        && Number(source.width) > 0 && Number(source.height) > 0) {
        return {
            x: Number(source.x),
            y: Number(source.y),
            width: Number(source.width),
            height: Number(source.height)
        };
    }
    const viewBox = templateViewBox(template);
    const viewWidth = Math.max(1, numberValue(viewBox[2], assembly.width));
    const viewHeight = Math.max(1, numberValue(viewBox[3], assembly.height));
    return {
        x: -(viewWidth - assembly.width) / 2,
        y: -(viewHeight - assembly.height) / 2,
        width: viewWidth,
        height: viewHeight
    };
}

function carrierPivot(data) {
    const width = Math.max(1, numberValue(data.width, 100));
    const height = Math.max(1, numberValue(data.height, 100));
    const mode = textValue(data.pivotMode, 'center');
    if (mode === 'custom') {
        return {
            x: numberValue(data.pivotX, 0),
            y: numberValue(data.pivotY, 0)
        };
    }
    if (mode === 'topleft')
        return { x: 0, y: 0 };
    if (mode === 'top')
        return { x: width / 2, y: 0 };
    if (mode === 'right')
        return { x: width, y: height / 2 };
    if (mode === 'bottom')
        return { x: width / 2, y: height };
    return { x: width / 2, y: height / 2 };
}

function assemblyPlacement(template, assembly, carrier) {
    const data = carrier.data;
    const viewBox = templateViewBox(template);
    const viewWidth = Math.max(1, numberValue(viewBox[2], assembly.width));
    const viewHeight = Math.max(1, numberValue(viewBox[3], assembly.height));
    const width = Math.max(1, numberValue(data.width, viewWidth));
    const height = Math.max(1, numberValue(data.height, viewHeight));
    const fitScale = Math.min(width / viewWidth, height / viewHeight);
    const pivot = carrierPivot(data);
    return {
        originX: numberValue(data.x, 0),
        originY: numberValue(data.y, 0),
        viewBox: viewBox,
        exportBounds: assemblyExportBounds(template, assembly),
        fitScale: fitScale,
        letterboxX: (width - viewWidth * fitScale) / 2,
        letterboxY: (height - viewHeight * fitScale) / 2,
        parentScale: Math.max(0.01, numberValue(data.scale, 1)),
        rotation: numberValue(data.rotation, 0) * Math.PI / 180,
        pivotX: pivot.x,
        pivotY: pivot.y
    };
}

function transformAssemblyPoint(placement, x, y) {
    const localX = placement.letterboxX
        + (Number(x) - placement.exportBounds.x - Number(placement.viewBox[0])) * placement.fitScale;
    const localY = placement.letterboxY
        + (Number(y) - placement.exportBounds.y - Number(placement.viewBox[1])) * placement.fitScale;
    const scaledX = placement.pivotX + (localX - placement.pivotX) * placement.parentScale;
    const scaledY = placement.pivotY + (localY - placement.pivotY) * placement.parentScale;
    const deltaX = scaledX - placement.pivotX;
    const deltaY = scaledY - placement.pivotY;
    const cosine = Math.cos(placement.rotation);
    const sine = Math.sin(placement.rotation);
    return {
        x: placement.originX + placement.pivotX + deltaX * cosine - deltaY * sine,
        y: placement.originY + placement.pivotY + deltaX * sine + deltaY * cosine
    };
}

function transformAssemblyEntity(placement, entityValue) {
    const entity = cloneValue(entityValue);
    const center = transformAssemblyPoint(
        placement,
        entity.x + entity.width / 2,
        entity.y + entity.height / 2
    );
    entity.width = roundDrawingValue(entity.width * placement.fitScale * placement.parentScale);
    entity.height = roundDrawingValue(entity.height * placement.fitScale * placement.parentScale);
    entity.x = roundDrawingValue(center.x - entity.width / 2);
    entity.y = roundDrawingValue(center.y - entity.height / 2);
    entity.rotation = roundDrawingValue(entity.rotation + placement.rotation * 180 / Math.PI);
    return entity;
}

function offsetDrawingEntity(offsetX, offsetY, entityValue) {
    const entity = cloneValue(entityValue);
    entity.x = roundDrawingValue(entity.x + offsetX);
    entity.y = roundDrawingValue(entity.y + offsetY);
    return entity;
}

function addDrawingEntitiesToPlant(entitiesValue, transformEntity, groupValue) {
    const entities = Array.isArray(entitiesValue) ? entitiesValue : [];
    const group = groupValue && typeof groupValue === 'object' ? groupValue : {};
    const idMap = new Map();
    entities.forEach(function (sourceEntity) {
        const entity = transformEntity(sourceEntity);
        const template = templateById(entity.template_id);
        if (!template)
            return;
        const elementId = elementManager.addElement(entity.template_id, entity.x, entity.y, {
            skipStructuredPlacement: true,
            deferHistory: true
        });
        if (!elementId)
            return;
        idMap.set(sourceEntity.entity_id, elementId);
        const existing = elementManager.getElement(elementId);
        const existingProperties = existing && existing.data && existing.data.properties
            && typeof existing.data.properties === 'object' ? existing.data.properties : {};
        const updates = {
            rotation: entity.rotation,
            name: entity.name,
            description: entity.name,
            properties: Object.assign({}, existingProperties, entity.properties, {
                drawing_source_entity_id: sourceEntity.entity_id,
                drawing_assembly_id: group.id || sourceEntity.assembly_id || '',
                drawing_assembly_template_id: group.templateId || sourceEntity.assembly_template_id || '',
                drawing_assembly_name: group.name || sourceEntity.assembly_name || '',
                drawing_assembly_role: 'part',
                drawing_flip_x: entity.flip_x === true,
                drawing_flip_y: entity.flip_y === true,
                drawing_inverted: entity.inverted === true,
                drawing_scale_mode: entity.scale_mode,
                drawing_visual_state: entity.visual_state,
                drawing_layer: entity.layer
            })
        };
        if (entity.tag)
            updates.tag = entity.tag;
        const sizeChanged = Math.abs(entity.width - numberValue(template.breite, entity.width)) > 0.5
            || Math.abs(entity.height - numberValue(template.hoehe, entity.height)) > 0.5;
        if (sizeChanged) {
            updates.width = entity.width;
            updates.height = entity.height;
            updates.geometry_custom = true;
            updates.geometry = {
                base_width: entity.width,
                base_height: entity.height,
                view_box: templateViewBox(template)
            };
        }
        elementManager.updateElement(elementId, updates);
    });
    return idMap;
}

function addDrawingConnectionsToPlant(connectionsValue, idMap) {
    const connections = Array.isArray(connectionsValue) ? connectionsValue : [];
    let count = 0;
    connections.forEach(function (connection) {
        const fromId = idMap.get(connection.from_entity_id);
        const toId = idMap.get(connection.to_entity_id);
        if (!fromId || !toId || connection.kind === 'structure')
            return;
        const type = PLANT_CONNECTION_TYPES[connection.kind] || 'pipe';
        const created = createPlantConnectionWithFallback(
            fromId,
            connection.from_port_id,
            toId,
            connection.to_port_id,
            type,
            { deferHistory: true }
        );
        if (created)
            count += 1;
    });
    return count;
}

function activatePlantElementsWorkspace() {
    const button = document.querySelector('[data-target-tab="elements"][data-workspace="engineering"]');
    if (button)
        button.click();
}

function layoutCarrierProperties(assembly, groupId, existingProperties) {
    return Object.assign({}, existingProperties || {}, {
        drawing_assembly_role: 'layout',
        drawing_hide_embedded_entities: true,
        drawing_assembly_id: groupId,
        drawing_assembly_template_id: assembly.assembly_template_id,
        drawing_assembly_name: assembly.name,
        drawing_assembly_part_count: assembly.entities.length,
        drawing_assembly_connection_count: assembly.connections.length
    });
}

function placeStructuredAssemblyTemplate(template, x, y, existingCarrierId) {
    const assembly = assemblyTemplateForPlantTemplate(template);
    if (!assembly || !assembly.entities.length) {
        showStatus('Die strukturierte Baugruppe enthält keine gültigen Einzelteile.', 'error');
        return { handled: true, elementId: null };
    }
    let carrier = existingCarrierId ? elementManager.getElement(existingCarrierId) : null;
    const previousProperties = carrier && carrier.data && carrier.data.properties
        && typeof carrier.data.properties === 'object' ? carrier.data.properties : {};
    const groupId = textValue(previousProperties.drawing_assembly_id, 'drawing_' + Date.now().toString(36));
    const properties = layoutCarrierProperties(assembly, groupId, previousProperties);
    let carrierId = carrier ? carrier.data.id : '';
    if (carrier) {
        elementManager.updateElement(carrierId, {
            name: assembly.name + ' · Zeichnungsebene',
            description: 'Maße, Beschriftungen und Skizzengeometrie der Baugruppe',
            tag: '',
            properties: properties
        });
    }
    else {
        carrierId = elementManager.addElement(template.id, x, y, {
            skipStructuredPlacement: true,
            deferHistory: true,
            instanceUpdates: {
                name: assembly.name + ' · Zeichnungsebene',
                description: 'Maße, Beschriftungen und Skizzengeometrie der Baugruppe',
                tag: '',
                properties: properties
            }
        });
        carrier = carrierId ? elementManager.getElement(carrierId) : null;
    }
    if (!carrier) {
        showStatus('Die Zeichnungsebene der Baugruppe konnte nicht angelegt werden.', 'error');
        return { handled: true, elementId: null };
    }
    const placement = assemblyPlacement(template, assembly, carrier);
    const transformEntity = transformAssemblyEntity.bind(null, placement);
    const idMap = addDrawingEntitiesToPlant(assembly.entities, transformEntity, {
        id: groupId,
        templateId: assembly.assembly_template_id,
        name: assembly.name
    });
    const connectionCount = addDrawingConnectionsToPlant(assembly.connections, idMap);
    state.saveHistory();
    activatePlantElementsWorkspace();
    const elementIds = Array.from(idMap.values());
    if (elementIds.length)
        elementManager.selectElement(elementIds[0]);
    showStatus(assembly.name + ' strukturiert platziert · ' + elementIds.length
        + ' Einzelteile und ' + connectionCount + ' Verbindungen bleiben separat konfigurierbar.', 'success', 4800);
    return {
        handled: true,
        elementId: elementIds[0] || null,
        elementIds: elementIds,
        layoutElementId: carrierId,
        connections: connectionCount
    };
}

function handleStructuredAssemblyPlacement(template, x, y) {
    if (!structuredAssemblyTemplate(template))
        return null;
    return placeStructuredAssemblyTemplate(template, x, y, '');
}

function instanceFallbackTemplate(data) {
    return {
        id: textValue(data.templateId, 'custom-symbol'),
        name: textValue(data.name, 'Eigene Baugruppe'),
        kategorie: 'Custom',
        family: textValue(data.family, 'custom-composition'),
        symbol_type: textValue(data.symbolType, 'custom-composition'),
        library_role: 'custom',
        standard: textValue(data.standard, 'CUSTOM'),
        breite: numberValue(data.width, 100),
        hoehe: numberValue(data.height, 100),
        view_box: Array.isArray(data.viewBox) ? cloneValue(data.viewBox) : [0, 0, data.width, data.height],
        svg: textValue(data.svgContent, '')
    };
}

function legacyFlatAssemblyCandidate(elementId) {
    const item = elementManager.getElement(elementId);
    if (!item || !item.data)
        return null;
    const properties = item.data.properties && typeof item.data.properties === 'object'
        ? item.data.properties : {};
    if (properties.drawing_assembly_role === 'layout' || properties.drawing_assembly_role === 'part')
        return null;
    const template = templateById(item.data.templateId) || instanceFallbackTemplate(item.data);
    const custom = template.library_role === 'custom' || template.family === 'custom-composition'
        || template.symbol_type === 'custom-composition' || template.standard === 'CUSTOM';
    if (!custom)
        return null;
    const assembly = assemblyTemplateForPlantTemplate(template);
    if (!assembly || !assembly.entities.length)
        return null;
    return { item: item, template: template, assembly: assembly };
}

function expandLegacyFlatAssembly(elementId) {
    const candidate = legacyFlatAssemblyCandidate(elementId);
    if (!candidate) {
        showStatus('Für dieses Objekt wurde keine passende Baugruppenstruktur gefunden.', 'error');
        return null;
    }
    const template = Object.assign({}, candidate.template, {
        composition_mode: 'structured-assembly',
        assembly_template_id: candidate.assembly.assembly_template_id,
        assembly_template: cloneValue(candidate.assembly),
        assembly_export_bounds: assemblyExportBounds(candidate.template, candidate.assembly)
    });
    return placeStructuredAssemblyTemplate(
        template,
        candidate.item.data.x,
        candidate.item.data.y,
        candidate.item.data.id
    );
}

function appendAssemblyUpgradePanel() {
    const selected = state.get('selectedElements') || [];
    if (selected.length !== 1)
        return;
    const candidate = legacyFlatAssemblyCandidate(selected[0]);
    if (!candidate)
        return;
    const panel = byId('properties-panel');
    if (!panel || panel.querySelector('#prop-expand-drawing-assembly'))
        return;
    const host = panel.querySelector('.v1-properties') || panel;
    const section = htmlNode('section', 'v64-r6-assembly-upgrade');
    section.setAttribute('aria-labelledby', 'v64-r6-assembly-upgrade-title');
    const title = htmlNode('strong', '', 'Baugruppe elementar bearbeiten');
    title.id = 'v64-r6-assembly-upgrade-title';
    const description = htmlNode(
        'p',
        '',
        candidate.assembly.entities.length + ' erkannte Einzelteile werden deckungsgleich freigelegt. '
            + 'Die vorhandene SVG-Zeichnung bleibt als passive Ebene für Maße und Beschriftungen erhalten.'
    );
    const button = htmlNode('button', 'btn btn-primary', 'In einzeln editierbare Bauteile auflösen');
    button.id = 'prop-expand-drawing-assembly';
    button.type = 'button';
    button.addEventListener('click', function () {
        expandLegacyFlatAssembly(selected[0]);
    });
    section.append(title, description, button);
    host.appendChild(section);
}

function queueAssemblyUpgradePanel() {
    window.requestAnimationFrame(appendAssemblyUpgradePanel);
}

function bindStructuredAssemblySupport() {
    if (typeof elementManager.registerTemplatePlacementHandler === 'function')
        elementManager.registerTemplatePlacementHandler(handleStructuredAssemblyPlacement);
    state.on('selection:changed', queueAssemblyUpgradePanel);
    state.on('element:updated', queueAssemblyUpgradePanel);
    state.on('templates:loaded', queueAssemblyUpgradePanel);
    state.on('templates:reloaded', queueAssemblyUpgradePanel);
}

function placeSelectionInPlant() {
    const sheet = currentSheet();
    const selection = selectionCount(ui.selection) ? ui.selection : wholeSheetSelection(sheet);
    const collected = collectPlantSelection(sheet, selection);
    if (!collected.entities.length) {
        showStatus('Bitte mindestens eine Komponente auswählen.', 'error');
        return null;
    }
    if (!elementManager || typeof elementManager.addElement !== 'function') {
        showStatus('Das Anlagenbild ist nicht verfügbar.', 'error');
        return null;
    }
    const bounds = plantSelectionBounds(sheet, selection) || { x: 0, y: 0, width: 0, height: 0 };
    const center = plantCanvasCenter();
    // Centre the group on the visible plant canvas but never push parts out of the sheet.
    const offsetX = Math.round(Math.max(40 - bounds.x, center.x - bounds.width / 2 - bounds.x));
    const offsetY = Math.round(Math.max(40 - bounds.y, center.y - bounds.height / 2 - bounds.y));
    const idMap = new Map();
    const groupId = 'drawing_' + Date.now().toString(36);
    collected.entities.forEach(function (entity) {
        const template = templateById(entity.template_id);
        if (!template)
            return;
        const elementId = elementManager.addElement(entity.template_id, entity.x + offsetX, entity.y + offsetY);
        if (!elementId)
            return;
        idMap.set(entity.entity_id, elementId);
        const existing = elementManager.getElement(elementId);
        const existingProperties = existing && existing.data && existing.data.properties
            && typeof existing.data.properties === 'object' ? existing.data.properties : {};
        const updates = {
            rotation: entity.rotation,
            name: entity.name,
            description: entity.name,
            properties: Object.assign({}, existingProperties, entity.properties, {
                drawing_entity_id: entity.entity_id,
                drawing_assembly_id: entity.assembly_id || groupId,
                drawing_assembly_name: entity.assembly_name || '',
                // r4 geometry flags travel along so no configuration is lost in the plant picture.
                drawing_flip_x: entity.flip_x === true,
                drawing_flip_y: entity.flip_y === true,
                drawing_inverted: entity.inverted === true,
                drawing_scale_mode: entity.scale_mode,
                drawing_visual_state: entity.visual_state,
                drawing_layer: entity.layer
            })
        };
        if (entity.tag)
            updates.tag = entity.tag;
        const sizeChanged = Math.abs(entity.width - numberValue(template.breite, entity.width)) > 0.5
            || Math.abs(entity.height - numberValue(template.hoehe, entity.height)) > 0.5;
        if (sizeChanged) {
            updates.width = entity.width;
            updates.height = entity.height;
            updates.geometry_custom = true;
            updates.geometry = {
                base_width: entity.width,
                base_height: entity.height,
                view_box: templateViewBox(template)
            };
        }
        elementManager.updateElement(elementId, updates);
    });
    let connectionCount = 0;
    collected.connections.forEach(function (connection) {
        const fromId = idMap.get(connection.from_entity_id);
        const toId = idMap.get(connection.to_entity_id);
        if (!fromId || !toId || connection.kind === 'structure')
            return;
        const type = PLANT_CONNECTION_TYPES[connection.kind] || 'pipe';
        if (createPlantConnectionWithFallback(fromId, connection.from_port_id, toId, connection.to_port_id, type))
            connectionCount += 1;
    });
    const button = document.querySelector('[data-target-tab="elements"][data-workspace="engineering"]');
    if (button)
        button.click();
    showStatus(idMap.size + ' Einzelobjekte und ' + connectionCount
        + ' Verbindungen in das Anlagenbild übernommen · jedes Teil bleibt eigenständig konfigurierbar.', 'success', 4200);
    return { elements: Array.from(idMap.values()), connections: connectionCount };
}

function exportSvg() {
    const artifact = buildSvgArtifact(emptySelection(), true);
    if (!artifact) {
        showStatus('Die Anlagenskizze ist leer.', 'error');
        return;
    }
    utils.downloadFile(utils.svgToBlob(artifact.svg), safeFilename(currentSheet().name));
    showStatus('Anlagenskizze als SVG exportiert.', 'success');
}

function exportJson() {
    const blob = new Blob([
        JSON.stringify(normalizePlantDrawing(currentModel()), null, 2)
    ], { type: 'application/json' });
    utils.downloadFile(blob, safeFilename(currentSheet().name).replace(/\.svg$/i, '.json'));
    showStatus('Konstruktionsmodell als JSON exportiert.', 'success');
}

// ---------------------------------------------------------------------------
// Toolbar state and status line
// ---------------------------------------------------------------------------

function updateChrome() {
    queryAll('[data-drawing-tool]').forEach(function (button) {
        const active = button.dataset.drawingTool === ui.tool;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    queryAll('[data-connection-kind]').forEach(function (button) {
        const active = button.dataset.connectionKind === ui.connectionKind;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    byId('plant-drawing-grid-toggle').classList.toggle('active', ui.gridEnabled);
    byId('plant-drawing-snap-toggle').classList.toggle('active', ui.snapEnabled);
    const linked = byId('plant-drawing-linked-toggle');
    if (linked) {
        linked.classList.toggle('active', ui.linkedDrag);
        linked.setAttribute('aria-pressed', ui.linkedDrag ? 'true' : 'false');
    }
    const hints = byId('plant-drawing-port-toggle');
    if (hints) {
        hints.classList.toggle('active', ui.portHintsEnabled);
        hints.setAttribute('aria-pressed', ui.portHintsEnabled ? 'true' : 'false');
    }
    queryAll('[data-drawing-layer]').forEach(function (button) {
        const visible = layerVisible(button.dataset.drawingLayer);
        button.classList.toggle('active', visible);
        button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    });
    const animation = byId('plant-drawing-animation-toggle');
    if (animation) {
        animation.classList.toggle('active', ui.animationEnabled);
        animation.setAttribute('aria-pressed', ui.animationEnabled ? 'true' : 'false');
    }
    byId('plant-drawing-canvas').dataset.tool = ui.tool;
    updateInventoryTabs();
}

function updateStatus(message) {
    const target = byId('plant-drawing-status');
    if (message)
        target.textContent = message;
    else if (ui.snapCandidate)
        target.textContent = 'Einrasten: ' + ui.snapCandidate.moving_port_name + ' → '
            + ui.snapCandidate.target_entity_name + ' · ' + ui.snapCandidate.target_port_name;
    else if (ui.drag && ui.drag.mode === 'resize')
        target.textContent = 'Größe ändern · Umschalt hält das Seitenverhältnis';
    else if (ui.drag && ui.drag.mode === 'rotate')
        target.textContent = 'Drehen · Umschalt rastet in 15°-Schritten ein';
    else if (ui.pendingPort)
        target.textContent = 'Startport gewählt · jetzt Zielport anklicken';
    else if (ui.tool === 'place') {
        const template = templateById(ui.selectedTemplateId);
        const assembly = assemblyTemplateById(ui.selectedAssemblyTemplateId);
        target.textContent = assembly ? 'Baugruppe ' + assembly.name + ' platzieren'
            : (template ? template.name + ' platzieren' : 'Komponente wählen');
    }
    else if (ui.tool === 'connect')
        target.textContent = 'Klassische Verbindung · ' + ui.connectionKind + ' · zwei Ports anklicken';
    else if (ui.tool === 'pan' || ui.panning)
        target.textContent = 'Zeichenfläche verschieben · Mausrad scrollt, Strg + Mausrad zoomt, Strg + Ziehen verschiebt';
    else if (ui.tool === 'polyline')
        target.textContent = ui.draft && ui.draft.points && ui.draft.points.length
            ? 'Leitung: ' + ui.draft.points.length + ' Punkt(e) · Klick setzt, Doppelklick/Enter beendet, Umschalt = orthogonal, Rücktaste löscht'
            : 'Leitung zeichnen · erster Klick setzt den Startpunkt';
    else if (ui.tool === 'region')
        target.textContent = 'Bereich aufziehen (gestrichelter Rahmen mit Titel)';
    else if (ui.tool === 'dimension')
        target.textContent = 'Bemaßung aufziehen (Maßlinie mit Pfeilen und Text)';
    else if (['line', 'rect', 'ellipse', 'text'].includes(ui.tool))
        target.textContent = 'Zeichenelement aufziehen · ' + ui.tool;
    else
        target.textContent = selectionCount(ui.selection)
            ? selectionCount(ui.selection) + ' Objekt(e) ausgewählt · R dreht · F spiegelt · I invertiert · Rechtsklick für mehr'
            : 'Bereit · Teile an freie Ports ziehen, sie rasten ein · Strg + Ziehen verschiebt die Ansicht';
}

function renderAll() {
    if (!ui.initialized)
        return;
    renderCanvas();
    renderInspector();
    renderValidation();
    updateChrome();
    updateStatus();
}

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------

function rawCanvasPoint(event) {
    const point = utils.getSVGCoordinates(byId('plant-drawing-canvas'), event);
    const sheet = currentSheet();
    const limit = Math.max(sheet.width, sheet.height) * 4 + 4000;
    return {
        x: Math.max(-limit, Math.min(limit, point.x)),
        y: Math.max(-limit, Math.min(limit, point.y))
    };
}

function canvasPoint(event) {
    const point = rawCanvasPoint(event);
    const sheet = currentSheet();
    return {
        x: snapPlantValue(point.x, sheet, ui.snapEnabled),
        y: snapPlantValue(point.y, sheet, ui.snapEnabled)
    };
}

function snapTolerance() {
    return DEFAULT_SNAP_TOLERANCE / Math.max(0.35, Math.min(3.5, ui.zoom));
}

function startCanvasPan(event) {
    const canvas = byId('plant-drawing-canvas');
    ui.panning = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        originX: ui.pan.x,
        originY: ui.pan.y
    };
    canvas.classList.add('is-panning');
    try {
        canvas.setPointerCapture(event.pointerId);
    }
    catch (error) {
        // Synthetic gesture events may carry a pointer that is already captured.
    }
    updateStatus('Zeichenfläche verschieben');
}

function updateCanvasPan(event) {
    if (!ui.panning || ui.panning.pointerId !== event.pointerId)
        return;
    const scale = viewScale();
    ui.pan.x = ui.panning.originX - (event.clientX - ui.panning.clientX) / scale;
    ui.pan.y = ui.panning.originY - (event.clientY - ui.panning.clientY) / scale;
    applyViewBox();
}

function finishCanvasPan(event) {
    if (!ui.panning)
        return;
    const canvas = byId('plant-drawing-canvas');
    const pointerId = ui.panning.pointerId;
    ui.panning = null;
    canvas.classList.remove('is-panning');
    if (canvas.hasPointerCapture(pointerId))
        canvas.releasePointerCapture(pointerId);
    updateStatus();
}

function panCanvasByWheel(event) {
    const scale = viewScale();
    ui.pan.x += event.deltaX / scale;
    ui.pan.y += event.deltaY / scale;
    applyViewBox();
}

function transferredTemplateId(dataTransfer) {
    if (!dataTransfer)
        return '';
    return textValue(
        dataTransfer.getData(TEMPLATE_TRANSFER_TYPE)
            || dataTransfer.getData('templateId'),
        ''
    );
}

function transferredAssemblyId(dataTransfer) {
    if (!dataTransfer)
        return '';
    return textValue(dataTransfer.getData(ASSEMBLY_TRANSFER_TYPE), '');
}

function onCanvasDragOver(event) {
    const dataTransfer = event.dataTransfer;
    const types = dataTransfer ? Array.from(dataTransfer.types || []) : [];
    const templateId = transferredTemplateId(dataTransfer);
    const supported = Boolean(templateById(templateId))
        || types.includes(TEMPLATE_TRANSFER_TYPE)
        || types.includes(ASSEMBLY_TRANSFER_TYPE)
        || types.includes('templateId');
    if (!supported)
        return;
    event.preventDefault();
    dataTransfer.dropEffect = 'copy';
    byId('plant-drawing-stage').classList.add('is-drop-target');
}

function onCanvasDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget))
        byId('plant-drawing-stage').classList.remove('is-drop-target');
}

function onCanvasDrop(event) {
    const templateId = transferredTemplateId(event.dataTransfer);
    const assemblyId = transferredAssemblyId(event.dataTransfer);
    byId('plant-drawing-stage').classList.remove('is-drop-target');
    if (assemblyId && assemblyTemplateById(assemblyId)) {
        event.preventDefault();
        placeAssembly(rawCanvasPoint(event), assemblyId, 'Drag & Drop');
        return;
    }
    if (!templateById(templateId))
        return;
    event.preventDefault();
    placeTemplate(rawCanvasPoint(event), templateId, 'Drag & Drop');
}

function selectTarget(event, kind, id) {
    ui.palettePreviewTemplateId = '';
    ui.palettePreviewAssemblyId = '';
    ui.selection = toggleSelection(
        ui.selection,
        kind,
        id,
        event.ctrlKey || event.metaKey || event.shiftKey
    );
    renderAll();
}

function placeTemplate(point, templateIdValue, sourceLabel) {
    const templateId = textValue(templateIdValue, ui.selectedTemplateId);
    const template = templateById(templateId);
    if (!template) {
        showStatus('Bitte zuerst eine Komponente wählen.', 'error');
        return null;
    }
    const sheet = currentSheet();
    const width = numberValue(template.breite, 100);
    const height = numberValue(template.hoehe, 100);
    const entity = createPlantEntity(
        template,
        snapPlantValue(point.x - width / 2, sheet, ui.snapEnabled),
        snapPlantValue(point.y - height / 2, sheet, ui.snapEnabled)
    );
    let next = updateActivePlantSheet(currentModel(), function (draft) {
        draft.entities.push(entity);
        return draft;
    });
    let message = template.name + ' als eine Instanz eingefügt';
    if (ui.snapEnabled) {
        const snapped = snapSelectionToPorts(next, [entity.entity_id]);
        next = snapped.model;
        if (snapped.connections.length)
            message += ' · an ' + snapped.connections.length + ' Port(s) gekoppelt';
    }
    ui.selection = onlySelection('entity', entity.entity_id);
    ui.palettePreviewTemplateId = '';
    ui.selectedTemplateId = '';
    ui.tool = 'select';
    commitModel(next, 'Komponente platziert');
    renderPalette();
    showStatus(message + (sourceLabel ? ' · ' + sourceLabel : ''), 'success', 2600);
    return entity;
}

function handlePortClick(entityId, portId) {
    const sheet = currentSheet();
    const entity = findPlantEntity(sheet, entityId);
    const port = findPlantPort(entity, portId);
    if (!entity || !port)
        return;
    if (!ui.pendingPort) {
        ui.pendingPort = { entity_id: entityId, port_id: portId };
        renderAll();
        return;
    }
    if (ui.pendingPort.entity_id === entityId && ui.pendingPort.port_id === portId) {
        ui.pendingPort = null;
        renderAll();
        return;
    }
    if (ui.pendingPort.entity_id === entityId) {
        showStatus('Eine Verbindung benötigt zwei unterschiedliche Komponenten.', 'error');
        return;
    }
    try {
        const result = createPlantConnection(
            sheet,
            ui.pendingPort,
            { entity_id: entityId, port_id: portId },
            ui.connectionKind
        );
        const next = updateActivePlantSheet(currentModel(), function (draft) {
            draft.connections.push(result.connection);
            return draft;
        });
        ui.pendingPort = null;
        ui.selection = onlySelection('connection', result.connection.connection_id);
        commitModel(next, 'Ports verbunden');
        if (result.warnings.length)
            showStatus(result.warnings.join(' '), 'warning', 4200);
    }
    catch (error) {
        handleError(error, 'Ports konnten nicht verbunden werden');
    }
}

function dragEntityIds(clickedEntityId, detach) {
    const sheet = currentSheet();
    const selected = ui.selection.entity_ids.slice();
    if (detach)
        return selected.length ? selected : [clickedEntityId];
    if (!ui.linkedDrag)
        return selected;
    const ids = new Set(selected);
    selected.forEach(function (entityId) {
        plantConnectedComponent(sheet, entityId).forEach(function (memberId) {
            ids.add(memberId);
        });
    });
    return Array.from(ids);
}

function removeJointsOfEntities(modelValue, entityIds, keepInternal) {
    const ids = new Set(entityIds);
    return updateActivePlantSheet(modelValue, function (sheet) {
        sheet.connections = sheet.connections.filter(function (connection) {
            if (!connection.joint)
                return true;
            const fromInside = ids.has(connection.from_entity_id);
            const toInside = ids.has(connection.to_entity_id);
            if (keepInternal && fromInside && toInside)
                return true;
            return !fromInside && !toInside;
        });
        return sheet;
    });
}

function startMoveDrag(point, clickedEntityId, detach) {
    const base = detach
        ? removeJointsOfEntities(currentModel(), ui.selection.entity_ids.length ? ui.selection.entity_ids : [clickedEntityId], true)
        : normalizePlantDrawing(currentModel());
    const sheet = getActivePlantSheet(base);
    const entityIds = dragEntityIds(clickedEntityId, detach);
    const primitiveIds = ui.selection.primitive_ids.slice();
    const assemblyIds = new Set();
    entityIds.forEach(function (entityId) {
        const entity = findPlantEntity(sheet, entityId);
        if (entity && entity.assembly_id)
            assemblyIds.add(entity.assembly_id);
    });
    sheet.primitives.forEach(function (primitive) {
        if (primitive.assembly_id && assemblyIds.has(primitive.assembly_id) && !primitiveIds.includes(primitive.primitive_id))
            primitiveIds.push(primitive.primitive_id);
    });
    const origins = {};
    entityIds.forEach(function (entityId) {
        const entity = findPlantEntity(sheet, entityId);
        if (entity)
            origins[entityId] = { x: entity.x, y: entity.y };
    });
    primitiveIds.forEach(function (primitiveId) {
        const primitive = sheet.primitives.find(function (item) { return item.primitive_id === primitiveId; });
        if (primitive)
            origins[primitiveId] = primitiveOrigin(primitive);
    });
    ui.drag = {
        mode: 'move',
        detach: detach,
        start: point,
        entityIds: entityIds,
        primitiveIds: primitiveIds,
        origins: origins,
        base: base,
        moved: false
    };
}

function primitiveOrigin(primitive) {
    return {
        x1: primitive.x1, y1: primitive.y1, x2: primitive.x2, y2: primitive.y2,
        points: cloneValue(primitive.points || [])
    };
}

function startPrimitiveDrag(point) {
    const sheet = currentSheet();
    const origins = {};
    ui.selection.primitive_ids.forEach(function (primitiveId) {
        const primitive = sheet.primitives.find(function (item) {
            return item.primitive_id === primitiveId;
        });
        if (primitive)
            origins[primitiveId] = primitiveOrigin(primitive);
    });
    ui.drag = {
        mode: 'move',
        detach: false,
        start: point,
        entityIds: [],
        primitiveIds: ui.selection.primitive_ids.slice(),
        origins: origins,
        base: normalizePlantDrawing(currentModel()),
        moved: false
    };
}

function startHandleDrag(point, entityId, handle) {
    const sheet = currentSheet();
    const entity = findPlantEntity(sheet, entityId);
    if (!entity)
        return;
    ui.drag = {
        mode: handle === 'rotate' ? 'rotate' : 'resize',
        handle: handle,
        entityId: entityId,
        start: point,
        origin: cloneValue(entity),
        base: normalizePlantDrawing(currentModel()),
        moved: false
    };
}

function localHandleFor(handle, rotation) {
    const vectors = {
        n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
        ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1]
    };
    const vector = vectors[handle] || [1, 1];
    const radians = -rotation * Math.PI / 180;
    const x = vector[0] * Math.cos(radians) - vector[1] * Math.sin(radians);
    const y = vector[0] * Math.sin(radians) + vector[1] * Math.cos(radians);
    let result = '';
    if (y < -0.5)
        result += 'n';
    else if (y > 0.5)
        result += 's';
    if (x > 0.5)
        result += 'e';
    else if (x < -0.5)
        result += 'w';
    return result || handle;
}

function anchorLocalPoint(entity, localHandle) {
    const x = localHandle.includes('w') ? entity.width : (localHandle.includes('e') ? 0 : entity.width / 2);
    const y = localHandle.includes('n') ? entity.height : (localHandle.includes('s') ? 0 : entity.height / 2);
    return { x: x, y: y };
}

function localPointToWorld(entity, point) {
    return plantPortWorldPoint(entity, { x: point.x, y: point.y });
}

function updateResizeDrag(point, event) {
    const origin = ui.drag.origin;
    const sheet = getActivePlantSheet(ui.drag.base);
    const rawDx = point.x - ui.drag.start.x;
    const rawDy = point.y - ui.drag.start.y;
    const radians = -origin.rotation * Math.PI / 180;
    const localDx = rawDx * Math.cos(radians) - rawDy * Math.sin(radians);
    const localDy = rawDx * Math.sin(radians) + rawDy * Math.cos(radians);
    const localHandle = localHandleFor(ui.drag.handle, origin.rotation);
    const anchorBefore = localPointToWorld(origin, anchorLocalPoint(origin, localHandle));
    const resized = resizePlantEntityByHandle(origin, localHandle,
        snapPlantValue(localDx, sheet, ui.snapEnabled), snapPlantValue(localDy, sheet, ui.snapEnabled),
        { keep_aspect: Boolean(event && event.shiftKey), minimum: 10 });
    const anchorAfter = localPointToWorld(resized, anchorLocalPoint(resized, localHandle));
    resized.x = Math.round((resized.x + anchorBefore.x - anchorAfter.x) * 1000) / 1000;
    resized.y = Math.round((resized.y + anchorBefore.y - anchorAfter.y) * 1000) / 1000;
    ui.drag.moved = ui.drag.moved || Math.abs(rawDx) + Math.abs(rawDy) > 0.5;
    ui.previewModel = updateActivePlantSheet(ui.drag.base, function (draft) {
        draft.entities = draft.entities.map(function (entity) {
            return entity.entity_id === origin.entity_id ? resized : entity;
        });
        return draft;
    });
    renderCanvas();
    updateStatus();
}

function updateRotateDrag(point, event) {
    const origin = ui.drag.origin;
    const center = { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 };
    let angle = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI + 90;
    if (event && event.shiftKey)
        angle = Math.round(angle / 15) * 15;
    else
        angle = Math.round(angle);
    angle = ((angle % 360) + 360) % 360;
    ui.drag.moved = true;
    ui.previewModel = updateActivePlantSheet(ui.drag.base, function (draft) {
        draft.entities = draft.entities.map(function (entity) {
            if (entity.entity_id !== origin.entity_id)
                return entity;
            entity.rotation = angle;
            return entity;
        });
        return draft;
    });
    renderCanvas();
    updateStatus('Drehen · ' + angle + '°');
}

function updateMoveDrag(point) {
    const sheet = getActivePlantSheet(ui.drag.base);
    const rawDx = point.x - ui.drag.start.x;
    const rawDy = point.y - ui.drag.start.y;
    if (!ui.drag.moved && Math.abs(rawDx) + Math.abs(rawDy) < 2)
        return;
    ui.drag.moved = true;
    let dx = snapPlantValue(rawDx, sheet, ui.snapEnabled);
    let dy = snapPlantValue(rawDy, sheet, ui.snapEnabled);
    ui.snapCandidate = null;
    if (ui.snapEnabled && ui.drag.entityIds.length) {
        const probe = updateActivePlantSheet(ui.drag.base, function (draft) {
            draft.entities.forEach(function (entity) {
                const origin = ui.drag.origins[entity.entity_id];
                if (origin) {
                    entity.x = origin.x + rawDx;
                    entity.y = origin.y + rawDy;
                }
            });
            return draft;
        });
        const candidate = findPlantSnapCandidate(getActivePlantSheet(probe), ui.drag.entityIds, snapTolerance());
        if (candidate) {
            dx = rawDx + candidate.dx;
            dy = rawDy + candidate.dy;
            ui.snapCandidate = candidate;
        }
    }
    ui.previewModel = updateActivePlantSheet(ui.drag.base, function (draft) {
        draft.entities.forEach(function (entity) {
            const origin = ui.drag.origins[entity.entity_id];
            if (origin) {
                entity.x = Math.round((origin.x + dx) * 1000) / 1000;
                entity.y = Math.round((origin.y + dy) * 1000) / 1000;
            }
        });
        draft.primitives.forEach(function (primitive) {
            const origin = ui.drag.origins[primitive.primitive_id];
            if (origin) {
                primitive.x1 = origin.x1 + dx;
                primitive.y1 = origin.y1 + dy;
                primitive.x2 = origin.x2 + dx;
                primitive.y2 = origin.y2 + dy;
                primitive.points = (origin.points || []).map(function (point) {
                    return { x: point.x + dx, y: point.y + dy };
                });
            }
        });
        return draft;
    });
    renderCanvas();
    renderPreview();
    updateStatus();
}

function updateDrag(point, event) {
    if (!ui.drag)
        return;
    if (ui.drag.mode === 'resize')
        updateResizeDrag(point, event);
    else if (ui.drag.mode === 'rotate')
        updateRotateDrag(point, event);
    else
        updateMoveDrag(point);
}

function finishDrag() {
    if (!ui.drag)
        return;
    const drag = ui.drag;
    const model = ui.previewModel;
    ui.drag = null;
    if (!drag.moved || !model) {
        ui.previewModel = null;
        ui.snapCandidate = null;
        renderAll();
        return;
    }
    if (drag.mode === 'resize') {
        commitModel(model, 'Größe geändert');
        return;
    }
    if (drag.mode === 'rotate') {
        commitModel(model, 'Komponente gedreht');
        return;
    }
    let result = { model: model, connections: [], warnings: [] };
    if (drag.entityIds.length)
        result = createPlantJoints(model, drag.entityIds, 0.75);
    commitModel(result.model, drag.detach ? 'Teil gelöst und verschoben' : 'Auswahl verschoben');
    if (result.connections.length)
        showStatus(result.connections.length + ' Port(s) gekoppelt · Teile sind jetzt gesteckt', 'success', 2600);
    else if (drag.detach)
        showStatus('Teil aus dem Verbund gelöst', 'info', 2200);
}

function startPrimitive(point) {
    ui.draft = {
        type: ui.tool,
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
        text: ui.tool === 'dimension' ? '1000 mm' : 'Beschriftung',
        label: ui.tool === 'region' ? 'Bereich' : '',
        label_position: 'inside',
        font_family: ui.defaultFontFamily
    };
    renderCanvas();
}

function orthogonalPoint(previous, point) {
    if (!previous)
        return point;
    return Math.abs(point.x - previous.x) >= Math.abs(point.y - previous.y)
        ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y };
}

function addPolylinePoint(point, orthogonal) {
    if (!ui.draft || ui.draft.type !== 'polyline') {
        ui.draft = {
            type: 'polyline',
            points: [point],
            line_style: ui.defaultLineStyle,
            animated: lineStylePreset(ui.defaultLineStyle).dashes,
            font_family: ui.defaultFontFamily
        };
        ui.draftCursor = point;
        renderCanvas();
        updateStatus();
        return;
    }
    const previous = ui.draft.points[ui.draft.points.length - 1];
    const next = orthogonal ? orthogonalPoint(previous, point) : point;
    if (previous && Math.abs(previous.x - next.x) < 0.5 && Math.abs(previous.y - next.y) < 0.5)
        return;
    ui.draft.points.push(next);
    ui.draftCursor = next;
    renderCanvas();
    updateStatus();
}

function updatePolylineCursor(point, orthogonal) {
    if (!ui.draft || ui.draft.type !== 'polyline')
        return;
    const previous = ui.draft.points[ui.draft.points.length - 1];
    ui.draftCursor = orthogonal ? orthogonalPoint(previous, point) : point;
    renderCanvas();
}

function removeLastPolylinePoint() {
    if (!ui.draft || ui.draft.type !== 'polyline')
        return;
    ui.draft.points.pop();
    if (!ui.draft.points.length)
        ui.draft = null;
    renderCanvas();
    updateStatus();
}

function finishPolyline() {
    const draft = ui.draft;
    if (!draft || draft.type !== 'polyline')
        return;
    ui.draft = null;
    ui.draftCursor = null;
    if (draft.points.length < 2) {
        renderCanvas();
        updateStatus();
        return;
    }
    const primitive = normalizePlantPrimitive({
        type: 'polyline',
        points: draft.points,
        line_style: draft.line_style,
        animated: draft.animated,
        font_family: draft.font_family
    });
    const next = updateActivePlantSheet(currentModel(), function (sheet) {
        sheet.primitives.push(primitive);
        return sheet;
    });
    ui.selection = onlySelection('primitive', primitive.primitive_id);
    commitModel(next, 'Leitung gezeichnet');
    showStatus('Leitung mit ' + primitive.points.length + ' Punkten gezeichnet · Darstellung im Inspektor wählbar.', 'success', 2600);
}

function finishPrimitive() {
    if (!ui.draft)
        return;
    if (ui.draft.type === 'polyline')
        return;
    const draft = ui.draft;
    ui.draft = null;
    const distance = Math.abs(draft.x2 - draft.x1) + Math.abs(draft.y2 - draft.y1);
    if (distance < 4 && draft.type !== 'text') {
        renderCanvas();
        return;
    }
    if (draft.type === 'text') {
        draft.x2 = draft.x1 + 140;
        draft.y2 = draft.y1 + 30;
    }
    const primitive = normalizePlantPrimitive(draft);
    const next = updateActivePlantSheet(currentModel(), function (sheet) {
        sheet.primitives.push(primitive);
        return sheet;
    });
    ui.selection = onlySelection('primitive', primitive.primitive_id);
    setTool('select');
    commitModel(next, 'Zeichenelement erstellt');
}

function finishMarquee() {
    const marquee = ui.marquee;
    ui.marquee = null;
    if (!marquee)
        return;
    const x1 = Math.min(marquee.x1, marquee.x2);
    const y1 = Math.min(marquee.y1, marquee.y2);
    const x2 = Math.max(marquee.x1, marquee.x2);
    const y2 = Math.max(marquee.y1, marquee.y2);
    if (x2 - x1 < 4 && y2 - y1 < 4) {
        renderAll();
        return;
    }
    const sheet = currentSheet();
    const selection = marquee.additive ? cloneValue(ui.selection) : emptySelection();
    sheet.entities.forEach(function (entity) {
        const bounds = plantEntityBounds(entity);
        if (bounds.x >= x1 && bounds.y >= y1 && bounds.x + bounds.width <= x2 && bounds.y + bounds.height <= y2
            && !selection.entity_ids.includes(entity.entity_id))
            selection.entity_ids.push(entity.entity_id);
    });
    sheet.primitives.forEach(function (primitive) {
        if (primitive.selectable === false)
            return;
        const bounds = plantPrimitiveBounds(primitive);
        if (bounds.x >= x1 && bounds.y >= y1 && bounds.x + bounds.width <= x2 && bounds.y + bounds.height <= y2
            && !selection.primitive_ids.includes(primitive.primitive_id))
            selection.primitive_ids.push(primitive.primitive_id);
    });
    ui.selection = selection;
    renderAll();
}

function gestureTarget(event) {
    const entityNode = event.target.closest('[data-entity-id]');
    if (entityNode)
        return { kind: 'entity', id: entityNode.dataset.entityId };
    const primitiveNode = event.target.closest('[data-primitive-id]');
    if (primitiveNode && primitiveNode.dataset.primitiveId)
        return { kind: 'primitive', id: primitiveNode.dataset.primitiveId };
    const connectionNode = event.target.closest('[data-connection-id]');
    if (connectionNode)
        return { kind: 'connection', id: connectionNode.dataset.connectionId };
    return null;
}

function startCtrlGesture(event) {
    // Ctrl + drag pans the sheet like the plant workspace; a Ctrl + click
    // without movement still toggles the object in the selection.
    ui.ctrlGesture = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        target: gestureTarget(event),
        shiftKey: event.shiftKey
    };
    byId('plant-drawing-canvas').setPointerCapture(event.pointerId);
    event.preventDefault();
}

function updateCtrlGesture(event) {
    const gesture = ui.ctrlGesture;
    if (!gesture || gesture.pointerId !== event.pointerId)
        return false;
    if (ui.panning) {
        updateCanvasPan(event);
        return true;
    }
    const distance = Math.abs(event.clientX - gesture.clientX) + Math.abs(event.clientY - gesture.clientY);
    if (distance >= CTRL_DRAG_THRESHOLD) {
        startCanvasPan({ pointerId: gesture.pointerId, clientX: gesture.clientX, clientY: gesture.clientY });
        updateCanvasPan(event);
    }
    return true;
}

function finishCtrlGesture(event) {
    const gesture = ui.ctrlGesture;
    if (!gesture)
        return false;
    ui.ctrlGesture = null;
    if (ui.panning) {
        finishCanvasPan(event);
        return true;
    }
    if (gesture.target)
        selectTarget({ ctrlKey: true, metaKey: false, shiftKey: gesture.shiftKey }, gesture.target.kind, gesture.target.id);
    return true;
}

function onPointerDown(event) {
    closeContextMenu();
    const panRequested = event.button === 1 || ui.tool === 'pan' || ui.spacePressed;
    if (panRequested) {
        event.preventDefault();
        startCanvasPan(event);
        return;
    }
    if (event.button !== 0)
        return;
    if ((event.ctrlKey || event.metaKey) && ui.tool === 'select' && !event.target.closest('[data-handle]')) {
        startCtrlGesture(event);
        return;
    }
    const portNode = event.target.closest('[data-port-id]');
    if (portNode && ui.tool === 'connect') {
        event.preventDefault();
        handlePortClick(portNode.dataset.entityId, portNode.dataset.portId);
        return;
    }
    const point = canvasPoint(event);
    const raw = rawCanvasPoint(event);
    const handleNode = event.target.closest('[data-handle]');
    const entityNode = event.target.closest('[data-entity-id]');
    const connectionNode = event.target.closest('[data-connection-id]');
    const primitiveNode = event.target.closest('[data-primitive-id]');
    const canvas = byId('plant-drawing-canvas');
    if (ui.tool === 'place') {
        if (ui.selectedAssemblyTemplateId)
            placeAssembly(raw, ui.selectedAssemblyTemplateId, 'Einmal-Platzierung');
        else
            placeTemplate(raw, ui.selectedTemplateId, 'Einmal-Platzierung');
        return;
    }
    if (ui.tool === 'polyline') {
        event.preventDefault();
        addPolylinePoint(point, event.shiftKey);
        return;
    }
    if (['line', 'rect', 'ellipse', 'text', 'region', 'dimension'].includes(ui.tool)) {
        startPrimitive(point);
        canvas.setPointerCapture(event.pointerId);
        return;
    }
    if (ui.tool === 'connect') {
        if (!entityNode)
            ui.pendingPort = null;
        renderAll();
        return;
    }
    if (handleNode && ui.tool === 'select') {
        event.preventDefault();
        startHandleDrag(raw, handleNode.dataset.handleEntityId, handleNode.dataset.handle);
        canvas.setPointerCapture(event.pointerId);
        renderCanvas();
        return;
    }
    if (entityNode) {
        const id = entityNode.dataset.entityId;
        const now = Date.now();
        if (ui.lastClick && ui.lastClick.entityId === id && now - ui.lastClick.time < 420
            && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            // Second click on the same part within the double-click window: the DOM
            // node was re-rendered in between, so native dblclick cannot fire.
            ui.lastClick = null;
            selectComponentOf(id);
            return;
        }
        ui.lastClick = { entityId: id, time: now };
        if (!hasSelection(ui.selection, 'entity', id))
            selectTarget(event, 'entity', id);
        if (!hasSelection(ui.selection, 'entity', id)) {
            renderAll();
            return;
        }
        startMoveDrag(raw, id, Boolean(event.altKey));
        canvas.setPointerCapture(event.pointerId);
        if (event.altKey)
            updateStatus('Alt + Ziehen · Teil wird aus dem Verbund gelöst');
    }
    else if (primitiveNode) {
        const id = primitiveNode.dataset.primitiveId;
        if (!hasSelection(ui.selection, 'primitive', id))
            selectTarget(event, 'primitive', id);
        startPrimitiveDrag(raw);
        canvas.setPointerCapture(event.pointerId);
    }
    else if (connectionNode)
        selectTarget(event, 'connection', connectionNode.dataset.connectionId);
    else {
        ui.palettePreviewTemplateId = '';
        ui.palettePreviewAssemblyId = '';
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        if (!additive)
            ui.selection = emptySelection();
        ui.marquee = { x1: raw.x, y1: raw.y, x2: raw.x, y2: raw.y, additive: additive };
        canvas.setPointerCapture(event.pointerId);
        renderAll();
    }
}

function onPointerMove(event) {
    if (ui.ctrlGesture && updateCtrlGesture(event))
        return;
    if (ui.panning) {
        updateCanvasPan(event);
        return;
    }
    const point = canvasPoint(event);
    const raw = rawCanvasPoint(event);
    byId('plant-drawing-coordinate').textContent = 'X: ' + Math.round(point.x) + ' · Y: ' + Math.round(point.y);
    if (ui.drag)
        updateDrag(raw, event);
    else if (ui.marquee) {
        ui.marquee.x2 = raw.x;
        ui.marquee.y2 = raw.y;
        renderCanvas();
    }
    else if (ui.draft && ui.draft.type === 'polyline')
        updatePolylineCursor(point, event.shiftKey);
    else if (ui.draft) {
        ui.draft.x2 = point.x;
        ui.draft.y2 = point.y;
        renderCanvas();
    }
}

function onPointerUp(event) {
    if (ui.ctrlGesture && finishCtrlGesture(event)) {
        const captured = byId('plant-drawing-canvas');
        if (captured.hasPointerCapture(event.pointerId))
            captured.releasePointerCapture(event.pointerId);
        return;
    }
    if (ui.panning)
        finishCanvasPan(event);
    else if (ui.drag)
        finishDrag();
    else if (ui.marquee)
        finishMarquee();
    else if (ui.draft)
        finishPrimitive();
    const canvas = byId('plant-drawing-canvas');
    if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
}

function selectComponentOf(entityId) {
    ui.selection = expandPlantSelectionToComponent(currentSheet(), onlySelection('entity', entityId));
    renderAll();
    showStatus(ui.selection.entity_ids.length + ' verbundene Teile ausgewählt', 'info', 2200);
}

function onDoubleClick(event) {
    if (ui.tool === 'polyline') {
        event.preventDefault();
        finishPolyline();
        return;
    }
    const entityNode = event.target.closest('[data-entity-id]');
    if (!entityNode || ui.tool !== 'select')
        return;
    event.preventDefault();
    selectComponentOf(entityNode.dataset.entityId);
}

// ---------------------------------------------------------------------------
// Selection commands
// ---------------------------------------------------------------------------

function deleteSelectionNow() {
    if (!selectionCount(ui.selection))
        return;
    const next = deletePlantSelection(currentModel(), ui.selection);
    ui.selection = emptySelection();
    commitModel(next, 'Auswahl gelöscht');
}

function rotateSelectionBy(degrees) {
    if (!ui.selection.entity_ids.length && !ui.selection.primitive_ids.length)
        return;
    const rotated = rotatePlantSelection(currentModel(), ui.selection, degrees);
    const joined = ui.selection.entity_ids.length
        ? createPlantJoints(rotated, ui.selection.entity_ids, 0.75) : { model: rotated, connections: [] };
    commitModel(joined.model, 'Auswahl gedreht');
}

function mapSelectedEntities(mapper, reason) {
    if (!ui.selection.entity_ids.length)
        return;
    const ids = ui.selection.entity_ids.slice();
    const next = updateActivePlantSheet(currentModel(), function (sheet) {
        sheet.entities = sheet.entities.map(function (entity) {
            return ids.includes(entity.entity_id) ? (mapper(entity) || entity) : entity;
        });
        return sheet;
    });
    commitModel(createPlantJoints(next, ids, 0.75).model, reason);
}

function flipSelection(axis) {
    mapSelectedEntities(function (entity) {
        return flipPlantEntity(entity, axis === 'y' ? 'y' : 'x');
    }, axis === 'y' ? 'Vertikal gespiegelt' : 'Horizontal gespiegelt');
}

function invertSelection() {
    mapSelectedEntities(function (entity) {
        return invertPlantEntity(entity);
    }, 'Flussrichtung invertiert');
}

function setVisualStateForSelection(state) {
    mapSelectedEntities(function (entity) {
        return setPlantEntityVisualState(entity, state);
    }, 'Darstellung geändert');
}

function cycleVisualStateOfSelection() {
    const sheet = currentSheet();
    const entity = ui.selection.entity_ids.length ? findPlantEntity(sheet, ui.selection.entity_ids[0]) : null;
    const template = entity ? templateById(entity.template_id) : null;
    const states = template && Array.isArray(template.visual_states) ? template.visual_states : [];
    if (!states.length)
        return;
    const current = Math.max(0, states.indexOf(entity.visual_state));
    setVisualStateForSelection(states[(current + 1) % states.length]);
}

function setScaleModeForSelection(mode) {
    mapSelectedEntities(function (entity) {
        return setPlantEntityScaleMode(entity, mode);
    }, 'Skalierung geändert');
}

function fitSheetNow(shrink) {
    const fitted = fitPlantSheetToContent(currentModel(), { shrink: shrink === true });
    if (!fitted.changed) {
        showStatus('Das Blatt passt bereits zum Inhalt.', 'info', 2200);
        return;
    }
    ui.pan.x += fitted.dx;
    ui.pan.y += fitted.dy;
    commitModel(fitted.model, 'Blatt an Inhalt angepasst');
    showStatus('Blatt auf ' + getActivePlantSheet(fitted.model).width + ' × '
        + getActivePlantSheet(fitted.model).height + ' angepasst.', 'success', 2600);
}

function reorderSelection(toFront) {
    if (!ui.selection.entity_ids.length)
        return;
    const ids = new Set(ui.selection.entity_ids);
    const next = updateActivePlantSheet(currentModel(), function (sheet) {
        const selected = sheet.entities.filter(function (entity) { return ids.has(entity.entity_id); });
        const others = sheet.entities.filter(function (entity) { return !ids.has(entity.entity_id); });
        sheet.entities = toFront ? others.concat(selected) : selected.concat(others);
        return sheet;
    });
    commitModel(next, toFront ? 'In den Vordergrund' : 'In den Hintergrund');
}

function selectComponentOfSelection() {
    if (!ui.selection.entity_ids.length)
        return;
    ui.selection = expandPlantSelectionToComponent(currentSheet(), ui.selection);
    renderAll();
}

function selectionWithoutLayer(selection, layer) {
    const sheet = currentSheet();
    const result = cloneValue(selection);
    result.entity_ids = result.entity_ids.filter(function (entityId) {
        const entity = findPlantEntity(sheet, entityId);
        return entity && entity.layer !== layer;
    });
    result.primitive_ids = result.primitive_ids.filter(function (primitiveId) {
        const primitive = sheet.primitives.find(function (item) { return item.primitive_id === primitiveId; });
        return primitive && primitive.layer !== layer;
    });
    return result;
}

function selectAll() {
    const sheet = currentSheet();
    ui.selection = wholeSheetSelection(sheet);
    ui.selection.connection_ids = [];
    DRAWING_LAYERS.forEach(function (layer) {
        if (!layerVisible(layer))
            ui.selection = selectionWithoutLayer(ui.selection, layer);
    });
    renderAll();
}

function nudgeSelection(dx, dy) {
    if (!ui.selection.entity_ids.length && !ui.selection.primitive_ids.length)
        return;
    const ids = dragEntityIds('', false);
    let model = translatePlantEntities(currentModel(), ids, dx, dy);
    model = updateActivePlantSheet(model, function (sheet) {
        sheet.primitives = sheet.primitives.map(function (primitive) {
            if (!ui.selection.primitive_ids.includes(primitive.primitive_id))
                return primitive;
            return translatePlantPrimitive(primitive, dx, dy);
        });
        return sheet;
    });
    commitModel(createPlantJoints(model, ids, 0.75).model, 'Auswahl verschoben');
}

function groupSelectionNow() {
    if (ui.selection.entity_ids.length < 2)
        return;
    const name = textValue(byId('plant-drawing-inventory-name').value, 'Baugruppe');
    const result = groupPlantSelection(currentModel(), ui.selection, name);
    commitModel(result.model, 'Baugruppe gruppiert');
    showStatus('Baugruppe "' + name + '" gruppiert · Teile bleiben einzeln konfigurierbar.', 'success', 2800);
}

function releaseEntityJoints(entityId) {
    commitModel(removeJointsOfEntities(currentModel(), [entityId], false), 'Steckverbindungen gelöst');
}

function releaseSelectionJoints() {
    if (!ui.selection.entity_ids.length)
        return;
    commitModel(removeJointsOfEntities(currentModel(), ui.selection.entity_ids, true), 'Teile gelöst');
}

function closeJointsOf(entityId) {
    let model = currentModel();
    const sheet = getActivePlantSheet(model);
    entityJoints(sheet, entityId).forEach(function (connection) {
        if (plantJointGap(getActivePlantSheet(model), connection) > 0.5)
            model = closePlantJoint(model, connection.connection_id, entityId);
    });
    commitModel(model, 'Steckverbindungen geschlossen');
}

function joinSelectionNow() {
    if (!ui.selection.entity_ids.length)
        return;
    const result = snapSelectionToPorts(currentModel(), ui.selection.entity_ids);
    commitModel(result.model, 'Ports gekoppelt');
    showStatus(result.connections.length + ' Port(s) gekoppelt', result.connections.length ? 'success' : 'info', 2400);
}

// ---------------------------------------------------------------------------
// V64_r4 · context menu
// ---------------------------------------------------------------------------

function contextMenuNode() {
    let menu = byId('plant-drawing-context-menu');
    if (menu)
        return menu;
    menu = htmlNode('div', 'plant-drawing-context-menu');
    menu.id = 'plant-drawing-context-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    document.body.appendChild(menu);
    return menu;
}

function closeContextMenu() {
    const menu = byId('plant-drawing-context-menu');
    if (menu) {
        menu.hidden = true;
        menu.replaceChildren();
    }
    ui.contextMenu = null;
}

function menuItem(label, handler, options) {
    const settings = options || {};
    return { label: label, handler: handler, disabled: settings.disabled === true, shortcut: settings.shortcut || '' };
}

function menuSeparator() {
    return { separator: true };
}

function contextMenuItems(target, point) {
    const sheet = currentSheet();
    const items = [];
    const entityIds = ui.selection.entity_ids;
    if (target.kind === 'entity') {
        const entity = findPlantEntity(sheet, target.id);
        const joints = entity ? entityJoints(sheet, entity.entity_id) : [];
        const openJoints = joints.filter(function (connection) { return plantJointGap(sheet, connection) > 0.5; });
        items.push(menuItem('Verbund auswählen', function () { selectComponentOf(target.id); }, { shortcut: 'Doppelklick' }));
        items.push(menuSeparator());
        items.push(menuItem('Drehen 90°', function () { rotateSelectionBy(90); }, { shortcut: 'R' }));
        items.push(menuItem('Drehen −90°', function () { rotateSelectionBy(-90); }, { shortcut: 'Umschalt+R' }));
        items.push(menuItem('Spiegeln horizontal', function () { flipSelection('x'); }, { shortcut: 'F' }));
        items.push(menuItem('Spiegeln vertikal', function () { flipSelection('y'); }, { shortcut: 'Umschalt+F' }));
        items.push(menuItem('Flussrichtung invertieren', invertSelection, { shortcut: 'I' }));
        if (entity && entity.stretch) {
            items.push(menuItem(entity.scale_mode === 'stretch' ? 'Skalierung: proportional' : 'Skalierung: strecken', function () {
                setScaleModeForSelection(entity.scale_mode === 'stretch' ? 'uniform' : 'stretch');
            }));
        }
        const stateTemplate = entity ? templateById(entity.template_id) : null;
        const states = stateTemplate && Array.isArray(stateTemplate.visual_states) ? stateTemplate.visual_states : [];
        if (states.length > 1) {
            const current = Math.max(0, states.indexOf(entity.visual_state));
            const nextState = states[(current + 1) % states.length];
            items.push(menuItem('Darstellung: ' + (VISUAL_STATE_LABELS[nextState] || nextState), function () {
                setVisualStateForSelection(nextState);
            }, { shortcut: 'Z' }));
        }
        items.push(menuSeparator());
        items.push(menuItem('Duplizieren', duplicateSelection, { shortcut: 'Strg+D' }));
        items.push(menuItem('Gruppieren', groupSelectionNow, { shortcut: 'Strg+G', disabled: entityIds.length < 2 }));
        items.push(menuItem('Als Baugruppe speichern', function () { saveSelectionAsAssembly(); }));
        items.push(menuSeparator());
        items.push(menuItem('Teil lösen', function () { releaseEntityJoints(target.id); }, { disabled: !joints.length, shortcut: 'Alt+Ziehen' }));
        items.push(menuItem('Zusammenziehen', function () { closeJointsOf(target.id); }, { disabled: !openJoints.length }));
        items.push(menuItem('Ports koppeln', joinSelectionNow));
        items.push(menuSeparator());
        items.push(menuItem('In den Vordergrund', function () { reorderSelection(true); }));
        items.push(menuItem('In den Hintergrund', function () { reorderSelection(false); }));
        items.push(menuSeparator());
        items.push(menuItem('Löschen', deleteSelectionNow, { shortcut: 'Entf' }));
        return items;
    }
    if (target.kind === 'connection') {
        const connection = sheet.connections.find(function (item) { return item.connection_id === target.id; });
        if (connection && connection.joint && plantJointGap(sheet, connection) > 0.5) {
            items.push(menuItem('Teile zusammenziehen', function () {
                commitModel(closePlantJoint(currentModel(), connection.connection_id), 'Steckverbindung geschlossen');
            }));
        }
        items.push(menuItem('Verbindung lösen', deleteSelectionNow, { shortcut: 'Entf' }));
        return items;
    }
    if (target.kind === 'primitive') {
        items.push(menuItem('Drehen 90°', function () { rotateSelectionBy(90); }, { shortcut: 'R' }));
        items.push(menuItem('Duplizieren', duplicateSelection, { shortcut: 'Strg+D' }));
        items.push(menuItem('Löschen', deleteSelectionNow, { shortcut: 'Entf' }));
        return items;
    }
    const template = templateById(ui.palettePreviewTemplateId || ui.selectedTemplateId);
    const assembly = assemblyTemplateById(ui.palettePreviewAssemblyId || ui.selectedAssemblyTemplateId);
    if (assembly)
        items.push(menuItem('„' + assembly.name + '“ hier platzieren', function () { placeAssembly(point, assembly.assembly_template_id, 'Kontextmenü'); }));
    else if (template)
        items.push(menuItem('„' + template.name + '“ hier platzieren', function () { placeTemplate(point, template.id, 'Kontextmenü'); }));
    items.push(menuItem('Alles auswählen', selectAll, { shortcut: 'Strg+A' }));
    items.push(menuItem('Auswahl aufheben', function () { ui.selection = emptySelection(); renderAll(); }, { shortcut: 'Esc', disabled: !selectionCount(ui.selection) }));
    items.push(menuSeparator());
    items.push(menuItem('Blatt an Inhalt anpassen', function () { fitSheetNow(true); }));
    items.push(menuItem('Ansicht einpassen', function () { resetView(); renderCanvas(); }));
    items.push(menuItem(ui.gridEnabled ? 'Raster ausblenden' : 'Raster einblenden', function () { ui.gridEnabled = !ui.gridEnabled; renderAll(); }));
    items.push(menuItem(ui.snapEnabled ? 'Einrasten aus' : 'Einrasten ein', function () { ui.snapEnabled = !ui.snapEnabled; renderAll(); }));
    items.push(menuItem(ui.portHintsEnabled ? 'Ports ausblenden' : 'Ports anzeigen', function () { ui.portHintsEnabled = !ui.portHintsEnabled; renderAll(); }));
    return items;
}

function openContextMenu(clientX, clientY, target, point) {
    const menu = contextMenuNode();
    menu.replaceChildren();
    const items = contextMenuItems(target, point);
    items.forEach(function (item) {
        if (item.separator) {
            menu.appendChild(htmlNode('div', 'plant-drawing-context-menu__separator'));
            return;
        }
        const button = htmlNode('button', 'plant-drawing-context-menu__item');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.disabled = item.disabled;
        button.append(htmlNode('span', '', item.label));
        if (item.shortcut)
            button.appendChild(htmlNode('kbd', '', item.shortcut));
        button.addEventListener('click', function (event) {
            event.preventDefault();
            closeContextMenu();
            item.handler();
        });
        menu.appendChild(button);
    });
    menu.hidden = false;
    const width = menu.offsetWidth || 240;
    const height = menu.offsetHeight || 300;
    const left = Math.max(4, Math.min(window.innerWidth - width - 4, clientX));
    const top = Math.max(4, Math.min(window.innerHeight - height - 4, clientY));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    ui.contextMenu = { target: target, point: point, clientX: clientX, clientY: clientY };
    const first = menu.querySelector('button:not([disabled])');
    if (first)
        first.focus();
}

function onContextMenu(event) {
    if (ui.tool === 'pan')
        return;
    event.preventDefault();
    ui.drag = null;
    ui.marquee = null;
    ui.previewModel = null;
    const entityNode = event.target.closest('[data-entity-id]');
    const connectionNode = event.target.closest('[data-connection-id]');
    const primitiveNode = event.target.closest('[data-primitive-id]');
    let target = { kind: 'canvas', id: '' };
    if (entityNode)
        target = { kind: 'entity', id: entityNode.dataset.entityId };
    else if (connectionNode)
        target = { kind: 'connection', id: connectionNode.dataset.connectionId };
    else if (primitiveNode && primitiveNode.dataset.primitiveId)
        target = { kind: 'primitive', id: primitiveNode.dataset.primitiveId };
    if (target.kind !== 'canvas' && !hasSelection(ui.selection, target.kind, target.id)) {
        ui.selection = onlySelection(target.kind, target.id);
        ui.palettePreviewTemplateId = '';
        ui.palettePreviewAssemblyId = '';
        renderAll();
    }
    openContextMenu(event.clientX, event.clientY, target, rawCanvasPoint(event));
}

// ---------------------------------------------------------------------------
// Examples and reference diagrams
// ---------------------------------------------------------------------------

function replaceWithExample() {
    ui.selection = emptySelection();
    commitModel(createRohrofenPlantExample(templateById), 'Rohrofen-Beispiel geladen');
    resetView();
    showStatus('Rohrofen-Beispiel mit elementaren Komponenten geladen.', 'success', 3600);
}

function replaceWithAssemblyExample() {
    ui.selection = emptySelection();
    commitModel(createRohrofenAssemblyExample(templateById), 'Zusammengesteckte Rohrofen-Anlage geladen');
    resetView();
    const report = validatePlantDrawing(currentModel(), templateById);
    showStatus('Rohrofen-Anlage aus ' + report.counts.entities + ' Elementarteilen mit '
        + report.counts.joints + ' gesteckten Verbindungen geladen.', 'success', 4200);
}

function replaceWithR4Example() {
    ui.selection = emptySelection();
    commitModel(createRohrofenR4Example(templateById), 'Rohrofen-Anlage mit Fittings und Gasmischer geladen');
    resetView();
    const report = validatePlantDrawing(currentModel(), templateById);
    showStatus('Rohrofen-Anlage aus ' + report.counts.entities + ' Teilen mit ' + report.counts.joints
        + ' gesteckten Verbindungen geladen (Fittings, Kapillaren, Gasmischer, Grenzstellen).', 'success', 4200);
}

function replaceWithClassicReactorExample() {
    ui.selection = emptySelection();
    // The optional frame lives on the structure layer and starts hidden so the
    // sheet matches the reference image; the layer switch reveals it.
    ui.layers = { process: true, structure: false, annotation: true };
    commitModel(createClassicReactorExample(templateById), 'Klassisches Reaktor-P&ID geladen');
    resetView();
    const report = validatePlantDrawing(currentModel(), templateById);
    showStatus('Klassisches Reaktor-P&ID aus ' + report.counts.entities + ' Teilen, '
        + report.counts.joints + ' Joints und ' + report.counts.primitives + ' Zeichenelementen geladen.', 'success', 4200);
}

function loadClassicReactorExample() {
    confirmReplace('Klassisches Reaktor-P&ID', 'Gefüllte Rohre, Flansche, Kapillaren, Ventilpanel, Gestell und Bemaßung wie im Referenzbild.',
        replaceWithClassicReactorExample);
}

function replaceWithClassicTemplateExample() {
    ui.selection = emptySelection();
    ui.layers = { process: true, structure: true, annotation: true };
    commitModel(createClassicTemplateExample(templateById), 'Klassische Template-Variante geladen');
    resetView();
    const report = validatePlantDrawing(currentModel(), templateById);
    showStatus('Klassische Template-Variante aus ' + report.counts.entities + ' Teilen und '
        + report.counts.primitives + ' Zeichenelementen geladen.', 'success', 4200);
}

function loadClassicTemplateExample() {
    confirmReplace('Klassische Template-Variante', 'Gasflaschen, Regelventile, Gasmischer, Kolonne, Kreis-Apparate und Instrumente wie im Referenzbild.',
        replaceWithClassicTemplateExample);
}

function loadR4Example() {
    confirmReplace('Rohrofen-Anlage mit Fittings und Gasmischer',
        'Grenzstellen, Kapillaren, Swagelok-Fittings, Gasmischer und gespiegelte Bögen sind gesteckt.', replaceWithR4Example);
}

function confirmReplace(label, detail, executor) {
    const sheet = currentSheet();
    if (sheet.entities.length || sheet.connections.length || sheet.primitives.length) {
        showConfirmation(
            'Die aktuelle Anlagenskizze durch „' + label + '“ ersetzen?',
            {
                title: label + ' laden',
                detail: detail,
                confirmLabel: 'Beispiel laden',
                destructive: true
            },
            executor
        );
        return;
    }
    executor();
}

function loadExample() {
    confirmReplace('Rohrofen-Beispiel', 'Die aktuelle, noch nicht gespeicherte Skizze wird ersetzt.', replaceWithExample);
}

function loadAssemblyExample() {
    confirmReplace('Zusammengesteckte Rohrofen-Anlage',
        'Alle Teile sind elementar und über gesteckte Ports verbunden.', replaceWithAssemblyExample);
}

function referenceFragmentLabel(node, index) {
    const nodeName = textValue(node.localName, 'Element');
    const content = String(node.textContent || '').replace(/\s+/g, ' ').trim();
    return content ? nodeName + ' · ' + content.slice(0, 54) : nodeName + ' ' + (index + 1);
}

function createReferenceModelFromSvg(reference, svgText) {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (parsed.querySelector('parsererror'))
        throw new Error('Das Referenz-SVG ist nicht wohlgeformt.');
    const root = parsed.documentElement;
    if (!root || root.localName !== 'svg')
        throw new Error('Die Referenz enthält kein SVG-Wurzelelement.');
    sanitizeImportedSvg(root);
    const rawViewBox = String(root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const width = numberValue(root.getAttribute('width'), 1600);
    const height = numberValue(root.getAttribute('height'), 1000);
    const viewBox = rawViewBox.length === 4 && rawViewBox.every(Number.isFinite)
        ? rawViewBox : [0, 0, width, height];
    const sourceChildren = Array.from(root.children);
    const measure = svgNode('svg', {
        viewBox: viewBox.join(' '),
        width: viewBox[2],
        height: viewBox[3],
        'aria-hidden': 'true'
    });
    measure.style.position = 'fixed';
    measure.style.left = '-100000px';
    measure.style.top = '0';
    measure.style.visibility = 'hidden';
    measure.style.pointerEvents = 'none';
    const fontFamily = textValue(root.getAttribute('font-family'), 'Arial, Helvetica, sans-serif');
    measure.setAttribute('font-family', fontFamily);
    sourceChildren.forEach(function (node) {
        measure.appendChild(document.importNode(node, true));
    });
    document.body.appendChild(measure);
    const measuredChildren = Array.from(measure.children);
    const serializer = new XMLSerializer();
    const primitives = sourceChildren.map(function (source, index) {
        const measured = measuredChildren[index];
        let bounds = { x: 0, y: 0, width: 0, height: 0 };
        try {
            const measuredBounds = measured.getBBox();
            bounds = {
                x: measuredBounds.x,
                y: measuredBounds.y,
                width: measuredBounds.width,
                height: measuredBounds.height
            };
        }
        catch (error) {
            bounds = { x: 0, y: 0, width: 0, height: 0 };
        }
        const selectable = source.localName !== 'defs' && source.localName !== 'style'
            && (bounds.width > 0 || bounds.height > 0);
        const eventTarget = selectable
            ? 'reference_' + reference.id + '_' + String(index + 1).padStart(3, '0') : '';
        return normalizePlantPrimitive({
            primitive_id: 'reference_' + reference.id + '_' + String(index + 1).padStart(3, '0'),
            type: 'svg_fragment',
            x1: bounds.x,
            y1: bounds.y,
            x2: bounds.x + bounds.width,
            y2: bounds.y + bounds.height,
            source_x: bounds.x,
            source_y: bounds.y,
            markup: serializer.serializeToString(source),
            element_name: source.localName,
            label: referenceFragmentLabel(source, index),
            event_target: eventTarget,
            selectable: selectable,
            original_index: index
        });
    });
    measure.remove();
    const model = createEmptyPlantDrawing();
    const sheet = model.sheets[0];
    sheet.name = reference.label;
    sheet.width = viewBox[2];
    sheet.height = viewBox[3];
    sheet.grid = 10;
    sheet.primitives = primitives;
    sheet.reference = {
        id: reference.id,
        label: reference.label,
        asset: reference.asset,
        view_box: viewBox,
        font_family: fontFamily,
        fragment_count: primitives.filter(function (primitive) { return primitive.selectable; }).length,
        animation_count: root.querySelectorAll('animate,animateTransform,animateMotion,set').length,
        integration: 'elemental-svg-fragments-with-event-targets'
    };
    return normalizePlantDrawing(model);
}

async function replaceWithReference(referenceId) {
    const reference = REFERENCE_DIAGRAMS[referenceId];
    if (!reference)
        throw new Error('Unbekannte Referenzanlage: ' + referenceId);
    const response = await fetch(reference.asset, { cache: 'no-store' });
    if (!response.ok)
        throw new Error('Referenzanlage konnte nicht geladen werden: HTTP ' + response.status);
    const svgText = await response.text();
    const model = createReferenceModelFromSvg(reference, svgText);
    ui.selection = emptySelection();
    ui.palettePreviewTemplateId = '';
    ui.palettePreviewAssemblyId = '';
    commitModel(model, 'Referenzanlage elementar geladen');
    resetView();
    showStatus(reference.label + ' mit ' + currentSheet().reference.fragment_count
        + ' editierbaren Fragmenten geladen.', 'success', 4800);
    return model;
}

function loadReferenceDiagram(referenceIdValue) {
    const select = byId('plant-drawing-reference-select');
    const referenceId = textValue(referenceIdValue, select ? select.value : 'reactor');
    const reference = REFERENCE_DIAGRAMS[referenceId];
    if (!reference) {
        showStatus('Bitte eine gültige Referenzanlage wählen.', 'error');
        return Promise.resolve(null);
    }
    const sheet = currentSheet();
    function executeLoad() {
        return replaceWithReference(referenceId).catch(function (error) {
            handleError(error, 'Referenzanlage konnte nicht geladen werden');
            return null;
        });
    }
    if (sheet.entities.length || sheet.connections.length || sheet.primitives.length) {
        showConfirmation(
            'Die aktuelle Anlagenskizze durch „' + reference.label + '“ ersetzen?',
            {
                title: 'Referenzanlage elementar laden',
                detail: 'Jedes sichtbare SVG-Element bleibt auswählbar und wird mit einem Event-Ziel versehen.',
                confirmLabel: 'Referenz laden',
                destructive: true
            },
            executeLoad
        );
        return Promise.resolve(null);
    }
    return executeLoad();
}

function zoomBy(factor) {
    const center = viewCenter();
    ui.zoom = Math.max(.25, Math.min(4, ui.zoom * factor));
    const size = canvasSize();
    const scale = viewScale();
    ui.pan = { x: center.x - size.width / (2 * scale), y: center.y - size.height / (2 * scale) };
    applyViewBox();
    renderCanvas();
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

function bindButton(id, handler) {
    const button = byId(id);
    if (button)
        button.addEventListener('click', handler);
}

function bindUi() {
    queryAll('[data-drawing-tool]').forEach(function (button) {
        button.addEventListener('click', function () {
            setTool(button.dataset.drawingTool);
        });
    });
    queryAll('[data-connection-kind]').forEach(function (button) {
        button.addEventListener('click', function () {
            ui.connectionKind = CONNECTION_KINDS.includes(button.dataset.connectionKind)
                ? button.dataset.connectionKind : 'process';
            setTool('connect');
        });
    });
    queryAll('[data-inventory-tab]').forEach(function (button) {
        button.addEventListener('click', function () {
            setInventoryTab(button.dataset.inventoryTab);
        });
    });
    bindButton('plant-drawing-grid-toggle', function () {
        ui.gridEnabled = !ui.gridEnabled;
        renderAll();
    });
    bindButton('plant-drawing-snap-toggle', function () {
        ui.snapEnabled = !ui.snapEnabled;
        renderAll();
    });
    bindButton('plant-drawing-linked-toggle', function () {
        ui.linkedDrag = !ui.linkedDrag;
        updateChrome();
        showStatus(ui.linkedDrag ? 'Verbund mitziehen aktiv · Alt + Ziehen löst ein Teil'
            : 'Einzelteile ziehen · gesteckte Verbindungen bleiben als offene Joints sichtbar', 'info', 2600);
    });
    bindButton('plant-drawing-port-toggle', function () {
        ui.portHintsEnabled = !ui.portHintsEnabled;
        renderAll();
    });
    queryAll('[data-drawing-layer]').forEach(function (button) {
        button.addEventListener('click', function () {
            const layer = button.dataset.drawingLayer;
            ui.layers[layer] = !layerVisible(layer);
            if (!ui.layers[layer])
                ui.selection = selectionWithoutLayer(ui.selection, layer);
            renderAll();
            showStatus('Ebene ' + LAYER_LABELS[layer] + (ui.layers[layer] ? ' eingeblendet' : ' ausgeblendet'), 'info', 2000);
        });
    });
    bindButton('plant-drawing-animation-toggle', function () {
        ui.animationEnabled = !ui.animationEnabled;
        applyAnimationState();
        updateChrome();
        showStatus(ui.animationEnabled ? 'Animation läuft: Laufstriche zeigen den Durchfluss' : 'Animation angehalten', 'info', 2200);
    });
    bindButton('plant-drawing-rotate', function () { rotateSelectionBy(90); });
    bindButton('plant-drawing-group', groupSelectionNow);
    bindButton('plant-drawing-delete', deleteSelectionNow);
    bindButton('plant-drawing-zoom-out', function () { zoomBy(1 / 1.2); });
    bindButton('plant-drawing-zoom-in', function () { zoomBy(1.2); });
    bindButton('plant-drawing-zoom-fit', function () {
        resetView();
        renderCanvas();
    });
    window.addEventListener('resize', function () {
        if (ui.initialized)
            applyViewBox();
    });
    byId('plant-drawing-search').addEventListener('input', function () {
        renderPalette();
        renderAssemblyPalette();
    });
    byId('plant-drawing-category').addEventListener('change', renderPalette);
    bindButton('plant-drawing-demo', loadExample);
    bindButton('plant-drawing-assembly-demo', loadAssemblyExample);
    bindButton('plant-drawing-r4-demo', loadR4Example);
    bindButton('plant-drawing-classic-demo', loadClassicReactorExample);
    bindButton('plant-drawing-classic-template-demo', loadClassicTemplateExample);
    bindButton('plant-drawing-import-button', importPlantTemplateIntoDrawing);
    bindButton('plant-drawing-reference-load', function () {
        loadReferenceDiagram();
    });
    bindButton('plant-drawing-save-assembly', function () {
        saveSelectionAsAssembly();
    });
    bindButton('plant-drawing-save-inventory', function () {
        saveToInventory(false);
    });
    bindButton('plant-drawing-use-in-plant', function () {
        saveToInventory(true);
    });
    bindButton('plant-drawing-place-in-plant-parts', function () {
        placeSelectionInPlant();
    });
    bindButton('plant-drawing-export-svg', exportSvg);
    bindButton('plant-drawing-export-json', exportJson);
    const canvas = byId('plant-drawing-canvas');
    const stage = byId('plant-drawing-stage');
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerdown', function (event) {
        const menu = byId('plant-drawing-context-menu');
        if (menu && !menu.hidden && !menu.contains(event.target))
            closeContextMenu();
    }, true);
    window.addEventListener('blur', closeContextMenu);
    stage.addEventListener('dragover', onCanvasDragOver);
    stage.addEventListener('dragleave', onCanvasDragLeave);
    stage.addEventListener('drop', onCanvasDrop);
    canvas.addEventListener('wheel', function (event) {
        event.preventDefault();
        if (event.ctrlKey) {
            zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
            return;
        }
        if (event.shiftKey) {
            panCanvasByWheel({ deltaX: event.deltaY, deltaY: 0 });
            return;
        }
        panCanvasByWheel(event);
    }, { passive: false });
}

function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
        const workspace = byId('plant-drawing-workspace');
        if (!workspace || workspace.hidden)
            return;
        const editable = event.target instanceof HTMLInputElement
            || event.target instanceof HTMLTextAreaElement
            || event.target instanceof HTMLSelectElement
            || (event.target instanceof HTMLElement && event.target.isContentEditable);
        if (editable)
            return;
        if (event.code === 'Space') {
            event.preventDefault();
            ui.spacePressed = true;
            byId('plant-drawing-canvas').classList.add('is-pan-ready');
            return;
        }
        if (event.key === 'Control' || event.key === 'Meta') {
            byId('plant-drawing-canvas').classList.add('is-pan-ready');
            return;
        }
        const key = event.key.toLowerCase();
        const grid = currentSheet().grid;
        const panStep = canvasSize().width / viewScale() * 0.12;
        if ((event.ctrlKey || event.metaKey) && event.key.startsWith('Arrow')) {
            // Ctrl + arrows move the view, plain arrows move the selection.
            event.preventDefault();
            panViewBy(event.key === 'ArrowLeft' ? -panStep : (event.key === 'ArrowRight' ? panStep : 0),
                event.key === 'ArrowUp' ? -panStep : (event.key === 'ArrowDown' ? panStep : 0));
            return;
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const size = byId('plant-drawing-canvas').getBoundingClientRect();
            const target = ui.selection.entity_ids.length === 1
                ? { kind: 'entity', id: ui.selection.entity_ids[0] } : { kind: 'canvas', id: '' };
            openContextMenu(size.left + size.width / 2, size.top + size.height / 2, target, viewCenter());
            return;
        }
        if (ui.draft && ui.draft.type === 'polyline' && (event.key === 'Enter' || event.key === 'Backspace')) {
            event.preventDefault();
            if (event.key === 'Enter')
                finishPolyline();
            else
                removeLastPolylinePoint();
            return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            deleteSelectionNow();
        }
        else if (event.key === 'Escape') {
            closeContextMenu();
            if (ui.draft && ui.draft.type === 'polyline') {
                finishPolyline();
                return;
            }
            ui.ctrlGesture = null;
            ui.pendingPort = null;
            ui.drag = null;
            ui.draft = null;
            ui.marquee = null;
            ui.previewModel = null;
            ui.snapCandidate = null;
            ui.panning = null;
            byId('plant-drawing-canvas').classList.remove('is-panning', 'is-pan-ready');
            setTool('select');
            renderAll();
        }
        else if ((event.ctrlKey || event.metaKey) && key === 'd') {
            event.preventDefault();
            duplicateSelection();
        }
        else if ((event.ctrlKey || event.metaKey) && key === 'a') {
            event.preventDefault();
            selectAll();
        }
        else if ((event.ctrlKey || event.metaKey) && key === 'g') {
            event.preventDefault();
            groupSelectionNow();
        }
        else if (key === 'r' && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            rotateSelectionBy(event.shiftKey ? -90 : 90);
        }
        else if (key === 'f' && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            flipSelection(event.shiftKey ? 'y' : 'x');
        }
        else if (key === 'i' && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            invertSelection();
        }
        else if (key === 'z' && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            cycleVisualStateOfSelection();
        }
        else if ((key === '+' || key === '=') && !event.ctrlKey && !event.metaKey)
            zoomBy(1.2);
        else if (key === '-' && !event.ctrlKey && !event.metaKey)
            zoomBy(1 / 1.2);
        else if (event.key === 'ArrowLeft')
            nudgeSelection(-grid, 0);
        else if (event.key === 'ArrowRight')
            nudgeSelection(grid, 0);
        else if (event.key === 'ArrowUp')
            nudgeSelection(0, -grid);
        else if (event.key === 'ArrowDown')
            nudgeSelection(0, grid);
        else if (key === 'v')
            setTool('select');
        else if (key === 'h')
            setTool('pan');
        else if (key === 'c')
            setTool('connect');
        else if (key === 'l' && !event.ctrlKey && !event.metaKey)
            setTool('polyline');
        else if (key === 'b' && !event.ctrlKey && !event.metaKey)
            setTool('region');
        else if (key === 'd' && !event.ctrlKey && !event.metaKey)
            setTool('dimension');
    });
    document.addEventListener('keyup', function (event) {
        const canvas = byId('plant-drawing-canvas');
        if (event.key === 'Control' || event.key === 'Meta') {
            if (canvas && !ui.spacePressed)
                canvas.classList.remove('is-pan-ready');
            return;
        }
        if (event.code !== 'Space')
            return;
        ui.spacePressed = false;
        if (canvas)
            canvas.classList.remove('is-pan-ready');
    });
}

function bindState() {
    state.on('state:plant_drawing', function () {
        if (!ui.drag) {
            ui.previewModel = null;
            renderAll();
        }
    });
    state.on('plant_drawing:loaded', function () {
        ui.selection = emptySelection();
        ui.palettePreviewTemplateId = '';
        ui.palettePreviewAssemblyId = '';
        renderAssemblyPalette();
        renderPalette();
        renderAll();
    });
    state.on('history:restored', function () {
        ui.selection = emptySelection();
        ui.palettePreviewTemplateId = '';
        ui.palettePreviewAssemblyId = '';
        renderAll();
    });
    state.on('templates:loaded', function () {
        updateCategoryOptions();
        renderPalette();
        renderAll();
    });
    state.on('templates:reloaded', function () {
        updateCategoryOptions();
        renderPalette();
        renderAll();
    });
    document.addEventListener('plant:workspace-activated', function (event) {
        if (event.detail && event.detail.workspace === 'drawing') {
            window.requestAnimationFrame(function () {
                if (!ui.viewMeasured)
                    resetView();
                renderAll();
            });
        }
    });
}

function init() {
    if (ui.initialized || !byId('plant-drawing-workspace'))
        return;
    ui.initialized = true;
    state.setSilent('plant_drawing', normalizePlantDrawing(state.get('plant_drawing')));
    bindUi();
    bindKeyboard();
    bindStructuredAssemblySupport();
    bindState();
    updateCategoryOptions();
    renderPalette();
    renderAssemblyPalette();
    renderAll();
    loadLibraryAssemblies();
    window.__appVersion = '64_r6';
    document.documentElement.dataset.plantFactoryRelease = '64';
    document.documentElement.dataset.plantFactoryRevision = 'r6';
    applyAnimationState();
    window.__plantFactoryV64 = Object.freeze({
        version: '64',
        patchContract: 'PF-V64-SVG-EVENT-DRAWING',
        inheritedPatchContract: 'PF-V63.4-HMI-UX',
        additive: true,
        svgEventSchema: 'plant-factory.svg-event-animation',
        svgEventSchemaVersion: 1,
        eventEffects: [
            'fill', 'stroke', 'temperature', 'flow', 'blink',
            'pulse', 'rotate', 'level', 'opacity', 'glow'
        ],
        plantDrawingSchema: 'plant-factory.plant-drawing',
        elementalPlantDrawing: true,
        customInventoryComposition: true,
        v9PlantDrawingExport: true,
        patchRevision: 'r1',
        dragDropPlacement: 'single-instance',
        twoAxisPan: true,
        referenceDiagramImport: Object.keys(REFERENCE_DIAGRAMS)
    });
    window.__plantFactoryV64R1 = Object.freeze({
        version: '64_r1',
        patchContract: 'PF-V64-R1-DRAWING-UX',
        baseContract: 'PF-V64-SVG-EVENT-DRAWING',
        additive: true
    });
    window.__plantFactoryV64R2 = Object.freeze({
        version: '64_r2',
        patchContract: 'PF-AUTOMATION-STUDIO-V1',
        inheritedPatchContract: 'PF-V64-R1-DRAWING-UX',
        additive: true
    });
    window.__plantFactoryV64R3 = Object.freeze({
        version: '64_r3',
        patchContract: 'PF-V64-R3-DRAWING-ASSEMBLY',
        inheritedPatchContract: 'PF-AUTOMATION-STUDIO-V1',
        additive: true,
        portSnapping: true,
        joints: true,
        assemblyTemplates: true,
        separateInventories: ['drawing', 'plant'],
        assemblySchema: 'plant-factory.plant-drawing-assembly',
        assemblySchemaVersion: 1
    });
    window.__plantFactoryV64R4 = Object.freeze({
        version: '64_r4',
        patchContract: 'PF-V64-R4-DRAWING-GEOMETRY',
        inheritedPatchContract: 'PF-V64-R3-DRAWING-ASSEMBLY',
        additive: true,
        stretchProfiles: true,
        mirroring: true,
        flowInversion: true,
        scaleModes: SCALE_MODES.slice(),
        growingSheet: true,
        inspectorTabs: INSPECTOR_TABS.slice(),
        contextMenu: true,
        ctrlDragNavigation: true,
        elementaryParts: ['Swagelok_union', 'Swagelok_tee', 'Swagelok_elbow', 'Capillary_line',
            'Pipe_cap', 'Boundary_connector', 'Gas_mixer']
    });
    window.__plantFactoryV64R5 = Object.freeze({
        version: '64_r5',
        patchContract: 'PF-V64-R5-CLASSIC-DRAWING',
        inheritedPatchContract: 'PF-V64-R4-DRAWING-GEOMETRY',
        additive: true,
        classicSymbolFamily: true,
        visualStates: true,
        layers: DRAWING_LAYERS.slice(),
        lineStyles: LINE_STYLES.slice(),
        primitives: ['polyline', 'region', 'dimension'],
        animationToggle: true,
        structureConnectionKind: 'structure'
    });
    window.__plantFactoryV64R6 = Object.freeze({
        version: '64_r6',
        patchContract: 'PF-V64-R6-ACCESSIBLE-STRUCTURED-ASSEMBLY',
        inheritedPatchContract: 'PF-V64-R5-CLASSIC-DRAWING',
        additive: true,
        visibleInventoryScrollbar: true,
        accessibleCategoryTabs: true,
        structuredAssemblyInventory: true,
        editableAssemblyParts: true,
        legacyFlatAssemblyUpgrade: true,
        passiveDrawingLayout: true
    });
    window.PlantFactoryV64Drawing = Object.freeze({
        getModel: function () {
            return normalizePlantDrawing(state.get('plant_drawing'));
        },
        validate: function () {
            return validatePlantDrawing(state.get('plant_drawing'), templateById);
        },
        exportSelectionSvg: function () {
            const artifact = buildSvgArtifact(ui.selection, false);
            return artifact ? artifact.svg : '';
        },
        exportFullSvg: function () {
            const artifact = buildSvgArtifact(emptySelection(), true);
            return artifact ? artifact.svg : '';
        },
        getUiState: function () {
            return {
                tool: ui.tool,
                zoom: ui.zoom,
                pan: cloneValue(ui.pan),
                selectedTemplateId: ui.selectedTemplateId,
                selectedAssemblyTemplateId: ui.selectedAssemblyTemplateId,
                palettePreviewTemplateId: ui.palettePreviewTemplateId,
                palettePreviewAssemblyId: ui.palettePreviewAssemblyId,
                inventoryTab: ui.inventoryTab,
                inspectorTab: ui.inspectorTab,
                autoGrow: ui.autoGrow,
                layers: cloneValue(ui.layers),
                animationEnabled: ui.animationEnabled,
                draftPoints: ui.draft && ui.draft.type === 'polyline' ? ui.draft.points.length : 0,
                contextMenuOpen: Boolean(ui.contextMenu),
                viewScale: viewScale(),
                linkedDrag: ui.linkedDrag,
                snapEnabled: ui.snapEnabled,
                portHintsEnabled: ui.portHintsEnabled,
                selection: cloneValue(ui.selection),
                snapCandidate: ui.snapCandidate ? cloneValue(ui.snapCandidate) : null
            };
        },
        selectTool: setTool,
        setSelection: function (selection) {
            ui.selection = Object.assign(emptySelection(), selection && typeof selection === 'object' ? {
                entity_ids: Array.isArray(selection.entity_ids) ? selection.entity_ids.slice() : [],
                connection_ids: Array.isArray(selection.connection_ids) ? selection.connection_ids.slice() : [],
                primitive_ids: Array.isArray(selection.primitive_ids) ? selection.primitive_ids.slice() : []
            } : {});
            renderAll();
            return cloneValue(ui.selection);
        },
        selectComponent: function (entityId) {
            ui.selection = expandPlantSelectionToComponent(currentSheet(), onlySelection('entity', entityId));
            renderAll();
            return cloneValue(ui.selection);
        },
        rotateSelection: rotateSelectionBy,
        flipSelection: flipSelection,
        invertSelection: invertSelection,
        setScaleMode: setScaleModeForSelection,
        fitSheetToContent: function (shrink) {
            fitSheetNow(shrink === true);
            return cloneValue(currentSheet());
        },
        getSheet: function () {
            return cloneValue(currentSheet());
        },
        setInspectorTab: function (tab) {
            ui.inspectorTab = INSPECTOR_TABS.includes(tab) ? tab : 'part';
            renderInspector();
            return ui.inspectorTab;
        },
        openContextMenu: function (x, y) {
            const canvas = byId('plant-drawing-canvas');
            const rect = canvas.getBoundingClientRect();
            const target = ui.selection.entity_ids.length === 1
                ? { kind: 'entity', id: ui.selection.entity_ids[0] } : { kind: 'canvas', id: '' };
            openContextMenu(rect.left + numberValue(x, rect.width / 2), rect.top + numberValue(y, rect.height / 2),
                target, viewCenter());
            return Boolean(ui.contextMenu);
        },
        closeContextMenu: closeContextMenu,
        setVisualState: setVisualStateForSelection,
        setLayerVisible: function (layer, visible) {
            if (DRAWING_LAYERS.includes(layer))
                ui.layers[layer] = visible !== false;
            renderAll();
            return cloneValue(ui.layers);
        },
        setAnimation: function (enabled) {
            ui.animationEnabled = enabled === true;
            applyAnimationState();
            updateChrome();
            return ui.animationEnabled;
        },
        addPolyline: function (points, style, animated) {
            const primitive = normalizePlantPrimitive({
                type: 'polyline', points: points, line_style: style, animated: animated !== false
            });
            const next = updateActivePlantSheet(currentModel(), function (sheet) {
                sheet.primitives.push(primitive);
                return sheet;
            });
            commitModel(next, 'Leitung hinzugefügt');
            return primitive.primitive_id;
        },
        loadClassicReactorExample: function () {
            replaceWithClassicReactorExample();
            return normalizePlantDrawing(state.get('plant_drawing'));
        },
        loadClassicTemplateExample: function () {
            replaceWithClassicTemplateExample();
            return normalizePlantDrawing(state.get('plant_drawing'));
        },
        resetView: function () {
            resetView();
            renderCanvas();
            return { zoom: ui.zoom, pan: cloneValue(ui.pan) };
        },
        joinSelection: joinSelectionNow,
        placeTemplate: function (templateId, x, y) {
            return placeTemplate({ x: Number(x) || 0, y: Number(y) || 0 }, templateId, 'API');
        },
        placeAssembly: function (assemblyTemplateId, x, y) {
            return placeAssembly({ x: Number(x) || 0, y: Number(y) || 0 }, assemblyTemplateId, 'API');
        },
        saveSelectionAsAssembly: saveSelectionAsAssembly,
        getAssemblyTemplates: function () {
            return cloneValue(allAssemblyTemplates());
        },
        getDrawingInventory: function () {
            return {
                elements: drawingElementTemplates().map(function (template) { return template.id; }),
                assemblies: allAssemblyTemplates().map(function (template) { return template.assembly_template_id; }),
                imported: committedModel().inventory.imported_template_ids.slice(),
                plant_only: plantOnlyTemplates().map(function (template) { return template.id; })
            };
        },
        setInventoryTab: setInventoryTab,
        placeSelectionInPlant: placeSelectionInPlant,
        loadReferenceDiagram: loadReferenceDiagram,
        placeStructuredAssemblyTemplate: placeStructuredAssemblyTemplate,
        expandLegacyFlatAssembly: expandLegacyFlatAssembly,
        transferAssemblyToPlantInventory: transferAssemblyToPlantInventory,
        createReferenceModelFromSvg: createReferenceModelFromSvg,
        loadRohrofenExample: loadExample,
        loadRohrofenAssemblyExample: function () {
            replaceWithAssemblyExample();
            return normalizePlantDrawing(state.get('plant_drawing'));
        },
        loadRohrofenR4Example: function () {
            replaceWithR4Example();
            return normalizePlantDrawing(state.get('plant_drawing'));
        }
    });
}

const ui = {
    initialized: false,
    tool: 'select',
    inventoryTab: 'elements',
    selectedTemplateId: '',
    selectedAssemblyTemplateId: '',
    palettePreviewTemplateId: '',
    palettePreviewAssemblyId: '',
    connectionKind: 'process',
    selection: emptySelection(),
    pendingPort: null,
    panning: null,
    spacePressed: false,
    drag: null,
    draft: null,
    marquee: null,
    lastClick: null,
    previewModel: null,
    snapCandidate: null,
    libraryAssemblies: [],
    gridEnabled: true,
    snapEnabled: true,
    linkedDrag: true,
    portHintsEnabled: true,
    autoGrow: true,
    layers: { process: true, structure: true, annotation: true },
    animationEnabled: false,
    defaultLineStyle: 'pipe',
    defaultFontFamily: 'Arial, Helvetica, sans-serif',
    draftCursor: null,
    inspectorTab: 'part',
    contextMenu: null,
    ctrlGesture: null,
    fitScale: 0,
    viewMeasured: false,
    zoom: 1,
    pan: { x: 0, y: 0 }
};

if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init, { once: true });
else
    init();
