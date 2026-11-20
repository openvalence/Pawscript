// dev/posbar-shaft-check.mjs -- paw-4c48.8: the position bar ON THE SHAFT in YOUR test instance, started with FAKE_SHAFT_STORY=strokes
// in its environment (node dev/test-app.mjs start ...; the CDP_* env it prints), on a generated clip (any 8 s video). One shot with
// c2_penis (the shaft) + c1_hips painted; T with the fake sidecar's fake.groups: its shaft is oblique (-40 deg), its members along it,
// its visible share plays strokes (0.9 s, 20..90 %, held 3-3.6 s: test/fake-pawtrack.mjs). It asserts, on what is painted and with
// real input:
// paw-4c48.18 (2026-11-18): the check had gone stale, the rail had not regressed. Since bb0e6d7 / paw-4c48.11 a shaft reading that does
// not repeat with the strokes is drawn unsure (faint), and since the depth scale (paw-4c48, depthScale) pos 0 / 100 are the reading's
// own recurring extremes (hilted / fully out), not the group's base end / full length. On the default fake story (one push in and
// out, no strokes) every frame was rightly faint and the old expectations (pos 0 at the base, script = 100 x visible share) no longer
// held. Now: the strokes story (confident); pos 0 on the shaft's line between its base and tip; the script that equals the diamond
// (read from the painted bar itself) keeps the marker on it, 20 off parts them.
//  1. before any run: the magnet button turns the mode on, but the bar stays where it was placed; its tooltip and the canvas say
//     "no shaft read in this shot";
//  2. with the run (Refine tab: the bar follows the script): the painted rail lies along the penis group (its axis within 3 deg
//     of the shaft's), its pos-0 end (hilted) on the shaft's line between its base and its tip, the script marker moves along it
//     with the playhead, and with the script = the diamond's own reading the marker and the diamond coincide; 20 off they part;
//  3. Track tab: it follows the run (live in the script since paw-x7w7);
//  4. it never takes the pointer over the video (what is under the rail is the stage, not the bar); hovered, its handles show;
//     with the Groups tool on they do not; the flip chip flips this shot (0 at the tip), takes no focus; the width chip drag
//     changes the width; double-click on the ruler resets the look; the magnet again = the hand-placed bar.
// Every page exception and console error fails it.
//   node dev/posbar-shaft-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/posbar-shaft-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const clip = join(resolve(out), `rail-${Date.now()}.mp4`);
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const SQ = (x, y, w = 0.12, h = 0.12) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const grp = (who, part, x, y, extra = {}) => ({ name: `${who}_${part}`, who, part, poly: SQ(x, y), pinned: true, t_ms: 500, source: 'user', ...extra });
// the script: a placeholder before the run; after it, the diamond's own reading (sampled from the painted bar) as the script
let read = null;   // [{at, pos}] the diamond's reading over the shot (dataset meas), once the run is there
const script = (off = 0) => (read || Array.from({ length: 201 }, (_, k) => ({ at: k * 40, pos: 50 }))).map((q) => ({ at: q.at, pos: Math.max(0, Math.min(100, Math.round(q.pos + off))) }));
const mode = () => ev(() => document.querySelector('canvas.pbar')?.dataset.mode || '');

