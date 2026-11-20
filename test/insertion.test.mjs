// Push and pull (paw-ajvq: the knotting's mode 'none', was the Insertion / Pull-out kinds): the generated push / pull
// (lib/fx.js pushKeys, insertionScript), its curve handles (fx-edit.js), the scenes they sit in are tracked (a bridge
// generates the push where nothing is) and Autorange leaving an insertion scene alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAG, skipReason } from '../src/features/timeline/acts.js';
import { withMods } from '../src/features/timeline/mods.js';
import { planTracks } from '../src/lib/track-plan.js';
import { applyFx, insertionScript, pushKeys, fitInsertion, fxParams, FX_KINDS, KNOT_PUSH, KNOT_PULL, tagIdOf, isPushFx } from '../src/lib/fx.js';
import { isValid } from '../src/lib/core/script.js';
import { curveModel, curveTwins } from '../src/features/timeline/fx-edit.js';
import { snapTo } from '../src/ui/kit/curve.js';
import { rangePlan } from '../src/lib/autorange.js';

const S = (t0, t1, tags = []) => ({ start_ms: t0, end_ms: t1, tags });
const mono = (pts, dir = -1) => pts.every((a, i) => !i || Math.sign(a.pos - pts[i - 1].pos) !== -dir);
const PUSH = (id, t0, t1, params = {}) => ({ id, kind: 'knotting', t0, t1, params: { ...KNOT_PUSH, ...params } });
const PULL = (id, t0, t1) => ({ id, kind: 'knotting', t0, t1, params: { ...KNOT_PULL } });

test('paw-ajvq kinds: no Insertion / Pull-out / Climax run-in kind; a push / pull is a knotting in mode none, read by the consumers as the insertion / pullout tag', () => {
  for (const k of ['insertion', 'pullout', 'climax']) assert.ok(!FX_KINDS[k], k);
  assert.ok(fxParams({ kind: 'knotting', params: { mode: 'none' } }).mode === 'none', 'none is a knot mode');
  assert.ok(isPushFx(PUSH('a', 0, 1)) && !isPushFx({ kind: 'knotting', params: { mode: 'single' } }));
  assert.equal(KNOT_PUSH.to, 0, 'a push goes to the level set full depth'); assert.equal(KNOT_PULL.to, 100, 'a pull goes out');
  assert.equal(tagIdOf(PUSH('a', 0, 1)), 'insertion'); assert.equal(tagIdOf(PULL('a', 0, 1)), 'pullout'); assert.equal(tagIdOf({ kind: 'knotting', params: {} }), 'knotting');
  assert.equal(TAG.insertion.cat, 'modifier'); assert.equal(TAG.pullout.cat, 'modifier');
  const sc = [S(0, 10000, ['anal', 'penetration']), S(10000, 20000, ['anal', 'penetration'])];
  const p = withMods(sc, [PUSH('i', 10000, 14000)]);
  assert.deepEqual(p[1].tags.at(-1), { id: 'insertion', t0: 10000, t1: 14000 });
  assert.equal(p[0], sc[0], 'scenes it does not meet stay the same objects');
  assert.equal(withMods(sc, []), sc);
});

test('plan rows: an insertion does not skip its scene: it is tracked (the modifier shapes the run; a bridge generates the push where nothing is)', () => {
  assert.equal(skipReason(S(0, 1000, ['anal', 'insertion'])), '');
  const scenes = withMods([S(0, 1000, ['anal', 'penetration']), S(1000, 2000, ['anal']), S(2000, 3000, ['anal', 'penetration'])], [PUSH('i', 1000, 2000)]);
  const trackers = [{ id: 'tapnext_points', name: 'TAPNext', roi: 'none' }];
  for (const skip of [skipReason, undefined]) {   // the acts.js reader and the raw-tag default agree
    const p = planTracks(scenes, { trackers, trackerId: 'tapnext_points', skip });
    assert.deepEqual(p.map((x) => x.action), ['track', 'track', 'track']);
  }
});

