// Machine panel display time (src/features/machine/clock.js) and the player's unsnapped scrub time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayClock, timeSource, ScrubGate } from '../src/features/machine/clock.js';
import { bulgeSample } from '../src/features/machine/centreline.js';
import { readFileSync } from 'node:fs';

test('time source: the continuous clock while playing, else the frame on screen (a scrub too)', () => {
  // paw-o60v.8.1: paused (a scrub drag included) it is the frame on screen, never the pointer's time ahead of it
  assert.deepEqual(timeSource({ scrubTime: 1234.5, playing: false, displayMs: 1233.3, shownMs: 1200 }), { t: 1200, direct: false });
  assert.deepEqual(timeSource({ scrubTime: null, playing: true, now: () => 999.9, timeMs: 966, shownMs: 966 }), { t: 999.9, direct: true });
  assert.deepEqual(timeSource({ scrubTime: null, playing: false, displayMs: 500, shownMs: 467 }), { t: 467, direct: false });
  // both players carry the unsnapped scrub time, null unless a scrub drag sets it
  for (const f of ['../src/app/player.svelte.js', '../src/features/video/player.svelte.js']) assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /scrubTime = \$state\(null\)/);
  // every scrub drag sets it and clears it on release
  const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.match(src('../src/features/timeline/Ruler.svelte'), /scrubTime = c;[\s\S]*scrubTime = null;[\s\S]*scrubTime = null;/);
  assert.match(src('../src/features/lanes/LaneView.svelte'), /scrubTime = clampT\([\s\S]*function scrubDone\(d\) \{ app\.player\.scrubTime = null;/);
  assert.match(src('../src/features/lanes/LaneStack.svelte'), /p\.scrubTime = c0;[\s\S]*scrubTime = null; app\.player\.scrubEnd/);
});

test('display clock: lands on each frame-quantised update just as the next one arrives, never overshoots', () => {
  // the playhead advances one 33.3 ms frame every 33 ms of wall time; the display refreshes at 240 Hz
  const c = new DisplayClock(), frame = 1000 / 30, rAF = 1000 / 240;
  let target = 1000, nextUpd = 0, lastShown = -Infinity, worst = 0;
  for (let now = 0; now < 2000; now += rAF) {
    if (now >= nextUpd) {
      if (nextUpd > 100) worst = Math.max(worst, Math.abs(c.value(now) - target));   // where it is when the next update lands
      target += frame; nextUpd += 33;
    }
    const v = c.at(target, now, { frameMs: frame });
    assert.ok(v <= target + 1e-9 && v >= lastShown - 1e-9, `monotonic, no overshoot at ${now}`);
    lastShown = v;
  }
  assert.ok(worst <= frame * (rAF / 33) + 1e-6, `within one display frame of the target (${worst.toFixed(2)} ms of script)`);
});

test('display clock: a big seek snaps, an early update retargets without a jump, and it rests on the playhead', () => {
  const c = new DisplayClock();
  c.at(0, 0); c.at(33, 33);
  const mid = c.at(66, 50);
  assert.ok(mid > 0 && mid < 66);
  const before = c.value(55), after = c.at(100, 55);
  assert.ok(Math.abs(after - before) < 1e-9, 'retargeted from where it was');
  assert.equal(c.at(5000, 60), 5000, 'more than a second away: snap');
  assert.equal(c.at(5000, 1000), 5000);
  assert.equal(c.moving(1000), false);
});

test('scrub gate (paw-ekys): a moving playhead marks the panel scrubbing until it rests; playing never does', () => {
  const g = new ScrubGate(140);
  assert.equal(g.tick(1000, 0, false), false, 'the first frame is not a scrub');
  assert.equal(g.tick(1000, 16, false), false, 'a resting playhead');
  assert.equal(g.tick(1200, 32, false), true, 'it moved');
  assert.equal(g.tick(1400, 48, false), true);
  assert.equal(g.tick(1400, 150, false), true, 'within 140 ms of the last move');
  assert.equal(g.tick(1400, 200, false), false, 'rested: the next frame refines');
  assert.equal(g.tick(5000, 216, true), false, 'playing is not scrubbing');
  assert.equal(g.tick(6000, 232, true), false);
});

test('the bulge readout samples a cached third of the belly skin, never the back or other parts (paw-ekys)', () => {
  const n = 3000, pos = new Float32Array(n * 3), col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { pos.set([0, (i % 100) * 7, i % 2 ? -50 : 80], i * 3); col[i * 4 + 3] = i % 10 === 9 ? 3 : 1; }
  const ix = bulgeSample({ pos, col });
  assert.equal(bulgeSample({ pos, col }) === ix, false, 'cached per mesh object');
  const m = { pos, col }, a = bulgeSample(m);
  assert.equal(bulgeSample(m), a, 'the same array for the same mesh');
  assert.ok(a.length > 0 && a.length < n / 5);
  for (const i of a) { assert.equal(col[i * 4 + 3], 1); assert.ok(pos[i * 3 + 2] < 40 && pos[i * 3 + 1] > 50 && pos[i * 3 + 1] < 560); }
});