try {
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev((g) => {
    app.devicePreview.toggle(false);
    app.player.setUi({ posBar: false });
    app.setMode('refine'); app.player.pause();
    app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['anal', 'penetration'], groups: g }]; });
  }, [grp('c2', 'penis', 0.3, 0.45, { shaft: true }), grp('c1', 'hips', 0.6, 0.45)]);
  await ev((S) => { app.doc.axes = { ...app.doc.axes, stroke: S }; app.player.seek(1500, { exact: true }); }, script());
  await wait(400);

  // ---- 1. no run yet: the mode is on, the bar stays where it was placed ----
  await page.locator('button[aria-label="Position bar"]').click(); await wait(300);
  const toggle = page.locator('[data-testid="posbar-shaft-toggle"]');
  await toggle.hover(); await wait(700);
  const tip0 = await ev(() => document.querySelector('[role="tooltip"]')?.textContent || '');
  await toggle.click(); await wait(500);
  ok(/^hand:no shaft read in this shot/.test(await mode()), `no run: the hand-placed bar (${await mode()})`);
  ok(/no shaft read in this shot/.test(tip0), `the toggle's tooltip says why ("${tip0.slice(0, 120)}")`);

  // ---- the run ----
  await ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: 8000 }; app.player.seek(500); await tr.track(); });
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
  await ev(() => { const tr = window.__pawDev.trackingFor(app); window.TR = tr; tr.select(tr.runs.at(-1).id); app.setMode('refine'); });
  await wait(600);

  // what is painted / read at t: the rail's ends (from the drawn bar: the store's rail through the same math), the members, pos / meas
  // what is painted / read at t: the shaft bar's ends (canvas dataset, normalised), the members (normalised), pos / meas; angles in
  // square units (x times the aspect: the default fit view maps them to the screen unrotated)
  const look = (t) => ev(async (t) => {
    app.player.seek(t, { exact: true });
    await new Promise((r) => setTimeout(r, 350));
    const cv = document.querySelector('canvas.pbar'), R = TR.railFor(t), run = TR.selected, A = app.doc.media.width / app.doc.media.height;
    const j = run.frames.t.findIndex((x) => Math.abs(x - t) < 25), id = run.scenes[0].groups.sem_c2_penis.id;
    const M = (run.frames.ov[j]?.pts || []).filter((q) => q[5] === id && q[2] > 0).map((q) => [q[0] * A, q[1]]);
    const c = M.reduce((a, q) => [a[0] + q[0] / M.length, a[1] + q[1] / M.length], [0, 0]);
    let a = 0, b = 0, e = 0;
    for (const q of M) { const x = q[0] - c[0], y = q[1] - c[1]; a += x * x; b += y * y; e += x * y; }
    const th = 0.5 * Math.atan2(2 * e, a - b), u = [Math.cos(th), Math.sin(th)], s = M.map((q) => (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1]);
    const bar = (cv.dataset.bar || '').split(',').map(Number), D = [bar[0] * A, bar[1]], O = [bar[2] * A, bar[3]], L = Math.hypot(O[0] - D[0], O[1] - D[1]) || 1;
    return { mode: cv.dataset.mode, pos: parseFloat(cv.dataset.pos), meas: parseFloat(cv.dataset.meas), src: cv.dataset.src, ctx: !!R?.ctx?.G,
      px: (cv.dataset.px || '').split(',').map(Number), members: M.length, mu: u, mEnds: [Math.min(...s), Math.max(...s)].map((v) => [c[0] + v * u[0], c[1] + v * u[1]]), D, O, bu: [(O[0] - D[0]) / L, (O[1] - D[1]) / L] };
  }, t);
  // the painted rail: pixels the bar adds along a line through the canvas (alpha), and its ends from the painted track
  const paintedAxis = () => ev(() => {
    const cv = document.querySelector('canvas.pbar'), r = cv.getBoundingClientRect(), kx = cv.width / r.width, ky = cv.height / r.height;
    // the track only: away from its ends, the marker and the measured diamond (round caps and cross pieces)
    const [a0, b0, a1, b1] = (cv.dataset.px || '0,0,0,0').split(',').map(Number), at = (pos) => [a0 + ((a1 - a0) * pos) / 100, b0 + ((b1 - b0) * pos) / 100];
    const keep = [at(0), at(100), at(parseFloat(cv.dataset.pos)), at(parseFloat(cv.dataset.meas))].filter((q) => q.every(Number.isFinite));
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, P = [];
    for (let q = 0; q < d.length; q += 4) if (d[q + 3] > 40) { const p = [((q / 4) % cv.width) / kx, Math.floor(q / 4 / cv.width) / ky]; if (keep.every((k) => Math.hypot(p[0] - k[0], p[1] - k[1]) > 16)) P.push(p); }   // (16 px: the rail between the depth scale's ends is short)
    const c = P.reduce((a, q) => [a[0] + q[0] / P.length, a[1] + q[1] / P.length], [0, 0]);
    let a = 0, b = 0, e = 0;
    for (const q of P) { const x = q[0] - c[0], y = q[1] - c[1]; a += x * x; b += y * y; e += x * y; }
    const th0 = 0.5 * Math.atan2(2 * e, a - b);
    const th = th0;   // the track alone (its ends and the marks left out) is symmetric about its axis: its principal direction
    const u = [Math.cos(th), Math.sin(th)], s = P.map((q) => (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1]);
    return { n: P.length, u, ends: [Math.min(...s), Math.max(...s)].map((v) => [c[0] + v * u[0], c[1] + v * u[1]]) };
  });
  const ang = (a, b) => (Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // ---- 2. along the penis, the marker on the measured entry ----
  await ev(() => app.settings.set('video.posbar.shaft:' + app.doc.media.path, { on: true, labels: false }));   // no labels: the painted pixels are the track
  const rows = [];
  for (const t of [150, 250, 1000, 2050, 5250, 6350]) {   // (the strokes story at 49..88 % visible: a deep frame, under 3 of the 10 points visible, is held, rightly faint)
    const L = await look(t), P = await paintedAxis();
    rows.push({ t, ...L, P });
  }
  ok(rows.every((r) => r.mode === 'shaft' && r.ctx), `the mode is on the shaft, confident (${rows.map((r) => r.mode).join(' ')})`);
  // against the fake's shaft axis (-40 deg, square units; the members' own principal axis is biased when few are visible: they sit in two staggered rows)
  const TRUTH = [Math.cos((-40 * Math.PI) / 180), Math.sin((-40 * Math.PI) / 180)];
  const pxu = (r) => { const [a, b, c, d] = r.px, l = Math.hypot(c - a, d - b) || 1; return [(c - a) / l, (d - b) / l]; };
  const offP = rows.map((r) => ang(r.P.u, pxu(r))), offB = rows.map((r) => ang(r.bu, TRUTH)), offM = rows.map((r) => ang(r.mu, TRUTH));
  ok(Math.max(...offP) < 3 && Math.max(...offB) < 1.5, `the rail lies along the shaft: its ends ${offB.map((x) => x.toFixed(1)).join(' ')} deg off it; the painted track ${offP.map((x) => x.toFixed(1)).join(' ')} deg off those ends on screen (the visible members' own axis: ${offM.map((x) => x.toFixed(1)).join(' ')})`);
  // the pos-0 end (D, hilted): on the shaft's line (across it under 0.01 frame heights), between the members' base end and the tip
  const onLine = rows.map((r) => { const v = [r.D[0] - r.mEnds[0][0], r.D[1] - r.mEnds[0][1]]; return Math.abs(-v[0] * TRUTH[1] + v[1] * TRUTH[0]); });
  const along = rows.map((r) => (r.D[0] - r.mEnds[0][0]) * r.bu[0] + (r.D[1] - r.mEnds[0][1]) * r.bu[1]);
  ok(Math.max(...onLine) < 0.015 && along.every((x) => x > -0.03), `pos 0 (hilted) on the shaft: ${onLine.map((x) => x.toFixed(3)).join(' ')} across, ${along.map((x) => x.toFixed(3)).join(' ')} from the base end`);
  // the script = the diamond's own reading (sampled off the painted bar): the marker on the diamond
  read = [];
  for (let t = 0; t <= 7920; t += 80) { const L = await look(t); if (Number.isFinite(L.meas)) read.push({ at: t, pos: L.meas }); }
  await ev((S) => { app.doc.axes = { ...app.doc.axes, stroke: S }; }, script());
  const rows2 = [];
  for (const t of [160, 240, 1040, 2080, 5280, 6320]) rows2.push(await look(t));
  const gap = rows2.map((r) => Math.abs(r.pos - r.meas));
  ok(read.length > 60 && Math.max(...gap) < 2.5, `script = the diamond's reading: marker and measured entry together (pos - meas ${rows2.map((r) => (r.pos - r.meas).toFixed(1)).join(' ')})`);
  ok(new Set(rows2.map((r) => Math.round(r.pos))).size >= 4, `the marker moves with the playhead (${rows2.map((r) => r.pos).join(" ")})`);
  await page.screenshot({ path: join(out, 'rail-on-shaft.png') });
  // the script 20 off: they part
  await ev((S) => { app.doc.axes = { ...app.doc.axes, stroke: S }; }, script(-20));
  const sep = [];
  for (const t of [1200, 2400]) { const L = await look(t); sep.push(L.meas - L.pos); }
  ok(sep.every((x) => x > 15), `script 20 off: marker and measured entry apart (${sep.map((x) => x.toFixed(1)).join(' ')})`);
  await ev((S) => { app.doc.axes = { ...app.doc.axes, stroke: S }; }, script());

  // ---- 3. Track tab: the unapplied run ----
  await ev(() => app.setMode('track')); await wait(400);
  const tk = await look(1500);
  // paw-x7w7: no Accept, the run is live in the script, so the bar reads the script on the Track tab too
  ok(tk.mode === 'shaft', `Track tab: on the shaft, following the ${tk.src}`);
  await ev(() => app.setMode('refine')); await wait(300);

  // ---- 4. the pointer and the handles ----
  await look(1500);
  const P0 = await paintedAxis(), mid = [(P0.ends[0][0] + P0.ends[1][0]) / 2, (P0.ends[0][1] + P0.ends[1][1]) / 2];   // the painted rail's middle (canvas px)
  const stagePt = await ev(() => { const c = document.querySelector('canvas.pbar').getBoundingClientRect(); return [c.x, c.y]; });
  const X = stagePt[0] + mid[0], Y = stagePt[1] + mid[1];
  await page.mouse.move(X + 300, Y + 200); await wait(200);
  const under0 = await ev(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.className + '|' + (e.dataset?.testid || '') : ''; }, [X, Y]);
  ok(!/posbar|phit|sh-end|sh-chips/.test(under0), `not hovered: the video is under the rail, not the bar (${under0})`);
  await page.mouse.move(X, Y, { steps: 3 }); await wait(400);
  const chips = page.locator('[data-testid="posbar-shaft-chips"]');
  ok(await chips.count() === 1, 'hovered: its handles show');
  const under1 = await ev(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.className + '|' + (e.dataset?.testid || '') : ''; }, [X, Y]);
  ok(!/posbar|phit/.test(under1), `hovered: the middle of the rail still lets the pointer through (${under1})`);
  const focus0 = await ev(() => document.activeElement?.tagName + '#' + (document.activeElement?.className || ''));
  const m0 = (await look(1500)).meas;
  await page.mouse.move(X, Y); await wait(300);
  await page.locator('[data-testid="posbar-shaft-flip"]').click(); await wait(500);
  const flips = await ev(() => app.settings.get('video.posbar.shaft:' + app.doc.media.path).flips);
  const m1 = (await look(1500)).meas;
  ok(flips.includes(0) && Math.abs(m1 - (100 - m0)) < 1.5, `flip this shot: stored (${JSON.stringify(flips)}), the measured entry reads ${m1.toFixed(1)} (was ${m0.toFixed(1)})`);
  const focus1 = await ev(() => document.activeElement?.tagName + '#' + (document.activeElement?.className || ''));
  ok(focus1 === focus0, `no focus taken (${focus0} -> ${focus1})`);
  // width: drag the W chip
  await page.mouse.move(X, Y); await wait(300);
  const wb = await page.locator('.sh-chips button[aria-label="Width"]').boundingBox();
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await page.mouse.down();
  await page.mouse.move(wb.x + wb.width / 2 + 60, wb.y + wb.height / 2, { steps: 5 }); await page.mouse.up(); await wait(400);
  const w1 = await ev(() => app.settings.get('video.posbar.shaft:' + app.doc.media.path).width);
  ok(w1 > 12, `the width chip drag: width ${w1}`);
  // the Groups tool: display only
  await ev(() => app.setMode('track')); await wait(300);
  await ev(() => window.__pawDev.groupsFor?.(app)?.open?.());
  await page.keyboard.press('Tab'); await wait(500);
  const tool = await ev(() => app.player.overlays.activeTool?.id || '');
  await page.mouse.move(X + 5, Y + 5); await page.mouse.move(X, Y); await wait(400);
  ok(!tool || (await chips.count()) === 0, `with the ${tool || 'no'} tool active: no handles (${await chips.count()})`);
  await page.keyboard.press('Escape'); await wait(300);
  await ev(() => app.setMode('refine')); await wait(300);
  // reset (double-click the ruler): the look back, the mode kept; the magnet again: the hand-placed bar
  await page.locator('button[aria-label="Position bar"]').dblclick(); await wait(500);
  const lk = await ev(() => app.settings.get('video.posbar.shaft:' + app.doc.media.path));
  ok(lk?.on === true && !lk.width && !(lk.flips || []).length, `double-click the ruler: the look reset, the mode kept (${JSON.stringify(lk)})`);
  await ev(() => app.player.setUi({ posBar: true })); await wait(300);
  await toggle.click(); await wait(500);
  ok(await mode() === 'hand', `the magnet again: the hand-placed bar (${await mode()})`);
  // playing: drawn every frame (the rail follows the time)
  await toggle.click(); await wait(300);
  await ev(() => app.player.seek(1000, { exact: true })); await wait(200);
  const seen = await ev(async () => { const cv = document.querySelector('canvas.pbar'), s = new Set(); app.player.play(); const t0 = performance.now(); while (performance.now() - t0 < 1000) { await new Promise((r) => requestAnimationFrame(r)); s.add(cv.dataset.pos + '|' + cv.dataset.meas); } app.player.pause(); return s.size; });
  ok(seen > 15, `playing: ${seen} distinct painted readings in 1 s`);
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
