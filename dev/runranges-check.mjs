// dev/runranges-check.mjs -- paw-1ysd run ranges in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on
// a copy of a generated clip (dev/assets/cfr30.mp4) cut into three shots (the fake sidecar's painted-groups tracker). Asserted:
//   1. Track the whole video, then shots 2-3 again with other settings: two ranges on the run strip, the second trimmed the first
//      (the first run kept, playing shot 1); the published file follows the second run there;
//   2. the first range's right end dragged left with the mouse: it is shorter, the gap plays no run;
//   3. a drag along the second range, "Use <the first run>" from its menu: that piece plays the first run again (the file follows);
//   3b. (paw-40ps) a point moved in that shot's first piece: only that piece bakes, the first run's piece still plays / Publishes;
//   4. the second range's Invert this range (its right-click; paw-k8pe: no ± glyph on the strip): its points are mirrored in the file; a span drawn on the last range + "Invert this stretch": a
//      hatched stretch on the strip, the file changes there; its right end dragged (paw-zvos: the drag follows to the release,
//      one write, no preview left; an end drag + Escape writes nothing); the stretch selected + Delete: gone, the file back;
//   5. one band of two rows (19 px: the run strip, the overrides), no direction row; the shaft strip layered in the lane (no row
//      of its own); paw-k8pe: the strip is clean bars (no names, no glyphs), the run's name is the lane toolbar's run chip at a
//      readable size; a screenshot of the lane: runranges-2.png in <shots dir>.
//   node dev/runranges-check.mjs <clip.mp4> <scratch dir> <shots dir>     exits 1 on any FAIL
import { join } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [src, dir, shots] = process.argv.slice(2);
if (!src || !dir || !shots) { console.error('usage: node dev/runranges-check.mjs <clip.mp4> <scratch dir> <shots dir>'); process.exit(2); }
mkdirSync(dir, { recursive: true }); mkdirSync(shots, { recursive: true });
const clip = join(dir, `rr-${Date.now()}.mp4`), fun = clip.replace(/\.mp4$/, '.funscript');
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (d) d.resolve(d.choices?.some((c) => c.id === 'discard') ? 'discard' : null); });
const fileIn = (t0, t1) => (existsSync(fun) ? JSON.parse(readFileSync(fun, 'utf8')).actions.filter((a) => a.at >= t0 && a.at < t1) : []);
const publish = async () => { await ev(() => app.project.publish()); await page.waitForFunction(() => !app.project.busy, null, { timeout: 30000 }); await wait(400); };
const ranges = () => ev(() => window.__pawDev.trackingFor(app).runRanges.map((r) => ({ id: r.id, run: r.run, t0: r.t0, t1: r.t1 })));
const ghostIn = (id, t0, t1) => ev(([id, a, b]) => (window.__pawDev.trackingFor(app).ghost(id)?.script || []).filter((p) => p.at >= a && p.at < b), [id, t0, t1]);
// (tr.track() returns doing nothing while another job runs, e.g. the tracker list after a reload: busy 'list'; the product greys
// Track then, track.run's when: canTrack. Waited for as a user would, paw-mawd)
const track = async (t0, t1, pts) => {
  await ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); });
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).canTrack, null, { timeout: 60000 });
  await ev(async ([t0, t1, pts]) => {
    const tr = window.__pawDev.trackingFor(app); tr.paramsBy['fake.groups'] = { ...(tr.paramsBy['fake.groups'] || {}), group_points: pts };
    app.doc.range = { t0, t1 }; app.player.seek(t0 + 300); await tr.track(); app.doc.range = null;
  }, [t0, t1, pts]);
};

