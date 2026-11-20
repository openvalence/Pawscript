// dev/acttrack-check.mjs -- paw-qoo5 "select an action that fits in one cut and track just that action", in YOUR test instance
// (node dev/test-app.mjs start ...; the CDP_* env it prints; the fake sidecar), real CDP mouse and keys, on a copy of a clip.
// One shot (no cut), two action regions on the main line: A (slit masturbation, ~20-40 %) and B (slit penetration, ~55-80 %),
// the parts painted on a frame inside B.
//   1. the orange notch's tip (the action changes inside the shot) offers both ways, with the keys as bound;
//   2. Track tab: a click on B selects B (not the shot); T takes B's span as the range (the fake sidecar has no grid tracker:
//      the Track itself goes through Ctrl+T, the same path: commands.js own / tracking.svelte.js runTrack);
//   3. Ctrl+T: one run over exactly B, B's tags in the request and on the run (run.act); its range on the run strip; A and the
//      rest of the shot play no run;
//   4. Ctrl+T again: B's run replaced (one run, a new id, the same range);
//   5. A selected (nothing painted inside it): refused, "Paint the parts on a frame inside this action first", no new run;
//   6. nothing selected: Ctrl+T tracks the shot at the playhead as before (no act on the run, no act tags sent).
//   node dev/acttrack-check.mjs <clip.mp4>     exits 1 on any FAIL
import { copyFileSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { stripLayout, bandsIn } from '../src/features/timeline/actions-strip.js';

const src = process.argv[2];
if (!src) { console.error('usage: node dev/acttrack-check.mjs <clip.mp4>'); process.exit(2); }
const clip = join(dirname(resolve(src)), 'acttrack-' + basename(src));
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms), J = JSON.stringify;
async function geo() {
  const g = await ev(() => { const c = document.querySelector('[data-tl-lane="scenes"] canvas').getBoundingClientRect(); return { left: c.left, top: c.top, w: c.width, h: c.height, v: { ...app.view }, acts: app.doc.acts || [] }; });
  const L = stripLayout(g.h, bandsIn(g.acts, g.v.start, g.v.start + g.v.span));
  return { x: (t) => g.left + ((t - g.v.start) / g.v.span) * g.w, yMain: g.top + (L.main.y0 + L.main.y1) / 2, yShots: g.top + (L.y1 + g.h) / 2 };
}
const state = () => ev(() => { const tr = __pawDev.trackingFor(app); return {
  act: __pawDev.tl.act, range: app.doc.range && [Math.round(app.doc.range.t0), Math.round(app.doc.range.t1)],
  runs: tr.runs.filter((r) => !r.tag).map((r) => ({ id: r.id, range: [Math.round(r.range.start), Math.round(r.range.end)], act: r.act || null })),
  ranges: tr.runRanges.map((r) => ({ run: r.run, t0: Math.round(r.t0), t1: Math.round(r.t1) })), busy: tr.busy }; });
