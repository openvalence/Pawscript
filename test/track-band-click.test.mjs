// paw-iphl: in the Track tab most of the shot band is the positioning lane; a click there selected nothing (only the ~8 px row of
// shot numbers did), so the next T tracked the whole video. A click (no drag) on an empty stretch of that lane selects the shot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/features/timeline/ScenesLane.svelte', import.meta.url), 'utf8');
const upFn = src.slice(src.indexOf('function actUp()'), src.indexOf('function actMenu('));

// paw-qoo5: except, in the Track tab, an action over part of one shot (actions-strip.js partOfShot): that click selects the action
test('paw-iphl: a click on an empty stretch of the Actions / positioning lane, and anywhere on the band in the Track tab (but an action over part of one shot), selects the shot under it', () => {
  assert.ok(upFn, 'actUp is there');
  assert.match(upFn, /if \(d\.kind === 'actEmpty' \|\| \(app\.mode === 'track' && !partOfShot\(d\.r, list\)\)\) \{ selectAct\(app, null\); const i = sceneIndexAt\(list, d\.t0\); if \(i >= 0\) \{ tl\.cut = null; applySel\(app, selShot\(i\), 'click'\); \} return; \}/);
});