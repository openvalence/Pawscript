// paw-4c48: lib/shaft.js shaftState (one reading of the shaft per frame: hidden vs lost, knot sanity, tip free, events) and
// the scorecard, on synthetic shaft channels with a KNOWN story (the fake sidecar plays the same one): out and free to 1 s,
// goes in (went in at 1 s), down to 20 % visible at 3 s (knot at 35 % +- 5 %: in at ~2.77 s), no reading 3-4.5 s with the
// body tracked (hidden), back up (knot out at ~4.88 s), fully out at 6 s and pulled back (pulled out at 6 s), off frame
// 7-7.5 s. Then the store: the knot line and the truth marks (one undo step each, saved with the project), the script untouched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { shaftState, shaftScore, scoreOverall, scoreTable, scoreLine, matchEvents, stateText, stateIndex, SHAFT } from '../src/lib/shaft.js';
import { channelOf, makeRun } from '../src/lib/runs.js';
import { stitch } from '../src/lib/seed-stitch.js';
import { deriveClean } from '../src/lib/rederive.js';
import { projectDoc, appDocFrom } from '../src/app/project-logic.js';

const FPS = 30, N = 240, T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS)), FM = 1000 / FPS;
const story = (s) => (s < 1 ? 1 : s < 2 ? 1 - 0.5 * (s - 1) : s < 3 ? 0.5 - 0.3 * (s - 2) : s < 4.5 ? NaN : s < 5 ? 0.2 + 0.6 * (s - 4.5) : s < 6 ? 0.5 + 0.5 * (s - 5) : s >= 7 && s < 7.5 ? NaN : 1);
const ch = (f) => channelOf(T.map((t) => { const v = f(t); return [t, v === v && v != null ? v : null]; }));
const R = [0.6, 0.5];   // the receiving part's image position (no camera channel: centre = image)
/** A run with the story; o overrides any channel function (t -> value) or the record. */
function storyRun(o = {}) {
  const L = o.len || ((t) => story(t / 1000)), gap = (t) => (t < 1000 || t >= 6000 ? 0.15 : 0), off = (t) => t >= 7000 && t < 7500;
  const f = {
    len: L, in: (t) => (L(t) === L(t) ? 1 - L(t) : NaN), in_conf: (t) => (L(t) === L(t) ? 0.9 : 0), knot: () => NaN,
    ex: (t) => (L(t) === L(t) ? R[0] - gap(t) : NaN), ey: (t) => (L(t) === L(t) ? R[1] : NaN),
    bx: (t) => (off(t) ? 1.2 : L(t) === L(t) ? R[0] - gap(t) - 0.3 * L(t) : R[0]), by: () => R[1], w: (t) => (L(t) === L(t) ? 0.05 : NaN),
    x: () => 0.45, y: () => 0.5, n: () => 0.1, ...o.ch,
  };
  const channels = Object.fromEntries(Object.entries(f).map(([k, fn]) => [`sem_c2_penis_${k}`, ch(fn)]));
  if (o.recv !== false) { channels.sem_c1_anus_x = ch(() => R[0]); channels.sem_c1_anus_y = ch(() => R[1]); }
  Object.assign(channels, o.extra || {});
  const rec = { source: 'sam', full: 'seen', l_full_w: 6, knot: { at_w: 2.1, half_w: 0.3 }, members: 30, chunks: 10, drift: 2, ...o.rec };
  return { id: 'run1', channels, scenes: [{ start_ms: 0, end_ms: 8000, sign: 1, shaft: { c2_penis: rec } }], flips: [], range: { start: 0, end: 8000 } };
}
const frames = (st, a, b) => Array.from(st.t).map((t, i) => [t, i]).filter(([t]) => t >= a && t < b).map(([, i]) => i);
const evt = (st, kind) => st.events.filter((e) => e.kind === kind).map((e) => e.t);
const first = (pred) => T.find(pred);

