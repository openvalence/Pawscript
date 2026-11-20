// dev/paint-perf-check.mjs -- paw-o60v.6 "when painting cursor is stuttery", in YOUR test instance (CDP_* env; dist built
// with VITE_TEST_ID), on the big generated project (dev/perf/big-project.mjs: 100 shots, 208 painted groups, 24 runs of 1024
// points). Real pointer input over CDP at a 250 Hz mouse's cadence (not awaited one by one: a blocked page gets its moves
// queued and coalesced, as a real mouse does), the Groups tool on:
//   strokes: untracked / tracked shot (blobs view), brush small / large, erase, 20 more groups, edge snap on; hover with no
//   button (paused, and while playing).
//   per move: input (the oldest coalesced sample) to the end of the next rendering update (p50 / p95 / max), the ring and the
//   dab painted in that update (cursor canvas / stroke layer stamped with the move), main-thread busy per move (V8 profile),
//   long tasks during the stroke; pen up to painted and the longest frame in the 1.5 s after it (stroke end to settled).
//   who key (1 / 2 over a group) x20 and scene tag x10: input to next paint (Event Timing).
//   result: every stroke's stored mask = the brush replayed in Node (groups.js stroke / eraseIslands) over the samples the
//   app took, from the mask the group had before: the paint is exactly the pointer path's (pixel-identical: hash + RLE).
// Targets (--assert): ring / dab within one rendering update of every move, under 8 ms main-thread work per move, no long
// task during a stroke; stroke end to settled under 50 ms; who key and tag under 16 ms p50.
//   node dev/paint-perf-check.mjs <big.mp4> [--out <jsonl>] [--label <text>] [--dist <build dir>] [--assert] [--only <case,...>] [--keep] [--settle <s>]
import { appendFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
import { stroke as brush, eraseIslands, encodeMask } from '../src/features/tracking/groups.js';
import { profStart } from './perf/probe.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SourceMapConsumer } from 'source-map-js';

const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const clip = argv[0], proj = clip.replace(/\.[^.]+$/, '.pawproj'), out = opt('out'), label = opt('label') || '', ASSERT = argv.includes('--assert');
const only = opt('only')?.split(',') || null;
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const act = (f, a) => page.evaluate(`(async () => { await (${f})(${JSON.stringify(a ?? null)}); })()`);   // never hand a store back over CDP
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : (ASSERT ? 'FAIL ' : 'miss ')) + msg); };
const log = (o) => { console.log(JSON.stringify(o)); if (out) appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), label, ...o }) + '\n'); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const s = await page.context().newCDPSession(page);
const q = (xs, p) => { xs = xs.slice().sort((a, b) => a - b); return xs.length ? +xs[Math.min(xs.length - 1, Math.floor(p * xs.length))].toFixed(1) : 0; };
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const seek = async (t) => { await ev((t) => { app.player.pause(); app.player.seek(t, { exact: true }); }, t); await page.waitForFunction((t) => Math.abs(app.player.timeMs - t) < 40 && !app.player.el?.seeking, t, { timeout: 15000 }).catch(() => {}); await wait(400); };

async function openBig() {
  if (argv.includes('--keep') && await ev(() => !!app.doc.media).catch(() => false)) return false;   // default: a fresh open, every case on the project as generated
  await ev(async () => { for (const c of (await app.backend.autosaveList()) || []) await app.backend.autosaveClear(c.id); });
  const p = ev((f) => app.project.openProject(f, { force: true }).then(() => 'ok', (e) => String(e)), proj);
  for (let k = 0; k < 6; k++) { await wait(300); await answer(); }
  await p;
  await act(() => app.project.stopAutosave?.());   // an autosave writes the 126 MB runs: Playwright mirrors that IPC body and loses the page (RESULTS.md)
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).runs.length >= 20, null, { timeout: 180000 }).catch(() => {});
  return true;
}

