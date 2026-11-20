// dev/qa-keys-retrack-check.mjs -- paw-g3zk and paw-l3ec in the REAL window (your test instance: node dev/test-app.mjs start ...;
// CDP_* env; the fake sidecar), with real CDP mouse and keys:
//  g3zk: Track tab, click the Overview row (it takes the focus), click the video picture, press Tab: Groups opens (G does not).
//  l3ec: a box drawn, Ctrl+T (Track ROI, the fake groups tracker) twice on the same shot: one run, one ghost (paw-1ysd: the
//        new run's range covers the earlier one's, so the earlier one is gone); the Track menu's "Track as a new run" then
//        keeps both, the new one taking no range (the earlier one plays on).
//   node dev/qa-keys-retrack-check.mjs <clip.mp4>
import { resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const clip = process.argv[2];
if (!clip) { console.error('usage: node dev/qa-keys-retrack-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 60000 });
  await ev(async () => { for (const c of (await app.backend.autosaveList()) || []) await app.backend.autosaveClear(c.id); });   // a fresh open, no recovery offer
  const opening = ev((p) => app.project.openVideo(p, { force: true }), resolve(clip)).catch(() => {});
  for (let k = 0; k < 8; k++) { await wait(500); await ev(() => { const d = app.dialog; if (d) d.resolve(/^Recover|Save changes/.test(d.title || '') ? 'discard' : /^Replace/.test(d.title || '') ? 'replace' : d.choices?.[0]?.id ?? null); }); }
  await opening;
  await page.waitForFunction(() => (app.doc.media?.durationMs || 0) > 9000 && app.player.ready, null, { timeout: 60000 });
  await ev(() => { app.setMode('track'); app.doc.scenes = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }]; app.player.pause(); app.player.seek(6000); });
  await page.waitForFunction(() => __pawDev.trackingFor(app).trackers.length > 0, null, { timeout: 30000 });
  await wait(800);
  // ---- paw-g3zk ----
  await page.mouse.click(...await center('[data-tl-lane="overview"]')); await wait(300);
  const f1 = await ev(() => document.activeElement?.closest?.('[role=application]')?.dataset?.tlLane || document.activeElement?.tagName);
  ok(f1 === 'overview', `a click on the Overview row focuses it (${f1})`);
  await page.mouse.click(...await center('[data-testid="video-stage"] canvas.ov')); await wait(300);
  const f2 = await ev(() => ({ el: document.activeElement?.tagName, row: !!document.activeElement?.closest?.('[role=application]'), win: app.commands.winner('Tab') }));
  ok(!f2.row && f2.win === 'tracking.groups', `a click on the video takes the key context from the row (focus ${f2.el}, Tab -> ${f2.win})`);
  await page.keyboard.press('KeyG'); await wait(400);
  ok(!(await ev(() => __pawDev.groupsFor(app).on)), 'G does not open Groups');
  await page.keyboard.press('Tab'); await wait(500);
  ok(await ev(() => __pawDev.groupsFor(app).on), 'Tab opens Groups');
  // paw-i5qx: with the focus on a button of the Groups bar the tool's keys still reach their commands (1 / 2 / 3, E, K)
  await page.click('[data-testid="groups-circle"]'); await page.click('[data-testid="groups-circle"]'); await wait(200);
  const k0 = await ev(() => { const G = __pawDev.groupsFor(app); return { who: G.who, grow: G.grow, knot: G.knotBrush, focus: !!document.activeElement?.closest?.('[data-testid="groups-tools"]') }; });
  await page.keyboard.press('Digit2'); await page.keyboard.press('KeyE'); await page.keyboard.press('KeyK'); await wait(300);
  const k1 = await ev(() => { const G = __pawDev.groupsFor(app); return { who: G.who, grow: G.grow, knot: G.knotBrush }; });
  ok(k0.focus && k1.who === 'c2' && k1.grow !== k0.grow && k1.knot !== k0.knot, `focus on the bar (${k0.focus}): 2 -> ${k1.who}, E -> grow ${k1.grow}, K -> knot ${k1.knot}`);
  await page.keyboard.press('Digit1'); await page.keyboard.press('KeyE'); await page.keyboard.press('KeyK'); await wait(200);
  ok(await ev(() => document.querySelector('[data-testid="groups-tools"]').getBoundingClientRect().width) <= 44, 'the Groups bar is at most 44 px wide');
  // the same with a tool on the video that takes the press (the Groups brush: its pointerdown prevents the default)
  await page.mouse.click(...await center('[data-tl-lane="overview"]')); await wait(200);
  const pic0 = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await page.mouse.click(...await center('[data-testid="video-stage"] canvas.ov')); await wait(300);
  ok(!(await ev(() => !!document.activeElement?.closest?.('[role=application]'))), 'a press the Groups brush takes also moves the key context off the row');
  // paw-trjh (seen here too) as bb2d421 (paw-8ehz) left it: the picture keeps its place when its margins hold the tool's
  // columns (the bar + 4 px left, 180 px right: groups-room.js), else it is fitted beside them; the bar never lies over it, and
  // closing Groups puts the picture back exactly
  const geo = () => ev(() => { const R = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height].map(Math.round) : null; }; return { pic: R('[data-testid="video-stage"] video'), st: R('[data-testid="video-stage"]'), bar: R('[data-testid="groups-tools"]') }; });
  const gOpen = await geo();
  await ev(() => __pawDev.groupsFor(app).toggle(false)); await wait(400);
  const gClosed = await geo(), pic1 = gClosed.pic;
  await ev(() => __pawDev.groupsFor(app).toggle(true)); await wait(500);
  const gAgain = await geo();
  await ev(() => __pawDev.groupsFor(app).toggle(false)); await wait(400);
  const [px, , pw] = pic1, [sx, , sw] = gClosed.st, bw = gOpen.bar[2];
  const roomy = px - sx >= bw + 4 && sx + sw - (px + pw) >= 180;
  ok((roomy ? JSON.stringify(pic0) === JSON.stringify(pic1) : gOpen.bar[0] + gOpen.bar[2] <= gOpen.pic[0] + 1) && JSON.stringify(gAgain.pic) === JSON.stringify(pic0),
    `Groups open: ${roomy ? 'the picture stays put' : 'the picture beside the bar'} (open ${pic0}, bar ${gOpen.bar}; closed ${pic1}; open again ${gAgain.pic})`);
  await ev(() => { const s = app.doc.scenes; app.doc.scenes = s.map(({ groups: _g, ...x }) => x); });   // the dab painted above out of the way
  // ---- paw-l3ec ----
  const own = () => ev(() => { const tr = __pawDev.trackingFor(app); return { runs: tr.runs.filter((r) => !r.tag).map((r) => r.id), ghosts: app.doc.ghosts.filter((g) => g.source?.kind === 'tracker' && !g.source.tag).map((g) => `${g.id}:${g.name}`) }; });
  const trackOnce = async (how) => {
    await ev(() => { const tr = __pawDev.trackingFor(app); tr.selectTracker('fake.groups'); tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.4, h: 0.4, t_ms: 6000 }; document.activeElement?.blur?.(); });
    const n0 = await ev(() => __pawDev.trackingFor(app).runs.length);
    if (how === 'key') await page.keyboard.press('Control+KeyT'); else await ev(() => app.commands.run('track.beside'));
    await page.waitForFunction((n) => { const tr = __pawDev.trackingFor(app); return !tr.busy && tr.runs.length !== n; }, n0, { timeout: 60000 }).catch(() => {});
    await wait(1500);
  };
  await ev(() => { const tr = __pawDev.trackingFor(app); tr.runs = []; app.doc.ghosts = []; tr.select(''); app.doc.range = { t0: 5000, t1: 10000 }; window.__t = []; const o = app.toast.bind(app); app.toast = (m, ...r) => { __t.push(String(m)); return o(m, ...r); }; });
  await trackOnce('key');
  const a = await own();
  ok(a.runs.length === 1, `Ctrl+T: one run (${JSON.stringify(a)})`);
  await trackOnce('key');
  const b = await own();
  ok(b.runs.length === 1 && b.ghosts.length === 1 && b.runs[0] !== a.runs[0], `Ctrl+T again on the same shot: still one run and one ghost, the new one (${JSON.stringify(b)})`);
  const toast = await ev(() => __t.join(' | '));
  ok(/replaces the earlier run/.test(toast), `the toast says it replaced the earlier run: "${toast.slice(0, 200)}"`);
  await trackOnce('beside');
  const c = await own();
  ok(c.runs.length === 2, `Track menu "Track as a new run": both kept (${JSON.stringify(c)})`);
  const rr = await ev(() => __pawDev.trackingFor(app).runRanges.map((r) => r.run));
  ok(rr.length >= 1 && rr.every((id) => id === b.runs[0]), `the earlier run still plays, the new one has no range (${JSON.stringify(rr)})`);
} catch (e) { fails++; console.log('FAIL [threw]', String(e?.message || e).slice(0, 400)); } finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
