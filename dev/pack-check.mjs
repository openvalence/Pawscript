// dev/pack-check.mjs -- paw-2k9s / paw-zkvc in YOUR test instance, on a shell WITH dev/patches/paw-2k9s-pack-shell.patch
// (node dev/test-app.mjs start ... from a copy that has it applied; the CDP_* env it prints). Generated clips only.
//   File menu (real clicks): Pack project / Clean project / Clean project and remove tracker runs are there, enabled, and the
//   Clean tips say what would be freed. Pack: the .pawpack is checked by Python's zipfile (stored, manifest first, CRCs, the
//   video byte for byte, every manifest sha256) and holds no absolute path and no user folder; a cancel leaves nothing.
//   Open it: unpacked beside it, the project opens on the unpacked video with the same points and runs. A pack naming
//   '../' or of a newer major format is refused and writes nothing. Clean: the media-cache entries of the video go, the
//   video / project / funscript / runs stay byte for byte, it still plays. Clean + runs: the .pawruns loses its frame data
//   (the old one to the Recycle Bin), the points stay.
//   node dev/pack-check.mjs <dir for the generated clip>        exits 1 on any FAIL
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { connectTestApp } from './cdp-connect.mjs';

const [dir] = process.argv.slice(2);
if (!dir) { console.error('usage: node dev/pack-check.mjs <clip dir>'); process.exit(2); }
rmSync(dir, { recursive: true, force: true });   // generated files only: a fresh folder each run
mkdirSync(dir, { recursive: true });
const clip = join(dir, 'pack clip.mp4'), stem = join(dir, 'pack clip');
const ff = (a) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit', windowsHide: true }); if (r.status) process.exit(1); };
ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-threads', '4', '-c:a', 'aac', '-shortest', clip]);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const py = (code, ...args) => { const r = spawnSync('python', ['-I', '-c', code, ...args], { encoding: 'utf8', windowsHide: true }); return { out: r.stdout.trim(), err: r.stderr.trim(), status: r.status }; };

const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 300)); } });
// the toasts recorded, emptied; hooked on the shown app each time (opening a project can show another tab's app: app.tabs)
const freshToasts = () => ev(() => { window.__toasts = []; const a = app; if (!a.__toastHook) { const t = a.toast.bind(a); a.toast = (m, k, o) => { window.__toasts.push({ m: String(m), k }); return t(m, k, o); }; a.__toastHook = true; } });
await freshToasts();
// the toast that matches (a timeout: what was shown instead, so the assertion after it fails with the reason, not a crash)
const lastToast = (re) => page.waitForFunction((re) => { app.dialog?.resolve?.('discard'); return window.__toasts.some((t) => new RegExp(re).test(t.m)); }, re.source, { timeout: 60000 })
  .then(() => ev((re) => window.__toasts.findLast((t) => new RegExp(re).test(t.m)), re.source), async () => ({ m: `no toast like ${re} in 60 s; shown: ${JSON.stringify(await ev(() => window.__toasts.map((t) => t.m)))}` }));
const ready = () => page.waitForFunction(() => app.player.ready && app.player.vw > 0, null, { timeout: 60000 });

// ---- a project: points, a tracked run, saved beside the clip ----
await ev(async (p) => { app.dialog?.resolve?.('discard'); await app.project.openVideo(p, { force: true, mode: 'ignore' }); }, clip);
await ready();
await ev(async () => {
  app.transact('points', () => { app.doc.axes = { ...app.doc.axes, stroke: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 2000, pos: 10 }], roll: [{ at: 0, pos: 50 }, { at: 1500, pos: 70 }] }; });
  const tr = window.__pawDev.trackingFor(app);
  if (!tr.trackers.length) await tr.list();   // trackRange knows only listed trackers ("Unknown tracker fake.none.")
  window.__trackRes = await tr.trackRange({ tracker: 'fake.none', range: { t0: 0, t1: app.durationMs }, scenes: 'one' });
});
ok(await ev(() => !!window.__trackRes?.run && window.__pawDev.trackingFor(app).runs.some((r) => r.frames)), 'a tracked run with frame data' + (await ev(() => (window.__trackRes?.run ? '' : ': ' + JSON.stringify(window.__trackRes)))));
ok(await ev(() => app.project.save()), 'saved: ' + ['.pawproj', '.funscript', '.roll.funscript', '.pawruns'].map((e) => e + (existsSync(stem + e) ? ' ✓' : ' ✗')).join(' '));
const before = Object.fromEntries(['.mp4', '.pawproj', '.funscript', '.roll.funscript'].map((e) => [e, sha(stem + e)]));
const points = await ev(() => JSON.stringify(app.doc.axes));
const nRuns = await ev(() => window.__pawDev.trackingFor(app).runs.filter((r) => r.frames).length);
// the scrub cache, filmstrip, waveform: let them be made
await page.waitForFunction(() => app.player.scrubCache?.state === 'ready', null, { timeout: 90000 }).catch(() => {});
await wait(1500);

