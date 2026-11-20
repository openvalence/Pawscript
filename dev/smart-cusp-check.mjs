// dev/smart-cusp-check.mjs -- paw-6t7d in the REAL window (your test instance: node dev/test-app.mjs start ...; CDP_* env).
// The owner's shot as a generated run (test/how-synth.mjs kind 'cusp'): 14 fast full-range strokes (465 ms) with a sharp deep
// turn and a round top, linked to 'fused' with Smart stroke on, plus a SAM shaft that is confident on every frame but does
// not follow the stroke (the owner's r -0.11). It asserts what is painted:
//   1. for each DEPTH (auto, scene, follow, each, shaft) the Detail chip on the Tracker lane says points were placed
//      ("render N/M", N > 0); with the shot's Max speed at 500 (the cap these strokes run into) it adds "· speed cap";
//   2. the generic device curve of the points (the lane's light line) and the machine preview (Capstan, Kinetic2) stay
//      within 12 pos RMS of the trace (the lane's fused signal mapped onto the points' depth), and closer than the bare
//      triangle's (Detail 'turns');
//   3. the Adjust strip's direction line does not contradict itself ("shaft not used: its depth does not follow ..."), and
//      the DEPTH control says the shaft is off here ("shaft · off") instead of silently using the scene's range.
//   SHOT_DIR=<dir> node dev/smart-cusp-check.mjs
import { connectTestApp } from './cdp-connect.mjs';
import { track, howRun } from '../test/how-synth.mjs';
import { renderScript } from '../src/lib/stroke-shape.js';

