// paw-4wal: the boundary menu offered "Camera move" on every freshly detected boundary (each detected shot its own scene),
// then refused it ("The first shot of a scene has no cut before it in the scene"). A camera move there joins the two scenes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTake, sameTake } from '../src/features/timeline/shots.js';

const detected = () => [{ start_ms: 0, end_ms: 10000 }, { start_ms: 10000, end_ms: 20000 }, { start_ms: 20000, end_ms: 32000 }];

test('a camera move on a scene boundary is accepted: the scenes join, the cut is a camera move', () => {
  const r = setTake(detected(), 1, true);
  assert.ok(r, 'accepted');
  assert.equal(r[1].join, true, 'one scene');
  assert.ok(sameTake(r[1]), 'a camera move');
  assert.notEqual(r[2].join, true, 'the next boundary is untouched');
  assert.equal(setTake(r, 1, false)?.[1].split, undefined, 'and back to a cut');
});

test('the first shot has no boundary before it', () => assert.equal(setTake(detected(), 0, true), null));
