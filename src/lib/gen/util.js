// Small pure helpers shared by the generators, the plan compiler and the loop tiler.
// No DOM, no dependencies. Positions: 0 = deepest, 100 = out (see core/script.js).

// minGapMs 20: the smallest interval some devices accept (e.g. a 20 ms device profile); callers pass their profile's value
export const DEFAULTS = Object.freeze({ maxSpeed: 450, minGapMs: 20, blendMs: 300 });

// ---------------------------------------------------------------- seeded randomness

/** Deterministic PRNG: seed (uint32) -> () => float in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the string form of each part -> uint32. Stable seed derivation: hashSeed(planSeed, segId). */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0xff; h = Math.imul(h, 0x01000193); // part separator, so ('ab','c') != ('a','bc')
  }
  return h >>> 0;
}

export const rngFor = (...parts) => mulberry32(hashSeed(...parts));

// ---------------------------------------------------------------- curves and interpolation

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Easing curves on u in [0, 1] -> [0, 1]. Used for ramps, fades and the climax decay. */
export const CURVES = {
  linear: (u) => u,
  'ease-in': (u) => u * u,                                     // slow start
  'ease-out': (u) => 1 - (1 - u) * (1 - u),                    // fast start, settles
  'ease-in-out': (u) => (1 - Math.cos(Math.PI * u)) / 2,
  exp: (u) => (Math.exp(3 * u) - 1) / (Math.exp(3) - 1),       // used only when an endpoint is 0 (see mix)
  step: (u) => (u < 1 ? 0 : 1),
};

/** a -> b at u (clamped 0..1) along `curve`. 'exp' between two positive values is geometric
 *  (a * (b/a)^u: equal ratios per unit time, the natural accelerando / ritardando). */
export function mix(a, b, u, curve = 'linear') {
  u = clamp(u, 0, 1);
  if (curve === 'exp' && a > 0 && b > 0) return a * Math.pow(b / a, u);
  return a + (b - a) * (CURVES[curve] ?? CURVES.linear)(u);
}

export function median(v) {
  if (!v.length) return NaN;
  const s = [...v].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------- speed

/** Largest integer pos change allowed over dt ms at maxSpeed pos/s. */
export const allowedStep = (dt, maxSpeed) => Math.floor((maxSpeed * dt) / 1000 + 1e-9);

/** True if q is at least minGapMs after p and moving p -> q stays within maxSpeed (maxSpeed <= 0 = no cap). */
export const stepOk = (p, q, maxSpeed, minGapMs = 1) =>
  q.at - p.at >= minGapMs && (!(maxSpeed > 0) || Math.abs(q.pos - p.pos) <= allowedStep(q.at - p.at, maxSpeed));

/** Script -> Script whose every step is <= maxSpeed (integer exact): each point is pulled toward its
 *  predecessor, timing kept. A forward pass: point 0 is the anchor. */
export function limitSpeed(script, maxSpeed = DEFAULTS.maxSpeed) {
  if (!(maxSpeed > 0) || script.length < 2) return script.slice();
  const out = [script[0]];
  for (let i = 1; i < script.length; i++) {
    const prev = out[i - 1], a = script[i];
    const lim = allowedStep(a.at - prev.at, maxSpeed);
    const pos = clamp(a.pos, prev.pos - lim, prev.pos + lim);
    out.push(pos === a.pos ? a : { at: a.at, pos });
  }
  return out;
}

/** Worst step speed in a script: { speed, at } (at = time of the point ending the step). */
export function maxStepSpeed(script) {
  let speed = 0, at = -1;
  for (let i = 1; i < script.length; i++) {
    const v = (Math.abs(script[i].pos - script[i - 1].pos) * 1000) / (script[i].at - script[i - 1].at);
    if (v > speed) { speed = v; at = script[i].at; }
  }
  return { speed, at };
}

// ---------------------------------------------------------------- joining two pieces

/**
 * How many points to drop from the end of `left` and the start of `right` so that the step across the
 * join respects maxSpeed and minGapMs. Points are only dropped within windowMs of the join (the window is
 * widened to the size that always admits a straight bridge over the full 0..100 range), the outgoing
 * side yields first, and each side keeps at least one point. A locked side never yields (except to
 * resolve two points at the same time, which would make the result invalid).
 * -> { dropLeft, dropRight, ok }  (ok false = the remaining step still exceeds the cap; report it).
 */
export function joinPlan(left, right, { maxSpeed = DEFAULTS.maxSpeed, minGapMs = DEFAULTS.minGapMs, windowMs = DEFAULTS.blendMs, lockLeft = false, lockRight = false } = {}) {
  let i = left.length, j = 0;
  if (!i || !right.length) return { dropLeft: 0, dropRight: 0, ok: true };
  const W = Math.max(windowMs, (maxSpeed > 0 ? Math.ceil(50000 / maxSpeed) : 0) + minGapMs);
  const lEnd = left[i - 1].at, rStart = right[0].at;
  while (i > 0 && j < right.length) {
    const p = left[i - 1], q = right[j];
    if (stepOk(p, q, maxSpeed, minGapMs)) return { dropLeft: left.length - i, dropRight: j, ok: true };
    const canL = !lockLeft && i > 1 && p.at >= lEnd - W;
    const canR = !lockRight && j < right.length - 1 && q.at <= rStart + W;
    if (canL) i--;
    else if (canR) j++;
    else if (q.at <= p.at) { if (!lockLeft || lockRight) i--; else j++; } // validity beats locks and counts
    else return { dropLeft: left.length - i, dropRight: j, ok: false };
  }
  return { dropLeft: left.length - i, dropRight: j, ok: true };
}

/** Join script `a` (up to tJoin) to script `b` (from tJoin on) without a speed spike: the part of a before
 *  tJoin, then b from tJoin, with points near the join removed until the crossing step is within the cap.
 *  opts: { maxSpeed, minGapMs, windowMs, lockLeft, lockRight }. Returns a new Script. */
export function blend(a, b, tJoin, opts = {}) {
  const left = a.filter((x) => x.at < tJoin), right = b.filter((x) => x.at >= tJoin);
  const { dropLeft, dropRight } = joinPlan(left, right, opts);
  return left.slice(0, left.length - dropLeft).concat(right.slice(dropRight));
}

// ---------------------------------------------------------------- humanise any script

/**
 * Seeded humanising of an existing Script: turning points move in time by up to `time` x the shorter
 * neighbouring interval (never crossing a neighbour) and stroke depth shrinks by up to `amp` x the travel
 * toward `anchor` (a pos; strokes never leave their original range). Endpoints stay put.
 * opts: { time = 0.1, amp = 0.1, seed = 0, anchor = 100 }.
 */
export function humanize(script, { time = 0.1, amp = 0.1, seed = 0, anchor = 100 } = {}) {
  const rng = rngFor(seed, 'humanize');
  const out = script.map((a) => ({ ...a }));
  for (let i = 1; i < out.length - 1; i++) {
    const a = script[i - 1], b = script[i], c = script[i + 1];
    const turn = (b.pos - a.pos) * (c.pos - b.pos) < 0;
    const rt = rng(), ra = rng(); // drawn for every point so results don't depend on which points are turns
    if (!turn) continue;
    const room = Math.min(b.at - a.at, c.at - b.at);
    const at = Math.round(b.at + (2 * rt - 1) * clamp(time, 0, 0.45) * room);
    out[i].at = clamp(at, out[i - 1].at + 1, c.at - 1);
    out[i].pos = Math.round(b.pos + (anchor - b.pos) * clamp(amp, 0, 1) * ra);
  }
  return out;
}
