// Funscript text <-> {script, meta, raw}. Pure: strings and objects in, strings and objects out.
//
// parseFunscript is tolerant of real-world files (floats, unsorted, duplicates, missing fields, BOM, numeric
// strings, the funlib 2.0 `channels.stroke.actions` layout) and reports every repair in `notes`.
// serializeFunscript replaces ONLY what we own (`actions`, plus metadata bookmarks when asked, plus
// `inverted` when meta says so): every other key of a foreign file survives untouched, in its original order.
//
// `inverted: true` matches runs.js funscriptDoc and funscript.js parseFunscript: on read pos becomes 100 - pos
// (so the editor always shows 100 = out), on write it is flipped back and the flag is kept.
// `range` (device scale hint, e.g. 90) is NOT applied to positions (same as funscript.js, which notes
// 'range ignored'); it is kept in meta.range and in raw.
// paw-2pcf: embedded axes (funlib 1.1 `axes: [{id, actions}]`, 2.0 `channels: {name: {actions}}`, ids by name or T-code)
// are parsed into `embedded` {axisName: Script} (each with its own `inverted`); the open turns them into document axes
// (project-logic buildOpenDoc), which save as sibling files like any axis. So the stroke file does not keep a stale
// copy, serializeFunscript drops the embedded entries it took (meta.embedded) and keeps every other key.
import { normalize } from '../core/script.js';
import { axisName } from './axes.js';

const MAX_ACTIONS = 2_000_000;
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

// ---------- metadata marks: chapters and bookmarks ----------
// UNVERIFIED, FROM MEMORY of OpenFunscripter's metadata block (other players read the same shape):
//   "metadata": { "title", "creator", "description", "duration" (seconds), "tags": [], "performers": [],
//                 "chapters":  [ { "name": "...", "startTime": "HH:MM:SS.mmm", "endTime": "HH:MM:SS.mmm" } ],
//                 "bookmarks": [ { "name": "...", "time": "HH:MM:SS.mmm" } ] }
// funscript.js `marksOf` reads the same keys (startTime / time), which is some evidence they are right.
// The optional chapter `color` is OUR extension (no known standard); players ignore unknown keys.

