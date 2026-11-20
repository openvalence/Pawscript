// history-diff.js -- what changed between two states of a project, in the app's own terms, grouped by section (paw-up1r
// stage 2): the commit dialog's list, each history entry's summary, the scope of a commit (one shot, one scene, or the
// project) and the restore of one section. Pure (test/app-commit.test.mjs).
//
// A state is the app.load() shape (project-logic.js appDocFrom of a parsed .pawproj): axes {id: [{at, pos}]}, scenes (the
// flat shot list), fx, acts, loops, plan, bookmarks, chapters, graphs, finish, repeats, ghosts, project.{extra, settings}.
// Both sides of a diff come through the same parse, so derived fields compare equal.
//
// Sections are the NEWER state's shots (a scene = a run of joined shots, timeline/shots.js). A change inside one shot's
// time span [start_ms, end_ms) belongs to that shot; a change of the shot list itself (cuts), of chapters, graphs, the
// finishing stack, settings or a block without times belongs to the project. scope: {kind: 'shot' | 'scene', i, t0, t1,
// label} when every change falls in one shot / one scene, else {kind: 'project'}. An entry with a section scope describes
// that section on its own (its snapshot holds the whole document; restoreSection takes only the span), so a section can
// later carry its own versions without a new format.

import { sceneRuns, sceneNo } from '../features/timeline/shots.js';
import { fmtMs } from '../lib/video.js';
import { normRanges } from '../lib/run-ranges.js';

const RUN = new Set(['tracker', 'modrun']);
const SHOT_DERIVED = new Set(['carried', 'positioning', 'scene_describe', 'structure']);
const BLOCK_NAME = { timeline: 'Ruler mode', transitions: 'Fades and dissolves', tracking: 'Tracking axis', loopLinks: 'Loop crop links', review: 'Review marks set aside', draft: 'Draft steps', director: 'Director', assist: 'Assist answers' };
// paw-vhcd: a shot's facts in words (never the field names); anything else is the shot's details
const FACT_WORD = { tags: 'tags', describe: 'tags', groups: 'painted groups', range: 'Autorange band', tease: 'tease mark', offers: 'merge offers', detail: 'Detail', signal: 'source', derives: 'source', fill: 'fill', camera: 'camera', kind: 'kind', transition: 'transition', split: 'cut kind', loop: 'loop', cum: 'cum mark', sign: 'direction', join: 'scene', view: 'view' };
const SKIP_EXTRA = new Set(['scriptFiles', 'published']);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const json = (v) => JSON.stringify(v ?? null);
const isRun = (g) => RUN.has(g?.source?.kind);
const span = (g) => (g?.script?.length ? [g.script[0].at, g.script[g.script.length - 1].at] : null);

export const PROJECT = Object.freeze({ kind: 'project', label: 'Project' });
export const scopeLabel = (s) => (!s || s.kind === 'project' ? 'Project' : s.label || `${s.kind === 'scene' ? 'Scene' : 'Shot'} ${s.i + 1}`);

/** The shot index whose span holds [t0, t1] (t1 = t0 for an instant), -1 when it is outside every shot or crosses a cut. */
export function shotOf(shots, t0, t1 = t0) {
  let lo = 0, hi = shots.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (shots[m].start_ms <= t0) { i = m; lo = m + 1; } else hi = m - 1; }
  if (i < 0) return -1;
  const s = shots[i], last = i === shots.length - 1;
  if (!(t0 < s.end_ms || (last && t0 === s.end_ms))) return -1;
  return t1 <= s.end_ms ? i : -1;   // a span may end on the cut (a modifier, a run's last point)
}

