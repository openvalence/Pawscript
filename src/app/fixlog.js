// fixlog.js -- the fix log (paw-dze): every time the owner corrected something the app produced, with enough context to
// act on it ("automatic output X was changed by manual action Y"). Pure (no DOM, no runes): the app runs it live
// (FixLog, fed by app.svelte.js from the undo history's records and the usage log's events) and dev/fix-report.mjs
// replays it over old usage logs that predate it. Field and kind reference: docs/fix-log.md.
//
//  Detector  one event -> facts. Events are usage-log records {t (ms), s, k, ...}: 'edit:commit' {label, paths, diff?}
//            (diff: diffPatches, live only), 'edit:undo', 'tracking:*', 'settings:set', 'timeline:cum.detect', ...
//            A fact is {t, kind, key?, t0?, t1?, shotIndex?, scope?, auto?, manual?}; kind 'auto:<step>' (the app
//            produced something), 'ok:<step>' (the owner confirmed it as is) or 'fix:<area>.<what>' (the owner changed it).
//  Grouper   facts -> episodes: same session, same project, the same scene (by video time), no gap over IDLE_MS.
//            Repeats of one fix kind on one key in an episode are one item with a chain (a retry chain).
//  FixLog    the live glue: stamps each fact with the project / scene / shot, writes it to the usage log as a raw
//            event, keeps Accept spans to summarise hand edits of the points lazily (pointEdits, at episode close),
//            and appends each closed episode to fixes.jsonl. Never throws into the app.

export const IDLE_MS = 120000, UNDO_MS = 10000, REVERT_MS = 300000, NEAR_MS = 15000;
const J = (v) => JSON.stringify(v ?? null);
export const clip = (v, n = 120) => { const s = typeof v === 'string' ? v : J(v); return s.length > n ? s.slice(0, n) + '…' : s; };
const isUnassigned = (n) => /^unassigned_\d+$/.test(n || '');
const isSuggested = (g) => !!g?.source && g.source !== 'user';
/** 83.4 s -> '1:23.4' */
export const mmss = (ms) => { if (!Number.isFinite(ms)) return '?'; const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };

// ---- diffs of one undo step (live only; cheap: identity scans, JSON only of the small values that changed) ----

/** The changed stretch of a script between two versions: {t0, t1, n0, n1} (n = points in the stretch) or null. Points compare by
 *  value: an Accept rebuilds every point object (normalize), and by identity its span was the whole script (paw-wzxu: every
 *  Accept of a run of them logged as 0:02-2:21, one shot). */
export function axisSpan(b = [], a = []) {
  b = b || []; a = a || [];
  const n = Math.min(a.length, b.length), same = (x, y) => x === y || (x.at === y.at && x.pos === y.pos);
  let pre = 0, suf = 0;
  while (pre < n && same(a[pre], b[pre])) pre++;
  while (suf < n - pre && same(a[a.length - 1 - suf], b[b.length - 1 - suf])) suf++;
  const ai = a.slice(pre, a.length - suf), bi = b.slice(pre, b.length - suf);
  if (!ai.length && !bi.length) return null;
  const ats = [...ai, ...bi].map((p) => p.at);
  return { t0: Math.min(...ats), t1: Math.max(...ats), n0: bi.length, n1: ai.length };
}

const SKIP_KEYS = new Set(['start_ms', 'end_ms', 'describe', 'scene_describe', 'structure', 'loop', 'offers']);
/** Groups of one take before / after: names added / removed / changed, and what each was before. */
export function groupsDiff(b = [], a = []) {
  const B = new Map((b || []).map((g) => [g.name, g])), A = new Map((a || []).map((g) => [g.name, g]));
  return {
    added: [...A.keys()].filter((k) => !B.has(k)), removed: [...B.keys()].filter((k) => !A.has(k)),
    changed: [...A.keys()].filter((k) => B.has(k) && B.get(k) !== A.get(k)),
    before: Object.fromEntries([...B].map(([k, g]) => [k, { suggested: isSuggested(g) || !!g.unconfirmed, source: g.source || 'user' }])),
    suggested: (b || []).filter(isSuggested).length,
  };
}
/** Two shot lists (doc.scenes) -> {cuts: {added, removed}, joins: {merged, split}, keys: {key: [from, to]}, groups?, t0, t1}. */
export function scenesDiff(b = [], a = []) {
  b = b || []; a = a || [];
  const bs = new Map(b.map((s, i) => [s.start_ms, i])), as = new Set(a.map((s) => s.start_ms));
  const out = { cuts: { added: a.filter((s) => !bs.has(s.start_ms)).map((s) => s.start_ms), removed: b.filter((s) => !as.has(s.start_ms)).map((s) => s.start_ms) }, joins: { merged: [], split: [] }, keys: {} };
  let t0 = Infinity, t1 = -Infinity;
  const span = (s) => { t0 = Math.min(t0, s.start_ms); t1 = Math.max(t1, s.end_ms); };
  for (const t of [...out.cuts.added, ...out.cuts.removed]) { t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  for (const s of a) {
    const j = bs.get(s.start_ms), o = j == null ? null : b[j];
    if (!o || o === s) continue;
    if (o.end_ms !== s.end_ms) span(s);
    if ((o.join === true) !== (s.join === true)) { (s.join === true ? out.joins.merged : out.joins.split).push(s.start_ms); span(s); }
    for (const k of new Set([...Object.keys(o), ...Object.keys(s)])) {
      if (SKIP_KEYS.has(k) || k === 'join' || o[k] === s[k]) continue;
      if (k === 'groups') { if (!out.groups) { out.groups = groupsDiff(o.groups, s.groups); span(s); } continue; }
      if (k === 'derive') {
        for (const d of new Set([...Object.keys(o.derive || {}), ...Object.keys(s.derive || {})])) {
          const x = o.derive?.[d], y = s.derive?.[d];
          if (J(x) !== J(y)) { out.keys['derive.' + d] ??= [x ?? null, y ?? null]; span(s); }
        }
        continue;
      }
      if (J(o[k]) === J(s[k])) continue;
      out.keys[k] ??= [o[k] ?? null, s[k] ?? null];
      span(s);
    }
  }
  if (t1 >= t0) { out.t0 = t0; out.t1 = t1; }
  return out;
}
/** Two modifier lists (doc.fx) -> {added, removed, changed: [{id, kind, t0, t1, what}], t0, t1}. */
export function fxDiff(b = [], a = []) {
  const B = new Map((b || []).map((e) => [e.id, e])), A = new Map((a || []).map((e) => [e.id, e]));
  const d = (e) => ({ id: e.id, kind: e.kind, t0: Math.round(e.t0), t1: Math.round(e.t1) });
  const out = { added: [...A.values()].filter((e) => !B.has(e.id)).map(d), removed: [...B.values()].filter((e) => !A.has(e.id)).map(d), changed: [] };
  for (const [id, e] of A) {
    const o = B.get(id);
    if (!o || o === e) continue;
    const what = [...(o.t0 !== e.t0 || o.t1 !== e.t1 ? ['span'] : []), ...(o.kind !== e.kind ? ['kind'] : []), ...(J(o.params) !== J(e.params) ? ['params'] : []), ...(!!o.muted !== !!e.muted ? ['muted'] : [])];
    if (what.length) out.changed.push({ ...d(e), what: what.join(','), ...(what.includes('span') ? { dt: Math.round(e.t0 - o.t0) } : {}) });
  }
  const all = [...out.added, ...out.removed, ...out.changed];
  if (all.length) { out.t0 = Math.min(...all.map((x) => x.t0)); out.t1 = Math.max(...all.map((x) => x.t1)); }
  return out;
}
/** The undo history's patches of one step -> {axes: [{axis, ...axisSpan}], scenes?, fx?, finish?}. */
export function diffPatches(patches = []) {
  const out = { axes: [] };
  for (const p of patches) {
    if (p.path.startsWith('axes.')) { const s = axisSpan(p.before, p.after); if (s) out.axes.push({ axis: p.path.slice(5), ...s }); }
    else if (p.path === 'scenes') out.scenes = scenesDiff(p.before, p.after);
    else if (p.path === 'fx') out.fx = fxDiff(p.before, p.after);
    else if (p.path === 'finish') { const b = p.before || {}, a = p.after || {}; out.finish = Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => J(b[k]) !== J(a[k])).map((k) => [k, [clip(b[k] ?? null, 60), clip(a[k] ?? null, 60)]])); }
  }
  return out;
}