try {
  await ev(() => app.history?.markSaved?.());
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 10; k++) { await wait(400); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  const D = await ev(() => app.durationMs), c = [0, Math.round(D / 3), Math.round((2 * D) / 3), D];
  await ev((c) => {
    app.setView?.({ start: 0, span: app.durationMs }); app.setMode('track');
    const SQ = (x, y) => [[x, y], [x + 0.12, y], [x + 0.12, y + 0.12], [x, y + 0.12]];
    const g = (t) => [{ name: 'c2_penis', who: 'c2', part: 'penis', poly: SQ(0.3, 0.45), pinned: true, t_ms: t, source: 'user', shaft: true }, { name: 'c1_hips', who: 'c1', part: 'hips', poly: SQ(0.6, 0.45), pinned: true, t_ms: t, source: 'user' }];
    app.transact('shots', () => { app.doc.scenes = [0, 1, 2].map((k) => ({ start_ms: c[k], end_ms: c[k + 1], tags: ['anal', 'penetration'], groups: g(c[k] + 300) })); });
  }, c);
  // 1. two tracks over overlapping spans
  await track(0, D, 0);
  if (!(await ev(() => window.__pawDev.trackingFor(app).runs.length))) console.log('     tracking:', JSON.stringify(await ev(() => { const tr = window.__pawDev.trackingFor(app); return { runs: tr.runs.map((r) => r.id), busy: tr.busy, error: tr.error, notice: tr.notice, canTrack: tr.canTrack, tracker: tr.trackerId, video: tr.videoPath, tab: app.tabId }; })));
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy && window.__pawDev.trackingFor(app).runs.length === 1, null, { timeout: 120000 });
  await track(c[1], D, 8);
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy && window.__pawDev.trackingFor(app).runs.length === 2, null, { timeout: 120000 });
  await wait(800);
  let R = await ranges();
  const [r1, r2] = await ev(() => window.__pawDev.trackingFor(app).runs.map((r) => r.id));
  ok(R.length === 2 && R[0].run === r1 && R[1].run === r2 && R[0].t1 === R[1].t0 && Math.abs(R[1].t0 - c[1]) <= 40, `two ranges, the second trimmed the first (${JSON.stringify(R.map((x) => [x.run, x.t0, x.t1]))})`);
  ok((await ev(() => document.querySelectorAll('[data-testid="run-range"]').length)) === 2, 'the run strip draws both');
  await publish();
  const w2 = await ghostIn(r2, c[1] + 300, c[2] - 300), f2 = fileIn(c[1] + 300, c[2] - 300);
  ok(f2.length > 3 && JSON.stringify(f2.map((a) => a.at)) === JSON.stringify(w2.map((a) => a.at)), `the file plays the second run in shot 2 (${f2.length} points)`);
  // 2. drag the first range's right end left (the real mouse)
  const box = async (sel) => ev((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const h1 = await box(`[data-testid="run-range"][data-run="${r1}"] .h.r`);
  const strip = await box('[data-testid="run-strip"]');
  const xAt = (t) => strip.x + (t / D) * strip.w;   // the view spans the whole video
  if (process.env.RR_DEBUG) console.log('debug', JSON.stringify({ h1, strip, hit: await ev(([x, y]) => { const e = document.elementFromPoint(x, y); const o = []; for (let n = e, k = 0; n && k < 6; k++, n = n.parentElement) o.push((n.className?.baseVal ?? n.className) + ':' + n.tagName); return o; }, [h1.x + h1.w / 2, h1.y + h1.h / 2]), view: await ev(() => app.view) }));
  await page.mouse.move(h1.x + h1.w / 2, h1.y + h1.h / 2); await page.mouse.down();
  await page.mouse.move(xAt(c[1] * 0.6), h1.y + h1.h / 2, { steps: 8 }); await page.mouse.up(); await wait(400);
  R = await ranges();
  ok(R[0].run === r1 && R[0].t1 < c[1] - 200 && R[1].t0 >= c[1] - 40, `the first range shortened by its end (${R[0].t0}-${R[0].t1})`);
  await publish();
  ok(fileIn(R[0].t1 + 150, c[1] - 150).length === 0, 'the gap plays no run (no points published there)');
  // 3. a piece of the second range plays the first run again
  const a = c[1] + Math.round((c[2] - c[1]) * 0.25), b = c[1] + Math.round((c[2] - c[1]) * 0.75);
  const body2 = await box(`[data-testid="run-range"][data-run="${r2}"] .body`);
  await page.mouse.move(xAt(a), body2.y + body2.h / 2); await page.mouse.down();
  await page.mouse.move(xAt(b), body2.y + body2.h / 2, { steps: 8 }); await page.mouse.up(); await wait(400);
  const n1 = await ev((id) => window.__pawDev.trackingFor(app).ghost(id).name, r1), item = page.getByRole('menuitem', { name: `Use ${n1}` });
  if (process.env.RR_DEBUG) console.log('debug menu', JSON.stringify(await ev(([a, b]) => ({ menu: [...document.querySelectorAll('[role=menu], [role=menuitem]')].map((e) => e.getAttribute('role') + ':' + e.textContent.slice(0, 60)), ext: window.__pawDev.trackingFor(app).runs.map((r) => [r.id, window.__pawDev.trackingFor(app).runExtent(r.id)]), a, b, sel: window.__pawDev.trackingFor(app).rangeSel }), [a, b])));
  ok((await item.count()) >= 1, 'the span offers the first run');
  if (await item.count()) { await item.first().click(); await wait(500); }
  R = await ranges();
  const piece = R.find((x) => x.run === r1 && x.t0 > c[1]);
  ok(!!piece && R.filter((x) => x.run === r2).length === 2, `the piece plays the first run, the second split around it (${JSON.stringify(R.map((x) => [x.run, x.t0, x.t1]))})`);
  await publish();
  if (piece) { const g1 = await ghostIn(r1, piece.t0 + 200, piece.t1 - 200), fp = fileIn(piece.t0 + 200, piece.t1 - 200); ok(fp.length > 0 && JSON.stringify(fp.map((x) => x.at)) === JSON.stringify(g1.map((x) => x.at)), 'the file follows the first run there'); }
  // 3b. paw-40ps: shot 2 now plays two runs (the second | the first's piece | the second). A point moved in its first piece bakes
  // that piece only: the first run's piece still plays and Publishes
  if (piece) {
    const moved = await ev(([a, b]) => { const s = app.script, p = s.find((x) => x.at >= a && x.at < b); if (!p) return null; app.edit('Move point', 'stroke', s.map((x) => (x === p ? { at: x.at, pos: x.pos > 50 ? 5 : 95 } : x))); return p.at; }, [c[1] + 150, piece.t0 - 150]);
    await publish();
    const g1 = await ghostIn(r1, piece.t0 + 200, piece.t1 - 200), fp = fileIn(piece.t0 + 200, piece.t1 - 200);
    const st = await ev((t) => window.__pawDev.trackingFor(app).bakeState(1).pieces.map((p) => (p.t0 <= t && t < p.t1 ? 'edited:' : '') + p.state), moved);
    ok(moved != null && fp.length > 0 && JSON.stringify(fp.map((x) => x.at)) === JSON.stringify(g1.map((x) => x.at)), `a point moved in the shot's first piece: the first run's piece still plays and Publishes (${fp.length} points; pieces ${JSON.stringify(st)})`);
    ok(st.filter((s) => s.endsWith('baked')).length === 1 && st.some((s) => s === 'edited:baked'), 'only the edited piece is baked');
    await ev(() => app.undo()); await wait(300);
  }
  // 4. invert the last range (±)
  const last = R.filter((x) => x.run === r2).at(-1), before = fileIn(last.t0 + 200, last.t1 - 200);
  await page.locator(`[data-testid="run-range"][data-run="${r2}"] .body`).last().click({ button: 'right' }); await wait(300);   // paw-k8pe: the ± glyph is gone; its menu inverts
  await page.getByRole('menuitem', { name: /^Invert this range/ }).click(); await wait(1500);
  await publish();
  const after = fileIn(last.t0 + 200, last.t1 - 200);
  const mean = (s) => s.reduce((x, p) => x + p.pos, 0) / Math.max(1, s.length);
  ok(after.length > 2 && JSON.stringify(after) !== JSON.stringify(before), `the ± inverts that range in the file (mean pos ${mean(before).toFixed(1)} -> ${mean(after).toFixed(1)})`);
  // 4b. a stretch inverted from the strip, then removed
  const R4 = await ranges(), lastR = R4.find((x) => x.run === r1 && x.t0 > c[1]), sa = lastR.t0 + 300, sb = lastR.t0 + Math.round((lastR.t1 - lastR.t0) / 2);   // the piece of run 1 (no stretch yet)
  const before2 = fileIn(sa + 100, sb - 100);
  const bodyL = await box(`[data-testid="run-range"][data-run="${r1}"] .body`);
  await page.mouse.move(xAt(sa), bodyL.y + bodyL.h / 2); await page.mouse.down();
  await page.mouse.move(xAt(sb), bodyL.y + bodyL.h / 2, { steps: 8 }); await page.mouse.up(); await wait(400);
  const invItem = page.getByRole('menuitem', { name: 'Invert this stretch' });
  ok((await invItem.count()) === 1, 'a span on a range offers Invert this stretch');
  if (await invItem.count()) { await invItem.click(); await wait(1500); }
  ok((await page.locator('[data-testid="flip-stretch"]').count()) === 1, 'the flipped stretch shows on the run strip (a whole range inverted shows as its ± only)');
  await publish();
  const flipped = fileIn(sa + 100, sb - 100);
  ok(flipped.length > 0 && JSON.stringify(flipped) !== JSON.stringify(before2), 'the file changes over the stretch');
  // 4c (paw-zvos). the stretch's right end dragged right with the mouse: the drag follows to the release (the stretch's element
  // is re-made as its bounds move: the strip holds the pointer), one write, no preview left; then an end drag cancelled by Escape
  const flips = () => ev((id) => { const tr = window.__pawDev.trackingFor(app); return { list: tr.flipsOf(tr.run(id)), preview: tr.flipPreview }; }, r1);
  const f0 = (await flips()).list.find(([x, y]) => x < sb && y > sa);
  const ph = await box('[data-testid="flip-stretch"] .ph.r'), sc = Math.round((lastR.t1 - sb) / 2), to = sb + sc;
  await page.mouse.move(ph.x + ph.w / 2, ph.y + ph.h / 2); await page.mouse.down();
  await page.mouse.move(xAt(to), ph.y + ph.h / 2, { steps: 10 });
  const mid = await flips();
  await page.mouse.up(); await wait(600);
  const f1 = await flips(), s1 = f1.list.find(([x]) => Math.abs(x - f0[0]) <= 40);
  ok(!!mid.preview && !f1.preview && !!s1 && Math.abs(s1[1] - to) <= 120 && s1[1] > f0[1] + sc / 2, `the stretch's end drag follows to the release and is written (${JSON.stringify(f0)} -> ${JSON.stringify(s1)}, aimed ${to}; preview left: ${!!f1.preview})`);
  const ph2 = await box('[data-testid="flip-stretch"] .ph.l');
  await page.mouse.move(ph2.x + ph2.w / 2, ph2.y + ph2.h / 2); await page.mouse.down();
  await page.mouse.move(xAt(lastR.t0 + 80), ph2.y + ph2.h / 2, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.move(xAt(lastR.t0 + 40), ph2.y + ph2.h / 2, { steps: 3 }); await page.mouse.up(); await wait(600);
  const fz = await flips();
  ok(!fz.preview && JSON.stringify(fz.list) === JSON.stringify(f1.list), `Escape during an end drag: nothing written, no preview left (${JSON.stringify(fz.list)})`);
  await page.locator('[data-testid="flip-stretch"] .polb').first().click(); await wait(200);
  await page.keyboard.press('Delete'); await wait(1500);
  ok((await page.locator('[data-testid="flip-stretch"]').count()) === 0, 'selected + Delete: the stretch is gone');
  await publish();
  ok(JSON.stringify(fileIn(sa + 100, sb - 100)) === JSON.stringify(before2), 'the file is as before the stretch');
  // 5. one band, the shaft layered, the names
  const lay = await ev(() => { const e = document.querySelector('[data-testid="lane-edge"]'), s = document.querySelector('[data-testid="shaft-strip"]');
    return { edge: e ? Math.round(e.getBoundingClientRect().height) : null, rows: e ? e.children.length : 0, dirRow: !!e?.querySelector('.dirrow'), shaft: s ? (s.closest('.cv') ? 'in lane' : 'row') : 'none',
      strip: document.querySelector('[data-testid="run-strip"]')?.innerText.trim() ?? null, bar: Math.round(document.querySelector('[data-testid="run-range"] .body')?.getBoundingClientRect().height || 0),
      chip: (() => { const c = document.querySelector('[data-testid="run-chip"]'); return c ? { t: c.innerText.trim(), fs: parseFloat(getComputedStyle(c).fontSize), h: Math.round(c.getBoundingClientRect().height), inBar: !!c.closest('.stack .bar') } : null; })() }; });
  ok(lay.edge === 24 && !lay.dirRow, `one band of two rows, 24 px at the default density (paw-k8pe: 10 run strip + 14 overrides in the kit's small type), no direction row (${JSON.stringify({ edge: lay.edge, dirRow: lay.dirRow })})`);
  ok(lay.shaft !== 'row', `the shaft strip has no row of its own (${lay.shaft})`);
  ok(lay.strip === '' && lay.bar >= 6, `the run strip: clean bars ${lay.bar} px high, no glyphs ("${lay.strip}")`);
  ok(!!lay.chip && lay.chip.inBar && /^#\d+ · /.test(lay.chip.t) && lay.chip.fs >= 11 && lay.chip.h >= 18, `the run's name is the toolbar's run chip, readable (${JSON.stringify(lay.chip)})`);
  // 5. the screenshot
  await ev(() => app.player.seek(app.durationMs / 2)); await wait(500);
  const laneBox = await box('[data-tracklane="combined"]');
  if (laneBox) await page.screenshot({ path: join(shots, 'runranges-2.png'), clip: { x: laneBox.x, y: laneBox.y + Math.max(0, laneBox.h - 120), width: laneBox.w, height: Math.min(120, laneBox.h) } });
} finally {
  await ev(() => app.project.close?.({ force: true })).catch(() => {});
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
