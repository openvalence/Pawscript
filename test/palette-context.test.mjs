// paw-m3b6 step 4: the palette ranks by where it was opened, and finds settings and panels. Pure (features/palette/logic.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteContext, contextBoost, rankResults, settingItems, panelItems, valueText } from '../src/features/palette/logic.js';
import { hereFor } from '../src/features/palette/here.js';

const cmd = (id, title, source, enabled = true) => ({ id, title, source, enabled, keys: [], menu: 'Edit' });
const ids = (found) => found.map((f) => f.item.id);

test('the same query in two contexts: the row / tab it was opened in comes first', () => {
  const items = [cmd('timeline.plan.delete', 'Delete segment', 'timeline'), cmd('lanes.deleteSelected', 'Delete selected points', 'lanes')];
  const refine = { place: 'refine', row: null, area: 'timeline', tool: null };
  const planRow = { place: 'scenes', row: 'plan', area: null, tool: null };
  assert.deepEqual(ids(rankResults(items, 'delete', { ctx: refine })), ['lanes.deleteSelected', 'timeline.plan.delete'], 'Refine: the points (its Here list, its feature)');
  assert.deepEqual(ids(rankResults(items, 'delete', { ctx: planRow })), ['timeline.plan.delete', 'lanes.deleteSelected'], 'the Plan row focused: its delete');
  assert.deepEqual(ids(rankResults(items, 'delete')), ['timeline.plan.delete', 'lanes.deleteSelected'], 'no context: the fuzzy score alone');
});

test('context orders near-equal matches only: a clearly better match stays first', () => {
  const items = [cmd('player.toggle', 'Play / pause', 'app'), cmd('review.playFromPrevious', 'Play from before the previous problem', 'review')];
  const ctx = { place: 'review', row: null, area: 'review.problems', tool: null };
  assert.ok(contextBoost(items[1], ctx) > 0);
  assert.deepEqual(ids(rankResults(items, 'play / pause', { ctx })), ['player.toggle']);
  assert.ok(contextBoost(items[0], ctx) <= 12 && contextBoost(items[1], ctx) <= 12);
});

test('enabled before disabled at near-equal score; a disabled command still listed', () => {
  const items = [cmd('a.cut', 'Cut points', 'app', false), cmd('b.cut', 'Cut points here', 'app', true)];
  assert.deepEqual(ids(rankResults(items, 'cut')), ['b.cut', 'a.cut']);
});

test('the active tool and the area under the pointer lift their commands', () => {
  const g = cmd('tracking.groupsGrow', 'Grow a dab', 'tracking'), o = cmd('lanes.scale', 'Grow selection', 'lanes');
  assert.equal(contextBoost(g, { place: 'refine', tool: 'tracking.groups' }), 6);
  assert.equal(contextBoost(o, { place: 'scenes', area: 'timeline' }), 3);
  assert.equal(contextBoost(o, null), 0);
});

test('settings and panels are results, below a command of the same score', () => {
  const entries = [
    { key: 'edit.snapFrames', label: 'Snap to frames', type: 'boolean', doc: 'Points land on frame starts' },
    { key: 'ui.theme', label: 'Theme', type: 'string', options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] },
    { key: 'layout', label: 'Layout', type: 'object', internal: true },
  ];
  const vals = { 'edit.snapFrames': true, 'ui.theme': 'light' };
  const s = settingItems(entries, (k) => vals[k]);
  assert.deepEqual(s.map((x) => [x.title, x.toggle]), [['Setting: Snap to frames (On)', true], ['Setting: Theme (Light)', false]], 'internal state is not listed');
  const p = panelItems([{ id: 'review.problems', title: 'Problems', icon: 'warning' }]);
  assert.equal(p[0].title, 'Panel: Problems');
  const found = rankResults([cmd('review.next', 'Problems: next', 'review'), ...s, ...p], 'problems');
  assert.deepEqual(ids(found), ['review.next', 'panel:review.problems']);
  assert.deepEqual(ids(rankResults([cmd('x.theme', 'Theme', 'app'), ...s], 'theme')), ['x.theme', 'setting:ui.theme']);
  assert.deepEqual(ids(rankResults(s, 'snap')), ['setting:edit.snapFrames'], 'found by its label');
  assert.deepEqual(ids(rankResults(s, 'frame starts')), ['setting:edit.snapFrames'], 'and by its description');
});

test('valueText: On / Off, the choice label, the unit, private', () => {
  assert.equal(valueText({ type: 'boolean' }, false), 'Off');
  assert.equal(valueText({ type: 'number', unit: 'GB' }, 4), '4 GB');
  assert.equal(valueText({ type: 'string' }, ''), 'Not set');
  assert.equal(valueText({ type: 'string', private: true }, 'secret'), 'Set');
});

test('paletteContext: tab, focused row, the area under the pointer (its shown panel), the tool', () => {
  const app = { mode: 'review', tabs: { home: false }, player: { overlays: { tool: 'tracking.groups' } },
    layout: { hover: 'r1', tree: { dir: 'row', pin: 0, size: 300, kids: [{ id: 'r1', tabs: [] }, { id: 'video', kind: 'video' }] }, active: (l) => (l.id === 'r1' ? { id: 'review.problems' } : null) } };
  assert.deepEqual(paletteContext(app, 'plan'), { place: 'review', row: 'plan', area: 'review.problems', tool: 'tracking.groups' });
  app.layout.hover = 'video';
  assert.equal(paletteContext(app).area, 'video');
  assert.deepEqual(paletteContext({ mode: 'track', tabs: { home: true } }), { place: 'home', row: null, area: null, tool: null }, 'the project page: no layout');
});

test('hereFor names its command ids (the palette\'s Here section runs them)', () => {
  const reg = { get: (id) => ({ id }), keysFor: () => ['K'], enabled: () => true };
  const h = hereFor({ mode: 'review', tabs: { home: false } }, reg);
  assert.deepEqual(h.items[0].ids, ['review.prevProblem', 'review.nextProblem']);
});
