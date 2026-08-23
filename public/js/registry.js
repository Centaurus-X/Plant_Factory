/**
 * registry.js - Normalized template registry and symbol palette.
 *
 * PF-PID-V1 process symbols are the default engineering library. Legacy and
 * custom assets remain available through explicit filters. HMI controls stay
 * in the HMI designer and are never created by dropping a process symbol.
 */
import { api, state, showStatus, handleError } from './core.js';
import {
    TEMPLATE_SCOPE_ALL,
    TEMPLATE_SCOPE_CUSTOM,
    TEMPLATE_SCOPE_HMI,
    TEMPLATE_SCOPE_LEGACY,
    TEMPLATE_SCOPE_STANDARD,
    compareTemplates,
    isCanonicalProcessTemplate,
    matchesTemplateScope,
    normalizeInstance,
    normalizeTemplate,
    templateBadge,
    templateScope
} from './pid_standard.js';

function createTemplateRegistry() {
    const self = {};

    self.init = async function () {
        try {
            await self.loadTemplates();
            self.isLoaded = true;
            console.log('✓ Template-Registry initialisiert');
        }
        catch (error) {
            handleError(error, 'Fehler beim Laden der Templates');
        }
    };

    self.loadTemplates = async function () {
        try {
            const response = await api.getTemplates();
            if (!response || !response.templates)
                return;
            self.manifest = response.manifest && typeof response.manifest === 'object'
                ? response.manifest : {};
            self.objectStandard = response.object_standard && typeof response.object_standard === 'object'
                ? response.object_standard : {};
            self.categoryOrder = Array.isArray(self.manifest.category_order)
                ? self.manifest.category_order.slice() : [];
            self.templates.clear();
            self.kategorien.clear();
            Object.values(response.templates).forEach(function (rawTemplate) {
                const template = normalizeTemplate(rawTemplate);
                self.templates.set(template.id, template);
                if (!self.kategorien.has(template.kategorie))
                    self.kategorien.set(template.kategorie, []);
                self.kategorien.get(template.kategorie).push(template.id);
            });
            self.kategorien.forEach(function (templateIds) {
                templateIds.sort(function (leftId, rightId) {
                    return compareTemplates(self.templates.get(leftId), self.templates.get(rightId));
                });
            });
            self.buildSearchIndex();
            state.emit('templates:loaded', {
                count: self.templates.size,
                standardCount: self.getStandardTemplates().length,
                kategorien: self.kategorien.size
            });
            showStatus(self.getStandardTemplates().length + ' P&ID-V1-Symbole bereit', 'success');
        }
        catch (error) {
            throw new Error('Template-Laden fehlgeschlagen: ' + error.message);
        }
    };

    self.reloadTemplates = async function () {
        try {
            await api.reloadTemplates();
            await self.loadTemplates();
            state.emit('templates:reloaded');
        }
        catch (error) {
            handleError(error, 'Fehler beim Neuladen der Templates');
        }
    };

    self.buildSearchIndex = function () {
        self.searchIndex.clear();
        self.templates.forEach(function (template, id) {
            const aliases = Array.isArray(template.aliases) ? template.aliases.join(' ') : '';
            const searchText = [
                template.name,
                template.id,
                template.kategorie,
                template.symbol_type,
                template.standard,
                aliases
            ].join(' ').toLowerCase();
            self.searchIndex.set(id, searchText);
        });
    };

    self.getTemplate = function (id) {
        return self.templates.get(id);
    };

    self.getAllTemplates = function () {
        return Array.from(self.templates.values()).sort(compareTemplates);
    };

    self.getStandardTemplates = function () {
        return self.getAllTemplates().filter(isCanonicalProcessTemplate);
    };

    self.getTemplatesByKategorie = function (kategorie) {
        const templateIds = self.kategorien.get(kategorie) || [];
        return templateIds.map(function (id) {
            return self.templates.get(id);
        }).filter(Boolean).sort(compareTemplates);
    };

    self.getAllKategorien = function () {
        return Array.from(self.kategorien.keys()).sort(self.compareCategories);
    };

    self.compareCategories = function (left, right) {
        const leftIndex = self.categoryOrder.indexOf(left);
        const rightIndex = self.categoryOrder.indexOf(right);
        if (leftIndex !== -1 || rightIndex !== -1) {
            if (leftIndex === -1)
                return 1;
            if (rightIndex === -1)
                return -1;
            if (leftIndex !== rightIndex)
                return leftIndex - rightIndex;
        }
        return String(left).localeCompare(String(right), 'de');
    };

    self.searchTemplates = function (query) {
        const searchTerm = String(query || '').trim().toLowerCase();
        if (!searchTerm)
            return self.getAllTemplates();
        const results = [];
        self.searchIndex.forEach(function (searchText, id) {
            if (searchText.includes(searchTerm)) {
                const template = self.templates.get(id);
                if (template)
                    results.push(template);
            }
        });
        return results.sort(compareTemplates);
    };

    self.filterTemplates = function (scope, searchQuery) {
        const selectedScope = String(scope || TEMPLATE_SCOPE_STANDARD);
        const searchTerm = String(searchQuery || '').trim().toLowerCase();
        return self.getAllTemplates().filter(function (template) {
            if (!matchesTemplateScope(template, selectedScope))
                return false;
            if (!searchTerm)
                return true;
            return (self.searchIndex.get(template.id) || '').includes(searchTerm);
        });
    };

    self.uploadTemplate = async function (file, metadaten) {
        try {
            const svgContent = await self.readFileAsText(file);
            const metadata = {
                ...(metadaten || {}),
                library_role: 'custom',
                standard: 'CUSTOM',
                default_visible: false,
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
            const response = await api.uploadTemplate(file.name, svgContent, metadata);
            if (!response.erfolg)
                throw new Error(response.fehler || 'Upload fehlgeschlagen');
            await self.reloadTemplates();
            showStatus('Template "' + file.name + '" hochgeladen', 'success');
            return response;
        }
        catch (error) {
            handleError(error, 'Fehler beim Template-Upload');
            throw error;
        }
    };

    self.readFileAsText = function (file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function (event) {
                resolve(event.target.result);
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    };

    self.createTemplateInstance = function (templateId, x, y) {
        const template = self.getTemplate(templateId);
        if (!template)
            throw new Error('Template ' + templateId + ' nicht gefunden');
        const source = {
            id: self.generateInstanceId(),
            templateId: template.id,
            x: Number(x) || 0,
            y: Number(y) || 0,
            width: template.breite,
            height: template.hoehe,
            rotation: 0,
            scale: 1,
            pivotMode: 'center',
            properties: {},
            bindings: template.bindings,
            ports: template.ports
        };
        return normalizeInstance(source, template, state.get('elements'));
    };

    self.generateInstanceId = function () {
        return 'inst_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };

    self.templates = new Map();
    self.kategorien = new Map();
    self.searchIndex = new Map();
    self.manifest = {};
    self.objectStandard = {};
    self.categoryOrder = [];
    self.isLoaded = false;
    return self;
}

function appendOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
}

function createTemplatePaletteController(registry) {
    const self = {};

    self.init = function () {
        if (self.searchInput) {
            self.searchInput.addEventListener('input', function (event) {
                self.currentSearch = event.target.value;
                self.updateDisplay();
            });
        }
        if (self.kategorieFilter) {
            self.kategorieFilter.addEventListener('change', function (event) {
                self.currentScope = event.target.value || TEMPLATE_SCOPE_STANDARD;
                self.updateDisplay();
            });
        }
        const reloadButton = document.getElementById('btn-templates-neu-laden');
        if (reloadButton) {
            reloadButton.addEventListener('click', function () {
                self.registry.reloadTemplates();
            });
        }
        const uploadButton = document.getElementById('btn-template-hochladen');
        if (uploadButton) {
            uploadButton.addEventListener('click', function () {
                self.showUploadDialog();
            });
        }
        state.on('templates:loaded', function () {
            self.updateDisplay();
        });
        state.on('templates:reloaded', function () {
            self.updateDisplay();
        });
    };

    self.updateDisplay = function () {
        self.populateKategorieFilter();
        self.renderTemplates();
    };

    self.populateKategorieFilter = function () {
        if (!self.kategorieFilter)
            return;
        const currentValue = self.currentScope || TEMPLATE_SCOPE_STANDARD;
        const categories = self.registry.getAllKategorien().filter(function (category) {
            return self.registry.getTemplatesByKategorie(category).some(isCanonicalProcessTemplate);
        });
        self.kategorieFilter.innerHTML = '';
        appendOption(self.kategorieFilter, TEMPLATE_SCOPE_STANDARD, 'P&ID V1 · Standard');
        categories.forEach(function (category) {
            appendOption(self.kategorieFilter, category, category);
        });
        appendOption(self.kategorieFilter, TEMPLATE_SCOPE_ALL, 'Alle Bibliotheken');
        appendOption(self.kategorieFilter, TEMPLATE_SCOPE_LEGACY, 'Legacy-Symbole');
        if (self.registry.getAllTemplates().some(function (template) {
            return templateScope(template) === TEMPLATE_SCOPE_HMI;
        })) {
            appendOption(self.kategorieFilter, TEMPLATE_SCOPE_HMI, 'HMI optional');
        }
        appendOption(self.kategorieFilter, TEMPLATE_SCOPE_CUSTOM, 'Eigene Symbole');
        const hasCurrentValue = Array.from(self.kategorieFilter.options).some(function (option) {
            return option.value === currentValue;
        });
        self.kategorieFilter.value = hasCurrentValue ? currentValue : TEMPLATE_SCOPE_STANDARD;
        self.currentScope = self.kategorieFilter.value;
    };

    self.renderTemplates = function () {
        if (!self.paletteElement)
            return;
        const templates = self.registry.filterTemplates(self.currentScope, self.currentSearch);
        self.paletteElement.innerHTML = '';
        const count = document.getElementById('template-count');
        if (count)
            count.textContent = String(templates.length);
        if (templates.length === 0) {
            self.paletteElement.innerHTML = '<div class="no-selection" style="padding: 2rem;">Keine Templates gefunden</div>';
            return;
        }
        const defaultStandardView = self.currentScope === TEMPLATE_SCOPE_STANDARD
            && !String(self.currentSearch || '').trim();
        let remaining = templates.slice();
        if (defaultStandardView) {
            const favorites = remaining.filter(function (template) {
                return template.favorite === true;
            });
            if (favorites.length > 0) {
                self.paletteElement.appendChild(self.createCategorySection(
                    'Favoriten', favorites, { favorite: true }
                ));
                const favoriteIds = new Set(favorites.map(function (template) {
                    return template.id;
                }));
                remaining = remaining.filter(function (template) {
                    return !favoriteIds.has(template.id);
                });
            }
        }
        const grouped = {};
        remaining.forEach(function (template) {
            const category = template.kategorie || 'Sonstige';
            if (!grouped[category])
                grouped[category] = [];
            grouped[category].push(template);
        });
        Object.keys(grouped).sort(self.registry.compareCategories).forEach(function (category) {
            self.paletteElement.appendChild(self.createCategorySection(
                category, grouped[category], { favorite: false }
            ));
        });
    };

    self.createCategorySection = function (title, items, options) {
        const settings = options || {};
        const category = document.createElement('div');
        category.className = 'template-kategorie';
        if (settings.favorite)
            category.classList.add('template-kategorie--favorites');
        const heading = document.createElement('div');
        heading.className = 'kategorie-titel';
        const label = document.createElement('span');
        label.textContent = title;
        const count = document.createElement('span');
        count.className = 'kategorie-titel-count';
        count.textContent = items.length + (items.length === 1 ? ' Symbol' : ' Symbole');
        heading.appendChild(label);
        heading.appendChild(count);
        category.appendChild(heading);
        const grid = document.createElement('div');
        grid.className = 'template-grid';
        items.forEach(function (template) {
            grid.appendChild(self.createTemplateItem(template, settings));
        });
        category.appendChild(grid);
        return category;
    };

    self.createTemplateItem = function (template, options) {
        const settings = options || {};
        const structured = template.composition_mode === 'structured-assembly';
        const partCount = Math.max(0, Number(template.assembly_part_count) || 0);
        const item = document.createElement('div');
        item.className = 'template-item';
        item.draggable = true;
        item.dataset.templateId = template.id;
        item.dataset.standard = template.standard;
        item.dataset.libraryRole = template.library_role;
        item.dataset.compositionMode = structured ? 'structured-assembly' : 'flat';
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', structured
            ? template.name + ', editierbare Baugruppe mit ' + partCount + ' Einzelteilen einfügen'
            : template.name + ' einfügen');
        item.setAttribute('title', structured
            ? 'Ziehen oder mit Eingabe einfügen: alle Geräte bleiben einzeln editierbar.'
            : 'Ziehen oder mit Eingabe mittig einfügen');
        if (settings.favorite) {
            const favorite = document.createElement('span');
            favorite.className = 'favorite-template-marker';
            favorite.setAttribute('aria-hidden', 'true');
            favorite.innerHTML = '<svg class="ico"><use href="#ico-check"></use></svg>';
            item.appendChild(favorite);
        }
        const parser = new DOMParser();
        const svgDocument = parser.parseFromString(template.svg, 'image/svg+xml');
        const svgElement = svgDocument.documentElement;
        svgElement.setAttribute('width', '100%');
        svgElement.setAttribute('height', '100%');
        svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svgElement.setAttribute('aria-hidden', 'true');
        svgElement.setAttribute('focusable', 'false');
        item.appendChild(svgElement.cloneNode(true));
        const badge = document.createElement('span');
        badge.className = 'template-standard-badge';
        badge.textContent = structured ? 'Baugruppe · ' + partCount + ' Teile' : templateBadge(template);
        item.appendChild(badge);
        const name = document.createElement('span');
        name.className = 'template-name';
        name.textContent = template.name;
        item.appendChild(name);
        function handleDragStart(event) {
            event.dataTransfer.setData('templateId', template.id);
            event.dataTransfer.effectAllowed = 'copy';
        }
        function activateTemplate(event) {
            if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ')
                return;
            if (event.type === 'keydown')
                event.preventDefault();
            state.emit('template:activate', { templateId: template.id });
        }
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('click', activateTemplate);
        item.addEventListener('keydown', activateTemplate);
        return item;
    };

    self.showUploadDialog = function () {
        const modal = document.getElementById('modal-template-hochladen');
        if (!modal)
            return;
        modal.classList.remove('hidden');
        const closeButton = modal.querySelector('.modal-close');
        const cancelButton = modal.querySelector('.modal-cancel');
        const confirmButton = document.getElementById('btn-template-upload-confirm');
        function closeModal() {
            modal.classList.add('hidden');
        }
        if (closeButton)
            closeButton.onclick = closeModal;
        if (cancelButton)
            cancelButton.onclick = closeModal;
        if (confirmButton) {
            confirmButton.onclick = async function () {
                await self.handleUpload();
                closeModal();
            };
        }
    };

    self.handleUpload = async function () {
        const fileInput = document.getElementById('template-datei');
        const nameInput = document.getElementById('template-name');
        const categoryInput = document.getElementById('template-kategorie');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            showStatus('Bitte wählen Sie eine SVG-Datei aus', 'error');
            return;
        }
        const file = fileInput.files[0];
        const metadata = {
            name: nameInput.value || file.name.replace('.svg', ''),
            kategorie: categoryInput.value || 'Custom'
        };
        try {
            await self.registry.uploadTemplate(file, metadata);
            fileInput.value = '';
            nameInput.value = '';
            categoryInput.value = '';
            self.currentScope = TEMPLATE_SCOPE_CUSTOM;
            self.updateDisplay();
        }
        catch (error) {
            console.warn('Template upload rejected:', error.message);
        }
    };

    self.registry = registry;
    self.paletteElement = document.getElementById('template-palette');
    self.searchInput = document.getElementById('template-suche');
    self.kategorieFilter = document.getElementById('kategorie-filter');
    self.currentScope = TEMPLATE_SCOPE_STANDARD;
    self.currentSearch = '';
    self.init();
    return self;
}

export const templateRegistry = createTemplateRegistry();
export const templatePalette = createTemplatePaletteController(templateRegistry);
templateRegistry.init();
console.log('✓ Registry-Modul geladen');
