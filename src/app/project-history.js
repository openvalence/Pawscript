// project-history.js -- what a continuous project keeps beside its .pawproj (paw-up1r stage 1): the undo history and the
// automatic checkpoints, in `<stem>.pawhistory/` (undo.json, index.json, <id>.pawproj). Pure: project.svelte.js does the IO
// (test/app-continuous.test.mjs).
//
//   index.json  {v: 1, checkpoints: [{id, at (ms), label, auto, keep?, key}]}   newest last; <id>.pawproj = the document then
//               (the .pawproj text: no run frames, those stay in the .pawruns). Stage 2's history list reads this.
//   undo.json   {v: 1, build, projectSha, index, entries}   the undo stack, newest first, each value stored as the slice that
//               differs from the next newer state (history.js patchCost's prefix / suffix), so a one-point edit on a long script
//               is a few actions. Only loaded when projectSha is the sha256 of the .pawproj it was written with, and `build` is
//               this build (paw-0tas: another build may hold a field in another shape, which an undo would write back).

//   stage 2: an entry also has kind ('auto' | 'commit' | 'publish'; older entries: auto), note? (the owner's words), version?
//               (publish), scope? (history-diff.js: the shot / scene all its changes fall in), changes ([{scope, lines}] since
//               the entry before it; a commit: since the last commit) and sum ({pts, runs, shots}). Commits and publishes
//               are never pruned (auto: false). The entry's <id>.pawproj holds the whole document even when scoped.

import { patchCost } from './history.js';
import { APP_VERSION, APP_BUILD, actionsHash } from '../lib/provenance.js';

export const historyDir = (projectPath) => String(projectPath).replace(/\.pawproj$/i, '') + '.pawhistory';
/** An index entry's kind (entries written before stage 2 have none). */
/** paw-vhcd: an entry's name without the `Before going back to “…”` (or `Go back to` / `Back to`) that earlier restores
 *  wrapped round it, so going back to such an entry never nests them. */
export function bareName(s) {
  let x = String(s ?? '');
  for (let m; (m = /^(?:Before going back to|Go back to|Back to) “([\s\S]*)”$/.exec(x));) x = m[1];
  return x;
}
export const kindOf =(c) => c?.kind || (c?.auto === false ? 'commit' : 'auto');
/** What a publish writes, as one key: the final axes' actions and the stroke file's chapters / bookmarks. */
export const publishKey = (axes = {}, chapters = [], bookmarks = []) =>
  Object.keys(axes).filter((k) => axes[k]?.length).sort().map((k) => `${k}:${actionsHash(axes[k])}`).join(',') + '|' + contentKey(JSON.stringify([chapters || [], bookmarks || []]));

/** paw-0tas: the build an undo.json belongs to (version + commit). */
export const UNDO_BUILD = `${APP_VERSION}+${APP_BUILD.commit}`;
/** undo.json's text around `entries` (the exportHistory json). */
export const undoText = (projectSha, entries, build = UNDO_BUILD) => `{"v":1,"build":${JSON.stringify(build)},"projectSha":${JSON.stringify(projectSha || '')},"entries":${entries}}`;
/** Is this parsed undo.json the stack of this very file, written by this build? Anything else starts an empty stack. */
export const undoUsable = (u, sha, build = UNDO_BUILD) => u?.v === 1 && !!sha && u.projectSha === sha && u.build === build;

/** A checkpoint's identity: the text without its save / create stamps (FNV-1a), so an unchanged document makes none. */
export function contentKey(text) {
  const s = String(text).replace(/^\s*"(savedAt|createdAt)": "[^"]*",?\n/gm, '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + s.length;
}

/** Which checkpoints stay: every kept (keep: true) or manual one; of the automatic ones the newest `recent`, then the newest
 *  of each calendar day. -> {keep, drop}, both newest first. */
export function pruneCheckpoints(list = [], { recent = 20 } = {}) {
  const keep = [], drop = [], days = new Set();
  let n = 0;
  for (const c of [...list].sort((a, b) => b.at - a.at)) {
    if (c.keep || !c.auto) { keep.push(c); continue; }
    const day = new Date(c.at).toDateString();
    (n++ < recent || !days.has(day) ? keep : drop).push(c);
    days.add(day);
  }
  return { keep, drop };
}

// ---------- undo history ----------
/** The most undo.json may hold, in characters of JSON (older entries are dropped first; an entry bigger than this alone is not kept). */
export const UNDO_BYTES = 4_000_000;
const NONE = { u: 1 };   // undefined (an axis that did not exist) in JSON
const enc = (v) => (v === undefined ? NONE : v);
const dec = (v) => (v && typeof v === 'object' && !Array.isArray(v) && v.u === 1 && Object.keys(v).length === 1 ? undefined : v);
const selOut = (s) => (s ? { axis: s.selection?.axis, ats: [...(s.selection?.ats || [])], active: s.activeAxis } : null);
const selIn = (s) => (s ? { selection: { axis: s.axis, ats: new Set(s.ats || []) }, activeAxis: s.active } : null);

