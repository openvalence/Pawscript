// The timeline row stack's defaults (src/app/layout.svelte.js, compiled for the server so runes are plain fields;
// the rows' order from the features' lane.js): the Tracker under Range, the legacy Plan row hidden, the one-time v2
// migration of stored layouts, Reset rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileModule } from 'svelte/compiler';

const srcUrl = new URL('../src/app/layout.svelte.js', import.meta.url);
const code = compileModule(readFileSync(srcUrl, 'utf8'), { filename: 'layout.svelte.js', generate: 'server' }).js.code
  .replace(/from 'svelte\/internal\/server'/, `from '${import.meta.resolve('svelte/internal/server')}'`)
  .replace(/from '\.\/areas\.js'/, `from '${new URL('../src/app/areas.js', import.meta.url)}'`);
const { Layout, migrateLayout, LAYOUT_V } = await import('data:text/javascript,' + encodeURIComponent(code));

const mockApp = (values = {}, mode = 'refine') => {
  const v = { ...values };
  return { v, mode, panels: [], settings: { get: (k, d) => (v[k] ?? d), set: (k, x) => { v[k] = x; } } };
};

test('default order: Scenes, Effects, Range, Tracker, Plan, Audio, then the lanes (no Loops row: paw-llaa, the loops are on their shots; no Chapters row: paw-1w0x)', () => {
  const orderOf = (file, id) => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const m = src.match(new RegExp(`id: '${id.replace('.', '\\.')}'[^}]*?order: ([\\d.]+)`));
    assert.ok(m, `${id} in ${file}`);
    return +m[1];
  };
  const T = '../src/features/timeline/lane.js';
  const ids = [[T, 'timeline.scenes'], [T, 'timeline.fx'], [T, 'timeline.range'], ['../src/features/tracking/lane.js', 'tracking'],
    [T, 'timeline.plan'], [T, 'timeline.waveform']];
  const orders = ids.map(([f, id]) => orderOf(f, id));
  assert.deepEqual([...orders].sort((a, b) => a - b), orders, `in order: ${orders}`);
  assert.ok(orders.at(-1) < 50, 'all above the axis lanes (order 50)');
});

test('the legacy Plan row starts hidden in every mode; the Tracker keeps its per-mode default', () => {
  for (const mode of ['scenes', 'track', 'refine', 'review', 'draft']) {
    const L = new Layout(mockApp({}, mode));
    assert.equal(L.row('timeline.plan').collapsed, true, mode);
  }
  assert.equal(new Layout(mockApp({}, 'track')).row('tracking').collapsed, false);
  assert.equal(new Layout(mockApp({}, 'refine')).row('tracking').collapsed, true);
  const app = mockApp();
  const L = new Layout(app);
  L.setRow('timeline.plan', { collapsed: false });
  assert.equal(L.row('timeline.plan').collapsed, false, 'one click brings it back');
});

test('v2 migration: entries that only repeat the old default go, customised rows stay; runs once', () => {
  const old = {
    script: { rows: { 'timeline.plan': { height: null, collapsed: false }, tracking: { height: null, collapsed: true }, 'timeline.loops': { height: 40, collapsed: false } } },
    review: { rows: { 'timeline.plan': { height: null, collapsed: false } } },              // shown on purpose (old default hidden)
    track: { rows: { 'timeline.plan': { height: 90, collapsed: false }, tracking: { height: null, collapsed: true } } },   // resized; hid the Tracker
  };
  const m = migrateLayout(old);
  assert.deepEqual(m.refine.rows, { 'timeline.loops': { height: 40, collapsed: false } });
  assert.deepEqual(m.review.rows, old.review.rows);
  assert.deepEqual(m.track.rows, old.track.rows);
  const app = mockApp({ layout: old });
  const L = new Layout(app);
  assert.equal(app.v['layout.v'], LAYOUT_V);
  assert.equal(L.row('timeline.plan').collapsed, true, 'the untouched Plan row now hidden');
  assert.equal(L.row('timeline.loops').height, 40, 'other rows untouched');
  // a later Plan "show" survives the next start (no second migration)
  L.setRow('timeline.plan', { collapsed: false });
  assert.equal(new Layout(app).row('timeline.plan').collapsed, false);
});

test('Reset rows: every row back to the mode default, docks and other modes kept', () => {
  const app = mockApp({ 'layout.v': LAYOUT_V });
  const L = new Layout(app);
  L.setRow('timeline.plan', { collapsed: false, height: 120 });
  L.size('left', 400);
  L.resetRows();
  assert.deepEqual(L.row('timeline.plan'), { height: null, collapsed: true });
  assert.equal(L.cur.left.size, 400);
});