test('hidden vs lost: a gap after a low falling reading with the body tracked is hidden (fully in); off frame is lost', () => {
  const st = shaftState(storyRun(), 0);
  assert.equal(st.name, 'c2_penis');
  const hid = frames(st, 3000, 4500);
  assert.ok(hid.every((i) => st.state[i] === 'hidden'), 'every frame of the gap: hidden');
  assert.ok(hid.every((i) => st.vis[i] === 0 && st.conf[i] === SHAFT.HIDDEN_CONF), 'vis 0 (all in), its own low confidence');
  assert.match(st.why[hid[0]], /2[0-9] % visible and falling/);
  const off = frames(st, 7000, 7500);
  assert.ok(off.every((i) => st.state[i] === 'lost' && st.why[i] === 'off frame'), 'off frame: lost, not hidden');
  assert.ok(frames(st, 0, 3000).every((i) => st.state[i] === 'seen'));
  assert.match(stateText(st, hid[3]), /^hidden: inferred fully in, knot inside, tip in, confidence 0\.2; why hidden:/);
  assert.match(stateText(st, stateIndex(st, 1500)), /^75 % visible, knot outside, tip in, confidence 0\.9$/);
  assert.equal(stateText(st, off[2]), 'lost: off frame');
});

test('a gap after a HIGH reading is lost (with its reason), never hidden; the body gone ends hidden', () => {
  // no reading 6.2-6.8 s while 100 % visible
  const L = (t) => (t >= 6200 && t < 6800 ? NaN : story(t / 1000));
  const st = shaftState(storyRun({ len: L }), 0);
  assert.ok(frames(st, 6200, 6800).every((i) => st.state[i] === 'lost' && st.why[i] === 'SAM found no mask (drift or lost)'));
  // the same gap with under 3 visible members (n: 2 % of 30 members of the max 10 %)
  const few = shaftState(storyRun({ len: L, ch: { n: (t) => (t >= 6200 && t < 6800 ? 0.002 : 0.1) } }), 0);
  assert.ok(frames(few, 6200, 6800).every((i) => few.why[i] === 'fewer than 3 visible points (SAM not prompted)'));
  // the hidden gap, but the shaft's group (and no base part) gone from 3.6 s: hidden until then, lost after
  const gone = shaftState(storyRun({ ch: { x: (t) => (t >= 3600 && t < 4500 ? NaN : 0.45) } }), 0);
  assert.ok(frames(gone, 3000, 3600).every((i) => gone.state[i] === 'hidden'));
  assert.ok(frames(gone, 3600, 4500).every((i) => gone.state[i] === 'lost' && /not tracked/.test(gone.why[i])));
  // the sidecar's occlusion (len kept, in NaN, conf 0): lost, a hand at the entry
  const occ = shaftState(storyRun({ ch: { in: (t) => (t >= 1200 && t < 1400 ? NaN : 1 - story(t / 1000)), in_conf: (t) => (t >= 1200 && t < 1400 ? 0 : story(t / 1000) === story(t / 1000) ? 0.9 : 0) } }), 0);
  assert.ok(frames(occ, 1200, 1400).every((i) => occ.state[i] === 'lost' && /hand/.test(occ.why[i])));
  // a low-confidence reading is 'low' (shown faint), not lost
  const low = shaftState(storyRun({ ch: { in_conf: (t) => (t >= 500 && t < 700 ? 0.3 : story(t / 1000) === story(t / 1000) ? 0.9 : 0) } }), 0);
  assert.ok(frames(low, 500, 700).every((i) => low.state[i] === 'low'));
});

test('knot sanity: the record\'s place beyond the full length or reaching the base is rejected; the owner\'s mark wins; a painted knot', () => {
  const ok = shaftState(storyRun(), 0);
  assert.ok(Math.abs(ok.knotAt - 0.35) < 1e-9 && ok.knotFrom === 'record' && ok.knotWhy === null);
  const beyond = shaftState(storyRun({ rec: { knot: { at_w: 6.5, half_w: 0.5 } } }), 0);
  assert.equal(beyond.knotAt, null); assert.match(beyond.knotWhy, /beyond the full length \(108 %\)/);
  assert.ok(Array.from(beyond.knot).every((k) => k === -1), 'no knot state without a place');
  assert.equal(beyond.events.filter((e) => e.kind.startsWith('knot')).length, 0);
  const base = shaftState(storyRun({ rec: { knot: { at_w: 0.86, half_w: 0.8 }, l_full_w: 3.09 } }), 0);
  assert.equal(base.knotAt, null); assert.match(base.knotWhy, /reaches the base/);
  const mark = shaftState(storyRun({ rec: { knot: { at_w: 6.5, half_w: 0.5 } } }), 0, { calib: { knot: 0.6 } });
  assert.equal(mark.knotAt, 0.6); assert.equal(mark.knotFrom, 'mark');
  // a painted knot group at 40 % of the visible part (base -> entry), on frames where the visible share is 1: 0.4 of the length
  const kx = (t) => { const L = story(t / 1000), g = t < 1000 || t >= 6000 ? 0.15 : 0, ex = R[0] - g; return L === L && L > 0.95 ? ex - 0.3 * L + 0.4 * 0.3 * L : NaN; };
  const painted = shaftState(storyRun({ rec: { knot: null }, extra: { sem_c2_knot_x: ch(kx), sem_c2_knot_y: ch(() => R[1]) } }), 0);
  assert.ok(Math.abs(painted.knotAt - 0.4) < 1e-3 && painted.knotFrom === 'painted', `painted ${painted.knotAt}`);
});

