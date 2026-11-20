// Scenes that continue behind a cutaway (lib/scenes-continue.js): the relation, proposals from fingerprints, the bridge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAt } from '../src/features/timeline/scenes.js';
import { sceneView, isInternal, sceneKind, toggleTag } from '../src/features/timeline/acts.js';
import { defaultTrackerFor, shaftBox } from '../src/lib/scenes-continue.js';
import { cutawaySpan, continuations, setContinues, markAction, grey16, printDist, proposeContinues, withProposals, turnsIn, bridgeScript } from '../src/lib/scenes-continue.js';

const offOf = (s) => (s.tags?.includes('offscreen') ? 'offscreen' : null);
const sc = (...cuts) => cuts.slice(0, -1).map((t, i) => ({ start_ms: t, end_ms: cuts[i + 1] }));

test('cutawaySpan: back over the offscreen run to the action; none without a cutaway', () => {
  const l = sc(0, 10, 20, 30, 40, 50);
  l[2] = { ...l[2], tags: ['offscreen'] }; l[3] = { ...l[3], tags: ['offscreen'] }; l[4] = { ...l[4], continues: true };
  assert.deepEqual(cutawaySpan(l, 4), { a: 1, b0: 2, b1: 3, c: 4, internal: [] });
  assert.equal(cutawaySpan(l, 3), null);                                  // does not continue
  l[1] = { ...l[1], continues: true };
  assert.equal(cutawaySpan(l, 1), null);                                   // no cutaway right before it
  assert.deepEqual(continuations(l), [{ a: 1, b0: 2, b1: 3, c: 4, internal: [] }]);
  assert.equal(cutawaySpan([{ ...l[2] }, { ...l[4] }], 1), null);         // nothing before the cutaway
});

test('setContinues / markAction: the relation and its cutaways in one list', () => {
  const l = sc(0, 10, 20, 30, 40);
  const on = setContinues(l, 2, true);
  assert.deepEqual(on[1].tags, ['offscreen']); assert.equal(on[2].continues, true);
  assert.deepEqual(cutawaySpan(on, 2), { a: 0, b0: 1, b1: 1, c: 2, internal: [] });
  const off = setContinues(on, 2, false);
  assert.equal(off[2].continues, false); assert.equal(cutawaySpan(off, 2), null);
  assert.equal(setContinues(l, 1, true), null);
  const m = markAction([...l.slice(0, 2), { ...l[2], continues: true }, ...l.slice(3)], 0, 3);
  assert.deepEqual(m.map(offOf), [null, 'offscreen', 'offscreen', null]);
  assert.equal(m[2].continues, undefined);                                 // an inner scene's own flag goes
  assert.deepEqual(continuations(m), [{ a: 0, b0: 1, b1: 2, c: 3, internal: [] }]);
  assert.equal(markAction(l, 0, 1), null);
  const sp = splitAt(on, 25);                                             // splitting A': the half after the cutaway keeps it
  assert.deepEqual(sp.map((s) => s.continues ?? null), [null, null, true, null, null]);
});

test('fingerprints: grey16 luma, printDist, proposals only where A ≈ A\' and B differs from both', () => {
  const flat = (r, g, b) => grey16(Uint8Array.from({ length: 1024 }, (_, i) => [r, g, b, 255][i % 4]));
  const A = flat(200, 60, 60), W = flat(20, 20, 160), A2 = flat(196, 64, 58);
  assert.ok(Math.abs(A[0] - (0.299 * 200 + 0.587 * 60 + 0.114 * 60) / 255) < 1e-6);
  assert.ok(printDist(A, A2) < 0.02 && printDist(A, W) > 0.2);
  assert.ok(Number.isNaN(printDist(A, null)));
  const l = sc(0, 10, 20, 30, 40);
  const p = [{ first: A, last: A }, { first: W, last: W }, { first: A2, last: A2 }, { first: W, last: W }];
  assert.deepEqual(proposeContinues(l, p), [20]);                          // A W A' W: scene 3 continues scene 1 (W A' W is not proposed too)
  assert.deepEqual(proposeContinues(sc(0, 10, 20, 30, 40, 50), [...p, p[0]]), [20, 40]);   // A W A' W A'': a chain
  assert.deepEqual(continuations(withProposals(sc(0, 10, 20, 30, 40, 50), new Set([20, 30, 40]))).map((x) => [x.a, x.c]), [[0, 2], [2, 4]]);   // a conflicting one is skipped
  assert.deepEqual(proposeContinues([l[0], l[1], { ...l[2], continues: false }, l[3]], p), [30]);   // the user said no (W A' W still matches)
  assert.deepEqual(proposeContinues([l[0], { ...l[1], tags: ['oral'] }, l[2], l[3]], p), [30]);    // the middle has a tag of its own: not that one
  assert.deepEqual(proposeContinues(l, [p[0], { first: A, last: A }, p[2], p[3]]), []);           // B looks like A: one shot, no cutaway
  const eff = withProposals(l, new Set([20]));
  assert.equal(eff[2].continues, 'auto'); assert.equal(offOf(eff[1]), 'offscreen');
  assert.deepEqual(continuations(eff), [{ a: 0, b0: 1, b1: 1, c: 2, internal: [] }]);
  assert.equal(withProposals(l, new Set()), l);
  assert.equal(l[1].tags, undefined);                                      // never written into the document
});