test('a pull-out: one monotone pull from where the trace is to out, held; the untracked bridge pulls the same way', () => {
  const flat = [{ at: 0, pos: 10 }, { at: 30000, pos: 10 }];
  const out = applyFx(flat, [PULL('p', 10000, 20000)]);
  assert.ok(isValid(out)); assert.ok(mono(out.filter((a) => a.at >= 10000 && a.at <= 20000), 1), 'monotone out');
  assert.equal(out.find((a) => a.at === 20000).pos, 100);
  const s = insertionScript(10000, 20000, 10000, 20000, { from: 10, params: KNOT_PULL });
  assert.ok(mono(s, 1)); assert.equal(s.at(-1).pos, 100);
});

test('the generated push: one monotone move from the level before to the depth, held to the end', () => {
  const s = insertionScript(10000, 20000, 10000, 20000, { from: 100, params: KNOT_PUSH });
  assert.ok(isValid(s)); assert.ok(s.every((a) => a.at > 10000 && a.at < 20000), 'strictly inside the scene');
  assert.ok(mono(s), 'only ever deeper');
  assert.equal(s[0].pos, 100); assert.equal(s[s.length - 1].pos, 0); assert.equal(s[s.length - 1].at, 19999, 'held to the end');
  const d = fxParams({ kind: 'knotting', params: KNOT_PUSH }), arrive = 10000 + d.popAt * 10000;
  assert.ok(s.filter((a) => a.at >= arrive).every((a) => a.pos === 0), 'flat after it arrives');
  // the ease: slow start, steady, settle -- the first and last fifths of the push move less than the middle one
  const k = pushKeys(d, 100, 0), at = (u) => { const i = k.findIndex(([x]) => x >= u); const [a, pa] = k[i - 1], [b, pb] = k[i]; return pa + ((pb - pa) * (u - a)) / (b - a); };
  const u0 = d.popAt - d.push, w = d.push / 5, step = (j) => at(u0 + (j + 1) * w) - at(u0 + j * w);
  assert.ok(Math.abs(step(0)) < Math.abs(step(2)) && Math.abs(step(4)) < Math.abs(step(2)));
  // the level before is where it starts; a tag span inside the scene holds before and after it
  const p = insertionScript(0, 10000, 3000, 8000, { from: 60, params: { ...KNOT_PUSH, to: 5 } });
  assert.equal(p[0].at, 1); assert.equal(p[0].pos, 60); assert.equal(p.find((a) => a.at >= 8000).pos, 5); assert.equal(p[p.length - 1].pos, 5);
  assert.ok(mono(p));
  // the effect's own start wins over the level before; dragged above the start it is a slow pull
  assert.equal(insertionScript(0, 10000, 0, 10000, { from: 60, params: { ...KNOT_PUSH, from: 90 } })[0].pos, 90);
  const out = insertionScript(0, 10000, 0, 10000, { from: 5, params: { ...KNOT_PUSH, to: 100 } });
  assert.ok(mono(out, 1)); assert.equal(out[0].pos, 5); assert.equal(out[out.length - 1].pos, 100);
  assert.deepEqual(insertionScript(0, 30, 0, 30, { params: KNOT_PUSH }), [], 'too short');
});

test('knotted insertion: One knot over an untracked scene is one knot-in (push, pop, settle, the tie); a push no longer yields to a knot (paw-ajvq)', () => {
  const k = insertionScript(0, 10000, 0, 10000, { from: 100, params: { mode: 'single' } });
  assert.ok(isValid(k)); assert.equal(k[0].pos, 100);
  assert.ok(k.some((a) => a.pos === 0), 'the pop lands on full depth'); assert.equal(k[k.length - 1].pos, 17, 'held at the tie (no pull-out in an untracked scene)');
  // on the stroke: a push under a knot is a layer like any other (the special rule is gone): the knot acts on the push
  const base = [{ at: 0, pos: 90 }, { at: 5000, pos: 20 }, { at: 9000, pos: 80 }, { at: 21000, pos: 50 }];
  const ins = PUSH('i', 10000, 14000), knot = { id: 'k', kind: 'knotting', t0: 12000, t1: 20000, params: { mode: 'single' } };
  assert.notDeepEqual(applyFx(base, [ins, knot]), applyFx(base, [knot]));
  assert.notDeepEqual(applyFx(base, [ins]), applyFx(base, [knot]));
});

