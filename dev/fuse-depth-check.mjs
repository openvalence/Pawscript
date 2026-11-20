// dev/fuse-depth-check.mjs -- paw-gy1r in the REAL window (your test instance: node dev/test-app.mjs start ...; CDP_* env).
// A synthetic two-character run: big strokes for 10 s, then small strokes at the deep end; the bodies' distance channel
// (who_pair_proj) reads that depth with tracker noise; the shot is linked to 'fused'. It asserts what is painted:
//   1. the Tracker row carries the depth chips (fusion pressed), kit tooltips, no native title;
//   2. a click on "pair" = ONE undo step (the shot's derive.fuse.depth = 'pair'), the chip pressed;
//   3. the painted fused trace (the run's colour, pixel rows) of the small-stroke stretch moves down to the deep end; the
//      big strokes stay full; the dashed level line is painted along the trace there;
//   4. baseline auto is locked while seated; the owner's knots (dragged high) move the points' level and the dashed line up;
//   5. undo -> fusion again (the trace back).
//   SHOT_DIR=<dir> node dev/fuse-depth-check.mjs
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl } from './run-bar.mjs';

const shots = process.env.SHOT_DIR || null, FPS = 30, N = 600, END = Math.round((N * 1000) / FPS);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
const ph = (i) => (2 * Math.PI * 1.25 * i) / FPS;
const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
/** depth: -1 deep .. +1 out */
const D = (i) => { const u = ss(9.5, 10.5, i / FPS); return (1 - u) * Math.sin(ph(i)) + u * (-0.72 + 0.18 * Math.sin(1.4 * ph(i))); };
function chans() {
  const r = rng(3), out = {};
  const parts = { c1_hips: () => [0.4, 0.58], c1_torso: () => [0.3, 0.48], c1_thighs_l: () => [0.37, 0.7], c2_hips: (i) => [0.5, 0.42 + 0.035 * D(i)], c2_penis: (i) => [0.46, 0.5 + 0.035 * D(i)] };
  for (const [name, f] of Object.entries(parts)) {
    const xs = [], ys = [];
    for (let i = 0; i < N; i++) { const t = Math.round((i * 1000) / FPS), [x, y] = f(i); xs.push([t, x + 0.0012 * gauss(r)]); ys.push([t, y + 0.0012 * gauss(r)]); }
    out[`sem_${name}_x`] = xs; out[`sem_${name}_y`] = ys;
  }
  out.who_pair_proj = Array.from({ length: N }, (_, i) => [Math.round((i * 1000) / FPS), 0.5 + 0.5 * Math.max(-0.82, D(i)) + 0.03 * gauss(r) + (i % 23 === 0 ? 0.15 : 0)]);
  return out;
}

