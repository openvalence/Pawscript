// paw-idb5: the bottom of the window. The bottom dock is the bottom tray: folded by default and then no height at all
// (no rail), opened by the status bar's centred button / Ctrl+J; its height and tab are remembered; open, it takes its px
// from the timeline, never the video (areas.js placeTray). F1's overlay starts with "Here: <tab>" (palette/here.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileModule } from 'svelte/compiler';
import { defaultTree, placeTray, place, trayGive, GAP } from '../src/app/areas.js';
import { hereFor, HERE } from '../src/features/palette/here.js';

const code = compileModule(readFileSync(new URL('../src/app/layout.svelte.js', import.meta.url), 'utf8'), { filename: 'layout.svelte.js', generate: 'server' }).js.code
  .replace(/from 'svelte\/internal\/server'/, `from '${import.meta.resolve('svelte/internal/server')}'`)
  .replace(/from '\.\/areas\.js'/, `from '${new URL('../src/app/areas.js', import.meta.url)}'`);
const { Layout, rowsIn } = await import('data:text/javascript,' + encodeURIComponent(code));

const panel = (id, dock, modes) => ({ id, title: id, dock, modes, component() {} });
const PANELS = [panel('tracking', 'left', ['track']), panel('timeline.inspector', 'right'), panel('timeline.rows', 'bottom'), panel('graph', 'bottom', ['track', 'refine'])];
const mockApp = (values = {}, mode = 'track') => {
  const v = { ...values };
  return { v, mode, panels: PANELS, settings: { get: (k, d) => (v[k] ?? d), set: (k, x) => { v[k] = x; } } };
};
const bottomOf = (t) => (function walk(n) { return n.kids ? walk(n.kids[0]) || walk(n.kids[1]) : n.home === 'bottom' ? n : null; })(t);

test('the tray is folded by default and then takes no height (no rail); open, it has its own height', () => {
  const app = mockApp();
  const L = new Layout(app);
  assert.equal(L.trayOpen, false, 'folded by default');
  const tray = bottomOf(L.tree);
  assert.equal(L.hidden(tray), true, 'folded = left out of the layout');
  const r = { x: 0, y: 0, w: 1280, h: 640 };
  const opts = { hidden: (l) => L.hidden(l), activeOf: (l) => L.active(l)?.id };
  const shut = placeTray(L.tree, r, opts);
  assert.equal(shut.rects[tray.id], undefined, 'not drawn');
  assert.equal(shut.give, 0);
  assert.equal(shut.rects.timeline.y + shut.rects.timeline.h, r.h, 'the timeline reaches the bottom edge (the status bar is under it)');
  L.toggle('bottom');
  assert.equal(L.trayOpen, true);
  const open = placeTray(L.tree, r, opts);
  assert.ok(open.rects[bottomOf(L.tree).id].h >= 120, 'open: its own height');
  assert.equal(L.panelsIn('bottom').map((p) => p.id).join(), 'timeline.rows,graph', 'its tabs: Rows, then Graph (Track)');
  L.toggle('bottom');
  assert.equal(L.trayOpen, false, 'the button / Ctrl+J folds it again');
});

