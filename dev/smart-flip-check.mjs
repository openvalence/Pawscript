// dev/smart-flip-check.mjs -- paw-s80k in the REAL window (your test instance: node dev/test-app.mjs start ...; CDP_* env).
// A generated run (test/how-synth.mjs: impact and slow-out strokes, painted parts that fuse) whose shot plays a channel of
// its own read the other way up from fusion's convention ('inv': a relative / camera-removed channel has its own sign
// rule). It asserts what is painted and what the ghost holds:
//   1. Smart stroke on (its button in the Adjust strip, else the store): the painted trace is the same way up as before
//      (how high the lane is painted at the first top and the first deep turn: the top stays above), and so are the ghost points
//      (they correlate with the points before, and with the grey "Without Smart stroke" ghost); the direction strip says so;
//   2. F: the exact mirror (every ghost point pos -> 100 - pos, the same times), the painted rows swap;
//   3. Smart stroke off and on again: the same points as after 2.
//   SHOT_DIR=<dir> node dev/smart-flip-check.mjs [clip.mp4 >= 13 s, default: a copy of dev/assets/cfr2997.mp4 (60 s)]
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { connectTestApp } from './cdp-connect.mjs';
import { track, howRun } from '../test/how-synth.mjs';

const shots = process.env.SHOT_DIR || null;
// 0d33bfa (paw-3cbm): F needs a video open (and flips the run that PLAYS at the playhead), so the synthetic run sits on a real
// clip longer than the run (a fake media path set over the run would recompose it from nothing), as dev/direction-check.mjs
const dir = shots || join(tmpdir(), 'paw-smart-flip-check');
mkdirSync(dir, { recursive: true });
const clip = resolve(process.argv[2] || join(dir, `smart-flip-${Date.now()}.mp4`));
if (!process.argv[2]) copyFileSync(new URL('./assets/cfr2997.mp4', import.meta.url), clip);
const many = (n, s) => Array.from({ length: n }, () => ({ ...s }));
const tr0 = track([...many(8, { kind: 'impact', T: 800, rest: 0.45 }), ...many(8, { kind: 'slowout', T: 700 })]);
const run0 = howRun(tr0, { seed: 3 });
const chans = Object.fromEntries(Object.entries(run0.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
chans.inv = tr0.t.map((t, i) => [t, 1 - tr0.d[i] + 0.01 * Math.sin(i * 12.9898)]);
const T = tr0.t;
for (const [k, v] of [['centroid_x', 0.5], ['centroid_y', 0.5], ['cam_x', 0], ['cam_y', 0]]) chans[k] = T.map((t) => [t, v]);
const END = tr0.t[tr0.N - 1] + 1;
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const shot = async (name, loc) => { if (shots) await (loc || page).screenshot({ path: `${shots}/${name}.png` }); };
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
const grid = (p) => { const out = []; let j = 0; for (let x = 1500; x < END - 1500; x += 20) { while (j + 1 < p.length && p[j + 1][0] <= x) j++; const a = p[j], b = p[j + 1]; out.push(b && b[0] > a[0] ? a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]) : a[1]); } return out; };
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  const opening = page.evaluate((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 40 && !(await page.evaluate(() => !!(app.doc.media?.path && app.player.ready))); k++) {
    await page.waitForTimeout(500);
    await page.evaluate(() => { const d = app.dialog; if (d) d.resolve(d.choices?.some((c) => c.id === 'discard') ? 'discard' : d.choices?.[0]?.id ?? null); });
  }
  await opening.catch(() => {});
  await page.waitForFunction(() => app.doc.media?.path && app.player.ready, null, { timeout: 60000 });
  await page.evaluate(({ chans, END }) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    // the Tracker row (its canvas, its direction strip) is a Refine / Review row: the Track tab's combined lane has neither
    // since 84468ba / 0d4d3ae (paw-unuy)
    app.setMode('refine'); app.layout.setRow('tracking', { collapsed: false });   // hidden there by default (tracking/lane.js)
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080 };   // the clip's own project (beside it) and hash
    app.doc.scenes = [{ start_ms: 0, end_ms: END, tags: ['anal', 'penetration'] }];
    const T = chans.who_pair_proj.map(([t]) => t);
    const run = D.makeRun({ n: 5, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: END }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: END - 100, pos: 100 }], channels: chans, notes: [], scenes: [{ start_ms: 0, end_ms: END, sign: 1 }] },
      frames: D.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    window.RID = run.id;
    app.setView({ start: 0, span: END });
    tr.linkScene(0, run.id, 'inv');
    app.player.seek(3000);
    window.sig = () => (TR.ghost(RID).script || []).map((p) => [p.at, p.pos]);
    window.ab = () => (app.doc.ghosts.find((g) => g.id === 'smart-ab')?.script || []).map((p) => [p.at, p.pos]);
    // the Tracker row as painted: per column, the mean height of what is drawn bright there (the trace, the device curve over
    // it and the points' marks), as the lane's value (lib/lane.js laneY: 1 = the top of the drawing area, 0 = its bottom;
    // the time ruler's labels above it and the fused weight strip below it left out)
    window.rowAt = (ms) => {
      const c = document.querySelector('canvas[aria-label="Tracker signals"]'), g = c.getContext('2d'), dpr = c.width / c.clientWidth, H = c.clientHeight, pt = +(c.dataset.padT || 14), pb = +(c.dataset.padB || 12);
      const x = Math.round((ms / END) * c.width), d = g.getImageData(x - 1, 0, 3, c.height).data, vs = [];
      for (let y = Math.ceil(13 * dpr); y <= Math.floor((H - 11) * dpr); y++) for (let k = 0; k < 3; k++) { const q = (y * 3 + k) * 4; if (Math.max(d[q], d[q + 1], d[q + 2]) > 110 && d[q + 3] > 100) vs.push(1 - (y / dpr - pt) / (H - pt - pb)); }
      return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
    };
  }, { chans, END });
  await page.waitForSelector('.strip .seg.sign', { timeout: 15000 });
  await settle(); await page.waitForTimeout(800);
  const off = await page.evaluate(() => sig());
  // the first out turn and the first deep turn of the shot as it plays now (pos high = out)
  const turns = off.filter((p, i) => i > 0 && i + 1 < off.length && (p[1] - off[i - 1][1]) * (off[i + 1][1] - p[1]) < 0 && p[0] > 1500);
  const top = turns.find((p) => p[1] > 70), deep = turns.find((p) => p[1] < 30);
  ok(!!top && !!deep, `before: a top at ${top?.[0]} ms (${top?.[1]}), a deep turn at ${deep?.[0]} ms (${deep?.[1]})`);
  const rows = () => page.evaluate(([a, b]) => [rowAt(a), rowAt(b)], [top[0], deep[0]]);
  const r0 = await rows();
  ok(r0[0] != null && r0[1] != null && r0[0] > r0[1], `painted before: at the top turn the lane is drawn at ${r0[0]?.toFixed(2)} of its height, at the deep turn ${r0[1]?.toFixed(2)}`);
  await shot('smart-flip-before', page.locator('canvas[aria-label="Tracker signals"]'));

  // ---- 1. Smart stroke on ----
  const btn = page.getByRole('button', { name: /Smart stroke: fused \+ strokes/ });
  if (!(await btn.count())) await page.evaluate(() => app.layout?.show?.('tracker'));
  await settle();
  if (await btn.count()) { await btn.first().click(); console.log('     (Smart stroke on by its button)'); } else { await page.evaluate(() => TR.setSmart(0, true)); console.log('     (Smart stroke on by the store: the button is not on screen)'); }
  await settle(); await page.waitForTimeout(800);
  const on = await page.evaluate(() => sig()), abG = await page.evaluate(() => ab());
  ok(JSON.stringify(on) !== JSON.stringify(off), `Smart stroke changed the points (${off.length} -> ${on.length})`);
  const rOn = corr(grid(on), grid(off));
  ok(rOn > 0.6, `Smart stroke on: the ghost points the same way up as before (r ${rOn.toFixed(2)})`);
  ok(abG.length > 10 && corr(grid(on), grid(abG)) > 0.6, `... and as the grey "Without Smart stroke" ghost (r ${abG.length ? corr(grid(on), grid(abG)).toFixed(2) : '-'})`);
  const r1 = await rows();
  ok(r1[0] != null && r1[1] != null && r1[0] > r1[1], `painted with Smart stroke: still high at the top turn (${r1[0]?.toFixed(2)}), low at the deep one (${r1[1]?.toFixed(2)})`);
  const m = await page.evaluate(() => TR.run(RID).match?.[0] || null);
  ok(m && m.flip && m.ref === 'inv', `matched to the shot's channel: ${JSON.stringify(m)}`);
  const tip = await page.evaluate(() => { const b = document.querySelector('.strip .seg.sign'); b?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true })); b?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true; });
  await page.locator('.strip .seg.sign').first().hover(); await page.waitForTimeout(900);
  const tipText = await page.evaluate(() => [...document.querySelectorAll('[role="tooltip"], .tooltip, .tip')].map((e) => e.textContent).join(' | '));
  ok(tip && /plays the same way up as inv/.test(tipText), `the direction strip says it: "${(/[^|]*same way up[^|]*/.exec(tipText) || [tipText.slice(0, 160)])[0].trim()}"`);
  await shot('smart-flip-on', page.locator('canvas[aria-label="Tracker signals"]'));

  // ---- 2. F ----
  await page.mouse.move(5, 5);
  await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(400);
  await page.evaluate(() => app.setMode('track')); await settle();   // F (flip the scene at the playhead) is a Track-tab key
  await page.keyboard.press('f');
  await page.evaluate(() => app.setMode('refine'));
  await settle(); await page.waitForTimeout(800);
  ok(JSON.stringify(await page.evaluate(() => TR.run(RID).flips)) === '[0]', 'F flipped the scene');
  const fl = await page.evaluate(() => sig());
  const mirror = on.map(([a, p]) => [a, 100 - p]);
  const diff = fl.length === mirror.length ? fl.filter((q, i) => q[0] !== mirror[i][0] || q[1] !== mirror[i][1]).length : -1;
  ok(diff === 0, `F: the exact mirror of the Smart stroke points (${fl.length} points, ${diff} differ)`);
  const r2 = await rows();
  ok(r2[0] != null && r2[1] != null && r2[0] < r2[1], `painted after F: swapped (at the old top ${r2[0]?.toFixed(2)}, at the old deep turn ${r2[1]?.toFixed(2)})`);

  // ---- 3. off and on again ----
  if (await btn.count()) { await page.getByRole('button', { name: /Smart stroke: on/ }).first().click(); await settle(); await page.waitForTimeout(500); await page.getByRole('button', { name: /Smart stroke: fused \+ strokes/ }).first().click(); }
  else { await page.evaluate(() => TR.setSmart(0, false)); await settle(); await page.evaluate(() => TR.setSmart(0, true)); }
  await settle(); await page.waitForTimeout(800);
  const again = await page.evaluate(() => sig());
  ok(JSON.stringify(again) === JSON.stringify(fl), `Smart stroke off and on again: the same points (${again.length})`);
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failed` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
