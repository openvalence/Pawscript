// The effects layer (src/lib/fx.js): effects modulate the tracked motion inside their span only, from its own turns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid, posAt } from '../src/lib/core/script.js';
import { applyFx, fxGhost, baseTurns, liveFx, fxSchema, FX_KIND_IDS, fitProfile, moveCurve } from '../src/lib/fx.js';
import { createCatalogue } from '../src/lib/graph/nodes/index.js';

// tracked-looking strokes: 0..20 s slow (half-stroke 500 ms), 20..40 s fast (180 ms); bottoms ~5, tops ~90, uneven
function tracked() {
  const out = [];
  let t = 0, top = false, k = 0;
  while (t <= 40000) {
    out.push({ at: Math.round(t), pos: top ? 88 + (k % 3) : 4 + (k % 2) });
    t += t < 20000 ? 500 + (k % 4) * 10 : 180 + (k % 3) * 5;
    top = !top; k++;
  }
  return out;
}
const BASE = Object.freeze(tracked().map(Object.freeze));
const turnTimes = (s, a, b) => baseTurns(s, a, b).map((x) => x.at);

function outsideIdentical(out, base, t0, t1) {
  const keep = (s) => s.filter((a) => a.at < t0 || a.at > t1);
  const o = keep(out), b = keep(base);
  assert.equal(o.length, b.length, 'same number of points outside');
  o.forEach((a, i) => assert.equal(a, b[i], `point ${i} outside is the same object`));
}

for (const kind of FX_KIND_IDS) {
  test(`${kind}: outside the span the base is byte-identical, inside it changes, output valid and deterministic`, () => {
    const pt = kind === 'spurt', e = { id: 'e1', kind, t0: 15000, t1: pt ? 15000 : 30000, ...(kind === 'shape' ? { params: { dwellTop: 0.2 } } : {}) };
    const out = applyFx(BASE, [e]);
    assert.ok(isValid(out));
    outsideIdentical(out, BASE, pt ? 14700 : 15000, pt ? 15300 : 30000);   // a spurt's window widens for the cap
    assert.notDeepEqual(out, BASE, 'the effect does something');
    assert.deepEqual(applyFx(BASE, [e]), out);
    assert.equal(applyFx(BASE, [{ ...e, muted: true }]), BASE, 'muted = gone');
  });
}

test('no live effects, or an effect beyond the base, returns the base itself', () => {
  assert.equal(applyFx(BASE, []), BASE);
  assert.equal(applyFx(BASE, [{ id: 'x', kind: 'nope', t0: 0, t1: 5000 }]), BASE);
  assert.equal(applyFx(BASE, [{ id: 'x', kind: 'orgasm', t0: 50000, t1: 60000 }]), BASE);
  assert.deepEqual(liveFx([{ id: 'b', kind: 'shape', t0: 5, t1: 9 }, { id: 'a', kind: 'shape', t0: 1, t1: 2 }, { id: 'c', kind: 'shape', t0: 3, t1: 3 }]).map((e) => e.id), ['a', 'b']);
});

test('knotting: one knot cycle on every tracked stroke, landing on the tracked turns', () => {
  const t0 = 4000, t1 = 16000, out = applyFx(BASE, [{ id: 'k', kind: 'knotting', t0, t1 }]);
  const at = new Map(out.map((a) => [a.at, a.pos]));
  const turns = baseTurns(BASE, t0 + 1000, t1 - 1000);
  assert.ok(turns.length > 15);
  for (const x of turns) assert.equal(at.get(x.at), x.kind === 'top' ? 80 : 0, `${x.kind} at ${x.at}`);
  // the knot levels are there between them (knotOut 17, popTo 64)
  const inside = out.filter((a) => a.at > t0 + 1000 && a.at < t1 - 1000).map((a) => a.pos);
  assert.ok(inside.includes(17) && inside.includes(64));
});

test('orgasm: keeps every tracked turn time, pulls depth to the deep end, flutters only where the base is fast', () => {
  const t0 = 10000, t1 = 30000, out = applyFx(BASE, [{ id: 'o', kind: 'orgasm', t0, t1, params: { edgeMs: 1000 } }]);
  const times = new Set(out.map((a) => a.at));
  for (const t of BASE.filter((a) => a.at >= t0 && a.at <= t1).map((a) => a.at)) assert.ok(times.has(t), `base point ${t} kept`);
  const mid = out.filter((a) => a.at > t0 + 1000 && a.at < t1 - 1000);
  assert.ok(mid.every((a) => a.pos <= 40), 'inside the deep band (0..40) once eased in');
  const baseIn = (a, b) => BASE.filter((x) => x.at > a && x.at < b).length, outIn = (a, b) => out.filter((x) => x.at > a && x.at < b).length;
  assert.equal(outIn(12000, 19000), baseIn(12000, 19000), 'slow strokes: no flutter added');
  assert.ok(outIn(21000, 28000) > baseIn(21000, 28000), 'fast strokes: flutter added between turns');
  assert.equal(applyFx(BASE, [{ id: 'o', kind: 'orgasm', t0, t1, params: { pulse: 0 } }]).length, BASE.length, 'pulse 0: no flutter');
});