test('v3: Refine (was Script) and Track open the right dock on the timeline Inspector; a dock left on Plan moves over, a chosen tab stays', () => {
  for (const mode of ['refine', 'track']) assert.equal(new Layout(mockApp({}, mode)).cur.right.tab, 'timeline.inspector', mode);
  assert.equal(new Layout(mockApp({}, 'review')).cur.right.tab, 'review.problems');
  const old = {
    script: { right: { tab: 'timeline.plan', collapsed: false, size: 400 }, rows: { 'timeline.plan': { height: null, collapsed: false } } },
    track: { right: { tab: 'inspector.selection', collapsed: true } },
    review: { right: { tab: 'timeline.plan' } },
  };
  const m = migrateLayout(old, 2);
  const right = (all, mode) => new Layout(mockApp({ layout: all, 'layout.v': LAYOUT_V }, mode)).cur.right;
  assert.deepEqual(right(m, 'refine'), { collapsed: false, size: 400, tab: 'timeline.inspector' }, 'tab dropped, size kept');
  assert.deepEqual(m.refine.rows, old.script.rows, 'a v2 layout skips the v1 row step');
  assert.deepEqual(right(m, 'track'), { collapsed: true, size: 330, tab: 'timeline.inspector' });
  assert.equal(right(m, 'review').tab, 'timeline.plan', 'other modes untouched');
  assert.equal(right(migrateLayout({ track: { right: { tab: 'director' } } }, 2), 'track').tab, 'director');
  const app = mockApp({ layout: old, 'layout.v': 2 }, 'refine');
  const L = new Layout(app);
  assert.equal(L.cur.right.tab, 'timeline.inspector');
  assert.equal(L.cur.right.size, 400);
  assert.equal(L.row('timeline.plan').collapsed, false, 'the shown Plan row stays shown');
  assert.equal(app.v['layout.v'], LAYOUT_V);
  L.tab('right', 'timeline.plan');
  assert.equal(new Layout(app).cur.right.tab, 'timeline.plan', 'no second migration');
});

const panel = (id, dock, modes) => ({ id, dock, title: id, ...(modes ? { modes } : {}) });
const PANELS = [panel('tracking', 'left', ['track']), panel('timeline.inspector', 'right'), panel('fix', 'right'), panel('graph', 'bottom'), panel('keys', 'bottom')];

test('v4: a v3 layout becomes the same frame as an area tree; moved panels stay moved; rows untouched', () => {
  const old = { track: { left: { size: 410, collapsed: true }, right: { size: 500, tab: 'fix' }, bottom: { size: 300, collapsed: false, tab: 'keys', sizes: { graph: 700 } }, timeline: { size: 333 }, rows: { tracking: { height: 90 } } } };
  const app = mockApp({ layout: old, 'layout.v': 3, 'layout.docks': { keys: 'left' } }, 'track');
  app.panels = PANELS;
  const L = new Layout(app);
  assert.equal(app.v['layout.v'], LAYOUT_V);
  assert.ok(app.v.layout.track.tree && !app.v.layout.track.left, 'stored as a tree');
  assert.deepEqual(L.cur.left, { size: 410, collapsed: true, tab: '' });
  assert.deepEqual(L.cur.right, { size: 500, collapsed: false, tab: 'fix' });
  assert.equal(L.cur.timeline.size, 333);
  assert.equal(L.sizeOf('bottom', 'graph'), 700, 'per-panel bottom sizes kept');
  assert.equal(L.sizeOf('bottom', 'keys'), 300);
  assert.equal(L.row('tracking').height, 90 + 47, 'v8 (paw-idb5): a stored Tracker height takes the hidden-rows strip (20) and the Chapters row (27)');
  assert.deepEqual(L.panelsIn('left').map((p) => p.id), ['tracking', 'keys'], 'the v3 dock move holds');
  assert.deepEqual(L.panelsIn('bottom').map((p) => p.id), ['graph']);
});

test('default tree: the old frame; docks with nothing to show in a mode are left out', () => {
  const app = mockApp({}, 'refine');
  app.panels = PANELS;
  const L = new Layout(app);
  assert.deepEqual(L.cur.left, { size: 300, collapsed: true, tab: '' });
  assert.equal(L.cur.right.size, 330);
  assert.equal(L.cur.bottom.collapsed, true);
  assert.equal(L.hidden(L.tree.kids[0].kids[0].kids[0]), true, 'no left panel in Refine: no left area');
  assert.deepEqual(L.panelsIn('right').map((p) => p.id), ['timeline.inspector', 'fix']);
  assert.equal(L.dockOf({ id: 'fix' }), 'right');
});