// per patch, its own part of the file (the slice of `before` that differs from `after`), kept while the patch holds the same values
const memo = new WeakMap();
function partOf(p) {
  let m = memo.get(p);
  if (m && m.b === p.before && m.a === p.after) return m;
  const b = p.before, a = p.after;
  if (Array.isArray(b) && Array.isArray(a)) {
    const n = Math.min(a.length, b.length);
    let pre = 0, suf = 0;
    while (pre < n && a[pre] === b[pre]) pre++;
    while (suf < n - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const mid = b.slice(pre, b.length - suf);
    m = { b, a, json: JSON.stringify({ p: p.path, d: [pre, suf, a.length, mid] }), cost: mid.length + 1 };
  } else m = { b, a, json: JSON.stringify({ p: p.path, v: enc(b) }), cost: Array.isArray(b) ? b.length + 1 : 1 };
  memo.set(p, m);
  return m;
}

/**
 * The applied part of a History (history.js) as the text of undo.json's `entries` (newest first), bounded to about `budget`
 * stored elements (older entries are dropped first). `now`: doc.read() at the time of writing. The redo branch is not kept.
 * -> {json, kept}
 */
export function exportHistory(h, now, { budget = 100_000, bytes = UNDO_BYTES } = {}) {
  const ref = { ...now }, parts = [];
  let cost = 0, kept = 0, size = 0;
  for (let i = h.index - 1; i >= 0; i--) {
    const e = h.entries[i], ps = [];
    let c = 0;
    for (const p of e.patches) {
      const m = partOf(p);
      // a value changed outside the history between this entry and the next newer state: its own `after` goes with it
      if (ref[p.path] !== p.after) { const full = JSON.parse(m.json); full.a = enc(p.after); ps.push(JSON.stringify(full)); c += Array.isArray(p.after) ? p.after.length : 1; }
      else ps.push(m.json);
      c += m.cost;
    }
    const sb = selOut(e.selBefore), sa = selOut(e.selAfter);
    c += (sb?.ats.length || 0) + (sa?.ats.length || 0);
    // also bounded in BYTES: one element can be megabytes (a scene with its painted masks): 40 paint strokes made a 250 MB
    // undo.json, rebuilt and written about every second, and the page ran out of memory (the owner, 2026-11-18)
    const len = ps.reduce((n, x) => n + x.length, 0);
    if ((kept && cost + c > budget) || size + len > bytes) break;
    size += len;
    for (const p of e.patches) ref[p.path] = p.before;
    parts.push(`{"label":${JSON.stringify(e.label)},"time":${e.time},"coalesce":${!!e.coalesce},"sb":${JSON.stringify(sb)},"sa":${JSON.stringify(sa)},"ps":[${ps.join(',')}]}`);
    cost += c; kept++;
  }
  return { json: '[' + parts.join(',') + ']', kept };
}

/**
 * Rebuilds the undo stack from undo.json's entries onto `h` (a fresh History over the loaded document): every entry's `after`
 * is the next newer state (the document itself for the newest), its `before` that with the stored slice put back. Stops at
 * the first entry that does not fit (a value of another length than written: the file belongs to another state), keeping the
 * newer ones. `now`: doc.read(). -> entries restored
 */
export function importHistory(h, entries, now) {
  const cur = { ...now }, out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const patches = [];
    let ok = !!e && Array.isArray(e.ps);
    for (const p of ok ? e.ps : []) {
      const after = 'a' in p ? dec(p.a) : cur[p.p];
      let before;
      if (p.d) {
        const [pre, suf, n, mid] = p.d;
        if (!Array.isArray(after) || after.length !== n || !Array.isArray(mid)) { ok = false; break; }
        before = [...after.slice(0, pre), ...mid, ...after.slice(after.length - suf)];
      } else before = dec(p.v);
      patches.push({ path: p.p, before, after });
    }
    if (!ok) break;
    for (const q of patches) cur[q.path] = q.before;
    out.unshift({ label: String(e.label ?? ''), time: +e.time || 0, coalesce: !!e.coalesce, patches, selBefore: selIn(e.sb), selAfter: selIn(e.sa) });
  }
  h.reset();
  for (const e of out) {
    const size = e.patches.reduce((s, p) => s + patchCost(p.before, p.after), 0);
    h.entries.push({ id: ++h.seq, ...e, size });
    h.total += size;
  }
  h.index = h.entries.length;
  h.last = '';
  h.markSaved();
  return out.length;
}