test('reshape: keeps every tracked turn (time and pos) and re-draws the moves between them', () => {
  const t0 = 2000, t1 = 12000, out = applyFx(BASE, [{ id: 's', kind: 'shape', t0, t1, params: { dwellTop: 0.25, dwellBottom: 0.25 } }]);
  assert.equal(applyFx(BASE, [{ id: 's', kind: 'shape', t0, t1 }]), BASE, 'all params "as tracked": no change');
  const at = new Map(out.map((a) => [a.at, a.pos]));
  for (const t of turnTimes(BASE, t0 + 1, t1 - 1)) assert.equal(at.get(t), BASE.find((a) => a.at === t).pos, `turn ${t}`);
  // dwell 0.25 at both ends: each whole move inside arrives at 75 % of its time and holds
  const pairs = BASE.filter((a) => a.at > t0 + 600 && a.at < t1 - 600);
  for (let i = 0; i + 1 < pairs.length; i++) {
    const a = pairs[i], b = pairs[i + 1], u = Math.round(a.at + 0.75 * (b.at - a.at));
    assert.equal(at.get(u), b.pos, `held at ${u}`);
  }
  // ease leaving / arriving: points between the turns, still the same turns
  const eased = applyFx(BASE, [{ id: 's', kind: 'shape', t0, t1, params: { accelIn: 1, accelOut: 1 } }]), ea = new Map(eased.map((a) => [a.at, a.pos]));
  for (const t of turnTimes(BASE, t0 + 1, t1 - 1)) assert.equal(ea.get(t), BASE.find((a) => a.at === t).pos);
  assert.ok(eased.length > BASE.length + 40);
  // fast in / slow out: the deep turns stay, the tops move earlier in their stroke
  const fio = applyFx(BASE, [{ id: 's', kind: 'shape', t0, t1, params: { inFrac: 0.35 } }]);
  const bottoms = baseTurns(BASE, t0 + 1, t1 - 1).filter((x) => x.kind === 'bottom').map((x) => x.at), fa = new Set(fio.map((a) => a.at));
  for (const t of bottoms) assert.ok(fa.has(t), `bottom ${t} kept`);
  assert.ok(isValid(fio));
  // depth lo / hi: the span's turns onto 20..70
  const deep = applyFx(BASE, [{ id: 's', kind: 'shape', t0, t1, params: { lo: 20, hi: 70 } }]).filter((a) => a.at > t0 + 600 && a.at < t1 - 600);
  assert.equal(Math.min(...deep.map((a) => a.pos)), 20); assert.equal(Math.max(...deep.map((a) => a.pos)), 70);
});

test('fit from motion: a square-ish track reads as dwells, a linear one as none; the fit is a param preset', () => {
  const keys = BASE.filter((a) => a.at <= 20000);
  const track = (prof) => {   // 100 Hz samples drawn through the keyframes with a profile, scale 0..1 like a tracker
    const t = [], v = [];
    for (let i = 0; i + 1 < keys.length; i++) {
      const a = keys[i], b = keys[i + 1];
      for (let x = a.at; x < b.at; x += 10) { const u = (x - a.at) / (b.at - a.at); t.push(x); v.push((a.pos + prof(u) * (b.pos - a.pos)) / 100); }
    }
    return { t, v };
  };
  const sq = fitProfile(track((u) => moveCurve(u, 0, 0, 0.3)), BASE, 2000, 18000);
  assert.ok(sq.dwellTop >= 0.2 && sq.dwellBottom >= 0.2, JSON.stringify(sq));
  const lin = fitProfile(track((u) => u), BASE, 2000, 18000);
  assert.ok(lin.dwellTop <= 0.05 && Math.abs(lin.accelIn) < 0.1 && Math.abs(lin.accelOut) < 0.1, JSON.stringify(lin));
  const ease = fitProfile(track((u) => moveCurve(u, 0.8, 0.8)), BASE, 2000, 18000);
  assert.ok(ease.accelIn > 0.3 && ease.accelOut > 0.3, JSON.stringify(ease));
  assert.ok(!('inFrac' in sq) && sq.lo <= 5 && sq.hi >= 88, 'the fit never moves turns: inFrac stays as tracked');
  // applied: the keyframe-only base gains the holds the track showed, turns unchanged
  const out = applyFx(BASE, [{ id: 'f', kind: 'shape', t0: 2000, t1: 18000, params: sq }]);
  assert.ok(out.length > BASE.length + 20 && isValid(out));
  assert.equal(fitProfile({ t: [], v: [] }, BASE, 0, 5000), null);
});

test('fxGhost: tracker ghosts through the layer (identity kept while nothing changes), other ghosts untouched', () => {
  const fx = [{ id: 'o', kind: 'orgasm', t0: 21000, t1: 30000 }];
  const g = { id: 'run1', source: { kind: 'tracker' }, script: BASE }, ref = { id: 'ref', source: { kind: 'reference' }, script: BASE };
  const a = fxGhost(g, fx), b = fxGhost(g, fx);
  assert.notEqual(a, g); assert.equal(a, b); assert.deepEqual(a.script, applyFx(BASE, fx));
  assert.equal(fxGhost(ref, fx), ref);
  assert.equal(fxGhost(g, []), g);
});

test('every kind has a parameter form', () => {
  for (const k of FX_KIND_IDS) assert.ok(fxSchema(k).length > 0 || k === 'idle', k);   // idle is a hold: no params
  assert.ok(!fxSchema('knotting').some((p) => p.key === 'timing'), 'knot timing is always the tracked turns');
  assert.ok(Math.abs(moveCurve(0.5) - 0.5) < 1e-12 && moveCurve(0.9, 0, 0, 0.2) === 1);
});

test('graph: src.fx -> fx.apply gives applyFx; byKind overrides win', () => {
  const reg = createCatalogue(), node = reg.get('fx.apply'), src = reg.get('src.fx');
  assert.ok(node.perSpan && src);
  const fx = [{ id: 'o', kind: 'orgasm', t0: 21000, t1: 30000, params: { hi: 30 } }, { id: 'm', kind: 'shape', t0: 0, t1: 5000, muted: true }];
  const spans = src.eval({}, {}, { read: () => fx }).spans;
  assert.equal(spans.length, 1);
  const ctx = (over) => ({ where: spans, paramsFor: () => ({ maxSpeed: 450, ...over }), info() {} });
  assert.deepEqual(node.eval({ script: BASE }, { maxSpeed: 450 }, ctx({})).script, applyFx(BASE, fx, { maxSpeed: 450 }));
  assert.deepEqual(node.eval({ script: BASE }, { maxSpeed: 450 }, ctx({ hi: 20 })).script, applyFx(BASE, [{ ...fx[0], params: { hi: 20 } }], { maxSpeed: 450 }));
  assert.equal(node.eval({ script: BASE }, { maxSpeed: 450 }, { where: null, info() {} }).script, BASE);
});

