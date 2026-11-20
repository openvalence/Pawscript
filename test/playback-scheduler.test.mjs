// playback-scheduler.test.mjs -- src/features/playback/scheduler.js against a fake clock: the command sequence for
// a script given transport events, latency and offset, range, invert, limits, edits, and the pos -> device mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler, toDevice, TRANSITION_MS, SLOW_MS, SCRUB_MS } from '../src/features/playback/scheduler.js';

const STROKES = Array.from({ length: 41 }, (_, i) => ({ at: i * 500, pos: i % 2 ? 100 : 0 }));   // 0..20 s, 500 ms spans

/** Ticks every `dt` ms over [t0, t1); transport(now) -> {playing, mediaMs, rate?, script?}. Returns the sends with `t`. */
function drive(sch, t0, t1, transport, script = STROKES, dt = 5, out = []) {
  for (let now = t0; now < t1; now += dt) {
    const tr = transport(now);
    sch.tick(now, { script: tr.script ?? script, playing: tr.playing, rate: tr.rate ?? 1, mediaMs: tr.mediaMs });
  }
  return out;
}
function make(cfg = {}) {
  const sent = [];
  let clock = 0;
  const sch = createScheduler({ send: (c) => sent.push({ ...c, t: clock }) });
  sch.configure(cfg);
  const tick = sch.tick;
  sch.tick = (now, st) => { clock = now; tick(now, st); };
  return { sch, sent };
}
const playFrom = (t0, m0, rate = 1) => (now) => ({ playing: true, mediaMs: m0 + (now - t0) * rate, rate });
const spans = (sent) => sent.filter((c) => c.why === 'span');

test('pos 0 (deepest) is device 0, 100 is device 1; range and invert as Phosphor applyT', () => {
  assert.equal(toDevice(0), 0);
  assert.equal(toDevice(100), 1);
  assert.equal(toDevice(50), 0.5);
  assert.equal(toDevice(0, { lo: 20, hi: 80, invert: false }), 0.2);
  assert.equal(toDevice(100, { lo: 20, hi: 80, invert: false }), 0.8);
  assert.equal(toDevice(100, { lo: 20, hi: 80, invert: true }), 0.2);
  assert.equal(toDevice(0, { lo: 20, hi: 80, invert: true }), 0.8);
  for (const [p, c] of [[NaN, {}], [500, {}], [-7, {}], [50, { lo: -50, hi: 300 }], [50, { lo: NaN, hi: 100 }]]) {
    const d = toDevice(p, { lo: 0, hi: 100, invert: false, ...c });
    assert.ok(d >= 0 && d <= 1, `${p} ${JSON.stringify(c)} -> ${d}`);
  }
});

test('play from 0: a slow transition, then one command per span, sent when the span starts, lasting the span', () => {
  const { sch, sent } = make();
  drive(sch, 0, 4000, playFrom(0, 0));
  assert.equal(sent[0].why, 'transition');
  assert.equal(sent[0].durMs, SLOW_MS);
  assert.equal(sent[0].pos, toDevice(0));                 // the script at 1000 ms (where the transition ends)
  const sp = spans(sent);
  assert.deepEqual(sp.map((c) => c.t), [1000, 1500, 2000, 2500, 3000, 3500]);
  assert.deepEqual(sp.map((c) => c.pos), [1, 0, 1, 0, 1, 0]);
  assert.ok(sp.every((c) => c.durMs === 500));
});

test('latency sends each span earlier by the profile latency; offset (+ = machine later) shifts it back', () => {
  const run = (cfg) => { const { sch, sent } = make(cfg); drive(sch, 0, 4000, playFrom(0, 0)); return spans(sent); };
  const base = run({}), lat = run({ latencyMs: 100 }), both = run({ latencyMs: 100, offsetMs: 40 });
  assert.deepEqual(lat.slice(1, 5).map((c) => c.t), base.slice(1, 5).map((c) => c.t - 100));
  assert.deepEqual(both.slice(1, 5).map((c) => c.t), base.slice(1, 5).map((c) => c.t - 60));
  assert.deepEqual(lat.slice(1, 5).map((c) => c.pos), base.slice(1, 5).map((c) => c.pos));
  const early = run({ offsetMs: -100 });                  // negative offset = machine earlier
  assert.deepEqual(early.slice(1, 5).map((c) => c.t), base.slice(1, 5).map((c) => c.t - 100));
});

