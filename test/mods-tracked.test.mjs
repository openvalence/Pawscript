// paw-ef73.20 stage 3 (owner: "if you track it, it's tracked, if you don't its not"): a modifier takes its timing from
// the tracked signal of its reacting part when a run over it has one (timeline/mods-tracked.js), else it is generated.
// Nothing is stored; the signals are the existing ones (balls / penis scale peaks, a SAM shaft's inserted fraction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackedBy, resolveTracked, REACTS } from '../src/features/timeline/mods-tracked.js';
import { finalScript } from '../src/lib/finish.js';
import { applyFx } from '../src/lib/fx.js';

const M = (id, kind, t0, t1, o = {}) => ({ id, kind, t0, t1, params: {}, ...o });
/** A scale channel that dips (contracts) every `every` ms from t0. */
const pulses = (t0, t1, every) => { const t = [], v = []; for (let x = t0; x < t1; x += 33) { const p = (x - t0) % every; t.push(x); v.push(1 - 0.2 * Math.exp(-(((p - 60) / 40) ** 2)) + 0.004 * Math.sin(x * 0.37)); } return { t, v }; };
/** A shaft's inserted fraction: 0 until a, a linear push to 1 at b, held (confident everywhere). */
const push = (t0, t1, a, b) => { const t = [], v = [], c = []; for (let x = t0; x < t1; x += 33) { t.push(x); v.push(x < a ? 0 : x > b ? 1 : (x - a) / (b - a)); c.push(1); } return [{ t, v }, { t, v: c }]; };

test('the reacting part per kind; idle and the Refine kinds are generated only', () => {
  assert.deepEqual(REACTS, { orgasm: 'balls', throbbing: 'penis', knotting: 'penis', insertion: 'penis', pullout: 'penis' });
  assert.equal(trackedBy(M('i', 'idle', 0, 5000), { channels: { sem_balls_scale: pulses(0, 5000, 700) } }), null);
  assert.equal(trackedBy(M('o', 'orgasm', 0, 5000), null), null, 'no run: generated');
  assert.equal(trackedBy(M('o', 'orgasm', 0, 5000), { channels: {} }), null, 'a run without the part: generated');
});

test('throbbing: the beat period off the balls (else penis) contraction peaks under it', () => {
  const run = { channels: { sem_c1_penis_scale: pulses(0, 10000, 700) } };
  const tr = trackedBy(M('t', 'throbbing', 1000, 8000), run);
  assert.equal(tr.part, 'penis');
  assert.ok(Math.abs(tr.params.period - 700) <= 40, String(tr.params.period));
});

test('orgasm: its spurts from the balls contraction peaks, only where no spurt was placed by hand; own params and identity kept', () => {
  const run = { channels: { sem_balls_scale: pulses(0, 10000, 900) } }, org = M('o', 'orgasm', 2000, 6000);
  const r = resolveTracked([org], () => run);
  assert.equal(r.by.get('o').part, 'balls');
  const sp = r.list.filter((e) => e.kind === 'spurt');
  assert.ok(sp.length >= 3 && sp.every((e) => e.t0 >= 2000 && e.t0 < 6000 && e.t1 === e.t0), JSON.stringify(sp.map((e) => e.t0)));
  const hand = resolveTracked([org, M('s', 'spurt', 3000, 3000)], () => run).list.filter((e) => e.kind === 'spurt');
  assert.deepEqual(hand.map((e) => e.id), ['s'], 'hand-placed spurts win');
  const none = [org];
  assert.equal(resolveTracked(none, () => null).list, none, 'nothing tracked: the same list');
  assert.equal(resolveTracked([{ ...org, muted: true }], () => run).by.size, 0, 'a muted one stays as it is');
});

test('insertion / one knot: the push timing off a SAM shaft\'s inserted fraction (confident frames); the owner\'s own params win', () => {
  const [v, c] = push(0, 20000, 6000, 12000), run = { channels: { sem_c1_penis_in: v, sem_c1_penis_in_conf: c } };
  const ins = trackedBy(M('i', 'insertion', 5000, 15000), run);
  assert.equal(ins.part, 'penis'); assert.equal(ins.ch, 'sem_c1_penis_in');
  assert.ok(ins.params.push > 0.4 && ins.params.push < 0.8 && ins.params.arrive > 0.6, JSON.stringify(ins.params));
  const r = resolveTracked([M('i', 'insertion', 5000, 15000, { params: { push: 0.2 } })], () => run);
  assert.equal(r.list[0].params.push, 0.2, 'own push kept');
  assert.ok(r.list[0].params.arrive > 0.6, 'the fitted arrival fills in');
  const knot = trackedBy(M('k', 'knotting', 5000, 15000, { params: { mode: 'single' } }), run);
  assert.equal(knot.params.mode, 'single');
  assert.equal(trackedBy(M('k', 'knotting', 5000, 15000, { params: { mode: 'cycles' } }), run), null, 'cycles always follow the tracked strokes');
  const low = { channels: { sem_c1_penis_in: v, sem_c1_penis_in_conf: { t: c.t, v: c.v.map(() => 0.2) } } };
  assert.equal(trackedBy(M('i', 'insertion', 5000, 15000), low), null, 'unconfident frames say nothing: generated');
});

test('the final script takes the resolved modifiers only for the list they were resolved from', () => {
  const base = []; for (let t = 0; t < 20000; t += 400) base.push({ at: t, pos: (t / 400) % 2 ? 80 : 20 });
  const fx = [M('t', 'throbbing', 2000, 9000)], res = { of: fx, list: [{ ...fx[0], params: { period: 1500 } }] };
  const doc = { axes: { stroke: base }, scenes: [], fx, finish: null };
  assert.deepEqual(finalScript(doc, 'stroke', { mods: res }), applyFx(base, res.list));
  assert.deepEqual(finalScript({ ...doc, fx: [...fx] }, 'stroke', { mods: res }), applyFx(base, fx), 'another list: its own params');
});
