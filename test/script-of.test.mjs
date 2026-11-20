// paw-x7w7: no Accept. The tracked script is live, Bake makes it permanent, hand edits bake what they touch; one accessor
// (lib/script-of.js scriptOf) for what is drawn, edited, played and written. The pure rule, then the store and app wiring.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveSpans, composeLive, settleEdit, bakeSpans, unbakeRanges, touchedLive } from '../src/lib/script-of.js';

const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t < t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const shots = [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }, { start_ms: 4000, end_ms: 6000 }];
const run = { id: 'run1', name: '#1', script: saw(0, 6000, 100, 30, 70) };
const inS = (s, t0, t1) => s.filter((p) => p.at >= t0 && p.at < t1);

test('live: every shot with a run and no baked points plays the run; a baked shot keeps its points exactly', () => {
  const baked = saw(0, 2000, 250, 0, 100);   // shot 1 accepted long ago (an old project): baked
  const spans = liveSpans({ shots, base: baked, runOf: () => run });
  assert.deepEqual(spans.map((s) => [s.t0, s.t1, s.shot]), [[2000, 4000, 1], [4000, 6000, 2]]);
  const { script } = composeLive(baked, spans, { gapMs: 60, posTol: 6 });
  assert.deepEqual(inS(script, 0, 2000), baked, 'baked points byte for byte (the join cleanup never removes one)');
  assert.deepEqual(inS(script, 2000, 6000), inS(run.script, 2000, 6000), 'the live shots are the run');
  // no shots: the selected run over its own span; a fill / bridge with baked points inside is skipped
  assert.deepEqual(liveSpans({ selected: run }).map((s) => [s.t0, s.t1]), [[0, 5901]]);
  assert.deepEqual(liveSpans({ base: baked, bridges: [{ t0: 1000, t1: 1500, script: saw(1000, 1500, 100, 0, 100) }] }), []);
});

test('settle: an edit computed from the composed script bakes only the shot it touches; untouched live stays live', () => {
  const base = [];
  const spans = liveSpans({ shots, base, runOf: () => run }), live = composeLive(base, spans);
  // nothing changed: the base itself (no undo step)
  assert.equal(settleEdit(base, live, live.script.slice()), base);
  // a point moved in shot 2: shot 2 is baked with the edit in it, shots 1 and 3 stay live (no points written there)
  const next = live.script.map((p) => (p.at === 2500 ? { at: 2500, pos: 5 } : p));
  const raw = settleEdit(base, live, next);
  assert.deepEqual(inS(raw, 0, 2000), []); assert.deepEqual(inS(raw, 4000, 6000), []);
  assert.deepEqual(inS(raw, 2000, 4000), inS(next, 2000, 4000), 'shot 2: every live point baked, the edit in');
  assert.deepEqual(touchedLive(live, next).map((s) => s.shot), [1]);
  // an edit computed from the raw base (a generator writing into an untracked gap) leaves live shots live
  assert.equal(settleEdit(base, live, base), base);
  // Bake / Unbake
  const b = bakeSpans(base, live, [spans[0]]);
  assert.deepEqual(b, inS(live.script, 0, 2000));
  assert.deepEqual(unbakeRanges(b, [{ t0: 0, t1: 2000 }]), []);
  assert.equal(unbakeRanges(b, [{ t0: 2000, t1: 4000 }]), b, 'nothing there: same array');
});

// ---- the store and the app (vite SSR, the real store) ----
const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, S, F;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  S = await server.ssrLoadModule('/src/lib/script-of.js');
  F = await server.ssrLoadModule('/src/lib/finish.js');
});
after(() => server?.close());
/** An app with three shots and run1's ghost linked to each; stroke = `base`. */
function mk(base = []) {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), axes: { stroke: base }, activeAxis: 'stroke', ghosts: [{ id: 'run1', name: '#1 fake', color: 'red', visible: true, script: run.script, source: { kind: 'tracker' } }], scenes: shots, fx: [], plan: [], loops: [] }, keys: false, backend: M.mockBackend() });
  app.toast = () => {};
  const tr = T.trackingFor(app);
  tr.links = shots.map((s) => ({ t0: s.start_ms, t1: s.end_ms, run: 'run1', channel: 'primary' }));
  return { app, tr };
}
/** What fusion / a source pick does to a live run: its ghost gets new points (the store's recompose). */
const rederive = (app, f) => { app.doc.ghosts = app.doc.ghosts.map((g) => (g.id === 'run1' ? { ...g, script: g.script.map((p) => ({ at: p.at, pos: f(p.pos) })) } : g)); };

test('a tracked shot plays and exports with no Accept; the device scheduler, simulator and export read the composed script', () => {
  const { app } = mk();
  assert.deepEqual(app.doc.axes.stroke, [], 'nothing baked');
  const fin = F.finalOf(app), axes = F.finalAxes(app);
  assert.equal(fin.length, run.script.length, 'what plays (playback #script, the Simulator, the PosBar): the run');
  assert.deepEqual(axes.stroke, fin, 'what Ctrl+S / Export / Pack write');
  assert.equal(app.script, S.scriptOf(app), 'app.script is the accessor');
  assert.equal(S.scriptOf(app), S.scriptOf(app), 'the same array while nothing changes (memo)');
});

test('changing the run (fusion, a source pick) changes the export of a live shot and NOT of a baked one', () => {
  const { app, tr } = mk();
  assert.equal(tr.bake({ shots: [0] }), 1);
  const was = F.finalAxes(app).stroke;
  rederive(app, (v) => 100 - v);
  const now = F.finalAxes(app).stroke;
  assert.deepEqual(inS(now, 0, 2000), inS(was, 0, 2000), 'baked: unchanged');
  assert.notDeepEqual(inS(now, 2000, 6000), inS(was, 2000, 6000), 'live: follows the run');
  assert.deepEqual(inS(now, 2000, 6000), inS(app.doc.ghosts[0].script, 2000, 6000));
  assert.equal(tr.bakeState(0).state, 'baked'); assert.equal(tr.bakeState(0).canUnbake, true); assert.equal(tr.bakeState(1).state, 'live');
});