test('range scale and invert reach every command; nothing leaves [0, 1]', () => {
  const { sch, sent } = make({ lo: 10, hi: 60, invert: true });
  drive(sch, 0, 3000, playFrom(0, 0));
  assert.deepEqual([...new Set(spans(sent).map((c) => +c.pos.toFixed(6)))].sort(), [0.1, 0.6]);
  const bad = make({ lo: -40, hi: 250 });
  drive(bad.sch, 0, 3000, playFrom(0, 0), [{ at: 0, pos: 0 }, { at: 700, pos: 100 }, { at: 1400, pos: 0 }, { at: 2100, pos: 100 }]);
  assert.ok(bad.sent.length > 2 && bad.sent.every((c) => c.pos >= 0 && c.pos <= 1 && Number.isFinite(c.durMs) && c.durMs > 0));
});

test('rate 2: spans go out twice as often and last half as long', () => {
  const { sch, sent } = make();
  drive(sch, 0, 3000, playFrom(0, 0, 2));
  const sp = spans(sent);
  assert.ok(sp.length >= 4);
  assert.ok(sp.every((c) => c.durMs === 250), sp.map((c) => c.durMs).join());
  assert.equal(sp[1].t - sp[0].t, 250);
});

test('a late tick still lands on the knot: duration is what is left, past knots are skipped', () => {
  const { sch, sent } = make();
  drive(sch, 0, 1400, playFrom(0, 0));
  drive(sch, 2120, 2200, playFrom(0, 0));                  // the timer stalled 725 ms; the media clock ran on (no seek)
  const last = sent.at(-1);
  assert.equal(last.why, 'span');
  assert.equal(last.t, 2120);
  assert.equal(last.durMs, 2500 - 2120);                    // span 2000 -> 2500 is the one running; knots 1500, 2000 skipped
  assert.equal(last.pos, 1);
});

test('pause: one stop segment at rest along the line; no motion while paused and still', () => {
  const { sch, sent } = make();
  const tr = (now) => (now < 2200 ? { playing: true, mediaMs: now } : { playing: false, mediaMs: 2200 });
  drive(sch, 0, 4000, tr);
  const i = sent.findIndex((c) => c.why === 'stop');
  assert.ok(i > 0);
  assert.equal(sent.length, i + 1, 'nothing after the stop');
  // the player's clock settling back onto the presented frame right after the pause is not a seek
  const settle = make();
  drive(settle.sch, 0, 2205, (now) => (now < 2200 ? { playing: true, mediaMs: now } : { playing: false, mediaMs: 2200 }));
  drive(settle.sch, 2205, 2600, () => ({ playing: false, mediaMs: 2170 }));
  assert.equal(settle.sent.at(-1).why, 'stop');
  drive(settle.sch, 2600, 2700, () => ({ playing: false, mediaMs: 9000 }));   // a real seek afterwards is followed
  assert.equal(settle.sent.at(-1).why, 'scrub');
  const stop = sent[i];
  assert.equal(stop.t, 2200);
  assert.ok(stop.durMs <= 200);
  // span 2000 -> 2500 runs 0 -> 100; 200 ms on from 2200 is 2400: pos 80
  assert.ok(Math.abs(stop.pos - 0.8) < 1e-9, String(stop.pos));
});

test('scrub while paused follows the playhead at most every SCRUB_MS, at a limited speed', () => {
  const { sch, sent } = make();
  sch.tick(0, { script: STROKES, playing: false, rate: 1, mediaMs: 500 });   // first paused tick: go to the playhead
  for (let now = 5; now < 1000; now += 5) sch.tick(now, { script: STROKES, playing: false, rate: 1, mediaMs: 500 + now * 2 });
  const sc = sent.filter((c) => c.why === 'scrub');
  assert.ok(sc.length >= 5 && sc.length <= 11, String(sc.length));
  for (let i = 1; i < sc.length; i++) assert.ok(sc[i].t - sc[i - 1].t >= SCRUB_MS);
  for (const c of sc) assert.ok(c.durMs >= SCRUB_MS);
  const off = make({ scrub: false });
  off.sch.tick(0, { script: STROKES, playing: false, rate: 1, mediaMs: 500 });
  off.sch.tick(200, { script: STROKES, playing: false, rate: 1, mediaMs: 900 });
  assert.equal(off.sent.length, 0);
});

