import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByMenu, splitMode, parseTime, resolveTime, nextKeys, conflictsById, describeConflict, previewConflicts } from '../src/features/palette/logic.js';

test('groupByMenu: menu order, groups kept together, Other last', () => {
  const list = [
    { id: 'x', menu: 'View', group: 'zoom' }, { id: 'n' }, { id: 'a', menu: 'Edit', group: 'h' },
    { id: 'b', menu: 'Edit', group: 'clip' }, { id: 'c', menu: 'Edit', group: 'h' }, { id: 'z', menu: 'Custom' },
  ];
  const g = groupByMenu(list);
  assert.deepEqual(g.map((x) => x.menu), ['Edit', 'View', 'Custom', 'Other']);
  assert.deepEqual(g[0].items.map((c) => c.id), ['a', 'c', 'b']);
});

test('splitMode reads the prefix', () => {
  assert.deepEqual(splitMode('undo'), { mode: 'commands', text: 'undo' });
  assert.deepEqual(splitMode('> undo'), { mode: 'commands', text: 'undo' });
  assert.deepEqual(splitMode(':1:23.5'), { mode: 'time', text: '1:23.5' });
  assert.deepEqual(splitMode(' @intro'), { mode: 'commands', text: '@intro' }, 'paw-qbvj: no @ mode (bookmarks have no UI)');
});

test('parseTime: clock, units, relative', () => {
  assert.deepEqual(parseTime('1:23.5'), { ms: 83500, rel: 0 });
  assert.deepEqual(parseTime('1:02:03'), { ms: 3723000, rel: 0 });
  assert.deepEqual(parseTime('83s'), { ms: 83000, rel: 0 });
  assert.deepEqual(parseTime('83'), { ms: 83000, rel: 0 });
  assert.deepEqual(parseTime('500ms'), { ms: 500, rel: 0 });
  assert.deepEqual(parseTime('2m'), { ms: 120000, rel: 0 });
  assert.deepEqual(parseTime('+5'), { ms: 5000, rel: 1 });
  assert.deepEqual(parseTime('-1.5s'), { ms: 1500, rel: -1 });
  assert.deepEqual(parseTime('.5'), { ms: 500, rel: 0 });
  for (const bad of ['', 'abc', '1:2:3:4', '5x', '+']) assert.equal(parseTime(bad), null, bad);
  assert.equal(resolveTime({ ms: 5000, rel: -1 }, 2000, 60000), 0);
  assert.equal(resolveTime({ ms: 5000, rel: 1 }, 2000, 60000), 7000);
  assert.equal(resolveTime({ ms: 999999, rel: 0 }, 0, 60000), 60000);
});

test('nextKeys: replace, append, remove, dedupe, back to defaults -> null', () => {
  assert.deepEqual(nextKeys(['Ctrl+K'], ['Ctrl+K'], 0, 'Ctrl+J'), ['Ctrl+J']);
  assert.deepEqual(nextKeys(['Ctrl+K'], ['Ctrl+K'], 1, 'Ctrl+J'), ['Ctrl+K', 'Ctrl+J']);
  assert.equal(nextKeys(['Ctrl+K', 'Ctrl+J'], ['Ctrl+K'], 1, 'Ctrl+K'), null);   // duplicate drops -> defaults
  assert.deepEqual(nextKeys(['Ctrl+K'], ['Ctrl+K'], 0, null), []);
  assert.equal(nextKeys(['Ctrl+J'], ['Ctrl+K'], 0, 'Ctrl+K'), null);
  assert.equal(nextKeys(['B', 'A'], ['A', 'B'], 5, null), null);   // same set, other order: still the defaults
});

test('conflicts: grouped by id and described from each side', () => {
  const list = [
    { keys: 'Escape', ids: ['palette.close', 'edit.escape'], kind: 'same' },
    { keys: 'G', ids: ['x.g', 'player.start'], kind: 'prefix', longer: 'G G' },
  ];
  const m = conflictsById(list);
  assert.equal(m.get('player.start').length, 1);
  assert.equal(m.get('palette.close')[0].kind, 'same');
  const T = { 'edit.escape': 'Clear selection', 'player.start': 'Go to start', 'x.g': 'Grab', 'palette.close': 'Close' };
  const t = (id) => T[id];
  assert.equal(describeConflict(list[0], 'palette.close', ['Escape'], t), 'Esc is also bound to Clear selection');
  assert.equal(describeConflict(list[1], 'x.g', ['G'], t), 'G waits for a second key: G G is Go to start');
  assert.equal(describeConflict(list[1], 'player.start', ['Home', 'G G'], t), 'G G starts with G, which is Grab');
});

test('previewConflicts: only conflicts involving the candidate, with the edited slot replaced', () => {
  const b = [['player.toggle', 'Space'], ['player.start', 'Home'], ['player.start', 'G G'], ['edit.undo', 'Ctrl+Z']];
  assert.deepEqual(previewConflicts(b, 'edit.undo', 0, 'Space').map((c) => c.ids), [['player.toggle', 'edit.undo']]);
  assert.deepEqual(previewConflicts(b, 'edit.undo', 0, 'Ctrl+Y'), []);
  assert.equal(previewConflicts(b, 'edit.undo', -1, 'G')[0].kind, 'prefix');
  // replacing player.start's own Home with G G again: no conflict with itself
  assert.deepEqual(previewConflicts(b, 'player.start', 0, 'G G'), []);
  // the replaced slot no longer counts: rebinding edit.undo from Ctrl+Z to Ctrl+Z conflicts with nothing
  assert.deepEqual(previewConflicts(b, 'edit.undo', 0, 'Ctrl+Z'), []);
});

test('paw-hyof: the palette finds a command by its aliases ("checkpoint" -> Project history / Commit)', async () => {
  const { Registry } = await import('../src/app/commands.js');
  const { rank } = await import('../src/features/palette/fuzzy.js');
  const { commandFields } = await import('../src/features/palette/logic.js');
  const r = new Registry();
  r.register({ id: 'file.history', title: 'Project history', aliases: ['checkpoints', 'commits'], menu: 'File', run() {} });
  r.register({ id: 'view.zoomIn', title: 'Zoom in', menu: 'View', run() {} });
  const found = rank(r.list(), 'checkpoint', { fields: commandFields }).map((x) => x.item.id);
  assert.deepEqual(found, ['file.history']);
});
