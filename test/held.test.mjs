// paw-rnv1: characters drawn on twos / threes over a picture that changes every frame (src/lib/held.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHeld, retimeHeld, heldRun, heldScenes, heldText, heldOn, HELD, partMotion } from '../src/lib/held.js';
import { channelPatch } from '../src/lib/runs-channel.js';
import { deriveClean } from '../src/lib/rederive.js';
import { channelOf } from '../src/lib/runs.js';

const FPS = 30, N = 300, T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
/** draw[i] = the frame where frame i's drawing first appears: '1' | '2' | '3' | 'm' (mixed 2 / 3) | 'b' (twos, every
 *  other change blended over two frames: a 24 -> 30 fps conversion) */
function schedule(kind, seed = 0) {
  if (kind === '1') return T.map((_, i) => i);
  const r = rng(5 + seed), out = new Array(N);
  for (let i = 0; i < N;) { const s = kind === 'm' || kind === 'b' ? (r() < 0.5 ? 2 : 3) : +kind; for (let k = i; k < Math.min(N, i + s); k++) out[k] = i; i += s; }
  return out;
}
const stroke = (i) => Math.sin((2 * Math.PI * 1.2 * i) / FPS);
/** A run with characters {who: {sched, parts: {part: (i) -> [x, y]}}}; jitter on every frame (frame heights). */
function runOf(chars, { jitter = 0.0004, seed = 1, blend = false } = {}) {
  const r = rng(seed), ch = {};
  for (const [who, c] of Object.entries(chars)) {
    const d = c.sched;
    for (const [part, f] of Object.entries(c.parts)) {
      const xs = [], ys = [];
      T.forEach((ms, i) => {
        let [x, y] = f(d[i]);
        if (blend && i + 1 < N && d[i + 1] !== d[i] && (d[i + 1] - d[i]) === 3) { const [x2, y2] = f(d[i + 1]); x = (x + x2) / 2; y = (y + y2) / 2; }
        const lost = c.lost?.(part, i);
        xs.push([ms, lost ? null : x + jitter * gauss(r)]); ys.push([ms, lost ? null : y + jitter * gauss(r)]);
      });
      ch[`sem_${who}_${part}_x`] = channelOf(xs); ch[`sem_${who}_${part}_y`] = channelOf(ys);
    }
  }
  return { id: 'r', params: { axis: 'auto' }, scenes: [], channels: ch, notes: [], flips: [], range: { start: 0, end: T[N - 1] + 1 }, points: { at: new Float64Array(0), pos: new Float64Array(0) } };
}
const pair = (s1, s2 = s1) => ({
  c1: { sched: s1, parts: { hips: (k) => [0.4, 0.55 - 0.02 * stroke(k)], torso: (k) => [0.3, 0.45 - 0.008 * stroke(k)] } },
  c2: { sched: s2, parts: { hips: (k) => [0.5, 0.5 + 0.03 * stroke(k)], torso: (k) => [0.6, 0.35 + 0.01 * stroke(k)] } },
});
const truthNew = (d) => d.map((x, i) => (i === 0 || x !== d[i - 1] ? 1 : 0));
const asc = (a) => a.every((x, i) => !i || x >= a[i - 1]);

test('each schedule is found per character, with its drawings where they appear', () => {
  for (const k of ['2', '3', 'm']) {
    const d = schedule(k), sc = heldScenes(runOf(pair(d)), 16 / 9)[0];
    for (const w of ['c1', 'c2']) {
      const r = sc.chars[w], tn = truthNew(d), nw = sc.nw[w];
      assert.ok(r, `${k} ${w} found`);
      assert.ok(r.frames >= 0.9 * N, `${k} ${w}: ${r.frames} of ${N} frames`);
      let tp = 0, fp = 0, fn = 0;
      for (let i = 0; i < N; i++) if (r.stretch[i]) { if (nw[i] && tn[i]) tp++; else if (nw[i]) fp++; else if (tn[i]) fn++; }
      // c1 moves two thirds as much: its drawings near a turn hide in the noise more often (harmless: they barely move)
      assert.ok(tp / (tp + fp) >= 0.85 && tp / (tp + fn) >= (w === 'c1' ? 0.65 : 0.85), `${k} ${w}: P ${tp / (tp + fp)} R ${tp / (tp + fn)}`);
      const top = Object.entries(r.steps).sort((a, b) => b[1] - a[1])[0][0];
      assert.equal(+top, k === '3' ? 3 : k === '2' ? 2 : +top, `${k}: steps ${JSON.stringify(r.steps)}`);
    }
  }
  const sc = heldScenes(runOf(pair(schedule('2'), schedule('m', 1))), 16 / 9)[0];
  assert.ok(sc.chars.c1 && sc.chars.c2, 'two characters on two schedules');
  assert.notDeepEqual(Array.from(sc.nw.c1), Array.from(sc.nw.c2));
  assert.match(heldText(sc.chars), /^c1 on twos: \d+ drawings in \d+ frames \(2×\d+.*\) · c2 on twos \/ threes/);
});

