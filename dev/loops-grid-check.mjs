// dev/loops-grid-check.mjs -- paw-kxz4: are loops, cuts and frame numbers on the video's REAL frames? In YOUR test instance (node
// dev/test-app.mjs start ...; the CDP_* env it prints), on a clip from dev/make-loop-clip.mjs (every picture is only its id; a loop of
// L pictures x P passes at frame A; `--real` = the clip's pts table in ms, from ffprobe, so real frame k = the k-th decoded picture
// starting at real[k]). Reads what is painted (screenshots of the video and of the ruler's repeat strip) and reports:
//   pics     clock frame n -> the picture shown (seekFrame(n)); err = frames between that and the n-th picture
//   loop     the automatic loop (Loops row) t0 / t1 / end: ms from the start of the ruler's frame there, and from the real picture change
//   tick     the loop frame's tick on the ruler (painted x -> ms): the same two offsets; tip: the hover text
//   pick     a click on the tick: the picture under the playhead (want: the loop's first picture, A)
//   passes   pass k (the app's t0 + k x period), frame j: the picture shown (want A + j): errors
//   cut      K at the frame showing picture 2000 + C: the stored cut vs the real change, the pictures either side of it
//   steps    frame steps across [s0, s1): every picture once, in order (the clip's dropped frame inside)
//   node dev/loops-grid-check.mjs <clip> --loop A:L:P --cut C --steps s0:s1 [--json out.json]
// Exits 1 when anything is off the real frames.
import { writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
const argv = process.argv.slice(2), opt = (k, d = null) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const src = argv[0], clip = src.replace(/(\.[a-z0-9]+)$/i,`.run${process.pid}$1`), [A, L, P] = opt('loop', '200:24:3').split(':').map(Number), C = +opt('cut', '300'), [s0, s1] = opt('steps', '30:50').split(':').map(Number);
const real = opt('real') ? JSON.parse(readFileSync(opt('real'), 'utf8')) : null, jsonOut = opt('json');
copyFileSync(src, clip);   // a path of its own: the automatic loops are marked once per video and session
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const pic = (k) => (k < A ? k : k < A + L * P ? A + ((k - A) % L) : 2000 + k);   // the k-th decoded picture

await ev(async (p) => {
  clearInterval(window.__noRecover);
  window.__noRecover = setInterval(() => { if (app.dialog) app.dialog.resolve('discard'); }, 150);
  app.settings.set('video.scrubCache', false); app.settings.set('lanes.hoverScrub', false); app.settings.set('timeline.frameCursor', 'off');
  await app.project.openVideo(p, { force: true });
}, clip);
const base = clip.split(/[\\/]/).pop();
await page.waitForFunction((base) => app.doc.media?.path?.endsWith(base) && app.player.ready && (app.player.vw > 0 || app.player.error), base, { timeout: 60000 });
if (argv.includes('--proxy')) {   // a file the webview cannot play: its proxy (media.rs proxy_args), as an owner clip
  await ev(() => { if (!app.player.media?.proxyOf) app.player.makeProxy(); });
  await page.waitForFunction(() => app.player.media?.proxyOf && app.player.ready && app.player.vw > 0, null, { timeout: 300000, polling: 500 });
}
await ev(() => { app.setMode('scenes'); app.player.pause(); });
await page.waitForFunction(() => (app.doc.loops || []).some((l) => l.auto), null, { timeout: 120000, polling: 500 }).catch(() => {});
await wait(1500);   // the frame table (a packet scan) and the edges re-snap, when they come
const info = await ev(() => ({ proxy: !!app.player.media?.proxyOf, startMs: app.player.startMs, kind: app.player.clock.kind, frameMs: app.player.frameMs, count: app.player.clock.count, fps: app.doc.media.fps, loops: app.doc.loops.map((l) => ({ t0: l.t0, t1: l.t1, auto: l.auto })) }));
console.log(JSON.stringify(info));

/** The id painted in the video (a screenshot of the picture's box: object-fit contain). */
async function shown() {
  await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await ev(() => { const v = document.querySelector('video'), b = v.getBoundingClientRect(), s = Math.min(b.width / v.videoWidth, b.height / v.videoHeight), w = v.videoWidth * s, h = v.videoHeight * s; return { x: b.left + (b.width - w) / 2, y: b.top + (b.height - h) / 2, w, h }; });
  const png = (await page.screenshot({ clip: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.floor(r.w), height: Math.floor(r.h) }, scale: 'css' })).toString('base64');
  return ev(async (png) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const px = (i, row) => { const d = x.getImageData(Math.floor(((i + 0.5) * bmp.width) / 16), Math.floor(((row * 2 + 1) * bmp.height) / 4), 1, 1).data; return (d[0] + d[1] + d[2]) / 3; };
    if (px(0, 0) - px(15, 0) < 80) return -1;
    let n = 0;
    for (let i = 1; i <= 14; i++) { const a = px(i, 0) > 128, b2 = px(i, 1) > 128; if (a === b2) return -1; n = n * 2 + (a ? 1 : 0); }
    return n;
  }, png);
}
const atFrame = async (n) => { await ev((n) => app.player.seekFrame(n), n); return shown(); };
const clockAt = (t) => ev((t) => { const c = app.player.clock, n = c.frameAt(t), a = c.timeOf(n), e = c.endOf(n); return { n, a, frac: (t - a) / (e - a), ms: t - a, span: e - a }; }, t);
const realOff = (t, k) => (real ? Math.round((t - real[k]) * 1000) / 1000 : null);   // ms from the real picture change k
const fails = [], out = { clip, info };