test('events: went in, knot in (hysteresis), knot out, pulled out, at frame starts; nothing flaps', () => {
  const st = shaftState(storyRun(), 0);
  assert.deepEqual(evt(st, 'wentIn'), [1000], 'went in where the tip reached the partner');
  assert.deepEqual(evt(st, 'pulledOut'), [6000]);
  // knot in when the visible share drops under 35 - 5 - 3 (hysteresis) = 27 %; out over 35 + 5 + 3 = 43 %
  assert.deepEqual(evt(st, 'knotIn'), [first((t) => t >= 2000 && story(t / 1000) < 0.27)]);
  assert.deepEqual(evt(st, 'knotOut'), [first((t) => t >= 4500 && story(t / 1000) > 0.43)]);
  assert.deepEqual(st.events.map((e) => e.kind), ['wentIn', 'knotIn', 'knotOut', 'pulledOut']);
  // a wobble around the knot's edge (28-30 %, through 2-4.8 s: no hidden stretch, then out without having been in) and the tip's distance between 2 and 3 widths after leaving: no extra events
  const wob = (t) => (t >= 2000 && t < 4800 ? 0.29 + 0.01 * Math.sin(t / 30) : story(t / 1000));
  const w = shaftState(storyRun({ len: wob }), 0);
  assert.equal(evt(w, 'knotIn').length, 0, 'never crossed the hysteresis band');
  const tip = (t) => (t >= 6000 && t < 7000 ? R[0] - (2.5 + 0.4 * Math.sin(t / 20)) * 0.05 / (16 / 9) : t < 1000 || t >= 7500 ? R[0] - 0.15 : story(t / 1000) === story(t / 1000) ? R[0] : NaN);
  const f = shaftState(storyRun({ ch: { ex: tip } }), 0, { aspect: 16 / 9 });
  assert.deepEqual(f.events.filter((e) => e.kind === 'pulledOut' || e.kind === 'wentIn').map((e) => e.t), [1000, 7500], `between the thresholds (6-7 s) the state holds; free again after the off-frame gap: ${JSON.stringify(f.events)}`);
  // on a 24 fps clock the events sit on its frame starts
  const grid = 1000 / 24, g = shaftState(storyRun(), 0, { grid });
  for (const e of g.events) assert.equal(e.t, Math.round(Math.floor((e.t + 1) / grid) * grid), `on a frame start: ${e.t}`);
});

