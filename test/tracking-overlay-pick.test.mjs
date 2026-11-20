// overlay-pick.js: the video overlay draws only the frame on show, and only the selected shots' trackers unless it follows the playhead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayPick, selectionSpan } from '../src/features/tracking/overlay-pick.js';

const run = (id, t0, t1, extra = {}) => {
  const t = [];
  for (let ms = t0; ms < t1; ms += 40) t.push(ms);
  return { id, range: { start: t0, end: t1 }, scenes: [], frames: { t, v: t.map(() => 0), ov: t.map((ms) => ({ pts: [[0.5, 0.5, 1, 1]], ms })) }, ...extra };
};
const shots = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000 }];
const A = run('A', 0, 4000), B = run('B', 4000, 8000);

test('selecting the next shot hides the previous shot\'s trackers, wherever the playhead is', () => {
  const spanA = selectionSpan(shots, [0]), spanB = selectionSpan(shots, [1]);
  assert.equal(overlayPick({ runs: [A], selected: A, t: 2000, span: spanA }).run, A);
  assert.equal(overlayPick({ runs: [A], selected: A, t: 2000, span: spanB }), null, 'shot B selected: nothing of A');
  assert.equal(overlayPick({ runs: [A], selected: A, t: 5000, span: spanB }), null, 'B has no run: nothing stays');
  assert.equal(overlayPick({ runs: [A, B], selected: A, t: 5000, span: spanB }).run, B, 'B\'s own run');
  assert.equal(overlayPick({ runs: [A], selected: A, t: 2000, span: null }).run, A, 'nothing selected: the playhead\'s');
});

test('the frame drawn is the one at t: never another time\'s pts', () => {
  assert.equal(overlayPick({ runs: [A], selected: A, t: 4100, frameMs: 40 }), null, 'past the run: nothing (was the last frame for 250 ms)');
  const gap = { ...A, frames: { ...A.frames, t: A.frames.t.filter((ms) => ms < 1000 || ms > 2000) } };
  gap.frames.ov = gap.frames.t.map((ms) => ({ ms }));
  assert.equal(overlayPick({ runs: [gap], selected: gap, t: 1500, frameMs: 40 }), null, 'a hole in the frames: nothing');
  const c = overlayPick({ runs: [A], selected: A, t: 1010, frameMs: 40 });
  assert.equal(c.fr.ov[c.i].ms, 1000);
});

test('follow playhead: every scene\'s run as the video plays, whatever is selected; preference selected > linked > newest', () => {
  const spanA = selectionSpan(shots, [0]);
  assert.equal(overlayPick({ runs: [A, B], selected: A, t: 5000, follow: 'playhead', span: spanA }).run, B);
  const C = run('C', 0, 8000);
  assert.equal(overlayPick({ runs: [A, C], selected: null, t: 1000 }).run, C, 'newest');
  assert.equal(overlayPick({ runs: [A, C], selected: null, linked: A, t: 1000 }).run, A, 'the shot\'s linked run');
  assert.equal(overlayPick({ runs: [A, C], selected: C, linked: A, t: 1000 }).run, C, 'the selected run first');
  assert.equal(overlayPick({ runs: [A], selected: A, t: 1000, visible: () => false }), null, 'hidden ghosts draw nothing');
  assert.equal(overlayPick({ runs: [{ ...A, tag: 'camera' }], t: 1000 }), null, 'the camera reference never draws');
});
