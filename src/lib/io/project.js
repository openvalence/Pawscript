// .pawproj: versioned JSON for the whole `app.doc` (see ARCHITECTURE.md). Pure: text <-> doc.
//
// File shape (version 3; 2 kept effects (`fx`) and modifier spans apart, 1 differs in what plan kind 'climax' means), every section but `format`, `version`, `axes` optional on read:
//   { format:'pawproj', version:1, app:{name,version}, createdAt, savedAt,
//     media:{ path, relativePath?, name, size, hash:{algo,value}|null, durationMs, fps, isVfr, width, height },
//     axes:{ stroke:[[at,pos],...], roll:[...] }, activeAxis, playheadMs,
//     chapters:[{id,t0,t1,name,color}], bookmarks:[{id,at,note}], loops:[{id,t0,t1,tiledTo?}],
//     plan:[{id,t0,t1,kind,recipe,params}], ghosts:[{id,name,color,visible,source}],
//     profileId, settings:{...}, view:{start,span}, ...unknown keys }
// NOT saved: selection, time-range selection, dirty flag, player state, ghost frames (ghost scripts only with
// opts.ghostScripts). Unknown keys survive: top-level ones in doc.extra, nested ones by object spread.
import { normalize } from '../core/script.js';
import { axisName } from './axes.js';

export const FORMAT = 'pawproj';
export const CURRENT_VERSION = 3;

export class ProjectError extends Error {
  /** errors: [{path, message}] */
  constructor(errors) {
    super(errors.length === 1 ? `${errors[0].path}: ${errors[0].message}` : `${errors.length} problems in project file; first: ${errors[0].path}: ${errors[0].message}`);
    this.name = 'ProjectError';
    this.errors = errors;
  }
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const show = (v) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 40 ? s.slice(0, 37) + '...' : s; };
const KNOWN = ['format', 'version', 'app', 'createdAt', 'savedAt', 'media', 'axes', 'activeAxis', 'playheadMs', 'chapters', 'bookmarks', 'loops', 'plan', 'ghosts', 'profileId', 'settings', 'view'];

// ---------- migrations: version N -> N+1 ----------
/**
 * MIGRATIONS[v](obj) -> obj of version v+1 (must not mutate its input). Version 0 is the shape sketched in
 * pawscript-design-outline.md section 5 (snake_case, objects per action); it never shipped but is cheap to read.
 */
export const MIGRATIONS = {
  0(o) {
    const m = o.media;
    const axes = {};
    if (isObj(o.axes)) for (const [k, v] of Object.entries(o.axes)) axes[k] = (Array.isArray(v) ? v : (v && v.actions) || []).map((a) => [a.at, a.pos]);
    else if (Array.isArray(o.actions)) axes.stroke = o.actions.map((a) => [a.at, a.pos]);
    const rest = { ...o };
    for (const k of ['actions', 'tracking_sessions']) delete rest[k];
    return {
      ...rest, version: 1, axes,
      media: isObj(m) ? { path: m.path, name: m.name ?? String(m.path ?? '').split(/[\\/]/).pop(), size: m.size ?? null,
        hash: m.sha256 ? { algo: 'sha256', value: m.sha256 } : null, durationMs: m.duration_ms ?? null, fps: m.fps ?? null,
        isVfr: !!m.is_vfr, width: m.width ?? null, height: m.height ?? null } : null,
      chapters: (o.chapters || []).map((c, i) => ({ id: c.id ?? 'ch' + (i + 1), t0: c.start_ms, t1: c.end_ms, name: c.name ?? '', color: c.color ?? null })),
      bookmarks: (o.bookmarks || []).map((b, i) => ({ id: b.id ?? 'bm' + (i + 1), at: b.at_ms, note: b.note ?? '' })),
      loops: (o.loops || []).map((l, i) => ({ id: l.id ?? 'lp' + (i + 1), t0: l.start_ms, t1: l.end_ms, ...(l.tiled_to != null ? { tiledTo: l.tiled_to } : {}) })),
    };
  },
  /** v2 split the climax: kind 'climax' is now the fast run-in, 'orgasm' the pulses. A v1 segment of kind 'climax'
   *  played the pulses unless it named another recipe, and recipe 'climax' was the pulses on any kind: both keep
   *  their sound as recipe 'orgasm-pulses' (the old params), a pulses climax becomes kind 'orgasm'. */
  1(o) {
    const plan = Array.isArray(o.plan) ? o.plan.map((s) => {
      if (!isObj(s)) return s;
      const pulses = s.recipe === 'climax' || (s.kind === 'climax' && s.recipe == null);
      return pulses ? { ...s, recipe: 'orgasm-pulses', ...(s.kind === 'climax' ? { kind: 'orgasm' } : {}) } : s;
    }) : o.plan;
    return { ...o, version: 2, ...(plan !== undefined ? { plan } : {}) };
  },
  /** v3 (paw-ef73.20): modifiers are one object (the `modifiers` block); the old `fx` effects and the scenes' modifier
   *  spans are converted once by the app (app/project-logic.js modsFromV2, from doc.meta.migratedFrom). */
  2(o) { return { ...o, version: 3 }; },
};

