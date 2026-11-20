// paw-liwk: the Groups grow brush. Pure parts (stroke / loop -> prompts, the smallest mask that holds them, the soft finishing,
// latest-wins tokens) and the store with a fake sidecar (prompts accumulate per group, one undo step per prompt, a late answer
// is dropped, a busy card refuses and the brush paints as usual).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMask } from '../src/features/tracking/groups.js';
import { strokePoints, strokeExtent, loopPrompt, pickMask, softBlob, latest, resizeMask, areaKeep, MAX_POINTS, BOX_MIN } from '../src/features/tracking/grow.js';
import { marginPx, MARGIN_DEFAULT } from '../src/features/tracking/snap.js';
const insideMargin = (r) => marginPx(MARGIN_DEFAULT / 100, (4 * r) / 3);   // the default paint margin of a disc of radius r (width 4r/3)

const W = 160, H = 120;
const disc = (cx, cy, r, w = W, h = H) => { const a = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r ? 1 : 0; return a; };
const area = (a) => a.reduce((s, v) => s + (v >= 0.5 ? 1 : 0), 0);

test('a dab is one point; a scribble a few spread along it, never more than MAX_POINTS', () => {
  assert.deepEqual(strokePoints([[10, 10]], 5), [[10, 10]]);
  assert.deepEqual(strokePoints([[10, 10], [11, 10], [12, 10]], 5), [[10, 10]], 'points inside the first one add nothing');
  const line = Array.from({ length: 60 }, (_, i) => [10 + i * 2, 20]);
  const p = strokePoints(line, 5);
  assert.ok(p.length > 2 && p.length <= MAX_POINTS && p[0][0] === 10 && p.every((q, i) => !i || Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) >= 5));
});

test('a scribble that lingers at its start still spreads its points over the WHOLE length, last point included; a long one has an extent', () => {
  const path = [...Array.from({ length: 30 }, () => [10, 20]), ...Array.from({ length: 50 }, (_, i) => [10 + i * 2, 20])];
  const p = strokePoints(path, 5);
  assert.ok(p.length >= 4 && p.length <= MAX_POINTS && p[0][0] === 10 && p.at(-1)[0] === 108, 'from the first to the last vertex');
  const xs = p.map((q) => q[0]);
  assert.ok(Math.max(...xs.map((x, i) => (i ? x - xs[i - 1] : 0))) < 40, 'no big gap: spread along it, not clustered');
  assert.equal(strokeExtent([[10, 10], [12, 10]], 5), 0, 'a dab has no extent');
  assert.ok(Math.abs(strokeExtent(path, 5) - 98) < 1 && strokeExtent(path, 5) >= BOX_MIN * 5);
});

test('a circled loop gives its box and points well inside it', () => {
  const poly = Array.from({ length: 40 }, (_, i) => [80 + 30 * Math.cos((i / 40) * 2 * Math.PI), 60 + 30 * Math.sin((i / 40) * 2 * Math.PI)]);
  const { box, points } = loopPrompt(poly, W, H);
  assert.ok(Math.abs(box[0] - 50) < 1 && Math.abs(box[2] - 110) < 1 && Math.abs(box[1] - 30) < 1 && Math.abs(box[3] - 90) < 1);
  assert.ok(points.length >= 2 && points.every(([x, y]) => Math.hypot(x - 80, y - 60) < 22), 'inside, away from the loop line');
});

