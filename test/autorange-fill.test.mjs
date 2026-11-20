// Autorange over fills (owner 2026-11-10: "it doesn't apply to fills"): an off-screen shot that is filled or bridged
// is the act going on unseen, so the live pass ranges it, its band eased between the shots around it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangePlan, rangePass, envelope, RULES } from '../src/lib/autorange.js';
import { rangedGhost, finalScript } from '../src/lib/finish.js';
import { withMods } from '../src/features/timeline/mods.js';

const strokes = (t0, t1, half = 400, lo = 20, hi = 80) => { const s = []; let k = 0; for (let t = t0; t < t1; t += half) s.push({ at: t, pos: k++ % 2 ? hi : lo }); return s; };
const PEN = ['anal', 'penetration'];
// S1 on screen, S2 off screen (filled / bridged), S3 on screen: three scenes, as in the owner's screenshot
const shots = (s2 = {}, tags2 = [...PEN, 'offscreen']) => [{ start_ms: 0, end_ms: 10000, tags: PEN }, { start_ms: 10000, end_ms: 20000, tags: tags2, ...s2 }, { start_ms: 20000, end_ms: 30000, tags: PEN }];
const seen = [...strokes(0, 10000), ...strokes(20000, 30000)], filled = strokes(0, 30000, 400, 6, 97);
const inS2 = (s) => s.filter((p) => p.at > 10000 && p.at < 19999);

test('an accepted bridge on an off-screen shot is ranged, its band eased from the shot before to the one after (an old fill reads as the bridge, paw-2lp7.4)', () => {
  const sc = shots({ fill: 'both' }), plan = rangePlan(sc, filled), r = plan[1];
  assert.equal(r.rule, 'unseen'); assert.equal(r.source, 'tracked'); assert.equal(r.trust, 0);
  assert.deepEqual([r.lo, r.hi, r.lo1, r.hi1], [plan[0].lo1, plan[0].hi1, plan[2].lo, plan[2].hi]);
  assert.match(r.reason, /off-screen, bridged: band eased S1 → S3/);
  const env = envelope(plan, filled, { scenes: sc }), p = env.pieces.find((q) => q.t0 === 10000);
  assert.ok(p && /off-screen, bridged/.test(p.why[0]), JSON.stringify(env.pieces.map((q) => [q.t0, q.t1, q.why])));
  const out = inS2(rangePass(filled, plan, { scenes: sc }));
  assert.notDeepEqual(out, inS2(filled), 'the fill is ranged now');
  for (const q of out) { const [lo, hi] = env.bandAt(q.at); assert.ok(q.pos >= lo - 9 && q.pos <= hi + 9, `${q.at}: ${q.pos} in ${lo}-${hi}`); }
});

test('an off-screen shot with a bridge\'s points (no fill) is ranged the same way; without points or fill it inherits', () => {
  const br = rangePlan(shots(), filled);
  assert.equal(br[1].rule, 'unseen'); assert.match(br[1].reason, /off-screen, bridged/);
  const none = rangePlan(shots(), seen);
  assert.equal(none[1].rule, 'inherit'); assert.equal(none[1].source, 'none');
});

test('blank shots and insertion pushes keep their own behaviour', () => {
  const blank = rangePlan(shots({}, [...PEN, 'blank']), filled);
  assert.equal(blank[1].rule, 'inherit'); assert.equal(blank[1].source, 'none');
  const ins = rangePlan(withMods(shots({}, []), [{ id: 'i', kind: 'knotting', t0: 10000, t1: 20000, params: { mode: 'none', to: 0 } }]), filled);
  assert.equal(ins[1].rule, 'insertion'); assert.equal(ins[1].source, 'none');
  assert.ok(RULES.findIndex((r) => r.id === 'unseen') < RULES.findIndex((r) => r.id === 'inherit'));
});

test('a fill not yet accepted (the bridges / fills ghost) is previewed ranged: what Accept + play gives', () => {
  const sc = shots({ fill: 'both' }), ghost = { id: 'scene-bridge', name: 'Bridges and holds', axis: 'stroke', script: inS2(filled), source: { kind: 'bridge-preview' } };
  const app = { doc: { axes: { stroke: seen }, scenes: sc, fx: [], finish: { autorange: true } }, finishEnv: () => ({}) };
  assert.equal(rangePlan(sc, seen)[1].source, 'none', 'nothing in the base there yet');
  const g = rangedGhost(app, ghost);
  assert.notDeepEqual(g.script, ghost.script);
  assert.equal(rangedGhost(app, ghost), g, 'memoised');
  const accepted = inS2(finalScript({ ...app.doc, axes: { stroke: [...seen, ...inS2(filled)].sort((x, y) => x.at - y.at) } }));
  assert.deepEqual(g.script, accepted, 'the preview is exactly what the accepted fill plays');
  assert.equal(rangedGhost({ ...app, doc: { ...app.doc, finish: { autorange: false } } }, ghost), ghost, 'pass off: as it is');
});
