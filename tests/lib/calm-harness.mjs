import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
export const fixtures = path.join(root, 'tests/fixtures/hardening');
export const outputs = path.join(root, 'evidence/hardening/browser');

const require = createRequire(path.join(root, 'node_modules/playwright/package.json'));
const { chromium } = require('playwright');
export const executablePath = process.env.VEIL_BROWSER_PATH || path.join(process.env.USERPROFILE || '', 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');
export const fx = name => path.join(fixtures, name);
export const out = name => path.join(outputs, name);

export async function launch({ viewport = { width: 1440, height: 900 }, headless = true, deviceScaleFactor = 1 } = {}) {
  const browser = await chromium.launch({
    ...(fs.existsSync(executablePath)?{executablePath}:{}),
    headless,
    args: ['--disable-background-networking', '--disable-component-update']
  });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    acceptDownloads: true,
    offline: true,
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await context.newPage();
  const log = { requests: [], errors: [], console: [], dialogs: [], notes: [] };

  page.on('request', r => {
    if (!/^file:/.test(r.url())) log.requests.push(r.url());
  });
  page.on('pageerror', e => log.errors.push(e.message));
  page.on('console', m => {
    if (['error', 'warning'].includes(m.type())) log.console.push(m.type() + ': ' + m.text());
  });

  let dialogResponse = true;
  page.on('dialog', async d => {
    log.dialogs.push(d.type() + ': ' + d.message());
    if (dialogResponse) await d.accept();
    else await d.dismiss();
  });

  const distHtmlPath = path.join(root, 'dist/Veil.html');
  const artifactSha = crypto.createHash('sha256').update(fs.readFileSync(distHtmlPath)).digest('hex');

  const h = {
    browser, context, page, log, artifactSha,
    setDialogResponse(v) { dialogResponse = v; },
    async open() {
      await page.goto(pathToFileURL(distHtmlPath).href);
      await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Ready.'), null, { timeout: 60000 });
    },
    async ready(timeout = 90000) {
      await page.waitForFunction(() => !document.body.classList.contains('working'), null, { timeout });
    },
    async click(sel) {
      await page.locator(sel).click();
      await h.ready();
    },
    status() { return page.locator('#status').textContent(); },
    calmStatus() { return page.locator('#calmStatus').textContent(); },
    screen() { return page.evaluate(() => document.body.dataset.calmScreen); },
    async shot(name, full = true) {
      await page.screenshot({ path: out(name + '.png'), fullPage: full });
    },
    async openFixture(name) {
      await page.setInputFiles('#pdfInput', fx(name));
      await h.ready();
    },
    async download(action, name, timeout = 60000) {
      const ev = page.waitForEvent('download', { timeout });
      await action();
      const d = await ev;
      const file = out(name);
      await d.saveAs(file);
      await h.ready();
      return fs.readFileSync(file);
    },
    async pasteHTML(html, plain) {
      await page.evaluate(([html, plain]) => {
        const el = document.getElementById('calmPaste');
        const dt = new DataTransfer();
        dt.setData('text/html', html);
        dt.setData('text/plain', plain);
        el.focus();
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, [html, plain]);
    },
    async clipboard() {
      return page.evaluate(() => navigator.clipboard.readText());
    },
    async storage() {
      return page.evaluate(async () => ({
        local: localStorage.length,
        session: sessionStorage.length,
        cookies: document.cookie,
        idb: (await indexedDB.databases()).length
      }));
    },
    async finish(name, extra = {}) {
      fs.writeFileSync(out(name + '.json'), JSON.stringify({ ...extra, ...log }, null, 2));
      await browser.close();
    }
  };
  return h;
}

export function schemaFromPrompt(prompt) {
  const marker = 'DOCUMENT AND REQUIRED JSON SCHEMA\n';
  const at = prompt.lastIndexOf(marker) + marker.length;
  let depth = 0, inString = false, end = at;
  for (let i = at; i < prompt.length; i++) {
    const c = prompt[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (!depth) { end = i + 1; break; }
    }
  }
  return JSON.parse(prompt.slice(at, end));
}

export function labelsFromPrompt(prompt) {
  const m = prompt.match(/REGISTERED DOCUMENT LABELS[^\n]*\n([^\n]*)/);
  return m ? m[1].split(', ').filter(x => x && x !== '(None)') : [];
}

export function pdfStrings(bytes) {
  const zlib = require('node:zlib');
  const text = bytes.toString('latin1');
  const parts = [text];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(text))) {
    try {
      parts.push(zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'));
    } catch { /* not deflate */ }
  }
  return parts.join('\n');
}
