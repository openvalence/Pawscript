// dev/detail-render-check.mjs -- paw-na9u in the REAL window (your test instance: node dev/test-app.mjs start ...; CDP_* env).
// A synthetic run (test/how-synth.mjs): 8 rounded (sine) strokes, 6 strokes with a true flat top (360 ms), 8 slow-then-fast
// out-moves, linked to 'fused' with Smart stroke on. It asserts what is painted:
//   1. By render is the default (the chip reads "render"); the popover's "+ mid + hold" switches to the old Detail in ONE
//      undo step, undo brings By render's points back exactly;
//   2. By render: no hold on the rounded strokes (no trapezoids), a point marking the dwell on the flat tops (flat or a slow
//      transition, as the trace is), a point on the slow-then-fast out-moves; the old Detail's holds there for comparison;
//   3. the Tracker lane paints the device's curve of the points (canvas data-render-fit, its light pixels along the curve);
//   4. the machine preview (Capstan, Kinetic2) of By render stays within 8 pos RMS of the trace (the lane's fused signal
//      mapped onto its depth) and no farther from it than the old Detail's.
//   SHOT_DIR=<dir> node dev/detail-render-check.mjs
import { connectTestApp } from './cdp-connect.mjs';
import { track, howRun } from '../test/how-synth.mjs';
import { renderScript } from '../src/lib/stroke-shape.js';