test('scorecard: coverage, depth agreement at the best small lag, timing against marks placed N frames off, the text', () => {
  const st = shaftState(storyRun(), 0), n = st.t.length;
  const script = T.filter((_, i) => i % 3 === 0).map((t) => ({ at: t, pos: Math.round(100 * (story(t / 1000) === story(t / 1000) ? story(t / 1000) : 0)) }));
  const truth = [{ k: 'wentIn', t: 1000 + 2 * Math.round(FM) + 1 }, { k: 'knotIn', t: evt(st, 'knotIn')[0] - 100 }, { k: 'knotOut', t: 4000 }, { k: 'pulledOut', t: 6000 }, { k: 'pulledOut', t: 7700 }];
  const c = shaftScore(st, { t0: 0, t1: 8000, script, truth, calib: { out: 500 } });
  const cnt = (s) => st.state.filter((x) => x === s).length;
  assert.equal(c.frames, n);
  assert.equal(c.hidden, Math.round((1000 * cnt('hidden')) / n) / 1000);
  assert.equal(c.lost, Math.round((1000 * cnt('lost')) / n) / 1000);
  assert.deepEqual(Object.keys(c.lostBy), ['off frame']);
  assert.ok(c.depth.r >= 0.99 && Math.abs(c.depth.lagMs) <= FM && Math.abs(c.depth.swing - 1) < 0.05, JSON.stringify(c.depth));
  assert.deepEqual(c.events.wentIn, { truth: 1, found: 1, matched: 1, medianMs: -67, misses: 0, falseAlarms: 0 }, 'a mark 2 frames late: -67 ms');
  assert.equal(c.events.knotIn.medianMs, 100);
  assert.deepEqual([c.events.knotOut.matched, c.events.knotOut.misses, c.events.knotOut.falseAlarms], [0, 1, 1], 'a mark 0.9 s off: a miss and a false alarm');
  assert.deepEqual([c.events.pulledOut.matched, c.events.pulledOut.misses], [1, 1]);
  assert.deepEqual(c.calib, { out: true, hilt: false });
  assert.ok(c.knot.sane && c.knot.at === 0.35);
  assert.ok(c.diagnosis.some((d) => /^shaft hidden for 1\.5 s from 3\.0 s/.test(d)), c.diagnosis.join(' | '));
  assert.ok(c.diagnosis.some((d) => /^lost for 0\.5 s from 7\.0 s: off frame/.test(d)));
  assert.ok(c.diagnosis.some((d) => /SAM drifted in 2 of 10 chunks/.test(d)));
  // a shifted script: the lag found
  const late = script.map((p) => ({ ...p, at: p.at + 100 }));
  assert.ok(Math.abs(shaftScore(st, { script: late }).depth.lagMs - shaftScore(st, { script }).depth.lagMs + 100) <= FM, 'the script 100 ms later: the lag 100 ms less');
  // reproducible: the same input, the same card
  assert.deepEqual(shaftScore(st, { t0: 0, t1: 8000, script, truth }), shaftScore(shaftState(storyRun(), 0), { t0: 0, t1: 8000, script, truth }));
  // no shaft pass; relative full length; no receiver
  assert.deepEqual(shaftScore(null).diagnosis, ['no shaft pass on this shot: paint the penis and re-track']);
  const rel = shaftScore(shaftState(storyRun({ rec: { full: 'relative' }, recv: false }), 0));
  assert.ok(rel.diagnosis.some((d) => /full length is relative/.test(d)) && rel.diagnosis.some((d) => /no receiving part/.test(d)));
  // pooled, the table, the line
  const o = scoreOverall([c, shaftScore(null)]);
  assert.equal(o.withShaft, 1); assert.equal(o.events.wentIn.matched, 1); assert.equal(o.medianR, c.depth.r);
  const tx = scoreTable([{ label: 'shot 1', card: c }], o);
  assert.match(tx.split('\n')[1], /^shot 1\t240\t/);
  assert.match(tx, /1\/1 -67 ms/);
  assert.equal(scoreLine(c), `${Math.round(100 * c.seen)}% seen · ${Math.round(100 * c.hidden)}% hidden · r ${c.depth.r.toFixed(2)} · marks 3/5`);
  assert.deepEqual(matchEvents([100, 500], [90, 520, 900]), { truth: 3, found: 2, matched: 2, medianMs: -5, misses: 1, falseAlarms: 0 });
});

test('a multi-seed part: the stitched channels are read as they are; the knot state is recomputed, never the blended one', () => {
  // two seeds (0 s and 6 s) whose shaft passes normalised against their own full length: the second reads 10 % longer
  const L1 = (t) => story(t / 1000), L2 = (t) => (story(t / 1000) === story(t / 1000) ? Math.min(1.1, 1.1 * story(t / 1000)) : NaN);
  const vals = (L) => ({ len: T.map(L), in_conf: T.map((t) => (L(t) === L(t) ? 0.9 : 0)), knot: T.map(() => 0.5), bx: T.map(() => 0.3), x: T.map(() => 0.45) });
  const st2 = stitch(T, [{ t: 0, v: vals(L1) }, { t: 6000, v: vals(L2) }]);
  const run = storyRun({ ch: { len: (t) => st2.v.len[T.indexOf(t)], in_conf: (t) => st2.v.in_conf[T.indexOf(t)], knot: (t) => st2.v.knot[T.indexOf(t)] } });
  const st = shaftState(run, 0);
  assert.ok(st && st.t.length === N);
  const hand = 3000, i0 = stateIndex(st, hand - 600), i1 = stateIndex(st, hand + 600);
  assert.ok(i0 >= 0 && i1 >= 0);
  assert.ok(Array.from(st.knot).every((k) => k === -1 || k === 0 || k === 1 || k === 2), 'states from len, not the stitched 0.5s');
  assert.equal(evt(st, 'knotIn').length, 1);
  // the handover (half way, 3 s) is inside the hidden gap here; after it the second seed's longer reading shows (len up to 1.1 -> vis clamped 1)
  assert.ok(st.vis[stateIndex(st, 6500)] === 1);
});

