// lib/graph types.js: every compat cell, adapters, signal and spans helpers, checks and summaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPES, compat, compatParam, gridFor, makeSignal, signalAt, sliceSignal, sampleScript, resampleSeries, clipScript,
  normSpans, flattenSpans, unionSpans, intersectSpans, invertSpans, spanAt, spansToAts, atsToSpans, valueAt,
  summarize, checkValue, bytesOf, adapt, snapRate,
} from '../src/lib/graph/types.js';

const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o) && !ArrayBuffer.isView(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
const ends = (spans) => spans.map((s) => [s.t0, s.t1, s.kind]);

test('TYPES lists the five port types with SERIES colours', () => {
  assert.deepEqual(Object.keys(TYPES), ['script', 'signal', 'spans', 'number', 'any']);
  for (const t of Object.values(TYPES)) assert.ok(['sky', 'green', 'yellow', 'grey', 'violet'].includes(t.color));
});

test('compat: every cell of the table', () => {
  const C = ['script', 'signal', 'spans', 'number'];
  const expect = {
    'script>signal': { ok: true, adapter: 'sample' },
    'number>signal': { ok: true, adapter: 'const' },
  };
  const refuse = {
    'signal>script': ['sig.toScript', 'sig.sampleAt'],
    'script>spans': ['script.turns', 'script.strokes'],
    'signal>spans': ['spans.threshold'],
    'spans>signal': ['spans.toSignal', 'spans.kindValue'],
    'script>number': ['an.stat'],
    'signal>number': ['an.stat'],
    'spans>script': ['flow.switch', 'script.splice'],
  };
  for (const a of C) {
    for (const b of C) {
      const r = compat(a, b);
      const k = `${a}>${b}`;
      if (a === b) assert.deepEqual(r, { ok: true }, k);
      else if (expect[k]) assert.deepEqual(r, expect[k], k);
      else {
        assert.equal(r.ok, false, k);
        assert.ok(r.reason.includes(a) && r.reason.includes(b), `${k}: reason names both types: ${r.reason}`);
        assert.deepEqual(r.suggest, refuse[k] || [], k);
      }
    }
    assert.deepEqual(compat(a, 'any'), { ok: true });
    assert.deepEqual(compat('any', a), { ok: true });
  }
});

test('compatParam: signal params take signal/number/script(sample); number params take numbers only', () => {
  assert.deepEqual(compatParam('signal', 'signal'), { ok: true });
  assert.deepEqual(compatParam('number', 'signal'), { ok: true });
  assert.deepEqual(compatParam('script', 'signal'), { ok: true, adapter: 'sample' });
  assert.equal(compatParam('spans', 'signal').ok, false);
  assert.deepEqual(compatParam('number', 'number'), { ok: true });
  for (const t of ['signal', 'script', 'spans']) assert.equal(compatParam(t, 'number').ok, false);
});

test('snapRate', () => {
  assert.equal(snapRate(undefined), 50);
  assert.equal(snapRate(30), 25);
  assert.equal(snapRate(90), 100);
  assert.equal(snapRate(1000), 200);
  assert.equal(snapRate('abc'), 50);
});

test('gridFor, makeSignal, signalAt', () => {
  assert.deepEqual(gridFor({ t0: 0, t1: 1000 }, 20), { i0: 0, n: 51, dt: 20 });
  assert.deepEqual(gridFor({ t0: 30, t1: 59 }, 20), { i0: 1, n: 2, dt: 20 });
  const s = makeSignal(1, 3, 20, 0);
  assert.equal(s.v.length, 3);
  assert.ok(Number.isNaN(makeSignal(0, 2, 20).v[0]));
  const sig = { i0: 1, dt: 20, v: Float32Array.from([10, 20, NaN, 40]) };
  assert.equal(signalAt(sig, 20), 10);
  assert.equal(signalAt(sig, 30), 15);
  assert.ok(Number.isNaN(signalAt(sig, 50)), 'NaN neighbour');
  assert.ok(Number.isNaN(signalAt(sig, 60)), 'NaN sample');
  assert.equal(signalAt(sig, 80), 40);
  assert.ok(Number.isNaN(signalAt(sig, 19)), 'before');
  assert.ok(Number.isNaN(signalAt(sig, 81)), 'after');
});

test('sliceSignal shares the buffer and covers the range', () => {
  const sig = freeze({ i0: 0, dt: 10, v: Float32Array.from({ length: 101 }, (_, k) => k) });
  const s = sliceSignal(sig, 95, 205);
  assert.equal(s.i0, 9);
  assert.equal(s.v[0], 9);
  assert.equal(s.v[s.v.length - 1], 21);
  assert.equal(s.v.buffer, sig.v.buffer);
  assert.equal(signalAt(s, 150), 15);
  assert.equal(sliceSignal(sig, -100, 5000), sig, 'whole range returns the signal itself');
  assert.equal(sliceSignal(sig, 5000, 6000).v.length, 0);
});

test('sampleScript: linear, NaN outside, empty -> all NaN', () => {
  const script = freeze([{ at: 20, pos: 0 }, { at: 60, pos: 100 }, { at: 100, pos: 50 }]);
  const sig = sampleScript(script, { i0: 0, n: 7, dt: 20 });
  assert.deepEqual([...sig.v].map((x) => (Number.isNaN(x) ? null : x)), [null, 0, 50, 100, 75, 50, null]);
  assert.ok([...sampleScript([], { i0: 0, n: 4, dt: 20 }).v].every(Number.isNaN));
  const one = sampleScript([{ at: 40, pos: 7 }], { i0: 0, n: 4, dt: 20 });
  assert.deepEqual([...one.v].map((x) => (Number.isNaN(x) ? null : x)), [null, null, 7, null]);
});

test('resampleSeries: scale/offset, gaps, NaN sources', () => {
  const t = Float64Array.from([0, 15, 30, 200, 215]);
  const v = Float32Array.from([0, 0.5, 1, NaN, 1]);
  const sig = resampleSeries(t, v, { i0: 0, n: 12, dt: 20 }, { maxGapMs: 50, scale: 100 });
  const got = [...sig.v].map((x) => (Number.isNaN(x) ? null : Math.round(x)));
  assert.equal(got[0], 0);
  assert.equal(got[1], 67); // between 15 (50) and 30 (100)
  assert.equal(got[2], null, 'gap 30..200 > maxGapMs');
  assert.equal(got[10], null, 'next to a NaN source sample');
  assert.equal(got[11], null, 'outside the series');
  const off = resampleSeries(Float64Array.from([0, 100]), Float32Array.from([1, 1]), { i0: 0, n: 2, dt: 100 }, { offset: 5 });
  assert.deepEqual([...off.v], [6, 6]);
});

test('clipScript keeps one neighbour outside each end', () => {
  const s = freeze([0, 100, 200, 300, 400, 500].map((at) => ({ at, pos: at / 10 })));
  assert.deepEqual(clipScript(s, 150, 320).map((a) => a.at), [100, 200, 300, 400]);
  assert.deepEqual(clipScript(s, 200, 300).map((a) => a.at), [100, 200, 300, 400]);
  assert.equal(clipScript(s, -10, 900), s);
  assert.deepEqual(clipScript(s, 600, 700).map((a) => a.at), [500]);
});

test('normSpans: ints, swapped, sorted, non-finite dropped, extra fields kept', () => {
  const out = normSpans(freeze([{ t0: 50.4, t1: 10, kind: 'a' }, { t0: 'x', t1: 3 }, null, { t0: 0, t1: 5, data: { id: 1 } }]));
  assert.deepEqual(out, [{ t0: 0, t1: 5, data: { id: 1 } }, { t0: 10, t1: 50, kind: 'a' }]);
  assert.deepEqual(normSpans(undefined), []);
});

test('flattenSpans: the later start owns the overlap; points kept', () => {
  const s = freeze([{ t0: 0, t1: 100, kind: 'a' }, { t0: 20, t1: 40, kind: 'b' }, { t0: 30, t1: 30, kind: 'p' }, { t0: 90, t1: 120, kind: 'c' }]);
  assert.deepEqual(ends(flattenSpans(s)), [[0, 20, 'a'], [20, 40, 'b'], [30, 30, 'p'], [40, 90, 'a'], [90, 120, 'c']]);
  // equal starts: the one listed later (sorted by t1, so the longer) wins
  assert.deepEqual(ends(flattenSpans([{ t0: 0, t1: 10, kind: 'x' }, { t0: 0, t1: 20, kind: 'y' }])), [[0, 20, 'y']]);
  assert.deepEqual(flattenSpans([]), []);
});

test('unionSpans merges overlapping and touching spans, absorbs inner points', () => {
  const u = unionSpans(freeze([{ t0: 0, t1: 10, kind: 'a' }, { t0: 5, t1: 20, kind: 'b' }, { t0: 30, t1: 30 }]), freeze([{ t0: 20, t1: 25, kind: 'c' }, { t0: 7, t1: 7 }, { t0: 30, t1: 30 }]));
  assert.deepEqual(ends(u), [[0, 25, 'a'], [30, 30, undefined]]);
});

test('intersectSpans keeps a\'s fields; points survive where covered', () => {
  const a = freeze([{ t0: 0, t1: 50, kind: 'k' }, { t0: 60, t1: 60, kind: 'pt' }]);
  const b = freeze([{ t0: 10, t1: 20 }, { t0: 40, t1: 70 }, { t0: 5, t1: 5 }]);
  assert.deepEqual(ends(intersectSpans(a, b)), [[5, 5, 'k'], [10, 20, 'k'], [40, 50, 'k'], [60, 60, 'pt']]);
});

test('invertSpans: gaps inside [t0, t1)', () => {
  assert.deepEqual(invertSpans([{ t0: 10, t1: 20 }, { t0: 15, t1: 30 }, { t0: 50, t1: 50 }], 0, 40), [{ t0: 0, t1: 10 }, { t0: 30, t1: 40 }]);
  assert.deepEqual(invertSpans([], 0, 10), [{ t0: 0, t1: 10 }]);
  assert.deepEqual(invertSpans([{ t0: -5, t1: 15 }], 0, 10), []);
});

test('spanAt: flattened; a point matches only at t0', () => {
  const s = freeze([{ t0: 0, t1: 100, kind: 'a' }, { t0: 20, t1: 40, kind: 'b' }, { t0: 200, t1: 200, kind: 'p' }]);
  assert.equal(spanAt(s, 30).kind, 'b');
  assert.equal(spanAt(s, 40).kind, 'a');
  assert.equal(spanAt(s, 100), null, 'half-open');
  assert.equal(spanAt(s, 200).kind, 'p');
  assert.equal(spanAt(s, 201), null);
});

test('spansToAts and atsToSpans', () => {
  const script = freeze([0, 10, 20, 30, 40].map((at) => ({ at, pos: 50 })));
  assert.deepEqual([...spansToAts(script, [{ t0: 10, t1: 30 }, { t0: 40, t1: 40 }, { t0: 35, t1: 35 }])].sort((a, b) => a - b), [10, 20, 40]);
  assert.deepEqual(atsToSpans(new Set([30, 10, 10.2]), 'turn'), [{ t0: 10, t1: 10, kind: 'turn' }, { t0: 30, t1: 30, kind: 'turn' }]);
  assert.deepEqual(atsToSpans([5]), [{ t0: 5, t1: 5 }]);
});

test('valueAt per type', () => {
  assert.equal(valueAt('script', [{ at: 0, pos: 0 }, { at: 100, pos: 100 }], 25), 25);
  assert.equal(valueAt('signal', { i0: 0, dt: 10, v: Float32Array.from([0, 10]) }, 5), 5);
  assert.equal(valueAt('spans', [{ t0: 0, t1: 10, kind: 'x' }], 5).kind, 'x');
  assert.equal(valueAt('number', 4, 99), 4);
  assert.equal(valueAt('script', undefined, 0), null);
});

test('summarize formats', () => {
  const script = Array.from({ length: 4812 }, (_, i) => ({ at: i * 124, pos: 5 + (i % 91) }));
  assert.equal(summarize('script', script), '4 812 pts · 0:00–9:56 · 5–95');
  const v = new Float32Array(30001).fill(50);
  v[0] = 38; v[1] = 92;
  for (let k = 10; k < 3610; k++) v[k] = NaN;
  assert.equal(summarize('signal', { i0: 0, dt: 20, v }), '30 001 smp · 38–92 · 12% gaps');
  const spans = [...Array(3)].map((_, i) => ({ t0: i, t1: i + 1, kind: 'climax' })).concat([...Array(6)].map((_, i) => ({ t0: 10 + i, t1: 11 + i, kind: 'oral' })), [...Array(5)].map((_, i) => ({ t0: 20 + i, t1: 21 + i })));
  assert.equal(summarize('spans', spans), '14 spans · climax 3, oral 6');
  assert.equal(summarize('spans', [{ t0: 1, t1: 1 }, { t0: 2, t1: 2 }]), '2 points');
  assert.equal(summarize('number', 62.4), '62.4');
  assert.equal(summarize('script', []), '0 pts');
});

test('checkValue: valid and invalid values per type', () => {
  assert.equal(checkValue('script', [{ at: 0, pos: 0 }, { at: 1, pos: 100 }]), '');
  assert.notEqual(checkValue('script', [{ at: 1, pos: 0 }, { at: 1, pos: 0 }]), '');
  assert.notEqual(checkValue('script', [{ at: 0, pos: 101 }]), '');
  assert.notEqual(checkValue('script', [{ at: 0.5, pos: 1 }]), '');
  assert.equal(checkValue('signal', { i0: 0, dt: 20, v: new Float32Array(2) }), '');
  assert.notEqual(checkValue('signal', { i0: 0, dt: 20, v: [1, 2] }), '');
  assert.notEqual(checkValue('signal', { i0: 0.5, dt: 20, v: new Float32Array(2) }), '');
  assert.equal(checkValue('spans', [{ t0: 0, t1: 0 }, { t0: 0, t1: 5 }]), '');
  assert.notEqual(checkValue('spans', [{ t0: 5, t1: 6 }, { t0: 0, t1: 5 }]), '');
  assert.notEqual(checkValue('spans', [{ t0: 5, t1: 1 }]), '');
  assert.equal(checkValue('number', 3), '');
  assert.notEqual(checkValue('number', NaN), '');
  assert.notEqual(checkValue('number', true), '');
});

test('bytesOf estimates and adapt applies the two adapters', () => {
  assert.equal(bytesOf('script', [{ at: 0, pos: 0 }]), 56);
  assert.equal(bytesOf('signal', { v: new Float32Array(10) }), 72);
  assert.equal(bytesOf('number', 1), 8);
  const g = { i0: 0, n: 3, dt: 50 };
  assert.deepEqual([...adapt('const', 7, g).v], [7, 7, 7]);
  assert.deepEqual([...adapt('sample', [{ at: 0, pos: 0 }, { at: 100, pos: 100 }], g).v], [0, 50, 100]);
});