test('areas: dock a tab, split, join; persisted per mode; Reset brings the default back; a corrupt tree falls back', () => {
  const app = mockApp({ 'layout.v': LAYOUT_V }, 'refine');
  app.panels = PANELS;
  const notes = [];
  app.usage = { note: (k, d) => notes.push([k, d.op]) };
  const L = new Layout(app);
  assert.ok(L.moveTab('fix', 'video', 'left', 250));
  const fixAt = L.dockOf({ id: 'fix' });
  assert.ok(fixAt && fixAt !== 'right');
  assert.deepEqual(L.panelsIn('right').map((p) => p.id), ['timeline.inspector']);
  assert.equal(new Layout(app).dockOf({ id: 'fix' }), fixAt, 'persisted');
  app.mode = 'track';
  assert.equal(L.dockOf({ id: 'fix' }), 'right', 'other modes keep their own tree');
  app.mode = 'refine';
  const nid = L.split(fixAt, 'bottom', 100);
  assert.ok(nid && L.panelsIn(nid).length === 0, 'a split opens empty (panel picker)');
  assert.equal(L.hidden({ id: nid, tabs: [] }), false);
  assert.ok(L.moveTab('keys', nid));
  assert.ok(L.join(fixAt, nid));
  assert.deepEqual(L.panelsIn(fixAt).map((p) => p.id), ['fix', 'keys'], 'joined: tabs kept');
  assert.equal(L.join('video', 'timeline'), false, 'the timeline never goes');
  assert.ok(L.toggleMax(fixAt));
  assert.equal(L.maximized, fixAt);
  L.toggleMax();
  assert.equal(L.maximized, null);
  assert.deepEqual(notes.filter(([k]) => k === 'ui:area').map(([, op]) => op), ['dock', 'split', 'dock', 'join', 'max', 'unmax']);
  L.reset();
  assert.equal(L.dockOf({ id: 'fix' }), 'right');
  app.v.layout = { refine: { tree: { dir: 'row', kids: [{ id: 'x' }, { id: 'y' }] } } };
  assert.equal(new Layout(app).dockOf({ id: 'fix' }), 'right', 'no video in it: the default tree');
});

test('pre-areas API: toggle / tab / shows map onto the dock-named areas', () => {
  const app = mockApp({ 'layout.v': LAYOUT_V }, 'track');
  app.panels = PANELS;
  const L = new Layout(app);
  L.toggle('bottom');
  assert.equal(L.cur.bottom.collapsed, false);
  L.tab('bottom', 'keys');
  assert.equal(L.shows('keys'), true);
  assert.equal(L.shows('graph'), false);
  L.toggle('timeline');
  assert.equal(L.cur.timeline.size > 0, true, 'the timeline never folds');
  L.size('right', 9999);
  assert.equal(L.cur.right.size, 680, 'kept inside the old limits');
});

test('v5: the Scenes row (two strips now) loses a stored height at the old one-strip default, keeps any other', () => {
  const m = migrateLayout({ track: { rows: { 'timeline.scenes': { height: 24 }, tracking: { height: 90 } } }, script: { rows: { 'timeline.scenes': { height: 60, collapsed: true } } }, review: { rows: { 'timeline.scenes': { height: 18 } } } }, 4);
  assert.deepEqual(m.track.rows['timeline.scenes'], {}); assert.equal(m.track.rows.tracking.height, 90 + 47, 'v8 (paw-idb5) grows a stored Tracker height');
  assert.deepEqual(m.refine.rows['timeline.scenes'], { height: 60, collapsed: true }, 'a height you set stays');
  assert.deepEqual(m.review.rows['timeline.scenes'], { height: 18 }, 'never grown past what you chose small');
  const v6 = migrateLayout({ track: { rows: { 'timeline.scenes': { height: 46 } } }, script: { rows: { 'timeline.scenes': { height: 80 } } } }, 5);
  assert.deepEqual([v6.track.rows['timeline.scenes'], v6.refine.rows['timeline.scenes']], [{}, { height: 80 }], 'v6: the v5 default goes (a third strip), a chosen height stays');
});

// paw-pq6b: panels / rows removed on 2026-11-16 (014f5cd: Chapters panel + row, the Hint line, Shortcuts as a panel; the Loops row
// before) can still be named in the owner's stored layout: they are left out silently, the area shows what exists.
test('a stored layout naming removed panels and rows: dropped silently, the areas show what exists', () => {
  const live = PANELS.filter((p) => p.id !== 'keys');
  const app = mockApp({ 'layout.v': LAYOUT_V }, 'refine');
  app.panels = live;
  const walk = (n, f) => (n.kids ? { ...n, kids: n.kids.map((k) => walk(k, f)) } : f(n));
  const tree = walk(new Layout(app).tree, (l) => (l.home === 'right' ? { ...l, tabs: ['timeline.markers', 'timeline.inspector', 'keys'], tab: 'timeline.markers' }
    : l.home === 'bottom' ? { ...l, tabs: ['keys'], tab: 'keys', collapsed: false } : l));
  app.v.layout = { refine: { tree, rows: { 'timeline.chapters': { height: 26 }, 'timeline.hint': { collapsed: true }, 'timeline.loops': { height: 40 } } } };
  const L = new Layout(app);
  assert.deepEqual(L.panelsIn('right').map((p) => p.id), ['timeline.inspector', 'fix']);
  const right = L.tree.kids.flatMap(function f(n) { return n.kids ? n.kids.flatMap(f) : [n]; }).find((l) => l.home === 'right');
  assert.equal(L.active(right).id, 'timeline.inspector', 'a removed shown tab falls back to the first live one');
  assert.deepEqual(L.panelsIn('bottom').map((p) => p.id), ['graph']);
  assert.equal(L.shows('timeline.markers'), false);
  assert.deepEqual(L.row('timeline.chapters'), { height: 26, collapsed: false }, 'a stale row entry is inert (no lane reads it)');
});