const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const shot = async (name, loc) => { if (shots) await (loc || page).screenshot({ path: `${shots}/${name}.png` }); };
/** the Tracker row's canvas: per time window [t0, t1) the rows (px from the top) painted in colour hex (within tol) */
const painted = (hex, t0, t1, tol = 40) => page.evaluate(({ hex, t0, t1, tol, END }) => {
  const cvs = [...document.querySelectorAll('canvas[aria-label="Tracker signals"]')];
  const want = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  let best = null;
  for (const c of cvs) {
    const ctx = c.getContext('2d'); if (!ctx) continue;
    const W = c.width, H = c.height, img = ctx.getImageData(0, 0, W, H).data, x0 = Math.floor((t0 / END) * W), x1 = Math.ceil((t1 / END) * W), rows = [];
    for (let x = x0; x < x1; x++) for (let y = 0; y < H; y++) { const k = (y * W + x) * 4; if (Math.abs(img[k] - want[0]) + Math.abs(img[k + 1] - want[1]) + Math.abs(img[k + 2] - want[2]) <= tol && img[k + 3] > 100) rows.push(y / H); }
    if (rows.length > (best?.rows.length || 0)) best = { rows, H };
  }
  if (!best) return null;
  const s = best.rows.sort((a, b) => a - b), q = (p) => s[Math.floor(p * (s.length - 1))];
  return { n: s.length, mid: q(0.5), lo: q(0.05), hi: q(0.95) };
}, { hex, t0, t1, tol, END });
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  const ch = chans();
  await page.evaluate(({ ch, END }) => {
    const Dv = window.__pawDev, tr = Dv.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'depthcheck001' } };
    app.doc.project = { ...(app.doc.project || {}), path: 'C:\\pawtest\\fuse-depth-check.pawproj' };
    app.doc.scenes = [{ start_ms: 0, end_ms: END, tags: ['anal', 'penetration'] }];
    const T = ch.who_pair_proj.map(([t]) => t);
    const run = Dv.makeRun({ n: 1, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: END }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: END - 100, pos: 100 }], scenes: [{ start_ms: 0, end_ms: END, sign: 1 }], channels: ch, notes: [] },
      frames: Dv.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    window.RID = run.id;
    app.setView({ start: 0, span: END });
    tr.linkScene(0, run.id, 'fused');
    app.player.seek(END / 2);
  }, { ch, END });
  const chip = (m) => page.locator(`[data-testid="fuse-depth-${m}"]`);
  await runCtl(page);   // paw-k8pe: the run's row is the lane toolbar's (its tail in a … popover)
  await chip('fusion').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  ok((await chip('fusion').getAttribute('aria-pressed')) === 'true' && (await chip('pair').getAttribute('aria-pressed')) === 'false', 'depth chips painted, fusion pressed');
  ok((await chip('pair').getAttribute('title')) == null && (await chip('fusion').getAttribute('title')) == null, 'no native title');
  ok(await chip('shaft').isDisabled(), 'shaft disabled (no shaft pass)');
  await chip('pair').hover(); await page.waitForFunction(() => document.querySelector('.k-tip')?.matches(':popover-open'), null, { timeout: 8000 }).catch(() => {});   // the tip shows 500 ms after the hover, later while the page computes
  const tip = await page.evaluate(() => [...document.querySelectorAll('[role=tooltip]')].map((e) => e.textContent).join(' | '));
  ok(/bodies' distance/.test(tip) && /timing and shape/.test(tip), `its kit tooltip: ${tip.slice(0, 150)}`);
  await page.mouse.move(5, 5); await page.waitForTimeout(600);
  const color = await page.evaluate(() => TR.runs[0].color);
  const big0 = await painted(color, 1500, 8500), small0 = await painted(color, 12000, 19000);
  await shot('depth-before', page.locator('canvas[aria-label="Tracker signals"]'));
  const n0 = await page.evaluate(() => app._history.entries.length);
  await runCtl(page); await chip('pair').click(); await page.waitForTimeout(1200);
  const n1 = await page.evaluate(() => app._history.entries.length), d = await page.evaluate(() => { const s = app.doc.scenes[0]; return (s.derives && s.derives[RID]) || s.derive || null; });
  ok(n1 === n0 + 1 && d?.fuse?.depth === 'pair', `pair in one undo step: derive.fuse ${JSON.stringify(d?.fuse)}`);
  await runCtl(page); ok((await chip('pair').getAttribute('aria-pressed')) === 'true', 'the pair chip pressed');
  const info = await page.evaluate(() => TR.runs[0].channels.fused?.depth?.[0]);
  ok(info?.used > 0.9, `seated: ${JSON.stringify(info)}`);
  const big1 = await painted(color, 1500, 8500), small1 = await painted(color, 12000, 19000);
  ok(small0 && small1 && small1.mid > small0.mid + 0.12, `the small strokes' painted rows move down: median ${small0?.mid.toFixed(2)} -> ${small1?.mid.toFixed(2)} of the row height`);
  ok(small1 && big1 && small1.hi - small1.lo < 0.5 * (big1.hi - big1.lo), `and stay small against the big ones: ${(small1.hi - small1.lo).toFixed(2)} vs ${(big1.hi - big1.lo).toFixed(2)}`);
  ok(big0 && big1 && Math.abs(big1.hi - big1.lo - (big0.hi - big0.lo)) < 0.15, `the big strokes keep their size: ${(big0.hi - big0.lo).toFixed(2)} -> ${(big1.hi - big1.lo).toFixed(2)}`);
  const ink = await page.evaluate(() => { const c = getComputedStyle(document.documentElement).getPropertyValue('--tx-hi').trim(); const e = document.createElement('i'); e.style.color = c; document.body.append(e); const m = /(\d+), (\d+), (\d+)/.exec(getComputedStyle(e).color); e.remove(); return '#' + [1, 2, 3].map((k) => (+m[k]).toString(16).padStart(2, '0')).join(''); });
  const line1 = await painted(ink, 12000, 19000, 30);
  ok(line1 && line1.n > 40 && Math.abs(line1.mid - small1.mid) < 0.12, `the dashed level line is painted along the deep stretch (rows ${line1?.mid.toFixed(2)}, ${line1?.n} px)`);
  await shot('depth-pair', page.locator('canvas[aria-label="Tracker signals"]'));
  // baseline auto locked; the owner's knots move the level
  await runCtl(page); const auto = page.locator('.pick button.chip', { hasText: /^auto$/ });
  ok(await auto.isDisabled(), 'baseline auto locked while seated');
  const lvl = () => page.evaluate(() => { const p = TR.runs[0].points; const q = []; for (let j = 0; j < p.at.length; j++) if (p.at[j] > 12000 && p.at[j] < 19000) q.push(p.pos[j]); return q.reduce((a, b) => a + b, 0) / q.length; });
  const p0 = await lvl();
  await page.evaluate(({ END }) => { const k = TR.links.findIndex((l) => l.run === RID); TR.patchLink(k, { baseline: { mode: 'knots', knots: [[0, 0.5], [9000, 0.5], [12000, 0.85], [END, 0.85]] } }); }, { END });
  await page.waitForTimeout(1000);
  const p1 = await lvl(), line2 = await painted(ink, 13000, 19000, 30);
  ok(p1 > p0 + 20, `the owner's knots move the points' level there: ${p0.toFixed(0)} -> ${p1.toFixed(0)}`);
  ok(line2 && line2.mid < line1.mid - 0.15, `and the dashed line with them (rows ${line1.mid.toFixed(2)} -> ${line2?.mid.toFixed(2)})`);
  await shot('depth-knots', page.locator('canvas[aria-label="Tracker signals"]'));
  await page.evaluate(() => { const k = TR.links.findIndex((l) => l.run === RID); TR.patchLink(k, { baseline: { mode: 'off' } }); });
  await page.waitForTimeout(600);
  await page.evaluate(() => app.undo ? app.undo() : app.commands.run('edit.undo')); await page.waitForTimeout(1200);
  const small2 = await painted(color, 12000, 19000);
  ok((await chip('fusion').getAttribute('aria-pressed')) === 'true' && small2 && Math.abs(small2.mid - small0.mid) < 0.05, `undo: fusion again, the trace back (${small2?.mid.toFixed(2)})`);
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failed` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