test('pickMask: a dab walks up the candidate levels (not stuck on a sub-part); every positive must be inside; long strokes match by extent; absurd answers are out', () => {
  const sub = { a: disc(48, 50, 14), score: 0.66 }, part = { a: disc(50, 50, 22), score: 0.52 }, whole = { a: disc(52, 50, 33), score: 0.28 };   // 615 / 1521 / 3421 px: the shape SAM gives on a shaded part
  const masks = [sub, part, whole];
  const dab = pickMask(masks, [[48, 50]], W, H);
  assert.equal(dab.index, 2, 'each level at most LEVEL_MAX x the one below and scored over SCORE_FLOOR: the largest'); assert.deepEqual(dab.steps, [0, 1, 2]); assert.equal(dab.at, 2);
  assert.equal(pickMask([sub, part, { ...whole, score: 0.02 }], [[48, 50]], W, H).index, 1, 'a level SAM scores under SCORE_FLOOR is not taken');
  assert.equal(pickMask([{ a: disc(48, 50, 8), score: 0.7 }, { a: disc(50, 50, 40), score: 0.5 }], [[48, 50]], W, H).index, 0, 'a level 25 x larger is another object: not taken (the dial can go there)');
  assert.equal(pickMask(masks, [[48, 50], [75, 50]], W, H).index, 2, 'a second mark outside the others: the only one holding both');
  assert.equal(pickMask(masks, [[48, 50], [49, 51]], W, H).index, 2, 'two positives inside every candidate: still the largest level');
  assert.equal(pickMask(masks, [[48, 50], [70, 50], [150, 5]], W, H).index, 2, 'none holds all: the ones holding most (here the largest holds two)');
  assert.equal(pickMask([{ a: new Float32Array(W * H) }], [[10, 10]], W, H).why, 'none');
  const spread = [[45, 50], [55, 50]];   // a long stroke: the extent picks
  assert.equal(pickMask([part, whole], spread, W, H, { extent: 150 }).index, 1, 'a stroke 150 px across wants the big candidate');
  assert.equal(pickMask([part, whole], spread, W, H, { extent: 36 }).index, 0, 'one 36 px across the part');
  const huge = { a: disc(80, 60, 59), score: 0.9 };   // 10900 px of 19200
  assert.equal(pickMask([huge], [[80, 60]], W, H).why, 'large', 'over half of the picture');
  assert.equal(pickMask([part], [[50, 50]], W, H, { prev: 100 }).why, 'large', 'twelve times the mask it refines');
  assert.equal(pickMask([part, huge], [[50, 50]], W, H).index, 0, 'the absurd one is skipped, the other stays');
});

test('areaKeep: the smoothed distance keeps the cleaned mask area (the blur must not shrink the part)', () => {
  const raw = disc(80, 60, 12), out = cleanMask(raw, W, H, [[80, 60]], { margin: 0 }).a;
  assert.ok(Math.abs(area(out) - area(raw)) <= 0.02 * area(raw), `a small part keeps its size: ${area(out)} of ${area(raw)}`);
  const s = Float32Array.from({ length: 100 }, (_, i) => i - 30);   // 30 negatives
  assert.equal(areaKeep(s, 40, 99).filter((v) => v < 0).length, 40, 'shifted so exactly px pixels are inside');
  assert.equal(areaKeep(s, 90, 5)[0], -35, 'the shift is at most r px');
});

test('softBlob: a hair inside SAM\'s edge, smooth, and never into another group', () => {
  const a = disc(80, 60, 20), M = insideMargin(8), out = softBlob(a, W, H, { radius: 8 });
  const r = (th) => { let rr = 0; for (let t = 0; t < 40; t += 0.1) { const x = 80 + Math.cos(th) * t, y = 60 + Math.sin(th) * t; if (out[Math.floor(y) * W + Math.floor(x)] >= 0.5) rr = t; } return rr; };
  for (let k = 0; k < 16; k++) assert.ok(Math.abs(r((k / 16) * 2 * Math.PI) - (20 - M)) < 1, `inside by the margin at ${k}`);
  const other = newMask({ w: W, h: H }); for (let y = 0; y < H; y++) for (let x = 90; x < W; x++) other.a[y * W + x] = 1;
  const o2 = softBlob(a, W, H, { radius: 8, others: [other] });
  for (let i = 0; i < o2.length; i++) if (other.a[i] >= 0.5) assert.equal(o2[i], 0);
  assert.ok(area(o2) > 0.6 * area(out));
});

test('latest(): only the newest token is ok; void() drops the one in flight; resizeMask keeps the shape', () => {
  const l = latest(), a = l.next(), b = l.next();
  assert.equal(l.ok(a), false); assert.equal(l.ok(b), true);
  l.void(); assert.equal(l.ok(b), false, 'a cancel drops the answer in flight');
  const m = resizeMask(disc(40, 30, 10, 80, 60), 80, 60, 160, 120);
  assert.ok(Math.abs(area(m) / 4 - area(disc(40, 30, 10, 80, 60))) < 12);
});