// ---- the store: knot line and truth marks (vite SSR, as test/polarity-store.test.mjs) ----
const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, TS;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  TS = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

test('store: the knot line and the six marks are one undo step each, saved with the project; the script never changes', async () => {
  const doc = { ...M.sampleDoc(), project: { path: 'C:/videos/sample.pawproj' }, scenes: [{ start_ms: 0, end_ms: 8000 }] };
  const app = M.createMockApp({ backend: M.mockBackend(), doc, keys: false }), tr = TS.trackingFor(app);
  app.loadBlocks({});
  await tr.runsLoad;
  const base = storyRun(), run = makeRun({ n: 1, tracker: { id: 'fake.groups', name: 'Fake' }, params: {}, range: { start: 0, end: 8000 }, roi: null, frames: null, runs: [],
    result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 0, pos: 50 }, { at: 4000, pos: 100 }], scenes: base.scenes, channels: Object.fromEntries(Object.entries(base.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])])) } });
  tr.runs = [run]; app.doc.ghosts = [tr.ghostOf(run)]; tr.select(run.id);
  const script0 = JSON.stringify(app.doc.axes), ghost0 = JSON.stringify(tr.ghost(run.id).script);
  const h0 = app.history.index;
  tr.setShaftKnot(0, 0.5);
  assert.equal(app.history.index, h0 + 1, 'the knot: one undo step');
  assert.equal(tr.shotDerive(0, run.id).shaft.knot, 0.5);
  assert.equal(tr.shaftStateOf(run, 0).knotFrom, 'mark');
  app.player.seek(2000);
  for (const k of ['wentIn', 'knotIn', 'knotOut', 'pulledOut', 'out', 'hilt']) { app.player.seek(1000 + 1000 * ['wentIn', 'knotIn', 'knotOut', 'pulledOut', 'out', 'hilt'].indexOf(k)); assert.ok(tr.markTruth(k), k); }
  assert.equal(app.history.index, h0 + 7, 'one undo step per mark');
  const marks = tr.shaftTruth(0, run.id);
  assert.deepEqual(marks.map((m) => m.k), ['wentIn', 'knotIn', 'knotOut', 'pulledOut', 'out', 'hilt']);
  assert.ok(marks.every((m) => m.t % 1 === 0));
  assert.ok(tr.setShaftMark('knotIn', 2100, marks[1].t)); assert.equal(tr.shaftTruth(0, run.id)[1].t, 2100, 'moved');
  assert.ok(tr.setShaftMark('knotIn', null, 2100)); assert.ok(!tr.shaftTruth(0, run.id).some((m) => m.k === 'knotIn'), 'deleted');
  assert.ok(tr.setShaftMark('out', null, marks[4].t)); assert.ok(!tr.shaftTruth(0, run.id).some((m) => m.k === 'out'), 'out removed from the calibration');
  app.undo(); app.undo();
  assert.equal(tr.shaftTruth(0, run.id).length, 6, 'undo brings them back');
  // markShaft(null) clears out / hilt, keeps the knot
  tr.markShaft(null, 1000);
  assert.deepEqual(tr.shotDerive(0, run.id).shaft, { knot: 0.5 });
  app.undo();
  // the project round trip
  const d = app.doc, back = appDocFrom(JSON.parse(JSON.stringify(projectDoc({ media: d.media, axes: d.axes, scenes: d.scenes, ghosts: d.ghosts, project: d.project }))), { path: 'C:/videos/sample.pawproj' });
  assert.deepEqual(back.scenes[0].shaftTruth, app.doc.scenes[0].shaftTruth);
  assert.deepEqual(deriveClean(back.scenes[0].derives?.[run.id] ?? back.scenes[0].derive)?.shaft, tr.shotDerive(0, run.id).shaft);
  // nothing that makes the script changed
  assert.equal(JSON.stringify(app.doc.axes), script0);
  tr.setChannel(run.id, run.channel);   // the store's recompose (its effect, under SSR called by hand)
  assert.equal(JSON.stringify(tr.ghost(run.id).script), ghost0, 'the run\'s points as before');
  // the scorecard over all shots
  const { rows, overall } = tr.shaftScorecards();
  assert.equal(rows.length, 1); assert.equal(overall.withShaft, 1);
  assert.equal(rows[0].card.events.wentIn.matched, 1, 'the went-in mark at 1 s matches the event');
});
