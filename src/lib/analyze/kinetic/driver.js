// Loader and driver for the machine's own planner (Kinetic2, built into kinetic.wasm; see PROVENANCE.md).
// Adapted from Phosphor's plugins/factory/funscript-player/kinetic/kinetic.js and scheduler.js (Apache-2.0, same owner):
// the segment stream is built exactly as the real host sends it, so the preview is what the machine will do.
//
// - The wasm is bytes.js (base64 in a module), imported lazily: no fetch, no .wasm URL, so it needs no Vite config
//   and works in node and in the browser (compiling needs CSP 'wasm-unsafe-eval' in a locked-down page).
// - One shared instance. loadKinetic() never rejects permanently in a way that breaks callers: on failure it
//   resolves null and kineticError() says why (callers fall back to the analytic engine).
// - Synchronous after load: renderKinetic() is a plain function so simulateDevice() can stay synchronous.

export const LEAD_MS = 150, HORIZON_MS = 250, PREROLL_MS = 1200, TAIL_MS = 1000, EXPECT_MS = 500;
export const FREE = -32768;   // segment end velocity "unspecified": a free knot (the planner shapes it)
export const DUR_MAX = 65535;  // segment dur_ms is a u16
// kinetic_sample.flags (Nucleus tools/kinetic-wasm KINETIC_FLAG_*): SHAPED a knot was trimmed toward its predecessor, CLAMPED the
// plan left the window (the output backstop holds it at the edge)
export const FLAG_SHAPED = 2, FLAG_CLAMPED = 4;
const ANOMALY_NAMES = ['', 'settle', 'end velocity clamped', 'knot trimmed', 'dwell zeroed', 'knot refused', 'piece over ceiling'];

let inst = null, version = null, error = null, loading = null;

async function instantiate(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const k = (await WebAssembly.instantiate(bytes, {})).instance.exports;
  k._initialize();
  return k;
}
function versionOf(k) {
  const m = new Uint8Array(k.memory.buffer), p = k.kinetic_version();
  let e = p;
  while (m[e]) e++;
  return new TextDecoder().decode(m.subarray(p, e));
}

/** Lazily load the planner (shared). Resolves the version string, or null when it cannot load (see kineticError()). */
export function loadKinetic() {
  if (inst) return Promise.resolve(version);
  if (!loading) {
    loading = import('./bytes.js').then(({ WASM }) => instantiate(WASM)).then((k) => {
      const v = versionOf(k);
      if (!/ kinetic2 /.test(v)) throw new Error('not a Kinetic2 build: ' + v);
      inst = k; version = v; error = null;
      return v;
    }).catch((e) => { error = e; loading = null; return null; });
  }
  return loading;
}
export const kineticLoaded = () => inst !== null;
export const kineticVersion = () => version;
export const kineticError = () => error;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** knot j's end velocity as the host declares it: 0 at a rest (last knot, long gap, reversal, hold edge), else FREE. */
function endVel(at, pos, j) {
  const n = at.length;
  if (j >= n - 1 || at[j + 1] - at[j] > EXPECT_MS) return 0;
  const d1 = pos[j + 1] - pos[j], d0 = j > 0 ? pos[j] - pos[j - 1] : d1;
  return d0 * d1 > 0 ? FREE : 0;
}

/** Script (actions, pos 0..100) -> render segments [startMs, pos_e4, durMs, endVelE3] on the engine clock, plus t0 (media ms of engine 0).
 *  dur_ms is a u16 on the wire: the host clamps it to 65535 (Phosphor src/model/motion.js record), so a span longer than
 *  that arrives at 65.5 s and holds; passed unclamped, the wasm's uint16 parameter would wrap it (70 s -> 4.5 s). */
