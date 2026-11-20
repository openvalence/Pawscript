// dev/groups-outline-check.mjs -- paw-9qim in YOUR test instance (node dev/test-app.mjs start ...; the fake sidecar): a large
// and a small painted group, T (fake.groups: 3 points per group half way inside the painting, as a seeding inset leaves
// them), then the blobs view with only its Parts layer: the pixels that layer paints (Parts on minus Parts off, the
// overlay canvases read back) around each group, their bounding box vs the painted one, on the seed frame and near the
// end. The outline must keep the painted size (HEAD draws the points' hull: a triangle about half the painting's size).
//   node dev/groups-outline-check.mjs <clip.mp4>
import { existsSync, rmSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [clip] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/groups-outline-check.mjs <clip.mp4>'); process.exit(2); }
for (const f of [clip.replace(/\.[^.]+$/, '.pawproj'), clip.replace(/\.[^.]+$/, '.pawruns')]) if (existsSync(f)) rmSync(f);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (d) d.resolve(d.choices?.[0]?.id ?? null); });
const seek = async (t) => { await ev((t) => { app.player.pause(); app.player.seek(t, { exact: true }); }, t); await page.waitForFunction((t) => Math.abs(app.player.timeMs - t) < 20 && !app.player.el?.seeking, t, { timeout: 15000 }); await wait(500); };
const SQ = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const groups = [{ name: 'c1_hips', who: 'c1', part: 'hips', poly: SQ(0.15, 0.2, 0.3, 0.4) }, { name: 'c1_balls', who: 'c1', part: 'balls', poly: SQ(0.65, 0.55, 0.08, 0.12) }];

// the overlay canvases' pixels (alpha > 0) painted by the Parts layer: on minus off, per group window -> bbox area / painted bbox area
const partsPixels = async () => {
  const grab = () => ev(() => {
    const st = document.querySelector('[data-testid="video-stage"]'), v = st.querySelector('video').getBoundingClientRect();
    return [...st.querySelectorAll('canvas')].filter((c) => c.width > 50).map((c) => {
      let d;
      try { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; } catch { return []; }
      const r = c.getBoundingClientRect(), sx = c.width / r.width, sy = c.height / r.height, on = [];
      for (let y = 0; y < c.height; y += 1) for (let x = 0; x < c.width; x += 1) if (d[(y * c.width + x) * 4 + 3] > 40) on.push([((x / sx + r.x) - v.x) / v.width, ((y / sy + r.y) - v.y) / v.height]);
      return on;
    }).flat();
  });
  const set = async (v) => { await ev((v) => { app.settings.set('tracking.blobs.seeded', v); app.player.overlays?.invalidate(); }, v); await wait(600); };
  await set(true); const a = await grab();
  await set(false); const b = new Set((await grab()).map((p) => p.map((q) => q.toFixed(3)).join()));
  await set(true);
  return a.filter((p) => !b.has(p.map((q) => q.toFixed(3)).join()));
};
let ar = 16 / 9;   // the video's aspect (set once it is open)
const ratio = (px, poly) => {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys), cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const mine = px.filter(([x, y]) => Math.abs(x - cx) < 0.8 * w + 0.03 && Math.abs(y - cy) < 0.8 * h + 0.03);
  if (mine.length < 10) return 0;
  // the smallest box over turns of -30..30 deg (square pixels: aspect ar): the drawn painting turns with its live members
  // (fake.groups' c1_hips turns +-0.15 rad since 26b5f7d; the outline follows that turn since b2bbeee), its size is what counts
  let best = Infinity;
  for (let deg = -30; deg <= 30; deg++) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), U = mine.map(([x, y]) => x * ar * c + y * s), V = mine.map(([x, y]) => -x * ar * s + y * c);
    best = Math.min(best, (Math.max(...U) - Math.min(...U)) * (Math.max(...V) - Math.min(...V)));
  }
  return best / (w * ar * h);
};

try {
  await page.waitForFunction(() => window.app && window.__pawDev?.groupsFor, null, { timeout: 60000 });
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 6; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  const D = await ev(() => app.durationMs), A = 500;
  ar = await ev(() => app.player.vw / app.player.vh || 16 / 9);
  await ev(([D, A, groups]) => {
    app.setMode('track'); app.player.pause();
    app.doc.scenes = [{ start_ms: 0, end_ms: D, groups: groups.map((g) => ({ ...g, pinned: true, t_ms: A, source: 'user' })) }];
    app.settings.set('tracking.scenes', 'document'); app.settings.set('tracking.trails', 'blobs');
    for (const [k, v] of Object.entries({ heat: false, points: false, bodies: false, camera: false, primary: false, axis: false, labels: 'off', fusion: false, hud: false, trails: false, hulls: false, seeded: true, seededOpacity: 100, opacity: 100, follow: 'playhead' })) app.settings.set('tracking.blobs.' + k, v);
    const tr = window.__pawDev.trackingFor(app);
    tr.runs = []; tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: D };
  }, [D, A, groups]);
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).trackerId === 'fake.groups', null, { timeout: 15000 });
  await ev(() => app.commands.run('track.run', { all: true }));
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).runs.length === 1 && !window.__pawDev.trackingFor(app).busy, null, { timeout: 60000 });
  await wait(800);
  for (const [label, t] of [['seed frame', A], ['near the end', Math.max(A, D - 400)]]) {
    await seek(t);
    const px = await partsPixels();
    for (const g of groups) {
      const r = ratio(px, g.poly);
      ok(r > 0.85 && r < 1.3, `${label}: ${g.name} drawn outline bbox / painted bbox ${r.toFixed(2)} (the points' hull, what HEAD draws, is about 0.25)`);
    }
  }
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
