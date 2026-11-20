// signal-source.js -- what a run's signal is made from: per shot (derive.source / derive.against) and per range inside a
// run (the scene fact `signal`), paw-9qm. Pure (test/signal-source.test.mjs).
//
// Per shot (rederive.js deriveClean, saved on the shot like the camera settings, undoable):
//   source   a channel id: 'fused' | 'shaft' (the shaft's measured entry: lib/shaft-source.js) | 'rel:<a>:<b>' (a pair: a's motion against b's) | any channel of the run
//            ('sem_c1_hips_proj', 'proj_cam', ...). Wins over the scene link's channel. Absent = the link / the run's own.
//   against  what the signal is measured against: absent = the camera (the camera removal as set: derive.cam) |
//            'none' (no camera removal: image positions) | a group key ('sem_c2_hips'): the source relative to that
//            part (a single part A -> rel:A:part; fused -> every part's centre minus that part's; a pair keeps its own).
// Per range: shots[k].signal = {spans: [{t0, t1, source?, against?, cam?, fuse?}]} (a scene fact, timeline/shots.js ACT_KEYS:
//   absolute times, clipped to the scene when read, like the Detail overrides). Inside a span the run's signal is
//   that span's source / against / camera instead of the shot's; at the span's ends the two cross-fade over
//   BLEND_MS (the override mapped onto the base signal's range over the run scene, its sign aligned), so a join
//   never jumps. Old projects carry neither: nothing changes.
import { sceneAt } from './runs.js';
import { lowerBound } from './lane.js';
import { shaftNames, partNames, partOf } from './shaft.js';
import { CAM_DEFAULT, deriveClean, fuseClean, cameraPath, unwarp, deriveBlock, withAgainst, AGAINST_KEY } from './rederive.js';

const fin = Number.isFinite;
export const BLEND_MS = 300;
export { AGAINST_KEY, withAgainst };
const SOURCE = /^[A-Za-z0-9_:~.-]{1,160}$/;
const REL = /^rel:([^:]+):([^:]+)$/;

/** 'camera' | 'none' | a group key -> the stored value ('camera' = the default: undefined); anything else undefined.
 *  keepCamera: a span keeps an explicit 'camera' (it overrides a shot's 'none'). */
export function againstClean(a, keepCamera = false) {
  if (a === 'camera') return keepCamera ? 'camera' : undefined;
  return a === 'none' || (typeof a === 'string' && AGAINST_KEY.test(a)) ? a : undefined;
}
export const sourceClean = (s) => (typeof s === 'string' && SOURCE.test(s) ? s : undefined);
/** 'rel:a:b' -> {a, b} (a !== b), else null. */
export function pairOf(id) {
  const m = REL.exec(id || '');
  return m && m[1] !== m[2] && AGAINST_KEY.test(m[1]) && AGAINST_KEY.test(m[2]) ? { a: m[1], b: m[2] } : null;
}

/** One range override from a file / an edit -> {t0, t1, source?, against?, cam?, fuse?} or null (nothing to override). fuse =
 *  the fusion controls inside it (rederive.js fuseClean: the pad, pins, ...; paw-iasp). */
