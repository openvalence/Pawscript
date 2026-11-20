// dev/ruler-scrub-check.mjs -- paw-o60v.8 "scrubbing isn't all that quick anymore": dragging the playhead on the ruler and a held
// frame-step key show decoded frames (player.dragTo / step -> scrub, the scrub cache's decoder) instead of seeking the <video> on
// every move, and seek it once at rest. In YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on the
// numbered clips of dev/assets (make-clips.sh: every frame carries its index as a 12-bit code along the top, LSB left). A probe
// drawer on the shared overlay layer paints, as the same code, the frame IT draws for (row 2) and the frame the playhead calls for
// (row 3: the frame the scrub holds, else the one containing the playhead time); every compositor frame of the window is recorded
// (CDP screencast) and the three codes read back. Asserted:
//   drag (real mouse along the ruler, cache ready): on every recorded frame picture = overlay = the frame under the playhead; the
//     pictures came from the decoder (scrub draws), not a seek per move; after the release the <video> (the canvas gone) shows the
//     last frame, the player's frame is it, and playing starts from it;
//   held ArrowRight (key repeat, 20 steps): every recorded frame consistent, decoded frames drawn, it rests 20 frames on, the <video> there;
//   no scrub cache (setting video.scrubCache off, another clip): the drag seeks as before, every recorded frame consistent, the rest exact;
//   paw-o60v.8.1, what shows where the script / machine is follows the frame ON SCREEN: on cfr30 with a saw on the stroke axis,
//     the position bar (canvas.pbar data-pos, written as it paints) and the simulator's position readout (.vsim) equal the
//     script at the player's frame on screen each time they change, during a ruler drag, a lane playhead drag, held ArrowRight
//     and hover scrub (both scrub cache and no cache), after the release, and while playing; and they move (not stuck).
//   paw-8ika, a NEW project after another one was closed (the owner's "the preview machine issue was on new projects"): what the
//     machine follows in the Track tab (lib/follow.svelte.js) was made by the first component that asked, the position bar, and
//     died with it when the document closed: the next video's Track tab showed the closed project's run ("unapplied") and never
//     changed again. Asserted on a fresh copy of cfr30 after a tracked, closed copy: before its own run the bar follows no run;
//     after it, during a ruler drag in the Track tab, the bar and the simulator follow that run (they change, they agree).
//   node dev/ruler-scrub-check.mjs <dir with cfr30.mp4 cfr24.mp4>        exits 1 on any FAIL (RS_ONLY=new: the new-project phase alone)
import { join } from 'node:path';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [dir] = process.argv.slice(2);
if (!dir) { console.error('usage: node dev/ruler-scrub-check.mjs <clip dir>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (d) d.resolve(/Save changes/.test(d.title || '') ? 'discard' : d.choices?.[0]?.id ?? null); });
const cdp = await page.context().newCDPSession(page);
const rect = (sel) => ev((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);

async function open(name, cache) {
  // a launch's recovery question still up, or whatever was open: out of the way first (no Save / Recover question)
  // the first-run hint (#onboard-hint: on in a profile with no recent projects, as a fresh test instance is, and left on by
  // groups-fit / groups-room) lies see-through over the top of the picture, where the frame code is read (710c7ab, paw-kxwz)
  await ev((on) => { app.settings.set('onboard.hints', false); app.settings.set('video.scrubCache', on); if (app.dialog) app.dialog.resolve(app.dialog.choices?.some((c) => c.id === 'discard') ? 'discard' : null); app.history?.markSaved?.(); }, cache);
  await wait(300);
  const p = ev((c) => app.project.openVideo(c, { force: true }), join(dir, name + '.mp4'));
  for (let k = 0; k < 10; k++) { await wait(400); await answer(); }
  await p.catch(() => {});
  // the clip itself (a dirty document open before asks first: answered above), not whatever was open
  await page.waitForFunction((n) => app.doc.media?.path?.replace(/\\/g, '/').endsWith('/' + n + '.mp4') && app.player.ready && app.player.vw > 0, name, { timeout: 60000 });
  // a tab with the lanes (follow() drags a lane's playhead and hover-scrubs a lane; the Scenes tab, where the check before may
  // have left the app, has none)
  await ev(() => { app.setMode('refine'); app.player.setUi({ hud: false }); app.project.stopAutosave?.(); app.setView?.({ start: 0, span: app.durationMs }); });
  if (cache) await page.waitForFunction(() => app.player.scrubCache?.state === 'ready', null, { timeout: 120000 });
  else await wait(1500);
  await ev(() => {
    const L = app.player.overlays, P = (window.__rs = { draws: 0 });
    L.remove('rs.probe');
    globalThis.__pawScrubLog = () => { P.draws++; };
    const row = (ctx, env, y, k) => { for (let b = 0; b < 12; b++) { const [x0, y0] = env.map((12 + b * 25) / 640, y / 360), [x1, y1] = env.map((32 + b * 25) / 640, (y + 20) / 360); ctx.fillStyle = (k >> b) & 1 ? '#ff0000' : '#000000'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); } };
    L.add({ id: 'rs.probe', order: 99999, draw: (ctx, env) => {
      const p = app.player, [a0, b0] = env.map(8 / 640, 44 / 360), [a1, b1] = env.map(312 / 640, 112 / 360);
      ctx.fillStyle = '#000000'; ctx.fillRect(a0, b0, a1 - a0, b1 - b0);
      row(ctx, env, 48, env.frame);
      row(ctx, env, 88, p.heldFrame >= 0 ? p.heldFrame : p.clock.frameAt(p.playheadMs));
      P.map = [env.map(0, 0), env.map(1, 1)];
    } });
  });
}
async function record(body) {
  const frames = [];
  const on = (f) => { frames.push(f.data); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); };
  cdp.on('Page.screencastFrame', on);
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  try { await body(); } finally { await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', on); }
  return frames;
}
async function decode(frames) {
  const out = [];
  for (let i = 0; i < frames.length; i += 10) {
    out.push(...await ev(async (chunk) => {
      const [p0, p1] = __rs.map, st = document.querySelector('[data-testid="video-stage"]').getBoundingClientRect(), res = [];
      for (const b64 of chunk) {
        const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
        const k = bmp.width / window.innerWidth, c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const px = (nx, ny) => g.getImageData(Math.round((st.left + p0[0] + nx * (p1[0] - p0[0])) * k), Math.round((st.top + p0[1] + ny * (p1[1] - p0[1])) * k), 1, 1).data;
        const code = (y, isOn, isOff) => { let v = 0; for (let b = 0; b < 12; b++) { const a = px((22 + b * 25) / 640, y / 360); if (isOn(a)) v |= 1 << b; else if (!isOff(a)) return null; } return v; };
        const white = (a) => a[0] > 150 && a[1] > 150 && a[2] > 150, red = (a) => a[0] > 150 && a[1] < 90 && a[2] < 90, dark = (a) => a[0] < 90 && a[1] < 90 && a[2] < 90;
        const pic = code(18, white, dark), ov = code(58, red, dark), want = code(98, red, dark);
        res.push(pic == null || ov == null || want == null ? null : { pic, ov, want });
      }
      return res;
    }, frames.slice(i, i + 10)));
  }
  return out.filter(Boolean);
}
const split = (rows) => rows.filter((r) => r.pic !== r.ov);   // the overlay on another frame than the picture
const lagOf = (rows) => { const h = {}; for (const r of rows) h[r.want - r.pic] = (h[r.want - r.pic] || 0) + 1; return h; };   // frames the picture is behind the playhead
const med = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };
const settled = () => page.waitForFunction(() => !app.player.seeking && !app.player.scrubbing, null, { timeout: 10000 });
async function rest(label) {
  await settled(); await wait(300);
  const st = await ev(() => ({ frame: app.player.frame, held: app.player.heldFrame, scrubbing: app.player.scrubbing, k: app.player.clock.frameAt(app.player.el.currentTime * 1000 - app.player.startMs) }));
  const last = (await decode(await record(() => wait(250)))).slice(-2);
  ok(!st.scrubbing && st.k === st.frame && last.length && last.every((r) => r.pic === st.frame && r.ov === st.frame),
    `${label}: at rest the <video> shows frame ${st.frame} (its currentTime: ${st.k}), the overlay too ${JSON.stringify(last)}`);
  return st.frame;
}
async function playsFrom(k, label) {
  const got = await ev(() => new Promise((res) => {
    const p = app.player, el = p.el, out = [];
    const f = (now, md) => { out.push(p.clock.frameAt(md.mediaTime * 1000 - p.startMs)); if (out.length < 6) el.requestVideoFrameCallback(f); else { p.pause(); res(out); } };
    el.requestVideoFrameCallback(f); p.play(); setTimeout(() => { p.pause(); res(out); }, 3000);
  }));
  await settled();
  ok(got.length >= 3 && got[0] >= k && got[0] <= k + 1 && got.every((x, i) => !i || x >= got[i - 1]), `${label}: playing starts from frame ${k}: ${JSON.stringify(got)}`);
}
async function drag(label, { expectDecoded }) {
  const R = await rect('[data-tl-lane=ruler]');
  const x0 = R.x + R.w * 0.2, y = R.y + R.h / 2;
  await ev(() => { __rs.draws = 0; app.player.stats.seeks = 0; });
  const frames = await record(async () => {
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let k = 1; k <= 80; k++) { await page.mouse.move(x0 + k * (R.w * 0.3 / 80), y); await wait(30); }
    await wait(60);   // still held: the last frame decoded
    await page.mouse.up();
    await wait(400);
  });
  const rows = await decode(frames), b = split(rows), n = await ev(() => ({ draws: __rs.draws, seeks: app.player.stats.seeks }));
  // the seek path (no scrub cache) is today's: a <video> seek's picture can reach the screen a frame or two before its overlay
  if (expectDecoded) ok(rows.length >= 20 && !b.length, `${label}: the overlay is on the picture's frame on every recorded frame (${rows.length} read, ${new Set(rows.map((r) => r.pic)).size} different frames, split ${JSON.stringify(b.slice(0, 5))})`);
  else console.log(`     ${label}: ${rows.length} read, ${new Set(rows.map((r) => r.pic)).size} different frames, ${b.length} with the overlay on another frame than the picture (the seek path, as before)`);
  const lag = rows.map((r) => r.want - r.pic);
  console.log(`     ${label}: frames the picture is behind the playhead's frame, per recorded frame: ${JSON.stringify(lagOf(rows))}`);
  if (expectDecoded) ok(med(lag) <= 1 && lag.every((x) => x >= 0), `${label}: every picture is a frame the playhead was on, the median one frame or less behind (${med(lag)})`);
  ok(expectDecoded ? n.draws >= 20 && n.seeks <= 3 : n.draws === 0 && n.seeks >= 10, `${label}: ${expectDecoded ? 'decoded frames, the <video> sought once at rest' : 'no scrub cache: a <video> seek per move, as before'} (${n.draws} decoded draws, ${n.seeks} seeks)`);
  return rest(label);
}