/** Apply migrations until `target`. Returns {obj, from}. Throws ProjectError for unknown or newer versions. */
export function migrate(obj, migrations = MIGRATIONS, target = CURRENT_VERSION, { allowNewer = false } = {}) {
  const from = obj.version;
  if (!Number.isInteger(from) || from < 0) throw new ProjectError([{ path: 'version', message: `expected a non-negative integer, got ${show(from)}` }]);
  if (from > target) {
    if (allowNewer) return { obj, from };
    throw new ProjectError([{ path: 'version', message: `file is version ${from} but this Pawscript reads up to ${target}: update Pawscript` }]);
  }
  let cur = obj;
  for (let v = from; v < target; v++) {
    const fn = migrations[v];
    if (!fn) throw new ProjectError([{ path: 'version', message: `no migration from version ${v} to ${v + 1}` }]);
    cur = fn(structuredClone(cur));
    if (cur.version !== v + 1) cur = { ...cur, version: v + 1 };
  }
  return { obj: cur, from };
}

// ---------- validation + decode ----------
function decode(o, { lenient, warnings }) {
  const E = [];
  const err = (path, message) => E.push({ path, message });
  const warn = (path, message) => warnings.push(`${path}: ${message}`);
  const num = (v, path, { min = -Infinity, int = false, nullable = false } = {}) => {
    if (v === null && nullable) return true;
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && (!int || Number.isInteger(v))) return true;
    err(path, `expected ${int ? 'an integer' : 'a number'}${min > -Infinity ? ` >= ${min}` : ''}${nullable ? ' or null' : ''}, got ${show(v)}`);
    return false;
  };
  const str = (v, path, nullable = false) => {
    if (typeof v === 'string' || (nullable && (v === null || v === undefined))) return true;
    err(path, `expected a string${nullable ? ' or null' : ''}, got ${show(v)}`);
    return false;
  };
  const list = (key, check) => {
    const v = o[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { err(key, `expected an array, got ${show(v)}`); return []; }
    const ids = new Map();
    v.forEach((it, i) => {
      const p = `${key}[${i}]`;
      if (!isObj(it)) { err(p, `expected an object, got ${show(it)}`); return; }
      if (typeof it.id !== 'string' || !it.id) err(p + '.id', `expected a non-empty string, got ${show(it.id)}`);
      else if (ids.has(it.id)) err(p + '.id', `duplicate id ${show(it.id)} (also at ${key}[${ids.get(it.id)}])`);
      else ids.set(it.id, i);
      check(it, p);
    });
    return v;
  };
  const span = (it, p) => { const a = num(it.t0, p + '.t0', { min: 0 }), b = num(it.t1, p + '.t1', { min: 0 }); if (a && b && it.t1 < it.t0) err(p + '.t1', `ends (${it.t1}) before it starts (${it.t0})`); };

  // axes
  const axes = {};
  if (!isObj(o.axes)) err('axes', `expected an object of axis -> [[at,pos],...], got ${show(o.axes)}`);
  else {
    for (const [id, pairs] of Object.entries(o.axes)) {
      const p = `axes.${id}`;
      if (!axisName(id)) { if (lenient) warn(p, 'unknown axis id kept as is'); else err(p, `unknown axis id (known: stroke, roll, pitch, twist, surge, sway, vib, ...)`); }
      if (!Array.isArray(pairs)) { err(p, `expected an array of [at,pos], got ${show(pairs)}`); continue; }
      const actions = [];
      let bad = 0;
      pairs.forEach((x, i) => {
        const ok = Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && x[0] >= 0 && Number.isInteger(x[1]) && x[1] >= 0 && x[1] <= 100;
        if (!ok) { bad++; if (!lenient && bad <= 3) err(`${p}[${i}]`, `expected [at, pos] with integer at >= 0 and pos in 0..100, got ${show(x)}`); return; }
        if (!lenient && actions.length && x[0] <= actions[actions.length - 1].at) { bad++; if (bad <= 3) err(`${p}[${i}]`, `time ${x[0]} is not after the previous action (${actions[actions.length - 1].at})`); }
        actions.push({ at: x[0], pos: x[1] });
      });
      if (lenient) {
        const s = normalize(actions);
        if (bad || s.length !== pairs.length) warn(p, `repaired: ${pairs.length - s.length} of ${pairs.length} actions dropped or merged`);
        axes[id] = s;
      } else axes[id] = actions;
    }
  }

  // media
  let media = null;
  if (o.media !== undefined && o.media !== null) {
    const m = o.media;
    if (!isObj(m)) err('media', `expected an object or null, got ${show(m)}`);
    else {
      str(m.path, 'media.path'); str(m.name, 'media.name', true);
      for (const k of ['size', 'durationMs', 'fps', 'width', 'height']) if (m[k] !== undefined) num(m[k], 'media.' + k, { min: 0, nullable: true });
      if (m.hash != null && !(isObj(m.hash) && typeof m.hash.algo === 'string' && typeof m.hash.value === 'string')) err('media.hash', `expected {algo, value} strings or null, got ${show(m.hash)}`);
      media = { ...m };
    }
  }

  const chapters = list('chapters', (c, p) => { span(c, p); str(c.name, p + '.name', true); str(c.color, p + '.color', true); });
  const bookmarks = list('bookmarks', (b, p) => { num(b.at, p + '.at', { min: 0 }); str(b.note, p + '.note', true); });
  const loops = list('loops', (l, p) => { span(l, p); if (l.tiledTo !== undefined) num(l.tiledTo, p + '.tiledTo', { min: 0, nullable: true }); });
  const plan = list('plan', (s, p) => {
    span(s, p); str(s.kind, p + '.kind');
    if (s.params !== undefined && s.params !== null && !isObj(s.params)) err(p + '.params', `expected an object, got ${show(s.params)}`);
  });
  const ghosts = list('ghosts', (g, p) => { str(g.name, p + '.name', true); str(g.color, p + '.color', true); if (g.visible !== undefined && typeof g.visible !== 'boolean') err(p + '.visible', `expected true/false, got ${show(g.visible)}`); });
  if (o.settings !== undefined && !isObj(o.settings)) err('settings', `expected an object, got ${show(o.settings)}`);
  if (o.view != null) {
    if (!isObj(o.view)) err('view', `expected {start, span}, got ${show(o.view)}`);
    else { num(o.view.start, 'view.start'); if (num(o.view.span, 'view.span') && !(o.view.span > 0)) err('view.span', `must be > 0, got ${o.view.span}`); }
  }
  if (o.playheadMs !== undefined && o.playheadMs !== null) num(o.playheadMs, 'playheadMs', { min: 0 });
  str(o.profileId, 'profileId', true);
  for (const k of ['createdAt', 'savedAt']) str(o[k], k, true);
  let activeAxis = o.activeAxis;
  if (activeAxis !== undefined && activeAxis !== null) {
    if (typeof activeAxis !== 'string') err('activeAxis', `expected a string, got ${show(activeAxis)}`);
    else if (isObj(o.axes) && !(activeAxis in axes)) {
      if (lenient) { warn('activeAxis', `${show(activeAxis)} has no script; using ${Object.keys(axes)[0] ?? 'stroke'}`); activeAxis = undefined; }
      else err('activeAxis', `${show(activeAxis)} has no script in axes (have: ${Object.keys(axes).join(', ') || 'none'})`);
    }
  }
  if (E.length) throw new ProjectError(E);

  const extra = {};
  for (const [k, v] of Object.entries(o)) if (!KNOWN.includes(k)) extra[k] = v;
  return {
    media, axes, activeAxis: activeAxis ?? (axes.stroke ? 'stroke' : Object.keys(axes)[0] ?? 'stroke'),
    chapters, bookmarks, loops, plan, ghosts: ghosts.map((g) => ({ ...g, visible: g.visible ?? true, source: g.source ?? null, script: Array.isArray(g.script) ? normalize(g.script.map((x) => (Array.isArray(x) ? { at: x[0], pos: x[1] } : x))) : [] })),
    settings: isObj(o.settings) ? o.settings : {}, view: isObj(o.view) ? { start: o.view.start, span: o.view.span } : null,
    profileId: o.profileId ?? null, playheadMs: o.playheadMs ?? null,
    meta: { version: o.version, app: isObj(o.app) ? o.app : null, createdAt: o.createdAt ?? null, savedAt: o.savedAt ?? null },
    extra,
  };
}

