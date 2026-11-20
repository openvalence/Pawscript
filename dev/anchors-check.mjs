// dev/anchors-check.mjs -- paw-wg2d / paw-ze8n: anchors in the REAL window (your test instance: node dev/test-app.mjs start ...;
// CDP_* env). A generated clip, a synthetic run that "starts off then corrects" (experiments/anchors/measure.mjs flipStart)
// linked to 'fused'. Asserts on what is painted and on the fused trace:
//   1. the keys (Alt+0 / Alt+Shift+0 / Alt+M) at the playhead add anchors, several of each kind; a diamond per anchor is painted
//      on the Tracker row at its frame, fully in low and fully out high;
//   2. the fused trace changes in the bad part and not past the anchored section;
//   3. a diamond dragged moves its anchor frame by frame (one undo step); click + Delete removes it; Ctrl+Z brings it back;
//      the same key on an anchor's frame takes it off.
//   node dev/anchors-check.mjs <clip.mp4> [SHOT_DIR=<dir>]
import { resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { CASES, CUT, anchorsFor } from '../experiments/anchors/measure.mjs';

const clip = process.argv[2], shots = process.env.SHOT_DIR || null;
if (!clip) { console.error('usage: node dev/anchors-check.mjs <clip.mp4>'); process.exit(2); }
const run0 = CASES.flipStart();
const chans = Object.fromEntries(Object.entries(run0.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a);
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 60000 });
  await ev((p) => app.project.openVideo(p, { force: true }), resolve(clip)).catch(() => {});
  await page.waitForFunction(() => (app.doc.media?.durationMs || 0) > 20000, null, { timeout: 60000 });
  await ev((chans) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    app.setMode('track');
    app.doc.scenes = [{ start_ms: 0, end_ms: 20000, tags: ['penetration'] }];
    const T = Object.values(chans)[0].map(([t]) => t);
    const run = D.makeRun({ n: 7, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: 20000 }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: chans, notes: [] },
      frames: D.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    window.RID = run.id;
    tr.linkScene(0, run.id, 'fused');
    app.setView({ start: 0, span: 20000 });
    window.fz = () => Array.from(TR.run(RID)?.channels?.fused?.v || []);
    window.hist = () => app._history.index;
    window.anchors = () => (app.doc.scenes[0].anchors || []).map((a) => [a.ms, a.pos]);
  }, chans);
  await page.waitForTimeout(500);
  const v0 = await ev(() => fz());
  ok(v0.length > 500, `the run is fused (${v0.length} samples)`);
  const KEY = { 0: 'Alt+Digit0', 100: 'Alt+Shift+Digit0', 50: 'Alt+KeyM' };
  // the key acts on the playhead's frame: wait for the seek to land there (a slower machine had not: the anchor went elsewhere)
  const press = async (ms, pos) => { await ev((t) => { document.activeElement?.blur?.(); app.player.seek(t); }, ms); await page.waitForFunction((t) => Math.abs(app.player.timeMs - t) < (app.player.frameMs || 33), ms, { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(120); await page.keyboard.press(KEY[pos]); await page.waitForTimeout(120); };
  // nothing of the open still landing (a background pass rewriting the shots would drop the first anchors)
  await page.waitForFunction(() => !app.tasks?.length, null, { timeout: 30000 }).catch(() => {});
  await ev(() => { window.__toasts = []; const o = app.toast.bind(app); app.toast = (m, ...a) => { window.__toasts.push(String(m)); return o(m, ...a); }; });
  // ---- 1. keys: 2 in + 2 out on the bad part, one more fully in two frames after the first, a middle ----
  const marks = anchorsFor(2, 0, 0, CUT), extraIn = { ms: marks[0].ms + 67, pos: 0 };
  for (const a of marks) await press(a.ms, a.pos);
  await press(extraIn.ms, 0);
  const mid = { ms: Math.round((marks[0].ms + marks[2].ms) / 2), pos: 50 };
  await press(mid.ms, 50);
  await page.waitForTimeout(600);
  const list = await ev(() => anchors());
  console.log('toasts', JSON.stringify(await ev(() => window.__toasts)), 'shots', await ev(() => app.doc.scenes.length));
  ok(list.filter(([, p]) => p === 0).length === 3 && list.filter(([, p]) => p === 100).length === 2 && list.filter(([, p]) => p === 50).length === 1, `several of each kind from the keys: ${JSON.stringify(list)}`);
  const painted = await ev(() => [...document.querySelectorAll('[data-testid="anchor-mark"]')].map((e) => { const r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect(); return { pos: +e.dataset.pos, x: r.left + r.width / 2 - p.left, y: (r.top + r.height / 2 - p.top) / p.height, w: p.width }; }));
  ok(painted.length === list.length, `a diamond per anchor painted on the Tracker row (${painted.length})`);
  const xOf = (ms) => (ms / 20000) * painted[0].w;
  ok(painted.every((d) => list.some(([ms, p]) => p === d.pos && Math.abs(xOf(ms) - d.x) < 3)), 'each at its frame');
  ok(painted.filter((d) => d.pos === 0).every((d) => d.y > 0.75) && painted.filter((d) => d.pos === 100).every((d) => d.y < 0.25), 'fully in painted low, fully out high');
  if (shots) await page.screenshot({ path: shots + '/anchors-row.png' });
  // ---- 2. the fused trace: changed in the bad part, untouched past the anchored section ----
  const v1 = await ev(() => fz()), sec = await ev(() => TR.fuseInfo(0)?.anchors?.sections || []);
  const end = Math.max(...sec.map((s) => s.t1)), q1 = Math.ceil((end / 1000) * 30) + 1;
  let changed = 0, after = 0;
  for (let i = 0; i < v0.length; i++) { if (i < (CUT * 0.9) && Math.abs(v1[i] - v0[i]) > 0.05) changed++; if (i >= q1 && !Object.is(v1[i], v0[i])) after++; }
  ok(changed > 50, `the fused trace changed in the bad part (${changed} samples)`);
  ok(sec.length >= 1 && end < 9500 && after === 0, `untouched past the anchored section (${end} ms; ${after} samples differ after it)`);
  // ---- 3. drag, click + Delete, undo, the same key on its frame ----
  // (the last fully-out diamond: no other diamond overlaps it at this zoom; the two fully-in ones 2 frames apart do)
  const target = { pos: 100 }, h0 = await ev(() => hist());
  const box = await page.locator('[data-testid="anchor-mark"][data-pos="100"]').last().boundingBox();
  const last = (a) => (app.doc.scenes[0].anchors || []).filter((x) => x.pos === a.pos).sort((x, y) => y.ms - x.ms)[0].ms;
  const want = await ev(last, target);
  const px = painted[0].w / 20000 * (1000 / 30);   // one frame in px
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  for (let k = 1; k <= 6; k++) { await page.mouse.move(box.x + box.width / 2 + (k * 3 * px) / 6, box.y + box.height / 2); await page.waitForTimeout(40); }
  await page.mouse.up(); await page.waitForTimeout(500);
  const after1 = await ev(last, target);
  ok(Math.abs(after1 - want - 100) <= 34 && (await ev(() => hist())) - h0 === 1, `a drag moves it about 3 frames (${want} -> ${after1}), one undo step`);
  const n0 = (await ev(() => anchors())).length;
  const b2 = await page.locator('[data-testid="anchor-mark"][data-pos="50"]').first().boundingBox();
  await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.waitForTimeout(150);
  await page.keyboard.press('Delete'); await page.waitForTimeout(400);
  const n1 = (await ev(() => anchors())).length;
  ok(n1 === n0 - 1 && (await page.locator('[data-testid="anchor-mark"]').count()) === n1, `click + Delete removes it (${n0} -> ${n1}), its diamond goes`);
  await ev(() => document.activeElement?.blur?.()); await page.keyboard.press('Control+KeyZ'); await page.waitForTimeout(400);
  ok((await ev(() => anchors())).length === n0, 'Ctrl+Z brings it back');
  await press(extraIn.ms, 0); await page.waitForTimeout(300);
  ok((await ev(() => anchors())).length === n0 - 1 && !(await ev(() => anchors())).some(([ms]) => ms === extraIn.ms), 'the same key on its frame takes it off');
  await page.keyboard.press('Space'); await page.waitForTimeout(200);
  ok(await ev(() => app.player.playing), 'Space still plays');
  await page.keyboard.press('Space');
} catch (e) { fails++; console.log('FAIL', e?.stack || e); }
await browser.close();
console.log(fails ? `${fails} failure(s)` : 'all ok');
process.exit(fails ? 1 : 0);
