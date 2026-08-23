#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache'
]);

function loadTypeScript() {
  const candidates = ['typescript'];
  try {
    const globalRoot = childProcess.execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (globalRoot) candidates.push(path.join(globalRoot, 'typescript'));
  } catch (error) {
    // Local TypeScript remains the preferred runtime dependency.
  }

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      // Continue with the next deterministic module location.
    }
  }
  throw new Error('TypeScript is required for the JavaScript style check. Run npm install.');
}

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()
        && (EXCLUDED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.release_test.'))) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(fullPath));
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) files.push(fullPath);
  }
  return files.sort();
}

function inspectFile(ts, file) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const findings = [];

  function visit(node) {
    let kind = '';
    if (ts.isArrowFunction(node)) kind = 'arrow-function';
    else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) kind = 'class';
    else if (ts.isMethodDeclaration(node)) kind = 'method-declaration';

    if (kind) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push({
        file: path.relative(ROOT, file),
        line: position.line + 1,
        kind,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function main() {
  const ts = loadTypeScript();
  const findings = [];
  for (const file of listJavaScriptFiles(ROOT)) {
    findings.push(...inspectFile(ts, file));
  }

  if (findings.length) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line}: ${finding.kind}`);
    }
    return 1;
  }

  console.log('Functional JavaScript style verified: no classes, methods or arrow functions.');
  return 0;
}

process.exitCode = main();