// pics: the frame numbers vs the pictures
out.pics = [];
for (const n of [0, 1, 2, 39, 40, 41, A - 1, A, A + 1, C, C + 1]) { const id = await atFrame(n); out.pics.push({ n, id, want: pic(n), err: id < 0 ? null : (() => { for (let d = -4; d <= 4; d++) if (pic(n + d) === id) return d; return 'far'; })() }); }
for (const p of out.pics) if (p.err !== 0) fails.push(`frame ${p.n} shows picture ${p.id} (want ${p.want})`);

// loop: the automatic loop's edges
const lp = info.loops.find((l) => l.auto);
if (!lp) fails.push('no automatic loop');
else {
  const per = (lp.auto.end - lp.t0) / lp.auto.n;
  out.loop = { t0: lp.t0, t1: lp.t1, end: lp.auto.end, n: lp.auto.n, t0Clock: await clockAt(lp.t0), t1Clock: await clockAt(lp.t1), endClock: await clockAt(lp.auto.end), t0Real: realOff(lp.t0, A), t1Real: realOff(lp.t1, A + L), endReal: realOff(lp.auto.end, A + L * P) };
  for (const k of ['t0Clock', 't1Clock', 'endClock']) if (Math.abs(out.loop[k].ms) > 0.6) fails.push(`loop ${k} ${out.loop[k].ms.toFixed(2)} ms off the ruler's frame`);
  for (const k of ['t0Real', 't1Real', 'endReal']) if (out.loop[k] != null && Math.abs(out.loop[k]) > 0.6) fails.push(`loop ${k} ${out.loop[k]} ms off the real frame`);
  // passes: pass k frame j shows A + j
  out.passes = { errors: 0, checked: 0, bad: [] };
  for (let k = 0; k < P; k++) {
    const n0 = (await clockAt(Math.round(lp.t0 + k * per))).n;
    for (const j of [0, 1, Math.floor(L / 2), L - 2, L - 1]) {
      const id = await atFrame(n0 + j); out.passes.checked++;
      if (id !== A + j) { out.passes.errors++; out.passes.bad.push({ k, j, id }); }
    }
  }
  if (out.passes.errors) fails.push(`${out.passes.errors} of ${out.passes.checked} pass frames show another picture`);

  // tick: zoom on the loop start, read the strip, click the tick
  await ev((t) => { const fm = app.player.frameMs; app.view = { start: t - 6 * fm, span: 12 * fm }; }, lp.t0);
  await wait(400);
  const R = await ev(() => { const e = document.querySelector('[data-tl-lane="ruler"]') || document.querySelector('.ruler canvas')?.parentElement, r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: e.clientWidth, h: e.clientHeight, view: { ...app.view } }; });
  const png = (await page.screenshot({ clip: { x: Math.floor(R.x), y: Math.floor(R.y), width: Math.floor(R.w), height: 9 }, scale: 'css' })).toString('base64');
  const cols = await ev(async (png) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 5, bmp.width, 1).data, sat = [];
    for (let i = 0; i < bmp.width; i++) { const r = d[4 * i], g = d[4 * i + 1], bl = d[4 * i + 2]; sat.push(Math.max(r, g, bl) - Math.min(r, g, bl) > 60); }
    const runs = []; let s = -1;
    sat.forEach((v, i) => { if (v && s < 0) s = i; if ((!v || i === sat.length - 1) && s >= 0) { runs.push([s, v ? i + 1 : i]); s = -1; } });
    return runs;
  }, png);
  const xT = (x) => R.view.start + ((x - R.x + Math.floor(R.x)) / R.w) * R.view.span;
  const near = cols.map(([a, e]) => [xT(a), xT(e)]).sort((p, q) => Math.abs(p[0] - lp.t0) - Math.abs(q[0] - lp.t0))[0];
  if (!near) fails.push('no repeat tick painted at the loop start');
  else {
    out.tick = { t0: near[0], t1: near[1], startClock: await clockAt(near[0]), endClock: await clockAt(near[1]), startReal: realOff(near[0], A), endReal: realOff(near[1], A + 1) };
    const pxMs = R.view.span / R.w;   // a painted edge is good to a pixel
    const off = (c) => Math.min(c.ms, c.span - c.ms);   // to the nearest frame start (a painted edge is good to a pixel)
    out.tick.startOff = off(out.tick.startClock); out.tick.endOff = off(out.tick.endClock);
    if (out.tick.startOff > pxMs + 0.6 || out.tick.endOff > pxMs + 0.6) fails.push(`tick edges ${out.tick.startOff.toFixed(2)} / ${out.tick.endOff.toFixed(2)} ms off the ruler's frame starts`);
    if (out.tick.startReal != null && Math.abs(out.tick.startReal) > pxMs + 0.6) fails.push(`tick starts ${out.tick.startReal} ms off the real loop frame`);
    const cx = R.x + ((near[0] + near[1]) / 2 - R.view.start) / R.view.span * R.w;
    await page.mouse.move(cx, R.y + 5); await wait(400);
    out.tip = await ev(() => [...document.querySelectorAll('body *')].map((e) => e.childElementCount ? '' : e.textContent).find((s) => /Loop of \d+ pictures/.test(s)) || app.tl?.hint?.text || null);
    await page.mouse.click(cx, R.y + 5); await wait(600);
    out.pick = { playhead: await ev(() => app.player.timeMs), id: await shown() };
    if (out.pick.id !== A) fails.push(`clicking the loop frame's tick shows picture ${out.pick.id} (want ${A})`);
    await page.mouse.move(R.x + R.w / 2, R.y + 200);
  }
}

