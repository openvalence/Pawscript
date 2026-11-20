// dev/test-app.mjs -- launch an isolated Pawscript test instance that scripts can drive over CDP, on a hidden desktop.
//
//   node dev/test-app.mjs start   --dir <scratch dir> --target <your CARGO_TARGET_DIR> [--id <earlier id>]   -> prints the env for dev/cdp.mjs
//   node dev/test-app.mjs stop    --dir <scratch dir>                    -> ends what start launched
//   node dev/test-app.mjs restart --dir <scratch dir>                    -> stop, then start the same instance again (same id, target, ports,
//                                                                           dist: localStorage and app data survive, as in the real app)
//   start ... --real-tracker [--gb N]   dev only: the REAL sidecar (trackers\.venv, cwd = the repo) instead of the fake, each process
//                                       admitted by trackers/gpu_lock.py --gb N (default 10). Its GPU use is real: mind the GPU rules.
//                                       (gpu_lock counts this instance's sidecar as the owner's.)
//
// This is the only way to open a real app window. The owner may be playing a fullscreen game on this machine, so
// the app (cargo, the exe, WebView2) runs on a separate, never-displayed Win32 desktop, WinSta0\PawscriptTest
// (dev/hidden-desktop.cs, built into <dir>/hidden-desktop.exe by the C# compiler that ships with Windows). A window
// on a desktop that is not the input desktop cannot become the foreground window, take focus or knock a game out of
// fullscreen, whatever the app or WebView2 does; nothing appears on the owner's screen and nothing gets a console
// window. CDP input, screenshots, rAF, WebGL (hardware) and video all work there. Never start the app any other way
// (no plain `tauri dev` or built exe for testing, no headed browser).
//
// Also (ARCHITECTURE.md, Standards):
//  - a WebView2 debugging port and a preview port drawn from the instance id (high ports, never 9333 / 5173 / 9477): a new id
//    gets free ones, the same id (--id, restart) gets the same ones, so the page origin and its localStorage survive a restart (paw-hoxz);
//  - its own identifier (app.pawscript.test-<id>), so settings / autosaves / window state / the WebView2 profile
//    never mix with anyone's, and the single-instance plugin can never hand anything to the owner's app;
//  - a build stamped with VITE_TEST_ID, so scripts can assert window.__pawscriptTestId before acting;
//  - the fake sidecar (no GPU) unless --real-tracker; stop ends only processes whose command line is still this instance's.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : null; };
const dir = arg('dir');
if (!dir) { console.error('usage: node dev/test-app.mjs start|stop|restart --dir <scratch dir> [--target <CARGO_TARGET_DIR>]'); process.exit(2); }
if (process.platform !== 'win32') { console.error('Windows only (the hidden desktop is a Win32 desktop)'); process.exit(2); }
const stateFile = join(dir, 'test-app.json');

