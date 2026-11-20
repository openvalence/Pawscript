// paw-2lp7.4, the owner: "cutaway is to something not action; off screen is not on screen but continuing" ("offscreen works
// better", "cutaway logic needs worked"). Two marks on a shot (view tags), one bridging path:
//   off-screen = the action goes on unseen: not tracked, bridged from the shots around it (lib/scenes-continue.js);
//   cutaway    = something that is not the action: not tracked; bridged EXACTLY like off-screen while an action region covers
//                it (`carried`, regions.js withCarried), else an intermission (nothing carried).
// The bridge's one option is 'timing' (the shot's own turn times). The fills before / after / both are gone: an old one reads
// as a cutaway (migrateFill). Proposals of a shot between the same footage are off-screen. Staleness: the bridge is derived,
// so a moved cut / re-tracked neighbour recomputes it. Linked-shot fill never reads or writes a marked shot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normScenes, toSaved, fromSaved, isCutaway, cutawayMode, setCutaway, setTiming, migrateFill, layerRects, cutawayAt, nudgeCut } from '../src/features/timeline/shots.js';
import { bridgeRuns, bridgeScript, fillSpans, withProposals } from '../src/lib/scenes-continue.js';
import { withCarried, carryAcross, syncActs, projectScenes } from '../src/features/timeline/regions.js';
import { skipReason, sceneView, isOffscreen, isIntermission, isInternal, isBlank, sceneKind } from '../src/features/timeline/acts.js';
import { planTracks } from '../src/lib/track-plan.js';
import { rangePlan } from '../src/lib/autorange.js';
import { fillTargets } from '../src/lib/link-fill.js';

const P = ['anal', 'penetration'];
const OPTS = { internal: isInternal, kind: sceneKind, blank: isBlank };
const strokes = (t0, t1, half = 400, lo = 15, hi = 85) => { const o = []; for (let t = t0, k = 0; t < t1; t += half, k++) o.push({ at: t, pos: k % 2 ? hi : lo }); return o; };
/** Shots from lengths (ms) and per-shot facts. */
const shots = (lens, facts = []) => { let t = 0; return lens.map((n, i) => { const s = { start_ms: t, end_ms: t + n, ...(facts[i] || {}) }; t += n; return s; }); };
/** The document as the app holds it: regions from the scene tags (or `acts`), projected, `carried` derived (Doc's setters). */
function doc(list, acts = null) {
  const s = syncActs(normScenes(list), acts ?? []);
  const a = acts ?? s.acts;
  return { scenes: withCarried(acts ? projectScenes(s.scenes, a) : s.scenes, a), acts: a };
}
const mark = (s) => (s.tags || []).filter((x) => x === 'offscreen' || x === 'cutaway');
const act = (t0, t1, tags = P, o = {}) => ({ id: `r${t0}`, kind: 'act', t0, t1, layer: 0, tags, ...o });

test('the two definitions: off-screen is bridged with or without an action over it; a cutaway only under one', () => {
  // A (0-4 s) | B (4-6 s) | A' (6-10 s), the action on A and A'
  for (const mark of ['offscreen', 'cutaway']) {
    const bare = doc(shots([4000, 2000, 4000], [{}, { tags: [mark] }, {}]), [act(0, 4000), act(6000, 10000)]).scenes;
    const under = doc(shots([4000, 2000, 4000], [{}, { tags: [mark] }, {}]), [act(0, 10000)]).scenes;
    const runs = (l) => bridgeRuns(l, OPTS).map(({ a, b0, b1, c }) => [a, b0, b1, c]);
    assert.deepEqual(runs(under), [[0, 1, 1, 2]], `${mark} under the action: bridged from both sides`);
    assert.deepEqual(runs(withProposals(bare, null, OPTS)), mark === 'offscreen' ? [[0, 1, 1, 2]] : [], `${mark} with no action over it`);
    assert.equal(isOffscreen(under[1]), true, `${mark} under an action reads off-screen everywhere`);
    assert.equal(isIntermission(bare[1]), mark === 'cutaway');
    assert.equal(skipReason(bare[1]), mark === 'offscreen' ? 'off-screen: bridged from the neighbors' : 'cutaway: an intermission, nothing carried');
    assert.equal(skipReason(under[1]), 'off-screen: bridged from the neighbors');
  }
});

