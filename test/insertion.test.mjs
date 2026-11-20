// Insertion and pull-out (paw-ef73.20: modifiers, made like every other event modifier): the generated push / pull
// (lib/fx.js insertion / pullout, insertionScript), its curve handles (fx-edit.js), the scenes they sit in are tracked
// (a bridge generates the push where nothing is) and Autorange leaving an insertion scene alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAG, skipReason } from '../src/features/timeline/acts.js';
import { withMods } from '../src/features/timeline/mods.js';
import { planTracks } from '../src/lib/track-plan.js';
import { applyFx, insertionScript, insertionKeys, fitInsertion, fxParams, FX_KINDS } from '../src/lib/fx.js';
import { isValid } from '../src/lib/core/script.js';
import { curveModel, curveTwins } from '../src/features/timeline/fx-edit.js';
import { snapTo } from '../src/ui/kit/curve.js';
import { rangePlan } from '../src/lib/autorange.js';

const S = (t0, t1, tags = []) => ({ start_ms: t0, end_ms: t1, tags });
const mono = (pts, dir = -1) => pts.every((a, i) => !i || Math.sign(a.pos - pts[i - 1].pos) !== -dir);

test('kinds: insertion and pull-out are event modifiers (any tab), never scene tags: the consumers see them through withMods', () => {
  assert.ok(FX_KINDS.insertion.event && FX_KINDS.pullout.event);
  assert.equal(TAG.insertion.cat, 'modifier'); assert.equal(TAG.pullout.cat, 'modifier');
  assert.equal(fxParams({ kind: 'pullout' }).to, 100, 'a pull-out goes out');
  const sc = [S(0, 10000, ['anal', 'penetration']), S(10000, 20000, ['anal', 'penetration'])];
  const p = withMods(sc, [{ id: 'i', kind: 'insertion', t0: 10000, t1: 14000, params: {} }]);
  assert.deepEqual(p[1].tags.at(-1), { id: 'insertion', t0: 10000, t1: 14000 });
  assert.equal(p[0], sc[0], 'scenes it does not meet stay the same objects');
  assert.equal(withMods(sc, []), sc);
});

test('plan rows: an insertion does not skip its scene: it is tracked (the modifier shapes the run; a bridge generates the push where nothing is)', () => {
  assert.equal(skipReason(S(0, 1000, ['anal', 'insertion'])), '');
  const scenes = withMods([S(0, 1000, ['anal', 'penetration']), S(1000, 2000, ['anal']), S(2000, 3000, ['anal', 'penetration'])], [{ id: 'i', kind: 'insertion', t0: 1000, t1: 2000, params: {} }]);
  const trackers = [{ id: 'tapnext_points', name: 'TAPNext', roi: 'none' }];
  for (const skip of [skipReason, undefined]) {   // the acts.js reader and the raw-tag default agree
    const p = planTracks(scenes, { trackers, trackerId: 'tapnext_points', skip });
    assert.deepEqual(p.map((x) => x.action), ['track', 'track', 'track']);
  }
});

test('a pull-out: one monotone pull from where the trace is to out, held; the untracked bridge pulls the same way', () => {
  const flat = [{ at: 0, pos: 10 }, { at: 30000, pos: 10 }];
  const out = applyFx(flat, [{ id: 'p', kind: 'pullout', t0: 10000, t1: 20000 }]);
  assert.ok(isValid(out)); assert.ok(mono(out.filter((a) => a.at >= 10000 && a.at <= 20000), 1), 'monotone out');
  assert.equal(out.find((a) => a.at === 20000).pos, 100);
  const s = insertionScript(10000, 20000, 10000, 20000, { from: 10, kind: 'pullout' });
  assert.ok(mono(s, 1)); assert.equal(s.at(-1).pos, 100);
});

test('the generated push: one monotone move from the level before to the depth, held to the end', () => {
  const s = insertionScript(10000, 20000, 10000, 20000, { from: 100 });
  assert.ok(isValid(s)); assert.ok(s.every((a) => a.at > 10000 && a.at < 20000), 'strictly inside the scene');
  assert.ok(mono(s), 'only ever deeper');
  assert.equal(s[0].pos, 100); assert.equal(s[s.length - 1].pos, 10); assert.equal(s[s.length - 1].at, 19999, 'held to the end');
  const d = fxParams({ kind: 'insertion' }), arrive = 10000 + d.arrive * 10000;
  assert.ok(s.filter((a) => a.at >= arrive).every((a) => a.pos === 10), 'flat after it arrives');
  // the ease: slow start, steady, settle -- the first and last fifths of the push move less than the middle one
  const k = insertionKeys(d, 100), at = (u) => { const i = k.findIndex(([x]) => x >= u); const [a, pa] = k[i - 1], [b, pb] = k[i]; return pa + ((pb - pa) * (u - a)) / (b - a); };
  const u0 = d.arrive - d.push, w = d.push / 5, step = (j) => at(u0 + (j + 1) * w) - at(u0 + j * w);
  assert.ok(Math.abs(step(0)) < Math.abs(step(2)) && Math.abs(step(4)) < Math.abs(step(2)));
  // the level before is where it starts; a tag span inside the scene holds before and after it
  const p = insertionScript(0, 10000, 3000, 8000, { from: 60, params: { to: 5 } });
  assert.equal(p[0].at, 1); assert.equal(p[0].pos, 60); assert.equal(p.find((a) => a.at >= 8000).pos, 5); assert.equal(p[p.length - 1].pos, 5);
  assert.ok(mono(p));
  // the effect's own start wins over the level before; dragged above the start it is a slow pull-out
  assert.equal(insertionScript(0, 10000, 0, 10000, { from: 60, params: { from: 90 } })[0].pos, 90);
  const out = insertionScript(0, 10000, 0, 10000, { from: 5, params: { to: 100 } });
  assert.ok(mono(out, 1)); assert.equal(out[0].pos, 5); assert.equal(out[out.length - 1].pos, 100);
  assert.deepEqual(insertionScript(0, 30, 0, 30), [], 'too short');
});

