// paw-ef73.9: where a take is seeded with fades and camera lead-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWindow, seedAt } from '../src/lib/seed-window.js';
import { seedCandidates } from '../src/features/tracking/groups.js';
import { bestPaintFrame } from '../src/features/tracking/repeat-groups.js';

const fm = 40;
const fadeIn = { kind: 'fade-in', f0: -1, f1: 10, t0: null, ts: 0, tm: 0, t1: 400, b0: 0, b1: 80 };
const fadeOut = { kind: 'fade-out', f0: 140, f1: 151, t0: 5600, ts: 5640, tm: 6000, t1: null, b0: null, b1: null };

test('a take that fades in is seeded at or after its first clean frame; a fade out ends the window', () => {
  const shots = [{ start_ms: 0, end_ms: 6000 }];
  const w = seedWindow(shots, 0, [fadeIn, fadeOut], fm, 6000);
  assert.equal(w.a, 400); assert.equal(w.why, 'fade');
  assert.equal(w.b, 5640); assert.equal(w.t0, 0); assert.equal(w.t1, 6000);
  assert.equal(seedAt(w, 120, fm), 400);    // inside the fade in -> its first clean frame
  assert.equal(seedAt(w, 2000, fm), 2000);  // the owner's frame stays
  assert.equal(seedAt(w, 5900, fm), 5600);  // inside the fade out -> its last clean frame
  assert.equal(seedWindow(shots, 0, [], fm, 6000).why, '');
});

test('a pan-in: the seed moves to the static shot of the take (camera move between), or past the camera estimate\'s move', () => {
  const shots = [{ start_ms: 0, end_ms: 1500, tags: ['pan'] }, { start_ms: 1500, end_ms: 5000, join: true, split: 'camera' }];
  const w = seedWindow(shots, 1, [], fm, 5000);
  assert.deepEqual([w.a, w.why, w.t0], [1500, 'lead-in', 0]);
  const one = [{ start_ms: 0, end_ms: 5000, camera: [{ kind: 'zoom', t0: 0 }, { kind: 'static', t0: 1200 }] }];
  assert.deepEqual([seedWindow(one, 0, [], fm, 5000).a, seedWindow(one, 0, [], fm, 5000).why], [1200, 'lead-in']);
  const allMove = [{ start_ms: 0, end_ms: 5000, tags: ['pan'] }];
  assert.equal(seedWindow(allMove, 0, [], fm, 5000).a, 0);   // nothing static: no suggestion
  const hardCut = [{ start_ms: 0, end_ms: 1500, tags: ['pan'] }, { start_ms: 1500, end_ms: 5000 }];
  assert.equal(seedWindow(hardCut, 1, [], fm, 5000).a, 1500);   // another take: its own start
  assert.equal(seedWindow(hardCut, 1, [], fm, 5000).why, '');
});

test('Suggest\'s candidate frames and the best paint frame keep to the window', () => {
  const shots = [{ start_ms: 0, end_ms: 6000 }], w = seedWindow(shots, 0, [fadeIn], fm, 6000);
  const c = seedCandidates(shots, 0, 400, fm, w);
  assert.ok(c.length > 1 && c.every((t) => t >= 400), String(c));
  assert.ok(seedCandidates(shots, 0, 0, fm).includes(0));   // no window: the take's start as before
  // a repeat index whose frames are at 80 (inside the fade) and 800: the best frame is the clean one
  const occ = [{ id: 0, t: 80 }, { id: 0, t: 7000 }, { id: 0, t: 7400 }, { id: 1, t: 800 }, { id: 1, t: 7200 }];
  const ix = { occ, buckets: [{ occ: occ.filter((o) => o.id === 0) }, { occ: occ.filter((o) => o.id === 1) }] };
  const two = [...shots, { start_ms: 6000, end_ms: 8000 }];
  assert.equal(bestPaintFrame(two, 0, ix, new Set()).t, 80);   // without the window: the frame that repeats most, in the fade
  assert.equal(bestPaintFrame(two, 0, ix, new Set(), w).t, 800);
});
