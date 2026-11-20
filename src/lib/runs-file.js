// runs-file.js -- the .pawruns container: every tracker run of a project, saved beside its .pawproj (same stem). Pure.
//
// Layout (little-endian):
//   8 bytes  "PAWRUNS1"
//   u32      manifest length (bytes)
//   ...      manifest: UTF-8 JSON {format: 'pawruns', version: 1, runs: [run]}
//   ...      blob: one section per run with frames, at manifest run.frames.off (from the blob start), run.frames.len bytes
// A manifest run is the run record (lib/runs.js makeRun shape) with its typed arrays as pairs: samples / confidence
// [[t, v|null]], channels {name: {pairs, min, max}}, points / points0 / points0Primary [[at, pos]] ('=' = the same object
// as points / points0); every other key (scenes, flips, orient, events, notes, params, roi, cameraMotion, lowMotion,
// sceneChannels, color, visible, tag, restored, ...) is copied as JSON. `lane` is derived (runs-channel.js channelPatch) and
// not stored. Signal values keep 7 significant digits.
// A frames section, per frame: u32 t_ms, f32 value (NaN = null), u16 n, then n x (i16 x*10000, i16 y*10000, i8 v, i8 label
// (-128 = none)) = the overlay's `pts`. n = 0xFFFF: no overlay (null); 0xFFFE: an overlay without `pts`. The overlay's other
// keys go in the manifest (run.frames.ovx = [[frameIndex, keys]]), except: `masks` are dropped (sam2: up to 3 x 64 vertices a
// frame; the box stays; run.masksOmitted counts the frames; a modifier's own run, run.mod, keeps them), and a grid frame's `points` / `boxes` are not stored when they
// are what the sidecar derives from `pts` (cotracker_points / tapnext_points: visible points, occluded ones as 0.012 boxes).
// A run whose points carry a part (pts[4], v3.4) or pinned group id (pts[5], v4.6) gets a second section after its
// frames, at run.frames.ext = {off, len}: per point of every frame with `pts`, in the same order, i8 part, i8 pinned id
// (0 = none). Readers that predate it ignore the key and load the points without the ids, as before (paw-u4q).
//
// Version 2 (paw-ee14, copy-on-write; docs/formats/pawruns.md): the same 12-byte head with the manifest
// {"format":"pawruns","version":2} (a version-1 reader refuses it), then an append-only log of content-addressed blocks
// and commits. A block is written once and never changed: a run's frame section, its ext section, or its record (the
// version-1 manifest entry as UTF-8 JSON with frames = {sec, n, ovx?, ext?}: block hashes, not offsets). A commit is a
// small JSON manifest {v: 2, blocks: {hash: [off, len, deps?]}, runs: [record hash, ...]} followed by a 16-byte trailer
// "PAWRTAIL" u32 manifest length u32 CRC-32 of the manifest. The newest commit whose trailer and CRC check out is the
// file; anything after it (a write cut short) is ignored. hash = the first 16 bytes of the block's SHA-256, hex.

import { series, channelOf, orderFrames } from './runs.js';

const MAGIC = 'PAWRUNS1', VERSION = 1, HEAD = 12, SLICE = 64, V2 = 2;
const NULL_OV = 0xffff, NO_PTS = 0xfffe, NO_LABEL = -128, XY = 10000, D = 0.006;
const QNAN = (() => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, NaN, true); return d.getUint32(0, true); })();   // what packFrames writes for null
const TYPED = new Set(['samples', 'channels', 'confidence', 'points', 'points0', 'points0Primary', 'frames', 'lane']);

const sig = (x) => (typeof x === 'number' && Number.isFinite(x) ? +x.toPrecision(7) : null);
const pairs = (t, v) => Array.from(t, (x, i) => [x, sig(v[i])]);
const ptPairs = (p) => Array.from(p.at, (x, i) => [x, p.pos[i]]);
const pts = (a) => ({ at: Float64Array.from(a, (x) => x[0]), pos: Float64Array.from(a, (x) => x[1]) });
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const i16 = (x) => Math.max(-32768, Math.min(32767, Math.round(x * XY)));
const i8 = (x) => Math.max(-127, Math.min(127, Math.round(+x || 0)));

/** A broken / foreign file: decodeRuns throws this (code 'corrupt'). */
export class RunsFileError extends Error {
  constructor(msg) { super('not a usable .pawruns file: ' + msg); this.code = 'corrupt'; }
}
const bad = (m) => { throw new RunsFileError(m); };

/** <stem>.pawruns beside a .pawproj path. */
export const runsPath = (projectPath) => projectPath.replace(/\.[^.\\/]+$/, '') + '.pawruns';

