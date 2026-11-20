import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptColumns, signalColumns, sigAt, signalRange, visibleSpans } from '../src/features/graph/editor/decimate.js';
import { writeClip, readClip, fragmentOrigin, FORMAT } from '../src/features/graph/editor/clipboard.js';

const deepFreeze = (o) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) deepFreeze(v); return o; };

test('scriptColumns: points with neighbours when sparse, min/max bands when dense', () => {
  const s = deepFreeze([{ at: 0, pos: 0 }, { at: 100, pos: 100 }, { at: 200, pos: 0 }, { at: 300, pos: 100 }]);
  const r = scriptColumns(s, 120, 180, 100);
  assert.deepEqual(r.pts, [[100, 100], [200, 0]]);
  const big = deepFreeze(Array.from({ length: 10000 }, (_, i) => ({ at: i * 10, pos: i % 2 ? 90 : 10 })));
  const d = scriptColumns(big, 0, 99990, 100);
  assert.equal(d.min.length, 100);
  assert.equal(d.min[50], 10);
  assert.equal(d.max[50], 90);
});

test('sigAt interpolates and returns NaN at gaps and outside', () => {
  const sig = { i0: 5, dt: 20, v: new Float32Array([0, 10, NaN, 30]) };
  assert.equal(sigAt(sig, 100), 0);
  assert.equal(sigAt(sig, 110), 5);
  assert.ok(Number.isNaN(sigAt(sig, 130)));
  assert.ok(Number.isNaN(sigAt(sig, 90)));
  assert.equal(sigAt(sig, 160), 30);
  assert.ok(Number.isNaN(sigAt(sig, 170)));
});

test('signalColumns: per-column min/max, NaN columns stay NaN, zoomed-in interpolates', () => {
  const v = new Float32Array(1000);
  for (let i = 0; i < 1000; i++) v[i] = i < 500 ? i % 100 : NaN;
  const sig = { i0: 0, dt: 20, v };
  const c = signalColumns(sig, 0, 19980, 10);
  assert.equal(c.min[0], 0);
  assert.equal(c.max[0], 99);
  assert.ok(Number.isNaN(c.min[9]));
  const z = signalColumns(sig, 0, 100, 50);
  assert.ok(Math.abs(z.min[25] - 2.55) < 1e-4);
});

test('signalRange prefers the hint, then position/unit scales', () => {
  assert.deepEqual(signalRange({ v: new Float32Array([1, 2]), range: [0, 5] }), [0, 5]);
  assert.deepEqual(signalRange({ v: new Float32Array([10, 80]) }), [0, 100]);
  assert.deepEqual(signalRange({ v: new Float32Array([0.2, 0.4]) }), [0, 1]);
  assert.deepEqual(signalRange({ v: new Float32Array([NaN]) }), [0, 1]);
  assert.deepEqual(signalRange({ v: new Float32Array([-5, 300]) }), [-5, 300]);
});

test('visibleSpans keeps spans and points touching the range', () => {
  const sp = [{ t0: 0, t1: 50 }, { t0: 60, t1: 60 }, { t0: 100, t1: 300 }, { t0: 400, t1: 500 }];
  assert.deepEqual(visibleSpans(sp, 55, 350).map((s) => s.t0), [60, 100]);
});

test('clipboard round trip, bare fragments, rejects non-fragments, drops dangling links', () => {
  const frag = deepFreeze({ id: 'p', name: 'x', nodes: [{ id: 'a', type: 'src.axis', x: 40, y: 60 }, { id: 'b', type: 'edit.smooth', x: 300, y: 20 }],
    links: [{ from: 'a', out: 'script', to: 'b', in: 'script' }, { from: 'a', out: 'script', to: 'gone', in: 'script' }] });
  const text = writeClip(frag);
  assert.equal(JSON.parse(text).format, FORMAT);
  const back = readClip(text);
  assert.equal(back.nodes.length, 2);
  assert.equal(back.links.length, 1);
  assert.deepEqual(fragmentOrigin(back), { x: 40, y: 20 });
  assert.equal(readClip(JSON.stringify({ nodes: [{ id: 'a', type: 't' }], links: [] })).nodes.length, 1);
  assert.equal(readClip('hello'), null);
  assert.equal(readClip('{"nodes":[]}'), null);
  assert.equal(readClip('[1,2]'), null);
  assert.equal(readClip(JSON.stringify({ nodes: [{ id: 'a' }] })), null);
});
