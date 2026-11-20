// Pure inspector logic: statistics, scope resolution, preview stats/diff, batch edits, snippets,
// param-form mapping, time parsing. No DOM, no Svelte. Scripts are immutable (see lib/core/script.js).
import { lowerBound, indexAt, upsert, removeAt, clampPos, normalize, isValid } from '../../lib/core/script.js';

const r1 = (x) => Math.round(x * 10) / 10;

// ---------- time formatting / parsing ----------

/** 83456 -> "1:23.456" (h:mm:ss.mmm from one hour). */
export function fmtTime(ms) {
  const neg = ms < 0; ms = Math.abs(Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, f = ms % 1000;
  const p = (n, w) => String(n).padStart(w, '0');
  return (neg ? '-' : '') + (h ? `${h}:${p(m, 2)}` : `${m}`) + `:${p(s, 2)}.${p(f, 3)}`;
}

/**
 * Flexible time input -> ms (or NaN). Accepts "83456" (ms), "83.4s", "1:23.456", "1:02:03", "f120"/"120f" (frames),
 * "+500"/"-500" relative to `base`.
 */
export function parseTime(str, { fps = 30, base = 0 } = {}) {
  let s = String(str ?? '').trim().toLowerCase();
  if (!s) return NaN;
  let rel = 0;
  if (s[0] === '+' || s[0] === '-') { rel = s[0] === '-' ? -1 : 1; s = s.slice(1).trim(); }
  let v = NaN, m;
  if ((m = /^f\s*(\d+(?:\.\d+)?)$|^(\d+(?:\.\d+)?)\s*f$/.exec(s))) v = (+(m[1] ?? m[2]) * 1000) / fps;
  else if ((m = /^(\d+(?:\.\d+)?)\s*ms$/.exec(s))) v = +m[1];
  else if ((m = /^(\d+(?:\.\d+)?)\s*s$/.exec(s))) v = +m[1] * 1000;
  else if (/^\d+(?::\d+){1,2}(?:\.\d+)?$/.test(s)) {
    const parts = s.split(':').map(Number);
    v = parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
  } else if (/^\d+(?:\.\d+)?$/.test(s)) v = +s;
  if (!Number.isFinite(v)) return NaN;
  return Math.round(rel ? base + rel * v : v);
}

export const msToFrame = (ms, frameMs) => Math.round(ms / (frameMs || 1000 / 30));
export const frameToMs = (f, frameMs) => Math.round(f * (frameMs || 1000 / 30));

// ---------- statistics ----------

const EMPTY_STATS = Object.freeze({ count: 0, t0: 0, t1: 0, span: 0, posMin: 0, posMax: 0, posMean: 0, spm: 0, peakSpeed: 0, peakAt: 0 });

/** Stats over the actions of `script` at indices idx (ascending). Speeds are the segments touching those points. */
function statsOfIndices(script, idx) {
  const n = idx.length;
  if (!n) return EMPTY_STATS;
  let posMin = 100, posMax = 0, sum = 0, peak = 0, peakAt = script[idx[0]].at, turns = 0, lastDir = 0, prevPos = -1;
  const seg = (i, j) => { // segment i -> j (j = i+1)
    const a = script[i], b = script[j];
    const sp = (Math.abs(b.pos - a.pos) * 1000) / (b.at - a.at);
    if (sp > peak) { peak = sp; peakAt = b.at; }
  };
  for (let k = 0; k < n; k++) {
    const i = idx[k], p = script[i].pos;
    if (p < posMin) posMin = p;
    if (p > posMax) posMax = p;
    sum += p;
    if (i > 0) seg(i - 1, i);
    if (i + 1 < script.length && (k === n - 1 || idx[k + 1] !== i + 1)) seg(i, i + 1);
    if (prevPos >= 0 && p !== prevPos) {
      const dir = p > prevPos ? 1 : -1;
      if (lastDir && dir !== lastDir) turns++;
      lastDir = dir;
    }
    prevPos = p;
  }
  const t0 = script[idx[0]].at, t1 = script[idx[n - 1]].at, span = t1 - t0;
  // A stroke = one full out-and-back = two reversals; turns counts interior reversals only, so add the half-strokes at the ends.
  const strokes = (turns + 1) / 2;
  return { count: n, t0, t1, span, posMin, posMax, posMean: r1(sum / n), spm: span > 0 ? r1((strokes * 60000) / span) : 0, peakSpeed: Math.round(peak), peakAt };
}

/** Stats of a selection (Set/array of ats). Ats not in the script are ignored. */
export function selectionStats(script, ats) {
  const idx = [];
  for (const at of ats) { const i = indexAt(script, at); if (i >= 0) idx.push(i); }
  idx.sort((a, b) => a - b);
  return statsOfIndices(script, idx);
}

/** Stats of all actions with t0 <= at <= t1. */
export function rangeStats(script, t0, t1) {
  const a = lowerBound(script, t0), b = lowerBound(script, t1 + 1);
  const idx = []; for (let i = a; i < b; i++) idx.push(i);
  return statsOfIndices(script, idx);
}

export const axisStats = (script) => (script.length ? { ...statsOfIndices(script, script.map((_, i) => i)), duration: script[script.length - 1].at } : { ...EMPTY_STATS, duration: 0 });

/** Facts about one action: neighbours and speeds in pos/s (speedIn from the previous action, speedOut to the next). */
export function pointInfo(script, at) {
  const i = indexAt(script, at);
  if (i < 0) return null;
  const sp = (a, b) => (Math.abs(b.pos - a.pos) * 1000) / (b.at - a.at);
  return {
    i, at, pos: script[i].pos,
    speedIn: i > 0 ? Math.round(sp(script[i - 1], script[i])) : null,
    speedOut: i + 1 < script.length ? Math.round(sp(script[i], script[i + 1])) : null,
    prevAt: i > 0 ? script[i - 1].at : null, nextAt: i + 1 < script.length ? script[i + 1].at : null,
  };
}

/** Max speed (pos/s) over a whole script. */
export function maxSpeed(script) { let m = 0; for (let i = 1; i < script.length; i++) { const s = (Math.abs(script[i].pos - script[i - 1].pos) * 1000) / (script[i].at - script[i - 1].at); if (s > m) m = s; } return Math.round(m); }

/** True while another command enabled right now is bound to one of `id`'s keys (a broad command's `when`: let it have the key). */
export const yielded = (app, id) => { const c = app.commands; return !!c?.winner && c.keysFor(id).some((k) => c.winner(k, [id])); };

// ---------- scope resolution ----------

export const SCOPES = [
  { id: 'selection', label: 'Selection' },
  { id: 'range', label: 'Range' },
  { id: 'axis', label: 'Axis' },
  { id: 'all', label: 'All axes' },
];
const SCOPE_TIPS = { selection: 'Selected points', range: 'Points inside the I/O range', axis: 'Every point of the active axis', all: 'Every axis' };
/** SCOPES as SegmentedControl options (short labels, the long form as the tooltip). */
export const scopeOptions = () => SCOPES.map((s) => ({ value: s.id, label: s.id === 'all' ? 'All' : s.label, tip: SCOPE_TIPS[s.id] }));

/** Chapter containing t, else the nearest by distance, else null. */
export function chapterAt(chapters, t) {
  let best = null, bd = Infinity;
  for (const c of chapters || []) {
    const d = t < c.t0 ? c.t0 - t : t > c.t1 ? t - c.t1 : 0;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/**
 * Resolve a scope to concrete targets. doc = {axes, activeAxis, selection:{axis,ats}, range, chapters}.
 * Returns {targets:[{axis, sel, ats}], t0, t1, label, empty, why}. `sel` is what is handed to op(script, sel, opts):
 * {ats:Set} | {t0,t1} | null (everything); `ats` is only for counting (Set or {size}).
 */
export function resolveScope(doc, scope, playheadMs = 0) {
  const axis = doc.activeAxis, script = doc.axes?.[axis] ?? [];
  const mk = (targets, label, extra = {}) => {
    const total = targets.reduce((n, t) => n + t.ats.size, 0);
    return { targets, label, empty: total === 0, why: total === 0 ? extra.why ?? 'nothing in scope' : '', t0: extra.t0, t1: extra.t1 };
  };
  // A range target: ops get {t0,t1} (so range-aware tools see the real span), `ats` is only used to count.
  const ranged = (t0, t1) => ({ axis, sel: { t0, t1 }, ats: { size: rangeCount(script, t0, t1) } });
  switch (scope) {
    case 'selection': {
      const sel = doc.selection?.axis === axis ? doc.selection.ats : null;
      let ats = new Set();
      if (sel?.size) {
        // count the selected times still in the script: one O(n) pass for a big selection, k binary searches for a
        // small one. A fully valid selection (the usual case) is used as is, so a 100k select-all copies nothing.
        let hits = 0;
        if (sel.size * 16 > script.length) { for (const p of script) if (sel.has(p.at)) hits++; }
        else for (const at of sel) if (indexAt(script, at) >= 0) hits++;
        ats = hits === sel.size ? sel : new Set([...sel].filter((at) => indexAt(script, at) >= 0));
      }
      return mk([{ axis, sel: { ats }, ats }], `${ats.size} selected`, { why: 'no points selected' });
    }
    case 'range': {
      const r = doc.range;
      if (!r) return mk([{ axis, sel: null, ats: { size: 0 } }], 'no range', { why: 'no range set (I / O)' });
      return mk([ranged(r.t0, r.t1)], 'range', { t0: r.t0, t1: r.t1, why: 'no points in range' });
    }
    case 'chapter': {
      const c = chapterAt(doc.chapters, playheadMs);
      if (!c) return mk([{ axis, sel: null, ats: { size: 0 } }], 'no chapter', { why: 'no chapters defined' });
      return mk([ranged(c.t0, c.t1)], c.name || 'chapter', { t0: c.t0, t1: c.t1, why: 'no points in chapter' });
    }
    case 'all':
      return mk(Object.keys(doc.axes || {}).map((a) => ({ axis: a, sel: null, ats: { size: doc.axes[a].length } })), 'all axes');
    default:
      return mk([{ axis, sel: null, ats: { size: script.length } }], 'whole axis');
  }
}

const rangeCount = (script, t0, t1) => lowerBound(script, t1 + 1) - lowerBound(script, t0);

// ---------- op running, preview stats, diff ----------

/** Run an op defensively. sel = {ats} | {t0,t1} | null. -> {script, ats:number[]} | {error}. A sloppy result is repaired with normalize(). */
export function runOp(op, script, sel, opts) {
  try {
    const res = op.apply(script, sel, opts);
    let out = Array.isArray(res) ? res : res?.script;
    if (!Array.isArray(out)) return { error: 'tool returned no script' };
    if (!isValid(out)) out = normalize(out);
    return { script: out, ats: res?.ats ? [...res.ats] : [] };
  } catch (e) { return { error: String(e?.message ?? e) }; }
}

/** Counts of added / removed / moved(pos changed at same `at`) actions between two scripts. O(n). */
export function diffScripts(a, b) {
  let i = 0, j = 0, added = 0, removed = 0, moved = 0;
  while (i < a.length && j < b.length) {
    if (a[i].at === b[j].at) { if (a[i].pos !== b[j].pos) moved++; i++; j++; }
    else if (a[i].at < b[j].at) { removed++; i++; } else { added++; j++; }
  }
  return { added: added + (b.length - j), removed: removed + (a.length - i), moved };
}

/** Before/after summary for the preview card. */
export function previewStats(before, after) {
  const s = (x) => ({ count: x.length, maxSpeed: maxSpeed(x) });
  const b = s(before), a = s(after), d = diffScripts(before, after);
  return { before: b, after: a, dCount: a.count - b.count, dMaxSpeed: a.maxSpeed - b.maxSpeed, diff: d, unchanged: d.added === 0 && d.removed === 0 && d.moved === 0 };
}

// ---------- batch edits on a selection (pure; return {script, ats}) ----------

const pick = (script, ats) => { const idx = []; for (const at of ats) { const i = indexAt(script, at); if (i >= 0) idx.push(i); } return idx.sort((a, b) => a - b); };

/** kind: 'set' (pos=v) | 'offset' (pos+=v) | 'scale' (pos scaled by v% about the selection mean) | 'shift' (ms) | 'tscale' (time scaled by v% about first selected). */
export function batchEdit(script, ats, kind, v) {
  const idx = pick(script, ats);
  if (!idx.length || !Number.isFinite(v)) return { script, ats: [...ats] };
  const sel = idx.map((i) => script[i]);
  let moved;
  if (kind === 'set') moved = sel.map((a) => ({ at: a.at, pos: clampPos(v) }));
  else if (kind === 'offset') moved = sel.map((a) => ({ at: a.at, pos: clampPos(a.pos + v) }));
  else if (kind === 'scale') {
    const mean = sel.reduce((s, a) => s + a.pos, 0) / sel.length;
    moved = sel.map((a) => ({ at: a.at, pos: clampPos(mean + (a.pos - mean) * (v / 100)) }));
  } else if (kind === 'shift') {
    const lo = -sel[0].at; // never before 0
    const d = Math.max(lo, Math.round(v));
    moved = sel.map((a) => ({ at: a.at + d, pos: a.pos }));
  } else if (kind === 'tscale') {
    const t0 = sel[0].at, f = Math.max(0.01, v / 100);
    moved = sel.map((a) => ({ at: Math.round(t0 + (a.at - t0) * f), pos: a.pos }));
  } else return { script, ats: [...ats] };
  const keep = removeAt(script, new Set(sel.map((a) => a.at)));
  return { script: upsert(keep, moved), ats: moved.map((a) => a.at) };
}

/** Move one point to a new time/pos. -> {script, ats}. */
export function movePoint(script, at, { at: nat = at, pos } = {}) {
  const i = indexAt(script, at);
  if (i < 0) return { script, ats: [at] };
  const p = clampPos(pos ?? script[i].pos);
  const na = Math.max(0, Math.round(nat));
  return { script: upsert(removeAt(script, [at]), [{ at: na, pos: p }]), ats: [na] };
}

// ---------- param schema <-> form state ----------

/** Normalise one param descriptor from the catalogue (tolerates key/id/name, type aliases). */
export function normParam(p) {
  const key = p.key ?? p.id ?? p.name;
  let type = p.type ?? ((p.options ?? p.choices) ? 'select' : typeof p.default === 'boolean' ? 'bool' : 'number');
  if (type === 'boolean' || type === 'checkbox' || type === 'toggle') type = 'bool';
  else if (type === 'enum' || type === 'choice') type = 'select';
  else if (type === 'int' || type === 'integer' || type === 'percent' || type === 'float') type = 'number';
  const integer = p.type === 'int' || p.type === 'integer' || p.integer === true || (p.step != null && Number.isInteger(p.step) && p.type !== 'float' && p.type !== 'number');
  const options = (p.options ?? p.choices)?.map((o) => (typeof o === 'object' ? { value: o.value ?? o.id, label: o.label ?? o.title ?? String(o.value ?? o.id) } : { value: o, label: String(o) }));
  return { key, label: p.label ?? p.title ?? key, type, min: p.min, max: p.max, step: p.step ?? (integer ? 1 : 0.1), integer, unit: p.unit ?? (p.type === 'percent' ? '%' : ''), default: p.default ?? (type === 'bool' ? false : type === 'select' ? options?.[0]?.value : p.min ?? 0), options, help: p.help ?? p.description ?? '' };
}

export const opParams = (op) => (op.params ?? []).map(normParam);

export function defaultsFor(op) { const o = {}; for (const p of opParams(op)) o[p.key] = p.default; return o; }

/** Remembered values merged over defaults; unknown keys dropped, types coerced, numbers clamped. */
export function coerceParams(op, values = {}) {
  const out = {};
  for (const p of opParams(op)) {
    let v = values[p.key] ?? p.default;
    if (p.type === 'bool') v = !!v;
    else if (p.type === 'select') v = p.options?.some((o) => o.value === v) ? v : p.default;
    else if (p.type === 'number') {
      v = Number(v); if (!Number.isFinite(v)) v = Number(p.default) || 0;
      if (p.min != null) v = Math.max(p.min, v);
      if (p.max != null) v = Math.min(p.max, v);
      if (p.integer) v = Math.round(v);
    } else v = String(v ?? '');
    out[p.key] = v;
  }
  return out;
}

export const paramsEqual = (op, a, b) => opParams(op).every((p) => a?.[p.key] === b?.[p.key]);

const GROUP_ORDER = ['amplitude', 'time', 'density', 'speed', 'rhythm', 'variation', 'points', 'select'];
const GROUP_TITLE = { select: 'Selection helpers', points: 'Points' };
export const groupTitle = (g = 'other') => GROUP_TITLE[g] ?? g.charAt(0).toUpperCase() + g.slice(1);

/** Group + filter the catalogue. Favourites first (own group), then groups in a fixed, sensible order. */
export function groupOps(ops, query = '', favs = []) {
  const q = query.trim().toLowerCase();
  const hit = (o) => !q || `${o.title} ${groupTitle(o.group)} ${o.id}`.toLowerCase().includes(q);
  const list = ops.filter(hit), fav = new Set(favs), groups = [];
  const f = favs.map((id) => list.find((o) => o.id === id)).filter(Boolean);
  if (f.length) groups.push({ group: 'Favourites', ops: f, fav: true });
  const by = new Map();
  for (const o of list) { const g = o.group || 'other'; if (!by.has(g)) by.set(g, []); by.get(g).push(o); }
  const keys = [...by.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  for (const g of keys) groups.push({ group: groupTitle(g), ops: by.get(g) });
  return { groups, count: list.length, fav };
}

/** Slider only where it is usable (not for 0..1e9 ms). */
export const sliderOK = (p) => p.type === 'number' && Number.isFinite(p.min) && Number.isFinite(p.max) && (p.max - p.min) / p.step <= 2000;

/** Key of the synthetic "follow the playhead" switch that kitSchema adds after an op's playhead param. */
export const FOLLOW = '__follow';

/**
 * An op's params as a kit ParamForm schema (src/ui/kit/params.js). With `follow`, a bool row FOLLOW is added
 * right after op.playhead (the param that tracks the playhead until the user sets it); `playheadMs` becomes that
 * param's default, so a value that is just the playhead does not read as changed.
 */
export function kitSchema(op, { follow = false, playheadMs } = {}) {
  const out = [];
  for (const p of opParams(op)) {
    const live = p.key === op.playhead && Number.isFinite(playheadMs);
    // "Tolerance (simplify)": the short head is the label (one line in a 260 px form), the aside joins the hint
    const m = /^(.+?)\s+\((.+)\)$/.exec(p.label);
    const aside = m ? m[2][0].toUpperCase() + m[2].slice(1) : '';
    const hint = [aside, p.help].filter(Boolean).join('. ') || undefined;
    const base = { key: p.key, label: m ? m[1] : p.label, default: live ? playheadMs : p.default, hint };
    if (p.type === 'bool') out.push({ ...base, type: 'bool' });
    else if (p.type === 'select') out.push({ ...base, type: 'choice', choices: p.options ?? [] });
    else if (p.type === 'number') {
      out.push({ ...base, type: p.integer ? 'int' : 'float', min: p.min, max: p.max, step: p.step, unit: p.unit || undefined,
        control: sliderOK(p) && (p.max - p.min) / p.step <= 400 ? 'slider' : 'field' });
    } else continue; // free text: no op uses it, and ParamForm has no text control
    if (follow && p.key === op.playhead) out.push({ key: FOLLOW, label: 'Follow playhead', type: 'bool', default: true, hint: `${base.label === 'Playhead' ? 'The time' : base.label} tracks the playhead until you set it` });
  }
  return out;
}

// ---------- snippets ----------

let _id = 0;
export const newId = (p = 's') => `${p}${Date.now().toString(36)}${(_id++).toString(36)}`;

/** Snippet from actions (times made relative to the first). null if empty. */
export function makeSnippet(actions, name = 'Snippet', id = newId()) {
  if (!actions.length) return null;
  const t0 = actions[0].at;
  const acts = actions.map((a) => ({ at: a.at - t0, pos: a.pos }));
  return { id, name: String(name).slice(0, 60), duration: acts[acts.length - 1].at, actions: acts };
}

export const snippetFromSelection = (script, ats, name) => makeSnippet(pick(script, ats).map((i) => script[i]), name);
export const snippetFromRange = (script, t0, t1, name) => makeSnippet(script.slice(lowerBound(script, t0), lowerBound(script, t1 + 1)), name);

export const serializeSnippets = (list) => JSON.stringify({ pawscript: 'snippets', v: 1, snippets: list });

/** Tolerant parse: accepts the serialised wrapper or a bare array; drops invalid entries. */
export function parseSnippets(text) {
  let d = text;
  if (typeof text === 'string') { try { d = JSON.parse(text); } catch { return []; } }
  const arr = Array.isArray(d) ? d : Array.isArray(d?.snippets) ? d.snippets : [];
  const out = [];
  for (const s of arr) {
    if (!s || !Array.isArray(s.actions)) continue;
    const acts = normalize(s.actions);
    if (!acts.length) continue;
    const t0 = acts[0].at;
    const rel = acts.map((a) => ({ at: a.at - t0, pos: a.pos }));
    out.push({ id: typeof s.id === 'string' ? s.id : newId(), name: String(s.name ?? 'Snippet').slice(0, 60), duration: rel[rel.length - 1].at, actions: rel });
  }
  return out;
}

/** Paste `snip` at `atMs`. opts: timeScale (1), posScale (1, about 50), fitMs (stretch to this duration), mode 'merge'|'replace'. -> {script, ats}. */
export function placeSnippet(script, snip, atMs, { timeScale = 1, posScale = 1, fitMs = 0, mode = 'merge' } = {}) {
  const f = fitMs > 0 && snip.duration > 0 ? fitMs / snip.duration : timeScale;
  const placed = snip.actions.map((a) => ({ at: Math.round(atMs + a.at * f), pos: clampPos(50 + (a.pos - 50) * posScale) }));
  const t1 = placed[placed.length - 1].at;
  const base = mode === 'replace' ? script.filter((a) => a.at < atMs || a.at > t1) : script;
  const next = upsert(base, placed);
  return { script: next, ats: normalize(placed).map((a) => a.at) };
}