export function segmentsOf(script, leadMs = LEAD_MS) {
  const at = script.map((a) => a.at), pos = script.map((a) => a.pos / 100);
  const pad = 2 * leadMs + PREROLL_MS, e4 = (p) => Math.round(clamp(p, 0, 1) * 10000);
  const segs = [[2 * leadMs, e4(pos[0]), PREROLL_MS, 0]];
  for (let k = 1; k < at.length; k++) if (at[k] > at[k - 1]) segs.push([pad + at[k - 1], e4(pos[k]), Math.min(DUR_MAX, at[k] - at[k - 1]), endVel(at, pos, k) === 0 ? 0 : FREE]);
  return { segs, t0: -pad, steps: Math.ceil(pad + at[at.length - 1] + TAIL_MS) };
}

/**
 * Run the planner over a script, as a generator that yields (steps done) every `chunk` ms of planner time so a caller can
 * spread it over idle slices; the return value is the render. limitsMm = {v (mm/s), a (mm/s^2), j (mm/s^3)}, strokeMm =
 * window and rail. -> { t0 (media ms of engine 0), first (media ms of sample 0, read from the engine clock: t0 + 1, as
 * kinetic_step advances the clock, then evaluates), steps, pos, vel, acc (Float32Array, mm, mm/s, mm/s^2, one per 1 ms:
 * pos is the ideal emitter's position_mm, what the board renders), flags (Uint8Array, kinetic_sample.flags per ms),
 * anomalies: {name: count}, accepted, refused }. Throws if the planner is not loaded. Abandon a run with .return() (frees it).
 */
export function* kineticRun(script, limitsMm, strokeMm, chunk = 4096) {
  if (!inst) throw new Error('Kinetic planner not loaded (await loadKinetic())' + (error ? ': ' + error.message : ''));
  if (script.length < 2) throw new Error('need at least two actions');
  const k = inst, { segs, t0, steps } = segmentsOf(script);
  const h = k.kinetic_create(limitsMm.v, limitsMm.a, limitsMm.j, strokeMm, HORIZON_MS);
  if (!h) throw new Error('planner refused the limits');
  const out = k.malloc(64), tb = k.malloc(32);
  try {
    if (k.kinetic_set_window(h, 0, strokeMm) !== 1) throw new Error('planner refused the window');
    k.kinetic_default_tuning(tb);
    k.kinetic_set_tuning(h, tb);
    k.kinetic_expect(h, EXPECT_MS);
    const pos = new Float32Array(steps), vel = new Float32Array(steps), acc = new Float32Array(steps), flags = new Uint8Array(steps), an = new Uint32Array(32);
    let next = 0, accepted = 0, refused = 0, first = NaN, dv = new DataView(k.memory.buffer);
    for (let i = 0; i < steps; i++) {
      for (; next < segs.length && segs[next][0] - LEAD_MS <= i; next++) {
        const s = segs[next], r = k.kinetic_submit_segment(h, s[1], s[2], s[3], Math.round(s[0] * 1000));
        if (r === 1) accepted++; else if (r === 0) refused++;
      }
      k.kinetic_step(h, 0.001, out);
      if (dv.buffer !== k.memory.buffer) dv = new DataView(k.memory.buffer);   // memory may have grown
      if (i === 0) first = t0 + dv.getFloat64(out, true) / 1000;   // t_us
      pos[i] = dv.getFloat32(out + 44, true); vel[i] = dv.getFloat32(out + 36, true); acc[i] = dv.getFloat32(out + 40, true); flags[i] = dv.getUint8(out + 58);
      for (let a = dv.getUint32(out + 52, true); a; a &= a - 1) an[31 - Math.clz32(a & -a)]++;
      if (i % chunk === chunk - 1) { yield i + 1; dv = new DataView(k.memory.buffer); }
    }
    const anomalies = {};
    an.forEach((c, b) => { if (c) anomalies[ANOMALY_NAMES[b] || 'bit ' + b] = c; });
    return { t0, first, steps, pos, vel, acc, flags, anomalies, accepted, refused };
  } finally {
    k.free(out); k.free(tb); k.kinetic_destroy(h);
  }
}

/** kineticRun in one go (synchronous). */
export function renderKinetic(script, limitsMm, strokeMm) {
  const it = kineticRun(script, limitsMm, strokeMm, Infinity);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
