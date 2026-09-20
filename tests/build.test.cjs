const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const base = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(base, 'dist/Veil.html'), 'utf8');
test('assembled source preserves literal replacement metacharacters', () => {
  for (const name of ['core.js', 'workflow.js', 'app.js']) {
    const source = fs.readFileSync(path.join(base, 'src', name), 'utf8').replace('/*__CALM__*/', () => fs.readFileSync(path.join(base, 'src/calm.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
    assert(html.includes('<script>' + source + '</script>'), name + ' must be embedded without alteration');
  }
  assert(!/\/\*__(?:CORE|WORKFLOW|APP|CSS|PDFLIB|BUNDLE|IMPORTERS)__\*\//.test(html));
});
test('embedded core works independently of the source module', () => {
  const script = html.match(/<script>(\/\* Pure document logic\.[\s\S]*?)<\/script>/)[1];
  const context = {}; vm.runInNewContext(script, context);
  assert.equal(context.VeilCore.escapeRegExp('a.b+$'), 'a\\.b\\+\\$');
});

test('assembled executable scripts parse without unresolved calm source markers', () => {
  assert(!html.includes('/*__CALM__*/'));
  assert(!html.includes('<!--__CALM_HTML__-->'));
  let scripts=0;
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){new vm.Script(match[1]);scripts++;}
  assert(scripts>=3);
});
test('build manifest matches the actual standalone artifact', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'dist/build.json'), 'utf8'));
  assert.equal(manifest.sha256, crypto.createHash('sha256').update(html).digest('hex'));
  assert.equal(manifest.bytes, Buffer.byteLength(html));
  assert.equal(manifest.importersSourceSha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(base, 'src/importers.js'))).digest('hex'));
});
