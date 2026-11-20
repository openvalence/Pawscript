import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/app/history.js';

// a plain-object document with the same read/write shape as src/app/doc.svelte.js
function setup(opts = {}) {
  const doc = { axes: { stroke: [] }, chapters: [], sel: { ats: [] } };
  let clock = 0;
  const h = new History({
    read: () => ({ ...Object.fromEntries(Object.entries(doc.axes).map(([k, v]) => ['axes.' + k, v])), chapters: doc.chapters }),
    write: (p, v) => {
      if (p.startsWith('axes.')) { const n = { ...doc.axes }; if (v === undefined) delete n[p.slice(5)]; else n[p.slice(5)] = v; doc.axes = n; }
      else doc[p] = v;
    },
    readSel: () => doc.sel, writeSel: (s) => (doc.sel = s),
    now: () => clock, ...opts,
  });
  const edit = (label, axis, next, o) => h.transact(label, () => { doc.axes = { ...doc.axes, [axis]: next }; }, o);
  return { doc, h, edit, tick: (ms) => (clock += ms) };
}
const A = (...p) => p.map(([at, pos]) => ({ at, pos }));

test('edit, undo, redo round-trip restores the exact arrays', () => {
  const { doc, h, edit } = setup();
  const s0 = doc.axes.stroke, s1 = A([0, 10]), s2 = A([0, 10], [100, 90]);
  edit('Add', 'stroke', s1); edit('Add', 'stroke', s2);
  assert.equal(h.entries.length, 2);
  h.undo(); assert.equal(doc.axes.stroke, s1);
  h.undo(); assert.equal(doc.axes.stroke, s0);
  assert.equal(h.undo(), null);
  h.redo(); h.redo(); assert.equal(doc.axes.stroke, s2);
  assert.equal(h.redo(), null);
});

test('no-op transaction records nothing', () => {
  const { h } = setup();
  h.transact('Nothing', () => {});
  assert.equal(h.entries.length, 0);
  assert.equal(h.dirty, false);
});

test('a transaction groups several axes and doc values into one entry', () => {
  const { doc, h } = setup();
  h.transact('Accept run', () => {
    doc.axes = { ...doc.axes, stroke: A([0, 0]) };
    doc.axes = { ...doc.axes, roll: A([5, 50]) };
    doc.axes = { ...doc.axes, stroke: A([0, 0], [10, 100]) };
    doc.chapters = [{ id: 'c', t0: 0, t1: 10 }];
  });
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0].patches.length, 3);
  h.undo();
  assert.deepEqual(doc.axes, { stroke: [] });   // the axis that did not exist is removed again
  assert.deepEqual(doc.chapters, []);
  h.redo();
  assert.equal(doc.axes.roll.length, 1); assert.equal(doc.axes.stroke.length, 2); assert.equal(doc.chapters.length, 1);
});

test('nested transactions: only the outermost records', () => {
  const { doc, h, edit } = setup();
  h.transact('Outer', () => { edit('Inner 1', 'stroke', A([0, 1])); edit('Inner 2', 'stroke', A([0, 2])); });
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0].label, 'Outer');
  h.undo(); assert.deepEqual(doc.axes.stroke, []);
});

test('a throw rolls back and records nothing', () => {
  const { doc, h } = setup();
  const s0 = doc.axes.stroke;
  assert.throws(() => h.transact('Bad', () => { doc.axes = { ...doc.axes, stroke: A([1, 1]) }; doc.chapters = [1]; throw new Error('boom'); }), /boom/);
  assert.equal(doc.axes.stroke, s0); assert.deepEqual(doc.chapters, []);
  assert.equal(h.entries.length, 0); assert.equal(h.busy, false);
});

test('async transaction commits on resolve, rolls back on reject', async () => {
  const { doc, h } = setup();
  await h.transact('Async', async () => { doc.axes = { ...doc.axes, stroke: A([1, 1]) }; await null; doc.axes = { ...doc.axes, stroke: A([1, 1], [2, 2]) }; });
  assert.equal(h.entries.length, 1); assert.equal(doc.axes.stroke.length, 2);
  await assert.rejects(h.transact('Async bad', async () => { doc.chapters = [1]; await null; throw new Error('no'); }));
  assert.deepEqual(doc.chapters, []); assert.equal(h.entries.length, 1);
});