// ---- page-side recorder: per pointer move, input -> end of the next rendering update; what that update showed ----
const install = () => ev(() => {
  if (window.__pp) return;
  const P = (window.__pp = { on: false, lat: [], ring: [], dab: [], long: [], frames: [], last: 0, up: null, moves: 0 });
  const after = (f) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = f; c.port2.postMessage(0); });   // runs once that frame's rendering is done
  const stamp = () => { const G = __pawDev.groupsFor(app); return { cur: window.__ppCur || 0, ver: G.draft ? G.draft.ver : -1, shown: G.draft ? (G.draft.drawnVer ?? G.draft.ver) : -1 }; };
  window.addEventListener('pointermove', (e) => {
    if (!P.on) return;
    const cs = e.getCoalescedEvents?.() || [], t0 = cs.length ? cs[0].timeStamp : e.timeStamp, seq = ++P.moves;
    after(() => { P.lat.push(performance.now() - t0); const st = stamp(); P.ring.push(st.cur >= seq ? 1 : 0); if (st.ver >= 0) P.dab.push(st.shown >= st.ver ? 1 : 0); });
  }, { capture: true, passive: true });
  // the ring's canvas, stamped with the move it last drew (wrapping only what the check reads: the canvas' own clearRect)
  const tag = () => { const cv = document.querySelector('canvas.gcursor'); if (!cv || cv.__pp) return; cv.__pp = true; const g = cv.getContext('2d'), cr = g.clearRect.bind(g); g.clearRect = (...a) => { window.__ppCur = P.moves; return cr(...a); }; };
  setInterval(tag, 200); tag();
  window.addEventListener('pointerup', (e) => { if (!P.on) return; const t0 = e.timeStamp; after(() => { P.up = performance.now() - t0; }); }, { capture: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (P.on) P.long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  const loop = (t) => { if (P.on && P.last) P.frames.push([t, t - P.last]); P.last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  P.events = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (P.on && e.interactionId) P.events.push([e.interactionId, e.duration, e.name]); }).observe({ type: 'event', durationThreshold: 16 });
});
const rec = (on) => ev((on) => { const P = window.__pp; if (on) { P.lat = []; P.ring = []; P.dab = []; P.long = []; P.frames = []; P.up = null; P.events = []; P.last = 0; } P.on = on; }, on);
const readRec = () => ev(() => { const P = window.__pp; return { lat: P.lat, ring: P.ring, dab: P.dab, long: P.long, frames: P.frames, up: P.up, events: P.events, moves: P.moves }; });
const dist = opt('dist');   // the build's folder (source maps): the profile's functions as src/ file:line
const profOn = () => profStart(s, 200);
const maps = new Map();
const where = (cf) => {
  if (!cf.url) return `(${cf.functionName || 'native'})`;
  const file = cf.url.replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
  if (dist && !maps.has(file)) { const p = join(dist, file + '.map'); maps.set(file, existsSync(p) ? new SourceMapConsumer(JSON.parse(readFileSync(p, 'utf8'))) : null); }
  const m = dist && maps.get(file), o = m?.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
  return o?.source ? `${o.source.replace(/^.*?\/(src|node_modules)\//, '$1/')}:${o.line}` : `${file}:${cf.lineNumber + 1}`;
};
/** Stops the profiler -> {busy ms, top: self time, incl: inclusive time per function (src file:line through the source maps)}. */
async function profOff() {
  const { profile } = await s.send('Profiler.stop'), byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map(), incl = new Map(), key = new Map();
  const k = (id) => { if (!key.has(id)) { const cf = byId.get(id).callFrame; key.set(id, `${cf.functionName || '(anon)'} ${where(cf)}`); } return key.get(id); };
  let busy = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i], ms = (profile.timeDeltas[i + 1] ?? 0) / 1000, fn = byId.get(id).callFrame.functionName;
    if (/^\((idle|program)\)$/.test(fn)) continue;
    busy += ms;
    self.set(k(id), (self.get(k(id)) || 0) + ms);
    const seen = new Set();
    for (let x = id; x != null; x = parent.get(x)) { const kk = k(x); if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + ms); } }
  }
  const top = (m, n) => [...m].filter(([kk]) => !/^\(root\)/.test(kk)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([kk, ms]) => `${ms.toFixed(1)} ${kk}`);
  return { busy, top: top(self, 12), incl: top(incl, 40) };
}