test('knotted insertion: one knot-in (push, pop, settle, the tie), never a push and a knot on top of each other', () => {
  const k = insertionScript(0, 10000, 0, 10000, { from: 100, knot: {} });
  assert.ok(isValid(k)); assert.equal(k[0].pos, 100);
  assert.ok(k.some((a) => a.pos === 0), 'the pop lands on full depth'); assert.equal(k[k.length - 1].pos, 5, 'held at the tie');
  // on the stroke: a knotting effect over an insertion effect wins (the insertion yields), byte-identical to the knot alone
  const base = [{ at: 0, pos: 90 }, { at: 5000, pos: 20 }, { at: 9000, pos: 80 }, { at: 21000, pos: 50 }];
  const ins = { id: 'i', kind: 'insertion', t0: 10000, t1: 20000 }, knot = { id: 'k', kind: 'knotting', t0: 10000, t1: 20000, params: { mode: 'single' } };
  assert.deepEqual(applyFx(base, [ins, knot]), applyFx(base, [knot]));
  assert.notDeepEqual(applyFx(base, [ins]), applyFx(base, [knot]));
});

test('insertion effect on tracked points: the strokes under it become the push from the level the trace is at', () => {
  const base = [];
  for (let t = 0; t <= 30000; t += 400) base.push({ at: t, pos: (t / 400) % 2 ? 90 : 10 });
  const out = applyFx(base, [{ id: 'i', kind: 'insertion', t0: 10000, t1: 20000 }]), inside = out.filter((a) => a.at >= 10000 && a.at <= 20000);
  assert.ok(isValid(out)); assert.ok(mono(inside), 'no strokes left inside');
  assert.equal(inside[0].pos, base.find((a) => a.at === 10000).pos); assert.equal(inside[inside.length - 1].pos, 10);
  assert.equal(FX_KINDS.insertion.label, 'Insertion');
});

test('fitInsertion: the push timing off a tracked slow push; null on strokes', () => {
  const t = [], v = [];
  for (let ms = 0; ms <= 6000; ms += 33.3) { t.push(ms); v.push(ms < 1000 ? 0.9 : ms < 4000 ? 0.9 - (0.7 * (ms - 1000)) / 3000 : 0.2); }
  const f = fitInsertion({ t, v }, 0, 6000);
  assert.ok(Math.abs(f.arrive - 0.65) <= 0.04, `arrive ${f.arrive}`); assert.ok(Math.abs(f.push - 0.47) <= 0.06, `push ${f.push}`);
  assert.equal(fitInsertion({ t, v: t.map((ms) => 0.5 + 0.4 * Math.sin(ms / 160)) }, 0, 6000), null);
});

test('insertion popover: start, push, two eases, arrival and depth; every handle reads back its value', () => {
  for (const params of [{}, { from: 95, to: 4, push: 0.5, arrive: 0.7, easeIn: 0.8, easeOut: -0.2 }, { from: 10, to: 100 }]) {
    const p = fxParams({ kind: 'insertion', params }), m = curveModel('insertion', p);
    assert.deepEqual(m.handles.map((h) => h.key), ['from', 'push', 'easeIn', 'easeOut', 'arrive', 'to']);
    for (const h of m.handles) if (h.value != null) assert.ok(Math.abs(snapTo(h.toValue(h.x, h.y), h) - h.value) <= (h.step || 1) + 1e-9, `${h.key}: ${h.toValue(h.x, h.y)} vs ${h.value}`);
    assert.deepEqual(curveTwins('insertion', p).map((x) => x.key).sort(), m.handles.map((h) => h.key).sort());
  }
});

test('Autorange: an insertion scene gets no band effect, no gap fill, no tease; the next scene continues the run deep', () => {
  const sc = withMods([S(0, 10000, ['anal', 'penetration']), S(10000, 20000, ['anal']), S(20000, 30000, ['anal', 'penetration'])], [{ id: 'i', kind: 'insertion', t0: 10000, t1: 20000 }]);
  const script = [];
  for (let t = 0; t < 30000; t += 500) if (t < 10000 || t >= 20000) script.push({ at: t, pos: t % 1000 ? 90 : 10 });
  script.push({ at: 12000, pos: 100 }, { at: 19000, pos: 10 });   // an accepted push: long point gaps
  const plan = rangePlan(sc, script);
  assert.equal(plan[1].rule, 'insertion'); assert.equal(plan[1].source, 'none'); assert.deepEqual(plan[1].pieces, []); assert.deepEqual(plan[1].tease, []);
  assert.equal(plan[2].run.id, plan[0].run.id, 'same run'); assert.ok(plan[2].lo < plan[0].lo, 'deeper on');
  assert.equal(rangePlan(withMods([S(0, 10000, ['anal'])], [{ id: 'i', kind: 'insertion', t0: 0, t1: 10000 }]), []).at(0).source, 'none', 'no gap fill either');
});
