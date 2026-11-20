// dev/paint-target-check.mjs -- paw-iwb7 in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints; the fake
// sidecar), real CDP mouse and keys, on a copy of a clip. The owner: "I'll paint a shot and hit T and I am tracking what was selected
// before" / "if I press Tab on a frame it's because I scrubbed to it and I wanna start painting, so move my cursor to the paint area".
// Two shots A | B (a hard cut at the middle), an action region R inside B.
//   1. the reproduction: a click on shot A (the Shots strip) selects it; the playhead to a frame in B; Tab, paint on the picture, Tab;
//      T takes B as the range (it took A's before), the selection is B, a toast says so; Track ROI over every painted part (the same
//      own() path, the fake tracker): one run over exactly B; the busy task names it ("Tracking shot 2");
//   2. R selected (a click on the Actions strip), painted inside it: T still takes R's span, R stays selected;
//   3. hover scrub on, the pointer over a lane at a frame in A: Tab opens the tool on exactly the frame shown (the playhead on it, not
//      between frames); the pointer moving across the lanes and the Shots strip changes nothing while the tool is open; the OS pointer
//      move is asked once, at the middle of the visible picture (the stage's video, the tool open) (backend.setCursorPosition stubbed:
//      the real OS move needs the release exe with the capability, not tested here); closing the tool moves nothing back;
//   4. Tab over the lanes at a frame in B (painted in 1.): the pointer is asked to where B was painted; with the setting off the
//      frame is still taken but nothing is asked.
//   node dev/paint-target-check.mjs <clip.mp4>     exits 1 on any FAIL
import { copyFileSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { stripLayout, bandsIn } from '../src/features/timeline/actions-strip.js';

const src = process.argv[2];
if (!src) { console.error('usage: node dev/paint-target-check.mjs <clip.mp4>'); process.exit(2); }
const clip = join(dirname(resolve(src)), 'painttarget-' + basename(src));
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms), J = JSON.stringify;
const rect = (sel) => ev((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const xOf = async (sel, t) => { const r = await rect(sel), v = await ev(() => ({ ...app.view })); return r.x + ((t - v.start) / v.span) * r.w; };
const on = () => ev(() => !!__pawDev.groupsFor(app).on);
const state = () => ev(() => { const tl = __pawDev.tl; return { act: tl.act, scene: tl.scene, shots: [...tl.shots], range: app.doc.range && [Math.round(app.doc.range.t0), Math.round(app.doc.range.t1)] }; });
const blur = () => ev(() => document.activeElement?.blur?.());
async function paint() {   // a short stroke on the middle of the picture; -> where it began (client px)
  const v = await rect('[data-testid="video-stage"] video'), at = [v.x + v.w * 0.42, v.y + v.h * 0.45];
  const n0 = await ev(() => __pawDev.groupsFor(app).groups.length);
  await page.mouse.move(...at); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(at[0] + k * 6, at[1] + (k % 2 ? 4 : -4));
  await page.mouse.up(); await wait(400);
  ok((await ev(() => __pawDev.groupsFor(app).groups.length)) > n0, 'a stroke painted a group');
  return at;
}
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 60000 });
  await ev(async () => { for (const c of (await app.backend.autosaveList()) || []) await app.backend.autosaveClear(c.id); });
  const opening = ev((p) => app.project.openVideo(p, { force: true }), clip).catch(() => {});
  for (let k = 0; k < 8; k++) { await wait(500); await ev(() => { const d = app.dialog; if (d) d.resolve(/^Recover|Save changes/.test(d.title || '') ? 'discard' : /^Replace/.test(d.title || '') ? 'replace' : d.choices?.[0]?.id ?? null); }); }
  await opening;
  await page.waitForFunction(() => (app.doc.media?.durationMs || 0) > 5000 && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => __pawDev.trackingFor(app).trackers.length > 0, null, { timeout: 30000 });
  const D = await ev(() => app.durationMs), fm = await ev(() => app.player.frameMs || 1000 / 30);
  const F = (u) => Math.round(Math.round((u * D) / fm) * fm);   // on a frame start
  const CUT = F(0.5), R = { id: 'actR', kind: 'act', t0: F(0.6), t1: F(0.85), layer: 0, tags: ['slit', 'penetration'], roles: [] };
  await ev(([D, CUT, R]) => {
    app.setMode('track'); app.setView?.({ start: 0, span: D }); app.player.pause();
    app.transact('setup', () => { app.doc.scenes = [{ start_ms: 0, end_ms: CUT }, { start_ms: CUT, end_ms: D, cut: 'hard' }]; app.doc.acts = [R]; });
    app.doc.range = null; __pawDev.tl.act = null; __pawDev.tl.scene = -1; __pawDev.tl.shots = [];
    app.settings.set('lanes.hoverScrub', false);
    window.__t = []; const o = app.toast.bind(app); app.toast = (m, ...r) => { __t.push(String(m)); return o(m, ...r); };
    window.__tasks = []; const tk = app.task.bind(app); app.task = (title, ...r) => { __tasks.push(String(title)); return tk(title, ...r); };
    window.__cur = []; app.backend.setCursorPosition = (x, y) => { __cur.push([x, y]); };   // the OS move itself: the release exe only
  }, [D, CUT, R]);
  await wait(800);

  // ---- 1. the reproduction: shot A selected, painted in B, T ----
  // the Track tab's shots: the Shots strip at the foot of the Actions row (the filmstrip lane is the Scenes tab's)
  const sc = '[data-tl-lane="scenes"] canvas', g0 = await ev(() => { const c = document.querySelector('[data-tl-lane="scenes"] canvas').getBoundingClientRect(); return { top: c.top, h: c.height, v: { ...app.view }, acts: app.doc.acts || [] }; });
  const L0 = stripLayout(g0.h, bandsIn(g0.acts, g0.v.start, g0.v.start + g0.v.span)), yShots = g0.top + (L0.y1 + g0.h) / 2;
  await page.mouse.click(await xOf(sc, F(0.25)), yShots); await wait(500);
  let s = await state();
  ok(J(s.shots) === J([0]) && J(s.range) === J([0, CUT]), `a click on shot A selects it, the range is A (${J(s)})`);
  await ev((t) => app.player.seek(t), F(0.7)); await wait(600);
  await blur(); await page.keyboard.press('Tab'); await wait(600);
  ok(await on(), 'Tab opens Groups on a frame in B');
  await ev(() => { window.__t = []; });
  const paintedB = await paint();
  await page.keyboard.press('Tab'); await wait(400);
  s = await state();
  ok(J(s.shots) === J([1]) && J(s.range) === J([CUT, D]) && s.act === null, `painted in B: the selection and the range are B now (${J(s)})`);
  ok((await ev(() => __t.join(' | '))).includes('now tracks shot 2, where you painted'), `a toast says what T tracks ("${(await ev(() => __t.join(' | '))).slice(0, 160)}")`);
  await blur(); await page.keyboard.press('KeyT'); await wait(600);
  s = await state();
  ok(J(s.range) === J([CUT, D]), `T: the range is B, not A (${J(s.range)})`);
  const tip = await ev(() => { const b = document.querySelector('[data-btn="track"]'); return b ? (b.getAttribute('aria-label') || '') + ' ' + (b.dataset.tip || '') : ''; });
  console.log('     (the chips\' Track button: ' + J(tip.slice(0, 160)) + ')');
  // Track ROI over every painted part (track.run {all}: the old panel Track, the same own() path as T) with the fake tracker
  const n0 = await ev(() => { const tr = __pawDev.trackingFor(app); tr.selectTracker('fake.groups'); tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.4, h: 0.4, t_ms: app.player.timeMs }; window.__tasks = []; return tr.runs.map((r) => r.id).join(); });
  await ev(() => app.commands.run('track.run', { all: true }));
  await page.waitForFunction((n) => { const tr = __pawDev.trackingFor(app); return !tr.busy && tr.runs.map((r) => r.id).join() !== n; }, n0, { timeout: 60000 }).catch(() => {});
  await wait(1000);
  const runs = await ev(() => __pawDev.trackingFor(app).runs.filter((r) => !r.tag).map((r) => [Math.round(r.range.start), Math.round(r.range.end)]));
  ok(runs.length === 1 && J(runs[0]) === J([CUT, D]), `Track (every painted part): one run over exactly B (${J(runs)})`);
  const tasks = await ev(() => __tasks.join(' | '));
  ok(/Tracking shot 2/.test(tasks), `the busy task names the span ("${tasks.slice(0, 120)}")`);

  // ---- 2. a region inside B selected, painted inside it: the region stays the target ----
  const g = await ev(() => { const c = document.querySelector('[data-tl-lane="scenes"] canvas').getBoundingClientRect(); return { left: c.left, top: c.top, w: c.width, h: c.height, v: { ...app.view }, acts: app.doc.acts || [] }; });
  const L = stripLayout(g.h, bandsIn(g.acts, g.v.start, g.v.start + g.v.span));
  await page.mouse.click(g.left + (((R.t0 + R.t1) / 2 - g.v.start) / g.v.span) * g.w, g.top + (L.main.y0 + L.main.y1) / 2); await wait(500);
  s = await state();
  ok(s.act === R.id && J(s.range) === J([R.t0, R.t1]), `a click on R selects it (${J(s)})`);
  await ev((t) => app.player.seek(t), F(0.75)); await wait(600);
  await blur(); await page.keyboard.press('Tab'); await wait(600);
  await paint();
  await page.keyboard.press('Tab'); await wait(400);
  await blur(); await page.keyboard.press('KeyT'); await wait(600);
  s = await state();
  ok(s.act === R.id && J(s.range) === J([R.t0, R.t1]), `painted inside R: T still takes R's span, R selected (${J(s)})`);

  // ---- 3. Tab over the lanes with hover scrub: the frame shown, held; the pointer asked onto the picture ----
  await ev(() => { __pawDev.tl.act = null; app.doc.range = null; app.settings.set('lanes.hoverScrub', true); window.__cur = []; });
  const lane = await rect('.stack .lane');
  ok(!!lane, 'a lane to hover');
  const ly = lane.y + lane.h / 2, hx = await xOf('.stack .lane', F(0.3) + fm * 0.4);
  await page.mouse.move(hx - 30, ly); await page.mouse.move(hx, ly, { steps: 4 }); await wait(700);
  const before = await ev(() => ({ frame: app.player.frame, t: app.player.timeMs, rest: app.player.restMs, scrub: app.player.scrubTime }));
  ok(before.scrub != null && Math.abs(before.t - F(0.3)) < fm * 1.5, `hover scrub shows the frame under the pointer (${J(before)})`);
  await blur(); await page.keyboard.press('Tab'); await wait(800);
  const after = await ev(() => ({ on: __pawDev.groupsFor(app).on, frame: app.player.frame, t: app.player.timeMs, rest: app.player.restMs, start: app.player.clock.timeOf(app.player.frame), g: __pawDev.groupsFor(app).t }));
  ok(after.on && after.frame === before.frame && after.rest == null && Math.abs(after.t - after.start) < 0.5, `Tab: the tool opens on exactly the frame shown, the playhead on it (${J(after)})`);
  for (const u of [0.1, 0.45, 0.62, 0.9]) { await page.mouse.move(await xOf('.stack .lane', F(u)), ly, { steps: 3 }); await wait(150); }
  await page.mouse.move(await xOf(sc, F(0.8)), yShots, { steps: 3 }); await wait(500);
  const held = await ev(() => ({ frame: app.player.frame, t: app.player.timeMs }));
  ok(held.frame === before.frame && Math.abs(held.t - after.t) < 0.5, `the pointer across the lanes and the Shots strip changes nothing while the tool is open (${J(held)})`);
  const cur = await ev(() => window.__cur);
  const pic = await ev(() => { const v = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(), s = document.querySelector('[data-testid="video-stage"]').getBoundingClientRect(); const x0 = Math.max(v.left, s.left), x1 = Math.min(v.right, s.right), y0 = Math.max(v.top, s.top), y1 = Math.min(v.bottom, s.bottom); return [(x0 + x1) / 2, (y0 + y1) / 2]; });
  ok(cur.length === 1 && Math.hypot(cur[0][0] - pic[0], cur[0][1] - pic[1]) < 3, `the pointer is asked once, onto the middle of the visible picture (asked ${J(cur)}, picture ${J(pic.map(Math.round))})`);
  await blur(); await page.keyboard.press('Tab'); await wait(400);
  ok(!(await on()) && (await ev(() => window.__cur.length)) === 1, 'closing the tool moves nothing back');
  await page.mouse.move(await xOf('.stack .lane', F(0.2)), ly, { steps: 3 }); await wait(500);
  ok(Math.abs((await ev(() => app.player.timeMs)) - F(0.2)) < fm * 1.5, 'tool closed: hover scrub works again');

  // ---- 4. a frame in B (painted in 1.): the pointer to where B was painted; the setting off: the frame only ----
  await page.mouse.move(await xOf('.stack .lane', F(0.7)), ly, { steps: 3 }); await wait(700);
  await ev(() => { window.__cur = []; }); await blur(); await page.keyboard.press('Tab'); await wait(800);
  const cur4 = await ev(() => window.__cur);
  ok(cur4.length === 1 && Math.hypot(cur4[0][0] - paintedB[0], cur4[0][1] - paintedB[1]) < 3, `Tab in B: the pointer is asked to where B was last painted (asked ${J(cur4)}, painted at ${J(paintedB.map(Math.round))})`);
  await blur(); await page.keyboard.press('Tab'); await wait(300);
  await ev(() => { app.settings.set('tracking.groups.tabPointer', false); window.__cur = []; });
  await page.mouse.move(await xOf('.stack .lane', F(0.35)) + 0.4, ly, { steps: 3 }); await wait(700);
  const b5 = await ev(() => app.player.frame);
  await blur(); await page.keyboard.press('Tab'); await wait(800);
  const a5 = await ev(() => ({ on: __pawDev.groupsFor(app).on, frame: app.player.frame, rest: app.player.restMs, cur: window.__cur.length }));
  ok(a5.on && a5.frame === b5 && a5.rest == null && a5.cur === 0, `the setting off: the frame is taken, the pointer is not asked (${J(a5)})`);
  await blur(); await page.keyboard.press('Tab'); await wait(300);
  // ---- REAL_CURSOR=1 (a shell built with the capability core:window:allow-set-cursor-position): the real call, unstubbed. The ACL
  // must let it through; the OS move itself is refused on the hidden desktop (not the input desktop), so it is only reported ----
  if (process.env.REAL_CURSOR === '1') {
    const r = await ev(async () => {
      const inv = window.__TAURI_INTERNALS__?.invoke, out = {};
      try { await inv('plugin:window|set_cursor_position', { label: 'main', value: { Physical: { x: 200, y: 150 } } }); out.set = 'ok'; } catch (e) { out.set = String(e?.message || e); }
      try { out.at = await inv('plugin:window|cursor_position', { label: 'main' }); out.inner = await inv('plugin:window|inner_position', { label: 'main' }); } catch (e) { out.read = String(e?.message || e); }
      return out;
    });
    ok(!/not allowed|denied by|permission/i.test(String(r.set)), `REAL_CURSOR: the shell lets set_cursor_position through (${J(r)})`);
  }
} catch (e) { fails++; console.log('FAIL [threw]', String(e?.message || e).slice(0, 400)); } finally {
  await ev(() => { app.settings.set('lanes.hoverScrub', false); app.settings.set('tracking.groups.tabPointer', true); app.project.close?.({ force: true }); }).catch(() => {});
  console.log(fails ? `${fails} FAIL` : 'all ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