test('Modifiers row edits and the popover curves: every handle reads back its own value; labels stay in the box', async () => {
  const { addFx, dropSpan, toggleMute, setFxKind, curveModel, curveTwins, fxRows, dragFx, duplicateFx } = await import('../src/features/timeline/fx-edit.js');
  const { fxParams } = await import('../src/lib/fx.js');
  const { placeLabels, snapTo } = await import('../src/ui/kit/curve.js');
  let L = addFx([], { id: 'a', kind: 'orgasm', t0: 1000, t1: 5000, dur: 60000 });
  L = addFx(L, { id: 'b', kind: 'shape', t0: 2000, t1: 3000, dur: 60000 });
  const g = dropSpan(8000, { cuts: [6000, 12000], dur: 60000 });
  L = addFx(L, { id: 'k', kind: 'knotting', ...g, dur: 60000 });
  L = addFx(L, { id: 'k2', kind: 'shape', ...dropSpan(7000, { cuts: [6000, 12000], dur: 60000 }), dur: 60000 });
  assert.deepEqual(L.map((e) => [e.id, e.t0, e.t1]), [['a', 1000, 5000], ['b', 2000, 3000], ['k', 6000, 12000], ['k2', 6000, 12000]], 'effects stack (layers)');
  const { row, rows } = fxRows(L);
  assert.equal(rows, 2); assert.deepEqual([row.get('a'), row.get('b'), row.get('k'), row.get('k2')], [0, 1, 0, 1]);
  const m = dragFx(L, 'b', 'body', { dt: 5000, dur: 60000 });
  assert.deepEqual(m.map((e) => e.id), ['a', 'k', 'k2', 'b']); assert.equal(m.find((e) => e.id === 'b').t0, 7000);
  assert.equal(m.find((e) => e.id === 'k'), L.find((e) => e.id === 'k'), 'other layers never move');
  assert.equal(dragFx(L, 'a', 't1', { t: 500, minLen: 100 })[0].t1, 1100, 'an edge keeps minLen');
  assert.equal(duplicateFx(L, 'a', { newId: () => 'a2', dur: 60000 }).list.find((e) => e.id === 'a2').t0, 5000);
  assert.equal(toggleMute(toggleMute(L, 'a'), 'a')[0].muted, undefined);
  assert.deepEqual(setFxKind(L, 'a', 'climax')[0].params, {});
  const vals = { shape: { inFrac: 0.4, accelIn: 0.3, accelOut: -0.2, dwellTop: 0.2, dwellBottom: 0.1, lo: 10, hi: 80 }, orgasm: { pulse: 1.2, rampIn: 0.25, rampOut: 0.4 }, knotting: {}, spurt: { amount: 30, rise: 60, fall: 80, hold: 0 } };
  for (const [kind, params] of Object.entries(vals)) {
    const p = fxParams({ kind, params }), m = curveModel(kind, p);
    assert.ok(m.lines.length && m.handles.length, kind);
    for (const h of m.handles) assert.ok(Math.abs(snapTo(h.toValue(h.x, h.y), h) - h.value) <= (h.step || 1) + 1e-9, `${kind}.${h.key}: ${h.toValue(h.x, h.y)} vs ${h.value}`);
    assert.ok(curveTwins(kind, p).length <= m.handles.length + 5, `${kind}: twins are the handles' numbers (+ a few), not the whole schema`);
  }
  const items = [{ x: 50, y: 50, w: 40, h: 14 }, { x: 55, y: 52, w: 40, h: 14 }];
  const r = placeLabels(items, [[[0, 60], [200, 60]]], 200, 100);
  for (const [i, q] of r.entries()) assert.ok(q.x >= 0 && q.y >= 0 && q.x + items[i].w <= 200 && q.y + items[i].h <= 100);
  assert.ok(!(r[0].x < r[1].x + 40 && r[1].x < r[0].x + 40 && r[0].y < r[1].y + 14 && r[1].y < r[0].y + 14), 'labels do not overlap');
});

