// Blank scenes, fades / dissolves and the structure tags (intro / idle / after / outro): acts.js, the plan skip,
// the hold bridge (lib/scenes-continue.js), migration and the tracking store's ghosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoTags, sceneTags, sceneView, isBlank, isInternal, isOffscreen, toggleTag, migrateScene, structureAuto, withStructure, sceneStructure,
  skipReason, sceneCamera, tintOf } from '../src/features/timeline/acts.js';
import { transitionText, chipsOf } from '../src/features/timeline/scenes.js';
import { cleanScenes } from '../src/app/project-logic.js';
import { planTracks } from '../src/lib/track-plan.js';
import { bridgeScript, holdScript, afterScript, withProposals, proposeContinues, setContinues, continuations, REST } from '../src/lib/scenes-continue.js';

const sc = (...xs) => { let t = 0; return xs.map((x) => { const s = { start_ms: t, end_ms: t + 1000, ...x }; t += 1000; return s; }); };
const D = (acts, extra = {}) => ({ tags: [], summary: { acts, positions: [], views: [], count: 'duo', species: ['wolf'], rating: 'explicit', ...extra } });
const ANAL = { describe: D(['anal_penetration']) };

test('blank: detected from scene.kind, one view at most (it replaces a describe view), user-overridable like the others', () => {
  const b = { start_ms: 0, end_ms: 1000, kind: 'blank' };
  assert.deepEqual(autoTags(b), ['blank']);
  assert.equal(sceneView(b), 'blank'); assert.ok(isBlank(b));
  const xray = { ...b, describe: { tags: [{ tag: 'x-ray_view', score: 0.9 }], summary: { acts: [], views: ['x-ray_view'] } } };
  assert.equal(sceneView(xray), 'blank');                                       // a black screen shows no x-ray
  const off = { ...b, tags: toggleTag(b, 'offscreen') };
  assert.equal(sceneView(off), 'offscreen'); assert.ok(isOffscreen(off) && !isBlank(off));
  assert.equal(sceneView({ ...b, tags: toggleTag(b, 'blank') }), null);         // removed: '-blank'
  const plain = { start_ms: 0, end_ms: 1000 }, on = { ...plain, tags: toggleTag(plain, 'blank') };
  assert.equal(sceneView(on), 'blank');
  assert.equal(sceneView({ ...on, tags: toggleTag(on, 'internal') }), 'internal');   // exclusive
  assert.ok(isInternal({ ...on, tags: toggleTag(on, 'internal') }));
  assert.equal(sceneView({ start_ms: 0, end_ms: 1, kind: 'still' }), null);       // a still is a scene, not a view
});

test('structure: intro before the first act, after / outro behind the last, blanks stay blank, idle never detected', () => {
  const L = sc({ kind: 'still' }, { kind: 'blank' }, { describe: D([]) }, ANAL, { describe: D([]) }, { kind: 'blank' }, { describe: D([], { count: 'unknown', species: [] }) }, { kind: 'still' });
  assert.deepEqual(structureAuto(L), ['intro', null, 'intro', null, 'after', null, 'outro', 'outro']);
  const W = withStructure(L);
  assert.equal(withStructure(L), W);                                            // cached per list
  assert.equal(withStructure(W), W);
  assert.deepEqual(W.map(sceneStructure), ['intro', null, 'intro', null, 'after', null, 'outro', 'outro']);
  assert.deepEqual(sceneTags(W[1]), ['blank']);
  assert.equal(tintOf(W[0]), 'fade-in'); assert.equal(tintOf(W[4]), 'afterglow'); assert.equal(tintOf(W[7]), 'outro');
  // an undescribed scene is unknown: it stops the intro run; with no sex act a quiet tail is outro, not after
  assert.deepEqual(structureAuto(sc({ describe: D([]) }, {}, { describe: D([]) }, ANAL)), ['intro', null, null, null]);
  assert.deepEqual(structureAuto(sc({ describe: D(['kissing']) }, { describe: D([]) })), [null, 'outro']);
  // no act anywhere: only stills at the very ends
  assert.deepEqual(structureAuto(sc({ kind: 'still' }, { kind: 'blank' }, {}, { describe: D([]) }, { kind: 'still' })), ['intro', null, null, null, 'outro']);
  assert.deepEqual(structureAuto([]), []);
  // the user's word wins: a removed or replaced structure tag
  assert.equal(sceneStructure({ ...W[0], tags: ['-intro'] }), null);
  assert.equal(sceneStructure({ ...W[0], tags: toggleTag(W[0], 'idle') }), 'idle');
  assert.equal(sceneStructure({ ...W[4], tags: toggleTag(W[4], 'outro') }), 'outro');
  // a stored structure is derived data: recomputed, never trusted
  assert.equal(withStructure([{ ...L[3], structure: 'intro' }])[0].structure, undefined);
});