test('Bake and Unbake: one undo step each; Unbake gives the shot back to the run', () => {
  const { app, tr } = mk();
  const n0 = app._history.entries.length;
  tr.bake({ shots: [1] });
  assert.equal(app._history.entries.length, n0 + 1); assert.match(app._history.entries.at(-1).label, /^Bake shot/);
  assert.equal(inS(app.doc.axes.stroke, 2000, 4000).length, 20);
  rederive(app, (v) => v / 2);
  assert.equal(tr.unbake({ shots: [1] }), 1);
  assert.equal(app._history.entries.length, n0 + 2);
  assert.deepEqual(app.doc.axes.stroke, []);
  assert.deepEqual(inS(S.scriptOf(app), 2000, 4000), inS(app.doc.ghosts[0].script, 2000, 4000), 'live again: the run as it is now');
  app.undo(); assert.equal(inS(app.doc.axes.stroke, 2000, 4000).length, 20);
  app.undo(); assert.deepEqual(app.doc.axes.stroke, []);
  // the whole script, and a run
  tr.bake({ all: true }); assert.equal(app.doc.axes.stroke.length, run.script.length); app.undo();
  tr.bake({ run: 'run1' }); assert.equal(app.doc.axes.stroke.length, run.script.length); app.undo();
});

test('a hand edit on a live shot bakes that shot in the same undo step; the other shots stay live', () => {
  const { app } = mk();
  const n0 = app._history.entries.length, s = app.script;
  app.edit('Move point', 'stroke', s.map((p) => (p.at === 4300 ? { at: 4300, pos: 1 } : p)));
  assert.equal(app._history.entries.length, n0 + 1);
  assert.equal(inS(app.doc.axes.stroke, 4000, 6000).length, 20, 'shot 3 baked whole');
  assert.equal(app.doc.axes.stroke.find((p) => p.at === 4300).pos, 1, 'with the edit');
  assert.deepEqual(inS(app.doc.axes.stroke, 0, 4000), [], 'shots 1 and 2 still live');
  rederive(app, (v) => 100 - v);
  assert.equal(S.scriptOf(app).find((p) => p.at === 4300).pos, 1, 'a run change no longer moves it');
  app.undo();
  assert.deepEqual(app.doc.axes.stroke, []);
});

test('old project: accepted points are baked byte for byte; an un-accepted shot now plays its run; accepted + a newer run stays baked', () => {
  const accepted = saw(0, 2000, 200, 12, 88);   // what an old Accept wrote into shot 1; the run was re-derived since
  const { app } = mk(accepted);
  const out = F.finalAxes(app).stroke;
  assert.equal(JSON.stringify(inS(out, 0, 2000)), JSON.stringify(accepted));
  assert.deepEqual(inS(out, 2000, 6000), inS(run.script, 2000, 6000), 'shots 2 and 3 (never accepted): the run, live');
});

test('no reader left on raw doc.axes where composition matters (allowed raw readers listed)', () => {
  // files that read doc.axes[...] / doc.axes.stroke as a SCRIPT. Every reader of the script goes through lib/script-of.js
  // scriptOf (or finish.js finalOf / finalAxes, or follow.svelte.js followOf); these may read the baked points raw:
  const ALLOWED = {
    'src/lib/script-of.js': 'the accessor itself',
    'src/app/app.svelte.js': 'app.edit settles against the baked points',
    'src/app/project-logic.js': 'file IO: the .pawproj keeps the baked points, funscript writes get finalAxes',
    'src/app/project.svelte.js': 'import into an axis (replaces the baked points), resume selection',
    'src/features/tracking/tracking.svelte.js': 'the live composition itself, bridges / fills (their inputs), Bake / Unbake',
    'src/features/tracking/ScenesPanel.svelte': 'baked status of a shot',
    'src/features/timeline/ScenesLane.svelte': 'baked status of a shot (fallback without the store)',
    'src/features/graph/integration/core.js': 'graph bake: compares with what it baked',
    'src/features/inspector/logic.js': 'pure on a doc-shaped object (callers pass scriptOf axes)',
    'src/features/fix/logic.js': 'pure on a doc-shaped object (callers pass scriptOf axes)',
    'src/features/assist/AssistOverlay.svelte': 'a reactivity read only',
    'src/features/timeline/loop-actions.js': 'whether the axis exists',
    'src/features/tracking/axes-derive.js': 'six-axis results, not the document',
    'src/lib/follow.svelte.js': 'reads docOf (scriptOf) axes',
    'src/lib/finish.js': 'finalScript on a doc-shaped object (finalOf passes scriptOf)',
  };
  const RAW = /\b(?:doc|d)\.axes(?:\?\.)?(?:\[|\.stroke\b)/;
  const files = [];
  const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) { if (n !== 'vendor') walk(p); } else if (/\.(js|svelte)$/.test(n)) files.push(p); } };
  walk(join(root, 'src'));
  const bad = files.map((p) => p.slice(root.length).replace(/\\/g, '/').replace(/^\//, '')).filter((rel) => {
    const lines = readFileSync(join(root, rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    return lines.some((l) => RAW.test(l)) && !ALLOWED[rel];
  });
  assert.deepEqual(bad, [], 'raw script readers: route them through scriptOf / finalOf, or list them here with the reason');
});