test('seek while playing: a short transition to the new place, then spans from there', () => {
  const { sch, sent } = make();
  const tr = (now) => ({ playing: true, mediaMs: now < 2000 ? now : 10000 + (now - 2000) });
  drive(sch, 0, 3200, tr);
  const j = sent.findIndex((c, i) => i > 0 && c.why === 'transition');
  assert.equal(sent[j].t, 2000);
  assert.equal(sent[j].durMs, TRANSITION_MS);
  assert.ok(Math.abs(sent[j].pos - 0.6) < 1e-9);           // the script at 10300: span 10000 (0) -> 10500 (100)
  const after = spans(sent.slice(j + 1));
  assert.equal(after[0].t, 2300);                           // joins at the transition's end
  assert.equal(after[0].durMs, 200);                        // ... and lands on knot 10500
  assert.equal(after[0].pos, 1);
});

test('an edit mid-play: the next command carries the edited position', () => {
  const { sch, sent } = make();
  drive(sch, 0, 1700, playFrom(0, 0));
  const edited = STROKES.map((a) => (a.at === 2000 ? { at: 2000, pos: 30 } : a));
  drive(sch, 1700, 2600, playFrom(0, 0), edited);
  const sp = spans(sent);
  const at1500 = sp.find((c) => c.t === 1500);              // span 1500 -> 2000 targets knot 2000
  assert.equal(at1500.pos, 0);                               // sent before the edit: the old knot
  const at2000 = sp.find((c) => c.t === 2000);
  assert.equal(at2000.pos, 1);                               // knot 2500 (pos 100): unedited
  const { sch: s2, sent: sent2 } = make();
  drive(s2, 0, 1400, playFrom(0, 0));
  drive(s2, 1400, 1600, playFrom(0, 0), edited);
  assert.equal(spans(sent2).find((c) => c.t === 1500).pos, 0.3);   // edited before it went out: the edit is sent
});

test('hard profile: travel clamped to maxSpeed (timing kept), commands spaced by minIntervalMs', () => {
  const { sch, sent } = make({ maxSpeed: 100 });            // 100 u/s = full stroke per second
  drive(sch, 0, 4000, playFrom(0, 0));
  for (const c of spans(sent)) assert.ok(c.durMs === 500);
  const sp = spans(sent);
  for (let i = 1; i < sp.length; i++) assert.ok(Math.abs(sp[i].pos - sp[i - 1].pos) <= 0.5 + 1e-9, `${sp[i - 1].pos} -> ${sp[i].pos}`);
  const dense = Array.from({ length: 300 }, (_, i) => ({ at: i * 10, pos: i % 2 ? 90 : 10 }));
  const m = make({ minIntervalMs: 50 });
  drive(m.sch, 0, 2500, playFrom(0, 0), dense, 2);
  const ds = spans(m.sent);
  assert.ok(ds.length > 10);
  for (let i = 1; i < ds.length; i++) assert.ok(ds[i].t - ds[i - 1].t >= 50, `${ds[i - 1].t} ${ds[i].t}`);
  const planner = make({ maxSpeed: 0 });                     // planner: overspeed is signal, never clamped
  drive(planner.sch, 0, 3000, playFrom(0, 0), [{ at: 0, pos: 0 }, { at: 1500, pos: 0 }, { at: 1550, pos: 100 }, { at: 1600, pos: 0 }]);
  assert.ok(spans(planner.sent).some((c) => c.pos === 1 && c.durMs === 50));
});

test('posAt interpolates the last command (live readout); reset forgets the transport', () => {
  const { sch, sent } = make();
  drive(sch, 0, 1010, playFrom(0, 0));
  const last = sent.at(-1);
  assert.equal(last.why, 'span');
  assert.ok(Math.abs(sch.posAt(last.t + 250) - 0.5) < 0.02);
  sch.reset();
  sch.tick(2000, { script: STROKES, playing: true, rate: 1, mediaMs: 1500 });
  assert.equal(sent.at(-1).why, 'transition');
  assert.equal(sent.at(-1).durMs, TRANSITION_MS);            // position known: the short transition
  sch.reset(true);
  sch.tick(3000, { script: STROKES, playing: true, rate: 1, mediaMs: 1500 });
  assert.equal(sent.at(-1).durMs, SLOW_MS);
});