/** The sidecar's points / boxes of a grid overlay (cotracker_points.py) == what ov carries? */
function derivable(ov, p) {
  const vis = p.filter((q) => q[2]), occ = p.filter((q) => !q[2]);
  return Array.isArray(ov.points) && Array.isArray(ov.boxes) && ov.points.length === vis.length && ov.boxes.length === occ.length
    && ov.points.every((q, j) => q.length === 2 && q[0] === vis[j][0] && q[1] === vis[j][1])
    && ov.boxes.every((b, j) => b.length === 4 && b[0] === r4(occ[j][0] - D) && b[1] === r4(occ[j][1] - D) && b[2] === 2 * D && b[3] === 2 * D);
}
const derive = (p) => ({
  points: p.filter((q) => q[2]).map((q) => [q[0], q[1]]),
  boxes: p.filter((q) => !q[2]).map((q) => [r4(q[0] - D), r4(q[1] - D), 2 * D, 2 * D]),
});

/** A frame's overlay -> {p: its binary points | null, rest: its keys for the manifest | null (none worth keeping), masked}. */
function ovSplit(ov, keepMasks) {
  const p = Array.isArray(ov.pts) && ov.pts.length < NO_PTS ? ov.pts : null;
  const { pts: _, masks, ...rest } = ov;
  let masked = false;
  if (masks && keepMasks) rest.masks = masks;   // paw-ef73.26: a modifier's own SAM run keeps its outlines (seen and corrected per frame)
  else if (masks) masked = true;
  if (!p && ov.pts) rest.pts = ov.pts;   // more than 65533 points: kept as JSON
  const skip = p ? derivable(rest, p) && Object.keys(rest).length === 2 : !Object.keys(rest).length;
  return { p, rest: skip ? null : rest, masked };
}

/** frames {t, v, ov} -> {bytes, ovx, masksOmitted, ext}. A generator: it yields every SLICE frames (encodeRunsAsync). */
function* packFrames(fr, keepMasks = false) {
  const n = fr.t.length, ovx = [], ptsOf = new Array(n);
  let size = 0, masksOmitted = 0;
  for (let i = 0; i < n; i++) {
    if (i % SLICE === SLICE - 1) yield;
    size += 10;
    if (!fr.ov[i]) continue;
    const { p, rest, masked } = ovSplit(fr.ov[i], keepMasks);
    if (masked) masksOmitted++;
    if (p) { ptsOf[i] = p; size += 6 * p.length; }
    if (rest) ovx.push([i, rest]);
  }
  const bytes = new Uint8Array(size), dv = new DataView(bytes.buffer);
  let o = 0;
  for (let i = 0; i < n; i++) {
    if (i % SLICE === SLICE - 1) yield;
    dv.setUint32(o, Math.max(0, Math.min(0xffffffff, Math.round(fr.t[i]) || 0)), true);
    dv.setFloat32(o + 4, typeof fr.v[i] === 'number' ? fr.v[i] : NaN, true);
    const p = ptsOf[i];
    dv.setUint16(o + 8, !fr.ov[i] ? NULL_OV : p ? p.length : NO_PTS, true);
    o += 10;
    if (p) for (const q of p) {
      dv.setInt16(o, i16(q[0]), true); dv.setInt16(o + 2, i16(q[1]), true);
      dv.setInt8(o + 4, i8(q[2])); dv.setInt8(o + 5, q.length > 3 && q[3] != null ? i8(q[3]) : NO_LABEL);
      o += 6;
    }
  }
  // the part / pinned group ids, only when some point has one
  let ext = null;
  if (ptsOf.some((p) => p && p.some((q) => q.length > 4))) {
    const x = new Int8Array(ptsOf.reduce((s, p) => s + (p ? 2 * p.length : 0), 0));
    let k = 0;
    for (const p of ptsOf) if (p) for (const q of p) { x[k++] = i8(q[4]); x[k++] = i8(q[5]); }
    ext = new Uint8Array(x.buffer);
  }
  return { bytes, ovx, masksOmitted, ext };
}