// paw-o60v.8.1: the position bar and the simulator against the script at the frame on screen
async function follow(label) {
  await ev(() => {
    const D = app.durationMs, S = [];
    for (let t = 0; t <= D + 2000; t += 2000) S.push({ at: t, pos: (t / 2000) % 2 ? 100 : 0 });   // a saw: 2 s up, 2 s down
    app.devicePreview?.toggle?.(false);   // the raw script (the planner's motion is unit-tested)
    app.player.setUi({ posBar: true, sim: true, simFold: false });
    app.doc.axes = { ...app.doc.axes, stroke: S }; app.doc.activeAxis = 'stroke';
    app.settings.set('lanes.hoverScrub', true);
    const exp = (t) => { const i = Math.floor(t / 2000), f = (t - i * 2000) / 2000; return i % 2 ? 100 - 100 * f : 100 * f; };
    const F = (window.__fol = { rows: [] }), P = app.player;
    // the time inside the frame on screen: the playhead's rest time when it lies in that frame, else the frame's nearest edge
    const inShown = () => { const a = P.clock.timeOf(P.frame), b = P.clock.endOf(P.frame), r = P.playing || P.restMs == null ? a : P.restMs; return r >= a && r < b ? r : r < a ? a : Math.max(a, b - 1); };
    F.inShown = inShown; F.exp = exp;
    const note = (what, v) => { if (Number.isFinite(v)) F.rows.push({ what, v, f: P.frame, exp: exp(inShown()), playing: P.playing }); };
    F.mo?.disconnect();
    F.mo = new MutationObserver(() => {
      const cv = document.querySelector('canvas.pbar'), pv = document.querySelector('.vsim .sub .pv');
      if (cv && cv.dataset.pos !== F.bar) { F.bar = cv.dataset.pos; note('bar', parseFloat(F.bar)); }
      if (pv && pv.textContent !== F.sim) { F.sim = pv.textContent; note('sim', parseFloat(F.sim)); }
    });
    F.mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-pos'], characterData: true, childList: true });
    P.pause(); P.seekFrame(15);
  });
  await settled(); await wait(400);
  const judge = async (name, body) => {
    await ev(() => { __fol.rows = []; });
    await body();
    await settled(); await wait(500);
    const { rows, rest } = await ev(() => {
      const P = app.player, cv = document.querySelector('canvas.pbar'), pv = document.querySelector('.vsim .sub .pv');
      return { rows: __fol.rows, rest: { bar: parseFloat(cv?.dataset.pos), sim: parseFloat(pv?.textContent), exp: __fol.exp(__fol.inShown()), f: P.frame } };
    });
    const off = rows.filter((r) => Math.abs(r.v - r.exp) > 0.15), bars = new Set(rows.filter((r) => r.what === 'bar').map((r) => r.v)).size, sims = new Set(rows.filter((r) => r.what === 'sim').map((r) => r.v)).size;
    ok(rows.length >= 10 && !off.length && bars >= 5 && sims >= 5, `${label} ${name}: the position bar and the simulator show the script at the frame on screen each time they change (${rows.length} changes, ${bars} bar / ${sims} simulator values, off ${JSON.stringify(off.slice(0, 4))})`);
    ok(Math.abs(rest.bar - rest.exp) <= 0.15 && Math.abs(rest.sim - rest.exp) <= 0.15, `${label} ${name}: at rest still on the frame shown (frame ${rest.f}: bar ${rest.bar}, simulator ${rest.sim}, script ${rest.exp.toFixed(1)})`);
  };
  const R = await rect('[data-tl-lane=ruler]'), H = await rect('.stack .lrow .canvas'), y = R.y + R.h / 2;
  await judge('ruler drag', async () => { await page.mouse.move(R.x + R.w * 0.1, y); await page.mouse.down(); for (let k = 1; k <= 60; k++) { await page.mouse.move(R.x + R.w * (0.1 + k * 0.005), y); await wait(30); } await page.mouse.up(); });
  // a lane's playhead: pressed where it is drawn, dragged along the lane
  const hx = await ev((H) => { const v = app.view, P = app.player; return H.x + ((P.playheadMs - v.start) / v.span) * H.w; }, H);
  await judge('lane playhead drag', async () => { await page.mouse.move(hx, H.y + H.h / 2); await page.mouse.down(); for (let k = 1; k <= 60; k++) { await page.mouse.move(hx + k * (H.w * 0.004), H.y + H.h / 2); await wait(30); } await page.mouse.up(); });
  await ev(() => { document.activeElement?.blur?.(); app.player.seekFrame(30); }); await settled(); await wait(300);
  const V = await rect('[data-testid="video-stage"] video'); await page.mouse.move(V.x + V.w / 2, V.y + V.h / 2);
  await judge('held ArrowRight', async () => { for (let i = 0; i < 20; i++) { await page.keyboard.down('ArrowRight'); await wait(33); } await page.keyboard.up('ArrowRight'); });
  await judge('hover scrub', async () => { for (let k = 0; k < 60; k++) { await page.mouse.move(H.x + H.w * (0.55 + k * 0.004), H.y + H.h / 2); await wait(30); } await page.mouse.move(V.x + V.w / 2, V.y + V.h / 2); });
  await judge('playing', async () => { await ev(() => { app.player.seekFrame(10); }); await settled(); await ev(() => app.player.play()); await wait(1500); await ev(() => app.player.pause()); });
  await ev(() => { __fol.mo?.disconnect(); });
}

