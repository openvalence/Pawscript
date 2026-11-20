// paw-ef73.7: one continuous time -> x mapping for every timeline row, overlay and playhead; one frame convention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { msToX, xToMs, headMs } from '../src/lib/lane.js';
import { X, frameTime, frameAt } from '../src/features/timeline/draw.js';
import { layoutTicks } from '../src/features/timeline/ticks.js';

const FPS = [24000 / 1001, 25, 30000 / 1001, 30, 60];

test('X is msToX, unrounded: the same time gives the same (fractional) x to every caller', () => {
  for (const view of [{ start: 0, span: 164000 }, { start: 700.4, span: 2000 }, { start: 12345.678, span: 33.3 }]) {
    for (const w of [1593.6, 2560, 1280.5]) {
      for (const t of [0, 733, 733.333, 12345.6789, view.start + view.span / 3]) {
        assert.equal(X(view, w, t), msToX(view, w, t));
        assert.ok(Math.abs(xToMs(view, w, X(view, w, t)) - t) < 1e-6, 'x -> time round trip');
      }
    }
  }
});

test('frame N starts at round(N * frameMs); the frame at t contains t; x -> frame -> x round trips', () => {
  for (const fps of FPS) {
    const fm = 1000 / fps, view = { start: 600, span: 2000 }, w = 2560;
    for (let n = 0; n < 4000; n += 7) {
      const t = frameTime(n, fm);
      assert.equal(frameAt(t, fm), n, `fps ${fps} frame ${n} at its own start`);
      assert.equal(frameAt((n + 1) * fm - 0.601, fm), n, 'up to the next start (the player clock: TOL_MS early is the next frame, paw-bf4o)');
      const x = X(view, w, t);
      assert.equal(X(view, w, frameTime(frameAt(xToMs(view, w, x), fm), fm)), x, 'x -> frame -> x');
    }
  }
  assert.equal(frameAt(719, 1000 / 30), 21, '0:00.719 is in frame 21 (0.700 to 0.733), never "f22"');
});

test('ruler frame ticks and repeat ticks sit at X of their frame time; nothing on the timeline rounds its x', () => {
  const fm = 1000 / 30, view = { start: 600.25, span: 400 }, w = 2400;
  const lay = layoutTicks(view, w, { mode: 'frames', frameMs: fm });
  for (const x of lay.frames || []) { const n = frameAt(xToMs(view, w, x) + 1e-6, fm); assert.ok(Math.abs(x - X(view, w, frameTime(n, fm))) < 1e-6, 'a frame tick at its frame time'); }
  for (const f of ['src/features/timeline/draw.js', 'src/features/lanes/render.js', 'src/lib/lane.js', 'src/features/timeline/ticks.js', 'src/features/timeline/repeats.js', 'src/features/timeline/loop-marks.js', 'src/features/timeline/Ruler.svelte', 'src/features/timeline/ScenesLane.svelte']) {
    assert.doesNotMatch(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), /Math\.round\((X|msToX)\(/, f);
  }
});

test('the playhead is drawn with the clock while playing, the pointer while scrubbing, else the stored frame time', () => {
  assert.equal(headMs({ playing: true, now: () => 1234.5, timeMs: 1200 }), 1234.5);
  assert.equal(headMs({ playing: false, scrubTime: 719.2, timeMs: 700 }), 719.2);
  assert.equal(headMs({ playing: false, scrubTime: null, timeMs: 700 }), 700);
});