// paw-o60v.3: a save re-encodes only what changed. A run's frames never change after it lands (a change makes a new frames
// object: runs-add, a re-track) and a run record is replaced, never edited, on every change (the tracking store's runs are
// $state.raw). So the packed frame section is kept per frames object (SEC; decodeRuns fills it from the file's own bytes
// where re-encoding them gives the same bytes) and the run's manifest JSON per run object (MAN). The output is
// byte-identical to an encode from scratch (test/runs-file.test.mjs). A step toward runs stored once (paw-up1r).
const SEC = new WeakMap(), MAN = new WeakMap();
const FR = '\u0001pawruns-frames\u0001', FRJ = JSON.stringify(FR);
const secOk = (c, fr, keepMasks) => c && c.keepMasks === keepMasks && c.t === fr.t && c.v === fr.v && c.ov === fr.ov;
function* section(fr, keepMasks) {
  const c = SEC.get(fr);
  if (secOk(c, fr, keepMasks)) return c;
  const p = yield* packFrames(fr, keepMasks);
  const e = { t: fr.t, v: fr.v, ov: fr.ov, keepMasks, bytes: p.bytes, ext: p.ext, masksOmitted: p.masksOmitted, ovxJson: p.ovx.length ? JSON.stringify(p.ovx) : '' };
  SEC.set(fr, e);
  return e;
}
/** One run's manifest entry as JSON, split around its frames record (whose offsets depend on the runs before it). */
function* piece(r) {
  const fr = r.frames?.t ? r.frames : null, c = MAN.get(r);
  if (c && c.fr === fr && (!fr || (SEC.get(fr) === c.sec && secOk(c.sec, fr, !!r.mod)))) return c;
  const sec = fr ? yield* section(fr, !!r.mod) : null;
  const m = {};
  for (const [k, v] of Object.entries(r)) if (!TYPED.has(k) && v !== undefined) m[k] = v;
  m.samples = r.samples ? pairs(r.samples.t, r.samples.v) : [];
  m.channels = Object.fromEntries(Object.entries(r.channels || {}).map(([k, c]) => [k, { pairs: pairs(c.t, c.v), min: sig(c.min), max: sig(c.max) }]));
  m.confidence = r.confidence ? pairs(r.confidence.t, r.confidence.v) : null;
  m.points = ptPairs(r.points);
  m.points0 = !r.points0 || r.points0 === r.points ? '=' : ptPairs(r.points0);
  if (r.points0Primary) m.points0Primary = r.points0Primary === (r.points0 || r.points) ? '=' : ptPairs(r.points0Primary);
  m.frames = sec ? FR : null;
  if (sec?.masksOmitted) m.masksOmitted = sec.masksOmitted;
  const json = JSON.stringify(m), at = sec ? json.lastIndexOf(FRJ) : -1;   // the last one: only masksOmitted comes after frames
  const e = { fr, sec, pre: at < 0 ? json : json.slice(0, at), post: at < 0 ? '' : json.slice(at + FRJ.length) };
  MAN.set(r, e);
  return e;
}
/** -> {json, secs}: the manifest text and the blob's sections in order (a file's identity: encodeRunsAsync prev). */
function* plan(runs) {
  const list = [], secs = [];
  let off = 0;
  for (const r of runs) {
    const p = yield* piece(r), s = p.sec;
    if (!s) { list.push(p.pre); continue; }
    let f = `{"off":${off},"len":${s.bytes.length},"n":${s.t.length}${s.ovxJson ? ',"ovx":' + s.ovxJson : ''}`;
    secs.push(s.bytes); off += s.bytes.length;
    if (s.ext) { f += `,"ext":{"off":${off},"len":${s.ext.length}}`; secs.push(s.ext); off += s.ext.length; }
    list.push(p.pre + f + '}' + p.post);
    yield;
  }
  return { json: `{"format":"pawruns","version":${VERSION},"runs":[${list.join(',')}]}`, secs };
}
const COPY = 1 << 23;   // bytes copied per slice
function* assemble({ json, secs }) {
  const j = new TextEncoder().encode(json);
  const out = new Uint8Array(HEAD + j.length + secs.reduce((s, b) => s + b.length, 0)), dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) out[i] = MAGIC.charCodeAt(i);
  dv.setUint32(8, j.length, true);
  out.set(j, HEAD);
  let o = HEAD + j.length;
  for (const s of secs) for (let a = 0; a < s.length; a += COPY) { const b = s.subarray(a, a + COPY); out.set(b, o); o += b.length; yield; }
  return out;
}
const finish = (g) => { for (;;) { const x = g.next(); if (x.done) return x.value; } };
// a MessageChannel message, not setTimeout: never clamped or throttled in a busy / hidden window
const macrotask = () => new Promise((res) => {
  if (typeof MessageChannel === 'undefined') return setTimeout(res, 0);
  const c = new MessageChannel();
  c.port1.onmessage = () => { c.port1.close(); res(); };
  c.port2.postMessage(0);
});

