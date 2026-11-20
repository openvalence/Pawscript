// how-synth.mjs -- synthetic runs with known stroke shapes for fusion's HOW (paw-t11b): test/fusion-how.test.mjs and
// experiments/fusion/how-score.mjs. Not a test file itself. 30 fps; parts are frame positions (y down; a stroke moves the
// Top's hips / penis / balls down = deeper); depth d 0 = deep .. 1 = out.
// Stroke kinds (one full stroke = an out-move from deep, then an in-move back):
//   sine      d = 0.5 - 0.5 cos: no hold, no midpoint
//   shoulder  smoothstep moves with a rest of `rest` x the half at the deep turn (and `top` at the top): holds, no midpoint
//   impact    an in-move that speeds up into the deep turn (d = 1 - 0.25 u - 0.75 u^3) and stops dead, a short rest (`rest`), the balls
//             and thighs ring after it (a damped swing the stroke does not explain); a smoothstep out-move: a hold at
//             the deep turn and a midpoint on the in-move
//   slowout   a smoothstep in-move, an out-move that starts slow and ends fast (d = 0.25 u + 0.75 u^3): a midpoint on the out-move
//   cusp      paw-6t7d (the owner's 'anal penetration' shot): both moves lopsided, full speed into and out of one turn (a cusp)
//             and a slow rounded other turn. cusp 'bottom' (default): out-move d = 1 - (1 - u)^2, in-move d = 1 - u^2 (a sharp
//             deep turn, a round top); 'top': out-move d = u^2, in-move d = (1 - u)^2. A midpoint (or shoulder) on every move
import { channelOf } from '../src/lib/runs.js';

export const FPS = 30, ASPECT = 16 / 9;
export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const gauss = (r) => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const ss = (u) => u * u * (3 - 2 * u);

/** strokes [{kind, T (ms per full stroke), rest?, top?, amp? (0..1), cusp? ('bottom' | 'top': kind 'cusp')}] -> {N, t, d (depth per frame), truth: {turns: [{t,
 *  kind: 'bottom' | 'top', hold}], halves: [{t0, t1, dir, mid}]}, impacts: [ms]}. */
export function track(strokes, { lead = 300 } = {}) {
  const seg = [];   // [t0, t1, f(u) -> d] pieces
  let t = 0;
  const truth = { turns: [], halves: [] }, impacts = [];
  seg.push([t, t + lead, () => 0]); t += lead;
  for (const s of strokes) {
    const H = s.T / 2, amp = s.amp ?? 1, rest = s.kind === 'shoulder' || s.kind === 'impact' ? s.rest ?? 0.4 : 0, top = s.kind === 'shoulder' ? s.top ?? 0 : 0;
    // deep turn (start), its rest
    truth.turns.push({ t, kind: 'bottom', hold: rest > 0 });
    if (rest > 0) { seg.push([t, t + rest * H, () => 0]); t += rest * H; }
    const cb = s.kind === 'cusp' && s.cusp !== 'top', ct = s.kind === 'cusp' && s.cusp === 'top';
    const outT = H * (1 - rest), outF = s.kind === 'sine' ? (u) => amp * (0.5 - 0.5 * Math.cos(Math.PI * u)) : s.kind === 'slowout' ? (u) => amp * (0.25 * u + 0.75 * u ** 3) : cb ? (u) => amp * (1 - (1 - u) ** 2) : ct ? (u) => amp * u * u : (u) => amp * ss(u);
    truth.halves.push({ t0: truth.turns[truth.turns.length - 1].t, t1: t + outT, dir: 1, mid: s.kind === 'slowout' || s.kind === 'cusp' });
    seg.push([t, t + outT, outF]); t += outT;
    truth.turns.push({ t, kind: 'top', hold: top > 0 });
    if (top > 0) { seg.push([t, t + top * H, () => amp]); t += top * H; }
    const inT = H * (1 - top), inF = s.kind === 'sine' ? (u) => amp * (0.5 + 0.5 * Math.cos(Math.PI * u)) : s.kind === 'impact' ? (u) => amp * (1 - 0.25 * u - 0.75 * u ** 3) : cb ? (u) => amp * (1 - u * u) : ct ? (u) => amp * (1 - u) ** 2 : (u) => amp * (1 - ss(u));
    truth.halves.push({ t0: truth.turns[truth.turns.length - 1].t, t1: t + inT, dir: -1, mid: s.kind === 'impact' || s.kind === 'cusp' });
    seg.push([t, t + inT, inF]); t += inT;
    if (s.kind === 'impact') impacts.push(t);
  }
  truth.turns.push({ t, kind: 'bottom', hold: false });
  seg.push([t, t + lead, () => 0]); t += lead;
  const N = Math.floor((t * FPS) / 1000), ts = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS)), d = new Float64Array(N);
  let k = 0;
  for (let i = 0; i < N; i++) { const x = (i * 1000) / FPS; while (k + 1 < seg.length && x >= seg[k][1]) k++; const [a, b, f] = seg[k]; d[i] = f(b > a ? Math.min(1, (x - a) / (b - a)) : 0); }
  return { N, t: ts, d, truth, impacts };
}
/** A damped swing after each impact at time ms: amplitude x e^(-dt / 150 ms) x sin(2 pi 6 Hz dt), lagging lagMs. */
const swing = (impacts, amp, lagMs = 33) => (ms) => { let s = 0; for (const a of impacts) { const x = ms - a - lagMs; if (x > 0 && x < 900) s += amp * Math.exp(-x / 150) * Math.sin((2 * Math.PI * 6 * x) / 1000); } return s; };

