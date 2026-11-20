// paw-ef73.14, the owner: "the scrubbing should be smooth, and points can be between frames, cuts scenes and everything
// else snap to frames". The playhead may rest between frames (player.restMs / playheadMs); a point at the playhead keeps
// that time (unless Snap to frames is on); structure at the playhead or from a drag lands on the start of the frame
// containing it, whatever the Snap setting and Shift. (The scrub itself: dev/snap-look.mjs in a test instance.)
import { test } from 'node:test';
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
    if (url.endsWith('.js') && src().includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: noGlob(src()) };
    return next(url, ctx);
  },
});

const src = new URL('../src/', import.meta.url);
const { frameStartOf, headMs } = await import(new URL('lib/lane.js', src));
const { playheadMs, pointTime } = await import(new URL('features/lanes/cmdlogic.js', src));
const { setPointAt } = await import(new URL('app/core-commands.js', src));
const { structure } = await import(new URL('features/timeline/commands-scenes.js', src));
const { snapTime, snapDelta } = await import(new URL('features/timeline/intervals.js', src));
const { dragRange } = await import(new URL('features/timeline/ruler.js', src));

const FM = 1000 / 30;   // frame 21 starts at 700, frame 22 at 733
// a player resting between frames after a smooth scrub: frame 21 on screen (its presentation time a hair under 700), the
// playhead at 719.2 (frameAt as the player's: a presentation time a hair under a frame's start is that frame)
const player = (o = {}) => ({ timeMs: 699.98, frame: 21, restMs: 719.2, frameMs: FM, playing: false, get playheadMs() { return this.restMs ?? this.timeMs; },
  snap: (ms) => Math.round(Math.round(ms / FM) * FM), frameAt: (ms) => Math.floor((ms + 1) / FM), timeOfFrame: (k) => Math.round(k * FM), ...o });

test('a smooth scrub leaves the playhead between frames: drawn there, read there by points', () => {
  const p = player();
  assert.equal(headMs(p), 719.2, 'drawn where it rests');
  assert.equal(playheadMs(p), 719.2, 'the lanes read where it rests');
  assert.equal(playheadMs({ ...p, restMs: null }), 700, 'no rest: the frame on screen');
  assert.equal(playheadMs({ ...p, playing: true }), p.timeMs, 'playing: the clock');
});

test('a point at a between-frames playhead keeps that time; Snap to frames (the points\' own setting) snaps it', () => {
  assert.equal(pointTime(719.2, { frameMs: 0 }), 719);
  assert.equal(pointTime(719.2, { frameMs: FM }), 733, 'Snap on: the nearest frame, as before');
  for (const [snap, want] of [[false, 719], [true, 733]]) {
    let axes = { stroke: [] };
    const app = { player: player(), settings: { get: (k) => (k === 'edit.snapFrames' ? snap : undefined) }, doc: { activeAxis: 'stroke', get axes() { return axes; } },
      edit: (_l, axis, next) => { axes = { ...axes, [axis]: next }; }, select() {} };
    setPointAt(app, 50);
    assert.deepEqual(axes.stroke, [{ at: want, pos: 50 }], `Snap ${snap}`);
  }
});

test('"Cut here" and "New scene here" from a between-frames playhead land on the start of the frame on screen', () => {
  for (const which of ['splitShot', 'splitScene']) {
    let scenes = [{ start_ms: 0, end_ms: 5000 }];
    const app = { player: player(), settings: { get: () => false }, toast() {}, usage: { note() {} }, fixes: { auto() {} },
      doc: { get scenes() { return scenes; }, set scenes(v) { scenes = v; }, range: null }, transact: (_l, f) => f(), edit() {} };
    structure[which](app);
    assert.deepEqual(scenes.map((s) => s.start_ms), [0, 700], which);
  }
});

test('structure drags land on the start of the frame under the pointer, with Shift (no targets) too, never between', () => {
  assert.equal(frameStartOf(719.2, FM), 700);
  assert.equal(frameStartOf(733, FM), 733);
  assert.equal(frameStartOf(732.6, FM), 700, 'the frame containing it, not the nearest');
  assert.equal(frameStartOf(732.9, FM), 733, 'within TOL_MS of the next frame: that frame, as the player clock shows it (paw-bf4o)');
  assert.deepEqual(snapTime(719.2, [], 0, FM), { t: 700, target: null }, 'chapters, plan, loops, cuts (Shift: no targets, still frames)');
  assert.equal(snapDelta([700, 1000], 26, [], 0, FM).dt, 0, 'a moved span: its first edge on a frame');
  assert.equal(snapDelta([700, 1000], 40, [], 0, FM).dt, 33);
  const r = dragRange('new', null, 719.2, 1520.5, { targets: [], tol: 0, frameMs: FM }, 10000);   // the Track range (Alt: no targets)
  assert.ok([r.range.t0, r.range.t1].every((t) => t === frameStartOf(t, FM)), JSON.stringify(r.range));
});