test('spurt: a ringing about the trace, deeper on the frame, alternating and decaying, squeezed near the ends, close spurts stack', () => {
  const t = 5000, flat = [{ at: 0, pos: 50 }, { at: 10000, pos: 50 }];
  const ring = (base, params, ctx = { maxSpeed: 0 }) => applyFx(base, [{ id: 's', kind: 'spurt', t0: t, t1: t, params }], ctx);
  // count 3, amount 20, decay 0.75 about a flat 50: 50 -> 30 (on the frame) -> 65 -> 39 -> 50, 50 ms per swing
  const one = ring(flat, { amount: 20 });
  assert.ok(isValid(one));
  assert.deepEqual(one.filter((a) => a.at >= t - 50 && a.at <= t + 150), [{ at: t - 50, pos: 50 }, { at: t, pos: 30 }, { at: t + 50, pos: 65 }, { at: t + 100, pos: 39 }, { at: t + 150, pos: 50 }]);
  assert.deepEqual(one.filter((a) => a.at < t - 50 || a.at > t + 150), flat, 'the trace untouched outside the ringing');
  // symmetric about the trace: on a rising trace every swing is measured from the trace at its own time
  const rising = [{ at: 0, pos: 40 }, { at: 10000, pos: 60 }], r = ring(rising, { amount: 20, count: 4 });
  const off = r.filter((a) => a.at >= t && a.at <= t + 150).map((a) => a.pos - posAt(rising, a.at));
  [-20, 15, -11.25, 8.4375].forEach((o, k) => assert.ok(Math.abs(off[k] - o) <= 0.5 + 1e-9, `swing ${k}: ${off[k]} vs ${o} (alternating sides, each decay x the one before)`));
  for (const at of [t - 50, t + 200]) assert.equal(r.find((a) => a.at === at).pos, Math.round(posAt(rising, at)), `ends on the trace at ${at}`);
  // never past 0 / 100: the swing is squeezed to the room there, not clipped (near the deep end the deep swing shrinks, the out swing does not)
  const low = ring([{ at: 0, pos: 10 }, { at: 10000, pos: 10 }], { amount: 25 }).filter((a) => a.at >= t && a.at <= t + 100).map((a) => a.pos);
  assert.deepEqual(low, [0, 29, 0]);
  const high = ring([{ at: 0, pos: 95 }, { at: 10000, pos: 95 }], { amount: 25 }).filter((a) => a.at >= t && a.at <= t + 100).map((a) => a.pos);
  assert.deepEqual(high, [70, 100, 81]);
  // an old saved absolute `depth` is ignored (amount 25)
  assert.deepEqual(ring(flat, { depth: 0 }), ring(flat, {}));
  // speed cap: every swing in full, the first on the frame; the approach starts earlier by what the cap needs
  const capped = ring(flat, { amount: 40 }, { maxSpeed: 450 });
  assert.ok(isValid(capped));
  assert.equal(capped.find((a) => a.at === t).pos, 10, 'the full swing, on the frame');
  assert.ok(capped.some((a) => a.pos === 80) && capped.some((a) => a.pos === 28), 'the later swings in full too');
  assert.equal(capped.find((a) => a.pos === 50 && a.at > 4000 && a.at < t).at, t - Math.ceil((40 * 1000) / (0.97 * 450)), 'the approach starts earlier');
  for (let i = 1; i < capped.length; i++) assert.ok(Math.abs(capped[i].pos - capped[i - 1].pos) * 1000 / (capped[i].at - capped[i - 1].at) <= 450, 'under the cap');
  // two spurts 300 ms apart: both ring, both deeper on their frame
  const two = applyFx(flat, [{ id: 'a', kind: 'spurt', t0: t, t1: t }, { id: 'b', kind: 'spurt', t0: t + 300, t1: t + 300 }], { maxSpeed: 0 });
  assert.ok(isValid(two));
  assert.equal(two.find((a) => a.at === t).pos, 25); assert.equal(two.find((a) => a.at === t + 300).pos, 25);
  // outside the trace: nothing
  assert.equal(applyFx(flat, [{ id: 'x', kind: 'spurt', t0: 20, t1: 20 }]), flat);
});

test('the axis through the layer: a live ghost over the effects reach; baked effects are skipped (un-bake = clear the flag)', async () => {
  const { fxAxisGhost, markBaked } = await import('../src/lib/fx.js');
  const fx = [{ id: 's', kind: 'spurt', t0: 21000, t1: 21000 }, { id: 'o', kind: 'orgasm', t0: 30000, t1: 34000 }];
  const g = fxAxisGhost(BASE, fx);
  assert.equal(g.source.kind, 'fx'); assert.equal(fxAxisGhost(BASE, fx), g, 'same object while nothing changes');
  assert.ok(g.script[0].at >= 18000 && g.script[g.script.length - 1].at <= 37000, 'only over the reach');
  assert.equal(fxAxisGhost(BASE, []), null);
  const baked = markBaked(fx, { t0: 20000, t1: 22000 });
  assert.deepEqual(baked.map((e) => !!e.baked), [true, false]);
  assert.deepEqual(applyFx(BASE, baked), applyFx(BASE, [fx[1]]), 'a baked effect does not apply twice');
  assert.equal(markBaked(baked, { t0: 0, t1: 1000 }), baked);
});

test('editing a baked effect un-bakes it (params, span, kind, a copy): the edit acts instead of silently doing nothing', async () => {
  const { setFxParams, dragFx, setFxKind, duplicateFx, toggleMute } = await import('../src/features/timeline/fx-edit.js');
  const { markBaked } = await import('../src/lib/fx.js');
  const baked = markBaked([{ id: 'o', kind: 'orgasm', t0: 21000, t1: 30000, params: {} }]);
  assert.equal(applyFx(BASE, baked), BASE, 'baked: skipped');
  const edits = [setFxParams(baked, 'o', { hi: 60 }), dragFx(baked, 'o', 'body', { dt: 1000 }), dragFx(baked, 'o', 't1', { t: 32000 }), setFxKind(baked, 'o', 'climax'),
    duplicateFx(baked, 'o', { newId: () => 'o2' }).list.filter((e) => e.id === 'o2')];
  for (const L of edits) { assert.ok(L.length === 1 && !('baked' in L[0])); assert.notEqual(applyFx(BASE, L), BASE); }
  assert.equal(toggleMute(baked, 'o')[0].baked, true, 'mute is not an edit of the output: still baked');
});

test('a scene selection goes to its linked run, else the newest run covering it', async () => {
  const { runForScene } = await import('../src/lib/runs.js');
  const g = (id, t0, t1) => ({ id, source: { kind: 'tracker', range: { t0, t1 } }, script: [{ at: t0, pos: 0 }, { at: t1, pos: 100 }] });
  const ghosts = [g('run1', 0, 20000), g('run2', 5000, 15000), { id: 'ref', pinned: true, source: { kind: 'reference' }, script: [{ at: 0, pos: 0 }, { at: 60000, pos: 0 }] }];
  const scene = { start_ms: 6000, end_ms: 12000 };
  assert.equal(runForScene(scene, [], ghosts), 'run2', 'newest covering');
  assert.equal(runForScene(scene, [{ t0: 6000, t1: 12000, run: 'run1', channel: 'g1_proj' }], ghosts), 'run1', 'the link wins');
  assert.equal(runForScene(scene, [{ t0: 6000, t1: 12000, run: 'gone', channel: 'primary' }], ghosts), 'run2', 'a link whose ghost is gone: fallback');
  assert.equal(runForScene({ start_ms: 30000, end_ms: 40000 }, [], ghosts), null);
});

// ---- knotting, mode 'single': one slow insertion (push, pop, settle, the tie) ----
const SLOW = Object.freeze([{ at: 0, pos: 90 }, { at: 1000, pos: 20 }, { at: 2000, pos: 85 }, { at: 3000, pos: 60 }, { at: 9000, pos: 55 }, { at: 10000, pos: 80 }, { at: 11000, pos: 10 }].map(Object.freeze));