test('begin/commit groups a drag; cancel reverts it', () => {
  const { doc, h } = setup();
  let g = h.begin('Move');
  for (let i = 1; i <= 20; i++) doc.axes = { ...doc.axes, stroke: A([i, 50]) };
  g.commit(); g.commit();   // second commit is a no-op
  assert.equal(h.entries.length, 1);
  const before = doc.axes.stroke;
  g = h.begin('Move');
  doc.axes = { ...doc.axes, stroke: A([99, 50]) };
  g.cancel();
  assert.equal(doc.axes.stroke, before); assert.equal(h.entries.length, 1);
});

test('undo while a group is open commits it first (undo never goes dead)', () => {
  const { doc, h } = setup();
  h.begin('Forgotten');
  doc.axes = { ...doc.axes, stroke: A([1, 1]) };
  h.undo();
  assert.deepEqual(doc.axes.stroke, []);
  assert.equal(h.entries.length, 1); assert.equal(h.busy, false);
  h.redo(); assert.equal(doc.axes.stroke.length, 1);
});

test('a new edit after undo drops the redo branch', () => {
  const { doc, h, edit } = setup();
  edit('a', 'stroke', A([1, 1])); edit('b', 'stroke', A([2, 2]));
  h.undo();
  edit('c', 'stroke', A([3, 3]));
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.entries.map((e) => e.label), ['a', 'c']);
  h.undo(); assert.deepEqual(doc.axes.stroke, A([1, 1]));
});

test('coalescing merges rapid same-label edits inside the window only', () => {
  const { doc, h, edit, tick } = setup({ window: 1000 });
  const s0 = doc.axes.stroke;
  edit('Nudge', 'stroke', A([0, 50]), { coalesce: true });
  tick(300); edit('Nudge', 'stroke', A([0, 55]), { coalesce: true });
  tick(300); edit('Nudge', 'stroke', A([0, 60]), { coalesce: true });
  assert.equal(h.entries.length, 1);
  tick(1500); edit('Nudge', 'stroke', A([0, 65]), { coalesce: true });   // window passed
  assert.equal(h.entries.length, 2);
  tick(100); edit('Other', 'stroke', A([0, 70]), { coalesce: true });    // different label
  tick(100); edit('Other', 'stroke', A([0, 75]));                         // not coalescable
  assert.equal(h.entries.length, 4);
  h.goto(1); assert.deepEqual(doc.axes.stroke, A([0, 60]));
  h.goto(0); assert.equal(doc.axes.stroke, s0);
});

test('coalescing never merges into an entry exposed by undo', () => {
  const { h, edit, tick } = setup();
  edit('Nudge', 'stroke', A([0, 50]), { coalesce: true });
  edit('Nudge', 'stroke', A([0, 51]), { coalesce: false });
  h.undo();
  tick(10); edit('Nudge', 'stroke', A([0, 52]), { coalesce: true });
  assert.equal(h.entries.length, 2);
});

test('coalesced edits that return to the start leave no entry', () => {
  const { doc, h, edit } = setup();
  const s1 = A([0, 50]);
  edit('Set', 'stroke', s1);
  const s2 = A([0, 55]);
  edit('Nudge', 'stroke', s2, { coalesce: true });
  h.transact('Nudge', () => { doc.axes = { ...doc.axes, stroke: s1 }; }, { coalesce: true });
  assert.deepEqual(h.entries.map((e) => e.label), ['Set']);
});

test('selection is restored by undo and redo', () => {
  const { doc, h } = setup();
  doc.sel = { ats: [1] };
  h.transact('Delete', () => { doc.axes = { ...doc.axes, stroke: A([5, 5]) }; doc.sel = { ats: [] }; });
  assert.deepEqual(doc.sel, { ats: [] });
  h.undo(); assert.deepEqual(doc.sel, { ats: [1] });
  h.redo(); assert.deepEqual(doc.sel, { ats: [] });
});

test('dirty follows the saved position, including through coalescing', () => {
  const { h, edit, tick } = setup();
  assert.equal(h.dirty, false);
  edit('a', 'stroke', A([1, 1]), { coalesce: true });
  assert.equal(h.dirty, true);
  h.markSaved(); assert.equal(h.dirty, false);
  tick(10); edit('a', 'stroke', A([1, 2]), { coalesce: true });   // merged into the saved entry: still dirty
  assert.equal(h.entries.length, 1); assert.equal(h.dirty, true);
  h.markSaved(); edit('b', 'stroke', A([1, 3]));
  h.undo(); assert.equal(h.dirty, false);
  h.undo(); assert.equal(h.dirty, true);
});

