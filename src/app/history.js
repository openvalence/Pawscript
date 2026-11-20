// history.js -- undo/redo over immutable document values. Pure: no DOM, no runes (test/app-history.test.mjs).
//
// The document's undoable values (one Script per axis, chapters, bookmarks, loops, plan) are immutable, so an
// undo entry is just which values changed: {label, patches: [{path, before, after}], selBefore, selAfter}.
// A group snapshots every undoable value when it opens and diffs by identity when it closes, so code inside a
// group may change those values any way it likes (app.edit, or plain assignment) and still lands as ONE entry.
//
//   read()            -> { [path]: value }  every undoable value now ('axes.stroke', 'chapters', ...)
//   write(path, v)    sets one (v === undefined removes it, e.g. an axis that did not exist before)
//   readSel/writeSel  selection captured with each entry and restored by undo/redo

/**
 * Memory an entry's patch holds, in "actions": the elements that differ between before and after (the common
 * prefix and suffix are the very same objects, shared with the document), plus a base for the two pointer arrays
 * (1/8 of their length). A one-point edit on a 100 000-action script costs ~25 000, not 200 000, so a large
 * document keeps a useful undo depth while memory stays bounded.
 */
export function patchCost(b, a) {
  if (!Array.isArray(b) || !Array.isArray(a)) return (Array.isArray(b) ? b.length : b == null ? 0 : 1) + (Array.isArray(a) ? a.length : a == null ? 0 : 1);
  const n = Math.min(a.length, b.length);
  let pre = 0, suf = 0;
  while (pre < n && a[pre] === b[pre]) pre++;
  while (suf < n - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return (b.length - pre - suf) + (a.length - pre - suf) + Math.ceil((a.length + b.length) / 8) + 1;
}
const sizeOf = (patches) => patches.reduce((s, p) => s + patchCost(p.before, p.after), 0);
const MAX_ENTRIES = 500;

export class History {
  entries = [];     // applied entries are entries[0 .. index)
  index = 0;
  total = 0;        // sum of entry sizes (actions held), for the memory cap
  seq = 0;
  savedId = 0;      // id of the top entry when last saved (0 = the initial state)
  open = null;      // the outermost open group: {label, opts, before, selBefore}
  depth = 0;
  last = '';        // 'commit' | 'undo' | 'redo' -- coalescing only follows a commit
  gen = 0;          // bumped when open groups are force-closed (undo/redo mid-drag, reset): their handles go dead

  constructor({ read, write, readSel = () => null, writeSel = () => {}, now = Date.now, window = 1000, cap = 4_000_000, onChange = () => {}, onRecord = () => {} }) {
    Object.assign(this, { read, write, readSel, writeSel, now, window, cap, onChange, onRecord });
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length; }
  get topId() { return this.index ? this.entries[this.index - 1].id : 0; }
  get dirty() { return this.topId !== this.savedId; }
  get busy() { return this.depth > 0; }
  markSaved() { this.savedId = this.topId; this.onChange(); }
  /** The current state is unsaved even with nothing to undo (a restored autosave): no position is clean. */
  markDirty() { this.savedId = -1; this.onChange(); }
  /** Forget everything (a new document). */
  reset() { this.entries = []; this.index = 0; this.total = 0; this.savedId = this.topId; this.open = null; this.depth = 0; this.gen++; this.onChange(); }

  /**
   * Opens a group. Every change until the matching commit() is one entry; cancel() puts back the values this
   * handle saw when it opened. Groups nest: only the outermost commit records. Each handle acts once.
   */
  begin(label, opts = {}) {
    const before = this.read(), selBefore = this.readSel(), gen = this.gen;
    if (!this.open) this.open = { label, opts, before, selBefore };
    this.depth++;
    let done = false;
    // A handle whose group was force-closed (undo/redo arrived mid-drag, or reset) is dead: its commit/cancel do
    // nothing, so the depth can never go wrong and recording never stops.
    const finish = () => {
      if (done) return false;
      done = true;
      if (gen !== this.gen) { console.warn('[history] group "' + label + '" was closed by undo/redo; its commit/cancel is ignored'); return false; }
      this.depth = Math.max(0, this.depth - 1);
      return true;
    };
    return {
      commit: () => {
        if (!finish()) return;
        if (!this.depth) { const o = this.open; this.open = null; this.#record(o); }
      },
      cancel: () => {
        if (!finish()) return;
        this.#restore(before);
        this.writeSel(selBefore);
        if (!this.depth) this.open = null;
        this.onChange();
      },
    };
  }

  /** Runs fn as one group. A throw (or rejected promise) rolls back and rethrows. Returns fn's result. */
  transact(label, fn, opts = {}) {
    const h = this.begin(label, opts);
    let out;
    try { out = fn(); } catch (e) { h.cancel(); throw e; }
    if (out && typeof out.then === 'function') return out.then((v) => { h.commit(); return v; }, (e) => { h.cancel(); throw e; });
    h.commit();
    return out;
  }

  undo() {
    this.#closeOpen();
    if (!this.canUndo) return null;
    const e = this.entries[--this.index];
    for (let i = e.patches.length - 1; i >= 0; i--) this.write(e.patches[i].path, e.patches[i].before);
    this.writeSel(e.selBefore);
    this.last = 'undo';
    this.onChange();
    return e;
  }
  redo() {
    this.#closeOpen();
    if (!this.canRedo) return null;
    const e = this.entries[this.index++];
    for (const p of e.patches) this.write(p.path, p.after);
    this.writeSel(e.selAfter);
    this.last = 'redo';
    this.onChange();
    return e;
  }
  /** A value written outside history (paw-1ysd: the range a track or a fill takes) folded into every stored state of `path`:
   *  each patch's before / after and an open group's before become fn(value), so no undo or redo drops it. */
  rebase(path, fn) {
    for (const e of this.entries) for (const p of e.patches) if (p.path === path) { p.before = fn(p.before); p.after = fn(p.after); }
    if (this.open && path in this.open.before) this.open.before[path] = fn(this.open.before[path]);
  }
  /** Undo or redo until `n` entries are applied. */
  goto(n) {
    n = Math.max(0, Math.min(this.entries.length, n));
    while (this.index > n) this.undo();
    while (this.index < n) this.redo();
  }
  /** For a history panel: [{id, label, time, size, applied}], oldest first. */
  list() { return this.entries.map((e, i) => ({ id: e.id, label: e.label, time: e.time, size: e.size, applied: i < this.index })); }

  // An undo while a group is open (a feature forgot to commit, or a key arrived mid-drag) first commits it,
  // so nothing is lost and undo never goes dead.
  #closeOpen() {
    if (!this.open) return;
    const o = this.open;
    this.open = null; this.depth = 0; this.gen++;
    this.#record(o);
  }

  #restore(before) {
    const now = this.read();
    for (const k of new Set([...Object.keys(now), ...Object.keys(before)])) if (now[k] !== before[k]) this.write(k, before[k]);
  }

  #record(o) {
    const after = this.read(), patches = [];
    for (const k of new Set([...Object.keys(o.before), ...Object.keys(after)])) {
      if (o.before[k] !== after[k]) patches.push({ path: k, before: o.before[k], after: after[k] });
    }
    if (!patches.length) return;
    const t = this.now(), selAfter = this.readSel();
    const top = this.index ? this.entries[this.index - 1] : null;
    if (o.opts.coalesce && top && top.coalesce && top.label === o.label && this.last === 'commit'
      && this.index === this.entries.length && t - top.time <= this.window) {
      for (const p of patches) {
        const q = top.patches.find((x) => x.path === p.path);
        if (q) q.after = p.after; else top.patches.push(p);
      }
      top.patches = top.patches.filter((p) => p.before !== p.after);
      this.total -= top.size;
      top.size = sizeOf(top.patches);
      this.total += top.size;
      top.time = t; top.selAfter = selAfter; top.id = ++this.seq;   // a new id: an edit after a save is dirty
      if (!top.patches.length) { this.entries.pop(); this.index--; }   // nudged there and back: nothing left
    } else {
      for (const e of this.entries.splice(this.index)) this.total -= e.size;   // a new edit drops the redo branch
      const size = sizeOf(patches);
      this.entries.push({ id: ++this.seq, label: o.label, time: t, patches, selBefore: o.selBefore, selAfter, coalesce: !!o.opts.coalesce, size });
      this.index++;
      this.total += size;
      try { this.onRecord(o.label, patches); } catch { /* observers never break an edit */ }
      // memory cap: drop the oldest entries (never the newest one). Once the saved state's entry (or the initial
      // state) is gone, no reachable position matches the file any more: nothing may report clean.
      while ((this.total > this.cap || this.entries.length > MAX_ENTRIES) && this.entries.length > 1 && this.index > 1) {
        const e = this.entries.shift();
        this.index--; this.total -= e.size;
        if (this.savedId === 0 || this.savedId === e.id) this.savedId = -1;
      }
    }
    this.last = 'commit';
    this.onChange();
  }
}