// ---- the store, with a fake sidecar
async function tool() {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js'), GJ = await server.ssrLoadModule('/src/features/tracking/groups.js');
  const doc = { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 30000 }], ghosts: [] };
  doc.media = { ...(doc.media || {}), path: 'C:\\clip.mp4' };
  const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
  const tr = app.tracking = T.trackingFor(app); app.mode = 'track';
  app.player.timeMs = 1000;
  const G = GS.groupsFor(app), toasts = [];
  app.toast = (m, k) => toasts.push([m, k]);
  G.toggle(true);
  const { w, h } = G.size, reqs = [];
  let answer = (req) => ({ result: { frame_wh: [1920, 1080], mask_wh: [w, h], cached: reqs.length > 1, ms: { embed: 1, decode: 1 }, masks: [] } });
  const enc = (cx, cy, r) => { const a = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r ? 1 : 0; const e = GJ.encodeMask({ w, h, a }); return { mask: e, score: 0.9, area: 0 }; };
  tr.job = (label, req) => { reqs.push(req); return Promise.resolve(answer(req)); };
  const dab = async (nx, ny, erase = false) => { const ok = G.begin(nx, ny, erase); if (ok) { G.end(); await new Promise((r) => setTimeout(r, 5)); } return ok; };
  return { server, app, G, tr, reqs, toasts, enc, w, h, setAnswer: (f) => { answer = f; }, answerOf: (req) => answer(req), dab };
}

test('grow: a dab sends its point, the group becomes the smallest mask holding it; more dabs add prompts; Ctrl+Z steps back one prompt', async () => {
  const t = await tool();
  try {
    const { G, app, reqs, enc, w, h } = t;
    G.app.settings.set('tracking.groups.grow', true);
    t.setAnswer(() => ({ result: { mask_wh: [w, h], cached: false, ms: {}, masks: [enc(w * 0.4, h * 0.5, 14), enc(w * 0.5, h * 0.5, 60)] } }));
    assert.ok(await t.dab(0.4, 0.5));
    assert.equal(reqs.length, 1); assert.equal(reqs[0].cmd, 'segment'); assert.equal(reqs[0].video, 'C:\\clip.mp4'); assert.equal(reqs[0].mask_w, w);
    assert.deepEqual(reqs[0].pos, [[0.4, 0.5]]); assert.equal(reqs[0].neg, undefined);
    assert.equal(G.groups.length, 1);
    const area1 = G.groups[0].poly.length && G.maskFor(G.groups[0]).a.reduce((s, v) => s + (v >= 0.5), 0);
    assert.ok(area1 > 400 && area1 < 800, `the small disc (~615 px) came back, a hair inside: ${area1}`);
    // a second dab ON the group: its prompts are added to the first dab's
    t.setAnswer(() => ({ result: { mask_wh: [w, h], cached: true, ms: {}, masks: [enc(w * 0.5, h * 0.5, 40)] } }));
    assert.ok(await t.dab(0.42, 0.5));
    assert.deepEqual(reqs[1].pos, [[0.4, 0.5], [0.42, 0.5]], 'accumulated');
    const area2 = G.maskFor(G.groups[0]).a.reduce((s, v) => s + (v >= 0.5), 0);
    assert.ok(area2 > 3 * area1, `the bigger mask now: ${area2}`);
    // Ctrl+Z: back to the first prompt's blob; the next dab continues from the FIRST prompt only
    const n = app._history.entries.length;
    app.undo();
    assert.equal(app._history.entries.length, n, 'undo moves the cursor (one step)');
    assert.equal(G.maskFor(G.groups[0]).a.reduce((s, v) => s + (v >= 0.5), 0), area1, 'one prompt back');
    t.setAnswer(() => ({ result: { mask_wh: [w, h], masks: [enc(w * 0.3, h * 0.3, 14)] } }));
    assert.ok(await t.dab(0.3, 0.3));   // off the group
    assert.equal(G.groups.length, 2, 'a dab off the group starts a new group (own prompts)');
    assert.deepEqual(reqs[2].pos, [[0.3, 0.3]]);
  } finally { await t.server.close(); }
});

