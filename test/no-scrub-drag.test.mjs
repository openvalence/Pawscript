// A left press / drag scrubs only on the ruler: the filmstrip, the Shots strip and the point lanes' empty area never move
// the playhead on a drag (components cannot mount here, so the handlers' source is checked: the only seek / scrub calls
// reachable from them are the hover preview, the select-a-shot click and the point lane's own click on empty space).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../src/features/' + f, import.meta.url), 'utf8');
const body = (s, name) => { const i = s.indexOf('function ' + name + '('); let d = 0, j = s.indexOf('{', i); for (let k = j; k < s.length; k++) { if (s[k] === '{') d++; if (s[k] === '}' && --d === 0) return s.slice(i, k + 1); } };

test('filmstrip: down / move / up never scrub or seek on a drag; only hover (setting) previews', () => {
  const s = read('timeline/FilmstripLane.svelte');
  for (const f of ['down', 'up', 'cancel']) assert.doesNotMatch(body(s, f), /scrub|\.seek\(/, f);
  const mv = body(s, 'move');
  assert.match(mv, /!drag/, 'a drag branch comes first');
  assert.ok(mv.indexOf('hoverTo') < mv.indexOf('drag.moved'), 'hoverTo only when no drag');
  assert.match(mv.slice(mv.indexOf('hoverTo')), /^hoverTo\(e\);\s*return;/, 'and returns');
  assert.match(mv, /lanes\.hoverScrub/);
  assert.match(body(s, 'up'), /applySel\(app, selShot\(i\), 'click'\)/, 'a click selects the shot');
});

test('Shots / Scenes strips and the other canvas rows have no press-drag scrub', () => {
  for (const f of ['ScenesLane', 'FxLane', 'PlanLane', 'RangeLane'])
    assert.doesNotMatch(read('timeline/' + f + '.svelte'), /scrubTime|\.scrub\(/, f);
});

test('point lane: a drag on empty space is a box select; the playhead moves on a plain click only', () => {
  const s = read('lanes/LaneView.svelte'), up = s.slice(s.indexOf("d.kind === 'box' && d.mode !== 'time'"));
  assert.match(s, /kind === 'box'\) \{[^}]*ov = \{ \.\.\.ov, box/s, 'a box is drawn while dragging');
  assert.doesNotMatch(s.slice(s.indexOf("if (drag.kind === 'box')"), s.indexOf("if (drag.kind === 'box')") + 400), /seek|scrub/);
  assert.match(up, /seekAt/, 'click path');
});
