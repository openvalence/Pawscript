// dev/shaft-strip-check.mjs -- paw-4c48: the shaft strip on the Tracker lane in YOUR test instance (node dev/test-app.mjs start ...;
// the CDP_* env it prints), on a generated clip (any 8 s video). One shot with c2_penis (the shaft) + c1_hips painted; T with the
// fake sidecar's fake.groups, whose shaft channels play a known story (test/fake-pawtrack.mjs: went in 1 s, knot in ~2.77 s,
// hidden 3-4.5 s, knot out ~4.88 s, pulled out 6 s, off frame 7-7.5 s). It asserts, on what is painted and with real input:
//  1. the strip is there with the visible-share line (top at 0.5 s), the hatched hidden span (3-4.5 s, at the bottom), the knot
//     line, and nothing painted where lost (7-7.5 s);
//  2. dragging the knot line stores it on the shot (one undo step); double-click = automatic again;
//  3. Alt+4 drops "knot in" on the playhead's frame, a tick shows; dragged it moves (one undo step); Delete removes it;
//  4. a mark placed 3 frames after the detected knot in: the readout's card says 1/1 -100 ms;
//  5. a click on the strip's top edge = "fully out here", the bottom edge = "hilted here" (the calibration marks);
//  6. the command "Shaft scorecard: all shots" answers;
//  7. the script lanes and every ghost's points (what plays) are byte-identical before and after all of it.
// Every page exception and console error fails it.
//   node dev/shaft-strip-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/shaft-strip-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
// a fresh copy every run: an earlier run's autosave of the same clip would ask to recover (a destructive choice a script may not take)
const clip = join(resolve(out), `shaft-${Date.now()}.mp4`);
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
// what must never change: the lanes' scripts and every ghost's points (the run's played points among them)
// the truth-mark keys (Alt+3..6, tracking.shaftMark.*) are Track-tab commands; the strip with its ticks is checked on the Refine row
const markKey = async (k) => { await ev(() => app.setMode('track')); await wait(400); await page.keyboard.press(k); await wait(400); await ev(() => app.setMode('refine')); await wait(600); };
const fingerprint = () => ev(() => JSON.stringify({ axes: app.doc.axes, ghosts: app.doc.ghosts.map((g) => [g.id, g.script]), pts: Array.from(window.__pawDev.trackingFor(app).selected?.points?.pos || []) }));