test('grow: Shift+dab on a SAM group sends a negative point; on a hand-painted group it is the plain eraser', async () => {
  const t = await tool();
  try {
    const { G, reqs, enc, w, h } = t;
    G.app.settings.set('tracking.groups.grow', false);
    assert.ok(await t.dab(0.7, 0.7));   // hand painted
    G.app.settings.set('tracking.groups.grow', true);
    const before = G.maskFor(G.groups[0]).a.reduce((s, v) => s + (v >= 0.5), 0);
    assert.ok(await t.dab(0.7, 0.7, true));
    assert.equal(reqs.length, 0, 'no SAM call: it has no positive to start from');
    assert.ok(G.groups.length === 0 || G.maskFor(G.groups[0]).a.reduce((s, v) => s + (v >= 0.5), 0) < before, 'the plain erase ran');
    t.setAnswer(() => ({ result: { mask_wh: [w, h], masks: [enc(w * 0.4, h * 0.5, 14), enc(w * 0.4, h * 0.5, 30)] } }));
    assert.ok(await t.dab(0.4, 0.5));
    t.setAnswer(() => ({ result: { mask_wh: [w, h], masks: [enc(w * 0.4, h * 0.5, 20)] } }));
    assert.ok(await t.dab(0.5, 0.5, true));
    assert.deepEqual(reqs.at(-1).neg[0], [0.5, 0.5]); assert.deepEqual(reqs.at(-1).pos, [[0.4, 0.5]]);
    assert.ok(reqs.at(-1).neg.slice(1).every(([x, y]) => Math.hypot((x - 0.5) * w, (y - 0.5) * h) < G.radius * h * 1.3), 'paw-yx6q: the rest inside the erased sweep');
  } finally { await t.server.close(); }
});

test('grow: a stale answer (Esc / a newer prompt / the tool closed) is dropped; a failure paints the stroke as usual', async () => {
  const t = await tool();
  try {
    const { G, enc, w, h, toasts } = t;
    G.app.settings.set('tracking.groups.grow', true);
    let release;
    t.setAnswer(() => new Promise((res) => { release = () => res({ result: { mask_wh: [w, h], masks: [enc(w * 0.4, h * 0.5, 14)] } }); }));
    t.tr.job = (label, req) => { t.reqs.push(req); return t.setAnswerPromise(); };
    t.setAnswerPromise = () => new Promise((res) => { release = () => res({ result: { mask_wh: [w, h], masks: [enc(w * 0.4, h * 0.5, 14)] } }); });
    assert.ok(G.begin(0.4, 0.5, false)); G.end();
    assert.equal(G.growBusy, true, 'busy while SAM works'); assert.ok(G.draft?.waiting, 'the dab stays on screen meanwhile');
    G.cancel();   // Esc
    release(); await new Promise((r) => setTimeout(r, 10));
    assert.equal(G.groups.length, 0, 'the late answer changed nothing'); assert.equal(G.growBusy, false);
    // tool closed while waiting: the paint is kept as painted, the answer is dropped
    assert.ok(G.begin(0.4, 0.5, false)); G.end(); G.toggle(false); release(); await new Promise((r) => setTimeout(r, 10));
    assert.equal(G.groups.length, 1, 'the stroke was kept as painted');
    const area = G.maskFor(G.groups[0]).a.reduce((s, v) => s + (v >= 0.5), 0);
    G.toggle(true);
    // failure: SAM missing
    t.tr.job = () => Promise.resolve({ error: 'RuntimeError: segment needs SAM 2 (the sam2 extra, its checkpoint on disk and a CUDA GPU)' });
    assert.ok(await t.dab(0.8, 0.2));
    assert.equal(G.groups.length, 2, 'painted as usual'); assert.match(G.growNote, /needs SAM 2/); assert.ok(toasts.some(([m]) => /Grow:.*Painted as usual/.test(m)));
    assert.ok(area > 0);
  } finally { await t.server.close(); }
});

test('grow: refused while the card is busy tracking (no request), the brush paints', async () => {
  const t = await tool();
  try {
    const { G, tr, reqs, toasts } = t;
    G.app.settings.set('tracking.groups.grow', true);
    tr.busy = 'track';
    assert.ok(await t.dab(0.5, 0.5));
    assert.equal(reqs.length, 0); assert.equal(G.groups.length, 1, 'painted as usual');
    assert.ok(toasts.some(([m]) => /the card is busy tracking/.test(m)));
    assert.equal(G.growNote, 'the card is busy tracking');
  } finally { await t.server.close(); }
});

test('segmentRequest: a video + t_ms or an image, prompts in 0..1, optional box / prior mask', async () => {
  const { segmentRequest } = await import('../src/lib/protocol.js');
  assert.deepEqual(segmentRequest({ video: 'v.mp4', t_ms: 1000.4, pos: [[0.5, 0.5]], mask_w: 320 }), { cmd: 'segment', video: 'v.mp4', t_ms: 1000, pos: [[0.5, 0.5]], mask_w: 320 });
  const r = segmentRequest({ image: 'a.png', pos: [[0.1, 0.2]], neg: [[0.9, 0.9]], box: [0, 0, 1, 1], mask: { w: 2, h: 2, rle: [0, 4] } });
  assert.equal(r.image, 'a.png'); assert.equal(r.video, undefined); assert.deepEqual(r.neg, [[0.9, 0.9]]); assert.deepEqual(r.box, [0, 0, 1, 1]); assert.ok(r.mask);
});