/** Per axis: points added / removed / moved (same time, other position), each counted in the section of its time. */
function diffAxes(a = {}, b = {}, at) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] || [], y = b[k] || [];
    if (x === y) continue;
    if (x.length === y.length) { let same = true; for (let i = 0; i < x.length && same; i++) same = x[i].at === y[i].at && x[i].pos === y[i].pos; if (same) continue; }
    const old = new Map(x.map((p) => [p.at, p.pos])), now = new Set();
    for (const p of y) { now.add(p.at); if (!old.has(p.at)) at(p.at, k, 'add'); else if (old.get(p.at) !== p.pos) at(p.at, k, 'mov'); }
    for (const p of x) if (!now.has(p.at)) at(p.at, k, 'del');
  }
}
/** Lists of things with ids and times (fx, acts, loops, plan, bookmarks, chapters): added / removed / changed. */
function diffById(a = [], b = [], fn, keyOf = (e) => e?.id) {
  const body = (e) => json(keyOf === idKey ? e : { ...e, id: undefined });
  const old = new Map((a || []).filter((e) => keyOf(e) != null).map((e) => [keyOf(e), e])), seen = new Set();
  for (const e of b || []) {
    const k = keyOf(e);
    if (k == null) continue;
    seen.add(k);
    const o = old.get(k);
    if (!o) fn('added', e); else if (body(o) !== body(e)) fn('changed', e, o);
  }
  for (const [k, o] of old) if (!seen.has(k)) fn('removed', o);
}
const idKey = (e) => e?.id;
// action regions made from the shots of a file that had none get new ids at every parse: matched by their place instead
const spanKey = (e) => (e && Number.isFinite(e.t0) ? `${e.t0}|${e.t1}|${e.layer ?? ''}` : null);
const cutsOf = (shots) => shots.map((s) => `${s.start_ms}|${s.end_ms}|${s.join === true ? 1 : 0}`).join(',');
const shotFacts = (s) => Object.fromEntries(Object.entries(s || {}).filter(([k]) => !SHOT_DERIVED.has(k)));

/**
 * a: the older state (null = nothing), b: the newer. -> {groups: [{scope, lines: [text]}] (project first, then shots in
 * time order), scope, empty, shots: [indices touched]}.
 */