test('a change blended over two frames (24 -> 30 fps) still reads as twos / threes', () => {
  const d = schedule('b'), sc = heldScenes(runOf(pair(d), { blend: true }), 16 / 9)[0];
  assert.ok(sc.chars.c2 && sc.chars.c2.frames >= 0.9 * N, JSON.stringify(sc.chars.c2?.frames));
});

test('the retime gives back the animator\'s curve: one sample per drawing, straight between', () => {
  for (const k of ['2', '3', 'm']) {
    const d = schedule(k), run = runOf(pair(d), { jitter: 0 }), out = heldRun(run, [], 16 / 9);
    assert.ok(out, k);
    const y = out.run.channels.sem_c2_hips_y.v, raw = run.channels.sem_c2_hips_y.v, truth = T.map((_, i) => 0.5 + 0.03 * stroke(i));
    let eRaw = 0, eOut = 0;
    for (let i = 0; i < N; i++) { eRaw += (raw[i] - truth[i]) ** 2; eOut += (y[i] - truth[i]) ** 2; }
    assert.ok(eOut < 0.25 * eRaw, `${k}: rms ${Math.sqrt(eOut / N)} vs staircase ${Math.sqrt(eRaw / N)}`);
    for (let i = 0; i < N; i++) if (truthNew(d)[i]) assert.ok(Math.abs(y[i] - raw[i]) < 1e-6, `${k}: a drawing's own frame keeps its value (${i})`);
  }
});

test('ones, slow continuous motion, a pause, a hold at depth and plain noise are left exactly as tracked', () => {
  const ones = runOf(pair(schedule('1')));
  assert.equal(heldRun(ones, [], 16 / 9), null, 'ones');
  const slow = { c1: { sched: schedule('1'), parts: { hips: (k) => [0.4 + 0.00008 * k, 0.5], torso: (k) => [0.3 + 0.00008 * k, 0.4] } } };
  assert.equal(heldRun(runOf(slow), [], 16 / 9), null, 'slow continuous motion, every frame');
  const still = { c1: { sched: schedule('1'), parts: { hips: () => [0.4, 0.5], torso: () => [0.3, 0.4] } } };
  assert.equal(heldRun(runOf(still), [], 16 / 9), null, 'a pause');
  assert.equal(heldRun(runOf(still, { jitter: 0.002 }), [], 16 / 9), null, 'noise only');
  const weak = { c1: { sched: schedule('2'), parts: { hips: (k) => [0.4, 0.5 + 0.006 * stroke(k)], torso: () => [0.3, 0.4] } } };
  assert.equal(heldRun(runOf(weak), [], 16 / 9), null, 'twos whose steps hide in the tracker noise (under ~6 x): left as tracked');
  const depth = (k) => (k % 150 < 90 ? stroke(k) : -1);   // strokes, then held at depth for 2 s, on ones
  const hold = { c1: { sched: schedule('1'), parts: { hips: (k) => [0.4, 0.5 + 0.03 * depth(k)], torso: (k) => [0.3, 0.4 + 0.01 * depth(k)] } } };
  assert.equal(heldRun(runOf(hold), [], 16 / 9), null, 'a hold at depth');
});

