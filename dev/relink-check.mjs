// dev/relink-check.mjs -- paw-o2ij / paw-xfg6 / paw-ky2g in the REAL window (your test instance: node dev/test-app.mjs start ...;
// the CDP_* env it prints). Generated clips only, in <dir> (made here with ffmpeg, removed at the end).
//  1. o2ij: open a clip, add points by keys, no Ctrl+S; the continuous write stores media.size / media.hash; close; MOVE the video
//     into a subfolder; reopen the project: the video is found by its fingerprint (no Locate needed) and its new place written.
//  2. xfg6: move it out of reach; reopen: the pane says the file is missing and shows "Locate video…" (the bar over a cached copy,
//     or the card when nothing plays); Locate (the file dialog stubbed to answer the file's new place) clears it.
//  3. ky2g: at 900 x 600, three unusable projects opened twice each: at most 4 toasts, repeats counted ("×2"), "Dismiss all"
//     clears them; where the toasts sit against the timeline is printed (they go above it when there is room).
//   node dev/relink-check.mjs <dir>
import { existsSync, rmSync, readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node dev/relink-check.mjs <dir>'); process.exit(2); }
const root = join(dir, 'relink-clips'), sub = join(root, 'sub'), away = join(dir, 'relink-away');
rmSync(root, { recursive: true, force: true }); rmSync(away, { recursive: true, force: true });
mkdirSync(sub, { recursive: true }); mkdirSync(away, { recursive: true });
const clip = join(root, 'mv.mp4'), proj = join(root, 'mv.pawproj'), moved = join(sub, 'mv.mp4'), gone = join(away, 'mv.mp4');
const ff = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
if (ff.status !== 0) { console.error('ffmpeg failed: ' + ff.stderr); process.exit(2); }

const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
const settle = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
const disk = () => JSON.parse(readFileSync(proj, 'utf8'));
const open = async (p, video) => {
  await ev((p) => app.project.openPaths([p]), p);
  if (video) await page.waitForFunction((v) => app.doc.media?.path === v, video, { timeout: 30000 });
  await settle();
};

try {
  await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await ev(() => app.project.close());

  // ---- 1. paw-o2ij ----
  await open(clip, clip);
  await page.waitForFunction(() => app.player.ready, null, { timeout: 30000 });
  await ev(() => app.setMode('refine'));
  for (const [ms, key] of [[500, '0'], [1000, '9']]) { await ev((ms) => app.player.seek(ms, { exact: true }), ms); await wait(150); await page.keyboard.press('Numpad' + key); }   // paw-5zpf: NumPad digits place points (the number row picks the selection mode)
  await wait(2500);   // the continuous write, no Ctrl+S
  ok(existsSync(proj), 'mv.pawproj written beside the clip without a save');
  const m = existsSync(proj) ? disk().media : {};
  ok(m.size > 0 && m.hash?.algo === 'q1' && /^q1-/.test(m.hash.value), `the project holds the fingerprint (size ${m.size}, hash ${m.hash?.value?.slice(0, 16)}...)`);
  await ev(() => app.project.close());
  await page.waitForFunction(() => !app.doc.media, null, { timeout: 15000 });
  renameSync(clip, moved);
  await open(proj, moved).catch(() => {});
  ok(await ev((v) => app.doc.media?.path === v, moved), `reopened: the moved video found by its fingerprint (${await ev(() => app.doc.media?.path)})`);
  ok(!(await ev(() => app.player.missing)), 'the pane does not call it missing');
  await wait(2500);
  ok(disk().media.path === moved, 'its new place is written');

  // ---- 2. paw-xfg6 ----
  await ev(() => app.project.close());
  await page.waitForFunction(() => !app.doc.media, null, { timeout: 15000 });
  renameSync(moved, gone);
  await open(proj, moved).catch(() => {});
  await page.waitForFunction(() => app.player.missing || app.player.error, null, { timeout: 15000 }).catch(() => {});
  await settle();
  const st = await ev(() => ({ missing: app.player.missing, error: app.player.error?.code ?? null, ready: app.player.ready }));
  const bar = await page.locator('[data-testid="video-missing"]').isVisible().catch(() => false);
  const locate = page.getByRole('button', { name: 'Locate video…' });
  ok(st.missing || st.error === 'missing', `the player knows the file is missing (${JSON.stringify(st)})`);
  ok(await locate.first().isVisible().catch(() => false), `"Locate video…" is visible in the pane (${bar ? 'the bar over a cached copy' : 'the error card'})`);
  await ev((p) => { window.__od = app.backend.openDialog; app.backend.openDialog = async () => p; }, gone);
  await locate.first().click();
  await page.waitForFunction((g) => app.doc.media?.path === g && !app.player.missing && !app.player.error, gone, { timeout: 15000 }).catch(() => {});
  ok(await ev((g) => app.doc.media?.path === g && !app.player.missing, gone), 'Locate video… points the project at the file; the missing state is gone');
  await ev(() => { app.backend.openDialog = window.__od; });
  await page.screenshot({ path: join(dir, 'relink-located.png') });

  // ---- 3. paw-ky2g ----
  await page.setViewportSize({ width: 900, height: 600 });
  await settle();
  const bad = [join(root, 'broken.pawproj'), join(root, 'newer.pawproj'), join(root, 'empty.pawproj')];
  writeFileSync(bad[0], '{ not json'); writeFileSync(bad[1], JSON.stringify({ format: 'pawproj', version: 99 })); writeFileSync(bad[2], JSON.stringify({ format: 'nope' }));
  for (const p of [...bad, ...bad]) await ev((p) => app.project.openPaths([p]), p);
  await settle();
  const toasts = page.locator('.k-toast');
  const n = await toasts.count(), texts = await toasts.allInnerTexts();
  ok(n <= 4, `at most 4 toasts (${n})`);
  ok(texts.some((t) => /×2/.test(t)), `a repeat is counted, not stacked (${JSON.stringify(texts.map((t) => t.slice(0, 50)))})`);
  const geo = await ev(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const tl = r('[aria-label="Timeline"]'), host = r('.k-toast-host'), ts = [...document.querySelectorAll('.k-toast')].map((e) => e.getBoundingClientRect());
    return { tlTop: tl ? Math.round(tl.top) : null, hostTop: Math.round(host.top), hostBottom: Math.round(host.bottom), toastTops: ts.map((x) => Math.round(x.top)), lift: getComputedStyle(document.documentElement).getPropertyValue('--toast-bottom') };
  });
  console.log('     at 900x600: ' + JSON.stringify(geo));
  ok(geo.hostTop >= 0, 'the stack stays inside the window (older ones cut at the top of the room)');
  if (geo.lift) ok(geo.hostBottom <= geo.tlTop, 'the toasts sit above the timeline');
  await page.screenshot({ path: join(dir, 'relink-toasts-900x600.png') });
  const all = page.getByRole('button', { name: 'Dismiss all' });
  ok(await all.isVisible().catch(() => false), '"Dismiss all" shows over the stack');
  await all.click().catch(() => {});
  await settle();
  ok(await toasts.count() === 0, 'Dismiss all clears the stack');
} finally {
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});
  await ev(() => app.project.close()).catch(() => {});
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  rmSync(root, { recursive: true, force: true }); rmSync(away, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}