export function diffDocs(a, b) {
  a ||= {}; b ||= {};
  const shots = b.scenes || [], runs = sceneRuns(shots), buckets = new Map(), proj = [];
  // a bucket per shot (key = its index) or per scene (key 'scene:<first shot>': a thing spanning shots of one scene)
  const bucket = (i, run = null) => { const k = run ? 'scene:' + run[0] : i; if (!buckets.has(k)) buckets.set(k, { pts: {}, items: [], scope: run ? sceneScope(shots, run) : shotScope(shots, i), lo: run ? run[0] : i, hi: run ? run[1] : i }); return buckets.get(k); };
  const where = (t0, t1 = t0) => (shots.length ? shotOf(shots, t0, t1) : -1);
  // points: counted per section and axis
  const outside = { pts: {}, items: [] }, across = [];
  diffAxes(a.axes, b.axes, (t, axis, kind) => { const i = where(t), bk = i < 0 ? outside : bucket(i); const c = (bk.pts[axis] ||= { add: 0, del: 0, mov: 0 }); c[kind]++; });
  const item = (t0, t1 = t0, text) => {
    if (t0 == null || !shots.length) return void outside.items.push(text);
    const i = where(t0, t1 ?? t0);
    if (i >= 0) return void bucket(i).items.push(text);
    const i0 = where(t0), i1 = where(Math.max(t0, (t1 ?? t0) - 0.001)), run = i0 >= 0 && i1 >= 0 ? runs.find(([lo, hi]) => i0 >= lo && i1 <= hi) : null;
    if (run) bucket(-1, run).items.push(text);
    else if (i0 >= 0 && i1 >= 0) across.push(`${text} (shots ${i0 + 1}–${i1 + 1})`);   // across scenes: said by its shots, not "outside"
    else outside.items.push(text);
  };
  // runs: by id, placed by the span of their points
  const runsA = new Map((a.ghosts || []).filter(isRun).map((g) => [g.id, g])), runsB = new Map((b.ghosts || []).filter(isRun).map((g) => [g.id, g]));
  // a run is said by its number ("run #2"), not its whole title (the section already says where)
  const runName = (id) => { const n = (b.ghosts || []).concat(a.ghosts || []).find((g) => g.id === id)?.name || id, m = /#\d+$/.exec(n); return m ? 'run ' + m[0] : n; };
  for (const [id, g] of runsB) if (!runsA.has(id)) { const s = span(g); item(s?.[0], s?.[1], `${runName(id)} tracked`); }
  for (const [id, g] of runsA) if (!runsB.has(id)) { const s = span(g); item(s?.[0], s?.[1], `${runName(id)} removed`); }
  const timed = (word, at = (e) => [e.t0, e.t1], name = () => word) => (verb, e) => { const [t0, t1] = at(e); item(t0, t1, `${name(e)} ${verb}${verb !== 'changed' && Number.isFinite(t0) ? ' at ' + fmtMs(t0) : ''}`); };
  diffById(a.fx, b.fx, timed('modifier', undefined, (e) => (e.kind === 'spurt' ? 'spurt marker' : e.kind || 'modifier')));
  diffById(a.acts, b.acts, timed('action region', undefined, (e) => `${e.kind ? e.kind + ' ' : ''}region`), spanKey);
  // paw-1ysd: which run plays where (by id; named after the run's ghost)
  diffById(a.runRanges || [], b.runRanges || [], timed('run range', undefined, (e) => `${runName(e.run)} range`), (e) => (e ? `${e.run}|${e.t0}|${e.t1}` : null));
  diffById(a.loops, b.loops, timed('loop'));
  diffById(a.plan, b.plan, timed('plan segment', undefined, (e) => `plan ${e.kind || 'segment'}`));
  diffById(a.bookmarks, b.bookmarks, timed('bookmark', (e) => [e.at, e.at]));
  // the run links (tracking 'links' block: {t0, t1, run, channel}) sit in time too
  const linksOf = (d) => (Array.isArray(d.project?.extra?.links?.scenes) ? d.project.extra.links.scenes : []);
  const lk = (l) => `${l.t0}|${l.t1}|${l.run}|${l.channel}`;
  { const la = new Set(linksOf(a).map(lk)), lb = new Set(linksOf(b).map(lk));
    for (const l of linksOf(b)) if (!la.has(lk(l))) item(l.t0, l.t1, `${runName(l.run)} plays here`);
    for (const l of linksOf(a)) if (!lb.has(lk(l))) item(l.t0, l.t1, `${runName(l.run)} no longer plays here`); }
  // the shot list: its cuts are the project's; a shot's own facts (tags, range, detail ...) are that shot's
  const sa = a.scenes || [];
  if (cutsOf(sa) !== cutsOf(shots)) {
    const ca = new Set(sa.slice(1).map((s) => s.start_ms)), cb = new Set(shots.slice(1).map((s) => s.start_ms));
    const add = [...cb].filter((t) => !ca.has(t)).length, del = [...ca].filter((t) => !cb.has(t)).length;
    proj.push(`Shots: ${[add && plural(add, 'cut') + ' added', del && plural(del, 'cut') + ' removed', !add && !del && 'scenes regrouped'].filter(Boolean).join(', ')}`);
  } else {
    shots.forEach((s, i) => {
      const x = shotFacts(sa[i]), y = shotFacts(s), keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => json(x[k]) !== json(y[k]));
      const words = [...new Set(keys.map((k) => FACT_WORD[k] || 'details'))];
      if (keys.length) bucket(i).items.unshift(`${words.slice(0, 4).join(', ')}${words.length > 4 ? ' …' : ''} changed`);
    });
  }
  diffById(a.chapters, b.chapters, (verb, e) => proj.push(`Chapter ${e.name ? '“' + e.name + '” ' : ''}${verb}`));
  if (json(a.graphs || []) !== json(b.graphs || [])) proj.push('Graphs changed');
  if (a.finish != null && b.finish != null && json(a.finish) !== json(b.finish)) proj.push('Finishing changed');   // absent = an older file, written with the default
  if (json(a.repeats) !== json(b.repeats)) proj.push('Repeated frames changed');
  if (json(a.project?.settings || {}) !== json(b.project?.settings || {})) proj.push('Project settings changed');
  const ea = a.project?.extra || {}, eb = b.project?.extra || {};
  for (const k of new Set([...Object.keys(ea), ...Object.keys(eb)])) if (k !== 'links' && !SKIP_EXTRA.has(k) && json(ea[k]) !== json(eb[k])) proj.push(`${BLOCK_NAME[k] || k} changed`);
  const lines = (bk) => [...Object.entries(bk.pts).map(([axis, c]) => ptsText(axis, c)), ...bk.items];
  const groups = [];
  const outLines = lines(outside);
  if (proj.length || outLines.length || across.length) groups.push({ scope: PROJECT, lines: [...proj, ...across, ...outLines.map((l) => (shots.length ? l + ' (outside the shots)' : l))] });
  const bks = [...buckets.values()].sort((x, y) => x.lo - y.lo || (y.hi - y.lo) - (x.hi - x.lo));
  for (const bk of bks) groups.push({ scope: bk.scope, lines: lines(bk) });
  const lo = Math.min(...bks.map((x) => x.lo)), hi = Math.max(...bks.map((x) => x.hi));
  let scope = PROJECT;
  if (!proj.length && !outLines.length && !across.length && bks.length) {
    if (lo === hi) scope = shotScope(shots, lo);
    else { const run = runs.find(([a0, a1]) => lo >= a0 && hi <= a1); if (run) scope = sceneScope(shots, run); }
  }
  return { groups, scope, empty: !groups.length, shots: bks.length ? Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) : [] };
}
function ptsText(axis, c) {
  const n = [c.add && '+' + c.add.toLocaleString('en'), c.del && '−' + c.del.toLocaleString('en')].filter(Boolean).join(' ');
  return n ? `${n} point${c.add + c.del === 1 ? '' : 's'} on ${axis}${c.mov ? `, ${c.mov} moved` : ''}` : `${plural(c.mov, 'point')} moved on ${axis}`;
}
export const shotScope = (shots, i) => ({ kind: 'shot', i, t0: shots[i].start_ms, t1: shots[i].end_ms, label: `Shot ${i + 1}` });
export const sceneScope = (shots, [lo, hi]) => ({ kind: 'scene', i: sceneNo(shots, lo), t0: shots[lo].start_ms, t1: shots[hi].end_ms, shots: [lo, hi], label: `Scene ${sceneNo(shots, lo) + 1}` });