export function spanClean(s) {
  if (!s || !fin(+s.t0) || !fin(+s.t1) || !(+s.t1 > +s.t0)) return null;
  const out = { t0: Math.round(+s.t0), t1: Math.round(+s.t1) }, src = sourceClean(s.source), ag = againstClean(s.against, true);
  if (src) out.source = src;
  if (ag) out.against = ag;
  if (s.cam && typeof s.cam === 'object') out.cam = deriveClean({ cam: s.cam })?.cam || { ...CAM_DEFAULT };   // explicit auto: kept (overrides a shot's)
  const fu = fuseClean(s.fuse);
  if (fu) out.fuse = fu;
  return out.source || out.against || out.cam || out.fuse ? out : null;
}
/** A stored scene fact `signal` -> {spans} sorted, or undefined (nothing). */
export function signalClean(sig) {
  const spans = (Array.isArray(sig?.spans) ? sig.spans : []).map(spanClean).filter(Boolean).sort((a, b) => a.t0 - b.t0);
  return spans.length ? { spans } : undefined;
}
/** Shot index runs per scene ([lo, hi]): joined shots are one scene (timeline/shots.js sceneRuns, inlined: no cycle). */
function runsOf(list = []) {
  const out = [];
  list.forEach((s, i) => { if (i && s?.join === true) out[out.length - 1][1] = i; else out.push([i, i]); });
  return out;
}
/** Every range override of the document's shots, clipped to its scene: [{t0, t1, source?, against?, cam?}] by t0. */
export function signalSpans(list = []) {
  const out = [];
  for (const [lo, hi] of runsOf(list)) {
    const a = list[lo].start_ms, b = list[hi].end_ms;
    for (const s of signalClean(list[lo].signal)?.spans || []) { const t0 = Math.max(a, s.t0), t1 = Math.min(b, s.t1); if (t1 > t0) out.push({ ...s, t0, t1 }); }
  }
  return out.sort((x, y) => x.t0 - y.t0);
}
/** The override governing t ('' none): the last span over t. */
export const spanAt = (spans, t) => spans.findLast((s) => t >= s.t0 && t < s.t1) || null;
/** spans with [t0, t1) taken out (trimmed / split). */
const cut = (spans, t0, t1) => spans.flatMap((s) => (s.t1 <= t0 || s.t0 >= t1 ? [s] : [...(s.t0 < t0 ? [{ ...s, t1: t0 }] : []), ...(s.t1 > t1 ? [{ ...s, t0: t1 }] : [])]));
/**
 * The document's shots with the range override over [t0, t1) set to `value` ({source?, against?, cam?}; null = the
 * overrides there removed). `from` = an existing span being moved / resized (it goes first). Every scene the range
 * touches gets its part. -> a new list, or the same list when nothing changes.
 */
export function setSignalSpan(list, { t0, t1 }, value, from = null) {
  let out = list;
  for (const [lo, hi] of runsOf(list)) {
    const a = list[lo].start_ms, b = list[hi].end_ms, cur = signalClean(list[lo].signal);
    const hitNew = t1 > a && t0 < b, hitOld = from && from.t1 > a && from.t0 < b;
    if (!hitNew && !hitOld) continue;
    let spans = cur?.spans || [];
    if (hitOld) spans = spans.filter((s) => !(s.t0 === from.t0 && s.t1 === from.t1) && !(Math.max(a, s.t0) === Math.max(a, from.t0) && Math.min(b, s.t1) === Math.min(b, from.t1)));
    if (hitNew) {
      const x = Math.max(a, Math.round(t0)), y = Math.min(b, Math.round(t1));
      spans = cut(spans, x, y);
      const s = value && spanClean({ ...value, t0: x, t1: y });
      if (s) spans = [...spans, s];
    }
    const next = signalClean({ spans });
    if (JSON.stringify(next) === JSON.stringify(cur)) continue;
    if (out === list) out = list.slice();
    for (let k = lo; k <= hi; k++) { const { signal: _, ...rest } = out[k]; out[k] = next ? { ...rest, signal: next } : rest; }   // eslint-disable-line no-unused-vars
  }
  return out;
}

// ---- resolving a source ----
const groupKey = (c) => { const s = /^(sem_[a-z0-9_]+?)_(proj|rel)$/.exec(c || '') || /^(g[1-4](p[12])?)_(proj|rel)$/.exec(c || ''); return s ? s[1] : ''; };
/** Can run build channel `name` (fused needs two parts with centres; a pair both centres)? canFuse is passed in (no
 *  import of fusion.js here: fusion imports nothing back, but runs-channel wires both). */