/** A points run of the track: the Top's hips / penis / balls stroke, the Bottom's hips / thighs hold still (the camera
 *  steady), the balls (and the Bottom's thighs) ring after each impact (ring = 0: none), a head that wanders. o {seed,
 *  jitter, ring, parts (names to keep), noisy: [t0, t1] (jitter x 6 there)}. */
export function howRun(tr, { seed = 1, jitter = 0.0012, ring = 1, parts = null, noisy = null } = {}) {
  const r = rng(seed), A = 0.06, sw = swing(tr.impacts, 0.02 * ring), rp = swing(tr.impacts, 0.006 * ring, 60);
  const wob = (() => { let a = 0; return tr.t.map(() => (a = 0.97 * a + 0.003 * gauss(r))); })();
  const P = {
    c2_hips: (i) => [0.5, 0.42 + A * (1 - tr.d[i])],
    c2_penis: (i) => [0.52, 0.5 + A * (1 - tr.d[i])],
    c2_balls: (i) => [0.51 + 0.4 * sw(tr.t[i]), 0.53 + A * (1 - tr.d[i]) + sw(tr.t[i])],
    c1_hips: () => [0.5, 0.62],
    c1_thighs: (i) => [0.45, 0.7 + rp(tr.t[i])],
    c1_head: (i) => [0.3 + wob[i], 0.3],
  };
  const ch = {};
  for (const [name, f] of Object.entries(P)) {
    if (parts && !parts.includes(name)) continue;
    const xs = [], ys = [];
    tr.t.forEach((ms, i) => { const q = f(i), j = jitter * (noisy && ms >= noisy[0] && ms < noisy[1] ? 6 : 1); xs.push([ms, q[0] + j * gauss(r)]); ys.push([ms, q[1] + j * gauss(r)]); });
    ch[`sem_${name}_x`] = channelOf(xs); ch[`sem_${name}_y`] = channelOf(ys);
  }
  ch.who_pair_proj = channelOf(tr.t.map((ms, i) => [ms, tr.d[i]]));
  return { id: 'r', params: { axis: 'auto' }, scenes: [], channels: ch, notes: [], flips: [], range: { start: 0, end: tr.t[tr.N - 1] + 1 } };
}

/** Points [{at, why}] (or {at, why} arrays) against the track's truth -> {holdWant, holdHit, holdFalse, midWant, midHit,
 *  midFalse}: a hold point counts for the truth turn it follows (within that turn's rest + 150 ms), a midpoint for the
 *  truth half it falls in; the lead-in / lead-out turns are left out. */
export function layoutScore(tr, pts) {
  const P = Array.isArray(pts) ? pts : Array.from(pts.at, (at, i) => ({ at, why: pts.why?.[i] }));
  const T = tr.truth.turns.slice(1, -1), Hs = tr.truth.halves.slice(1, -1), lo = T[0].t - 100, hi = T[T.length - 1].t + 100;
  const holds = P.filter((p) => p.why === 'hold' && p.at > lo && p.at < hi), mids = P.filter((p) => p.why === 'mid' && p.at > lo && p.at < hi);
  const r = { holdWant: 0, holdHit: 0, holdFalse: 0, midWant: 0, midHit: 0, midFalse: 0 };
  const owner = (at) => { let k = -1; for (let q = 0; q < T.length; q++) if (T[q].t - 100 <= at) k = q; return k; };
  const got = new Set();
  for (const h of holds) { const k = owner(h.at), nx = T[k + 1]; if (k >= 0 && T[k].hold && (!nx || h.at < nx.t - 50)) got.add(k); else r.holdFalse++; }
  T.forEach((x, k) => { if (x.hold) { r.holdWant++; if (got.has(k)) r.holdHit++; } });
  const gm = new Set();
  for (const m of mids) { const k = Hs.findIndex((h) => m.at > h.t0 && m.at < h.t1); if (k >= 0 && Hs[k].mid) gm.add(k); else r.midFalse++; }
  Hs.forEach((h, k) => { if (h.mid) { r.midWant++; if (gm.has(k)) r.midHit++; } });
  return r;
}