/** [debug port, preview port] of an instance id: 20000..48999, under Windows' ephemeral range, far from 5173 / 9333 / 9477. */
const portsOf = (id) => { const web = 20000 + (createHash('sha256').update(id).digest().readUInt32BE(0) % 14500) * 2; return [web + 1, web]; };
const isFree = (p) => new Promise((ok) => { const s = createServer(); s.once('error', () => ok(false)); s.listen(p, '127.0.0.1', () => s.close(() => ok(true))); });
const bothFree = async (id) => (await Promise.all(portsOf(id).map(isFree))).every(Boolean);
const commandLine = (pid) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`], { encoding: 'utf8', windowsHide: true }).trim(); } catch { return ''; }
};
const stopAll = (st) => {
  for (const { pid, mark } of st.procs) {
    // a PID can be reused once its process is gone: never kill one whose command line is not ours any more
    if (!commandLine(pid).includes(mark)) { console.log(`${pid}: already gone`); continue; }
    try { execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true }); } catch { /* exited meanwhile */ }
    console.log(`${pid}: stopped`);
  }
};

if (cmd === 'stop') { stopAll(JSON.parse(readFileSync(stateFile, 'utf8'))); process.exit(0); }
if (cmd !== 'start' && cmd !== 'restart') { console.error('start, stop or restart'); process.exit(2); }
const prev = cmd === 'restart' ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
if (prev) stopAll(prev);
const target = prev?.target ?? arg('target');
if (!target) { console.error('--target <CARGO_TARGET_DIR> is required (never share the default target dir with a running app)'); process.exit(2); }
// a pool target on the second PC (the dev/remote runner: <Root>\targets\<k>, lock <k>.lock = 'run folder|deadline') belongs to
// the run holding its lock (its lines get PAWSCRIPT_RUN): a second cargo on it cannot replace the running exe (paw-6ttm)
if (/[\\/]targets[\\/]\d+[\\/]?$/.test(target)) {
  let holder = '';
  try { holder = readFileSync(resolve(target) + '.lock', 'utf8').split('|')[0].trim(); } catch { /* no lock: nobody holds it */ }
  if (!holder || !process.env.PAWSCRIPT_RUN || resolve(holder) !== resolve(process.env.PAWSCRIPT_RUN)) {
    console.error(`cargo target ${target} is a pool slot ${holder ? 'held by ' + holder : 'nobody holds'}: take one through the dev/remote runner`); process.exit(1);
  }
}
const gb = prev ? prev.gb : rest.includes('--real-tracker') ? Number(arg('gb') || 10) : null;   // null: the fake sidecar

mkdirSync(dir, { recursive: true });
// --id <id of an earlier run>: the same identifier, so the same app data folder and the same ports (origin): a check over a restart
let id = prev?.id ?? arg('id');
if (id) {
  // its ports, once a just-stopped instance has let go of them
  let free = false;
  for (let k = 0; k < 20 && !(free = await bothFree(id)); k++) await new Promise((ok) => setTimeout(ok, 250));
  if (!free) { console.error(`the ports of ${id} (${portsOf(id).join(', ')}) are taken: is it still running? (node dev/test-app.mjs stop --dir ...)`); process.exit(1); }
} else {
  for (let k = 0; k < 50 && !id; k++) { const c = 'test-' + randomBytes(4).toString('hex'); if (await bothFree(c)) id = c; }
  if (!id) { console.error('no free port pair found'); process.exit(1); }
}
const [cdpPort, webPort] = portsOf(id);
const dist = resolve(dir, 'dist');
const env = { ...process.env, VITE_EXPOSE_APP: '1', VITE_TEST_ID: id };
const node = process.execPath, vite = resolve('node_modules/vite/bin/vite.js'), tauri = resolve('node_modules/@tauri-apps/cli/tauri.js');
const q = (s) => `"${s}"`;

// Everything here runs with piped or ignored stdio and windowsHide, so Node creates it with CREATE_NO_WINDOW.
const run = (exe, args) => { const r = spawnSync(exe, args, { env, windowsHide: true, encoding: 'utf8' }); process.stdout.write(r.stdout + r.stderr); return r.status === 0; };
const src = resolve('dev/hidden-desktop.cs'), launcher = join(dir, 'hidden-desktop.exe');
const csc = join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if ((!existsSync(launcher) || statSync(launcher).mtimeMs < statSync(src).mtimeMs) && !run(csc, ['/nologo', '/target:winexe', '/out:' + launcher, src])) { console.error('could not build ' + launcher); process.exit(1); }
if (!(prev && existsSync(join(dist, 'index.html'))) && !run(node, [vite, 'build', '--outDir', dist, '--emptyOutDir'])) { console.error('build failed'); process.exit(1); }

// detached (outlives this script) and a GUI exe (never a console); what it starts goes on the hidden desktop
const onHiddenDesktop = (command, extraEnv, log) => {
  const p = spawn(launcher, [id], { env: { ...extraEnv, PAWTEST_CMD: command, PAWTEST_OUT: join(dir, log + '.log'), PAWTEST_ERR: join(dir, log + '.err.log') }, stdio: 'ignore', windowsHide: true, detached: true });
  p.unref();
  return p.pid;
};
const preview = onHiddenDesktop(`${q(node)} ${q(vite)} preview --outDir ${q(dist)} --port ${webPort} --strictPort`, env, 'preview');
const cfg = join(dir, 'tauri-test.json');
writeFileSync(cfg, JSON.stringify({
  identifier: 'app.pawscript.' + id,
  build: { devUrl: `http://localhost:${webPort}`, beforeDevCommand: '' },
  // off-screen, unfocused and taskbar-less as well, in case anything ever ran it outside the hidden desktop
  app: { windows: [{ label: 'main', title: 'Pawscript (' + id + ')', width: 1600, height: 1000, x: -32000, y: -32000, focus: false, skipTaskbar: true, visible: true, resizable: true }] },
}));
// the sidecar's cwd is the repo root (src-tauri/src/sidecar.rs); PAWTRACK_CMD is split on whitespace
const py = resolve('trackers/.venv/Scripts/python.exe');
const app = onHiddenDesktop(`${q(node)} ${q(tauri)} dev --no-watch --config ${q(cfg)}`, {
  ...process.env, CARGO_TARGET_DIR: resolve(target), HF_HUB_OFFLINE: '1',
  PAWTRACK_CMD: gb == null ? 'node test/fake-pawtrack.mjs' : `${py} ${resolve('trackers/gpu_lock.py')} --gb ${gb} ${py} -m pawtrack.cli`,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
}, 'tauri');
const url = `http://localhost:${webPort}/`;
writeFileSync(stateFile, JSON.stringify({ id, cdpPort, webPort, url, target: resolve(target), gb, procs: [{ pid: app, mark: id }, { pid: preview, mark: id }] }, null, 1));
console.log(`${prev ? 're' : ''}started ${id} on the hidden desktop${gb == null ? '' : ` with the REAL sidecar (gpu_lock --gb ${gb})`}: debug port ${cdpPort}, page ${url} (state in ${stateFile}; logs tauri[.err].log, preview[.err].log)`);
console.log(`CDP_PORT=${cdpPort} CDP_EXPECT_URL=${url} CDP_TEST_ID=${id}`);
process.exit(0);