test('bridgeScript: follow + carry fills the cutaway at the local rate, landing on the first turn after it', () => {
  const strokes = (t0, t1, half) => { const out = []; for (let t = t0, k = 0; t <= t1; t += half, k++) out.push({ at: t, pos: k % 2 ? 90 : 10 }); return out; };
  const s = [...strokes(0, 10000, 400), ...strokes(14000, 24000, 400)];
  assert.deepEqual(turnsIn(s, 9000, 10000).map((x) => x.kind), ['top', 'bottom', 'top']);   // 9200, 9600, 10000
  const b = bridgeScript(s, s, 10100, 13900, { from: 0, to: 24000 });
  assert.ok(b.length >= 8 && b.length <= 11, `${b.length} points`);
  assert.ok(b.every((p) => p.at > 10100 && p.at < 13900));
  assert.ok(b.every((p) => p.pos === 10 || p.pos === 90));                // depth = the neighbours' median top / bottom
  for (let i = 1; i < b.length; i++) { assert.notEqual(b[i].pos, b[i - 1].pos); assert.ok(Math.abs(b[i].at - b[i - 1].at - 400) < 60); }
  assert.equal(b[0].pos, 10);                                             // the last turn before (10000) was a top
  assert.equal(b.at(-1).pos, 90);                                         // and the first after (14000) is a bottom
  // only the action before: the rate is carried forward
  const f = bridgeScript(strokes(0, 10000, 300), [], 10000, 12000);
  assert.ok(f.length >= 5 && f.every((p) => p.at > 10000 && p.at < 12000));
  assert.deepEqual(bridgeScript([], [], 0, 1000), []);                   // nothing to follow
});

test('internal view: tags / override (acts.js), and it continues the action as a tracked member, never a cutaway', () => {
  const tag = (t, score = 0.8) => ({ tags: [{ tag: t, score }] });
  for (const t of ['internal', 'internal_anal', 'x-ray', 'cross_section', 'cutaway_view']) assert.equal(sceneView({ describe: tag(t) }), 'internal', t);
  assert.equal(sceneView({ describe: tag('internal', 0.3) }), null);       // below MIN_SCORE
  assert.equal(sceneView({ describe: { summary: { views: ['internal'] } } }), 'internal');
  assert.equal(sceneView({ describe: tag('anal') }), null);
  assert.equal(sceneView({ tags: ['-internal'], describe: tag('x-ray') }), null);   // the user said none
  assert.equal(sceneView({ tags: ['internal'] }), 'internal');
  assert.deepEqual(toggleTag({ describe: tag('x-ray') }, 'internal'), ['-internal']);   // off over a detected one
  assert.deepEqual(toggleTag({ tags: ['-internal'], describe: tag('x-ray') }, 'internal'), ['internal']);
  const l0 = sc(0, 10, 20, 30, 40);

  const O = { internal: isInternal, kind: sceneKind };
  const l = [{ ...l0[0], tags: ['anal'] }, { ...l0[1], tags: ['anal'], describe: tag('internal_anal') }, { ...l0[2], tags: ['anal'] }, l0[3]];
  const eff = withProposals(l, new Set(), O);
  assert.equal(eff[2].continues, 'auto');                                 // A I A2 of one act: one action
  assert.deepEqual(eff[1].tags, ['anal']);                                // the internal view is not demoted
  assert.deepEqual(continuations(eff, O), [{ a: 0, b0: 1, b1: 1, c: 2, internal: [1] }]);
  assert.equal(withProposals([l[0], l[1], { ...l[2], tags: ['oral'] }, l[3]], new Set(), O)[2].continues, undefined);   // different acts
  assert.equal(withProposals([l[0], l[1], { ...l[2], continues: false }, l[3]], new Set(), O)[2].continues, false);  // the user said no
  // fingerprints never make an internal view a cutaway
  const A = new Float32Array(256).fill(0.8), W = new Float32Array(256).fill(0.1), p = [{ first: A, last: A }, { first: W, last: W }, { first: A, last: A }];
  const hand = [l0[0], { ...l0[1], tags: ['internal'] }, l0[2]];
  assert.deepEqual(proposeContinues(hand, p, O), []);
  assert.deepEqual(withProposals(hand, new Set([20]), O)[1].tags, ['internal']);
  // manual relation / marking keep internal views as tracked members
  const on = setContinues(hand, 2, true, O);
  assert.deepEqual(on[1].tags, ['internal']);
  assert.deepEqual(cutawaySpan(on, 2, O), { a: 0, b0: 1, b1: 1, c: 2, internal: [1] });
  const m = markAction([l0[0], { ...l0[1], tags: ['internal'] }, l0[2], l0[3]], 0, 3, O);
  assert.deepEqual(m.map(offOf), [null, null, 'offscreen', null]);
  assert.deepEqual(continuations(m, O)[0].internal, [1]);
});