test('insertion effect on tracked points: the strokes under it become the push from the level the trace is at', () => {
  const base = [];
  for (let t = 0; t <= 30000; t += 400) base.push({ at: t, pos: (t / 400) % 2 ? 90 : 10 });
  const out = applyFx(base, [PUSH('i', 10000, 20000, { to: 10 })]), inside = out.filter((a) => a.at >= 10000 && a.at <= 20000);
  assert.ok(isValid(out)); assert.ok(mono(inside), 'no strokes left inside');
  assert.equal(inside[0].pos, base.find((a) => a.at === 10000).pos); assert.equal(inside[inside.length - 1].pos, 10);
});

test('fitInsertion: the push timing off a tracked slow push; null on strokes', () => {
  const t = [], v = [];
  for (let ms = 0; ms <= 6000; ms += 33.3) { t.push(ms); v.push(ms < 1000 ? 0.9 : ms < 4000 ? 0.9 - (0.7 * (ms - 1000)) / 3000 : 0.2); }
  const f = fitInsertion({ t, v }, 0, 6000);
  assert.equal(f.mode, 'none');
  assert.ok(Math.abs(f.popAt - 0.65) <= 0.04, `arrive ${f.popAt}`); assert.ok(Math.abs(f.push - 0.47) <= 0.06, `push ${f.push}`);
  assert.equal(fitInsertion({ t, v: t.map((ms) => 0.5 + 0.4 * Math.sin(ms / 160)) }, 0, 6000), null);
});

test('push popover: start, push, arrival and the level it ends at; every handle reads back its value', () => {
  for (const params of [KNOT_PUSH, { ...KNOT_PUSH, from: 95, to: 4, push: 0.5, popAt: 0.7 }, KNOT_PULL]) {
    const p = fxParams({ kind: 'knotting', params }), m = curveModel('knotting', p);
    assert.deepEqual(m.handles.map((h) => h.key), ['from', 'push', 'popAt', 'to']);
    for (const h of m.handles) if (h.value != null) assert.ok(Math.abs(snapTo(h.toValue(h.x, h.y), h) - h.value) <= (h.step || 1) + 1e-9, `${h.key}: ${h.toValue(h.x, h.y)} vs ${h.value}`);
    assert.deepEqual(curveTwins('knotting', p).map((x) => x.key).sort(), m.handles.map((h) => h.key).sort());
  }
});

test('Autorange: an insertion scene gets no band effect, no gap fill, no tease; the next scene continues the run deep', () => {
  const sc = withMods([S(0, 10000, ['anal', 'penetration']), S(10000, 20000, ['anal']), S(20000, 30000, ['anal', 'penetration'])], [PUSH('i', 10000, 20000)]);
  const script = [];
  for (let t = 0; t < 30000; t += 500) if (t < 10000 || t >= 20000) script.push({ at: t, pos: t % 1000 ? 90 : 10 });
  script.push({ at: 12000, pos: 100 }, { at: 19000, pos: 10 });   // an accepted push: long point gaps
  const plan = rangePlan(sc, script);
  assert.equal(plan[1].rule, 'insertion'); assert.equal(plan[1].source, 'none'); assert.deepEqual(plan[1].pieces, []); assert.deepEqual(plan[1].tease, []);
  assert.equal(plan[2].run.id, plan[0].run.id, 'same run'); assert.ok(plan[2].lo < plan[0].lo, 'deeper on');
  assert.equal(rangePlan(withMods([S(0, 10000, ['anal'])], [PUSH('i', 0, 10000)]), []).at(0).source, 'none', 'no gap fill either');
});
