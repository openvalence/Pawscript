// dev/models-window-check.mjs -- paw-cdot: the Models list in YOUR test instance (node dev/test-app.mjs start ..., then
// the CDP_* env it prints) against a models server on 127.0.0.1 (this script; no other host is contacted): Settings >
// Models, Check for model updates (the fake manifest adds two models), Download one (lands checked, shows Installed),
// a bad hash (refused, nothing kept, the error painted), Remove (the file goes, the row says Not downloaded).
//   node dev/models-window-check.mjs [out-dir]
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const out = process.argv[2] || tmpdir();
const body = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 31) % 251));
const sha = createHash('sha256').update(body).digest('hex');
const manifest = { kind: 'pawscript.models/1', version: 1, models: [
  { id: 'test-tiny', title: 'Test tiny', for: 'window check', required: false, licence: 'CC0', licenceUrl: 'https://example.com/licence', files: [{ path: '.cache/test/tiny.bin', bytes: body.length, sha256: sha, url: 'test/tiny.bin' }] },
  { id: 'test-bad', title: 'Test bad hash', for: 'window check', required: false, licence: 'CC0', files: [{ path: '.cache/test/bad.bin', bytes: body.length, sha256: '0'.repeat(64), url: 'test/tiny.bin' }] },
] };
const seen = [];
const server = createServer((req, res) => {
  seen.push(`${req.method} ${req.url}${req.headers.range ? ' ' + req.headers.range : ''}`);
  if (req.url === '/m/manifest.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(manifest)); }
  if (req.url === '/m/test/tiny.bin') {
    const from = Number(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0);
    res.writeHead(from ? 206 : 200, { 'content-length': body.length - from });
    return res.end(body.subarray(from));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/m/`;
const dir = mkdtempSync(join(tmpdir(), 'paw-models-'));

const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const row = (id) => `[data-model-id="${id}"]`;
const painted = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(s) === e; }, sel);
try {
  await page.waitForFunction(() => window.app?.settings, null, { timeout: 30000 });
  await ev(([d, b]) => { app.settings.set('models.dir', d); app.settings.set('models.baseUrl', b); }, [dir, base]);
  await ev(() => app.commands.run('models.open'));
  await page.waitForSelector('[data-testid=models-list]', { timeout: 10000 });
  await page.waitForFunction((d) => document.querySelector('[data-testid=models-folder]')?.textContent.includes(d), dir, { timeout: 10000 });
  console.log('models folder shown:', dir);
  await page.locator('[data-testid=models-list] button', { hasText: 'Check for model updates' }).click();
  await page.waitForSelector(row('test-tiny'), { timeout: 15000 });
  console.log('fetched manifest rows:', await ev(() => [...document.querySelectorAll('[data-model-id]')].map((e) => `${e.dataset.modelId}:${e.dataset.state}`).join(' ')));
  await page.locator(`${row('test-tiny')} [data-testid=model-download]`).click();
  await page.waitForFunction((s) => document.querySelector(s)?.dataset.state === 'installed', row('test-tiny'), { timeout: 20000 });
  const file = join(dir, '.cache', 'test', 'tiny.bin');
  const got = existsSync(file) && createHash('sha256').update(readFileSync(file)).digest('hex');
  console.log('downloaded:', file, got === sha ? 'sha256 ok' : 'WRONG ' + got, '| .part left:', existsSync(file + '.part'));
  if (got !== sha) fail('the downloaded file does not match');
  if (!(await painted(`${row('test-tiny')} .k-badge`))) fail('the Installed badge is not painted');
  console.log('badge:', await ev((s) => document.querySelector(s)?.textContent.trim(), `${row('test-tiny')} .k-badge`));
  // every row's size, state and buttons inside the list and the window (the Settings panel is narrow: they used to sit past its edge)
  for (const w of [null, 220]) {   // as laid out here, and as narrow as the Settings side panel's default (about 210 px)
    const past = await ev(async (w) => { const list = document.querySelector('[data-testid=models-list]'); list.style.width = w ? `${w}px` : '';
      await new Promise(requestAnimationFrame);
      const box = list.getBoundingClientRect(), lim = Math.min(box.right, innerWidth) + 1;
      const bad = [...document.querySelectorAll('[data-testid=model-row]')].flatMap((r) => [...r.querySelectorAll('.k-badge, button, .size')].filter((e) => e.getBoundingClientRect().right > lim)
        .map((e) => `${r.dataset.modelId}: ${e.textContent.trim()} ends at ${Math.round(e.getBoundingClientRect().right)} > ${Math.round(lim)}`));
      list.style.width = ''; return bad; }, w);
    console.log(`rows inside the list (${w ? `${w} px` : 'as laid out'}):`, past.length ? past.join(' | ') : 'yes');
    if (past.length) fail(`${past.length} badge(s) / button(s) past the Models list's edge at ${w || 'its own'} width`);
  }
  // a file whose bytes do not match the manifest: refused, nothing kept
  await page.locator(`${row('test-bad')} [data-testid=model-download]`).click();
  await page.waitForSelector('[data-testid=models-error]', { timeout: 20000 });
  const err = await ev(() => document.querySelector('[data-testid=models-error]').textContent);
  console.log('bad hash:', err.slice(0, 120), '| kept:', existsSync(join(dir, '.cache', 'test', 'bad.bin')), existsSync(join(dir, '.cache', 'test', 'bad.bin.part')));
  if (!/did not check out/.test(err) || existsSync(join(dir, '.cache', 'test', 'bad.bin')) || existsSync(join(dir, '.cache', 'test', 'bad.bin.part'))) fail('a bad hash was not refused cleanly');
  if (!(await painted('[data-testid=models-error]'))) fail('the error is not painted');
  await page.screenshot({ path: join(out, 'models-list.png') });
  // Remove: two clicks (the second says how much), only the model's own file goes
  const rm = page.locator(`${row('test-tiny')} [data-testid=model-remove]`);
  await rm.click();
  console.log('remove asks:', (await rm.textContent()).trim());
  await rm.click();
  await page.waitForFunction((s) => document.querySelector(s)?.dataset.state === 'missing', row('test-tiny'), { timeout: 10000 });
  console.log('removed:', !existsSync(file), '| folder kept:', existsSync(join(dir, '.cache', 'test')));
  if (existsSync(file)) fail('Remove left the file');
  console.log('requests:', seen.join(' | '));
  if (seen.some((s) => !s.startsWith('GET /m/'))) fail('a request outside the models address');
  console.log(process.exitCode ? 'models window check: FAILED' : 'models window check: ok');
} finally {
  await ev(() => { app.settings.reset('models.dir'); app.settings.reset('models.baseUrl'); }).catch(() => {});
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
