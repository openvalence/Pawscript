// paw-lji3: Smart stroke is on for a newly tracked shot whose run can fuse; off by hand is kept (smart: false) through save /
// load and re-derive. paw-83sq: a re-track takes the shot's settings on the run it re-tracks (on, off, camera, source).
// Runs tracked before (no flag) play exactly as they did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { channelPatch } from '../src/lib/runs-channel.js';
import { runDerives, arrivalShots, deriveClean, deriveOf } from '../src/lib/rederive.js';
import { canFuse } from '../src/lib/fusion.js';
import { canSource } from '../src/lib/signal-source.js';
import { toSaved, fromSaved } from '../src/features/timeline/shots.js';
import { Detector } from '../src/app/fixlog.js';
import { track, howRun, ASPECT } from './how-synth.mjs';

const many = (n, s) => Array.from({ length: n }, () => ({ ...s }));
const TR = track([...many(6, { kind: 'impact', T: 800, rest: 0.45 }), ...many(6, { kind: 'slowout', T: 700 })]);
const r0 = howRun(TR, { seed: 5 }), MID = Math.round(r0.range.end / 2), END = r0.range.end;
const mkRun = (id, o = {}) => ({ ...r0, id, channel: 'who_pair_proj', scenes: [{ start_ms: 0, end_ms: MID, sign: 1 }, { start_ms: MID, end_ms: END, sign: 1 }], points0: { at: new Float64Array(), pos: new Float64Array() }, ...o });
const two = (a = {}, b = {}) => [{ start_ms: 0, end_ms: MID, ...a }, { start_ms: MID, end_ms: END, ...b }];
const opts = (run, prev = () => null) => ({ prev, fuse: canFuse(run), source: (x) => canSource(run, x, canFuse) });
const pts = (run, shots) => { const p = channelPatch(run, run.channel, {}, [], { aspect: ASPECT, derives: runDerives(run, shots) }); return Array.from(p.points0.at, (at, k) => [at, p.points0.pos[k]]); };
const CAM = { mode: 'auto', strength: 100, source: 'background', smoothMs: 0, explicit: true };

test('a new run that can fuse arrives with Smart stroke on, the very derive the button writes; one that cannot: nothing written', () => {
  const run = mkRun('run1');
  assert.ok(canFuse(run));
  const shots = arrivalShots(two(), run, opts(run));
  for (const s of shots) assert.deepEqual(s.derives.run1, deriveClean({ smart: true, match: true }));   // = setSmart(i, true) on a fresh shot (setDerive)
  assert.deepEqual(pts(run, shots), pts(run, two({ derives: { run1: { smart: true, match: true } } }, { derives: { run1: { smart: true, match: true } } })), 'plays as Smart stroke by hand');
  assert.notDeepEqual(pts(run, shots), pts(run, two()), 'and not as the classic path');
  const single = mkRun('run2', { channels: { who_pair_proj: r0.channels.who_pair_proj, sem_c2_hips_x: r0.channels.sem_c2_hips_x, sem_c2_hips_y: r0.channels.sem_c2_hips_y } });
  assert.ok(!canFuse(single));
  const before = two();
  assert.equal(arrivalShots(before, single, opts(single)), before, 'a run that cannot fuse: as before');
  // shots outside the run, and skipped ones (off-screen), are left alone
  const short = mkRun('run3', { range: { start: 0, end: MID } }), sh = arrivalShots(two(), short, { ...opts(short), skip: () => false });
  assert.ok(sh[0].derives.run3.smart && !sh[1].derives);
  assert.ok(!arrivalShots(two(), run, { ...opts(run), skip: (i) => i === 1 })[1].derives);
});

test('Smart stroke off by hand sticks: kept as false, through save -> load and a re-derive, and plays the classic path', () => {
  const run = mkRun('run1');
  const on = arrivalShots(two(), run, opts(run));
  const off = on.map((s, i) => (i === 0 ? { ...s, derives: { run1: deriveClean({ ...s.derives.run1, smart: false, match: true }) } } : s));   // setSmart(0, false)
  assert.deepEqual(off[0].derives.run1, { smart: false });
  const loaded = fromSaved(JSON.parse(JSON.stringify(toSaved(off))));
  assert.deepEqual(loaded.map((s) => s.derives), off.map((s) => s.derives), 'saved and loaded as set');
  const dv = runDerives(run, loaded);
  assert.equal(dv[0].smart, false); assert.equal(dv[1].smart, true);
  const classic = pts(run, two(undefined, { derives: { run1: { smart: true, match: true } } }));
  assert.deepEqual(pts(run, loaded), classic, 'off = the classic path, exactly as an absent flag');
  // a re-derive never brings it back: the arrival is the only writer, and a re-arrival of the same run keeps what is there
  assert.deepEqual(arrivalShots(loaded, run, opts(run, () => null)).map((s) => s.derives), loaded.map((s) => s.derives));
});

