// The Blender-style area tree (src/app/areas.js): tree operations never lose a panel, the video or the timeline;
// the pixel layout reproduces the old frame; drop zones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTree, place, split, remove, moveTab, moveArea, swap, join, close, neighbour, normalise, leaves, find, hitZone, zoneRect, GAP, RAIL, dockTake, share, roomOf, fit } from '../src/app/areas.js';

const cfg = { left: { size: 300 }, right: { size: 330, tab: 'insp' }, bottom: { size: 400, collapsed: true, sizes: {} }, timeline: { size: 420 } };
const base = () => {
  let t = defaultTree(cfg);
  t = JSON.parse(JSON.stringify(t));
  for (const l of leaves(t)) if (l.home === 'left') l.tabs = ['track']; else if (l.home === 'right') l.tabs = ['insp', 'fix']; else if (l.home === 'bottom') l.tabs = ['graph', 'keys'];
  return t;
};
const tabsOf = (t) => leaves(t).flatMap((l) => l.tabs || []).sort();
const kinds = (t) => leaves(t).filter((l) => l.kind).map((l) => l.kind).sort();

test('default layout: [left | video | right] over the timeline, the folded bottom dock under both, old sizes', () => {
  const g = place(base(), { x: 0, y: 0, w: 1600, h: 900 });
  const r = g.rects;
  assert.deepEqual(r.left, { x: 0, y: 0, w: 300, h: 900 - RAIL - 420 - GAP });
  assert.equal(r.video.x, 300 + GAP);
  assert.equal(r.right.w, 330);
  assert.equal(r.right.x + r.right.w, 1600);
  assert.equal(r.timeline.h, 420);
  assert.equal(r.timeline.w, 1600);
  assert.deepEqual(r.bottom, { x: 0, y: 900 - RAIL, w: 1600, h: RAIL }, 'folded: its rail');
  assert.equal(g.edges.left, 'left'); assert.equal(g.edges.right, 'right'); assert.equal(g.edges.bottom, 'bottom');
  assert.equal(g.borders.length, 3, 'left, right, timeline; none beside a folded area');
});

test('layout: the video keeps its minimum; a hidden leaf gives its room to its sibling; per-tab size', () => {
  const t = base();
  const small = place(t, { x: 0, y: 0, w: 900, h: 900 }).rects;
  assert.ok(small.video.w >= 360, 'video ' + small.video.w);
  const noLeft = place(t, { x: 0, y: 0, w: 1600, h: 900 }, { hidden: (l) => l.id === 'left' }).rects;
  assert.equal(noLeft.left, undefined);
  assert.equal(noLeft.video.x, 0);
  const open = JSON.parse(JSON.stringify(t));
  const b = leaves(open).find((l) => l.home === 'bottom');
  b.collapsed = false; b.sizes = { keys: 200 };
  assert.equal(place(open, { x: 0, y: 0, w: 1600, h: 1200 }, { activeOf: () => 'keys' }).rects.bottom.h, 200);
  assert.equal(place(open, { x: 0, y: 0, w: 1600, h: 1200 }, { activeOf: () => 'graph' }).rects.bottom.h, 400);
});

test('moveTab: centre = a tab there, an edge = a new area; an emptied plain area goes, a dock stays; never onto the video centre', () => {
  const t = base();
  const a = moveTab(t, 'fix', 'left', 'center');
  assert.deepEqual(find(a, 'left').leaf.tabs, ['track', 'fix']);
  assert.equal(find(a, 'left').leaf.tab, 'fix');
  assert.deepEqual(tabsOf(a), tabsOf(t));
  const b = moveTab(t, 'fix', 'video', 'right', 250);
  const nl = leaves(b).find((l) => l.tabs?.[0] === 'fix' && !l.home);
  assert.ok(nl);
  assert.equal(find(b, nl.id).parent.size, 250);
  assert.equal(moveTab(t, 'fix', 'video', 'center'), null);
  assert.equal(moveTab(t, 'track', 'left', 'right'), null, 'its only tab onto its own edge');
  const c = moveTab(b, 'fix', 'right', 'center');
  assert.equal(find(c, nl.id), null, 'the new area emptied: removed');
  const d = moveTab(t, 'track', 'right', 'center');
  assert.ok(find(d, 'left'), 'a dock emptied stays (it hides while empty)');
  assert.deepEqual(kinds(c), ['timeline', 'video']);
});

test('split / remove / swap / moveArea keep everything', () => {
  const t = base();
  const s = split(t, 'right', 'bottom', { id: 'n', tabs: [] }, 200);
  assert.equal(find(s, 'n').parent.dir, 'col');
  assert.equal(find(s, 'n').index, 1);
  assert.deepEqual(remove(s, 'n'), t, 'remove undoes a split');
  assert.equal(remove(t, 'nope'), null);
  const w = swap(t, 'video', 'right');
  assert.equal(find(w, 'video').index, 1);
  assert.equal(find(w, 'right').index, 0);
  const m = moveArea(t, 'timeline', 'right', 'top', 150);
  assert.equal(find(m, 'timeline').parent, find(m, 'right').parent);
  assert.deepEqual(kinds(m), ['timeline', 'video']);
  assert.deepEqual(tabsOf(m), tabsOf(t));
  assert.equal(moveArea(t, 'right', 'right', 'left'), null);
});