export function canSource(run, name, canFuse = () => false) {
  if (!name || !run) return false;
  if (name === 'primary') return true;
  if (name === 'fused') return canFuse(run);
  if (name === 'shaft') return shaftNames(run).length > 0;   // paw-4c48.10: per run scene, runs-channel.js decides (lib/shaft-source.js)
  if (partOf(name)) return partNames(run).includes(partOf(name));   // paw-4c48.19: a depth part, the same way
  const p = pairOf(name);
  if (p) return !!(run.channels?.[p.a + '_x'] && run.channels?.[p.b + '_x']);
  return !!run.channels?.[name];
}
/** The channel to build for source `name` measured against `against`: a single part against another part = the pair
 *  rel:part:against; anything else unchanged (fused: fusionInput moves its centres; a pair names its own other part;
 *  a channel with no centre cannot be measured against a part). */
export function resolveSource(run, name, against) {
  if (!against || !AGAINST_KEY.test(against) || !run?.channels?.[against + '_x']) return name;
  const k = groupKey(name);
  return k && k !== against && run.channels[k + '_x'] && run.channels[k + '_y'] ? `rel:${k}:${against}` : name;
}

/**
 * The run with its pinned groups' centres (sem_*_x / _y: what fusion.js reads) handled per run scene as its derive
 * says: a camera override (or against 'none') re-handles the camera like rederive.js deriveChannels does for the
 * projected channels; against a part = every other part's centre minus that part's (that part itself absent there).
 * Scenes with neither keep the stored centres; nothing to do anywhere: the same run object.
 */
export function fusionInput(run, derives = [], aspect = 16 / 9) {
  const ch = run?.channels || {}, keys = Object.keys(ch).filter((k) => /^sem_[a-z0-9_]+_x$/.test(k) && ch[k.slice(0, -2) + '_y']).map((k) => k.slice(0, -2));
  if (keys.length < 2) return run;
  const dOf = (k) => withAgainst(derives[k] ?? (k < 0 ? derives[0] : null) ?? null);
  const camOk = !deriveBlock(run), T = ch[keys[0] + '_x'].t, scenes = run.scenes || [], per = new Map();
  for (let j = 0; j < T.length; j++) { const k = sceneAt(scenes, T[j]); if (!per.has(k)) per.set(k, []); per.get(k).push(j); }
  const out = {};
  const val = (c, j) => (c && c.t[j] === T[j] ? c.v[j] : NaN);   // channels share the frame times (one entry per frame)
  for (const [k, idx] of per) {
    const d = dOf(k), cam = camOk && d?.cam ? d.cam : null, P = d?.against && AGAINST_KEY.test(d.against) && keys.includes(d.against) ? d.against : '';
    if (!cam && !P) continue;
    const path = cam ? cameraPath(run, idx, cam, aspect) : null;
    const pos = (key) => idx.map((j, q) => {
      const x = val(ch[key + '_x'], j), y = val(ch[key + '_y'], j);
      if (x == null || y == null || !fin(x) || !fin(y)) return [NaN, NaN];
      if (!cam) return [x, y];
      const [px, py] = unwarp(path, q, x * aspect + val(ch.cam_x, j) * aspect, y + val(ch.cam_y, j), aspect);
      return [px / aspect, py];
    });
    const ref = P ? pos(P) : null;
    for (const key of keys) {
      const p = key === P ? null : pos(key);
      for (const ax of ['_x', '_y']) {
        const name = key + ax, c = ch[name];
        if (!out[name]) out[name] = Float32Array.from(T, (_, j) => val(c, j));
        idx.forEach((j, q) => {
          const v = p ? p[q][ax === '_x' ? 0 : 1] : NaN;
          out[name][j] = ref ? v - ref[q][ax === '_x' ? 0 : 1] + 0.5 : v;
        });
      }
    }
  }
  if (!Object.keys(out).length) return run;
  const channels = { ...ch };
  for (const [name, v] of Object.entries(out)) channels[name] = { t: T, v };
  return { ...run, channels };
}