test('knotting single: auto on a span without 2 tracked turns; push from the start level onto the knot, pop to full depth, settle, held to the end', () => {
  const t0 = 3000, t1 = 8000, e = { id: 'k', kind: 'knotting', t0, t1 }, out = applyFx(SLOW, [e]);
  assert.ok(isValid(out));
  outsideIdentical(out, SLOW, t0, t1);
  assert.deepEqual(applyFx(SLOW, [{ ...e, params: { mode: 'single' } }]), out, 'auto = single here');
  const at = (t) => out.find((a) => a.at === t)?.pos;
  // defaults: from 100, push 0.75 of the span ending at popAt 0.8 (t 7000) on the knot (lo 0 + popDepth 15), pop >= 80 ms, tie 5
  assert.equal(at(3000), 100, "the base point on t0 yields"); assert.equal(at(3250), 100); assert.equal(at(7000), 15);
  const popEnd = out.find((a) => a.at > 7000);
  assert.equal(popEnd.pos, 0); assert.ok(popEnd.at - 7000 >= 80 && popEnd.at - 7000 <= 120, 'the pop is quick');
  assert.equal(at(8000), 5, 'held at the tie level at the span end');
  assert.ok(out.filter((a) => a.at > t0 && a.at <= 7000).every((a, i, l) => !i || a.pos <= l[i - 1].pos), 'the push only goes deeper');
  // from = null: the push starts where the trace is
  assert.equal(applyFx(SLOW, [{ ...e, params: { from: null } }]).find((a) => a.at === 3000).pos, 60);
  // ease: more points on the push, still monotone, same ends
  const eased = applyFx(SLOW, [{ ...e, params: { easeIn: 0.6, easeOut: 0.8 } }]);
  assert.ok(eased.filter((a) => a.at > 3250 && a.at < 7000).length >= 4);
});

test('knotting cycles: unchanged by the single-mode params, and forced cycles where auto would pick single', () => {
  const t0 = 4000, t1 = 16000, base = applyFx(BASE, [{ id: 'k', kind: 'knotting', t0, t1 }]);
  assert.deepEqual(applyFx(BASE, [{ id: 'k', kind: 'knotting', t0, t1, params: { mode: 'cycles', push: 0.3, popAt: 0.4, popDepth: 40, settle: 0.3, hold: 50, easeIn: 1, from: 20 } }]), base);
  assert.deepEqual(applyFx(BASE, [{ id: 'k', kind: 'knotting', t0, t1, params: { mode: 'bogus' } }]), base, 'an unknown mode is auto');
  const single = applyFx(SLOW, [{ id: 'k', kind: 'knotting', t0: 3000, t1: 8000 }]);
  assert.notDeepEqual(applyFx(SLOW, [{ id: 'k', kind: 'knotting', t0: 3000, t1: 8000, params: { mode: 'cycles' } }]), single);
});

test('fitKnotIn: push / pop timing off noisy samples of either sign; null where the samples do not show a push', async () => {
  const { fitKnotIn } = await import('../src/lib/fx.js');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  // 30 fps, 0..6 s: out (0.9) until 1.0 s, a slow push to 0.4 at 3.6 s, the pop drops to 0.15 by 3.7 s, holds; +-0.02 noise
  const t = [], v = [];
  for (let ms = 0; ms <= 6000; ms += 33.3) {
    const y = ms < 1000 ? 0.9 : ms < 3600 ? 0.9 - (0.5 * (ms - 1000)) / 2600 : ms < 3700 ? 0.4 - (0.25 * (ms - 3600)) / 100 : 0.15;
    t.push(ms); v.push(y + 0.04 * rnd());
  }
  const f = fitKnotIn({ t, v }, 500, 5500);
  assert.equal(f.mode, 'single');
  assert.ok(Math.abs(f.popAt - 0.62) <= 0.03, `pop at ${f.popAt}`);   // 3.6 s of a 0.5..5.5 s span
  assert.ok(Math.abs(f.push - 0.52) <= 0.06, `push ${f.push}`);      // 1.0 .. 3.6 s
  assert.ok(f.popDepth >= 25 && f.popDepth <= 45, `pop depth ${f.popDepth}`);   // the pop is a third of the travel
  assert.ok(f.settle <= 0.05);
  const g = fitKnotIn({ t, v: v.map((x) => 5 - 3 * x) }, 500, 5500);   // any scale, other sign: same timing
  assert.deepEqual([g.popAt, g.push], [f.popAt, f.push]);
  // no pop: the arrival is the pop time, popDepth not set
  const smooth = fitKnotIn({ t, v: t.map((ms) => (ms < 1000 ? 0.9 : ms < 4000 ? 0.9 - (0.7 * (ms - 1000)) / 3000 : 0.2)) }, 500, 5500);
  assert.equal(smooth.popDepth, undefined); assert.ok(Math.abs(smooth.popAt - 0.69) <= 0.03, `arrival ${smooth.popAt}`);
  // strokes all around, nothing monotone in the span worth a push: null
  const strokes = t.map((ms) => 0.5 + 0.4 * Math.sin(ms / 160));
  assert.equal(fitKnotIn({ t, v: strokes }, 500, 5500), null);
  assert.equal(fitKnotIn({ t: [], v: [] }, 0, 1000), null);
});

test('knotting single popover: every handle reads back its value; twins are its own numbers', async () => {
  const { curveModel, curveTwins } = await import('../src/features/timeline/fx-edit.js');
  const { fxParams } = await import('../src/lib/fx.js');
  const { snapTo } = await import('../src/ui/kit/curve.js');
  for (const params of [{ mode: 'single' }, { mode: 'single', push: 0.5, popAt: 0.7, popDepth: 25, lo: 4, settle: 0.12, hold: 10, easeIn: 0.4, easeOut: -0.3, from: 85 }]) {
    const p = fxParams({ kind: 'knotting', params }), m = curveModel('knotting', p);
    assert.equal(m.handles.length, 9);
    for (const h of m.handles) assert.ok(Math.abs(snapTo(h.toValue(h.x, h.y), h) - h.value) <= (h.step || 1) + 1e-9, `${h.key}: ${h.toValue(h.x, h.y)} vs ${h.value}`);
    assert.deepEqual(curveTwins('knotting', p).map((x) => x.key).sort(), m.handles.map((h) => h.key).sort());
  }
});

