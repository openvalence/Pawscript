// fusion-how.js -- HOW each stroke goes, read from every tracked part (paw-t11b). Pure (test/fusion-how.test.mjs).
// Owner: "balls flapping indicates strong, parts rippling, impact etc it's all data to understand HOW the stroke not what
// the stroke, and it should kinda be more part of fusion than on top of it"; "random is bad, human is good, uniform is bad".
// Fusion says WHAT (the depth signal) and, here, HOW: per half-stroke (turn to turn of the fused signal: the turns the
// strokes step finds on it, strokes.js signalTurns) from EVERY part fusion read, also the ones with no say in the depth
// (balls, tail, thighs, bulges, the measure parts). Each part is a voice (fusion.js voicesOf): its motion along its own
// stroke axis (a: sign-aligned with the stroke, lag: its delay in samples), its say w (coherence with the stroke x presence
// x fit x stroke over tracker jitter: a part that never moves with the stroke says nothing about it), and its motion the
// stroke does not explain (rx / ry: the part minus its share of the stroke: a swing, a ripple), with wr (presence x fit).
//  dwell     per turn: each voice's rest around the turn (while it stays within BAND of its stroke of its own turn level:
//            the strokes step's dwell on the part smoothed the same way; at least 1.5 x its jitter) as a share of the two half-strokes' mean length; the turn's dwell = the say-weighted median over the voices (several
//            parts stopping together count, one part stalling alone does not); fs / fe = where the rest starts / motion
//            resumes (shares of the half before / after), the same median over the resting voices.
//  impact    per turn: how sharply the stroke arrives (hit: the incoming move's shape from its middle to 85 %, behind the
//            straight line = still speeding up into the stop, a sine is ahead of it: HIT) and what rings after it, fuzzy:
//            max(hit x (0.4 + 0.6 ring), ring x (0.5 + 0.5 hit)); a voice ringing at a turn has no vote on its dwell (it
//            is the impact, not a rest);
//  ring      how much unexplained motion starts right after the turn (just after against during the move, per voice:
//            RING), a fuzzy OR over the voices: one well-tracked swinging ball is enough ("balls flapping = strong");
//  strength  the ringing voices' unexplained motion after the turn as a share of their own stroke (shown, not used);
//  shape     per half: the move between the rests at its two turns (m0..m1: where a turn falls inside a rest is noise),
//            its deviation from the straight line (stroke-shape.js profile, 15 samples) from the most confident voices
//            there (say ^ SHARP, each at its own lag; sub-frame turn times), not from the blend;
//  conf      per turn / half: how much say was there, 0..1 (no voices: 0, and the Detail stays on the signal alone).
//  agree     per half (paw-na9u): the say-weighted share of the voices whose own bow (mean deviation from the straight line)
//            has the consensus' sign (HOW.BOW: straight either way), by: the top three of them (the Detail's tooltip says
//            who supports a point), fprof: the parts' shape turn to turn (as prof, over the whole half); per turn restAgree:
//            the share of the say that rests there.
// Types (pooling over the scene): the half-strokes of the WHOLE scene, by direction, tempo, size, shape (and the dwell at the
// turn they leave: a held stroke and an unheld one are not one type): each joins the
// nearest type within TYPE (else starts one), then every half goes to its nearest type (one that returns later is the same
// type). A type's pooled shape is its members' median (many passes at different frame phases: sub-frame resolution). The
// Detail decides per type (stroke-shape.js shapeFit o.how): one layout per type, its own evidence per stroke type.
import { signalTurns, savgol } from './strokes.js';
import { PROF, medProf } from './stroke-shape.js';