// paw-o60v.4 / paw-v9qp: a frame's points stay in the file's bytes until something reads them (decoded, they were ~1.8 GB of
// heap at the owner's runs size). The overlay of a frame with points gets own enumerable accessors (`pts`, and `points` /
// `boxes` where they are derived) that decode that frame on its first read; a spread, JSON or deepEqual sees plain arrays,
// and assigning one makes it a plain property. Decoded frames are held first in, first out up to HOLD points: an older one
// is dropped and decoded again when read again (the same numbers in a new array; frames never change after a run lands).
// ponytail: FIFO, not LRU: a pass cycling over more than HOLD points (~2000 frames of 1024) decodes again; LRU if that shows.
const LZ = Symbol('pawruns frame');
const held = [];
let HOLD = 3e6, heldN = 0, heldAt = 0;
/** Tests: hold at most n decoded points (-> the old limit). */
export const holdPoints = (n) => { const was = HOLD; HOLD = n; return was; };
function keep(s, cost) {
  if (!s.cost) held.push(s);
  s.cost += cost; heldN += cost;
  while (heldN > HOLD && held.length - heldAt > 1) { const o = held[heldAt++]; heldN -= o.cost; o.cost = 0; o.p = o.d = null; }
  if (heldAt > 4096) { held.splice(0, heldAt); heldAt = 0; }
}
function ptsOf(s) {
  if (s.p) return s.p;
  const { dv, o, n, x } = s, p = new Array(n);
  for (let j = 0, k = o; j < n; j++, k += 6) {
    const X = dv.getInt16(k, true) / XY, Y = dv.getInt16(k + 2, true) / XY, v = dv.getInt8(k + 4), g = dv.getInt8(k + 5);
    p[j] = g === NO_LABEL ? [X, Y, v] : [X, Y, v, g];
  }
  if (x >= 0) for (let j = 0, k = x, xv = s.xdv || dv; j < n; j++, k += 2) {   // the part / pinned group ids
    const part = xv.getInt8(k), sem = xv.getInt8(k + 1), q = p[j];
    if (!part && !sem) continue;
    if (q.length < 4) q.push(-1);
    q.push(part);
    if (sem) q.push(sem);
  }
  s.p = p;
  keep(s, n);
  return p;
}
function derivedOf(s) {
  if (s.d) return s.d;
  const d = derive(ptsOf(s));
  s.d = d;
  keep(s, s.n);
  return d;
}
const acc = (key, get) => ({
  enumerable: true, configurable: true,
  get() { return get(this[LZ]); },
  set(v) { Object.defineProperty(this, key, { value: v, writable: true, enumerable: true, configurable: true }); },
});
const PTS = acc('pts', ptsOf), POINTS = acc('points', (s) => derivedOf(s).points), BOXES = acc('boxes', (s) => derivedOf(s).boxes);
/** Are these frames' points still in the file's bytes (decoded on read, held in the shared FIFO)? */
export const lazyFrames = (fr) => !!fr?.ov?.some((o) => o && LZ in o);
/** A frame's overlay: its manifest keys (rest) + lazy pts, or (none kept) lazy points, boxes, pts: the eager key order. */
function lazyOv(rest, s) {
  const ov = rest ? { ...rest } : {};
  Object.defineProperty(ov, LZ, { value: s });
  if (!rest) { Object.defineProperty(ov, 'points', POINTS); Object.defineProperty(ov, 'boxes', BOXES); }
  return Object.defineProperty(ov, 'pts', PTS);
}

function unpackFrames(dv, off, len, count, ovx, ext, xdv = dv) {   // xdv: where ext is (lightenFrames: its own array)
  const fr = { t: new Array(count), v: new Array(count), ov: new Array(count) }, rest = new Map(ovx || []), lazy = [];
  let o = off, canon = true, np = 0;
  const end = off + len, need = (k) => { if (o + k > end) bad('frame data truncated'); };
  for (let i = 0; i < count; i++) {
    need(10);
    fr.t[i] = dv.getUint32(o, true); fr.v[i] = dv.getFloat32(o + 4, true);
    if (fr.v[i] !== fr.v[i] && dv.getUint32(o + 4, true) !== QNAN) canon = false;
    const n = dv.getUint16(o + 8, true);
    o += 10;
    if (n === NULL_OV) { fr.ov[i] = null; continue; }
    if (n === NO_PTS) { fr.ov[i] = { ...(rest.get(i) || {}) }; continue; }
    need(6 * n);
    for (let j = 0; j < n; j++) if (dv.getInt8(o + 6 * j + 4) === -128) { canon = false; break; }
    const s = { dv, o, n, x: ext ? ext.off + 2 * np : -1, xdv: xdv === dv ? null : xdv, p: null, d: null, cost: 0 };
    fr.ov[i] = lazyOv(rest.get(i), s);
    lazy.push(s);
    np += n; o += 6 * n;
  }
  if (o !== end) bad('frame data has trailing bytes');
  if (ext) {
    if (2 * np > ext.len) bad('part / pinned id section truncated');
    if (2 * np !== ext.len) bad('part / pinned id section has trailing bytes');
    let any = false;
    for (const s of lazy) for (let j = 0, k = s.x; j < s.n; j++, k += 2) {
      const part = xdv.getInt8(k), sem = xdv.getInt8(k + 1);
      if (part === -128 || sem === -128) canon = false;
      if (!part && !sem) continue;
      any = true;
      if (dv.getInt8(s.o + 6 * j + 5) === NO_LABEL) canon = false;   // decoded with a label -1 it re-encodes as -1
    }
    if (!any) canon = false;
  }
  // canon: re-encoding these frames gives these very bytes (decodeRuns keeps them: SEC)
  return { fr, canon };
}