// paw-8ika: a new project after a closed one, in the Track tab with an unapplied run
async function newProject() {
  const made = [];
  const copy = (tag) => { const f = join(dir, `np-${tag}-${Date.now()}.mp4`); copyFileSync(join(dir, 'cfr30.mp4'), f); made.push(f); return f; };
  // every question (recover a session, save changes) answered without keeping anything
  const answer = () => ev(() => { const d = app.dialog; if (d) d.resolve(d.choices?.some((c) => c.id === 'discard') ? 'discard' : null); });
  const openFile = async (f) => {
    await answer(); await ev(() => app.history?.markSaved?.());
    const p = ev((c) => app.project.openVideo(c, { force: true }), f);
    for (let k = 0; k < 10; k++) { await wait(400); await answer(); }
    await p.catch(() => {});
    await page.waitForFunction((n) => app.doc.media?.path?.replace(/\\/g, '/').endsWith('/' + n) && app.player.ready && app.player.vw > 0, f.replace(/\\/g, '/').split('/').pop(), { timeout: 60000 });
    await ev(() => { app.project.stopAutosave?.(); app.setView?.({ start: 0, span: app.durationMs }); app.setMode('track'); });
    await wait(600);
  };
  const track = async () => {
    await ev(async () => {
      const SQ = (x, y) => [[x, y], [x + 0.12, y], [x + 0.12, y + 0.12], [x, y + 0.12]];
      const g = [{ name: 'c2_penis', who: 'c2', part: 'penis', poly: SQ(0.3, 0.45), pinned: true, t_ms: 500, source: 'user', shaft: true }, { name: 'c1_hips', who: 'c1', part: 'hips', poly: SQ(0.6, 0.45), pinned: true, t_ms: 500, source: 'user' }];
      app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: app.durationMs, tags: ['anal', 'penetration'], groups: g }]; });
      const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: app.durationMs }; app.player.seek(500); await tr.track();
    });
    await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
    await wait(600);
  };
  const bar = () => ev(() => { const cv = document.querySelector('canvas.pbar'); return { pos: cv?.dataset.pos || '', src: cv?.dataset.src || '' }; });
  // the selected run's own points at the playhead (linear between them, as the script plays them)
  const runAt = () => ev(() => { const P = window.__pawDev.trackingFor(app).selected?.points; if (!P?.at?.length) return null; const t = app.player.timeMs; let k = 0; while (k + 1 < P.at.length && P.at[k + 1] <= t) k++; const j = Math.min(k + 1, P.at.length - 1), f = P.at[j] > P.at[k] ? Math.max(0, Math.min(1, (t - P.at[k]) / (P.at[j] - P.at[k]))) : 0; return P.pos[k] + f * (P.pos[j] - P.pos[k]); });
  // a write in flight holds a close (project.close: "Busy"): ask again until it is closed
  const closeIt = async () => { for (let k = 0; k < 20 && (await ev(() => !!app.doc.media)); k++) { await ev(() => { app.history?.markSaved?.(); return app.project.close(); }).catch(() => {}); await wait(300); await answer(); } };
  try {
    // a fresh session that starts in the Refine tab: the first thing to ask in the Track tab is the position bar (the simulator hidden)
    await ev(() => { app.setMode('refine'); app.player.setUi({ posBar: true, sim: false, sr6: false }); app.settings.set('view.machinePreview', false); app.history?.markSaved?.(); });
    await page.reload();
    await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
    await answer();
    await openFile(copy('a'));
    await track();
    await ev(() => app.player.seek(2000, { exact: true })); await settled(); await wait(400);
    const a = await bar();
    // 2e31f7a (paw-x7w7): no Accept, the tracked run is live in the script: the bar's source is the script, which plays the run here
    const ra = await runAt();
    ok(a.src === 'script' && a.pos !== '' && Math.abs(+a.pos - ra) <= 0.5, `new project A, Track tab: the bar follows its run, live in the script (${JSON.stringify(a)}, the run ${ra?.toFixed(1)})`);
    await closeIt();
    await page.waitForFunction(() => !app.doc.media, null, { timeout: 10000 });
    // a new video, a new project: nothing tracked yet, so nothing unapplied to follow
    await openFile(copy('b'));
    await ev(() => app.player.seek(2000, { exact: true })); await settled(); await wait(400);
    const b = await bar();
    ok(!b.pos || Math.abs(+b.pos - +a.pos) > 0.15, `new project B after A was closed, before any run: the bar shows nothing of A's run (${JSON.stringify(b)}; A's read ${a.pos})`);
    await track();
    await ev(() => { app.player.setUi({ sim: true, simFold: false }); app.player.seekFrame(15); });
    await settled(); await wait(400);
    const R = await rect('[data-tl-lane=ruler]'), y = R.y + R.h / 2, rows = [];
    await page.mouse.move(R.x + R.w * 0.1, y); await page.mouse.down();
    for (let k = 1; k <= 40; k++) {
      await page.mouse.move(R.x + R.w * (0.1 + k * 0.012), y); await wait(40);
      if (k % 4 === 0) rows.push(await ev(() => ({ ...(() => { const cv = document.querySelector('canvas.pbar'); return { pos: cv?.dataset.pos, src: cv?.dataset.src }; })(), sim: document.querySelector('.vsim .sub .pv')?.textContent, f: app.player.frame })));
    }
    await page.mouse.up(); await settled(); await wait(300);
    const vals = new Set(rows.map((r) => r.pos)), agree = rows.filter((r) => r.pos === r.sim && r.src === 'script').length;   // 2e31f7a: the run plays in the script
    ok(vals.size >= 5 && agree >= rows.length - 1, `new project B, Track tab, its run unapplied, ruler drag: the bar and the simulator follow it (${vals.size} bar values over ${new Set(rows.map((r) => r.f)).size} frames, ${agree}/${rows.length} agree and on the run)`);
  } finally {
    await ev(() => { app.history?.markSaved?.(); app.project.close(); }).catch(() => {});
    for (let k = 0; k < 3; k++) { await wait(300); await answer().catch(() => {}); }
    for (const f of made) for (const x of [f, f.replace(/\.mp4$/, '.pawproj'), f.replace(/\.mp4$/, '.pawruns')]) if (existsSync(x)) try { rmSync(x); } catch { /* still open */ }
  }
}

