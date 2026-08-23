#!/usr/bin/env node
/**
 * Build the deterministic V63.2 complete integration example.
 *
 * The example reuses the released PF-PID-V1 geometry and applies only the
 * V63.2 automation/logic overlay. This keeps the project auditable and avoids
 * a second hand-maintained copy of the plant geometry.
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const BASE_JSON = path.join(ROOT, 'projekte', 'designziel_v1_v61_1.json');
const BASE_SVG = path.join(ROOT, 'projekte', 'designziel_v1_v61_1.svg');
const OVERLAY_JSON = path.join(ROOT, 'test', 'fixtures', 'v63_2_example_overlay.json');
const TARGET_JSON = path.join(ROOT, 'projekte', 'v63_2_komplettbeispiel.json');
const TARGET_SVG = path.join(ROOT, 'projekte', 'v63_2_komplettbeispiel.svg');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildProject() {
  const base = readJson(BASE_JSON);
  const overlay = readJson(OVERLAY_JSON);
  return Object.assign({}, base, overlay);
}

function serializedProject() {
  return JSON.stringify(buildProject(), null, 2) + '\n';
}

function valuesEqual(actual, expected) {
  if (Buffer.isBuffer(actual) && Buffer.isBuffer(expected)) return actual.equals(expected);
  return actual === expected;
}

function assertEqual(actual, expected, label) {
  if (!valuesEqual(actual, expected)) {
    throw new Error(label + ' differs from the deterministic V63.2 build.');
  }
}

function checkTargets() {
  assertEqual(fs.readFileSync(TARGET_JSON, 'utf8'), serializedProject(), 'Project JSON');
  assertEqual(fs.readFileSync(TARGET_SVG), fs.readFileSync(BASE_SVG), 'Project SVG');
  process.stdout.write('V63.2 example project is deterministic and current.\n');
}

function writeTargets() {
  fs.writeFileSync(TARGET_JSON, serializedProject(), 'utf8');
  fs.copyFileSync(BASE_SVG, TARGET_SVG);
  process.stdout.write('V63.2 example project rebuilt.\n');
}

function main() {
  if (process.argv.includes('--check')) {
    checkTargets();
    return;
  }
  writeTargets();
}

main();
