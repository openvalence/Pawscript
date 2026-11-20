import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTitle } from '../src/lib/runs.js';
import { runLabel } from '../src/features/timeline/generate-logic.js';

const SC = [{ start_ms: 0, end_ms: 60000 }, { start_ms: 60000, end_ms: 72300 }, { start_ms: 72300, end_ms: 100000 }, { start_ms: 100000, end_ms: 200000 }];
const run = (n, start, end) => ({ n, range: { start, end } });

test('runTitle: scenes · range · #k among the runs over the same scenes', () => {
  const a = run(3, 72300, 100000), b = run(7, 72300, 100000), c = run(5, 61000, 120000), d = run(9, 73000, 90000);
  const runs = [a, b, c, d];
  assert.equal(runTitle(a, SC, runs), 'S3 · 1:12.3–1:40.0 · #1');
  assert.equal(runTitle(b, SC, runs), 'S3 · 1:12.3–1:40.0 · #2');
  assert.equal(runTitle(d, SC, runs), 'S3 · 1:13.0–1:30.0 · #3');   // same scene, other range: still counted
  assert.equal(runTitle(c, SC, runs), 'S2–S4 · 1:01.0–2:00.0 · #1');
  assert.equal(runTitle(b, [], runs), '1:12.3–1:40.0 · #3');        // no scenes: by n among every run (a, c before it)
  assert.equal(runTitle(b, SC.slice(0, 2), runs), '1:12.3–1:40.0 · #2');   // re-cut: overlaps no scene now, like a (c overlaps S2)
  assert.equal(runTitle(run(1, 0, 5000)), '0:00.0–0:05.0 · #1');
});

test('runLabel: a run title keeps its times (cut only at ": ")', () => {
  assert.equal(runLabel({ name: 'S3 · 1:12.3–1:40.0 · #2' }), 'S3 · 1:12.3–1:40.0 · #2');
  assert.equal(runLabel({ name: '#3 TAPNext: a note' }), '#3 TAPNext');
});