// ---- knotting, mode 'unknot': the knot coming out (tie, pull with tugs, pop out, settle) ----
const TIED = Object.freeze([{ at: 0, pos: 90 }, { at: 1000, pos: 10 }, { at: 2000, pos: 5 }, { at: 9000, pos: 8 }, { at: 10000, pos: 95 }, { at: 11000, pos: 20 }].map(Object.freeze));

test('knotting unknot: auto when the trace is deeper before the span than after; held at the tie, pulled out, pop >= 80 ms, settled at `to`', async () => {
  const { knotMode, fxParams } = await import('../src/lib/fx.js');
  const t0 = 3000, t1 = 8000, e = { id: 'u', kind: 'knotting', t0, t1 };
  assert.equal(knotMode(fxParams(e), TIED, t0, t1), 'unknot', 'deeper before, < 2 turns: unknot');
  assert.equal(knotMode(fxParams(e), SLOW, t0, t1), 'single', 'shallower before: one knot');
  assert.equal(knotMode(fxParams(e), BASE, 4000, 16000), 'cycles');
  const out = applyFx(TIED, [{ ...e, params: { tugs: 0 } }]);
  assert.ok(isValid(out));
  outsideIdentical(out, TIED, t0, t1);
  assert.deepEqual(applyFx(TIED, [e]), applyFx(TIED, [{ ...e, params: { mode: 'unknot' } }]), 'auto = unknot here');
  const at = (t) => out.find((a) => a.at === t)?.pos;
  // defaults: tie 5 until popAt 0.8 - pull 0.6 (t 4000), the pull reaches knotOut 17 at 7000, the pop lands on popTo 64, settles onto 100 by + 0.08 span
  assert.equal(at(3000), 5); assert.equal(at(4000), 5); assert.equal(at(7000), 17);
  const pop = out.find((a) => a.at > 7000);
  assert.equal(pop.pos, 64); assert.ok(pop.at - 7000 >= 80 && pop.at - 7000 <= 120, `the pop is quick (${pop.at - 7000} ms)`);
  assert.equal(at(8000), 100, 'settled and held at `to`');
  assert.ok(out.filter((a) => a.at >= t0 && a.at <= t1).every((a, i, l) => !i || a.pos >= l[i - 1].pos), 'without tugs it only comes out');
  // speed cap: a bigger pop takes longer, never shorter than 80 ms
  const big = applyFx(TIED, [{ ...e, params: { tugs: 0, popTo: 100 } }], { maxSpeed: 300 }), bp = big.find((a) => a.at > 7000);
  assert.ok(bp.at - 7000 >= Math.ceil((83 * 1000) / (0.97 * 300)));
  // tugs: slips back in during the pull, still ending at the knot level; `to` as tracked = the trace at the span end
  const tug = applyFx(TIED, [{ ...e, params: { tugs: 3, tugAmp: 6 } }]).filter((a) => a.at > 4000 && a.at <= 7000);
  assert.equal(tug.filter((a, i) => i && a.pos < tug[i - 1].pos).length, 3, 'three slips back in');
  assert.equal(applyFx(TIED, [{ ...e, params: { to: null } }]).find((a) => a.at === 8000).pos, Math.round(posAt(TIED, 8000)));
});

test('knotting cycles and single: byte-identical with the unknot params set', () => {
  const cyc = applyFx(BASE, [{ id: 'k', kind: 'knotting', t0: 4000, t1: 16000 }]);
  assert.deepEqual(applyFx(BASE, [{ id: 'k', kind: 'knotting', t0: 4000, t1: 16000, params: { pull: 0.2, tugs: 5, tugAmp: 20, to: 30 } }]), cyc);
  const one = applyFx(SLOW, [{ id: 'k', kind: 'knotting', t0: 3000, t1: 8000 }]);
  assert.deepEqual(applyFx(SLOW, [{ id: 'k', kind: 'knotting', t0: 3000, t1: 8000, params: { pull: 0.2, tugs: 5, tugAmp: 20, to: 30 } }]), one);
});

test('fitKnotOut: pull / pop timing off noisy samples; null on strokes', async () => {
  const { fitKnotOut } = await import('../src/lib/fx.js');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  // tied (0.15) until 1.0 s, a slow pull to 0.4 at 3.6 s, the pop out to 0.8 by 3.7 s, settles to 0.9 by 4.0 s
  const t = [], v = [];
  for (let ms = 0; ms <= 6000; ms += 33.3) {
    const y = ms < 1000 ? 0.15 : ms < 3600 ? 0.15 + (0.25 * (ms - 1000)) / 2600 : ms < 3700 ? 0.4 + (0.4 * (ms - 3600)) / 100 : ms < 4000 ? 0.8 + (0.1 * (ms - 3700)) / 300 : 0.9;
    t.push(ms); v.push(y + 0.02 * rnd());
  }
  const f = fitKnotOut({ t, v }, 500, 5500);
  assert.equal(f.mode, 'unknot');
  assert.ok(Math.abs(f.popAt - 0.62) <= 0.03, `pop at ${f.popAt}`);
  assert.ok(f.pull >= 0.38 && f.pull <= 0.56, `pull ${f.pull}`);
  assert.ok(f.settle <= 0.12, `settle ${f.settle}`);
  assert.deepEqual(fitKnotOut({ t, v: v.map((x) => 3 - 2 * x) }, 500, 5500), f, 'any scale or sign');
  assert.equal(fitKnotOut({ t, v: t.map((ms) => 0.5 + 0.4 * Math.sin(ms / 160)) }, 500, 5500), null);
});

