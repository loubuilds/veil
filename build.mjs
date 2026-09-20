import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const base = path.dirname(fileURLToPath(import.meta.url));
const deps = path.resolve(process.argv[2] || path.join(base, 'node_modules'));
const require = createRequire(path.join(deps, 'esbuild/package.json'));
const { build } = require('esbuild');
const importerBundle = await build({ entryPoints: [path.join(base, 'src/importers.js')], bundle: true, format: 'iife', globalName: 'VeilImporters', platform: 'browser', target: 'es2022', minify: true, write: false, nodePaths: [deps] });
const read = f => fs.readFileSync(path.join(base, f), 'utf8');
const brandMark = read('src/brand-mark.svg').trim();
const favicon = brandMark.replace('<svg ', '<svg color="#fff" ').replace('fill="none">', 'fill="none"><rect width="48" height="48" rx="10" fill="#102536"/>');
const escapeHTML = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const assets = {};
for (const [kind, dir, ext] of [['cMapUrl', 'cmaps', '.bcmap'], ['standardFontDataUrl', 'standard_fonts', null], ['wasmUrl', 'wasm', '.wasm']]) {
  assets[kind] = {};
  for (const file of fs.readdirSync(path.join(deps, 'pdfjs-dist', dir)).sort()) {
    if (file.startsWith('LICENSE') || (ext && !file.endsWith(ext))) continue;
    assets[kind][file] = fs.readFileSync(path.join(deps, 'pdfjs-dist', dir, file)).toString('base64');
  }
}
const libraries = { pdf: fs.readFileSync(path.join(deps, 'pdfjs-dist/build/pdf.min.mjs')).toString('base64'), worker: fs.readFileSync(path.join(deps, 'pdfjs-dist/build/pdf.worker.min.mjs')).toString('base64'), assets };
const licenses = ['pdfjs-dist/LICENSE', 'pdf-lib/LICENSE.md', 'fflate/LICENSE', 'postal-mime/LICENSE.txt', 'pako/LICENSE', ...fs.readdirSync(path.join(deps, 'pdfjs-dist/standard_fonts')).filter(x => x.startsWith('LICENSE')).map(x => 'pdfjs-dist/standard_fonts/' + x), ...fs.readdirSync(path.join(deps, 'pdfjs-dist/wasm')).filter(x => x.startsWith('LICENSE')).map(x => 'pdfjs-dist/wasm/' + x)].map(f => `\n${f}\n${fs.readFileSync(path.join(deps, f), 'utf8')}`).join('\n') + '\n' + read('licenses/fontkit.txt') + '\n' + read('licenses/sax.txt');
const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
// Callback replacements preserve literal dollar sequences in embedded source.
const html = read('src/shell.html').replace('/*__CSS__*/', () => read('src/ui.css') + '\n' + read('src/calm.css'))
  .replace('<!--__BRAND_MARK__-->', () => brandMark.replace('<svg ', '<svg class="brand-mark" aria-hidden="true" focusable="false" '))
  .replace('__FAVICON__', () => 'data:image/svg+xml;base64,' + Buffer.from(favicon).toString('base64'))
  .replace('/*__PDFLIB__*/', () => safeScript(fs.readFileSync(path.join(deps, 'pdf-lib/dist/pdf-lib.min.js'), 'utf8')))
  .replace('/*__CORE__*/', () => safeScript(read('src/core.js')))
  .replace('/*__WORKFLOW__*/', () => safeScript(read('src/workflow.js')))
  .replace('/*__BUNDLE__*/', () => 'const BUNDLE = ' + JSON.stringify(libraries) + ';')
  .replace('/*__IMPORTERS__*/', () => safeScript(importerBundle.outputFiles[0].text))
  .replace('/*__APP__*/', () => safeScript(read('src/app.js').replace('/*__CALM__*/', () => read('src/calm.js'))))
  .replace('<!--__CALM_HTML__-->', () => read('src/calm.html'))
  .replace('__VEIL_LICENSE__', () => escapeHTML(read('LICENSE')))
  .replace('__LICENSES__', () => escapeHTML(licenses));
fs.mkdirSync(path.join(base, 'dist'), { recursive: true });
fs.writeFileSync(path.join(base, 'dist/Veil.html'), html);
fs.writeFileSync(path.join(base, 'dist/build.json'), JSON.stringify({ sha256: crypto.createHash('sha256').update(html).digest('hex'), bytes: Buffer.byteLength(html), pdfjs: JSON.parse(fs.readFileSync(path.join(deps, 'pdfjs-dist/package.json'))).version, pdfLib: JSON.parse(fs.readFileSync(path.join(deps, 'pdf-lib/package.json'))).version, importersSourceSha256: crypto.createHash('sha256').update(read('src/importers.js')).digest('hex'), importDependencies: Object.fromEntries(['fflate', 'postal-mime', '@pdf-lib/fontkit'].map(name => [name, JSON.parse(fs.readFileSync(path.join(deps, name, 'package.json'))).version])) }, null, 2));
console.log('Built dist/Veil.html (' + (Buffer.byteLength(html) / 1048576).toFixed(1) + ' MB).');