/** The diff as stored in an index entry: a few lines per group, capped. */
export const compactChanges = (d, { groups = 24, lines = 8 } = {}) => d.groups.slice(0, groups).map((g) => ({ scope: g.scope, lines: g.lines.slice(0, lines).concat(g.lines.length > lines ? [`… ${g.lines.length - lines} more`] : []) }));
/** One line: "Shot 14: +212 points on stroke, run 2 tracked; Project: Shots: 1 cut added". */
export const changesText = (groups = []) => groups.map((g) => `${scopeLabel(g.scope)}: ${g.lines.join(', ')}`).join('; ');

/** What a state holds, for the history list: {pts: {axis: n}, runs: [ids], shots: n}. */
export function summaryOf(d) {
  return { pts: Object.fromEntries(Object.entries(d?.axes || {}).filter(([, s]) => s?.length).map(([k, s]) => [k, s.length])), runs: (d?.ghosts || []).filter(isRun).map((g) => g.id), shots: d?.scenes?.length || 0 };
}
export const summaryText = (s) => (s ? [...Object.entries(s.pts || {}).map(([k, n]) => `${n.toLocaleString('en')} on ${k}`), s.runs?.length ? plural(s.runs.length, 'run') : '', s.shots ? plural(s.shots, 'shot') : ''].filter(Boolean).join(' · ') : '');

