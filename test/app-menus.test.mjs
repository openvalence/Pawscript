import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuModel, stripPrefix } from '../src/app/menus.js';

const cmd = (id, menu, source, group, title = id) => ({ id, title, keys: [], menu, source, group, hidden: false });
const toItem = (c, label) => ({ id: c.id, label });

test('Edit starts with Undo/Redo; each other feature is one submenu; big features nest their sections', () => {
  const list = [
    ...Array.from({ length: 12 }, (_, i) => cmd('plan' + i, 'Edit', 'timeline', 'plan', 'Plan: step ' + i)),
    ...Array.from({ length: 30 }, (_, i) => cmd('tt' + i, 'Edit', 'inspector', i < 20 ? 'Transform tools' : 'Quick actions', 'Quick: t' + i)),
    cmd('lanes.cut', 'Edit', 'lanes', 'clip'), cmd('lanes.dup', 'Edit', 'lanes', 'clip'),
    cmd('edit.undo', 'Edit', 'app', 'history'), cmd('edit.redo', 'Edit', 'app', 'history'), cmd('edit.selectAll', 'Edit', 'app', 'select'),
    cmd('pal.x', 'View', 'palette', 'Navigate'),
    cmd('track.run', 'Track', 'tracking', 'track'), ...Array.from({ length: 4 }, (_, i) => cmd('g' + i, 'Track', 'graph', 'Graph')),
  ];
  const m = Object.fromEntries(menuModel(list, toItem).map((x) => [x.label, x.items]));
  assert.deepEqual(m.Edit.slice(0, 2).map((x) => x.id), ['edit.undo', 'edit.redo']);
  const subs = m.Edit.filter((x) => x.items).map((x) => x.label);
  assert.deepEqual(subs, ['Timeline', 'Inspector']);
  assert.ok(m.Edit.length < 15, 'top level stays short: ' + m.Edit.length);
  const insp = m.Edit.find((x) => x.label === 'Inspector').items;
  assert.deepEqual(insp.filter((x) => x.items).map((x) => x.label), ['Transform tools', 'Quick actions']);
  assert.equal(m.Edit.find((x) => x.label === 'Timeline').items[0].label, 'Step 0');   // area prefix dropped inside its submenu
  assert.equal(m.View.length, 1);   // a lone feature item is inlined, not a submenu of one
  assert.equal(m.Track[0].id, 'track.run');
  assert.equal(m.Track.at(-1).label, 'Advanced');   // paw-u6s5: Track has its own layout; another feature's commands nest under Advanced
  assert.equal(m.Track.at(-1).items.at(-1).label, 'Graph');
  assert.equal(stripPrefix('Next loop'), 'Next loop');
});