/**
 * parse(text, opts) -> doc   (shape: axes, activeAxis, media, chapters, bookmarks, loops, plan, ghosts, settings,
 * view, profileId, playheadMs, meta, extra). Throws ProjectError with `.errors = [{path, message}]`.
 * opts: { lenient: repair scripts / bad active axis instead of failing, warnings: [] out-array, allowNewer,
 *         migrations, target (testing) }
 */
export function parse(text, opts = {}) {
  let o;
  try { o = JSON.parse(typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch (e) { throw new ProjectError([{ path: '(file)', message: 'not valid JSON: ' + e.message }]); }
  if (!isObj(o)) throw new ProjectError([{ path: '(file)', message: 'top level must be a JSON object' }]);
  if (o.format !== FORMAT) throw new ProjectError([{ path: 'format', message: `expected ${show(FORMAT)}, got ${show(o.format)}: this is not a Pawscript project` }]);
  const warnings = opts.warnings || [];
  const { obj, from } = migrate(o, opts.migrations || MIGRATIONS, opts.target ?? CURRENT_VERSION, opts);
  const doc = decode(obj, { lenient: !!opts.lenient, warnings });
  if (from !== obj.version) warnings.push(`migrated from version ${from} to ${obj.version}`);
  doc.meta.migratedFrom = from !== obj.version ? from : null;
  return doc;
}

// ---------- serialise ----------
/** relative path from a project file to a media file (both absolute, either slash style); null if different drives. */
export function relativePath(fromFile, toFile) {
  const a = String(fromFile).replace(/\\/g, '/').split('/'), b = String(toFile).replace(/\\/g, '/').split('/');
  a.pop();
  if (/^[A-Za-z]:$/.test(a[0] || '') && a[0].toLowerCase() !== (b[0] || '').toLowerCase()) return null;
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/**
 * doc -> plain object (see file shape above).
 * opts: { projectPath (adds media.relativePath), savedAt (ISO string, default now), appVersion, ghostScripts: keep ghost scripts }
 */
export function toJSON(doc, opts = {}) {
  const axes = {};
  for (const [id, s] of Object.entries(doc.axes || {})) axes[id] = s.map((a) => [a.at, a.pos]);
  const media = doc.media ? { ...doc.media } : null;
  if (media) {
    if (opts.projectPath && media.path) { const r = relativePath(opts.projectPath, media.path); if (r) media.relativePath = r; }
    media.size ??= null; media.hash ??= null;
  }
  const ghosts = (doc.ghosts || []).map((g) => { const { script, frames, ...rest } = g; return opts.ghostScripts ? { ...rest, script: (script || []).map((a) => [a.at, a.pos]) } : rest; });
  const out = {
    ...(doc.extra || {}),
    format: FORMAT, version: CURRENT_VERSION,
    app: { ...(doc.meta && doc.meta.app), name: 'Pawscript', ...(opts.appVersion ? { version: opts.appVersion } : {}) },
    createdAt: (doc.meta && doc.meta.createdAt) || opts.savedAt || new Date().toISOString(),
    savedAt: opts.savedAt || new Date().toISOString(),
    media, axes, ...(doc.activeAxis in axes ? { activeAxis: doc.activeAxis } : {}),
    ...(doc.playheadMs != null ? { playheadMs: doc.playheadMs } : {}),
    chapters: doc.chapters || [], bookmarks: doc.bookmarks || [], loops: doc.loops || [], plan: doc.plan || [], ghosts,
    profileId: doc.profileId ?? null, settings: doc.settings || {}, view: doc.view ? { start: doc.view.start, span: doc.view.span } : null,
  };
  return out;
}

/** doc -> text: indented JSON with each numeric pair ([at,pos], a kept channel's [t, v|null]) on one line (~25 bytes per action). */
export function serialize(doc, opts = {}) {
  const text = JSON.stringify(toJSON(doc, opts), null, 2);
  return text.replace(/\[\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?),\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|null)\s+\]/g, '[$1, $2]') + '\n';
}

// ---------- re-linking a moved media file ----------
/**
 * Rank candidate files for a project's media: exact hash match, then same size + same name, then same size,
 * then same name. candidates: [{path, name?, size, hash?: {algo,value}}] -> [{path, score, why}] best first.
 */
export function rankRelink(media, candidates) {
  const nameOf = (p) => String(p).replace(/\\/g, '/').split('/').pop().toLowerCase();
  const want = nameOf(media.path || media.name || '');
  const out = [];
  for (const c of candidates) {
    const sameName = nameOf(c.name || c.path) === want, sameSize = media.size != null && c.size === media.size;
    const sameHash = media.hash && c.hash && media.hash.algo === c.hash.algo && media.hash.value === c.hash.value;
    const score = sameHash ? 100 : sameSize && sameName ? 60 : sameSize ? 40 : sameName ? 20 : 0;
    if (score) out.push({ path: c.path, score, why: sameHash ? 'hash' : sameSize && sameName ? 'size+name' : sameSize ? 'size' : 'name' });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- feature blocks (extension point) ----------
// A feature that wants to persist data in the project (e.g. node-graph: `graphs`) owns ONE top-level key of the
// file. At runtime it lives in `doc.extra[key]` (the shell must keep `doc.extra` in app.doc and pass it back to
// serialize). Old builds without the feature round-trip the block untouched; the feature validates its own block.
const RESERVED = new Set(KNOWN);
/** Read a feature block (or `fallback`). */
export const getBlock = (doc, key, fallback = null) => (doc.extra && key in doc.extra ? doc.extra[key] : fallback);
/** New doc with the feature block set (undefined removes it). Throws for keys the core schema owns. */
export function setBlock(doc, key, value) {
  if (RESERVED.has(key)) throw new Error(`"${key}" is a core project key, pick another block name`);
  const extra = { ...(doc.extra || {}) };
  if (value === undefined) delete extra[key]; else extra[key] = value;
  return { ...doc, extra };
}