export const HOW = Object.freeze({
  BAND: 0.06,            // a voice rests at a turn while it stays within this share of its stroke there of its turn level (the strokes step's band, on the part smoothed like the signal; at least 1.5 x its jitter)
  COH: [0.3, 0.8],       // coherence with the stroke -> a voice's say on dwell and shape
  SNR: [2, 8],           // stroke amplitude over tracker jitter -> say
  HIT: [-0.02, 0.12],    // how far behind the straight line the move is from its middle to 85 % (a sine -0.06, a straight move 0, speeding up into the stop 0.2) -> how sharp the stop is
  RING: [1.5, 3.5],      // unexplained motion just after the stroke arrives over during the move (at least its usual level) -> ringing
  AFTER: 0.35,           // the ring is looked for in this share of the half after the stroke arrives
  SHARP: 4,              // a half's shape is the most confident voices': say ^ this
  CONF: 0.5,             // conf = say / (say + this): one clean voice 0.67, three 0.86
  SECONDARY: [0.3, 0.05],   // fusion.js: a secondary part = present x fit >= [0], say in the depth < [1]; the Detail reads HOW only in scenes with one
  TYPE: Object.freeze({ dur: 0.3, amp: 0.35, shape: 0.12, rest: 0.15 }),   // a half joins a type within these (tempo, size: ratios; shape: RMS; the dwell at the turn it leaves)
  BOW: 0.02,             // paw-na9u: a move's bow (mean deviation from the straight line, share of the move) under this is straight (for the parts' agreement)
});
const fin = Number.isFinite;
const smooth = (x, [a, b]) => (x <= a ? 0 : x >= b ? 1 : ((x - a) / (b - a)) ** 2 * (3 - (2 * (x - a)) / (b - a)));
const rnd = (x, k = 3) => (fin(x) ? +x.toFixed(k) : 0);
const median = (a) => { const s = a.filter(fin).sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
export function wmedian(xs, ws) {
  const o = xs.map((x, i) => [x, ws[i]]).filter((p) => fin(p[0]) && p[1] > 0).sort((a, b) => a[0] - b[0]), tot = o.reduce((s, p) => s + p[1], 0);
  if (!tot) return NaN;
  let acc = 0;
  for (const [x, w] of o) { acc += w; if (acc >= tot / 2 - 1e-12) return x; }
  return o[o.length - 1][0];
}
const pctl = (a, p) => { const b = Array.from(a).filter(fin).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };
const rms = (x, y) => { let s = 0; for (let k = 0; k < PROF; k++) s += (x[k] - y[k]) ** 2; return Math.sqrt(s / PROF); };
/** a smoothed like the strokes step smooths the signal (Savitzky-Golay over ~150 ms, per seen stretch: jitter is not a
 *  rest or a move); NaN where unseen. */
function smoothed(a, dt) {
  const n = a.length, o = new Float64Array(n).fill(NaN), h = Math.max(1, Math.floor(Math.round(150 / dt) / 2));
  for (let i = 0; i < n;) {
    if (a[i] !== a[i]) { i++; continue; }
    let j = i;
    while (j < n && a[j] === a[j]) j++;
    o.set(savgol(a.slice(i, j), h), i);
    i = j;
  }
  return o;
}
/** f at time x (t ascending, linear; NaN across a hole). */
function at(t, f, x) {
  let lo = 0, hi = t.length - 1;
  if (!(x >= t[0] && x <= t[hi])) return NaN;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
  return t[hi] === t[lo] ? f[lo] : f[lo] + ((f[hi] - f[lo]) * (x - t[lo])) / (t[hi] - t[lo]);
}
/** The move ta -> tb (exact ms) on f as its deviation from the straight line at u = k / 16 (stroke-shape.js profile), or null. */
export function profAt(t, f, ta, tb) {
  const fa = at(t, f, ta), fb = at(t, f, tb), A = fb - fa;
  if (!(tb > ta) || !fin(A) || Math.abs(A) < 1e-12) return null;
  const out = new Float64Array(PROF);
  for (let k = 0; k < PROF; k++) { const u = (k + 1) / (PROF + 1), y = at(t, f, ta + u * (tb - ta)); if (!fin(y)) return null; out[k] = (y - fa) / A - u; }
  return out;
}
/** Parabola vertex offset (samples, -0.5..0.5) at i. */
const sub = (y, i) => { if (i < 1 || i >= y.length - 1) return 0; const den = y[i - 1] - 2 * y[i] + y[i + 1]; return Math.abs(den) < 1e-12 || !fin(den) ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (y[i - 1] - y[i + 1])) / den)); };

