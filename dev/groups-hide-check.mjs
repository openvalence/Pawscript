// dev/groups-hide-check.mjs -- paw-0apg "hide the groups once a scene is tracked unless you go to the seed frame", in YOUR
// test instance (node dev/test-app.mjs start ...; the fake sidecar), on a generated clip (1280 x 720, 30 fps, 4 s, one shot:
// an orange and a green box on blue; make it with --make <clip.mp4>). Asserts on what the overlay canvas paints in a thin
// band along each painted group's outline (the run's own points sit inside the groups, never on that band):
//  1. two groups painted with the brush on frame 30 (1 s), the tool closed: their outlines are painted on frame 30 AND on
//     frame 75 (no run yet: today's behaviour, unchanged);
//  2. T (fake.groups): on frame 75 nothing of them is painted, and a click there reaches the video's canvas (the groups do
//     not take it: the document and the tool are unchanged); on frame 30, the seed frame, they are painted;
//  3. the Groups tool on, on frame 75: painted (the tool shows them everywhere);
//  4. the run discarded, the tool off: back on frame 75.
//   node dev/groups-hide-check.mjs --make <clip.mp4>
//   node dev/groups-hide-check.mjs <clip.mp4> [<out dir>]
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.argv[2] === '--make') {
  const box = (c, w, h) => `color=c=${c}:s=${w}x${h}:r=30:d=4`;
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2040a0:s=1280x720:r=30:d=4', '-f', 'lavfi', '-i', box('0xff8c00', 240, 200), '-f', 'lavfi', '-i', box('0x20c040', 160, 160),
    '-filter_complex', '[0][1]overlay=x=260:y=250[a];[a][2]overlay=x=760:y=200,format=yuv420p', '-c:v', 'libx264', '-g', '1', '-threads', '4', '-t', '4', process.argv[3]], { stdio: 'inherit', windowsHide: true });
  process.exit(r.status);
}
const { connectTestApp } = await import('./cdp-connect.mjs');
const [clip, out] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/groups-hide-check.mjs <clip.mp4> [<out dir>]'); process.exit(2); }
if (out) mkdirSync(out, { recursive: true });
for (const f of [clip.replace(/\.[^.]+$/, '.pawproj'), clip.replace(/\.[^.]+$/, '.pawruns')]) if (existsSync(f)) rmSync(f);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (d) d.resolve(d.choices?.[0]?.id ?? null); });
const seek = async (t) => { await ev((t) => { app.player.pause(); app.player.seek(t, { exact: true }); }, t); await page.waitForFunction((t) => Math.abs(app.player.timeMs - t) < 20 && !app.player.el?.seeking, t, { timeout: 15000 }); await wait(600); };
const shot = async (tag) => { if (out) await page.screenshot({ path: `${out}/${tag}.png` }); };
const toolOn = (on) => ev((on) => { const G = __pawDev.groupsFor(app); if (G.on !== on) G.toggle(on); }, on);

// overlay canvas pixels (alpha > 20) within 3 px of the painted groups' outlines (stored polys, sampled every 2 px)
const band = () => ev(() => {
  const cv = document.querySelector('[data-testid="video-stage"] canvas.ov'), r = cv.getBoundingClientRect(), k = cv.width / r.width;
  const v = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const seen = new Set(); let n = 0;
  for (const g of (app.doc.scenes || []).flatMap((s) => s.groups || [])) {
    const P = g.poly.map(([x, y]) => [v.x - r.x + x * v.width, v.y - r.y + y * v.height]);
    P.forEach((a, i) => {
      const b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= L; s += 2) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const X = Math.round((a[0] + (b[0] - a[0]) * s / (L || 1) + dx) * k), Y = Math.round((a[1] + (b[1] - a[1]) * s / (L || 1) + dy) * k), key = Y * cv.width + X;
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height || seen.has(key)) continue;
        seen.add(key); if (d[key * 4 + 3] > 20) n++;
      }
    });
  }
  return n;
});

