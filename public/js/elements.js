/**
 * elements.js - SVG-Element-Management
 *
 * Zuständigkeiten:
 * - SVG-Elemente erstellen und verwalten
 * - Element-Transformation (Move, Scale, Rotate)
 * - Element-Auswahl und -Manipulation
 * - Canvas-Interaktion (Drag & Drop, Zoom, Pan)
 */
import { state, utils } from './core.js';
import { templateRegistry } from './registry.js';
import { normalizeInstance, resolveInstancePorts } from './pid_standard.js';

function selectorNodes(inner, selector) {
    if (!selector)
        return [];
    try {
        const direct = Array.from(inner.querySelectorAll(selector));
        if (direct.length > 0)
            return direct;
    }
    catch (error) {
        return [];
    }
    if (selector.startsWith('#')) {
        const sourceId = selector.slice(1);
        return Array.from(inner.querySelectorAll('[data-source-id]')).filter(function (node) {
            return String(node.getAttribute('data-source-id') || '') === sourceId;
        });
    }
    return [];
}

function applyElementPaint(outer, instance) {
    try {
        if (!outer || !instance)
            return;
        const enabled = instance.paint_fill_enabled === true;
        const color = String(instance.paint_fill_color || '').trim();
        let opacity = Number(instance.paint_fill_opacity);
        if (!Number.isFinite(opacity))
            opacity = null;
        const selector = String(instance.paint_fill_selector || '').trim();
        const inner = outer.querySelector(':scope > g.svg-element-content') || outer;
        let nodes = [];
        if (selector) {
            nodes = selectorNodes(inner, selector);
        }
        else {
            const all = Array.from(inner.querySelectorAll('path,rect,circle,ellipse,polygon,polyline'));
            nodes = all.filter(function (node) {
                if (node.classList.contains('element-hit-bounds') || node.classList.contains('element-port-handle'))
                    return false;
                const fill = (node.getAttribute('fill') || '').trim().toLowerCase();
                const hasFillAttribute = fill && fill !== 'none' && fill !== 'transparent';
                const hasFillOpacityAttribute = node.getAttribute('fill-opacity') != null;
                const hasStyleFill = node.style && String(node.style.fill || '').trim() !== '';
                const hasStyleFillOpacity = node.style && String(node.style.fillOpacity || '').trim() !== '';
                return hasFillAttribute || hasFillOpacityAttribute || hasStyleFill || hasStyleFillOpacity;
            });
        }
        nodes.forEach(function (node) {
            node.setAttribute('data-hmi-fill', '1');
            if (node.getAttribute('data-orig-style-fill') == null)
                node.setAttribute('data-orig-style-fill', String(node.style.fill || ''));
            if (node.getAttribute('data-orig-style-fill-opacity') == null)
                node.setAttribute('data-orig-style-fill-opacity', String(node.style.fillOpacity || ''));
            if (enabled) {
                if (color)
                    node.style.fill = color;
                if (opacity != null)
                    node.style.fillOpacity = String(opacity);
            }
            else {
                const originalFill = node.getAttribute('data-orig-style-fill') || '';
                const originalOpacity = node.getAttribute('data-orig-style-fill-opacity') || '';
                if (originalFill)
                    node.style.fill = originalFill;
                else
                    node.style.removeProperty('fill');
                if (originalOpacity)
                    node.style.fillOpacity = originalOpacity;
                else
                    node.style.removeProperty('fill-opacity');
            }
        });
    }
    catch (error) {
        console.warn('Element paint could not be applied:', error.message);
    }
}

function applyCompositionPresentation(outer, instance) {
    if (!outer || !instance)
        return;
    const properties = instance.properties && typeof instance.properties === 'object'
        ? instance.properties : {};
    const layout = properties.drawing_assembly_role === 'layout';
    const hideEmbedded = layout && properties.drawing_hide_embedded_entities === true;
    outer.classList.toggle('svg-element--assembly-layout', layout);
    if (layout) {
        outer.setAttribute('data-assembly-role', 'layout');
        outer.setAttribute('aria-label', (instance.name || 'Baugruppe') + ' · passive Zeichnungsebene');
    }
    else {
        outer.removeAttribute('data-assembly-role');
    }
    const viewport = outer.querySelector(':scope > g.svg-element-content > svg.symbol-viewport');
    if (!viewport)
        return;
    viewport.querySelectorAll('[data-pf-entity-id], [data-pf-connection-id]').forEach(function (node) {
        if (hideEmbedded)
            node.setAttribute('display', 'none');
        else
            node.removeAttribute('display');
    });
}

function rewriteReferenceValue(value, idMap) {
    let result = String(value || '');
    idMap.forEach(function (targetId, sourceId) {
        result = result.replaceAll('url(#' + sourceId + ')', 'url(#' + targetId + ')');
        if (result === '#' + sourceId)
            result = '#' + targetId;
    });
    return result;
}