// ---- hand edits of accepted points ----
/**
 * What the owner did by hand to the points an Accept wrote: a = the accepted points of the span, b = the points there
 * now (both sorted by at). Unchanged points (same at and pos) are skipped; the rest are paired nearest in time within
 * tol ms (moved), else added / deleted. where: the accepted point's place in its stroke (turn: both neighbours on one
 * side; hold: a neighbour within 2 units; else mid), for the moved and deleted ones.
 */
export function pointEdits(a = [], b = [], { tol = 400, cap = 4000 } = {}) {
  const key = (p) => p.at + ':' + p.pos, bk = new Set(b.map(key)), ak = new Set(a.map(key));
  const ra = [], rb = b.filter((p) => !ak.has(key(p)));
  a.forEach((p, i) => { if (!bk.has(key(p))) ra.push(i); });
  const where = (i) => {
    const p = a[i], l = a[i - 1], r = a[i + 1];
    if ((l && Math.abs(p.pos - l.pos) <= 2) || (r && Math.abs(p.pos - r.pos) <= 2)) return 'hold';
    if (l && r && (p.pos - l.pos) * (p.pos - r.pos) > 0) return 'turn';
    return l && r ? 'mid' : 'turn';   // an end of the span is a turn of the stroke it ends
  };
  const out = { n: a.length, moved: 0, added: 0, deleted: 0, dtMax: 0, dtSum: 0, dpMax: 0, dpSum: 0, where: { turn: 0, mid: 0, hold: 0 } };
  if (ra.length > cap || rb.length > cap) { out.added = rb.length; out.deleted = ra.length; out.capped = true; return out; }
  const pairs = [];
  for (const i of ra) for (let j = 0; j < rb.length; j++) { const dt = Math.abs(a[i].at - rb[j].at); if (dt <= tol) pairs.push([dt, i, j]); }
  pairs.sort((x, y) => x[0] - y[0]);
  const ua = new Set(), ub = new Set();
  for (const [, i, j] of pairs) {
    if (ua.has(i) || ub.has(j)) continue;
    ua.add(i); ub.add(j);
    const dt = Math.abs(rb[j].at - a[i].at), dp = Math.abs(rb[j].pos - a[i].pos);
    out.moved++; out.dtSum += dt; out.dpSum += dp; out.dtMax = Math.max(out.dtMax, dt); out.dpMax = Math.max(out.dpMax, dp);
    out.where[where(i)]++;
  }
  for (const i of ra) if (!ua.has(i)) { out.deleted++; out.where[where(i)]++; }
  out.added = rb.length - ub.size;
  return out;
}
/** The points of a script in [t0, t1]. */
export const slice = (s, t0, t1) => (s || []).filter((p) => p.at >= t0 && p.at <= t1);