try {
  await page.waitForFunction(() => window.app && window.__pawDev?.groupsFor, null, { timeout: 60000 });
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 6; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  const D = await ev(() => app.durationMs), SEED = 1000, OTHER = 2500;
  await ev((D) => {
    for (const [k, v] of Object.entries({ autoFromRepeats: false, brush: 0.04, grow: false, snap: false, circle: false, askAfter: false })) app.settings.set('tracking.groups.' + k, v);
    app.setMode('track'); app.player.pause();
    app.doc.scenes = [{ start_ms: 0, end_ms: D }];
    app.settings.set('tracking.trails', 'off');
    const tr = __pawDev.trackingFor(app);
    tr.runs = []; app.doc.ghosts = (app.doc.ghosts || []).filter((g) => g.source?.kind !== 'tracker');
  }, D);
  await seek(SEED);
  await toolOn(true); await wait(500);
  const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
  const scribble = async (cx, cy, rx, ry) => { await page.mouse.move(...at(cx - rx, cy)); await page.mouse.down(); for (let k = 0; k <= 12; k++) await page.mouse.move(...at(cx - rx + (2 * rx * k) / 12, cy + (k % 2 ? ry : -ry))); await page.mouse.up(); await wait(300); };
  await scribble(0.297, 0.486, 0.06, 0.08);   // the orange box (260..500, 250..450)
  await scribble(0.656, 0.389, 0.04, 0.07);   // the green box (760..920, 200..360)
  await ev(() => { const G = __pawDev.groupsFor(app); G.assign(0, { who: 'c1', part: 'tail' }); G.assign(1, { who: 'c1', part: 'balls' }); });
  await wait(300);
  const names = await ev(() => (app.doc.scenes[0].groups || []).map((g) => `${g.name}@${g.t_ms}`).join());
  ok(/c1_tail@\d+,c1_balls@\d+/.test(names), 'two groups painted on the seed frame: ' + names);
  await toolOn(false); await wait(500);

  await seek(SEED); const pre0 = await band(); await shot('1-seed-untracked');
  await seek(OTHER); const pre1 = await band(); await shot('2-other-untracked');
  ok(pre0 > 200, `untracked, seed frame: the groups are painted (${pre0} px on their outlines)`);
  ok(pre1 > 200, `untracked, another frame: still painted, as before (${pre1} px)`);

  await ev((D) => { const tr = __pawDev.trackingFor(app); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: D }; }, D);
  await page.waitForFunction(() => __pawDev.trackingFor(app).trackerId === 'fake.groups', null, { timeout: 15000 });
  await ev(() => app.commands.run('track.run', { all: true }));
  await page.waitForFunction(() => __pawDev.trackingFor(app).runs.length === 1 && !__pawDev.trackingFor(app).busy, null, { timeout: 60000 });
  await wait(800);
  ok(!(await ev(() => __pawDev.groupsFor(app).on)), 'tracked; the Groups tool is off');

  await seek(OTHER); const post1 = await band(); await shot('3-other-tracked');
  ok(post1 < Math.max(20, pre1 * 0.05), `tracked, another frame: nothing of the painted groups (${post1} px on their outlines, ${pre1} before)`);
  // a click on where a group was: the video's canvas gets it, the groups do not
  const before = await ev(() => JSON.stringify(app.doc.scenes[0].groups.map((g) => [g.name, g.t_ms, g.poly])) + '|' + __pawDev.groupsFor(app).active);
  await ev(() => { window.__hideHit = null; document.addEventListener('pointerdown', (e) => { window.__hideHit = e.target.matches?.('canvas.ov') ? 'canvas.ov' : e.target.tagName + '.' + e.target.className; }, { capture: true, once: true }); });
  await page.mouse.click(...at(0.297, 0.486)); await wait(300);
  const hit = await ev(() => window.__hideHit), tool = await ev(() => app.player.overlays.activeTool?.id || null);
  const after = await ev(() => JSON.stringify(app.doc.scenes[0].groups.map((g) => [g.name, g.t_ms, g.poly])) + '|' + __pawDev.groupsFor(app).active);
  ok(hit === 'canvas.ov' && tool !== 'tracking.groups' && before === after && !(await ev(() => __pawDev.groupsFor(app).on)), `a click there reaches the video (target ${hit}, active tool ${tool}), the groups are unchanged`);

  await seek(SEED); const post0 = await band(); await shot('4-seed-tracked');
  ok(post0 > 200, `tracked, the seed frame: painted (${post0} px)`);

  await seek(OTHER); await toolOn(true); await wait(600); const on1 = await band(); await shot('5-other-tool-on');
  ok(on1 > 100, `the Groups tool on, another frame: painted (${on1} px)`);
  await toolOn(false); await wait(300);

  await ev(() => { const tr = __pawDev.trackingFor(app); tr.remove(tr.runs[0].id); });
  await wait(300); await seek(OTHER); const back = await band(); await shot('6-other-discarded');
  ok(back > 200, `the run discarded: back on another frame (${back} px)`);
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