// ---- File menu: the three commands, their tips (real clicks) ----
async function fileMenu() {
  await page.locator('button', { hasText: /^File$/ }).first().click();
  await page.locator('[role="menu"]').first().waitFor({ timeout: 5000 });
  await wait(700);   // the estimate is read when the menu asks whether Clean is enabled
}
await fileMenu();
const items = await ev(() => [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map((e) => ({ t: e.innerText.trim(), off: e.getAttribute('aria-disabled') === 'true' || e.disabled })));
for (const t of ['Pack project…', 'Clean project', 'Clean project and remove tracker runs']) ok(items.some((i) => i.t.startsWith(t) && !i.off), `File menu: "${t}" enabled`);
const tips = await ev(() => ({ clean: app.commands.list().find((c) => c.id === 'file.clean').tip, runs: app.commands.list().find((c) => c.id === 'file.cleanRuns').tip }));
ok(/^Would free \d/.test(tips.clean) && /scrub cache|filmstrip|waveform/.test(tips.clean), 'Clean tip: ' + tips.clean.split('\n')[0]);
ok(/tracker run's frame data/.test(tips.runs) && /accepted script points stay/.test(tips.runs), 'Clean + runs tip: ' + tips.runs.split('\n')[0]);
await page.keyboard.press('Escape');

// ---- Pack: cancel first (nothing left), then for real through the menu ----
const dest = join(dir, 'shared', 'pack clip.pawpack');
mkdirSync(join(dir, 'shared'), { recursive: true });
await ev((d) => { app.backend.__saveDialog ??= app.backend.saveDialog; app.backend.saveDialog = async () => d; }, dest);
await ev(() => { const w = app.backend.packWrite; app.backend.__packWrite = w; app.backend.packWrite = (...a) => { let j = null; const o = a[3] || {}; j = w(a[0], a[1], a[2], { onProgress: (f) => { o.onProgress?.(f); j?.cancel(); } }); return j; }; });
await ev(() => app.commands.run('file.pack'));
const tc = await lastToast(/Pack cancel+ed|Pack failed|Packed/);   // f4da366: American spelling ("Pack canceled, nothing written")
ok(/^Pack cancel+ed/.test(tc.m), 'the cancel says so: ' + tc.m);
ok(!existsSync(dest) && !readdirSync(join(dir, 'shared')).length, 'cancelled pack: nothing in the folder (' + readdirSync(join(dir, 'shared')).join(', ') + ')');
await ev(() => { app.backend.packWrite = app.backend.__packWrite; });
await fileMenu();
await page.locator('[role="menu"] [role^="menuitem"]', { hasText: /^\s*Pack project/ }).first().click();
const t1 = await lastToast(/^Packed|Pack failed/);
ok(/^Packed pack clip\.pawpack \(/.test(t1.m), 'toast: ' + t1.m);
ok(existsSync(dest), 'the .pawpack is there: ' + (existsSync(dest) ? statSync(dest).size + ' bytes' : 'missing'));

// independent reader: Python's zipfile
const z = py(`
import zipfile, json, hashlib, sys
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
bad = z.testzip()
m = json.loads(z.read('pawpack.json'))
shas = {f['name']: hashlib.sha256(z.read(f['name'])).hexdigest() == f['sha256'] for f in m['files']}
print(json.dumps({'names': names, 'bad': bad, 'stored': all(i.compress_type == 0 for i in z.infolist()), 'first_off': z.getinfo('pawpack.json').header_offset, 'shas': shas, 'm': m}))
`, dest);
const zr = z.status ? null : JSON.parse(z.out);
ok(zr && zr.names[0] === 'pawpack.json' && zr.first_off === 0, 'zipfile: manifest first at offset 0: ' + (zr ? zr.names.join(', ') : z.err));
ok(zr?.bad === null && zr.stored, 'zipfile: every CRC good, every entry stored');
ok(zr && Object.values(zr.shas).every(Boolean) && Object.keys(zr.shas).length === 5, 'zipfile: every manifest sha256 matches (' + JSON.stringify(zr?.shas) + ')');
ok(zr?.m.video?.name === 'pack clip.mp4' && zr.m.video.durationMs > 11000 && zr.m.format === 'pawpack' && zr.m.version === '1.0', 'manifest: ' + JSON.stringify({ video: zr?.m.video, app: zr?.m.app }));
const vz = py(`import zipfile, hashlib, sys; print(hashlib.sha256(zipfile.ZipFile(sys.argv[1]).read('pack clip.mp4')).hexdigest())`, dest);
ok(vz.out === before['.mp4'], 'the video in the pack is the original byte for byte');
// privacy: nothing but the video names this machine's folders (the test dir lies under C:\Users\<name>\...)
const texts = py(`
import zipfile, sys, json, struct
z = zipfile.ZipFile(sys.argv[1]); out = {}
for n in z.namelist():
    b = z.read(n)
    if n.endswith('.pawruns'): k = struct.unpack('<I', b[8:12])[0]; b = b[12:12 + k]
    if not n.endswith('.mp4'): out[n] = b.decode('utf-8')
print(json.dumps(out))
`, dest);
const user = (/[\\/]Users[\\/]([^\\/]+)/i.exec(dir) || [])[1] || '';
for (const [n, t] of Object.entries(JSON.parse(texts.out || '{}'))) {
  const leak = /[A-Za-z]:[\\/]|\\\\[^\\]+\\/.exec(t) || (user && new RegExp('Users(\\\\\\\\|\\\\|/)+' + user, 'i').exec(t));
  ok(!leak, `${n}: no absolute path, no user folder${leak ? ' (found ' + leak[0] + ')' : ''}`);
}

// ---- Open the pack: unpacked beside it, its project opens ----
await ev(async (p) => { app.dialog?.resolve?.('discard'); await app.project.close({ force: true }); await app.project.openPaths([p]); }, dest);
await page.waitForFunction(() => /pack clip[\\/]pack clip\.pawproj$/.test(app.project.path || ''), null, { timeout: 60000 });
await ready();
const un = join(dir, 'shared', 'pack clip');
ok(sha(join(un, 'pack clip.mp4')) === before['.mp4'], 'unpacked video identical');
ok(await ev(() => app.doc.media.path.replace(/\\/g, '/').endsWith('shared/pack clip/pack clip.mp4')), 'the project opened on the unpacked video: ' + (await ev(() => app.doc.media.path)));
ok((await ev(() => JSON.stringify(app.doc.axes))) === points, 'same points after the round trip');
await page.waitForFunction(() => window.__pawDev.trackingFor(app).runs.some((r) => r.frames), null, { timeout: 30000 }).catch(() => {});
ok((await ev(() => window.__pawDev.trackingFor(app).runs.filter((r) => r.frames).length)) === nRuns, `the tracker runs came along with their frame data (${nRuns})`);
// opening it again: a new folder, nothing replaced
await ev(async (p) => { await app.project.close({ force: true }); await app.project.openPaths([p]); }, dest);
await page.waitForFunction(() => /pack clip \(2\)/.test(app.project.path || ''), null, { timeout: 60000 }).then(() => ok(true, 'opened again: into "pack clip (2)"'), () => ok(false, 'opened again: ' + app.project?.path));

// ---- refused packs: a name leaving its folder, a newer format ----
const evil = join(dir, 'shared', 'evil.pawpack'), newer = join(dir, 'shared', 'newer.pawpack');
const mk = py(`
import zipfile, json, hashlib, sys
def pack(path, name, version):
    data = b'{"actions":[]}'
    m = {'format': 'pawpack', 'version': version, 'files': [{'name': name, 'role': 'script', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_STORED) as z:
        z.writestr('pawpack.json', json.dumps(m)); z.writestr(name, data)
pack(sys.argv[1], '../evil.funscript', '1.0'); pack(sys.argv[2], 'x.funscript', '2.0')
`, evil, newer);
ok(!mk.status, 'crafted packs ' + mk.err);
await freshToasts();
// not awaited: a "Save changes?" for the open project (the unpacked copy reopened) would hold the call; lastToast answers it
await ev((p) => { app.project.openPaths([p]); }, evil);
const te = await lastToast(/Can't open evil/);
ok(/outside its folder/.test(te.m) && !existsSync(join(dir, 'shared', 'evil.funscript')) && !existsSync(join(dir, 'shared', 'evil')), "a pack naming '../' is refused, nothing written: " + te.m);
await ev((p) => { app.project.openPaths([p]); }, newer);
// f4da366: one fragment ("..., update Pawscript to open it")
const tn = await lastToast(/Can't open newer/);
ok(/newer Pawscript \(pack format 2\.0\), update Pawscript/.test(tn.m) && !existsSync(join(dir, 'shared', 'newer')), 'a newer major format is refused plainly: ' + tn.m);

// ---- Clean project (menu click) on the original ----
await ev(async (p) => { await app.project.close({ force: true }); await app.project.openPaths([p]); }, stem + '.pawproj');
await ready();
await page.waitForFunction(() => app.player.scrubCache?.state === 'ready', null, { timeout: 90000 }).catch(() => {});
await wait(1500);
await ev(() => app.project.flush?.());   // paw-up1r: the project is written continuously; what Clean must not change is measured from here
before['.pawproj'] = sha(stem + '.pawproj');
const cache0 = await ev(() => app.backend.mediaCacheOf([app.doc.media.path]));
ok(cache0.length >= 3, 'media cache of the clip before: ' + cache0.map((i) => `${i.kind} ${i.bytes}`).join(', '));
await freshToasts();
await fileMenu();
await page.locator('[role="menu"] [role^="menuitem"]').filter({ hasText: 'Clean project' }).filter({ hasNotText: 'tracker runs' }).first().click();
const t2 = await lastToast(/^Freed|^Nothing to free|Clean project stopped/);
ok(/^Freed \d/.test(t2.m), 'toast: ' + t2.m.split('\n')[0]);
await ev(() => app.project.flush?.());
const cache1 = await ev(() => app.backend.mediaCacheOf([app.doc.media.path]));
ok(cache1.length === 0, 'media cache of the clip after: ' + (cache1.map((i) => i.kind).join(', ') || 'none'));
for (const [e, h] of Object.entries(before)) ok(sha(stem + e) === h, `${e} unchanged`);
ok(existsSync(stem + '.pawruns'), '.pawruns kept');
await ev(async (p) => { await app.project.close({ force: true }); await app.project.openPaths([p]); }, stem + '.pawproj');
await ready();
await ev(() => { app.player.pause(); app.player.seekFrame(100); });
await page.waitForFunction(() => app.player.frame === 100 && !app.player.seeking, null, { timeout: 20000 }).then(() => ok(true, 'reopened after Clean: plays and seeks (frame 100)'), () => ok(false, 'reopened after Clean: no seek'));
ok((await ev(() => JSON.stringify(app.doc.axes))) === points, 'points unchanged after Clean');

// ---- Clean project and remove tracker runs ----
const runs0 = statSync(stem + '.pawruns').size;
await page.waitForFunction(() => window.__pawDev.trackingFor(app).runs.some((r) => r.frames), null, { timeout: 30000 }).catch(() => {});
await freshToasts();
await fileMenu();
await page.locator('[role="menu"] [role^="menuitem"]', { hasText: /^\s*Clean project and remove tracker runs/ }).first().click();
const t3 = await lastToast(/^Freed|Clean project stopped/);
// 1e8fe21 (paw-lacf): it says what goes ("tracker run frames ...") and what stays ("The runs stay in the project ...")
ok(/tracker run frames/.test(t3.m) && /runs stay/.test(t3.m) && /Recycle Bin/.test(t3.m), 'toast: ' + t3.m.replace(/\n/g, ' | '));
const runs1 = existsSync(stem + '.pawruns') ? statSync(stem + '.pawruns').size : -1;
ok(runs1 > 0 && runs1 < runs0, `.pawruns rewritten without frame data: ${runs0} -> ${runs1} bytes`);
ok(await ev(() => { const t = window.__pawDev.trackingFor(app); return t.runs.length > 0 && t.runs.every((r) => !r.frames); }), 'the runs stay, without frames');
ok((await ev(() => JSON.stringify(app.doc.axes))) === points, 'accepted points unchanged');
for (const e of ['.mp4', '.funscript', '.roll.funscript']) ok(sha(stem + e) === before[e], `${e} unchanged`);

await ev(() => { if (app.backend.__saveDialog) app.backend.saveDialog = app.backend.__saveDialog; });
await browser.close();
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