test('cutaway + an action region == off-screen: the same skip, Autorange, track plan and bridge, bit for bit', () => {
  const pts = [...strokes(0, 4000), ...strokes(6000, 10000, 300, 25, 75)];
  const off = doc(shots([4000, 2000, 4000], [{}, { tags: ['offscreen'] }, {}]), [act(0, 10000)]).scenes;
  const cut = doc(shots([4000, 2000, 4000], [{}, { tags: ['cutaway'] }, {}]), [act(0, 10000)]).scenes;
  assert.equal(cut[1].carried, true);
  const strip = (l) => l.map((s) => skipReason(s) + '|' + sceneView(s));
  assert.deepEqual(strip(cut), strip(off));
  const plan = (l) => rangePlan(l, pts).map(({ rule, lo, hi, lo1, hi1, reason, source }) => ({ rule, lo, hi, lo1, hi1, reason, source }));
  assert.deepEqual(plan(cut), plan(off));
  const tp = (l) => planTracks(l, { trackerId: 't', trackers: [{ id: 't', roi: 'none' }], skip: skipReason, offscreen: isOffscreen }).map((x) => [x.action, x.sceneIdx, x.reason]);
  assert.deepEqual(tp(cut), tp(off));
  const br = (l) => bridgeRuns(l, OPTS).map(({ a, c, b0, b1 }) => bridgeScript(a >= 0 ? pts : [], c >= 0 ? pts : [], l[b0].start_ms, l[b1].end_ms, { from: l[a]?.start_ms, to: l[c]?.end_ms }));
  assert.deepEqual(br(cut), br(off));
  assert.ok(br(cut)[0].length >= 4);
  // the timing option the same: tracked for its turn times, its fill span the same
  assert.deepEqual(fillSpans(setTiming(cut, [1], true)), fillSpans(setTiming(off, [1], true)));
});

test('an intermission rests like any stretch with no action: nothing generated across it, no act for Autorange (its dead-gap rule)', () => {
  const { scenes: l } = doc(shots([4000, 2000, 4000], [{}, { tags: ['cutaway'] }, {}]), [act(0, 4000), act(6000, 10000)]);
  assert.equal(cutawayMode(l, 1), 'intermission');
  assert.deepEqual(bridgeRuns(l, OPTS), []);
  assert.deepEqual(fillSpans(setTiming(l, [1], true)), [], 'the timing option does nothing on an intermission');
  const r = rangePlan(l, [...strokes(0, 4000), ...strokes(6000, 10000)])[1];
  assert.equal(r.family, null, 'no action');
  assert.deepEqual(r.tease.map((x) => x.why), ['no act'], 'the dead-gap tease, as an untagged gap gets');
  // drawing an action across it carries it (the card flips by itself); taking it away rests it again
  const acts = carryAcross([act(0, 4000), act(6000, 10000)], l, 1);
  assert.deepEqual(acts.filter((x) => x.layer === 0).map((x) => [x.t0, x.t1]), [[0, 10000]], 'the same action both sides: one region across');
  const on = withCarried(projectScenes(l, acts), acts);
  assert.equal(cutawayMode(on, 1), 'carried');
  assert.equal(cutawayMode(withCarried(on, [act(0, 4000)]), 1), 'intermission');
  assert.equal(carryAcross(acts, on, 1), null, 'an action covers it already');
  assert.deepEqual(carryAcross([act(0, 4000)], l, 1).map((x) => [x.t0, x.t1]), [[0, 6000]], 'one side: that action grows over it');
});

test('every off-screen run is bridged from the shots around it that exist: one-sided only at the video\'s edge (paw-ef73.8)', () => {
  const runs = (l) => bridgeRuns(withProposals(l, null, OPTS), OPTS).map(({ a, b0, b1, c }) => [a, b0, b1, c]);
  assert.deepEqual(runs(doc(shots([3000, 4000]), [act(0, 7000)]).scenes), []);
  assert.deepEqual(runs(doc(shots([3000, 4000], [{ tags: ['offscreen'] }]), [act(0, 7000)]).scenes), [[-1, 0, 0, 1]], 'starts the video: the shot after');
  assert.deepEqual(runs(doc(shots([3000, 4000], [{}, { tags: ['offscreen'] }]), [act(0, 7000)]).scenes), [[0, 1, 1, -1]], 'ends it: the shot before');
  // at the end of one action, another after it: both sides still (as off-screen always did; reading one side lost on his shots)
  const edge = doc(shots([3000, 2000, 3000], [{}, { tags: ['offscreen'] }, {}]), [act(0, 5000), act(5000, 8000, ['oral', 'penetration'])]).scenes;
  assert.deepEqual(runs(edge), [[0, 1, 1, 2]]);
  // an off-screen shot that starts the action region of the shot after it (no continuation reaches it): both sides (it had none)
  const starts = doc(shots([3000, 2000, 3000], [{}, { tags: ['offscreen'] }, {}]), [act(0, 3000, ['oral', 'penetration']), act(3000, 8000)]).scenes;
  assert.deepEqual(runs(starts), [[0, 1, 1, 2]]);
  // no action anywhere (a bare off-screen mark): both sides, as off-screen always was
  assert.deepEqual(runs(doc(shots([3000, 2000, 3000], [{}, { tags: ['offscreen'] }, {}]), []).scenes), [[0, 1, 1, 2]]);
  // the one-sided script carries the side's rate
  const s = bridgeScript(strokes(0, 3000, 300), [], 3000, 5000, { from: 0 });
  assert.ok(s.length >= 5 && s.slice(1).every((p, k) => Math.abs(p.at - s[k].at - 300) <= 2), JSON.stringify(s));
});