try {
  await page.reload();   // a clean page whatever ran before (an unsaved document would ask)
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev((g) => { app.setMode('track'); app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['anal', 'penetration'], groups: g }]; }); },
    [grp('c2', 'penis', 0.3, 0.45, { shaft: true }), grp('c1', 'hips', 0.6, 0.45)]);
  await ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: 8000 }; app.player.seek(500); for (let k = 0; k < 75 && !tr.canTrack; k++) await new Promise((r) => setTimeout(r, 200)); await tr.track(); });
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
  await ev(() => { const tr = window.__pawDev.trackingFor(app); window.TR = tr; tr.select(tr.runs.at(-1).id); app.setView({ start: 0, span: 8000 }); });
  // the strip as a row with its own gestures is the Tracker row's (Refine / Review, hidden there by default); on the Track tab it is
  // layered over the lane's foot with only its handles live since d9fdc1e (paw-1ysd stage 5)
  await ev(() => { app.setMode('refine'); app.layout.setRow('tracking', { collapsed: false }); });
  await page.waitForSelector('[data-testid="shaft-strip"]', { timeout: 10000 });
  await wait(600);
  const st = await ev(() => { const r = TR.selected, s = TR.shaftStateOf(r, 0); return s && { events: s.events, knotVis: s.knotVis, hidden: s.state.filter((x) => x === 'hidden').length, lost: s.state.filter((x) => x === 'lost').length, fm: app.player.frameMs }; });
  ok(!!st && st.hidden > 30 && st.lost > 10, `the run's shaft reading: ${st?.hidden} hidden, ${st?.lost} lost frames`);
  ok(JSON.stringify(st?.events.map((e) => e.kind)) === '["wentIn","knotIn","knotOut","pulledOut"]', `events ${JSON.stringify(st?.events)}`);
  const fp0 = await fingerprint();

  // ---- 1. what is painted ----
  const box = await page.locator('[data-testid="shaft-strip"]').boundingBox();
  const X = (ms) => box.x + (ms / 8000) * box.width, Y0 = 9, Y1 = box.height - 2, yv = (v) => box.y + Y1 - v * (Y1 - Y0);
  // per column x (ms), the rows (css px from the strip's top) with a painted pixel
  const rows = (ms) => ev(([ms, w]) => {
    const c = document.querySelector('[data-testid="shaft-strip"] canvas'), d = window.devicePixelRatio || 1, x = Math.round((ms / 8000) * w * d);
    const px = c.getContext('2d').getImageData(x, 0, 1, c.height).data, out = [];
    for (let y = 0; y < c.height; y++) if (px[y * 4 + 3] > 60) out.push(Math.round(y / d));
    return [...new Set(out)];
  }, [ms, box.width]);
  const r05 = await rows(500), r37 = await rows(3700), r72 = await rows(7250), r65 = await rows(6500);
  ok(r05.some((y) => Math.abs(y - Y0) <= 1), `0.5 s: the line at the top (all of it out) rows ${r05}`);
  ok(r37.filter((y) => y >= Y1 - 6 && y <= Y1).length >= 3, `3.7 s: hatched at the bottom (hidden) rows ${r37}`);
  ok(!r37.some((y) => y > Y0 + 2 && y < Y1 - 7 && Math.abs(y - (Y1 - st.knotVis * (Y1 - Y0))) > 1), '3.7 s: no visible-share line in the middle');
  ok(r65.some((y) => Math.abs(y - (Y1 - st.knotVis * (Y1 - Y0))) <= 1), `the knot line at ${Math.round(100 * st.knotVis)} % (6.5 s rows ${r65})`);
  ok(!r72.some((y) => y > Y0 + 2 && y < Y1 - 1 && Math.abs(y - (Y1 - st.knotVis * (Y1 - Y0))) > 1), `7.25 s (lost): blank but the knot line (rows ${r72})`);
  await page.screenshot({ path: join(out, 'shaft-strip.png'), clip: { x: box.x, y: box.y - 40, width: box.width, height: box.height + 60 } });

  // ---- 1b. paw-4c48.7: the shaft PAINTED on the video lies along the penis group (the fake's shaft is oblique, its stored
  //      entry swings 30 deg every 6th frame as the sidecar's did): on 7 consecutive frames around such a frame, the painted
  //      capsule's axis (the shaft-coloured pixels the shaft adds to the overlay canvas, by difference) is within 4 deg of the
  //      members' principal axis, its base by their base end, and it does not jump between frames ----
  {
    // the shaft is painted on the video only on the Track tab (TrackingOverlay: no runs drawn off it since 3eba8e6): 623b3c7 moved
    // this check to the Refine Tracker row for the strip's gestures, the capsule is checked back on the Track tab
    await ev(() => { app.settings.set('tracking.trails', 'off'); app.setMode('track'); }); await wait(400);
    const fr = await ev(() => Array.from(TR.selected.frames.t));
    const g0 = fr.findIndex((t) => t >= 1000), first = g0 + ((3 - (g0 % 6) + 6) % 6) - 3;   // frames first .. first + 6, a glitch frame (i % 6 = 3) in the middle
    const painted = [];
    for (let i = first; i <= first + 6; i++) {
      await ev((t) => app.player.seek(t + 1, { exact: true }), fr[i]); await wait(250);
      const res = await ev(async (t) => {
        const cv = document.querySelector('canvas.ov'), c = cv.getContext('2d'), snap = () => c.getImageData(0, 0, cv.width, cv.height).data;
        const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const orig = TR.shaftAt;
        TR.shaftAt = () => null; TR.tick = (TR.tick || 0) + 1; await raf(); await raf();
        const off = snap();
        TR.shaftAt = orig; TR.tick++; await raf(); await raf();
        const on = snap(), W = cv.width, rc = cv.getBoundingClientRect(), k = cv.width / rc.width, ky = cv.height / rc.height;
        let P = [];
        for (let q = 0; q < on.length; q += 4) {
          const d = Math.abs(on[q] - off[q]) + Math.abs(on[q + 1] - off[q + 1]) + Math.abs(on[q + 2] - off[q + 2]);
          const sat = Math.max(on[q], on[q + 1], on[q + 2]) - Math.min(on[q], on[q + 1], on[q + 2]);
          if (d > 60 && sat > 60 && on[q + 3] > 120) P.push([((q / 4) % W) / k, Math.floor(q / 4 / W) / ky]);
        }
        const pca = (Q) => { const m = [0, 0]; for (const p of Q) { m[0] += p[0] / Q.length; m[1] += p[1] / Q.length; } let a = 0, b = 0, e = 0; for (const p of Q) { const x = p[0] - m[0], y = p[1] - m[1]; a += x * x; b += y * y; e += x * y; } const th = 0.5 * Math.atan2(2 * e, a - b); return { m, u: [Math.cos(th), Math.sin(th)] }; };
        const sh = TR.shaftAt(t), E = TR.axisMap, h = sh ? Math.hypot(...[0, 1].map((j) => E(sh.base[0], sh.base[1] + sh.w)[j] - E(sh.base[0], sh.base[1])[j])) / 2 : 0;
        // only what lies over the drawn segment (the gauge sits beyond the entry, on the axis' extension)
        { const b0 = E(sh.base[0], sh.base[1]), e0 = E(sh.entry[0], sh.entry[1]), dx = e0[0] - b0[0], dy = e0[1] - b0[1], l2 = dx * dx + dy * dy || 1, m = (h + 2) / Math.sqrt(l2);
          P = P.filter((p) => { const f = ((p[0] - b0[0]) * dx + (p[1] - b0[1]) * dy) / l2; return f > m && f < 1 - m; }); }
        // the painted axis: the direction whose long straight edges stack up most (a Hough peak over the angle: the capsule's two
        // outlines and its centre line are the longest straight runs painted; the gauge's border is short)
        const peak = (th) => { const nx = -Math.sin(th), ny = Math.cos(th), H = new Map(); let best = 0; for (const p of P) { const b = Math.round(p[0] * nx + p[1] * ny); const c = (H.get(b) || 0) + 1; H.set(b, c); if (c > best) best = c; } return best; };
        let bt = 0, bs = -1;
        for (let a = 0; a < 180; a += 0.5) { const sc = peak((a * Math.PI) / 180); if (sc > bs) { bs = sc; bt = a; } }
        for (let a = bt - 0.5; a <= bt + 0.5; a += 0.05) { const sc = peak((a * Math.PI) / 180); if (sc > bs) { bs = sc; bt = a; } }
        const L = P.length ? { u: [Math.cos((bt * Math.PI) / 180), Math.sin((bt * Math.PI) / 180)] } : null;
        // the members on this frame (the run's points of the shaft group), on screen
        const run = TR.selected, j = run.frames.t.findIndex((x) => Math.abs(x - t) < 2), id = run.scenes[0].groups['sem_' + sh.name].id;
        const M = run.frames.ov[j].pts.filter((p) => p[5] === id && p[2] > 0).map((p) => E(p[0], p[1]));
        const mp = pca(M), s = M.map((p) => (p[0] - mp.m[0]) * mp.u[0] + (p[1] - mp.m[1]) * mp.u[1]);
        const ends = [Math.min(...s), Math.max(...s)].map((v) => [mp.m[0] + v * mp.u[0], mp.m[1] + v * mp.u[1]]), b = E(sh.base[0], sh.base[1]);
        const baseEnd = Math.hypot(ends[0][0] - b[0], ends[0][1] - b[1]) < Math.hypot(ends[1][0] - b[0], ends[1][1] - b[1]) ? ends[0] : ends[1];
        const e2 = E(sh.entry[0], sh.entry[1]), dl = Math.hypot(e2[0] - b[0], e2[1] - b[1]) || 1;
        return { n: P.length, u: L?.u, mu: mp.u, su: [(e2[0] - b[0]) / dl, (e2[1] - b[1]) / dl], base: b, baseEnd, h, members: M.length };
      }, fr[i]);
      painted.push({ i, ...res });
    }
    const ang = (a, b) => { const c = Math.abs(a[0] * b[0] + a[1] * b[1]); return (Math.acos(Math.min(1, c)) * 180) / Math.PI; };
    const offAxis = painted.map((p) => (p.u ? ang(p.u, p.mu) : 99)), jump = painted.slice(1).map((p, q) => (p.u && painted[q].u ? ang(p.u, painted[q].u) : 99));
    const baseOff = painted.map((p) => Math.hypot(p.base[0] - p.baseEnd[0], p.base[1] - p.baseEnd[1]) / Math.max(1, 2 * p.h));
    ok(painted.every((p) => p.n > 40 && p.members >= 3), `the capsule is painted on every frame (${painted.map((p) => p.n).join(' ')} px, members ${painted.map((p) => p.members).join(' ')})`);
    ok(Math.max(...offAxis) < 4, `the painted axis lies along the penis group: off by ${offAxis.map((x) => x.toFixed(1)).join(' ')} deg (frames ${first}..${first + 6}, glitch at ${first + 3})`);
    const model = painted.map((p) => ang(p.su, p.mu)), paintVsModel = painted.map((p) => (p.u ? ang(p.u, p.su) : 99));
    ok(Math.max(...model) < 2 && Math.max(...paintVsModel) < 4, `the drawn axis (the overlay's base -> entry) vs the members ${model.map((x) => x.toFixed(1)).join(' ')} deg; painted vs drawn ${paintVsModel.map((x) => x.toFixed(1)).join(' ')} deg`);
    ok(Math.max(...jump) < 3, `no jump between frames: ${jump.map((x) => x.toFixed(1)).join(' ')} deg`);
    ok(Math.max(...baseOff) < 0.6, `the base at the group's base end: ${baseOff.map((x) => x.toFixed(2)).join(' ')} shaft widths`);
    await page.screenshot({ path: join(out, 'shaft-overlay.png') });
    await ev(() => { app.player.seek(500, { exact: true }); app.setMode('refine'); }); await wait(600);
  }

  // ---- 2. the knot line drag ----
  const h0 = await ev(() => app._history.index);
  await page.mouse.move(X(6500), yv(st.knotVis)); await page.mouse.down();
  await page.mouse.move(X(6500), yv(0.5), { steps: 4 }); await page.mouse.move(X(6500), yv(0.6), { steps: 4 });
  await wait(200);
  ok((await ev(() => app._history.index)) === h0, 'while dragging: no history');
  await page.mouse.up(); await wait(400);
  const kn = await ev(() => TR.shotDerive(0, TR.selected.id)?.shaft?.knot);
  ok(Math.abs(kn - 0.6) < 0.06 && (await ev(() => app._history.index)) === h0 + 1, `the knot line dragged to ${kn} (one undo step)`);
  ok(await ev(() => TR.shaftStateOf(TR.selected, 0).knotFrom === 'mark'), 'the reading uses the owner\'s knot');
  await page.mouse.dblclick(X(6500), yv(kn)); await wait(400);
  ok((await ev(() => TR.shotDerive(0, TR.selected.id)?.shaft?.knot)) == null, 'double-click: automatic again');
  await ev(() => app.undo()); await wait(200);
  ok(Math.abs((await ev(() => TR.shotDerive(0, TR.selected.id)?.shaft?.knot)) - kn) < 1e-9, 'undo brings the dragged knot back');

  // ---- 3. a truth mark by key ----
  await ev(() => app.player.seek(2000, { exact: true })); await wait(300);
  const ph = await ev(() => window.__pawDev.playheadFrameStart ? window.__pawDev.playheadFrameStart(app.player) : Math.round(app.player.timeOfFrame(app.player.frame)));
  await page.locator('[data-testid="shaft-strip"]').hover({ position: { x: 5, y: 2 } });
  await markKey('Alt+4');
  let marks = await ev(() => app.doc.scenes[0].shaftTruth || []);
  ok(marks.length === 1 && marks[0].k === 'knotIn' && Math.abs(marks[0].t - ph) <= 1, `Alt+4: knot in at the playhead's frame ${JSON.stringify(marks)} (playhead ${ph})`);
  const tick = page.locator('.tm[data-kind="knotIn"]');
  ok(await tick.count() === 1, 'its tick shows on the truth row');
  const tb = await tick.boundingBox(), h1 = await ev(() => app._history.index);
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2 + 30, tb.y + tb.height / 2, { steps: 5 }); await page.mouse.up(); await wait(400);
  marks = await ev(() => app.doc.scenes[0].shaftTruth || []);
  const moved = marks[0]?.t;
  ok(moved > ph + 100 && (await ev(() => app._history.index)) === h1 + 1, `dragged: ${ph} -> ${moved} (one undo step)`);
  ok(await ev((t) => Math.abs(t - app.player.snap(t)) <= 1, moved), 'on a frame start');
  await page.locator('.tm[data-kind="knotIn"]').focus(); await page.keyboard.press('Delete'); await wait(300);
  ok((await ev(() => (app.doc.scenes[0].shaftTruth || []).length)) === 0, 'Delete removes it');
  ok(await page.locator('.tm[data-kind="knotIn"]').count() === 0, 'its tick is gone');

  // ---- 4. the scorecard against a mark 3 frames after the detected knot in ----
  const kIn = await ev(() => TR.shaftStateOf(TR.selected, 0).events.find((e) => e.kind === 'knotIn').t);   // against the dragged knot line (kept by the undo above)
  await ev((t) => app.player.seek(t, { exact: true }), kIn + 3 * st.fm + 2); await wait(300);
  await markKey('Alt+4');
  await ev(() => app.player.seek(2900, { exact: true })); await wait(300);
  await page.locator('[data-testid="shaft-readout"]').click(); await wait(400);
  const evText = await page.locator('[data-testid="shaft-card-events"]').innerText().catch(() => '');
  const want = -Math.round(3 * st.fm);
  ok(new RegExp(`knot in 1/1 ${want} ms`).test(evText), `the card: "${evText.replace(/\s+/g, ' ')}" (want knot in 1/1 ${want} ms)`);
  await page.screenshot({ path: join(out, 'shaft-card.png') });
  await page.keyboard.press('Escape'); await wait(200);

  // ---- 5. click the top / bottom edge: the calibration marks ----
  await page.mouse.click(X(6600), box.y + Y0 + 1); await wait(400);
  await page.mouse.click(X(2950), box.y + Y1 - 1); await wait(400);
  const cal = await ev(() => TR.shotDerive(0, TR.selected.id)?.shaft);
  ok(cal?.out != null && Math.abs(cal.out - 6600) < 60 && cal?.hilt != null && Math.abs(cal.hilt - 2950) < 60, `top edge = fully out ${cal?.out}, bottom edge = hilted ${cal?.hilt}`);
  ok(await page.locator('.tm[data-kind="out"]').count() === 1 && await page.locator('.tm[data-kind="hilt"]').count() === 1, 'both show as ticks on the truth row');

  // ---- 6. the command ----
  await ev(() => app.commands.run('tracking.shaftScorecard')); await wait(600);
  ok(await ev(() => /Shaft scorecard, 1 of 1 shots/.test(document.body.innerText)), 'the command answers (toast)');

  // ---- 7. nothing that plays changed ----
  await wait(500);
  const fp1 = await fingerprint();
  ok(fp1 === fp0, `the script lanes and the played points are byte-identical (${fp0.length} chars)`);
  // saved beside the copy (the marks and the knot go with it; the next check's reload asks nothing)
  await ev(() => app.project.save()); await wait(800);
  for (let k = 0; k < 6 && (await ev(() => !!app.dialog)); k++) { await ev(() => app.dialog.resolve(app.dialog.choices?.find((c) => !/discard|cancel/i.test(c.id))?.id ?? null)); await wait(500); }
  ok(await ev(() => !app.doc.dirty), 'saved: the document is clean');
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
