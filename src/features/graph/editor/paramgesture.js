// paramgesture.js -- one param scrub as one undo entry, for the card fields and the inspector. Pure over a
// controller (test/graph-editor-paramgesture.test.mjs).
//
// A field reports change(value, commit=false) while it scrubs and commit=true when it is done. The kit
// NumberField only commits when the value differs from where the scrub started, so a scrub released on its
// start value never commits: end() (called on pointerup / key-up) closes such a gesture. Back on the start
// value it cancels, so the app history records nothing; otherwise it commits.

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** ctl: { gesture(label) -> { update(fn), commit(), cancel() }, mutate(label, fn) -> reason }. */
export function createParamGesture(ctl) {
  let cur = null;   // { key, h, start, last }
  function end() {
    if (!cur) return;
    const c = cur;
    cur = null;
    if (same(c.last, c.start)) c.h.cancel(); else c.h.commit();
  }
  return {
    get open() { return !!cur; },
    /**
     * key: identifies the field (node id + param + kind); fn(graph) -> graph applies `value`; start: the value
     * before the scrub. Returns the refusal reason of a one-shot edit ('' otherwise).
     */
    change(key, label, fn, value, commit, start) {
      if (!commit || cur) {
        if (!cur || cur.key !== key) { end(); cur = { key, h: ctl.gesture(label), start, last: start }; }
        cur.h.update(fn);
        cur.last = value;
        if (commit) { const c = cur; cur = null; c.h.commit(); }
        return '';
      }
      return ctl.mutate(label, fn) || '';
    },
    end,
  };
}

/**
 * Closes `pg` after every pointer release and nudge-key release, once the field's own handlers have run
 * (setTimeout: the field's commit, if any, comes first). Returns the cleanup, which also closes an open gesture.
 */
export function endOnRelease(pg, target = globalThis) {
  const later = () => setTimeout(() => pg.end(), 0);
  const key = (e) => { if (/^(Arrow|Page)/.test(e.key || '')) later(); };
  target.addEventListener('pointerup', later);
  target.addEventListener('pointercancel', later);
  target.addEventListener('keyup', key);
  return () => {
    target.removeEventListener('pointerup', later);
    target.removeEventListener('pointercancel', later);
    target.removeEventListener('keyup', key);
    pg.end();
  };
}