test('marking: C / Shift+C set one mark (the other replaced: one step converts), again = back in the action; the timing option', () => {
  const l = doc(shots([3000, 2000, 3000]), [act(0, 8000)]).scenes;
  const c = setCutaway(l, [1]);
  assert.deepEqual([mark(c[1]), cutawayMode(withCarried(c, [act(0, 8000)]), 1)], [['cutaway'], 'carried']);
  const o = setCutaway(c, [1], true, 'offscreen');
  assert.deepEqual(mark(o[1]), ['offscreen'], 'converted in one step');
  assert.equal(setCutaway(o, [1], true, 'offscreen'), null, 'already so');
  const t = setTiming(o, [1]);
  assert.equal(t[1].fill, 'timing');
  assert.equal(setTiming(l, [1]), null, 'a plain shot has no bridge');
  const back = setCutaway(t, [1], undefined, 'offscreen');
  assert.deepEqual([mark(back[1]), back[1].fill, isCutaway(back[1])], [[], undefined, false], 'un-marked: tracked, the option gone');
  assert.deepEqual(mark(setCutaway(setCutaway(l, [0]), [0, 1])[1]), ['cutaway'], 'a mixed selection: on');
  assert.deepEqual(setCutaway(normScenes(shots([3000, 2000], [{}, { tags: ['internal'] }])), [1])[1].tags, ['cutaway'], 'one view: an internal mark is replaced');
});

test('old projects: before / after / both fills read as cutaways (an off-screen one stays off-screen), timing stays; saved as the new marks', () => {
  assert.deepEqual(migrateFill({ start_ms: 0, end_ms: 1, fill: 'both' }), { start_ms: 0, end_ms: 1, tags: ['cutaway'] });
  assert.deepEqual(migrateFill({ start_ms: 0, end_ms: 1, fill: 'before', tags: ['offscreen'] }), { start_ms: 0, end_ms: 1, tags: ['offscreen'] });
  assert.deepEqual(migrateFill({ start_ms: 0, end_ms: 1, fill: 'timing' }), { start_ms: 0, end_ms: 1, fill: 'timing', tags: ['cutaway'] }, 'track this cutaway');
  const same = { start_ms: 0, end_ms: 1, fill: 'timing', tags: ['offscreen'] };
  assert.equal(migrateFill(same), same);
  // the owner's shapes (one of his clips): an off-screen + timing shot, 'both' and 'before' fills on camera-split shots
  const old = [
    { start_ms: 0, end_ms: 7500, shots: [{ start_ms: 0, end_ms: 7500 }] },
    { start_ms: 7500, end_ms: 40000, tags: [...P], shots: [
      { start_ms: 7500, end_ms: 12900, fill: 'timing', tags: ['offscreen'] }, { start_ms: 12900, end_ms: 23792 },
      { start_ms: 23792, end_ms: 24500, split: 'camera', fill: 'both' }, { start_ms: 24500, end_ms: 32533, split: 'camera' },
      { start_ms: 32533, end_ms: 34867, split: 'camera', fill: 'before' }, { start_ms: 36067 - 1200, end_ms: 36067, split: 'camera', fill: 'before' },
      { start_ms: 36067, end_ms: 40000 }] },
    { start_ms: 40000, end_ms: 44000, fill: 'after', tags: ['oral', 'penetration'], shots: [{ start_ms: 40000, end_ms: 44000 }] },
  ];
  const l = fromSaved(JSON.parse(JSON.stringify(old)));
  assert.deepEqual(l.map((s) => [s.tags?.filter((x) => x === 'offscreen' || x === 'cutaway')?.[0] ?? null, s.fill ?? null]),
    [[null, null], ['offscreen', 'timing'], [null, null], ['cutaway', null], [null, null], ['cutaway', null], ['cutaway', null], [null, null], ['cutaway', null]]);
  const d = doc(l.map((s) => s));
  assert.deepEqual(d.scenes.map((_, k) => cutawayMode(d.scenes, k)), [null, 'offscreen', null, 'carried', null, 'carried', 'carried', null, 'carried'], 'under their actions: bridged like off-screen');
  const saved = toSaved(d.scenes);
  assert.ok(!JSON.stringify(saved).includes('"carried"'), 'carried is derived, never saved');
  assert.ok(!/"fill":"(before|after|both)"/.test(JSON.stringify(saved)));
  assert.deepEqual(fromSaved(saved).map((s) => s.tags), l.map((s) => s.tags), 'saves and loads back the same');
});