test('migration: Detect scenes kind / transition survive; a stored structure is dropped; old one-kind overrides still migrate', () => {
  const b = { start_ms: 0, end_ms: 900, kind: 'blank', transition: { in: 'fade', out: 'cut', in_ms: 600 } };
  assert.equal(migrateScene(b), b);
  assert.deepEqual(cleanScenes([b, { start_ms: 900, end_ms: 2000, kind: 'still', structure: 'outro' }]),
    [b, { start_ms: 900, end_ms: 2000, kind: 'still' }]);
  assert.deepEqual(migrateScene({ start_ms: 0, end_ms: 1, kind: 'knotting' }).tags, ['knotting']);
  assert.deepEqual(migrateScene({ start_ms: 0, end_ms: 1, kind: 'blank', view: 'internal' }), { start_ms: 0, end_ms: 1, kind: 'blank', tags: ['internal'] });
});

test('plan: blank -> skip "blank: hold", structure -> skip "…: nothing to track, generated"; a blank cutaway stays out of the action item', () => {
  const trackers = [{ id: 'lk_box', name: 'LK', roi: 'none' }], base = { trackers, trackerId: 'lk_box' };
  const L = withStructure(sc({ kind: 'still' }, { tags: ['anal'] }, { kind: 'blank' }, { tags: ['anal'], continues: true }, { kind: 'still' }));
  const p = planTracks(L, { ...base, internal: isInternal, offscreen: isOffscreen, skip: skipReason, camera: sceneCamera });
  assert.deepEqual(p.map((x) => [x.label, x.action, x.reason]), [
    ['S1', 'skip', 'intro: nothing to track, generated'],
    ['S2 + S4', 'track', 'continues across S3 (blank)'],
    ['S3', 'skip', 'blank: hold'],
    ['S5', 'skip', 'outro: nothing to track, generated']]);
  assert.deepEqual(p[1].segments, [[1000, 2000], [3000, 4000]]);
  // the raw-tag defaults agree
  assert.deepEqual(planTracks(L, base).map((x) => x.action), ['skip', 'track', 'skip', 'skip']);
  assert.equal(skipReason({ tags: ['idle'] }), 'idle: nothing to track, generated');
  assert.equal(skipReason({ tags: ['offscreen'] }), 'off-screen: bridged from the neighbors');
  assert.equal(skipReason({}), '');
});

test('continuity over a blank: proposed when the acts match (or the pictures say so), never turned off-screen', () => {
  const L = sc({ tags: ['anal', 'penetration'] }, { kind: 'blank' }, { tags: ['anal', 'penetration'] });
  const P = withProposals(L, null, { blank: isBlank });
  assert.equal(P[2].continues, 'auto'); assert.ok(isBlank(P[1]) && !isOffscreen(P[1]));
  assert.deepEqual(continuations(P).map((c) => [c.a, c.b0, c.b1, c.c]), [[0, 1, 1, 2]]);
  assert.equal(withProposals(sc({ tags: ['anal'] }, { kind: 'blank' }, { tags: ['oral'] }))[2].continues, undefined);   // a blank is not the user's word
  const g = (v) => new Float32Array(256).fill(v), prints = [{ first: g(0.5), last: g(0.5) }, { first: g(0), last: g(0) }, { first: g(0.5), last: g(0.5) }];
  const U = sc({}, { kind: 'blank' }, {});
  assert.deepEqual(proposeContinues(U, prints), [2000]);
  const Q = withProposals(U, new Set([2000]));
  assert.equal(Q[2].continues, 'auto'); assert.equal(Q[1].tags, undefined);
  assert.equal(setContinues(U, 2, true)[1].tags, undefined);                    // stays blank, not off-screen
});

