// dev/bake-check.mjs -- paw-x7w7 "no Apply / Accept: the tracked script is live, Bake makes it permanent, Refine edits bake what
// they touch", in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a copy of a generated clip
// (dev/assets/cfr30.mp4, dev/assets/make-clips.sh) cut into three shots (the fake sidecar's painted-groups tracker). Asserted:
//   1. Track: nothing baked, the script (app.script, the stroke lane) has the run's points, no "unapplied" anywhere on the page;
//      the position bar follows the script (data-pos = the final at the frame on screen) in the Track tab and in Refine;
//   2. Publish (Ctrl+Alt+S) writes it beside the video (<stem>.funscript: the run's points);
//   3. a source pick on shot 1 changes the run: the next Publish writes different points there;
//   4. Bake (Shift+B over the whole video): one undo step; another source pick changes nothing in the file;
//   5. Unbake shot 2 (live again), then in Refine a point added on shot 2 with a digit key: shot 2 is baked (all its points,
//      the new one in) in ONE undo step, shot 3 untouched.
//   node dev/bake-check.mjs <clip.mp4> <scratch dir>     exits 1 on any FAIL
import { join } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [src, dir] = process.argv.slice(2);
if (!src || !dir) { console.error('usage: node dev/bake-check.mjs <clip.mp4> <scratch dir>'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const clip = join(dir, `bake-${Date.now()}.mp4`), fun = clip.replace(/\.mp4$/, '.funscript');
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
page.on('console', (m) => { if (m.type() === 'error') { fails++; console.log('FAIL [console]', m.text().slice(0, 300)); } });
const answer = () => ev(() => { const d = app.dialog; if (d) d.resolve(d.choices?.some((c) => c.id === 'discard') ? 'discard' : null); });
const fileIn = (t0, t1) => (existsSync(fun) ? JSON.parse(readFileSync(fun, 'utf8')).actions.filter((a) => a.at >= t0 && a.at < t1) : null);
const save = async () => { await page.keyboard.press('Control+Alt+s'); await page.waitForFunction(() => !app.project.busy, null, { timeout: 30000 }); await wait(500); };
const shotOf = (k) => ev((k) => ({ t0: app.doc.scenes[k].start_ms, t1: app.doc.scenes[k].end_ms }), k);

try {
  await ev(() => app.history?.markSaved?.());
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 10; k++) { await wait(400); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await ev(() => { app.setView?.({ start: 0, span: app.durationMs }); app.setMode('track'); app.player.setUi({ posBar: true, sim: true }); });
  // three shots, a hips + a penis painted on each; track the whole video
  await ev(async () => {
    const D = app.durationMs, SQ = (x, y) => [[x, y], [x + 0.12, y], [x + 0.12, y + 0.12], [x, y + 0.12]];
    const g = (t) => [{ name: 'c2_penis', who: 'c2', part: 'penis', poly: SQ(0.3, 0.45), pinned: true, t_ms: t, source: 'user', shaft: true }, { name: 'c1_hips', who: 'c1', part: 'hips', poly: SQ(0.6, 0.45), pinned: true, t_ms: t, source: 'user' }];
    const c = [0, Math.round(D / 3), Math.round((2 * D) / 3), D];
    app.transact('shots', () => { app.doc.scenes = [0, 1, 2].map((k) => ({ start_ms: c[k], end_ms: c[k + 1], tags: ['anal', 'penetration'], groups: g(c[k] + 300) })); });
    const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: D }; app.player.seek(500); await tr.track();
  });
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy && window.__pawDev.trackingFor(app).runs.length > 0, null, { timeout: 120000 })
    .catch(async (e) => { console.log('track state', JSON.stringify(await ev(() => { const tr = window.__pawDev.trackingFor(app); return { busy: tr.busy, err: tr.error, block: tr.trackBlock, media: app.doc.media?.path, tab: app.tabs?.hidden }; }))); throw e; });
  await ev(() => { app.doc.range = null; }); await wait(800);

  // 1. live: nothing baked, the script has the run's points, no "unapplied"
  const st = await ev(() => ({ baked: (app.doc.axes.stroke || []).length, script: app.script.length, lane: document.querySelector('[aria-label^="stroke lane:"]')?.getAttribute('aria-label') || '' }));
  ok(st.baked === 0 && st.script > 20, `after Track nothing is baked and the script has the run's points (${JSON.stringify(st)})`);
  ok(/stroke lane: [1-9]\d* points/.test(st.lane), `the stroke lane draws them as the script: "${st.lane}"`);
  ok(!(await ev(() => /unapplied/i.test(document.body.innerText))), 'no "unapplied" anywhere on the page');
  const follows = async (tab) => {
    await ev((t) => app.setMode(t), tab); await wait(600);
    const rows = [];
    for (const t of [700, 1700, 3300, 5100]) {
      await ev((t) => app.player.seek(t), t); await wait(450);
      rows.push(await ev(() => { const cv = document.querySelector("canvas.pbar"); return { pos: cv?.dataset.pos, src: cv?.dataset.src, t: app.player.shownMs }; }));
    }
    const vals = new Set(rows.map((r) => r.pos));
    ok(vals.size >= 3 && rows.every((r) => r.src !== 'run' && r.pos !== ''), `${tab}: the position bar follows the live script (${JSON.stringify(rows)})`);
  };
  await follows('track');
  await follows('refine');

  // 2. Publish writes it
  await page.waitForFunction(() => !!app.project.path || true, null, { timeout: 5000 });
  await ev(() => app.project.flush?.()); await wait(800);
  await save();
  const s1 = await shotOf(0), w1 = fileIn(s1.t0, s1.t1);
  ok(w1 && w1.length > 5, `Publish wrote the live points beside the video (${w1?.length ?? 'no file'} in shot 1: ${fun.split(/[\\/]/).pop()})`);

  // 3. a source pick on shot 1 -> the next write differs there
  const pick = async () => ev(async (t) => {
    app.player.seek(t); await new Promise((r) => setTimeout(r, 300));
    const tr = window.__pawDev.trackingFor(app), r = tr.runs[0], cur = tr.shotSource?.(r, 0) ?? tr.channelFor(r, 0);
    const chans = Object.keys(r.channels || {}).filter((c) => /_proj$|^proj/.test(c) && c !== cur);
    const to = chans[(window.__bk = ((window.__bk ?? -1) + 1)) % chans.length];
    tr.setSource(to);
    return { from: cur, to, n: chans.length };
  }, s1.t0 + 400);
  const p1 = await pick(); await wait(1200);
  await save();
  const w2 = fileIn(s1.t0, s1.t1);
  ok(JSON.stringify(w2) !== JSON.stringify(w1), `a source pick (${p1.from} -> ${p1.to}) changes the written points of the live shot`);

  // 4. Bake the whole video (Shift+B with the I/O range over it): one undo step; another source pick changes nothing
  const n0 = await ev(() => app.history.entries.length);
  await ev(() => { app.doc.range = { t0: 0, t1: app.durationMs }; document.activeElement?.blur?.(); }); await wait(200);
  await page.keyboard.press('Shift+B'); await wait(500);
  const b = await ev(() => ({ n: app.history.entries.length, label: app.history.undoLabel, baked: app.doc.axes.stroke.length, script: app.script.length }));
  ok(b.n === n0 + 1 && /^Bake/.test(b.label) && b.baked === b.script, `Shift+B baked it, one undo step (${JSON.stringify(b)})`);
  await ev(() => { app.doc.range = null; });
  await save();
  const w3 = fileIn(0, 1e9);
  const p2 = await pick(); await wait(1200);
  await save();
  ok(JSON.stringify(fileIn(0, 1e9)) === JSON.stringify(w3), `after Bake another source pick (${p2.from} -> ${p2.to}) changes no point`);

  // 5. Unbake shot 2; in Refine a digit key on shot 2 bakes that shot (all its points + the new one), one undo step
  const s2 = await shotOf(1), s3 = await shotOf(2);
  await ev(() => window.__pawDev.trackingFor(app).unbake({ shots: [1] })); await wait(300);
  const live2 = await ev(([a, b]) => ({ baked: app.doc.axes.stroke.filter((p) => p.at >= a && p.at < b).length, script: app.script.filter((p) => p.at >= a && p.at < b).length }), [s2.t0, s2.t1]);
  ok(live2.baked === 0 && live2.script > 5, `Unbake: shot 2 plays its run live again (${JSON.stringify(live2)})`);
  const third = await ev(([a, b]) => JSON.stringify(app.doc.axes.stroke.filter((p) => p.at >= a && p.at < b)), [s3.t0, s3.t1]);
  await ev(() => { app.setMode('refine'); app.select([]); document.activeElement?.blur?.(); });
  const tAdd = Math.round((s2.t0 + s2.t1) / 2) + 17;
  await ev((t) => app.player.seek(t), tAdd); await wait(500);
  const n1 = await ev(() => app.history.entries.length);
  await page.keyboard.press('Numpad5'); await wait(500);
  const e = await ev(([a, b]) => ({ n: app.history.entries.length, label: app.history.undoLabel, baked: app.doc.axes.stroke.filter((p) => p.at >= a && p.at < b).length, script: app.script.filter((p) => p.at >= a && p.at < b).length }), [s2.t0, s2.t1]);
  ok(e.n === n1 + 1 && e.baked === e.script && e.baked === live2.script + 1, `a point added in Refine on live shot 2 bakes it with the edit, one undo step (${JSON.stringify(e)})`);
  ok((await ev(([a, b]) => JSON.stringify(app.doc.axes.stroke.filter((p) => p.at >= a && p.at < b)), [s3.t0, s3.t1])) === third, 'shot 3 untouched');
  await ev(() => app.undo()); await wait(300);
  ok((await ev(([a, b]) => app.doc.axes.stroke.filter((p) => p.at >= a && p.at < b).length, [s2.t0, s2.t1])) === 0, 'one undo: shot 2 live again');
  // the live script's cost in the real window (the store's $derived: a warm read is a cache hit)
  const perf = await ev(() => { const t0 = performance.now(); for (let k = 0; k < 2000; k++) void app.script; const a = (performance.now() - t0) / 2000; return { scriptReadMs: +a.toFixed(4) }; });
  console.log('perf', JSON.stringify(perf));
} finally {
  await ev(() => app.project.close?.({ force: true })).catch(() => {});
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