test('proposals follow the definitions: a shot between the same footage is proposed off-screen; an owner\'s cutaway is his decision', () => {
  const l = normScenes(shots([3000, 1500, 3000], [{ tags: P }, {}, { tags: P }]));
  const p = withProposals(l, new Map([[4500, 0]]), OPTS);
  assert.deepEqual([p[2].continues, p[1].tags], ['auto', ['offscreen']], 'accepting it marks the insert off-screen (markAction)');
  const own = normScenes(shots([3000, 1500, 3000], [{ tags: P }, { tags: ['cutaway'] }, { tags: P }]));
  assert.equal(withProposals(own, new Map([[4500, 0]]), OPTS)[2].continues, undefined, 'never over a cutaway he marked');
});

test('linked-shot fill: a marked shot is never a source or a target (un-mark it first)', () => {
  const sh = shots([3000, 3000]), run = { id: 'r1', n: 1, range: { start: 0, end: 3000 }, channels: { primary: { t: [0], v: [0] } } };
  const ix = null;   // no repeats: the crop link carries the pair here
  const crops = [{ kind: 'crop', a: sh[0], b: sh[1], loops: [{ a: 'k1', b: 'k2', ratio: 1, periodA: 9, periodB: 9, shift: 0 }] }];
  const autos = [{ key: 'k1', t0: 0, t1: 3000, end: 3000, n: 1 }, { key: 'k2', t0: 3000, t1: 6000, end: 6000, n: 1 }];
  const plain = fillTargets({ shots: sh, ix, crops, autos, runs: [run] });
  assert.deepEqual(plain.map((x) => [x.i, x.j]), [[1, 0]], 'the plain pair fills');
  assert.deepEqual(fillTargets({ shots: [sh[0], { ...sh[1], tags: ['offscreen'] }], ix, crops, autos, runs: [run] }), [], 'off-screen target: none');
  assert.deepEqual(fillTargets({ shots: [{ ...sh[0], tags: ['cutaway'] }, sh[1]], ix, crops, autos, runs: [run] }), [], 'cutaway source: none');
});

test('draw: both marks raise a card; the card says what it does; the hit test finds it', () => {
  const { scenes: l } = doc(shots([3000, 2000, 3000, 2000], [{}, { tags: ['offscreen'] }, {}, { tags: ['cutaway'] }]), [act(0, 8000)]);
  const G = layerRects(l, (t) => t / 100, { sh: 26, y1: 27, h: 45 });
  assert.deepEqual(G.shots.map((r) => r.cut), [null, 'offscreen', null, 'intermission']);
  assert.equal(cutawayAt(G, 40, 22), 1);
  assert.equal(cutawayAt(G, 10, 22), -1);
});