// ---- input: CDP mouse events at a fixed cadence, each sent without waiting for the previous one's ack ----
const V = () => ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const mouse = (type, x, y, extra = {}) => s.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
async function path(pts, { button = false, mods = 0, hz = 250 } = {}) {
  const pend = [], dt = 1000 / hz, t0 = performance.now();
  for (let k = 0; k < pts.length; k++) {
    const [x, y] = pts[k];
    pend.push(mouse('mouseMoved', x, y, button ? { button: 'left', buttons: 1, modifiers: mods } : { modifiers: mods }));
    const due = t0 + (k + 1) * dt;
    while (performance.now() < due) await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now() - 1)));
  }
  await Promise.all(pend);
}
/** A wavy stroke across part of the picture: n samples (fx, fy fractions of the picture). */
const wave = (r, fx0, fy0, n = 300, span = 0.3) => Array.from({ length: n }, (_, k) => { const u = k / (n - 1); return [r.x + (fx0 + span * u) * r.w, r.y + (fy0 + 0.06 * Math.sin(u * Math.PI * 4)) * r.h]; });

/** Painted alpha (max over a small box) at client point pt on the ring's canvas (a box the brush's size: the ring and its
 *  label), the stroke canvas and the overlay canvas: what the window shows there, read from the canvases themselves. */
const alphaAt = ([x, y]) => ev(([x, y]) => {
  const at = (sel, half) => {
    const cv = document.querySelector(sel);
    if (!cv) return -1;
    const r = cv.getBoundingClientRect(), k = cv.width / r.width, X = Math.round((x - r.left) * k), Y = Math.round((y - r.top) * k), h = Math.max(1, Math.round(half * k));
    const d = cv.getContext('2d').getImageData(X - h, Y - h, 2 * h + 1, 2 * h + 1).data;
    let m = 0; for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]);
    return m;
  };
  const G = __pawDev.groupsFor(app), v = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect();
  return { ring: at('canvas.gcursor', G.radius * v.height + 6), stroke: at('canvas.gstroke', 2), overlay: at('[data-testid="video-stage"] canvas.ov', 2) };
}, [x, y]);

// the stroke's samples and the mask it started from, stashed at pen up (G.end wrapped on the instance; Float32 as base64)
const hook = () => ev(() => {
  const G = __pawDev.groupsFor(app);
  if (G.__ppHook) return;
  G.__ppHook = true;
  const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const end = G.end.bind(G);
  G.end = (...a) => {
    const d = G.draft;
    if (d) window.__ppLast = { pts: d.pts.map((p) => [p[0], p[1]]), erase: d.erase, before: d.before ? b64(d.before.a) : null, w: d.raw.w, h: d.raw.h, r: G.radius * d.raw.h, k: d.k, g: d.g, name: d.name, n0: G.groups.length, keepPos: null };
    return end(...a);
  };
});
/** The group the last stroke landed on: its stored mask (cached full precision, as base64) and its RLE. */
const landed = () => ev(() => {
  const G = __pawDev.groupsFor(app), L = window.__ppLast;
  if (!L) return null;
  const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const g = L.g ? G.groups.find((x) => x.name === L.g.name) : G.groups[G.active];
  if (!g) return { ...L, g: null, gone: true };
  return { ...L, g: g.name, mask: b64(G.maskFor(g).a), rle: g.mask?.rle || null };
});
const f32 = (b) => { const u = Buffer.from(b, 'base64'); return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4); };
function replay(L) {
  const a = L.before ? f32(L.before).slice() : new Float32Array(L.w * L.h), m = { w: L.w, h: L.h, a };
  brush(m, L.pts[0], L.pts[0], L.r, { erase: L.erase });
  for (let i = 1; i < L.pts.length; i++) brush(m, L.pts[i - 1], L.pts[i], L.r, { erase: L.erase });
  return L.erase && L.before ? eraseIslands({ w: L.w, h: L.h, a: f32(L.before) }, m, []) : m;
}
const fnv = (a) => { const u = new Uint32Array(a.buffer, a.byteOffset, a.length); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };

