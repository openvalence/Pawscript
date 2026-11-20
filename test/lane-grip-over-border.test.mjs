// paw-s3ex: the last lane's grip sits on the timeline section's bottom edge, which is an area border when the bottom tray is
// open (Areas .border). The border's hit band reaches over the grip; when the border wins, a grip drag hands the room to the
// squeezed timeline rows first (the lane stays 144 px on the Track tab) and a double-click resets the section instead of
// giving the lane its default height. The grip must stack above the border.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = (f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8').split('<style>')[1];
const z = (src, sel) => { const m = src.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); const v = m?.[1].match(/z-index:\s*(\d+)/); return v ? +v[1] : null; };

test('paw-s3ex: the last lane grip stacks above the area border on the section edge', () => {
  const border = z(css('app/Areas.svelte'), '.border'), grip = z(css('features/lanes/LaneStack.svelte'), '.lrow:last-child .split');
  assert.ok(border != null, 'Areas .border has a z-index');
  assert.ok(grip != null && grip > border, `the last grip's z-index (${grip}) is above the border's (${border})`);
});