async function scrubPhases() {
  await page.waitForFunction(() => window.app && app.player, null, { timeout: 60000 });
  await open('cfr30', true);
  ok(await ev(() => !!app.player.scrubCache?.path), 'cfr30: the scrub cache is ready');
  const k = await drag('cfr30 ruler drag', { expectDecoded: true });
  await playsFrom(k, 'cfr30 after the drag');
  // held ArrowRight: key repeat (keydown with repeat), 33 ms apart
  await ev(() => { document.activeElement?.blur?.(); app.player.seekFrame(30); }); await settled(); await wait(300);
  const V = await rect('[data-testid="video-stage"] video'); await page.mouse.move(V.x + V.w / 2, V.y + V.h / 2);
  await ev(() => { __rs.draws = 0; });
  const frames = await record(async () => { for (let i = 0; i < 20; i++) { await page.keyboard.down('ArrowRight'); await wait(33); } await page.keyboard.up('ArrowRight'); await wait(400); });
  const rows = await decode(frames), b = split(rows), draws = await ev(() => __rs.draws);
  console.log(`     cfr30 held ArrowRight: frames the picture is behind the playhead's frame: ${JSON.stringify(lagOf(rows))}`);
  // the first press is a single step (a <video> seek, as before: its picture can reach the screen a frame before its overlay)
  ok(rows.length >= 10 && b.every((r) => r.pic === 31), `cfr30 held ArrowRight: the overlay is on the picture's frame on every recorded frame after the first press (${rows.length} read, split ${JSON.stringify(b.slice(0, 5))})`);
  ok(draws >= 5, `cfr30 held ArrowRight: decoded frames drawn while held (${draws})`);
  const end = await rest('cfr30 held ArrowRight');
  ok(end === 50, `cfr30 held ArrowRight: 20 steps from frame 30 rest on frame 50 (${end})`);
  await playsFrom(end, 'cfr30 after the steps');
  // no scrub cache: the seek path, unchanged
  await open('cfr24', false);
  const k2 = await drag('cfr24 (no scrub cache) ruler drag', { expectDecoded: false });
  await playsFrom(k2, 'cfr24 after the drag');
  await follow('cfr24 (no scrub cache)');
  await open('cfr30', true);
  await follow('cfr30');
  await ev(() => { app.player.overlays.remove('rs.probe'); globalThis.__pawScrubLog = undefined; app.settings.set('video.scrubCache', true); app.player.setUi({ posBar: false }); });
}
try {
  if (process.env.RS_ONLY === 'new') await page.waitForFunction(() => window.app && app.player, null, { timeout: 60000 });   // only the new-project phase
  else await scrubPhases();
  await newProject();
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