/** A decoded run's frames whose bytes re-encode to themselves (canon): the file's bytes become the cached section, after
 *  checking that the manifest keys (ovx) re-encode the same too. The sections keep the file's buffer alive while used. */
function seed(fr, keepMasks, ovx, bytes, ext) {
  const again = [];
  let masksOmitted = 0;
  for (const i of [...new Map(ovx || []).keys()].sort((a, b) => a - b)) {
    if (!fr.ov[i]) return;
    const s = ovSplit(fr.ov[i], keepMasks);
    if (s.masked) masksOmitted++;
    if (s.rest) again.push([i, s.rest]);
  }
  const ovxJson = again.length ? JSON.stringify(again) : '';
  if (ovxJson !== (ovx?.length ? JSON.stringify(ovx) : '')) return null;
  const e = { t: fr.t, v: fr.v, ov: fr.ov, keepMasks, bytes, ext, masksOmitted, ovxJson };
  SEC.set(fr, e);
  return e;
}

/** A manifest / record entry -> the run (makeRun's shape); sec: its frame section {off, len, n, ovx, ext: {off, len} |
 *  null} at absolute offsets of u8, already checked to lie inside it. -> {r, c: the seeded section entry | null} */
function runOf(m, label, u8, dv, sec) {
  if (!m || typeof m.id !== 'string' || !Array.isArray(m.points) || !m.range) bad(`${label} is incomplete`);
  const { samples, channels, confidence, points, points0, points0Primary, frames: _, ...rest } = m;
  // the file's key order (re-encoded unchanged, the manifest is the file's: runsFileKey), the defaults after
  const r = { ...rest };
  for (const [key, v] of Object.entries({ scenes: [], flips: [], events: [], notes: [], channel: 'primary', visible: true, ref: false })) if (!(key in r)) r[key] = v;
  r.samples = series(samples || []);
  r.channels = Object.fromEntries(Object.entries(channels || {}).map(([name, c]) => [name, channelOf(c?.pairs || [])]));
  r.confidence = confidence?.length ? series(confidence) : null;
  r.points = pts(points);
  r.points0 = points0 === '=' || !points0 ? r.points : pts(points0);
  if (points0Primary) r.points0Primary = points0Primary === '=' ? r.points0 : pts(points0Primary);
  r.frames = null;
  if (!sec) return { r, c: null };
  const x = sec.ext, u = unpackFrames(dv, sec.off, sec.len, sec.n, sec.ovx, x), t0 = u.fr.t;
  r.frames = orderFrames(u.fr);
  const c = (u.canon && r.frames.t === t0 && seed(r.frames, !!r.mod, sec.ovx, u8.subarray(sec.off, sec.off + sec.len), x ? u8.subarray(x.off, x.off + x.len) : null)) || null;
  if (c) Object.assign(c, { of: u8, at: sec.off, extAt: x ? x.off : -1 });   // where the bytes are in the file read (runs-cow.js copies them)
  return { r, c };
}

/** runs (makeRun records) -> the .pawruns bytes. */
export function encodeRuns(runs) { return finish(assemble(finish(plan(runs)))); }

/** Runs generator g to its value in slices of about `budget` ms of main thread (a macrotask between them). */
export const drive = async (g, budget = 8) => {
  let t = performance.now();
  for (;;) {
    const x = g.next();
    if (x.done) return x.value;
    if (performance.now() - t >= budget) { await macrotask(); t = performance.now(); }
  }
};

/** encodeRuns in slices of about `budget` ms of main thread (a macrotask between them) -> {bytes, key}. prev: the key of
 *  the file known to be on disk; when these runs encode to that same file, bytes is null (nothing to write). */
export async function encodeRunsAsync(runs, prev = null, { budget = 8 } = {}) {
  const key = await drive(plan(runs), budget);
  if (prev && prev.json === key.json && prev.secs.length === key.secs.length && prev.secs.every((s, i) => s === key.secs[i])) return { bytes: null, key };
  return { bytes: await drive(assemble(key), budget), key };
}

const utf8 = (b) => new TextDecoder('utf-8', { fatal: true }).decode(b);
const okRange = (o, l, lo, hi) => Number.isInteger(o) && Number.isInteger(l) && o >= lo && l >= 0 && o + l <= hi;

/** The .pawruns bytes (Uint8Array | ArrayBuffer) -> runs (makeRun's shape, frames restored). Throws RunsFileError.
 *  Version 2: a run whose record is unreadable is left out (runsFileState(runs).damaged), never the whole file. */
export const decodeRuns = (bytes) => finish(decodeSteps(bytes));
/** decodeRuns a run per slice of about `budget` ms (a macrotask between them: a 24-run file never holds the main thread
 *  for long, paw-o60v.5); the same runs. */