test('store: the bridge ghost across an off-screen shot and a carried cutaway, none across an intermission; it follows a moved cut and a re-tracked neighbour; Bake and the commands are one undo step each', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const C = await server.ssrLoadModule('/src/features/timeline/commands-scenes.js'), ST = await server.ssrLoadModule('/src/features/timeline/state.svelte.js');
    // shots: A 0-6 s | B 6-8 s | A' 8-14 s | D 14-16 s | E 16-22 s; one action over 0-14 s, another over E
    const pts = [...strokes(0, 6000), ...strokes(8000, 14000), ...strokes(16000, 22000, 300)];
    const sc = shots([6000, 2000, 6000, 2000, 6000]);
    const app = M.createMockApp({ doc: { ...M.sampleDoc(), axes: { stroke: pts }, activeAxis: 'stroke', ghosts: [], scenes: sc, acts: [act(0, 14000), act(16000, 22000, ['oral', 'penetration'])] }, commands: C.default, keys: false, backend: M.mockBackend() });
    const tr = T.trackingFor(app);
    app.tracking = tr;
    ST.tl.focus = 'scenes';
    const n0 = app._history.entries.length;
    app.commands.run('timeline.shot.offscreen', { shots: [1] });
    assert.equal(app._history.entries.at(-1).label, 'Off-screen');
    const b1 = tr.bridges.find((b) => b.t0 === 6000);
    assert.ok(b1 && b1.mode === 'carry' && b1.script.length >= 4, 'the off-screen shot is bridged');
    const gaps = b1.script.slice(1).map((p, k) => p.at - b1.script[k].at).filter((d) => d > 250);
    assert.ok(gaps.every((d) => Math.abs(d - 400) <= 60), `the neighbours' rhythm carried: ${gaps}`);
    // a cutaway with no action over it: an intermission, nothing across it
    app.commands.run('timeline.shot.cutaway', { shots: [3] });
    assert.equal(app._history.entries.at(-1).label, 'Cutaway');
    assert.equal(C.MARK_WORDS[cutawayMode(app.doc.scenes, 3)].startsWith('a cutaway with no action'), true);
    assert.ok(!tr.bridges.some((b) => b.t0 < 16000 && b.t1 > 14000), 'no points across an intermission');
    // draw the action across it: carried, bridged like off-screen; one undo step
    const n1 = app._history.entries.length;
    app.transact('Action region', () => { app.doc.acts = [act(0, 14000), act(14000, 22000, ['oral', 'penetration'])]; });
    assert.equal(cutawayMode(app.doc.scenes, 3), 'carried');
    assert.ok(tr.bridges.some((b) => b.t0 === 14000 && b.mode === 'carry' && b.script.length), 'the card flipped: bridged');
    app.undo();
    assert.equal(cutawayMode(app.doc.scenes, 3), 'intermission');
    assert.equal(app._history.entries.length, n1 + 1, 'one undo step (the entry stays for redo)');
    // the bridge follows its neighbours: a cut moved, a neighbour re-tracked (new points); nothing stale left
    const before = tr.bridges.find((b) => b.t0 === 6000).script;
    app.transact('Nudge cut', () => { app.doc.scenes = nudgeCut(app.doc.scenes, 1, 1, 1000 / 30); });
    const moved = tr.bridges.find((b) => b.t0 > 6000 && b.t0 < 6100);
    assert.ok(moved && moved.script.every((p) => p.at > moved.t0), 'recomputed for the new span');
    app.undo();
    app.edit('Re-track', 'stroke', [...strokes(0, 6000, 250), ...strokes(8000, 14000, 250), ...strokes(16000, 22000, 300)]);
    const re = tr.bridges.find((b) => b.t0 === 6000).script;
    assert.notDeepEqual(re, before, 'the neighbours changed: the bridge too');
    // paw-x7w7: the bridge plays live (in the script, no Accept); Bake makes it permanent: one undo step
    const S = await server.ssrLoadModule('/src/lib/script-of.js');
    assert.deepEqual(S.scriptOf(app, 'stroke').filter((p) => p.at > 6000 && p.at < 8000), re, 'live in the script');
    assert.deepEqual(app.doc.axes.stroke.filter((p) => p.at > 6000 && p.at < 8000), [], 'not baked');
    const n2 = app._history.entries.length;
    assert.ok(tr.bake({ shots: [1] }) > 0);
    assert.equal(app._history.entries.length, n2 + 1);
    assert.deepEqual(app.doc.axes.stroke.filter((p) => p.at > 6000 && p.at < 8000), re);
    assert.ok(!tr.bridges.some((b) => b.t0 === 6000), 'baked: nothing live there');
    // converting and the option, one step each; back in the action
    app.commands.run('timeline.shot.cutaway', { shots: [1] });
    assert.deepEqual([mark(app.doc.scenes[1]), cutawayMode(app.doc.scenes, 1)], [['cutaway'], 'carried']);
    app.commands.run('timeline.shot.bridge.timing', { shots: [1] });
    assert.equal(app.doc.scenes[1].fill, 'timing'); assert.equal(app._history.entries.at(-1).label, 'Bridge: timing from this shot');
    app.commands.run('timeline.shot.cutaway', { shots: [1] });
    assert.deepEqual([mark(app.doc.scenes[1]), app.doc.scenes[1].fill], [[], undefined]);
    assert.equal(app._history.entries.at(-1).label, 'Back in the action (tracked)');
    assert.ok(app._history.entries.length > n0);
    assert.deepEqual(C.default.find((c) => c.id === 'timeline.shot.offscreen').keys, ['Shift+C']);
  } finally { await server.close(); }
});