test('bridge hold: eases to the level before, stays, eases into the level after; holdScript / afterScript shapes', () => {
  const before = [{ at: 0, pos: 10 }, { at: 400, pos: 90 }, { at: 800, pos: 30 }], after = [{ at: 3000, pos: 70 }, { at: 3400, pos: 10 }];
  const h = bridgeScript(before, after, 1000, 3000, { mode: 'hold' });
  assert.ok(h.every((p) => p.at > 1000 && p.at < 3000));
  assert.equal(h[0].pos, 30); assert.equal(h.at(-1).pos, 70);
  assert.ok(h.slice(0, -1).every((p) => p.pos === 30));                          // no carried strokes
  assert.deepEqual(bridgeScript([], [], 1000, 3000, { mode: 'hold' }), []);
  const intro = holdScript(0, 5000, { level: REST, end: 20 });
  assert.equal(intro[0].pos, REST); assert.equal(intro.at(-1).pos, 20); assert.ok(intro.at(-1).at < 5000);
  const outro = holdScript(0, 5000, { start: 40, level: REST });
  assert.deepEqual([outro[0].pos, outro.at(-1).pos], [40, REST]);
  assert.deepEqual(holdScript(0, 30), []);
  const ag = afterScript(10000, 50000);
  assert.ok(ag.length > 4 && ag.every((p) => p.at > 10000 && p.at < 50000));
  const tail = ag.filter((p) => p.at > 40000);                                   // past the recipe's 30 s: a hold
  assert.ok(tail.length >= 1 && tail.every((p) => p.pos === tail[0].pos));
});

test('transition text and the still chip', () => {
  assert.deepEqual(transitionText({ transition: { in: 'cut', out: 'fade', out_ms: 600 } }), ['fade out 0.6 s']);
  assert.deepEqual(transitionText({ transition: { in: 'dissolve', out: null, in_ms: 480 } }), ['dissolve in 0.5 s']);
  assert.deepEqual(transitionText({ kind: 'blank', transition: { in: 'fade', out: 'fade', in_ms: 600, out_ms: 800 } }),
    ['faded out of the scene before 0.6 s', 'fades into the next scene 0.8 s']);
  assert.deepEqual(transitionText({}), []);
  assert.ok(chipsOf({ kind: 'still' }).some((c) => c.text.includes('still')));
});

test('tracking store: hold ghosts over a blank cutaway and the intro / outro, live like a bridge, Bake makes it permanent (paw-x7w7)', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const strokes = (t0, t1) => { const out = []; for (let t = t0, k = 0; t <= t1; t += 400, k++) out.push({ at: t, pos: k % 2 ? 90 : 10 }); return out; };
    const doc = { ...M.sampleDoc(), axes: { stroke: [...strokes(3000, 10000), ...strokes(12000, 20000)] }, activeAxis: 'stroke', ghosts: [],
      scenes: [{ start_ms: 0, end_ms: 3000, kind: 'still' }, { start_ms: 3000, end_ms: 10100, tags: ['anal', 'penetration'] }, { start_ms: 10100, end_ms: 11900, kind: 'blank' },
        { start_ms: 11900, end_ms: 20100, tags: ['anal', 'penetration'], continues: true }, { start_ms: 20100, end_ms: 24000, kind: 'still' }] };
    const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() }), tr = T.trackingFor(app);
    assert.deepEqual(tr.bridges.map((b) => [b.t0, b.t1, b.mode]), [[0, 3000, 'intro'], [10100, 11900, 'hold'], [20100, 24000, 'outro']]);
    const [intro, hold, outro] = tr.bridges;
    assert.equal(intro.script[0].pos, 100); assert.equal(intro.script.at(-1).pos, 10);   // rest, then into the first point after
    const last = doc.axes.stroke.filter((p) => p.at <= 10100).at(-1).pos;
    assert.ok(hold.script.slice(0, -1).every((p) => p.pos === last));
    assert.equal(outro.script.at(-1).pos, 100);
    assert.ok(tr.liveOf('stroke').script.some((p) => p.at > 0 && p.at < 3000), 'the intro plays live');
    assert.ok(tr.bake({ shots: [0] }) > 0);
    assert.ok(app.doc.axes.stroke.some((p) => p.at > 0 && p.at < 3000));
    assert.deepEqual(tr.bridges.map((b) => b.mode), ['hold', 'outro']);
    assert.deepEqual(tr.plan().map((x) => x.action), ['skip', 'track', 'skip', 'skip']);
  } finally { await server.close(); }
});