export const decodeRunsAsync = (bytes, { budget = 8 } = {}) => drive(decodeSteps(bytes), budget);
function* decodeSteps(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bad('not bytes');
  if (u8.length < HEAD || String.fromCharCode(...u8.subarray(0, 8)) !== MAGIC) bad('no PAWRUNS1 header');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = dv.getUint32(8, true), blob = HEAD + n;
  if (blob > u8.length) bad('manifest truncated');
  let man, json;
  try { man = JSON.parse((json = utf8(u8.subarray(HEAD, blob)))); } catch (e) { bad('manifest is not JSON (' + e.message + ')'); }
  if (man?.format !== 'pawruns') bad('no runs manifest');
  if (man.version > V2) bad(`version ${man.version} is newer than this app reads (${V2}): update Pawscript`);
  if (man.version === V2) return yield* decodeV2(u8, dv, blob);
  if (!Array.isArray(man.runs)) bad('no runs manifest');
  const secs = [], runs = [];
  let whole = true;   // every frame section kept as the file's own bytes: the file is this key (runsFileKey)
  for (const [k, m] of man.runs.entries()) {
    if (k) yield;
    const f = m?.frames, x = f?.ext;
    let sec = null;
    if (f) {
      if (!okRange(f.off, f.len, 0, u8.length - blob) || !Number.isInteger(f.n) || f.n < 0) bad(`run ${m.id}: frame section out of range`);
      if (x && !okRange(x.off, x.len, 0, u8.length - blob)) bad(`run ${m.id}: part / pinned id section out of range`);
      sec = { off: blob + f.off, len: f.len, n: f.n, ovx: f.ovx, ext: x ? { off: blob + x.off, len: x.len } : null };
    }
    const { r, c } = runOf(m, `run ${k}`, u8, dv, sec);
    if (c) secs.push(c.bytes, ...(c.ext ? [c.ext] : []));
    else if (f) whole = false;
    runs.push(r);
  }
  if (whole) FILE.set(runs, { json, secs });
  COW.set(runs, { v: 1, buf: u8, size: u8.length, tail: tailOf(u8), blocks: new Map(), runs: null, damaged: [], torn: false });
  return runs;
}

// paw-v9qp: what decodeRuns read, as encodeRunsAsync's key, so the first write after an open is skipped when the runs encode
// to the file as it is (it rewrote the whole 126 MB file once a session before).
const FILE = new WeakMap();
/** The key (encodeRunsAsync prev) of the file a decodeRuns result came from; null when re-encoding it would not give its bytes. */
export const runsFileKey = (runs) => FILE.get(runs) || null;

// ---------------------------------------------------------------- version 2: copy-on-write (paw-ee14)

const TAIL = 'PAWRTAIL', TL = 16, TAIL0 = TAIL.charCodeAt(0);
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
/** CRC-32 (IEEE, as zip) of bytes. */
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** A block's name: the first 16 bytes of its SHA-256, hex. */
export async function blockHash(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let s = '';
  for (let i = 0; i < 16; i++) s += (d[i] < 16 ? '0' : '') + d[i].toString(16);
  return s;
}
const tailOf = (u8) => u8.subarray(Math.max(0, u8.length - TL)).slice();
const isTail = (u8, p) => { for (let i = 0; i < 8; i++) if (u8[p + i] !== TAIL.charCodeAt(i)) return false; return true; };

/** The 12-byte head + {"format":"pawruns","version":2}: a version-2 file starts with it. */
export function headV2() {
  const j = new TextEncoder().encode(`{"format":"pawruns","version":${V2}}`), out = new Uint8Array(HEAD + j.length);
  for (let i = 0; i < 8; i++) out[i] = MAGIC.charCodeAt(i);
  new DataView(out.buffer).setUint32(8, j.length, true);
  out.set(j, HEAD);
  return out;
}
/** A commit: the manifest {v, blocks: Map hash -> [off, len, deps?], runs: [record hash]} as JSON + its trailer. */
export function encodeCommit(blocks, runs) {
  const obj = {};
  for (const [h, b] of blocks) obj[h] = b;
  const j = new TextEncoder().encode(JSON.stringify({ v: V2, blocks: obj, runs })), out = new Uint8Array(j.length + TL), dv = new DataView(out.buffer);
  out.set(j);
  for (let i = 0; i < 8; i++) out[j.length + i] = TAIL.charCodeAt(i);
  dv.setUint32(j.length + 8, j.length, true);
  dv.setUint32(j.length + 12, crc32(j), true);
  return out;
}

/** The newest complete commit of a version-2 file: {at, len, end} | null. A trailer is complete when its manifest's CRC
 *  checks out; bytes after it (an append cut short) are ignored. */
export function lastCommit(u8, start) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let p = u8.length - TL; p >= start; p = u8.lastIndexOf(TAIL0, p - 1)) {
    if (p < 0) break;
    if (p + TL > u8.length || !isTail(u8, p)) continue;
    const len = dv.getUint32(p + 8, true), crc = dv.getUint32(p + 12, true);
    if (len <= p - start && crc32(u8.subarray(p - len, p)) === crc) return { at: p - len, len, end: p + TL };
  }
  return null;
}

