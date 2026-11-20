// dev/carried-outline-check.mjs -- paw-rrtw "these islands are very rigid and tend to fly around", in YOUR test instance (node
// dev/test-app.mjs start ...; the fake sidecar), on a generated clip (dev/groups-hide-check.mjs --make <clip.mp4>). A painted
// c1_balls, T (fake.groups), then the run's members of that group replaced by ten that move together (0.1 of the width to the
// right over the clip); from 2 s on, five of them die and one flies to the far corner. The blobs view with its Parts layer only:
// what the overlay canvas paints in a thin band along where the painting should be (moved with the survivors) and along where
// a fit dragged by the stray member would put it. Asserts: at 1 s the outline is on the band, solid; at 3 s it is still on
// the survivors' band (not dragged off) and faint (unsure: drawn at under 60 % of its 1 s opacity).
//   node dev/carried-outline-check.mjs <clip.mp4> [<out dir>]
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [clip, out] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/carried-outline-check.mjs <clip.mp4> [<out dir>]'); process.exit(2); }
if (out) mkdirSync(out, { recursive: true });
for (const f of [clip.replace(/\.[^.]+$/, '.pawproj'), clip.replace(/\.[^.]+$/, '.pawruns')]) if (existsSync(f)) rmSync(f);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (d) d.resolve(d.choices?.[0]?.id ?? null); });
const seek = async (t) => { await ev((t) => { app.player.pause(); app.player.seek(t, { exact: true }); }, t); await page.waitForFunction((t) => Math.abs(app.player.timeMs - t) < 20 && !app.player.el?.seeking, t, { timeout: 15000 }); await wait(600); };
const POLY = [[0.2, 0.33], [0.4, 0.33], [0.4, 0.63], [0.2, 0.63]], SEED_T = 500, DX = 0.1;
// the outline expected at t: the painting moved with the members; the one HEAD's fit gives with the stray member (measured: off by 0.2-0.5 frame heights)
const moved = (t, D) => POLY.map(([x, y]) => [x + DX * t / D, y]);
// overlay canvas: [pixels with alpha > 20 within 3 px of polygon P (normalised), their max alpha]
const band = (P) => ev((P) => {
  const cv = document.querySelector('[data-testid="video-stage"] canvas.ov'), r = cv.getBoundingClientRect(), k = cv.width / r.width;
  const v = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const Q = P.map(([x, y]) => [v.x - r.x + x * v.width, v.y - r.y + y * v.height]), seen = new Set();
  let n = 0, top = 0;
  Q.forEach((a, i) => { const b = Q[(i + 1) % Q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s <= L; s += 2) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const X = Math.round((a[0] + (b[0] - a[0]) * s / L + dx) * k), Y = Math.round((a[1] + (b[1] - a[1]) * s / L + dy) * k), key = Y * cv.width + X;
      if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height || seen.has(key)) continue;
      seen.add(key); const al = d[key * 4 + 3]; if (al > 20) { n++; top = Math.max(top, al); }
    } });
  return [n, top];
}, P);

try {
  await page.waitForFunction(() => window.app && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 6; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  const D = await ev(() => app.durationMs);
  await ev(([D, POLY, SEED_T]) => {
    app.setMode('track'); app.player.pause(); app.player.setUi({ hud: false, posBar: false });
    app.doc.scenes = [{ start_ms: 0, end_ms: D, groups: [{ name: 'c1_balls', who: 'c1', part: 'balls', poly: POLY, pinned: true, t_ms: SEED_T, source: 'user' }] }];
    app.settings.set('tracking.scenes', 'document'); app.settings.set('tracking.trails', 'blobs');
    for (const [k, v] of Object.entries({ heat: false, points: false, bodies: false, camera: false, primary: false, axis: false, labels: 'off', fusion: false, hud: false, trails: false, hulls: false, seeded: true, seededOpacity: 100, opacity: 100, follow: 'playhead' })) app.settings.set('tracking.blobs.' + k, v);
    const tr = __pawDev.trackingFor(app);
    tr.runs = []; app.doc.ghosts = (app.doc.ghosts || []).filter((g) => g.source?.kind !== 'tracker');
    tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: D };
  }, [D, POLY, SEED_T]);
  await page.waitForFunction(() => __pawDev.trackingFor(app).trackerId === 'fake.groups', null, { timeout: 15000 });
  await ev(() => app.commands.run('track.run', { all: true }));
  await page.waitForFunction(() => __pawDev.trackingFor(app).runs.length === 1 && !__pawDev.trackingFor(app).busy, null, { timeout: 60000 });
  // the group's members replaced: ten moving together; from 2 s five dead and one in the far corner
  const id = await ev(([D, POLY, DX]) => {
    const tr = __pawDev.trackingFor(app), run = tr.runs[0], fr = run.frames;
    const id = (run.scenes || []).flatMap((s) => Object.values(s.groups || {})).find((g) => g?.label === 'c1_balls')?.id;
    if (!id) return 0;
    const seed = Array.from({ length: 10 }, (_, k) => [0.23 + 0.035 * (k % 5), 0.4 + 0.15 * Math.floor(k / 5)]);
    const ov = fr.ov.map((o, i) => {
      if (!o?.pts) return o;
      const t = fr.t[i], late = t >= 2000, own = seed.map(([x, y], k) => (late && k % 2 ? [x, y, 0, 0, 0, id] : late && k === 4 ? [0.95, 0.92, 1, 0, 0, id] : [x + DX * t / D, y, 1, 0, 0, id]));
      return { ...o, pts: [...o.pts.filter((q) => q[5] !== id), ...own] };
    });
    const channels = Object.fromEntries(Object.entries(run.channels || {}).filter(([k]) => !k.startsWith('sem_c1_balls')));   // its centre from the members, not the fake's
    tr.runs = [{ ...run, channels, frames: { ...fr, ov } }];
    return id;
  }, [D, POLY, DX]);
  ok(id > 0, `the run has c1_balls pinned (id ${id})`);
  await wait(500);
  await seek(1000); const [n1, a1] = await band(moved(1000, D)); if (out) await page.screenshot({ path: `${out}/1s.png` });
  ok(n1 > 150, `1 s, all ten members: the outline on the moved painting (${n1} px on its band)`);
  await seek(3000); const [n3, a3] = await band(moved(3000, D)); if (out) await page.screenshot({ path: `${out}/3s.png` });
  ok(n3 > 150, `3 s, five dead, one flown off: still on the survivors (${n3} px on the band where they carry it)`);
  ok(n3 > 150 && a3 < 0.6 * a1, `3 s: drawn faint, unsure (peak alpha ${a3} against ${a1} at 1 s)`);
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