function escapeRegularExpression(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteStyleReferences(value, idMap) {
    let result = rewriteReferenceValue(value, idMap);
    idMap.forEach(function (targetId, sourceId) {
        const selectorPattern = new RegExp('#' + escapeRegularExpression(sourceId) + '(?=[\\s,.>{:+~\\[])', 'g');
        result = result.replace(selectorPattern, '#' + targetId);
    });
    return result;
}

function namespaceSvgIds(root, instanceId) {
    const idMap = new Map();
    root.querySelectorAll('[id]').forEach(function (node) {
        const sourceId = String(node.getAttribute('id') || '');
        if (!sourceId)
            return;
        const targetId = instanceId + '__' + sourceId.replace(/[^A-Za-z0-9_.-]/g, '_');
        idMap.set(sourceId, targetId);
        node.setAttribute('data-source-id', sourceId);
        node.setAttribute('id', targetId);
    });
    if (idMap.size === 0)
        return;
    root.querySelectorAll('*').forEach(function (node) {
        Array.from(node.attributes || []).forEach(function (attribute) {
            const updated = rewriteReferenceValue(attribute.value, idMap);
            if (updated !== attribute.value)
                node.setAttribute(attribute.name, updated);
        });
        if (node.localName === 'style' && node.textContent)
            node.textContent = rewriteStyleReferences(node.textContent, idMap);
    });
}

function instanceViewBox(instance, svgRoot) {
    const configured = Array.isArray(instance.viewBox) && instance.viewBox.length === 4
        ? instance.viewBox
        : null;
    if (configured)
        return configured.join(' ');
    const source = svgRoot.getAttribute('viewBox');
    if (source)
        return source;
    return '0 0 ' + (instance.width || 100) + ' ' + (instance.height || 100);
}

function createElementManager() {
    const self = {};

    self.init = function () {
        state.on('history:restored', function () {
            self.rebuildFromState();
        });
        state.on('elements:loaded', function () {
            self.rebuildFromState();
            state.set('selectedElements', []);
        });
        console.log('✓ Element-Manager initialisiert');
    };

    self.normalizeElementData = function (elementData, existingElements) {
        const template = templateRegistry.getTemplate(elementData && elementData.templateId);
        return normalizeInstance(elementData, template, existingElements || state.get('elements'));
    };

    self.registerTemplatePlacementHandler = function (handler) {
        if (typeof handler !== 'function')
            return function () {};
        if (!self.templatePlacementHandlers.includes(handler))
            self.templatePlacementHandlers.push(handler);
        return function () {
            self.templatePlacementHandlers = self.templatePlacementHandlers.filter(function (candidate) {
                return candidate !== handler;
            });
        };
    };

    self.runTemplatePlacementHandlers = function (template, x, y, settings) {
        for (let index = 0; index < self.templatePlacementHandlers.length; index += 1) {
            const handler = self.templatePlacementHandlers[index];
            try {
                const result = handler(template, x, y, settings);
                if (result && result.handled === true)
                    return result;
            }
            catch (error) {
                console.error('Strukturierte Template-Platzierung fehlgeschlagen:', error);
                return { handled: true, elementId: null };
            }
        }
        return null;
    };

    self.addElement = function (templateId, x, y, options) {
        const settings = options && typeof options === 'object' ? options : {};
        try {
            const template = templateRegistry.getTemplate(templateId);
            if (settings.skipStructuredPlacement !== true) {
                const handled = self.runTemplatePlacementHandlers(template, x, y, settings);
                if (handled)
                    return handled.elementId || null;
            }
            let instance = templateRegistry.createTemplateInstance(templateId, x, y);
            if (settings.instanceUpdates && typeof settings.instanceUpdates === 'object') {
                instance = self.normalizeElementData(
                    Object.assign({}, instance, settings.instanceUpdates),
                    state.get('elements')
                );
            }
            const svgElement = self.createSVGElement(instance);
            self.elementsLayer.appendChild(svgElement);
            self.elements.set(instance.id, { data: instance, element: svgElement });
            const stateElements = state.get('elements').slice();
            stateElements.push(instance);
            state.set('elements', stateElements);
            if (settings.deferHistory !== true)
                state.saveHistory();
            state.emit('element:added', instance);
            state.emit('hmi:auto-widget-skipped', {
                elementId: instance.id,
                reason: 'PF-PID-V1 explicit HMI policy'
            });
            return instance.id;
        }
        catch (error) {
            console.error('Fehler beim Hinzufügen des Elements:', error);
            return null;
        }
    };

    self.createSVGElement = function (rawInstance) {
        const NS = 'http://www.w3.org/2000/svg';
        const instance = self.normalizeElementData(rawInstance);
        Object.assign(rawInstance, instance);
        const outer = document.createElementNS(NS, 'g');
        outer.setAttribute('id', instance.id);
        outer.setAttribute(
            'class',
            instance.standard === 'PF-PID-V1'
                ? 'svg-element pf-pid-v1-entity'
                : 'svg-element'
        );
        outer.setAttribute('role', 'group');
        outer.setAttribute('aria-label', instance.tag + ' ' + instance.name);
        outer.setAttribute('data-template-id', instance.templateId || '');
        outer.setAttribute('data-standard', instance.standard || 'LEGACY');
        outer.setAttribute('data-symbol-type', instance.symbolType || 'symbol');
        outer.setAttribute('data-geometry-profile', instance.geometryProfile || 'legacy');
        outer.setAttribute('data-entity-tag', instance.tag || '');
        outer.setAttribute('data-runtime-state', instance.runtimeState || 'ready');
        outer.setAttribute('data-hmi-auto-create', 'false');

        const inner = document.createElementNS(NS, 'g');
        inner.setAttribute('class', 'svg-element-content');
        outer.appendChild(inner);

        const bounds = document.createElementNS(NS, 'rect');
        bounds.setAttribute('class', 'element-hit-bounds');
        bounds.setAttribute('x', '0');
        bounds.setAttribute('y', '0');
        bounds.setAttribute('width', String(instance.width));
        bounds.setAttribute('height', String(instance.height));
        bounds.setAttribute('fill', 'transparent');
        bounds.setAttribute('stroke', 'none');
        bounds.setAttribute('pointer-events', 'all');
        inner.appendChild(bounds);

        const parser = new DOMParser();
        const svgDocument = parser.parseFromString(instance.svgContent, 'image/svg+xml');
        const parserError = svgDocument.querySelector('parsererror');
        const svgRoot = parserError ? null : svgDocument.documentElement;
        const viewport = document.createElementNS(NS, 'svg');
        const sourceClass = svgRoot ? String(svgRoot.getAttribute('class') || '') : '';
        const canonicalClass = instance.standard === 'PF-PID-V1' ? ' pf-pid-v1' : '';
        viewport.setAttribute('class', ('symbol-viewport ' + sourceClass + canonicalClass).trim());
        viewport.setAttribute('x', '0');
        viewport.setAttribute('y', '0');
        viewport.setAttribute('width', String(instance.width));
        viewport.setAttribute('height', String(instance.height));
        viewport.setAttribute('viewBox', svgRoot
            ? instanceViewBox(instance, svgRoot)
            : '0 0 ' + instance.width + ' ' + instance.height);
        viewport.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        viewport.setAttribute('overflow', 'visible');
        viewport.setAttribute('data-pf-standard', instance.standard || 'LEGACY');
        viewport.setAttribute('data-pf-family', instance.family || instance.symbolType || 'symbol');
        if (svgRoot) {
            Array.from(svgRoot.attributes || []).forEach(function (attribute) {
                if (attribute.name.startsWith('data-'))
                    viewport.setAttribute(attribute.name, attribute.value);
            });
            Array.from(svgRoot.children).forEach(function (child) {
                viewport.appendChild(child.cloneNode(true));
            });
        }
        else {
            const fallbackText = document.createElementNS(NS, 'text');
            fallbackText.setAttribute('x', String(instance.width / 2));
            fallbackText.setAttribute('y', String(instance.height / 2));
            fallbackText.setAttribute('text-anchor', 'middle');
            fallbackText.setAttribute('class', 'symbol-parse-error');
            fallbackText.textContent = 'SVG ungültig';
            viewport.appendChild(fallbackText);
        }
        namespaceSvgIds(viewport, instance.id);
        inner.appendChild(viewport);

        const portLayer = document.createElementNS(NS, 'g');
        portLayer.setAttribute('class', 'element-port-layer');
        portLayer.setAttribute('aria-hidden', 'true');
        inner.appendChild(portLayer);

        self.updateGeometry(outer, instance);
        self.updateTransform(outer, instance);
        self.updateLabel(outer, instance);
        applyCompositionPresentation(outer, instance);
        return outer;
    };

    self.updateGeometry = function (element, instance) {
        const width = Math.max(24, Number(instance.width) || 100);
        const height = Math.max(24, Number(instance.height) || 100);
        instance.width = width;
        instance.height = height;
        const inner = element.querySelector(':scope > g.svg-element-content') || element;
        const bounds = inner.querySelector(':scope > rect.element-hit-bounds');
        const viewport = inner.querySelector(':scope > svg.symbol-viewport');
        if (bounds) {
            bounds.setAttribute('width', String(width));
            bounds.setAttribute('height', String(height));
        }
        if (viewport) {
            viewport.setAttribute('width', String(width));
            viewport.setAttribute('height', String(height));
        }
        self.updatePortLayer(element, instance);
    };

    self.updatePortLayer = function (element, instance) {
        const NS = 'http://www.w3.org/2000/svg';
        const inner = element.querySelector(':scope > g.svg-element-content') || element;
        const layer = inner.querySelector(':scope > g.element-port-layer');
        if (!layer)
            return;
        layer.innerHTML = '';
        resolveInstancePorts(instance).forEach(function (port) {
            const circle = document.createElementNS(NS, 'circle');
            circle.setAttribute('class', 'element-port-handle');
            circle.setAttribute('data-port-id', port.id);
            circle.setAttribute('data-port-kind', port.kind || 'process');
            circle.setAttribute('cx', String(port.x));
            circle.setAttribute('cy', String(port.y));
            circle.setAttribute('r', '4');
            circle.setAttribute('tabindex', '-1');
            const title = document.createElementNS(NS, 'title');
            title.textContent = (port.name || port.id) + ' · ' + (port.kind || 'process');
            circle.appendChild(title);
            layer.appendChild(circle);
        });
    };

    self.updateTransform = function (element, instance) {
        self.updateGeometry(element, instance);
        element.setAttribute('transform', 'translate(' + instance.x + ', ' + instance.y + ')');
        const inner = element.querySelector(':scope > g.svg-element-content') || element;
        const width = Number(instance.width) || 100;
        const height = Number(instance.height) || 100;
        const mode = instance.pivotMode || 'center';
        let pivotX = width / 2;
        let pivotY = height / 2;
        if (mode === 'custom') {
            pivotX = Number.isFinite(instance.pivotX) ? instance.pivotX : 0;
            pivotY = Number.isFinite(instance.pivotY) ? instance.pivotY : 0;
        }
        else if (mode === 'topleft') {
            pivotX = 0;
            pivotY = 0;
        }
        else if (mode === 'top') {
            pivotX = width / 2;
            pivotY = 0;
        }
        else if (mode === 'right') {
            pivotX = width;
            pivotY = height / 2;
        }
        else if (mode === 'bottom') {
            pivotX = width / 2;
            pivotY = height;
        }
        const transforms = [
            'translate(' + pivotX + ', ' + pivotY + ')',
            'rotate(' + (instance.rotation || 0) + ')',
            'scale(' + (instance.scale || 1) + ')',
            'translate(' + (-pivotX) + ', ' + (-pivotY) + ')'
        ];
        inner.setAttribute('transform', transforms.join(' '));
        element.setAttribute('data-entity-tag', instance.tag || '');
        element.setAttribute('data-runtime-state', instance.runtimeState || 'ready');
        element.setAttribute('aria-label', (instance.tag || '') + ' ' + (instance.name || ''));
        applyElementPaint(element, instance);
    };

    self.getElement = function (id) {
        return self.elements.get(id);
    };

    self.getAllElements = function () {
        return Array.from(self.elements.values());
    };

    self.listPorts = function (elementId) {
        const item = self.elements.get(elementId);
        if (!item)
            return [];
        if (!Array.isArray(item.data.ports) || item.data.ports.length === 0) {
            item.data.ports = [
                { id: 'left', name: 'Links', rx: 0, ry: 0.5, kind: 'process', direction: 'bidirectional' },
                { id: 'right', name: 'Rechts', rx: 1, ry: 0.5, kind: 'process', direction: 'bidirectional' },
                { id: 'top', name: 'Oben', rx: 0.5, ry: 0, kind: 'utility', direction: 'bidirectional' },
                { id: 'bottom', name: 'Unten', rx: 0.5, ry: 1, kind: 'utility', direction: 'bidirectional' }
            ];
            self.updatePortLayer(item.element, item.data);
        }
        return resolveInstancePorts(item.data);
    };

    self.setPort = function (elementId, portId, x, y, extra) {
        const item = self.elements.get(elementId);
        if (!item)
            return;
        const settings = extra || {};
        const sourcePorts = Array.isArray(item.data.ports) ? item.data.ports.slice() : [];
        const index = sourcePorts.findIndex(function (port) {
            return port.id === portId;
        });
        const width = Math.max(1, Number(item.data.width) || 100);
        const height = Math.max(1, Number(item.data.height) || 100);
        const updated = {
            ...settings,
            id: portId,
            name: settings.name || portId,
            x: Number(x) || 0,
            y: Number(y) || 0,
            rx: Math.min(1, Math.max(0, (Number(x) || 0) / width)),
            ry: Math.min(1, Math.max(0, (Number(y) || 0) / height))
        };
        if (index >= 0)
            sourcePorts[index] = { ...sourcePorts[index], ...updated };
        else
            sourcePorts.push(updated);
        self.updateElement(elementId, { ports: sourcePorts, ports_custom: true });
    };

    self.getPortWorldPosition = function (elementId, portId) {
        const item = self.elements.get(elementId);
        if (!item)
            return null;
        const port = self.listPorts(elementId).find(function (candidate) {
            return candidate.id === portId || candidate.name === portId;
        });
        if (!port)
            return null;
        const inner = item.element.querySelector(':scope > g.svg-element-content') || item.element;
        const ctm = inner && inner.getCTM && inner.getCTM();
        if (ctm && inner.ownerSVGElement && inner.ownerSVGElement.createSVGPoint) {
            const point = inner.ownerSVGElement.createSVGPoint();
            point.x = port.x;
            point.y = port.y;
            const transformed = point.matrixTransform(ctm);
            return { x: transformed.x, y: transformed.y };
        }
        return {
            x: (item.data.x || 0) + (port.x || 0),
            y: (item.data.y || 0) + (port.y || 0)
        };
    };

    self.updateLabel = function (element, instance) {
        const NS = 'http://www.w3.org/2000/svg';
        let group = element.querySelector(':scope > g.element-label');
        const tag = String(instance.tag || instance.properties?.tag || '').trim();
        const description = String(instance.description || instance.name || '').trim();
        if (!tag && !description) {
            if (group)
                group.remove();
            return;
        }
        if (!group) {
            group = document.createElementNS(NS, 'g');
            group.setAttribute('class', 'element-label');
            const tagNode = document.createElementNS(NS, 'text');
            tagNode.setAttribute('class', 'element-tag-label');
            tagNode.setAttribute('text-anchor', 'middle');
            group.appendChild(tagNode);
            const descriptionNode = document.createElementNS(NS, 'text');
            descriptionNode.setAttribute('class', 'element-description-label');
            descriptionNode.setAttribute('text-anchor', 'middle');
            group.appendChild(descriptionNode);
            element.appendChild(group);
        }
        const scale = Number.isFinite(instance.scale) && instance.scale > 0 ? instance.scale : 1;
        const width = Number(instance.width) || 100;
        const centerX = width / 2;
        const height = Number(instance.height) || 100;
        const rotation = (Number(instance.rotation) || 0) * Math.PI / 180;
        const rotatedHeight = Math.abs(width * scale * Math.sin(rotation))
            + Math.abs(height * scale * Math.cos(rotation));
        const baseY = height / 2 + rotatedHeight / 2 + 14;
        const tagNode = group.querySelector('.element-tag-label');
        const descriptionNode = group.querySelector('.element-description-label');
        tagNode.textContent = tag || description;
        tagNode.setAttribute('x', String(centerX));
        tagNode.setAttribute('y', String(baseY));
        descriptionNode.textContent = description && description !== tag ? description : '';
        descriptionNode.setAttribute('x', String(centerX));
        descriptionNode.setAttribute('y', String(baseY + 12));
    };

    self.updateElement = function (id, updates) {
        const item = self.elements.get(id);
        if (!item)
            return;
        Object.assign(item.data, updates || {});
        if (Object.prototype.hasOwnProperty.call(updates || {}, 'tag')) {
            if (!item.data.properties || typeof item.data.properties !== 'object')
                item.data.properties = {};
            item.data.properties.tag = item.data.tag;
        }
        if (Object.prototype.hasOwnProperty.call(updates || {}, 'description')) {
            if (!item.data.properties || typeof item.data.properties !== 'object')
                item.data.properties = {};
            item.data.properties.description = item.data.description;
        }
        self.updateTransform(item.element, item.data);
        self.updateLabel(item.element, item.data);
        applyCompositionPresentation(item.element, item.data);
        const stateElements = state.get('elements').slice();
        const index = stateElements.findIndex(function (element) {
            return element.id === id;
        });
        if (index !== -1) {
            stateElements[index] = { ...item.data };
            state.set('elements', stateElements);
        }
        state.emit('element:updated', { id: id, updates: updates || {} });
    };

    self.removeElement = function (id) {
        const item = self.elements.get(id);
        if (!item)
            return;
        item.element.remove();
        self.elements.delete(id);
        const stateElements = state.get('elements').filter(function (element) {
            return element.id !== id;
        });
        state.set('elements', stateElements);
        state.saveHistory();
        state.emit('element:removed', id);
    };

    self.selectElement = function (id, addToSelection) {
        const item = self.elements.get(id);
        if (!item)
            return;
        let selectedElements = state.get('selectedElements').slice();
        if (addToSelection) {
            if (!selectedElements.includes(id))
                selectedElements.push(id);
        }
        else {
            selectedElements.forEach(function (selectedId) {
                const selectedItem = self.elements.get(selectedId);
                if (selectedItem)
                    selectedItem.element.classList.remove('selected');
            });
            selectedElements = [id];
        }
        item.element.classList.add('selected');
        state.set('selectedElements', selectedElements);
        state.emit('selection:changed', selectedElements);
    };

    self.deselectAll = function () {
        state.get('selectedElements').forEach(function (id) {
            const item = self.elements.get(id);
            if (item)
                item.element.classList.remove('selected');
        });
        state.set('selectedElements', []);
        state.emit('selection:changed', []);
    };

    self.rebuildFromState = function () {
        self.elementsLayer.innerHTML = '';
        self.elements.clear();
        const sourceElements = state.get('elements');
        const normalizedElements = [];
        sourceElements.forEach(function (elementData) {
            const normalized = self.normalizeElementData(elementData, normalizedElements.concat(sourceElements));
            const svgElement = self.createSVGElement(normalized);
            self.elementsLayer.appendChild(svgElement);
            self.elements.set(normalized.id, { data: normalized, element: svgElement });
            normalizedElements.push(normalized);
        });
        state.set('elements', normalizedElements);
        state.emit('elements:rebuilt');
    };

    self.clear = function () {
        self.elements.forEach(function (item) {
            item.element.remove();
        });
        self.elements.clear();
        state.set('elements', []);
        state.set('selectedElements', []);
    };

    self.getElementBounds = function (id) {
        const item = self.elements.get(id);
        if (!item)
            return null;
        const data = item.data;
        const width = (Number(data.width) || 100) * (Number(data.scale) || 1);
        const height = (Number(data.height) || 100) * (Number(data.scale) || 1);
        const rotation = (Number(data.rotation) || 0) * Math.PI / 180;
        const rotatedWidth = Math.abs(width * Math.cos(rotation))
            + Math.abs(height * Math.sin(rotation));
        const rotatedHeight = Math.abs(width * Math.sin(rotation))
            + Math.abs(height * Math.cos(rotation));
        const centerX = (Number(data.x) || 0) + (Number(data.width) || 100) / 2;
        const centerY = (Number(data.y) || 0) + (Number(data.height) || 100) / 2;
        return {
            x: centerX - rotatedWidth / 2,
            y: centerY - rotatedHeight / 2,
            width: rotatedWidth,
            height: rotatedHeight,
            centerX: centerX,
            centerY: centerY,
            rotation: Number(data.rotation) || 0,
            scale: Number(data.scale) || 1
        };
    };

    self.elementsLayer = document.getElementById('elements-layer');
    self.canvas = document.getElementById('main-canvas');
    self.elements = new Map();
    self.templatePlacementHandlers = [];
    self.init();
    return self;
}
// ============================================================================
// Canvas-Controller
// ============================================================================
function createCanvasController(elementManager) {
    const self = {};
    self.init = function () {
        self.setupDragAndDrop();
        self.setupCanvasInteraction();
        self.setupZoomControls();
        self.setupToolbar();
        console.log('✓ Canvas-Controller initialisiert');
    };
    self.setupDragAndDrop = function () {
        // Drop auf Canvas
        self.canvas.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        self.canvas.addEventListener('drop', function (e) {
            e.preventDefault();
            const templateId = e.dataTransfer.getData('templateId');
            if (!templateId)
                return;
            // Position berechnen
            const coords = utils.getSVGCoordinates(self.canvas, e);
            // Transform des elements-layer berücksichtigen
            const zoom = state.get('zoom');
            const pan = state.get('pan');
            const adjustedX = (coords.x - pan.x) / zoom;
            const adjustedY = (coords.y - pan.y) / zoom;
            // Bei aktiviertem Snap einrasten
            let finalX = adjustedX;
            let finalY = adjustedY;
            if (state.get('snapEnabled')) {
                finalX = utils.snapToGrid(adjustedX);
                finalY = utils.snapToGrid(adjustedY);
            }
            self.elementManager.addElement(templateId, finalX, finalY);
        });
    };
    self.setupCanvasInteraction = function () {
        self.canvas.addEventListener('mousedown', function (e) {
            const target = e.target;
            const tool = state.get('currentTool');
            // Prüfen ob SVG-Element geklickt wurde
            const svgElement = target.closest('.svg-element');
            if (tool === 'select' && svgElement) {
                e.preventDefault();
                // Element selektieren
                const id = svgElement.getAttribute('id');
                const addToSelection = e.ctrlKey || e.metaKey;
                self.elementManager.selectElement(id, addToSelection);
                // Drag starten
                self.startElementDrag(svgElement, e);
            }
            else if (tool === 'pan' || (e.button === 1 || (e.button === 0 && e.altKey))) {
                e.preventDefault();
                self.startPan(e);
            }
            else if (tool === 'select' && !svgElement) {
                // Klick auf leere Fläche - Selektion aufheben
                self.elementManager.deselectAll();
            }
        });
        self.canvas.addEventListener('mousemove', function (e) {
            // Mausposition anzeigen
            const coords = utils.getSVGCoordinates(self.canvas, e);
            const zoom = state.get('zoom');
            const pan = state.get('pan');
            const adjustedX = Math.round((coords.x - pan.x) / zoom);
            const adjustedY = Math.round((coords.y - pan.y) / zoom);
            const posDisplay = document.getElementById('mouse-position');
            if (posDisplay) {
                posDisplay.textContent = `X: ${adjustedX}, Y: ${adjustedY}`;
            }
            // Drag/Pan verarbeiten
            if (self.isDragging) {
                self.dragElement(e);
            }
            else if (self.isPanning) {
                self.pan(e);
            }
        });
        self.canvas.addEventListener('mouseup', function (e) {
            if (self.isDragging) {
                self.endElementDrag();
            }
            else if (self.isPanning) {
                self.endPan();
            }
        });
        self.canvas.addEventListener('mouseleave', function (e) {
            if (self.isDragging) {
                self.endElementDrag();
            }
            else if (self.isPanning) {
                self.endPan();
            }
        });
        // Deselect bei Klick außerhalb
        self.canvas.addEventListener('click', function (e) {
            const target = e.target;
            if (target === self.canvas || target.id === 'elements-layer') {
                self.elementManager.deselectAll();
            }
        });
    };
    self.startElementDrag = function (element, e) {
        self.isDragging = true;
        self.draggedElement = element;
        // Aktuelle Mausposition im SVG-Koordinatensystem holen
        const mousePos = utils.getSVGCoordinates(self.canvas, e);
        // Transform des elements-layer berücksichtigen
        const zoom = state.get('zoom');
        const pan = state.get('pan');
        // Mausposition relativ zum elements-layer berechnen
        const adjustedMousePos = {
            x: (mousePos.x - pan.x) / zoom,
            y: (mousePos.y - pan.y) / zoom
        };
        self.dragStartPos = adjustedMousePos;
        const id = element.getAttribute('id');
        const item = self.elementManager.getElement(id);
        if (item) {
            self.dragStartElementPos = {
                x: item.data.x,
                y: item.data.y
            };
            // Offset zwischen Mausposition und Element-Position speichern
            self.dragOffset = {
                x: adjustedMousePos.x - item.data.x,
                y: adjustedMousePos.y - item.data.y
            };
        }
        element.style.cursor = 'grabbing';
    };
    self.dragElement = function (e) {
        if (!self.draggedElement || !self.dragOffset)
            return;
        // Aktuelle Mausposition berechnen
        const mousePos = utils.getSVGCoordinates(self.canvas, e);
        const zoom = state.get('zoom');
        const pan = state.get('pan');
        // Mausposition im elements-layer Koordinatensystem
        const adjustedMousePos = {
            x: (mousePos.x - pan.x) / zoom,
            y: (mousePos.y - pan.y) / zoom
        };
        // Neue Element-Position unter Berücksichtigung des Offsets
        let newX = adjustedMousePos.x - self.dragOffset.x;
        let newY = adjustedMousePos.y - self.dragOffset.y;
        // Snap to grid
        if (state.get('snapEnabled')) {
            newX = utils.snapToGrid(newX);
            newY = utils.snapToGrid(newY);
        }
        const id = self.draggedElement.getAttribute('id');
        self.elementManager.updateElement(id, {
            x: newX,
            y: newY
        });
    };
    self.endElementDrag = function () {
        if (self.draggedElement) {
            self.draggedElement.style.cursor = 'grab';
            state.saveHistory();
        }
        self.isDragging = false;
        self.draggedElement = null;
        self.dragStartPos = null;
        self.dragStartElementPos = null;
        self.dragOffset = null;
    };
    self.startPan = function (e) {
        self.isPanning = true;
        self.panStartPos = { x: e.clientX, y: e.clientY };
        self.canvas.style.cursor = 'grabbing';
    };
    self.pan = function (e) {
        if (!self.isPanning || !self.panStartPos)
            return;
        const dx = e.clientX - self.panStartPos.x;
        const dy = e.clientY - self.panStartPos.y;
        self.panStartPos = { x: e.clientX, y: e.clientY };
        const currentPan = state.get('pan');
        state.set('pan', {
            x: currentPan.x + dx,
            y: currentPan.y + dy
        });
        self.applyViewTransform();
    };
    self.endPan = function () {
        self.isPanning = false;
        self.panStartPos = null;
        self.canvas.style.cursor = 'default';
    };
    self.setupZoomControls = function () {
        const zoomInBtn = document.getElementById('btn-zoom-in');
        const zoomOutBtn = document.getElementById('btn-zoom-out');
        const zoomResetBtn = document.getElementById('btn-zoom-reset');
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', function () {
                return self.zoomIn();
            });
        }
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', function () {
                return self.zoomOut();
            });
        }
        if (zoomResetBtn) {
            zoomResetBtn.addEventListener('click', function () {
                return self.zoomReset();
            });
        }
        // Mausrad-Zoom
        self.canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            if (e.deltaY < 0) {
                self.zoomIn(0.1);
            }
            else {
                self.zoomOut(0.1);
            }
        }, { passive: false });
        // Zoom-Level anzeigen
        state.subscribe('zoom', function (zoom) {
            const zoomDisplay = document.getElementById('zoom-level');
            if (zoomDisplay) {
                zoomDisplay.textContent = Math.round(zoom * 100) + '%';
            }
        });
    };
    self.zoomIn = function (step = 0.2) {
        const vf = (typeof window !== 'undefined') ? window.__viewportFixV2 : null;
        const raw = Number(step);
        const s = (Number.isFinite(raw) && raw > 0) ? raw : 0.2;
        const factor = 1 + s;
        // ✅ Einheitlich mit Mousewheel (core.js): Multiplikativ + Anchor (Center)
        if (vf && typeof vf.zoomInCenter === 'function') {
            vf.zoomInCenter(factor);
            return;
        }
        // Fallback: alter linearer Zoom
        const currentZoom = state.get('zoom');
        const newZoom = Math.min(currentZoom + s, 5.0);
        state.set('zoom', newZoom);
        self.applyViewTransform();
    };
    self.zoomOut = function (step = 0.2) {
        const vf = (typeof window !== 'undefined') ? window.__viewportFixV2 : null;
        const raw = Number(step);
        const s = (Number.isFinite(raw) && raw > 0) ? raw : 0.2;
        const factor = 1 + s;
        // ✅ Einheitlich mit Mousewheel (core.js): Multiplikativ + Anchor (Center)
        if (vf && typeof vf.zoomOutCenter === 'function') {
            vf.zoomOutCenter(factor);
            return;
        }
        // Fallback: alter linearer Zoom
        const currentZoom = state.get('zoom');
        const newZoom = Math.max(currentZoom - s, 0.1);
        state.set('zoom', newZoom);
        self.applyViewTransform();
    };
    self.zoomReset = function () {
        const vf = (typeof window !== 'undefined') ? window.__viewportFixV2 : null;
        // Fit complete drawings responsively; keep the neutral reset for empty canvases.
        if (vf && typeof vf.fitContent === 'function' && self.elements.size > 0) {
            vf.fitContent(72);
            return;
        }
        if (vf && typeof vf.reset === 'function') {
            vf.reset();
            return;
        }
        // Fallback: alter Reset
        state.set('zoom', 1.0);
        state.set('pan', { x: 0, y: 0 });
        self.applyViewTransform();
    };
    self.applyViewTransform = function () {
        const zoom = state.get('zoom');
        const pan = state.get('pan');
        const vf = (typeof window !== 'undefined') ? window.__viewportFixV2 : null;
        // ✅ Wenn ViewportFix aktiv ist, ist ER die Quelle der Wahrheit.
        //    Wir haben gerade state.zoom/state.pan aktualisiert -> Fix aus State anwenden.
        if (vf && typeof vf.applyFromState === 'function') {
            vf.applyFromState();
            return;
        }
        // Fallback: direkte Layer-Transforms
        const transformString = `translate(${pan.x}, ${pan.y}) scale(${zoom})`;
        if (self.elementsLayer) {
            self.elementsLayer.setAttribute('transform', transformString);
        }
        if (self.connectionsLayer) {
            self.connectionsLayer.setAttribute('transform', transformString);
        }
        else {
            const connLayer = document.getElementById('connections-layer');
            if (connLayer) {
                connLayer.setAttribute('transform', transformString);
                self.connectionsLayer = connLayer;
            }
        }
        console.log('View-Transform angewendet:', transformString);
    };
    self.setupToolbar = function () {
        // Grid-Toggle
        const gridBtn = document.getElementById('btn-grid');
        if (gridBtn) {
            gridBtn.addEventListener('click', function () {
                const gridEnabled = !state.get('gridEnabled');
                state.set('gridEnabled', gridEnabled);
                const gridBg = document.getElementById('grid-background');
                if (gridBg) {
                    gridBg.classList.toggle('hidden', !gridEnabled);
                }
                gridBtn.classList.toggle('active', gridEnabled);
            });
        }
        // Snap-Toggle
        const snapBtn = document.getElementById('btn-snap');
        if (snapBtn) {
            snapBtn.addEventListener('click', function () {
                const snapEnabled = !state.get('snapEnabled');
                state.set('snapEnabled', snapEnabled);
                snapBtn.classList.toggle('active', snapEnabled);
            });
        }
        // Tool-Buttons
        document.querySelectorAll('.tool-btn[data-tool]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const tool = btn.dataset.tool;
                state.set('currentTool', tool);
                // Aktive Klasse setzen
                document.querySelectorAll('.tool-btn[data-tool]').forEach(function (b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
            });
        });
        // Delete-Button
        const deleteBtn = document.getElementById('btn-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function () {
                self.deleteSelected();
            });
        }
        // Undo/Redo
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) {
            undoBtn.addEventListener('click', function () {
                return state.undo();
            });
        }
        if (redoBtn) {
            redoBtn.addEventListener('click', function () {
                return state.redo();
            });
        }
        // Tastatur-Shortcuts
        document.addEventListener('keydown', function (e) {
            if (e.target.tagName === 'INPUT')
                return;
            switch (e.key) {
                case 'Delete':
                case 'Backspace':
                    e.preventDefault();
                    self.deleteSelected();
                    break;
                case 'v':
                case 'V':
                    state.set('currentTool', 'select');
                    break;
                case 'h':
                case 'H':
                    state.set('currentTool', 'pan');
                    break;
                case 'g':
                case 'G':
                    gridBtn.click();
                    break;
                case 's':
                case 'S':
                    snapBtn.click();
                    break;
                case 'z':
                case 'Z':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        if (e.shiftKey) {
                            state.redo();
                        }
                        else {
                            state.undo();
                        }
                    }
                    break;
                case 'y':
                case 'Y':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        state.redo();
                    }
                    break;
            }
        });
    };
    self.deleteSelected = function () {
        const selectedElements = state.get('selectedElements');
        if (selectedElements.length === 0)
            return;
        selectedElements.forEach(function (id) {
            self.elementManager.removeElement(id);
        });
        state.set('selectedElements', []);
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.elementManager = elementManager;
    self.canvas = document.getElementById('main-canvas');
    self.elementsLayer = document.getElementById('elements-layer');
    self.connectionsLayer = document.getElementById('connections-layer'); // ← WICHTIG!
    self.canvasContainer = document.getElementById('canvas-container');
    self.isDragging = false;
    self.dragStartPos = null;
    self.draggedElement = null;
    self.dragOffset = null;
    self.dragStartElementPos = null;
    self.isPanning = false;
    self.panStartPos = null;
    self.init();
    return self;
}
// ============================================================================
// Globale Instanzen
// ============================================================================
export const elementManager = createElementManager();
export const canvasController = createCanvasController(elementManager);
function createLayerSynchronizer() {
    const self = {};
    self.init = function () {
        // MutationObserver auf elements-layer
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === 'attributes' &&
                    mutation.attributeName === 'transform') {
                    self.syncTransform();
                }
            });
        });
        observer.observe(self.elementsLayer, {
            attributes: true,
            attributeFilter: ['transform']
        });
        // Initial synchronisieren
        self.syncTransform();
        console.log('✓ Layer-Synchronizer aktiv');
    };
    self.syncTransform = function () {
        const transform = self.elementsLayer.getAttribute('transform');
        if (transform) {
            self.connectionsLayer.setAttribute('transform', transform);
        }
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.elementsLayer = document.getElementById('elements-layer');
    self.connectionsLayer = document.getElementById('connections-layer');
    if (!self.elementsLayer || !self.connectionsLayer) {
        console.warn('Layer für Synchronisation nicht gefunden');
        return;
    }
    self.init();
    return self;
}
// Layer-Synchronizer initialisieren
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        createLayerSynchronizer();
    });
}
else {
    createLayerSynchronizer();
}
console.log('✓ Elements-Modul mit Connection-Fix geladen');
console.log('✓ Elements-Modul geladen');
// ============================================================================
// --- PRÄZISER DRAG-PATCH: Element-Dragging im Layer-Koordinatensystem ------
// ============================================================================
// --- PRÄZISER DRAG-PATCH V6 ---------------------------------------------------
// Änderungen ggü. V5:
// • Pointer-Capture NICHT auf pointerdown, sondern erst NACH Schwelle (echter Drag)
// • Klick bleibt vollständig intakt (Eigenschaften-Panel bleibt nach Loslassen erhalten)
// • Events werden nur im Drag-Zustand gestoppt
(function installPreciseElementDragV6() {
    if (window.__preciseElementDragV6Installed)
        return;
    window.__preciseElementDragV6Installed = true;
    const svg = document.getElementById('main-canvas');
    const layer = document.getElementById('elements-layer');
    if (!svg || !layer || typeof elementManager?.updateElement !== 'function')
        return;
    try {
        svg.style.touchAction = 'none';
    }
    catch (_) { }
    function screenToLayerLocal(sx, sy) {
        const m = layer.getScreenCTM && layer.getScreenCTM();
        if (!m || !svg.createSVGPoint)
            return { x: sx, y: sy };
        const pt = svg.createSVGPoint();
        pt.x = sx;
        pt.y = sy;
        const p = pt.matrixTransform(m.inverse());
        return { x: p.x, y: p.y };
    }
    // V52-Fix (B-25): Der State-Key heisst 'currentTool' (core.js:135), nicht
    // 'tool'. isSelectionToolActive() lieferte dadurch IMMER true und der
    // Element-Drag war auch im Hand-/Pan-Werkzeug aktiv.
    function isHandToolActive() {
        return document.body.classList.contains('tool-pan-active') ||
            (window.state && state.get && state.get('currentTool') === 'pan');
    }
    function isSelectionToolActive() {
        const t = (window.state && state.get && state.get('currentTool')) || 'select';
        return t === 'select' || !t;
    }
    const DRAG_THRESHOLD = 4; // px im Layer-System
    let press = null; // { pointerId, selectedIds, startLocal, starts, dragging, captured, captureTarget }
    let raf = 0;
    let pending = null;
    // pointerdown NICHT stoppen → Click bleibt möglich, solange kein Drag
    layer.addEventListener('pointerdown', function (e) {
        if (e.button !== 0)
            return; // nur linke Taste
        if (!isSelectionToolActive())
            return; // nur im Auswahl-Tool
        if (isHandToolActive() || e.ctrlKey)
            return; // Handmodus/CTRL → kein Element-Drag
        const hit = e.target.closest && e.target.closest('g.svg-element');
        if (!hit)
            return;
        const id = hit.getAttribute('id');
        const item = elementManager.getElement(id);
        if (!item)
            return;
        // Selektion bestimmen
        let selected = (window.state && state.get && state.get('selectedElements')) ? (state.get('selectedElements') || []) : [];
        if (!Array.isArray(selected) || selected.length === 0)
            selected = [id];
        if (!selected.includes(id))
            selected = [id]; // nur direkt geklicktes Element ziehen
        // Startwerte sichern
        const starts = new Map();
        selected.forEach(function (elId) {
            const it = elementManager.getElement(elId);
            if (it && it.data)
                starts.set(elId, { x: Number(it.data.x) || 0, y: Number(it.data.y) || 0 });
        });
        press = {
            pointerId: e.pointerId,
            selectedIds: selected,
            startLocal: screenToLayerLocal(e.clientX, e.clientY),
            starts,
            dragging: false,
            captured: false,
            captureTarget: svg // wir capturen erst, WENN Drag startet
        };
        // Globale Listener im Capture – aber wir stoppen Events erst IM Drag
        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerCancel, true);
        // Fallbacks
        window.addEventListener('mousemove', onMouseMove, true);
        window.addEventListener('mouseup', onMouseUp, true);
        window.addEventListener('blur', onAbort, true);
        window.addEventListener('contextmenu', onAbort, true);
    });
    function onPointerMove(e) {
        if (!press || e.pointerId !== press.pointerId)
            return;
        handleMove(e.clientX, e.clientY, e);
    }
    function onMouseMove(e) {
        if (!press)
            return;
        handleMove(e.clientX, e.clientY, e);
    }
    function handleMove(clientX, clientY, e) {
        const now = screenToLayerLocal(clientX, clientY);
        const dx = now.x - press.startLocal.x;
        const dy = now.y - press.startLocal.y;
        if (!press.dragging) {
            // Noch Klick-Kandidat → erst ab Schwelle in Drag wechseln
            const d2 = dx * dx + dy * dy;
            if (d2 < DRAG_THRESHOLD * DRAG_THRESHOLD)
                return;
            // --- AB HIER: echter Drag beginnt ---
            press.dragging = true;
            // Pointer-Capture JETZT setzen (nicht früher), damit wir das Up garantiert bekommen
            try {
                press.captureTarget.setPointerCapture(press.pointerId);
                press.captured = true;
            }
            catch (_) { }
            svg.style.cursor = 'grabbing';
        }
        // Im Drag: fremde Handler stoppen
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation)
            e.stopImmediatePropagation();
        pending = { dx, dy };
        if (!raf)
            raf = requestAnimationFrame(applyDrag);
    }
    function applyDrag() {
        raf = 0;
        if (!press || !press.dragging || !pending)
            return;
        const { dx, dy } = pending;
        pending = null;
        press.selectedIds.forEach(function (elId) {
            const st = press.starts.get(elId);
            if (!st)
                return;
            elementManager.updateElement(elId, { x: st.x + dx, y: st.y + dy });
        });
    }
    function finishDrag(stopEvent) {
        if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        pending = null;
        if (press && press.captured) {
            try {
                press.captureTarget.releasePointerCapture(press.pointerId);
            }
            catch (_) { }
        }
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerCancel, true);
        window.removeEventListener('mousemove', onMouseMove, true);
        window.removeEventListener('mouseup', onMouseUp, true);
        window.removeEventListener('blur', onAbort, true);
        window.removeEventListener('contextmenu', onAbort, true);
        // Nur wenn WIRKLICH Drag stattgefunden hat, den Up-Klick „verbrauchen“
        if (stopEvent && press && press.dragging) {
            stopEvent.preventDefault();
            stopEvent.stopPropagation();
            if (stopEvent.stopImmediatePropagation)
                stopEvent.stopImmediatePropagation();
        }
        press = null;
        svg.style.cursor = '';
    }
    function onPointerUp(e) {
        if (!press || e.pointerId !== press.pointerId)
            return;
        finishDrag(e);
    }
    function onMouseUp(e) {
        if (!press)
            return;
        finishDrag(e);
    }
    function onPointerCancel() {
        if (!press)
            return;
        finishDrag(); // kein Klick zu verbrauchen
    }
    function onAbort() {
        if (!press)
            return;
        finishDrag(); // Abbruch ohne Klick-Verbrauch
    }
    // native HTML5-Drag unterbinden
    layer.addEventListener('dragstart', function (e) {
        return e.preventDefault();
    });
})();
/*
// --- PRÄZISER DRAG-PATCH V4: Drag erst nach Schwelle; Klick/Properties bleiben intakt -----
(function installPreciseElementDragV4() {
    if (window.__preciseElementDragV4Installed) return;
    window.__preciseElementDragV4Installed = true;

    const svg   = document.getElementById('main-canvas');
    const layer = document.getElementById('elements-layer');
    if (!svg || !layer || typeof elementManager?.updateElement !== 'function') return;

    // Maus zu Layer-Koordinaten
    function screenToLayerLocal(sx, sy) {
        const m = layer.getScreenCTM && layer.getScreenCTM();
        if (!m || !svg.createSVGPoint) return { x: sx, y: sy };
        const pt = svg.createSVGPoint();
        pt.x = sx; pt.y = sy;
        const p = pt.matrixTransform(m.inverse());
        return { x: p.x, y: p.y };
    }

    // Aktive Tools abfragen
    function isHandToolActive() {
        return document.body.classList.contains('tool-pan-active') ||
               (window.state && state.get && state.get('currentTool') === 'pan');
    }
    function isSelectionToolActive() {
        const t = (window.state && state.get && state.get('currentTool')) || 'select';
        return t === 'select' || !t;
    }

    const DRAG_THRESHOLD = 4; // px im Layer-System

    let press = null;   // { targetId, selectedIds, startLocal:{x,y}, starts:Map, dragging:boolean }
    let raf = 0;
    let pending = null; // { dx, dy }

    // mousedown NICHT im Capture, NICHT stoppen → Click bleibt intakt, sofern kein Drag
    layer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;                 // nur linke Taste
        if (!isSelectionToolActive()) return;       // nur im Select-Tool
        if (isHandToolActive() || e.ctrlKey) return; // Handmodus/CTRL: kein Element-Drag

        const hit = e.target.closest && e.target.closest('g.svg-element');
        if (!hit) return;

        const id = hit.getAttribute('id');
        const item = elementManager.getElement(id);
        if (!item) return;

        // Selektion laden
        let selected = (window.state && state.get && state.get('selectedElements')) ? (state.get('selectedElements') || []) : [];
        if (!Array.isArray(selected) || selected.length === 0) selected = [id];
        if (!selected.includes(id)) selected = [id]; // nur direkt geklicktes Element ziehen

        // Startwerte sichern
        const starts = new Map();
        selected.forEach(elId => {
            const it = elementManager.getElement(elId);
            if (it && it.data) starts.set(elId, { x: Number(it.data.x) || 0, y: Number(it.data.y) || 0 });
        });

        press = {
            targetId: id,
            selectedIds: selected,
            startLocal: screenToLayerLocal(e.clientX, e.clientY),
            starts,
            dragging: false
        };

        // globale Listener zum Tracken – ABER noch nichts stoppen!
        window.addEventListener('mousemove', onMove, true); // capture, damit wir bei echtem Drag übernehmen können
        window.addEventListener('mouseup', onUp, true);
    });

    function onMove(e) {
        if (!press) return;

        const now = screenToLayerLocal(e.clientX, e.clientY);
        const dx = now.x - press.startLocal.x;
        const dy = now.y - press.startLocal.y;

        // Noch kein Drag? Schwelle prüfen
        if (!press.dragging) {
            const dist2 = dx * dx + dy * dy;
            if (dist2 < DRAG_THRESHOLD * DRAG_THRESHOLD) {
                // Noch Klick-Kandidat → nichts blocken
                return;
            }
            // Ab hier echter Drag: ab jetzt verhindern wir Parallel-Handler
            press.dragging = true;
            // Cursor Feedback (optional)
            svg.style.cursor = 'grabbing';
        }

        // ECHTER DRAG: Events stoppen, damit alte Drag-Handler NICHT mitlaufen
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        pending = { dx, dy };
        if (!raf) raf = requestAnimationFrame(applyDrag);
    }

    function applyDrag() {
        raf = 0;
        if (!press || !press.dragging || !pending) return;

        const { dx, dy } = pending;
        pending = null;

        press.selectedIds.forEach(elId => {
            const st = press.starts.get(elId);
            if (!st) return;
            elementManager.updateElement(elId, { x: st.x + dx, y: st.y + dy });
        });
    }

    function onUp(e) {
        // Wenn wir wirklich gezogen haben: Klick unterdrücken, sonst nicht
        if (press && press.dragging) {
            if (raf) { cancelAnimationFrame(raf); raf = 0; }
            pending = null;

            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
        press = null;
        svg.style.cursor = '';

        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
    }
})();
 */
