// paw-ef73.22: the grey frame cursor (frame-cursor.js: pointer / playhead time -> the frame's start x and width, one time -> x
// mapping, at several zooms and frame rates), its setting (off draws nothing), and the playhead rule behind the pink line:
// every move that is not a scrub leaves the playhead on the frame start (the Player's restMs / scrubTime / playheadMs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';

const noGlob = (s) => s.replace(/import\.meta\.glob\(/g, '((..._) => ({}))(');
registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    const file = fileURLToPath(url), src = () => readFileSync(file, 'utf8');
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: noGlob(compileModule(src(), { filename: file, generate: 'server' }).js.code) };
    if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: noGlob(compile(src(), { filename: file, generate: 'server' }).js.code) };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    if (url.endsWith('.json')) return { format: 'module', shortCircuit: true, source: 'export default ' + src() };
    return next(url, ctx);
  },
});
const root = new URL('../src/', import.meta.url);
const { frameBoxAt, frameCursorOf, frameCursorMode, nextFrameCursorMode, FRAME_CURSOR_MODES, BLOCK_MIN_PX } = await import(new URL('features/timeline/frame-cursor.js', root));
const { X, frameTime, frameAt } = await import(new URL('features/timeline/draw.js', root));
const { xToMs, headMs } = await import(new URL('lib/lane.js', root));
const { SCHEMA, Settings } = await import(new URL('app/settings.svelte.js', root));
const { Player } = await import(new URL('features/video/player.svelte.js', root));
const { makeClock } = await import(new URL('features/video/frames.js', root));

const FPS = [24000 / 1001, 25, 30000 / 1001, 30, 60];

test('pointer x -> the frame under it: its start x, its width, at several zooms and frame rates', () => {
  for (const fps of FPS) for (const span of [400, 2000, 30000, 600000]) for (const w of [1593.6, 1280]) {
    const fm = 1000 / fps, view = { start: 1234.5, span };
    for (let px = 3; px < w; px += 97.3) {
      const t = xToMs(view, w, px), b = frameBoxAt(view, w, t, fm);
      assert.equal(b.n, frameAt(t, fm));
      assert.equal(b.x, X(view, w, frameTime(b.n, fm)), 'the frame start, by the shared mapping');
      assert.ok(Math.abs(b.w - (X(view, w, frameTime(b.n + 1, fm)) - b.x)) < 1e-9);
      const tol = (1.1 / span) * w;   // the clock accepts TOL_MS early and the frame is drawn from its stored start (rounded: up to 0.5 ms late)
      assert.ok(b.x <= px + tol + 1e-6 && px < b.x + b.w + 1e-6, `fps ${fps} span ${span}: the pointer is inside its frame`);
      assert.equal(b.wide, b.w >= BLOCK_MIN_PX);
    }
  }
});

test('the cursor steps one frame width per frame and sits on the frame start at rest', () => {
  for (const fps of [23.976, 29.97, 25]) {
    const fm = 1000 / fps, view = { start: 0, span: 1000 }, w = 1600;
    const a = frameBoxAt(view, w, 500, fm), b = frameBoxAt(view, w, 500 + fm, fm);
    assert.equal(b.n, a.n + 1);
    assert.ok(Math.abs(b.x - a.x - a.w) < 1e-9, 'the next frame starts where this one ends');
    assert.equal(frameBoxAt(view, w, frameTime(a.n, fm), fm).x, a.x, 'a playhead on a frame start: the same frame');
    assert.equal(frameBoxAt(view, w, (a.n + 1) * fm - 0.61, fm).n, a.n, 'just over TOL_MS before the next start: still this frame');
  }
});

test('modes: off draws nothing, ruler only on the ruler, full on every row; the block and number only on the ruler where a frame is wide', () => {
  const view = { start: 0, span: 1000 }, fm = 1000 / 24, args = [view, 1600, 500, fm];
  assert.equal(frameCursorOf('off', true, ...args), null);
  assert.equal(frameCursorOf('off', false, ...args), null);
  assert.ok(frameCursorOf('ruler', true, ...args));
  assert.equal(frameCursorOf('ruler', false, ...args), null);
  assert.ok(frameCursorOf('full', false, ...args));
  assert.equal(frameCursorOf('full', false, ...args).block, false);
  assert.equal(frameCursorOf('full', true, ...args).block, true);
  assert.equal(frameCursorOf('full', true, { start: 0, span: 600000 }, 1600, 500, fm).block, false, 'thin frames: a line only');
  assert.equal(frameCursorOf('full', true, view, 1600, 5000, fm), null, 'off screen: nothing');
  assert.equal(frameCursorMode(undefined), 'full', 'unset: the default');
});