test('unknot popover: every handle reads back its value (tug count too); twins are its own numbers', async () => {
  const { curveModel, curveTwins } = await import('../src/features/timeline/fx-edit.js');
  const { fxParams } = await import('../src/lib/fx.js');
  const { snapTo } = await import('../src/ui/kit/curve.js');
  for (const params of [{ mode: 'unknot' }, { mode: 'unknot', tugs: 0 }, { mode: 'unknot', tugs: 5, tugAmp: 9, pull: 0.4, popAt: 0.7, knotOut: 25, popTo: 70, settle: 0.15, hold: 8, to: 90 }, { mode: 'unknot', tugs: 1 }]) {
    const p = fxParams({ kind: 'knotting', params }), m = curveModel('knotting', p);
    assert.equal(m.handles.length, p.tugs ? 9 : 8);
    for (const h of m.handles) assert.ok(Math.abs(snapTo(h.toValue(h.x, h.y), h) - h.value) <= (h.step || 1) + 1e-9, `${h.key}: ${h.toValue(h.x, h.y)} vs ${h.value}`);
    assert.deepEqual(curveTwins('knotting', p).map((x) => x.key).sort(), m.handles.map((h) => h.key).sort());
  }
});

// ---- linked effects: one set of params over several effects ----
test('linked effects: link per kind, params fan out (spans stay), duplicate keeps the link, unlink keeps params, bake marks every member', async () => {
  const { linkFx, unlinkFx, linkMembers, setFxParams, duplicateFx, setFxKind } = await import('../src/features/timeline/fx-edit.js');
  const { markBaked } = await import('../src/lib/fx.js');
  const L0 = [{ id: 'a', kind: 'spurt', t0: 1000, t1: 1000, params: { amount: 40 } }, { id: 'b', kind: 'spurt', t0: 2000, t1: 2000, params: {} },
    { id: 'c', kind: 'spurt', t0: 3000, t1: 3000, params: { count: 5 } }, { id: 'o', kind: 'orgasm', t0: 0, t1: 5000, params: {} }];
  let n = 0;
  const L = linkFx(L0, ['a', 'b', 'c', 'o'], { primary: 'a', newLink: () => `L${++n}` });
  assert.deepEqual(L.map((e) => e.link), ['L1', 'L1', 'L1', undefined], 'per kind; a lone orgasm is left alone');
  assert.deepEqual(L.map((e) => e.params), [{ amount: 40 }, { amount: 40 }, { amount: 40 }, {}], "the primary's params");
  assert.deepEqual(linkMembers(L, 'b').map((e) => e.id), ['a', 'b', 'c']);
  assert.deepEqual(linkFx(L0, ['a', 'b'], { primary: 'b', newLink: () => 'L9' })[1].params, { amount: 40 }, 'a default primary does not wipe a tuned one');
  const P = setFxParams(L, 'c', { decay: 0.5 });
  assert.deepEqual(P.slice(0, 3).map((e) => e.params), Array(3).fill({ amount: 40, decay: 0.5 }), 'fan-out');
  assert.deepEqual(P.map((e) => e.t0), L.map((e) => e.t0), 'spans stay their own');
  assert.equal(P[3], L[3]);
  const d = duplicateFx(P, 'b', { newId: () => 'b2' });
  assert.equal(d.list.find((e) => e.id === 'b2').link, 'L1', 'a copy stays in the group');
  const U = unlinkFx(P, ['c']);
  assert.deepEqual([U[2].link, U[2].params], [undefined, { amount: 40, decay: 0.5 }], 'unlinked, params as they are');
  assert.equal(setFxParams(U, 'c', { amount: 5 })[0].params.amount, 40, 'an unlinked edit stays its own');
  assert.equal(unlinkFx(U, ['b']).find((e) => e.id === 'a').link, undefined, 'a group of one drops its link');
  assert.equal(setFxKind(P, 'a', 'orgasm').find((e) => e.id === 'a').link, undefined, 'another kind leaves the group');
  const B = markBaked(P);
  assert.ok(B.slice(0, 3).every((e) => e.baked && e.link === 'L1'), 'bake marks every member (the link survives)');
  const E = setFxParams(B, 'a', { amount: 30 });
  assert.deepEqual(E.slice(0, 3).map((e) => [!!e.baked, e.params.amount]), [[false, 30], [true, 30], [true, 30]], 'only the edited one un-bakes');
});

test('U follows the spurt before it (linked, or its own params), Alt+U does not; scene bounds and 10 s', async () => {
  const { addSpurt } = await import('../src/features/timeline/fx-edit.js');
  let n = 0;
  const nl = () => `L${++n}`, scenes = [{ start_ms: 0, end_ms: 10000 }, { start_ms: 10000, end_ms: 30000 }];
  const plain = addSpurt([], { id: 's1', t: 1000, scenes, newLink: nl });
  assert.equal(plain.linked, false);
  assert.equal(addSpurt(plain.list, { id: 's2', t: 1500, scenes, newLink: nl }).linked, false, 'a default spurt before: nothing to follow');
  const custom = [{ id: 's1', kind: 'spurt', t0: 1000, t1: 1000, params: { amount: 40, count: 5 } }];
  const r = addSpurt(custom, { id: 's2', t: 1500, scenes, newLink: nl });
  assert.equal(r.linked, true);
  assert.deepEqual(r.list.map((e) => [e.id, e.link, e.params]), [['s1', 'L1', { amount: 40, count: 5 }], ['s2', 'L1', { amount: 40, count: 5 }]]);
  const r3 = addSpurt(r.list, { id: 's3', t: 1800, scenes, newLink: nl });
  assert.deepEqual(r3.list.map((e) => e.link), ['L1', 'L1', 'L1'], 'joins the existing link');
  const alt = addSpurt(r.list, { id: 's3', t: 1800, scenes, unlinked: true, newLink: nl }).list.find((e) => e.id === 's3');
  assert.deepEqual([alt.link, alt.params], [undefined, {}], 'Alt+U: unlinked, defaults');
  assert.equal(addSpurt(custom, { id: 'x', t: 10500, scenes, newLink: nl }).linked, false, 'another scene');
  assert.equal(addSpurt(custom, { id: 'x', t: 9000, newLink: nl }).linked, true, 'no scenes: within 10 s');
  assert.equal(addSpurt(custom, { id: 'x', t: 12000, newLink: nl }).linked, false, 'no scenes: not past 10 s');
});