test('open, the tray takes its px from the timeline: the video never moves; folded, the timeline gets them back', () => {
  const c = { left: { size: 300 }, right: { size: 330 }, bottom: { size: 200, collapsed: true }, timeline: { size: 400 } };
  const r = { x: 0, y: 0, w: 1280, h: 680 }, none = { hidden: (l) => !!(l.home === 'bottom' && l.collapsed) };
  const shut = placeTray(defaultTree(c), r, none);
  const t = defaultTree({ ...c, bottom: { size: 200, collapsed: false } });
  const open = placeTray(t, r, { hidden: () => false });
  assert.equal(open.give, 200 + GAP);
  assert.equal(open.rects.bottom.h, 200);
  assert.equal(open.rects.video.h, shut.rects.video.h, 'the video keeps its height');
  assert.equal(open.rects.timeline.h, shut.rects.timeline.h - 200 - GAP, 'the timeline gives the tray its height');
  assert.equal(open.rects.timeline.y + open.rects.timeline.h + GAP, open.rects.bottom.y, 'the tray right under the timeline');
  // the old frame (plain place): the video gave way instead (here down to its minimum)
  assert.ok(place(t, r, { hidden: () => false }).rects.video.h < shut.rects.video.h);
  // a timeline at its minimum: the video gives the rest (nothing overlaps, nothing scrolls)
  const big = placeTray(defaultTree({ ...c, bottom: { size: 380, collapsed: false } }), r, { hidden: () => false });
  assert.equal(big.rects.timeline.h, 120);
  assert.equal(big.rects.video.h + big.rects.timeline.h + big.rects.bottom.h + 2 * GAP, r.h);
  // a tray moved away from under the timeline (a user's own layout): nothing special
  assert.equal(trayGive({ dir: 'row', pin: 1, size: 200, kids: [{ id: 'timeline', kind: 'timeline' }, { id: 'b', home: 'bottom' }] }, { b: { h: 300 } }), 0);
});

test('the tray remembers its height (per tab shown in it) and its last tab, in settings', () => {
  const app = mockApp();
  const L = new Layout(app);
  L.tab('bottom', 'graph');
  L.size('bottom', 333, 'graph');
  const again = new Layout({ ...app, settings: app.settings });
  assert.equal(again.trayOpen, true, 'opened by showing a tab: still open');
  assert.equal(bottomOf(again.tree).tab, 'graph');
  assert.equal(again.sizeOf('bottom', 'graph'), 333);
  again.toggle('bottom', false);
  assert.equal(new Layout({ ...app, settings: app.settings }).trayOpen, false, 'folded state remembered');
  assert.equal(bottomOf(new Layout({ ...app, settings: app.settings }).tree).tab, 'graph', 'the last tab kept while folded');
});

test('rowsIn: the rows of the current tab, in order, a row that hides itself left out (Timeline.svelte and the tray\'s Rows tab)', () => {
  const lanes = [{ id: 'b', order: 20 }, { id: 'a', order: 10 }, { id: 's', order: 5, modes: ['scenes'] }, { id: 'v', order: 30, visible: () => false }, { id: 'o', order: 40, orderIn: { track: 1 } }];
  assert.deepEqual(rowsIn(lanes, { mode: 'track' }).map((r) => r.id), ['o', 'a', 'b']);
  assert.deepEqual(rowsIn(lanes, { mode: 'scenes' }).map((r) => r.id), ['s', 'a', 'b', 'o']);
});

// ---- F1's "Here" section ----
const reg = (keys, off = []) => ({ get: (id) => (id in keys ? { id } : null), keysFor: (id) => keys[id] || [], enabled: (id) => !off.includes(id) });

test('F1 Here, Scenes: the old hint line\'s keys in its order, from the commands (a rebinding shows)', () => {
  const keys = { 'timeline.key.cut': ['K'], 'timeline.key.mergePrev': ['Shift+M'], 'timeline.key.mergeNext': ['M'], 'timeline.key.newScene': ['N'], 'timeline.shot.cutaway': ['Alt+C'],
    'timeline.key.prevCut': ['['], 'timeline.key.nextCut': [']'], 'timeline.key.prevScene': ['Shift+['], 'timeline.key.nextScene': ['Shift+]'],
    'timeline.key.nudgeEarlier': [','], 'timeline.key.nudgeLater': ['.'], 'timeline.zoom.frames': ['Shift+Z'] };
  const h = hereFor({ mode: 'scenes', tabs: { home: false } }, reg({ ...keys, 'timeline.key.cut': ['Ctrl+K'] }));
  assert.equal(h.title, 'Here: Scenes');
  assert.deepEqual(h.items.map((i) => i.what), ['cut here', 'merge left / right', 'new scene', 'cutaway', 'cuts', 'scenes', 'move the cut a frame', 'frames']);
  assert.deepEqual(h.items[0].keys, ['Ctrl+K'], 'the user\'s binding');
  assert.deepEqual(h.items[1].keys, ['Shift+M', 'M']);
});