// per decoded run: [hash, bytes] of its record and sections, checked by verifyRuns
const CHK = new WeakMap();
// per decodeRuns result: the file as the copy-on-write writer needs it (runsFileState)
const COW = new WeakMap();

/** A version-2 file's newest commit -> {c, blocks: Map, runs}. Throws RunsFileError. */
function commitOf(u8, start) {
  const c = lastCommit(u8, start);
  if (!c) bad('no complete version in the file');
  let man;
  try { man = JSON.parse(utf8(u8.subarray(c.at, c.at + c.len))); } catch (e) { bad('manifest is not JSON (' + e.message + ')'); }
  if (man?.v !== V2 || !man.blocks || typeof man.blocks !== 'object' || !Array.isArray(man.runs)) bad('no runs manifest');
  const blocks = new Map();
  for (const [h, b] of Object.entries(man.blocks)) if (Array.isArray(b) && okRange(b[0], b[1], start, c.at)) blocks.set(h, b);
  return { c, blocks, runs: man.runs.filter((h) => typeof h === 'string') };
}
/** A record's frame sections at absolute offsets ({off, len, n, ovx, ext} | null) + their [hash, bytes]. Throws. */
function secOf(f, blocks, u8, chk) {
  if (!f) return null;
  const s = blocks.get(f.sec), x = f.ext ? blocks.get(f.ext) : null;
  if (!s || (f.ext && !x) || !Number.isInteger(f.n) || f.n < 0) bad('its frame data is missing');
  chk?.push([f.sec, u8.subarray(s[0], s[0] + s[1])]);
  if (x) chk?.push([f.ext, u8.subarray(x[0], x[0] + x[1])]);
  return { off: s[0], len: s[1], n: f.n, ovx: f.ovx, ext: x ? { off: x[0], len: x[1] } : null };
}

function* decodeV2(u8, dv, start) {
  const { c, blocks, runs: hashes } = commitOf(u8, start), damaged = [], runs = [];
  for (const [k, h] of hashes.entries()) {
    if (k) yield;
    const b = blocks.get(h);
    let m = null;
    try {
      if (!b) bad('its record is missing');
      const rec = u8.subarray(b[0], b[0] + b[1]);
      m = JSON.parse(utf8(rec));
      const chk = [[h, rec]];
      let got;
      try { got = runOf(m, `run ${k}`, u8, dv, secOf(m?.frames, blocks, u8, chk)); }
      catch (e) {   // the record is fine, its frames are not: the run without them
        if (!m?.frames) throw e;
        got = runOf(m, `run ${k}`, u8, dv, null);
        chk.length = 1;
        damaged.push({ k, id: m.id, hash: h, frames: true, error: e.message || String(e) });
      }
      if (got.c) Object.assign(got.c, { hash: m.frames.sec, extHash: m.frames.ext || null });   // claimed here, checked by verifyRuns
      CHK.set(got.r, chk);
      runs.push(got.r);
    } catch (e) { damaged.push({ k, id: typeof m?.id === 'string' ? m.id : null, hash: h, error: e.message || String(e) }); }
  }
  COW.set(runs, { v: V2, buf: u8, size: u8.length, tail: tailOf(u8), blocks, runs: hashes, damaged, torn: c.end !== u8.length });
  return runs;
}

/** What a decodeRuns result knows of its file, for runs-cow.js: {v: 1 | 2, buf (the bytes read), size, tail (its last 16
 *  bytes), blocks (v2: hash -> [off, len, deps?] of the newest commit), runs (v2: record hashes), damaged (runs left out:
 *  [{k, hash, error}]), torn (v2: bytes after the newest commit)} | null. */
export const runsFileState = (runs) => COW.get(runs) || null;

/** Checks every block a version-2 decode used against its hash (async). -> Map(run id -> 'record' | 'frames') of the runs
 *  whose data does not match: a bad record is said, bad frames are dropped by the caller. Its `bad`: the Set of those
 *  blocks' hashes (paw-acfc: runs-cow.js withoutBad). In slices of about `budget` ms (paw-o60v.5: the webview hashes on
 *  its main thread, ~100 ms for a 100 MB file, in one task when not sliced). */
export async function verifyRuns(runs, { budget = 8 } = {}) {
  const out = new Map();
  out.bad = new Set();
  let t = performance.now();
  for (const r of runs) {
    const chk = CHK.get(r);
    if (!chk) continue;
    for (let i = 0; i < chk.length; i++) {
      if (performance.now() - t > budget) { await macrotask(); t = performance.now(); }
      if ((await blockHash(chk[i][1])) === chk[i][0]) continue;
      out.bad.add(chk[i][0]);
      out.set(r.id, i ? 'frames' : 'record');
      if (i) break;
    }
  }
  return out;
}