// ---- throb: a heartbeat on the trace ----
test('throbbing: the measured heartbeat at defaults (40 ms down by 10, 290 ms back, every 667 ms) on a flat trace at 100', () => {
  const flat = [{ at: 0, pos: 100 }, { at: 30000, pos: 100 }], e = { id: 'th', kind: 'throbbing', t0: 1000, t1: 5000 };
  const out = applyFx(flat, [e]);
  assert.ok(isValid(out));
  const beat = (tb) => out.filter((a) => a.at >= tb && a.at <= tb + 330).map((a) => [a.at - tb, a.pos]);
  for (let k = 0; k < 6; k++) assert.deepEqual(beat(1000 + 667 * k), [[0, 100], [40, 90], [330, 100]], `beat ${k}`);
  assert.equal(out.filter((a) => a.pos === 90).length, 6, '6 whole beats in 4 s (a 7th would run past the span)');
  assert.deepEqual(out.filter((a) => a.at < 1000 || a.at > 5000), flat, 'the trace outside');
  // squeezed near 0: a dip on a trace at 4 only goes to 0; a swell there goes out
  const low = [{ at: 0, pos: 4 }, { at: 30000, pos: 4 }];
  assert.equal(Math.min(...applyFx(low, [e]).map((a) => a.pos)), 0);
  assert.equal(Math.max(...applyFx(low, [{ ...e, params: { dir: 'swell' } }]).map((a) => a.pos)), 14);
  // the envelope: the first beats small, the full dip mid-span
  const env = applyFx(flat, [{ ...e, t1: 9000, params: { rampIn: 0.4 } }]), d = (tb) => 100 - env.find((a) => a.at === tb + 40).pos;
  assert.ok(d(1000 + 667) < d(1000 + 667 * 4) && d(1000 + 667 * 6) === 10, 'builds');
  // lub-dub: a second dip of half at +120 ms
  const dub = applyFx(flat, [{ ...e, params: { double: 0.5 } }]);
  assert.deepEqual(dub.filter((a) => a.at >= 1000 && a.at <= 1450).map((a) => [a.at - 1000, a.pos]), [[0, 100], [40, 90], [120, 100], [160, 95], [450, 100]]);
  // a speed cap lengthens the dip, the amount is kept, the dip stays on its time (the beat starts earlier: paw-r9nh)
  const capped = applyFx(flat, [{ ...e, params: { amount: 30 } }], { maxSpeed: 300 });
  assert.equal(capped.find((a) => a.at === 1040).pos, 70);
  assert.equal(capped.find((a) => a.at === 1040 - Math.ceil((30 * 1000) / (0.97 * 300))).pos, 100);
  // jitter: seeded (deterministic), the beats move
  const j = applyFx(flat, [{ ...e, t1: 9000, params: { jitter: 0.2 } }]);
  assert.deepEqual(applyFx(flat, [{ ...e, t1: 9000, params: { jitter: 0.2 } }]), j);
  assert.notDeepEqual(j, applyFx(flat, [{ ...e, t1: 9000 }]));
});

test('throbbing popover and fit: every handle reads back its value; the period is the median spacing of the pulses', async () => {
  const { curveModel } = await import('../src/features/timeline/fx-edit.js');
  const { fxParams, throbPeriod } = await import('../src/lib/fx.js');
  const { snapTo } = await import('../src/ui/kit/curve.js');
  for (const params of [{}, { amount: 20, attack: 60, release: 200, period: 900, double: 0.4, rampIn: 0.2, rampOut: 0.3, dir: 'swell' }]) {
    const p = fxParams({ kind: 'throbbing', params }), m = curveModel('throbbing', p);
    assert.equal(m.handles.length, 7);
    for (const h of m.handles) assert.ok(Math.abs(snapTo(h.toValue(h.x, h.y), h) - h.value) <= (h.step || 1) + 1e-9, `${h.key}: ${h.toValue(h.x, h.y)} vs ${h.value}`);
  }
  assert.equal(fxParams({ kind: 'throbbing', params: { dir: 'sideways' } }).dir, 'dip');
  assert.equal(throbPeriod([0, 660, 1340, 2000, 2670, 3500]), 670);
  assert.equal(throbPeriod([0, 700]), null);
});

test('a single throb (Shift+U) is a throbbing range one beat long: its dip on the frame (40 ms down by 10, 290 ms back); its popover has no period', async () => {
  const { singleThrob, isPointFx, fxParams } = await import('../src/lib/fx.js');
  const { curveModel, curveTwins } = await import('../src/features/timeline/fx-edit.js');
  const flat = [{ at: 0, pos: 100 }, { at: 30000, pos: 100 }], s = singleThrob(2000), e = { id: 'th1', kind: 'throbbing', ...s };
  assert.deepEqual([s.t0, s.t1], [1960, 2291]);
  assert.equal(isPointFx(e), false, 'a range, not a point');
  const out = applyFx(flat, [e]);
  assert.ok(isValid(out));
  assert.deepEqual(out, [{ at: 0, pos: 100 }, { at: 1960, pos: 100 }, { at: 2000, pos: 90 }, { at: 2290, pos: 100 }, { at: 30000, pos: 100 }], 'exactly one beat');
  const p = fxParams(e), m = curveModel('throbbing', p, true);
  assert.ok(!m.handles.some((h) => ['period', 'rampIn', 'rampOut'].includes(h.key)), 'one beat: no period, build or fade');
  assert.ok(!curveTwins('throbbing', p, m.handles, true).some((t) => t.key === 'jitter'));
});