const shots = process.env.SHOT_DIR || null;
const many = (n, s) => Array.from({ length: n }, () => ({ ...s }));
const tr0 = track([...many(8, { kind: 'sine', T: 700 }), ...many(6, { kind: 'shoulder', T: 1200, rest: 0, top: 0.6 }), ...many(8, { kind: 'slowout', T: 800 })]);
const chans = Object.fromEntries(Object.entries(howRun(tr0, { seed: 2 }).channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
const END = tr0.t[tr0.N - 1] + 1, SINE = [300, 300 + 8 * 700], FLAT = [SINE[1], SINE[1] + 6 * 1200], SLOW = [FLAT[1], FLAT[1] + 8 * 800];
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const shot = async (name, loc) => { if (shots) await (loc || page).screenshot({ path: `${shots}/${name}.png` }); };
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150)))));
const ghost = () => page.evaluate(() => { const g = TR.ghost(RID), r = TR.runs[0]; return (g?.script || []).map((p) => ({ at: p.at, pos: p.pos, why: TR.whyAt(r, p.at) || '' })); });
const count = (G, [a, b], why) => G.filter((p) => p.at > a + 50 && p.at < b - 50 && why.test(p.why)).length;
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await page.evaluate(({ chans, END }) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'detailrender01' } };
    app.doc.project = { ...(app.doc.project || {}), path: 'C:\\pawtest\\detail-render.pawproj' };
    app.doc.scenes = [{ start_ms: 0, end_ms: END, tags: ['penetration'] }];
    const T = chans.who_pair_proj.map(([t]) => t);
    const run = D.makeRun({ n: 4, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: END }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: END - 100, pos: 100 }], scenes: [{ start_ms: 0, end_ms: END, sign: 1 }], channels: chans, notes: [] },
      frames: D.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    window.RID = run.id;
    app.setView({ start: 0, span: END });
    tr.linkScene(0, run.id, 'fused');
    tr.setSmart(0, true);
    app.player.seek(1000);
  }, { chans, END });
  await settle();
  // 1. By render is the default; the chip switches to the old Detail in ONE undo step and back
  const chip = page.locator('[data-testid="detail-chip"]');
  await chip.waitFor({ timeout: 15000 });
  ok(/render/.test(await chip.innerText()), `the chip reads the default: "${await chip.innerText()}"`);
  const G = await ghost();
  await chip.dispatchEvent('click');   // (at the lane's left edge the lane's fold button sits over it)
  const pop = page.locator('[data-testid="detail"]');
  await pop.waitFor({ timeout: 5000 });
  const pick = (name) => pop.getByRole('radio', { name, exact: true }).or(pop.getByRole('button', { name, exact: true })).first();
  ok(await pick('render').count() > 0 && await pick('+ mid + hold').count() > 0 && !(await pick('render').getAttribute('title')), 'the popover has "render" and "+ mid + hold", no native title');
  await pick('+ mid + hold').click();
  await settle();
  await page.keyboard.press('Escape');
  ok(/[+]mid[+]hold/.test(await chip.innerText()), `one click: the old Detail ("${await chip.innerText()}")`);
  const old = await ghost(), oldHoldsSine = count(old, SINE, /^hold$/), oldHoldsFlat = count(old, FLAT, /^hold$/);
  await page.evaluate(() => app.undo());
  await settle();
  const back = await ghost();
  ok(/render/.test(await chip.innerText()) && JSON.stringify(back) === JSON.stringify(G), `one undo step: By render again, its points exactly ("${await chip.innerText()}")`);
  // 2. what By render placed
  const hs = count(G, SINE, /^hold$/), xs = count(G, SINE, /^(mid|shoulder)$/), hf = count(G, FLAT, /^hold$/), ps = count(G, SLOW, /^(mid|shoulder)$/);
  ok(hs === 0, `rounded strokes: no hold (the old Detail put ${oldHoldsSine} there), ${xs} other points on 16 half-strokes`);
  ok(xs <= 3, `rounded strokes: at most a stray point (${xs})`);
  // the generated tops are flat, the trace there drifts down a few pos before the fall (the strokes step's drift removal
  // tilts a long plateau): a slow transition, which By render marks with a point rather than a flat pair
  const dw = count(G, FLAT, /^(hold|shoulder|mid)$/);
  ok(dw >= 4, `flat tops: a point marks the dwell on ${dw} of 6 (${hf} of them flat holds; the old Detail: ${oldHoldsFlat} flat holds)`);
  ok(ps >= 6, `slow-then-fast out-moves: ${ps} points on 8`);
  // 3. the device's curve on the Tracker lane
  const geo = await page.evaluate(() => { const c = document.querySelector('canvas[aria-label="Tracker signals"]'), r = c.getBoundingClientRect(); return { n: +(c.dataset.renderFit || 0), pt: +(c.dataset.padT || 14), pb: +(c.dataset.padB || 12), w: r.width, h: r.height, d: window.devicePixelRatio || 1, start: app.view.start, span: app.view.span, hi: getComputedStyle(document.documentElement).getPropertyValue('--tx-hi').trim() }; });
  ok(geo.n > 50, `the Tracker lane draws the rendered fit (${geo.n} samples)`);
  const laneY = (h, x) => geo.pt + (1 - x) * (h - geo.pt - geo.pb), X = (t) => ((t - geo.start) / geo.span) * geo.w;
  const ts = Array.from({ length: 60 }, (_, k) => 600 + (k * (END - 1200)) / 59), ys = renderScript(G.map((p) => ({ at: p.at, pos: p.pos })), ts);
  const px = await page.evaluate(({ P, d }) => { const c = document.querySelector('canvas[aria-label="Tracker signals"]'), x = c.getContext('2d'); return P.map(([u, v]) => { let best = 0; for (let dy = -1; dy <= 1; dy++) { const q = x.getImageData(Math.round(u * d), Math.round((v + dy) * d), 1, 1).data; best = Math.max(best, (q[0] + q[1] + q[2]) / 3); } return best; }); }, { P: ts.map((t, k) => [X(t), laneY(geo.h, ys[k] / 100)]), d: geo.d });
  const lit = px.filter((v) => v > 150).length;
  ok(lit >= 0.6 * px.length, `its light line is painted where the device's curve is: ${lit}/${px.length} samples lit`);
  await shot('detail-render-lane', page.locator('canvas[aria-label="Tracker signals"]'));
  // 4. the machine preview against the generated strokes
  await page.evaluate(() => { app.settings.set('review.profile', 'nucleus-capstan'); app.devicePreview.toggle(true); });
  // the machine preview's plan; after a change, the one planned for the new points (not the last one still up)
  const prev = async (not = null) => { await page.waitForFunction((not) => app.doc.ghosts.some((g) => g.id === 'device-preview' && g.samples?.pos?.length && g.samples !== window.__lastPlan && (not == null || g.script?.length !== not)), null, { timeout: 30000 }); await settle(); return page.evaluate(() => { const g = app.doc.ghosts.find((x) => x.id === 'device-preview'); window.__lastPlan = g.samples; return { t0: g.samples.t0, pos: Array.from(g.samples.pos), n: g.script?.length }; }); };
  const lane = await page.evaluate(() => { const r = TR.runs[0]; return { t: Array.from(r.lane.t), v: Array.from(r.lane.v) }; });
  const errOf = (P, S) => {   // the trace (the Tracker lane's fused signal) mapped onto the preview's depth by least squares (its range and offset), then RMS
    const at = (t) => S.pos[Math.max(0, Math.min(S.pos.length - 1, Math.round(t - S.t0)))];
    const d = (t) => { let lo = 0, hi = lane.t.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lane.t[m] <= t) lo = m; else hi = m; } return lane.v[lo] + ((lane.v[hi] - lane.v[lo]) * (t - lane.t[lo])) / (lane.t[hi] - lane.t[lo] || 1); };
    const ts = []; for (let t = 600; t < END - 600; t += 5) ts.push(t);
    const mx = ts.reduce((s, t) => s + d(t), 0) / ts.length, my = ts.reduce((s, t) => s + at(t), 0) / ts.length;
    let sxx = 0, sxy = 0; for (const t of ts) { sxx += (d(t) - mx) ** 2; sxy += (d(t) - mx) * (at(t) - my); }
    const a = sxy / sxx, b = my - a * mx;
    return Math.sqrt(ts.reduce((s, t) => s + (at(t) - (a * d(t) + b)) ** 2, 0) / ts.length);
  };
  const P1 = await prev(), eNew = errOf(G, P1);
  const pv = await page.evaluate(() => app.doc.ghosts.find((g) => g.id === 'device-preview')?.name || '');
  ok(/Nucleus Capstan, kinetic/.test(pv), `the machine preview runs the Capstan's planner: "${pv}"`);
  await page.evaluate(() => app.redo());   // the old Detail again: its machine preview for comparison
  await settle();
  ok(/[+]mid[+]hold/.test(await chip.innerText()), 'redo: the old Detail');
  const eOld = errOf(await ghost(), await prev());   // (a new plan: the samples object changes)
  ok(eNew <= 8 && eNew <= eOld + 0.25, `machine preview vs the trace: By render ${eNew.toFixed(2)} pos RMS, the old Detail ${eOld.toFixed(2)}`);
  await page.evaluate(() => app.undo());
  await settle();
  await shot('detail-render-window');
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failed` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
