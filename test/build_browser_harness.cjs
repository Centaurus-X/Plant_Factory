#!/usr/bin/env node
'use strict';

/**
 * Build a hermetic browser harness for environments whose Chromium policy
 * blocks every URL navigation. The production sources remain unchanged: CSS
 * is inlined, ES modules are transpiled into an isolated CommonJS registry,
 * and HTTP calls are bridged by the Playwright smoke test.
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.resolve(process.argv[2] || path.join(PROJECT_ROOT, '.browser_harness'));
const INDEX_PATH = path.join(PROJECT_ROOT, 'public', 'index.html');
const JAVASCRIPT_ROOT = path.join(PROJECT_ROOT, 'public', 'js');

function fail(message) {
  process.stderr.write('Browser harness build failed: ' + message + '\n');
  process.exit(1);
}

function loadTypeScript() {
  try {
    return require('typescript');
  } catch (localError) {
    let globalRoot = '';
    try {
      globalRoot = childProcess.execFileSync('npm', ['root', '-g'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch (rootError) {
      fail('TypeScript is unavailable. Run npm install before the browser tests.');
    }
    try {
      return require(path.join(globalRoot, 'typescript'));
    } catch (globalError) {
      fail('TypeScript is unavailable. Run npm install before the browser tests.');
    }
  }
  return null;
}

function attributeValue(tag, name) {
  const expression = new RegExp('\\b' + name + '\\s*=\\s*(["\\\'])(.*?)\\1', 'i');
  const match = expression.exec(tag);
  return match ? match[2] : '';
}

function collectHtmlAssets(html) {
  const styles = [];
  const entries = [];
  const linkExpression = /<link\b[^>]*>/gi;
  const scriptExpression = /<script\b[^>]*>\s*<\/script>/gi;
  let match = null;

  while ((match = linkExpression.exec(html)) !== null) {
    const tag = match[0];
    if (attributeValue(tag, 'rel').toLowerCase() === 'stylesheet') {
      const href = attributeValue(tag, 'href');
      if (href) styles.push(href);
    }
  }

  while ((match = scriptExpression.exec(html)) !== null) {
    const tag = match[0];
    if (attributeValue(tag, 'type').toLowerCase() === 'module') {
      const source = attributeValue(tag, 'src');
      if (source) entries.push(source);
    }
  }

  return { styles: styles, entries: entries };
}

function pathFromPublicUrl(url) {
  const relative = String(url).replace(/^\/+/, '');
  const target = path.resolve(PROJECT_ROOT, relative);
  const rootPrefix = PROJECT_ROOT + path.sep;
  if (target !== PROJECT_ROOT && !target.startsWith(rootPrefix)) {
    fail('asset escapes project root: ' + url);
  }
  return target;
}

function mimeForFont(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.woff2') return 'font/woff2';
  if (extension === '.woff') return 'font/woff';
  if (extension === '.ttf') return 'font/ttf';
  if (extension === '.otf') return 'font/otf';
  return 'application/octet-stream';
}

function inlineCssUrls(cssText, cssPath) {
  const urlExpression = /url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g;
  return cssText.replace(urlExpression, function (full, quote, reference) {
    if (/^(?:data:|https?:|#)/i.test(reference)) return full;
    const target = reference.charAt(0) === '/'
      ? pathFromPublicUrl(reference)
      : path.resolve(path.dirname(cssPath), reference);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return full;
    const encoded = fs.readFileSync(target).toString('base64');
    return 'url("data:' + mimeForFont(target) + ';base64,' + encoded + '")';
  });
}

function escapeStyleText(value) {
  return String(value).replace(/<\/style/gi, '<\\/style');
}

function buildEmbeddedHtml(sourceHtml, styleUrls) {
  let html = sourceHtml.replace(/<link\b[^>]*>/gi, function (tag) {
    const relation = attributeValue(tag, 'rel').toLowerCase();
    return relation === 'stylesheet' || relation === 'icon' ? '' : tag;
  });
  html = html.replace(/<script\b[^>]*>\s*<\/script>/gi, function (tag) {
    return attributeValue(tag, 'type').toLowerCase() === 'module' ? '' : tag;
  });

  const styleTags = styleUrls.map(function (url) {
    const filePath = pathFromPublicUrl(url);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail('stylesheet not found: ' + url);
    const css = inlineCssUrls(fs.readFileSync(filePath, 'utf8'), filePath);
    const sourceName = path.basename(filePath).replace(/"/g, '&quot;');
    return '<style data-source="' + sourceName + '">\n'
      + escapeStyleText(css) + '\n</style>';
  }).join('\n');

  return html.replace('</head>', styleTags + '\n</head>');
}

function walkJavaScript(directory, output) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkJavaScript(target, output);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(target);
    }
  });
}

function moduleId(filePath) {
  return '/' + path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

function transpileModules(typeScript) {
  const files = [];
  const modules = Object.create(null);
  walkJavaScript(JAVASCRIPT_ROOT, files);
  files.sort().forEach(function (filePath) {
    const source = fs.readFileSync(filePath, 'utf8');
    const result = typeScript.transpileModule(source, {
      fileName: filePath,
      reportDiagnostics: true,
      compilerOptions: {
        target: typeScript.ScriptTarget.ES2020,
        module: typeScript.ModuleKind.CommonJS,
        sourceMap: false,
        inlineSourceMap: false,
        removeComments: false
      }
    });
    const diagnostics = result.diagnostics || [];
    if (diagnostics.length > 0) {
      const message = diagnostics.map(function (diagnostic) {
        return typeScript.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      }).join(' | ');
      fail(path.relative(PROJECT_ROOT, filePath) + ': ' + message);
    }
    modules[moduleId(filePath)] = result.outputText;
  });
  return modules;
}

function runtimeBundle(modules, entries) {
  const header = [
    '(function (moduleSources, entryIds) {',
    "  'use strict';",
    '  var cache = Object.create(null);',
    '  function normalize(pathname) {',
    '    var parts = [];',
    "    pathname.split('/').forEach(function (part) {",
    "      if (!part || part === '.') return;",
    "      if (part === '..') parts.pop();",
    '      else parts.push(part);',
    '    });',
    "    return '/' + parts.join('/');",
    '  }',
    '  function resolve(fromId, specifier) {',
    "    if (specifier.charAt(0) !== '.') throw new Error('Unsupported module: ' + specifier);",
    "    var base = fromId.slice(0, fromId.lastIndexOf('/') + 1);",
    '    var id = normalize(base + specifier);',
    "    if (!Object.prototype.hasOwnProperty.call(moduleSources, id)",
    "        && Object.prototype.hasOwnProperty.call(moduleSources, id + '.js')) id += '.js';",
    '    return id;',
    '  }',
    '  function load(id) {',
    '    if (cache[id]) return cache[id].exports;',
    "    if (!Object.prototype.hasOwnProperty.call(moduleSources, id)) throw new Error('Module not bundled: ' + id);",
    '    var module = { exports: {} };',
    '    cache[id] = module;',
    '    var localRequire = function (specifier) { return load(resolve(id, specifier)); };',
    "    var source = moduleSources[id] + '\\n//# sourceURL=v61-harness:' + id;",
    "    var factory = new Function('module', 'exports', 'require', source);",
    '    factory(module, module.exports, localRequire);',
    '    return module.exports;',
    '  }',
    '  window.__v61HarnessMode = true;',
    '  window.__v61HarnessModules = cache;',
    '  entryIds.forEach(function (id) { load(id); });',
    '})('
  ].join('\n');
  return header + JSON.stringify(modules) + ',\n' + JSON.stringify(entries) + ');\n';
}

function writeHarness() {
  const typeScript = loadTypeScript();
  const sourceHtml = fs.readFileSync(INDEX_PATH, 'utf8');
  const assets = collectHtmlAssets(sourceHtml);
  if (assets.styles.length === 0) fail('no stylesheets found in public/index.html');
  if (assets.entries.length === 0) fail('no module entries found in public/index.html');

  const html = buildEmbeddedHtml(sourceHtml, assets.styles);
  const modules = transpileModules(typeScript);
  const bundle = runtimeBundle(modules, assets.entries);

  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'bundle.js'), bundle, 'utf8');
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'manifest.json'), JSON.stringify({
    version: '63.4',
    styles: assets.styles,
    entries: assets.entries,
    module_count: Object.keys(modules).length
  }, null, 2) + '\n', 'utf8');

  process.stdout.write('Hermetic browser harness: '
    + assets.styles.length + ' styles, '
    + assets.entries.length + ' entries, '
    + Object.keys(modules).length + ' modules\n');
}

writeHarness();