test('F1 Here: each tab its own list; what does not apply now is marked off; unknown / unbound commands are left out', () => {
  for (const m of ['track', 'refine', 'review']) assert.ok(HERE[m].length >= 5, m);
  const h = hereFor({ mode: 'review', tabs: { home: false } }, reg({ 'review.nextProblem': ['F8'], 'review.prevProblem': ['Shift+F8'], 'review.fixProblem': ['Ctrl+F8'] }, ['review.fixProblem']));
  assert.equal(h.title, 'Here: Review');
  assert.deepEqual(h.items.map((i) => [i.what, i.off]), [['previous / next problem', false], ['fix this problem', true]]);
});

test('F1 Here, Track: hold Space: scrub is listed, on only while the Groups tool is open (its brush key applies)', () => {
  const keys = { 'tracking.groups': ['Tab'], 'tracking.groupsSmaller': ['['] };
  const item = (off) => hereFor({ mode: 'track', tabs: { home: false } }, reg(keys, off)).items.find((i) => /^hold Space: scrub/.test(i.what));
  assert.deepEqual(item([]).keys, ['Space']);
  assert.equal(item([]).off, false, 'the tool open');
  assert.equal(item(['tracking.groupsSmaller']).off, true, 'the tool closed');
  assert.deepEqual(hereFor({ mode: 'track', tabs: { home: false } }, reg(keys)).items.find((i) => i.what.startsWith('Groups: paint')).keys, ['Tab']);
});

test('F1 Here on the home tab: the project page\'s keys (arrows, Enter, type to filter, Ctrl+Tab)', () => {
  const h = hereFor({ mode: 'track', tabs: { home: true } }, reg({ 'tabs.next': ['Ctrl+Tab'], 'tabs.prev': ['Ctrl+Shift+Tab'], 'palette.open': ['Ctrl+K'], 'file.open': ['Ctrl+O'] }));
  assert.equal(h.place, 'home');
  assert.equal(h.title, 'Here: Projects');
  const what = h.items.map((i) => i.what);
  for (const w of ['move between the projects', 'open the project', 'type a letter or digit: filter the list', 'next / previous tab']) assert.ok(what.includes(w), w);
  assert.deepEqual(h.items.find((i) => i.what === 'next / previous tab').keys, ['Ctrl+Tab', 'Ctrl+Shift+Tab']);
});

test('layout v8: a stored layout gives the freed px to the timeline (folded tray: the rail) and a stored Tracker height (strip + Chapters)', async () => {
  const code8 = code;   // the module above
  const { migrateLayout, FREED, LAYOUT_V } = await import('data:text/javascript,' + encodeURIComponent(code8));
  assert.equal(LAYOUT_V, 8);
  const tree = (collapsed) => defaultTree({ left: { size: 300 }, right: { size: 330 }, bottom: { size: 300, collapsed }, timeline: { size: 450 } });
  const out = migrateLayout({ track: { tree: tree(true), rows: { tracking: { height: 90 } } }, refine: { tree: tree(false) }, scenes: { tree: tree(true), rows: { 'timeline.chapters': { collapsed: true }, tracking: { height: 50 } } } }, 7);
  assert.equal(out.track.tree.kids[0].size, 450 + FREED.rail, 'folded tray: its rail px go to the timeline');
  assert.equal(out.refine.tree.kids[0].size, 450, 'an open tray keeps its own px: nothing to give');
  assert.equal(out.track.rows.tracking.height, 90 + FREED.strip + FREED.chapters, 'Track hid Plan / Audio / Probe (the strip) and showed Chapters');
  assert.equal(out.scenes.rows.tracking.height, 50 + FREED.strip, 'Chapters was hidden there: only the strip');
  assert.deepEqual(migrateLayout({ track: { tree: tree(true) } }, 8).track.tree.kids[0].size, 450, 'v8 layouts are left alone');
  assert.equal(FREED.rail + FREED.strip + FREED.chapters, 181 - 110, 'the Tracker default grew by exactly that (tracking/lane.js)');
});