// ---- paw-noy2: SAM's mask is cleaned: one piece, no holes, a smooth edge
import { cleanMask, HOLE_FRAC } from '../src/features/tracking/grow.js';
import { components } from '../src/features/tracking/fill.js';
const ragged = (cx = 80, cy = 60, R = 25, seed = 5) => {   // a disc with a ragged fringe (+-2.5 px, high frequency), a hole, a speck, a far piece
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const noise = Array.from({ length: 360 }, () => (rnd() - 0.5) * 5), a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, th = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 360) % 360;
    if (Math.hypot(dx, dy) < R + noise[th]) a[y * W + x] = 1;
    if (Math.hypot(x - cx - 8, y - cy + 6) < 3) a[y * W + x] = 0;   // a hole
    if (Math.hypot(x - 12, y - 12) < 1.6) a[y * W + x] = 1;          // a speck
    if (Math.hypot(x - 140, y - 100) < 7) a[y * W + x] = 1;          // a far piece
  }
  return a;
};
const nComp = (a) => components(Uint8Array.from(a, (v) => (v >= 0.5 ? 1 : 0)), W, H).sizes.length - 1;
const bl = (a, x, y) => { const fx = x - 0.5, fy = y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy, g = (X, Y) => a[Math.min(H - 1, Math.max(0, Y)) * W + Math.min(W - 1, Math.max(0, X))]; return (g(ix, iy) * (1 - u) + g(ix + 1, iy) * u) * (1 - v) + (g(ix, iy + 1) * (1 - u) + g(ix + 1, iy + 1) * u) * v; };
const rad = (a, cx, cy, k) => { const th = (k / 72) * 2 * Math.PI; let r = 0; for (let t = 0; t < 45; t += 0.05) if (bl(a, cx + Math.cos(th) * t, cy + Math.sin(th) * t) >= 0.5) r = t; return r; };   // sub-pixel radius of the 0.5 level

test('cleanMask: a ragged SAM mask with a hole, a speck and a far piece becomes ONE smooth piece of the same size', () => {
  const raw = ragged(), M = insideMargin(8);
  assert.ok(nComp(raw) >= 3, 'the input has islands');
  const out = cleanMask(raw, W, H, [[80, 60]], { radius: 8 });
  assert.equal(nComp(out.a), 1, 'one component'); assert.equal(out.far, true, 'the far piece was dropped: the owner is told');
  const hole = out.a[(60 - 6) * W + 80 + 8]; assert.ok(hole >= 0.5, 'the hole is filled');
  const rs = Array.from({ length: 72 }, (_, k) => rad(out.a, 80, 60, k)), rr = Array.from({ length: 72 }, (_, k) => rad(raw, 80, 60, k));
  const curv = (r) => Math.max(...r.map((v, k) => Math.abs(r[(k + 71) % 72] - 2 * v + r[(k + 1) % 72])));
  assert.ok(curv(rr) > 3 && curv(rs) < 1.0, `boundary curvature ${curv(rr).toFixed(2)} -> ${curv(rs).toFixed(2)}`);
  const area = out.a.reduce((s, v) => s + (v >= 0.5 ? 1 : 0), 0), ideal = Math.PI * (25 - M) ** 2;
  assert.ok(Math.abs(area - ideal) / ideal < 0.08, `area ${area} within 8 % of the disc less the margin (${ideal.toFixed(0)}): the smoothing keeps the size`);
  assert.ok(HOLE_FRAC > 0 && HOLE_FRAC < 0.2);
});

test('cleanMask: prompts in two pieces keep the piece with most of them (and say so); a single piece is not "far"', () => {
  const a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (Math.hypot(x - 40, y - 60) < 18) a[y * W + x] = 1; if (Math.hypot(x - 120, y - 60) < 14) a[y * W + x] = 1; }
  const out = cleanMask(a, W, H, [[40, 60], [44, 62], [120, 60]], { radius: 8 });
  assert.equal(nComp(out.a), 1); assert.ok(out.a[60 * W + 40] >= 0.5 && out.a[60 * W + 120] === 0, 'the left piece (2 prompts) won'); assert.equal(out.far, true);
  const one = cleanMask(disc(80, 60, 20), W, H, [[80, 60]], { radius: 8 });
  assert.equal(one.far, false);
});