const trackKey = async (runs = true) => {
  const n0 = await ev(() => { const tr = __pawDev.trackingFor(app); tr.selectTracker('fake.groups'); tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.4, h: 0.4, t_ms: app.player.timeMs }; document.activeElement?.blur?.(); window.__req = []; return tr.runs.map((r) => r.id).join(); });
  await page.keyboard.press('Control+KeyT');
  // 8c50451: with several parts painted Ctrl+T asks which at the pointer; its last row tracks every painted part (what this
  // check was written for: the parts' run over the selected action)
  const every = page.locator('[role=menu] [role^=menuitem]', { hasText: /Every painted part/ });
  if (await every.first().waitFor({ timeout: 1500 }).then(() => true, () => false)) await every.first().click();
  if (runs) await page.waitForFunction((n) => { const tr = __pawDev.trackingFor(app); return !tr.busy && tr.runs.map((r) => r.id).join() !== n; }, n0, { timeout: 60000 }).catch(() => {});
  await wait(runs ? 1200 : 800);
};
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 60000 });
  await ev(async () => { for (const c of (await app.backend.autosaveList()) || []) await app.backend.autosaveClear(c.id); });
  const opening = ev((p) => app.project.openVideo(p, { force: true }), clip).catch(() => {});
  for (let k = 0; k < 8; k++) { await wait(500); await ev(() => { const d = app.dialog; if (d) d.resolve(/^Recover|Save changes/.test(d.title || '') ? 'discard' : /^Replace/.test(d.title || '') ? 'replace' : d.choices?.[0]?.id ?? null); }); }
  await opening;
  await page.waitForFunction(() => (app.doc.media?.durationMs || 0) > 5000 && app.player.ready, null, { timeout: 60000 });
  await page.waitForFunction(() => __pawDev.trackingFor(app).trackers.length > 0, null, { timeout: 30000 });
  const D = await ev(() => app.durationMs), fm = await ev(() => app.player.frameMs || 1000 / 30);
  const F = (u) => Math.round(Math.round((u * D) / fm) * fm);   // on a frame start
  const A = { id: 'actA', kind: 'act', t0: F(0.2), t1: F(0.4), layer: 0, tags: ['slit', 'masturbation'], roles: [] };
  const B = { id: 'actB', kind: 'act', t0: F(0.55), t1: F(0.8), layer: 0, tags: ['slit', 'penetration'], roles: [] };
  await ev(([A, B, D, tp]) => {
    app.setMode('track'); app.setView?.({ start: 0, span: D }); app.player.pause();
    const SQ = (x, y) => [[x, y], [x + 0.12, y], [x + 0.12, y + 0.12], [x, y + 0.12]];
    const groups = [{ name: 'c2_penis', who: 'c2', part: 'penis', poly: SQ(0.3, 0.45), pinned: true, t_ms: tp, source: 'user' }, { name: 'c1_hips', who: 'c1', part: 'hips', poly: SQ(0.6, 0.45), pinned: true, t_ms: tp, source: 'user' }];
    app.transact('setup', () => { app.doc.scenes = [{ start_ms: 0, end_ms: D, groups }]; app.doc.acts = [A, B]; });
    app.doc.range = null; __pawDev.tl.act = null;
    window.__t = []; const o = app.toast.bind(app); app.toast = (m, ...r) => { __t.push(String(m)); return o(m, ...r); };
    const tr = __pawDev.trackingFor(app), j = tr.job.bind(tr); tr.job = (label, req, opt) => { if (req?.cmd === 'track') window.__req.push(req); return j(label, req, opt); };
  }, [A, B, D, F(0.6)]);
  await wait(800);
  const acts = await ev(() => (app.doc.acts || []).map((r) => `${r.id}:${r.t0}-${r.t1}:${r.tags.join('+')}`));
  ok(acts.length === 2, `two regions in one shot (${J(acts)})`);
  // 1. the notch's tip at B's start
  let g = await geo();
  await page.mouse.move(g.x(B.t0) - 3, g.yShots); await page.mouse.move(g.x(B.t0), g.yShots, { steps: 2 }); await wait(500);
  const tip = await ev(() => [...document.querySelectorAll('.k-tip .txt')].map((e) => e.textContent).join(' / '));
  const keys = await ev(() => ({ t: app.commands.keysFor('track.gridFrame')?.[0], k: app.commands.keysFor('timeline.key.cut')?.[0] }));
  ok(tip.includes(`select an action and press ${keys.t} to track just it, or cut here (${keys.k})`), `the notch offers both ways with the bound keys (${keys.t}, ${keys.k}): "${tip.slice(0, 220)}"`);
  // 2. a click on B (Track tab) selects B; T takes its span
  g = await geo();
  await page.mouse.click(g.x((B.t0 + B.t1) / 2), g.yMain); await wait(400);
  let s = await state();
  ok(s.act === B.id && J(s.range) === J([B.t0, B.t1]), `Track tab: a click on B selects B, the range is its span (act ${s.act}, range ${J(s.range)})`);
  await ev(() => { app.doc.range = null; document.activeElement?.blur?.(); }); await page.keyboard.press('KeyT'); await wait(600);
  s = await state();
  ok(J(s.range) === J([B.t0, B.t1]), `T with B selected: the range is B's span (${J(s.range)}; toast "${(await ev(() => __t.at(-1) || '')).slice(0, 80)}")`);
  // 3. Ctrl+T: one run over exactly B
  await ev((t) => app.player.seek(t), F(0.65));
  await trackKey();
  s = await state();
  const req = await ev(() => window.__req.map((r) => ({ s: r.start_ms, e: r.end_ms, tags: r.tags || [] })));
  const r1 = s.runs[0];
  ok(s.runs.length === 1 && J(r1.range) === J([B.t0, B.t1]), `one run over exactly B (${J(s.runs.map((r) => r.range))}; B ${B.t0}-${B.t1})`);
  ok(J(r1?.act?.tags) === J(B.tags) && r1.act.id === B.id, `the run carries B's tags (${J(r1?.act)})`);
  // req[0] is the run's own request; a camera reference track over the same range may follow (tagged, internal: no act)
  ok(req[0]?.s === B.t0 && req[0].e === B.t1 && B.tags.every((x) => req[0].tags.includes(x)) && !req[0].tags.includes('masturbation'), `the tracker is told B's tags, not A's (${J(req)})`);
  ok(s.ranges.length === 1 && s.ranges[0].run === r1.id && s.ranges[0].t0 === B.t0 && s.ranges[0].t1 === B.t1, `its range on the strip is B's span, nothing else plays (A and the rest of the shot: no run) (${J(s.ranges)})`);
  ok((await ev((id) => document.querySelectorAll(`[data-testid="run-range"][data-run="${id}"]`).length, r1.id)) === 1, 'the run strip draws it');
  // 4. again: replaced
  await trackKey();
  s = await state();
  ok(s.runs.length === 1 && s.runs[0].id !== r1.id && J(s.runs[0].range) === J([B.t0, B.t1]) && s.ranges.length === 1 && s.ranges[0].run === s.runs[0].id, `Ctrl+T again on B: its run replaced (${J(s.runs.map((r) => r.id))}, ranges ${J(s.ranges)})`);
  const r2 = s.runs[0];
  // 5. A: nothing painted inside it
  g = await geo();
  await page.mouse.click(g.x((A.t0 + A.t1) / 2), g.yMain); await wait(400);
  s = await state();
  ok(s.act === A.id, `a click on A selects A (${s.act})`);
  await ev(() => { window.__t = []; });
  await trackKey(false);
  s = await state();
  const t5 = await ev(() => __t.join(' | '));
  ok(s.runs.length === 1 && s.runs[0].id === r2.id && /Paint the parts on a frame inside this action first/.test(t5), `A with the parts painted only outside it: refused, no run ("${t5.slice(0, 120)}")`);
  // 6. nothing selected: as before (the shot at the playhead)
  await ev((t) => { __pawDev.tl.act = null; app.doc.range = null; app.player.seek(t); }, F(0.62));
  await trackKey();
  s = await state();
  const req6 = await ev(() => window.__req.map((r) => ({ s: r.start_ms, e: r.end_ms, tags: r.tags || [] })));
  ok(s.runs.length === 1 && J(s.runs[0].range) === J([0, D]) && !s.runs[0].act && req6.length >= 1 && req6.every((r) => !r.tags.includes('penetration')), `nothing selected: the whole shot as before, no act on the run or in the request (${J(s.runs)}; ${J(req6)})`);
} catch (e) { fails++; console.log('FAIL [threw]', String(e?.message || e).slice(0, 400)); } finally {
  await ev(() => app.project.close?.({ force: true })).catch(() => {});
  console.log(fails ? `${fails} FAIL` : 'all ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