test('a part lost and found again, and a stitched part (a jump at the hand-over), stay as tracked on ones; on twos the lost frames stay lost', () => {
  const lost = (part, i) => part === 'hips' && i >= 100 && i < 160;
  const c = pair(schedule('1')); c.c2.lost = lost; c.c1.lost = lost;
  assert.equal(heldRun(runOf(c), [], 16 / 9), null, 'lost and found, ones');
  const st = pair(schedule('1')); const f = st.c2.parts.hips; st.c2.parts.hips = (k) => { const [x, y] = f(k); return k >= 150 ? [x + 0.02, y + 0.015] : [x, y]; };
  assert.equal(heldRun(runOf(st), [], 16 / 9), null, 'stitched part, ones');
  const tw = pair(schedule('2')); tw.c2.lost = lost;
  const run = runOf(tw), out = heldRun(run, [], 16 / 9);
  assert.ok(out?.run.channels.sem_c2_hips_y);
  for (let i = 100; i < 160; i++) assert.ok(Number.isNaN(out.run.channels.sem_c2_hips_y.v[i]), `lost frame ${i} stays lost`);
  assert.ok(heldScenes(run, 16 / 9)[0].chars.c2.frames >= 0.9 * N, 'the torso carries the character while the hips are lost');
  const st2 = pair(schedule('2')); st2.c2.parts.hips = st.c2.parts.hips;
  const o2 = heldRun(runOf(st2, { jitter: 0 }), [], 16 / 9), y2 = o2.run.channels.sem_c2_hips_y.v;
  assert.ok(Math.abs(y2[150] - y2[149]) > 0.01, 'the hand-over jump stays at its frame');
});

test('retimeHeld: holds stay flat, NaN stays NaN, nothing to do returns the same array', () => {
  const t = Array.from({ length: 20 }, (_, i) => i * 33), v = Float64Array.from(t, (_, i) => (i < 12 ? 0 : 1));
  const nw = Uint8Array.from(t, (_, i) => (i === 0 || i === 12 ? 1 : 0));
  const r = retimeHeld(t, v, nw, 2);
  assert.ok(r.slice(0, 10).every((x) => x === 0), 'flat until a step before the next drawing');
  assert.ok(r[10] === 0 && r[11] > 0 && r[11] < 1 && r[12] === 1);
  const v2 = Float64Array.from(v); v2[5] = NaN;
  assert.ok(Number.isNaN(retimeHeld(t, v2, nw, 2)[5]));
  assert.equal(retimeHeld(t, v, new Uint8Array(20).fill(1)), v);
});

test('heldRun: the run passed in is untouched; pairs take both sides\' drawings; the shot switch turns it off', () => {
  const run = runOf(pair(schedule('2'), schedule('3', 1)));
  run.channels.who_pair_proj = channelOf(T.map((ms, i) => [ms, run.channels.sem_c2_hips_y.v[i] - run.channels.sem_c1_hips_y.v[i]]));
  run.channels['rel:sem_c2_hips:sem_c1_hips'] = { ...run.channels.who_pair_proj };
  run.channels.proj = channelOf(T.map((ms, i) => [ms, run.channels.sem_c2_hips_y.v[i]]));
  const before = JSON.stringify(Object.fromEntries(Object.entries(run.channels).map(([k, c]) => [k, Array.from(c.v)])));
  const out = heldRun(run, [], 16 / 9);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(run.channels).map(([k, c]) => [k, Array.from(c.v)]))), before, 'input untouched');
  assert.notEqual(out.run.channels.who_pair_proj, run.channels.who_pair_proj, 'the pair is retimed');
  assert.notEqual(out.run.channels['rel:sem_c2_hips:sem_c1_hips'], run.channels['rel:sem_c2_hips:sem_c1_hips'], 'a rel: pair too');
  assert.equal(out.run.channels.proj, run.channels.proj, 'the box signal is left as tracked');
  const sc = heldScenes(run, 16 / 9)[0], u = sc.nw.c1.map((x, i) => x || sc.nw.c2[i]), pv = out.run.channels.who_pair_proj.v, rv = run.channels.who_pair_proj.v;
  for (let i = 0; i < N; i++) if (u[i]) assert.ok(Math.abs(pv[i] - rv[i]) < 1e-6, `pair sample ${i}: a frame where either side changes`);
  assert.equal(heldRun(run, [{ held: false }], 16 / 9), null, 'off on the shot');
  assert.ok(heldRun(run, [{ held: true }], 16 / 9));
  assert.equal(heldRun(run, [{ held: false }], 16 / 9), null);
  assert.equal(heldOn(null), HELD.DEFAULT);
  assert.equal(heldRun(run, [], 16 / 9).run.channels.sem_c2_hips_y, out.run.channels.sem_c2_hips_y, 'the same objects on every compose (caches downstream hit)');
});