test('memory cap drops the oldest entries, never the newest', () => {
  const { doc, h, edit } = setup({ cap: 50 });
  const big = (n, k) => Array.from({ length: n }, (_, i) => ({ at: i, pos: k }));
  for (let k = 0; k < 10; k++) edit('e' + k, 'stroke', big(10, k));
  assert.ok(h.total <= 50, 'total ' + h.total);
  assert.equal(h.entries.at(-1).label, 'e9');
  assert.ok(h.entries.length < 10);
  edit('huge', 'stroke', big(500, 1));   // bigger than the cap alone: kept anyway
  assert.equal(h.entries.at(-1).label, 'huge');
  h.undo(); assert.equal(doc.axes.stroke[0].pos, 9);
});

test('goto and list', () => {
  const { h, edit } = setup();
  for (const l of ['a', 'b', 'c']) edit(l, 'stroke', A([l.charCodeAt(0), 1]));
  h.goto(1);
  assert.deepEqual(h.list().map((e) => [e.label, e.applied]), [['a', true], ['b', false], ['c', false]]);
  h.goto(99); assert.equal(h.index, 3);
  h.goto(-5); assert.equal(h.index, 0);
});

test('reset forgets history and is clean', () => {
  const { h, edit } = setup();
  edit('a', 'stroke', A([1, 1]));
  h.reset();
  assert.equal(h.entries.length, 0); assert.equal(h.dirty, false); assert.equal(h.canUndo, false);
});

test('undo or redo during an open group: the dead handle is ignored and recording continues', () => {
  for (const op of ['undo', 'redo']) {
    const { doc, h, edit } = setup();
    edit('a', 'stroke', A([1, 1]));
    if (op === 'redo') h.undo();
    const g = h.begin('Drag');
    doc.axes = { ...doc.axes, stroke: A([5, 5]) };
    h[op]();                                   // force-closes the drag (recorded), then undoes / redoes
    g.commit(); g.cancel();                    // late commit / cancel of the dead handle: no effect
    assert.equal(h.depth, 0); assert.equal(h.busy, false);
    const n = h.entries.length;
    edit('after', 'stroke', A([9, 9]));        // recording still works
    assert.equal(h.entries.length >= n, true);
    assert.equal(h.entries[h.index - 1].label, 'after');
    h.undo(); assert.notDeepEqual(doc.axes.stroke, A([9, 9]));
  }
});

test('a cancelled dead handle does not restore stale values', () => {
  const { doc, h, edit } = setup();
  const g = h.begin('Drag');
  doc.axes = { ...doc.axes, stroke: A([5, 5]) };
  h.undo();                                    // commits 'Drag' then undoes it
  edit('b', 'stroke', A([7, 7]));
  g.cancel();
  assert.deepEqual(doc.axes.stroke, A([7, 7]));
  assert.equal(h.depth, 0);
});

test('undo depth on a large document: a one-point edit costs the change, not the whole array', () => {
  const N = 100_000;
  const { doc, h, edit } = setup({ cap: 4_000_000 });
  doc.axes.stroke = Array.from({ length: N }, (_, i) => ({ at: i * 10, pos: i % 100 }));
  for (let k = 0; k < 100; k++) { const s = doc.axes.stroke.slice(); s[k * 7] = { at: s[k * 7].at, pos: 50 }; edit('Set point', 'stroke', s); }
  assert.ok(h.entries.length >= 100, 'kept ' + h.entries.length);   // was 20 with whole-array sizes
});

test('the cap never makes a modified document report clean', () => {
  const { doc, h, edit } = setup({ cap: 50 });
  const big = (n, k) => Array.from({ length: n }, (_, i) => ({ at: i, pos: k }));
  const s0 = doc.axes.stroke;   // saved state = initial (savedId 0)
  for (let k = 0; k < 10; k++) edit('e' + k, 'stroke', big(10, k));
  assert.ok(h.entries.length < 10, 'the cap dropped entries');
  while (h.canUndo) h.undo();
  assert.notEqual(doc.axes.stroke, s0);
  assert.equal(h.dirty, true);
});
