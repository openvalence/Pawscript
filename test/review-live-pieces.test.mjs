// [review] edge cases of lib/script-of.js settle / bake against run ranges (pieces of a shot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveSpans, composeLive, settleEdit, bakeSpans } from '../src/lib/script-of.js';

const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t < t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const inS = (s, t0, t1) => s.filter((p) => p.at >= t0 && p.at < t1);
const A = { id: 'A', name: '#1', script: saw(0, 4000, 100, 30, 70) };
const B = { id: 'B', name: '#2', script: saw(0, 4000, 100, 10, 90) };

test('a hand edit in one piece of a two-run shot keeps the other piece playing', () => {
  // one shot [0, 4000): run A plays [0, 2000), run B plays [2000, 4000) (two run ranges in one shot)
  const shots = [{ start_ms: 0, end_ms: 4000 }];
  const runOf = () => [{ t0: 0, t1: 2000, g: A }, { t0: 2000, t1: 4000, g: B }];
  const base = [];
  const live = composeLive(base, liveSpans({ shots, base, runOf }));
  assert.deepEqual(inS(live.script, 2000, 4000), inS(B.script, 2000, 4000));
  // move one point in A's piece
  const next = live.script.map((p) => (p.at === 500 ? { at: 500, pos: 5 } : p));
  const raw = settleEdit(base, live, next);
  // what plays after the edit (the store recomposes from the new base)
  const after = composeLive(raw, liveSpans({ shots, base: raw, runOf })).script;
  assert.deepEqual(inS(after, 2000, 4000), inS(B.script, 2000, 4000), 'B piece must still play (it vanished)');
});

test('Bake by run on a two-run shot keeps the other run playing', () => {
  const shots = [{ start_ms: 0, end_ms: 4000 }];
  const runOf = () => [{ t0: 0, t1: 2000, g: A }, { t0: 2000, t1: 4000, g: B }];
  const live = composeLive([], liveSpans({ shots, base: [], runOf }));
  const baked = bakeSpans([], live, live.spans.filter((s) => s.id === 'A'));
  const after = composeLive(baked, liveSpans({ shots, base: baked, runOf })).script;
  assert.deepEqual(inS(after, 2000, 4000), inS(B.script, 2000, 4000), 'B piece must still play');
});