// ---- splicing a range override into the base signal ----
/** Channel c at time t (linear between samples; NaN outside / across a NaN). */
function at(c, t) {
  const n = c.t.length, j = lowerBound(c.t, t);
  if (j < n && c.t[j] === t) return c.v[j];
  if (j <= 0 || j >= n) return NaN;
  const a = c.v[j - 1], b = c.v[j];
  return a === a && b === b ? a + ((b - a) * (t - c.t[j - 1])) / (c.t[j] - c.t[j - 1] || 1) : NaN;
}
const smooth = (x) => x * x * (3 - 2 * x);
/**
 * base (a channel {t, v, conf?, timing?}) with each override spliced in over its span: [{t0, t1, ch}] (ch = the
 * override's channel, any time grid). Inside [lo, hi) (the run scene) each override is mapped onto the base's range
 * there (min..max), its sign aligned with the base's (their correlation over the scene), and cross-faded in / out over
 * blendMs at its ends (smoothstep; at most half the span). Outside every span: the base, sample for sample.
 * -> {t, v, min, max, scaled, conf?, timing?} on the base's grid.
 */
export function splice(base, overrides, { lo = -Infinity, hi = Infinity, blendMs = BLEND_MS } = {}) {
  const t = base.t, n = t.length, v = Float32Array.from(base.v), conf = base.conf ? Float32Array.from(base.conf) : null, timing = base.timing ? Float32Array.from(base.timing) : null;
  let bLo = Infinity, bHi = -Infinity;
  for (let j = 0; j < n; j++) if (t[j] >= lo && t[j] < hi && base.v[j] === base.v[j]) { bLo = Math.min(bLo, base.v[j]); bHi = Math.max(bHi, base.v[j]); }
  for (const o of overrides) {
    if (!o?.ch?.t?.length) continue;
    const s0 = Math.max(lo, o.t0), s1 = Math.min(hi, o.t1);
    if (!(s1 > s0)) continue;
    const alt = new Float64Array(n).fill(NaN);
    let aLo = Infinity, aHi = -Infinity, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0, m = 0;
    for (let j = 0; j < n; j++) {
      if (t[j] < lo || t[j] >= hi) continue;
      const y = at(o.ch, t[j]);
      alt[j] = y;
      if (y !== y) continue;
      aLo = Math.min(aLo, y); aHi = Math.max(aHi, y);
      const x = base.v[j];
      if (x === x) { m++; sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; }
    }
    if (!(aHi >= aLo)) continue;
    const r = m > 2 ? (sxy - (sx * sy) / m) / Math.sqrt(Math.max(1e-24, (sxx - (sx * sx) / m) * (syy - (sy * sy) / m))) : 1;
    const flip = r < 0, L = bHi >= bLo ? bLo : aLo, H = bHi >= bLo ? bHi : aHi, span = aHi - aLo;
    const map = (y) => { const u = span > 1e-12 ? (y - aLo) / span : 0.5; return L + (flip ? 1 - u : u) * (H - L); };
    const B = Math.max(1, Math.min(blendMs, (s1 - s0) / 2));
    for (let j = 0; j < n; j++) {
      if (t[j] < s0 || t[j] >= s1 || alt[j] !== alt[j]) continue;
      const ow = o.ch.w ? at({ t: o.ch.t, v: o.ch.w }, t[j]) : 1;   // paw-ef73.26: a measure's own weight (its confidence): weak = the base
      const w = smooth(Math.min(1, (t[j] - s0) / B, (s1 - t[j]) / B)) * (ow === ow ? smooth(Math.min(1, Math.max(0, ow))) : 0), y = map(alt[j]), x = v[j];
      v[j] = x === x ? x + w * (y - x) : y;
      if (conf) conf[j] = w >= 0.5 ? (o.ch.conf ? at({ t: o.ch.t, v: o.ch.conf }, t[j]) : 1) : conf[j];
      if (timing) timing[j] = v[j];   // fusion's timing series belongs to the base: inside a span the spliced signal times itself
    }
  }
  let min = Infinity, max = -Infinity;
  for (const y of v) if (y === y) { min = Math.min(min, y); max = Math.max(max, y); }
  if (min > max) min = max = 0;
  return { t, v, min, max, scaled: Float32Array.from(v, (y) => (y - min) / (max - min || 1)), ...(conf ? { conf } : {}), ...(timing ? { timing } : {}) };
}