const cases = [
  { id: 'untracked', t: 540500, brush: 0.04 },
  { id: 'tracked', t: 90500, brush: 0.04 },
  { id: 'tracked-large', t: 90500, brush: 0.15 },
  { id: 'tracked-erase', t: 90500, brush: 0.04, erase: true },
  { id: 'tracked-many', t: 90500, brush: 0.04, many: 20 },
  { id: 'tracked-snap', t: 90500, brush: 0.04, snap: true },
  { id: 'hover-paused', t: 90500, brush: 0.04, hover: true },
  { id: 'hover-playing', t: 90500, brush: 0.04, hover: true, play: true },
];
const results = { label };
try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.groupsFor, null, { timeout: 60000 });
  if (await openBig()) await wait(1000 * +(opt('settle') ?? 70));   // after an open the shot-link scan keeps the main thread busy for about a minute (paw-o60v.1): measured after it
  await act(() => { app.setMode('track'); app.project.stopAutosave?.(); app.settings.set('tracking.trails', 'blobs'); app.settings.set('tracking.groups.circle', false); app.settings.set('tracking.groups.grow', false); app.settings.set('tracking.groups.askAfter', false); });
  await install(); await hook();
  await wait(1500);
  const load = await ev(() => navigator.hardwareConcurrency);
  for (const c of cases) {
    if (only && !only.includes(c.id)) continue;
    await act(() => { const G = __pawDev.groupsFor(app); if (G.on) G.toggle(false); });
    await seek(c.t);
    await act((c) => { app.settings.set('tracking.groups.brush', c.brush); app.settings.set('tracking.groups.snap', !!c.snap); const G = __pawDev.groupsFor(app); G.toggle(true); G.disarm?.(); }, c);
    await wait(800);
    const r = await V(), h0 = await ev(() => app._history.index);
    if (c.many) {   // more groups on this frame: real strokes through the tool's own begin / move / end, away from the test stroke
      await act((n) => { const G = __pawDev.groupsFor(app); for (let k = 0; k < n; k++) { const x = 0.05 + 0.09 * (k % 10), y = k < 10 ? 0.86 : 0.94; G.begin(x, y, false, 1, true); G.move(x + 0.02, y); G.end(); } }, c.many);
      await wait(1500);
    }
    const n0 = await ev(() => __pawDev.groupsFor(app).groups.length);
    if (c.play) await act(() => app.player.play());
    const pts = wave(r, 0.2, c.erase ? 0.42 : 0.6);
    if (c.erase) {   // something to erase: one plain stroke first, the erase across it
      await mouse('mouseMoved', ...pts[0]); await mouse('mousePressed', ...pts[0], { button: 'left', buttons: 1, clickCount: 1 });
      await path(pts.slice(0, 120), { button: true }); await mouse('mouseReleased', ...pts[119], { button: 'left', buttons: 0, clickCount: 1 });
      await wait(1500);
    }
    const ePts = c.erase ? wave(r, 0.2, 0.42, 300, 0.3).map(([x, y]) => [x, y + 0.01 * r.h]) : pts;
    const mods = c.erase ? 8 : 0;
    await mouse('mouseMoved', ...ePts[0], { modifiers: mods });
    await wait(300);
    await profOn(); await rec(true);
    if (!c.hover) await mouse('mousePressed', ...ePts[0], { button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
    await path(ePts, { button: !c.hover, mods });
    const pr = await profOff();
    const mv = await readRec();
    const mid = await alphaAt(ePts.at(-1));   // still pressed: what the canvases paint at the pointer
    await profOn(); await rec(true);
    if (!c.hover) await mouse('mouseReleased', ...ePts.at(-1), { button: 'left', buttons: 0, clickCount: 1, modifiers: mods });
    await wait(1500);
    const pu = await profOff(), af = await readRec();
    const after = await alphaAt(ePts.at(-1));
    await rec(false);
    if (c.play) await act(() => app.player.pause());
    const moves = mv.lat.length, frameMax = Math.max(0, ...mv.frames.map((f) => f[1]));
    const settle = Math.max(0, ...af.frames.map((f) => f[1]));
    const o = { case: c.id, moves, latP50: q(mv.lat, 0.5), latP95: q(mv.lat, 0.95), latMax: q(mv.lat, 1), ringInFrame: moves ? +(mv.ring.reduce((a, b) => a + b, 0) / moves).toFixed(3) : 0,
      dabInFrame: mv.dab.length ? +(mv.dab.reduce((a, b) => a + b, 0) / mv.dab.length).toFixed(3) : null, busyPerMove: +(pr.busy / Math.max(1, moves)).toFixed(2), busy: Math.round(pr.busy),
      long: mv.long, frameMax: Math.round(frameMax), upToPaint: af.up != null ? Math.round(af.up) : null, settleFrameMax: Math.round(settle), settleLong: af.long, settleBusy: Math.round(pu.busy), top: pr.top, incl: pr.incl, topUp: pu.top, inclUp: pu.incl, groups: [n0, await ev(() => __pawDev.groupsFor(app).groups.length)], cpus: load, mid, after };
    if (!c.hover && !c.snap) {   // the stored paint against the brush replayed over the app's own samples (the snap moves edges: the synthetic strokes compare it across builds)
      const L = await landed();
      if (L?.mask) {
        const want = replay(L), got = f32(L.mask);
        o.pixels = { same: fnv(want.a) === fnv(got), hash: fnv(got), rle: JSON.stringify(encodeMask(want).rle) === JSON.stringify(L.rle), samples: L.pts.length };
      } else o.pixels = { same: false, why: L?.gone ? 'group gone' : 'no stroke recorded' };
    }
    results[c.id] = o;
    log(o);
    await act((h0) => { while (app._history.index > h0) app.undo(); }, h0);   // the document as it was: every case paints on the same groups
    await wait(600);
  }
  // the same strokes through the tool's own begin / move / end (no timing in it): their stored masks' hashes, to compare builds
  if (!only || only.includes('synthetic')) {
    await act(() => { const G = __pawDev.groupsFor(app); if (G.on) G.toggle(false); }); await seek(90500);
    await act(() => { app.settings.set('tracking.groups.brush', 0.05); const G = __pawDev.groupsFor(app); G.toggle(true); G.disarm?.(); }); await wait(800);
    const hashes = await ev(async () => {
      const G = __pawDev.groupsFor(app), out = {}, path = (x0, y0, n = 80) => Array.from({ length: n }, (_, k) => [x0 + 0.3 * k / (n - 1), y0 + 0.05 * Math.sin(k / 6)]);
      const fnv = (a) => { const u = new Uint32Array(a.buffer, a.byteOffset, a.length); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
      const run = async (id, pts, { erase = false, force = false, snap = false } = {}) => {
        app.settings.set('tracking.groups.snap', snap);
        if (snap) await G.prefetch?.();
        G.begin(pts[0][0], pts[0][1], erase, 1, force); for (const p of pts.slice(1)) G.move(p[0], p[1]); G.end();
        await new Promise((r) => setTimeout(r, 300));
        const g = G.groups[G.active];
        out[id] = g ? `${g.name}:${fnv(G.maskFor(g).a)}:${g.poly?.length}` : 'none';
      };
      const h0 = app._history.index, g0 = G.groups[0].poly, cx = g0.reduce((a, q) => a + q[0], 0) / g0.length, cy = g0.reduce((a, q) => a + q[1], 0) / g0.length;
      await run('new', path(0.15, 0.62), { force: true });
      await run('add', path(cx - 0.05, cy));
      await run('erase', path(cx - 0.1, cy + 0.01), { erase: true });
      await run('snap', path(0.15, 0.72), { force: true, snap: true });
      while (app._history.index > h0) app.undo();
      app.settings.set('tracking.groups.snap', false);
      return out;
    });
    results.synthetic = hashes;
    log({ case: 'synthetic', hashes });
  }
  // who keys (over a group) and scene tags: input to next paint (Event Timing: an interaction = its slowest event)
  if (!only || only.includes('who')) {
    await act(() => { const G = __pawDev.groupsFor(app); if (G.on) G.toggle(false); }); await seek(90500);
    await act(() => { const G = __pawDev.groupsFor(app); G.toggle(true); }); await wait(800);
    const r = await V(), g = await ev(() => { const G = __pawDev.groupsFor(app), p = G.groups[0].poly; return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]; });
    await page.mouse.move(r.x + g[0] * r.w, r.y + g[1] * r.h); await wait(400);
    await profOn(); await wait(300); await rec(true);
    for (let k = 0; k < 20; k++) { await page.keyboard.press(k % 2 ? '2' : '1'); await wait(250); }
    const pw = await profOff(), w = await readRec(); await rec(false);
    const per = new Map(); for (const [id, d] of w.events) per.set(id, Math.max(per.get(id) || 0, d));
    const xs = [...per.values()], under = 20 - xs.length;   // Event Timing reports 16 ms and up only: the others were faster
    const all = [...xs, ...Array(Math.max(0, under)).fill(8)];
    results.who = { n: 20, over16: xs.length, p50: q(all, 0.5), p90: q(all, 0.9), max: q(all, 1), long: w.long, busyPerKey: +(pw.busy / 20).toFixed(1), top: pw.top, incl: pw.incl };
    log({ case: 'who', ...results.who });
    await act(() => { const G = __pawDev.groupsFor(app); G.toggle(false); });
  }
  if (!only || only.includes('tags')) {
    await seek(120500);
    await rec(true);
    for (let k = 0; k < 10; k++) { await act((id) => app.commands.run(id), ['timeline.scene.tag.oral', 'timeline.scene.tag.side'][k % 2]); await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await wait(250); }
    await profOn(); await wait(300); const per10 = [];
    for (let k = 0; k < 10; k++) per10.push(await ev(async (id) => { const t0 = performance.now(); app.commands.run(id); await new Promise((r) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); })); return performance.now() - t0; }, ['timeline.scene.tag.oral', 'timeline.scene.tag.side'][k % 2]));
    const pt = await profOff(), w = await readRec(); await rec(false);
    results.tags = { n: 10, p50: q(per10, 0.5), p90: q(per10, 0.9), max: q(per10, 1), long: w.long, busyPerTag: +(pt.busy / 10).toFixed(1), top: pt.top, incl: pt.incl };
    log({ case: 'tags', ...results.tags });
  }
  // ---- the targets ----
  for (const c of cases) {
    const o = results[c.id];
    if (!o) continue;
    ok(o.latP95 <= 17, `${c.id}: input -> painted within one 60 Hz frame for 95 % of the moves (p95 ${o.latP95} ms, max ${o.latMax})`);
    ok(o.ringInFrame >= 0.98, `${c.id}: the ring drawn in the rendering update after ${Math.round(o.ringInFrame * 100)} % of ${o.moves} moves (input -> painted p50 ${o.latP50} / p95 ${o.latP95} / max ${o.latMax} ms)`);
    if (o.dabInFrame != null) ok(o.dabInFrame >= 0.98, `${c.id}: the dab drawn in the rendering update after ${Math.round(o.dabInFrame * 100)} % of the moves`);
    ok(o.busyPerMove < 8, `${c.id}: main thread ${o.busyPerMove} ms per move`);
    ok(!o.long.length, `${c.id}: long tasks during the stroke: ${JSON.stringify(o.long)}`);
    if (!c.hover) ok(o.settleFrameMax < 50 + 17, `${c.id}: stroke end to settled: longest frame ${o.settleFrameMax} ms in the 1.5 s after pen up (pen up to painted ${o.upToPaint} ms; long ${JSON.stringify(o.settleLong)})`);
    ok(o.mid.ring > 0, `${c.id}: the ring is painted at the pointer (alpha ${o.mid.ring})`);
    if (!c.hover && !c.erase) ok(o.mid.stroke > 0 && o.after.stroke === 0 && o.after.overlay > 0, `${c.id}: mid-stroke the stroke canvas paints the dab under the pointer (alpha ${o.mid.stroke}); after pen up it is clear (${o.after.stroke}) and the overlay paints the group there (${o.after.overlay})`);
    if (o.pixels) ok(o.pixels.same && o.pixels.rle, `${c.id}: stored mask = the brush over the app's ${o.pixels.samples} samples (hash ${o.pixels.hash})`);
  }
  if (results.who) ok(results.who.p50 < 16, `who key: input to next paint p50 ${results.who.p50} ms (p90 ${results.who.p90}, max ${results.who.max}; ${results.who.over16} of 20 over 16 ms)`);
  if (results.tags) ok(results.tags.p50 < 16, `scene tag: command to next paint p50 ${results.tags.p50} ms (p90 ${results.tags.p90}, max ${results.tags.max})`);
} catch (e) { fails++; console.log('FAIL', e?.stack || e); }
finally { await browser.close().catch(() => {}); }
console.log(fails ? `${fails} ${ASSERT ? 'FAILED' : 'missed'}` : 'all ok');
process.exit(ASSERT && fails ? 1 : 0);