test('a re-track takes each shot\'s settings on the run it re-tracks: Smart on, Smart off, the camera, the source', () => {
  const run2 = mkRun('run2');
  const old = two({ derives: { run1: { smart: true, cam: CAM, match: true } } }, { derives: { run1: { smart: false, source: 'rel:sem_c2_hips:sem_c1_hips', unflip: true } } });
  const got = arrivalShots(old, run2, opts(run2, () => 'run1'));
  assert.deepEqual(got[0].derives.run2, { cam: CAM, smart: true, match: true }, 'on + the camera chosen by hand');
  assert.equal(got[1].derives.run2.smart, false, 'off stays off although the new run can fuse');
  assert.equal(got[1].derives.run2.source, 'rel:sem_c2_hips:sem_c1_hips', 'the source picked');
  assert.equal(got[1].derives.run2.unflip, undefined, 'the old run\'s own flip is not carried');
  assert.deepEqual(got.map((s) => s.derives.run1), old.map((s) => s.derives.run1), 'the old run keeps its own');
  // a source the new run lacks is dropped (it would fall back anyway); the rest is kept
  const lean = mkRun('run2', { channels: { ...r0.channels, sem_c2_hips_x: undefined, sem_c2_hips_y: undefined } });
  delete lean.channels.sem_c2_hips_x; delete lean.channels.sem_c2_hips_y;
  const g2 = arrivalShots(old, lean, opts(lean, () => 'run1'));
  assert.equal(g2[1].derives.run2.source, undefined); assert.equal(g2[1].derives.run2.smart, false);
  // a run of the project before this change (no flag: classic) re-tracked: the new run gets the new default
  assert.equal(arrivalShots(two({ derives: { run1: { cam: CAM } } }), run2, opts(run2, () => 'run1'))[0].derives.run2.smart, true);
  // discard + Track again: the new run takes the freed number, and the shot's settings left under it are what it inherits
  const left = two({ derives: { run1: { smart: false, cam: CAM } } });
  assert.deepEqual(arrivalShots(left, mkRun('run1'), opts(mkRun('run1')))[0].derives.run1, { cam: CAM, smart: false, match: true }, 'off kept');
  // an older project's shared derive (no per-run entries) carries over too
  assert.deepEqual(deriveOf(arrivalShots(two({ derive: { cam: CAM } }), run2, opts(run2))[0], 'run2'), { cam: CAM, smart: true, match: true });
});

test('an old project (runs without the flag) composes byte-identical channels: the hash recorded before the change', () => {
  const run = mkRun('run3');
  const shots = two({ derives: { run3: { cam: CAM, fuse: { w: { 'c1:core~c2:core': 2 } }, match: true } } }, { derives: { run3: { smart: true, match: true } } });
  const p = channelPatch(run, run.channel, {}, [], { aspect: ASPECT, derives: runDerives(run, shots) });
  const out = JSON.stringify({ at: Array.from(p.points0.at), pos: Array.from(p.points0.pos), lane: p.lane ? Array.from(p.lane.v) : null, match: p.match });
  assert.equal(createHash('sha256').update(out).digest('hex'), 'bceb851a01bd8d315ff42efa5b1c54d7773a1f42b05dacf1933cfa70d7ef9943');   // paw-dnrv: undrift off by default (was 5a028c11 at HEAD 290c7af, before paw-lji3)
  assert.equal(deriveClean({ cam: CAM }).smart, undefined, 'an absent flag stays absent (classic)');
});

test('the fix log: a track logs the run only; Smart stroke off by hand is a fix', () => {
  const d = new Detector(), T = Date.parse('2026-11-18T10:00:00Z');
  const ev = [{ k: 'tracking:runStart', tracker: 'tapnext_points', label: 'track', t0: 0, t1: END, params: '{}' }, { k: 'tracking:runEnd', tracker: 'tapnext_points', run: 'run1', points: 40 }];
  assert.deepEqual(ev.flatMap((e, i) => d.see({ t: T + i * 1000, s: 's', ...e })).map((f) => f.kind), ['auto:track.run'], 'the arrival writes no undo step, so no fix');
  const f = d.see({ t: T + 5000, s: 's', k: 'edit:commit', label: 'Smart stroke off', paths: 'scenes' });
  assert.deepEqual(f.map((x) => [x.kind, x.manual.to]), [['fix:strokes.smart', 'off']]);
});