/** A voice's rest at a turn: its own extreme of that kind (+1 = a maximum) within 2 samples of c inside (lo, hi), then the
 *  samples around it within `band` of that level (the strokes step's dwell, per part) -> {s, e (samples), ts, te (where it
 *  leaves the band, between samples: a dwell is not whole frames)} | null (not seen). am: the voice's motion, t: times. */
function restAt(am, kind, band, c, lo, hi, t) {
  lo = Math.max(-1, lo); hi = Math.min(am.length, hi);
  let b = -1;
  for (let q = Math.max(lo + 1, c - 2); q <= Math.min(hi - 1, c + 2); q++) if (am[q] === am[q] && (b < 0 || kind * (am[q] - am[b]) > 0)) b = q;
  if (b < 0) return null;
  const L = am[b], off = (q) => Math.abs(am[q] - L);
  let s = b, e = b;
  while (s - 1 > lo && off(s - 1) <= band) s--;
  while (e + 1 < hi && off(e + 1) <= band) e++;
  const x = (o, q) => (off(o) > band && off(o) !== off(q) ? Math.min(1, (off(o) - band) / (off(o) - off(q))) : 1);   // the crossing between o (out) and q (in)
  const ts = s - 1 > lo && am[s - 1] === am[s - 1] ? t[s - 1] + (t[s] - t[s - 1]) * x(s - 1, s) : t[s], te = e + 1 < hi && am[e + 1] === am[e + 1] ? t[e + 1] - (t[e + 1] - t[e]) * x(e + 1, e) : t[e];
  return { s, e, ts, te };
}

/**
 * HOW the strokes of one run scene go. t (ms), v (the fused signal, NaN = none), voices [{id, label, role, a, lag, w, wr, on, fit, rx, ry, amp}]
 * (fusion.js voicesOf), o {strokes: the strokes step's options for its turns} -> {turns: [{t, kind (+1 = a top of v),
 * dwell, fs, fe, hit, ring, impact, strength, conf, by: [{id, label, d}], ringBy: [{id, label, r}]}], halves: [{t0, t1,
 * m0, m1 (the move between the rests), dir, T (m1 - m0), A, rest (the dwell it leaves), prof (m0..m1), sprof (the signal's
 * own), asym, conf, type}], types: [{id, label, dir, n, T, A, rest, prof}]}.
 */