test('deriveClean keeps the switch; channelPatch composes from the retimed parts and hands back the tracks as tracked', () => {
  assert.deepEqual(deriveClean({ held: false }), { held: false });
  assert.deepEqual(deriveClean({ held: true }), { held: true });
  assert.equal(deriveClean({ held: 'no' }), null);
  const run = runOf(pair(schedule('2')));
  run.channels.who_pair_proj = channelOf(T.map((ms, i) => [ms, run.channels.sem_c2_hips_y.v[i]]));
  const rel = 'rel:sem_c2_hips:sem_c1_hips';
  const on = channelPatch(run, 'fused', {}, [], { aspect: 16 / 9, derives: [] }), off = channelPatch(run, 'fused', {}, [], { aspect: 16 / 9, derives: [{ held: false }] });
  assert.ok(on.channels.fused && off.channels.fused);
  for (const k of Object.keys(run.channels)) assert.equal(on.channels[k], run.channels[k], `${k} handed back as tracked`);
  let d = 0;
  for (let i = 0; i < N; i++) d += Math.abs(on.channels.fused.v[i] - off.channels.fused.v[i]);
  assert.ok(d > 0.5, 'the fused signal reads the retimed parts');
  const p = channelPatch(run, rel, {}, [], { aspect: 16 / 9, derives: [] });
  const q = channelPatch(run, rel, {}, [], { aspect: 16 / 9, derives: [{ held: false }] });
  assert.ok(p.lane && q.lane && asc(Array.from(p.lane.t)));
});

test('paw-o60v.5: partMotion in place gives the Array sort + quantile version, number for number (ties, -0, gaps, steps)', () => {
  const fin = Number.isFinite, quantile = (a, q) => { const b = a.filter(fin).sort((x, y) => x - y); if (!b.length) return NaN; const p = (b.length - 1) * q, i = Math.floor(p); return b[i] + (b[Math.min(i + 1, b.length - 1)] - b[i]) * (p - i); };
  const old = (X, Y) => {   // before paw-o60v.5
    const n = X.length, ux = new Float64Array(n).fill(NaN), uy = new Float64Array(n).fill(NaN), out = new Float64Array(n).fill(NaN);
    for (let i = 1; i < n; i++) if (fin(X[i]) && fin(X[i - 1]) && fin(Y[i]) && fin(Y[i - 1])) { ux[i] = X[i] - X[i - 1]; uy[i] = Y[i] - Y[i - 1]; }
    const L = HELD.LAYER;
    for (let i = 1; i < n; i++) {
      if (!fin(ux[i])) continue;
      const w = [];
      for (let j = Math.max(1, i - L); j <= Math.min(n - 1, i + L); j++) if (fin(ux[j])) w.push(j);
      w.sort((a, b) => Math.hypot(ux[a], uy[a]) - Math.hypot(ux[b], uy[b]));
      const lo = w.slice(0, Math.ceil(w.length / 2));
      out[i] = Math.hypot(ux[i] - quantile(lo.map((j) => ux[j]), 0.5), uy[i] - quantile(lo.map((j) => uy[j]), 0.5));
    }
    return out;
  };
  const r = rng(77);
  for (let k = 0; k < 400; k++) {
    const n = 2 + Math.floor(r() * 120), X = new Float64Array(n), Y = new Float64Array(n), kind = k % 4;
    for (let i = 0; i < n; i++) {
      const g = r();
      X[i] = g < 0.06 ? NaN : kind === 0 ? Math.round(r() * 3) / 100 : kind === 1 ? (i >> 1) * 0.01 : r() * 0.1;   // (0: ties, 1: a staircase, 2-3: noise)
      Y[i] = kind === 3 && g > 0.5 ? -0 : kind === 1 ? 0.5 : X[i] * 0.5 + (fin(X[i]) ? r() * 0.01 : 0);
    }
    assert.deepEqual(partMotion(X, Y), old(X, Y), `case ${k}`);
  }
});