/**
 * Restore one section [t0, t1) of `then` into `now` (both app.load shapes; now = doc.read() plus scenes): points inside the
 * span come from then, every point outside stays as it is; modifiers, regions, loops, plan segments and bookmarks lying
 * wholly inside the span come from then (those crossing its edges stay); a shot inside the span with the same cut in both
 * takes then's facts (the cuts themselves are the project's). -> {[key]: value} only for what differs ('axes.<id>' per axis).
 */
export function restoreSection(now, then, { t0, t1, last = false }) {
  const inT = (t) => t >= t0 && (t < t1 || (last && t === t1)), inside = (e) => Number.isFinite(e?.t0) && Number.isFinite(e?.t1) && e.t0 >= t0 && e.t1 <= t1;
  const out = {};
  const axes = new Set([...Object.keys(now.axes || {}), ...Object.keys(then.axes || {})]);
  for (const k of axes) {
    const cur = now.axes?.[k] || [], old = then.axes?.[k] || [];
    const next = [...cur.filter((p) => !inT(p.at)), ...old.filter((p) => inT(p.at))].sort((x, y) => x.at - y.at);
    const same = next.length === cur.length && next.every((p, i) => p === cur[i] || (p.at === cur[i].at && p.pos === cur[i].pos));
    if (!same) out['axes.' + k] = next;
  }
  const swap = (key, test) => {
    const cur = now[key] || [], old = then[key] || [];
    const next = [...cur.filter((e) => !test(e)), ...old.filter(test)].sort((x, y) => (x.t0 ?? x.at) - (y.t0 ?? y.at));
    if (json(next) !== json(cur)) out[key] = next;
  };
  swap('fx', inside); swap('acts', inside); swap('loops', inside); swap('plan', inside);
  swap('bookmarks', (e) => Number.isFinite(e?.at) && inT(e.at));
  // paw-1ysd: the run ranges inside the section as they were (those straddling an edge clipped to it); outside, as they are
  if (Array.isArray(now.runRanges) || Array.isArray(then.runRanges)) {
    const cur = now.runRanges || [], old = then.runRanges || [], hi = last ? t1 + 1 : t1;
    const outside = cur.flatMap((r) => [r.t0 < t0 && { ...r, t1: Math.min(r.t1, t0) }, r.t1 > hi && { ...r, id: r.t0 < t0 ? r.id + 'b' : r.id, t0: Math.max(r.t0, hi) }].filter(Boolean));
    const inside = old.filter((r) => r.t1 > t0 && r.t0 < hi).map((r) => ({ ...r, id: r.t0 < t0 || r.t1 > hi ? r.id + 'i' : r.id, t0: Math.max(r.t0, t0), t1: Math.min(r.t1, hi) }));
    const next = [];   // sorted, a run's pieces that meet again joined (the section's edge is no cut of its own)
    for (const r of [...outside, ...inside].sort((x, y) => (x.layer | 0) - (y.layer | 0) || x.t0 - y.t0)) {
      const p = next[next.length - 1];
      if (p && p.run === r.run && (p.layer | 0) === (r.layer | 0) && p.t1 === r.t0) next[next.length - 1] = { ...p, t1: r.t1 }; else next.push(r);
    }
    // paw-rhrt: one range that grew past the section since then is both an outside piece and an inside one: ids stay unique
    // (the strip keys its rows by id), then the clean-up every range edit gets
    const ids = new Set();
    for (const r of next) { let id = r.id; while (ids.has(id)) id += 'i'; ids.add(id); r.id = id; }
    const norm = normRanges(next);
    if (json(norm) !== json(normRanges(cur))) out.runRanges = norm;
  }
  const shots = now.scenes || [], was = new Map((then.scenes || []).map((s) => [`${s.start_ms}|${s.end_ms}`, s]));
  let changed = false;
  const next = shots.map((s) => { const o = s.start_ms >= t0 && s.end_ms <= t1 ? was.get(`${s.start_ms}|${s.end_ms}`) : null; if (o && json(shotFacts(o)) !== json(shotFacts(s))) { changed = true; return { ...o, join: s.join }; } return s; });
  if (changed) out.scenes = next;
  return out;
}