const shots = process.env.SHOT_DIR || null;
const tr0 = track(Array.from({ length: 14 }, () => ({ kind: 'cusp', T: 465 })));
const run0 = howRun(tr0, { seed: 2 });
const chans = Object.fromEntries(Object.entries(run0.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
// a confident shaft that does not follow the stroke
const T = chans.who_pair_proj.map(([t]) => t);
chans.sem_c2_penis_len = T.map((t) => [t, 0.82 + 0.05 * Math.sin(t / 37) * Math.cos(t / 91)]);
chans.sem_c2_penis_in = T.map((t, i) => [t, 1 - chans.sem_c2_penis_len[i][1]]);
chans.sem_c2_penis_in_conf = T.map((t) => [t, 1]);
// a steady camera and a centroid: the Adjust strip (its direction line and DEPTH control) needs them to adjust the run
for (const [k, v] of [['centroid_x', 0.5], ['centroid_y', 0.5], ['cam_x', 0], ['cam_y', 0]]) chans[k] = T.map((t) => [t, v]);
const END = tr0.t[tr0.N - 1] + 1, A = 300 + 465, B = 300 + 13 * 465;   // scored between the second and the last stroke
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const shot = async (name, loc) => { if (shots) await (loc || page).screenshot({ path: `${shots}/${name}.png` }); };
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
const ghost = () => page.evaluate(() => { const g = TR.ghost(RID), r = TR.runs[0]; return (g?.script || []).map((p) => ({ at: p.at, pos: p.pos, why: TR.whyAt(r, p.at) || '' })); });
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await page.evaluate(({ chans, END }) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'smartcusp001' } };
    app.doc.project = { ...(app.doc.project || {}), path: 'C:\\pawtest\\smart-cusp.pawproj' };
    app.doc.scenes = [{ start_ms: 0, end_ms: END, tags: ['anal', 'penetration'] }];
    const T = chans.who_pair_proj.map(([t]) => t);
    const run = D.makeRun({ n: 4, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: END }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: END - 100, pos: 100 }], channels: chans, notes: [],
        scenes: [{ start_ms: 0, end_ms: END, sign: 1, shaft: { c2_penis: { source: 'sam', full: 'relative', conf_share: 1 } } }] },
      frames: D.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    window.RID = run.id;
    app.setView({ start: 0, span: END });
    tr.linkScene(0, run.id, 'fused');
    tr.setSmart(0, true);
    app.player.seek(3000);
  }, { chans, END });
  await settle();
  const chip = page.locator('[data-testid="detail-chip"]');
  await chip.waitFor({ timeout: 15000 });
  const lane = await page.evaluate(() => { const r = TR.runs[0]; return { t: Array.from(r.lane.t), v: Array.from(r.lane.v) }; });
  const d = (t) => { let lo = 0, hi = lane.t.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lane.t[m] <= t) lo = m; else hi = m; } return lane.v[lo] + ((lane.v[hi] - lane.v[lo]) * (t - lane.t[lo])) / (lane.t[hi] - lane.t[lo] || 1); };
  const ts = []; for (let t = A; t < B; t += 5) ts.push(t);
  /** RMS of curve f against the trace mapped onto it by least squares (the depth policy sets the scale, not the shape). */
  const errOf = (f) => {
    const y = ts.map(f), x = ts.map(d), mx = x.reduce((s, q) => s + q, 0) / x.length, my = y.reduce((s, q) => s + q, 0) / y.length;
    let sxx = 0, sxy = 0; x.forEach((q, i) => { sxx += (q - mx) ** 2; sxy += (q - mx) * (y[i] - my); });
    const a = sxy / sxx, b = my - a * mx;
    return Math.sqrt(y.reduce((s, q, i) => s + (q - (a * x[i] + b)) ** 2, 0) / y.length);
  };
  const generic = (G) => { const R = renderScript(G.map((p) => ({ at: p.at, pos: p.pos })), ts); return (t) => R[Math.round((t - A) / 5)]; };
  await page.evaluate(() => { app.settings.set('review.profile', 'nucleus-capstan'); app.devicePreview.toggle(true); });
  const prev = async () => { await page.waitForFunction(() => app.doc.ghosts.some((g) => g.id === 'device-preview' && g.samples?.pos?.length && g.samples !== window.__lastPlan), null, { timeout: 30000 }); await settle(); return page.evaluate(() => { const g = app.doc.ghosts.find((x) => x.id === 'device-preview'); window.__lastPlan = g.samples; return { t0: g.samples.t0, pos: Array.from(g.samples.pos) }; }); };
  const machine = (S) => (t) => S.pos[Math.max(0, Math.min(S.pos.length - 1, Math.round(t - S.t0)))];
  // the bare triangle for comparison: Detail 'turns' on this shot, then back (one undo step)
  await page.evaluate(() => TR.setDetailAt(0, 'shot', { shape: 'turns', sens: 50 }));
  await settle();
  const Gt = await ghost(), eTriGen = errOf(generic(Gt)), eTriK = errOf(machine(await prev()));
  await page.evaluate(() => app.undo());
  await settle();
  for (const range of ['auto', 'scene', 'follow', 'local', 'shaft']) {
    await page.evaluate((range) => TR.setDerive(0, { strokes: { range: range === 'auto' ? undefined : range } }, { label: 'depth ' + range }), range);
    await settle();
    const txt = await chip.innerText(), m = /render (\d+)\/(\d+)/.exec(txt), G = await ghost();
    const extra = G.filter((p) => p.at > A && p.at < B && /^(mid|shoulder|hold)$/.test(p.why)).length;
    ok(m && +m[1] > 0, `DEPTH ${range}: the chip says points were placed: "${txt}" (${extra} between turns in the scored span)`);
    const eGen = errOf(generic(G)), eK = errOf(machine(await prev()));
    ok(eGen <= 12 && eGen < eTriGen, `DEPTH ${range}: device curve vs trace ${eGen.toFixed(2)} pos RMS (bare triangle ${eTriGen.toFixed(2)})`);
    ok(eK <= 12 && eK < eTriK, `DEPTH ${range}: machine preview vs trace ${eK.toFixed(2)} pos RMS (bare triangle ${eTriK.toFixed(2)})`);
  }
  // the speed cap named on the chip where it limited the shape: these strokes no longer reach the 600 default (2c7e027 raised it
  // on purpose), so the shot's own Max speed is pinned to 500, as test/smart-cusp.test.mjs does (paw-08cm); back to auto depth
  await page.evaluate(() => TR.setDerive(0, { strokes: { range: undefined, maxSpeed: 500 } }, { label: 'max speed 500' }));
  await settle();
  const capTxt = await chip.innerText();
  ok(/render [1-9]\d*\/\d+ · speed cap/.test(capTxt), `with the shot's Max speed at 500 the chip names the speed cap: "${capTxt}"`);
  await shot('smart-cusp-lane', page.locator('canvas[aria-label="Tracker signals"]'));
  // 3. the Adjust strip
  const line = page.locator('[data-testid="shaft-direction"]');
  // 145370e (paw-p8o2): the Adjust strip lives only in the band under the stroke lane: unfold it (its ▾) when it is folded
  if (!(await line.count())) await page.evaluate(() => document.querySelector('[data-testid="inspector-more"]')?.click());
  await settle();
  if (await line.count()) {
    const s = await line.innerText();
    // the shaft's r with this signal is ~0 by construction: printed "r 0" when it rounds to nothing
    ok(/shaft not used: its depth does not follow this signal \(r -?0(\.\d+)?\)/.test(s) && !/confident/.test(s), `the direction line: "${s}"`);
    const opt = page.locator('[data-testid="strokes-depth"] [role="radio"]', { hasText: 'shaft' });
    ok((await opt.count()) === 1 && /shaft · off/.test(await opt.innerText()), `the DEPTH control says the shaft is off here: "${(await opt.count()) ? await opt.innerText() : ''}"`);
    await shot('smart-cusp-strip', page.locator('[data-testid="strokes-depth"]'));
  } else ok(false, 'the Adjust strip is not on screen');
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failed` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