// cut: K at the frame showing picture 2000 + C
let nC = -1;
for (let n = C - 4; n <= C + 4 && nC < 0; n++) if ((await atFrame(n)) === pic(C)) nC = n;
await ev(() => { if (!(app.doc.scenes || []).length) app.transact('one shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: Math.round(app.durationMs) }]; }); });
const before = await ev(() => (app.doc.scenes || []).map((s) => s.start_ms));
await atFrame(nC);
await ev(() => app.commands.run('timeline.shot.split'));
await wait(300);
const cut = (await ev(() => (app.doc.scenes || []).map((s) => s.start_ms))).find((t) => !before.includes(t));
out.cut = { frame: nC, cut, clock: cut != null ? await clockAt(cut) : null, real: cut != null ? realOff(cut, C) : null, at: cut != null ? await atFrame((await clockAt(cut)).n) : null, prev: cut != null ? await atFrame((await clockAt(cut)).n - 1) : null };
if (cut == null) fails.push('no cut made');
else {
  if (out.cut.at !== pic(C) || out.cut.prev !== pic(C - 1)) fails.push(`the cut's frame shows ${out.cut.at}, the frame before ${out.cut.prev} (want ${pic(C)} | ${pic(C - 1)})`);
  if (out.cut.real != null && Math.abs(out.cut.real) > 0.6) fails.push(`the cut is ${out.cut.real} ms from the real picture change`);
}
await ev(() => app.undo());

// steps
out.steps = [];
await atFrame(s0);
for (let n = s0; n < s1; n++) { out.steps.push(await shown()); await ev(() => app.player.step(1)); await page.waitForFunction(() => !app.player.seeking, null, { timeout: 5000 }).catch(() => {}); }
const ids = out.steps;
const skipped = [], dup = [];
for (let i = 1; i < ids.length; i++) { if (ids[i] === ids[i - 1]) dup.push(ids[i]); else if (ids[i] !== ids[i - 1] + 1) skipped.push([ids[i - 1], ids[i]]); }
out.stepsSummary = { first: ids[0], last: ids.at(-1), dup, skipped };
if (dup.length || skipped.length) fails.push(`frame steps: ${dup.length} repeated, ${skipped.length} skipped (${JSON.stringify(skipped.slice(0, 3))})`);

// resnap (--resnap, a clip whose clock becomes its frame table): a project saved with cuts on the old n x frameMs grid and a point
// between frames, opened: the cuts land on the real frames' starts (the picture the old frame showed), one toast, the point stays
if (argv.includes('--resnap') && info.kind === 'table') {
  const fm = await ev(() => app.doc.media.fps), media = await ev(() => ({ ...app.doc.media }));
  const nominal = (n) => Math.round((n * 1000) / fm), dur = Math.round(media.durationMs), pt = Math.round(real[C] + 13);   // inside real frame C, not on a start
  const projClip = clip.replace(/(\.[a-z0-9]+)$/i, '.proj$1'), proj = clip.replace(/(\.[a-z0-9]+)$/i, '.pawproj');
  copyFileSync(src, projClip);
  const { serialize } = await import('../src/lib/io/index.js');
  const cuts = [C, C + 100];
  writeFileSync(proj, serialize({ media: { ...media, path: projClip, name: projClip.split(/[\\/]/).pop() }, axes: { stroke: [{ at: pt, pos: 40 }, { at: pt + 300, pos: 60 }] }, activeAxis: 'stroke',
    extra: { scenes: [0, ...cuts].map((n, i, a) => ({ start_ms: i ? nominal(n) : 0, end_ms: i < a.length - 1 ? nominal(a[i + 1]) : dur })) }, chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], fx: [] }, { savedAt: new Date().toISOString() }));
  await ev(() => { window.__toasts = []; if (!app.__toastWrapped) { const t = app.toast.bind(app); app.toast = (m, ...a) => { window.__toasts.push(String(m)); return t(m, ...a); }; app.__toastWrapped = true; } });
  await ev((p) => app.project.openProject(p, { force: true }), proj);
  await page.waitForFunction((b) => app.doc.media?.path?.endsWith(b) && app.player.clock.kind === 'table', projClip.split(/[\\/]/).pop(), { timeout: 60000 }).catch(() => {});
  await wait(1500);
  const got = await ev(() => ({ starts: app.doc.scenes.map((s) => s.start_ms), stroke: app.doc.axes.stroke.map((a) => a.at), toasts: window.__toasts.filter((m) => /real frames/.test(m)) }));
  const shownAt = (t) => { let k = 0; while (k + 1 < real.length && real[k + 1] <= t) k++; return k; };   // the picture on screen at t
  const want = cuts.map((n) => Math.round(real[shownAt(nominal(n) + 500 / fm)]));   // the one the old frame showed (its middle)
  out.resnap = { before: cuts.map(nominal), after: got.starts.slice(1), want, point: { stored: pt, after: got.stroke[0] }, toasts: got.toasts };
  if (JSON.stringify(got.starts.slice(1)) !== JSON.stringify(want)) fails.push(`re-snap: cuts ${got.starts.slice(1)} (want ${want})`);
  if (got.stroke[0] !== pt) fails.push(`re-snap moved a point ${pt} -> ${got.stroke[0]}`);
  if (got.toasts.length !== 1) fails.push(`re-snap toasts: ${JSON.stringify(got.toasts)}`);
  console.log('resnap', JSON.stringify(out.resnap));
}

out.fails = fails;
console.log(JSON.stringify({ pics: out.pics, loop: out.loop, passes: out.passes, tick: out.tick, tip: out.tip, pick: out.pick, cut: out.cut, steps: out.stepsSummary }, null, 1));
console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'all on the real frames');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
await b.close();
for (const f of [clip, clip.replace(/(.[a-z0-9]+)$/i, '.proj$1'), clip.replace(/(.[a-z0-9]+)$/i, '.pawproj')]) try { rmSync(f, { force: true }); } catch { /* still open in the app */ }
process.exit(fails.length ? 1 : 0);