test('join: the neighbour sharing the edge; tabs merged; video / timeline never removed; close relocates tabs', () => {
  let t = split(base(), 'right', 'bottom', { id: 'n', tabs: ['x'] }, 200);
  assert.equal(neighbour(t, 'right', 'bottom').id, 'n');
  assert.equal(neighbour(t, 'right', 'left'), null, 'the video is not its direct sibling now');
  const j = join(t, 'right', 'n');
  assert.deepEqual(find(j, 'right').leaf.tabs, ['insp', 'fix', 'x']);
  assert.equal(join(t, 'n', 'video'), null);
  assert.equal(join(base(), 'video', 'right'), null, 'a full area into the video: refused');
  const e = split(base(), 'video', 'left', { id: 'e', tabs: [] }, 200);
  assert.ok(join(e, 'video', 'e'), 'an empty area into the video: fine');
  const c = close(t, 'n');
  assert.deepEqual(find(c, 'right').leaf.tabs, ['insp', 'fix', 'x']);
  assert.equal(close(t, 'video'), null);
});

test('normalise: repairs or refuses', () => {
  const t = base();
  assert.deepEqual(normalise(t), t);
  assert.equal(normalise(null), null);
  assert.equal(normalise({ dir: 'row', pin: 0, size: 10, kids: [{ id: 'video', kind: 'video' }, { id: 'a', tabs: [] }] }), null, 'no timeline');
  const dup = JSON.parse(JSON.stringify(t));
  leaves(dup).find((l) => l.home === 'left').tabs = ['insp', 'track'];
  dup.size = 'x';
  const n = normalise(dup);
  assert.deepEqual(tabsOf(n), ['fix', 'graph', 'insp', 'keys', 'track'], 'a panel listed twice: first wins');
  assert.equal(n.size, 300);
});

test('drop zones: middle fifth = centre, else the nearest edge; preview = that half', () => {
  const r = { x: 0, y: 0, w: 400, h: 200 };
  assert.equal(hitZone(r, 200, 100), 'center');
  assert.equal(hitZone(r, 10, 100), 'left');
  assert.equal(hitZone(r, 390, 100), 'right');
  assert.equal(hitZone(r, 200, 5), 'top');
  assert.equal(hitZone(r, 200, 195), 'bottom');
  assert.deepEqual(zoneRect(r, 'right'), { x: 200, y: 0, w: 200, h: 200 });
  assert.deepEqual(zoneRect(r, 'top'), { x: 0, y: 0, w: 400, h: 100 });
});

test('dockTake: growing the timeline past the video minimum takes the room from the bottom dock, never under its minimum', () => {
  assert.deepEqual(dockTake(300, 342, 400), { size: 300, take: 0 });      // within the room: nothing taken
  assert.deepEqual(dockTake(400, 342, 400), { size: 400, take: 58 });     // past it: the excess leaves the dock
  assert.deepEqual(dockTake(900, 342, 400), { size: 342 + 280, take: 280 });   // the dock stops at its 120 px minimum
  assert.deepEqual(dockTake(500, 342, 100), { size: 342, take: 0 });      // a dock already at its minimum gives nothing
});

test('share: a splitter moves height between its neighbours, pushing on past minimums; the total never changes (paw-3lmy)', () => {
  const sum = (a) => a.reduce((x, y) => x + y, 0), mins = [16, 16, 180, 16];
  const s = [40, 110, 300, 30];
  assert.deepEqual(share(s, mins, 1, 50), [40, 160, 250, 30]);        // down: the part below gives
  assert.deepEqual(share(s, mins, 1, 200), [40, 244, 180, 16]);       // past the fill's minimum: the next one gives, then it stops
  assert.deepEqual(share(s, mins, 1, -120), [16, 16, 418, 30]);       // up: the part above, then the one above that
  assert.deepEqual(share(s, mins, 1, 0), s);
  for (const d of [-500, -7, 3, 999]) for (const i of [0, 1, 2]) { const o = share(s, mins, i, d); assert.equal(sum(o), sum(s)); assert.ok(o.every((x, k) => x >= Math.min(mins[k], s[k]))); }
  assert.equal(roomOf(s, mins, 2, 4), 120 + 14);
  // the lone lane against the timeline's edge: an unbounded part below takes or gives everything
  assert.deepEqual(share([118, Infinity], [48, 0], 0, 60), [178, Infinity]);
  assert.deepEqual(share([118, Infinity], [48, 0], 0, -100).slice(0, 1), [48]);
});

test('fit: fixed rows keep their px and the fill takes the rest; short of room the fixed rows give way; only minimums overflow', () => {
  const sum = (a) => a.reduce((x, y) => x + y, 0), mins = [16, 16, 180];
  assert.deepEqual(fit([44, 110, null], mins, 500), [44, 110, 346]);
  assert.deepEqual(fit([44, 110, null], mins, 334), [44, 110, 180]);  // exactly at the fill's minimum
  const f = fit([44, 110, null], mins, 300);                           // 34 short: the fixed rows give it in proportion
  assert.equal(sum(f), 300); assert.equal(f[2], 180); assert.ok(f[0] < 44 && f[1] < 110 && f[1] - 16 > f[0] - 16);
  assert.deepEqual(fit([44, 110, null], mins, 150), [16, 16, 180]);   // minimums do not fit: the one case past avail
  assert.deepEqual(fit([44, 110], [16, 16], 400), [44, 110]);         // no fill row: room left over stays empty
});