/** The blocks of these runs (sliced, ~8 ms each), hashed: [{id, rec: {hash, bytes}, secs: [{hash, bytes, of, at}]}] in
 *  run order. A record is the version-1 manifest entry with frames = {sec, n, ovx?, ext?}. Unchanged runs and sections
 *  keep their encoding and hash (SEC / MAN), so a flip re-encodes and hashes one record. */
export async function planBlocks(runs, { budget = 8 } = {}) {
  const enc = new TextEncoder(), out = [];
  let t = performance.now();
  for (const r of runs) {
    const p = await drive(piece(r), budget), s = p.sec, secs = [];
    let f = '';
    if (s) {
      s.hash ??= await blockHash(s.bytes);
      if (s.ext) s.extHash ??= await blockHash(s.ext);
      secs.push({ hash: s.hash, bytes: s.bytes, of: s.of, at: s.at });
      if (s.ext) secs.push({ hash: s.extHash, bytes: s.ext, of: s.of, at: s.extAt });
      f = `{"sec":"${s.hash}","n":${s.t.length}${s.ovxJson ? ',"ovx":' + s.ovxJson : ''}${s.ext ? `,"ext":"${s.extHash}"` : ''}}`;
    }
    if (!p.v2 || p.v2.f !== f) {
      const bytes = enc.encode(s ? p.pre + f + p.post : p.pre);
      p.v2 = { f, bytes, hash: await blockHash(bytes) };
    }
    out.push({ id: r.id, rec: { hash: p.v2.hash, bytes: p.v2.bytes }, secs });
    if (performance.now() - t > budget) { await macrotask(); t = performance.now(); }
  }
  return out;
}

/** paw-d1sq: a run tracked this session keeps its points as nested arrays (~75 MB a 600 x 1024 run). Once its section is
 *  packed (written), each frame whose overlay decodes from the packed bytes to exactly the same keys and numbers is swapped,
 *  in place, for the lazy overlay a reopen gives (decoded on read); a frame that would differ (masks, finer coordinates)
 *  keeps its own. -> frames swapped. Sliced (async). */
export async function lightenFrames(fr, { budget = 8 } = {}) {
  const e = fr && SEC.get(fr);
  if (!e || !secOk(e, fr, e.keepMasks) || lazyFrames(fr)) return 0;
  const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength), dv = view(e.bytes);
  let u;
  try { u = unpackFrames(dv, 0, e.bytes.length, fr.t.length, e.ovxJson ? JSON.parse(e.ovxJson) : null, e.ext ? { off: 0, len: e.ext.length } : null, e.ext ? view(e.ext) : dv); } catch { return 0; }
  let n = 0, t = performance.now();
  for (let i = 0; i < fr.ov.length; i++) {
    const a = fr.ov[i], b = u.fr.ov[i];
    if (a && b && LZ in b && sameOv(a, b)) { fr.ov[i] = b; n++; }
    if (performance.now() - t > budget) { await macrotask(); t = performance.now(); }
  }
  return n;
}
const sameOv = (a, b) => { const ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k])); };
function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') return sameOv(a, b);
  return false;
}

/** Records of a version-2 file by hash (a history entry's runs, paw-s49h) -> runs, each with its own copy of its frame
 *  bytes (the file's buffer is not kept). Missing or unreadable ones are left out. */
export async function decodeRecords(bytes, hashes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < HEAD || String.fromCharCode(...u8.subarray(0, 8)) !== MAGIC) return [];
  const start = HEAD + new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(8, true);
  let blocks;
  try { blocks = commitOf(u8, start).blocks; } catch { return []; }
  const out = [];
  for (const h of hashes) {
    const b = blocks.get(h);
    if (!b) continue;
    try {
      const rec = u8.subarray(b[0], b[0] + b[1]);
      if ((await blockHash(rec)) !== h) continue;
      const m = JSON.parse(utf8(rec)), chk = [], sec = secOf(m?.frames, blocks, u8, chk);
      if (!(await Promise.all(chk.map(async ([k, v]) => (await blockHash(v)) === k))).every(Boolean)) continue;
      // the run's sections copied into a buffer of their own (the file's is not kept)
      const own = new Uint8Array(chk.reduce((s, [, v]) => s + v.length, 0));
      if (sec) { own.set(chk[0][1]); if (chk[1]) own.set(chk[1][1], sec.len); }
      const mine = sec && { ...sec, off: 0, ext: sec.ext ? { off: sec.len, len: sec.ext.len } : null };
      const { r, c } = runOf(m, `run ${h}`, own, new DataView(own.buffer), mine);
      if (c) Object.assign(c, { hash: m.frames.sec, extHash: m.frames.ext || null, of: null });
      out.push(r);
    } catch { /* left out */ }
  }
  return out;
}