const pad = (v, n = 2) => String(v).padStart(n, '0');
/** ms -> 'HH:MM:SS.mmm' */
export function formatClock(ms) {
  const t = Math.max(0, Math.round(ms)), s = Math.floor(t / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}.${pad(t % 1000, 3)}`;
}
/** 'HH:MM:SS(.mmm)' | 'MM:SS(.mmm)' | number of ms -> ms; NaN if unusable. */
export function parseClock(v) {
  if (typeof v === 'number') return v >= 0 ? v : NaN;
  const m = typeof v === 'string' && /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v.trim());
  return m ? Math.round(((+m[1] || 0) * 3600 + +m[2] * 60 + +m[3]) * 1000) : NaN;
}

/** Read chapters/bookmarks from a metadata object into app shapes. endMs completes a last chapter with no endTime. */
export function readMarks(metadata, endMs = null) {
  const md = isObj(metadata) ? metadata : {};
  const chapters = [];
  for (const c of Array.isArray(md.chapters) ? md.chapters : []) {
    const t0 = parseClock(c && c.startTime);
    if (!isObj(c) || !Number.isFinite(t0)) continue;
    chapters.push({ id: '', t0, t1: parseClock(c.endTime), name: typeof c.name === 'string' ? c.name : '', color: typeof c.color === 'string' ? c.color : null });
  }
  chapters.sort((a, b) => a.t0 - b.t0);
  chapters.forEach((c, i) => {
    c.id = 'ch' + (i + 1);
    if (!Number.isFinite(c.t1) || c.t1 < c.t0) c.t1 = chapters[i + 1] ? chapters[i + 1].t0 : Math.max(c.t0, endMs ?? c.t0);
  });
  const bookmarks = [];
  for (const b of Array.isArray(md.bookmarks) ? md.bookmarks : []) {
    const at = parseClock(b && b.time);
    if (isObj(b) && Number.isFinite(at)) bookmarks.push({ id: '', at, note: typeof b.name === 'string' ? b.name : '' });
  }
  bookmarks.sort((a, b) => a.at - b.at).forEach((b, i) => { b.id = 'bm' + (i + 1); });
  return { chapters, bookmarks };
}

function writeBookmarks(orig, bookmarks) {
  const old = Array.isArray(orig) ? orig.filter(isObj) : [];
  return bookmarks.map((b) => {
    const prev = old.find((o) => parseClock(o.time) === Math.round(b.at) && (o.name ?? '') === (b.note ?? ''));
    return { ...(prev || {}), name: b.note ?? '', time: prev ? prev.time : formatClock(b.at) };
  });
}

// ---------- parse ----------
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
/** The embedded axes of a parsed file: {embedded: {axisName: Script}, taken: [{where: 'axes' | 'channels', key, axis}], notes}. */
function embeddedAxes(doc) {
  const embedded = {}, taken = [], notes = [];
  const ents = [...(Array.isArray(doc.axes) ? doc.axes.map((x, i) => ['axes', i, isObj(x) ? x.id ?? x.name : null, x]) : []),
    ...(isObj(doc.channels) ? Object.entries(doc.channels).map(([k, x]) => ['channels', k, k, x]) : [])];
  for (const [where, key, id, x] of ents) {
    const name = axisName(id);
    if (!name || name === 'stroke' || embedded[name] || !isObj(x) || !Array.isArray(x.actions)) continue;
    try {
      const p = parseFunscript({ actions: x.actions, ...(x.inverted === true ? { inverted: true } : {}) });
      if (!p.script.length) continue;
      embedded[name] = p.script; taken.push({ where, key, axis: name });
      if (p.notes.length) notes.push(`${name}: ${p.notes.join('; ')}`);
    } catch (e) { notes.push(`${name} axis not loaded: ${e.message}`); }
  }
  return { embedded, taken, notes };
}

/**
 * parseFunscript(text | object) -> { script, meta, raw, notes, embedded }
 *   script  valid core Script (integers, clamped, sorted, strictly increasing), inversion already applied
 *   meta    { version, inverted, range, source: 'actions'|'channels.stroke', title, creator, description,
 *             durationMs, chapters: [{id,t0,t1,name,color}], bookmarks: [{id,at,note}] }
 *   raw     deep copy of the parsed JSON object, untouched: hand it back to serializeFunscript
 *   notes   human-readable list of every repair made
 * Throws Error with a plain message when the input is not a funscript at all.
 */
export function parseFunscript(input) {
  let doc = input;
  if (typeof input === 'string') {
    try { doc = JSON.parse(input.charCodeAt(0) === 0xfeff ? input.slice(1) : input); } catch (e) { throw new Error('not a funscript: invalid JSON (' + e.message + ')'); }
  } else if (isObj(input)) doc = structuredClone(input);
  if (!isObj(doc)) throw new Error('not a funscript: top level is not a JSON object');
  let list = Array.isArray(doc.actions) ? doc.actions : null, source = 'actions';
  if (!list && isObj(doc.channels) && isObj(doc.channels.stroke) && Array.isArray(doc.channels.stroke.actions)) { list = doc.channels.stroke.actions; source = 'channels.stroke'; }
  if (!list) throw new Error('not a funscript: no "actions" array');
  if (list.length > MAX_ACTIONS) throw new Error(`refusing ${list.length} actions (limit ${MAX_ACTIONS})`);

  const notes = [];
  const inverted = doc.inverted === true;
  let invalid = 0, negative = 0, fractional = 0, clamped = 0, unsorted = false, prev = -Infinity;
  const kept = [];
  for (const a of list) {
    const at = isObj(a) ? num(a.at) : NaN, pos = isObj(a) ? num(a.pos) : NaN;
    if (!Number.isFinite(at) || !Number.isFinite(pos)) { invalid++; continue; }
    if (at < 0) { negative++; continue; }
    if (!Number.isInteger(at) || !Number.isInteger(pos)) fractional++;
    if (pos < 0 || pos > 100) clamped++;
    if (at < prev) unsorted = true;
    prev = at;
    kept.push({ at, pos: inverted ? 100 - Math.min(100, Math.max(0, pos)) : pos });
  }
  const script = normalize(kept);
  const dups = kept.length - script.length;
  if (invalid) notes.push(`${invalid} action${invalid === 1 ? '' : 's'} without a numeric at/pos dropped`);
  if (negative) notes.push(`${negative} action${negative === 1 ? '' : 's'} before time 0 dropped`);
  if (unsorted) notes.push('actions sorted');
  if (dups > 0) notes.push(`${dups} duplicate timestamp${dups === 1 ? '' : 's'} merged (later one wins)`);
  if (fractional) notes.push(`${fractional} action${fractional === 1 ? '' : 's'} had fractional values (rounded)`);
  if (clamped) notes.push(`${clamped} position${clamped === 1 ? '' : 's'} clamped to 0..100`);
  if (typeof doc.range === 'number' && doc.range !== 100) notes.push(`range ${doc.range} kept in the file but not applied`);
  if (inverted) notes.push('file is inverted: positions flipped on load, flipped back on save');

  const emb = embeddedAxes(doc);
  notes.push(...emb.notes);
  const md = isObj(doc.metadata) ? doc.metadata : {};
  const marks = readMarks(md, script.length ? script[script.length - 1].at : 0);
  const str = (v) => (typeof v === 'string' ? v : null);
  const meta = {
    version: str(doc.version), inverted, range: Number.isFinite(doc.range) ? doc.range : 100, source,
    title: str(md.title), creator: str(md.creator), description: str(md.description),
    durationMs: Number.isFinite(md.duration) ? Math.round(md.duration * 1000) : null,   // OFS stores seconds (from memory)
    chapters: marks.chapters, bookmarks: marks.bookmarks, ...(emb.taken.length ? { embedded: emb.taken } : {}),
  };
  return { script, meta, raw: doc, notes, embedded: emb.embedded };
}

// ---------- serialise ----------
/**
 * serializeFunscript({script, meta?, raw?}, {chapters?, bookmarks?}) -> plain object ready for JSON.stringify.
 *   raw        the `raw` from parseFunscript (or the previously saved JSON); null makes a fresh
 *              { version:'1.0', inverted:false, range:100, actions } file (same defaults as runs.js funscriptDoc)
 *   meta.inverted  if boolean it decides the flag and the flip (default: raw's flag)
 *   bookmarks  app-shaped list to write into metadata (OFS shape); omit to leave metadata untouched
 *   chapters   ignored: the app no longer authors chapters (paw-1w0x), so metadata.chapters passes through exactly as the
 *              file had it (another tool's data is never rewritten)
 */
export function serializeFunscript({ script, meta = {}, raw = null }, opts = {}) {
  const base = isObj(raw) ? raw : null;
  const doc = base ? { ...base } : { version: '1.0', inverted: false, range: 100 };
  if (typeof meta.inverted === 'boolean' && meta.inverted !== (doc.inverted === true)) doc.inverted = meta.inverted;
  const flip = doc.inverted === true;
  const actions = script.map((a) => {
    const pos = Math.round(Math.min(100, Math.max(0, a.pos)));
    return { at: Math.round(a.at), pos: flip ? 100 - pos : pos };
  });
  if (base && !Array.isArray(base.actions) && isObj(base.channels) && isObj(base.channels.stroke) && Array.isArray(base.channels.stroke.actions)) {
    doc.channels = { ...base.channels, stroke: { ...base.channels.stroke, actions } };
  } else doc.actions = actions;
  // the embedded axes the open took are document axes now (written as sibling files): no stale copy in this file
  for (const { where, key } of Array.isArray(meta.embedded) ? meta.embedded : []) {
    if (where === 'channels' && isObj(doc.channels) && key in doc.channels) { const { [key]: _, ...rest } = doc.channels; doc.channels = rest; }   // eslint-disable-line no-unused-vars
  }
  const drop = new Set((Array.isArray(meta.embedded) ? meta.embedded : []).filter((e) => e.where === 'axes').map((e) => e.key));
  if (drop.size && Array.isArray(doc.axes)) { const keep = doc.axes.filter((_, i) => !drop.has(i)); if (keep.length) doc.axes = keep; else delete doc.axes; }

  if ((opts.bookmarks && opts.bookmarks.length) || (isObj(doc.metadata) && opts.bookmarks)) {
    if (doc.metadata === undefined || doc.metadata === null) doc.metadata = {};
    if (isObj(doc.metadata)) {
      const md = { ...doc.metadata };
      if (opts.bookmarks && (opts.bookmarks.length || md.bookmarks !== undefined)) md.bookmarks = writeBookmarks(md.bookmarks, opts.bookmarks);
      doc.metadata = md;
    }
  }
  return doc;
}

/** serializeFunscript + JSON.stringify. opts.indent (default none, the usual compact funscript). */
export const stringifyFunscript = (file, opts = {}) => JSON.stringify(serializeFunscript(file, opts), null, opts.indent);
