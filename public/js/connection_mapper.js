/**
 * connection_mapper.js - Verbindungs-Management
 *
 * Zuständigkeiten:
 * - Verbindungen zwischen Elementen erstellen
 * - Verbindungslinien visualisieren
 * - Verbindungstypen verwalten (Rohre, Signale, Daten)
 * - Automatische Routing-Algorithmen
 */
import { state, utils } from './core.js';
import { elementManager } from './elements.js';
import { closeModalElement, openModalElement, showConfirmation, showNotice } from './dialog_service.js';
import {
    choosePortPair,
    normalizeConnection,
    portAcceptsConnection,
    portDirectionAccepts,
    portsCompatible
} from './pid_standard.js';
// ============================================================================
// Connection-Manager
// ============================================================================
function createConnectionManager() {
    const self = {};
    self.init = function () {
        // React to element updates without rebuilding the persisted model.
        state.on('element:updated', function (data) {
            self.updateConnectedLines(data.id);
        });
        state.on('element:removed', function (id) {
            self.removeConnectionsByElement(id);
        });
        state.on('history:restored', function () {
            self.rebuildFromState({ reason: 'history_restored' });
        });
        // Project loading sets elements first and connections second. Build the
        // path DOM immediately, then resolve CTM/BBox after stable layout frames.
        state.on('connections:loaded', function () {
            self.rebuildFromState({ reason: 'project_connections_loaded' });
        });
        state.on('elements:rebuilt', function () {
            self.scheduleLayoutRefresh('elements_rebuilt');
        });
        window.addEventListener('resize', function () {
            self.scheduleLayoutRefresh('viewport_resized', { maxAttempts: 12 });
        });
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                self.scheduleLayoutRefresh('fonts_ready', { maxAttempts: 12 });
            });
        }
        console.log('✓ Connection-Manager initialisiert');
    };
    self.cancelLayoutRefresh = function () {
        self.layoutEpoch += 1;
        if (self.layoutTimer !== null) {
            window.clearTimeout(self.layoutTimer);
            self.layoutTimer = null;
        }
        if (self.layoutFrame !== null) {
            window.cancelAnimationFrame(self.layoutFrame);
            self.layoutFrame = null;
        }
    };
    self.scheduleLayoutRefresh = function (reason, options) {
        const opts = options && typeof options === 'object' ? options : {};
        const maxAttempts = Math.max(1, Number(opts.maxAttempts) || 40);
        const baseDelay = Math.max(8, Number(opts.baseDelay) || 16);
        self.cancelLayoutRefresh();
        const epoch = self.layoutEpoch;
        let attempt = 0;

        function publish(report, status) {
            const payload = {
                reason: reason || 'layout_refresh',
                status: status,
                attempt: attempt,
                updated: report.updated,
                pending: report.pending,
                total: self.connections.size
            };
            state.emit('connections:layout-ready', payload);
            state.emit('connections:layout-settled', payload);
        }

        function scheduleAttempt() {
            if (epoch !== self.layoutEpoch)
                return;
            const delay = Math.min(160, baseDelay + Math.floor(attempt / 4) * baseDelay);
            self.layoutTimer = window.setTimeout(function () {
                self.layoutTimer = null;
                self.layoutFrame = window.requestAnimationFrame(refreshFrame);
            }, delay);
        }

        function refreshFrame() {
            self.layoutFrame = null;
            if (epoch !== self.layoutEpoch)
                return;
            attempt += 1;
            const report = self.updateAllConnections();
            if (report.pending > 0 && attempt < maxAttempts) {
                scheduleAttempt();
                return;
            }
            publish(report, report.pending > 0 ? 'pending' : 'ready');
        }

        self.layoutFrame = window.requestAnimationFrame(function () {
            self.layoutFrame = window.requestAnimationFrame(refreshFrame);
        });
    };
    self.updateAllConnections = function () {
        let updated = 0;
        let pending = 0;
        self.connections.forEach(function (item) {
            if (item.element && item.data) {
                if (self.updateConnectionPath(item.element, item.data))
                    updated += 1;
                else
                    pending += 1;
            }
        });
        return { updated: updated, pending: pending };
    };
    self.rejectConnection = function (connectionId, reason, detail) {
        const payload = Object.assign({
            id: connectionId || null,
            reason: reason
        }, detail && typeof detail === 'object' ? detail : {});
        state.emit('connection:rejected', payload);
        return false;
    };
    self.resolvePortPair = function (fromId, toId, type, fromPortId, toPortId) {
        const fromItem = elementManager.getElement(fromId);
        const toItem = elementManager.getElement(toId);
        if (!fromId || !toId || fromId === toId || !fromItem || !toItem) {
            return { ok: false, reason: 'incompatible_endpoints' };
        }
        if (!self.connectionTypes[type]) {
            return { ok: false, reason: 'incompatible_ports' };
        }
        const fromPorts = elementManager.listPorts(fromId).filter(function (port) {
            return portAcceptsConnection(port, type, 'from') && portDirectionAccepts(port, 'from');
        });
        const toPorts = elementManager.listPorts(toId).filter(function (port) {
            return portAcceptsConnection(port, type, 'to') && portDirectionAccepts(port, 'to');
        });
        const requestedFrom = fromPortId ? fromPorts.find(function (port) {
            return port.id === fromPortId;
        }) : null;
        const requestedTo = toPortId ? toPorts.find(function (port) {
            return port.id === toPortId;
        }) : null;
        if ((fromPortId && !requestedFrom) || (toPortId && !requestedTo)) {
            return { ok: false, reason: 'incompatible_ports' };
        }
        let selectedFrom = requestedFrom;
        let selectedTo = requestedTo;
        if (selectedFrom && selectedTo) {
            if (!portsCompatible(selectedFrom, selectedTo, type)) {
                return { ok: false, reason: 'incompatible_ports' };
            }
        }
        else if (selectedFrom) {
            selectedTo = toPorts.find(function (port) {
                return portsCompatible(selectedFrom, port, type);
            }) || null;
        }
        else if (selectedTo) {
            selectedFrom = fromPorts.find(function (port) {
                return portsCompatible(port, selectedTo, type);
            }) || null;
        }
        else {
            const automaticPair = choosePortPair(fromItem.data, toItem.data, type);
            if (automaticPair) {
                selectedFrom = fromPorts.find(function (port) {
                    return port.id === automaticPair.fromPort;
                }) || null;
                selectedTo = toPorts.find(function (port) {
                    return port.id === automaticPair.toPort;
                }) || null;
            }
        }
        if (!selectedFrom || !selectedTo || !portsCompatible(selectedFrom, selectedTo, type)) {
            return { ok: false, reason: 'incompatible_ports' };
        }
        return {
            ok: true,
            fromPort: selectedFrom.id,
            toPort: selectedTo.id,
            fromAnchor: { mode: 'port', portId: selectedFrom.id },
            toAnchor: { mode: 'port', portId: selectedTo.id }
        };
    };
    self.applyConnectionData = function (item, connection, options) {
        const opts = options && typeof options === 'object' ? options : {};
        const line = item.element;
        const typeStyle = self.connectionTypes[connection.type] || self.connectionTypes.pipe;
        item.data = connection;
        line.setAttribute('data-type', connection.type);
        line.setAttribute('data-from', connection.from);
        line.setAttribute('data-to', connection.to);
        line.setAttribute('data-from-port', connection.fromPort || 'auto');
        line.setAttribute('data-to-port', connection.toPort || 'auto');
        line.setAttribute('stroke', typeStyle.stroke);
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('stroke-linejoin', 'round');
        if (typeStyle.dashArray)
            line.setAttribute('stroke-dasharray', typeStyle.dashArray);
        else
            line.removeAttribute('stroke-dasharray');
        const width = Number(connection.strokeWidth) || typeStyle.strokeWidth || 2;
        line.setAttribute('stroke-width', width);
        line.style.setProperty('stroke-width', String(width), 'important');
        line.style.setProperty('vector-effect', 'non-scaling-stroke', 'important');
        if (opts.deferPath === true) {
            line.setAttribute('data-render-state', 'pending');
            line.removeAttribute('d');
            return false;
        }
        return self.updateConnectionPath(line, connection);
    };
    self.persistConnection = function (connectionId, connection, options) {
        const opts = options && typeof options === 'object' ? options : {};
        const item = self.connections.get(connectionId);
        if (!item)
            return false;
        const rendered = self.applyConnectionData(item, connection);
        if (!rendered)
            self.scheduleLayoutRefresh('connection_updated');
        const list = (state.get('connections') || []).slice();
        const index = list.findIndex(function (candidate) {
            return candidate.id === connectionId;
        });
        if (index !== -1)
            list[index] = connection;
        state.set('connections', list);
        if (opts.history !== false)
            state.saveHistory();
        state.emit('connection:updated', { id: connectionId, data: Object.assign({}, connection) });
        return true;
    };
    self.updateConnection = function (connectionId, patch, options) {
        const item = self.connections.get(connectionId);
        if (!item)
            return false;
        const change = patch && typeof patch === 'object' ? patch : {};
        const current = item.data;
        const has = function (name) {
            return Object.prototype.hasOwnProperty.call(change, name);
        };
        const nextFrom = has('from') ? String(change.from || '') : current.from;
        const nextTo = has('to') ? String(change.to || '') : current.to;
        const nextType = has('type') ? String(change.type || '') : current.type;
        const requestedFromPort = has('fromPort') ? (change.fromPort || null) : current.fromPort;
        const requestedToPort = has('toPort') ? (change.toPort || null) : current.toPort;
        const resolved = self.resolvePortPair(
            nextFrom,
            nextTo,
            nextType,
            requestedFromPort,
            requestedToPort
        );
        if (!resolved.ok) {
            return self.rejectConnection(connectionId, resolved.reason, {
                from: nextFrom,
                to: nextTo,
                requestedType: nextType,
                fromPort: requestedFromPort,
                toPort: requestedToPort
            });
        }
        const endpointFromChanged = nextFrom !== current.from;
        const endpointToChanged = nextTo !== current.to;
        const semanticChanged = nextType !== current.type || has('fromPort') || has('toPort');
        let fromAnchor = resolved.fromAnchor;
        let toAnchor = resolved.toAnchor;
        let fromPort = resolved.fromPort;
        let toPort = resolved.toPort;
        if (has('fromAnchor') && change.fromAnchor && change.fromAnchor.mode === 'fixed') {
            fromAnchor = {
                mode: 'fixed',
                x: Number(change.fromAnchor.x) || 0,
                y: Number(change.fromAnchor.y) || 0
            };
            fromPort = null;
        }
        else if (!has('fromAnchor') && current.fromAnchor && current.fromAnchor.mode === 'fixed'
            && !endpointFromChanged && !semanticChanged) {
            fromAnchor = Object.assign({}, current.fromAnchor);
            fromPort = null;
        }
        if (has('toAnchor') && change.toAnchor && change.toAnchor.mode === 'fixed') {
            toAnchor = {
                mode: 'fixed',
                x: Number(change.toAnchor.x) || 0,
                y: Number(change.toAnchor.y) || 0
            };
            toPort = null;
        }
        else if (!has('toAnchor') && current.toAnchor && current.toAnchor.mode === 'fixed'
            && !endpointToChanged && !semanticChanged) {
            toAnchor = Object.assign({}, current.toAnchor);
            toPort = null;
        }
        const typeStyle = self.connectionTypes[nextType] || self.connectionTypes.pipe;
        const requestedWidth = has('strokeWidth') ? Number(change.strokeWidth) : Number(current.strokeWidth);
        const next = Object.assign({}, current, change, {
            id: connectionId,
            from: nextFrom,
            to: nextTo,
            type: nextType,
            fromPort: fromPort,
            toPort: toPort,
            fromAnchor: fromAnchor,
            toAnchor: toAnchor,
            strokeWidth: Number.isFinite(requestedWidth) && requestedWidth > 0
                ? requestedWidth : typeStyle.strokeWidth,
            label: has('label') ? String(change.label || '') : String(current.label || ''),
            object_standard: Object.assign({}, current.object_standard || {}, {
                id: 'PF-PID-V1',
                version: '1.0',
                release: '61.1',
                semantic_ports: Boolean(fromPort && toPort),
                routing: 'orthogonal',
                manual_anchor_override: fromAnchor.mode === 'fixed' || toAnchor.mode === 'fixed'
            })
        });
        return self.persistConnection(connectionId, next, options);
    };
    self.createConnection = function (fromId, toId, type = 'pipe', options = {}) {
        const resolved = self.resolvePortPair(
            fromId,
            toId,
            type,
            options.fromPort || null,
            options.toPort || null
        );
        if (!resolved.ok) {
            self.rejectConnection(null, resolved.reason, {
                from: fromId,
                to: toId,
                requestedType: type,
                fromPort: options.fromPort || null,
                toPort: options.toPort || null
            });
            return null;
        }
        const connectionId = self.generateConnectionId();
        const typeStyle = self.connectionTypes[type] || self.connectionTypes.pipe;
        const fromFixed = options.fromAnchor && options.fromAnchor.mode === 'fixed';
        const toFixed = options.toAnchor && options.toAnchor.mode === 'fixed';
        const connection = {
            id: connectionId,
            from: fromId,
            to: toId,
            type: type,
            fromPort: fromFixed ? null : resolved.fromPort,
            toPort: toFixed ? null : resolved.toPort,
            fromAnchor: fromFixed ? Object.assign({}, options.fromAnchor) : resolved.fromAnchor,
            toAnchor: toFixed ? Object.assign({}, options.toAnchor) : resolved.toAnchor,
            strokeWidth: Number(options.strokeWidth) > 0 ? Number(options.strokeWidth) : typeStyle.strokeWidth,
            label: options.label || '',
            properties: options.properties || {},
            object_standard: {
                id: 'PF-PID-V1',
                version: '1.0',
                release: '61.1',
                semantic_ports: !fromFixed && !toFixed,
                routing: 'orthogonal',
                manual_anchor_override: fromFixed || toFixed
            }
        };
        const line = self.createConnectionLine(connection);
        self.connectionsLayer.appendChild(line);
        self.connections.set(connectionId, { data: connection, element: line });
        if (line.getAttribute('data-render-state') !== 'ready')
            self.scheduleLayoutRefresh('connection_created');
        const stateConnections = (state.get('connections') || []).slice();
        stateConnections.push(connection);
        state.set('connections', stateConnections);
        if (options.deferHistory !== true)
            state.saveHistory();
        state.emit('connection:created', connection);
        return connectionId;
    };
    self.createConnectionLine = function (connection, options) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('id', connection.id);
        line.setAttribute('class', 'connection-line');
        const item = { data: connection, element: line };
        self.applyConnectionData(item, connection, options);
        line.addEventListener('click', function (event) {
            event.stopPropagation();
            self.selectConnection(connection.id);
        });
        return line;
    };
    self.setConnectionStyle = function (connectionId, style) {
        const value = style && typeof style === 'object' ? style : {};
        return self.updateConnection(connectionId, {
            type: value.type,
            strokeWidth: value.strokeWidth
        });
    };
    self.updateConnectionEndpoints = function (connectionId, endpoints) {
        const value = endpoints && typeof endpoints === 'object' ? endpoints : {};
        const patch = {};
        if (Object.prototype.hasOwnProperty.call(value, 'from'))
            patch.from = value.from;
        if (Object.prototype.hasOwnProperty.call(value, 'to'))
            patch.to = value.to;
        return self.updateConnection(connectionId, patch);
    };
    self.setConnectionAnchor = function (connectionId, side, anchor) {
        const patch = {};
        if (side === 'from') {
            patch.fromAnchor = anchor && typeof anchor === 'object'
                ? Object.assign({}, anchor) : { mode: 'auto' };
            if (!anchor || anchor.mode !== 'fixed')
                patch.fromPort = anchor && anchor.portId ? anchor.portId : null;
        }
        else if (side === 'to') {
            patch.toAnchor = anchor && typeof anchor === 'object'
                ? Object.assign({}, anchor) : { mode: 'auto' };
            if (!anchor || anchor.mode !== 'fixed')
                patch.toPort = anchor && anchor.portId ? anchor.portId : null;
        }
        else {
            return false;
        }
        return self.updateConnection(connectionId, patch);
    };
    self.updateConnectionPath = function (line, connection) {
        const markPending = function () {
            line.setAttribute('data-render-state', 'pending');
            line.removeAttribute('d');
            return false;
        };
        const finitePoint = function (point) {
            return Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
        };
        const fromItem = elementManager.getElement(connection.from);
        const toItem = elementManager.getElement(connection.to);
        const layer = self.connectionsLayer;
        if (!fromItem || !toItem || !layer || !layer.isConnected)
            return markPending();
        const fromInner = fromItem.element.querySelector(':scope > g.svg-element-content') || fromItem.element;
        const toInner = toItem.element.querySelector(':scope > g.svg-element-content') || toItem.element;
        if (!fromInner.isConnected || !toInner.isConnected)
            return markPending();

        const mapPoint = function (fromNode, toNode, x, y) {
            if (!Number.isFinite(x) || !Number.isFinite(y))
                return null;
            const svg = (fromNode && fromNode.ownerSVGElement) || (toNode && toNode.ownerSVGElement);
            if (!svg || typeof svg.createSVGPoint !== 'function')
                return null;
            const fromMatrix = fromNode && fromNode.getCTM ? fromNode.getCTM() : null;
            const toMatrix = toNode && toNode.getCTM ? toNode.getCTM() : null;
            if (!fromMatrix || !toMatrix)
                return null;
            try {
                const point = svg.createSVGPoint();
                point.x = x;
                point.y = y;
                const viewportPoint = point.matrixTransform(fromMatrix);
                const localPoint = viewportPoint.matrixTransform(toMatrix.inverse());
                const result = { x: localPoint.x, y: localPoint.y };
                return finitePoint(result) ? result : null;
            }
            catch (error) {
                return null;
            }
        };
        const boundsInLayer = function (node) {
            let bounds = null;
            try {
                bounds = node.getBBox();
            }
            catch (error) {
                return null;
            }
            if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)
                || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)
                || bounds.width <= 0 || bounds.height <= 0) {
                return null;
            }
            const corners = [
                mapPoint(node, layer, bounds.x, bounds.y),
                mapPoint(node, layer, bounds.x + bounds.width, bounds.y),
                mapPoint(node, layer, bounds.x + bounds.width, bounds.y + bounds.height),
                mapPoint(node, layer, bounds.x, bounds.y + bounds.height)
            ];
            if (!corners.every(finitePoint))
                return null;
            const xValues = corners.map(function (point) { return point.x; });
            const yValues = corners.map(function (point) { return point.y; });
            const minX = Math.min.apply(null, xValues);
            const maxX = Math.max.apply(null, xValues);
            const minY = Math.min.apply(null, yValues);
            const maxY = Math.max.apply(null, yValues);
            const result = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2
            };
            return Object.values(result).every(Number.isFinite) ? result : null;
        };

        const fromBounds = boundsInLayer(fromInner);
        const toBounds = boundsInLayer(toInner);
        if (!fromBounds || !toBounds)
            return markPending();
        let startPoint = null;
        let endPoint = null;
        if (connection.fromAnchor && connection.fromAnchor.mode === 'fixed') {
            startPoint = mapPoint(fromInner, layer, Number(connection.fromAnchor.x), Number(connection.fromAnchor.y));
        }
        if (connection.toAnchor && connection.toAnchor.mode === 'fixed') {
            endPoint = mapPoint(toInner, layer, Number(connection.toAnchor.x), Number(connection.toAnchor.y));
        }
        if (!startPoint && connection.fromPort) {
            const port = elementManager.listPorts(connection.from).find(function (candidate) {
                return candidate.id === connection.fromPort;
            });
            if (port)
                startPoint = mapPoint(fromInner, layer, Number(port.x), Number(port.y));
        }
        if (!endPoint && connection.toPort) {
            const port = elementManager.listPorts(connection.to).find(function (candidate) {
                return candidate.id === connection.toPort;
            });
            if (port)
                endPoint = mapPoint(toInner, layer, Number(port.x), Number(port.y));
        }
        const fromCenter = { x: fromBounds.centerX, y: fromBounds.centerY };
        const toCenter = { x: toBounds.centerX, y: toBounds.centerY };
        if (!startPoint)
            startPoint = self.getEdgeConnectionPoint(fromBounds, toCenter);
        if (!endPoint)
            endPoint = self.getEdgeConnectionPoint(toBounds, fromCenter);
        if (!finitePoint(startPoint) || !finitePoint(endPoint))
            return markPending();
        const pathData = self.createOrthogonalPath(startPoint, endPoint);
        if (!pathData || /NaN|Infinity|undefined/.test(pathData))
            return markPending();
        line.setAttribute('d', pathData);
        line.setAttribute('data-from-port', connection.fromPort || 'auto');
        line.setAttribute('data-to-port', connection.toPort || 'auto');
        line.setAttribute(
            'marker-end',
            connection.type === 'pipe' ? 'url(#arrowhead)' : 'url(#arrowhead-open)'
        );
        line.setAttribute('data-render-state', 'ready');
        return true;
    };
    self.getEdgeConnectionPoint = function (bounds, targetCenter) {
        const centerX = bounds.centerX;
        const centerY = bounds.centerY;
        // Richtungsvektor zum Ziel
        const dx = targetCenter.x - centerX;
        const dy = targetCenter.y - centerY;
        // Verhältnis berechnen
        const halfWidth = bounds.width / 2;
        const halfHeight = bounds.height / 2;
        // V52-Fix (B-5): Bei exakt horizontal oder vertikal ausgerichteten
        // Elementen ist dx bzw. dy genau 0 — die Division lieferte Infinity
        // bzw. NaN, das Pfad-Attribut wurde zu "M NaN,NaN …" und die
        // Verbindung verschwand. Gleiches galt fuer degenerierte BBoxen
        // (halfWidth/halfHeight = 0) direkt nach dem Einfuegen.
        const EPS = 1e-6;
        const safeHalfWidth = Math.max(halfWidth, EPS);
        const safeHalfHeight = Math.max(halfHeight, EPS);
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx < EPS && absDy < EPS) {
            // Deckungsgleiche Mittelpunkte: rechte Kante als stabile Vorgabe.
            return { x: centerX + safeHalfWidth, y: centerY };
        }
        const ratioX = absDx / safeHalfWidth;
        const ratioY = absDy / safeHalfHeight;
        let connectionX, connectionY;
        if (ratioX > ratioY) {
            // Verbindung an linker oder rechter Kante
            connectionX = centerX + (dx > 0 ? safeHalfWidth : -safeHalfWidth);
            connectionY = centerY + (dy * safeHalfWidth / Math.max(absDx, EPS));
        }
        else {
            // Verbindung an oberer oder unterer Kante
            connectionX = centerX + (dx * safeHalfHeight / Math.max(absDy, EPS));
            connectionY = centerY + (dy > 0 ? safeHalfHeight : -safeHalfHeight);
        }
        if (!Number.isFinite(connectionX) || !Number.isFinite(connectionY)) {
            return { x: centerX, y: centerY };
        }
        return {
            x: connectionX,
            y: connectionY
        };
    };
    self.createOrthogonalPath = function (from, to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        // Einfaches orthogonales Routing
        if (Math.abs(dx) > Math.abs(dy)) {
            // Horizontal bevorzugt
            const midX = from.x + dx / 2;
            return `M ${from.x},${from.y} L ${midX},${from.y} L ${midX},${to.y} L ${to.x},${to.y}`;
        }
        else {
            // Vertikal bevorzugt
            const midY = from.y + dy / 2;
            return `M ${from.x},${from.y} L ${from.x},${midY} L ${to.x},${midY} L ${to.x},${to.y}`;
        }
    };
    self.createDirectPath = function (from, to) {
        // Direkte Linie
        return `M ${from.x},${from.y} L ${to.x},${to.y}`;
    };
    self.updateConnectedLines = function (elementId) {
        let pending = false;
        self.connections.forEach(function (item) {
            if (item.data.from === elementId || item.data.to === elementId) {
                if (!self.updateConnectionPath(item.element, item.data))
                    pending = true;
            }
        });
        if (pending)
            self.scheduleLayoutRefresh('element_updated', { maxAttempts: 16 });
    };
    self.removeConnection = function (connectionId) {
        const item = self.connections.get(connectionId);
        if (!item)
            return;
        // Vom DOM entfernen
        item.element.remove();
        // Aus Map entfernen
        self.connections.delete(connectionId);
        // Aus State entfernen
        const stateConnections = state.get('connections').filter(function (conn) {
            return conn.id !== connectionId;
        });
        state.set('connections', stateConnections);
        state.saveHistory();
        state.emit('connection:removed', connectionId);
    };
    self.removeConnectionsByElement = function (elementId) {
        const toRemove = [];
        self.connections.forEach(function (item, connId) {
            if (item.data.from === elementId || item.data.to === elementId) {
                toRemove.push(connId);
            }
        });
        toRemove.forEach(function (connId) {
            self.removeConnection(connId);
        });
    };
    self.selectConnection = function (connectionId) {
        // Alte Selektion entfernen
        self.connections.forEach(function (item) {
            item.element.classList.remove('selected');
        });
        // Neue Selektion
        const item = self.connections.get(connectionId);
        if (item) {
            item.element.classList.add('selected');
            state.emit('connection:selected', item.data);
        }
    };
    self.getConnections = function () {
        return Array.from(self.connections.values());
    };
    self.getConnectionsByElement = function (elementId) {
        const results = [];
        self.connections.forEach(function (item) {
            if (item.data.from === elementId || item.data.to === elementId) {
                results.push(item.data);
            }
        });
        return results;
    };
    self.rebuildFromState = function (options) {
        const opts = options && typeof options === 'object' ? options : {};
        self.cancelLayoutRefresh();
        self.connectionsLayer.innerHTML = '';
        self.connections.clear();
        const sourceConnections = Array.isArray(state.get('connections'))
            ? state.get('connections') : [];
        const findElement = function (elementId) {
            const item = elementManager.getElement(elementId);
            return item ? item.data : null;
        };
        const normalizedConnections = sourceConnections.map(function (connData) {
            return normalizeConnection(connData, findElement);
        });
        normalizedConnections.forEach(function (connData) {
            const line = self.createConnectionLine(connData, { deferPath: true });
            self.connectionsLayer.appendChild(line);
            self.connections.set(connData.id, {
                data: connData,
                element: line
            });
        });
        state.set('connections', normalizedConnections);
        state.emit('connections:rebuilt', normalizedConnections);
        self.scheduleLayoutRefresh(opts.reason || 'connections_rebuilt');
    };
    self.generateConnectionId = function () {
        return 'conn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };
    self.clear = function () {
        self.connections.forEach(function (item) {
            item.element.remove();
        });
        self.connections.clear();
        state.set('connections', []);
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.connectionsLayer = document.getElementById('connections-layer');
    self.connections = new Map();
    self.layoutEpoch = 0;
    self.layoutTimer = null;
    self.layoutFrame = null;
    self.connectionTypes = {
        'pipe': {
            label: 'Rohrleitung',
            stroke: 'var(--pid-process-line, #0891b2)',
            strokeWidth: 2.4,
            dashArray: null
        },
        'signal': {
            label: 'Signal',
            stroke: 'var(--pid-signal-line, #64748b)',
            strokeWidth: 1.6,
            dashArray: '5,5'
        },
        'data': {
            label: 'Daten',
            stroke: 'var(--pid-data-line, #7c3aed)',
            strokeWidth: 1.6,
            dashArray: '10,5'
        },
        'power': {
            label: 'Energie',
            stroke: 'var(--pid-power-line, #d97706)',
            strokeWidth: 1.8,
            dashArray: '3,3'
        }
    };
    self.init();
    return self;
}
// ============================================================================
// Connection-UI-Controller
// ============================================================================
function createConnectionUIController(connectionManager) {
    const self = {};
    self.escapeMarkup = function (value) {
        return String(value == null ? '' : value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    };
    self.elementLabel = function (item) {
        if (!item || !item.data)
            return '';
        const data = item.data;
        const primary = data.tag || data.name || data.id;
        const secondary = data.name && data.name !== primary ? ' · ' + data.name : '';
        return String(primary || data.id) + secondary;
    };
    self.init = function () {
        state.on('selection:changed', function (selectedIds) {
            self.updateConnectionsPanel(selectedIds);
        });
        state.on('connection:created', function () {
            self.updateStats();
            self.updateConnectionsPanel(state.get('selectedElements') || []);
        });
        state.on('connection:updated', function () {
            self.updateConnectionsPanel(state.get('selectedElements') || []);
        });
        state.on('connection:removed', function () {
            self.updateStats();
            self.updateConnectionsPanel(state.get('selectedElements') || []);
        });
        state.on('connections:rebuilt', function () {
            self.updateStats();
            self.updateConnectionsPanel(state.get('selectedElements') || []);
        });
        if (self.connectionsPanel) {
            self.connectionsPanel.addEventListener('click', function (event) {
                const button = event.target.closest('[data-connection-action]');
                if (!button)
                    return;
                const action = button.dataset.connectionAction;
                const connectionId = button.dataset.connectionId || '';
                const elementId = button.dataset.elementId || '';
                if (action === 'edit' && connectionId)
                    self.showEditConnectionDialog(connectionId);
                else if (action === 'remove' && connectionId)
                    self.confirmRemoveConnection(connectionId);
                else if (action === 'create' && elementId)
                    self.showCreateConnectionDialog(elementId);
            });
        }
        window.editConnection = self.showEditConnectionDialog;
        window.removeConnection = self.confirmRemoveConnection;
        console.log('✓ Connection-UI-Controller initialisiert');
    };
    self.confirmRemoveConnection = function (connectionId) {
        const item = self.connectionManager.connections.get(connectionId);
        if (!item)
            return;
        const typeLabel = self.connectionManager.connectionTypes[item.data.type]?.label || item.data.type;
        showConfirmation('Die Verbindung „' + typeLabel + '“ dauerhaft entfernen?', {
            title: 'Verbindung löschen',
            confirmLabel: 'Verbindung löschen',
            cancelLabel: 'Abbrechen',
            destructive: true,
            detail: String(item.data.from) + ' → ' + String(item.data.to)
        }, function () {
            self.connectionManager.removeConnection(connectionId);
        });
    };
    self.updateConnectionsPanel = function (selectedIds) {
        if (!self.connectionsPanel)
            return;
        if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
            self.connectionsPanel.innerHTML = '<div class="hint-text">Kein Element ausgewählt</div>';
            return;
        }
        const elementId = selectedIds[0];
        const connections = self.connectionManager.getConnectionsByElement(elementId);
        let html = '<div class="connection-list">';
        if (connections.length === 0)
            html += '<div class="hint-text">Keine Verbindungen</div>';
        connections.forEach(function (connection) {
            const isFrom = connection.from === elementId;
            const otherElementId = isFrom ? connection.to : connection.from;
            const typeLabel = self.connectionManager.connectionTypes[connection.type]?.label || connection.type;
            const direction = isFrom ? '→' : '←';
            html += '<div class="connection-item" data-connection-card="' + self.escapeMarkup(connection.id) + '">'
                + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
                + '<span>' + direction + ' ' + self.escapeMarkup(typeLabel) + '</span>'
                + '<div style="display:flex;gap:4px;">'
                + '<button type="button" class="btn-icon" data-connection-action="edit" data-connection-id="'
                + self.escapeMarkup(connection.id) + '" title="Verbindung bearbeiten" aria-label="Verbindung bearbeiten">'
                + '<svg class="ico" aria-hidden="true"><use href="#ico-properties"></use></svg></button>'
                + '<button type="button" class="btn-icon" data-connection-action="remove" data-connection-id="'
                + self.escapeMarkup(connection.id) + '" title="Verbindung entfernen" aria-label="Verbindung entfernen">'
                + '<svg class="ico" aria-hidden="true"><use href="#ico-trash"></use></svg></button>'
                + '</div></div>'
                + '<div class="text-muted" style="font-size:11px;margin-top:4px;overflow-wrap:anywhere;">'
                + self.escapeMarkup(otherElementId) + '</div></div>';
        });
        html += '</div><button type="button" class="btn btn-small btn-primary" '
            + 'data-connection-action="create" data-element-id="' + self.escapeMarkup(elementId)
            + '" style="margin-top:8px;">+ Neue Verbindung</button>';
        self.connectionsPanel.innerHTML = html;
    };
    self.fillElementOptions = function (select, selectedId, excludedId) {
        if (!select)
            return;
        select.innerHTML = '';
        elementManager.getAllElements().forEach(function (item) {
            if (excludedId && item.data.id === excludedId)
                return;
            const option = document.createElement('option');
            option.value = item.data.id;
            option.textContent = self.elementLabel(item) + ' (' + item.data.id + ')';
            option.selected = item.data.id === selectedId;
            select.appendChild(option);
        });
    };
    self.fillPortOptions = function (select, elementId, connectionType, endpointRole, selectedId) {
        if (!select)
            return;
        select.innerHTML = '';
        const automatic = document.createElement('option');
        automatic.value = '';
        automatic.textContent = 'Automatisch passenden Port wählen';
        select.appendChild(automatic);
        elementManager.listPorts(elementId).filter(function (port) {
            return portAcceptsConnection(port, connectionType, endpointRole)
                && portDirectionAccepts(port, endpointRole);
        }).forEach(function (port) {
            const option = document.createElement('option');
            option.value = port.id;
            option.textContent = (port.name || port.id) + ' · ' + port.kind + ' · ' + port.direction;
            option.selected = port.id === selectedId;
            select.appendChild(option);
        });
        if (!Array.from(select.options).some(function (option) {
            return option.value === String(selectedId || '');
        }))
            select.value = '';
    };
    self.anchorText = function (anchor, fallbackPort) {
        if (anchor && anchor.mode === 'fixed')
            return 'manueller Fixpunkt';
        if (fallbackPort)
            return 'Port ' + fallbackPort;
        return 'automatische Portwahl';
    };
    self.showEditConnectionDialog = function (connectionId) {
        const item = self.connectionManager.connections.get(connectionId);
        const modal = document.getElementById('modal-verbindung-bearbeiten');
        if (!item || !modal)
            return;
        const data = item.data;
        const draft = {
            from: data.from,
            to: data.to,
            type: data.type,
            fromPort: data.fromPort || null,
            toPort: data.toPort || null,
            fromAnchor: data.fromAnchor ? Object.assign({}, data.fromAnchor) : { mode: 'auto' },
            toAnchor: data.toAnchor ? Object.assign({}, data.toAnchor) : { mode: 'auto' },
            strokeWidth: Number(data.strokeWidth) || 2,
            label: String(data.label || '')
        };
        const fromSummary = modal.querySelector('#edit-von');
        const fromSelect = modal.querySelector('#edit-von-select');
        const toSelect = modal.querySelector('#edit-nach');
        const typeSelect = modal.querySelector('#edit-typ');
        const fromPortSelect = modal.querySelector('#edit-von-port');
        const toPortSelect = modal.querySelector('#edit-nach-port');
        const labelInput = modal.querySelector('#edit-label');
        const widthInput = modal.querySelector('#edit-breite');
        const validation = modal.querySelector('#edit-connection-validation');
        const fromAnchorStatus = modal.querySelector('#edit-from-anchor-status');
        const toAnchorStatus = modal.querySelector('#edit-to-anchor-status');
        const pickFrom = modal.querySelector('#btn-pick-from');
        const pickTo = modal.querySelector('#btn-pick-to');
        const resetAnchors = modal.querySelector('#btn-reset-anchors');
        const save = modal.querySelector('#btn-edit-conn-save');
        const cancel = modal.querySelector('#btn-edit-conn-cancel');
        const close = modal.querySelector('.modal-close');
        modal.dataset.connectionId = connectionId;
        if (typeSelect)
            typeSelect.value = draft.type;
        if (labelInput)
            labelInput.value = draft.label;
        if (widthInput)
            widthInput.value = String(draft.strokeWidth);
        function renderEndpointOptions() {
            self.fillElementOptions(fromSelect, draft.from, draft.to);
            self.fillElementOptions(toSelect, draft.to, draft.from);
            if (fromSummary)
                fromSummary.textContent = draft.from + ' → ' + draft.to;
        }
        function renderPorts() {
            self.fillPortOptions(fromPortSelect, draft.from, draft.type, 'from', draft.fromPort);
            self.fillPortOptions(toPortSelect, draft.to, draft.type, 'to', draft.toPort);
            if (fromAnchorStatus)
                fromAnchorStatus.textContent = 'Start: ' + self.anchorText(draft.fromAnchor, draft.fromPort);
            if (toAnchorStatus)
                toAnchorStatus.textContent = 'Ziel: ' + self.anchorText(draft.toAnchor, draft.toPort);
        }
        function clearValidation() {
            if (validation)
                validation.textContent = 'Änderungen werden erst mit „Speichern“ in das Projekt übernommen.';
        }
        function resetSemanticAnchors() {
            draft.fromPort = null;
            draft.toPort = null;
            draft.fromAnchor = { mode: 'auto' };
            draft.toAnchor = { mode: 'auto' };
            renderPorts();
        }
        function closeEditor() {
            closeModalElement(modal);
        }
        function updateDraftEndpoints() {
            draft.from = fromSelect ? fromSelect.value : draft.from;
            draft.to = toSelect ? toSelect.value : draft.to;
            renderEndpointOptions();
            resetSemanticAnchors();
            clearValidation();
        }
        if (fromSelect)
            fromSelect.onchange = updateDraftEndpoints;
        if (toSelect)
            toSelect.onchange = updateDraftEndpoints;
        if (typeSelect) {
            typeSelect.onchange = function () {
                draft.type = typeSelect.value;
                resetSemanticAnchors();
                clearValidation();
            };
        }
        if (fromPortSelect) {
            fromPortSelect.onchange = function () {
                draft.fromPort = fromPortSelect.value || null;
                draft.fromAnchor = draft.fromPort
                    ? { mode: 'port', portId: draft.fromPort } : { mode: 'auto' };
                renderPorts();
            };
        }
        if (toPortSelect) {
            toPortSelect.onchange = function () {
                draft.toPort = toPortSelect.value || null;
                draft.toAnchor = draft.toPort
                    ? { mode: 'port', portId: draft.toPort } : { mode: 'auto' };
                renderPorts();
            };
        }
        if (resetAnchors) {
            resetAnchors.onclick = function () {
                resetSemanticAnchors();
                clearValidation();
            };
        }
        function beginDraftAnchor(side) {
            closeModalElement(modal, { restoreFocus: false });
            self.beginAnchorPick(draft, side, function (anchor) {
                if (anchor) {
                    if (side === 'from') {
                        draft.fromAnchor = anchor;
                        draft.fromPort = null;
                    }
                    else {
                        draft.toAnchor = anchor;
                        draft.toPort = null;
                    }
                }
                renderPorts();
                openModalElement(modal, { captureFocus: false });
            });
        }
        if (pickFrom)
            pickFrom.onclick = function () { beginDraftAnchor('from'); };
        if (pickTo)
            pickTo.onclick = function () { beginDraftAnchor('to'); };
        if (save) {
            save.dataset.dialogPrimary = 'true';
            save.onclick = function () {
                const width = Number(widthInput ? widthInput.value : draft.strokeWidth);
                const result = self.connectionManager.updateConnection(connectionId, {
                    from: fromSelect ? fromSelect.value : draft.from,
                    to: toSelect ? toSelect.value : draft.to,
                    type: typeSelect ? typeSelect.value : draft.type,
                    fromPort: fromPortSelect ? (fromPortSelect.value || null) : draft.fromPort,
                    toPort: toPortSelect ? (toPortSelect.value || null) : draft.toPort,
                    fromAnchor: draft.fromAnchor,
                    toAnchor: draft.toAnchor,
                    strokeWidth: Number.isFinite(width) ? width : draft.strokeWidth,
                    label: labelInput ? labelInput.value : draft.label
                });
                if (result) {
                    closeEditor();
                    return;
                }
                if (validation)
                    validation.textContent = 'Die Änderung wurde nicht übernommen. Prüfe Objekte, Porttypen und Port-Richtungen.';
            };
        }
        if (cancel)
            cancel.onclick = closeEditor;
        if (close)
            close.onclick = closeEditor;
        renderEndpointOptions();
        renderPorts();
        clearValidation();
        openModalElement(modal);
    };
    self.beginAnchorPick = function (draft, side, onDone) {
        const svg = document.getElementById('main-canvas');
        const elementId = side === 'from' ? draft.from : draft.to;
        const elementItem = elementManager.getElement(elementId);
        if (!svg || !elementItem) {
            if (typeof onDone === 'function')
                onDone(null);
            return;
        }
        const content = elementItem.element.querySelector(':scope > g.svg-element-content') || elementItem.element;
        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        handle.setAttribute('r', '6');
        handle.setAttribute('class', 'anchor-handle');
        handle.setAttribute('pointer-events', 'none');
        svg.appendChild(handle);
        let completed = false;
        function cleanup(anchor) {
            if (completed)
                return;
            completed = true;
            svg.removeEventListener('pointermove', onMove, true);
            svg.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKey, true);
            handle.remove();
            if (typeof onDone === 'function')
                onDone(anchor || null);
        }
        function onMove(event) {
            const point = utils.getSVGCoordinates(svg, event);
            handle.setAttribute('cx', point.x);
            handle.setAttribute('cy', point.y);
        }
        function onClick(event) {
            event.preventDefault();
            event.stopPropagation();
            const point = utils.getSVGCoordinates(svg, event);
            const ctm = content.getCTM && content.getCTM();
            if (!ctm || !content.ownerSVGElement || !content.ownerSVGElement.createSVGPoint) {
                cleanup(null);
                return;
            }
            const svgPoint = content.ownerSVGElement.createSVGPoint();
            svgPoint.x = point.x;
            svgPoint.y = point.y;
            const local = svgPoint.matrixTransform(ctm.inverse());
            cleanup({ mode: 'fixed', x: local.x, y: local.y });
        }
        function onKey(event) {
            if (event.key !== 'Escape')
                return;
            event.preventDefault();
            event.stopPropagation();
            cleanup(null);
        }
        svg.addEventListener('pointermove', onMove, true);
        svg.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKey, true);
    };
    self.showCreateConnectionDialog = function (fromElementId) {
        const modal = document.getElementById('modal-verbindung-erstellen');
        if (!modal)
            return;
        const fromInfo = document.getElementById('verbindung-von');
        const body = modal.querySelector('.modal-body');
        const toSelect = document.getElementById('verbindung-nach');
        const typeSelect = document.getElementById('verbindung-typ');
        if (fromInfo)
            fromInfo.textContent = fromElementId;
        let fromPortGroup = body.querySelector('#group-von-port');
        if (!fromPortGroup) {
            fromPortGroup = document.createElement('div');
            fromPortGroup.className = 'form-group';
            fromPortGroup.id = 'group-von-port';
            fromPortGroup.innerHTML = '<label for="verbindung-von-port">Startport</label>'
                + '<select id="verbindung-von-port" class="select-input"></select>';
            body.appendChild(fromPortGroup);
        }
        let toPortGroup = body.querySelector('#group-nach-port');
        if (!toPortGroup) {
            toPortGroup = document.createElement('div');
            toPortGroup.className = 'form-group';
            toPortGroup.id = 'group-nach-port';
            toPortGroup.innerHTML = '<label for="verbindung-nach-port">Zielport</label>'
                + '<select id="verbindung-nach-port" class="select-input"></select>';
            body.appendChild(toPortGroup);
        }
        if (toSelect) {
            toSelect.innerHTML = '<option value="">Element auswählen…</option>';
            elementManager.getAllElements().forEach(function (item) {
                if (item.data.id === fromElementId)
                    return;
                const option = document.createElement('option');
                option.value = item.data.id;
                option.textContent = self.elementLabel(item) + ' (' + item.data.id + ')';
                toSelect.appendChild(option);
            });
        }
        function refreshPorts() {
            const type = typeSelect ? typeSelect.value : 'pipe';
            self.fillPortOptions(
                document.getElementById('verbindung-von-port'),
                fromElementId,
                type,
                'from',
                null
            );
            const toId = toSelect ? toSelect.value : '';
            self.fillPortOptions(
                document.getElementById('verbindung-nach-port'),
                toId,
                type,
                'to',
                null
            );
        }
        if (toSelect)
            toSelect.onchange = refreshPorts;
        if (typeSelect)
            typeSelect.onchange = refreshPorts;
        const closeButton = modal.querySelector('.modal-close');
        const cancelButton = modal.querySelector('.modal-cancel');
        const confirmButton = document.getElementById('btn-verbindung-confirm');
        function closeDialog() {
            closeModalElement(modal);
        }
        if (closeButton)
            closeButton.onclick = closeDialog;
        if (cancelButton)
            cancelButton.onclick = closeDialog;
        if (confirmButton) {
            confirmButton.dataset.dialogPrimary = 'true';
            confirmButton.onclick = function () {
                const connectionId = self.createConnection(fromElementId);
                if (connectionId)
                    closeDialog();
            };
        }
        refreshPorts();
        openModalElement(modal);
    };
    self.createConnection = function (fromElementId) {
        const toSelect = document.getElementById('verbindung-nach');
        const typeSelect = document.getElementById('verbindung-typ');
        const fromPortSelect = document.getElementById('verbindung-von-port');
        const toPortSelect = document.getElementById('verbindung-nach-port');
        if (!toSelect || !typeSelect)
            return null;
        const toElementId = toSelect.value;
        if (!toElementId) {
            showNotice('Bitte wähle zuerst ein Zielobjekt aus.', {
                title: 'Zielobjekt fehlt'
            });
            return null;
        }
        return self.connectionManager.createConnection(fromElementId, toElementId, typeSelect.value, {
            fromPort: fromPortSelect ? (fromPortSelect.value || null) : null,
            toPort: toPortSelect ? (toPortSelect.value || null) : null
        });
    };
    self.updateStats = function () {
        const countDisplay = document.getElementById('connection-count');
        if (countDisplay) {
            const count = self.connectionManager.getConnections().length;
            countDisplay.textContent = `${count} Verbindung${count !== 1 ? 'en' : ''}`;
        }
    };
    // --- Konstruktorkörper (läuft nach der Methodenbindung) ---
    self.connectionManager = connectionManager;
    self.connectionsPanel = document.getElementById('connections-panel');
    self.init();
    return self;
}
// ============================================================================
// Globale Instanzen
// ============================================================================
export const connectionManager = createConnectionManager();
export const connectionUI = createConnectionUIController(connectionManager);
console.log('✓ Connection-Mapper-Modul geladen');