/*
(function installPreciseElementDragV3() {
    if (window.__preciseElementDragV3Installed) return;
    window.__preciseElementDragV3Installed = true;

    const svg = document.getElementById('main-canvas');
    const layer = document.getElementById('elements-layer');
    if (!svg || !layer || typeof elementManager?.updateElement !== 'function') return;

    // Hilfsfunktion: Bildschirm -> Koordinaten des elements-layer
    function screenToLayerLocal(sx, sy) {
        const m = layer.getScreenCTM && layer.getScreenCTM();
        if (!m || !svg.createSVGPoint) return { x: sx, y: sy };
        const pt = svg.createSVGPoint();
        pt.x = sx; pt.y = sy;
        const p = pt.matrixTransform(m.inverse());
        return { x: p.x, y: p.y };
    }

    // Prüfen, ob echte Pan-Hand aktiv ist (nicht mit Ctrl-Hotkey verwechseln)
    function isHandToolActive() {
        return document.body.classList.contains('tool-pan-active') ||
               (window.state && state.get && state.get('currentTool') === 'pan');
    }

    let drag = null;       // { ids:[], startLocal:{x,y}, starts: Map id->{x,y} }
    let raf = 0;           // RAF-Coalescing
    let pending = null;    // { dx, dy }

    // Start: Nur linke Taste, nicht im Hand-Tool, Ziel muss ein svg-element sein
    layer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (isHandToolActive() || e.ctrlKey) return; // im Handmodus/CTRL nicht element-draggen

        const g = e.target.closest && e.target.closest('g.svg-element');
        if (!g) return;

        const id = g.getAttribute('id');
        const item = elementManager.getElement(id);
        if (!item) return;

        // Auswahl ermitteln (Multi-Select wird gleich mitgezogen)
        let selected = (window.state && state.get && state.get('selectedElements')) ? (state.get('selectedElements') || []) : [];
        if (!Array.isArray(selected) || selected.length === 0) selected = [id];
        if (!selected.includes(id)) selected = [id]; // nur direkt angeklicktes Element ziehen

        // Offsets sichern
        const starts = new Map();
        selected.forEach(elId => {
            const it = elementManager.getElement(elId);
            if (it && it.data) {
                starts.set(elId, { x: Number(it.data.x) || 0, y: Number(it.data.y) || 0 });
            }
        });

        drag = {
            ids: selected,
            startLocal: screenToLayerLocal(e.clientX, e.clientY),
            starts
        };

        // Verhindere, dass alte Drag-Handler parallel laufen (beschleunigen!)
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        // Move/Up global binden
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onUp, true);
    }, true);

    function onMove(e) {
        if (!drag) return;

        // Koordinaten im Layer-System
        const now = screenToLayerLocal(e.clientX, e.clientY);
        const dx = now.x - drag.startLocal.x;
        const dy = now.y - drag.startLocal.y;

        // Coalescing pro Frame
        pending = { dx, dy };
        if (!raf) {
            raf = requestAnimationFrame(applyDrag);
        }

        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }

    function applyDrag() {
        raf = 0;
        if (!drag || !pending) return;

        const { dx, dy } = pending;
        pending = null;

        // Alle selektierten Elemente relativ verschieben
        drag.ids.forEach(elId => {
            const start = drag.starts.get(elId);
            if (!start) return;
            elementManager.updateElement(elId, {
                x: start.x + dx,
                y: start.y + dy
            });
        });
    }

    function onUp(e) {
        if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        pending = null;
        drag = null;

        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);

        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
})();
 */ 
