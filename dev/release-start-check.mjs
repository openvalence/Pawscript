// dev/release-start-check.mjs -- a release build of this tree starts and paints (for shell patches; run on the second PC):
//
//   node dev/release-start-check.mjs <scratch dir>        (the dev/remote runner, -Gui ... 'node dev/release-start-check.mjs {work}')
//
// `tauri build --no-bundle` with a test identifier (app.pawscript.test-rel-<hex>: its own app data, never anyone's; the
// window off-screen), then the release exe on the hidden desktop (dev/hidden-desktop.cs, as dev/test-app.mjs) with a
// WebView2 debugging port and the fake sidecar. Passes when its page shows text over CDP and the exe still runs 5 s later.
// Ends the exe and removes the test identifier's app data. CARGO_TARGET_DIR is honoured (the dev/remote runner gives each run its own).
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const dir = resolve(process.argv[2] || '.');
const id = 'test-rel-' + randomBytes(4).toString('hex'), ident = 'app.pawscript.' + id;
const fail = (m) => { console.error('FAIL ' + m); process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

const cfg = join(dir, 'tauri-release-check.json');
// beforeBuildCommand: vite only (`npm run build` runs the unit suite first, whose timing tests flake on a loaded PC)
writeFileSync(cfg, JSON.stringify({ identifier: ident, build: { beforeBuildCommand: 'npx vite build' }, app: { windows: [{ label: 'main', title: 'Pawscript (' + id + ')', width: 1600, height: 1000, x: -32000, y: -32000, focus: false, skipTaskbar: true, visible: true, resizable: true }] } }));
const t0 = Date.now();
const b = spawnSync(process.execPath, [resolve('node_modules/@tauri-apps/cli/tauri.js'), 'build', '--no-bundle', '--config', cfg], { stdio: 'inherit', windowsHide: true });
if (b.status !== 0) { fail('tauri build --no-bundle exited ' + b.status); process.exit(1); }
const exe = join(resolve(process.env.CARGO_TARGET_DIR || 'src-tauri/target'), 'release', 'pawscript.exe');
console.log(`release build ${((Date.now() - t0) / 1000).toFixed(0)} s: ${exe}`);

const launcher = join(dir, 'hidden-desktop.exe');
if (!existsSync(launcher)) spawnSync(join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), ['/nologo', '/target:winexe', '/out:' + launcher, resolve('dev/hidden-desktop.cs')], { stdio: 'inherit' });
const p = spawn(launcher, [id], { env: { ...process.env, PAWTEST_CMD: `"${exe}"`, PAWTEST_OUT: join(dir, 'release.log'), PAWTEST_ERR: join(dir, 'release.err.log'), PAWTRACK_CMD: 'node test/fake-pawtrack.mjs', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: 'ignore', windowsHide: true });
let exited = null;
p.on('exit', (c) => { exited = c; });

let text = '', url = '';
for (const until = Date.now() + 90000; Date.now() < until && exited === null && !text;) {
  await sleep(1000);
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && /tauri\.localhost|^tauri:/.test(t.url));
    if (!page) continue;
    url = page.url;
    if (typeof WebSocket !== 'function') { text = `(node ${process.version} has no WebSocket: page present, text not read)`; break; }
    text = await new Promise((ok, bad) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.body ? document.body.innerText.trim().slice(0, 200) : ""', returnByValue: true } }));
      ws.onmessage = (m) => { const r = JSON.parse(m.data); if (r.id === 1) { ws.close(); ok(r.result?.result?.value || ''); } };
      ws.onerror = () => bad(new Error('ws'));
      setTimeout(() => { ws.close(); bad(new Error('ws timeout')); }, 5000);
    });
  } catch { /* not up yet */ }
}
if (!text) fail(exited !== null ? `the exe ended (launcher exit ${exited}) before its page showed text` : `no page with text in 90 s (page: ${url || 'none'})`);
else {
  console.log(`page ${url} shows: ${JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 120))}`);
  await sleep(5000);
  if (exited !== null) fail('the exe ended within 5 s of showing its page');
  else console.log(`OK the release exe started and runs (${((Date.now() - t0) / 1000).toFixed(0)} s in all)`);
}
if (exited === null) spawnSync('taskkill', ['/T', '/F', '/PID', String(p.pid)], { stdio: 'ignore', windowsHide: true });
await sleep(1500);
for (const base of [process.env.LOCALAPPDATA, process.env.APPDATA]) if (base) rmSync(join(base, ident), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
