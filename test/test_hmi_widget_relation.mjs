#!/usr/bin/env node
/** Verify the static V63.3 explicit Widget/Object relation contract. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const root = path.dirname(path.dirname(currentFile));
const hmi = fs.readFileSync(path.join(root, 'public/js/hmi.js'), 'utf8');
const device = fs.readFileSync(path.join(root, 'public/js/device.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/v63_3.css'), 'utf8');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'public/svg_templates/library_manifest_v1.json'), 'utf8')
);
let passed = 0;

function check(condition, label) {
  assert.equal(Boolean(condition), true, label);
  passed += 1;
  console.log('   ok  ' + label);
}

check(hmi.includes('id="hmi-quick-element"'), 'Objektauswahl ist Teil der Widget-Erzeugung');
check(hmi.includes('addWidgetFromTemplate(model, templateId, elementId)'), 'Widget-Erzeugung akzeptiert eine Objekt-ID');
check(hmi.includes("commitHmiModel(next, 'add_widget_with_object_relation')"), 'Widget und Binding werden atomar gespeichert');
check(hmi.includes("origin: 'explicit'"), 'Widget-Ursprung bleibt explizit');
check(hmi.includes('auto_created: false'), 'Widget wird nicht automatisch aus dem P&ID-Drop erzeugt');
check(hmi.includes('defaultBindingForWidget(widget, targetElementId)'), 'Objektbezug erzeugt ein kanonisches Binding');
check(hmi.includes('inferSourceFromDeviceAssignment(elementId, widgetType)'), 'Device-Zuweisung speist die Datenquelle');
check(hmi.includes('primaryWidgetBinding(model, widget.widget_id, viewId)'), 'Widget-Tabelle liest die kanonische Binding-Relation');
check(hmi.includes('hmi-widget-relation-card'), 'Widget-Editor zeigt die Relation');
check(css.includes('.hmi-widget-table'), 'V63.3 enthält einen eigenen Widget-Tabellenvertrag');
check(css.includes('overflow-wrap: anywhere'), 'Lange Widgetwerte überlagern keine Nachbarfelder');
check(device.includes('assignmentsExpanded: false'), 'I/O-Register startet eingeklappt');
check(device.includes('device-assignment-actions'), 'I/O-Aktionen sind zusammengeführt');
check(manifest.template_count >= 26
    && manifest.template_count === Object.keys(manifest.templates || {}).length,
    'Symbolbibliothek enthält mindestens 26 Templates und ist intern konsistent');
check(Boolean(manifest.templates.Generic_Sensor_Entity), 'Generic_Sensor_Entity ist registriert');
check(manifest.templates.Generic_Sensor_Entity.kategorie === 'Messstellen', 'Generischer Sensor liegt in Messstellen');

console.log('V63.3 Widget/Object relation contract: ' + passed + ' checks passed.');