export function readHow(t, v, voices = [], o = {}) {
  const n = t.length, { y, turns } = signalTurns(t, v, o.strokes || {});
  const out = { turns: [], halves: [], types: [] };
  if (turns.length < 2) return out;
  const dt = (t[n - 1] - t[0]) / (n - 1) || 1000 / 30;
  const V = voices.filter((x) => x.w > 0 || x.wr > 0).map((x) => {
    const am = smoothed(Float64Array.from(x.a, (a, q) => (x.on[q] ? a : NaN)), dt), d2 = [];
    for (let q = 1; q + 1 < n; q++) { const z = x.a[q + 1] - 2 * x.a[q] + x.a[q - 1]; if (z === z && x.on[q - 1] && x.on[q] && x.on[q + 1]) d2.push(Math.abs(z)); }
    const rv = new Float64Array(n).fill(NaN);
    for (let q = 1; q < n; q++) if (x.on[q] && x.on[q - 1]) { const d = Math.hypot(x.rx[q] - x.rx[q - 1], x.ry[q] - x.ry[q - 1]); if (d === d) rv[q] = d; }
    return { ...x, am, noise: (1.4826 * median(d2)) / Math.sqrt(6) || 0, rv, floor: median(Array.from(rv)) || 1e-9, xa: Float64Array.from(x.a, (u, q) => (x.on[q] ? u : NaN)) };   // xa: its motion where seen (paw-o60v.2: once, not per half)
  });
  const T = turns.map(([i]) => i), tt = T.map((i) => t[i] + sub(y, i) * dt);   // sub-frame turn times
  const seen = (x, a, b) => { let k = 0, c = 0; for (let q = Math.max(0, a); q <= Math.min(n - 1, b); q++) { c++; if (x.on[q]) k++; } return c ? k / c : 0; };
  const rmsOf = (f, a, b) => { let s = 0, c = 0; for (let q = Math.max(1, a); q <= Math.min(n - 1, b); q++) if (f[q] === f[q]) { s += f[q] * f[q]; c++; } return c ? Math.sqrt(s / c) : NaN; };
  for (let j = 0; j < T.length; j++) {
    const i = T[j], lo = j > 0 ? T[j - 1] : Math.max(-1, i - (T[1] - T[0])), hi = j + 1 < T.length ? T[j + 1] : Math.min(n, i + (T[j] - T[j - 1]));
    const Tb = t[i] - t[Math.max(0, lo)], Ta = t[Math.min(n - 1, hi)] - t[i], mean = (Tb + Ta) / 2 || dt;
    // ring: what each voice does right after the stroke arrives (where the signal enters its turn's band: the turn itself can
    // sit anywhere inside a rest) that the stroke does not explain, against during the move
    let ar = i;
    if (y[i] === y[i]) { const band = HOW.BAND * Math.max(Math.abs(y[i] - y[Math.max(0, lo)]) || 0, Math.abs(y[i] - y[Math.min(n - 1, hi)]) || 0); while (ar - 1 > Math.max(lo, 0) && Math.abs(y[ar - 1] - y[i]) <= band) ar--; }
    let none = 1, sw = 0, sv = 0;
    const ringBy = [];
    for (const x of V) {
      x._r = 0;
      if (!(x.wr > 0) || !x.on[Math.max(0, Math.min(n - 1, ar + x.lag))]) continue;
      const a0 = ar + x.lag, a1 = a0 + Math.max(2, Math.round(HOW.AFTER * (hi - ar))), b0 = lo + Math.round(0.4 * (ar - lo)), b1 = ar - Math.max(1, Math.round(0.1 * (ar - lo)));
      const ea = rmsOf(x.rv, a0, a1), eb = rmsOf(x.rv, b0, b1);
      if (!fin(ea)) continue;
      const r = smooth(ea / Math.max(fin(eb) ? eb : 0, x.floor), HOW.RING), g = x.wr * seen(x, a0, a1) * r;
      x._r = r;
      none *= 1 - Math.min(1, g);
      if (r > 0.05) {
        let s2 = 0, c2 = 0;
        for (let q = Math.max(0, a0); q <= Math.min(n - 1, a1); q++) if (x.on[q]) { s2 += x.rx[q] ** 2 + x.ry[q] ** 2; c2++; }
        sv += g * (c2 && x.amp > 0 ? Math.min(2, Math.sqrt(s2 / c2) / x.amp) : 0); sw += g;
        ringBy.push({ id: x.id, label: x.label, r: rnd(r, 2) });
      }
    }
    // dwell: every voice's rest around the turn (at its own lag); a voice ringing there does not vote (it is the impact)
    const ds = [], fss = [], fes = [], ws = [], rest = [];
    let say = 0;
    for (const x of V) {
      x._d = 0;
      const w = x.w * (1 - x._r);
      if (!(w > 0)) continue;
      const c = Math.max(lo + 1, Math.min(hi - 1, i + x.lag));
      if (!x.on[c]) continue;
      let mn = Infinity, mx = -Infinity;   // the stroke there: the voice's range over the two halves
      for (let q = Math.max(0, lo + x.lag); q <= Math.min(n - 1, hi + x.lag); q++) if (x.am[q] === x.am[q]) { mn = Math.min(mn, x.am[q]); mx = Math.max(mx, x.am[q]); }
      const r = mx > mn ? restAt(x.am, turns[j][1], Math.max(HOW.BAND * (mx - mn), 1.5 * x.noise), c, lo + x.lag, hi + x.lag, t) : null;
      if (!r) continue;
      say += x.w;
      const d = (r.te - r.ts) / mean;
      ds.push(d); ws.push(w); x._d = d;
      if (d > 0) { fss.push(Math.max(0, (t[i] - (r.ts - x.lag * dt)) / (Tb || dt))); fes.push(Math.max(0, (r.te - x.lag * dt - t[i]) / (Ta || dt))); rest.push(x); }
    }
    const dwell = ds.length ? wmedian(ds, ws) : 0, rw = rest.map((x) => x.w * (1 - x._r));
    out.turns.push({ t: t[i], kind: turns[j][1], dwell: rnd(dwell), fs: rnd(rest.length ? wmedian(fss, rw) : 0), fe: rnd(rest.length ? wmedian(fes, rw) : 0),
      hit: 0, ring: rnd(1 - none), impact: 0, strength: rnd(sw > 0 ? sv / sw : 0), conf: rnd(say / (say + HOW.CONF)),
      restAgree: rnd(ws.length ? rest.filter((x) => x._d > 0.5 * dwell).reduce((q, x) => q + x.w * (1 - x._r), 0) / ws.reduce((q, w) => q + w, 0) : 0),
      by: rest.filter((x) => x._d > 0.5 * dwell && x._d > 0).sort((a, b) => b.w - a.w).slice(0, 4).map((x) => ({ id: x.id, label: x.label, d: rnd(x._d, 2) })),
      ringBy: ringBy.sort((a, b) => b.r - a.r).slice(0, 3) });
  }
  // the halves: the move between the rests at its two turns (where the turn falls inside a rest is noise), its shape from
  // the most confident voices there, each at its own lag; sub-frame turn times
  for (let j = 0; j + 1 < T.length; j++) {
    const a = T[j], b = T[j + 1], ta = tt[j], tb = tt[j + 1], A0 = out.turns[j], B0 = out.turns[j + 1];
    let m0 = ta + A0.fe * (tb - ta), m1 = tb - B0.fs * (tb - ta);
    if (!(m1 - m0 >= 0.3 * (tb - ta))) { m0 = ta; m1 = tb; }
    const sprof = profAt(t, y, m0, m1);
    if (!sprof) continue;
    let say = 0, W = 0;
    const acc = new Float64Array(PROF), accF = new Float64Array(PROF), bows = [];
    let WF = 0;   // paw-na9u: each voice's bow (its mean deviation from the straight line) and say
    for (const x of V) {
      if (!(x.w > 0) || seen(x, a + x.lag, b + x.lag) < 0.8) continue;
      const xa = x.xa, pr = profAt(t, xa, m0 + x.lag * dt, m1 + x.lag * dt);
      if (!pr) continue;
      const pf = profAt(t, xa, ta + x.lag * dt, tb + x.lag * dt);   // paw-na9u: its shape over the whole half, turn to turn (the rests included)
      let f = 0, c = 0;
      for (let q = Math.max(0, a + x.lag); q <= Math.min(n - 1, b + x.lag); q++) if (x.on[q]) { f += x.fit[q]; c++; }
      const w = (x.w * (c ? f / c : 0)) ** HOW.SHARP;
      say += x.w;
      if (!(w > 0)) continue;
      if (pf) { bows.push({ x, s: x.w * (c ? f / c : 0), bow: pf.reduce((q, v) => q + v, 0) / PROF }); for (let k = 0; k < PROF; k++) accF[k] += w * pf[k]; WF += w; }
      for (let k = 0; k < PROF; k++) acc[k] += w * pr[k];
      W += w;
    }
    const prof = W > 0 ? acc.map((s) => s / W) : sprof;
    // paw-na9u: do the parts agree on the move's bow? the say-weighted share whose own bow has the consensus' sign (a bow
    // under HOW.BOW either way counts as agreeing with a straight consensus), and who they are
    const fp = WF > 0 ? accF.map((s) => s / WF) : profAt(t, y, ta, tb), cb = fp ? fp.reduce((q, v) => q + v, 0) / PROF : 0, same = (b) => (Math.abs(cb) < HOW.BOW ? Math.abs(b) < 2 * HOW.BOW : Math.sign(b) === Math.sign(cb) && Math.abs(b) >= HOW.BOW / 2);
    const sb = bows.reduce((q, y) => q + y.s, 0), ag = bows.filter((y) => same(y.bow));
    out.halves.push({ t0: t[a], t1: t[b], m0: Math.round(m0 * 10) / 10, m1: Math.round(m1 * 10) / 10, dir: Math.sign(y[b] - y[a]) || 1, T: m1 - m0, A: Math.abs(y[b] - y[a]), rest: A0.dwell, fr: rnd(dt / (tb - ta)), prof, sprof,
      asym: rnd(prof.reduce((s, x) => s + x, 0) / PROF), conf: rnd(W > 0 ? say / (say + HOW.CONF) : 0), type: '',
      fprof: fp, agree: rnd(sb > 0 ? ag.reduce((q, y) => q + y.s, 0) / sb : 1), voices: bows.length, by: ag.sort((p, q) => q.s - p.s).slice(0, 3).map((y) => y.x.label) });
  }
  // hit: how the move arrives at its turn, from its shape there (behind the straight line late = still fast at the end)
  for (const h of out.halves) {
    const B0 = out.turns.find((x) => x.t === h.t1);
    let late = 0, c = 0;
    for (let k = 0; k < PROF; k++) { const u = (k + 1) / (PROF + 1); if (u >= 0.5 && u <= 0.85) { late += h.prof[k]; c++; } }
    B0.hit = rnd(-late / c, 3);
    const hm = smooth(B0.hit, HOW.HIT);
    B0.impact = rnd(Math.max(hm * (0.4 + 0.6 * B0.ring), B0.ring * (0.5 + 0.5 * hm)));
  }
  out.types = typesOf(out.halves);
  return out;
}