// ---- events -> facts ----
const F = (kind, o = {}) => ({ kind, ...o });
// edit:commit labels (the undo step's name) -> facts. d = the step's diff (live only). The first match wins.
const COMMIT = [
  [/^Detect scenes$|^Group shots into scenes$/, () => F('auto:shots.detect', { scope: 'video' })],
  [/^Camera moves inside a loop joined$/, () => F('auto:shots.loopJoin', { scope: 'video' })],   // paw-ef73.4: kept, or a later cut / split there
  [/^Cuts tracked through: camera moves$|^Boundaries: camera moves$/, () => F('ok:structure.cameraMoves')],
  [/^Groups: suggest$/, (m, d) => F('auto:seed.suggest', { auto: d?.scenes?.groups ? { n: d.scenes.groups.added.length + d.scenes.groups.changed.length } : undefined })],
  [/^Groups: re-found after a cut$/, () => F('auto:seed.refind')],
  [/^Groups: accept (suggestions|.+)$|^Accept re-found groups$/, (m) => F('ok:seed.accept', { key: m[1] && m[1] !== 'suggestions' ? m[1] : '', manual: { group: m[1] || 'all' } })],
  [/^Groups: move to this frame$/, () => F('fix:seed.frame')],
  // paw-8mf4: a take filled from a repeated frame on selecting it (kept = an episode without fixes; edits of its groups are
  // repaints of a suggested group, src repeat / run), and the owner dropping that fill
  [/^Groups: auto from (the run at )?(.+)$/, (m) => F('auto:seed.repeat', { auto: { from: m[2], kind: m[1] ? 'run' : 'repeat' } })],
  [/^Groups: drop the filled groups$/, () => F('fix:seed.dropFill')],
  [/^Groups: paint (.+)$/, (m, d) => {
    const g = d?.scenes?.groups, was = g?.before?.[m[1]];
    if (was?.suggested) return F('fix:seed.repaint', { key: m[1], manual: { group: m[1], src: was.source } });
    return F('fix:seed.paint', { key: m[1], manual: { group: m[1], ...(g ? (was ? { own: true } : { new: true, suggested: g.suggested }) : {}) } });
  }],
  [/^Groups: erase (.+)$/, (m, d) => {
    const g = d?.scenes?.groups, gone = g?.removed?.includes(m[1]), was = g?.before?.[m[1]];
    return F(gone ? 'fix:seed.delete' : was?.suggested ? 'fix:seed.repaint' : 'fix:seed.paint', { key: m[1], manual: { group: m[1], erase: true, ...(was ? { suggested: was.suggested } : {}) } });
  }],
  [/^Groups: (?:assign|rename) (\S+) → (\S+)$/, (m, d) => (isUnassigned(m[1]) ? F('fix:seed.name', { key: m[2], manual: { group: m[2] } })
    : F('fix:seed.reassign', { key: m[1], manual: { from: m[1], to: m[2], ...(d?.scenes?.groups?.before?.[m[1]] ? { suggested: d.scenes.groups.before[m[1]].suggested } : {}) } }))],
  [/^Groups: swap (?:C1 and C2|Bottom and Top)$/, () => F('fix:seed.swapWho')],
  [/^Groups: swap (\S+) ↔ (\S+)$/, (m) => F('fix:seed.reassign', { key: m[1], manual: { from: m[1], to: m[2], swap: true } })],
  [/^Groups: delete (.+)$/, (m, d) => F('fix:seed.delete', { key: m[1], manual: { group: m[1], ...(d?.scenes?.groups?.before?.[m[1]] ? { suggested: d.scenes.groups.before[m[1]].suggested } : {}) } })],
  [/^Groups: (?:move|scale) (.+)$/, (m) => F('fix:seed.move', { key: m[1], manual: { group: m[1] } })],
  [/^Groups: (?:split|drop patches of) (.+)$/, (m) => F('fix:seed.split', { key: m[1], manual: { group: m[1] } })],
  [/^Groups: (pulse|no pulse|depth|no depth|use|skip) (.+)$/, (m) => F('fix:seed.flag', { key: m[2], manual: { group: m[2], flag: m[1] } })],
  [/^Groups: (\S+) → (\S+)$/, (m) => F('fix:seed.reassign', { key: m[1], manual: { from: m[1], to: m[2] } })],
  [/^Merge (scenes|shots)$|^One scene with cutaways$|^Join /, () => F('fix:structure.merge')],
  [/^(Split scene|New scene|Boundary: scene|Start a new scene)/, () => F('fix:structure.split')],
  [/^Shots?: (hard cut|same take)$/, (m) => F('fix:structure.take', { manual: { to: m[1] } })],
  [/^(Cut|Split shot|Move cut|Move scene cut|Move scene boundary.*|Delete (shot|cut|scene)s?|Remove cut)$/i, (m, d, ev) => (onScenes(ev) ? F('fix:structure.cut', { manual: { what: m[1] } }) : undefined)],
  [/^Scene tag: (Off-screen|Internal|Exposed|Blank)$|^Tag: (Off-screen|Internal|Exposed|Blank) \(/i, (m) => F('fix:structure.offscreen', { key: (m[1] || m[2]).toLowerCase(), manual: { tag: m[1] || m[2] } })],
  [/^Scene tag: (.+)$|^Tag: (.+) \(\d+ shots?\)$|^Scene tags$/, (m) => F('fix:structure.tag', { key: m[1] || m[2] || '', manual: { tag: m[1] || m[2] || 'tags' } })],
  [/^(Scene|Shot)s? fill (.+)$|^Scene fill timing/, (m) => F('fix:structure.fill', { manual: { to: m[2] || 'timing' } })],
  [/^Scene continues the action$|^Drop offered tags/, () => F('fix:structure.continues')],
  [/^Accept fills?\b|^Accept bridge$/, () => F('auto:fill.accept')],
  [/^Accept Effects on the stroke/, () => null],   // (Accept and its labels are gone since 2e31f7a / paw-x7w7: these rules read older logs)
  [/^Accept (.+) \((replace|merge)\)(?: \+ (\d+) fills?)?$/, (m) => F('auto:strokes.accept', { auto: { run: m[1].slice(0, 60), mode: m[2], ...(m[3] ? { fills: +m[3] } : {}) } })],   // paw-essc: + the fills Accept took
  [/^Bake (?!")(.+)$/, (m) => F('auto:strokes.bake', { auto: { what: m[1].slice(0, 60) } })],   // paw-x7w7: the live points made permanent
  [/^Unbake /, () => F('fix:strokes.unbake')],
  [/^Simplify/, () => F('fix:strokes.simplify')],
  [/^Smart stroke (on|off)$/, (m) => F('fix:strokes.smart', { manual: { to: m[1] } })],
  [/^Detail: (.+?)(?: \((scene|shot|area)\))?$/, (m) => F('fix:strokes.detail', { key: m[2] || 'scene', manual: { to: m[1], level: m[2] || 'scene' } })],
  [/^Strokes: (.+)$/, (m) => F('fix:strokes.step', { key: m[1], manual: { what: m[1] } })],
  [/^Signal: source of a range$/, () => F('fix:signal.range', { key: 'source' })],
  [/^Signal: source$/, () => F('fix:signal.source')],
  [/^Signal: measured against( \(range\))?$/, (m) => F(m[1] ? 'fix:signal.range' : 'fix:signal.against', { key: 'against' })],
  [/^Signal: camera( removal| of a range)$|^Camera (mode|strength|smoothing)/, (m) => F(m[1] === ' of a range' ? 'fix:signal.range' : 'fix:signal.camera', { key: 'cam' })],
  [/^Signal: /, () => F('fix:signal.range')],
  [/^Stroke axis/, () => F('fix:signal.axis')],
  [/^Fusion: /, () => F('fix:signal.fuse')],
  [/^Shaft: /, () => F('fix:signal.shaft')],
  [/^Adjust after tracking$/, () => F('fix:signal.derive')],
  [/^Autorange on$/, () => F('auto:finish.autorange', { scope: 'video' })],
  [/^Autorange off$/, () => F('fix:finish.autorangeOff', { scope: 'video' })],
  [/^Autorange: (fill|apply)|^Flatten /, () => null],
  [/^Autorange policy|^Autorange: (?!fill|apply|lock|leave|back|clear|S\d)\w+$/, () => F('fix:finish.policy', { scope: 'video' })],
  [/^Autorange: (S\d+ range|lock|leave|back to|clear)|^Range: /, (m) => F('fix:finish.range', { manual: { what: m[0].slice(0, 40) } })],
  [/^Add (\d+ )?spurts? \((proposed cumshots|balls contraction peaks)/, (m) => F('auto:spurts.place', { auto: { n: +(m[1] || 1), from: m[2].startsWith('balls') ? 'balls' : 'proposals' } })],
  [/^Add (spurt|a single throb)( \((linked|orgasm grown)\))?$/, (m) => F('fix:spurts.hand', { key: m[1] === 'spurt' ? 'spurt' : 'throb', manual: { kind: m[1] === 'spurt' ? 'spurt' : 'throbbing' } })],
  // modifiers (paw-ef73.20): one object, every edit a doc.fx step
  [/^(?:Mark|Add) (Orgasm|Knotting|Throbbing|Idle|push|pull|Reshape)$|^Duplicate modifiers?$/, (m) => F('fix:fx.add', { key: m[1] || 'copy', manual: { kind: m[1] || 'copy' } })],
  [/^(?:Remove|Delete) (?:modifiers?|Orgasm|Knotting|Throbbing|Idle|Reshape|Spurt|spurt)$/, () => F('fix:fx.remove')],
  [/^(Move|Resize|Scale) modifiers?$|^Grow orgasm$/, () => F('fix:fx.retime')],
  [/^Modifier: (.+)$|^(?:Throbbing|Reshape|Knotting|Insertion|Pull-out): |^Modifier kind: /, (m) => F('fix:fx.params', { key: m[1] || '', manual: { kind: m[1] || m[0].replace(/:.*/, '') } })],
  [/^(Mute|Unmute|Un-bake) modifier$/, (m) => F('fix:fx.params', { manual: { what: m[1].toLowerCase() } })],
];
// labels of steps that change points but are not the owner's hand edits (generated, imported, another feature's tool)
const NOT_HAND = /^(Accept|Unbake|Assist|Director|Import|Compile|Fix( all)?:|Limit speed|Re-tile|Remove loop tiles|Detach|Adopt|Add .* axis|Remove axis|Autorange|Flatten|Bake|Simplify|Graph|Draft)/;
const onScenes = (ev) => /(^|,)scenes(,|$)/.test(String(ev?.paths || ''));

/** A fact's span from a step's diff: the scenes / fx / axis that changed. */
function spanOf(d) {
  const x = d?.scenes?.t1 >= d?.scenes?.t0 ? d.scenes : d?.fx?.t1 >= d?.fx?.t0 ? d.fx : d?.axes?.[0];
  return x ? { t0: Math.round(x.t0), t1: Math.round(x.t1) } : {};
}
// diff values a kind shows as from -> to
const VALUE_OF = { 'fix:signal.source': 'derive.source', 'fix:signal.against': 'derive.against', 'fix:signal.camera': 'derive.cam', 'fix:signal.axis': 'derive.axis', 'fix:signal.fuse': 'derive.fuse',
  'fix:signal.shaft': 'derive.shaft', 'fix:strokes.smart': 'derive.smart', 'fix:strokes.step': 'derive.strokes', 'fix:strokes.detail': 'detail', 'fix:structure.fill': 'fill', 'fix:finish.range': 'range', 'fix:signal.range': 'signal' };
const SETTINGS_QUIET = /^(machine\.|layout|lanes\.layout|tracking\.groups\.brush|video\.ui|tracking\.laneGroups|tracking\.trails|palette|keys\.)/;
const overlap = (a, b) => Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0) >= 0.5 * Math.min(a.t1 - a.t0, b.t1 - b.t0);

/** Stateful classifier: one usage-style event -> facts (see the header). One per session stream. */
export class Detector {
  lastCommit = null; settings = new Map(); runs = []; pending = [];
  see(ev) {
    try { return this.#see(ev).filter(Boolean).map((f) => ({ t: ev.t, s: ev.s, ...f })); } catch (e) { console.warn('[fixlog]', e); return []; }
  }
  #see(ev) {
    const k = ev.k, t = ev.t;
    if (k === 'edit:commit') {
      const label = String(ev.label || ''), d = ev.diff;
      this.lastCommit = { label, t };
      let f;
      for (const [re, fn] of COMMIT) { const m = label.match(re); if (m && (f = fn(m, d, ev)) !== undefined) break; }
      if (f === undefined) f = this.#byDiff(label, ev, d);
      if (!f) return [];
      const v = VALUE_OF[f.kind] && d?.scenes?.keys?.[VALUE_OF[f.kind]];
      if (v && !(f.manual && 'to' in f.manual)) f.manual = { ...f.manual, ...(v[0] != null ? { from: clip(v[0], 80) } : {}), to: v[1] == null ? 'default' : clip(v[1], 80) };
      if (d?.fx && f.kind.startsWith('fix:fx.')) {
        const e = d.fx.changed[0] || d.fx.removed[0] || d.fx.added[0];
        if (e) f.manual = { ...f.manual, kind: e.kind, ...(e.what ? { what: e.what } : {}), ...(e.dt ? { dt: e.dt } : {}), n: d.fx.changed.length + d.fx.removed.length + d.fx.added.length };
        if (e?.kind === 'knotting' && f.kind !== 'fix:fx.add') f.kind = 'fix:fx.knotting';
        if (e?.kind === 'spurt' && f.kind === 'fix:fx.remove') f.kind = 'fix:spurts.drop';
        if (e?.kind === 'spurt' && f.kind === 'fix:fx.retime') f.kind = 'fix:spurts.move';
      }
      if (d?.finish && f.kind === 'fix:finish.policy') f.manual = { ...f.manual, ...d.finish };
      if (f.scope !== 'video') Object.assign(f, spanOf(d));
      if (f.t0 != null) this.lastCommit.t0 = f.t0, this.lastCommit.t1 = f.t1;   // an undo of it lands on its span
      if (f.kind.startsWith('auto:strokes') || f.kind === 'auto:fill.accept' || f.kind === 'fix:strokes.points' || f.kind === 'fix:strokes.unbake') { const a = d?.axes?.[0]; if (a) f.axis = a.axis; }
      return [f];
    }
    if (k === 'edit:undo') {
      const label = ev.label, c = this.lastCommit;
      if (label == null) return [];
      const out = [];
      if (/^Accept .* \((replace|merge)\)(?: \+ \d+ fills?)?$|^Accept fill|^Accept bridge$/.test(label) && !/Effects on the stroke/.test(label)) out.push(F('fix:strokes.acceptUndone', { manual: { label: clip(label, 80) } }));
      else if (c && c.label === label && t - c.t <= UNDO_MS) out.push(F('fix:generic.undo', { key: label, ...(c.t0 != null ? { t0: c.t0, t1: c.t1 } : {}), manual: { label: clip(label, 80), s: Math.round((t - c.t) / 100) / 10 } }));
      this.lastCommit = null;
      return out;
    }
    if (k === 'tracking:runStart') {
      if ((ev.label && ev.label !== 'track') || ev.tag === 'camera') return [];
      const r = { t, t0: ev.t0, t1: ev.t1, tracker: ev.tracker, params: ev.params || '{}', direction: ev.direction || 'both', seed: ev.seed ?? null };
      const prev = [...this.runs].reverse().find((q) => overlap(q, r));
      this.runs.push(r); this.pending.push(r);
      if (this.runs.length > 50) this.runs.shift();
      if (!prev) return [];
      return [F('fix:track.retrack', { t0: r.t0, t1: r.t1, manual: runChanges(prev, r) })];
    }
    if (k === 'tracking:runEnd') {
      const i = this.pending.findLastIndex((q) => q.tracker === ev.tracker), r = i >= 0 ? this.pending.splice(i, 1)[0] : null;
      const sp = r ? { t0: r.t0, t1: r.t1 } : {};
      if (ev.cancelled) return [F('fix:track.cancel', { ...sp, manual: { tracker: ev.tracker, s: Math.round((ev.ms || 0) / 1000) } })];
      if (ev.error) return [F('fix:track.error', { ...sp, manual: { tracker: ev.tracker, error: clip(ev.error, 80) } })];
      return [F('auto:track.run', { ...sp, auto: { run: ev.run, tracker: ev.tracker, picked: ev.picked || undefined, points: ev.points, ...(ev.lowMotion ? { lowMotion: true } : {}), ...(r?.direction && r.direction !== 'both' ? { direction: r.direction } : {}) } })];
    }
    if (k === 'tracking:discard') return [F('fix:track.discard', { key: ev.run, manual: { run: ev.run, tracker: ev.tracker } })];
    if (k === 'tracking:setChannel') return [F('fix:signal.channel', { key: String(ev.scene ?? ''), shotIndex: ev.scene >= 0 ? ev.scene : undefined, manual: { from: ev.from, to: ev.to, ...(ev.sidecar ? { sidecar: ev.sidecar } : {}) } })];
    if (k === 'tracking:flip') return [F('fix:signal.flip', { t0: ev.t0, t1: ev.t1, manual: { run: ev.run, ...(ev.all ? { all: true } : {}) } })];
    if (k === 'tracking:orient') return [F('fix:signal.flip', { t0: ev.t0, t1: ev.t1, manual: { run: ev.run, span: true, sign: ev.sign } })];
    if (k === 'tracking:repeatDirection') return [F('auto:signal.direction', { t0: ev.t0, t1: ev.t1, auto: { run: ev.run, from: ev.from, n: ev.n, r: ev.r } })];   // paw-zl3n: kept, or a later signal.flip on the span
    if (k === 'tracking:describe') return [F('auto:describe', { shotIndex: +(ev.d ?? -1) })];
    if (k === 'timeline:cum.detect') return [F('auto:spurts.detect')];
    if (k === 'scenes:continuesProposed') return [F('auto:structure.proposals', { scope: 'video' })];
    if (k === 'settings:set') {
      if (SETTINGS_QUIET.test(ev.key || '') || !('to' in ev)) return [];   // a private setting is logged by its key only: no values to compare
      const was = this.settings.get(ev.key);
      if (was && t - was.t <= REVERT_MS && J(ev.to) === J(was.from)) { this.settings.delete(ev.key); return [F('fix:settings.revert', { key: ev.key, manual: { key: ev.key, via: clip(ev.from, 60), back: clip(ev.to, 60) } })]; }
      if (!was || t - was.t > REVERT_MS) this.settings.set(ev.key, { from: ev.from, t });
      return [];
    }
    return [];
  }
  // a step no label rule knows: the points by hand, else what its diff says changed
  #byDiff(label, ev, d) {
    const paths = String(ev.paths || '');
    if (/(^|,)axes\./.test(paths) && !/(^|,)(scenes|fx|finish)(,|$)/.test(paths)) return NOT_HAND.test(label) ? null : F('fix:strokes.points', { key: '', manual: { label: clip(label, 40) } });
    const sc = d?.scenes;
    if (!sc) return null;
    if (sc.cuts.added.length || sc.cuts.removed.length) return F('fix:structure.cut', { manual: { added: sc.cuts.added.length, removed: sc.cuts.removed.length } });
    if (sc.joins.merged.length) return F('fix:structure.merge');
    if (sc.joins.split.length) return F('fix:structure.split');
    const key = Object.keys(sc.keys)[0];
    const map = { 'derive.source': 'fix:signal.source', 'derive.cam': 'fix:signal.camera', 'derive.axis': 'fix:signal.axis', 'derive.against': 'fix:signal.against', 'derive.smart': 'fix:strokes.smart', detail: 'fix:strokes.detail', fill: 'fix:structure.fill', range: 'fix:finish.range', signal: 'fix:signal.range', tags: 'fix:structure.tag' };
    return key && map[key] ? F(map[key], { manual: { label: clip(label, 40) } }) : null;
  }
}
/** What changed between two runs of one span: tracker, params, direction, seed (frames at 30 fps), range. */
export function runChanges(a, b) {
  const out = {};
  if (a.tracker !== b.tracker) out.tracker = [a.tracker, b.tracker];
  let pa = {}, pb = {};
  try { pa = JSON.parse(a.params || '{}'); pb = JSON.parse(b.params || '{}'); } catch { /* clipped JSON: compare the text */ if (a.params !== b.params) out.params = [clip(a.params, 60), clip(b.params, 60)]; }
  for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (J(pa[k]) !== J(pb[k])) (out.params ??= {})[k] = [clip(pa[k] ?? 'default', 30), clip(pb[k] ?? 'default', 30)];
  if (a.direction !== b.direction) out.direction = [a.direction, b.direction];
  if (a.seed != null && b.seed != null && a.seed !== b.seed) out.seedMs = Math.round(b.seed - a.seed);
  if (Math.abs(a.t0 - b.t0) > 50 || Math.abs(a.t1 - b.t1) > 50) out.range = [mmss(a.t0) + '–' + mmss(a.t1), mmss(b.t0) + '–' + mmss(b.t1)];
  return out;
}

// ---- facts -> episodes ----
const isFix = (k) => k.startsWith('fix:'), isAuto = (k) => k.startsWith('auto:'), isOk = (k) => k.startsWith('ok:');
const step = (k) => k.slice(k.indexOf(':') + 1);
/**
 * Groups facts (sorted by t) into episodes. A fact joins the open episode of its session + project whose video span
 * holds its time (t0..t1 middle, else at), else the latest open one when it has no time, else a new episode over its
 * scene (sceneT0 / sceneT1, else its own span, else at +- NEAR_MS). scope 'video' facts share one episode per project.
 * An episode closes after idleMs without a fact, or on closeAll; onClose(record) gets the record (see toRecord).
 */
export class Grouper {
  open = []; seq = 0;
  constructor({ idleMs = IDLE_MS, onClose = () => {} } = {}) { this.idleMs = idleMs; this.onClose = onClose; }
  add(f) {
    this.closeIdle(f.t);
    const mine = this.open.filter((e) => e.s === f.s && e.project === (f.project ?? ''));
    const mid = f.t0 != null ? (f.t0 + f.t1) / 2 : f.at;
    let ep = f.scope === 'video' ? mine.find((e) => e.video0) : mid != null ? mine.find((e) => !e.video0 && e.t0 != null && mid >= e.t0 - 1 && mid <= e.t1 + 1) : mine.filter((e) => !e.video0).sort((a, b) => b.last - a.last)[0];
    if (!ep) {
      const sp = f.scope === 'video' ? {} : f.sceneT1 > f.sceneT0 ? { t0: f.sceneT0, t1: f.sceneT1 } : f.t0 != null ? { t0: f.t0, t1: f.t1 } : f.at != null ? { t0: f.at - NEAR_MS, t1: f.at + NEAR_MS } : {};
      ep = { id: ++this.seq, s: f.s, project: f.project ?? '', video: f.video, video0: f.scope === 'video', scene: f.scene, shot: f.shot, ...sp, first: f.t, last: f.t, items: [], notes: [] };
      this.open.push(ep);
    }
    ep.last = f.t;
    if (ep.scene == null && f.scene != null) { ep.scene = f.scene; ep.shot = f.shot; }
    if (f.kind === 'note') { ep.notes.push(f); return ep; }
    const same = isFix(f.kind) ? ep.items.find((x) => x.kind === f.kind && (x.key ?? '') === (f.key ?? ''))
      : ep.items.find((x) => x.kind === f.kind && (x.auto?.tracker ?? '') === (f.auto?.tracker ?? ''));   // Autorange on 3x; one line per tracker
    if (same) { same.n++; same.t1 = f.t; if (same.chain.length < 12) same.chain.push(f.manual ?? null); if (f.points) same.points = f.points; }
    else ep.items.push({ kind: f.kind, key: f.key, t: f.t, t1: f.t, n: 1, ...(f.auto ? { auto: f.auto } : {}), chain: [f.manual ?? null], ...(f.points ? { points: f.points } : {}), ...(f.at != null ? { at: f.at } : {}) });
    return ep;
  }
  closeIdle(now) { for (const e of [...this.open]) if (now - e.last > this.idleMs) this.#close(e); }
  closeAll() { for (const e of [...this.open]) this.#close(e); }
  #close(e) { this.open = this.open.filter((x) => x !== e); this.onClose(toRecord(e)); }
}
/** An open episode -> its fixes.jsonl record {t, s, kind: 'episode', project, video, scene, shot, t0, t1, auto, ok, fixes,
 *  notes, cost: {s, n}, text}. cost: seconds from the first automatic output (else the first action) to the last fix. */
export function toRecord(e) {
  const autos = e.items.filter((x) => isAuto(x.kind)), fixes = e.items.filter((x) => isFix(x.kind)), oks = e.items.filter((x) => isOk(x.kind));
  const anchor = autos.length ? autos[0].t : e.first, lastFix = fixes.length ? Math.max(...fixes.map((x) => x.t1)) : anchor;
  const fix = (x) => ({ kind: x.kind, ...(x.key ? { key: x.key } : {}), n: x.n, t: new Date(x.t).toISOString(), s: Math.max(0, Math.round((x.t1 - anchor) / 1000)), manual: x.chain[x.chain.length - 1], ...(x.n > 1 ? { chain: x.chain } : {}), ...(x.points ? { points: x.points } : {}) });
  const r = {
    t: new Date(e.first).toISOString(), s: e.s, kind: 'episode', project: e.project, ...(e.video ? { video: e.video } : {}), ...(e.scene != null ? { scene: e.scene, shot: e.shot } : {}),
    ...(e.t0 != null ? { t0: Math.round(e.t0), t1: Math.round(e.t1) } : { whole: true }),
    auto: autos.map((x) => ({ step: step(x.kind), t: new Date(x.t).toISOString(), ...(x.n > 1 ? { n: x.n } : {}), ...(x.auto || x.chain[0] ? { what: x.auto || x.chain[0] } : {}) })),
    ok: oks.map((x) => ({ step: step(x.kind), n: x.n, ...(x.key ? { key: x.key } : {}) })),
    fixes: fixes.map(fix),
    notes: e.notes.map((n) => ({ t: new Date(n.t).toISOString(), id: n.id, tone: n.tone, text: n.text })),
    cost: { s: fixes.length ? Math.max(0, Math.round((lastFix - anchor) / 1000)) : 0, n: fixes.reduce((s, x) => s + x.n, 0) },
  };
  r.text = describe(r);
  return r;
}

// ---- plain sentences ----
const ft = (v) => (Array.isArray(v) ? v.map((x) => clip(x, 30)).join(' -> ') : clip(v, 40));
/** from -> to -> to ... of a chain of {from, to} (consecutive repeats once). */
const fromTo = (x) => { const ch = (x.chain || [x.manual]).filter((m) => m && 'to' in m), v = ch.length ? [ch[0].from, ...ch.map((m) => m.to)].filter((y) => y != null).map((y) => clip(y, 30)) : []; return v.filter((y, i) => y !== v[i - 1]).join(' -> '); };
const chainText = (x, f) => { const vals = (x.chain || [x.manual]).map(f).filter(Boolean); return [...new Set(vals)].join(' -> '); };
const times = (x) => (x.n > 1 ? ` ${x.n}x` : '');
const PHRASE = {
  'seed.paint': (x) => `painted ${chainText(x, (m) => m?.group)}${x.manual?.new ? ` from scratch (${x.manual.suggested ?? 0} suggestions in the take)` : ''}${times(x)}`,
  'seed.repaint': (x) => `repainted suggestion ${chainText(x, (m) => m?.group)}${times(x)}`,
  'seed.name': (x) => `named a painted group ${x.key}`,
  'seed.reassign': (x) => `reassigned ${chainText(x, (m) => m && `${m.from} -> ${m.to}`)}${x.manual?.suggested ? ' (a suggestion)' : ''}`,
  'seed.swapWho': (x) => `swapped Bottom and Top${times(x)}`,
  'seed.delete': (x) => `deleted ${x.manual?.suggested === false ? 'painted group' : 'suggestion'} ${chainText(x, (m) => m?.group)}${times(x)}`,
  'seed.move': (x) => `moved / scaled ${x.key}${times(x)}`, 'seed.split': (x) => `split ${x.key}`, 'seed.flag': (x) => `set ${chainText(x, (m) => m?.flag)} on ${x.key}`,
  'seed.frame': () => 'moved the groups to another frame', 'seed.dropFill': (x) => `dropped the groups filled from a repeat${times(x)}`,
  'track.retrack': (x) => `re-tracked${times(x)} (${chainText(x, (m) => (m ? Object.entries(m).map(([k, v]) => k === 'params' && !Array.isArray(v) ? Object.entries(v).map(([p, w]) => `${p} ${ft(w)}`).join(', ') : k === 'seedMs' ? `seed ${v > 0 ? '+' : ''}${v} ms` : `${k} ${ft(v)}`).join(', ') || 'same settings' : ''))})`,
  'track.cancel': (x) => `cancelled tracking${times(x)}`, 'track.error': (x) => `tracking failed: ${x.manual?.error}`, 'track.discard': (x) => `deleted run ${chainText(x, (m) => m?.run)}`,
  'signal.channel': (x) => `picked channel ${chainText(x, (m) => m?.to)} (sidecar had ${x.chain?.[0]?.sidecar || x.chain?.[0]?.from || '?'})`,
  'signal.source': (x) => `changed source ${fromTo(x)}${times(x)}`.replace('  ', ' '),
  'signal.against': (x) => `changed "measured against" ${fromTo(x)}`, 'signal.camera': (x) => `changed camera removal ${fromTo(x)}${times(x)}`,
  'signal.range': (x) => `range override (${x.key || 'edit'})${times(x)}`, 'signal.axis': (x) => `redrew the stroke axis${times(x)}`, 'signal.flip': (x) => `flipped direction${x.manual?.span ? ' of a span' : x.manual?.all ? ' of the whole run' : ''}${times(x)}`,
  'signal.fuse': (x) => `pinned / excluded fusion parts${times(x)}`, 'signal.shaft': (x) => `marked the shaft${times(x)}`, 'signal.derive': (x) => `adjusted after tracking${times(x)}`,
  'strokes.detail': (x) => `detail (${x.manual?.level || x.key}) ${chainText(x, (m) => m?.to)}`, 'strokes.simplify': (x) => `simplified${times(x)}`, 'strokes.smart': (x) => `Smart stroke ${chainText(x, (m) => m?.to)}`,
  'strokes.step': (x) => `strokes ${x.key}${times(x)}`, 'strokes.acceptUndone': () => 'undid the Accept', 'strokes.unbake': (x) => `unbaked${times(x)}`,
  'strokes.points': (x) => { const p = x.points; return p ? `points by hand: moved ${p.moved}, added ${p.added}, deleted ${p.deleted} of ${p.n} (max ${p.dpMax} units, ${p.dtMax} ms; turn ${p.where.turn}, mid ${p.where.mid}, hold ${p.where.hold})` : `edited points by hand${times(x)}`; },
  'finish.autorangeOff': () => 'turned Autorange off', 'finish.policy': (x) => `changed the Autorange policy${times(x)}`, 'finish.range': (x) => `edited the Autorange band${times(x)}`,
  'fx.add': (x) => `added ${chainText(x, (m) => m?.kind)} modifier${times(x)}`, 'fx.remove': (x) => `removed ${chainText(x, (m) => m?.kind)} modifier${times(x)}`, 'fx.retime': (x) => `retimed ${chainText(x, (m) => m?.kind)} modifier${times(x)}`,
  'fx.params': (x) => `edited ${chainText(x, (m) => m?.kind || m?.what)} modifier${times(x)}`, 'fx.knotting': (x) => `edited the Knotting fit${times(x)}`,
  'spurts.hand': (x) => `placed ${x.n} ${x.key || 'spurt'} marker${x.n > 1 ? 's' : ''} by hand`, 'spurts.drop': (x) => `dropped ${x.n} spurt${x.n > 1 ? 's' : ''}`, 'spurts.move': (x) => `moved spurts${times(x)}`,
  'structure.cut': (x) => `changed cuts${times(x)}`, 'structure.merge': (x) => `merged${times(x)}`, 'structure.split': (x) => `split a scene${times(x)}`, 'structure.take': (x) => `cut kind ${chainText(x, (m) => m?.to)}`,
  'structure.offscreen': (x) => `marked ${x.manual?.tag || x.key}${times(x)}`, 'structure.tag': (x) => `tag ${chainText(x, (m) => m?.tag)}`, 'structure.fill': (x) => `fill ${chainText(x, (m) => m?.to)}`,
  'structure.continues': () => 'set "continues the action"',
  'generic.undo': (x) => `undid "${x.key}" within 10 s${times(x)}`, 'settings.revert': (x) => `set ${x.key} and back`,
};
const AUTO_PHRASE = { 'track.run': (a) => `tracked${a.what?.tracker ? ` (${a.what.tracker}${a.what.picked ? ', picked ' + a.what.picked : ''})` : ''}`, 'seed.suggest': (a) => `Suggest${a.what?.n != null ? ` (${a.what.n} groups)` : ''}`,
  'strokes.accept': () => 'accepted the run', 'strokes.bake': () => 'baked', 'fill.accept': () => 'accepted a fill', 'shots.detect': () => 'detected scenes', 'shots.loopJoin': () => 'joined camera moves inside a loop', 'spurts.detect': () => 'detected cumshots', 'spurts.place': (a) => `placed ${a.what?.n ?? ''} proposed spurts`,
  'finish.autorange': () => 'Autorange on', describe: () => 'described', 'seed.refind': () => 're-found groups', 'seed.repeat': (a) => `filled groups from ${a.what?.kind === 'run' ? 'the run at ' : ''}${a.what?.from ?? 'a repeat'}`, 'signal.direction': (a) => `direction from ${a.what?.from ?? 'a repeat'} (same frames)`, 'structure.proposals': () => 'proposed scene continuations' };
/** One episode record -> one line ("S3 · shot 12 (1:23.4–1:31.0): tracked (...); changed source ...; 85 s, 14 actions"). */
export function describe(r) {
  const where = r.whole ? 'whole video' : `${r.scene != null ? `S${r.scene} · shot ${r.shot} ` : ''}(${mmss(r.t0)}–${mmss(r.t1)})`;
  const parts = [...r.auto.map((a) => (AUTO_PHRASE[a.step] || (() => a.step))(a) + (a.n > 1 ? ` ${a.n}x` : '')), ...r.ok.map((o) => `confirmed ${o.step}${o.n > 1 ? ` ${o.n}x` : ''}`),
    ...r.fixes.map((x) => (PHRASE[step(x.kind)] || (() => step(x.kind)))(x)), ...r.notes.map((n) => `note "${clip(n.text, 60)}"`)];
  return `${where}: ${parts.join('; ') || 'nothing'}${r.cost.n ? ` · ${r.cost.s} s, ${r.cost.n} action${r.cost.n > 1 ? 's' : ''}` : ''}`;
}

// ---- live ----
/** A video's id for the logs: 'n' + a hash of its file name (never the folder; the same before and after the project
 *  first saves, unlike media.hash which only exists once it has). '' without media. */
export function projectId(media) {
  if (!media) return '';
  let h = 0x811c9dc5;
  for (const c of String(media.name || media.path?.split(/[\/]/).pop() || '')) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return 'n' + h.toString(16).padStart(8, '0');
}
/** Shot / scene of video time t in a shot list: {shot (1-based), scene (1-based), sceneT0, sceneT1} or {}. */
export function whereIn(scenes, t) {
  if (!Array.isArray(scenes) || !scenes.length || !Number.isFinite(t)) return {};
  let k = scenes.findIndex((s) => t >= s.start_ms && t < s.end_ms);
  if (k < 0) k = t < scenes[0].start_ms ? 0 : scenes.length - 1;
  let scene = 0;
  for (let i = 0; i <= k; i++) if (!(i && scenes[i].join === true)) scene++;
  let lo = k, hi = k;
  while (lo > 0 && scenes[lo].join === true) lo--;
  while (hi + 1 < scenes.length && scenes[hi + 1].join === true) hi++;
  return { shot: k + 1, scene, sceneT0: scenes[lo].start_ms, sceneT1: scenes[hi].end_ms };
}

/**
 * The live fix log. deps: enabled() (setting usage.log), note(kind, data) (the usage log: raw facts go there),
 * sink {append(text)} | null (fixes.jsonl), ctx() -> {project, video, at, scenes}, axis(id) -> the script now,
 * now() (ms), sid() (the usage log's session id). record(label, patches) after every undo step, event(ev) for every usage event, tick() to close idle
 * episodes, closeAll() before the document changes or the app closes.
 */
export class FixLog {
  constructor({ enabled = () => true, note = () => {}, sink = null, ctx = () => ({}), axis = () => null, now = Date.now, idleMs = IDLE_MS, sid = () => '' } = {}) {
    Object.assign(this, { enabled, note, sink, ctx, axis, now, sid });
    this.det = new Detector();
    this.grp = new Grouper({ idleMs, onClose: (r) => this.#closed(r) });
    this.accepts = [];   // [{id, axis, ref (the script the Accept wrote), t0, t1, dirty}]
    this.lines = [];     // fixes.jsonl lines written (no sink: kept here, capped)
    this.aseq = 0;
  }
  record(label, patches) {
    if (!this.#on()) return;
    try { this.#take({ t: this.now(), k: 'edit:commit', label, paths: patches.map((p) => p.path).join(','), diff: diffPatches(patches) }, patches); } catch (e) { console.warn('[fixlog]', e); }
  }
  /** A usage event {t (ms), k, ...data}. Commits come through record(); the log's own facts are skipped. */
  event(ev) {
    if (!this.#on() || !ev?.k || ev.k === 'edit:commit' || /^(fix|auto|ok|episode):/.test(ev.k)) return;
    if (ev.k === 'app:heartbeat') { this.tick(); return; }   // idle episodes close within a minute of going idle
    try { this.#take(ev); } catch (e) { console.warn('[fixlog]', e); }
  }
  /** A feedback note (it lands in the episode at its time, so the log reads it next to what was being fixed). */
  noteFeedback(n) { if (this.#on()) try { this.grp.add(this.#stamp({ t: this.now(), s: this.sid(), kind: 'note', ...n })); } catch (e) { console.warn('[fixlog]', e); } }
  tick() { try { this.grp.closeIdle(this.now()); } catch (e) { console.warn('[fixlog]', e); } }
  closeAll() { try { this.grp.closeAll(); } catch (e) { console.warn('[fixlog]', e); } }
  /** paw-x7w7: a hand edit baked a live shot (app.edit): the app's live points there (ref, the composed script) are what its
   *  hand edits are measured against, as an Accept's were. */
  produced(axis, ref, t0, t1, label) {
    if (!this.#on()) return;
    this.accepts = this.accepts.filter((a) => a.axis !== axis || a.t1 < t0 || a.t0 > t1).slice(-19);
    this.accepts.push({ id: ++this.aseq, axis, ref, t0, t1, dirty: false, label });
  }
  /** A new document: open episodes closed (summarised against the old one), Accept spans and run memory dropped. */
  reset() { this.closeAll(); this.accepts = []; this.det = new Detector(); }
  #on() { try { return this.enabled() !== false; } catch { return false; } }
  #take(ev, patches = null) {
    ev.s ??= this.sid();
    for (const f of this.det.see(ev)) {
      this.#stamp(f);
      if ((f.kind === 'auto:strokes.accept' || f.kind === 'auto:fill.accept' || f.kind === 'auto:strokes.bake') && patches && f.axis) {
        const p = patches.find((x) => x.path === 'axes.' + f.axis);
        // a new Accept over an old one's span replaces it (the old hand edits were summarised at their episode's close)
        this.accepts = this.accepts.filter((a) => a.axis !== f.axis || a.t1 < f.t0 || a.t0 > f.t1).slice(-19);
        if (p) this.accepts.push({ id: ++this.aseq, axis: f.axis, ref: p.after, t0: f.t0, t1: f.t1, dirty: false, label: ev.label });
      } else if (f.kind === 'fix:strokes.acceptUndone') {
        this.accepts = this.accepts.filter((a) => a.label !== ev.label);
      } else if (f.kind === 'fix:strokes.points' && f.axis) {
        for (const a of this.accepts) if (a.axis === f.axis && f.t1 >= a.t0 && f.t0 <= a.t1) { a.dirty = true; f.key = 'accept' + a.id; }
      }
      const ep = this.grp.add(f);
      // the raw fact, with what the app had produced for this target and the cost so far
      const auto = ep.items.filter((x) => x.kind.startsWith('auto:')).at(-1);
      this.note(f.kind, { ...strip(f), ...(auto && f.kind.startsWith('fix:') ? { autoStep: step(auto.kind), autoS: Math.round((f.t - auto.t) / 1000) } : {}) });
    }
  }
  #stamp(f) {
    const c = this.ctx() || {};
    f.project = c.project || ''; if (c.video) f.video = c.video;
    if (f.shotIndex >= 0 && c.scenes?.[f.shotIndex] && f.t0 == null) { f.t0 = c.scenes[f.shotIndex].start_ms; f.t1 = c.scenes[f.shotIndex].end_ms; }
    if (f.scope !== 'video') {
      if (f.t0 == null && Number.isFinite(c.at)) f.at = Math.round(c.at);
      Object.assign(f, whereIn(c.scenes, f.t0 != null ? (f.t0 + f.t1) / 2 : f.at));
    }
    return f;
  }
  #closed(r) {
    try {
      // hand edits inside accepted spans of this episode's video span: summarised now (lazily, once per close)
      for (const a of this.accepts) {
        if (!a.dirty || r.t0 == null || a.t1 < r.t0 || a.t0 > r.t1) continue;
        const cur = this.axis(a.axis);
        if (!cur) continue;
        a.dirty = false;
        const pts = pointEdits(slice(a.ref, a.t0, a.t1), slice(cur, a.t0, a.t1));
        const item = r.fixes.find((x) => x.kind === 'fix:strokes.points' && x.key === 'accept' + a.id);
        const summary = { ...pts, accept: a.id, axis: a.axis, t0: a.t0, t1: a.t1 };
        if (item) item.points = summary; else r.fixes.push({ kind: 'fix:strokes.points', key: 'accept' + a.id, n: 0, t: r.t, s: 0, points: summary });
        this.note('fix:strokes.pointsSummary', { project: r.project, scene: r.scene, shot: r.shot, ...summary });
      }
      r.text = describe(r);
      const line = JSON.stringify(r);
      this.lines.push(line);
      if (this.lines.length > 500) this.lines.shift();
      if (this.#on() && (r.fixes.length || r.auto.length || r.ok.length || r.notes.length)) this.sink?.append(line + '\n');
    } catch (e) { console.warn('[fixlog]', e); }
  }
}
const strip = (f) => { const { t: _t, s: _s, diff: _d, ...r } = f; return r; };   // eslint-disable-line no-unused-vars