// ---- paw-k8jj: the candidate that fits the gesture, stepping, scribble box, mask prompt on refinement
test('grow: a dab gets the part level; the loosen / tighten dial walks SAM answers with no new request, one undo step per gesture; a refinement dab sends the mask back', async () => {
  const t = await tool();
  try {
    const { G, app, reqs, enc, w, h } = t;
    G.app.settings.set('tracking.groups.grow', true);
    const px = (g) => G.maskFor(g).a.reduce((s, v) => s + (v >= 0.5), 0);
    const cx = w * 0.4, cy = h * 0.5;
    const encL = (x, y, r) => {   // enc + the low-res logits the sidecar sends with `logits: true`
      const q = new Int8Array(256 * 256);
      for (let Y = 0; Y < 256; Y++) for (let X = 0; X < 256; X++) q[Y * 256 + X] = Math.max(-127, Math.min(127, Math.round(Math.max(-12, Math.min(12, (r - Math.hypot(((X + 0.5) / 256) * w - x, ((Y + 0.5) / 256) * h - y)) * 1.5)) / 0.25)));
      return { ...enc(x, y, r), logits: { w: 256, h: 256, s: 0.25, b64: Buffer.from(q.buffer).toString('base64') } };
    };
    t.setAnswer(() => ({ result: { mask_wh: [w, h], cached: false, ms: {}, masks: [encL(cx, cy, 12), encL(cx + 4, cy, 20), { ...encL(cx + 10, cy, 36), score: 0.02 }] } }));   // sub-part / part / a whole SAM scores at nothing
    assert.ok(await t.dab(0.4, 0.5));
    assert.equal(reqs[0].single, undefined, 'one point: SAM keeps its three levels'); assert.equal(reqs[0].logits, true); assert.equal(reqs[0].mask, undefined); assert.equal(reqs[0].box, undefined);
    const part = px(G.groups[0]);
    assert.ok(part > 900 && part < 1300, `the part level (disc r20 ~1260 less the margin), not the sub-part (~450): ${part}`);
    assert.equal(t.G.lastGrow.steps, 3); assert.equal(t.G.lastGrow.at, 1);
    // Alt + wheel: every notch asks SAM AGAIN, built from the current mask (an answerer that draws discs round the mask prompt it is sent)
    const GJ = await t.server.ssrLoadModule('/src/features/tracking/groups.js');
    let inflight = 0, maxInflight = 0;
    const around = (req) => {
      const mk = GJ.decodeMask(req.mask), mm = mk.a; let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < mm.length; i++) if (mm[i] >= 0.5) { n++; sx += i % w; sy += (i / w) | 0; }
      const rp = Math.sqrt(n / Math.PI), X = sx / n, Y = sy / n;
      return { result: { mask_wh: [w, h], cached: true, ms: {}, masks: [0.8, 1.0, 1.25, 1.7].map((f) => encL(X, Y, f * rp)) } };
    };
    t.tr.job = async (label, req) => { reqs.push(req); inflight++; maxInflight = Math.max(maxInflight, inflight); await new Promise((r) => setTimeout(r, 8)); inflight--; return around(req); };
    const settle = async () => { for (let i = 0; i < 400 && (G.dial?.busy || G.dial?.pend); i++) await new Promise((r) => setTimeout(r, 5)); };
    const n = reqs.length;
    for (let i = 0; i < 3; i++) assert.ok(G.dialNotch(1, [0.4, 0.5]));   // three notches at once: coalesced, answered one at a time
    await settle();
    assert.match(G.dial.label, /looser \+3/); assert.equal(maxInflight, 1, 'one request at a time'); assert.equal(reqs.length, n + 3, 'a request per notch');
    const q = reqs.at(-1);
    assert.equal(q.logits, true); assert.ok(q.mask?.rle?.length, 'the current mask, dilated, is the mask prompt'); assert.equal(q.box.length, 4); assert.equal(q.neg, undefined, 'looser: no negatives'); assert.ok(q.pos.length >= 1);
    G.commitDial();
    const loose = px(G.groups[0]);
    assert.ok(loose > 1.02 * part && loose < 1.08 * part, `three notches looser: about 1 % each (${part} -> ${loose}, ${(100 * (loose / part - 1)).toFixed(1)} %)`); assert.equal(G.groups.length, 1);
    const before = reqs.length;
    assert.ok(G.dialNotch(-2, [0.4, 0.5])); await settle(); G.commitDial();
    assert.ok(reqs.length >= before + 2, 'tighter asks SAM too'); assert.ok(reqs.at(-1).neg?.length >= 1, 'tighter: negatives in the outer band'); assert.equal(reqs.at(-1).pos.length >= 1, true);
    const tight = px(G.groups[0]);
    assert.ok(tight < loose && tight >= 12, `tighter: ${loose} -> ${tight}`);
    app.undo(); assert.equal(px(G.groups[0]), loose, 'ONE Ctrl+Z undoes the whole gesture');
    app.undo(); assert.equal(px(G.groups[0]), part, 'and the one before');
    // back and forth inside one gesture is instant (the ladder): no new request going back
    assert.ok(G.dialNotch(2, [0.4, 0.5])); await settle(); const r2 = reqs.length; assert.ok(G.dialNotch(-2, [0.4, 0.5])); await settle();
    assert.equal(reqs.length, r2, 'going back down the ladder asks nothing'); assert.equal(G.dial.p, 0); G.commitDial();
    assert.equal(px(G.groups[0]), part, 'back where it started: nothing to commit');
    // SAM has nothing different to say: "no more"; SAM unavailable: the classic edge steps, quietly
    t.tr.job = async (label, req) => { reqs.push(req); return { result: { mask_wh: [w, h], masks: [encL(cx + 4, cy, 20)] } }; };
    assert.ok(G.dialNotch(1, [0.4, 0.5])); await settle(); assert.match(G.dial.label, /no more/); G.commitDial();
    t.tr.job = async () => ({ error: 'RuntimeError: segment needs SAM 2' });
    assert.ok(G.dialNotch(1, [0.4, 0.5])); await settle(); G.commitDial();
    assert.ok(t.toasts.some(([m]) => /SAM is not available/.test(m)), 'a quiet note');
    // gestures one after another (the keys: each press is its own gesture): looser, then tighter, then tighter again: every one moves the mask
    t.tr.job = async (label, req) => { reqs.push(req); await new Promise((r) => setTimeout(r, 8)); return around(req); };
    const seq = [];
    for (const dir of [-3, 1, -1, -1, 1]) { assert.ok(G.dialNotch(dir, [0.4, 0.5])); await settle(); G.commitDial(); seq.push(px(G.groups[0])); }
    assert.ok(seq[1] > seq[0] && seq[2] < seq[1] && seq[3] < seq[2] && seq[4] > seq[3], 'each gesture moves it the way it was asked: ' + seq.join(' '));
    t.tr.job = (label, req) => { reqs.push(req); return Promise.resolve({ result: { mask_wh: [w, h], cached: true, ms: {}, masks: [encL(cx + 10, cy, 30)] } }); };
    t.setAnswer(() => ({ result: { mask_wh: [w, h], cached: true, ms: {}, masks: [encL(cx + 10, cy, 30)] } }));   // a refinement dab: the mask goes back as the prompt
    assert.ok(await t.dab(0.4 + 14 / w, 0.5));
    assert.equal(reqs.at(-1).single, true); assert.ok(reqs.at(-1).mask?.rle?.length, 'the current mask is the mask prompt'); assert.equal(reqs.at(-1).box, undefined);
    assert.equal(reqs.at(-1).pos.length, 2); assert.equal(G.groups.length, 1);
    G.app.settings.set('tracking.groups.grow', false);   // a hand-painted group dials edge-aware: no picture decoded in this harness, so it stops
    assert.ok(await t.dab(0.8, 0.8));
    const gi = G.groups.length - 1, b0 = px(G.groups[gi]);
    G.active = gi; assert.ok(G.dialNotch(1, [0.8, 0.8])); G.commitDial();
    assert.equal(px(G.groups[gi]), b0, 'no picture to follow: no blind dilation');
  } finally { await t.server.close(); }
});