/** Halves [{dir, T, A, prof}] sorted into types (see the header), in place (h.type = the type's id) -> [{id, label, dir, n,
 *  T, A, prof (pooled)}]. Deterministic: the same halves give the same types. */
export function typesOf(halves, tol = HOW.TYPE) {
  const types = [];
  // (a dwell is measured on whole frames: its tolerance grows by 1.5 frames' share of the half)
  const dist = (h, y) => Math.max(Math.abs(Math.log(h.T / y.T)) / Math.log(1 + tol.dur), Math.abs(Math.log(Math.max(h.A, 1e-9) / Math.max(y.A, 1e-9))) / Math.log(1 + tol.amp), rms(h.prof, y.prof) / tol.shape,
    Math.abs((h.rest || 0) - (y.rest || 0)) / (tol.rest + 1.5 * Math.max(h.fr || 0, y.fr || 0)));
  const fr = (y) => median(y.mem.map((h) => h.fr || 0));
  const pool = (y) => { y.T = median(y.mem.map((h) => h.T)); y.A = median(y.mem.map((h) => h.A)); y.rest = median(y.mem.map((h) => h.rest || 0)); y.fr = fr(y); y.prof = medProf(y.mem.map((h) => h.prof)); };
  for (const dir of [1, -1]) {
    const hs = halves.filter((h) => h.dir === dir), mine = [];
    for (const h of hs) {   // 1. in time order: the nearest type within tolerance, else a new one
      let best = null, bd = 1;
      for (const y of mine) { const d = dist(h, y); if (d <= bd) { bd = d; best = y; } }
      if (best) { best.mem.push(h); pool(best); } else { const y = { dir, mem: [h] }; pool(y); mine.push(y); }
    }
    for (let pass = 0; pass < 2; pass++) {   // 2. every half to its nearest type (a returning type is the same type)
      const to = hs.map((h) => { let best = null, bd = Infinity; for (const y of mine) { const d = dist(h, y); if (d < bd - 1e-12) { bd = d; best = y; } } return best; });
      for (const y of mine) y.mem = [];
      hs.forEach((h, q) => to[q].mem.push(h));
      for (let k = mine.length - 1; k >= 0; k--) if (!mine[k].mem.length) mine.splice(k, 1);
      for (const y of mine) pool(y);
    }
    types.push(...mine);
  }
  types.sort((x, y) => x.mem[0].t0 - y.mem[0].t0);
  return types.map((y, k) => {
    const id = String(k), label = k < 26 ? String.fromCharCode(65 + k) : 'T' + k;
    for (const h of y.mem) h.type = id;
    return { id, label, dir: y.dir, n: y.mem.length, T: Math.round(y.T), A: rnd(y.A), rest: rnd(y.rest), prof: y.prof };
  });
}