test('the setting: timeline.frameCursor = off | ruler | full, default full, junk falls back; the View command cycles', () => {
  const sc = SCHEMA['timeline.frameCursor'];
  assert.equal(sc.default, 'full');
  assert.ok(['off', 'ruler', 'full'].every(sc.valid) && !sc.valid('on') && !sc.valid(true));
  const s = new Settings(null);
  assert.equal(s.get('timeline.frameCursor'), 'full');
  s.set('timeline.frameCursor', 'ruler'); assert.equal(s.get('timeline.frameCursor'), 'ruler');
  s.set('timeline.frameCursor', 'sideways'); assert.equal(s.get('timeline.frameCursor'), 'full', 'a bad value is the default');
  assert.deepEqual(FRAME_CURSOR_MODES, ['off', 'ruler', 'full']);
  assert.deepEqual(['full', 'ruler', 'off'].map(nextFrameCursorMode), ['ruler', 'off', 'full']);
  const cmd = readFileSync(new URL('features/timeline/commands-view.js', root), 'utf8');
  assert.match(cmd, /id: 'timeline\.view\.frameCursor'[^\n]*menu: 'View'/);
  assert.match(cmd, /tip: '/, 'a kit tip');
});

// ---- the playhead rule: the pink line follows every move, not just the last scrub ----
const player = () => { const p = new Player(null); p.clock = makeClock({ fps: 24000 / 1001, durationMs: 120000 }); p.durationMs = 120000; return p; };
test('after a smooth scrub rests between frames, every step / jump / seek puts the playhead on a frame start and drops the scrub pointer time', async () => {
  for (const move of [(p) => p.step(1), (p) => p.step(-1), (p) => p.step(10), (p) => p.seek(30000), (p) => p.seekFrame(500), (p) => p.play()]) {
    const p = player();
    p.timeMs = p.clock.timeOf(300); p.frame = 300;
    p.scrubTime = 12345.6; p.restMs = 12345.6;   // a smooth scrub rested between frames (and the filmstrip never cleared its pointer time)
    assert.equal(headMs(p), 12345.6, 'the scrub: the pink line is where it rests');
    try { await move(p); } catch { /* no media element in this test: the bookkeeping before the seek is what is asserted */ }
    assert.equal(p.restMs, null, 'rest dropped');
    assert.equal(p.scrubTime, null, 'the scrub pointer time dropped: the pink line was stuck on it');
    p.playing = false;
    assert.equal(p.playheadMs, Math.round(p.clock.timeOf(p.clock.frameAt(p.timeMs))), 'the playhead is the frame start');
    assert.equal(headMs(p), p.playheadMs, 'and that is what is drawn');
  }
});
test('a scrub keeps its times; an exact seek rests where it is; a time a hair past a frame start is that frame start', () => {
  const p = player();
  p.scrubTime = 5000.3; p.seek(5000.3, { exact: true });
  assert.equal(p.restMs, 5000.3); assert.equal(p.scrubTime, 5000.3); assert.equal(headMs(p), 5000.3);
  p.restMs = null; p.scrubTime = null; p.timeMs = 5007;
  assert.equal(p.playheadMs, Math.round(p.clock.timeOf(p.clock.frameAt(5007))));
  assert.notEqual(p.playheadMs, 5007);
});

// ---- the scrub hysteresis (frame-hold.js) ----
const { holdFrame, holdMargin, settleInside, SCRUB_HOLD } = await import(new URL('features/video/frame-hold.js', root));
test('hysteresis: jitter around a frame boundary shows one frame; a real move past the margin changes it; one frame per frame at coarse zoom', () => {
  const clock = makeClock({ fps: 30, durationMs: 60000 }), fm = clock.frameMs, margin = holdMargin(0.5, fm);   // 0.5 ms per pixel
  assert.equal(margin, SCRUB_HOLD * fm, 'a tenth of a frame beats a pixel of time here');
  assert.equal(holdMargin(10, fm), 10, 'a third of a frame per pixel: one pixel of time is the margin');
  assert.equal(holdMargin(40, fm), 0, 'more than a frame per pixel: no margin (holding skipped frames, paw-bf4o)');
  const edge = 10 * fm, jitter = [edge + 0.3, edge - 0.3, edge + 0.2, edge - 0.2, edge + 0.1, edge - 0.1, edge + 0.3];
  const run = (ts, start = -1) => ts.reduce((acc, t) => [...acc, holdFrame(acc.length ? acc[acc.length - 1] : start, t, clock, margin)], []);
  const shown = run(jitter, 10);
  assert.ok(shown.every((n) => n === 10), 'resting on the boundary after showing frame 10: it stays 10 (' + shown + ')');
  const shown2 = run(jitter.slice().reverse(), 9);
  assert.ok(shown2.every((n) => n === 9 || n === 10) && new Set(shown2).size <= 2 && shown2.filter((n, i) => i && n !== shown2[i - 1]).length <= 1, 'at most one change, no flicker (' + shown2 + ')');
  assert.equal(holdFrame(10, edge - 0.6 - margin - 0.1, clock, margin), 9, 'past the margin before the boundary (as the clock reads it: TOL_MS early): frame 9');
  assert.equal(holdFrame(9, edge + margin + 0.1, clock, margin), 10, 'past the margin after it: frame 10');
  assert.equal(holdFrame(-1, edge - 1, clock, margin), 9, 'nothing showing yet: the containing frame');
  // moving steadily through frames: every frame once, in order, never skipping or repeating
  const sweep = []; for (let t = 5 * fm; t < 12 * fm; t += 0.7) sweep.push(holdFrame(sweep.length ? sweep[sweep.length - 1] : -1, t, clock, margin));
  const dedup = sweep.filter((n, i) => !i || n !== sweep[i - 1]);
  assert.deepEqual(dedup, [5, 6, 7, 8, 9, 10, 11]);
});
test('release: the frame showing stays; the stored playhead is nudged inside it when it sat past its edge', () => {
  const clock = makeClock({ fps: 30, durationMs: 60000 }), fm = clock.frameMs;
  assert.equal(settleInside(10 * fm + 4, 10, clock), 10 * fm + 4, 'inside: unchanged');
  const before = settleInside(10 * fm - 1, 10, clock);
  assert.ok(before >= clock.timeOf(10) && clock.frameAt(before) === 10, 'just before the frame: nudged to its start');
  const after = settleInside(11 * fm + 1, 10, clock);
  assert.ok(after < clock.endOf(10) && clock.frameAt(after) === 10, 'just after: nudged inside its end');
  const p = player(); p.timeMs = p.clock.timeOf(10); p.frame = 10;
  p.scrubPxMs = 0; p.seek(10 * p.clock.frameMs + 1, { exact: true });                // shows frame 10
  p.seek(11 * p.clock.frameMs + 0.5, { exact: true });                               // 0.5 ms past the boundary: still frame 10 (held)
  assert.equal(p.heldFrame, 10);
  assert.equal(p.restMs, 11 * p.clock.frameMs + 0.5, 'the playhead (pink) is the exact time while moving');
  p.settle();
  assert.equal(p.heldFrame, -1);
  assert.equal(p.clock.frameAt(p.restMs), 10, 'on release the playhead is inside the frame that stayed');
});
test('paw-somq: play after a click on a lane (an exact seek holds its frame) lets the frame go: the grey frame cursor follows the playhead', () => {
  const p = player();
  p.scrubPxMs = 0; p.seek(10 * p.clock.frameMs + 1, { exact: true });
  assert.equal(p.heldFrame, 10);
  try { p.play(); } catch { /* no media element here: the bookkeeping before playback starts is what is asserted */ }
  assert.equal(p.heldFrame, -1);
});

test('a scrub asks the frame source for the middle of the frame: sample times rounded to the file timescale never show the frame before', async () => {
  const { askTime } = await import(new URL('features/video/frame-hold.js', root));
  const { makeClock } = await import(new URL('features/video/frames.js', root));
  const { indexAt } = await import(new URL('features/video/scrub.js', root));
  const clock = makeClock({ fps: 45, durationMs: 60000 }), n = 2000;
  const table = { n, ms: Float64Array.from({ length: n }, (_, k) => Math.ceil(clock.timeOf(k))) };   // 0, 23, 45, 67 ...
  let early = 0;
  for (let k = 1; k < n; k++) { if (indexAt(table, clock.timeOf(k)) !== k) early++; assert.equal(indexAt(table, askTime(k, clock)), k); }
  assert.ok(early > 100);   // the pointer's own time at a frame's start: the frame before, on and off along the video
});

// ---- paw-bf4o: one frame grid for everything the owner sees (measured with dev/scrub-linear-check.mjs) ----
const RATES = [23.976, 24, 29.97, 30, 45, 59.94, 60];
test('paw-bf4o: the lanes\' grid (lane.js frameAt) is the player clock on every frame of the common rates; a stored frame start is inside its frame', () => {
  for (const fps of RATES) {
    const clock = makeClock({ fps }), fm = clock.frameMs;
    let bad = 0, first = '';
    for (let n = 0; n < 200000; n++) {
      const e = clock.timeOf(n), r = frameTime(n, fm);
      for (const t of [r, r - 1, r + 1, e, e - 0.3, e - 0.59, e - 0.61, e + 0.3, r - 0.5, r + 0.49, (n + 0.5) * fm]) {
        if (t < 0) continue;
        if (frameAt(t, fm) !== clock.frameAt(t)) { if (!bad++) first = `n ${n} t ${t}: lanes ${frameAt(t, fm)}, clock ${clock.frameAt(t)}`; }
      }
      if (clock.frameAt(r) !== n) { if (!bad++) first = `n ${n}: the stored start ${r} is frame ${clock.frameAt(r)}`; }
    }
    assert.equal(bad, 0, `${fps} fps: ${bad} disagreements (${first})`);
  }
});
test('paw-bf4o: the grey cursor for the frame the scrub shows is that frame, every residue (45 fps: n % 9 = 3, 4, 7, 8 sat one frame behind)', () => {
  for (const fps of RATES) {
    const clock = makeClock({ fps, durationMs: 200000 }), fm = clock.frameMs, w = 1600;
    for (let n = 600; n < 800; n++) {
      const view = { start: (n - 5) * fm, span: 10 * fm };
      assert.equal(frameCursorOf('full', true, view, w, clock.timeOf(n), fm).n, n, `${fps} fps frame ${n}`);
    }
  }
});
test('paw-bf4o: crawling one pixel at a time forward or back shows every frame at any zoom finer than a pixel per frame; resting on a boundary still does not flicker where a pixel is under half a frame', () => {
  const clock = makeClock({ fps: 45, durationMs: 200000 }), fm = clock.frameMs;
  for (const ppf of [1, 1.05, 1.3, 1.5, 1.9, 2, 2.5, 3, 4, 6, 11, 40]) for (const off of [0, 0.13, 0.37, 0.5, 0.71, 0.93, -0.3, -0.55]) {
    // off: a fraction of a pixel, or (negative) ms before a frame start, inside the clock's TOL_MS (measured: 1 px = 1 frame, 0.556 ms early)
    const px = fm / ppf, m = holdMargin(px, fm), t0 = 690 * fm + (off < 0 ? off : off * px), steps = Math.ceil(30 * ppf);
    for (const dir of [1, -1]) {
      const seen = new Set(); let held = -1;
      for (let i = 0; i <= steps; i++) { held = holdFrame(held, t0 + dir * (i * px) + (dir < 0 ? 30 * fm : 0), clock, m); seen.add(held); }
      const lo = Math.min(...seen) + 1, hi = Math.max(...seen) - 1, miss = [];
      for (let n = lo; n <= hi; n++) if (!seen.has(n)) miss.push(n);
      assert.deepEqual(miss, [], `${ppf} px/frame offset ${off} ${dir > 0 ? 'forward' : 'back'}: frames never shown`);
    }
    if (px <= fm / 2 - 1) {   // the owner's hysteresis: +-1 px around a boundary after showing frame 700 keeps 700
      const edge = 701 * fm, seq = [edge - 0.4 * px, edge + 0.6 * px, edge - 0.4 * px, edge + 0.6 * px];
      let held = 700; for (const t of seq) { held = holdFrame(held, t, clock, m); assert.equal(held, 700, `${ppf} px/frame: jitter at the boundary`); }
    }
  }
});