test('off-screen tag: a cutaway the user named, so the scene after it continues the action without fingerprints, whatever the acts', () => {
  const O = { internal: isInternal, kind: sceneKind };
  const l = sc(0, 10, 20, 30, 40);
  const t = [{ ...l[0], tags: ['anal'] }, { ...l[1], tags: ['offscreen', 'anal'] }, { ...l[2], tags: ['oral'] }, l[3]];
  const eff = withProposals(t, new Set(), O);
  assert.equal(eff[2].continues, 'auto');
  assert.deepEqual(continuations(eff, O), [{ a: 0, b0: 1, b1: 1, c: 2, internal: [] }]);
  assert.equal(withProposals([t[0], t[1], { ...t[2], continues: false }, t[3]], new Set(), O)[2].continues, false);   // the user said no
  assert.equal(withProposals([t[1], t[2]], new Set(), O)[1].continues, undefined);   // nothing before the cutaway
  assert.equal(defaultTrackerFor(t[1], O), null);                         // never a tracker default
  const ov = setContinues([l[0], { ...l[1], tags: ['-offscreen', 'kissing'] }, l[2]], 2, true, O);
  assert.deepEqual(ov[1].tags, ['kissing', 'offscreen']);                // the user's earlier no goes
});

test('internal views track with SAM area, sign flipped (more pixels = deeper); the shaft box from describe when there is one', () => {
  const O = { internal: isInternal };
  assert.equal(defaultTrackerFor({ start_ms: 0, end_ms: 10 }, O), null);
  const d = defaultTrackerFor({ tags: ['internal'] }, O);
  assert.deepEqual({ ...d, box: undefined }, { tracker: 'sam2_mask', params: { primary: 'area', pipe_sign: 'keep', pipe_invert: true }, label: 'SAM · area', box: undefined });
  assert.equal(d.box, null);
  const describe = { tags: [{ tag: 'x-ray_view', score: 0.9, box: [0.1, 0.1, 0.8, 0.8] }, { tag: 'canine_penis', score: 0.6, box: [0.4, 0.5, 0.2, 0.1] }, { tag: 'penis', score: 0.4, box: [0, 0, 1, 1] }] };
  assert.equal(isInternal({ describe }), true);                            // describe.py's tag name
  assert.deepEqual(defaultTrackerFor({ describe }, O).box, { kind: 'box', x: 0.4, y: 0.5, w: 0.2, h: 0.1 });   // the shaft over the view; 'penis' is below 0.5
  assert.deepEqual(shaftBox({ tags: [describe.tags[0]] }), { kind: 'box', x: 0.1, y: 0.1, w: 0.8, h: 0.8 });   // else the internal view's own box
  assert.equal(shaftBox({ tags: [{ tag: 'penis', score: 0.9, box: null }] }), null);
  defaultTrackerFor({ tags: ['internal'] }, O).params.primary = 'x';
  assert.equal(defaultTrackerFor({ tags: ['internal'] }, O).params.primary, 'area');   // a copy per call
});