test('grow: a long scribble sends points spread over its length (no box: it would clip SAM to a strip) and picks the candidate whose extent matches', async () => {
  const t = await tool();
  try {
    const { G, reqs, enc, w, h } = t;
    G.app.settings.set('tracking.groups.grow', true);
    t.setAnswer(() => ({ result: { mask_wh: [w, h], masks: [enc(w * 0.5, h * 0.5, 30), enc(w * 0.5, h * 0.5, 60)] } }));
    assert.ok(G.begin(0.3, 0.5, false));
    for (let i = 1; i <= 40; i++) G.move(0.3 + (0.4 * i) / 40, 0.5);
    G.end(); await new Promise((r) => setTimeout(r, 10));
    const q = reqs[0];
    assert.ok(q.pos.length >= 4 && Math.abs(q.pos[0][0] - 0.3) < 0.01 && Math.abs(q.pos.at(-1)[0] - 0.7) < 0.01, 'from one end to the other');
    assert.equal(q.box, undefined, 'no box from a scribble'); assert.equal(q.single, true, '>= 2 positives: one best mask');
  } finally { await t.server.close(); }
});

test('paw-om3e: an accepted Suggest proposal that SAM drew keeps its prompts and SAM mask: Alt + notch and a dab re-ask SAM from them; a repaint drops them', async () => {
  const t = await tool();
  try {
    const { G, app, reqs, enc, w, h } = t;
    const GJ = await t.server.ssrLoadModule('/src/features/tracking/groups.js');
    G.app.settings.set('tracking.groups.grow', true);
    const cx = w * 0.4, cy = h * 0.5, r = 22, disc = enc(cx, cy, r).mask;
    const poly = Array.from({ length: 32 }, (_, i) => [(cx + r * Math.cos((i / 32) * 2 * Math.PI)) / w, (cy + r * Math.sin((i / 32) * 2 * Math.PI)) / h]);
    const res = { t_ms: 1000, frame: 'given', frame_wh: [1920, 1080], groups: [{ name: 'c1_penis', who: 'c1', part: 'penis', side: null, poly, score: 0.9, source: 'seeder', outline: 'sam', mask_from: 'sam', pinned: true, sam: { pos: [[0.4, 0.5], [0.45, 0.5]], neg: [[0.8, 0.2]], mask: disc } }] };
    // the store carries it: Suggest's group has sam + fingerprint, Accept keeps both
    const sug = GJ.suggestedGroups(res, 1000, [], (p) => GJ.encodeMask(GJ.rasterPoly(p, { w, h })));
    assert.equal(sug[0].sam.fp, GJ.maskFp(sug[0].mask)); assert.equal(sug[0].sam.pos.length, 2);
    assert.equal(GJ.acceptGroup(sug[0]).sam.fp, sug[0].sam.fp, 'Accept keeps the SAM state');
    assert.notEqual(GJ.maskFp({ rle: [0, 5, 15, 3] }), GJ.maskFp({ rle: [0, 5, 15, 4] }));
    t.setAnswer((req) => (req.cmd === 'suggest_groups' ? { result: res } : { result: { mask_wh: [w, h], cached: true, ms: {}, masks: [enc(cx, cy, 0.8 * r), enc(cx, cy, r), enc(cx, cy, 1.25 * r), enc(cx, cy, 1.7 * r)] } }));
    t.tr.job = (label, req) => { if (req.cmd !== 'suggest_groups') reqs.push(req); return Promise.resolve(t.answerOf(req)); };
    await G.suggest();
    assert.equal(G.groups.length, 1); assert.equal(G.groups[0].source, 'seeder');
    G.accept();                                           // "Accept all"
    assert.equal(G.groups[0].source, 'user'); assert.ok(G.groups[0].sam, 'the accepted group still carries the state');
    const settle = async () => { for (let i = 0; i < 400 && (G.dial?.busy || G.dial?.pend); i++) await new Promise((rr) => setTimeout(rr, 5)); };
    assert.ok(G.dialNotch(1, [0.4, 0.5])); await settle(); G.commitDial();
    assert.equal(reqs.length, 1, 'one SAM request');
    assert.deepEqual(reqs[0].pos.slice(0, 2), [[0.4, 0.5], [0.45, 0.5]], "Suggest's own positives are the dial's (a hand-painted group would sample its inside)");
    assert.ok(reqs[0].mask?.rle?.length, 'SAM is asked again from a mask prompt');
    // a hand repaint changes the mask: no state any more (the dial falls back to the hand-painted behaviour)
    G.app.settings.set('tracking.groups.grow', false);
    const g0 = G.groups[0], moved = { ...g0, mask: GJ.encodeMask({ w, h, a: new Float32Array(w * h).fill(0) }) };
    assert.notEqual(GJ.maskFp(moved.mask), g0.sam.fp);
  } finally { await t.server.close(); }
});
