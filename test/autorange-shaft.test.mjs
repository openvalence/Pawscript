// Autorange over shaft-measured depth (paw-b28): where a shot's strokes took their depth from the shaft (lib/strokes.js
// range 'shaft', lib/shaft.js), the base depth is physical: the pass keeps it and the band only limits it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangePlan, rangePass, pieceMaps, envelope } from '../src/lib/autorange.js';

const strokes = (t0, t1, half = 400, lo = 30, hi = 70) => { const s = []; let k = 0; for (let t = t0; t < t1; t += half) s.push({ at: t, pos: k++ % 2 ? hi : lo }); return s; };
const PEN = ['anal', 'penetration'];
const one = (extra = {}, range = { lo: 0, hi: 100 }) => [{ start_ms: 0, end_ms: 20000, tags: PEN, range, ...extra }];
const SHAFT = { derive: { strokes: { range: 'shaft' } } };
const run = (sc, s, o = {}) => rangePass(s, rangePlan(sc, s, o), { scenes: sc });
const inner = (s) => s.filter((p) => p.at > 600 && p.at < 19400);

test('a shallow measured shot stays shallow; the same strokes without the shaft are stretched to the band', () => {
  const s = strokes(0, 20000), kept = inner(run(one(SHAFT), s)), plain = inner(run(one(), s));
  assert.deepEqual(kept.map((p) => p.pos), inner(s).map((p) => p.pos), 'measured: kept as it is');
  assert.ok(Math.min(...plain.map((p) => p.pos)) <= 2 && Math.max(...plain.map((p) => p.pos)) >= 98, 'not measured: stretched');
  const sc = one(SHAFT), plan = rangePlan(sc, s), m = pieceMaps(s, plan, { scenes: sc })[0];
  assert.equal(m.keep, 1); assert.ok(m.measured);
  assert.match(envelope(plan, s, { scenes: sc }).pieces[0].why[0], /measured from the shaft/);
});

test('a measured shot past its band is soft-clipped at the edges, never rescaled', () => {
  const s = strokes(0, 20000, 400, 10, 95).map((p, k) => (k % 4 === 1 ? { ...p, pos: 60 } : p)), out = inner(run(one(SHAFT, { lo: 40, hi: 90 }), s)), b = inner(s);
  out.forEach((p, k) => {
    if (b[k].pos === 60) assert.equal(p.pos, 60, 'inside the band: untouched');
    if (b[k].pos === 95) assert.ok(p.pos > 90 && p.pos <= 98, `top kneed: ${p.pos}`);
    if (b[k].pos === 10) assert.ok(p.pos < 40 && p.pos >= 32, `bottom kneed: ${p.pos}`);
  });
});

test('the default (no range chosen) takes the shaft where its run is confident; unsure stretches blend back to the band', () => {
  const s = strokes(0, 20000, 250), t = [], v = [];
  for (let x = 0; x <= 20000; x += 33) { t.push(x); v.push(x < 9000 ? 0.9 : 0.1); }
  const shafts = { 0: { share: 0.8, conf: { t, v } } }, out = run(one(), s, { shafts });
  const early = out.filter((p) => p.at > 1000 && p.at < 8000), late = out.filter((p) => p.at > 11000 && p.at < 19000);
  assert.ok(early.every((p) => p.pos === 30 || p.pos === 70), 'confident: kept');
  assert.deepEqual(late, run(one(), s).filter((p) => p.at > 11000 && p.at < 19000), 'unsure: today\'s map');
  const mid = out.filter((p) => p.at > 8700 && p.at < 9300).map((p) => p.pos);
  assert.ok(mid.some((x) => x !== 30 && x !== 70 && x > 3 && x < 97), `eased between: ${mid}`);
  // a run that is not confident enough over the shot, or a shot that chose another range: as before
  assert.deepEqual(run(one(), s, { shafts: { 0: { share: 0.3, conf: { t, v } } } }), run(one(), s));
  assert.deepEqual(run(one({ derive: { strokes: { range: 'scene' } } }), s, { shafts }), run(one(), s));
});

test('the owner\'s strength still wins on top; non-shaft shots are unchanged by the change', () => {
  const s = strokes(0, 20000, 400, 20, 80);
  assert.deepEqual(inner(run(one(SHAFT, { lo: 50, hi: 60, strength: 0 }), s)), inner(s), 'strength 0: the points');
  const sc = [...one(), { start_ms: 20000, end_ms: 40000, tags: PEN, join: true, ...SHAFT }], ss = strokes(0, 40000, 400, 20, 80);
  const env = envelope(rangePlan(sc, ss), ss, { scenes: sc });
  assert.equal(env.pieces.length, 2, 'a measured shot is its own piece, never merged into an unmeasured one');
});