test('tracking store: the bridge over a continuation (base points around it), it plays live and Bake puts it in (paw-x7w7), a linked cutaway gets none', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const L = await server.ssrLoadModule('/src/app/project-logic.js');
    const strokes = (t0, t1) => { const out = []; for (let t = t0, k = 0; t <= t1; t += 400, k++) out.push({ at: t, pos: k % 2 ? 90 : 10 }); return out; };
    const doc = { ...M.sampleDoc(), axes: { stroke: [...strokes(0, 10000), ...strokes(14000, 24000)] }, activeAxis: 'stroke', ghosts: [],
      scenes: [{ start_ms: 0, end_ms: 10100 }, { start_ms: 10100, end_ms: 13900, tags: ['offscreen'] }, { start_ms: 13900, end_ms: 24500, continues: true }] };
    const be = M.mockBackend(), sent = [];
    be.sidecar = async (req) => { sent.push(req); return req.cmd === 'track' ? { result: { samples: [[10200, 0.5]], points: [{ at: 10200, pos: 50 }], scenes: [] }, error: null, cancelled: false } : { result: null, error: 'no', cancelled: false }; };
    const app = M.createMockApp({ doc, keys: false, backend: be }), tr = T.trackingFor(app);
    assert.equal(tr.bridges.length, 1);
    const b = tr.bridges[0];
    assert.equal(b.t0, 10100); assert.equal(b.t1, 13900); assert.ok(b.script.length >= 8);
    // a bridge ghost is a preview: never saved, never a run
    const g = { id: 'scene-bridge', script: b.script, source: { kind: 'bridge-preview' } };
    assert.deepEqual(L.savedGhosts([g]), []);
    assert.deepEqual(L.projectDoc({ ...doc, ghosts: [g] }).ghosts, []);
    app.doc.ghosts = [g];
    assert.deepEqual(tr.ghosts, []);
    app.doc.ghosts = [];
    assert.ok(tr.liveOf('stroke').script.some((p) => p.at > 10100 && p.at < 13900), 'live in the script');
    assert.ok(tr.bake({ shots: [1] }) > 0);
    assert.ok(app.doc.axes.stroke.some((p) => p.at > 10100 && p.at < 13900));
    assert.equal(tr.bridges.length, 0);                                  // the cutaway has points now
    app.undo();
    assert.equal(tr.bridges.length, 1);
    tr.links = [{ t0: 10100, t1: 13900, run: 'run1', channel: 'primary' }];
    app.doc.ghosts = [{ id: 'run1', script: [], source: { kind: 'tracker' } }];
    assert.equal(tr.bridges.length, 0);                                  // the cutaway has a linked run of its own
    // a proposal (not stored) bridges like a manual relation
    tr.links = []; app.doc.ghosts = [];
    app.doc.scenes = doc.scenes.map(({ tags, continues, ...s }) => s);   // eslint-disable-line no-unused-vars
    assert.equal(tr.bridges.length, 0);
    tr.proposed = new Set([13900]);
    assert.equal(tr.bridges.length, 1);
    assert.equal(app.doc.scenes[2].continues, undefined);
    // an internal view between them instead: one action, tracked, no bridge
    tr.proposed = new Set();
    app.doc.scenes = [{ start_ms: 0, end_ms: 10100, tags: ['anal'] }, { start_ms: 10100, end_ms: 13900, tags: ['anal', 'internal'] }, { start_ms: 13900, end_ms: 24500, tags: ['anal'] }];
    assert.equal(tr.liveScenes()[2].continues, 'auto');
    assert.equal(tr.bridges.length, 0);
    // the internal-view default: SAM area over a range inside the internal scene, unless the user picked a tracker for it
    tr.trackers = [{ id: 'lk_box', name: 'LK', roi: 'box', params: [] }, { id: 'sam2_mask', name: 'SAM 2.1 mask', roi: 'box_or_points', params: [] }];
    tr.trackerId = 'lk_box';
    app.doc.range = { t0: 10100, t1: 13900 };
    assert.equal(tr.internalPlan?.label, 'SAM · area');
    tr.trackerId = 'sam2_mask';
    assert.equal(tr.trackBlock, 'Internal view: paint the inserted part with Groups (Tab) first.');
    app.doc.range = { t0: 0, t1: 10100 };
    assert.equal(tr.internalPlan, null);                                 // a normal scene
    app.doc.range = { t0: 10100, t1: 13900 };
    tr.openVideo(app.doc.media.path);   // the effect that does this does not run under SSR
    tr.roi = { kind: 'box', x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    await tr.track();
    const req = sent.find((r) => r.cmd === 'track');
    assert.equal(req.tracker, 'sam2_mask');
    assert.equal(req.params.primary, 'area'); assert.equal(req.params.pipe_invert, true); assert.equal(req.params.pipe_sign, 'keep');
    assert.equal(tr.runs.at(-1).name, 'SAM · area');
    assert.equal(tr.ghost(tr.runs.at(-1).id).name, tr.titleOf(tr.runs.at(-1)));   // the ghost is named by the run's title
    tr.pickedFor = new Set([10100]);
    assert.equal(tr.internalPlan, null);                                 // the user's pick wins
  } finally { await server.close(); }
});
